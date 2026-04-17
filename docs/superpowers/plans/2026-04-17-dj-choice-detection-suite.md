# DJ Choice Detection Test & Debug Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-layer test and debug suite that eliminates choice-detection regressions (False Negatives and False Positives) in `claude-plugin/hooks/choiceParser.js`, anchored by a fixture corpus, parser-only CLI, live integration skill, and structured filter-decision logging.

**Architecture:** Layer 1 is a pure parser runner (`tools/dj-parse.js`) that compares parser output against `.expect.json` files. Layer 2 is a stress skill (`claude-plugin/skills/dj-stress/`) that drives the live session and auto-judges via `/api/logs` + `/api/deck-state`. Layer 3 instruments `choiceParser.js` with a `trace` callback so the same decision stream powers both layers.

**Tech Stack:** Node.js 20 (ESM), existing `claude-plugin/bridge` (Express) and `claude-plugin/hooks` (stdin-JSON shell hooks), markdown skills (YAML frontmatter + body).

**Design spec:** `docs/superpowers/specs/2026-04-17-dj-choice-detection-suite-design.md`

---

## File Structure

Files created or modified by this plan:

- `claude-plugin/hooks/choiceParser.js` — modified: accept `{ trace }` option, emit per-decision records
- `claude-plugin/hooks/stop.js` — modified: pass trace callback that forwards to `hookLog`
- `claude-plugin/bridge/server.js` — modified: `/api/logs` gains `?source=hooks&since=<iso>` tail mode
- `tools/dj-parse.js` — new: CLI entry point for Layer 1
- `tools/dj-stress-gen.js` — new: eight-axis fixture generator
- `tools/_fixture-runner.js` — new: shared fixture loader used by both tools
- `.dj-test/fixtures/<name>.expect.json` — new: expectation files for each fixture
- `.dj-test/fixtures/nd/*.txt` — new: 10 negative fixtures
- `.dj-test/fixtures/pd/*.txt` — new: 10 positive fixtures
- `.dj-test/fixtures/ex/*.txt` — new: 7 edge fixtures (includes Q2 repro)
- `.dj-test/fixtures/pl/*.txt` — new: 5 plan-mode fixtures
- `claude-plugin/skills/dj-stress/SKILL.md` — new: integration stress-test skill
- `scripts/dj-test-report.js` — new: HTML report generator
- `README.md` — modified: reference to the suite
- `package.json` + cascading version files — modified per CLAUDE.md bump rules

---

## Task 1: Layer 1 Skeleton — `dj-parse.js` CLI + baseline expectations

Anchor the parser to the existing seven fixtures before changing any runtime code. This pins current behavior (including the Q2 FAIL) so later refactors can't silently drift.

**Files:**
- Create: `tools/dj-parse.js`
- Create: `tools/_fixture-runner.js`
- Create: `.dj-test/fixtures/step1-autopilot-plan.expect.json`
- Create: `.dj-test/fixtures/step2-analysis-report.expect.json`
- Create: `.dj-test/fixtures/step3-team-pipeline.expect.json`
- Create: `.dj-test/fixtures/step4-real-choices.expect.json`
- Create: `.dj-test/fixtures/step5-fenced-choices.expect.json`
- Create: `.dj-test/fixtures/step6-binary-emdash.expect.json`
- Create: `.dj-test/fixtures/step7-long-description.expect.json`

### Steps

- [ ] **Step 1.1: Create `tools/_fixture-runner.js` (shared loader)**

```js
// tools/_fixture-runner.js
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PARSER_PATH = path.resolve('claude-plugin/hooks/choiceParser.js');

export async function loadParser() {
  const mod = await import(pathToFileURL(PARSER_PATH).href);
  return { parseFencedChoices: mod.parseFencedChoices, parseRegexChoices: mod.parseRegexChoices };
}

export function loadFixture(fixturePath) {
  const text = readFileSync(fixturePath, 'utf8');
  const expectPath = fixturePath.replace(/\.txt$/, '.expect.json');
  let expected = null;
  try { expected = JSON.parse(readFileSync(expectPath, 'utf8')); } catch { /* may be dynamic */ }
  return { text, expected, path: fixturePath, expectPath };
}

export function discoverFixtures(root) {
  const results = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (p.endsWith('.txt')) results.push(p);
    }
  }
  walk(root);
  return results.sort();
}

export async function runFixture(fixturePath) {
  const { parseFencedChoices, parseRegexChoices } = await loadParser();
  const { text, expected } = loadFixture(fixturePath);
  const trace = [];
  const collect = (d) => trace.push(d);

  // Parser currently ignores trace — Task 2 wires it. Both calls tolerated.
  const fenced = parseFencedChoices(text, { trace: collect });
  const regex = fenced ? null : parseRegexChoices(text, { trace: collect });
  const choices = fenced || regex;

  const actual = {
    detect: choices !== null && choices.length > 0,
    choices: choices ? choices.map(c => c.label) : [],
    rule: fenced ? 'fenced-block' : regex ? 'regex-context' : 'none',
    trace,
  };

  const pass = expected
    ? actual.detect === expected.detect &&
      (!expected.choices || sameArray(actual.choices, expected.choices))
    : null;

  return { fixture: path.relative(process.cwd(), fixturePath), expected, actual, pass };
}

function sameArray(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
```

- [ ] **Step 1.2: Create `tools/dj-parse.js` (CLI entry)**

```js
#!/usr/bin/env node
// tools/dj-parse.js — Layer 1 unit runner for choiceParser.js
import path from 'node:path';
import { discoverFixtures, runFixture } from './_fixture-runner.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const targets = args.filter(a => !a.startsWith('--'));
const jsonOut = flags.has('--json');
const all = flags.has('--all');

async function main() {
  const fixtures = all
    ? discoverFixtures(path.resolve('.dj-test/fixtures'))
    : targets.map(t => path.resolve(t));

  if (fixtures.length === 0) {
    console.error('usage: node tools/dj-parse.js <fixture.txt> | --all [--json]');
    process.exit(2);
  }

  const results = [];
  for (const f of fixtures) results.push(await runFixture(f));

  if (jsonOut) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    for (const r of results) {
      const tag = r.pass === null ? 'NOEXP' : r.pass ? 'PASS ' : 'FAIL ';
      console.log(`${tag}  ${r.fixture}  detect=${r.actual.detect} rule=${r.actual.rule}`);
      if (r.pass === false) {
        console.log(`       expected: ${JSON.stringify(r.expected)}`);
        console.log(`       actual:   ${JSON.stringify({ detect: r.actual.detect, choices: r.actual.choices, rule: r.actual.rule })}`);
      }
    }
    const passed = results.filter(r => r.pass === true).length;
    const failed = results.filter(r => r.pass === false).length;
    const noexp = results.filter(r => r.pass === null).length;
    console.log(`\n${passed} pass, ${failed} fail, ${noexp} no-expect  (total ${results.length})`);
  }

  process.exit(results.some(r => r.pass === false) ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
```

- [ ] **Step 1.3: Write expectation files for existing fixtures**

Create `.dj-test/fixtures/step1-autopilot-plan.expect.json`:
```json
{
  "detect": false,
  "expectedRejectionReason": "em-dash-with-file-reference",
  "notes": "Autopilot plan — items have em-dash markers and file:line refs, not choices"
}
```

Create `.dj-test/fixtures/step2-analysis-report.expect.json`:
```json
{
  "detect": false,
  "expectedRejectionReason": "heading-colon-preamble",
  "notes": "Analysis report — preamble ends with ':', substantial aftermath"
}
```

Create `.dj-test/fixtures/step3-team-pipeline.expect.json`:
```json
{
  "detect": false,
  "expectedRejectionReason": "heading-colon-preamble",
  "notes": "Team pipeline plan — heading + em-dash descriptions"
}
```

Create `.dj-test/fixtures/step4-real-choices.expect.json`:
```json
{
  "detect": true,
  "choices": ["전체 리팩터링", "부분 수정", "현재 상태 유지"],
  "expectedRule": "regex-context",
  "notes": "Preamble ends with question mark → real choices"
}
```

Create `.dj-test/fixtures/step5-fenced-choices.expect.json`:
```json
{
  "detect": true,
  "choices": ["커밋하고 푸시", "추가 수정", "변경사항 되돌리기", "리뷰 요청"],
  "expectedRule": "fenced-block",
  "notes": "Fenced block → always detect"
}
```

Create `.dj-test/fixtures/step6-binary-emdash.expect.json`:
```json
{
  "detect": true,
  "choices": ["적용 — 테스트 통과 확인됨", "취소"],
  "expectedRule": "regex-context",
  "notes": "Binary choice with em-dash explanation in one item (v0.5.5 fix)"
}
```

