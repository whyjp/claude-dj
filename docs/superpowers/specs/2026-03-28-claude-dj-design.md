# Claude DJ — Design Spec

> **Version:** 1.0.0
> **Date:** 2026-03-28
> **Status:** Approved

---

## 1. Overview

Claude DJ는 Claude Code의 Hook API를 통해 permission/plan 요청을 Ulanzi D200 물리 버튼 또는 브라우저 기반 Virtual DJ로 조작하는 도구다.

**핵심 가치:** 터미널 포커스 이동 없이 Claude Code에 즉시 반응한다.

**브랜딩:** claude-dj (구 ReactDeck에서 변경)

### Design Decisions

| 결정 | 선택 | 이유 |
|------|------|------|
| Virtual D200 FE 역할 | First-class 클라이언트 | 장비 없는 사용자도 완전 사용 가능 |
| Phase 재구성 | Virtual-first | Phase 1에서 BINARY+CHOICE 모두, 장비 연동은 Phase 3 |
| 프로젝트 구조 | 모노레포 | bridge, hooks, FE, plugin 모두 한 repo |
| 배포 방식 | 오픈소스, plugin install → skill+hook 자동 등록 | 현대 플러그인 패턴 |
| Bridge 생명주기 | 수동 시작 데몬 | 서비스로 미리 띄워두는 것이 자연스럽고 모니터링 가능 |
| 구현 접근법 | Bridge-Centric | 단일 프로세스에서 HTTP API + WS + FE serve |
| SDK 준비 | Phase 1에서 vendor + 스켈레톤 | 프로토콜 확정 후 Phase 3에서 연동만 하면 됨 |

---

## 2. Architecture

### System Diagram

```
Claude Code Session(s)
    │
    │  Hook Events (stdin JSON → stdout JSON)
    │
    ├── PermissionRequest ── node hooks/permission.js ──► HTTP POST
    │   (Bash/Edit/Write)      reads stdin, POSTs,       :39200/api/hook/permission
    │                          writes response to stdout  [BLOCKING — waits for button]
    │
    ├── PermissionRequest ── node hooks/permission.js ──► HTTP POST
    │   (AskUserQuestion)      same script, same endpoint :39200/api/hook/permission
    │                          Bridge detects tool_name   [BLOCKING — waits for button]
    │
    ├── PreToolUse ────────── node hooks/notify.js ────► HTTP POST
    │                          fire-and-forget            :39200/api/hook/notify
    │                                                     [ASYNC]
    │
    └── Stop ─────────────── node hooks/stop.js ──────► HTTP POST
                               fire-and-forget            :39200/api/hook/stop
                                                          [ASYNC]

                    ┌─────────────────────────────────┐
                    │     Claude DJ Bridge  :39200     │
                    │                                 │
                    │  ┌──────────────────────────┐   │
                    │  │ Session Manager          │   │
                    │  │  sessions Map             │   │
                    │  │  state machine per session │   │
                    │  └──────────────────────────┘   │
                    │                                 │
                    │  ┌──────────────────────────┐   │
                    │  │ Button Manager           │   │
                    │  │  state → layout mapping   │   │
                    │  │  slot assignment           │   │
                    │  └──────────────────────────┘   │
                    │                                 │
                    │  HTTP API  │  WebSocket  │ Static│
                    └──────┬──────────┬──────────┬────┘
                           │          │          │
                    /api/hook/*    /ws       public/
                                    │          │
                         ┌──────────┤     index.html
                         │          │     app.js
                    Browser       Ulanzi D200
                  (Virtual DJ)   (Phase 3)
```

### Core Principle

WS 프로토콜은 하나 — Virtual DJ(브라우저)든 물리 D200(Ulanzi Plugin)이든 동일한 `/ws` 엔드포인트, 동일한 메시지 포맷. 클라이언트 종류를 Bridge가 구분할 필요 없음.

### Components

