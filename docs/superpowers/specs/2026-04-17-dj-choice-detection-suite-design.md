# claude-dj — Choice Detection Test & Debug Suite

**Date:** 2026-04-17
**Status:** Design approved — ready for implementation plan

## Goal

Eliminate choice-detection regressions (False Negatives and False Positives) in `claude-plugin/hooks/choiceParser.js` by building a three-layer test and debug suite that combines fast parser-only unit runs, live integration verification on the deck, and structured filter-decision logging. The suite must catch at minimum the observed regression where bold-prefixed choices with em-dash explanations (e.g. `**A.** — description`) are over-filtered and dropped.

## Motivation

Choice detection has been iterated ad-hoc (v0.5.1, v0.5.5, v0.6.0, v0.6.1), each fix addressing one regression while risking new ones. There is no corpus of positive/negative fixtures, no way to debug why a specific line was rejected, and no automated way to diagnose failures without manual deck observation. A live reproduction during the brainstorming session (a bold-option list with em-dash explanations failed to render on the deck) confirmed the gap.

## Scope

### In scope
- New parser-only CLI runner (`tools/dj-parse.js`) with fixture/expectation pairs
- New stress-test skill (`claude-plugin/skills/dj-stress/`) that auto-judges via bridge APIs
- Structured `[filter-decision]` logging in `choiceParser.js`, piped through existing ring buffer
- ~32 static fixtures organized by category (negative, positive, edge, plan-mode)
- Dynamic fixture generator with seeded reproducibility
- HTML report script for CI-style summaries
- README updates describing the suite

### Out of scope
- Rewriting the stop hook protocol (only `choiceParser.js` is touched)
- Changes to the deck renderer (`public/js/d200-renderer.js`)
- Bridge WebSocket protocol changes
- Non-regression changes to `permission.js` / `userPrompt.js` hooks

## Architecture

Three independent layers sharing the same fixture corpus:

```
Layer 1 (Unit)          Layer 2 (Integration)        Layer 3 (Instrumentation)
┌─────────────────┐     ┌───────────────────────┐    ┌──────────────────────┐
│ tools/          │     │ claude-plugin/skills/ │    │ hooks/choiceParser.js│
│   dj-parse.js   │     │   dj-stress/SKILL.md  │    │   + [filter-decision]│
│                 │     │                       │    │   structured logs    │
│ Parser only     │ ──▶ │ Live session + deck   │ ◀──│ logger ring buffer   │
│ expect.json     │     │ /api/logs auto-judge  │    │ /api/logs            │
└─────────────────┘     └───────────────────────┘    └──────────────────────┘
```

- **Layer 1 (Unit — `tools/dj-parse.js`):** Loads `choiceParser.js` as a module and runs it against a fixture `.txt`. Compares against `<name>.expect.json`. Exit code 0 on full pass. Runnable in CI without deck or bridge.
- **Layer 2 (Integration — `dj-stress` skill):** Orchestrates live session output of each fixture, fetches `/api/deck-state` and `/api/logs` after each step, and automatically compares against the expectation. User only confirms the final summary table — no per-step Pass/Fail button press.
- **Layer 3 (Instrumentation — `choiceParser.js` changes):** Emits one structured log entry per filter decision (phase, line, accept/reject, rule name, reason). Flows through existing `logger.js` ring buffer and appears in `/api/logs` and `claude-plugin/logs/hooks.log`.

## File Layout

```
tools/
  dj-parse.js                        [NEW]
  dj-stress-gen.js                   [NEW]

.dj-test/
  fixtures/
    nd/ 01-autopilot-plan.txt        [NEW] + .expect.json
    nd/ 02-analysis-report.txt       [NEW]
    nd/ 03-team-pipeline.txt         [NEW]
    nd/ 04-todo-checklist.txt        [NEW]
    nd/ 05-commit-log.txt            [NEW]
    nd/ 06-release-notes.txt         [NEW]
    nd/ ...                          (total 10)
    pd/ 01-bare-numbered.txt         [NEW]
    pd/ 02-bold-prefix.txt           [NEW]
    pd/ 03-dash-prefix.txt           [NEW]
    pd/ 04-fenced-block.txt          [NEW]
    pd/ 05-mixed-lang.txt            [NEW]
    pd/ ...                          (total 10)
    ex/ 01-bold-plus-emdash.txt      [NEW] (Q2 live repro)
    ex/ 02-choice-with-explanation.txt
    ex/ 03-preamble-then-choice.txt
    ex/ 04-choice-then-postamble.txt
    ex/ ...                          (total 7)
    pl/ 01-exitplan-numbered.txt     [NEW]
    pl/ 02-plan-with-subtasks.txt    [NEW]
    pl/ ...                          (total 5)
    dy/                              (generated at runtime)

claude-plugin/
  skills/dj-stress/SKILL.md          [NEW]
  hooks/choiceParser.js              [MOD] pipeline + [filter-decision]
  bridge/server.js                   [MOD] /api/logs gains ?category=... query filter

scripts/
  dj-test-report.js                  [NEW] consumes Layer 1 JSON → HTML
```

