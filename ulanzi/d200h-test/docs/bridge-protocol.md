# Bridge Protocol

Bridge 서버(`bridge/server.js`)와 클라이언트(Ulanzi 플러그인, 외부 앱) 사이의
WebSocket 메시지 명세.

## Connection

```
ws://localhost:39200/ws
```

CORS 제한: `localhost` 또는 `127.0.0.1` origin만 허용.

---

## Message Format

모든 메시지는 JSON 텍스트 프레임이다.

```json
{ "type": "<MESSAGE_TYPE>", ...fields }
```

---

## Server → Client

### `WELCOME`

클라이언트가 연결되면 즉시 전송된다.

```json
{ "type": "WELCOME", "version": "0.1.0" }
```

### `LAYOUT`

D200H 전체 또는 일부 키의 표시 상태를 지정한다.

```json
{ "type": "LAYOUT", "preset": "idle" }
{ "type": "LAYOUT", "preset": "active", "slot": 3 }
{ "type": "LAYOUT", "preset": "custom", "slots": { "0": 1, "5": 1, "11": 0 } }
```

| 필드     | 타입                         | 필수 | 설명                                          |
| -------- | ---------------------------- | ---- | --------------------------------------------- |
| `preset` | `'idle'\|'active'\|'custom'` | ✓    | 레이아웃 프리셋                               |
| `slot`   | `number`                     | —    | `active` preset에서 활성화할 단일 슬롯        |
| `slots`  | `{ [slot: string]: 0\|1 }`   | —    | `custom` preset에서 슬롯별 stateIndex 지정    |

**preset 동작:**

| preset   | 결과                                               |
| -------- | -------------------------------------------------- |
| `idle`   | 모든 슬롯 stateIndex=0 (IDLE 이미지)               |
| `active` | `slot` 슬롯만 1, 나머지 0. `slot` 미지정 시 전체 1 |
| `custom` | `slots` 맵대로 적용. 미포함 슬롯은 0으로 처리      |

**슬롯 번호 (D200H, GRID_COLS=5):**

```
┌────┬────┬────┬────┬────┐
│  0 │  1 │  2 │  3 │  4 │   Row 0
├────┼────┼────┼────┼────┤
│  5 │  6 │  7 │  8 │  9 │   Row 1
├────┼────┼────┼────┼────┤
│ 10 │ 11 │ 12 │    │    │   Row 2 (D200H 13키)
└────┴────┴────┴────┴────┘
```

### `ALL_DIM`

모든 키를 IDLE(dim) 상태로 설정한다. `LAYOUT(idle)`과 동일한 효과.

```json
{ "type": "ALL_DIM" }
```

---

## Client → Server

### `CLIENT_READY`

클라이언트가 연결 후 자신을 식별하기 위해 전송.

```json
{ "type": "CLIENT_READY", "clientType": "ulanzi-plugin", "version": "0.1.0" }
```

| `clientType` 값    | 설명                    |
| ------------------ | ----------------------- |
| `ulanzi-plugin`    | D200H 브릿지 플러그인   |
| *(임의 문자열)*    | 외부 앱, 디버거 등      |

### `BUTTON_PRESS`

D200H 버튼 눌림 이벤트. Ulanzi 플러그인이 `run` 이벤트 수신 시 전송.

```json
{ "type": "BUTTON_PRESS", "slot": 3, "timestamp": 1712345678000 }
```

| 필드        | 타입     | 필수 | 설명                         |
| ----------- | -------- | ---- | ---------------------------- |
| `slot`      | `number` | ✓    | 눌린 버튼 (0–12)              |
| `timestamp` | `number` | —    | `Date.now()` 기준 ms         |

유효하지 않은 `slot`(범위 초과, 비정수)은 서버에서 드롭된다.

### `SYNC_REQUEST`

현재 레이아웃 상태를 요청한다. 플러그인 재연결 후 자동 전송.

```json
{ "type": "SYNC_REQUEST" }
```

> 현재 서버는 이 메시지를 로그만 출력한다. 상태 저장 및 응답은 향후 구현.

---

## REST API

WebSocket 외에 HTTP로도 Bridge를 제어할 수 있다.

### `GET /api/health`

```json
{ "status": "ok", "version": "0.1.0", "port": 39200, "clients": 1 }
```

### `POST /api/layout`

LAYOUT 메시지를 모든 WS 클라이언트에 브로드캐스트.

**Request:**

```json
{ "preset": "custom", "slots": { "0": 1, "5": 1 } }
```

`preset` 필드는 필수. LAYOUT 메시지 포맷과 동일.

**Response:**

```json
{ "ok": true, "clients": 2 }
```

**예시 (PowerShell):**

```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:39200/api/layout `
  -ContentType "application/json" `
  -Body '{"preset":"custom","slots":{"0":1}}'
```

**예시 (curl):**

```bash
curl -s -X POST http://localhost:39200/api/layout \
  -H "Content-Type: application/json" \
  -d '{"preset":"active","slot":3}'
```

### `POST /api/button-press`

테스트용. 특정 슬롯의 BUTTON_PRESS를 수동으로 발생시킨다.

**Request:**

```json
{ "slot": 3 }
```

**Response:**

```json
{ "ok": true, "slot": 3 }
```

---

## Protocol vs UlanziStudio WS

Bridge 프로토콜과 UlanziStudio 내부 프로토콜은 별개다.

| 항목          | Bridge Protocol         | UlanziStudio Protocol           |
| ------------- | ----------------------- | ------------------------------- |
| 포트          | 39200                   | 3906                            |
| 용도          | 외부 앱 ↔ 플러그인      | UlanziStudio ↔ 플러그인         |
| key 포맷      | 슬롯 정수 (0-12)        | `"row_col"` (예: `"0_0"`)       |
| 이벤트 방향   | 양방향                  | UlanziStudio → 플러그인 주도     |
| 연결 주체     | 플러그인이 Bridge에 연결 | 플러그인이 UlanziStudio에 연결  |

---

## Error Handling

| 상황                        | 서버 동작                                 |
| --------------------------- | ----------------------------------------- |
| 잘못된 JSON                 | 무시, 오류 로그                           |
| 알 수 없는 `type`           | 무시, 로그                                |
| `BUTTON_PRESS` slot 범위 초과 | 드롭, 경고 로그                          |
| 클라이언트 50개 초과        | `1013 Too many connections`으로 거부       |
| 비 localhost origin         | WebSocket 연결 거부                       |
| REST body 없음              | 400 `body must be a JSON object`          |
| REST preset 없음            | 400 `preset is required`                  |
