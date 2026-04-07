---
name: dj-test
description: Sequential test harness for claude-dj features — binary choice, single choice, multi-choice, processing state, awaiting state, idle state. Run after D200H setup to verify all deck interactions.
user_invocable: true
---

# Claude DJ — Feature Test Harness

Run all claude-dj deck features in sequence. Each step verifies one capability and records Pass/Fail before moving on.

## Instructions

Follow steps 1–6 in order. Do NOT skip steps. After each step, wait for the user's Pass/Fail response before continuing.

Announce at the start:
> **Claude DJ 테스트 시작** — 6단계 순차 테스트를 진행합니다.

---

### Step 1: Binary Choice (2-option single select)

Call `AskUserQuestion` with exactly 2 options:

```
question: "Step 1/6 — 바이너리 선택: 버튼 두 개가 D200H에 표시되나요?"
header: "1. Binary"
options:
  - label: "Pass"   description: "두 개 버튼이 정상 표시됨"
  - label: "Fail"   description: "표시 안 됨 또는 문제 있음"
multiSelect: false
```

Record the result, then proceed to Step 2.

---

### Step 2: Single Choice (4-option single select)

Call `AskUserQuestion` with 4 options:

```
question: "Step 2/6 — 초이스: 4개 옵션 중 하나를 선택해주세요"
header: "2. Choice"
options:
  - label: "Option A"   description: "첫 번째 옵션"
  - label: "Option B"   description: "두 번째 옵션"
  - label: "Option C"   description: "세 번째 옵션"
  - label: "Option D"   description: "네 번째 옵션"
multiSelect: false
```

After the user selects, confirm which option was received and ask:

```
question: "Step 2/6 — 선택한 옵션이 정확히 전달되었나요?"
header: "2. Verify"
options:
  - label: "Pass"   description: "선택이 정확히 전달됨"
  - label: "Fail"   description: "잘못된 옵션이 전달됨"
multiSelect: false
```

Record the result, then proceed to Step 3.

---

### Step 3: Multi Choice (4-option multi select)

Call `AskUserQuestion` with `multiSelect: true`:

```
question: "Step 3/6 — 멀티초이스: 여러 개를 동시에 선택해주세요"
header: "3. Multi"
options:
  - label: "항목 A"   description: "첫 번째 항목"
  - label: "항목 B"   description: "두 번째 항목"
  - label: "항목 C"   description: "세 번째 항목"
  - label: "항목 D"   description: "네 번째 항목"
multiSelect: true
```

After the user selects, confirm which items were received and ask:

```
question: "Step 3/6 — 복수 선택이 정확히 전달되었나요?"
header: "3. Verify"
options:
  - label: "Pass"   description: "복수 선택이 모두 정확히 전달됨"
  - label: "Fail"   description: "선택이 누락되거나 잘못 전달됨"
multiSelect: false
```

Record the result, then proceed to Step 4.

---

### Step 4: Processing State

Tell the user:
> **Step 4/6 — Processing 상태 테스트**: 5초간 작업을 실행합니다. D200H에서 processing 상태가 표시되는지 확인해주세요.

Run a 5-second sleep using Bash:
```bash
sleep 5 && echo "processing test done"
```

Then ask:

```
question: "Step 4/6 — Processing 상태가 D200H에 표시되었나요?"
header: "4. Processing"
options:
  - label: "Pass"   description: "processing 상태가 정상 표시됨"
  - label: "Fail"   description: "상태 변화 없음 또는 문제 있음"
multiSelect: false
```

Record the result, then proceed to Step 5.

---

### Step 5: Awaiting State

Tell the user:
> **Step 5/6 — Awaiting 상태 테스트**: 지금 이 메시지를 보고 있는 상태가 awaiting입니다. D200H에서 awaiting 상태가 표시되는지 확인해주세요.

Then ask:

```
question: "Step 5/6 — Awaiting 상태가 D200H에 표시되나요?"
header: "5. Awaiting"
options:
  - label: "Pass"   description: "awaiting 상태가 정상 표시됨"
  - label: "Fail"   description: "상태 변화 없음 또는 문제 있음"
multiSelect: false
```

Record the result, then proceed to Step 6.

---

### Step 6: Idle State

Tell the user:
> **Step 6/6 — Idle 상태 테스트**: 이 테스트가 끝나면 아무 입력 없이 대기 상태로 들어갑니다. D200H에서 idle 상태로 전환되는지 약 10초간 관찰해주세요.

Then ask:

```
question: "Step 6/6 — 이 응답 이후 idle 상태를 확인할 준비가 되었나요?"
header: "6. Idle"
options:
  - label: "준비 완료"   description: "idle 확인할 준비됨"
  - label: "잠시 대기"   description: "아직 준비 안 됨"
multiSelect: false
```

If "잠시 대기" is selected, wait and re-ask. If "준비 완료", proceed to results.

---

## Results

After all 6 steps, print a results table:

```
## Claude DJ 테스트 결과

| # | 테스트 | 결과 |
|---|--------|------|
| 1 | Binary Choice (2-option) | Pass/Fail |
| 2 | Single Choice (4-option) | Pass/Fail |
| 3 | Multi Choice (multi-select) | Pass/Fail |
| 4 | Processing State | Pass/Fail |
| 5 | Awaiting State | Pass/Fail |
| 6 | Idle State | (확인 필요 — 응답 종료 후 관찰) |
```

End with:
> 테스트 완료! Idle 상태는 이 메시지 이후 D200H에서 직접 확인해주세요.

Do NOT ask any follow-up questions after the results — let the session go idle so Step 6 can be verified.
