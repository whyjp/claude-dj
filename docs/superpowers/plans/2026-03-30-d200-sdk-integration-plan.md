# D200 SDK Integration Plan

> Phase 3 — 계획 수립일: 2026-03-30
> **Status: DEFERRED** — D200 실물 디바이스 확보 후 착수. 시뮬레이터만으로는 핵심 검증 불가.

## Overview

D200 물리 디바이스를 claude-dj Bridge에 연동하는 계획.
Virtual DJ와 동일한 WS 프로토콜을 사용하되, UlanziStudio SDK를 통해 물리 버튼/아이콘을 제어한다.

## Deferral Rationale

시뮬레이터(UlanziDeckSimulator)로 검증 가능한 범위가 제한적:
- **가능**: $UD SDK WS 연결, onRun/onAdd 이벤트 흐름 (하지만 이건 Virtual DJ에서 이미 동일 프로토콜로 검증 완료)
- **불가능**: D200 LCD에서 유니코드 텍스트 렌더링 품질, context→slot 물리 매핑, 13키 프로필 자동 배치, 실제 UlanziStudio 환경 안정성

시뮬레이터 작업의 추가 가치가 낮고, 핵심 불확실성은 실물에서만 해소 가능.
→ **D200 실물 확보 시점에 feature/d200-plugin 브랜치에서 착수.**

## Architecture

### 현재 (Virtual DJ)

```
Claude Code ─hook→ hooks/*.js ─HTTP→ Bridge(:39200) ─WS broadcast→ Virtual DJ (Browser)
```

### D200 연동 후

```
Claude Code ─hook→ hooks/*.js ─HTTP→ Bridge(:39200) ─WS broadcast─┬→ Virtual DJ (Browser)
                                                                    └→ plugin/app.js ─$UD WS→ UlanziStudio ─USB→ D200
```

**Bridge 변경 없음** — Bridge는 이미 모든 WS 클라이언트에 broadcast.
plugin/app.js가 Virtual DJ와 동일하게 WS 클라이언트로 접속.

### plugin/app.js 이중 WS 구조

```
┌──────────────────────────────────────────────────┐
│                  plugin/app.js                    │
│                                                   │
│  WS #1: Bridge (ws://localhost:39200/ws)          │
│    ← LAYOUT 수신                                  │
│    → BUTTON_PRESS 전송                            │
│                                                   │
│  WS #2: UlanziStudio ($UD SDK, auto-connect)      │
│    → setBaseDataIcon / setPathIcon (아이콘 렌더)    │
│    ← onRun (물리 버튼 press 수신)                  │
│                                                   │
│  Translation Layer:                               │
│    Bridge LAYOUT → Unicode text icon → $UD.set*() │
│    $UD.onRun()  → slot number → Bridge BUTTON_PRESS│
└──────────────────────────────────────────────────┘
```

## 통신 계층 비교

| 구간 | Virtual DJ | D200 Plugin |
|------|-----------|-------------|
| Hook → Bridge | HTTP POST (동일) | HTTP POST (동일) |
| Bridge → Client | WS `LAYOUT` | WS `LAYOUT` (동일) |
| Client → Bridge | WS `BUTTON_PRESS` | WS `BUTTON_PRESS` (동일) |
| 렌더링 | DOM + CSS | `$UD.setBaseDataIcon(context, base64, text)` |
| 입력 | DOM click / keyboard | `$UD.onRun(jsn)` |
| 시작 방식 | Bridge 시작 시 자동 serve | UlanziStudio가 플러그인 spawn |

## Icon Strategy: Unicode Text

이미지 에셋 제작 대신 **유니코드 텍스트 아이콘**을 사용한다.
`$UD.setBaseDataIcon(context, base64, text)` 의 `text` 파라미터 또는
canvas로 텍스트를 base64 PNG로 렌더링하여 전송.

### Preset별 Unicode 매핑 (예시)

| Preset | Slot 0 | Slot 1 | Slot 2 | Slot 3-9 |
|--------|--------|--------|--------|----------|
| idle | 💤 dim | — | — | — |
| processing | ⏳ | — | — | — |
| binary | ✅ Allow | 🔒 Always | ❌ Deny | — |
| choice | 1️⃣ label | 2️⃣ label | 3️⃣ label | N️⃣ label |
| multiSelect | ☐/☑ toggle | ☐/☑ | ☐/☑ | slot9: ✔ Submit |

