/**
 * ulanziOutputAdapter.js
 *
 * RenderCommand를 UlanziApi 호출로 변환해 D200H LCD에 상태를 반영한다.
 *
 * RenderCommand {
 *   context:  string   — Ulanzi context string (uuid___key___actionid)
 *   iconKey:  string   — 아이콘 키 (아래 ICON_KEYS 참조)
 *   text?:    string   — 버튼 위에 표시할 텍스트 오버레이 (선택)
 * }
 *
 * iconKey 목록:
 *   기본:    idle | active | processing | awaiting
 *   바이너리: approve | always | deny
 *   시스템:  session-count | session-switch | agent-switch | submit
 *   선택지:  choice-1 ~ choice-10  (숫자)
 *            choice-a ~ choice-j  (알파벳)
 *   멀티:    multi-on | multi-off
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

// 시작 시 1회 전체 로드
const ICONS = {};

const ICON_FILES = [
  'idle', 'active', 'awaiting', 'sleep',
  // idle 캐릭터 10프레임
  ...Array.from({ length: 10 }, (_, i) => `idle-char-${i}`),
  // processing 3프레임 + 기본
  'processing', 'processing-1', 'processing-2', 'processing-3',
  'approve', 'always', 'deny',
  'submit',
  // session-count: 기본(0) + 1~30
  'session-count',
  ...Array.from({ length: 30 }, (_, i) => `session-count-${i + 1}`),
  'session-switch', 'agent-switch',
  'multi-on', 'multi-off',
  // multi 번호 포함 버전
  ...Array.from({ length: 10 }, (_, i) => `multi-off-${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `multi-on-${i + 1}`),
  // 숫자 선택지
  ...Array.from({ length: 10 }, (_, i) => `choice-${i + 1}`),
  // 알파벳 선택지
  ...Array.from({ length: 10 }, (_, i) => `choice-${String.fromCharCode(97 + i)}`),
];

for (const key of ICON_FILES) {
  ICONS[key] = loadB64(`${key}.png`);
}

const FALLBACK = ICONS['idle'];

/**
 * RenderCommand를 LCD에 반영한다.
 *
 * @param {{ context: string, iconKey: string, text?: string }} cmd
 * @param {import('../plugin-common-node/libs/ulanziApi.js').default} $UD
 */
export function applyRender(cmd, $UD) {
  if (!cmd || !cmd.context) return;

  const key = cmd.iconKey ?? 'idle';
  const imgData = ICONS[key] ?? FALLBACK;
  const text = cmd.text ?? '';

  if (!imgData) {
    console.warn(`[output] no image for iconKey="${key}", skipping`);
    return;
  }

  console.log(`[output] render iconKey="${key}" text="${text}" ctx=${cmd.context.slice(-8)}`);
  $UD.setBaseDataIcon(cmd.context, imgData, text);
}

/**
 * 동적 생성된 base64 PNG를 직접 LCD에 반영한다.
 * iconRenderer.js에서 생성한 세션명/에이전트명 아이콘에 사용.
 *
 * @param {{ context: string, b64: string }} cmd
 * @param {import('../plugin-common-node/libs/ulanziApi.js').default} $UD
 */
export function applyRenderRaw(cmd, $UD) {
  if (!cmd || !cmd.context || !cmd.b64) return;
  console.log(`[output] renderRaw ctx=${cmd.context.slice(-8)}`);
  $UD.setBaseDataIcon(cmd.context, cmd.b64, '');
}

/**
 * 여러 RenderCommand를 순서대로 적용한다.
 *
 * @param {Array<{ context: string, iconKey: string, text?: string }>} cmds
 * @param {import('../plugin-common-node/libs/ulanziApi.js').default} $UD
 */
export function applyRenderAll(cmds, $UD) {
  for (const cmd of cmds) {
    applyRender(cmd, $UD);
  }
}
