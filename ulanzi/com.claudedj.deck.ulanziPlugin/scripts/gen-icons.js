/**
 * gen-icons.js — D200H LCD 버튼 아이콘 PNG 생성
 *
 * 72×72 RGBA PNG를 순수 Node.js로 생성한다.
 * choice-N / choice-A 아이콘에는 비트맵 폰트로 숫자/문자를 직접 그린다.
 * (setBaseDataIcon의 text 오버레이는 D200H에서 표시 안 될 수 있으므로
 *  아이콘 이미지 자체에 숫자/문자를 포함한다.)
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
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}

function makePng(pixels) {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 4;
      const dst = y * (1 + W * 4) + 1 + x * 4;
      raw[dst] = pixels[src]; raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2]; raw[dst+3] = pixels[src+3];
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 픽셀 헬퍼 ──────────────────────────────────────────────

function fill(r, g, b, a = 255) {
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    px[i*4]=r; px[i*4+1]=g; px[i*4+2]=b; px[i*4+3]=a;
  }
  return px;
}

function setPixel(px, x, y, col) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  px[i]=col[0]; px[i+1]=col[1]; px[i+2]=col[2]; px[i+3]=col[3]??255;
}

function circle(px, cx, cy, r, col) {
  for (let y = cy-r; y <= cy+r; y++)
    for (let x = cx-r; x <= cx+r; x++)
      if ((x-cx)**2+(y-cy)**2 <= r*r) setPixel(px, x, y, col);
}

function rect(px, x0, y0, x1, y1, col) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      setPixel(px, x, y, col);
}

function roundRect(px, x0, y0, x1, y1, r, col) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let ok = true;
      if (x<x0+r&&y<y0+r) ok=(x0+r-x)**2+(y0+r-y)**2<=r*r;
      else if (x>x1-r&&y<y0+r) ok=(x1-r-x)**2+(y0+r-y)**2<=r*r;
      else if (x<x0+r&&y>y1-r) ok=(x0+r-x)**2+(y1-r-y)**2<=r*r;
      else if (x>x1-r&&y>y1-r) ok=(x1-r-x)**2+(y1-r-y)**2<=r*r;
      if (ok) setPixel(px, x, y, col);
    }
  }
}

function line(px, x0, y0, x1, y1, col, thick=2) {
  const dx = Math.abs(x1-x0), dy = Math.abs(y1-y0);
  const sx = x0<x1?1:-1, sy = y0<y1?1:-1;
  let err = dx-dy, x=x0, y=y0;
  while (true) {
    for (let ty=-Math.floor(thick/2); ty<=Math.floor(thick/2); ty++)
      for (let tx=-Math.floor(thick/2); tx<=Math.floor(thick/2); tx++)
        setPixel(px, x+tx, y+ty, col);
    if (x===x1&&y===y1) break;
    const e2=2*err;
    if (e2>-dy){err-=dy;x+=sx;}
    if (e2<dx){err+=dx;y+=sy;}
  }
}

// ── 비트맵 폰트 (7×9 픽셀) ──────────────────────────────────

// 각 문자: 7열×9행 비트맵 (1=픽셀, 0=배경)
const FONT = {
  '0': [0b0111110,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b0111110],
  '1': [0b0011000,0b0111000,0b1111000,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b1111111],
  '2': [0b0111110,0b1100011,0b0000011,0b0000110,0b0001100,0b0011000,0b0110000,0b1100000,0b1111111],
  '3': [0b0111110,0b1100011,0b0000011,0b0000011,0b0011110,0b0000011,0b0000011,0b1100011,0b0111110],
  '4': [0b0000110,0b0001110,0b0011110,0b0110110,0b1100110,0b1111111,0b0000110,0b0000110,0b0000110],
  '5': [0b1111111,0b1100000,0b1100000,0b1111110,0b0000011,0b0000011,0b0000011,0b1100011,0b0111110],
  '6': [0b0011110,0b0110000,0b1100000,0b1111110,0b1100011,0b1100011,0b1100011,0b1100011,0b0111110],
  '7': [0b1111111,0b0000011,0b0000110,0b0001100,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000],
  '8': [0b0111110,0b1100011,0b1100011,0b1100011,0b0111110,0b1100011,0b1100011,0b1100011,0b0111110],
  '9': [0b0111110,0b1100011,0b1100011,0b1100011,0b0111111,0b0000011,0b0000011,0b0110011,0b0111110],
  'A': [0b0011100,0b0110110,0b1100011,0b1100011,0b1111111,0b1100011,0b1100011,0b1100011,0b1100011],
  'B': [0b1111110,0b1100011,0b1100011,0b1100011,0b1111110,0b1100011,0b1100011,0b1100011,0b1111110],
  'C': [0b0111110,0b1100011,0b1100000,0b1100000,0b1100000,0b1100000,0b1100000,0b1100011,0b0111110],
  'D': [0b1111100,0b1100110,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100110,0b1111100],
  'E': [0b1111111,0b1100000,0b1100000,0b1100000,0b1111100,0b1100000,0b1100000,0b1100000,0b1111111],
  'F': [0b1111111,0b1100000,0b1100000,0b1100000,0b1111100,0b1100000,0b1100000,0b1100000,0b1100000],
  'G': [0b0111110,0b1100011,0b1100000,0b1100000,0b1100111,0b1100011,0b1100011,0b1100011,0b0111110],
  'H': [0b1100011,0b1100011,0b1100011,0b1100011,0b1111111,0b1100011,0b1100011,0b1100011,0b1100011],
  'I': [0b1111111,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b1111111],
  'J': [0b0000111,0b0000011,0b0000011,0b0000011,0b0000011,0b0000011,0b1100011,0b1100011,0b0111110],
};

/**
 * 비트맵 문자를 픽셀 배열에 그린다.
 * @param {Uint8Array} px
 * @param {string} ch - 단일 문자
 * @param {number} cx - 중앙 x
 * @param {number} cy - 중앙 y
 * @param {number} scale - 픽셀 크기 배수
 * @param {number[]} col - RGBA 색상
 */
