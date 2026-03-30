# Miniview Mode Design

**Date:** 2026-03-30
**Status:** Approved

## Summary

VirtualDJ에 miniview 모드를 추가한다. miniview에서는 D200 deck(13-key 그리드)만 표시되고, header와 control panel은 숨겨진다. deck 상단에 agent 탭 바가 추가되어 root/subagent 간 전환이 가능하다.

## Requirements

1. **Miniview 레이아웃:** header, ctl-panel 숨김. deck + agent 탭 바만 표시
2. **Agent 탭 바:** miniview 상단에 위치. root/subagent 탭 표시. 탭 클릭으로 agent 전환
3. **진입 방식:** URL 파라미터(`?view=mini`) + 풀뷰에서 토글 버튼
4. **복귀 방식:** agent 탭 바 우측 확장 아이콘(`⛶`) 클릭
5. **Deck 크기:** 기존과 동일 유지

## Architecture

### Approach: CSS 클래스 토글

`<body>`에 `mini` 클래스를 추가/제거하여 뷰 모드를 전환한다. 별도 HTML 페이지나 iframe 없이, 기존 SPA 구조를 그대로 활용한다.

### Layout

**풀뷰 (기존):**
```
┌─────────────────────────────────────┐
│ Header (로고, WS상태, 버튼)          │
├──────────────┬──────────────────────┤
│ D200 Deck    │ Control Panel        │
│ (13 keys)    │ (Log/Sessions/...)   │
└──────────────┴──────────────────────┘
```

**Miniview:**
```
┌──────────────┐
│ Agent Tabs   │  ← [root] [sub-1] [sub-2] ... [⛶]
├──────────────┤
│ D200 Deck    │
│ (13 keys)    │
└──────────────┘
```

## Components

### 1. Agent Tab Bar (신규 DOM 요소)

- **위치:** `.dev-panel` 내부, 그리드 위
- **구조:** `<div class="mini-agent-tabs">` containing tab buttons + expand icon
- **스타일:** 기존 이벤트 로그의 `.child-tabs`와 동일한 디자인 언어 (색상, 폰트, 하이라이트)
- **동작:**
  - 탭 클릭 → slot 12(agent switcher)와 동일한 `BUTTON_PRESS` 전송으로 agent 전환
  - LAYOUT 메시지의 agent 정보로 탭 목록/활성 상태 자동 업데이트
- **표시 조건:** miniview 모드에서만 표시 (`body.mini .mini-agent-tabs { display: flex }`)

### 2. CSS 변경

```css
/* Miniview: hide header and control panel */
body.mini header { display: none; }
body.mini .ctl-panel { display: none; }

/* Miniview: dev-panel takes full width, no forced grid */
body.mini main { display: block; }
body.mini .dev-panel { width: auto; }

/* Agent tab bar: hidden by default, shown in miniview */
.mini-agent-tabs { display: none; }
body.mini .mini-agent-tabs { display: flex; }
```

### 3. 진입/전환 로직 (JS)

**페이지 로드 시:**
```
URL에 ?view=mini 있으면 → body.classList.add('mini')
```

**풀뷰 → miniview 토글:**
- Header 영역에 미니뷰 전환 아이콘 추가
- 클릭 → `body.classList.add('mini')` + `history.replaceState`로 URL에 `?view=mini` 추가

**Miniview → 풀뷰 복귀:**
- Agent 탭 바 우측 `⛶` 클릭
- `body.classList.remove('mini')` + URL에서 `?view=mini` 제거

## Files to Modify

| File | Changes |
|------|---------|
| `/public/index.html` | Agent 탭 바 DOM 추가, header에 miniview 토글 버튼 추가 |
| `/public/css/style.css` | `body.mini` 스타일, `.mini-agent-tabs` 스타일 |
| `/public/js/app.js` | 페이지 로드 시 URL 파라미터 체크, 토글 로직 |
| `/public/js/d200-renderer.js` | LAYOUT 수신 시 agent 탭 바 업데이트 로직 |

## Data Flow

```
LAYOUT message (contains agent list + focus agent)
    ↓
d200-renderer.js: renderLayout()
    ↓
agent 탭 바 업데이트 (탭 목록 재생성, 활성 탭 하이라이트)
    ↓
사용자가 탭 클릭
    ↓
app.js: BUTTON_PRESS (slot 12 equivalent) 전송
    ↓
Bridge: agent focus 변경 → 새 LAYOUT 브로드캐스트
```

## Edge Cases

- **Agent 1개일 때:** 탭 바에 "root" 하나만 표시 (전환 불필요하지만 일관성 유지)
- **WebSocket 미연결:** 탭 바 비어있음, 연결 후 LAYOUT 수신 시 채워짐
- **새로고침:** URL 파라미터로 miniview 모드 유지, LAYOUT 수신 시 탭 복원
