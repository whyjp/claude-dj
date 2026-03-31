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

    // When viewing a specific agent, use that agent's state for the preset.
    // When root is focused but the permission came from an agent, show processing.
    const effectiveState = focusedAgent
      ? focusedAgent.state
      : (session._permissionAgentId ? 'PROCESSING' : session.state);

    switch (effectiveState) {
      case 'IDLE':
        return { ...base, preset: 'idle' };
      case 'PROCESSING':
        return { ...base, preset: 'processing' };
      case 'WAITING_BINARY':
        return { ...base, preset: 'binary', prompt: session.prompt };
      case 'WAITING_CHOICE': {
        const { choices, multiSelect, selected } = session.prompt;
        if (multiSelect) {
          return {
            ...base,
            preset: 'multiSelect',
            choices: choices.map((c) => ({ ...c, selected: selected?.has(c.index) || false })),
          };
        }
        return { ...base, preset: 'choice', choices };
      }
      case 'WAITING_RESPONSE':
        return { ...base, preset: 'awaiting_input' };
      default:
        return { ...base, preset: 'idle' };
    }
  }

  static resolvePress(slot, state, prompt) {
    if (!prompt) return null;
    // Dynamic options: [allow, ...addRule×N, deny]
    if (state === 'WAITING_BINARY') {
      const options = prompt.options || [];
      if (slot < 0 || slot >= options.length) return null;
      const opt = options[slot];
      return { type: 'binary', value: opt.type === 'deny' ? 'deny' : 'allow', option: opt };
    }

    if (state === 'WAITING_CHOICE') {
      const choices = prompt.choices || [];

      if (prompt.multiSelect) {
        // Slot 9 = Submit — resolve with all selected indices
        if (slot === 9) {
          const selected = [...(prompt.selected || [])].sort((a, b) => a - b);
          return { type: 'choice', value: selected.join(',') || '1' };
        }
        // Slots 0-8 = toggle selection
        if (slot >= 0 && slot < choices.length && slot < 9) {
          const idx = choices[slot].index;
          if (prompt.selected?.has(idx)) {
            prompt.selected.delete(idx);
          } else {
            prompt.selected?.add(idx);
          }
          return { type: 'toggle', index: idx };
        }
        return null;
      }

      if (slot >= 0 && slot < choices.length) {
        return { type: 'choice', value: String(choices[slot].index) };
      }
      return null;
    }

    // WAITING_RESPONSE is display-only — no button interaction

    return null;
  }

  static buildHookResponse(decision, isChoice, question = '') {
    if (isChoice) {
      const answers = {};
      if (question) answers[question] = decision.value;
      return {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'allow',
            updatedInput: { answer: decision.value, answers },
          },
        },
      };
    }

    // addRule: return the permission_suggestion as decision (behavior:"allow" + addRules)
    if (decision.option?.type === 'addRule' && decision.option.suggestion) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: decision.option.suggestion,
        },
      };
    }

    // allow or deny
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: decision.value,
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
          message: 'Claude DJ: timeout (60s)',
        },
      },
    };
  }
}
