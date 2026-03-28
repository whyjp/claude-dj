# Claude DJ — PRD

> **원제:** ReactDeck PRD (v1.1.0, 2026-03-28) — Claude DJ로 리브랜딩 반영한 업데이트본
> **버전:** 1.2.0
> **작성일:** 2026-03-29
> **작성자:** 영주 (개인 개발 참고용)
> **Hooks API 기준:** Claude Code v2.1.85

---

## 1. 제품 정의

### 한 줄 요약
> Claude Code가 permission/plan 응답을 요구할 때, **터미널 창으로 포커스를 이동하지 않고** Ulanzi D200의 물리 버튼으로 즉시 반응한다.

### 핵심 원칙
- **버튼은 입력 수단이지 정보 표시 수단이 아니다.** 내용은 터미널 화면으로 이미 보고 있다.
- **멀티 모니터 / 멀티 터미널** 환경에서 복수의 Claude Code 세션이 동시에 보이는 상황이 기본 전제.
- 포커스 이동 비용을 없애는 것이 목적.

### 기능 우선순위

```
[MAIN]  Claude Code 리액션 → 물리 버튼 동적 전환
        ├─ PROCESSING      : PreToolUse hook → 버튼 애니메이션
        ├─ WAITING_BINARY  : PermissionRequest hook (일반 tool) → ✅ ❌ 버튼
        └─ WAITING_CHOICE  : PermissionRequest hook (AskUserQuestion) → 번호 버튼

[SUB]   멀티 세션 관리
        ├─ 슬롯 10 (SESSION_COUNT): 총 세션 수 / 대기 수 표시 (고정)
        ├─ 슬롯 11 (SESSION_NAME/SWITCH): 현재 세션 이름 표시 + Phase 2에서 클릭으로 세션 전환 (고정)
        ├─ 슬롯 12 (RESERVED): 향후 용도 예약, 현재 미사용
        ├─ BIG WIN 영역: 시스템 전용 (시간/CPU 등 표시). Plugin API 제어 불가.
        └─ 자동 포커스 전환: 새 WAITING 발생 시 자동 이동
```

---

## 2. 모든 상호작용은 Hook 이벤트 JSON으로

**PTY stdout 파싱을 사용하지 않는다.**

Claude Code의 plan 선택지(numbered choice)는 `AskUserQuestion` 도구를 통해 발생하며, 이는 `PermissionRequest` hook으로 **구조화된 JSON**이 전달된다. PTY 텍스트를 파싱할 필요가 없다.

```
Claude Code가 "1. Refactor / 2. Fix tests / 3. Show diff" 를 출력할 때:
  → 내부적으로 AskUserQuestion 도구 호출
  → PermissionRequest hook 발화
  → stdin으로 tool_input.options[] 배열 수신
  → 구조화된 JSON으로 선택지 파악
  → 버튼 배치 후 대기
  → 버튼 누름 → updatedInput.answer = "2" 반환
```

### Hook 이벤트 → State 매핑 (전체)

| Hook 이벤트 | 조건 | 전환 상태 | 블로킹 |
|-------------|------|-----------|--------|
| `PreToolUse` | (모든 도구 실행 전) | → PROCESSING | ✗ async |
| `PermissionRequest` | `tool_name` ≠ `AskUserQuestion` | → WAITING_BINARY | ✅ blocking |
| `PermissionRequest` | `tool_name` = `AskUserQuestion` | → WAITING_CHOICE | ✅ blocking |
| `Stop` | — | → IDLE | ✗ async |

이 네 가지 이벤트만으로 **모든 상태 전환**이 완성된다.

---

## 3. 시스템 아키텍처

### 3.1 구성도

```
Claude Code
    │
    ├─ PermissionRequest hook ──► HTTP POST → Bridge :39200  [BLOCKING]
    │   (Bash/Edit/Write 등)          bridge가 버튼 대기 후 결정 반환
    │
    ├─ PermissionRequest hook ──► HTTP POST → Bridge :39200  [BLOCKING]
    │   (AskUserQuestion)             bridge가 버튼 대기 후 answer 반환
    │
    ├─ PreToolUse hook ─────────► HTTP POST → Bridge          [async]
    │                                 PROCESSING 상태로 전환
    │
    └─ Stop hook ───────────────► HTTP POST → Bridge          [async]
                                      IDLE 상태로 리셋
                                          │
                                   WebSocket /plugin
                                          │
                                 Ulanzi Plugin (app.js)
                                          │ $UD SDK API
                                     D200 물리 버튼
```

