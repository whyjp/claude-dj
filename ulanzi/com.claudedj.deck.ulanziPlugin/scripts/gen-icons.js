/**
 * gen-icons.js — D200H LCD 버튼 아이콘 PNG 생성
 *
 * canvas 없이 순수 Node.js로 72×72 RGBA PNG를 생성한다.
 * 각 아이콘은 배경색 + 중앙 텍스트(UTF-8 렌더링은 UlanziStudio가 담당)로 구성.
 * setBaseDataIcon(context, base64, text) 에서 text가 LCD에 오버레이되므로
 * PNG 자체는 배경색/심볼만 담는다.
 *
 * 출력: ../resources/*.png
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '../resources');
mkdirSync(OUT, { recursive: true });

const W = 72, H = 72;

// ── PNG 인코더 ──────────────────────────────────────────────

function crc32(buf) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crcBuf = Buffer.concat([t, data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, t, data, c]);
}

/**
 * RGBA 픽셀 배열(W×H×4)로 PNG Buffer를 만든다.
 * @param {Uint8Array} pixels - length = W*H*4
 */
function makePng(pixels) {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0; // filter: None
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 4;
      const dst = y * (1 + W * 4) + 1 + x * 4;
      raw[dst]     = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 드로잉 헬퍼 ─────────────────────────────────────────────

function fillPixels(r, g, b, a = 255) {
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    px[i * 4]     = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = a;
  }
  return px;
}

/** 픽셀 단위 원 그리기 */
function drawCircle(px, cx, cy, r, col) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * W + x) * 4;
        px[i] = col[0]; px[i+1] = col[1]; px[i+2] = col[2]; px[i+3] = col[3] ?? 255;
      }
    }
  }
}

/** 픽셀 단위 둥근 사각형 */
function drawRoundRect(px, x0, y0, x1, y1, r, col) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // 모서리 체크
      let inside = true;
      if (x < x0 + r && y < y0 + r) inside = (x0+r-x)**2+(y0+r-y)**2 <= r*r;
      else if (x > x1 - r && y < y0 + r) inside = (x1-r-x)**2+(y0+r-y)**2 <= r*r;
      else if (x < x0 + r && y > y1 - r) inside = (x0+r-x)**2+(y1-r-y)**2 <= r*r;
      else if (x > x1 - r && y > y1 - r) inside = (x1-r-x)**2+(y1-r-y)**2 <= r*r;
      if (inside) {
        const i = (y * W + x) * 4;
        px[i] = col[0]; px[i+1] = col[1]; px[i+2] = col[2]; px[i+3] = col[3] ?? 255;
      }
    }
  }
}

/** 수평선 */
function drawHLine(px, x0, x1, y, col, thick = 1) {
  for (let t = 0; t < thick; t++) {
    for (let x = x0; x <= x1; x++) {
      const i = ((y + t) * W + x) * 4;
      if (i >= 0 && i < px.length - 3) {
        px[i] = col[0]; px[i+1] = col[1]; px[i+2] = col[2]; px[i+3] = col[3] ?? 255;
      }
    }
  }
}

/** 수직선 */
function drawVLine(px, x, y0, y1, col, thick = 1) {
  for (let t = 0; t < thick; t++) {
    for (let y = y0; y <= y1; y++) {
      const i = (y * W + (x + t)) * 4;
      if (i >= 0 && i < px.length - 3) {
        px[i] = col[0]; px[i+1] = col[1]; px[i+2] = col[2]; px[i+3] = col[3] ?? 255;
      }
    }
  }
}

// ── 색상 팔레트 ──────────────────────────────────────────────

const C = {
  bg:       [12,  12,  20,  255],  // 거의 검정
  bgDim:    [20,  20,  32,  255],  // 어두운 배경
  bgGreen:  [10,  40,  20,  255],  // 초록 배경
  bgRed:    [40,  10,  15,  255],  // 빨강 배경
  bgAmber:  [40,  32,   8,  255],  // 노랑 배경
  bgBlue:   [10,  25,  50,  255],  // 파랑 배경
  bgPurple: [25,  15,  45,  255],  // 보라 배경
  bgTeal:   [10,  35,  35,  255],  // 청록 배경
  bgGray:   [25,  25,  35,  255],  // 회색 배경

  green:    [39, 255, 110, 255],
  greenDim: [20, 120,  55, 255],
  red:      [255,  51,  85, 255],
  redDim:   [140,  30,  50, 255],
  amber:    [255, 200,   0, 255],
  amberDim: [140, 110,   0, 255],
  blue:     [ 68, 170, 255, 255],
  blueDim:  [ 35,  90, 140, 255],
  purple:   [187, 136, 255, 255],
  purpleDim:[ 90,  65, 130, 255],
  teal:     [ 68, 255, 204, 255],
  white:    [244, 244, 255, 255],
  muted:    [100, 100, 140, 255],
  dark:     [ 30,  30,  50, 255],
};

