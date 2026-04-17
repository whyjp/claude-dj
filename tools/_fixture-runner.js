// tools/_fixture-runner.js
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PARSER_PATH = path.resolve('claude-plugin/hooks/choiceParser.js');

export async function loadParser() {
  const mod = await import(pathToFileURL(PARSER_PATH).href);
  return { parseFencedChoices: mod.parseFencedChoices, parseRegexChoices: mod.parseRegexChoices };
}

export function loadFixture(fixturePath) {
  const text = readFileSync(fixturePath, 'utf8');
  const expectPath = fixturePath.replace(/\.txt$/, '.expect.json');
  let expected = null;
  let expectRaw = null;
  try {
    expectRaw = readFileSync(expectPath, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (expectRaw !== null) {
    expected = JSON.parse(expectRaw); // let SyntaxError propagate
  }
  return { text, expected, path: fixturePath, expectPath };
}

export function discoverFixtures(root) {
  if (!existsSync(root)) {
    throw new Error(`Fixture directory not found: ${root}. Run from repo root.`);
  }
  const results = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (p.endsWith('.txt')) results.push(p);
    }
  }
  walk(root);
  return results.sort();
}

export async function runFixture(fixturePath, parsers) {
  const { parseFencedChoices, parseRegexChoices } = parsers;
  const { text, expected } = loadFixture(fixturePath);
  const trace = [];
  const collect = (d) => trace.push(d);

  // Parser currently ignores trace — Task 2 wires it. Both calls tolerated.
  const fenced = parseFencedChoices(text, { trace: collect });
  const regex = fenced ? null : parseRegexChoices(text, { trace: collect });
  const choices = fenced || regex;

  const actual = {
    detect: choices !== null && choices.length > 0,
    choices: choices ? choices.map(c => c.label) : [],
    rule: fenced ? 'fenced-block' : regex ? 'regex-context' : 'none',
    trace,
  };

  const pass = expected
    ? actual.detect === expected.detect &&
      (!expected.choices || sameArray(actual.choices, expected.choices)) &&
      (!expected.expectedRule || actual.rule === expected.expectedRule)
    : null;

  return { fixture: path.relative(process.cwd(), fixturePath), expected, actual, pass };
}

function sameArray(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
