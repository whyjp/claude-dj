---
name: dj-choice-test
description: Interactive choice-format stress test — verifies stop hook choice detection, false-positive filtering, fenced choices, and freeze-prevention across complex text patterns on the deck.
user_invocable: true
---

# Claude DJ — Choice Format Stress Test

Test the stop hook's choice detection logic with complex text patterns. Each step outputs a specific text pattern **without AskUserQuestion**, then checks whether the deck correctly detected or filtered the choices.

**CRITICAL**: Steps 1-5 must end WITHOUT calling AskUserQuestion — the point is to test the stop hook's regex/fenced detection. Only the Pass/Fail verification after each step uses AskUserQuestion.

## Instructions

Follow steps 1–5 in order. After each step, wait for the user's Pass/Fail before continuing.

Announce at the start:
> **Choice Format 스트레스 테스트 시작** — 5단계 순차 테스트를 진행합니다. 각 단계에서 D200H의 반응을 확인해주세요.

---

### Step 1: Plan Output — False Positive Prevention

Output this EXACT text, then END your message. Do NOT call AskUserQuestion.

```
구현 계획:

1. choiceParser.js 수정 — looksLikeExplanation 로직 변경
2. stopParser.test.js 업데이트 — 새 테스트 케이스 추가
3. 버전 범프 — 0.5.5 → 0.5.6

진행하겠습니다.
```

**Expected**: D200H shows awaiting state (NOT choice buttons). The em-dash markers should trigger the explanation filter. If choice buttons appear, the stop hook falsely detected choices and the session will FREEZE (proxy mode holds HTTP open waiting for a button press that shouldn't exist).

Wait for user response. Then ask Pass/Fail:

```
question: "Step 1/5 — Plan output에서 choice 버튼이 나타나지 않았나요? (awaiting 상태 = 정상)"
header: "1. Plan"
options:
  - label: "Pass"   description: "awaiting 상태 — 선택 버튼 없음 (정상)"
  - label: "Fail"   description: "선택 버튼이 나타남 (오탐지) 또는 프리즈됨"
multiSelect: false
```

Record result.

---

### Step 2: Real Choices — Detection Required

Output this EXACT text, then END your message. Do NOT call AskUserQuestion.

```
어떤 방식으로 진행할까요?

1. 전체 리팩터링
2. 부분 수정
3. 현재 상태 유지
```

**Expected**: D200H shows 3 choice buttons via stop hook proxy. These are real choices (no explanation markers, question at end). If the user presses a button, the stop hook receives the selection and blocks with it. If no buttons appear, the regex detection failed.

**IMPORTANT**: The user should press a button on the deck OR type their response in the terminal. Either way works — the stop hook proxy has a 2-minute timeout.

Wait for user response (button press or typed input). Then ask Pass/Fail:

```
question: "Step 2/5 — 3개의 선택 버튼이 D200H에 표시되었나요?"
header: "2. Detect"
options:
  - label: "Pass"   description: "3개 버튼 정상 표시됨"
  - label: "Fail"   description: "버튼 없음 또는 잘못 표시됨"
multiSelect: false
```

Record result.

---

### Step 3: Fenced Choices — Priority Detection

Output this EXACT text, then END your message. Do NOT call AskUserQuestion.

```
분석이 완료되었습니다. 다음 중 선택해주세요:

[claude-dj-choices]
1. 커밋하고 푸시
2. 추가 수정
3. 변경사항 되돌리기
4. 리뷰 요청
[/claude-dj-choices]
```

**Expected**: D200H shows 4 choice buttons. Fenced choices have priority over regex detection and should be detected with 100% accuracy.

Wait for user response. Then ask Pass/Fail:

```
question: "Step 3/5 — Fenced choices 4개 버튼이 D200H에 표시되었나요?"
header: "3. Fenced"
options:
  - label: "Pass"   description: "4개 버튼 정상 표시됨"
  - label: "Fail"   description: "버튼 없음 또는 잘못 표시됨"
multiSelect: false
```

Record result.

---

### Step 4: Binary Choice with Em-Dash — v0.5.5 Fix Verification

Output this EXACT text, then END your message. Do NOT call AskUserQuestion.

```
이 변경사항을 적용할까요?

1. 적용 — 테스트 통과 확인됨
2. 취소
```

**Expected**: D200H shows 2 choice buttons. This was the v0.5.5 bug — binary choices with one em-dash item were incorrectly filtered. After the fix, only-one-marker binary lists should be detected as choices.

Wait for user response. Then ask Pass/Fail:

```
question: "Step 4/5 — Binary choice (em-dash 포함) 2개 버튼이 D200H에 표시되었나요?"
header: "4. Binary"
options:
  - label: "Pass"   description: "2개 버튼 정상 표시됨"
  - label: "Fail"   description: "버튼 없음 (em-dash 필터 오동작)"
multiSelect: false
```

Record result.

---

### Step 5: Long Description Choices — Truncation Check

Output this EXACT text, then END your message. Do NOT call AskUserQuestion.

```
아키텍처 결정이 필요합니다:

1. 모놀리식 서버로 통합하고 마이크로서비스 전환은 나중에 진행
2. 처음부터 마이크로서비스로 설계하고 각 서비스별 독립 배포 구성
3. 하이브리드 접근법으로 핵심 서비스만 분리하고 나머지는 모놀리식 유지
```

**Expected**: D200H shows 3 choice buttons with labels truncated to 30 chars. Long descriptions should not prevent detection.

Wait for user response. Then ask Pass/Fail:

```
question: "Step 5/5 — 긴 설명의 3개 선택 버튼이 D200H에 표시되었나요?"
header: "5. Long"
options:
  - label: "Pass"   description: "3개 버튼 정상 표시됨 (레이블 잘림 OK)"
  - label: "Fail"   description: "버튼 없음 또는 표시 문제"
multiSelect: false
```

Record result.

---

## Results

After all 5 steps, print a results table:

```
## Choice Format 스트레스 테스트 결과

| # | 테스트 | 기대 동작 | 결과 |
|---|--------|-----------|------|
| 1 | Plan Output (false positive) | 버튼 없음 (awaiting) | Pass/Fail |
| 2 | Real Choices (detection) | 3개 버튼 표시 | Pass/Fail |
| 3 | Fenced Choices (priority) | 4개 버튼 표시 | Pass/Fail |
| 4 | Binary + Em-Dash (v0.5.5) | 2개 버튼 표시 | Pass/Fail |
| 5 | Long Description (truncation) | 3개 버튼 표시 | Pass/Fail |
```

End with:
> 테스트 완료! 모든 케이스에서 기대 동작과 일치하면 choice-format 로직이 정상입니다.

Do NOT ask follow-up questions after results.