// ── 아이콘 정의 ──────────────────────────────────────────────

function save(name, px) {
  const buf = makePng(px);
  writeFileSync(join(OUT, name + '.png'), buf);
  console.log(`  ✓ ${name}.png`);
}

// idle — 어두운 배경에 작은 dim 원
function makeIdle() {
  const px = fillPixels(...C.bg);
  drawCircle(px, 36, 36, 8, C.dark);
  return px;
}

// active — 초록 배경에 초록 원
function makeActive() {
  const px = fillPixels(...C.bgGreen);
  drawCircle(px, 36, 36, 22, C.green);
  drawCircle(px, 36, 36, 14, C.bgGreen);
  return px;
}

// processing — 노랑 배경에 점 3개 (로딩 표시)
function makeProcessing() {
  const px = fillPixels(...C.bgAmber);
  drawCircle(px, 20, 36, 7, C.amber);
  drawCircle(px, 36, 36, 7, C.amberDim);
  drawCircle(px, 52, 36, 7, C.amberDim);
  return px;
}

// approve — 초록 배경에 체크마크
function makeApprove() {
  const px = fillPixels(...C.bgGreen);
  drawRoundRect(px, 10, 10, 62, 62, 8, C.greenDim);
  // 체크마크: \ 부분
  for (let i = 0; i < 14; i++) {
    const x = 18 + i, y = 34 + i;
    drawCircle(px, x, y, 3, C.green);
  }
  // 체크마크: / 부분
  for (let i = 0; i < 22; i++) {
    const x = 30 + i, y = 48 - i;
    drawCircle(px, x, y, 3, C.green);
  }
  return px;
}

// always (Always Allow) — 파랑 배경에 자물쇠
function makeAlways() {
  const px = fillPixels(...C.bgBlue);
  drawRoundRect(px, 10, 10, 62, 62, 8, C.blueDim);
  // 자물쇠 몸통
  drawRoundRect(px, 22, 38, 50, 60, 4, C.blue);
  // 자물쇠 고리 (반원)
  for (let y = 20; y <= 40; y++) {
    for (let x = 22; x <= 50; x++) {
      const dx = x - 36, dy = y - 36;
      const r2 = dx*dx + dy*dy;
      if (r2 >= 100 && r2 <= 196 && y <= 36) { // 반원 외곽
        const i = (y * W + x) * 4;
        px[i] = C.blue[0]; px[i+1] = C.blue[1]; px[i+2] = C.blue[2]; px[i+3] = 255;
      }
    }
  }
  // 열쇠 구멍
  drawCircle(px, 36, 48, 4, C.bgBlue);
  return px;
}

// deny — 빨강 배경에 X
function makeDeny() {
  const px = fillPixels(...C.bgRed);
  drawRoundRect(px, 10, 10, 62, 62, 8, C.redDim);
  for (let i = 0; i < 30; i++) {
    drawCircle(px, 18 + i, 18 + i, 3, C.red);
    drawCircle(px, 54 - i, 18 + i, 3, C.red);
  }
  return px;
}

// submit (Done) — 청록 배경에 더블 체크
function makeSubmit() {
  const px = fillPixels(...C.bgTeal);
  drawRoundRect(px, 10, 10, 62, 62, 8, [20, 80, 70, 255]);
  for (let i = 0; i < 10; i++) {
    drawCircle(px, 14+i, 34+i, 2, C.teal);
    drawCircle(px, 24+i, 44-i, 2, C.teal);
  }
  for (let i = 0; i < 10; i++) {
    drawCircle(px, 24+i, 34+i, 2, C.teal);
    drawCircle(px, 34+i, 44-i, 2, C.teal);
  }
  return px;
}

// awaiting — 보라 배경에 모래시계
function makeAwaiting() {
  const px = fillPixels(...C.bgPurple);
  drawRoundRect(px, 10, 10, 62, 62, 8, C.purpleDim);
  // 모래시계 위 삼각형
  for (let y = 16; y <= 36; y++) {
    const w = Math.round((36 - y) * 20 / 20);
    drawHLine(px, 36 - w, 36 + w, y, C.purple, 1);
  }
  // 모래시계 아래 삼각형
  for (let y = 36; y <= 56; y++) {
    const w = Math.round((y - 36) * 20 / 20);
    drawHLine(px, 36 - w, 36 + w, y, C.purple, 1);
  }
  return px;
}

// session-count — 회색 배경에 # 심볼
function makeSessionCount() {
  const px = fillPixels(...C.bgGray);
  drawHLine(px, 20, 52, 28, C.muted, 3);
  drawHLine(px, 20, 52, 42, C.muted, 3);
  drawVLine(px, 28, 20, 52, C.muted, 3);
  drawVLine(px, 42, 20, 52, C.muted, 3);
  return px;
}

