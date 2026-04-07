/**
 * layoutMapper.js — 순수함수
 *
 * Bridge에서 받은 LAYOUT 메시지를 RenderCommand 배열로 변환한다.
 * RenderCommand는 ulanziOutputAdapter가 소비해 실제 D200H LCD에 반영한다.
 *
 * [슬롯 번호 체계]
 * Bridge(claude-dj 내부)는 행-우선(row-major) 슬롯을 사용한다:
 *   slot = row × DEVICE_COLS + col
 *
 * D200H 물리 장치는 열-우선(column-major) 슬롯을 사용한다:
 *   slot = col × DEVICE_ROWS + row
 *
 * 이 모듈은 Bridge에서 받은 행-우선 슬롯을 D200H 열-우선 슬롯으로 변환한다.
 * app.js에서 keyStates Map(context → {slot: D200H열우선슬롯})을 통해
 * 올바른 context를 찾아 RenderCommand를 완성한다.
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
 * r2 │ 10 │ 11 │ 12 │ 13 │ 14 │
 *    ├────┼────┼────┼────┼────┤
 * r3 │ 15 │ 16 │ 17 │ 18 │ 19 │
 *    └────┴────┴────┴────┴────┘
 *
 * SlotCommand {
 *   slot:       number  — D200H 열-우선 슬롯 (app.js가 keyStates 조회에 사용)
 *   stateIndex: number  — 0=IDLE, 1=ACTIVE, 2=APPROVE, 3=DENY, 4=CHOICE
 *   text?:      string
 * }
 */

/** D200H 물리 열 수 (= parseSlot의 GRID_COLS와 동일) */
export const DEVICE_COLS = 5;
/** D200H 물리 행 수 */
export const DEVICE_ROWS = 4;
/** 총 슬롯 수 (D200H: 5×4=20) */
export const TOTAL_SLOTS = DEVICE_COLS * DEVICE_ROWS; // 20

/**
 * Bridge(claude-dj 행-우선) 슬롯 → D200H 열-우선 슬롯 변환.
 *
 * Bridge slot: row × DEVICE_COLS + col
 * D200H slot:  col × DEVICE_ROWS + row
 *
 * @param {number} djSlot - Bridge 행-우선 슬롯 (0~19)
 * @returns {number} D200H 열-우선 슬롯 (0~19)
 */
export function toD200hSlot(djSlot) {
  const row = Math.floor(djSlot / DEVICE_COLS);
  const col = djSlot % DEVICE_COLS;
  return col * DEVICE_ROWS + row;
}

/**
 * D200H 열-우선 슬롯 → Bridge(claude-dj 행-우선) 슬롯 변환.
 *
 * @param {number} d200hSlot - D200H 열-우선 슬롯 (0~19)
 * @returns {number} Bridge 행-우선 슬롯 (0~19)
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
 * @returns {Array<{ slot: number, stateIndex: number, text?: string }>}
 */
