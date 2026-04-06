# Testing

## 테스트 원칙

1.  **시나리오 기반**: 테스트는 실제 사용 시나리오를 반영한다. 임의의 입력값이 아닌
    실제 UlanziStudio/Bridge가 주고받는 메시지 형식을 기준으로 작성한다.
2.  **실패 원인 분리**: 테스트 실패 시 "테스트 로직 오류"와 "구현 코드 오류"를 주석으로 명시한다.
3.  **억지 green 금지**: 테스트를 통과시키기 위해 검증 조건을 완화하거나 구현을 억지로 맞추지 않는다.
4.  **단위 → 통합 순서**: core 순수함수 단위 테스트를 먼저, 어댑터 통합 테스트를 이후에 작성한다.

## 테스트 실행

```powershell
# 모든 테스트
npm test

# 특정 파일만
node --test test/eventParser.test.js
node --test test/stateMachine.test.js
node --test test/layoutMapper.test.js
node --test --test-timeout=15000 test/integration.test.js
```

`integration.test.js`는 실제 WebSocket 서버를 인프로세스로 실행하므로
`--test-timeout=15000` 옵션이 필요하다.

## 테스트 파일 구조

```
test/
├── eventParser.test.js     # core: parseSlot, parseInputEvent 단위 테스트
├── stateMachine.test.js    # core: transition, getStateIndex 단위 테스트
├── layoutMapper.test.js    # core: mapLayout 단위 테스트
└── integration.test.js     # Bridge WsServer + BridgeWsAdapter 통합 테스트
```

---

## `test/eventParser.test.js`

**대상:** `core/eventParser.js`의 `parseSlot`, `parseInputEvent`

**테스트 그룹:**

| describe                                     | 커버 시나리오                                    |
| -------------------------------------------- | ------------------------------------------------ |
| `parseSlot — 시뮬레이터 포맷 (단순 정수)`    | `"0"`, `"5"`, 숫자 타입, 음수, 소수, 비숫자     |
| `parseSlot — 실제 UlanziStudio 포맷 (row_col)` | `"0_0"`, `"1_2"`, 음수, 구분자 과다, 비숫자   |
| `parseInputEvent — 시뮬레이터 포맷`          | keydown/keyup/run, 숫자 key 타입                 |
| `parseInputEvent — 실제 UlanziStudio 포맷`   | D200H 실기기에서 수집한 raw 메시지 기반          |
| `parseInputEvent — 공통 비정상 케이스`       | null, 비객체, cmd 없음, key 없음                 |

**핵심 케이스 — 실환경 기반:**

```javascript
// 실제 UlanziStudio가 보낸 raw 메시지 그대로 사용
const msg = {
  actionid: '9b62a068-9366-4233-b8f1-897533a92fc4',
  cmd: 'run',
  key: '0_0',                    // ← "row_col" 포맷
  param: {},
  uuid: 'com.d200htest.bridge.slot',
};
const result = parseInputEvent(msg);
assert.equal(result.slot, 0);   // row=0, col=0 → 0*5+0=0
```

> `TROUBLESHOOTING.md` TBL-001: `"0_0"` 포맷 미지원이 원인이었던 버그의 회귀 방지용.

---

## `test/stateMachine.test.js`

**대상:** `core/stateMachine.js`의 `transition`, `getStateIndex`, `isValidState`

**테스트 그룹:**

| describe         | 커버 시나리오                                        |
| ---------------- | ---------------------------------------------------- |
| `transition`     | IDLE→run→ACTIVE, ACTIVE→run→IDLE, keydown/keyup 무변화 |
| `getStateIndex`  | IDLE→0, ACTIVE→1, 미정의 상태→0 (fallback)           |
| `isValidState`   | 유효/무효 상태 문자열                                |

**상태 전이 커버리지:**

```
IDLE  ─[run]─► ACTIVE
IDLE  ─[keydown]─► IDLE   (변화 없음)
IDLE  ─[keyup]─► IDLE     (변화 없음)
ACTIVE ─[run]─► IDLE
ACTIVE ─[keydown]─► ACTIVE (변화 없음)
```