| Component | Role | Tech |
|-----------|------|------|
| Bridge Server | HTTP API + WS + Static serve | Node.js, express, ws |
| Session Manager | 세션 상태 머신, Map 관리 | bridge/sessionManager.js |
| Button Manager | state → 버튼 레이아웃 매핑 | bridge/buttonManager.js |
| WS Server | 양방향 클라이언트 통신 | bridge/wsServer.js |
| Hook Scripts | Claude Code → Bridge HTTP forwarder | hooks/*.js (3 files) |
| Virtual DJ FE | D200 시뮬레이터 + 운영 대시보드 | Vanilla JS SPA |
| Ulanzi Plugin | 물리 D200 연동 (Phase 3) | Ulanzi common-node SDK |
| CLI | `claude-dj start` 진입점 | cli/index.js |
| Setup | Hook 자동 등록 | tools/setup.js |

---

## 3. Project Structure

```
claude-dj/
├── package.json              # name: "claude-dj", bin: "claude-dj"
├── README.md
├── .gitignore
│
├── bridge/                    # Bridge Server
│   ├── server.js              # Express + WS + static serve 진입점
│   ├── sessionManager.js      # 세션 상태 머신, Map 관리
│   ├── buttonManager.js       # state → 버튼 레이아웃 매핑
│   ├── wsServer.js            # WebSocket 서버, 클라이언트 관리
│   └── config.js              # 포트, 타임아웃 등 설정
│
├── hooks/                     # Claude Code Hook Scripts
│   ├── permission.js          # PermissionRequest → HTTP POST (blocking)
│   ├── notify.js              # PreToolUse → HTTP POST (async)
│   └── stop.js                # Stop → HTTP POST (async)
│
├── public/                    # Virtual DJ FE (Bridge가 static serve)
│   ├── index.html             # SPA 진입점
│   ├── css/
│   │   └── style.css          # 다크 테마 스타일
│   ├── js/
│   │   ├── app.js             # 메인 앱 로직
│   │   ├── ws-client.js       # WebSocket 클라이언트
│   │   ├── d200-renderer.js   # D200 버튼 그리드 렌더링
│   │   └── dashboard.js       # 세션/이벤트/상태 대시보드
│   └── assets/
│       └── images/            # 버튼 아이콘 PNG, GIF
│
├── plugin/                    # Ulanzi Plugin (Phase 3, 스켈레톤)
│   ├── app.js                 # Plugin 진입점 (스켈레톤)
│   ├── manifest.json          # Ulanzi 플러그인 매니페스트
│   └── libs/
│       └── common-node/       # Ulanzi SDK (vendor)
│
├── cli/                       # CLI 진입점
│   └── index.js               # "claude-dj start" → bridge/server.js 기동
│
├── tools/                     # 설치/설정 스크립트
│   └── setup.js               # Hook 자동 등록 (settings.json)
│
└── docs/
    └── pre-researched/        # 기존 PRD, 랜딩, Virtual D200 HTML
```

### Dependencies (Phase 1)

- `express` — HTTP 서버
- `ws` — WebSocket 서버
- FE: 0 build dependencies (vanilla JS)

### Execution

```bash
npx claude-dj              # 글로벌 설치 없이 Bridge 실행
npx claude-dj setup        # Hook 자동 등록 (settings.json)
npm i -g claude-dj && claude-dj  # 글로벌 설치
```

---

## 4. State Machine

### Session States

```
IDLE            → 대기. 버튼 전체 dim.
PROCESSING      → PreToolUse 감지. 웨이브 애니메이션.
WAITING_BINARY  → PermissionRequest (일반 tool). ✅❌ 활성.
WAITING_CHOICE  → PermissionRequest (AskUserQuestion). 번호 버튼 활성.
```

### State Transitions (Hook events only)

```
                ┌─────────────────────────────────────────┐
                │                                         │
                ▼                                         │
          ┌──────────┐    PreToolUse     ┌────────────┐   │
          │   IDLE   │ ───────────────► │ PROCESSING │   │
          └──────────┘                   └─────┬──────┘   │
                ▲                              │          │
                │                    PermissionRequest     │
                │                              │          │
                │              ┌───────────────┴────────┐ │
                │              ▼                        ▼ │
                │    ┌─────────────────┐  ┌──────────────────┐
                │    │ WAITING_BINARY  │  │ WAITING_CHOICE   │
                │    │ tool≠AskUser   │  │ tool=AskUser     │
                │    └────────┬────────┘  └────────┬─────────┘
                │             │ button press        │ button press
      Stop      │             └────────┬────────────┘
      ──────────┘                      ▼
                              Hook 응답 반환 → PROCESSING
```

### Button Layout per State

**IDLE:** 슬롯 0~9, 12 → dim. 눌림 무반응.

**PROCESSING:** 슬롯 0~9, 12 → 웨이브 애니메이션.

**WAITING_BINARY:**
- 슬롯 0 → Approve (✅)
- 슬롯 1 → Deny (❌)
- 슬롯 5 → Always Allow (🔒) — `permission_suggestions` 있을 때만
- 나머지 → dim

**WAITING_CHOICE (예: 3 choices):**
- 슬롯 0 → 1번 + label
- 슬롯 1 → 2번 + label
- 슬롯 2 → 3번 + label
- 나머지 → dim
- 최대 11개 선택지 (슬롯 0~9 + 12)

### Slot Map

```
┌────┬────┬────┬────┬────┐
│  0 │  1 │  2 │  3 │  4 │
├────┼────┼────┼────┼────┤
│  5 │  6 │  7 │  8 │  9 │
├────┼────┼────┼──────────┤
│ 10 │ 11 │ 12 │ (시스템) │
└────┴────┴────┴──────────┘

동적 슬롯: 0~9, 12 (최대 11개 선택지)
고정 슬롯: 10 (SESSION_COUNT), 11 (SESSION_NAME/SWITCH)
시스템 키: 더블 사이즈 키 (제어 불가, 시간/CPU/RAM 표시)
```

> **Note:** D200의 더블 사이즈 키(Info Display 위치)는 Plugin API로 제어 불가 (시스템 전용).
> 세션 카운트는 슬롯 10, 세션명/전환은 슬롯 11. Virtual DJ FE에서는 Info Display 위치에 Session Info Display를 비대화형 패널로 표시하며, 별도 WS 메시지 없이 수동으로 업데이트된다.

---

## 5. Data Flow

### WAITING_BINARY Flow

```
Claude Code         Hook Script         Bridge              FE (WS)
    │                   │                  │                   │
    ├─PermissionReq────►│                  │                   │
    │  {tool:"Bash"}    ├──POST───────────►│                   │
    │                   │  /api/hook/perm  ├──WS LAYOUT───────►│  ✅❌ 표시
    │                   │                  │  preset:"binary"  │
    │                   │    HTTP 응답 대기 (long-poll, 30s)    │
    │                   │                  │◄──WS BUTTON_PRESS─│  ✅ 누름
    │                   │◄─HTTP 200────────│  slot:0           │
    │◄──stdout JSON─────│  behavior:allow  ├──WS LAYOUT───────►│  웨이브
    │  decision:allow   │                  │  preset:processing│
```

### WAITING_CHOICE Flow

```
Claude Code         Hook Script         Bridge              FE (WS)
    │                   │                  │                   │
    ├─PermissionReq────►│                  │                   │
    │  {tool:"AskUser", ├──POST───────────►│                   │
    │   options:[1,2,3]} │                  ├──WS LAYOUT───────►│  1️⃣2️⃣3️⃣ 표시
    │                   │                  │  preset:"choice"  │
    │                   │    HTTP 응답 대기 (long-poll, 30s)    │
    │                   │                  │◄──WS BUTTON_PRESS─│  2️⃣ 누름
    │                   │◄─HTTP 200────────│  slot:1           │
    │◄──stdout JSON─────│  answer:"2"      ├──WS LAYOUT───────►│  웨이브
```

### Timeout & Error Handling

| Scenario | Behavior |
|----------|----------|
| 30s 버튼 무응답 | auto deny + IDLE 전환 |
| Bridge 다운 | Hook fetch 실패 → exit 0 (빈 응답 = 원래 다이얼로그 표시) |
| WS 끊김 | FE 자동 재연결 (3s 간격) |
| stop_hook_active: true | 즉시 exit 0 (무한루프 방지) |

### Hook timeout config

- settings.json hook timeout: `120s`
- Bridge 버튼 대기: `30s`
- HTTP long-poll AbortSignal: `110s`

---

## 6. WS Protocol

### Bridge → Client

**LAYOUT** — 전체 레이아웃 교체
```json
{
  "type": "LAYOUT",
  "preset": "idle" | "processing" | "binary" | "choice",
  "session": { "id": "abc123", "name": "api-server", "state": "WAITING_BINARY" },
  "prompt": { "toolName": "Bash", "command": "rm -rf dist", "hasAlwaysAllow": false },
  "choices": [{ "index": 1, "label": "Refactor module" }]
}
```

**WELCOME** — 연결 시 현재 상태 sync
```json
{
  "type": "WELCOME",
  "version": "0.1.0",
  "sessions": [{ "id": "abc123", "name": "api-server", "state": "IDLE" }]
}
```

**SESSION_COUNT** (Phase 2)
```json
{ "type": "SESSION_COUNT", "total": 3, "waiting": 1 }
```

**ALL_DIM**
```json
{ "type": "ALL_DIM" }
```

### Client → Bridge

**BUTTON_PRESS**
```json
{ "type": "BUTTON_PRESS", "slot": 0, "timestamp": 1743000000 }
```

Slot 의미 (Bridge가 현재 state 기반으로 해석):
- BINARY: slot 0 = approve, slot 1 = deny, slot 5 = always allow
- CHOICE: slot 0~9 + 12 = choice 1~11 (max 11)

> **Note:** Session info is displayed passively in the FE info panel, no dedicated WS message needed.

**CLIENT_READY**
```json
{ "type": "CLIENT_READY", "clientType": "virtual", "version": "0.1.0" }
```

---

## 7. HTTP API

### Hook Endpoints

| Endpoint | Method | Blocking | Body | Response |
|----------|--------|----------|------|----------|
| `/api/hook/permission` | POST | Yes (30s) | Claude Code stdin JSON | hookSpecificOutput JSON |
| `/api/hook/notify` | POST | No | PreToolUse stdin JSON | `{ ok: true }` |
| `/api/hook/stop` | POST | No | Stop stdin JSON | `{ ok: true }` |

### Dashboard Endpoints

**GET /api/status**
```json
{
  "version": "0.1.0",
  "uptime": 3600,
  "sessions": [{ "id": "abc123", "name": "api-server", "state": "WAITING_BINARY", "waitingSince": 1743000000 }],
  "clients": { "virtual": 1, "plugin": 0 }
}
```

**GET /api/health**
```json
{ "status": "ok", "version": "0.1.0", "port": 39200, "uptime": 3600 }
```

---

## 8. Virtual DJ FE

### Layout

- **좌측:** D200 시뮬레이터 — 5+5+4 그리드 (슬롯 0~12), 버튼 클릭으로 조작. 시스템 키 영역은 Session Info Display로 활용 (비대화형)
- **우측:** 대시보드 탭
  - **Event Log** — WS 메시지 실시간 로그, 방향(in/out) 표시, 필터
  - **Sessions** — 연결된 세션 목록, 상태, 포커스 전환 (Phase 2)
  - **Protocol** — WS 프로토콜 레퍼런스 (개발자용)
  - **Settings** — Bridge URL, 타임아웃 설정

### Design System

- 다크 테마 (기존 PRD Virtual D200 HTML 기반)
- JetBrains Mono 폰트
- 컬러: green(#3aff6c), red(#ff3352), amber(#ffcc00), blue(#4099ff)
- 애니메이션: glow pulse, wave, flash 피드백
- State info bar: 현재 상태/세션/도구/WS 연결 표시

### Tech

- Vanilla JS SPA (빌드 도구 없음)
- Bridge가 `public/` 디렉토리를 static serve
- WS 자동 재연결 (3s 간격)

---

## 9. Phase Plan

### Phase 1 — MVP (Virtual-first)

- Bridge 전체 구현 (HTTP API + WS + Static serve)
- Hook scripts 3개
- Virtual DJ FE (D200 시뮬레이터 + 대시보드)
- CLI (`claude-dj start`)
- Setup (`claude-dj setup` — hook 자동 등록)
- BINARY + CHOICE 전체 루프
- 단일 세션
- Ulanzi SDK vendor + Plugin 스켈레톤

### Phase 2 — Multi-session

- Session Manager 확장
- SESSION_COUNT 슬롯 (슬롯 10)
- SESSION_NAME/SWITCH 슬롯 (슬롯 11 — 클릭으로 세션 로테이션)
- 자동 포커스 전환 로직 개선
- 자동 포커스 전환 로직
- FE Sessions 탭 활성화

### Phase 3 — Physical D200

- plugin/app.js 구현 — Bridge WS ↔ Ulanzi WS 프로토콜 변환기
- Ulanzi SDK 연동 (common-node)
- SDK Simulator + Virtual DJ 동시 동작 검증
- 이미지 에셋 제작 (PNG ~36장 + GIF 3개)
- UlanziStudio 배포

### Phase 4 — Stabilization

- stop_hook_active 무한루프 방지
- subagent permission 모니터링 (claude-code#23983)
- Bridge 다운 시 graceful fallback
- 자동 테스트 시나리오

---

## 10. Tech Stack

| Layer | Tech |
|-------|------|
| Bridge Server | Node.js 20+, express, ws |
| Hook Scripts | Node.js 20+ (stdin/stdout → HTTP POST) |
| Virtual DJ FE | Vanilla JS, CSS (no build) |
| Ulanzi Plugin | Node.js 20+ + common-node SDK (Phase 3) |
| CLI | Node.js, bin entry in package.json |

---

## 11. References

| Item | Source |
|------|--------|
| 기존 PRD | docs/pre-researched/ReactDeck_PRD.md |
| Virtual D200 HTML | docs/pre-researched/ReactDeck_VirtualD200.html |
| 랜딩 페이지 HTML | docs/pre-researched/ReactDeck_Landing.html |
| Claude Code Hooks | https://code.claude.com/docs/en/hooks |
| Ulanzi Plugin SDK | https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK |
| Ulanzi SDK (local) | ulanzi/sdk/ (common-node, UlanziDeckSimulator, demo) |
| Ulanzi SDK Simulator | ulanzi/sdk/UlanziDeckSimulator/ (port 39069) |
| UlanziStudio (installed) | C:/Program Files (x86)/Ulanzi Studio/ |
| subagent permission bug | https://github.com/anthropics/claude-code/issues/23983 |

---

## 12. Ulanzi SDK Integration Notes

### BIG WIN 키 제약

D200의 더블 사이즈 키(Info Display)는 시스템 전용(시간/CPU/RAM 표시)으로 Plugin API 제어 불가.
세션 카운트와 세션명은 슬롯 10~11을 활용한다. 슬롯 10 = SESSION_COUNT (비대화형), 슬롯 11 = SESSION_NAME/SWITCH (Phase 2에서 세션 로테이션 클릭 가능). Virtual DJ FE에서는 Info Display 위치에 Session Info Display를 비대화형 패널로 표시하며, 별도 WS 메시지 없이 수동으로 업데이트된다.

### Plugin 역할 (Phase 3)

Plugin은 Bridge WS ↔ Ulanzi WS 프로토콜 변환기:
- Bridge `LAYOUT` → Ulanzi `setPathIcon`/`setGifPathIcon` per key
- Ulanzi `onRun` (key press) → Bridge `BUTTON_PRESS`

### 테스트 시나리오

| 시나리오 | 경로 | Phase |
|----------|------|-------|
| A | Claude Code → Bridge → Virtual DJ (브라우저) | Phase 1 |
| B | Claude Code → Bridge → Plugin → SDK Simulator | Phase 3 |
| C | Claude Code → Bridge → Plugin → UlanziStudio → D200 | Phase 3 |
| D | A + B 동시 (양쪽 모두 동작 확인) | Phase 3 |

### Ulanzi SDK 구조 (vendor)

```
ulanzi/sdk/common-node/
├── index.js           # exports: UlanziApi (default), Utils, RandomPort
├── package.json       # deps: ws ^8.18.0
├── apiTypes.d.ts      # TypeScript 타입
└── libs/
    ├── ulanziApi.js   # UlanziApi class (extends EventEmitter)
    ├── constants.js   # Event name constants
    ├── utils.js       # Utility helpers
    └── randomPort.js  # Port generation
```

### Ulanzi WS Protocol (Plugin ↔ UlanziStudio)

Plugin → Host: `{ cmd: "state", uuid, key, actionid, param: { statelist: [...] } }`
Host → Plugin: `{ cmd: "run"|"add"|"clear"|"keydown"|"keyup", uuid, key, actionid, param }`
Context: `uuid___key___actionid` (3 parts joined by `___`)