function drawChar(px, ch, cx, cy, scale, col) {
  const bitmap = FONT[ch.toUpperCase()];
  if (!bitmap) return;
  const fw = 7 * scale, fh = 9 * scale;
  const ox = cx - Math.floor(fw / 2);
  const oy = cy - Math.floor(fh / 2);
  for (let row = 0; row < 9; row++) {
    for (let bit = 0; bit < 7; bit++) {
      if (bitmap[row] & (1 << (6 - bit))) {
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++)
            setPixel(px, ox + bit*scale + sx, oy + row*scale + sy, col);
      }
    }
  }
}

/**
 * 두 자리 숫자(10)를 그린다.
 */
function drawText(px, text, cx, cy, scale, col) {
  const chars = String(text).split('');
  const fw = 7 * scale;
  const gap = scale;
  const totalW = chars.length * fw + (chars.length - 1) * gap;
  let x = cx - Math.floor(totalW / 2) + Math.floor(fw / 2);
  for (const ch of chars) {
    drawChar(px, ch, x, cy, scale, col);
    x += fw + gap;
  }
}

// ── 색상 팔레트 ──────────────────────────────────────────────

const C = {
  bg:       [10,  10,  18, 255],
  bgGreen:  [ 8,  35,  16, 255],
  bgRed:    [35,   8,  12, 255],
  bgAmber:  [35,  28,   5, 255],
  bgBlue:   [ 8,  20,  45, 255],
  bgPurple: [22,  12,  40, 255],
  bgTeal:   [ 8,  30,  30, 255],
  bgGray:   [20,  20,  30, 255],

  green:    [ 39, 255, 110, 255],
  greenDim: [ 18, 100,  48, 255],
  red:      [255,  51,  85, 255],
  redDim:   [120,  25,  42, 255],
  amber:    [255, 200,   0, 255],
  amberDim: [120,  95,   0, 255],
  blue:     [ 68, 170, 255, 255],
  blueDim:  [ 30,  80, 130, 255],
  purple:   [187, 136, 255, 255],
  purpleDim:[ 80,  55, 120, 255],
  teal:     [ 68, 255, 204, 255],
  white:    [244, 244, 255, 255],
  muted:    [ 80,  80, 120, 255],
  dark:     [ 25,  25,  40, 255],
};

