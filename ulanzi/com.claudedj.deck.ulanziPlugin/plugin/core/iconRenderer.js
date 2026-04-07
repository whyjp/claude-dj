/**
 * iconRenderer.js — 런타임 동적 PNG 생성
 *
 * 세션명처럼 동적인 값을 아이콘 PNG에 직접 픽셀로 렌더링한다.
 * gen-icons.js와 동일한 비트맵 폰트/PNG 인코더를 사용한다.
 */

import zlib from 'zlib';

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
      raw[dst]=pixels[src]; raw[dst+1]=pixels[src+1];
      raw[dst+2]=pixels[src+2]; raw[dst+3]=pixels[src+3];
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8]=8; ihdr[9]=6;
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

function line(px, x0, y0, x1, y1, col, thick=2) {
  const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
  const sx=x0<x1?1:-1, sy=y0<y1?1:-1;
  let err=dx-dy, x=x0, y=y0;
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

// ── 비트맵 폰트 (7×9) ──────────────────────────────────────

const FONT = {
  '0':[0b0111110,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b0111110],
  '1':[0b0011000,0b0111000,0b1111000,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b1111111],
  '2':[0b0111110,0b1100011,0b0000011,0b0000110,0b0001100,0b0011000,0b0110000,0b1100000,0b1111111],
  '3':[0b0111110,0b1100011,0b0000011,0b0000011,0b0011110,0b0000011,0b0000011,0b1100011,0b0111110],
  '4':[0b0000110,0b0001110,0b0011110,0b0110110,0b1100110,0b1111111,0b0000110,0b0000110,0b0000110],
  '5':[0b1111111,0b1100000,0b1100000,0b1111110,0b0000011,0b0000011,0b0000011,0b1100011,0b0111110],
  '6':[0b0011110,0b0110000,0b1100000,0b1111110,0b1100011,0b1100011,0b1100011,0b1100011,0b0111110],
  '7':[0b1111111,0b0000011,0b0000110,0b0001100,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000],
  '8':[0b0111110,0b1100011,0b1100011,0b1100011,0b0111110,0b1100011,0b1100011,0b1100011,0b0111110],
  '9':[0b0111110,0b1100011,0b1100011,0b1100011,0b0111111,0b0000011,0b0000011,0b0110011,0b0111110],
  'A':[0b0011100,0b0110110,0b1100011,0b1100011,0b1111111,0b1100011,0b1100011,0b1100011,0b1100011],
  'B':[0b1111110,0b1100011,0b1100011,0b1100011,0b1111110,0b1100011,0b1100011,0b1100011,0b1111110],
  'C':[0b0111110,0b1100011,0b1100000,0b1100000,0b1100000,0b1100000,0b1100000,0b1100011,0b0111110],
  'D':[0b1111100,0b1100110,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100110,0b1111100],
  'E':[0b1111111,0b1100000,0b1100000,0b1100000,0b1111100,0b1100000,0b1100000,0b1100000,0b1111111],
  'F':[0b1111111,0b1100000,0b1100000,0b1100000,0b1111100,0b1100000,0b1100000,0b1100000,0b1100000],
  'G':[0b0111110,0b1100011,0b1100000,0b1100000,0b1100111,0b1100011,0b1100011,0b1100011,0b0111110],
  'H':[0b1100011,0b1100011,0b1100011,0b1100011,0b1111111,0b1100011,0b1100011,0b1100011,0b1100011],
  'I':[0b1111111,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b1111111],
  'J':[0b0000111,0b0000011,0b0000011,0b0000011,0b0000011,0b0000011,0b1100011,0b1100011,0b0111110],
  'K':[0b1100011,0b1100110,0b1101100,0b1111000,0b1110000,0b1111000,0b1101100,0b1100110,0b1100011],
  'L':[0b1100000,0b1100000,0b1100000,0b1100000,0b1100000,0b1100000,0b1100000,0b1100000,0b1111111],
  'M':[0b1100011,0b1110111,0b1111111,0b1101011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011],
  'N':[0b1100011,0b1110011,0b1111011,0b1101111,0b1100111,0b1100011,0b1100011,0b1100011,0b1100011],
  'O':[0b0111110,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b0111110],
  'P':[0b1111110,0b1100011,0b1100011,0b1100011,0b1111110,0b1100000,0b1100000,0b1100000,0b1100000],
  'Q':[0b0111110,0b1100011,0b1100011,0b1100011,0b1100011,0b1101011,0b1110011,0b0111110,0b0000011],
  'R':[0b1111110,0b1100011,0b1100011,0b1100011,0b1111110,0b1101100,0b1100110,0b1100011,0b1100011],
  'S':[0b0111110,0b1100011,0b1100000,0b1100000,0b0111110,0b0000011,0b0000011,0b1100011,0b0111110],
  'T':[0b1111111,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000,0b0011000],
  'U':[0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b0111110],
  'V':[0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b1100011,0b0110110,0b0011100,0b0001000],
  'W':[0b1100011,0b1100011,0b1100011,0b1100011,0b1101011,0b1111111,0b1110111,0b1100011,0b1100011],
  'X':[0b1100011,0b1100011,0b0110110,0b0011100,0b0001000,0b0011100,0b0110110,0b1100011,0b1100011],
  'Y':[0b1100011,0b1100011,0b0110110,0b0011100,0b0001000,0b0001000,0b0001000,0b0001000,0b0001000],
  'Z':[0b1111111,0b0000011,0b0000110,0b0001100,0b0011000,0b0110000,0b1100000,0b1100000,0b1111111],
  '-':[0b0000000,0b0000000,0b0000000,0b0000000,0b1111111,0b0000000,0b0000000,0b0000000,0b0000000],
  '_':[0b0000000,0b0000000,0b0000000,0b0000000,0b0000000,0b0000000,0b0000000,0b0000000,0b1111111],
  '.':[0b0000000,0b0000000,0b0000000,0b0000000,0b0000000,0b0000000,0b0000000,0b0011000,0b0011000],
};

function drawChar(px, ch, cx, cy, scale, col) {
  const bitmap = FONT[ch.toUpperCase()] ?? FONT['?'];
  if (!bitmap) return;
  const fw = 7 * scale, fh = 9 * scale;
  const ox = cx - Math.floor(fw / 2);
  const oy = cy - Math.floor(fh / 2);
  for (let row = 0; row < 9; row++) {
    for (let bit = 0; bit < 7; bit++) {
      if (bitmap[row] & (1 << (6 - bit))) {
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++)
            setPixel(px, ox+bit*scale+sx, oy+row*scale+sy, col);
      }
    }
  }
}

