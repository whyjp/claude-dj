# Troubleshooting

실제 UlanziStudio + D200H 연동 과정에서 발견된 문제들을 기록한다.
이 문서는 `claude-dj` 이식 및 향후 유지보수의 참조 자료이다.

## TBL-001: 버튼 눌러도 플러그인에서 아무 반응 없음

### 현상

-   `npm start` 실행 후 UlanziStudio 연결, `key added` 로그까지 정상
-   D200H 버튼을 눌러도 플러그인 터미널에 어떤 로그도 출력되지 않음

### 원인

`parseSlot`이 단순 정수 포맷만 처리하도록 작성되어 있었음.

실제 UlanziStudio는 `key`를 **`"row_col"` 형식**(예: `"0_0"`)으로 전달한다.
시뮬레이터(`UlanziDeckSimulator`)는 `"0"`, `"1"` 등 단순 정수를 사용하여 개발 단계에서 이 차이가 노출되지 않았다.

```
// 시뮬레이터 key 포맷
{"cmd":"keydown","key":"0", ...}

// 실제 UlanziStudio key 포맷
{"cmd":"keydown","key":"0_0", ...}
```

`Number("0_0")` → `NaN` → `parseSlot` → `null` 반환
→ `parseInputEvent` → `null` → `handleInput` 조기 반환 → 이벤트 무시

### 진단 방법

`ulanziApi.js`의 `onmessage` 핸들러에 임시 raw 로그 추가:

```javascript
this.websocket.onmessage = (evt) => {
  const data = evt?.data ? JSON.parse(evt.data) : null;
  console.log('[UlanziApi][raw]', JSON.stringify(data)); // 임시
  ...
```

버튼을 눌렀을 때 raw 메시지가 출력되는지 여부로 두 가지를 분리한다:

-   **출력됨** → 메시지는 수신되었으나 파싱 로직 오류 (이 케이스)
-   **출력 안 됨** → UlanziStudio가 이 프로세스로 이벤트를 전달하지 않음

### 수정

`parseSlot`에 `"row_col"` 포맷 처리 추가 (`eventParser.js`):

```javascript
// "row_col" 포맷 처리 (실제 UlanziStudio)
if (str.includes('_')) {
  const parts = str.split('_');
  if (parts.length !== 2) return null;
  const row = Number(parts[0]);
  const col = Number(parts[1]);
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return null;
  return row * GRID_COLS + col;
}
```

`GRID_COLS = 5`: D200H는 5열 × 3행 = 15 positions, 실제 사용 13개.

### 관련 파일

-   `com.d200htest.bridge.ulanziPlugin/plugin/core/eventParser.js`
-   `test/eventParser.test.js` — `"row_col"` 포맷 테스트 케이스 추가

---

## TBL-002: 플러그인 자동 실행 실패 (Plugins 폴더 내 node_modules 없음)

### 현상

UlanziStudio 재시작 후 플러그인이 자동으로 시작되지 않음 (`connected` 로그 없음).

### 원인

UlanziStudio는 Plugins 폴더 내 `manifest.json`의 `CodePath`를 Node.js로 실행하지만,
복사된 플러그인 폴더에 `node_modules`가 없어 `ws` 모듈을 찾지 못해 실패한다.

```
Error: Cannot find package 'ws'
```

### 해결 방법 (두 가지)

**방법 A — 개발 중 권장**: `d200h-test` 루트에서 수동 실행

```powershell
# 터미널 1: Bridge 서버
npm run bridge

# 터미널 2: Ulanzi 플러그인 (d200h-test/node_modules의 ws 사용)
npm start
```

`d200h-test/node_modules`에 `ws`가 설치되어 있으므로 정상 동작한다.
UlanziStudio의 자동 실행이 실패해도 수동 실행이 대신한다.

**방법 B — 배포 시**: 플러그인 폴더 내 의존성 설치

```powershell
cd "$env:APPDATA\Ulanzi\UlanziDeck\Plugins\com.d200htest.bridge.ulanziPlugin\plugin"
npm install ws
```

이후 UlanziStudio가 자동으로 플러그인을 실행한다.

### 주의

방법 A와 방법 B를 동시에 사용하면 두 개의 플러그인 프로세스가 UlanziStudio에 연결되어
이벤트가 중복 처리될 수 있다. 하나만 사용할 것.

---

## TBL-003: 통합 테스트 포트 충돌 (EADDRINUSE)

### 현상

`npm test` 실행 시 다음 오류 발생:

```
Error: listen EADDRINUSE: address already in use :::39299
```

### 원인

이전 테스트 실행이 비정상 종료되어 포트를 점유한 채 남아있거나,
테스트 teardown이 WebSocket 연결을 완전히 닫지 않아 포트가 해제되지 않음.

### 수정

-   `WsServer.terminateAll()` 메서드 추가: 모든 클라이언트 WebSocket을 강제 종료
-   `BridgeWsAdapter._connected` 플래그 + `isConnected` getter 추가:
    테스트의 `waitUntil(() => adapter.isConnected)` 조건 신뢰성 확보
-   `integration.test.js` teardown에서 `ws1.terminateAll()` 호출 후 `s1.close()`

포트 강제 해제 (긴급 시):

```powershell
@(39297, 39298, 39299) | ForEach-Object {
  $proc = Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue
  if ($proc) { Stop-Process -Id $proc.OwningProcess -Force }
}
```

---

## TBL-005: setStateIcon 이미지 변경 안 됨 — setBaseDataIcon + 이모지 PNG로 해결

