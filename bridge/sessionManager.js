import path from 'node:path';

export class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  getOrCreate(input) {
    const id = input.session_id;
    if (!this.sessions.has(id)) {
      this.sessions.set(id, {
        id,
        name: input.cwd ? path.basename(input.cwd) : 'unknown',
        cwd: input.cwd || '',
        state: 'IDLE',
        waitingSince: null,
        prompt: null,
        respondFn: null,
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

  handleStop(input) {
    const session = this.getOrCreate(input);
    session.state = 'IDLE';
    session.prompt = null;
    session.waitingSince = null;
    session.respondFn = null;
    return session;
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

  getFocusSession() {
    for (const [, session] of this.sessions) {
      if (session.state === 'WAITING_BINARY' || session.state === 'WAITING_CHOICE') {
        return session;
      }
    }
    return null;
  }

  toJSON() {
    return [...this.sessions.values()].map(({ respondFn, ...rest }) => rest);
  }
}