// choice 색상 10종
const CHOICE_BG = [
  [8,35,16],[35,28,5],[8,20,45],[22,12,40],
  [35,18,5],[8,30,25],[30,8,25],[25,30,8],
  [8,18,35],[30,22,8],
].map(v => [...v, 255]);

const CHOICE_FG = [
  C.green, C.amber, C.blue, C.purple,
  [255,136,68,255],[68,255,204,255],[255,68,170,255],
  [136,255,68,255],[68,170,255,255],[255,170,68,255],
];

// ── 아이콘 생성 함수 ─────────────────────────────────────────

function save(name, px) {
  writeFileSync(join(OUT, name + '.png'), makePng(px));
  console.log(`  ✓ ${name}.png`);
}

// idle — 어두운 배경에 작은 dim 원 (캐릭터 없는 빈 슬롯)
function makeIdle() {
  const px = fill(...C.bg);
  circle(px, 36, 36, 6, C.dark);
  return px;
}

// ── 이모지 캐릭터 픽셀 드로잉 헬퍼 ─────────────────────────

/**
 * 얼굴 기본형: 원형 머리 + 눈 2개
 * @param {Uint8Array} px
 * @param {number} cx 중심 x
 * @param {number} cy 중심 y
 * @param {number} r 머리 반지름
 * @param {number[]} faceCol 얼굴 색
 * @param {number[]} outlineCol 외곽선 색
 */
function drawFaceBase(px, cx, cy, r, faceCol, outlineCol) {
  circle(px, cx, cy, r, outlineCol);
  circle(px, cx, cy, r - 2, faceCol);
}

/** 눈 (기본 점) */
function drawEyes(px, cx, cy, eyeCol) {
  circle(px, cx - 7, cy - 4, 3, eyeCol);
  circle(px, cx + 7, cy - 4, 3, eyeCol);
}

/** 웃는 입 (호) */
function drawSmile(px, cx, cy, col) {
  for (let a = 0; a <= 180; a += 10) {
    const rad = a * Math.PI / 180;
    const x = Math.round(cx + 8 * Math.cos(rad));
    const y = Math.round(cy + 5 + 4 * Math.sin(rad));
    circle(px, x, y, 1, col);
  }
}

/** 크게 웃는 입 (큰 호) */
function drawBigSmile(px, cx, cy, col) {
  for (let a = 0; a <= 180; a += 8) {
    const rad = a * Math.PI / 180;
    const x = Math.round(cx + 10 * Math.cos(rad));
    const y = Math.round(cy + 6 + 5 * Math.sin(rad));
    circle(px, x, y, 2, col);
  }
}

/** 슬픈 입 (뒤집힌 호) */
function drawFrown(px, cx, cy, col) {
  for (let a = 0; a <= 180; a += 10) {
    const rad = a * Math.PI / 180;
    const x = Math.round(cx + 8 * Math.cos(rad));
    const y = Math.round(cy + 12 - 4 * Math.sin(rad));
    circle(px, x, y, 1, col);
  }
}

/** 놀란 입 (작은 원) */
function drawSurprisedMouth(px, cx, cy, col) {
  circle(px, cx, cy + 9, 4, col);
  circle(px, cx, cy + 9, 2, [10, 10, 18, 255]);
}

/** 윙크 (한쪽 눈 선) */
function drawWink(px, cx, cy, eyeCol) {
  circle(px, cx - 7, cy - 4, 3, eyeCol);
  line(px, cx + 4, cy - 4, cx + 10, cy - 4, eyeCol, 2);
}

/** 하트 눈 */
function drawHeartEyes(px, cx, cy, col) {
  // 왼쪽 하트
  circle(px, cx - 9, cy - 5, 3, col);
  circle(px, cx - 6, cy - 5, 3, col);
  circle(px, cx - 7, cy - 2, 3, col);
  // 오른쪽 하트
  circle(px, cx + 4, cy - 5, 3, col);
  circle(px, cx + 7, cy - 5, 3, col);
  circle(px, cx + 6, cy - 2, 3, col);
}

