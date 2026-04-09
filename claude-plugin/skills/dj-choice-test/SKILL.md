---
name: dj-choice-test
description: Interactive choice-format stress test — verifies stop hook choice detection, false-positive filtering, fenced choices, and freeze-prevention. Uses file-based fixtures in .dj-test/ (gitignored).
user_invocable: true
---

# Claude DJ — Choice Format Stress Test

Test the stop hook's choice detection logic with complex text patterns. Each step outputs a specific text pattern **without AskUserQuestion**, then checks whether the deck correctly detected or filtered the choices.

**CRITICAL RULES**:
- Steps 1-7 must end WITHOUT calling AskUserQuestion — the point is to test the stop hook's regex/fenced detection. Only the Pass/Fail verification after each step uses AskUserQuestion.
- **NO REAL WORK**: Do NOT actually execute any plan, delegate to agents, read/write project files, or run commands beyond the test setup.
- **NO TOOL CALLS** during test output steps (except AskUserQuestion for Pass/Fail).

## Setup Phase

Before starting tests, create all fixture files at once. Run this as a single bash command:

```bash
mkdir -p .dj-test/fixtures && cat > .dj-test/fixtures/step1-autopilot-plan.txt << 'FIXTURE'
Autopilot 실행 계획:

1. executor 에이전트 위임 — bridge/server.js WebSocket 핸들러 리팩터링
2. choiceParser.js 수정 — fenced block 우선순위 로직 추가, regex fallback 개선
3. test-engineer 에이전트 — 단위 테스트 15개 추가 (choiceParser, stopHook, buttonManager)
4. d200-renderer.js 업데이트 — 버튼 트렁케이션 30자 제한, overflow 처리
5. verifier 에이전트 — 전체 테스트 스위트 실행 및 검증
6. 버전 범프 0.5.6 → 0.5.7, CHANGELOG 업데이트

총 예상 변경: 6개 파일, ~200 LOC. 진행하겠습니다.
FIXTURE

cat > .dj-test/fixtures/step2-analysis-report.txt << 'FIXTURE'
코드베이스 분석 완료. 발견된 이슈:

1. bridge/wsServer.js:42 — 클라이언트 연결 해제 시 메모리 누수 가능성
2. hooks/stop.js:187 — proxy timeout이 하드코딩됨 (120000ms), 설정으로 분리 필요
3. public/js/app.js:23 — VERSION 상수가 빌드 타임에 주입되지 않고 수동 관리됨
4. bridge/sessionManager.js:95 — 세션 정리 로직에 race condition 존재

심각도: 중간. 즉시 수정이 필요한 항목은 #1과 #4입니다.
기존 테스트 커버리지: 47%. 목표 커버리지 80%까지 33개 테스트 추가 필요.
FIXTURE

cat > .dj-test/fixtures/step3-team-pipeline.txt << 'FIXTURE'
Team 파이프라인 구성:

1. architect (opus) — 전체 아키텍처 리뷰, WebSocket 프로토콜 재설계 제안
2. executor (sonnet) — 구현 작업 3건 병렬 실행
   - bridge/server.js 리팩터링
   - hooks/choiceParser.js 신규 파서 통합
   - public/js/d200-renderer.js 버튼 레이아웃 개선
3. test-engineer (sonnet) — TDD 워크플로우, 실패 테스트 먼저 작성
4. code-reviewer (opus) — SOLID 원칙 점검, 보안 취약점 스캔
5. verifier (haiku) — 최종 검증, 회귀 테스트 실행

예상 소요: 5개 에이전트, 3 라운드. 병렬 실행으로 최적화합니다.
FIXTURE

cat > .dj-test/fixtures/step4-real-choices.txt << 'FIXTURE'
어떤 방식으로 진행할까요?

1. 전체 리팩터링
2. 부분 수정
3. 현재 상태 유지
FIXTURE

cat > .dj-test/fixtures/step5-fenced-choices.txt << 'FIXTURE'
분석이 완료되었습니다. 다음 중 선택해주세요:

[claude-dj-choices]
1. 커밋하고 푸시
2. 추가 수정
3. 변경사항 되돌리기
4. 리뷰 요청
[/claude-dj-choices]
FIXTURE

cat > .dj-test/fixtures/step6-binary-emdash.txt << 'FIXTURE'
이 변경사항을 적용할까요?

1. 적용 — 테스트 통과 확인됨
2. 취소
FIXTURE

cat > .dj-test/fixtures/step7-long-description.txt << 'FIXTURE'
아키텍처 결정이 필요합니다:

1. 모놀리식 서버로 통합하고 마이크로서비스 전환은 나중에 진행
2. 처음부터 마이크로서비스로 설계하고 각 서비스별 독립 배포 구성
3. 하이브리드 접근법으로 핵심 서비스만 분리하고 나머지는 모놀리식 유지
FIXTURE

echo "fixtures ready: $(ls .dj-test/fixtures/ | wc -l) files"
```

