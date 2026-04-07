/**
 * eventParser.js — 순수함수
 *
 * UlanziStudio가 플러그인으로 보내는 raw WS 메시지를 내부 InputEvent DTO로 변환한다.
 *
 * InputEvent {
 *   slot:      number          — 버튼 인덱스 (0-based)
 *   event:     'keydown' | 'keyup' | 'run'
 *   context:   string          — uuid___key___actionid (Ulanzi context string)
 *   timestamp: number          — Date.now() at parse time
 * }
 *
 * 알 수 없는 cmd거나 slot을 파악할 수 없는 경우 null 반환.
 *
 * [실환경 주의]
 * 시뮬레이터(UlanziDeckSimulator)는 key를 "0", "1" 등 단순 정수 문자열로 전달하지만,
 * 실제 UlanziStudio는 "row_col" 형식(예: "0_0", "1_2")으로 전달한다.
 * parseSlot은 두 포맷을 모두 지원한다.
 * D200H 기준 그리드 열 수: GRID_COLS = 5
 */

const VALID_EVENTS = new Set(['keydown', 'keyup', 'run']);

/**
 * D200H 그리드 열 수.
 * "row_col" 포맷을 선형 슬롯 인덱스로 변환할 때 사용한다.
 * D200H: 5열 × 3행 = 15 positions, 실제 사용 13개
 */
export const GRID_COLS = 5;

/**
 * @param {object} msg - UlanziStudio 메시지 (onKeyDown/onKeyUp/onRun callback 인자)
 * @returns {InputEvent|null}
 */
export function parseInputEvent(msg) {
  if (!msg || typeof msg !== 'object') return null;

  const event = msg.cmd;
  if (!VALID_EVENTS.has(event)) return null;

  const slot = parseSlot(msg.key);
  if (slot === null) return null;

  return {
    slot,
    event,
    context: msg.context ?? '',
    timestamp: Date.now(),
  };
}

/**
 * Ulanzi key 필드를 정수 슬롯 번호로 정규화한다.
 *
 * 지원 포맷:
 *  - 단순 정수: "0", "5", 12  → 그대로 반환 (시뮬레이터 포맷)
 *  - row_col:  "0_0", "1_2"  → row * GRID_COLS + col (실제 UlanziStudio 포맷)
 *
 * 유효 범위: 0 이상 정수. 파싱 실패 시 null.
 *
 * @param {string|number} key
 * @returns {number|null}
 */
export function parseSlot(key) {
  if (key === undefined || key === null || key === '') return null;

  const str = String(key);

  // "row_col" 포맷 처리 (실제 UlanziStudio)
  if (str.includes('_')) {
    const parts = str.split('_');
    if (parts.length !== 2) return null;
    const row = Number(parts[0]);
    const col = Number(parts[1]);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return null;
    return row * GRID_COLS + col;
  }

  // 단순 정수 포맷 처리 (시뮬레이터)
  const n = Number(str);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}