/** 별 눈 (반짝) */
function drawStarEyes(px, cx, cy, col) {
  // 왼쪽 별
  circle(px, cx - 7, cy - 4, 4, col);
  setPixel(px, cx - 7, cy - 8, col); setPixel(px, cx - 7, cy, col);
  setPixel(px, cx - 11, cy - 4, col); setPixel(px, cx - 3, cy - 4, col);
  // 오른쪽 별
  circle(px, cx + 7, cy - 4, 4, col);
  setPixel(px, cx + 7, cy - 8, col); setPixel(px, cx + 7, cy, col);
  setPixel(px, cx + 3, cy - 4, col); setPixel(px, cx + 11, cy - 4, col);
}

/** 땀 한 방울 */
function drawSweat(px, cx, cy, col) {
  circle(px, cx + 18, cy - 12, 3, col);
  setPixel(px, cx + 18, cy - 16, col);
}

/** 작은 Z (졸림) */
function drawZzz(px, cx, cy, col) {
  drawText(px, 'Z', cx + 18, cy - 14, 2, col);
}

/** 이동 방향 화살표 (아래쪽 작은 삼각형) */
function drawArrow(px, cx, cy, dir, col) {
  // dir: 'r'=오른쪽, 'l'=왼쪽, 'd'=아래, 'u'=위
  if (dir === 'r') {
    for (let i = 0; i < 5; i++) {
      for (let j = -i; j <= i; j++) setPixel(px, cx + 14 + i, cy + j, col);
    }
  } else if (dir === 'l') {
    for (let i = 0; i < 5; i++) {
      for (let j = -i; j <= i; j++) setPixel(px, cx - 14 - i, cy + j, col);
    }
  }
}

/**
 * idle 캐릭터 프레임 생성
 * pos: 0~9 (순환 경로상 위치)
 * 각 위치별 표정/동작:
 *   0: 기본 웃음 (출발)
 *   1: 오른쪽 이동 중 (→ 화살표)
 *   2: 오른쪽 이동 중
 *   3: 오른쪽 이동 중
 *   4: 끝 도착 (별 눈 반짝)
 *   5: 아래 이동 (땀)
 *   6: 왼쪽 이동 중 (← 화살표)
 *   7: 왼쪽 이동 중
 *   8: 왼쪽 이동 중
 *   9: 하트 눈 (집에 돌아옴)
 */
function makeIdleChar(pos) {
  // 배경: 매우 어두운 청록 계열
  const BG  = [8, 12, 20, 255];
  const FACE = [255, 220, 80, 255];   // 노란 얼굴
  const OUTLINE = [180, 140, 20, 255];
  const EYE  = [20, 20, 30, 255];
  const MOUTH = [180, 80, 40, 255];
  const ACCENT = [255, 255, 255, 255];
  const RED  = [255, 80, 80, 255];
  const BLUE_A = [100, 180, 255, 255];

  const px = fill(...BG);
  const cx = 36, cy = 36;

  drawFaceBase(px, cx, cy, 22, FACE, OUTLINE);

  switch (pos) {
    case 0: // 기본 웃음 — 출발 대기
      drawEyes(px, cx, cy, EYE);
      drawSmile(px, cx, cy, MOUTH);
      break;
    case 1: // 오른쪽 이동 → (윙크 + 화살표)
      drawWink(px, cx, cy, EYE);
      drawSmile(px, cx, cy, MOUTH);
      drawArrow(px, cx, cy, 'r', ACCENT);
      break;
    case 2: // 오른쪽 이동 중 (땀)
      drawEyes(px, cx, cy, EYE);
      drawSmile(px, cx, cy, MOUTH);
      drawSweat(px, cx, cy, BLUE_A);
      break;
    case 3: // 오른쪽 이동 중 (눈 크게)
      circle(px, cx - 7, cy - 4, 4, EYE);
      circle(px, cx + 7, cy - 4, 4, EYE);
      drawSmile(px, cx, cy, MOUTH);
      drawArrow(px, cx, cy, 'r', ACCENT);
      break;
    case 4: // 끝 도착 — 별 눈 반짝
      drawStarEyes(px, cx, cy, [255, 220, 0, 255]);
      drawBigSmile(px, cx, cy, MOUTH);
      break;
    case 5: // 아래 이동 (졸린 눈 + Z)
      // 반쯤 감긴 눈
      rect(px, cx - 10, cy - 5, cx - 4, cy - 3, EYE);
      rect(px, cx + 4, cy - 5, cx + 10, cy - 3, EYE);
      drawFrown(px, cx, cy, MOUTH);
      drawZzz(px, cx, cy, BLUE_A);
      break;
    case 6: // 왼쪽 이동 ← (윙크 반대)
      drawWink(px, cx, cy, EYE);
      drawSmile(px, cx, cy, MOUTH);
      drawArrow(px, cx, cy, 'l', ACCENT);
      break;
    case 7: // 왼쪽 이동 중 (놀란 표정)
      drawEyes(px, cx, cy, EYE);
      drawSurprisedMouth(px, cx, cy, MOUTH);
      break;
    case 8: // 왼쪽 이동 중 (땀 + 화살표)
      drawEyes(px, cx, cy, EYE);
      drawSmile(px, cx, cy, MOUTH);
      drawSweat(px, cx, cy, BLUE_A);
      drawArrow(px, cx, cy, 'l', ACCENT);
      break;
    case 9: // 집 도착 — 하트 눈
      drawHeartEyes(px, cx, cy, RED);
      drawBigSmile(px, cx, cy, MOUTH);
      break;
  }
  return px;
}

