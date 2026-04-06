# Component Reference

프로젝트의 모든 모듈을 계층별로 정리한다.

---

## Bridge Server (`bridge/`)

### `bridge/wsServer.js` — WsServer

Bridge WebSocket 서버 코어. 클라이언트 연결 관리 및 메시지 라우팅.

**클래스: `WsServer`**

| 멤버              | 타입                                    | 설명                                          |
| ----------------- | --------------------------------------- | --------------------------------------------- |
| `clients`         | `Set<WebSocket>`                        | 현재 연결된 클라이언트 목록                    |
| `onButtonPress`   | `(slot, timestamp?) => void \| null`    | BUTTON_PRESS 수신 핸들러. 외부에서 할당        |
| `onClientReady`   | `(ws) => void \| null`                  | CLIENT_READY 수신 핸들러. 외부에서 할당        |
| `clientCount`     | `number` (getter)                       | 현재 연결 수                                  |
| `attach(server, path?)` | `(http.Server, string) => void`   | HTTP 서버에 WS 서버를 마운트 (기본 경로: `/ws`) |
| `broadcast(msg)`  | `(object) => void`                      | 모든 연결 클라이언트에 메시지 전송             |
| `terminateAll()`  | `() => void`                            | 모든 클라이언트를 강제 종료 (테스트 teardown용)|

**수신하는 메시지 타입:**

| type           | 필드                            | 처리                                  |
| -------------- | ------------------------------- | ------------------------------------- |
| `CLIENT_READY` | `clientType`, `version`         | `onClientReady` 콜백 호출             |
| `BUTTON_PRESS` | `slot` (0-12), `timestamp?`     | `onButtonPress` 콜백 호출             |

**송신하는 메시지 타입:**

| type      | 필드              | 시점                   |
| --------- | ----------------- | ---------------------- |
| `WELCOME` | `version`         | 신규 클라이언트 연결 시 |

---

### `bridge/server.js` — Bridge HTTP + WS 서버

Express HTTP + WsServer 조합. `npm run bridge`로 실행.

**환경 변수:**

| 변수          | 기본값 | 설명        |
| ------------- | ------ | ----------- |
| `BRIDGE_PORT` | 39200  | 서버 포트   |

**REST API:**

| 엔드포인트             | 메서드 | Body                                      | 응답                         |
| ---------------------- | ------ | ----------------------------------------- | ---------------------------- |
| `/api/health`          | GET    | —                                         | `{ status, version, clients }` |
| `/api/layout`          | POST   | `{ preset, slots?, slot? }`               | `{ ok, clients }`            |
| `/api/button-press`    | POST   | `{ slot: number }`                        | `{ ok, slot }`               |

**`POST /api/layout` Body 예시:**

```json
{ "preset": "idle" }
{ "preset": "active", "slot": 3 }
{ "preset": "custom", "slots": { "0": 1, "5": 1 } }
```

**export:**

```javascript
import { app, server, ws } from './bridge/server.js';
```

테스트에서 `server`와 `ws`를 직접 제어할 수 있다.

---

## Ulanzi Plugin (`com.d200htest.bridge.ulanziPlugin/plugin/`)

### `plugin/app.js` — Wiring (진입점)

플러그인 메인 서비스. UlanziStudio가 `node app.js <address> <port> <language>` 형식으로 실행.

**역할:**

-   `UlanziApi` 초기화 및 UlanziStudio 연결
-   키별 상태 저장: `keyStates: Map<context, { state, context, slot }>`
-   입력 이벤트 처리 → 상태 전이 → LCD 업데이트
-   Bridge 버튼 눌림 전달, Bridge LAYOUT 수신 처리

**흐름 요약:**

```
$UD.onAdd      → keyStates에 context 등록, 초기 상태 렌더
$UD.onRun      → handleInput → transition → applyRender + bridge.sendButtonPress
bridge.onLayout → keyStates 순회, applyRender로 각 키 업데이트
```

---

### `plugin/core/eventParser.js` — 순수함수

UlanziStudio WS 메시지를 `InputEvent` DTO로 변환.

**export:**

