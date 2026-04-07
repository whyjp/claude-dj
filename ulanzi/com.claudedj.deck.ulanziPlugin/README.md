# claude-dj Deck — UlanziStudio Plugin

D200H 실기기 소유자 전용 UlanziStudio 플러그인.  
claude-dj Bridge ↔ Ulanzi D200H 하드웨어 간 양방향 번역 레이어.

> **실행 주체: UlanziStudio**  
> UlanziStudio가 `manifest.json`의 `"CodePath": "plugin/app.js"`를 읽고  
> `node plugin/app.js <address> <port> <language>` 를 직접 실행합니다.  
> **`npm start`는 없습니다. UlanziStudio 재시작 = 플러그인 재시작입니다.**  
> 단, `npm install`은 반드시 수동으로 실행해야 합니다 (UlanziStudio가 하지 않음).

---

## 사전 조건

| 항목 | 버전/비고 |
|---|---|
| Ulanzi D200H | 5열 × 4행 = 20키 장치 |
| [UlanziStudio](https://www.ulanzi.com/pages/ulanzi-deck) | 최신 버전 |
| Node.js | v20 이상 (UlanziStudio 내장 또는 시스템) |
| claude-dj Bridge | 실행 중 상태 (`/claude-dj-plugin:bridge-start`) |

---

## 최초 설치

### 1단계 — 플러그인 폴더 복사

UlanziStudio가 인식하는 플러그인 경로는 `UUID.ulanziPlugin` 형식이어야 합니다.

```powershell
$src  = "D:\github\claude-dj\ulanzi\com.claudedj.deck.ulanziPlugin"
$dest = "$env:APPDATA\Ulanzi\UlanziDeck\Plugins\com.claudedj.deck.ulanziPlugin"

# 내용물만 복사 (중첩 폴더 방지)
Get-ChildItem $src -Recurse |
  Where-Object { -not $_.PSIsContainer -and $_.FullName -notmatch 'node_modules' } |
  ForEach-Object {
    $rel    = $_.FullName.Substring($src.Length + 1)
    $target = Join-Path $dest $rel
    $dir    = Split-Path $target
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item $_.FullName $target -Force
  }
```

> **주의**: `Copy-Item $src $dest -Recurse` 를 사용하면 중첩 폴더가 생성됩니다.  
> 반드시 위의 내용물 복사 방식을 사용하세요.

### 2단계 — 의존성 설치 (npm install)

UlanziStudio가 플러그인을 실행할 때 `plugin/` 폴더 안의 `node_modules`를 사용합니다.  
**이 단계를 건너뛰면 `ws` 모듈을 찾지 못해 플러그인이 동작하지 않습니다.**

```powershell
Set-Location "$env:APPDATA\Ulanzi\UlanziDeck\Plugins\com.claudedj.deck.ulanziPlugin\plugin"
npm install --omit=dev
```

설치 후 확인:

```powershell
Test-Path ".\node_modules\ws"   # True 여야 함
```

### 3단계 — UlanziStudio 재시작

UlanziStudio를 완전히 종료 후 재시작합니다.  
Plugins 목록에 **"claude-dj Deck"** 항목이 나타나면 설치 성공입니다.

### 4단계 — 버튼 배치

D200H의 **모든 20개 칸**에 `Deck Slot` 액션을 드래그해서 채웁니다.

```
      col0  col1  col2  col3  col4
       ┌────┬────┬────┬────┬────┐
 row0  │ DS │ DS │ DS │ DS │ DS │
       ├────┼────┼────┼────┼────┤
 row1  │ DS │ DS │ DS │ DS │ DS │
       ├────┼────┼────┼────┼────┤
 row2  │ DS │ DS │ DS │ DS │ DS │
       ├────┼────┼────┼────┼────┤
 row3  │ DS │ DS │ DS │ DS │ DS │
       └────┴────┴────┴────┴────┘
DS = Deck Slot (com.claudedj.deck.slot)
```

---

## 개발 중 수정 → 반영 절차

플러그인 코드를 수정할 때마다 아래 3단계가 필요합니다.  
**UlanziStudio가 `plugin/app.js`를 직접 실행하므로, 파일을 설치 경로에 복사해야만 반영됩니다.**

```
소스 수정 → 설치 경로 복사 → (npm install) → UlanziStudio 재시작
```

### 전체 절차 (plugin/*.js 또는 package.json 변경 시)

> **반드시 UlanziStudio를 먼저 종료하세요.**  
> UlanziStudio 실행 중에는 `plugin/` 폴더가 잠겨 복사가 실패합니다.

```powershell
# Step 1: UlanziStudio 종료 확인

# Step 2: 소스 → 설치 경로 복사
$src  = "D:\github\claude-dj\ulanzi\com.claudedj.deck.ulanziPlugin"
$dest = "$env:APPDATA\Ulanzi\UlanziDeck\Plugins\com.claudedj.deck.ulanziPlugin"

Get-ChildItem $src -Recurse |
  Where-Object { -not $_.PSIsContainer -and $_.FullName -notmatch 'node_modules' } |
  ForEach-Object {
    $rel    = $_.FullName.Substring($src.Length + 1)
    $target = Join-Path $dest $rel
    $dir    = Split-Path $target
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item $_.FullName $target -Force
  }

# Step 3: npm install (package.json 변경 시 필수, 그 외에도 실행 권장)
Set-Location "$dest\plugin"
npm install --omit=dev

# Step 4: UlanziStudio 재시작 → 플러그인 자동 시작
#   UlanziStudio가 내부적으로 실행:
#   node plugin/app.js <address> <port> <language>
```

### resources(아이콘 PNG)만 변경된 경우

아이콘은 앱 실행 시 1회 로드하므로 **UlanziStudio 재시작은 필요**합니다.  
단, 파일 복사는 실행 중에도 가능합니다:

```powershell
# Step 1: 아이콘 재생성 (scripts/gen-icons.js 수정 후)
Set-Location "D:\github\claude-dj\ulanzi\com.claudedj.deck.ulanziPlugin"
node scripts/gen-icons.js

# Step 2: 설치 경로에 복사 (실행 중 가능)
$dest = "$env:APPDATA\Ulanzi\UlanziDeck\Plugins\com.claudedj.deck.ulanziPlugin"
Copy-Item ".\resources\*" "$dest\resources\" -Force

# Step 3: UlanziStudio 재시작
```

### npm install이 필요한 경우

| 상황 | npm install 필요 여부 |
|---|---|
| 최초 설치 | **필수** |
| `package.json` 변경 (의존성 추가/변경) | **필수** |
| `plugin/*.js` 코드만 변경 | 불필요 |
| `resources/*.png` 아이콘만 변경 | 불필요 |
| 설치 경로 삭제 후 재복사 | **필수** (node_modules 사라짐) |

---

## 실행 흐름

### 누가 플러그인을 시작하는가?

**UlanziStudio가 직접 실행합니다.** `npm start`는 없습니다.

```
UlanziStudio 시작
  └─ manifest.json 읽기: "CodePath": "plugin/app.js"
  └─ node plugin/app.js 127.0.0.1 3906 en   ← UlanziStudio가 자동 실행
       ├─ UlanziStudio WS(:3906) 연결
       └─ Bridge WS(:39200) 연결
            ├─ CLIENT_READY 전송
            ├─ SYNC_REQUEST 전송 → Bridge가 현재 LAYOUT 응답
            └─ 이후 양방향 실시간 통신

UlanziStudio 종료 → 플러그인 프로세스도 종료
UlanziStudio 재시작 → 플러그인 프로세스도 재시작
```

**Bridge가 모든 상태를 결정합니다.** 플러그인은 번역만 담당합니다:
- D200H 버튼 누름 → 열-우선 슬롯 → 행-우선 슬롯 변환 → Bridge 전달
- Bridge LAYOUT → 행-우선 슬롯 → 열-우선 슬롯 변환 → D200H LCD 반영

---

## 슬롯 번호 체계

UlanziStudio key 포맷: `"col_row"` → `slot = col × 5 + row`

```
      col0  col1  col2  col3  col4
       ┌────┬────┬────┬────┬────┐
 row0  │  0 │  5 │ 10 │ 15 │ 20 │  ← slot = col × 5 + row
       ├────┼────┼────┼────┼────┤       (UlanziStudio 5×5 그리드 기준)
 row1  │  1 │  6 │ 11 │ 16 │ 21 │
       ├────┼────┼────┼────┼────┤
 row2  │  2 │  7 │ 12 │ 17 │ 22 │
       ├────┼────┼────┼────┼────┤
 row3  │  3 │  8 │ 13 │ 18 │ 23 │
       └────┴────┴────┴────┴────┘
```

Bridge 내부는 행-우선(row-major) 슬롯을 사용합니다:

```
      col0  col1  col2  col3  col4
       ┌────┬────┬────┬────┬────┐
 row0  │  0 │  1 │  2 │  3 │  4 │  ← slot = row × 5 + col
       ├────┼────┼────┼────┼────┤
 row1  │  5 │  6 │  7 │  8 │  9 │
       ├────┼────┼────┼────┼────┤
 row2  │ 10 │ 11 │ 12 │ 13 │ 14 │  (10=세션수, 11=세션전환, 12=에이전트전환)
       ├────┼────┼────┼────┼────┤
 row3  │ 15 │ 16 │ 17 │ 18 │ 19 │
       └────┴────┴────┴────┴────┘
```

---

## 연결 확인

Bridge 대시보드 → **Translator 탭** (`http://localhost:39200`)

- 초록 dot: UlanziStudio 플러그인 연결됨
- 로그: Bridge ↔ D200H 메시지 교환 실시간 확인

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| UlanziStudio에 플러그인 없음 | 폴더명 오류 또는 중첩 폴더 | 설치 경로 확인, 중첩 폴더 제거 |
| 버튼 눌러도 반응 없음 | `node_modules/ws` 없음 | `npm install --omit=dev` 재실행 |
| Translator 탭 dot 꺼짐 | Bridge 미실행 또는 포트 불일치 | Bridge 시작, 포트 39200 확인 |
| 버튼 위치 어긋남 | 버튼 배치 누락 | 20개 칸 전부 Deck Slot으로 채우기 |
| 업데이트 후 변경 없음 | UlanziStudio가 파일 잠금 | UlanziStudio 종료 후 복사 |
| 코드 수정 후 반영 안 됨 | 설치 경로 복사 누락 | 소스 → 설치 경로 복사 필수 |
| npm install 후에도 오류 | 설치 경로가 아닌 소스에서 실행 | 설치 경로의 plugin/ 에서 npm install |