// ── multiSelect 아이콘 (번호 포함) ──────────────────────────

/**
 * multi-off-N: 선택 안 된 상태 — 어두운 배경에 번호
 * multi-on-N:  선택된 상태 — 초록 배경에 체크 + 번호
 */
function makeMultiOff_N(n) {
  const idx = (n - 1) % 10;
  const px = fill(...C.bgGray);
  // 어두운 테두리
  roundRect(px, 6, 6, 66, 66, 10, C.muted);
  // 번호 (우상단 작게)
  drawText(px, String(n), 52, 20, 2, C.muted);
  // 빈 체크박스 심볼 (중앙)
  roundRect(px, 20, 28, 52, 52, 4, C.muted);
  return px;
}

function makeMultiOn_N(n) {
  const px = fill(...C.bgGreen);
  // 밝은 테두리
  roundRect(px, 6, 6, 66, 66, 10, C.greenDim);
  for (let t = 0; t < 2; t++) {
    rect(px, 6+t, 6+t, 66-t, 6+t+1, C.green);
    rect(px, 6+t, 66-t-1, 66-t, 66-t, C.green);
    rect(px, 6+t, 6+t, 6+t+1, 66-t, C.green);
    rect(px, 66-t-1, 6+t, 66-t, 66-t, C.green);
  }
  // 번호 (우상단)
  drawText(px, String(n), 52, 18, 2, C.white);
  // 체크마크 (중앙)
  line(px, 18, 40, 30, 54, C.green, 4);
  line(px, 30, 54, 54, 24, C.green, 4);
  return px;
}

// active — 초록 링
function makeActive() {
  const px = fill(...C.bgGreen);
  circle(px, 36, 36, 24, C.green);
  circle(px, 36, 36, 16, C.bgGreen);
  circle(px, 36, 36, 8, C.greenDim);
  return px;
}

/**
 * processing 3프레임 애니메이션
 * frame 0: 왼쪽 점 밝음 (●○○) — 흐름 시작
 * frame 1: 가운데 점 밝음 (○●○) — 흐름 중간
 * frame 2: 오른쪽 점 밝음 (○○●) — 흐름 끝
 * 각 프레임에서 밝은 점은 크고 밝게, 나머지는 작고 어둡게.
 * 꼬리 효과: 이전 점은 중간 밝기로 표현.
 */
function makeProcessingFrame(frame) { // frame: 0,1,2
  const px = fill(...C.bgAmber);
  const positions = [18, 36, 54];
  const sizes   = [6, 6, 6];
  const colors  = [C.amberDim, C.amberDim, C.amberDim];

  // 밝은 점 (현재)
  colors[frame] = C.amber;
  sizes[frame]  = 10;

  // 꼬리 점 (이전) — 중간 밝기
  const prev = (frame + 2) % 3;
  colors[prev] = [
    Math.round((C.amber[0] + C.amberDim[0]) / 2),
    Math.round((C.amber[1] + C.amberDim[1]) / 2),
    Math.round((C.amber[2] + C.amberDim[2]) / 2),
    255,
  ];
  sizes[prev] = 8;

  for (let i = 0; i < 3; i++) {
    circle(px, positions[i], 36, sizes[i], colors[i]);
  }
  return px;
}

