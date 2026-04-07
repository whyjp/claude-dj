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
 *   d200hSlot = col × GRID_COLS + row   (GRID_COLS=5, UlanziStudio 고정값)
 *
 * [중요] UlanziStudio는 5×5 그리드 기준으로 slot을 계산한다.
 * D200H가 5×4 장치여도 한 열 이동 시 +5이다 (행 수 4가 아님).
 * key:"2_1" → col=2, row=1 → slot=2*5+1=11 (PORTING.md 실기기 검증)
 *
 * D200H 물리 배치 (열-우선, GRID_COLS=5 기준):
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

/** Bridge 내부 행-우선 그리드 열 수 */
export const DEVICE_COLS = 5;
/** Bridge 내부 행-우선 그리드 행 수 */
export const DEVICE_ROWS = 4;
/** Bridge 내부 총 슬롯 수 */
export const TOTAL_SLOTS = DEVICE_COLS * DEVICE_ROWS; // 20

/**
 * UlanziStudio slot 계산 기준 열 수.
 * D200H가 5×4 장치여도 UlanziStudio는 5×5 그리드 기준으로
 * slot = col × GRID_COLS + row 를 계산한다.
 * PORTING.md 실기기 검증: key:"2_1" → slot=11 = 2*5+1
 */
const GRID_COLS = 5;

// Bridge 행-우선 시스템 슬롯 (row2 col0/col1/col2)
const DJ_SLOT_SESSION_COUNT  = 10;
const DJ_SLOT_SESSION_SWITCH = 11;
const DJ_SLOT_AGENT_SWITCH   = 12;

/**
 * Bridge(행-우선) 슬롯 → D200H UlanziStudio 슬롯 변환
 *
 * Bridge: djSlot = row × DEVICE_COLS + col
 * D200H:  d200hSlot = col × GRID_COLS + row
 *
 * @param {number} djSlot - Bridge 행-우선 슬롯 (0~19)
 * @returns {number} D200H UlanziStudio 슬롯
 */
export function toD200hSlot(djSlot) {
  const row = Math.floor(djSlot / DEVICE_COLS);
  const col = djSlot % DEVICE_COLS;
  return col * GRID_COLS + row;
}

/**
 * D200H UlanziStudio 슬롯 → Bridge(행-우선) 슬롯 변환
 *
 * D200H:  d200hSlot = col × GRID_COLS + row
 * Bridge: djSlot = row × DEVICE_COLS + col
 *
 * @param {number} d200hSlot - D200H UlanziStudio 슬롯
 * @returns {number} Bridge 행-우선 슬롯 (0~19)
 */
export function toInternalSlot(d200hSlot) {
  const col = Math.floor(d200hSlot / GRID_COLS);
  const row = d200hSlot % GRID_COLS;
  return row * DEVICE_COLS + col;
}

// D200H 시스템 슬롯 집합 (열-우선) — 함수 정의 후 초기화
const D200H_SYSTEM_SLOTS = new Set([
  toD200hSlot(DJ_SLOT_SESSION_COUNT),
  toD200hSlot(DJ_SLOT_SESSION_SWITCH),
  toD200hSlot(DJ_SLOT_AGENT_SWITCH),
]);

