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
          message: 'Claude DJ: timeout (60s)',
        },
      },
    };
  }
}
