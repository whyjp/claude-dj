/**
 * stateMachine.test.js
 *
 * 버튼 상태 전이 로직 검증.
 *
 * 테스트 원칙:
 *  - 각 테스트는 실제 D200H 버튼 인터랙션 시나리오를 반영한다.
 *  - 실패 시: 테스트 기대값이 잘못됐는지(시나리오 오류),
 *    stateMachine 내부 오류인지를 명확히 구분한다.
 *  - 억지 통과 수정 금지.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  transition,
  getStateIndex,
  isValidState,
  States,
} from '../com.d200htest.bridge.ulanziPlugin/plugin/core/stateMachine.js';

// --- transition ---

describe('transition', () => {
  it('IDLE + run → ACTIVE', () => {
    assert.equal(transition(States.IDLE, 'run'), States.ACTIVE);
  });

  it('ACTIVE + run → IDLE', () => {
    assert.equal(transition(States.ACTIVE, 'run'), States.IDLE);
  });

  it('IDLE + keydown → IDLE (상태 유지)', () => {
    assert.equal(transition(States.IDLE, 'keydown'), States.IDLE);
  });

  it('ACTIVE + keydown → ACTIVE (상태 유지)', () => {
    assert.equal(transition(States.ACTIVE, 'keydown'), States.ACTIVE);
  });

  it('IDLE + keyup → IDLE (상태 유지)', () => {
    assert.equal(transition(States.IDLE, 'keyup'), States.IDLE);
  });

  it('ACTIVE + keyup → ACTIVE (상태 유지)', () => {
    assert.equal(transition(States.ACTIVE, 'keyup'), States.ACTIVE);
  });

  it('미정의 이벤트는 현재 상태 유지', () => {
    assert.equal(transition(States.IDLE, 'unknown_event'), States.IDLE);
    assert.equal(transition(States.ACTIVE, 'unknown_event'), States.ACTIVE);
  });

  // 연속 토글 시나리오 — 실제 버튼 3회 누름
  it('run 3회 연속: IDLE → ACTIVE → IDLE → ACTIVE', () => {
    let state = States.IDLE;
    state = transition(state, 'run');
    assert.equal(state, States.ACTIVE);
    state = transition(state, 'run');
    assert.equal(state, States.IDLE);
    state = transition(state, 'run');
    assert.equal(state, States.ACTIVE);
  });

  // keydown 후 run (keyDown 먼저 발생, 이후 run 발생하는 실 환경 순서)
  it('keydown 후 run: 상태는 run에 의해만 전이', () => {
    let state = States.IDLE;
    state = transition(state, 'keydown'); // 무시됨
    assert.equal(state, States.IDLE);
    state = transition(state, 'run');     // 전이
    assert.equal(state, States.ACTIVE);
  });
});

// --- getStateIndex ---

describe('getStateIndex', () => {
  it('IDLE → stateIndex 0', () => {
    assert.equal(getStateIndex(States.IDLE), 0);
  });

  it('ACTIVE → stateIndex 1', () => {
    assert.equal(getStateIndex(States.ACTIVE), 1);
  });

  it('알 수 없는 상태 → 0 (안전 기본값)', () => {
    assert.equal(getStateIndex('UNKNOWN'), 0);
  });
});

// --- isValidState ---

describe('isValidState', () => {
  it('IDLE은 유효', () => {
    assert.equal(isValidState(States.IDLE), true);
  });

  it('ACTIVE는 유효', () => {
    assert.equal(isValidState(States.ACTIVE), true);
  });

  it('빈 문자열은 무효', () => {
    assert.equal(isValidState(''), false);
  });

  it('미정의 문자열은 무효', () => {
    assert.equal(isValidState('PROCESSING'), false);
  });

  it('null/undefined는 무효', () => {
    assert.equal(isValidState(null), false);
    assert.equal(isValidState(undefined), false);
  });
});

// --- States 상수 ---

describe('States 상수', () => {
  it('IDLE 값 확인', () => {
    assert.equal(States.IDLE, 'IDLE');
  });

  it('ACTIVE 값 확인', () => {
    assert.equal(States.ACTIVE, 'ACTIVE');
  });

  it('States는 동결(freeze)되어 수정 불가', () => {
    const original = States.IDLE;
    try { States.IDLE = 'MODIFIED'; } catch (_) {}
    assert.equal(States.IDLE, original);
  });
});