### 3.2 요청 경로 (전체)

| Hook 이벤트 | tool_name | 수신 구조 | Bridge 동작 | 응답 |
|-------------|-----------|-----------|-------------|------|
| `PermissionRequest` | `Bash` / `Edit` / `Write` 등 | `tool_input.command` | WAITING_BINARY 렌더링, 버튼 대기 | `behavior: allow/deny` |
| `PermissionRequest` | `AskUserQuestion` | `tool_input.options[]` | WAITING_CHOICE 렌더링, 버튼 대기 | `behavior: allow` + `updatedInput.answer` |
| `PreToolUse` | (any) | `tool_name`, `tool_input` | PROCESSING 렌더링 | exit 0 |
| `Stop` | — | `stop_hook_active` | IDLE 렌더링 | exit 0 |

---

## 4. 소프트웨어 컴포넌트 (전체 애셋)

### 4.1 컴포넌트 목록

| 컴포넌트 | 역할 | 경로 |
|---------|------|------|
| **Bridge Server** | Hook 수신, 세션 관리, WS 서버 | `bridge/server.js` |
| ↳ Session Manager | 세션 상태, 자동 포커스 전환 | `bridge/sessionManager.js` |
| ↳ Button Manager | state → 버튼 레이아웃 매핑 | `bridge/buttonManager.js` |
| ↳ WS Server | Ulanzi Plugin 양방향 통신 | `bridge/wsServer.js` |
| **Ulanzi Plugin** | 버튼 렌더링, 입력 처리 | `com.claudedj.claudecode.ulanziPlugin/` |
| ↳ app.js | Plugin 진입점 | `plugin/app.js` |
| **Hook Scripts** | Claude Code → Bridge 전달 | `hooks/` |
| ↳ permission.js | `PermissionRequest` long-poll | `hooks/permission.js` |
| ↳ notify.js | `PreToolUse` 상태 업데이트 | `hooks/notify.js` |
| ↳ stop.js | `Stop` IDLE 리셋 | `hooks/stop.js` |
| ↳ setup-hooks.sh | Hook 등록/해제 스크립트 | `hooks/setup-hooks.sh` |
| **Virtual DJ FE** | 브라우저 기반 장비 시뮬레이터 | `public/index.html` |

> ⚠️ PTY Wrapper / Prompt Parser / node-pty **불필요** — 모든 상호작용이 Hook 이벤트로 처리됨.

### 4.2 설정 파일

| 파일 | 위치 | 내용 |
|------|------|------|
| `settings.json` | `~/.claude/settings.json` | Hook 이벤트 전역 등록 |
| `manifest.json` | Ulanzi 플러그인 루트 | Actions, States 정의 |
| `config.json` | `bridge/config.json` | 포트, 타임아웃, 슬롯 매핑 |
| `package.json` | `bridge/` | ws, express |
| `package.json` | `plugin/` | Ulanzi common-node SDK |

### 4.3 이미지 에셋

> **스펙: 196 × 196 px / PNG / 어두운 배경**

#### 액션 버튼 — 정적

| 파일명 | 표시 | 슬롯 |
|--------|------|------|
| `btn_empty.png` | dim 빈 버튼 | IDLE 전체 |
| `btn_approve.png` | ✅ Approve | BINARY 슬롯 0 |
| `btn_deny.png` | ❌ Deny | BINARY 슬롯 1 |
| `btn_always_allow.png` | 🔒 Always Allow | BINARY 슬롯 5 (조건부) |
| `btn_always_deny.png` | ⛔ Always Deny | (옵션) |
| `btn_cancel.png` | ✖ Cancel | (옵션) |
| `btn_1.png` ~ `btn_10.png` | 숫자 + 색상 배경 | CHOICE 슬롯 0~9 |

#### 액션 버튼 — Active 피드백

| 파일명 | 설명 |
|--------|------|
| `btn_approve_active.png` | 눌림 순간 표시 |
| `btn_deny_active.png` | 눌림 순간 표시 |
| `btn_1_active.png` ~ `btn_10_active.png` | 눌림 순간 표시 |

#### PROCESSING 애니메이션

| 파일명 | 방식 | 설명 |
|--------|------|------|
| `anim_wave.gif` | GIF (권장) | 좌→우 웨이브 |
| `anim_processing.gif` | GIF | 단일 버튼 펄스 |
| `win_processing.gif` | GIF | BIG WIN PROCESSING 상태 |

