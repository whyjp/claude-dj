---
name: dj-stress
description: Auto-judged stress test for choice detection. Iterates .dj-test/fixtures/**, outputs each verbatim, fetches /api/deck-state + /api/logs to classify Pass/Fail without per-step user confirmation. Final summary only.
user_invocable: true
---

# Claude DJ — Stress Test (Auto-Judged)

Runs every fixture under `.dj-test/fixtures/` through the live stop-hook pipeline and classifies each result automatically. The user only confirms the final summary — no Pass/Fail buttons between fixtures.

**CRITICAL RULES**
- Fixture output steps must end WITHOUT calling AskUserQuestion (the stop hook's detection is what we are testing).
- Output each fixture VERBATIM — no prefix, no suffix, no commentary.
- Between fixtures, sleep 1 second, then GET `/api/deck-state` and `/api/logs?source=hooks&since=<stepStart>`.
- If `/api/deck-state` shows `preset === 'choice'`, the stop-hook is holding an HTTP request open — cancel it by POSTing to `/api/hook/stop-reset` (if that endpoint does not exist, typing any response in the terminal will close it).
- NO tool calls during fixture-output steps except the `Read` that loads fixture text.

## Setup Phase

1. Capture the run start timestamp:

```bash
RUN_START=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
echo "$RUN_START"
```

2. Announce:
> **DJ Stress Test 시작** — 39개 fixture 자동 판정 진행.

3. Confirm prerequisites:
```bash
test -d .dj-test/fixtures || { echo "fixtures missing"; exit 1; }
curl -sf http://localhost:39200/api/status > /dev/null || { echo "bridge not running"; exit 1; }
```

## Iteration

Process fixtures in this order:

1. `.dj-test/fixtures/step1-autopilot-plan.txt` (expected: no buttons — `detect: false`)
2. `.dj-test/fixtures/step2-analysis-report.txt`
3. `.dj-test/fixtures/step3-team-pipeline.txt`
4. `.dj-test/fixtures/step4-real-choices.txt` (expected: 3 buttons)
5. `.dj-test/fixtures/step5-fenced-choices.txt`
6. `.dj-test/fixtures/step6-binary-emdash.txt`
7. `.dj-test/fixtures/step7-long-description.txt`
8. `.dj-test/fixtures/nd/*.txt` (10 fixtures, alphabetical)
9. `.dj-test/fixtures/pd/*.txt` (10 fixtures)
10. `.dj-test/fixtures/ex/*.txt` (7 fixtures)
11. `.dj-test/fixtures/pl/*.txt` (5 fixtures)

Total: 39 fixtures.

### Per-fixture procedure

For each fixture path `$F`:

1. Capture step start:
   ```bash
   STEP_START=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
   ```

2. Load expectation:
   ```bash
   EXPECT=$(cat "${F%.txt}.expect.json")
   ```
   Parse `detect` (boolean). If `detect: true`, also capture `choices` (array).

3. Read the fixture content via the `Read` tool. Hold the text in memory.

4. **Output the fixture text as your next message body.** No wrapping, no explanation, end the message — do NOT call AskUserQuestion.

5. After the stop hook fires (bridge processes the response), wait:
   ```bash
   sleep 1
   ```

6. Probe:
   ```bash
   DECK=$(curl -s http://localhost:39200/api/deck-state)
   LOGS=$(curl -s "http://localhost:39200/api/logs?source=hooks&since=$STEP_START&n=100")
   ```

7. Classify:
   - If `expected.detect === true`: PASS iff `DECK.preset === 'choice'` AND the deck's choice count equals `expected.choices.length`.
   - If `expected.detect === false`: PASS iff `DECK.preset !== 'choice'`.
   - Otherwise FAIL.

8. Record `{ fixture: $F, expected, actual: { preset, choiceCount }, pass, logs }` into an in-memory results array.

9. If `DECK.preset === 'choice'` (the hook is holding proxy), reset before the next iteration:
   ```bash
   curl -X POST http://localhost:39200/api/hook/stop-reset 2>/dev/null || true
   ```

   Then continue. **Do NOT ask the user Pass/Fail per fixture.**

## Summary

After all 39 fixtures:

```markdown
## DJ Stress Test Results

| Category | Total | Pass | Fail |
|----------|-------|------|------|
| original (step1-7) | 7 | X | Y |
| nd/ (negative)     | 10 | X | Y |
| pd/ (positive)     | 10 | X | Y |
| ex/ (edge)         | 7 | X | Y |
| pl/ (plan-mode)    | 5 | X | Y |
| **Total**          | **39** | **X** | **Y** |

Accuracy: (X / 39) × 100 = Z%
Target: ≥ 95% agreement with Layer 1 (`node tools/dj-parse.js --all`).
```

If any fixtures FAIL, list them with the deck preset and the last 3 `[choiceParser]` log entries.

End with a single AskUserQuestion to confirm:

```
question: "Stress Test 결과 확인되었나요?"
header: "Stress"
options:
  - label: "OK"      description: "결과 확인"
  - label: "재실행"   description: "다시 돌려야 함"
multiSelect: false
```

If "OK" selected, end the skill. If "재실행", clear results and start Iteration again.

Do NOT perform any follow-up action beyond the summary and single confirmation.