| 이름               | 타입                            | 설명                                                    |
| ------------------ | ------------------------------- | ------------------------------------------------------- |
| `GRID_COLS`        | `number` (= 5)                  | D200H 그리드 열 수. row_col → 선형 인덱스 변환에 사용    |
| `parseInputEvent(msg)` | `(object) => InputEvent \| null` | raw 메시지를 DTO로 변환. 유효하지 않으면 null           |
| `parseSlot(key)`   | `(string \| number) => number \| null` | key 문자열을 정수 슬롯 인덱스로 변환              |

**InputEvent DTO:**

```typescript
{
  slot:      number   // 0-based 버튼 인덱스
  event:     'keydown' | 'keyup' | 'run'
  context:   string   // "uuid___key___actionid"
  timestamp: number   // Date.now()
}
```

**`parseSlot` 지원 포맷:**

| 포맷     | 예시    | 결과              | 환경                   |
| -------- | ------- | ----------------- | ---------------------- |
| 단순 정수 | `"0"`, `3` | `0`, `3`        | UlanziDeckSimulator    |
| row_col  | `"0_0"`, `"1_2"` | `0`, `7`  | 실제 UlanziStudio      |

> **주의:** 실제 UlanziStudio는 `"0_0"` 포맷을 사용한다. 시뮬레이터와 다름.
> 상세 내용은 `TROUBLESHOOTING.md` TBL-001 참조.

---

### `plugin/core/stateMachine.js` — 순수함수

D200H 버튼 1개의 IDLE/ACTIVE 상태 전이.

**export:**

| 이름                | 타입                          | 설명                                              |
| ------------------- | ----------------------------- | ------------------------------------------------- |
| `States`            | `{ IDLE, ACTIVE }` (frozen)   | 유효 상태 상수                                    |
| `transition(state, event)` | `(string, string) => string` | 다음 상태 반환. 미정의 조합은 현재 상태 유지    |
| `getStateIndex(state)` | `(string) => number`       | `manifest.json` States 배열 인덱스 반환 (0/1)     |
| `isValidState(state)` | `(string) => boolean`       | 유효 상태 여부 검사                               |

**전이 테이블:**

| 현재 상태 | 이벤트    | 다음 상태 |
| --------- | --------- | --------- |
| IDLE      | `run`     | ACTIVE    |
| ACTIVE    | `run`     | IDLE      |
| any       | `keydown` | 변화 없음 |
| any       | `keyup`   | 변화 없음 |

---

### `plugin/core/layoutMapper.js` — 순수함수

Bridge `LAYOUT` 메시지를 `SlotCommand` 배열로 변환.

**export:**

| 이름           | 타입                              | 설명                                              |
| -------------- | --------------------------------- | ------------------------------------------------- |
| `DEVICE_COLS`  | `number` (= 5)                    | D200H 열 수. slot = col × 5 + row 계산에 사용     |
| `TOTAL_SLOTS`  | `number` (= 25)                   | 슬롯 인덱스 상한. 5×5 그리드 최대치 (안전 마진)   |
| `mapLayout(layout)` | `(object) => SlotCommand[]`  | LAYOUT → SlotCommand 배열 변환. 길이 = TOTAL_SLOTS |

**SlotCommand:**

```typescript
{ slot: number, stateIndex: number, text?: string }
```

**preset 동작:**

| preset   | 동작                                                    |
| -------- | ------------------------------------------------------- |
| `idle`   | 전체 슬롯 stateIndex=0                                  |
| `active` | `slot` 지정 시 해당 슬롯만 1, 나머지 0. 미지정 시 전체 1 |
| `custom` | `slots` 맵 `{ "3": 1, "7": 0 }` 으로 개별 슬롯 지정   |

---

### `plugin/adapters/bridgeWsAdapter.js` — BridgeWsAdapter

Bridge 서버와의 WebSocket 연결 관리. 재연결 포함.

**클래스: `BridgeWsAdapter`**

| 멤버               | 타입                    | 설명                                          |
| ------------------ | ----------------------- | --------------------------------------------- |
| `isConnected`      | `boolean` (getter)      | Bridge WS 연결 상태                           |
| `onLayout(fn)`     | `(fn) => void`          | LAYOUT 수신 콜백 등록                         |
| `sendButtonPress(slot)` | `(number) => void` | BUTTON_PRESS 메시지 송신                      |
| `destroy()`        | `() => void`            | 재연결 중단 및 소켓 종료                      |

