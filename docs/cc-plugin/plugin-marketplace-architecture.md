# Claude Code Plugin & Marketplace 아키텍처

> **참조 구현**: [claude-dj](https://github.com/whyjp/claude-dj)

---

## 핵심 구조: Git Repo → Marketplace → Plugin

Claude Code의 플러그인 배포 모델은 단순합니다. **Git 리포지토리 자체가 마켓플레이스**이고, 그 안의 **서브디렉터리가 플러그인**입니다.

![플러그인 생애주기 개요](./01-plugin-lifecycle-overview.png)

```
Git Repository (= Marketplace)
├── .claude-plugin/              ← 마켓 선언 (Claude가 읽는 진입점)
│   └── marketplace.json         ← "이 리포에는 이런 플러그인들이 있다"
│
└── claude-plugin/               ← 플러그인 본체 (source.path가 가리키는 곳)
    ├── hooks/hooks.json         ← 이벤트 훅 (세션 생명주기 반응)
    ├── skills/*/SKILL.md        ← 스킬 (세션에 자동 주입되는 지시문)
    ├── commands/*.md            ← 슬래시 커맨드
    └── bridge/ + public/        ← 런타임 (서버 & UI)
```

핵심은 `marketplace.json`의 `source` 필드입니다. 이 한 줄이 "Git URL의 어디가 플러그인인지"를 선언합니다:

```json
{
  "plugins": [{
    "name": "claude-dj-plugin",
    "version": "0.3.0",
    "source": {
      "source": "git-subdir",
      "url": "https://github.com/whyjp/claude-dj.git",
      "path": "claude-plugin"
    }
  }]
}
```

![플러그인 내부 구조](./02-plugin-internal-structure.png)

---

## 마켓플레이스 등록

사용자가 마켓을 등록하면, Claude Code는 Git URL을 로컬에 기록합니다.

```bash
/plugin marketplace add https://github.com/whyjp/claude-dj
```

이 명령은 `~/.claude/plugins/known_marketplaces.json`에 항목을 추가하고, 리포를 로컬에 클론/심링크합니다.

![마켓플레이스 레지스트리](./03-marketplace-registry.png)

---

## 설치 시 일어나는 일

```bash
/plugin install claude-dj-plugin
```

![설치 프로세스](./04-installation-process.png)

설치는 5개의 JSON/파일 조작으로 이루어집니다:

| 단계 | 대상 파일 | 동작 |
|------|-----------|------|
| 1 | `known_marketplaces.json` | 마켓 소스(GitHub repo) 등록 |
| 2 | `marketplaces/` 디렉터리 | 리포를 심링크 또는 클론 |
| 3 | `installed_plugins.json` | 플러그인 키·버전·경로 기록 |
| 4 | `settings.json` | `enabledPlugins`에 활성화 플래그 |
| 5 | `~/.claude/commands/` | 슬래시 커맨드 `.md` 파일 복사 |

플러그인 키는 `{plugin-name}@{marketplace-id}` 형식입니다 (예: `claude-dj-plugin@claude-dj-marketplace`).

설치 후 로컬 파일 레이아웃:

```
~/.claude/
├── settings.json                    ← enabledPlugins
├── commands/
│   ├── bridge-start.md              ← 플러그인이 복사한 커맨드
│   └── bridge-stop.md
└── plugins/
    ├── known_marketplaces.json      ← 마켓 레지스트리
    ├── installed_plugins.json       ← 플러그인 레지스트리
    ├── marketplaces/whyjp-claude-dj/  ← 리포 심링크
    └── cache/claude-dj-marketplace/   ← 캐시
```

---

## 플러그인 구성요소

플러그인 본체(`claude-plugin/`)는 4가지 구성요소의 합입니다.

![요약 아키텍처](./07-summary-architecture.png)

### Hooks — 세션 이벤트 반응

`hooks.json`에서 이벤트 이름을 키로, 실행할 Node.js 스크립트를 선언합니다.

```json
{ "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/sessionStart.js\"" }] }] }
```

`${CLAUDE_PLUGIN_ROOT}`는 런타임에 플러그인 경로로 치환됩니다. claude-dj는 17개 이벤트를 처리합니다:

> `SessionStart` · `SessionEnd` · `UserPromptSubmit` · `PermissionRequest` · `TaskCreated` · `TaskCompleted` · `PreCompact` · `PostCompact` · `TeammateIdle` · `Notification` · `PreToolUse` · `PostToolUse` · `PostToolUseFailure` · `Stop` · `StopFailure` · `SubagentStart` · `SubagentStop`

### Skills — 자동 주입 지시문

YAML 프론트매터 + Markdown 본문. 세션 시작 시 자동으로 에이전트 컨텍스트에 주입됩니다.

### Commands — 슬래시 커맨드

`.md` 파일로 정의. 설치 시 `~/.claude/commands/`에 복사되어 `/bridge-start` 등으로 호출 가능합니다.

### Bridge — 런타임 서버

Express + WebSocket 서버. 훅 스크립트가 HTTP로 브리지와 통신하며, 물리 덱/브라우저 UI를 Claude Code 세션에 연결합니다.

---

## 업데이트 & 제거

**업데이트**: `claude-plugin/package.json`이 버전 단일 소스. `bump-version.js`가 5개 파일을 동기화합니다.

![버전 동기화](./05-version-sync.png)

```bash
node scripts/bump-version.js patch   # 0.3.0 → 0.3.1
```

개발자가 push하면 사용자 측 Claude Code가 마켓을 재동기화하여 새 버전을 로드합니다.

**제거**: `installed_plugins.json`·`known_marketplaces.json`·`settings.json`에서 항목을 삭제하고, 캐시·심링크·커맨드 파일·브리지 프로세스를 정리합니다.

```bash
/plugin uninstall claude-dj-plugin    # 또는 node cli/index.js uninstall
```

---

## 타 에이전트 시스템 이식 가이드

이 Git-Repo-as-Marketplace 패턴은 Claude Code에 종속된 것이 아니라, **에이전트가 플러그인을 발견·설치·실행하는 범용 설계**입니다. 다른 에이전트 시스템(Cursor, Windsurf, Cline, 자체 에이전트 등)에 이식하려면 아래 5개 계층을 각각 구현해야 합니다.

### 1. 매니페스트 파서 (Discovery Layer)

`.claude-plugin/marketplace.json`을 읽어 플러그인 목록과 소스 위치를 해석하는 모듈입니다.

**이식 시 할 일**:
- `marketplace.json` 스키마를 그대로 재사용하거나, 자체 에이전트의 매니페스트 형식으로 매핑하는 어댑터 작성
- `source.source`가 `"git-subdir"`일 때 Git clone + 서브디렉터리 추출 로직 구현
- 하나의 리포에 여러 플러그인이 있을 수 있으므로 `plugins[]` 배열 순회 처리

```
이식 난이도: ★☆☆☆☆ (JSON 파싱 + git clone)
```

### 2. 레지스트리 매니저 (Registry Layer)

어떤 마켓이 등록되어 있고, 어떤 플러그인이 설치되어 있는지를 추적하는 상태 저장소입니다.

**이식 시 할 일**:
- `known_marketplaces.json`, `installed_plugins.json` 등가물을 자체 에이전트의 설정 디렉터리에 구현
- 플러그인 키 체계(`name@marketplace`) 또는 자체 네이밍 규칙 결정
- scope(user/project) 구분이 필요한지 판단

```
이식 난이도: ★★☆☆☆ (CRUD on JSON files)
```

### 3. 훅 디스패처 (Event Layer)

이것이 **가장 핵심적이고 에이전트마다 가장 다른 부분**입니다. Claude Code는 `SessionStart`, `PermissionRequest`, `PreToolUse` 등의 이벤트를 정의하고, `hooks.json`에 선언된 커맨드를 서브프로세스로 실행합니다.

**이식 시 할 일**:
- 자체 에이전트의 생명주기 이벤트를 정의하고, Claude Code 이벤트와의 매핑 테이블 작성
- `hooks.json`을 읽어 이벤트 → 스크립트 실행을 디스패치하는 런타임 구현
- 환경변수(`CLAUDE_PLUGIN_ROOT` 등)와 stdin/stdout 프로토콜 결정
- timeout, 에러 핸들링, 동시 훅 실행 정책 결정

```
이식 난이도: ★★★★☆ (에이전트 코어에 이벤트 시스템 필요)
```

**이벤트 매핑 예시**:

| Claude Code 이벤트 | 범용 등가 개념 | 비고 |
|---------------------|----------------|------|
| `SessionStart` / `SessionEnd` | 에이전트 세션 생명주기 | 대부분의 에이전트에 존재 |
| `PermissionRequest` | 도구 실행 승인 | Human-in-the-loop 패턴 |
| `PreToolUse` / `PostToolUse` | 도구 실행 전후 미들웨어 | 로깅, 알림, 변환에 사용 |
| `Stop` | 에이전트 정지 요청 | 사용자 인터럽트 처리 |
| `SubagentStart` / `SubagentStop` | 하위 에이전트 추적 | 멀티에이전트 시스템만 해당 |
| `Notification` | 범용 알림 채널 | UI 연동 |

### 4. 스킬 로더 (Injection Layer)

`skills/*/SKILL.md`를 읽어 세션의 시스템 프롬프트나 컨텍스트에 주입하는 모듈입니다.

**이식 시 할 일**:
- YAML 프론트매터 파싱 (`name`, `description`, `user_invocable` 등)
- 본문 Markdown을 에이전트의 시스템 프롬프트/규칙에 삽입하는 인터페이스 구현
- 스킬 활성화 조건(항상 / 사용자 호출 시만) 처리

```
이식 난이도: ★★☆☆☆ (프롬프트 조작 API만 있으면 됨)
```

### 5. 커맨드 등록기 (Command Layer)

슬래시 커맨드 `.md` 파일을 에이전트의 커맨드 시스템에 등록하는 모듈입니다.

**이식 시 할 일**:
- 커맨드 `.md` 파일을 파싱하여 에이전트의 커맨드 레지스트리에 등록
- 커맨드 본문의 Bash 블록 실행 방식 결정 (직접 실행 / 에이전트에게 지시)
- 설치/제거 시 커맨드 파일 복사/삭제 자동화

```
이식 난이도: ★☆☆☆☆ (파일 복사 + 네이밍 규칙)
```

### 이식 전략 요약

가장 현실적인 접근은 **계층 1·2(매니페스트+레지스트리)를 먼저 이식**해서 "Git에서 플러그인을 찾아 설치할 수 있는" 기본 인프라를 만든 뒤, **계층 3(훅 디스패처)를 자체 에이전트의 이벤트 모델에 맞게 구현**하는 것입니다. 계층 4·5는 비교적 단순한 파일 파싱이므로 후속으로 붙이면 됩니다.

```
Phase 1: 매니페스트 파서 + 레지스트리 매니저     → 설치/제거가 동작
Phase 2: 훅 디스패처                             → 플러그인이 실제로 실행
Phase 3: 스킬 로더 + 커맨드 등록기               → 전체 기능 완성
```

이 패턴의 장점은 **플러그인 코드 자체를 수정하지 않고도** 다른 에이전트에서 로드할 수 있다는 것입니다. `marketplace.json`과 `hooks.json`은 선언적이므로, 디스패처만 바꾸면 같은 플러그인을 여러 에이전트 시스템에서 공유할 수 있습니다.
