/**
 * layoutMapper.js — 순수함수
 *
 * Bridge에서 받은 LAYOUT 메시지를 RenderCommand 배열로 변환한다.
 * RenderCommand는 ulanziOutputAdapter가 소비해 실제 LCD에 반영한다.
 *
 * LAYOUT {
 *   type:    'LAYOUT'
 *   preset:  'idle' | 'active' | 'custom'
 *   slots?:  { [slot: number]: stateIndex }  — custom preset에서 사용
 *   slot?:   number                           — active preset에서 특정 슬롯만 활성화
 * }
 *
 * RenderCommand {
 *   context:    string  — Ulanzi context string (uuid___key___actionid)
 *   stateIndex: number  — 0=IDLE, 1=ACTIVE
 *   text?:      string
 * }
 *
 * mapLayout은 context 정보가 없으므로 슬롯 인덱스만 담은 SlotCommand를 반환한다.
 * app.js에서 keyStates Map을 통해 context를 채워 RenderCommand로 완성한다.
 *
 * SlotCommand {
 *   slot:       number
 *   stateIndex: number
 *   text?:      string
 * }
 */

/**
 * D200H 슬롯 레이아웃 상수.
 *
 * key 포맷: "physical_col_physical_row"
 *   첫 번째 숫자 = 물리적 열 (0=왼쪽, DEVICE_COLS-1=오른쪽)
 *   두 번째 숫자 = 물리적 행 (0=위쪽, DEVICE_ROWS-1=아래쪽)
 *
 * slot = physical_col × DEVICE_COLS + physical_row
 *
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
 * DEVICE_COLS=5 는 물리적 열 수 (= parseSlot의 GRID_COLS와 동일).
 * TOTAL_SLOTS=25 는 5×5 최대 범위로 여유 있게 설정.
 * 실제 D200H가 5×4=20키이면 슬롯 4,9,14,19,24는 사용되지 않는다.
 */
export const DEVICE_COLS = 5;
export const TOTAL_SLOTS = 25; // 5열 × 5행 상한 (D200H 실제 키 수에 관계없이 안전)

/**
 * LAYOUT 메시지를 SlotCommand 배열로 변환한다.
 *
 * @param {object} layout
 * @returns {Array<{ slot: number, stateIndex: number, text?: string }>}
 */
export function mapLayout(layout) {
  if (!layout || typeof layout !== 'object') return [];

  switch (layout.preset) {
    case 'idle':
      return allSlots(0);

    case 'active': {
      // 단일 슬롯만 ACTIVE, 나머지는 IDLE
      const activeSlot = Number(layout.slot ?? -1);
      if (!Number.isInteger(activeSlot) || activeSlot < 0 || activeSlot >= TOTAL_SLOTS) {
        // slot 미지정: 전체 ACTIVE
        return allSlots(1);
      }
      return Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
        slot: i,
        stateIndex: i === activeSlot ? 1 : 0,
      }));
    }

    case 'custom': {
      // slots 맵: { "3": 1, "5": 0, ... }
      const slotsMap = layout.slots ?? {};
      return Array.from({ length: TOTAL_SLOTS }, (_, i) => {
        const val = slotsMap[String(i)] ?? slotsMap[i];
        const stateIndex = val !== undefined ? Number(val) : 0;
        return { slot: i, stateIndex };
      });
    }

    default:
      return [];
  }
}

/**
 * 모든 슬롯을 동일한 stateIndex로 채운 SlotCommand 배열을 반환한다.
 *
 * @param {number} stateIndex
 * @returns {Array<{ slot: number, stateIndex: number }>}
 */
function allSlots(stateIndex) {
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => ({ slot: i, stateIndex }));
}
