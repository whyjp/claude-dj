/**
 * stateMachine.js — 순수함수
 *
 * D200H 버튼 1개의 상태 전이를 관리한다.
 *
 * States:
 *   'IDLE'   — 기본 상태, stateIndex=0
 *   'ACTIVE' — 활성 상태, stateIndex=1
 *
 * Transitions (event: 'keydown' | 'keyup' | 'run'):
 *   IDLE   + run  → ACTIVE
 *   ACTIVE + run  → IDLE
 *   any    + keydown | keyup → 상태 변경 없음 (이벤트 무시)
 *
 * stateIndex는 manifest.json States 배열 인덱스와 1:1 대응한다.
 */

/** @type {Readonly<{IDLE: string, ACTIVE: string}>} */
export const States = Object.freeze({
  IDLE: 'IDLE',
  ACTIVE: 'ACTIVE',
});

/** manifest.json States 배열 인덱스 매핑 */
const STATE_INDEX = {
  [States.IDLE]:   0,
  [States.ACTIVE]: 1,
};

/**
 * 현재 상태와 이벤트를 받아 다음 상태를 반환한다.
 * 알 수 없는 상태/이벤트 조합에서는 현재 상태를 그대로 반환한다.
 *
 * @param {string} currentState
 * @param {string} event - 'keydown' | 'keyup' | 'run'
 * @returns {string} nextState
 */
export function transition(currentState, event) {
  if (event === 'run') {
    if (currentState === States.IDLE)   return States.ACTIVE;
    if (currentState === States.ACTIVE) return States.IDLE;
  }
  // keydown, keyup 및 미정의 이벤트는 상태 유지
  return currentState;
}

/**
 * 상태 문자열을 manifest.json States 배열 인덱스로 변환한다.
 *
 * @param {string} state
 * @returns {number} stateIndex (0=IDLE, 1=ACTIVE)
 */
export function getStateIndex(state) {
  const idx = STATE_INDEX[state];
  if (idx === undefined) {
    console.warn(`[stateMachine] unknown state: ${state}, defaulting to 0`);
    return 0;
  }
  return idx;
}

/**
 * 유효한 상태 문자열인지 검사한다.
 *
 * @param {string} state
 * @returns {boolean}
 */
export function isValidState(state) {
  return state === States.IDLE || state === States.ACTIVE;
}