export function mapLayout(layout) {
  if (!layout || typeof layout !== 'object') return [];

  switch (layout.preset) {
    case 'idle':
      return allSlotsD200h(0);

    case 'processing':
      // 전체 슬롯 IDLE(dim) — 처리 중 표시는 LCD 자체 애니메이션 불가, 단순 dim
      return allSlotsD200h(0);

    case 'active': {
      // Bridge 행-우선 슬롯 → D200H 열-우선 슬롯으로 변환
      const djActiveSlot = Number(layout.slot ?? -1);
      if (!Number.isInteger(djActiveSlot) || djActiveSlot < 0 || djActiveSlot >= TOTAL_SLOTS) {
        return allSlotsD200h(1);
      }
      const d200hActive = toD200hSlot(djActiveSlot);
      return Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
        slot: i,
        stateIndex: i === d200hActive ? 1 : 0,
      }));
    }

    case 'binary': {
      // Bridge 슬롯 0=Allow, 1=AlwaysAllow/Deny, 2=Deny → D200H 열-우선으로 변환
      // Bridge 행-우선 슬롯 0,1,2 → D200H 열-우선 슬롯 0,4,8 (col0 row0,1,2)
      const cmds = allSlotsD200h(0);
      const hasAlways = layout.prompt?.hasAlwaysAllow;

      // Bridge slot 0 (Allow) → D200H slot toD200hSlot(0)=0
      _setCmd(cmds, toD200hSlot(0), 2, 'Allow');
      if (hasAlways) {
        // Bridge slot 1 (AlwaysAllow) → D200H slot toD200hSlot(1)=4
        _setCmd(cmds, toD200hSlot(1), 2, 'Always');
        // Bridge slot 2 (Deny) → D200H slot toD200hSlot(2)=8
        _setCmd(cmds, toD200hSlot(2), 3, 'Deny');
      } else {
        // Bridge slot 1 (Deny) → D200H slot toD200hSlot(1)=4
        _setCmd(cmds, toD200hSlot(1), 3, 'Deny');
      }
      return cmds;
    }

    case 'choice': {
      // choices 배열 순서대로 Bridge 행-우선 슬롯 i → D200H 열-우선 슬롯
      const choices = layout.choices ?? [];
      const cmds = allSlotsD200h(0);
      choices.slice(0, TOTAL_SLOTS).forEach((c, i) => {
        _setCmd(cmds, toD200hSlot(i), 4, (c.label ?? '').slice(0, 12));
      });
      return cmds;
    }

    case 'multiSelect': {
      // 슬롯 0-8: 토글, 슬롯 9: 제출 (Bridge 행-우선 기준)
      const choices = layout.choices ?? [];
      const cmds = allSlotsD200h(0);
      choices.slice(0, 9).forEach((c, i) => {
        const selected = c.selected ?? false;
        const label = ((selected ? '☑ ' : '☐ ') + (c.label ?? '')).slice(0, 12);
        _setCmd(cmds, toD200hSlot(i), selected ? 1 : 0, label);
      });
      // Bridge slot 9 (Submit) → D200H slot toD200hSlot(9)
      _setCmd(cmds, toD200hSlot(9), 1, 'Done');
      return cmds;
    }

    case 'awaiting_input':
      // 전체 dim, 특별 표시 없음
      return allSlotsD200h(0);

    case 'choice_hint': {
      // 표시 전용 — 클릭 불가 힌트 (choice와 동일하게 렌더링)
      const choices = layout.choices ?? [];
      const cmds = allSlotsD200h(0);
      choices.slice(0, TOTAL_SLOTS).forEach((c, i) => {
        _setCmd(cmds, toD200hSlot(i), 4, (c.label ?? '').slice(0, 12));
      });
      return cmds;
    }

    case 'custom': {
      // slots 맵: { "djSlot": stateIndex } — Bridge 행-우선 슬롯 기준
      const slotsMap = layout.slots ?? {};
      const cmds = allSlotsD200h(0);
      for (const [djSlotStr, stateIndex] of Object.entries(slotsMap)) {
        const djSlot = Number(djSlotStr);
        if (Number.isInteger(djSlot) && djSlot >= 0 && djSlot < TOTAL_SLOTS) {
          _setCmd(cmds, toD200hSlot(djSlot), Number(stateIndex));
        }
      }
      return cmds;
    }

    default:
      return [];
  }
}

/**
 * 모든 D200H 슬롯(열-우선 0~TOTAL_SLOTS-1)을 동일한 stateIndex로 채운다.
 *
 * @param {number} stateIndex
 * @returns {Array<{ slot: number, stateIndex: number }>}
 */
function allSlotsD200h(stateIndex) {
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => ({ slot: i, stateIndex }));
}

/**
 * cmds 배열에서 특정 D200H 슬롯의 커맨드를 업데이트한다.
 *
 * @param {Array} cmds
 * @param {number} d200hSlot - D200H 열-우선 슬롯
 * @param {number} stateIndex
 * @param {string} [text]
 */
function _setCmd(cmds, d200hSlot, stateIndex, text) {
  const cmd = cmds.find(c => c.slot === d200hSlot);
  if (cmd) {
    cmd.stateIndex = stateIndex;
    if (text !== undefined) cmd.text = text;
  }
}