// approve — 초록 체크마크
function makeApprove() {
  const px = fill(...C.bgGreen);
  roundRect(px, 8, 8, 64, 64, 10, C.greenDim);
  line(px, 16, 36, 28, 50, C.green, 4);
  line(px, 28, 50, 56, 20, C.green, 4);
  return px;
}

/**
 * always — "Everything OK" 이모지 캐릭터 (🙆 스타일)
 * 양손을 머리 위로 올려 동그라미를 만드는 포즈.
 * 파랑 배경 + 노란 얼굴 + 웃는 표정 + 양팔 호 형태
 */
function makeAlways() {
  const px = fill(...C.bgBlue);
  roundRect(px, 8, 8, 64, 64, 10, C.blueDim);

  const FACE    = [255, 220, 80, 255];
  const OUTLINE = [180, 140, 20, 255];
  const EYE     = [20,  20,  30, 255];
  const MOUTH   = [180, 80,  40, 255];
  const BODY    = C.blue;
  const ARM     = C.blue;

  // 몸통 (작은 타원)
  for (let y = 46; y <= 60; y++) {
    const w = Math.round(10 * Math.sqrt(1 - ((y - 53) / 7) ** 2));
    for (let x = 36 - w; x <= 36 + w; x++) setPixel(px, x, y, BODY);
  }

  // 왼팔 — 머리 위로 호 그리기 (왼쪽)
  for (let a = 200; a <= 310; a += 5) {
    const rad = a * Math.PI / 180;
    const x = Math.round(36 + 22 * Math.cos(rad));
    const y = Math.round(28 + 18 * Math.sin(rad));
    circle(px, x, y, 2, ARM);
  }
  // 오른팔 — 머리 위로 호 그리기 (오른쪽)
  for (let a = 230; a <= 340; a += 5) {
    const rad = a * Math.PI / 180;
    const x = Math.round(36 + 22 * Math.cos(Math.PI - (a - 270) * Math.PI / 180));
    const y = Math.round(28 + 18 * Math.sin(Math.PI - (a - 270) * Math.PI / 180));
    circle(px, x, y, 2, ARM);
  }

  // 얼굴
  circle(px, 36, 30, 14, OUTLINE);
  circle(px, 36, 30, 12, FACE);

  // 눈 (웃는 눈 — 호)
  for (let a = 0; a <= 180; a += 20) {
    const rad = a * Math.PI / 180;
    setPixel(px, Math.round(29 + 4 * Math.cos(rad)), Math.round(26 - 2 * Math.sin(rad)), EYE);
    setPixel(px, Math.round(43 + 4 * Math.cos(rad)), Math.round(26 - 2 * Math.sin(rad)), EYE);
  }

  // 웃는 입
  for (let a = 0; a <= 180; a += 15) {
    const rad = a * Math.PI / 180;
    const x = Math.round(36 + 6 * Math.cos(rad));
    const y = Math.round(34 + 3 * Math.sin(rad));
    setPixel(px, x, y, MOUTH);
    setPixel(px, x, y + 1, MOUTH);
  }

  // 양손 끝 (작은 원)
  circle(px, 14, 18, 3, FACE);
  circle(px, 58, 18, 3, FACE);

  return px;
}

// deny — 빨강 X
function makeDeny() {
  const px = fill(...C.bgRed);
  roundRect(px, 8, 8, 64, 64, 10, C.redDim);
  line(px, 16, 16, 56, 56, C.red, 5);
  line(px, 56, 16, 16, 56, C.red, 5);
  return px;
}

// submit — 청록 더블체크
function makeSubmit() {
  const px = fill(...C.bgTeal);
  roundRect(px, 8, 8, 64, 64, 10, [15,65,60,255]);
  line(px, 10, 36, 22, 50, C.teal, 3);
  line(px, 22, 50, 38, 28, C.teal, 3);
  line(px, 24, 36, 36, 50, C.teal, 3);
  line(px, 36, 50, 58, 22, C.teal, 3);
  return px;
}