// Bridge 행-우선 동적 슬롯 (0~9): 실제 액션 버튼 영역
const DJ_DYNAMIC_SLOTS = Array.from({length: 10}, (_, i) => i);

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
      // 동적 슬롯(0~9)만 idle로 설정 — 시스템 슬롯은 systemCmds가 담당
      const cmds = dynamicSlotsD200h('idle');
      return [...cmds, ...systemCmds];
    }

    case 'processing': {
      // processing-1 을 초기 프레임으로 — app.js 타이머가 1/2/3 순환
      const cmds = dynamicSlotsD200h('processing-1');
      return [...cmds, ...systemCmds];
    }

    case 'active': {
      const djActiveSlot = Number(layout.slot ?? -1);
      const cmds = dynamicSlotsD200h('idle');
      if (Number.isInteger(djActiveSlot) && djActiveSlot >= 0 && djActiveSlot < TOTAL_SLOTS) {
        _setCmd(cmds, toD200hSlot(djActiveSlot), 'active');
      }
      return [...cmds, ...systemCmds];
    }

    case 'binary': {
      const cmds = dynamicSlotsD200h('idle');
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
      const cmds = dynamicSlotsD200h('idle');
      choices.slice(0, TOTAL_SLOTS).forEach((c, i) => {
        const iconKey = _choiceIcon(i, choices.length);
        const label = (c.label ?? '').slice(0, 12);
        _setCmd(cmds, toD200hSlot(i), iconKey, label);
      });
      return [...cmds, ...systemCmds];
    }

    case 'multiSelect': {
      const choices = layout.choices ?? [];
      const cmds = dynamicSlotsD200h('idle');
      choices.slice(0, 9).forEach((c, i) => {
        const selected = c.selected ?? false;
        const n = i + 1;
        // iconKey는 동적 렌더링 트리거용 — app.js에서 makeMultiIcon 호출
        _setCmd(cmds, toD200hSlot(i), 'multi-dynamic', undefined);
        // 동적 렌더링에 필요한 데이터를 cmd에 직접 저장
        const cmd = cmds.find(c2 => c2.slot === toD200hSlot(i));
        if (cmd) {
          cmd.multiN       = n;
          cmd.multiLabel   = c.label ?? '';
          cmd.multiSelected = selected;
        }
      });
      // Bridge 슬롯 9 = Submit
      _setCmd(cmds, toD200hSlot(9), 'submit', 'Done');
      return [...cmds, ...systemCmds];
    }

    case 'awaiting_input': {
      const cmds = dynamicSlotsD200h('idle');
      _setCmd(cmds, toD200hSlot(4), 'awaiting', 'Wait');
      return [...cmds, ...systemCmds];
    }

    case 'choice_hint': {
      const choices = layout.choices ?? [];
      const cmds = dynamicSlotsD200h('idle');
      choices.slice(0, TOTAL_SLOTS).forEach((c, i) => {
        const iconKey = _choiceIcon(i, choices.length);
        _setCmd(cmds, toD200hSlot(i), iconKey, (c.label ?? '').slice(0, 12));
      });
      return [...cmds, ...systemCmds];
    }

    case 'custom': {
      const slotsMap = layout.slots ?? {};
      const cmds = dynamicSlotsD200h('idle');
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

  // 슬롯 10: 세션 수 — 숫자가 아이콘에 직접 렌더링된 PNG 사용
  const countKey = (sessCount >= 1 && sessCount <= 30)
    ? `session-count-${sessCount}`
    : 'session-count';
  cmds.push({
    slot: toD200hSlot(DJ_SLOT_SESSION_COUNT),
    iconKey: countKey,
  });

  // 슬롯 11: 세션 전환 — 세션명을 iconKey로 인코딩 (동적 생성)
  // session-switch 기본 아이콘 사용, 세션명은 text로 전달 (런타임 동적 렌더링)
  cmds.push({
    slot: toD200hSlot(DJ_SLOT_SESSION_SWITCH),
    iconKey: 'session-switch',
    sessName: sess?.name ?? null, // app.js에서 동적 PNG 생성에 사용
  });

  // 슬롯 12: 에이전트 전환 — 동적 레이블
  const agentLabel = agent
    ? (agent.type ?? 'SUB').slice(0, 4)
    : (agentCount > 0 ? `+${agentCount}` : 'ROOT');
  cmds.push({
    slot: toD200hSlot(DJ_SLOT_AGENT_SWITCH),
    iconKey: 'agent-switch',
    agentLabel,
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
 * 동적 슬롯(Bridge 0~9)만 D200H 슬롯으로 변환해 iconKey로 채운다.
 * 시스템 슬롯(10/11/12)은 포함하지 않는다 — systemCmds가 담당.
 */
function dynamicSlotsD200h(iconKey) {
  return DJ_DYNAMIC_SLOTS.map(djSlot => ({
    slot: toD200hSlot(djSlot),
    iconKey,
  }));
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
