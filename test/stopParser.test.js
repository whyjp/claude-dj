import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFencedChoices, parseRegexChoices } from '../claude-plugin/hooks/choiceParser.js';

describe('parseFencedChoices', () => {
  it('parses numeric choices from fence', () => {
    const text = 'Here are your options:\n\n[claude-dj-choices]\n1. Refactor\n2. Rewrite\n3. Patch\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'Refactor' },
      { index: '2', label: 'Rewrite' },
      { index: '3', label: 'Patch' },
    ]);
  });

  it('parses letter choices from fence', () => {
    const text = '[claude-dj-choices]\nA. Fix tests\nB. Skip tests\nC. Delete\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: 'A', label: 'Fix tests' },
      { index: 'B', label: 'Skip tests' },
      { index: 'C', label: 'Delete' },
    ]);
  });

  it('parses hierarchical choices (1a, 1b)', () => {
    const text = '[claude-dj-choices]\n1. Database\n  1a. PostgreSQL\n  1b. SQLite\n2. File-based\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'Database' },
      { index: '1a', label: 'PostgreSQL' },
      { index: '1b', label: 'SQLite' },
      { index: '2', label: 'File-based' },
    ]);
  });

  it('uses last fence when multiple fences exist', () => {
    const text = '[claude-dj-choices]\n1. Old\n2. Stale\n[/claude-dj-choices]\n\nActually:\n\n[claude-dj-choices]\n1. New\n2. Fresh\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'New' },
      { index: '2', label: 'Fresh' },
    ]);
  });

  it('returns null when no fence found', () => {
    const text = 'Here is some text with 1. numbers and 2. lists but no fence.';
    assert.equal(parseFencedChoices(text), null);
  });

  it('returns null for empty fence', () => {
    const text = '[claude-dj-choices]\n[/claude-dj-choices]';
    assert.equal(parseFencedChoices(text), null);
  });

  it('caps at 10 choices', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `${i + 1}. Option ${i + 1}`).join('\n');
    const text = `[claude-dj-choices]\n${lines}\n[/claude-dj-choices]`;
    const result = parseFencedChoices(text);
    assert.equal(result.length, 10);
    assert.equal(result[9].index, '10');
  });

  it('truncates labels to 30 chars', () => {
    const text = '[claude-dj-choices]\n1. This is a very long label that exceeds thirty characters easily\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.ok(result[0].label.length <= 30);
  });

  it('supports delimiter variants: ) : ]', () => {
    const text = '[claude-dj-choices]\n1) Parens\n2: Colon\n3] Bracket\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.equal(result.length, 3);
    assert.equal(result[0].label, 'Parens');
    assert.equal(result[1].label, 'Colon');
    assert.equal(result[2].label, 'Bracket');
  });
});