// awaiting — 보라 모래시계
function makeAwaiting() {
  const px = fill(...C.bgPurple);
  roundRect(px, 8, 8, 64, 64, 10, C.purpleDim);
  for (let y = 14; y <= 36; y++) {
    const w = Math.round((36-y)*22/22);
    rect(px, 36-w, y, 36+w, y, C.purple);
  }
  for (let y = 36; y <= 58; y++) {
    const w = Math.round((y-36)*22/22);
    rect(px, 36-w, y, 36+w, y, C.purple);
  }
  return px;
}

// sleep — 어두운 배경에 Z z z
function makeSleep() {
  const px = fill(5, 5, 10, 255);
  const DIM = [40, 40, 70, 255];
  const MID = [60, 60, 100, 255];
  const BRT = [90, 90, 140, 255];
  // 큰 Z (중앙 상단)
  drawChar(px, 'Z', 28, 24, 4, BRT);
  // 중간 z (오른쪽 중간)
  drawChar(px, 'Z', 46, 38, 3, MID);
  // 작은 z (오른쪽 하단)
  drawChar(px, 'Z', 56, 50, 2, DIM);
  return px;
}

// session-count-N — 회색 배경에 숫자 픽셀 렌더링 (1~30)
function makeSessionCountN(n) {
  const px = fill(...C.bgGray);
  // 상단 작은 'S' 레이블 (scale=1)
  drawChar(px, 'S', 36, 14, 2, C.muted);
  // 숫자 (크게)
  const label = String(n);
  const scale = label.length === 1 ? 5 : 3;
  drawText(px, label, 36, 42, scale, C.white);
  return px;
}

// session-count (기본 — 세션 없음)
function makeSessionCount() {
  const px = fill(...C.bgGray);
  drawChar(px, 'S', 36, 14, 2, C.muted);
  drawText(px, '0', 36, 42, 5, C.muted);
  return px;
}

// session-switch-base — 파랑 육각형 심볼 (세션명 없는 기본)
function makeSessionSwitch() {
  const px = fill(...C.bgBlue);
  const pts = Array.from({length:6}, (_,i) => {
    const a = Math.PI/3*i - Math.PI/6;
    return [36+22*Math.cos(a), 36+22*Math.sin(a)];
  });
  for (let i = 0; i < 6; i++) {
    const [x0,y0]=pts[i], [x1,y1]=pts[(i+1)%6];
    line(px, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), C.blue, 3);
  }
  circle(px, 36, 36, 5, C.blue);
  return px;
}

/**
 * session-switch-{label} — 세션명을 픽셀로 그린 버전
 * label: 최대 4자 (짧게 잘라서 사용)
 */
function makeSessionSwitchLabel(label) {
  const px = fill(...C.bgBlue);
  // 상단 작은 육각형 심볼
  const pts = Array.from({length:6}, (_,i) => {
    const a = Math.PI/3*i - Math.PI/6;
    return [36+14*Math.cos(a), 20+14*Math.sin(a)];
  });
  for (let i = 0; i < 6; i++) {
    const [x0,y0]=pts[i], [x1,y1]=pts[(i+1)%6];
    line(px, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), C.blueDim, 2);
  }
  // 세션명 텍스트 (하단)
  const short = label.slice(0, 4).toUpperCase();
  const scale = short.length <= 2 ? 3 : 2;
  drawText(px, short, 36, 50, scale, C.blue);
  return px;
}

// agent-switch — 보라 다이아몬드
function makeAgentSwitch() {
  const px = fill(...C.bgPurple);
  const pts = [[36,12],[60,36],[36,60],[12,36]];
  for (let i = 0; i < 4; i++) {
    const [x0,y0]=pts[i], [x1,y1]=pts[(i+1)%4];
    line(px, x0, y0, x1, y1, C.purple, 3);
  }
  circle(px, 36, 36, 9, C.purple);
  circle(px, 36, 36, 5, C.bgPurple);
  return px;
}

// multi-on / multi-off
function makeMultiOn() {
  const px = fill(...C.bgGreen);
  roundRect(px, 10, 10, 62, 62, 8, C.greenDim);
  line(px, 16, 36, 28, 52, C.green, 4);
  line(px, 28, 52, 56, 18, C.green, 4);
  return px;
}

function makeMultiOff() {
  const px = fill(...C.bgGray);
  roundRect(px, 10, 10, 62, 62, 8, C.muted);
  return px;
}