> SDK `setGifPathIcon()` 지원 → GIF 방식 권장

#### 고정 슬롯

| 파일명 | 슬롯 | 상태 |
|--------|------|------|
| `session_count_normal.png` | 슬롯 10 | 대기 없음 |
| `session_count_alert.png` | 슬롯 10 | 대기 세션 있음 |
| `session_name.png` | 슬롯 11 | 세션 이름 표시 |

> ⚠️ BIG WIN 영역은 시스템 전용입니다. Plugin API로 제어할 수 없으며 세션 정보 표시 용도로 사용하지 않습니다. 세션 정보는 슬롯 10(SESSION_COUNT)과 슬롯 11(SESSION_NAME/SWITCH)을 통해 표시합니다.

#### 브랜드

| 파일명 | 용도 | 비고 |
|--------|------|------|
| `plugin_icon.png` | UlanziStudio 플러그인 아이콘 | 196×196 |
| `claudedj_logo.png` | Property Inspector UI | 직접 제작 |
| `claude_logo.png` | 플러그인 UI 내 활용 가능 | Anthropic 브랜드 가이드 확인 |
| `claude_code_logo.png` | 플러그인 UI 내 표시 | 동일 |

**에셋 총계: PNG ~36장 + GIF 3개**

---

## 5. Claude Code Hooks API (v2.1.85)

### 5.1 Hook 설정

```json
// ~/.claude/settings.json
{
  "hooks": {
    "PermissionRequest": [{
      "hooks": [{ "type": "command",
        "command": "node /path/to/claude-dj/hooks/permission.js",
        "timeout": 120
      }]
    }],
    "PreToolUse": [{
      "hooks": [{ "type": "command",
        "command": "node /path/to/claude-dj/hooks/notify.js"
      }]
    }],
    "Stop": [{
      "hooks": [{ "type": "command",
        "command": "node /path/to/claude-dj/hooks/stop.js"
      }]
    }]
  }
}
```

> 경로는 모노레포 checkout 위치에 따라 달라집니다. `hooks/setup-hooks.sh`를 실행하면 현재 디렉토리 기준으로 자동 등록됩니다.

### 5.2 PermissionRequest stdin — 케이스 A: 일반 Permission

```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/proj/transcript.jsonl",
  "cwd": "/projects/api-server",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf ./dist" },
  "permission_suggestions": [
    { "type": "setMode", "mode": "acceptEdits", "destination": "session" }
  ]
}
```

### 5.3 PermissionRequest stdin — 케이스 B: AskUserQuestion

```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/proj/transcript.jsonl",
  "cwd": "/projects/api-server",
  "hook_event_name": "PermissionRequest",
  "tool_name": "AskUserQuestion",
  "tool_input": {
    "question": "How would you like to proceed?",
    "options": [
      { "label": "1", "description": "Refactor the module" },
      { "label": "2", "description": "Fix failing tests" },
      { "label": "3", "description": "Show diff first" }
    ]
  }
}
```

> ✅ `tool_name === 'AskUserQuestion'` 판별로 BINARY / CHOICE 분기  
> ⚠️ `tool_use_id` 없음 (PreToolUse와 다름)  
> ⚠️ 비대화형 모드(`-p`)에서 발화 안 됨  
> ⚠️ subagent permission은 현재 hook 미트리거 (issue #23983)

### 5.4 permission.js — Bridge 판별 로직

```js
// hooks/permission.js
import { readFileSync } from 'fs';
const input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));

// tool_name으로 BINARY / CHOICE 분기 → Bridge가 처리
const res = await fetch('http://localhost:39200/permission', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
  signal: AbortSignal.timeout(110_000)
});

process.stdout.write(JSON.stringify(await res.json()));
process.exit(0);
```

```js
// bridge/server.js — /permission 핸들러
app.post('/permission', async (req, res) => {
  const input = req.body;
  const isChoice = input.tool_name === 'AskUserQuestion';

  // Ulanzi Plugin에 레이아웃 push
  wsBroadcast({
    type: 'LAYOUT',
    preset: isChoice ? 'choice' : 'binary',
    session: { id: input.session_id, name: path.basename(input.cwd), state: isChoice ? 'WAITING_CHOICE' : 'WAITING_BINARY' },
    ...(isChoice
      ? { choices: input.tool_input.options.map(o => ({ index: parseInt(o.label), label: o.description })) }
      : { prompt: { toolName: input.tool_name, command: input.tool_input?.command, hasAlwaysAllow: input.permission_suggestions?.length > 0 } }
    )
  });

  // 버튼 입력 대기 (최대 30초)
  const decision = await waitForButton(input.session_id, 30_000);

  // Hook 응답 반환
  if (isChoice) {
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow', updatedInput: { answer: decision.value } }
      }
    });
  } else {
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: decision.value, message: `Claude DJ: ${decision.value}` }
      }
    });
  }
});
```

### 5.5 PermissionRequest 응답 구조

**케이스 A — 일반 Permission:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "message": "Claude DJ: approved via physical button"
    }
  }
}
```

**케이스 B — AskUserQuestion 선택:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedInput": { "answer": "2" }
    }
  }
}
```