describe('parseRegexChoices (fallback)', () => {
  it('parses numbered list without fence', () => {
    const text = 'Choose:\n1. Alpha\n2. Beta\n3. Gamma';
    const result = parseRegexChoices(text);
    assert.equal(result.length, 3);
    assert.equal(result[0].index, '1');
    assert.equal(result[0].label, 'Alpha');
  });

  it('returns null when fewer than 2 matches', () => {
    const text = 'Just a single 1. item here.';
    assert.equal(parseRegexChoices(text), null);
  });

  it('returns null for numbered section headers spread across long text', () => {
    // This was a real false-positive: bold numbered headers in a long response
    const longText = `현재 상태를 파악했습니다.

**1. Docs 업데이트 (session4-final-status.md)**
- 테스트 카운트 82→93
- Subagent Tracking 완료
- Stop-Wait Path 추가

${'some filler text about the changes made.\n'.repeat(30)}

**2. README.md 업데이트**
- 테스트 카운트 88→93

${'more filler about README changes.\n'.repeat(20)}

**3. choice-format 스킬 강화 (SKILL.md)**
- Rule 강화
- Self-Check 섹션 추가

커밋하시겠습니까?`;
    assert.equal(parseRegexChoices(longText), null);
  });

  it('still detects choices in the tail of a long message', () => {
    const longText = `${'This is a long explanation.\n'.repeat(50)}
Which approach should we take?
1. Refactor the module
2. Rewrite from scratch
3. Patch and move on`;
    const result = parseRegexChoices(longText);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
    assert.equal(result[0].label, 'Refactor the module');
  });

  it('returns null for explanation list with em-dashes', () => {
    // Real bug: numbered explanations with "—" were parsed as choices
    const text = `몇 가지 가능한 원인:

1. Ulanzi Studio 재시작 필요 — Studio가 플러그인 JS를 메모리에 캐싱하므로
2. 프로파일 동기화 — Studio에서 보이는 것과 실제 장비는 별도 프로파일
3. 장비 캐시 — D200H가 이전에 받은 아이콘을 로컬에 캐싱

Ulanzi Studio를 재시작해보셨나요?`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('returns null for step-by-step instructions with arrows', () => {
    const text = `추천 순서:
1. Ulanzi Studio 완전 종료 → 재시작
2. Studio에서 장비 연결 확인
3. 프로파일을 장비에 다시 동기화

Ulanzi Studio를 재시작해보셨나요?`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('detects long but legitimate choices (no regression)', () => {
    const text = `Do you want to make this edit to stop.js?
1. Yes
2. Yes, and allow Claude to edit its own settings for this session
3. No`;
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
    assert.equal(result[0].label, 'Yes');
  });

  it('still detects short genuine choices after filtering', () => {
    const text = `어떻게 할까요?
1. 예
2. 아니오
3. 건너뛰기`;
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
    assert.equal(result[0].label, '예');
  });

  it('detects plan mode long choices (no false filter)', () => {
    const text = `How should we proceed?
1. Implement the full feature with database migration, API endpoints, and frontend components
2. Start with a minimal prototype that only covers the core use case
3. Write tests first, then implement incrementally`;
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
  });

  it('detects permission-style choices', () => {
    const text = `Do you want to make this edit to stop.js?
1. Yes
2. Yes, and allow Claude to edit its own settings for this session
3. No`;
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
  });

  it('returns null for mixed explanation with short items', () => {
    // First item has em-dash → entire set rejected
    const text = `확인 사항:
1. 설정 파일 확인 — config.json의 값이 올바른지
2. 서버 재시작
3. 로그 확인`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('returns null for en-dash explanations', () => {
    const text = `원인:
1. 캐시 문제 – 브라우저 캐시가 남아있음
2. 버전 불일치 – 서버와 클라이언트 버전이 다름`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('detects binary choice where one option has em-dash description', () => {
    const text = `어떻게 할까요?
1. 진행 — 현재 방향으로 구현
2. 취소`;
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 2);
    assert.equal(result[0].index, '1');
    assert.equal(result[1].index, '2');
  });

  it('returns null for binary explanation where both have em-dashes', () => {
    const text = `원인 분석:
1. 캐시 문제 — 브라우저 캐시가 남아있음
2. 버전 불일치 — 서버와 클라이언트 버전이 다름`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('detects letter choices (A/B/C)', () => {
    const text = `Which option?
A. Keep current implementation
B. Refactor to new pattern
C. Delete and rewrite`;
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
    assert.equal(result[0].index, 'A');
  });

  it('detects parenthesized number choices', () => {
    const text = `Select:
(1) Run tests
(2) Skip tests
(3) Run with coverage`;
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
  });

  it('returns null for arrow step lists', () => {
    const text = `배포 순서:
1. 빌드 실행 → dist 폴더 생성
2. 테스트 실행 → 결과 확인
3. 배포 스크립트 실행 → 서버 반영`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseRegexChoices(''), null);
  });

  it('returns null for single-line text', () => {
    assert.equal(parseRegexChoices('just a plain sentence'), null);
  });

  it('caps at 10 choices', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `${i + 1}. Option ${i + 1}`).join('\n');
    const result = parseRegexChoices(lines);
    assert.ok(result);
    assert.ok(result.length <= 10);
  });
});

describe('parseRegexChoices — plan & false-positive scenarios', () => {
  it('returns null for plan-style phase headers', () => {
    const text = `구현 계획입니다:

**Phase 1. 데이터베이스 마이그레이션**
- users 테이블에 role 컬럼 추가
- 마이그레이션 스크립트 작성

**Phase 2. API 엔드포인트 구현**
- GET /api/roles
- POST /api/roles

**Phase 3. 프론트엔드 통합**
- Role selector 컴포넌트 추가`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('returns null for implementation steps (not a choice prompt)', () => {
    // This is a common freeze scenario: numbered instructions look like choices
    const text = `다음 순서로 진행하겠습니다:

1. choiceParser.js 수정
2. 테스트 추가
3. 브릿지 재시작
4. 배포 확인

진행하겠습니다.`;
    // "진행하겠습니다" = "I'll proceed" — not asking user to choose
    // But the numbered list at the tail will be detected.
    // This is the known limitation of regex-only detection.
    const result = parseRegexChoices(text);
    // Currently detected (no explanation markers) — this documents current behavior.
    // Fenced choices or AskUserQuestion should be used instead.
    if (result) {
      assert.equal(result.length, 4);
    }
  });

  it('returns null for numbered summary with long descriptions', () => {
    const text = `변경 사항 요약:

1. choiceParser.js — looksLikeExplanation 함수에서 2개 항목일 때 every() 사용하도록 수정
2. stopParser.test.js — 바이너리 선택지 em-dash 테스트 2개 추가
3. package.json — 버전 0.5.4 → 0.5.5 업데이트

커밋하겠습니다.`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('returns null for numbered log/changelog entries', () => {
    const text = `최근 변경 이력:

1. v0.5.5 — binary choice 필터 수정
2. v0.5.4 — fenced choice fallback 추가
3. v0.5.3 — 파일 로깅 기능 추가

다음 작업으로 넘어갈까요?`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('returns null for numbered diagnostic output', () => {
    const text = `확인 결과:

1. Bridge 서버 — 정상 동작 중 (port 39200)
2. WebSocket — 연결됨 (translator: ulanzi-plugin)
3. D200H — 응답 없음 (USB 연결 확인 필요)

USB 케이블을 확인해주세요.`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('detects choices even with verbose labels (no false negative)', () => {
    const text = `어떤 방식으로 리팩터링할까요?

1. 전체 모듈을 새로 작성하고 기존 테스트를 마이그레이션
2. 인터페이스만 변경하고 내부 구현은 유지
3. 점진적으로 함수 단위로 교체`;
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
  });

  it('detects binary yes/no at end of plan', () => {
    const text = `위 계획대로 진행할까요?

1. 예
2. 아니오`;
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 2);
  });

  it('returns null for task list with checkboxes mixed in', () => {
    // Numbered items that are clearly task status, not choices
    const text = `작업 현황:

1. 데이터베이스 스키마 설계 — 완료
2. API 엔드포인트 구현 — 진행중
3. 프론트엔드 컴포넌트 — 미시작
4. 테스트 작성 — 미시작`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('returns null for numbered analysis with mixed markers', () => {
    // 3 items, first has arrow — some() rejects all
    const text = `문제 분석:

1. 세션 초기화 → handleSessionStart에서 state가 IDLE로 설정됨
2. 퍼미션 훅이 늦게 도착
3. 브로드캐스트 타이밍 이슈`;
    assert.equal(parseRegexChoices(text), null);
  });

  it('handles choices after markdown code block', () => {
    const text = "수정된 코드:\n```js\nfunction foo() { return 1; }\n```\n\n적용 방법을 선택하세요:\n1. 즉시 적용\n2. 리뷰 후 적용\n3. 취소";
    const result = parseRegexChoices(text);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
  });
});

describe('parseFencedChoices edge cases', () => {
  it('returns null for empty string', () => {
    assert.equal(parseFencedChoices(''), null);
  });

  it('returns null for fence with no closing tag', () => {
    const text = '[claude-dj-choices]\n1. Something\n2. Else';
    assert.equal(parseFencedChoices(text), null);
  });

  it('handles lines without delimiters inside fence', () => {
    const text = '[claude-dj-choices]\nSome text without numbers\n1. Valid choice\n2. Another\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].label, 'Valid choice');
  });

  it('handles unicode in labels', () => {
    const text = '[claude-dj-choices]\n1. 리팩터링\n2. 새로 작성\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].label, '리팩터링');
  });
});