Create `.dj-test/fixtures/step7-long-description.expect.json`:
```json
{
  "detect": true,
  "choices": [
    "모놀리식 서버로 통합하고 마이크로서비스",
    "처음부터 마이크로서비스로 설계하고 각 서",
    "하이브리드 접근법으로 핵심 서비스만 분리"
  ],
  "expectedRule": "regex-context",
  "notes": "Long descriptions truncated to 30 chars (stripMarkdown().slice(0,30))"
}
```

- [ ] **Step 1.4: Run against single fixture to verify CLI works**

Run: `node tools/dj-parse.js .dj-test/fixtures/step4-real-choices.txt`
Expected output includes `PASS   .dj-test/fixtures/step4-real-choices.txt  detect=true rule=regex-context` OR a valid `FAIL` line (if current parser misses it — that informs Task 4). Exit code 0 on pass, 1 on fail.

- [ ] **Step 1.5: Run `--all` to crystallize baseline**

Run: `node tools/dj-parse.js --all`
Expected: a summary like `X pass, Y fail, 0 no-expect  (total 7)`. Record the actual X/Y for the task checklist — the FAIL set is the regression spec.

- [ ] **Step 1.6: Add npm script for convenience**

Modify `package.json`:
```json
{
  "scripts": {
    "dj:parse": "node tools/dj-parse.js",
    "dj:parse:all": "node tools/dj-parse.js --all"
  }
}
```

- [ ] **Step 1.7: Bump version to v0.6.5-dev.1 and commit**

Run: `node scripts/bump-version.js prerelease dev` (if supported) or manually bump to `0.6.5-dev.1` in `package.json` and cascade via existing bump tooling.

If bump-version.js has no prerelease mode, use a simple `patch` bump (becomes 0.6.5) and note "pre-release usage: no user-facing change yet" in commit message.

Commit:
```bash
git add tools/dj-parse.js tools/_fixture-runner.js \
  .dj-test/fixtures/step1-autopilot-plan.expect.json \
  .dj-test/fixtures/step2-analysis-report.expect.json \
  .dj-test/fixtures/step3-team-pipeline.expect.json \
  .dj-test/fixtures/step4-real-choices.expect.json \
  .dj-test/fixtures/step5-fenced-choices.expect.json \
  .dj-test/fixtures/step6-binary-emdash.expect.json \
  .dj-test/fixtures/step7-long-description.expect.json \
  package.json
git commit -m "test: add dj-parse Layer 1 runner with baseline expectations (v0.6.5-dev.1)"
```

---

## Task 2: Layer 3 Instrumentation — `choiceParser.js` pipeline + trace

Reorganize parser into explicit stages and emit a decision trace through an optional callback. Functional behavior must remain unchanged — any diff in Layer 1 verdict versus Task 1 baseline is a bug.

**Files:**
- Modify: `claude-plugin/hooks/choiceParser.js`
- Modify: `claude-plugin/hooks/stop.js`

### Steps

- [ ] **Step 2.1: Replace `choiceParser.js` with staged pipeline (behavior-preserving)**

Rewrite file contents of `claude-plugin/hooks/choiceParser.js`:

```js
// claude-plugin/hooks/choiceParser.js
const FENCE_OPEN = '[claude-dj-choices]';
const FENCE_CLOSE = '[/claude-dj-choices]';
const LINE_RE = /^\s*(?:-\s*)?(?:\*\*)?([A-Za-z0-9]+(?:[a-z])?)[.):\]]\s*(?:\*\*)?\s*(.+)/;

const QUESTION_TAIL_RE = /[?？]\s*$/m;
const CHOICE_KEYWORD_RE =
  /(?:선택|골라|어떤|어느|진행할|할까|주세요|원하시|방식으로|어떻게|결정|필요합니다|which|choose|select|pick|prefer|decide|need)/i;
const HEADING_COLON_RE = /[:：]\s*$/;

function stripMarkdown(text) {
  return text.replace(/\*\*/g, '').replace(/\*/g, '').trim();
}

function noop() {}

function emit(trace, record) {
  if (typeof trace === 'function') trace(record);
}

// ---------- Stage 1: Fence extraction ----------
export function parseFencedChoices(text, { trace } = {}) {
  const lastOpen = text.lastIndexOf(FENCE_OPEN);
  if (lastOpen === -1) {
    emit(trace, { phase: '1-fence', accept: false, reason: 'no-open-tag' });
    return null;
  }
  const contentStart = lastOpen + FENCE_OPEN.length;
  const closeIdx = text.indexOf(FENCE_CLOSE, contentStart);
  if (closeIdx === -1) {
    emit(trace, { phase: '1-fence', accept: false, reason: 'no-close-tag' });
    return null;
  }
  const block = text.slice(contentStart, closeIdx).trim();
  if (!block) {
    emit(trace, { phase: '1-fence', accept: false, reason: 'empty-block' });
    return null;
  }

  const choices = [];
  for (const line of block.split('\n')) {
    const m = line.match(LINE_RE);
    if (m) {
      choices.push({ index: m[1], label: stripMarkdown(m[2]).slice(0, 30) });
    }
    if (choices.length >= 10) break;
  }

  emit(trace, { phase: '1-fence', accept: choices.length > 0, count: choices.length });
  return choices.length > 0 ? choices : null;
}

// ---------- Stage 3c: Context filter (current looksLikeChoices) ----------
function contextAccepts(tail, matches, trace) {
  if (matches.length === 0) return false;

  const firstMatchPos = matches[0].index;
  const lastMatch = matches[matches.length - 1];
  const lastMatchEnd = lastMatch.index + lastMatch[0].length;

  const preamble = tail.slice(0, firstMatchPos).trim();
  const preambleLines = preamble.split('\n').filter((l) => l.trim());
  const lastPreambleLine = preambleLines[preambleLines.length - 1] || '';
  const aftermath = tail.slice(lastMatchEnd).trim();

  if (QUESTION_TAIL_RE.test(lastPreambleLine)) {
    emit(trace, { phase: '3c-context', accept: true, rule: 'question-tail' });
    return true;
  }
  if (CHOICE_KEYWORD_RE.test(preamble)) {
    emit(trace, { phase: '3c-context', accept: true, rule: 'choice-keyword' });
    return true;
  }
  if (HEADING_COLON_RE.test(lastPreambleLine)) {
    emit(trace, { phase: '3c-context', accept: false, rule: 'heading-colon-preamble' });
    return false;
  }
  if (aftermath.length > 50) {
    emit(trace, { phase: '3c-context', accept: false, rule: 'long-aftermath', aftermathLen: aftermath.length });
    return false;
  }
  if (aftermath.length === 0) {
    emit(trace, { phase: '3c-context', accept: true, rule: 'list-at-end' });
    return true;
  }
  emit(trace, { phase: '3c-context', accept: false, rule: 'default-conservative' });
  return false;
}

// ---------- Stages 2 + 3d: Candidate extraction + quality gate ----------
export function parseRegexChoices(text, { trace } = {}) {
  const tail = (text.length > 800 ? text.slice(-800) : text).replace(/\r\n/g, '\n');

  const patterns = [
    /^\s*(?:-\s*)?(?:\*\*)?(\d+)[.):\]]\s*(?:\*\*)?\s*(.+)/gm,
    /^\s*\((\d+)\)\s*(.+)/gm,
    /^\s*(?:-\s*)?(?:\*\*)?([A-Za-z])[.):\]]\s*(?:\*\*)?\s*(.+)/gm,
    /^\s*\(([A-Za-z])\)\s*(.+)/gm,
  ];

  for (let patternIdx = 0; patternIdx < patterns.length; patternIdx++) {
    const pattern = patterns[patternIdx];
    const matches = [...tail.matchAll(pattern)];
    if (matches.length < 2) {
      emit(trace, { phase: '2-extract', patternIdx, accept: false, reason: 'too-few-matches', count: matches.length });
      continue;
    }

    const lines = tail.split('\n');
    const matchLineNums = matches.map((m) => {
      const pos = m.index;
      let lineNum = 0;
      let charCount = 0;
      for (const line of lines) {
        if (charCount + line.length >= pos) break;
        charCount += line.length + 1;
        lineNum++;
      }
      return lineNum;
    });

    const span = matchLineNums[matchLineNums.length - 1] - matchLineNums[0];
    if (span > 15) {
      emit(trace, { phase: '2-extract', patternIdx, accept: false, reason: 'span-too-wide', span });
      continue;
    }

    if (!contextAccepts(tail, matches, trace)) continue;

    const choices = matches.slice(0, 10).map((m) => ({
      index: m[1],
      label: stripMarkdown(m[2]).slice(0, 30),
    }));
    emit(trace, { phase: '3d-gate', patternIdx, accept: true, count: choices.length });
    return choices;
  }

  return null;
}
```

Behavior check: the only change from the original is the `{ trace }` option plumbing and the emission of trace records. The detection rules are byte-identical.

