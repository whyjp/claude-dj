# Smart Choice Detection — LLM-Assisted Response Mapping

> **Status:** TODO (Future Phase)
> **Difficulty:** HIGH
> **Date:** 2026-03-29

---

## Problem

현재 transcript 파싱은 정규식 기반으로 `1. text`, `A) text` 등 명시적 패턴만 감지한다. 하지만 Claude의 응답은 다양한 형태로 선택지를 제시한다:

| 형태 | 현재 감지 | 예시 |
|------|----------|------|
| 명시적 번호 `1. / 2. / 3.` | ✅ 가능 | "1. Refactor 2. Rewrite 3. Patch" |
| 괄호 번호 `(A) / (B)` | ✅ 가능 | "(A) Fix tests (B) Skip" |
| 볼드/마크다운 혼합 | ⚠️ 부분 | "**Option 1**: Refactor" |
| 암시적 선택 | ❌ 불가 | "We could either refactor the module or rewrite it from scratch" |
| 확인 요청 | ❌ 불가 | "Should I proceed with this approach?" (→ yes/no) |
| 계층적 선택 | ❌ 불가 | "1-a) Full refactor, 1-b) Partial, 2-a) Rewrite" |
| 자유 텍스트 입력 | ❌ 구분 불가 | "What name should I use for the function?" |

## Proposed Solution: LLM API 연동

Bridge/Plugin이 Claude의 마지막 응답을 **별도 LLM 호출**로 분석:

```
Input: Claude의 마지막 assistant 메시지
Prompt: "이 메시지에서 사용자가 선택해야 할 항목이 있는가?
         있다면 각 선택지를 번호와 짧은 라벨로 추출하라.
         선택이 필요 없으면 null을 반환하라."
Output: {choices: [{index: 1, label: "Refactor"}, ...]} | null
```

### Architecture

```
Claude Stop → Stop Hook → transcript 마지막 메시지 추출
    → LLM API 호출 (haiku — 빠르고 저렴)
    → 선택지 JSON 반환
    → Bridge에 전달
    → 덱에 선택지 버튼 표시
    → 유저 버튼 → events.jsonl → UserPromptSubmit → Claude
```

### LLM 호출 위치 선택지

| 위치 | 장점 | 단점 |
|------|------|------|
| **Stop 훅 내부** | 간단, 추가 인프라 불필요 | 훅 타임아웃 제한, API 키 관리 |
| **Bridge 서버** | 타임아웃 자유, 캐싱 가능 | Bridge에 API 키 필요, 복잡도 증가 |
| **별도 MCP 서버** | 격리됨, 독립 테스트 가능 | 추가 프로세스, 설정 복잡 |

**권장: Bridge 서버** — 이미 상시 실행 중이고, 응답 시간 제한 없음.

## Difficulty Assessment

| 항목 | 난이도 | 설명 |
|------|--------|------|
| Transcript 파싱 | LOW | 이미 구현됨 (정규식). JSONL 읽기 완료. |
| LLM API 연동 | MEDIUM | Anthropic SDK 또는 직접 HTTP. API 키 관리. |
| 프롬프트 엔지니어링 | MEDIUM | 선택지 추출 정확도. 오탐/미탐 튜닝 필요. |
| 선택지 → 덱 매핑 | LOW | 이미 WAITING_RESPONSE + choices 구조 있음. |
| 응답 → Claude 주입 | LOW | 이미 events.jsonl + UserPromptSubmit 완료. |
| 계층적 선택 (1-a, 2-b) | HIGH | UI 설계 + 2단계 버튼 인터랙션 필요. |
| 자유 텍스트 구분 | HIGH | LLM이 "선택 필요 없음" 판단해야 함. |
| 전체 통합 + 테스트 | MEDIUM | E2E 시나리오 복잡, 모킹 필요. |

**전체 난이도: HIGH** (LLM 연동 + 프롬프트 품질 + 에지케이스)

## Prerequisites

1. Anthropic API 키 (환경변수 `ANTHROPIC_API_KEY`)
2. claude-haiku-4-5 권장 (빠르고 저렴, 선택지 추출에 충분)
3. 현재 transcript 파싱 + events.jsonl 인프라 (이미 완료)

## Estimated Token Cost

- 입력: Claude 마지막 메시지 ~500 tokens
- 시스템 프롬프트: ~200 tokens
- 출력: ~50 tokens
- **매 Stop당 ~750 tokens** (haiku 기준 ~$0.0006)
- 세션당 ~50 Stop = ~$0.03/세션

## Implementation Order

1. Bridge에 `/api/analyze-choices` 엔드포인트 추가
2. LLM API 호출 모듈 (`bridge/choiceAnalyzer.js`)
3. Stop 훅 → Bridge → LLM → choices → 덱 파이프라인
4. 프롬프트 튜닝 (10+ 실제 사례로 테스트)
5. 자유 텍스트 vs 선택 vs 확인 구분 정확도 검증
6. 계층적 선택 지원 (optional, Phase 2)

## Fallback

LLM 호출 실패/타임아웃 시 → 현재 정규식 파싱으로 폴백.
정규식도 실패 시 → 버튼 표시 안 함 (현재 동작).
