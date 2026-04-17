#!/usr/bin/env node
// tools/dj-parse.js — Layer 1 unit runner for choiceParser.js
import path from 'node:path';
import { discoverFixtures, loadParser, runFixture } from './_fixture-runner.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const targets = args.filter(a => !a.startsWith('--'));
const jsonOut = flags.has('--json');
const all = flags.has('--all');

async function main() {
  if (all && targets.length > 0) {
    console.error('warning: --all ignores positional targets');
  }
  const fixtures = all
    ? discoverFixtures(path.resolve('.dj-test/fixtures'))
    : targets.map(t => path.resolve(t));

  if (fixtures.length === 0) {
    console.error('usage: node tools/dj-parse.js <fixture.txt> | --all [--json]');
    process.exit(2);
  }

  const parsers = await loadParser();
  const results = [];
  for (const f of fixtures) results.push(await runFixture(f, parsers));

  if (jsonOut) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    for (const r of results) {
      const tag = r.pass === null ? 'NOEXP' : r.pass ? 'PASS ' : 'FAIL ';
      console.log(`${tag}  ${r.fixture}  detect=${r.actual.detect} rule=${r.actual.rule}`);
      if (r.pass === false) {
        console.log(`       expected: ${JSON.stringify(r.expected)}`);
        console.log(`       actual:   ${JSON.stringify({ detect: r.actual.detect, choices: r.actual.choices, rule: r.actual.rule })}`);
      }
    }
    const passed = results.filter(r => r.pass === true).length;
    const failed = results.filter(r => r.pass === false).length;
    const noexp = results.filter(r => r.pass === null).length;
    console.log(`\n${passed} pass, ${failed} fail, ${noexp} no-expect  (total ${results.length})`);
  }

  process.exit(results.some(r => r.pass === false) ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
