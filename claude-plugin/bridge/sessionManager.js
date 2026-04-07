import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { log, warn, error } from './logger.js';

export class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.focusSessionId = null;
    this.focusAgentId = null;
  }

  getOrCreate(input) {
    const id = input.session_id;
    if (!id) throw new Error('session_id is required');
    if (!this.sessions.has(id)) {
      const disk = _findDiskSession(id, input.cwd);
      const baseName = input.cwd ? path.basename(input.cwd) : 'session';
      const defaultName = disk?.name || this._nextIndexedName(baseName);
      this.sessions.set(id, {
        id,
        _diskPid: disk?.pid || null,
        name: defaultName,
        cwd: input.cwd || '',
        state: 'IDLE',
        waitingSince: null,
        prompt: null,
        respondFn: null,
        lastToolResult: null,
        agents: new Map(),
      });
    } else {
      // Refresh name from disk on every hook event (catches /rename immediately)
      const session = this.sessions.get(id);
      if (session._diskPid) {
        try {
          const file = path.join(os.homedir(), '.claude', 'sessions', `${session._diskPid}.json`);
          const data = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (data.name && data.name !== session.name) {
            session.name = data.name;
          }
        } catch { /* file may not exist */ }
      }
    }
    return this.sessions.get(id);
  }

  get(id) {
    return this.sessions.get(id);
  }

  /** Generate indexed default name: baseName[0], baseName[1], ... */
  _nextIndexedName(baseName) {
    let maxIdx = -1;
    for (const s of this.sessions.values()) {
      const m = s.name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d+)\\]$`));
      if (m) maxIdx = Math.max(maxIdx, parseInt(m[1], 10));
      else if (s.name === baseName) maxIdx = Math.max(maxIdx, 0);
    }
    return maxIdx < 0 ? baseName : `${baseName}[${maxIdx + 1}]`;
  }

  get sessionCount() {
    return this.sessions.size;
  }

  handleSessionStart(input) {
    const session = this.getOrCreate(input);
    session.state = 'IDLE';
    session.idleSince = Date.now();
    session.startedAt = session.startedAt || Date.now();
    return session;
  }

  handleSessionEnd(input) {
    const session = this.sessions.get(input.session_id);
    if (!session) return null;
    if (session._permissionTimeout) {
      clearTimeout(session._permissionTimeout);
      session._permissionTimeout = null;
    }
    if (session.respondFn) {
      try { session.respondFn({ type: 'binary', value: 'deny' }); } catch { /* already sent */ }
      session.respondFn = null;
    }
    this.sessions.delete(input.session_id);
    if (this.focusSessionId === input.session_id) {
      this.focusSessionId = null;
      this.focusAgentId = null;
    }
    return session;
  }

  handleUserPromptSubmit(input) {
    const session = this.getOrCreate(input);
    session.state = 'PROCESSING';
    session.prompt = null;
    session.waitingSince = null;
    session.idleSince = null;
    return session;
  }

  handleSubagentStart(input) {
    const session = this.getOrCreate(input);
    session.agents.set(input.agent_id, {
      agentId: input.agent_id,
      type: input.agent_type || 'unknown',
      state: 'PROCESSING',
      startedAt: Date.now(),
    });
    return session;
  }

  handleSubagentStop(input) {
    const session = this.getOrCreate(input);
    session.agents.delete(input.agent_id);
    if (this.focusAgentId === input.agent_id) {
      this.focusAgentId = null;
    }
    return session;
  }

  handleNotify(input) {
    const session = this.getOrCreate(input);
    if (input.agent_id && session.agents.has(input.agent_id)) {
      session.agents.get(input.agent_id).state = 'PROCESSING';
      return session;
    }
    session.state = 'PROCESSING';
    session.prompt = null;
    return session;
  }

  handlePermission(input) {
    const session = this.getOrCreate(input);
    const isChoice = input.tool_name === 'AskUserQuestion';

    if (isChoice) {
      // AskUserQuestion: supports 1-4 questions via questions[] array
      const questions = input.tool_input?.questions || [];
      if (questions.length > 1) {
        // Multi-question mode: store all questions, start at index 0
        session.state = 'WAITING_CHOICE';
        session.prompt = {
          type: 'CHOICE',
          questionIndex: 0,
          questionCount: questions.length,
          questions: questions.map((q) => ({
            question: q.question || '',
            header: q.header || '',
            multiSelect: !!q.multiSelect,
            options: (q.options || []).map((o, i) => ({
              index: i + 1,
              label: o.label || o.description || `Option ${i + 1}`,
            })),
          })),
          answers: {}, // accumulates {question: answer} per question
          // Current question view fields (for layout compatibility)
          ...(() => {
            const q = questions[0];
            const options = q.options || [];
            return {
              question: q.question || '',
              multiSelect: !!q.multiSelect,
              selected: new Set(),
              choices: options.map((o, i) => ({
                index: i + 1,
                label: o.label || o.description || `Option ${i + 1}`,
              })),
            };
          })(),
        };
      } else {
        // Single question (original behavior)
        const options = input.tool_input?.options
          || questions[0]?.options
          || [];
        const question = input.tool_input?.question
          || questions[0]?.question
          || '';
        const multiSelect = !!(input.tool_input?.multiSelect
          || questions[0]?.multiSelect);
        session.state = 'WAITING_CHOICE';
        session.prompt = {
          type: 'CHOICE',
          question,
          multiSelect,
          selected: new Set(),
          choices: options.map((o, i) => ({
            index: i + 1,
            label: o.label || o.description || `Option ${i + 1}`,
          })),
        };
      }
    } else {
      session.state = 'WAITING_BINARY';
      const suggestions = Array.isArray(input.permission_suggestions) ? input.permission_suggestions : [];
      session.prompt = {
        type: 'BINARY',
        toolName: input.tool_name,
        command: input.tool_input?.command || input.tool_input?.file_path || '',
        hasAlwaysAllow: suggestions.length > 0,
        alwaysAllowSuggestion: suggestions[0] || null,
      };
    }

    session.waitingSince = Date.now();
    session._permissionAgentId = input.agent_id || null;

    if (input.agent_id && session.agents.has(input.agent_id)) {
      session.agents.get(input.agent_id).state = isChoice ? 'WAITING_CHOICE' : 'WAITING_BINARY';
    }

    return session;
  }

  handlePostToolUseFailure(input) {
    const session = this.getOrCreate(input);
    if (input.agent_id && session.agents.has(input.agent_id)) {
      session.agents.get(input.agent_id).state = 'PROCESSING';
      return session;
    }
    session.state = 'PROCESSING';
    session.lastToolError = {
      toolName: input.tool_name,
      error: input.error || 'unknown error',
      timestamp: Date.now(),
    };
    return session;
  }

  handlePostToolUse(input) {
    const session = this.getOrCreate(input);
    if (input.agent_id && session.agents.has(input.agent_id)) {
      session.agents.get(input.agent_id).state = 'PROCESSING';
      return session;
    }
    session.state = 'PROCESSING';
    session.lastToolResult = {
      toolName: input.tool_name,
      success: input.tool_result?.errored !== true,
      output: input.tool_result?.output || '',
      timestamp: Date.now(),
    };
    return session;
  }

  handleStop(input) {
    const session = this.getOrCreate(input);
    if (input.stop_hook_active) {
      return session;
    }
    session.state = 'WAITING_RESPONSE';
    session.prompt = { type: 'RESPONSE' };
    session.waitingSince = Date.now();
    return session;
  }

  handleStopFailure(input) {
    const session = this.getOrCreate(input);
    session.state = 'IDLE';
    session.prompt = null;
    session.waitingSince = null;
    session.idleSince = Date.now();
    session.lastToolError = {
      toolName: 'API',
      error: input.error_details || input.error?.message || 'API error',
      timestamp: Date.now(),
    };
    return session;
  }

  handleStopWithChoices(input, choices) {
    const session = this.getOrCreate(input);
    session.state = 'WAITING_RESPONSE';
    session.prompt = {
      type: 'RESPONSE',
      choices: choices.slice(0, 10),
    };
    session.waitingSince = Date.now();
    return session;
  }

  /**
   * Proxy mode: stop hook detected choices → create interactive WAITING_CHOICE.
   * The stop hook HTTP request stays open until user presses a button on the deck.
   */
  handleStopChoiceProxy(input, choices) {
    const session = this.getOrCreate(input);
    session.state = 'WAITING_CHOICE';
    session.prompt = {
      type: 'CHOICE',
      question: '',
      multiSelect: false,
      selected: new Set(),
      choices: choices.slice(0, 10).map((c, i) => ({
        index: i + 1,
        label: c.label,
      })),
    };
    session.waitingSince = Date.now();
    return session;
  }

  /** Transition session to IDLE (after response timeout or explicit dismiss) */
  dismissSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session._permissionTimeout) {
      clearTimeout(session._permissionTimeout);
      session._permissionTimeout = null;
    }
    if (session.respondFn) {
      try { session.respondFn({ type: 'binary', value: 'deny' }); } catch { /* already sent */ }
      session.respondFn = null;
    }
    session.state = 'IDLE';
    session.prompt = null;
    session.waitingSince = null;
    session.idleSince = Date.now();
    return session;
  }

  /** Remove sessions that have been IDLE longer than ttlMs.
   *  Also transitions WAITING_RESPONSE → IDLE after awaitingTtlMs (default 60s). */
  pruneIdle(ttlMs, awaitingTtlMs = 60000) {
    const now = Date.now();
    const pruned = [];
    const demoted = [];
    for (const [id, session] of this.sessions) {
      if (session.state === 'IDLE' && session.idleSince && (now - session.idleSince) > ttlMs) {
        this.sessions.delete(id);
        pruned.push(id);
      } else if (session.state === 'WAITING_RESPONSE' && session.waitingSince && (now - session.waitingSince) > awaitingTtlMs) {
        session.state = 'IDLE';
        session.prompt = null;
        session.waitingSince = null;
        session.idleSince = Date.now();
        demoted.push(id);
      }
    }
    return { pruned, demoted };
  }

  resolveWaiting(sessionId, decision) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      warn(`[resolve] session not found: ${sessionId}`);
      return false;
    }

    // Multi-question: record answer and advance to next question
    if (session.prompt?.questionCount > 1 && decision.type === 'choice') {
      const p = session.prompt;
      const qi = p.questionIndex;
      const currentQ = p.questions[qi];
      p.answers[currentQ.question] = decision.value;
      log(`[resolve] ${session.name} → Q${qi + 1}/${p.questionCount} answer=${decision.value}`);

      const nextQi = qi + 1;
      if (nextQi < p.questionCount) {
        // Advance to next question — keep state as WAITING_CHOICE
        const nextQ = p.questions[nextQi];
        p.questionIndex = nextQi;
        p.question = nextQ.question;
        p.multiSelect = nextQ.multiSelect;
        p.selected = new Set();
        p.choices = nextQ.options.map((o, i) => ({
          index: i + 1,
          label: o.label || o.description || `Option ${i + 1}`,
        }));
        return 'next_question';
      }
      // Last question — build combined answer and resolve
      decision = { type: 'choice', value: Object.values(p.answers).join(','), answers: p.answers };
    }

    // Transition state BEFORE calling respondFn so broadcast reflects new state
    session.state = 'PROCESSING';
    session.prompt = null;
    session.waitingSince = null;
    session._permissionAgentId = null;
    if (session.respondFn) {
      try {
        log(`[resolve] ${session.name} → ${decision.type}=${decision.value}`);
        session.respondFn(decision);
      } catch (e) {
        error(`[resolve] respondFn threw: ${e.message}`);
      }
      session.respondFn = null;
    } else {
      warn(`[resolve] ${session.name} — no respondFn (already resolved or timed out)`);
    }
    return true;
  }

  /** Get all sessions currently waiting for user input, oldest first */
  getWaitingSessions() {
    return [...this.sessions.values()]
      .filter((s) => s.state.startsWith('WAITING_'))
      .sort((a, b) => (a.waitingSince || 0) - (b.waitingSince || 0));
  }

  /** Get the currently focused session. Priority: focused urgent > any urgent > focused waiting > oldest waiting */
  getFocusSession() {
    const isUrgent = (s) => s.state === 'WAITING_BINARY' || s.state === 'WAITING_CHOICE';

    // If the manually focused session is urgent, respect it
    if (this.focusSessionId) {
      const focused = this.sessions.get(this.focusSessionId);
      if (focused && isUrgent(focused)) {
        return focused;
      }
    }

    // Otherwise, pick the first urgent session
    const urgent = this.getWaitingSessions().find(isUrgent);
    if (urgent) {
      this.focusSessionId = urgent.id;
      return urgent;
    }

    // Fallback: focused session if it's waiting (e.g. WAITING_RESPONSE)
    const focused = this.focusSessionId ? this.sessions.get(this.focusSessionId) : null;
    if (focused && focused.state.startsWith('WAITING_')) {
      return focused;
    }

    // Fallback: oldest waiting session
    const waiting = this.getWaitingSessions();
    if (waiting.length > 0) {
      this.focusSessionId = waiting[0].id;
      return waiting[0];
    }
    this.focusSessionId = null;
    return null;
  }

  /** Set focus to a specific session */
  setFocus(sessionId) {
    this.focusSessionId = sessionId;
  }

  /** Cycle focus to next session (all sessions, not just waiting). Returns the newly focused session or null. */
  cycleFocus() {
    const all = [...this.sessions.values()].sort((a, b) => a.startedAt - b.startedAt);
    if (all.length === 0) return null;
    if (all.length === 1) {
      this.focusSessionId = all[0].id;
      this.focusAgentId = null;
      return all[0];
    }
    const currentIdx = all.findIndex((s) => s.id === this.focusSessionId);
    const nextIdx = (currentIdx + 1) % all.length;
    this.focusSessionId = all[nextIdx].id;
    this.focusAgentId = null;
    return all[nextIdx];
  }

  cycleAgent() {
    const session = this.focusSessionId ? this.sessions.get(this.focusSessionId) : null;
    if (!session) return null;
    const agents = [...session.agents.values()];
    if (agents.length === 0) return null;

    if (this.focusAgentId === null) {
      this.focusAgentId = agents[0].agentId;
      return agents[0];
    }

    const currentIdx = agents.findIndex((a) => a.agentId === this.focusAgentId);
    const nextIdx = currentIdx + 1;
    if (nextIdx >= agents.length) {
      this.focusAgentId = null;
      return null;
    }
    this.focusAgentId = agents[nextIdx].agentId;
    return agents[nextIdx];
  }

  setAgentFocus(agentId) {
    this.focusAgentId = agentId || null;
  }

  getAgentCount(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.agents.size : 0;
  }

  /**
   * Sync sessions with Claude Code's on-disk session files (~/.claude/sessions/*.json).
   * - Removes bridge sessions whose PID is no longer alive
   * - Returns { pruned: [...sessionIds], alive: [...sessionIds] }
   */
  syncFromDisk() {
    const result = { pruned: [], alive: [], renamed: [] };
    let sessionsDir;
    try { sessionsDir = path.join(os.homedir(), '.claude', 'sessions'); }
    catch { return result; }

    // Read all on-disk session files → Map<pid, entry> and Map<sessionId, entry>
    const diskByPid = new Map();
    const diskBySessionId = new Map();
    try {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
          const entry = { sessionId: data.sessionId, name: data.name || null, pid: data.pid };
          if (data.pid) diskByPid.set(data.pid, entry);
          if (data.sessionId) diskBySessionId.set(data.sessionId, entry);
        } catch { /* skip malformed */ }
      }
    } catch { /* sessions dir doesn't exist */ return result; }

    // Check each bridge session against disk state
    for (const [id, session] of this.sessions) {
      // Try to find/update disk PID mapping
      if (!session._diskPid) {
        const disk = _findDiskSession(id, session.cwd);
        if (disk) session._diskPid = disk.pid;
      }

      // Find disk entry by PID or sessionId (double lookup for resilience)
      const pid = session._diskPid;
      let disk = pid ? diskByPid.get(pid) : undefined;
      if (!disk) {
        disk = diskBySessionId.get(id);
        if (disk && disk.pid) session._diskPid = disk.pid;
      }
      if (!disk) continue;
      const effectivePid = disk.pid || pid;

      if (effectivePid && _isPidAlive(effectivePid)) {
        result.alive.push(id);
        // Sync name from disk if changed
        if (disk.name && disk.name !== session.name) {
          session.name = disk.name;
          result.renamed.push(id);
        }
      } else if (effectivePid) {
        // PID dead → clean up
        if (session._permissionTimeout) {
          clearTimeout(session._permissionTimeout);
          session._permissionTimeout = null;
        }
        if (session.respondFn) {
          // Reject any pending permission with deny (prevents hook timeout)
          session.respondFn({ type: 'binary', value: 'deny' });
          session.respondFn = null;
        }
        this.sessions.delete(id);
        result.pruned.push(id);
      }
    }

    return result;
  }

  toJSON() {
    return [...this.sessions.values()].map(({ respondFn, _permissionTimeout, _diskPid, agents, ...rest }) => {
      // Generic Set→Array conversion for all prompt fields (not just .selected)
      let prompt = rest.prompt;
      if (prompt) {
        const converted = {};
        for (const [k, v] of Object.entries(prompt)) {
          converted[k] = v instanceof Set ? [...v] : v;
        }
        prompt = converted;
      }
      return { ...rest, prompt, agents: [...agents.values()] };
    });
  }
}

/**
 * Find the disk session file matching a hook session_id.
 * Strategy: 1) match by sessionId, 2) fallback to cwd + alive PID.
 * Returns { pid, name } or null.
 */
function _findDiskSession(hookSessionId, cwd) {
  try {
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    const entries = [];
    for (const file of files) {
      try {
        entries.push(JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8')));
      } catch { /* skip */ }
    }
    // 1) Exact sessionId match
    const exact = entries.find(d => d.sessionId === hookSessionId);
    if (exact) return { pid: exact.pid, name: exact.name || null };
    // 2) cwd match among alive PIDs (pick most recently started)
    if (cwd) {
      const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
      const cwdNorm = norm(cwd);
      const candidates = entries
        .filter(d => norm(d.cwd || '') === cwdNorm && _isPidAlive(d.pid))
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      if (candidates.length === 1) return { pid: candidates[0].pid, name: candidates[0].name || null };
      // Multiple candidates: pick one not already claimed by another bridge session
      if (candidates.length > 1) {
        const claimedPids = new Set();
        // This is called from SessionManager context — we can't access `this` here,
        // so we just return the most recent. syncFromDisk will correct if needed.
        return { pid: candidates[0].pid, name: candidates[0].name || null };
      }
    }
  } catch { /* no sessions dir */ }
  return null;
}

function _isPidAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = check existence only
    return true;
  } catch (e) {
    // EPERM means process exists but we lack permission (common on Windows)
    if (e.code === 'EPERM') return true;
    return false;
  }
}
