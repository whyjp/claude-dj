import path from 'node:path';

export class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.focusSessionId = null;
  }

  getOrCreate(input) {
    const id = input.session_id;
    if (!this.sessions.has(id)) {
      this.sessions.set(id, {
        id,
        name: `${input.cwd ? path.basename(input.cwd) : 'unknown'} (${id})`,
        cwd: input.cwd || '',
        state: 'IDLE',
        waitingSince: null,
        prompt: null,
        respondFn: null,
        lastToolResult: null,
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

  handleNotify(input) {
    const session = this.getOrCreate(input);
    session.state = 'PROCESSING';
    session.prompt = null;
    return session;
  }

  handlePermission(input) {
    const session = this.getOrCreate(input);
    const isChoice = input.tool_name === 'AskUserQuestion';

    if (isChoice) {
      const options = input.tool_input?.options || [];
      session.state = 'WAITING_CHOICE';
      session.prompt = {
        type: 'CHOICE',
        question: input.tool_input?.question || '',
        choices: options.map((o) => ({
          index: parseInt(o.label, 10),
          label: o.description || o.label,
        })),
      };
    } else {
      session.state = 'WAITING_BINARY';
      session.prompt = {
        type: 'BINARY',
        toolName: input.tool_name,
        command: input.tool_input?.command || input.tool_input?.file_path || '',
        hasAlwaysAllow: Array.isArray(input.permission_suggestions) && input.permission_suggestions.length > 0,
      };
    }

    session.waitingSince = Date.now();
    return session;
  }

  handlePostToolUse(input) {
    const session = this.getOrCreate(input);
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
    session.state = 'IDLE';
    session.prompt = null;
    session.waitingSince = null;
    session.respondFn = null;
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
    if (!session) return false;
    if (session.respondFn) {
      session.respondFn(decision);
      session.respondFn = null;
    }
    session.state = 'PROCESSING';
    session.prompt = null;
    session.waitingSince = null;
    return true;
  }

  /** Get all sessions currently waiting for user input, oldest first */
  getWaitingSessions() {
    return [...this.sessions.values()]
      .filter((s) => s.state === 'WAITING_BINARY' || s.state === 'WAITING_CHOICE')
      .sort((a, b) => (a.waitingSince || 0) - (b.waitingSince || 0));
  }

  /** Get the currently focused session (must be WAITING), or auto-pick oldest waiting */
  getFocusSession() {
    const focused = this.focusSessionId ? this.sessions.get(this.focusSessionId) : null;
    if (focused && (focused.state === 'WAITING_BINARY' || focused.state === 'WAITING_CHOICE')) {
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

  /** Cycle focus to next waiting session. Returns the newly focused session or null. */
  cycleFocus() {
    const waiting = this.getWaitingSessions();
    if (waiting.length === 0) return null;
    if (waiting.length === 1) {
      this.focusSessionId = waiting[0].id;
      return waiting[0];
    }
    const currentIdx = waiting.findIndex((s) => s.id === this.focusSessionId);
    const nextIdx = (currentIdx + 1) % waiting.length;
    this.focusSessionId = waiting[nextIdx].id;
    return waiting[nextIdx];
  }

  toJSON() {
    return [...this.sessions.values()].map(({ respondFn, ...rest }) => rest);
  }
}
