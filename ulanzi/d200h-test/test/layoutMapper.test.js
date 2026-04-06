/**
 * layoutMapper.test.js
 *
 * Bridge LAYOUT 메시지 → SlotCommand 배열 변환 검증.
 *
 * 테스트 원칙:
 *  - 각 테스트는 실제 Bridge 브로드캐스트 형식을 기반으로 작성.
 *  - 실패 시 테스트 로직 오류 vs layoutMapper 내부 오류를 구분한다.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapLayout, TOTAL_SLOTS } from '../com.d200htest.bridge.ulanziPlugin/plugin/core/layoutMapper.js';

describe('mapLayout — idle preset', () => {
  it('전체 슬롯이 stateIndex:0 (IDLE)', () => {
    const cmds = mapLayout({ preset: 'idle' });

    assert.equal(cmds.length, TOTAL_SLOTS);
    for (const cmd of cmds) {
      assert.equal(cmd.stateIndex, 0, `slot ${cmd.slot} stateIndex should be 0`);
    }
  });

  it('슬롯 번호는 0부터 TOTAL_SLOTS-1까지 연속', () => {
    const cmds = mapLayout({ preset: 'idle' });
    const slots = cmds.map((c) => c.slot).sort((a, b) => a - b);
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      assert.equal(slots[i], i);
    }
  });
});

describe('mapLayout — active preset (단일 슬롯)', () => {
  it('slot:3 → slot 3만 stateIndex:1, 나머지는 0', () => {
    const cmds = mapLayout({ preset: 'active', slot: 3 });

    assert.equal(cmds.length, TOTAL_SLOTS);
    for (const cmd of cmds) {
      if (cmd.slot === 3) {
        assert.equal(cmd.stateIndex, 1, 'slot 3은 ACTIVE');
      } else {
        assert.equal(cmd.stateIndex, 0, `slot ${cmd.slot}은 IDLE`);
      }
    }
  });

  it('slot:0 → 첫 번째 슬롯만 ACTIVE', () => {
    const cmds = mapLayout({ preset: 'active', slot: 0 });
    assert.equal(cmds.find((c) => c.slot === 0)?.stateIndex, 1);
    assert.equal(cmds.find((c) => c.slot === 1)?.stateIndex, 0);
  });

  it('slot:12 → 마지막 슬롯만 ACTIVE', () => {
    const cmds = mapLayout({ preset: 'active', slot: 12 });
    assert.equal(cmds.find((c) => c.slot === 12)?.stateIndex, 1);
    assert.equal(cmds.find((c) => c.slot === 11)?.stateIndex, 0);
  });

  it('slot 미지정 → 전체 ACTIVE', () => {
    const cmds = mapLayout({ preset: 'active' });
    for (const cmd of cmds) {
      assert.equal(cmd.stateIndex, 1);
    }
  });

  it('범위 밖 slot(-1) → 전체 ACTIVE (안전 폴백)', () => {
    const cmds = mapLayout({ preset: 'active', slot: -1 });
    for (const cmd of cmds) {
      assert.equal(cmd.stateIndex, 1);
    }
  });
});

describe('mapLayout — custom preset', () => {
  it('slots 맵 적용: slot 3=1, slot 7=1, 나머지=0', () => {
    const cmds = mapLayout({ preset: 'custom', slots: { '3': 1, '7': 1 } });

    assert.equal(cmds.length, TOTAL_SLOTS);
    assert.equal(cmds.find((c) => c.slot === 3)?.stateIndex, 1);
    assert.equal(cmds.find((c) => c.slot === 7)?.stateIndex, 1);
    assert.equal(cmds.find((c) => c.slot === 0)?.stateIndex, 0);
    assert.equal(cmds.find((c) => c.slot === 12)?.stateIndex, 0);
  });

  it('빈 slots 맵 → 전체 IDLE', () => {
    const cmds = mapLayout({ preset: 'custom', slots: {} });
    for (const cmd of cmds) {
      assert.equal(cmd.stateIndex, 0);
    }
  });

  it('slots 키가 숫자 타입이어도 처리', () => {
    const cmds = mapLayout({ preset: 'custom', slots: { 5: 1 } });
    assert.equal(cmds.find((c) => c.slot === 5)?.stateIndex, 1);
  });
});

describe('mapLayout — 비정상 입력', () => {
  it('null 입력 → 빈 배열', () => {
    assert.deepEqual(mapLayout(null), []);
  });

  it('undefined 입력 → 빈 배열', () => {
    assert.deepEqual(mapLayout(undefined), []);
  });

  it('알 수 없는 preset → 빈 배열', () => {
    assert.deepEqual(mapLayout({ preset: 'unknown_preset' }), []);
  });

  it('preset 없음 → 빈 배열', () => {
    assert.deepEqual(mapLayout({}), []);
  });
});

// TOTAL_SLOTS는 5열×5행 상한(25)으로 설정.
// 실기기 확인: 우측 최상단 key="4_0" → slot=20.
// D200H가 5열×4행=20키라면 슬롯 4,9,14,19,24는 사용되지 않는다.
// TOTAL_SLOTS는 실제 키 수가 아닌 "슬롯 배열의 최대 범위"이다.
describe('TOTAL_SLOTS 상수', () => {
  it('5열×5행 상한: 25', () => {
    assert.equal(TOTAL_SLOTS, 25);
  });

  it('실기기 상한 slot(20)을 TOTAL_SLOTS가 커버', () => {
    assert.ok(TOTAL_SLOTS > 20, `TOTAL_SLOTS(${TOTAL_SLOTS})이 slot 20을 커버해야 함`);
  });

  it('active preset slot:20 → slot 20만 ACTIVE', () => {
    const cmds = mapLayout({ preset: 'active', slot: 20 });
    const s20 = cmds.find(c => c.slot === 20);
    assert.ok(s20, 'slot 20 커맨드가 존재해야 함');
    assert.equal(s20.stateIndex, 1);
    assert.ok(cmds.filter(c => c.slot !== 20).every(c => c.stateIndex === 0));
  });
});