// choice-N — 배경 + 숫자 비트맵 렌더링
function makeChoiceNum(n) { // n: 1~10
  const idx = (n - 1) % 10;
  const px = fill(...CHOICE_BG[idx]);
  roundRect(px, 6, 6, 66, 66, 10, CHOICE_FG[idx].map((v,i)=>i<3?Math.round(v*0.2):v));
  // 테두리
  for (let t = 0; t < 3; t++) {
    rect(px, 6+t, 6+t, 66-t, 6+t+1, CHOICE_FG[idx]);
    rect(px, 6+t, 66-t-1, 66-t, 66-t, CHOICE_FG[idx]);
    rect(px, 6+t, 6+t, 6+t+1, 66-t, CHOICE_FG[idx]);
    rect(px, 66-t-1, 6+t, 66-t, 66-t, CHOICE_FG[idx]);
  }
  // 숫자 (scale=4: 7*4=28px 폭, 9*4=36px 높이)
  const label = String(n);
  const scale = label.length === 1 ? 5 : 3;
  drawText(px, label, 36, 36, scale, CHOICE_FG[idx]);
  return px;
}

// choice-A~J — 알파벳 비트맵 렌더링
function makeChoiceAlpha(letter) { // 'A'~'J'
  const idx = letter.toUpperCase().charCodeAt(0) - 65; // A=0
  const safeIdx = idx % 10;
  const px = fill(...CHOICE_BG[safeIdx]);
  roundRect(px, 6, 6, 66, 66, 10, CHOICE_FG[safeIdx].map((v,i)=>i<3?Math.round(v*0.2):v));
  for (let t = 0; t < 3; t++) {
    rect(px, 6+t, 6+t, 66-t, 6+t+1, CHOICE_FG[safeIdx]);
    rect(px, 6+t, 66-t-1, 66-t, 66-t, CHOICE_FG[safeIdx]);
    rect(px, 6+t, 6+t, 6+t+1, 66-t, CHOICE_FG[safeIdx]);
    rect(px, 66-t-1, 6+t, 66-t, 66-t, CHOICE_FG[safeIdx]);
  }
  drawChar(px, letter.toUpperCase(), 36, 36, 5, CHOICE_FG[safeIdx]);
  return px;
}

// ── 생성 실행 ────────────────────────────────────────────────

console.log('Generating icons...');

save('idle',           makeIdle());
// idle 캐릭터 10프레임 (순환 경로: 0→1→2→3→4→9→8→7→6→5→0)
for (let i = 0; i < 10; i++) save(`idle-char-${i}`, makeIdleChar(i));
save('active',         makeActive());
// processing 3프레임
save('processing-1',   makeProcessingFrame(0)); // ●○○
save('processing-2',   makeProcessingFrame(1)); // ○●○
save('processing-3',   makeProcessingFrame(2)); // ○○●
save('processing',     makeProcessingFrame(0)); // 기본 (하위 호환)
save('approve',        makeApprove());
save('always',         makeAlways());
save('deny',           makeDeny());
save('submit',         makeSubmit());
save('awaiting',       makeAwaiting());
save('sleep',          makeSleep());
// session-count: 0 + 1~30
save('session-count',  makeSessionCount());
for (let n = 1; n <= 30; n++) save(`session-count-${n}`, makeSessionCountN(n));
// session-switch 기본
save('session-switch', makeSessionSwitch());
save('agent-switch',   makeAgentSwitch());
save('multi-on',       makeMultiOn());
save('multi-off',      makeMultiOff());
// multi-on/off 번호 포함 버전
for (let n = 1; n <= 10; n++) save(`multi-off-${n}`, makeMultiOff_N(n));
for (let n = 1; n <= 10; n++) save(`multi-on-${n}`,  makeMultiOn_N(n));

for (let n = 1; n <= 10; n++) save(`choice-${n}`, makeChoiceNum(n));
for (let i = 0; i < 10; i++) {
  const letter = String.fromCharCode(65 + i); // A~J
  save(`choice-${letter.toLowerCase()}`, makeChoiceAlpha(letter));
}

const total = 4 + 31 + 1 + 1 + 1 + 4 + 20; // 대략
console.log(`Done — icons in ${OUT}`);
