export class ButtonManager {
  static layoutFor(session) {
    const base = {
      session: session.id ? {
        id: session.id,
        name: session.name,
        state: session.state,
      } : undefined,
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
      default:
        return { ...base, preset: 'idle' };
    }
  }

  static resolvePress(slot, state, prompt) {
    if (state === 'WAITING_BINARY') {
      if (slot === 0) return { type: 'binary', value: 'allow' };
      if (slot === 1) return { type: 'binary', value: 'deny' };
      if (slot === 5 && prompt.hasAlwaysAllow) return { type: 'binary', value: 'alwaysAllow' };
      return null;
    }

    if (state === 'WAITING_CHOICE') {
      const choices = prompt.choices || [];
      if (slot >= 0 && slot < choices.length) {
        return { type: 'choice', value: String(choices[slot].index) };
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

  static buildTimeoutResponse() {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'Claude DJ: timeout (30s)',
        },
      },
    };
  }
}
