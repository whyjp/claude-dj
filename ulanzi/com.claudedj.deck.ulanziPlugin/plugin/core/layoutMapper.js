/**
 * layoutMapper.js — 순수함수
 *
 * Bridge에서 받은 LAYOUT 메시지를 SlotCommand 배열로 변환한다.
 * SlotCommand는 ulanziOutputAdapter가 소비해 실제 D200H LCD에 반영한다.
 *
 * [슬롯 번호 체계]
 * Bridge(claude-dj 내부)는 행-우선(row-major) 슬롯을 사용한다:
 *   djSlot = row × DEVICE_COLS + col
 *
 * D200H 물리 장치는 열-우선(column-major) 슬롯을 사용한다:
 *   d200hSlot = col × DEVICE_ROWS + row
 *
 * 이 모듈은 Bridge djSlot → D200H d200hSlot 변환을 담당한다.
 *
 * D200H 물리 배치 (열-우선):
 *   col0  col1  col2  col3  col4
 *    ┌────┬────┬────┬────┬────┐
 * r0 │  0 │  5 │ 10 │ 15 │ 20 │
 *    ├────┼────┼────┼────┼────┤
 * r1 │  1 │  6 │ 11 │ 16 │ 21 │
 *    ├────┼────┼────┼────┼────┤
 * r2 │  2 │  7 │ 12 │ 17 │ 22 │
 *    ├────┼────┼────┼────┼────┤
 * r3 │  3 │  8 │ 13 │ 18 │ 23 │
 *    └────┴────┴────┴────┴────┘
 *
 * Bridge(행-우선) 배치:
 *   col0  col1  col2  col3  col4
 *    ┌────┬────┬────┬────┬────┐
 * r0 │  0 │  1 │  2 │  3 │  4 │
 *    ├────┼────┼────┼────┼────┤
 * r1 │  5 │  6 │  7 │  8 │  9 │
 *    ├────┼────┼────┼────┼────┤
 * r2 │ 10 │ 11 │ 12 │ 13 │ 14 │  (10=세션수, 11=세션전환, 12=에이전트전환)
 *    ├────┼────┼────┼────┼────┤
 * r3 │ 15 │ 16 │ 17 │ 18 │ 19 │
 *    └────┴────┴────┴────┴────┘
 *
 * SlotCommand {
 *   slot:    number  — D200H 열-우선 슬롯
 *   iconKey: string  — ulanziOutputAdapter의 ICONS 키
 *   text?:   string  — LCD 텍스트 오버레이 (선택)
 * }
 */

export const DEVICE_COLS = 5;
export const DEVICE_ROWS = 4;
export const TOTAL_SLOTS = DEVICE_COLS * DEVICE_ROWS; // 20

// Bridge 행-우선 시스템 슬롯 (D200H 물리 위치로 변환 후 특수 처리)
const DJ_SLOT_SESSION_COUNT  = 10;
const DJ_SLOT_SESSION_SWITCH = 11;
const DJ_SLOT_AGENT_SWITCH   = 12;

/**
 * Bridge(행-우선) 슬롯 → D200H 열-우선 슬롯 변환
 * @param {number} djSlot
 * @returns {number}
 */
export function toD200hSlot(djSlot) {
  const row = Math.floor(djSlot / DEVICE_COLS);
  const col = djSlot % DEVICE_COLS;
  return col * DEVICE_ROWS + row;
}

/**
 * D200H 열-우선 슬롯 → Bridge 행-우선 슬롯 변환
 * @param {number} d200hSlot
 * @returns {number}
 */
export function toInternalSlot(d200hSlot) {
  const col = Math.floor(d200hSlot / DEVICE_ROWS);
  const row = d200hSlot % DEVICE_ROWS;
  return row * DEVICE_COLS + col;
}

/**
 * LAYOUT 메시지를 SlotCommand 배열로 변환한다.
 * 반환되는 slot 값은 D200H 열-우선 슬롯이다.
 *
 * @param {object} layout - Bridge에서 수신한 LAYOUT 메시지
 * @returns {Array<{ slot: number, iconKey: string, text?: string }>}
 */
