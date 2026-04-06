/**
 * ulanziOutputAdapter.js
 *
 * RenderCommand를 UlanziApi 호출로 변환해 D200H LCD에 상태를 반영한다.
 *
 * RenderCommand {
 *   context:    string  — Ulanzi context string (uuid___key___actionid)
 *   stateIndex: number  — 0=IDLE, 1=ACTIVE
 *   text?:      string  — 버튼 위에 표시할 텍스트 (미지정 시 stateIndex 기반 자동)
 * }
 *
 * setBaseDataIcon으로 이모지 PNG를 직접 전송해 manifest 이미지 의존성을 제거한다.
 * resources/idle.png  → ⚫ (U+26AB)
 * resources/active.png → 🟢 (U+1F7E2)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const RESOURCES = join(dirname(fileURLToPath(import.meta.url)), '../../resources');

function loadB64(filename) {
  try {
    return readFileSync(join(RESOURCES, filename)).toString('base64');
  } catch (e) {
    console.warn(`[output] image load failed: ${filename} — ${e.message}`);
    return null;
  }
}

// 시작 시 1회 로드
const IMG = {
  0: loadB64('idle.png'),    // ⚫ IDLE
  1: loadB64('active.png'),  // 🟢 ACTIVE
};

const LABEL = { 0: '', 1: 'ON' };

/**
 * RenderCommand를 LCD에 반영한다.
 * setBaseDataIcon으로 이모지 이미지 직접 주입 + 텍스트 오버레이.
 *
 * @param {{ context: string, stateIndex: number, text?: string }} cmd
 * @param {import('../plugin-common-node/libs/ulanziApi.js').default} $UD
 */
export function applyRender(cmd, $UD) {
  if (!cmd || !cmd.context) return;
  const idx = cmd.stateIndex ?? 0;
  const text = cmd.text ?? LABEL[idx] ?? '';
  const imgData = IMG[idx] ?? IMG[0];
  console.log(`[output] applyRender stateIndex=${idx} text="${text}" img=${imgData ? 'ok' : 'missing'}`);
  if (imgData) {
    $UD.setBaseDataIcon(cmd.context, imgData, text);
  } else {
    $UD.setStateIcon(cmd.context, idx, text);
  }
}

/**
 * 여러 RenderCommand를 순서대로 적용한다.
 *
 * @param {Array<{ context: string, stateIndex: number, text?: string }>} cmds
 * @param {import('../plugin-common-node/libs/ulanziApi.js').default} $UD
 */
export function applyRenderAll(cmds, $UD) {
  for (const cmd of cmds) {
    applyRender(cmd, $UD);
  }
}
