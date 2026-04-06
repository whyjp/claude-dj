# Architecture

## System Overview

```mermaid
graph TB
    subgraph Hardware
        D200H["🎹 D200H\n(13~20 LCD Keys)"]
    end

    subgraph UlanziStudio["UlanziStudio (Port 3906)"]
        US["USB-HID ↔ WS 브릿지"]
    end

    subgraph Plugin["Ulanzi Plugin Process\n(npm start)"]
        APP["app.js\n(wiring)"]
        CORE["core/\n순수함수"]
        ADAPT["adapters/"]
    end

    subgraph Bridge["Bridge Server Process\n(npm run bridge · Port 39200)"]
        SRV["server.js\nExpress + WsServer"]
    end

    subgraph External["External App\n(claude-dj 등)"]
        EXT["WS Client\nor REST Client"]
    end

    D200H <-->|USB-HID| US
    US <-->|WS :3906| APP
    APP --> CORE
    APP --> ADAPT
    ADAPT <-->|WS :39200| SRV
    SRV <-->|WS / REST :39200| EXT
```

## Layer Design

플러그인 내부는 세 계층으로 분리된다. 각 계층은 단방향으로만 의존한다.

```mermaid
graph TB
    subgraph Wiring["wiring (app.js)"]
        W["이벤트 연결 · keyStates Map · 초기화"]
    end

    subgraph Adapters["adapters/ (I/O)"]
        BWA["bridgeWsAdapter.js\nBridge WS 연결/재연결"]
        UOA["ulanziOutputAdapter.js\nsetBaseDataIcon → LCD"]
    end

    subgraph Core["core/ (순수 함수, 외부 의존 없음)"]
        EP["eventParser.js\nWS msg → InputEvent DTO"]
        SM["stateMachine.js\nIDLE ↔ ACTIVE 전이"]
        LM["layoutMapper.js\nLAYOUT → SlotCommand[]"]
    end

    W --> Adapters
    W --> Core
    Adapters --> Core

    style Core fill:#e8f5e9
    style Adapters fill:#e3f2fd
    style Wiring fill:#fff3e0
```

**핵심 원칙:** `core/`는 순수 함수만 포함. `import`가 없어도 테스트 가능.

## Class Diagram

```mermaid
classDiagram
    class WsServer {
        +Set clients
        +onButtonPress: Function
        +onClientReady: Function
        +clientCount: number
        +attach(server, path)
        +broadcast(msg)
        +terminateAll()
        -_handleMessage(ws, msg)
    }

    class BridgeWsAdapter {
        +url: string
        +isConnected: boolean
        +onLayout(fn)
        +sendButtonPress(slot)
        +destroy()
        -_connect()
        -_scheduleReconnect()
        -_handleMessage(msg)
    }

    class UlanziApi {
        +uuid: string
        +key: string
        +actionid: string
        +connect(uuid)
        +setBaseDataIcon(context, data, text)
        +setStateIcon(context, state, text)
        +onKeyDown(fn)
        +onKeyUp(fn)
        +onRun(fn)
        +onAdd(fn)
        +onClear(fn)
    }

    class eventParser {
        <<pure functions>>
        +GRID_COLS: 5
        +parseInputEvent(msg) InputEvent
        +parseSlot(key) number
    }

    class stateMachine {
        <<pure functions>>
        +States: IDLE ACTIVE
        +transition(state, event) string
        +getStateIndex(state) number
        +isValidState(state) boolean
    }

    class layoutMapper {
        <<pure functions>>
        +DEVICE_COLS: 5
        +TOTAL_SLOTS: 25
        +mapLayout(layout) SlotCommand[]
    }

    class ulanziOutputAdapter {
        <<functions>>
        +applyRender(cmd, $UD)
        +applyRenderAll(cmds, $UD)
    }

    BridgeWsAdapter --> WsServer : WS connect
    UlanziApi --> eventParser : msg 파싱
    ulanziOutputAdapter --> UlanziApi : setBaseDataIcon
    layoutMapper ..> stateMachine : stateIndex 참조
```

## Sequence Diagrams

### 버튼 누름 — D200H → Bridge

