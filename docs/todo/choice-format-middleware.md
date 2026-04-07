# choice-format Middleware 전환

> **Status:** TODO (Next Phase)
> **Difficulty:** MEDIUM
> **Date:** 2026-04-07
> **Related:** `smart-choice-detection.md`, `choice-format/SKILL.md`

---

## Problem

현재 choice-format은 **LLM 인스트럭션 스킬**로 동작한다. Claude에게 "모든 선택지를 AskUserQuestion으로 출력하라"고 지시하는 방식이다.

### 현재 구조의 약점

| 문제 | 설명 |
|------|------|
| **100% 보장 불가** | LLM 지시이므로 무시되거나 빠질 수 있음 |
| **다른 스킬과 충돌** | dj-test awaiting 테스트처럼 AskUserQuestion을 안 써야 하는 경우 충돌 |
| **예외 조항 관리** | 스킬마다 예외를 추가해야 함 (Direct Input Override 등) |
| **이중 경로** | AskUserQuestion(primary) + stop hook proxy(fallback)로 같은 기능이 두 곳에 존재 |

### 현재 흐름

```
[Primary] choice-format 스킬 지시 → Claude가 AskUserQuestion 직접 호출 → WAITING_CHOICE
[Fallback] Claude가 텍스트로 출력 → stop hook choiceParser 감지 → decision:"block" 프록시 → WAITING_CHOICE
```

## Proposed Solution: Stop Hook 미들웨어로 통합

choice-format 스킬을 제거하거나 최소화하고, **stop hook의 choiceParser를 primary 경로로 승격**한다.

### 미들웨어 구조

```
Claude → 자연스럽게 텍스트/목록 출력 → Stop hook 발동
  → choiceParser가 선택지 감지
    → 있으면: decision:"block" + WAITING_CHOICE (버튼 표시)
    → 없으면: WAITING_RESPONSE (awaiting 상태)
```

### 장점

| 항목 | 설명 |
|------|------|
| **프로그래밍적 제어** | hook 코드에서 정확하게 판단 — LLM 지시 불필요 |
| **스킬 충돌 해소** | Claude는 자연스럽게 출력, 선택지 감지는 hook이 담당 |
| **단일 경로** | AskUserQuestion/stop proxy 이중 경로 → stop hook 단일 경로로 통합 |
| **awaiting 자연 지원** | 선택지가 없으면 자동으로 WAITING_RESPONSE — 별도 예외 불필요 |

### 위험 / 고려사항

| 항목 | 설명 |
|------|------|
| **choiceParser 정확도** | 현재 regex 기반 — primary로 쓰려면 false positive/negative 최소화 필요 |
| **AskUserQuestion 경로 유지** | 구조화된 선택지(multiSelect 등)는 여전히 AskUserQuestion이 필요 |
| **응답 지연** | Stop hook이 blocking이므로 모든 응답에 약간의 지연 추가 |
| **smart-choice-detection 연계** | regex 한계 시 LLM 분석 연동 가능 (별도 TODO) |

## Implementation Sketch

### Phase 1: choiceParser 강화

- regex 패턴 커버리지 확대 (볼드 혼합, 괄호 등)
- false positive 방지 로직 (코드 블록/테이블 내 번호 제외)
- 신뢰도 점수 도입 → 낮으면 choice_hint(display-only), 높으면 interactive

### Phase 2: choice-format 스킬 축소

- "AskUserQuestion 강제" 지시 제거
- "선택지를 명확한 번호/문자 목록으로 작성하라" 정도의 가이드로 변경
- multiSelect가 필요한 경우만 AskUserQuestion 사용 권장

### Phase 3: stop hook을 primary 경로로

- stop hook이 항상 choiceParser 실행
- 감지 결과에 따라 WAITING_CHOICE 또는 WAITING_RESPONSE 분기
- 기존 AskUserQuestion 경로는 multiSelect/구조화 선택지 전용으로 유지

## 기존 stop hook proxy와의 차이

현재 stop hook proxy는 **fallback**이다 — choice-format 스킬이 실패했을 때만 작동한다.
미들웨어 전환 후에는 stop hook이 **primary**가 된다 — 모든 Claude 응답을 거쳐간다.

```
현재:  Claude → AskUserQuestion(primary) → stop hook(fallback)
전환:  Claude → stop hook(primary) → AskUserQuestion(multiSelect only)
```