export function mapLayout(layout) {
  if (!layout || typeof layout !== 'object') return [];

  // 시스템 슬롯 공통 커맨드 (세션수/세션전환/에이전트전환)
  const systemCmds = _makeSystemCmds(layout);

  switch (layout.preset) {
    case 'idle': {
      const cmds = allSlotsD200h('idle');
      // 슬롯 9 (Bridge 행-우선) = idle 인디케이터
      _setCmd(cmds, toD200hSlot(9), 'idle', 'Idle');
      return [...cmds, ...systemCmds];
    }

    case 'processing': {
      const cmds = allSlotsD200h('processing');
      return [...cmds, ...systemCmds];
    }

    case 'active': {
      const djActiveSlot = Number(layout.slot ?? -1);
      const cmds = allSlotsD200h('idle');
      if (Number.isInteger(djActiveSlot) && djActiveSlot >= 0 && djActiveSlot < TOTAL_SLOTS) {
        _setCmd(cmds, toD200hSlot(djActiveSlot), 'active');
      }
      return [...cmds, ...systemCmds];
    }

    case 'binary': {
      const cmds = allSlotsD200h('idle');
      const hasAlways = layout.prompt?.hasAlwaysAllow;
      // Bridge 슬롯 0 = Allow
      _setCmd(cmds, toD200hSlot(0), 'approve', 'Allow');
      if (hasAlways) {
        // Bridge 슬롯 1 = Always Allow, 슬롯 2 = Deny
        _setCmd(cmds, toD200hSlot(1), 'always', 'Always');
        _setCmd(cmds, toD200hSlot(2), 'deny', 'Deny');
      } else {
        // Bridge 슬롯 1 = Deny
        _setCmd(cmds, toD200hSlot(1), 'deny', 'Deny');
      }
      return [...cmds, ...systemCmds];
    }

    case 'choice': {
      const choices = layout.choices ?? [];
      const cmds = allSlotsD200h('idle');
      choices.slice(0, TOTAL_SLOTS).forEach((c, i) => {
        const iconKey = _choiceIcon(i, choices.length);
        const label = (c.label ?? '').slice(0, 12);
        _setCmd(cmds, toD200hSlot(i), iconKey, label);
      });
      return [...cmds, ...systemCmds];
    }

    case 'multiSelect': {
      const choices = layout.choices ?? [];
      const cmds = allSlotsD200h('idle');
      choices.slice(0, 9).forEach((c, i) => {
        const selected = c.selected ?? false;
        const label = (c.label ?? '').slice(0, 10);
        _setCmd(cmds, toD200hSlot(i), selected ? 'multi-on' : 'multi-off', label);
      });
      // Bridge 슬롯 9 = Submit
      _setCmd(cmds, toD200hSlot(9), 'submit', 'Done');
      return [...cmds, ...systemCmds];
    }

    case 'awaiting_input': {
      const cmds = allSlotsD200h('idle');
      _setCmd(cmds, toD200hSlot(4), 'awaiting', 'Wait');
      return [...cmds, ...systemCmds];
    }

    case 'choice_hint': {
      // 표시 전용 (클릭 불가)
      const choices = layout.choices ?? [];
      const cmds = allSlotsD200h('idle');
      choices.slice(0, TOTAL_SLOTS).forEach((c, i) => {
        const iconKey = _choiceIcon(i, choices.length);
        _setCmd(cmds, toD200hSlot(i), iconKey, (c.label ?? '').slice(0, 12));
      });
      return [...cmds, ...systemCmds];
    }

    case 'custom': {
      const slotsMap = layout.slots ?? {};
      const cmds = allSlotsD200h('idle');
      for (const [djSlotStr, iconKey] of Object.entries(slotsMap)) {
        const djSlot = Number(djSlotStr);
        if (Number.isInteger(djSlot) && djSlot >= 0 && djSlot < TOTAL_SLOTS) {
          _setCmd(cmds, toD200hSlot(djSlot), String(iconKey));
        }
      }
      return [...cmds, ...systemCmds];
    }

    default:
      return [];
  }
}

// ── 내부 헬퍼 ──────────────────────────────────────────────────

/**
 * 세션수/세션전환/에이전트전환 시스템 슬롯 커맨드 생성
 */
function _makeSystemCmds(layout) {
  const cmds = [];
  const sessCount = layout.sessionCount ?? 0;
  const sess = layout.session;
  const agent = layout.agent;
  const agentCount = layout.agentCount ?? 0;

  // 슬롯 10: 세션 수 표시
  cmds.push({
    slot: toD200hSlot(DJ_SLOT_SESSION_COUNT),
    iconKey: 'session-count',
    text: String(sessCount),
  });

  // 슬롯 11: 세션 전환 (세션 이름 표시)
  cmds.push({
    slot: toD200hSlot(DJ_SLOT_SESSION_SWITCH),
    iconKey: 'session-switch',
    text: sess?.name ? sess.name.slice(0, 8) : '—',
  });

  // 슬롯 12: 에이전트 전환 (에이전트 타입 표시)
  cmds.push({
    slot: toD200hSlot(DJ_SLOT_AGENT_SWITCH),
    iconKey: 'agent-switch',
    text: agent ? (agent.type ?? 'SUB').slice(0, 6) : (agentCount > 0 ? `+${agentCount}` : 'ROOT'),
  });

  return cmds;
}

/**
 * 선택지 인덱스에 맞는 iconKey 반환.
 * 10개 이하이면 숫자(choice-1~10), 알파벳 모드(choice-a~j) 전환은
 * 향후 layout.labelMode 필드로 확장 가능.
 */
function _choiceIcon(index, total) {
  // 현재는 항상 숫자 아이콘 (1-based)
  const n = index + 1;
  if (n >= 1 && n <= 10) return `choice-${n}`;
  return 'choice-10'; // 초과 시 마지막 색상 재사용
}

/**
 * 모든 D200H 슬롯(0~TOTAL_SLOTS-1)을 동일한 iconKey로 채운다.
 */
function allSlotsD200h(iconKey) {
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => ({ slot: i, iconKey }));
}

/**
 * cmds 배열에서 특정 D200H 슬롯의 커맨드를 업데이트한다.
 */
function _setCmd(cmds, d200hSlot, iconKey, text) {
  const cmd = cmds.find(c => c.slot === d200hSlot);
  if (cmd) {
    cmd.iconKey = iconKey;
    if (text !== undefined) cmd.text = text;
  }
}