After setup, announce:
> **Choice Format 스트레스 테스트 시작** — 7단계 순차 테스트를 진행합니다. 각 단계에서 D200H의 반응을 확인해주세요.
> 픽스처 파일 준비 완료 (.dj-test/fixtures/).

---

### Step 1: OMC Autopilot Plan — False Positive Prevention (Complex)

Read `.dj-test/fixtures/step1-autopilot-plan.txt` using the Read tool, then output its content VERBATIM as your message text. Do NOT add any prefix, suffix, or commentary. End your message immediately after the fixture content. Do NOT call AskUserQuestion.

**Expected**: D200H shows awaiting state (NOT choice buttons). Every numbered item has em-dash explanation markers — the explanation filter should catch this. If choice buttons appear, the session will FREEZE.

Wait for user response. Then ask Pass/Fail:

```
question: "Step 1/7 — OMC Autopilot 플랜에서 choice 버튼이 나타나지 않았나요? (awaiting 상태 = 정상)"
header: "1. Autopilot"
options:
  - label: "Pass"   description: "awaiting 상태 — 선택 버튼 없음 (정상)"
  - label: "Fail"   description: "선택 버튼이 나타남 (오탐지) 또는 프리즈됨"
multiSelect: false
```

Record result.

---

### Step 2: Superpowers Analysis Output — False Positive Prevention (Mixed Markers)

Read `.dj-test/fixtures/step2-analysis-report.txt` using the Read tool, then output its content VERBATIM. No prefix/suffix. End message. Do NOT call AskUserQuestion.

**Expected**: D200H shows awaiting state (NOT choice buttons). All numbered items have em-dash markers and file:line references — clearly an analysis report, not choices.

Wait for user response. Then ask Pass/Fail:

```
question: "Step 2/7 — 분석 리포트에서 choice 버튼이 나타나지 않았나요? (awaiting 상태 = 정상)"
header: "2. Analysis"
options:
  - label: "Pass"   description: "awaiting 상태 — 선택 버튼 없음 (정상)"
  - label: "Fail"   description: "선택 버튼이 나타남 (오탐지) 또는 프리즈됨"
multiSelect: false
```

Record result.

---

### Step 3: Multi-Agent Delegation Plan — False Positive Prevention (Nested Structure)

Read `.dj-test/fixtures/step3-team-pipeline.txt` using the Read tool, then output its content VERBATIM. No prefix/suffix. End message. Do NOT call AskUserQuestion.

**Expected**: D200H shows awaiting state (NOT choice buttons). Numbered items with agent names and em-dash descriptions are clearly a delegation plan. Nested bullet points add complexity.

Wait for user response. Then ask Pass/Fail:

```
question: "Step 3/7 — Team 파이프라인 플랜에서 choice 버튼이 나타나지 않았나요? (awaiting 상태 = 정상)"
header: "3. Team"
options:
  - label: "Pass"   description: "awaiting 상태 — 선택 버튼 없음 (정상)"
  - label: "Fail"   description: "선택 버튼이 나타남 (오탐지) 또는 프리즈됨"
multiSelect: false
```

Record result.

---

### Step 4: Real Choices — Detection Required

Read `.dj-test/fixtures/step4-real-choices.txt` using the Read tool, then output its content VERBATIM. No prefix/suffix. End message. Do NOT call AskUserQuestion.

**Expected**: D200H shows 3 choice buttons via stop hook proxy. These are real choices (no explanation markers, question ends with ?).

