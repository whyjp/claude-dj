/**
 * eventParser.test.js
 *
 * parseInputEvent — raw WS 메시지를 InputEvent DTO로 변환하는 순수함수 검증.
 *
 * 테스트 원칙:
 *  - 시나리오는 실제 UlanziStudio가 보내는 메시지 형식을 기반으로 작성.
 *  - 실패 시 이 파일의 테스트 로직이 잘못된 것인지,
 *    eventParser.js 내부 오류인지를 명확히 분리한다.
 *  - green을 위한 억지 수정 금지.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInputEvent, parseSlot, GRID_COLS } from '../com.d200htest.bridge.ulanziPlugin/plugin/core/eventParser.js';

// --- parseSlot ---

describe('parseSlot — 시뮬레이터 포맷 (단순 정수)', () => {
  it('문자열 "0"을 숫자 0으로 변환', () => {
    assert.equal(parseSlot('0'), 0);
  });

  it('문자열 "5"를 숫자 5로 변환', () => {
    assert.equal(parseSlot('5'), 5);
  });

  it('문자열 "12"를 숫자 12로 변환', () => {
    assert.equal(parseSlot('12'), 12);
  });

  it('숫자 타입도 허용', () => {
    assert.equal(parseSlot(3), 3);
  });

  it('빈 문자열은 null 반환', () => {
    assert.equal(parseSlot(''), null);
  });

  it('undefined는 null 반환', () => {
    assert.equal(parseSlot(undefined), null);
  });

  it('null은 null 반환', () => {
    assert.equal(parseSlot(null), null);
  });

  it('음수는 null 반환', () => {
    assert.equal(parseSlot('-1'), null);
  });

  it('소수점은 null 반환', () => {
    assert.equal(parseSlot('1.5'), null);
  });

  it('비숫자 문자열은 null 반환', () => {
    assert.equal(parseSlot('abc'), null);
  });
});

// 실제 UlanziStudio는 key를 "row_col" 형식으로 전달한다.
// 시뮬레이터와 달리 단순 정수가 아니므로 반드시 별도 처리 필요.
describe('parseSlot — 실제 UlanziStudio 포맷 (row_col)', () => {
  it('"0_0" → 0 (첫 번째 키)', () => {
    assert.equal(parseSlot('0_0'), 0);
  });

  it('"0_1" → 1 (첫 행 두 번째)', () => {
    assert.equal(parseSlot('0_1'), 1);
  });

  it('"0_4" → 4 (첫 행 마지막)', () => {
    assert.equal(parseSlot('0_4'), 4);
  });

  it('"1_0" → GRID_COLS (두 번째 행 첫 번째)', () => {
    assert.equal(parseSlot('1_0'), GRID_COLS);
  });

  it('"1_2" → GRID_COLS + 2', () => {
    assert.equal(parseSlot('1_2'), GRID_COLS + 2);
  });

  it('"2_2" → 2*GRID_COLS + 2 (D200H 13번째 키)', () => {
    assert.equal(parseSlot('2_2'), 2 * GRID_COLS + 2);
  });

  it('row 음수는 null 반환', () => {
    assert.equal(parseSlot('-1_0'), null);
  });

  it('col 음수는 null 반환', () => {
    assert.equal(parseSlot('0_-1'), null);
  });

  it('구분자가 2개 이상이면 null 반환', () => {
    assert.equal(parseSlot('0_0_0'), null);
  });

  it('row 비숫자는 null 반환', () => {
    assert.equal(parseSlot('a_0'), null);
  });

  it('col 비숫자는 null 반환', () => {
    assert.equal(parseSlot('0_b'), null);
  });
});

// --- parseInputEvent ---

describe('parseInputEvent — 시뮬레이터 포맷', () => {
  it('keydown 이벤트 파싱 (단순 정수 key)', () => {
    const msg = {
      cmd: 'keydown',
      key: '0',
      context: 'uuid___0___actionid',
    };
    const result = parseInputEvent(msg);

    assert.ok(result !== null, '결과가 null이어서는 안 됨');
    assert.equal(result.event, 'keydown');
    assert.equal(result.slot, 0);
    assert.equal(result.context, 'uuid___0___actionid');
    assert.ok(typeof result.timestamp === 'number', 'timestamp는 숫자');
  });

  it('keyup 이벤트 파싱 — slot 5', () => {
    const msg = { cmd: 'keyup', key: '5', context: 'uuid___5___actionid' };
    const result = parseInputEvent(msg);

    assert.ok(result !== null);
    assert.equal(result.event, 'keyup');
    assert.equal(result.slot, 5);
  });

  it('run 이벤트 파싱 — slot 12', () => {
    const msg = { cmd: 'run', key: '12', context: 'uuid___12___actionid' };
    const result = parseInputEvent(msg);

    assert.ok(result !== null);
    assert.equal(result.event, 'run');
    assert.equal(result.slot, 12);
  });

  it('key가 숫자 타입인 경우도 정상 파싱', () => {
    const result = parseInputEvent({ cmd: 'keydown', key: 2, context: 'ctx' });
    assert.ok(result !== null);
    assert.equal(result.slot, 2);
  });
});

// 실제 UlanziStudio에서 수신한 raw 메시지 형식 기반 테스트.
// 발견 경위: npm start 후 버튼 눌러도 반응 없는 문제 → raw 로그로 확인.
describe('parseInputEvent — 실제 UlanziStudio 포맷 (row_col key)', () => {
  it('keydown "0_0" → slot 0', () => {
    const msg = {
      actionid: '9b62a068-9366-4233-b8f1-897533a92fc4',
      cmd: 'keydown',
      key: '0_0',
      param: {},
      uuid: 'com.d200htest.bridge.slot',
    };
    const result = parseInputEvent(msg);

    assert.ok(result !== null, '실제 UlanziStudio 메시지가 null을 반환해서는 안 됨');
    assert.equal(result.event, 'keydown');
    assert.equal(result.slot, 0);
  });

  it('run "0_0" → slot 0', () => {
    const msg = {
      actionid: '9b62a068-9366-4233-b8f1-897533a92fc4',
      cmd: 'run',
      key: '0_0',
      param: {},
      uuid: 'com.d200htest.bridge.slot',
    };
    const result = parseInputEvent(msg);

    assert.ok(result !== null);
    assert.equal(result.event, 'run');
    assert.equal(result.slot, 0);
  });

  it('keyup "0_0" → slot 0', () => {
    const msg = { cmd: 'keyup', key: '0_0', param: {}, uuid: 'com.d200htest.bridge.slot' };
    const result = parseInputEvent(msg);

    assert.ok(result !== null);
    assert.equal(result.event, 'keyup');
    assert.equal(result.slot, 0);
  });

  it('두 번째 키 "0_1" → slot 1', () => {
    const result = parseInputEvent({ cmd: 'run', key: '0_1', param: {} });
    assert.ok(result !== null);
    assert.equal(result.slot, 1);
  });

  it('두 번째 행 첫 키 "1_0" → slot 5', () => {
    const result = parseInputEvent({ cmd: 'run', key: '1_0', param: {} });
    assert.ok(result !== null);
    assert.equal(result.slot, GRID_COLS);
  });
});

describe('parseInputEvent — 공통 비정상 케이스', () => {
  it('timestamp는 현재 시각 범위 내', () => {
    const before = Date.now();
    const result = parseInputEvent({ cmd: 'run', key: '0', context: '' });
    const after = Date.now();

    assert.ok(result !== null);
    assert.ok(result.timestamp >= before && result.timestamp <= after, 'timestamp 범위 초과');
  });

  it('알 수 없는 cmd는 null 반환', () => {
    assert.equal(parseInputEvent({ cmd: 'unknown', key: '0', context: '' }), null);
  });

  it('cmd 없는 메시지는 null 반환', () => {
    assert.equal(parseInputEvent({ key: '0', context: '' }), null);
  });

  it('key 없는 메시지는 null 반환', () => {
    assert.equal(parseInputEvent({ cmd: 'run', context: '' }), null);
  });

  it('null 입력은 null 반환', () => {
    assert.equal(parseInputEvent(null), null);
  });

  it('비객체 입력은 null 반환', () => {
    assert.equal(parseInputEvent('not-an-object'), null);
  });

  it('context 없는 메시지도 처리 (선택적 필드)', () => {
    const result = parseInputEvent({ cmd: 'run', key: '0' });
    assert.ok(result !== null);
    assert.equal(result.context, '');
  });
});