### System Slots (10-12)

| Slot | 용도 | 표시 |
|------|------|------|
| 10 | Session count | 🔢 N |
| 11 | Session cycle | 📂 name |
| 12 | Agent cycle | 🤖 type |

## Branch Strategy

### 원칙

1. **main 브랜치** — Bridge/Hook/Skill 수정이 필요한 경우 여기서 먼저 작업
2. **feature/d200-plugin 브랜치** — plugin/app.js 구현, main에서 분기
3. main 수정 완료 후 feature 브랜치에 merge하여 진행

### 이유

D200 플러그인은 Bridge WS 클라이언트로서 기존 프로토콜을 그대로 사용.
만약 연동 과정에서 Bridge/Hook에 프로토콜 변경이 필요하면:
- main에서 수정 + 테스트 (Virtual DJ 호환 유지)
- feature/d200-plugin에 merge
- plugin 구현 계속

이렇게 하면 main의 Virtual DJ는 항상 안정 상태를 유지.

## Implementation Steps

### Step 0: main에서 선행 작업 (필요 시)

Bridge/Hook 프로토콜에 D200 연동을 위해 수정이 필요한 항목 확인:

- [ ] WS LAYOUT 메시지에 slot별 icon hint 추가 여부 검토
- [ ] `CLIENT_READY` 에 `clientType: "ulanzi"` 구분 필요 여부
- [ ] button context → slot 매핑 방식 확정 (UlanziStudio 시뮬레이터로 테스트)

### Step 1: feature/d200-plugin 브랜치 생성

```bash
git checkout -b feature/d200-plugin main
```

### Step 2: Bridge WS Client 구현

plugin/app.js에 Bridge WS 클라이언트 추가:
- `ws://localhost:${CLAUDE_DJ_PORT}/ws` 접속
- `CLIENT_READY { clientType: "ulanzi", version: "0.1.0" }` 전송
- `LAYOUT` 메시지 수신 → Step 3의 변환 레이어로 전달
- 재연결 로직 (Bridge가 나중에 뜨는 경우 대비)

### Step 3: LAYOUT → $UD Icon 변환

- preset별 Unicode 텍스트 매핑 테이블
- `$UD.setBaseDataIcon(context, base64, text)` 호출
  - 또는 Node.js canvas로 텍스트→PNG base64 생성
  - 또는 `text` 파라미터만으로 충분한지 $UD SDK 동작 확인 필요

### Step 4: Key Press → BUTTON_PRESS 변환

- `$UD.onRun(jsn)` → `jsn.context` 에서 slot 번호 추출
- D200 2.5행 × 5열 = 13키 → slot 0~12
- Bridge WS로 `{ type: "BUTTON_PRESS", slot: N, timestamp: Date.now() }` 전송

### Step 5: Action/Profile 구성

- manifest.json의 단일 Action을 13키에 각각 배치
- UlanziStudio 프로필 프리셋 파일 포함 여부 결정
- context → slot 매핑 테이블 관리

### Step 6: 통합 테스트

- Bridge + plugin/app.js + UlanziStudio 시뮬레이터로 E2E 검증
- Virtual DJ와 D200 동시 연결 테스트
- 리얼 D200 디바이스 연결 테스트 (별도 작업)

## Open Questions

1. **$UD text rendering** — `setBaseDataIcon`의 text 파라미터만으로 유니코드 아이콘이 잘 표시되는지, 아니면 canvas→base64가 필요한지
2. **context → slot 매핑** — UlanziStudio가 각 키에 Action을 할당할 때 context 값의 패턴 확인 필요 (시뮬레이터로 테스트)
3. **프로필 배포** — 13키 프로필을 플러그인에 포함하여 자동 적용할 수 있는지
4. **재연결 순서** — UlanziStudio → plugin spawn → Bridge 아직 안 떴을 때의 graceful retry

## Risk Assessment

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Bridge 프로토콜 변경 필요 | 중 | main에서 먼저 수정, Virtual DJ 호환 테스트 후 merge |
| $UD text 렌더링 품질 | 낮 | canvas fallback으로 base64 PNG 생성 |
| context→slot 매핑 불확실 | 중 | 시뮬레이터에서 사전 테스트 |
| 동시 연결 충돌 | 낮 | Bridge는 이미 multi-client broadcast 지원 |