```mermaid
sequenceDiagram
    participant HW as D200H
    participant US as UlanziStudio
    participant PL as Plugin (app.js)
    participant BR as Bridge Server
    participant EX as External App

    HW->>US: 물리 클릭 (USB-HID)
    US->>PL: keydown {key:"4_0", uuid:...}
    US->>PL: run {key:"4_0", uuid:...}
    US->>PL: keyup {key:"4_0", uuid:...}

    PL->>PL: parseInputEvent() → {slot:20, event:"run"}
    PL->>PL: transition(IDLE, "run") → ACTIVE
    PL->>PL: applyRender({stateIndex:1})
    PL->>US: setBaseDataIcon(🟢 PNG)
    US->>HW: LCD 업데이트

    PL->>BR: BUTTON_PRESS {slot:20}
    BR->>EX: onButtonPress(20)
```

### 레이아웃 변경 — External App → D200H

```mermaid
sequenceDiagram
    participant EX as External App
    participant BR as Bridge Server
    participant PL as Plugin (app.js)
    participant US as UlanziStudio
    participant HW as D200H

    EX->>BR: POST /api/layout {preset:"active", slot:20}
    BR->>PL: WS LAYOUT {preset:"active", slot:20}
    PL->>PL: mapLayout() → SlotCommand[25]
    PL->>PL: cmdBySlot.get(20) → {stateIndex:1}
    PL->>PL: applyRender({stateIndex:1})
    PL->>US: setBaseDataIcon(🟢 PNG)
    US->>HW: LCD 업데이트
    BR->>EX: {ok:true, clients:1}
```

### 재연결 (Stage D)

```mermaid
sequenceDiagram
    participant PL as Plugin (BridgeWsAdapter)
    participant BR as Bridge Server

    PL->>BR: WS connect
    BR->>PL: WELCOME {version:"0.1.0"}
    PL->>BR: CLIENT_READY
    PL->>BR: SYNC_REQUEST

    note over BR: Bridge 프로세스 종료

    BR-->>PL: close (code=1006)
    PL->>PL: _scheduleReconnect() delay=1000ms
    note over PL: 백오프: 1s→2s→4s→8s→16s

    note over BR: Bridge 재시작

    PL->>BR: WS connect (attempt 2)
    BR->>PL: WELCOME
    PL->>BR: CLIENT_READY + SYNC_REQUEST
    BR->>PL: LAYOUT (현재 상태)
    PL->>PL: mapLayout() → applyRender()
```

## D200H Physical Key Layout

UlanziStudio가 전달하는 key 포맷: **`"physical_col_physical_row"`**

```
      col0  col1  col2  col3  col4
       ┌────┬────┬────┬────┬────┐
 row0  │  0 │  5 │ 10 │ 15 │ 20 │  ← 우측 최상단 = slot 20
       ├────┼────┼────┼────┼────┤
 row1  │  1 │  6 │ 11 │ 16 │ 21 │
       ├────┼────┼────┼────┼────┤
 row2  │  2 │  7 │ 12 │ 17 │ 22 │
       ├────┼────┼────┼────┼────┤
 row3  │  3 │  8 │ 13 │ 18 │ 23 │
       └────┴────┴────┴────┴────┘

slot = physical_col × DEVICE_COLS(5) + physical_row
```

| key 문자열 | physical_col | physical_row | slot |
| ---------- | ------------ | ------------ | ---- |
| `"0_0"`    | 0            | 0            | 0    |
| `"2_1"`    | 2            | 1            | 11   |
| `"4_0"`    | 4            | 0            | 20   |
| `"4_3"`    | 4            | 3            | 23   |

> **주의:** UlanziDeckSimulator는 `"0"`, `"1"` 단순 정수를 사용한다.
> 실제 UlanziStudio는 `"col_row"` 포맷을 사용한다. → `TROUBLESHOOTING.md` TBL-001

## Data Flow

```mermaid
flowchart LR
    RAW["UlanziStudio\nWS 메시지\n{cmd,key,uuid,...}"]
    EP["parseInputEvent()\n→ InputEvent\n{slot,event,context}"]
    SM["transition()\n→ nextState\nIDLE|ACTIVE"]
    SI["getStateIndex()\n→ 0|1"]
    AR["applyRender()\n{context,stateIndex}"]
    BD["setBaseDataIcon()\n(🟢 or ⚫ PNG)"]
    LCD["D200H LCD"]
    BP["sendButtonPress(slot)\n→ Bridge WS"]

    RAW --> EP --> SM --> SI --> AR --> BD --> LCD
    EP -->|slot| BP
```
