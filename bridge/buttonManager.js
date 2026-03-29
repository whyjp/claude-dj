export class ButtonManager {
  static layoutFor(session, focusAgentId = null, agentCount = 0) {
    const focusedAgent = focusAgentId ? session.agents?.get(focusAgentId) : null;
    const agents = session.agents ? [...session.agents.values()].map(a => ({
      agentId: a.agentId, type: a.type, state: a.state,
    })) : [];
    const base = {
      session: session.id ? {
        id: session.id,
        name: session.name,
        state: session.state,
      } : undefined,
      agent: focusedAgent ? {
        agentId: focusedAgent.agentId,
        type: focusedAgent.type,
        state: focusedAgent.state,
      } : null,
      agents,
      agentCount,
    };

    switch (session.state) {
      case 'IDLE':
        return { ...base, preset: 'idle' };
      case 'PROCESSING':
        return { ...base, preset: 'processing' };
      case 'WAITING_BINARY':
        return { ...base, preset: 'binary', prompt: session.prompt };
      case 'WAITING_CHOICE':
        return { ...base, preset: 'choice', choices: session.prompt.choices };
      case 'WAITING_RESPONSE':
        return { ...base, preset: 'response', choices: session.prompt.choices || null };
      default:
        return { ...base, preset: 'idle' };
    }
  }

  static resolvePress(slot, state, prompt) {
    // Match Claude Code's permission dialog order: 1=Allow, 2=Always, 3=Deny
    if (state === 'WAITING_BINARY') {
      if (slot === 0) return { type: 'binary', value: 'allow' };
      if (slot === 1 && prompt.hasAlwaysAllow) return { type: 'binary', value: 'alwaysAllow' };
      if (slot === 1 && !prompt.hasAlwaysAllow) return { type: 'binary', value: 'deny' };
      if (slot === 2) return { type: 'binary', value: 'deny' };
      return null;
    }

    if (state === 'WAITING_CHOICE') {
      const choices = prompt.choices || [];
      if (slot >= 0 && slot < choices.length) {
        return { type: 'choice', value: String(choices[slot].index) };
      }
      return null;
    }

    if (state === 'WAITING_RESPONSE') {
      const choices = prompt?.choices;
      if (choices && slot >= 0 && slot < choices.length) {
        const c = choices[slot];
        return { type: 'response', value: `I choose option ${c.index}: ${c.label}` };
      }
      if (!choices && slot >= 0 && slot <= 9) {
        return { type: 'response', value: String(slot + 1) };
      }
      return null;
    }

    return null;
  }

  static buildHookResponse(decision, isChoice) {
    if (isChoice) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'allow',
            updatedInput: { answer: decision.value },
          },
        },
      };
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: decision.value,
          message: `Claude DJ: ${decision.value} via button`,
        },
      },
    };
  }

  static buildStopResponse(decision) {
    return {
      hookSpecificOutput: {
        hookEventName: 'Stop',
        systemMessage: `[Claude DJ] User selected: ${decision.value}`,
      },
    };
  }

  static buildTimeoutResponse() {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'Claude DJ: timeout (60s)',
        },
      },
    };
  }
}