**타임아웃 30s 자동 deny:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Claude DJ: timeout (30s)"
    }
  }
}
```

| behavior | 의미 |
|----------|------|
| `"allow"` | 다이얼로그 건너뛰고 즉시 승인 |
| `"deny"` | 거부, message → Claude |
| `"ask"` | 원래 다이얼로그 표시 |

### 5.6 Stop stdin

```json
{
  "session_id": "abc123",
  "hook_event_name": "Stop",
  "stop_hook_active": false,
  "last_assistant_message": "작업 완료."
}
```
> ⚠️ `stop_hook_active: true` → 즉시 exit 0 (무한루프 방지)

### 5.7 Exit Code

| Code | 의미 |
|------|------|
| `0` | 정상. stdout JSON 파싱·적용 |
| `2` | 차단. stderr → Claude 피드백 |
| 기타 | 비차단 에러 |

---

## 6. 세션 State 머신

### 6.1 상태 정의

```
IDLE            → 대기. 버튼 전체 dim.
PROCESSING      → PreToolUse 감지. 웨이브 애니메이션.
WAITING_BINARY  → PermissionRequest (일반 tool). ✅❌ 활성.
WAITING_CHOICE  → PermissionRequest (AskUserQuestion). 번호 버튼 활성.
```

### 6.2 State 전환 — Hook 이벤트만 사용

```
Claude Code           Hook          Bridge State    D200 버튼
─────────────────────────────────────────────────────────────
(작업 없음)                          IDLE            전체 dim
    │
    ├─ 도구 실행 시작 ── PreToolUse ──► PROCESSING    웨이브 애니메이션
    │
    ├─ Bash/Edit 권한 ─ PermissionRequest ─► WAITING_BINARY  ✅❌
    │   (tool_name: Bash)    (blocking)
    │       └─ 버튼 누름 ───────────────────────────── → PROCESSING
    │
    ├─ Plan 선택 ────── PermissionRequest ─► WAITING_CHOICE  1 2 3 ...
    │   (AskUserQuestion)    (blocking)
    │       └─ 버튼 누름 ───────────────────────────── → PROCESSING
    │
    └─ 작업 완료 ─────── Stop ──────────────► IDLE           전체 dim
```

### 6.3 State별 버튼 레이아웃

```
IDLE:
  슬롯 0~9, 12 → btn_empty.png (동적 슬롯 전체 dim)
  슬롯 10 (SESSION_COUNT) → 고정, dim 아님
  슬롯 11 (SESSION_NAME) → 고정, dim 아님
  슬롯 12 (RESERVED) → dim, 눌림 무반응
  눌림 무반응

PROCESSING:
  슬롯 0~9 → anim_wave.gif (setGifPathIcon, offset delay로 웨이브)
  슬롯 12 (RESERVED) → dim 유지, 웨이브 미적용
  슬롯 10, 11 → 고정 상태 유지
  BIG WIN → 시스템 전용, Plugin API 제어 불가

WAITING_BINARY:
  슬롯 0 → btn_approve.png
  슬롯 1 → btn_deny.png
  슬롯 5 → btn_always_allow.png (permission_suggestions 있을 때)
  슬롯 2~4, 6~9 → btn_empty.png
  슬롯 12 (RESERVED) → dim 유지
  슬롯 10, 11 → 고정 상태 유지
  BIG WIN → 시스템 전용, Plugin API 제어 불가