**재연결 전략:**

-   최대 5회, 지수 백오프: 1초 → 2초 → 4초 → 8초 → 16초
-   재연결 후 `SYNC_REQUEST` 전송 → Bridge에서 현재 LAYOUT 재수신

**수신 메시지 처리:**

| type      | 동작                                              |
| --------- | ------------------------------------------------- |
| `LAYOUT`  | `_layoutCallback(msg)` 호출                       |
| `ALL_DIM` | `_layoutCallback({ preset: 'idle' })` 호출        |
| `WELCOME` | 로그 출력                                         |

---

### `plugin/adapters/ulanziOutputAdapter.js` — 출력 어댑터

RenderCommand를 UlanziApi 호출로 변환하여 D200H LCD를 업데이트한다.

**실기기 검증 결과:** `setStateIcon`은 UlanziStudio manifest 기반 이미지 캐시를 사용해
상태 변화가 LCD에 반영되지 않는 문제가 있다 (→ `TROUBLESHOOTING.md` TBL-005).
대신 `setBaseDataIcon(context, base64, text)`으로 base64 PNG를 직접 주입한다.

**렌더링 방식 (실기기 적용):**

| stateIndex | 이미지               | 텍스트 오버레이 | 의미     |
| ---------- | -------------------- | --------------- | -------- |
| 0 (IDLE)   | `resources/idle.png` (⚫ 검정 원) | `""` | 비활성   |
| 1 (ACTIVE) | `resources/active.png` (🟢 초록 원) | `"ON"` | 활성     |

이미지는 모듈 로드 시점에 `readFileSync`로 base64 문자열로 변환·캐시된다.

**export:**

| 이름               | 타입                                     | 설명                             |
| ------------------ | ---------------------------------------- | -------------------------------- |
| `applyRender(cmd, $UD)` | `(RenderCommand, UlanziApi) => void` | `setBaseDataIcon` 호출          |
| `applyRenderAll(cmds, $UD)` | `(RenderCommand[], UlanziApi) => void` | 커맨드 배열 순차 적용    |

**RenderCommand:**

```typescript
{ context: string, stateIndex: number, text?: string }
```

`context`가 없으면 아무 동작도 하지 않는다.

> claude-dj 이식 시: `resources/` 폴더에 stateIndex별 PNG를 추가하고
> `_IMAGES` 맵에 항목을 추가하면 신규 상태를 렌더링할 수 있다.

---

### `plugin/plugin-common-node/` — SDK Wrapper

UlanziDeckPlugin-SDK의 Node.js 공통 라이브러리. 수정 최소화 원칙.

| 파일             | 역할                                                   |
| ---------------- | ------------------------------------------------------ |
| `index.js`       | `UlanziApi`, `Utils`, `RandomPort` export              |
| `libs/ulanziApi.js` | UlanziStudio WS 연결, 이벤트 emit, SDK API 래퍼      |
| `libs/constants.js` | `Events` (이벤트 이름 상수), `SocketErrors`          |
| `libs/utils.js`  | 로깅, 언어 정규화, JSON 파싱 등 유틸                   |
| `libs/randomPort.js` | 랜덤 포트 생성 (멀티 플러그인 WS 통신용)            |

---

## Plugin Manifest (`manifest.json`)

UlanziStudio가 플러그인을 인식하는 메타데이터.

| 필드        | 값                               | 의미                                   |
| ----------- | -------------------------------- | -------------------------------------- |
| `UUID`      | `com.d200htest.bridge`           | 플러그인 고유 식별자 (4-segment = 주서비스) |
| `Type`      | `JavaScript`                     | Node.js 플러그인                       |
| `CodePath`  | `plugin/app.js`                  | UlanziStudio가 실행하는 진입점          |

**Action:**

| 필드        | 값                               |
| ----------- | -------------------------------- |
| `UUID`      | `com.d200htest.bridge.slot`      |
| States[0]   | IDLE (`resources/idle.png`)      |
| States[1]   | ACTIVE (`resources/active.png`)  |

`stateIndex`가 `manifest.json` States 배열 인덱스와 1:1 대응한다.