---

## `test/layoutMapper.test.js`

**대상:** `core/layoutMapper.js`의 `mapLayout`

**테스트 그룹:**

| describe              | 커버 시나리오                                            |
| --------------------- | -------------------------------------------------------- |
| `mapLayout — idle`    | 전체 13슬롯 stateIndex=0                                 |
| `mapLayout — active`  | 단일 슬롯 활성화, slot 미지정 시 전체 활성화             |
| `mapLayout — custom`  | 특정 슬롯 지정, 미지정 슬롯 기본값, 문자열/숫자 key 혼용 |
| `mapLayout — edge`    | null, 비객체, 미정의 preset 입력                         |

**TOTAL_SLOTS 커버 확인:**

```javascript
const cmds = mapLayout({ preset: 'idle' });
assert.equal(cmds.length, TOTAL_SLOTS); // 항상 13개
```

---

## `test/integration.test.js`

**대상:** `bridge/wsServer.js` (WsServer) + `adapters/bridgeWsAdapter.js` (BridgeWsAdapter)

실제 WebSocket 서버를 인프로세스로 구동해 메시지 왕복을 검증한다.

**픽스처 구조:**

```javascript
describe('Integration: Bridge WsServer + BridgeWsAdapter', () => {
  let server;   // http.Server
  let wsServer; // WsServer

  before(async () => {
    server = http.createServer();
    wsServer = new WsServer();
    wsServer.attach(server, '/ws');
    await new Promise(resolve => server.listen(TEST_PORT, resolve));
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });
});
```

**테스트 그룹:**

| describe                              | 포트  | 커버 시나리오                                          |
| ------------------------------------- | ----- | ------------------------------------------------------ |
| `Integration: Bridge WsServer + ...`  | 39295 | LAYOUT 수신, mapLayout 변환, ALL_DIM, BUTTON_PRESS     |
| `BridgeWsAdapter — 재연결 (Stage D)`  | 별도  | 서버 종료 후 재연결, 연결 불가 시 백오프 시도          |

**핵심 테스트 — 재연결:**

```
before: 서버 기동 → 어댑터 연결 확인
        서버 강제 종료 (terminateAll + close) → 어댑터 disconnect 확인
        새 서버 기동 → 어댑터 재연결 확인 (최대 5000ms)
        LAYOUT 브로드캐스트 → 수신 확인
```

**`waitUntil` 헬퍼:**

```javascript
async function waitUntil(fn, timeoutMs = 3000, intervalMs = 30) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await wait(intervalMs);
  }
  throw new Error(`waitUntil timeout — condition: ${fn.toString().slice(0, 80)}`);
}
```

비동기 상태 변화를 폴링으로 대기한다.
`adapter.isConnected`처럼 명확한 상태 플래그를 조건으로 사용해야 신뢰도가 높다.

---

## 포트 할당

테스트 파일이 서로 다른 포트를 사용하도록 고정 할당한다.

| 파일                    | 포트          | 비고                              |
| ----------------------- | ------------- | --------------------------------- |
| `integration.test.js`   | 39295         | 공유 서버                         |
| 재연결 테스트 (서버 1)  | 39292         | `서버 종료 후 재연결` 테스트      |
| 재연결 테스트 (실패)    | 39291         | `백오프 시도` 테스트              |

포트 충돌 발생 시 `TROUBLESHOOTING.md` TBL-003 참조.

---

## 테스트 커버리지 요약

| 모듈                      | 단위 | 통합 | 실환경 시나리오 |
| ------------------------- | ---- | ---- | --------------- |
| `eventParser.js`          | ✓    | —    | ✓ (row_col 포맷) |
| `stateMachine.js`         | ✓    | —    | —               |
| `layoutMapper.js`         | ✓    | —    | —               |
| `wsServer.js`             | —    | ✓    | —               |
| `bridgeWsAdapter.js`      | —    | ✓    | —               |
| `ulanziOutputAdapter.js`  | —    | —    | 수동 검증       |
| `app.js`                  | —    | —    | 수동 검증       |
