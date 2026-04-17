#!/usr/bin/env node
// tools/dj-stress-gen.js — seeded 8-axis fixture generator
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);

const seed = parseInt(flags.seed ?? '42', 10);
const count = parseInt(flags.count ?? '10', 10);
const out = flags.out ?? '.dj-test/fixtures/dy';

// Deterministic PRNG — Mulberry32
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const AXES = {
  language: ['ko', 'en', 'mixed'],
  count: [2, 3, 4, 7],
  prefix: ['bare', 'bold', 'dash', 'paren'],
  explanation: ['none', 'emdash', 'paren', 'colon'],
  preamble: ['none', 'short', 'long', 'analysis'],
  postamble: ['none', 'short', 'question'],
  fence: [false, true],
  labelLen: ['short', 'medium', 'long'],
};

const LABELS = {
  ko: ['옵션 하나', '두 번째 선택', '세 번째 대안', '네 번째 방법', '다섯 번째 경로', '여섯 번째 갈래', '마지막 선택'],
  en: ['Option A', 'Second choice', 'Third alternative', 'Fourth path', 'Fifth route', 'Sixth branch', 'Final option'],
  mixed: ['Option 하나', '두 번째 path', 'Third 대안', 'Fourth 방법', '다섯 번째 route', 'Sixth 갈래', 'Final 선택'],
};

const PREAMBLES = {
  none: '',
  short: { ko: '방향을 선택해주세요.\n\n', en: 'Pick a direction.\n\n', mixed: '방향을 pick해주세요.\n\n' },
  long: { ko: '상황 파악을 위해 몇 가지 질문드립니다. 아래 중 어떤 방향이 좋을까요?\n\n', en: 'To understand the situation, a few questions. Which direction do you prefer?\n\n', mixed: '상황 파악을 위해 which direction이 좋을까요?\n\n' },
  analysis: { ko: '분석 결과:\n\n', en: 'Analysis results:\n\n', mixed: '분석 results:\n\n' },
};

const POSTAMBLES = {
  none: '',
  short: { ko: '\n\n참고 바랍니다.', en: '\n\nFYI.', mixed: '\n\nFYI 참고.' },
  question: { ko: '\n\n어떤 걸 선택하시겠어요?', en: '\n\nWhich one do you pick?', mixed: '\n\n어떤 one을 pick?' },
};

function formatLine(idx, prefix, label, explanation, lang) {
  const expText = explanation === 'none' ? '' :
    explanation === 'emdash' ? ' — ' + (lang === 'ko' ? '추가 설명' : 'extra info') :
    explanation === 'paren' ? ' (' + (lang === 'ko' ? '부가 설명' : 'extra info') + ')' :
    explanation === 'colon' ? ': ' + (lang === 'ko' ? '상세 설명' : 'detailed info') : '';
  const body = label + expText;
  switch (prefix) {
    case 'bare':  return `${idx}. ${body}`;
    case 'bold':  return `**${idx}.** ${body}`;
    case 'dash':  return `- ${idx}. ${body}`;
    case 'paren': return `(${idx}) ${body}`;
  }
}

function generate(id) {
  const axes = {
    language: pick(AXES.language),
    count: pick(AXES.count),
    prefix: pick(AXES.prefix),
    explanation: pick(AXES.explanation),
    preamble: pick(AXES.preamble),
    postamble: pick(AXES.postamble),
    fence: pick(AXES.fence),
    labelLen: pick(AXES.labelLen),
  };

  const labels = LABELS[axes.language].slice(0, axes.count);
  const lines = labels.map((l, i) => formatLine(i + 1, axes.prefix, l, axes.explanation, axes.language));

  const pre = axes.preamble === 'none' ? '' : PREAMBLES[axes.preamble][axes.language];
  const post = axes.postamble === 'none' ? '' : POSTAMBLES[axes.postamble][axes.language];

  const inner = lines.join('\n');
  const body = axes.fence
    ? `${pre}[claude-dj-choices]\n${inner}\n[/claude-dj-choices]${post}`
    : `${pre}${inner}${post}`;

  // Expectation rules (pure deterministic)
  let detect;
  if (axes.fence) detect = true;
  else if (axes.preamble === 'analysis' && axes.prefix === 'bare' && axes.explanation === 'emdash') detect = false;
  else if (axes.preamble === 'analysis' && axes.postamble === 'none') detect = false;
  else if (axes.postamble === 'question' || axes.preamble === 'short' || axes.preamble === 'long') detect = true;
  else if (axes.prefix !== 'bare' && axes.postamble !== 'short') detect = true;
  else detect = false;

  // Build choice labels as the parser will extract them (label + explanation text)
  const choiceLabels = labels.map((l) => {
    const expText = axes.explanation === 'none' ? '' :
      axes.explanation === 'emdash' ? ' — ' + (axes.language === 'ko' ? '추가 설명' : 'extra info') :
      axes.explanation === 'paren' ? ' (' + (axes.language === 'ko' ? '부가 설명' : 'extra info') + ')' :
      axes.explanation === 'colon' ? ': ' + (axes.language === 'ko' ? '상세 설명' : 'detailed info') : '';
    return (l + expText).slice(0, 30);
  });

  return {
    id,
    axes,
    text: body,
    expect: detect
      ? { detect: true, choices: choiceLabels, expectedRule: axes.fence ? 'fenced-block' : 'regex-context', notes: `dy seed=${seed} id=${id}` }
      : { detect: false, expectedRejectionReason: 'axis-driven-negative', notes: `dy seed=${seed} id=${id}` },
  };
}

function main() {
  mkdirSync(out, { recursive: true });
  for (let i = 1; i <= count; i++) {
    const g = generate(i);
    const base = path.join(out, String(i).padStart(2, '0') + '-dy.txt');
    writeFileSync(base, g.text);
    writeFileSync(base.replace(/\.txt$/, '.expect.json'), JSON.stringify(g.expect, null, 2));
  }
  console.log(`generated ${count} dynamic fixtures in ${out} (seed=${seed})`);
}

main();