- [ ] **Step 2.2: Wire `stop.js` to forward trace records to `hookLog`**

Edit `claude-plugin/hooks/stop.js`, replacing lines 64–73 (the choice parse block). The current block is:

```js
    let choices = null;
    const stdinText = parsed.last_assistant_message || null;
    let src = 'none';

    if (stdinText) {
      const fenced = parseFencedChoices(stdinText);
      const regex = parseRegexChoices(stdinText);
      choices = fenced || regex;
      src = fenced ? 'stdin-fenced' : regex ? 'stdin-regex' : 'none';
    }
```

Replace with:

```js
    let choices = null;
    const stdinText = parsed.last_assistant_message || null;
    let src = 'none';
    const trace = (d) => hookLog('choiceParser', JSON.stringify({ ...d, source: 'stdin' }));

    if (stdinText) {
      const fenced = parseFencedChoices(stdinText, { trace });
      const regex = parseRegexChoices(stdinText, { trace });
      choices = fenced || regex;
      src = fenced ? 'stdin-fenced' : regex ? 'stdin-regex' : 'none';
    }
```

Also update the transcript-fenced fallback at line 80:

```js
        const fenced = parseFencedChoices(transcriptText, {
          trace: (d) => hookLog('choiceParser', JSON.stringify({ ...d, source: 'transcript' })),
        });
```

- [ ] **Step 2.3: Run baseline regression check**

