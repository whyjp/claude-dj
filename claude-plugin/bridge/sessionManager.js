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
      const diskName = _readDiskSessionName(id);
      const baseName = input.cwd ? path.basename(input.cwd) : 'unknown';
      this.sessions.set(id, {
        id,
        name: diskName || `${baseName} (${id.slice(0, 6)})`,
        cwd: input.cwd || '',
        state: 'IDLE',
        waitingSince: null,
        prompt: null,
        respondFn: null,
        lastToolResult: null,
        agents: new Map(),
      });
    }
    return this.sessions.get(id);
  }

  get(id) {
    return this.sessions.get(id);
  }

  get sessionCount() {
    return this.sessions.size;
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
      // AskUserQuestion: options can be at tool_input.options or tool_input.questions[0].options
      const options = input.tool_input?.options
        || input.tool_input?.questions?.[0]?.options
        || [];
      const question = input.tool_input?.question
        || input.tool_input?.questions?.[0]?.question
        || '';
      const multiSelect = !!(input.tool_input?.multiSelect
        || input.tool_input?.questions?.[0]?.multiSelect);
      session.state = 'WAITING_CHOICE';
      session.prompt = {
        type: 'CHOICE',
        question,
        multiSelect,
        selected: new Set(), // tracks toggled indices for multiSelect
        choices: options.map((o, i) => ({
          index: i + 1,
          label: o.label || o.description || `Option ${i + 1}`,
        })),
      };
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

  /** Remove sessions that have been IDLE longer than ttlMs */
  pruneIdle(ttlMs) {
    const now = Date.now();
    const pruned = [];
    for (const [id, session] of this.sessions) {
      if (session.state === 'IDLE' && session.idleSince && (now - session.idleSince) > ttlMs) {
        this.sessions.delete(id);
        pruned.push(id);
      }
    }
    return pruned;
  }

  resolveWaiting(sessionId, decision) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      warn(`[resolve] session not found: ${sessionId}`);
      return false;
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

    // Read all on-disk session files → Map<sessionId, {pid, name}>
    const diskSessions = new Map();
    try {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
          if (data.sessionId && data.pid) {
            diskSessions.set(data.sessionId, { pid: data.pid, name: data.name || null });
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* sessions dir doesn't exist */ return result; }

    // Check each bridge session against disk state
    for (const [id, session] of this.sessions) {
      const disk = diskSessions.get(id);
      if (disk === undefined) {
        // Session not on disk at all — might be stale, let idle prune handle it
        continue;
      }
      if (_isPidAlive(disk.pid)) {
        result.alive.push(id);
        // Sync name from disk if changed
        if (disk.name && disk.name !== session.name) {
          session.name = disk.name;
          result.renamed.push(id);
        }
      } else {
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
    return [...this.sessions.values()].map(({ respondFn, _permissionTimeout, agents, ...rest }) => {
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

function _readDiskSessionName(sessionId) {
  try {
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
        if (data.sessionId === sessionId && data.name) return data.name;
      } catch { /* skip */ }
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