function drawText(px, text, cx, cy, scale, col) {
  const chars = String(text).split('');
  const fw = 7 * scale, gap = scale;
  const totalW = chars.length * fw + (chars.length - 1) * gap;
  let x = cx - Math.floor(totalW / 2) + Math.floor(fw / 2);
  for (const ch of chars) {
    drawChar(px, ch, x, cy, scale, col);
    x += fw + gap;
  }
}

// ── 색상 ────────────────────────────────────────────────────

const BLUE     = [68, 170, 255, 255];
const BLUE_DIM = [30,  80, 130, 255];
const BG_BLUE  = [ 8,  20,  45, 255];
const WHITE    = [244, 244, 255, 255];
const MUTED    = [ 80,  80, 120, 255];

// ── 공개 API ─────────────────────────────────────────────────

/**
 * 세션명을 픽셀로 렌더링한 session-switch 아이콘 PNG를 base64로 반환.
 * @param {string} name - 세션 이름 (최대 5자 표시)
 * @returns {string} base64 PNG
 */
export function makeSessionSwitchIcon(name) {
  const px = fill(...BG_BLUE);

  // 상단 육각형 심볼 (작게)
  const pts = Array.from({length:6}, (_,i) => {
    const a = Math.PI/3*i - Math.PI/6;
    return [36+13*Math.cos(a), 20+13*Math.sin(a)];
  });
  for (let i = 0; i < 6; i++) {
    const [x0,y0]=pts[i], [x1,y1]=pts[(i+1)%6];
    line(px, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), BLUE_DIM, 2);
  }
  circle(px, 36, 20, 4, BLUE_DIM);

  // 세션명 (하단, 최대 5자)
  const label = (name ?? '—').slice(0, 5).toUpperCase();
  const scale = label.length <= 2 ? 3 : label.length <= 4 ? 2 : 2;
  drawText(px, label, 36, 50, scale, BLUE);

  return makePng(px).toString('base64');
}

// choice 색상 10종 (gen-icons.js와 동일)
const CHOICE_BG = [
  [8,35,16],[35,28,5],[8,20,45],[22,12,40],
  [35,18,5],[8,30,25],[30,8,25],[25,30,8],
  [8,18,35],[30,22,8],
].map(v => [...v, 255]);
const CHOICE_FG = [
  [39,255,110,255],[255,200,0,255],[68,170,255,255],[187,136,255,255],
  [255,136,68,255],[68,255,204,255],[255,68,170,255],
  [136,255,68,255],[68,170,255,255],[255,170,68,255],
];