Run: `node tools/dj-parse.js --all`
Expected: identical PASS/FAIL pattern as recorded in Task 1.5 (same verdicts; the change is additive — trace is pushed into array but comparison doesn't use it yet).

If any verdict changes, Step 2.1 introduced a regression — fix before proceeding.

- [ ] **Step 2.4: Run bridge + hook and verify trace lines appear**

Run: `npm run debug` (or `node scripts/local-deploy.js bridge/*.js hooks/*.js` then restart bridge).

In a separate terminal, trigger a Claude session with a numbered list ending in a question, e.g. paste `step4-real-choices.txt` content.

After the stop hook fires, check:
```bash
tail -20 claude-plugin/logs/hooks.log | grep choiceParser
```
Expected: at least one line like `2026-04-17T... [choiceParser] {"phase":"2-extract","patternIdx":0,...}`.

- [ ] **Step 2.5: Bump version to v0.6.5 and deploy**

Run:
```bash
node scripts/bump-version.js patch
node scripts/local-deploy.js hooks/choiceParser.js hooks/stop.js
```

Restart bridge via `/claude-dj-plugin:bridge-restart` or stop/start skill.

- [ ] **Step 2.6: Commit**

```bash
git add claude-plugin/hooks/choiceParser.js claude-plugin/hooks/stop.js \
  package.json claude-plugin/package.json claude-plugin/plugin.json \
  .claude-plugin/plugin.json .claude-plugin/marketplace.json \
  claude-plugin/public/js/app.js
git commit -m "feat: structured trace pipeline in choiceParser.js (v0.6.5)"
```

---

## Task 3: Layer 1 Fixture Expansion — 32 static fixtures

Build the regression corpus. Every fixture pairs a `.txt` with a `.expect.json`. Where the current parser's verdict disagrees with the fixture's declared expectation, the fixture becomes a FAIL — that FAIL list is the Task 4 fix target.

**Files:**
- Create: `.dj-test/fixtures/nd/01-autopilot-plan.txt` + `.expect.json` (10 total in `nd/`)
- Create: `.dj-test/fixtures/pd/01-bare-numbered.txt` + `.expect.json` (10 total in `pd/`)
- Create: `.dj-test/fixtures/ex/01-bold-plus-emdash.txt` + `.expect.json` (7 total in `ex/`)
- Create: `.dj-test/fixtures/pl/01-exitplan-numbered.txt` + `.expect.json` (5 total in `pl/`)

All 32 fixture pairs are listed verbatim in sub-steps. `nd/` = negative (detect=false), `pd/` = positive (detect=true), `ex/` = edge cases, `pl/` = plan-mode outputs.

### Steps

- [ ] **Step 3.1: Create `nd/` (negative) fixtures — 10 files**

Each fixture is a `.txt` file plus an `.expect.json` with `"detect": false`. For brevity this step groups them — create each file as shown.

Create `.dj-test/fixtures/nd/01-autopilot-plan.txt`:
```
Autopilot 실행 계획:

1. executor 에이전트 위임 — bridge/server.js WebSocket 핸들러 리팩터링
2. choiceParser.js 수정 — fenced block 우선순위 로직 추가, regex fallback 개선
3. test-engineer 에이전트 — 단위 테스트 15개 추가 (choiceParser, stopHook, buttonManager)
4. d200-renderer.js 업데이트 — 버튼 트렁케이션 30자 제한, overflow 처리
5. verifier 에이전트 — 전체 테스트 스위트 실행 및 검증
6. 버전 범프 0.5.6 → 0.5.7, CHANGELOG 업데이트

총 예상 변경: 6개 파일, ~200 LOC. 진행하겠습니다.
```

Create `.dj-test/fixtures/nd/01-autopilot-plan.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "heading-colon-preamble" }
```

Create `.dj-test/fixtures/nd/02-analysis-report.txt`:
```
코드베이스 분석 완료. 발견된 이슈:

1. bridge/wsServer.js:42 — 클라이언트 연결 해제 시 메모리 누수 가능성
2. hooks/stop.js:187 — proxy timeout이 하드코딩됨 (120000ms), 설정으로 분리 필요
3. public/js/app.js:23 — VERSION 상수가 빌드 타임에 주입되지 않고 수동 관리됨
4. bridge/sessionManager.js:95 — 세션 정리 로직에 race condition 존재

심각도: 중간. 즉시 수정이 필요한 항목은 #1과 #4입니다.
```

Create `.dj-test/fixtures/nd/02-analysis-report.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "long-aftermath" }
```

Create `.dj-test/fixtures/nd/03-team-pipeline.txt`:
```
Team 파이프라인 구성:

1. architect (opus) — 전체 아키텍처 리뷰, WebSocket 프로토콜 재설계 제안
2. executor (sonnet) — 구현 작업 3건 병렬 실행
3. test-engineer (sonnet) — TDD 워크플로우, 실패 테스트 먼저 작성
4. code-reviewer (opus) — SOLID 원칙 점검, 보안 취약점 스캔
5. verifier (haiku) — 최종 검증, 회귀 테스트 실행

예상 소요: 5개 에이전트, 3 라운드.
```

Create `.dj-test/fixtures/nd/03-team-pipeline.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "heading-colon-preamble" }
```

Create `.dj-test/fixtures/nd/04-todo-checklist.txt`:
```
오늘의 작업 체크리스트:

1. 아침 회의 준비 자료 정리
2. 어제 리뷰 받은 PR 수정 반영
3. 새 기능 설계 문서 초안 작성
4. 테스트 커버리지 80% 달성

내일까지 완료 목표.
```

Create `.dj-test/fixtures/nd/04-todo-checklist.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "heading-colon-preamble" }
```

Create `.dj-test/fixtures/nd/05-commit-log.txt`:
```
최근 커밋 히스토리:

1. feat: add WebSocket reconnection logic
2. fix: race condition in session cleanup
3. test: expand choice parser coverage
4. chore: bump version to 0.6.4

총 4개 커밋이 main에 머지되었습니다.
```

Create `.dj-test/fixtures/nd/05-commit-log.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "heading-colon-preamble" }
```

Create `.dj-test/fixtures/nd/06-release-notes.txt`:
```
v0.6.4 릴리스 노트:

1. ulanzi-deploy 스킬 추가
2. local-deploy 전체 플러그인 동기화 지원
3. 버튼 매니저 리팩터링
4. 문서 업데이트

릴리스 날짜: 2026-04-15.
```

Create `.dj-test/fixtures/nd/06-release-notes.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "heading-colon-preamble" }
```

Create `.dj-test/fixtures/nd/07-feature-summary.txt`:
```
구현된 기능들:

1. 실시간 WebSocket 통신
2. 세션 관리 및 포커스 전환
3. 버튼 덱 레이아웃 엔진
4. 선택 감지 파서

총 4개 핵심 기능이 v1.0 타깃으로 정렬되어 있습니다.
```

Create `.dj-test/fixtures/nd/07-feature-summary.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "heading-colon-preamble" }
```

Create `.dj-test/fixtures/nd/08-faq.txt`:
```
FAQ 목록입니다.

1. Q: 브릿지가 왜 안 켜지나요? — A: 포트 39200 점유 여부 확인하세요.
2. Q: 덱이 연결 안 됩니다 — A: WebSocket URL을 확인해주세요.
3. Q: 버튼이 안 뜹니다 — A: 로그에서 choice 감지 여부를 보세요.

추가 문의: 이슈 트래커에 남겨주세요.
```

Create `.dj-test/fixtures/nd/08-faq.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "long-aftermath" }
```

Create `.dj-test/fixtures/nd/09-log-summary.txt`:
```
마지막 1시간 동안의 에러 로그 요약:

1. ECONNREFUSED — 12건
2. TIMEOUT — 4건
3. EPIPE — 2건
4. ENOTFOUND — 1건

대부분 네트워크 이슈입니다.
```

Create `.dj-test/fixtures/nd/09-log-summary.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "heading-colon-preamble" }
```

Create `.dj-test/fixtures/nd/10-meeting-agenda.txt`:
```
오늘 회의 안건:

1. 지난주 스프린트 리뷰
2. 이번 스프린트 목표 정렬
3. 블로커 공유
4. Q&A

오후 3시 시작.
```

Create `.dj-test/fixtures/nd/10-meeting-agenda.expect.json`:
```json
{ "detect": false, "expectedRejectionReason": "heading-colon-preamble" }
```

- [ ] **Step 3.2: Create `pd/` (positive) fixtures — 10 files**

Create `.dj-test/fixtures/pd/01-bare-numbered.txt`:
```
어떤 방식으로 진행할까요?

1. 전체 리팩터링
2. 부분 수정
3. 현재 상태 유지
```

Create `.dj-test/fixtures/pd/01-bare-numbered.expect.json`:
```json
{ "detect": true, "choices": ["전체 리팩터링", "부분 수정", "현재 상태 유지"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/pd/02-bold-prefix.txt`:
```
어떤 옵션을 고르시겠습니까?

**1.** 첫 번째 옵션
**2.** 두 번째 옵션
**3.** 세 번째 옵션
```

Create `.dj-test/fixtures/pd/02-bold-prefix.expect.json`:
```json
{ "detect": true, "choices": ["첫 번째 옵션", "두 번째 옵션", "세 번째 옵션"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/pd/03-dash-prefix.txt`:
```
어느 방향이 좋을까요?

- 1. 지금 바로 배포
- 2. 리뷰 후 배포
- 3. 다음 스프린트로 연기
```

Create `.dj-test/fixtures/pd/03-dash-prefix.expect.json`:
```json
{ "detect": true, "choices": ["지금 바로 배포", "리뷰 후 배포", "다음 스프린트로 연기"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/pd/04-fenced-block.txt`:
```
분석이 완료되었습니다. 다음 중 선택해주세요:

[claude-dj-choices]
1. 커밋하고 푸시
2. 추가 수정
3. 변경사항 되돌리기
4. 리뷰 요청
[/claude-dj-choices]
```

Create `.dj-test/fixtures/pd/04-fenced-block.expect.json`:
```json
{ "detect": true, "choices": ["커밋하고 푸시", "추가 수정", "변경사항 되돌리기", "리뷰 요청"], "expectedRule": "fenced-block" }
```

Create `.dj-test/fixtures/pd/05-mixed-lang.txt`:
```
Which option do you prefer?

1. Refactor the module
2. 모듈 재작성
3. Patch and move on
```

Create `.dj-test/fixtures/pd/05-mixed-lang.expect.json`:
```json
{ "detect": true, "choices": ["Refactor the module", "모듈 재작성", "Patch and move on"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/pd/06-paren-numbered.txt`:
```
어떤 것을 선택하시겠어요?

(1) 옵션 A
(2) 옵션 B
(3) 옵션 C
```

Create `.dj-test/fixtures/pd/06-paren-numbered.expect.json`:
```json
{ "detect": true, "choices": ["옵션 A", "옵션 B", "옵션 C"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/pd/07-letter-prefix.txt`:
```
진행 방식을 선택해주세요.

A. 즉시 적용
B. 단계별 적용
C. 취소
```

Create `.dj-test/fixtures/pd/07-letter-prefix.expect.json`:
```json
{ "detect": true, "choices": ["즉시 적용", "단계별 적용", "취소"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/pd/08-two-option-binary.txt`:
```
이 변경사항을 적용할까요?

1. 네, 적용
2. 아니요, 취소
```

Create `.dj-test/fixtures/pd/08-two-option-binary.expect.json`:
```json
{ "detect": true, "choices": ["네, 적용", "아니요, 취소"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/pd/09-seven-options.txt`:
```
어떤 카테고리에 속하나요?

1. 웹
2. 모바일
3. 데스크탑
4. 서버
5. CLI
6. 라이브러리
7. 기타
```

Create `.dj-test/fixtures/pd/09-seven-options.expect.json`:
```json
{ "detect": true, "choices": ["웹", "모바일", "데스크탑", "서버", "CLI", "라이브러리", "기타"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/pd/10-short-preamble.txt`:
```
어떤?

1. 옵션 하나
2. 옵션 둘
3. 옵션 셋
```

Create `.dj-test/fixtures/pd/10-short-preamble.expect.json`:
```json
{ "detect": true, "choices": ["옵션 하나", "옵션 둘", "옵션 셋"], "expectedRule": "regex-context" }
```

- [ ] **Step 3.3: Create `ex/` (edge case) fixtures — 7 files**

Create `.dj-test/fixtures/ex/01-bold-plus-emdash.txt` (Q2 live repro):
```
어느 쪽에 가깝나요?

- **A. 감지 누락 (False Negative)** — Claude가 선택지를 제시했는데 덱에 버튼이 안 뜸
- **B. 오탐 (False Positive)** — 일반 설명인데 choice 버튼이 뜨면서 세션이 freeze됨
- **C. AskUserQuestion이 호출되지 않음** — Claude가 그냥 텍스트로만 끝내버림
- **D. Plan 모드 자체 통합 문제** — ExitPlanMode 결과가 덱에 전달 안 됨
- **E. 정확히는 모름** — 다양한 케이스로 파악하고 싶음
```

Create `.dj-test/fixtures/ex/01-bold-plus-emdash.expect.json`:
```json
{
  "detect": true,
  "choices": ["감지 누락 (False Negative)", "오탐 (False Positive)", "AskUserQuestion이 호출되지 않음", "Plan 모드 자체 통합 문제", "정확히는 모름"],
  "expectedRule": "regex-context",
  "notes": "Q2 live reproduction — bold letter + em-dash short explanation is a real choice"
}
```

Create `.dj-test/fixtures/ex/02-choice-with-explanation.txt`:
```
어떻게 처리할까요?

1. 승인 — 바로 배포
2. 거절 — 추가 수정 필요
```

Create `.dj-test/fixtures/ex/02-choice-with-explanation.expect.json`:
```json
{ "detect": true, "choices": ["승인 — 바로 배포", "거절 — 추가 수정 필요"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/ex/03-preamble-then-choice.txt`:
```
현재 브릿지 서버가 실행 중이며 연결된 덱이 2개 있습니다.
최근 에러 로그는 깨끗한 상태이고 WebSocket 연결도 안정적입니다.
몇 가지 옵션 중에서 어떤 것을 선택하시겠어요?

1. 재시작
2. 상태 유지
3. 종료
```

Create `.dj-test/fixtures/ex/03-preamble-then-choice.expect.json`:
```json
{ "detect": true, "choices": ["재시작", "상태 유지", "종료"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/ex/04-choice-then-postamble.txt`:
```
어떤 방향으로?

1. 옵션 A
2. 옵션 B
3. 옵션 C

참고로 옵션 A는 이전에 성공한 경험이 있습니다.
```

Create `.dj-test/fixtures/ex/04-choice-then-postamble.expect.json`:
```json
{
  "detect": false,
  "expectedRejectionReason": "long-aftermath",
  "notes": "Aftermath > 50 chars — treated as continuation, not choices (conservative default)"
}
```

Create `.dj-test/fixtures/ex/05-fenced-after-preamble.txt`:
```
분석 결과를 정리했습니다. 세 가지 경로가 있습니다:

첫째, 전체 리팩터링 접근
둘째, 부분 수정 접근
셋째, 현재 유지

[claude-dj-choices]
1. 전체 리팩터링
2. 부분 수정
3. 현재 유지
[/claude-dj-choices]
```

Create `.dj-test/fixtures/ex/05-fenced-after-preamble.expect.json`:
```json
{ "detect": true, "choices": ["전체 리팩터링", "부분 수정", "현재 유지"], "expectedRule": "fenced-block" }
```

Create `.dj-test/fixtures/ex/06-bold-single-emdash.txt`:
```
선택해주세요:

1. **빠른 경로**
2. 느린 경로 — 더 안전함
```

Create `.dj-test/fixtures/ex/06-bold-single-emdash.expect.json`:
```json
{ "detect": true, "choices": ["빠른 경로", "느린 경로 — 더 안전함"], "expectedRule": "regex-context" }
```

Create `.dj-test/fixtures/ex/07-long-labels.txt`:
```
아키텍처 결정이 필요합니다:

1. 모놀리식 서버로 통합하고 마이크로서비스 전환은 나중에 진행
2. 처음부터 마이크로서비스로 설계하고 각 서비스별 독립 배포 구성
3. 하이브리드 접근법으로 핵심 서비스만 분리하고 나머지는 모놀리식 유지
```

Create `.dj-test/fixtures/ex/07-long-labels.expect.json`:
```json
{
  "detect": true,
  "choices": [
    "모놀리식 서버로 통합하고 마이크로서비스",
    "처음부터 마이크로서비스로 설계하고 각 서",
    "하이브리드 접근법으로 핵심 서비스만 분리"
  ],
  "expectedRule": "regex-context"
}
```

- [ ] **Step 3.4: Create `pl/` (plan-mode) fixtures — 5 files**

Create `.dj-test/fixtures/pl/01-exitplan-numbered.txt`:
```
구현 계획:

1. choiceParser.js에 trace 옵션 추가
2. stop.js에서 hookLog 콜백 전달
3. Layer 1 CLI로 fixture 회귀 검증
4. v0.6.5 bump

어떤 순서로 진행할까요?
```

Create `.dj-test/fixtures/pl/01-exitplan-numbered.expect.json`:
```json
{
  "detect": true,
  "choices": ["choiceParser.js에 trace 옵션 추가", "stop.js에서 hookLog 콜백 전달", "Layer 1 CLI로 fixture 회귀 검증", "v0.6.5 bump"],
  "expectedRule": "regex-context",
  "notes": "Plan body followed by a question — whole thing becomes choices since question is within 800-char tail"
}
```

Create `.dj-test/fixtures/pl/02-plan-with-subtasks.txt`:
```
3단계 구현 계획입니다:

1. 설계 검증
2. 테스트 작성
3. 구현 배포

이 순서대로 진행하면 될까요?
```

Create `.dj-test/fixtures/pl/02-plan-with-subtasks.expect.json`:
```json
{
  "detect": true,
  "choices": ["설계 검증", "테스트 작성", "구현 배포"],
  "expectedRule": "regex-context"
}
```

Create `.dj-test/fixtures/pl/03-plan-with-heading-no-question.txt`:
```
구현 계획:

1. 설계 검증
2. 테스트 작성
3. 구현 배포
```

Create `.dj-test/fixtures/pl/03-plan-with-heading-no-question.expect.json`:
```json
{
  "detect": false,
  "expectedRejectionReason": "heading-colon-preamble",
  "notes": "Plan body with heading colon and no question — not choices"
}
```

Create `.dj-test/fixtures/pl/04-short-plan-end.txt`:
```
방향 선택해주세요:

1. A 방향
2. B 방향
```

Create `.dj-test/fixtures/pl/04-short-plan-end.expect.json`:
```json
{
  "detect": true,
  "choices": ["A 방향", "B 방향"],
  "expectedRule": "regex-context",
  "notes": "Choice keyword in preamble overrides heading-colon filter"
}
```

Create `.dj-test/fixtures/pl/05-plan-with-trailing-note.txt`:
```
두 가지 접근법이 있습니다:

1. 접근법 하나
2. 접근법 둘

어떤 걸 선택하시겠어요?
```

Create `.dj-test/fixtures/pl/05-plan-with-trailing-note.expect.json`:
```json
{
  "detect": true,
  "choices": ["접근법 하나", "접근법 둘"],
  "expectedRule": "regex-context",
  "notes": "Question is in aftermath but within 50 chars, plus choice keyword"
}
```

- [ ] **Step 3.5: Run full corpus and capture baseline FAIL set**

Run: `node tools/dj-parse.js --all`

Expected: summary like `X pass, Y fail, 0 no-expect  (total 39)` (7 original + 32 new).

Record the FAIL list verbatim in this task's checklist. This list = Task 4 target. `ex/01-bold-plus-emdash` and other edge cases should be in the FAIL list pre-fix.

- [ ] **Step 3.6: Bump version to v0.6.5.1 and commit**

Run: `node scripts/bump-version.js patch` → `0.6.5.1` (or `0.6.6` if tooling is strict 3-part semver, then reconcile Task 4 bump).

Commit:
```bash
git add .dj-test/fixtures/ package.json \
  claude-plugin/package.json claude-plugin/plugin.json \
  .claude-plugin/plugin.json .claude-plugin/marketplace.json \
  claude-plugin/public/js/app.js
git commit -m "test: add 32-fixture corpus — nd/pd/ex/pl categories (v0.6.5.1)"
```

---

## Task 4: Parser fix — pass the expanded corpus

Implement the minimum set of rule changes that brings Layer 1 to 32/32 PASS (or 39/39 including originals). The Q2 regression must be among the cases fixed.

**Files:**
- Modify: `claude-plugin/hooks/choiceParser.js`

### Steps

- [ ] **Step 4.1: Run current parser to isolate FAIL reasons**

Run: `node tools/dj-parse.js --all --json > /tmp/dj-baseline.json`

Inspect: `node -e "const r = JSON.parse(require('fs').readFileSync('/tmp/dj-baseline.json')); for (const x of r) if (x.pass === false) console.log(x.fixture, '->', x.actual.trace.map(d => d.phase + ':' + (d.rule || d.reason)).join(' | '));"`

Expected: each FAIL fixture shows the exact stage+rule that produced the wrong verdict.

- [ ] **Step 4.2: Write failing assertion for Q2 repro (bold+em-dash)**

The FAIL on `ex/01-bold-plus-emdash.txt` proves the current `contextAccepts()` treats bold-prefix short-explanation lists conservatively. The `pl/01-exitplan-numbered.txt` should test that "bold + em-dash + short label" is accepted when the message ends with a question.

Verify by running:
```bash
node tools/dj-parse.js .dj-test/fixtures/ex/01-bold-plus-emdash.txt
```
Expected output: `FAIL  .dj-test/fixtures/ex/01-bold-plus-emdash.txt  detect=false rule=none`.

This is the target to flip.

- [ ] **Step 4.3: Diagnose why ex/01 fails**

Trace shows `3c-context` either returns `heading-colon-preamble` (if preamble ended with `:`) or `default-conservative`.

In `ex/01-bold-plus-emdash.txt`:
- preamble: `어느 쪽에 가깝나요?` — ends with `?`
- matches start at the first `A.` line

Question-mark preamble check should already return true. If it doesn't, the regex `QUESTION_TAIL_RE` isn't seeing the `?` because `lastPreambleLine` is derived from the preamble without trailing newline. Verify:
- `preamble.split('\n').filter(l => l.trim())` — if preamble is `"어느 쪽에 가깝나요?\n"`, the last non-blank line is `어느 쪽에 가깝나요?`, which matches `/[?？]\s*$/m`.

So ex/01 SHOULD pass stage 3c. The failure is earlier — stage 2 candidate extraction.

Reason: lines start with `- **A. 감지 ...` and the pattern `/^\s*(?:-\s*)?(?:\*\*)?([A-Za-z])[.):\]]\s*(?:\*\*)?\s*(.+)/gm` should match A-E.

BUT — `- **A.` has `**` between dash and letter. The regex `(?:-\s*)?(?:\*\*)?([A-Za-z])` requires dash-space then optional `**`, then letter. Parse:
- `- **A. 감지` → `-` `_` `**` `A` `.` `_` `감지...`
- `(?:-\s*)?` consumes `- ` ✓
- `(?:\*\*)?` consumes `**` ✓
- `([A-Za-z])` captures `A` ✓
- `[.):\]]` consumes `.` ✓

Then `(?:\*\*)?` consumes the closing `**` after `감지 누락...`? No — `**` comes much later, after `(False Negative)`. So `(.+)` captures `감지 누락 (False Negative)** — Claude가 선택지를 제시했는데 덱에 버튼이 안 뜸`.

After `stripMarkdown()` the `**` is removed. Truncation to 30 chars gives `감지 누락 (False Negative)`.

So why does ex/01 fail? Possibly **the letter regex is tried AFTER the numeric regex, and the numeric regex has no matches** — so the loop falls through to letters. That should work.

**Actual cause hypothesis:** the LINE_RE in the fence parser vs the patterns in regex parser — and the context check. Context check `contextAccepts()` needs preamble ending with `?`, which it does.

Let me verify by running Step 4.1's trace inspector against ex/01 specifically. If the trace shows `3c-context` rule `question-tail` accepted but the overall result is still `null`, the bug is elsewhere.

If trace shows `2-extract` reached but failed `span > 15` or `matches.length < 2`, the regex isn't matching lines the way we expect.

**If trace shows no matches on letter-pattern:** the dash-prefix version of the letter regex is too restrictive. Fix: add an explicit `^\s*(?:-\s*)?(?:\*\*)?([A-Z])\.\s*(?:\*\*)?\s*(.+)` pattern that permits `. ` after the bold-close.

This step is diagnostic only — fix comes in Step 4.4.

- [ ] **Step 4.4: Apply fix based on diagnosis**

Assuming the trace reveals the letter-pattern variant must allow `**A.**` (bold-wrapped letter+period), add it as a new pattern.

Edit `parseRegexChoices` in `claude-plugin/hooks/choiceParser.js` — replace the `patterns` array:

```js
  const patterns = [
    // Numeric: 1. / 1) / **1)** / - 1. / - **1.**
    /^\s*(?:-\s*)?(?:\*\*)?(\d+)[.):\]]\s*(?:\*\*)?\s*(.+)/gm,
    // Numeric in parens: (1) text
    /^\s*\((\d+)\)\s*(.+)/gm,
    // Letter: A. / A) / **A.** / - A. / - **A.** — label may contain ** markers
    /^\s*(?:-\s*)?(?:\*\*)?([A-Za-z])[.):\]]\s*(?:\*\*)?\s*(.+?)(?:\*\*)?\s*$/gm,
    // Letter in parens
    /^\s*\(([A-Za-z])\)\s*(.+)/gm,
  ];
```

The third pattern adds a non-greedy `(.+?)` with an optional trailing `**` consumer so `**A.** 감지 누락 (...)**` parses cleanly.

Also ensure Stage 3c contextAccepts handles the `pl/05-plan-with-trailing-note` case: `aftermath.length <= 50` with choice keyword should accept.

Before `aftermath.length > 50` rule, add:
```js
  if (aftermath.length <= 50 && CHOICE_KEYWORD_RE.test(aftermath)) {
    emit(trace, { phase: '3c-context', accept: true, rule: 'short-aftermath-keyword' });
    return true;
  }
```

- [ ] **Step 4.5: Run full corpus — target 100% pass**

Run: `node tools/dj-parse.js --all`
Expected: `39 pass, 0 fail, 0 no-expect  (total 39)`.

If any fixture fails:
- Trace-diagnose via Step 4.1's inspector
- Iterate on rules one decision at a time
- Do not relax a passing rule to make a failing one pass — instead add a specific rule that encodes the expected distinction

- [ ] **Step 4.6: Run cross-fixture check — originals still pass**

Run: `node tools/dj-parse.js .dj-test/fixtures/step1-autopilot-plan.txt .dj-test/fixtures/step2-analysis-report.txt .dj-test/fixtures/step3-team-pipeline.txt`
Expected: all three show `PASS  ... detect=false`.

- [ ] **Step 4.7: Live deck regression — run Q2 repro through the session**

Deploy: `node scripts/local-deploy.js hooks/choiceParser.js` then `/claude-dj-plugin:bridge-restart`.

In a live Claude session, output the content of `ex/01-bold-plus-emdash.txt` and end the message. Check:
1. Deck shows 5 choice buttons
2. `tail -20 claude-plugin/logs/hooks.log` shows `"phase":"3c-context","accept":true,"rule":"question-tail"`

If deck buttons appear → live fix confirmed.

- [ ] **Step 4.8: Bump to v0.6.6 and commit**

```bash
node scripts/bump-version.js patch
git add claude-plugin/hooks/choiceParser.js package.json \
  claude-plugin/package.json claude-plugin/plugin.json \
  .claude-plugin/plugin.json .claude-plugin/marketplace.json \
  claude-plugin/public/js/app.js
git commit -m "fix: choiceParser covers bold+em-dash and short-aftermath keyword (v0.6.6)"
```

---

## Task 5: Layer 2 stress skill — `dj-stress`

Build the live-session integration harness. It iterates fixtures, outputs them verbatim, auto-judges via `/api/logs?source=hooks&since=<iso>` and `/api/deck-state`, and shows a single pass/fail summary at the end.

**Files:**
- Modify: `claude-plugin/bridge/server.js` — `/api/logs` gains `?source=hooks&since=<iso>` support
- Create: `claude-plugin/skills/dj-stress/SKILL.md`

### Steps

- [ ] **Step 5.1: Extend `/api/logs` with hooks-log tail**

Edit `claude-plugin/bridge/server.js` — replace the existing `/api/logs` handler (lines 98–101):

```js
app.get('/api/logs', async (req, res) => {
  const source = req.query.source || 'bridge';
  const n = Math.min(parseInt(req.query.n) || 50, 500);
  if (source === 'bridge') {
    return res.json(getRecentLogs(n));
  }
  if (source === 'hooks') {
    try {
      const { readFileSync } = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const hooksLog = path.join(__dirname, '..', 'logs', 'hooks.log');
      const text = readFileSync(hooksLog, 'utf8');
      const lines = text.trim().split('\n');
      const since = req.query.since;
      const filtered = since ? lines.filter(l => l.slice(0, 23) >= since) : lines;
      return res.json(filtered.slice(-n));
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }
  res.status(400).json({ error: `unknown source: ${source}` });
});
```

- [ ] **Step 5.2: Verify endpoint with curl**

After deploying and restarting bridge:
```bash
curl -s 'http://localhost:39200/api/logs?source=hooks&n=10'
```
Expected: JSON array of recent `hooks.log` lines.

```bash
curl -s "http://localhost:39200/api/logs?source=hooks&since=$(date -u +%Y-%m-%dT%H:%M:%S)"
```
Expected: JSON array of lines since the given ISO timestamp.

- [ ] **Step 5.3: Author `dj-stress/SKILL.md`**

Create `claude-plugin/skills/dj-stress/SKILL.md`:

```markdown
---
name: dj-stress
description: Auto-judged stress test for choice detection. Iterates .dj-test/fixtures/**, outputs each verbatim, fetches /api/deck-state + /api/logs to classify Pass/Fail without user button presses. Final summary only.
user_invocable: true
---

# Claude DJ — Stress Test (Auto-Judged)

Runs every fixture under `.dj-test/fixtures/` through the live stop-hook pipeline and classifies each result automatically. The user only confirms the final summary.

**CRITICAL RULES**:
- Each fixture step must end WITHOUT calling AskUserQuestion — the stop hook's detection is what we are testing.
- Do NOT read the fixture and then summarize — output it VERBATIM.
- NO other tool calls during fixture output steps (Read is used to get the content; the subsequent message IS the fixture text).
- Between fixtures, sleep 1 second, then GET /api/deck-state and /api/logs?source=hooks&since=<stepStart>.

## Setup Phase

Record the iteration start timestamp (UTC ISO):

```bash
date -u +%Y-%m-%dT%H:%M:%S.%3NZ
```

Save this as `RUN_START`. Each fixture step will record its own `stepStart` = `date -u ...` before outputting.

Announce:
> **DJ Stress Test 시작** — 39개 fixture 자동 판정 진행.

## Iteration

For each fixture file in the following order:
1. `.dj-test/fixtures/step1-autopilot-plan.txt` (expect: no buttons)
2. `.dj-test/fixtures/step2-analysis-report.txt` (expect: no buttons)
3. `.dj-test/fixtures/step3-team-pipeline.txt` (expect: no buttons)
4. `.dj-test/fixtures/step4-real-choices.txt` (expect: 3 buttons)
5. `.dj-test/fixtures/step5-fenced-choices.txt` (expect: 4 buttons)
6. `.dj-test/fixtures/step6-binary-emdash.txt` (expect: 2 buttons)
7. `.dj-test/fixtures/step7-long-description.txt` (expect: 3 buttons)
8. ...continue in alphabetical order through `nd/`, `pd/`, `ex/`, `pl/` subdirectories

For each fixture:

### Procedure per fixture

1. **Capture stepStart**:
   ```bash
   STEP_START=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
   ```

2. **Read expectation**:
   ```bash
   cat "$FIXTURE".expect.json
   ```
   Parse `detect` (boolean) and `choices` (array, optional).

3. **Read fixture content** via Read tool. Hold the content.

4. **Output fixture content VERBATIM** as the message body — no prefix, no suffix, end message without AskUserQuestion.

5. **Wait for stop hook to process** (bridge will process automatically; if `detect: true` the stop hook will hold open for ≤ 2 min waiting for deck input — the user should press any button OR you will auto-timeout).

   For auto-judge without user interaction, add query param `?autojudge=1` to the fixture output — but this requires changing stop.js to short-circuit. Simpler: rely on the deck state snapshot taken 1s after the stop hook fires.

6. **Probe**:
   ```bash
   sleep 1
   curl -s http://localhost:39200/api/deck-state > /tmp/deck-state.json
   curl -s "http://localhost:39200/api/logs?source=hooks&since=$STEP_START" > /tmp/step-logs.txt
   ```

7. **Classify**:
   - Parse `/tmp/deck-state.json` — if `preset === 'choice'` and `session.choices` length matches expected → PASS (on detect=true)
   - If `preset !== 'choice'` and expectation was `detect: false` → PASS
   - Otherwise FAIL; record fixture name + actual deck preset + logs.

8. **Log one-line result** to internal results array: `{fixture, expected, actual, pass}`.

9. Move to next fixture. Do NOT ask Pass/Fail from user.

## Cleanup & Summary

After all fixtures:

```bash
curl -X POST http://localhost:39200/api/test/reset  # best effort — clears in-flight proxy
```

Print summary table:

```markdown
## DJ Stress Test Results

| Category | Total | Pass | Fail |
|----------|-------|------|------|
| original (step1-7)  | 7  | X | Y |
| nd/ (negative)      | 10 | X | Y |
| pd/ (positive)      | 10 | X | Y |
| ex/ (edge)          | 7  | X | Y |
| pl/ (plan-mode)     | 5  | X | Y |
| **Total**           | **39** | **X** | **Y** |

Accuracy: (X / 39) × 100 = Z%
```

If Z < 95%, list failing fixtures and their deck state.

End with single AskUserQuestion to confirm the summary:

```
question: "Stress Test 결과 확인되었나요?"
header: "Stress"
options:
  - label: "OK"          description: "결과 확인"
  - label: "재실행"      description: "문제 있음 — 다시"
multiSelect: false
```

Do not iterate further after user confirms OK.
```

- [ ] **Step 5.4: Deploy skill to installed path**

```bash
INSTALL=$(node -e "const p=require('path'),os=require('os');const d=p.join(os.homedir(),'.claude','plugins');const i=JSON.parse(require('fs').readFileSync(p.join(d,'installed_plugins.json'),'utf8'));const e=Object.entries(i.plugins).find(([k])=>k.startsWith('claude-dj'));if(e)console.log(e[1][0].installPath);else console.log('NOT_FOUND')")
mkdir -p "$INSTALL/skills/dj-stress"
cp claude-plugin/skills/dj-stress/SKILL.md "$INSTALL/skills/dj-stress/SKILL.md"
cp claude-plugin/bridge/server.js "$INSTALL/bridge/server.js"
```

- [ ] **Step 5.5: Restart bridge**

`/claude-dj-plugin:bridge-restart`

- [ ] **Step 5.6: Run skill end-to-end**

In a live session: `/claude-dj-plugin:dj-stress`. Observe full iteration, verify auto-judge matches Layer 1 verdict on ≥ 95% of fixtures.

- [ ] **Step 5.7: Bump to v0.6.7 and commit**

```bash
node scripts/bump-version.js patch
git add claude-plugin/bridge/server.js claude-plugin/skills/dj-stress/SKILL.md \
  package.json claude-plugin/package.json claude-plugin/plugin.json \
  .claude-plugin/plugin.json .claude-plugin/marketplace.json \
  claude-plugin/public/js/app.js
git commit -m "feat: dj-stress integration skill + /api/logs?source=hooks (v0.6.7)"
```

---

## Task 6: Dynamic fixture generator

Complement the static corpus with programmatically generated fixtures that explore the axis space. Seeded for reproducibility; integrated as an optional block in the `dj-stress` skill.

**Files:**
- Create: `tools/dj-stress-gen.js`
- Modify: `claude-plugin/skills/dj-stress/SKILL.md` — add "Dynamic block" section

### Steps

- [ ] **Step 6.1: Create `tools/dj-stress-gen.js`**

```js
#!/usr/bin/env node
// tools/dj-stress-gen.js — seeded 8-axis fixture generator
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);

const seed = parseInt(flags.seed ?? '42', 10);
const count = parseInt(flags.count ?? '10', 10);
const out = flags.out ?? '.dj-test/fixtures/dy';

// Deterministic PRNG — Mulberry32
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const AXES = {
  language: ['ko', 'en', 'mixed'],
  count: [2, 3, 4, 7],
  prefix: ['bare', 'bold', 'dash', 'paren'],
  explanation: ['none', 'emdash', 'paren', 'colon'],
  preamble: ['none', 'short', 'long', 'analysis'],
  postamble: ['none', 'short', 'question'],
  fence: [false, true],
  labelLen: ['short', 'medium', 'long'],
};

const LABELS = {
  ko: ['옵션 하나', '두 번째 선택', '세 번째 대안', '네 번째 방법', '다섯 번째 경로', '여섯 번째 갈래', '마지막 선택'],
  en: ['Option A', 'Second choice', 'Third alternative', 'Fourth path', 'Fifth route', 'Sixth branch', 'Final option'],
  mixed: ['Option 하나', '두 번째 path', 'Third 대안', 'Fourth 방법', '다섯 번째 route', 'Sixth 갈래', 'Final 선택'],
};

const PREAMBLES = {
  none: '',
  short: { ko: '방향을 선택해주세요.\n\n', en: 'Pick a direction.\n\n', mixed: '방향을 pick해주세요.\n\n' },
  long: { ko: '상황 파악을 위해 몇 가지 질문드립니다. 아래 중 어떤 방향이 좋을까요?\n\n', en: 'To understand the situation, a few questions. Which direction do you prefer?\n\n', mixed: '상황 파악을 위해 which direction이 좋을까요?\n\n' },
  analysis: { ko: '분석 결과:\n\n', en: 'Analysis results:\n\n', mixed: '분석 results:\n\n' },
};

const POSTAMBLES = {
  none: '',
  short: { ko: '\n\n참고 바랍니다.', en: '\n\nFYI.', mixed: '\n\nFYI 참고.' },
  question: { ko: '\n\n어떤 걸 선택하시겠어요?', en: '\n\nWhich one do you pick?', mixed: '\n\n어떤 one을 pick?' },
};

function formatLine(idx, prefix, label, explanation, lang) {
  const expText = explanation === 'none' ? '' :
    explanation === 'emdash' ? ' — ' + (lang === 'ko' ? '추가 설명' : 'extra info') :
    explanation === 'paren' ? ' (' + (lang === 'ko' ? '부가 설명' : 'extra info') + ')' :
    explanation === 'colon' ? ': ' + (lang === 'ko' ? '상세 설명' : 'detailed info') : '';
  const body = label + expText;
  switch (prefix) {
    case 'bare':  return `${idx}. ${body}`;
    case 'bold':  return `**${idx}.** ${body}`;
    case 'dash':  return `- ${idx}. ${body}`;
    case 'paren': return `(${idx}) ${body}`;
  }
}

function generate(id) {
  const axes = {
    language: pick(AXES.language),
    count: pick(AXES.count),
    prefix: pick(AXES.prefix),
    explanation: pick(AXES.explanation),
    preamble: pick(AXES.preamble),
    postamble: pick(AXES.postamble),
    fence: pick(AXES.fence),
    labelLen: pick(AXES.labelLen),
  };

  const labels = LABELS[axes.language].slice(0, axes.count);
  const lines = labels.map((l, i) => formatLine(i + 1, axes.prefix, l, axes.explanation, axes.language));

  const pre = axes.preamble === 'none' ? '' : PREAMBLES[axes.preamble][axes.language];
  const post = axes.postamble === 'none' ? '' : POSTAMBLES[axes.postamble][axes.language];

  const inner = lines.join('\n');
  const body = axes.fence
    ? `${pre}[claude-dj-choices]\n${inner}\n[/claude-dj-choices]${post}`
    : `${pre}${inner}${post}`;

  // Expectation rules (pure deterministic)
  let detect;
  if (axes.fence) detect = true;
  else if (axes.preamble === 'analysis' && axes.prefix === 'bare' && axes.explanation === 'emdash') detect = false;
  else if (axes.preamble === 'analysis' && axes.postamble === 'none') detect = false;
  else if (axes.postamble === 'question' || axes.preamble === 'short' || axes.preamble === 'long') detect = true;
  else if (axes.prefix !== 'bare' && axes.postamble !== 'short') detect = true;
  else detect = false;

  return {
    id,
    axes,
    text: body,
    expect: detect
      ? { detect: true, choices: labels.map(l => l.slice(0, 30)), expectedRule: axes.fence ? 'fenced-block' : 'regex-context', notes: `dy seed=${seed} id=${id}` }
      : { detect: false, expectedRejectionReason: 'axis-driven-negative', notes: `dy seed=${seed} id=${id}` },
  };
}

function main() {
  mkdirSync(out, { recursive: true });
  for (let i = 1; i <= count; i++) {
    const g = generate(i);
    const base = path.join(out, String(i).padStart(2, '0') + '-dy.txt');
    writeFileSync(base, g.text);
    writeFileSync(base.replace(/\.txt$/, '.expect.json'), JSON.stringify(g.expect, null, 2));
  }
  console.log(`generated ${count} dynamic fixtures in ${out} (seed=${seed})`);
}

main();
```

- [ ] **Step 6.2: Verify deterministic generation**

```bash
node tools/dj-stress-gen.js --seed=42 --count=10
md5sum .dj-test/fixtures/dy/*.txt > /tmp/dy-hash-a.txt
rm -rf .dj-test/fixtures/dy
node tools/dj-stress-gen.js --seed=42 --count=10
md5sum .dj-test/fixtures/dy/*.txt > /tmp/dy-hash-b.txt
diff /tmp/dy-hash-a.txt /tmp/dy-hash-b.txt
```
Expected: no diff (byte-identical).

- [ ] **Step 6.3: Run Layer 1 against dynamic fixtures**

Run: `node tools/dj-parse.js --all`

Expected: all 49 fixtures pass (39 static + 10 dynamic). If any dynamic fixture has a wrong auto-expectation, the generator's expectation rules in `generate()` need adjustment — or the fixture exposes a new parser bug.

- [ ] **Step 6.4: Update `dj-stress` skill to include dynamic block**

Append to `claude-plugin/skills/dj-stress/SKILL.md` before the "Cleanup & Summary" section:

```markdown
## Dynamic Block (optional)

Before the summary, generate 10 fresh dynamic fixtures:

```bash
node tools/dj-stress-gen.js --seed=$(date +%s) --count=10 --out=.dj-test/fixtures/dy
```

Then iterate `.dj-test/fixtures/dy/*.txt` through the standard procedure above (steps 1–8). Append results to the summary under a new `dy/ (dynamic)` row.

After the summary, clean up:

```bash
rm -rf .dj-test/fixtures/dy
```
```

- [ ] **Step 6.5: Deploy**

```bash
cp claude-plugin/skills/dj-stress/SKILL.md "$INSTALL/skills/dj-stress/SKILL.md"
```

No bridge restart needed — skill content read per invocation.

- [ ] **Step 6.6: Bump to v0.6.8 and commit**

```bash
node scripts/bump-version.js patch
git add tools/dj-stress-gen.js claude-plugin/skills/dj-stress/SKILL.md \
  package.json claude-plugin/package.json claude-plugin/plugin.json \
  .claude-plugin/plugin.json .claude-plugin/marketplace.json \
  claude-plugin/public/js/app.js
git commit -m "feat: dj-stress-gen seeded 8-axis fixture generator (v0.6.8)"
```

---

## Task 7: HTML report + README

Final polish: consume Layer 1 JSON output into a static HTML report and document the whole suite.

**Files:**
- Create: `scripts/dj-test-report.js`
- Modify: `README.md`

### Steps

- [ ] **Step 7.1: Create `scripts/dj-test-report.js`**

```js
#!/usr/bin/env node
// scripts/dj-test-report.js — consume dj-parse --json → dj-test-report.html
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2] || '/dev/stdin';
const raw = readFileSync(input, 'utf8');
const results = JSON.parse(raw);

const byCategory = { original: [], nd: [], pd: [], ex: [], pl: [], dy: [] };
for (const r of results) {
  const cat = r.fixture.includes('/nd/') ? 'nd'
    : r.fixture.includes('/pd/') ? 'pd'
    : r.fixture.includes('/ex/') ? 'ex'
    : r.fixture.includes('/pl/') ? 'pl'
    : r.fixture.includes('/dy/') ? 'dy'
    : 'original';
  byCategory[cat].push(r);
}

const stats = Object.fromEntries(Object.entries(byCategory).map(([k, arr]) => [
  k,
  { total: arr.length, pass: arr.filter(r => r.pass === true).length, fail: arr.filter(r => r.pass === false).length },
]));

const rows = Object.entries(stats)
  .filter(([, s]) => s.total > 0)
  .map(([k, s]) => `<tr><td>${k}</td><td>${s.total}</td><td class="pass">${s.pass}</td><td class="${s.fail ? 'fail' : ''}">${s.fail}</td></tr>`)
  .join('');

const failRows = results.filter(r => r.pass === false).map(r => `
  <details><summary>${r.fixture}</summary>
  <pre>expected: ${JSON.stringify(r.expected, null, 2)}
actual:   ${JSON.stringify({ detect: r.actual.detect, choices: r.actual.choices, rule: r.actual.rule }, null, 2)}
trace:    ${JSON.stringify(r.actual.trace, null, 2)}</pre>
  </details>`).join('');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DJ Test Report</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 2em auto; color: #222; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #ccc; padding: 0.4em 0.8em; text-align: left; }
th { background: #f0f0f0; }
.pass { color: #27ae60; }
.fail { color: #c0392b; font-weight: bold; }
pre { background: #f5f5f5; padding: 0.8em; overflow-x: auto; white-space: pre-wrap; }
details { margin: 0.5em 0; }
summary { cursor: pointer; }
</style></head><body>
<h1>DJ Choice Detection — Test Report</h1>
<p>Generated: ${new Date().toISOString()}</p>
<h2>Summary</h2>
<table>
<tr><th>Category</th><th>Total</th><th>Pass</th><th>Fail</th></tr>
${rows}
</table>
${failRows ? `<h2>Failures</h2>${failRows}` : '<h2>All Pass ✓</h2>'}
</body></html>`;

writeFileSync('dj-test-report.html', html);
console.log('dj-test-report.html written');
```

- [ ] **Step 7.2: Generate and visually verify report**

```bash
node tools/dj-parse.js --all --json | node scripts/dj-test-report.js /dev/stdin
```

Expected: `dj-test-report.html written`. Open in a browser and confirm the category summary and failure drill-downs render. For the all-pass case the failure section should read "All Pass ✓".

- [ ] **Step 7.3: Add npm scripts**

Modify `package.json` scripts:
```json
{
  "scripts": {
    "dj:parse": "node tools/dj-parse.js",
    "dj:parse:all": "node tools/dj-parse.js --all",
    "dj:report": "node tools/dj-parse.js --all --json | node scripts/dj-test-report.js /dev/stdin",
    "dj:gen": "node tools/dj-stress-gen.js"
  }
}
```

- [ ] **Step 7.4: Update README**

Append to `README.md` (or insert under an existing "Testing" section):

```markdown
## Choice Detection Test Suite

Three-layer regression suite for the stop-hook choice parser.

| Layer | Runner | Purpose |
|-------|--------|---------|
| 1 Unit | `npm run dj:parse:all` | Parser-only verdict vs `.expect.json` |
| 2 Integration | `/claude-dj-plugin:dj-stress` | Live deck + bridge + auto-judge |
| 3 Instrumentation | `claude-plugin/logs/hooks.log` | `[choiceParser]` trace per decision |

Quick run:
```bash
npm run dj:parse:all        # expect: 39 pass, 0 fail
npm run dj:report           # writes dj-test-report.html
node tools/dj-stress-gen.js --seed=42 --count=10   # dynamic fixtures
```

Fixture categories: `nd/` (negative — no buttons), `pd/` (positive — buttons), `ex/` (edge cases), `pl/` (plan-mode), `dy/` (dynamic, generated).
```

- [ ] **Step 7.5: Add `dj-test-report.html` to .gitignore**

Edit `.gitignore`, append:
```
dj-test-report.html
.dj-test/fixtures/dy/
```

- [ ] **Step 7.6: Run full verification**

```bash
npm run dj:parse:all       # 39 pass, 0 fail
npm run dj:report          # produces HTML
```

Run `/claude-dj-plugin:dj-stress` in a live session and confirm accuracy ≥ 95% vs Layer 1 verdict.

- [ ] **Step 7.7: Bump to v0.6.9 and commit**

```bash
node scripts/bump-version.js patch
git add scripts/dj-test-report.js README.md .gitignore package.json \
  claude-plugin/package.json claude-plugin/plugin.json \
  .claude-plugin/plugin.json .claude-plugin/marketplace.json \
  claude-plugin/public/js/app.js
git commit -m "docs: HTML report + README for choice detection suite (v0.6.9)"
```

---

## Final Verification Gates

Run these before declaring the suite complete:

1. `npm run dj:parse:all` → `39 pass, 0 fail, 0 no-expect`
2. `node tools/dj-stress-gen.js --seed=42 --count=10 && npm run dj:parse:all` → `49 pass, 0 fail`
3. Live `/claude-dj-plugin:dj-stress` → auto-judge accuracy ≥ 95% vs Layer 1 verdict
4. Q2 repro live: `ex/01-bold-plus-emdash.txt` content in a session → deck shows 5 choice buttons
5. `tail -50 claude-plugin/logs/hooks.log | grep choiceParser` shows structured `[filter-decision]` entries for the last stop-hook invocation
6. `git log --oneline` shows Tasks 1–7 commits with correct version bumps (v0.6.5-dev.1 → v0.6.5 → v0.6.5.1 → v0.6.6 → v0.6.7 → v0.6.8 → v0.6.9)

If any gate fails, iterate on the specific task before moving on.