## Components

### `tools/dj-parse.js`

**Input:** fixture path or `--all`. Optional `--seed=N` for dynamic runs, `--json` for machine-readable.
**Output:** per-fixture JSON result + aggregate summary.
**Exit code:** 0 if all match, 1 otherwise.

Sample output:

```json
{
  "fixture": "ex/01-bold-plus-emdash.txt",
  "expected": { "detect": true, "choices": ["A...", "B..."] },
  "actual":   { "detect": true, "choices": ["A...", "B..."], "rule": "bold-with-emdash" },
  "pass": true
}
```

### Fixture `.expect.json`

```json
{
  "detect": true,
  "choices": ["커밋하고 푸시", "추가 수정", "변경사항 되돌리기", "리뷰 요청"],
  "expectedRule": "fenced-block",
  "notes": "Fenced block takes priority over regex"
}
```

For negative fixtures:

```json
{
  "detect": false,
  "expectedRejectionReason": "em-dash-with-file-reference",
  "notes": "OMC autopilot plan with file:line references"
}
```

### `tools/dj-stress-gen.js` — Dynamic generator

Eight-axis stratified sampling. Default 10 samples per run, seeded for reproducibility.

| Axis | Values |
|---|---|
| language | ko / en / mixed |
| option count | 2 / 3 / 4 / 7 |
| prefix | bare `1.` / bold `**1.**` / dash `- 1.` / paren `1)` |
| explanation | none / em-dash `—` / paren `(...)` / colon `: ...` |
| preamble | none / short / long / analysis-block |
| postamble | none / short summary / question |
| fence | no / yes `[claude-dj-choices]` |
| label length | short <20 / medium 20–40 / long 40–80 |

Expectation rules applied during generation:
- `fence=yes` → `detect: true`
- `preamble=analysis-block` AND `prefix=bare` AND `explanation=emdash` → `detect: false`
- `prefix ∈ {bold, dash}` AND `explanation ≠ none` → `detect: true` (v0.6.1+ zone)
- otherwise bare numbered + clear question end → `detect: true`

### `claude-plugin/skills/dj-stress/SKILL.md`

Orchestrates integration runs. For each fixture:
1. Read fixture verbatim (Read tool), output as message content, end without AskUserQuestion.
2. Sleep 500 ms, GET `/api/deck-state` + GET `/api/logs?since=<step-start>`.
3. Compare deck state (choice buttons present? count matches?) against expectation.
4. Append to in-memory results table. No Pass/Fail button from the user per step.
5. After all steps: clean up `.dj-test/dy/`, print final table with accuracy percentage.

User only confirms or queries the final summary. Auto-judge accuracy target ≥ 95 %.

### `choiceParser.js` pipeline reorganization

Current ad-hoc filtering becomes explicit stages:

```
Stage 1: Fence extraction
  [claude-dj-choices]...[/claude-dj-choices]
  matched → return choices (highest priority)

Stage 2: Candidate extraction
  Regex sweep for 1./- 1./**1.**/1)/etc → candidate line array

Stage 3: Filter pipeline (one [filter-decision] log per decision)
  3a. explanation-marker filter
        reject if em-dash AND (file:line reference OR code block OR description > 40 chars)
        KEEP if em-dash with short label-only explanation    ← Q2 fix
  3b. outline-marker filter
        reject if nested bullets, multi-line subtasks
  3c. context filter
        check last_assistant_message for question shape
  3d. quality gate
        2 ≤ choices ≤ 10, label length bounds

Stage 4: Emit
  { detect, choices, rule, trace: [...decisions] }
```

Each filter decision emits:

```json
{
  "phase": "3a",
  "line": "2. executor — bridge/server.js 리팩터링",
  "accept": false,
  "rule": "explanationFilter",
  "reason": "em-dash-with-file-reference",
  "detail": "matched /\\b[a-z]+\\.js:\\d+/ at offset 23"
}
```

### `scripts/dj-test-report.js`

Consumes Layer 1 JSON output (stdin or `--input=file`), emits `dj-test-report.html` with:
- Per-category pass/fail summary
- Failing fixture list with expected vs actual diff
- Filter-decision trace from embedded logs

## Data Flow