**IMPORTANT**: The user should press a button on the deck OR type their response in the terminal. Either way works — the stop hook proxy has a 2-minute timeout.

Wait for user response (button press or typed input). Then ask Pass/Fail:

```
question: "Step 4/7 — 3개의 선택 버튼이 D200H에 표시되었나요?"
header: "4. Detect"
options:
  - label: "Pass"   description: "3개 버튼 정상 표시됨"
  - label: "Fail"   description: "버튼 없음 또는 잘못 표시됨"
multiSelect: false
```

Record result.

---

### Step 5: Fenced Choices — Priority Detection

Read `.dj-test/fixtures/step5-fenced-choices.txt` using the Read tool, then output its content VERBATIM. No prefix/suffix. End message. Do NOT call AskUserQuestion.

**Expected**: D200H shows 4 choice buttons. Fenced choices have priority over regex detection and should be detected with 100% accuracy.

Wait for user response. Then ask Pass/Fail:

```
question: "Step 5/7 — Fenced choices 4개 버튼이 D200H에 표시되었나요?"
header: "5. Fenced"
options:
  - label: "Pass"   description: "4개 버튼 정상 표시됨"
  - label: "Fail"   description: "버튼 없음 또는 잘못 표시됨"
multiSelect: false
```

Record result.

---

### Step 6: Binary Choice with Em-Dash — v0.5.5 Fix Verification

Read `.dj-test/fixtures/step6-binary-emdash.txt` using the Read tool, then output its content VERBATIM. No prefix/suffix. End message. Do NOT call AskUserQuestion.

**Expected**: D200H shows 2 choice buttons. This was the v0.5.5 bug — binary choices with one em-dash item were incorrectly filtered.

Wait for user response. Then ask Pass/Fail:

```
question: "Step 6/7 — Binary choice (em-dash 포함) 2개 버튼이 D200H에 표시되었나요?"
header: "6. Binary"
options:
  - label: "Pass"   description: "2개 버튼 정상 표시됨"
  - label: "Fail"   description: "버튼 없음 (em-dash 필터 오동작)"
multiSelect: false
```

Record result.

---

### Step 7: Long Description Choices — Truncation Check

Read `.dj-test/fixtures/step7-long-description.txt` using the Read tool, then output its content VERBATIM. No prefix/suffix. End message. Do NOT call AskUserQuestion.

**Expected**: D200H shows 3 choice buttons with labels truncated to 30 chars. Long descriptions should not prevent detection.

Wait for user response. Then ask Pass/Fail:

```
question: "Step 7/7 — 긴 설명의 3개 선택 버튼이 D200H에 표시되었나요?"
header: "7. Long"
options:
  - label: "Pass"   description: "3개 버튼 정상 표시됨 (레이블 잘림 OK)"
  - label: "Fail"   description: "버튼 없음 또는 표시 문제"
multiSelect: false
```

Record result.

---

## Cleanup & Results

After all 7 steps, clean up fixtures:

```bash
rm -rf .dj-test/
```

Then print results table:

```
## Choice Format 스트레스 테스트 결과

| # | 테스트 | 유형 | 기대 동작 | 결과 |
|---|--------|------|-----------|------|
| 1 | OMC Autopilot Plan | 오탐 방지 | 버튼 없음 (awaiting) | Pass/Fail |
| 2 | Superpowers Analysis | 오탐 방지 | 버튼 없음 (awaiting) | Pass/Fail |
| 3 | Multi-Agent Pipeline | 오탐 방지 | 버튼 없음 (awaiting) | Pass/Fail |
| 4 | Real Choices | 감지 필수 | 3개 버튼 표시 | Pass/Fail |
| 5 | Fenced Choices | 우선 감지 | 4개 버튼 표시 | Pass/Fail |
| 6 | Binary + Em-Dash | v0.5.5 검증 | 2개 버튼 표시 | Pass/Fail |
| 7 | Long Description | 트렁케이션 | 3개 버튼 표시 | Pass/Fail |
```

End with:
> 테스트 완료! 픽스처 정리됨. 오탐 방지 (1-3) + 정상 감지 (4-7) 모든 케이스에서 기대 동작과 일치하면 choice-format 로직이 정상입니다.

Do NOT ask follow-up questions after results.