/**
 * multiSelect 아이콘 — 번호 + 레이블 + 선택 상태 동적 렌더링
 *
 * 레이아웃:
 *   ┌──────────────────┐
 *   │ [N]  ☑/☐        │  ← 상단: 번호(좌) + 체크박스(우)
 *   │ label text       │  ← 하단: 선택지 텍스트 (2줄 자동 분할)
 *   └──────────────────┘
 *
 * @param {number} n - 1-based 번호 (1~10)
 * @param {string} label - 선택지 텍스트
 * @param {boolean} selected - 선택 여부
 * @returns {string} base64 PNG
 */
export function makeMultiIcon(n, label, selected) {
  const idx = (n - 1) % 10;
  const fg  = CHOICE_FG[idx];
  const bg  = selected ? CHOICE_BG[idx] : [20, 20, 30, 255];
  const dimFg = fg.map((v, i) => i < 3 ? Math.round(v * 0.4) : v);

  const px = fill(...bg);

  // 테두리 (선택 시 밝게, 미선택 시 어둡게)
  const borderCol = selected ? fg : dimFg;
  for (let t = 0; t < 2; t++) {
    // 상단/하단 수평선
    for (let x = 6+t; x <= 66-t; x++) {
      setPixel(px, x, 6+t, borderCol);
      setPixel(px, x, 66-t, borderCol);
    }
    // 좌/우 수직선
    for (let y = 6+t; y <= 66-t; y++) {
      setPixel(px, 6+t, y, borderCol);
      setPixel(px, 66-t, y, borderCol);
    }
  }

  // 상단 좌: 번호 (scale=2, 작게)
  drawText(px, String(n), 18, 18, 2, selected ? fg : dimFg);

  // 상단 우: 체크박스 심볼
  if (selected) {
    // ☑ 체크마크
    line(px, 46, 22, 52, 30, fg, 2);
    line(px, 52, 30, 62, 12, fg, 2);
  } else {
    // ☐ 빈 박스
    for (let x = 46; x <= 62; x++) { setPixel(px, x, 12, dimFg); setPixel(px, x, 28, dimFg); }
    for (let y = 12; y <= 28; y++) { setPixel(px, 46, y, dimFg); setPixel(px, 62, y, dimFg); }
  }

  // 구분선
  for (let x = 10; x <= 62; x++) setPixel(px, x, 34, dimFg);

  // 하단: 레이블 텍스트 (최대 8자, 넘으면 2줄)
  const text = (label ?? '').slice(0, 14);
  const textCol = selected ? [244, 244, 255, 255] : dimFg;
  if (text.length <= 7) {
    const scale = text.length <= 4 ? 2 : 1;
    drawText(px, text.toUpperCase(), 36, 52, scale, textCol);
  } else {
    // 2줄 분할
    const line1 = text.slice(0, 7).toUpperCase();
    const line2 = text.slice(7, 14).toUpperCase();
    drawText(px, line1, 36, 45, 1, textCol);
    drawText(px, line2, 36, 58, 1, textCol);
  }

  return makePng(px).toString('base64');
}

/**
 * agent-switch 아이콘 — 에이전트 타입/상태 표시
 * @param {string} label - 표시할 텍스트 (ROOT, SUB, +N 등)
 * @returns {string} base64 PNG
 */
export function makeAgentSwitchIcon(label) {
  const PURPLE     = [187, 136, 255, 255];
  const PURPLE_DIM = [ 80,  55, 120, 255];
  const BG_PURPLE  = [ 22,  12,  40, 255];

  const px = fill(...BG_PURPLE);

  // 다이아몬드 (작게)
  const pts = [[36,12],[54,28],[36,44],[18,28]];
  for (let i = 0; i < 4; i++) {
    const [x0,y0]=pts[i], [x1,y1]=pts[(i+1)%4];
    line(px, x0, y0, x1, y1, PURPLE_DIM, 2);
  }

  // 텍스트
  const short = (label ?? 'ROOT').slice(0, 4).toUpperCase();
  const scale = short.length <= 2 ? 3 : 2;
  drawText(px, short, 36, 56, scale, PURPLE);

  return makePng(px).toString('base64');
}