// session-switch — 파랑 배경에 육각형 (⬡)
function makeSessionSwitch() {
  const px = fillPixels(...C.bgBlue);
  // 육각형 꼭짓점
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push([36 + 22 * Math.cos(a), 36 + 22 * Math.sin(a)]);
  }
  // 변 그리기
  for (let i = 0; i < 6; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % 6];
    const steps = 30;
    for (let t = 0; t <= steps; t++) {
      const x = Math.round(x0 + (x1 - x0) * t / steps);
      const y = Math.round(y0 + (y1 - y0) * t / steps);
      drawCircle(px, x, y, 2, C.blue);
    }
  }
  return px;
}

// agent-switch — 보라 배경에 ◈ (다이아몬드+원)
function makeAgentSwitch() {
  const px = fillPixels(...C.bgPurple);
  // 다이아몬드
  const pts = [[36,14],[58,36],[36,58],[14,36]];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % 4];
    const steps = 30;
    for (let t = 0; t <= steps; t++) {
      const x = Math.round(x0 + (x1 - x0) * t / steps);
      const y = Math.round(y0 + (y1 - y0) * t / steps);
      drawCircle(px, x, y, 2, C.purple);
    }
  }
  // 중앙 원
  drawCircle(px, 36, 36, 8, C.purple);
  drawCircle(px, 36, 36, 5, C.bgPurple);
  return px;
}

// choice-N (숫자) — 배경색 + 숫자 표시는 text 오버레이로
// 각 번호별 색상 구분
const CHOICE_COLORS = [
  C.bgGreen, C.bgAmber, C.bgBlue, C.bgPurple,
  [40, 20, 10, 255], [10, 35, 30, 255], [35, 10, 30, 255],
  [30, 35, 10, 255], [10, 25, 40, 255], [35, 25, 10, 255],
];
const CHOICE_FG = [
  C.green, C.amber, C.blue, C.purple,
  [255, 136, 68, 255], [68, 255, 204, 255], [255, 68, 170, 255],
  [136, 255, 68, 255], [68, 170, 255, 255], [255, 170, 68, 255],
];

function makeChoiceN(n) { // n: 1~10
  const idx = (n - 1) % 10;
  const px = fillPixels(...CHOICE_COLORS[idx]);
  drawRoundRect(px, 8, 8, 64, 64, 10, CHOICE_FG[idx].map((v, i) => i < 3 ? Math.round(v * 0.25) : v));
  // 테두리
  for (let t = 0; t < 3; t++) {
    drawHLine(px, 8+t, 64-t, 8+t, CHOICE_FG[idx], 1);
    drawHLine(px, 8+t, 64-t, 64-t, CHOICE_FG[idx], 1);
    drawVLine(px, 8+t, 8+t, 64-t, CHOICE_FG[idx], 1);
    drawVLine(px, 64-t, 8+t, 64-t, CHOICE_FG[idx], 1);
  }
  return px;
}

// choice-A~J (알파벳) — 숫자와 동일 배경, 알파벳은 text 오버레이
function makeChoiceAlpha(letter) { // letter: 'a'~'j'
  const idx = letter.charCodeAt(0) - 'a'.charCodeAt(0);
  return makeChoiceN(idx + 1); // 같은 색상 패턴 재사용
}

// multi-on / multi-off — 체크박스 스타일
function makeMultiOn() {
  const px = fillPixels(...C.bgGreen);
  drawRoundRect(px, 12, 12, 60, 60, 6, C.greenDim);
  // 체크
  for (let i = 0; i < 12; i++) {
    drawCircle(px, 22+i, 36+i*0.5, 2, C.green);
    drawCircle(px, 34+i, 48-i, 2, C.green);
  }
  return px;
}

function makeMultiOff() {
  const px = fillPixels(...C.bgGray);
  drawRoundRect(px, 12, 12, 60, 60, 6, C.muted);
  return px;
}

// ── 생성 실행 ────────────────────────────────────────────────

console.log('Generating icons...');

save('idle',           makeIdle());
save('active',         makeActive());
save('processing',     makeProcessing());
save('approve',        makeApprove());
save('always',         makeAlways());
save('deny',           makeDeny());
save('submit',         makeSubmit());
save('awaiting',       makeAwaiting());
save('session-count',  makeSessionCount());
save('session-switch', makeSessionSwitch());
save('agent-switch',   makeAgentSwitch());
save('multi-on',       makeMultiOn());
save('multi-off',      makeMultiOff());

// 숫자 선택지 1~10
for (let n = 1; n <= 10; n++) {
  save(`choice-${n}`, makeChoiceN(n));
}

// 알파벳 선택지 a~j
for (let i = 0; i < 10; i++) {
  const letter = String.fromCharCode('a'.charCodeAt(0) + i);
  save(`choice-${letter}`, makeChoiceAlpha(letter));
}

console.log(`Done — ${13 + 10 + 10} icons generated in ${OUT}`);