WAITING_CHOICE (최대 10개):
  슬롯 0 → btn_1.png + text "Refactor module"
  슬롯 1 → btn_2.png + text "Fix failing tests"
  슬롯 2 → btn_3.png + text "Show diff first"
  ...
  슬롯 9 → btn_10.png + text (10번째 선택지)
  슬롯 12 (RESERVED) → dim 유지, 선택지 배치 안 함
  슬롯 10, 11 → 고정 상태 유지
  BIG WIN → 시스템 전용, Plugin API 제어 불가
```

> ⚠️ 슬롯 12는 RESERVED (향후 용도 예약)이며 어떤 상태에서도 선택지나 액션을 배치하지 않습니다. BIG WIN 영역은 시스템 전용으로 Plugin API로 제어할 수 없습니다.

### 6.4 세션 객체

```js
const session = {
  id: 'abc123',               // Claude Code session_id
  name: 'api-server',         // path.basename(cwd)
  cwd: '/projects/api-server',
  state: 'IDLE',              // IDLE | PROCESSING | WAITING_BINARY | WAITING_CHOICE
  waitingSince: null,         // Date.now() — 멀티세션 oldest 판별용

  // WAITING 상태일 때만 유효
  prompt: {
    type: 'BINARY',           // 'BINARY' | 'CHOICE'
    toolName: 'Bash',         // BINARY일 때
    command: 'rm -rf dist',
    hasAlwaysAllow: false,
    choices: [],              // [{index, label}] CHOICE일 때
  },

  respondFn: null             // Bridge 주입: (decision) => void
};
```

### 6.5 멀티 세션 자동 포커스 전환 (Phase 3)

| 이벤트 | 현재 포커스 | 동작 |
|--------|------------|------|
| 새 WAITING 발생 | IDLE | 즉시 전환 + 레이아웃 교체 |
| 새 WAITING 발생 | WAITING | 유지 + COUNT 배지 +N |
| 응답 완료 | — | oldest WAITING 세션으로 이동 |
| 모두 IDLE | — | 전체 dim |

---

## 7. Ulanzi Plugin SDK

### 7.1 UUID 규칙

```
플러그인:   com.claudedj.ulanzistudio.claudecode          (4 segments)
액션:       com.claudedj.ulanzistudio.claudecode.button   (5 segments)
패키지 폴더: com.claudedj.claudecode.ulanziPlugin
```

### 7.2 핵심 API

```js
import UlanziApi from './libs/common-node/index.js';
const $UD = new UlanziApi();
$UD.connect('com.claudedj.ulanzistudio.claudecode');

$UD.setStateIcon(context, stateIndex, text);
$UD.setPathIcon(context, 'resources/images/btn_approve.png', '');
$UD.setGifPathIcon(context, 'resources/images/anim_wave.gif', '');

$UD.onRun((msg) => { /* 버튼 눌림 */ });
$UD.onAdd((msg) => { /* 슬롯 배치 */ });
$UD.onClear((msg) => { /* 슬롯 제거 */ });

const { key } = $UD.decodeContext(msg.context); // 물리 슬롯 번호
```

---

## 8. Bridge ↔ Plugin WebSocket Protocol

### 8.1 Bridge → Plugin

```jsonc
// 전체 레이아웃 설정
{
  "type": "LAYOUT",
  "preset": "idle" | "processing" | "binary" | "choice",
  "session": { "id": "abc", "name": "api-server", "state": "WAITING_BINARY" },

  // binary일 때
  "prompt": { "toolName": "Bash", "command": "rm -rf dist", "hasAlwaysAllow": false },

  // choice일 때 (AskUserQuestion options에서 변환)
  "choices": [
    { "index": 1, "label": "Refactor module" },
    { "index": 2, "label": "Fix failing tests" }
  ]
}

// 개별 업데이트
{ "type": "BUTTON_STATE", "slot": 0, "state": "approve"|"deny"|"always"|"processing"|"empty" }
{ "type": "BUTTON_CHOICE", "slot": 0, "choiceIndex": 0, "number": 1, "label": "Fix tests" }
{ "type": "SESSION_COUNT", "total": 3, "waiting": 1 }
{ "type": "SESSION_NAME", "name": "api-server" }
{ "type": "ALL_DIM" }

// ⚠️ BIG_WINDOW 메시지 없음 — BIG WIN 영역은 시스템 전용, Plugin API 제어 불가
// 세션 정보는 SESSION_COUNT (슬롯 10) 과 SESSION_NAME (슬롯 11) 으로 표시
```

### 8.2 Plugin → Bridge

```jsonc
{ "type": "BUTTON_PRESS", "slot": 0, "timestamp": 1743000000000 }
{ "type": "PLUGIN_READY", "version": "0.1.0" }

