# claude-dj Deck — UlanziStudio Plugin

D200H 실기기 소유자 전용 UlanziStudio 플러그인.  
claude-dj Bridge ↔ Ulanzi D200H 하드웨어 간 양방향 번역 레이어.

> **이 플러그인은 UlanziStudio가 직접 Node.js로 실행합니다.**  
> `npm install`로 의존성을 설치해야 하며, 실행은 UlanziStudio가 담당합니다.  
> 별도로 `npm start`를 실행하지 않아도 됩니다.

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

## 업데이트 (소스 변경 후)

소스 코드가 변경된 경우 아래 절차를 따릅니다.

### UlanziStudio가 실행 중일 때

UlanziStudio가 `plugin/` 폴더를 잠그므로 **UlanziStudio를 먼저 종료**해야 합니다.

```powershell
# 1. UlanziStudio 종료 확인 후 실행
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

# 2. npm install (package.json이 변경된 경우만)
Set-Location "$dest\plugin"
npm install --omit=dev

# 3. UlanziStudio 재시작
```

### resources(아이콘)만 변경된 경우

UlanziStudio 실행 중에도 가능합니다:

```powershell
$dest = "$env:APPDATA\Ulanzi\UlanziDeck\Plugins\com.claudedj.deck.ulanziPlugin"
Copy-Item "D:\github\claude-dj\ulanzi\com.claudedj.deck.ulanziPlugin\resources\*" "$dest\resources\" -Force
```

---

## 실행 흐름

```
UlanziStudio 시작
  └─ node plugin/app.js <address> <port> <language>  ← UlanziStudio가 자동 실행
       ├─ UlanziStudio WS(:3906) 연결
       └─ Bridge WS(:39200) 연결
            ├─ CLIENT_READY 전송
            ├─ SYNC_REQUEST 전송 → Bridge가 현재 LAYOUT 응답
            └─ 이후 양방향 실시간 통신
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
