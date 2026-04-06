# d200h-test

Ulanzi D200H 하드웨어 연동 테스트 하네스.

UlanziStudio SDK 기반 Node.js 플러그인과 Bridge 서버를 이용해
D200H 버튼 입력 수신과 LCD 원격 제어를 검증한다.
검증 완료 코드는 `claude-dj`의 `pre-example`로 사용된다.

## 실기기 검증 완료

| 스테이지 | 내용                                  | 결과        |
| -------- | ------------------------------------- | ----------- |
| Stage A  | D200H 버튼 누름 → Bridge 수신         | ✅ |
| Stage B  | 버튼 누름 → LCD 토글 (⚫↔🟢)         | ✅ |
| Stage C  | REST `POST /api/layout` → LCD 제어    | ✅ |
| Stage D  | Bridge 재시작 → 플러그인 자동 재연결  | ✅ |

## Quick Start

```powershell
npm install

# 터미널 1
npm run bridge

# 터미널 2
npm start

# 테스트
npm test
```

## 문서

-   [docs/README.md](docs/README.md) — 전체 문서 인덱스 및 시스템 개요
-   [docs/architecture.md](docs/architecture.md) — Mermaid 아키텍처 다이어그램
-   [docs/components.md](docs/components.md) — 모듈 레퍼런스
-   [docs/bridge-protocol.md](docs/bridge-protocol.md) — WS / REST API 명세
-   [docs/testing.md](docs/testing.md) — 테스트 가이드
-   [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — 실환경 문제 해결 기록
-   [PORTING.md](PORTING.md) — claude-dj 이식 가이드