```
[Claude message]
   ↓
stop hook (hooks/stop.js)
   ↓
choiceParser.js
   ├─ Stage 1 / 2 / 3 / 4
   └─ each decision → logger.emit('filter-decision', {...})
                            ↓
                      ring buffer
                            ↓
                      /api/logs?category=filter-decision
                            ↓
                      dj-stress skill ← auto-judge
                            ↓
                      summary table

(parallel path)
tools/dj-parse.js → require('choiceParser') → same pipeline
                                              → same trace (in-memory)
                                              → compare vs .expect.json
                                              → exit 0/1
```

## Implementation Order

Seven steps, one commit per step, version bump per CLAUDE.md rules.

1. **Layer 1 skeleton.** `tools/dj-parse.js` + `.expect.json` pairs for existing `.dj-test/fixtures/step1–7`. Uses current `choiceParser.js` unchanged. Some fixtures expected to FAIL (including Q2) — this captures the baseline. Bump **v0.6.5-dev.1** (pre-release marker so CLAUDE.md bump rule is honored without claiming a user-facing change).
2. **Layer 3 instrumentation.** Reorganize `choiceParser.js` into explicit stages and emit `[filter-decision]` logs. Functional behavior unchanged; Layer 1 still shows same FAIL set but with richer traces. Bump **v0.6.5**.

3. **Layer 1 fixture expansion.** Create `nd/`, `pd/`, `ex/`, `pl/` directories with 32 static fixtures and `.expect.json` pairs. Run `dj-parse --all` to crystallize the FAIL list (regression spec). Bump **v0.6.5.1** (patch — test corpus only, no runtime change).
4. **Parser fix.** Adjust Stage 3a (`explanationFilter`) so em-dash without file reference / long description is kept. Other stages unchanged. Target: Layer 1 32/32 PASS, including Q2. Bump **v0.6.6**.
5. **Layer 2 skill.** Author `dj-stress/SKILL.md` that iterates fixtures, fetches deck/log APIs, auto-judges. Bump **v0.6.7**.
6. **Dynamic generator.** `tools/dj-stress-gen.js` with seeded sampling, integrated into `dj-stress` (step block "dynamic"). Verify `--seed=42` twice → identical output. Bump **v0.6.8**.
7. **Report & docs.** `scripts/dj-test-report.js` (HTML) + README section for the suite. Bump **v0.6.9**.

## Verification Gates

| Step | Gate |
|---|---|
| 1 | `node tools/dj-parse.js .dj-test/fixtures/step4-real-choices.txt` emits valid JSON; `--all` runs without crash |
| 2 | `/api/logs?category=filter-decision` returns entries after a stop-hook invocation |
| 3 | `dj-parse --all` output lists exactly the expected FAIL set (includes Q2) |
| 4 | `dj-parse --all` → 32/32 PASS |
| 5 | `/dj-stress` run’s auto-judge verdict matches Layer 1 verdict on the same fixtures |
| 6 | Two seeded runs produce byte-identical fixture content |
| 7 | HTML report generated from Layer 1 output; README section merged |

## Risks and Mitigations

1. **Hidden dependencies in `choiceParser.js` — refactor risk.** Reorganizing stages (Step 2) could break existing cases not in the corpus. Mitigation: Step 1 freezes current behavior into `.expect.json` first; Step 2 changes shape (pipeline + logs) but not decisions — any Step 2 diff vs Step 1 is a bug.
2. **Dynamic generator misclassification.** Generator’s expectation rules could disagree with what the parser *should* do. Mitigation: keep generator rules deterministic and simple; treat disagreements as evidence the parser rule (or the generator rule) needs refining — flag, don’t auto-pass.
3. **Auto-judge races on deck state.** `/api/deck-state` may not reflect the latest render when polled. Mitigation: 500 ms initial delay, retry up to 2 times with exponential back-off.
4. **`[filter-decision]` log volume.** Could flood ring buffer under stress. Mitigation: gate behind `DJ_DEBUG_FILTER=1` env var for Layer 2; always on for Layer 1 (runs in isolation).

## Success Criteria

- Layer 1: `node tools/dj-parse.js --all` → 32/32 pass with exit code 0
- Layer 2: `/dj-stress` auto-judge ≥ 95 % accuracy vs Layer 1 verdict
- Layer 3: every fixture’s trace is inspectable via `/api/logs?category=filter-decision`
- Q2 regression fixed: bold + em-dash + short-label list renders choice buttons on the deck
- No regression on existing positive corpus (step1–7, v0.6.1 dash/bold tests)

## Out-of-Scope (Deferred)

- Hooking Layer 1 into a GitHub Action (CI) — can be added after Step 7 if desired
- Extending the pipeline to handle lettered lists (A. / B. / a) ) beyond current support
- UI surfacing of filter traces inside the dashboard — only CLI/HTML for now
