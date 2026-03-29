# Claude DJ — Session 5 Status

> **Date:** 2026-03-29
> **Tests:** 102 passing, 9 suites
> **Commits this session:** 16
> **Push:** Pushed to origin/main

---

## 1. Completed Work

### 1.1 Stop Hook Schema Fix
- `hookSpecificOutput.hookEventName: "Stop"` → Claude Code가 지원하지 않음
- `{ continue: true, systemMessage }` 시도 → 스키마 통과, 하지만 자동 재개 안 됨
- **결론:** Stop hook은 display-only notification으로 전환

### 1.2 Regex False-Positive Fix
- `parseRegexChoices`: 전체 텍스트 → 마지막 800자만 스캔
- 15줄 이내 클러스터 검증 (섹션 헤더 `**1. Title**` 오탐지 방지)
- 테스트 2개 추가 (오탐지 시나리오 + 긴 메시지 끝 정상 감지)

### 1.3 Choice-Format Skill Rewrite
- 78줄 → 56줄, 절차적 포맷
- "The One Rule": 응답이 사용자 반응을 기대하면 → AskUserQuestion 필수
- Common Mistakes 테이블: 한/영 병기 (`"커밋할까요?" / "should I commit?"`)
- 라이브 검증: select (3버튼), confirm (2버튼) 모두 정상

### 1.4 Stop-Wait Removal (-162줄)
- Long-poll 엔드포인트, `_stopWaiters`, events.jsonl 이중 기록 제거
- `WAITING_RESPONSE` → `awaiting_input` preset (display-only)
- 근본 한계: Stop hook은 user turn 주입 불가

### 1.5 MultiSelect Toggle+Submit
- `multiSelect: true` AskUserQuestion → 덱에서 처리 가능
- 슬롯 0-8: ☐/☑ 토글, 슬롯 9: ✔ Done (submit)
- Bridge: 토글 시 레이아웃 재브로드캐스트, submit 시 resolve
- 답변 포맷: `"1,3"` (comma-separated indices)
- 라이브 검증 완료

### 1.6 Session Disk Sync
- `~/.claude/sessions/*.json` 폴링 (30초마다)
- PID 생존 확인 (`process.kill(pid, 0)`)
- 죽은 세션 자동 정리 + ALL_DIM 브로드캐스트
- Push-only 한계 극복: 세션 종료/crash 감지 가능

### 1.7 Virtual DJ UI
- Idle indicator: 슬롯 9에 💤 Idle
- Awaiting input: 슬롯 4에 ⏳ Awaiting input
- MultiSelect: ☐/☑ 토글 + ✔ Done CSS 스타일

### 1.8 Landing Page Overhaul
- 6개 상태 시뮬레이터: BINARY, CHOICE, MULTI, PROC, AWAIT, IDLE
- 각 상태별 프롬프트 예시 + 버튼 인터랙션
- 3초 후 자동 리셋
- `/landing` 경로로 bridge에서 디버그 접근

---

## 2. Architecture (Current)

```
Claude Code Session
    ├─ PreToolUse    → hooks/notify.js       → POST /api/hook/notify      (async, focus-filtered)
    ├─ PostToolUse   → hooks/postToolUse.js  → POST /api/hook/postToolUse (async, focus-filtered)
    ├─ PermissionReq → hooks/permission.js   → POST /api/hook/permission  (blocking)
    │   ├─ AskUserQuestion (single)  → WAITING_CHOICE → button → answer
    │   ├─ AskUserQuestion (multi)   → WAITING_CHOICE → toggle+Done → answer
    │   └─ Bash/Write/etc            → WAITING_BINARY → approve/deny
    ├─ Stop          → hooks/stop.js         → POST /api/hook/stop        (display-only notification)
    ├─ UserPrompt    → hooks/userPrompt.js   → GET /api/events/:id        (reads deck events)
    ├─ SubagentStart → hooks/subagentStart.js→ POST /api/hook/subagentStart (async)
    └─ SubagentStop  → hooks/subagentStop.js → POST /api/hook/subagentStop  (async)
         ↓
    Bridge Server (localhost:39200)
    ├─ SessionManager (state machine, focus, prune, disk sync)
    ├─ ButtonManager (state → layout, single/multi choice, binary)
    ├─ WsServer (broadcast, late-join sync)
    └─ Static serve (Virtual DJ + /landing)
         ↓ WebSocket
    Virtual DJ (browser) / Ulanzi D200 (Phase 3)
```

### Deck States

| State | Deck Layout | Interactive |
|-------|-------------|------------|
| IDLE | 💤 slot 9 | No |
| PROCESSING | Wave pulse 0-9 | No |
| WAITING_BINARY | ✅ Approve / ❌ Deny | Yes |
| WAITING_CHOICE | 0..N buttons | Yes |
| WAITING_CHOICE (multi) | ☐/☑ toggle + ✔ Done(9) | Yes |
| WAITING_RESPONSE | ⏳ slot 4 | No (display-only) |

---

## 3. Test Map

```
102 tests, 9 suites:
├── sessionManager.test.js  (32 tests: +syncFromDisk)
├── buttonManager.test.js   (15 tests: +multiSelect, +awaiting_input)
├── stopParser.test.js      (13 tests: +false-positive, +tail detection)
├── hooks.test.js           (12 tests)
├── e2e.test.js             (14 tests: +multiSelect toggle+submit, +awaiting_input)
├── e2e.subagent.test.js    (3 tests)
├── bridge.test.js          (5 tests)
├── config.test.js          (3 tests)
└── (sessionManager sync)   (2 tests: dead PID, alive PID)
```

---

## 4. Remaining Work

### [DONE] Phase 1-2: Virtual DJ
모든 핵심 기능 구현 + 라이브 검증 완료.

### [LOW] Phase 3: Physical D200 Plugin
> Ref: `docs/reference/ulanzideck-plugin-dev-guide.md`
- Ulanzi D200 Plugin (UlanziDeck SDK)
- 물리 버튼 매핑

### [LOW] Phase 4: Distribution
- `git push` ✅ (완료)
- npm publish (`npx claude-dj`)
- `/install github:whyjp/claude-dj` 검증

### [KNOWN LIMITATIONS]
- **Stop hook delivery**: 텍스트 선택지 → 덱 버튼 인터랙션 불가 (Claude Code 아키텍처 한계)
- **MultiSelect UX**: 토글+Done 작동하지만 Claude Code가 `answer: "1,3"` 포맷을 올바르게 처리하는지 추가 검증 필요
- **Session ID stability**: `/clear`, `/compact` 후 sessionId 유지 여부 추가 확인 필요