### 현상

`setStateIcon(context, stateIndex, text)`을 호출해도 D200H LCD 이미지가 변하지 않는다.

### 원인 (두 가지 겹침)

**원인 A — 더미 이미지**: `resources/idle.png`, `active.png`가 1×1 투명 PNG였음.
IDLE과 ACTIVE가 모두 투명하므로 시각적 차이 없음.

**원인 B — solid PNG 생성 오류**: 단색 PNG를 스크립트로 생성했으나 ACTIVE(파란색) PNG의
base64가 올바르게 인코딩되지 않아 LCD에서 검은색으로 표시됨.

### 해결

1.  **이모지 PNG 사용**: Twemoji CDN에서 실제 이모지 이미지를 다운로드.
    -   IDLE → ⚫ `26ab.png` (검정 원)
    -   ACTIVE → 🟢 `1f7e2.png` (초록 원)

    ```powershell
    $base = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72"
    Invoke-WebRequest "$base/26ab.png"  -OutFile "resources/idle.png"
    Invoke-WebRequest "$base/1f7e2.png" -OutFile "resources/active.png"
    ```

2.  **`setBaseDataIcon` 사용**: `setStateIcon`(manifest 상태 인덱스 기반) 대신
    `setBaseDataIcon`(base64 PNG 직접 주입)으로 교체. manifest 이미지 의존성 완전 제거.

    ```javascript
    $UD.setBaseDataIcon(cmd.context, imgBase64, text);
    ```

3.  **파일 로드**: 어댑터 시작 시 `readFileSync`로 PNG를 읽어 base64 변환.
    `import.meta.url` 기준 상대 경로로 resources 폴더 접근.

### 관련 파일

-   `plugin/adapters/ulanziOutputAdapter.js`
-   `com.d200htest.bridge.ulanziPlugin/resources/idle.png`
-   `com.d200htest.bridge.ulanziPlugin/resources/active.png`

### 주의

Plugins 폴더에도 이미지를 복사해야 UlanziStudio manifest 아이콘이 올바르게 표시된다.

```powershell
Copy-Item "D:\github\d200h-test\com.d200htest.bridge.ulanziPlugin\resources\*.png" `
  "$env:APPDATA\Ulanzi\UlanziDeck\Plugins\com.d200htest.bridge.ulanziPlugin\resources\" -Force
```

---

## TBL-004: `key added` 로그가 같은 슬롯에 두 번 출력됨

### 현상

플러그인 재시작 후 동일 슬롯에 대해 `key added` 로그가 두 번 출력되고
actionid가 서로 다름:

```
[bridge-plugin] key added: slot=11 context=...___2_1___9b62a068...
[bridge-plugin] key added: slot=11 context=...___2_1___18da79f2...
```

### 원인

UlanziStudio에서 같은 키에 "Bridge Slot" 액션 인스턴스가 **두 개 배치된 상태**.
플러그인이 재연결될 때 UlanziStudio는 등록된 모든 인스턴스에 `add`를 보내므로
두 번 수신된다.

이전 세션에서 배치한 액션이 남아있는 상태에서 추가로 올린 경우 발생한다.

### UlanziStudio가 플러그인을 자동 실행하는가?

**아니다.** JS 플러그인이 Plugins 폴더에 설치되면, UlanziStudio는 직접 실행하는
대신 해당 폴더로 Windows Terminal을 열어 실행 명령을 표시하는 방식을 사용한다.

```
WindowsTerminal.exe -d "...Plugins\com.d200htest.bridge.ulanziPlugin\plugin"
```

실제 `node app.js` 프로세스는 기동되지 않으므로 `npm start`와 겹치지 않는다.

### 해결

UlanziStudio에서 해당 키를 **한 번 제거 후 재배치**하면 인스턴스가 하나로 정리된다.

동작 자체에는 문제없다. 키 이벤트는 UlanziStudio가 현재 활성 actionid로만 보내며,
두 번째 `key added`는 keyStates Map에 같은 slot을 가진 별도 context로 저장되지만
버튼 누름 이벤트 처리에 간섭하지 않는다.

---

## UlanziStudio WS 프로토콜 정리

실제 UlanziStudio가 플러그인으로 전달하는 메시지 형식 (D200H 기준):

| 이벤트  | 예시 raw 메시지                                                                     |
| ------- | ----------------------------------------------------------------------------------- |
| `add`   | `{"actionid":"...","cmd":"add","controller":"Keypad","device":"D200H","key":"0_0","param":{},"uuid":"com.d200htest.bridge.slot"}` |
| `keydown` | `{"actionid":"...","cmd":"keydown","key":"0_0","param":{},"uuid":"com.d200htest.bridge.slot"}` |
| `run`   | `{"actionid":"...","cmd":"run","key":"0_0","param":{},"uuid":"com.d200htest.bridge.slot"}` |
| `keyup` | `{"actionid":"...","cmd":"keyup","key":"0_0","param":{},"uuid":"com.d200htest.bridge.slot"}` |

**시뮬레이터와의 차이점:**

| 항목      | UlanziDeckSimulator | 실제 UlanziStudio |
| --------- | ------------------- | ----------------- |
| `key` 포맷 | `"0"`, `"5"` (단순 정수) | `"0_0"`, `"1_2"` (행\_열) |
| `device` 필드 | 없음 | `"D200H"` |
| `controller` 필드 | 없음 | `"Keypad"` |
