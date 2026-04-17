#!/usr/bin/env node
// scripts/dj-test-report.js — consume dj-parse --json → dj-test-report.html
import { readFileSync, writeFileSync } from 'node:fs';

const inputArg = process.argv[2];
let raw;
if (!inputArg || inputArg === '/dev/stdin' || inputArg === '-') {
  // Read from stdin (works cross-platform, including Windows)
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  raw = Buffer.concat(chunks).toString('utf8');
} else {
  raw = readFileSync(inputArg, 'utf8');
}
const results = JSON.parse(raw);

const byCategory = { original: [], nd: [], pd: [], ex: [], pl: [], dy: [] };
for (const r of results) {
  const cat = r.fixture.includes('/nd/') ? 'nd'
    : r.fixture.includes('/pd/') ? 'pd'
    : r.fixture.includes('/ex/') ? 'ex'
    : r.fixture.includes('/pl/') ? 'pl'
    : r.fixture.includes('/dy/') ? 'dy'
    : 'original';
  byCategory[cat].push(r);
}

const stats = Object.fromEntries(Object.entries(byCategory).map(([k, arr]) => [
  k,
  { total: arr.length, pass: arr.filter(r => r.pass === true).length, fail: arr.filter(r => r.pass === false).length },
]));

const rows = Object.entries(stats)
  .filter(([, s]) => s.total > 0)
  .map(([k, s]) => `<tr><td>${k}</td><td>${s.total}</td><td class="pass">${s.pass}</td><td class="${s.fail ? 'fail' : ''}">${s.fail}</td></tr>`)
  .join('');

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const failRows = results.filter(r => r.pass === false).map(r => `
  <details><summary>${escapeHtml(r.fixture)}</summary>
  <pre>expected: ${escapeHtml(JSON.stringify(r.expected, null, 2))}
actual:   ${escapeHtml(JSON.stringify({ detect: r.actual.detect, choices: r.actual.choices, rule: r.actual.rule }, null, 2))}
trace:    ${escapeHtml(JSON.stringify(r.actual.trace, null, 2))}</pre>
  </details>`).join('');

const totalPass = results.filter(r => r.pass === true).length;
const totalFail = results.filter(r => r.pass === false).length;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DJ Test Report</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 2em auto; color: #222; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #ccc; padding: 0.4em 0.8em; text-align: left; }
th { background: #f0f0f0; }
.pass { color: #27ae60; }
.fail { color: #c0392b; font-weight: bold; }
pre { background: #f5f5f5; padding: 0.8em; overflow-x: auto; white-space: pre-wrap; }
details { margin: 0.5em 0; }
summary { cursor: pointer; }
.banner { padding: 1em; border-radius: 4px; margin: 1em 0; }
.banner.ok { background: #e8f5e9; color: #1b5e20; }
.banner.ko { background: #ffebee; color: #b71c1c; }
</style></head><body>
<h1>DJ Choice Detection — Test Report</h1>
<p>Generated: ${new Date().toISOString()}</p>
<div class="banner ${totalFail === 0 ? 'ok' : 'ko'}">
<strong>${totalPass}</strong> pass, <strong>${totalFail}</strong> fail (of ${results.length} total)
</div>
<h2>Summary</h2>
<table>
<tr><th>Category</th><th>Total</th><th>Pass</th><th>Fail</th></tr>
${rows}
</table>
${failRows ? `<h2>Failures</h2>${failRows}` : '<h2>All Pass ✓</h2>'}
</body></html>`;

writeFileSync('dj-test-report.html', html);
console.log('dj-test-report.html written');
