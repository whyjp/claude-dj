# claude-dj Deck Translator

D200H 실기기 소유자 전용 UlanziStudio 플러그인.

claude-dj Bridge와 Ulanzi D200H 하드웨어 사이의 번역 레이어.

---

## 설치 조건

- Ulanzi D200H 장치
- [UlanziStudio](https://www.ulanzi.com/pages/ulanzi-deck) 설치
- Node.js v20+
- claude-dj Bridge 실행 중 (`/claude-dj-plugin:bridge-start`)

---

## 설치 절차

### 1. 플러그인 폴더 복사

```powershell
$src  = "D:\github\claude-dj\ulanzi\translator"
$dest = "$env:APPDATA\Ulanzi\UlanziDeck\Plugins\com.claudedj.deck.ulanziPlugin"
Copy-Item $src $dest -Recurse
```

### 2. 의존성 설치

```powershell
Set-Location "$dest\plugin"
npm install --omit=dev
```

### 3. UlanziStudio 재시작

UlanziStudio를 재시작하면 플러그인 목록에 **"claude-dj Deck"** 이 나타납니다.

### 4. 버튼 배치

D200H의 **모든 20개 칸**에 `Deck Slot` 버튼을 드래그해서 채웁니다.

---

## 슬롯 번호 체계

UlanziStudio(D200H)는 열-우선(column-major) 슬롯을 사용합니다:

```
      col0  col1  col2  col3  col4
       ┌────┬────┬────┬────┬────┐
 row0  │  0 │  5 │ 10 │ 15 │ 20 │  ← slot = col×4 + row
       ├────┼────┼────┼────┼────┤
 row1  │  1 │  6 │ 11 │ 16 │ 21 │
       ├────┼────┼────┼────┼────┤
 row2  │  2 │  7 │ 12 │ 17 │ 22 │
       ├────┼────┼────┼────┼────┤
 row3  │  3 │  8 │ 13 │ 18 │ 23 │
       └────┴────┴────┴────┴────┘
```

이 플러그인이 Bridge의 행-우선 슬롯으로 자동 변환합니다.

---

## 연결 확인

Bridge 대시보드(`http://localhost:39200`) → **Translator 탭**에서 연결 상태와 메시지 교환 로그를 확인합니다.