// ⚠️ BIG_WINDOW_PRESS 없음 — BIG WIN 영역은 시스템 전용, 클릭 불가
// 슬롯 11 (SESSION_NAME/SWITCH) 클릭 = Phase 2에서 세션 전환 역할 수행
```

---

## 9. 슬롯 번호 매핑

```
┌────┬────┬────┬────┬────┐
│  0 │  1 │  2 │  3 │  4 │  ← dynamic (BINARY/CHOICE)
├────┼────┼────┼────┼────┤
│  5 │  6 │  7 │  8 │  9 │  ← dynamic (BINARY/CHOICE)
├────┼────┼────┼──────────┤
│ 10 │ 11 │ 12 │ (시스템) │
└────┴────┴────┴──────────┘
 카운트 세션  예약   제어불가

슬롯  0~9  : 동적 (BINARY/CHOICE 상태에 따라 자유 배치)
슬롯 10    : SESSION_COUNT (고정 — 총/대기 세션 수 표시)
슬롯 11    : SESSION_NAME/SWITCH (고정 — 현재 세션 이름, Phase 2: 클릭으로 세션 전환)
슬롯 12    : RESERVED (향후 용도 예약, 현재 dim, 비대화형)
BIG WIN    : 시스템 전용 (시간/CPU 등 표시) — Plugin API 제어 불가
```

---

## 10. 구현 마일스톤

### Phase 1 — MVP: WAITING_BINARY

- [ ] Bridge HTTP 서버 (express, port 39200)
- [ ] `PermissionRequest` hook 스크립트 (long-poll, 30s timeout)
- [ ] `tool_name` 판별 → BINARY/CHOICE 분기 로직
- [ ] Ulanzi Plugin + WS 기본 연결
- [ ] `LAYOUT` binary 렌더링
- [ ] `BUTTON_PRESS` → Bridge → hook 응답 루프 완성
- [ ] `Stop` hook → IDLE 리셋
- [ ] Virtual D200 FE로 전체 루프 검증

### Phase 2: WAITING_CHOICE

- [ ] `AskUserQuestion` 판별 + `options[]` 파싱
- [ ] `WAITING_CHOICE` + 번호 버튼 (text 오버레이, 슬롯 0~9 최대 10개)
- [ ] `updatedInput.answer` 응답 방식
- [ ] PROCESSING 상태 GIF 웨이브 애니메이션
- [ ] 슬롯 11 (SESSION_NAME) 클릭 → 세션 전환 이벤트 (`BUTTON_PRESS` slot=11)

### Phase 3: 멀티 세션 (부수 기능)

- [ ] SESSION_COUNT 슬롯 10 업데이트
- [ ] SESSION_NAME 슬롯 11 업데이트
- [ ] 슬롯 11 클릭 → 다음 세션으로 rotate (Phase 2 연계)
- [ ] 자동 포커스 전환 로직

### Phase 4: 안정화

- [ ] `stop_hook_active` 무한루프 방지
- [ ] subagent permission 버그 모니터링 (issue #23983)
- [ ] Bridge 다운 시 graceful fallback
- [ ] Virtual D200 auto test 전 시나리오 통과

---

## 11. 기술 스택

| 레이어 | 기술 |
|-------|------|
| Bridge Server | Node.js 20+, express |
| Plugin Main | Node.js 20+ + Ulanzi common-node SDK |
| Hook Scripts | Node.js 20+ (stdin/stdout) |
| 통신 | WebSocket (ws npm) |
| 이미지 | 정적 PNG ~36장 + GIF 3개 |
| 테스트/체험 | Virtual D200 FE (브라우저) |

> ❌ node-pty — 사용 안 함  
> ❌ PTY stdout 파싱 — 사용 안 함  
> ✅ 모든 상호작용은 Hook 이벤트 JSON

---

## 12. 레퍼런스

| 항목 | URL |
|------|-----|
| Claude Code Hooks 공식 문서 | https://code.claude.com/docs/en/hooks |
| Claude Code Channels Reference | https://code.claude.com/docs/en/channels-reference |
| Ulanzi Plugin SDK | https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK |
| claude-watch (선행 참고) | https://github.com/shobhit99/claude-watch |
| AgentDeck (Stream Deck 선행) | https://github.com/puritysb/AgentDeck |
| subagent permission 버그 | https://github.com/anthropics/claude-code/issues/23983 |
