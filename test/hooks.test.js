import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

describe('Hook scripts', () => {
  it('permission.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/permission.js'));
    const content = readFileSync('hooks/permission.js', 'utf8');
    assert.ok(content.includes('/api/hook/permission'));
  });

  it('notify.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/notify.js'));
    const content = readFileSync('hooks/notify.js', 'utf8');
    assert.ok(content.includes('/api/hook/notify'));
  });

  it('stop.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/stop.js'));
    const content = readFileSync('hooks/stop.js', 'utf8');
    assert.ok(content.includes('/api/hook/stop'));
  });

  it('postToolUse.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/postToolUse.js'));
    const content = readFileSync('hooks/postToolUse.js', 'utf8');
    assert.ok(content.includes('/api/hook/postToolUse'));
  });

  it('userPrompt.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/userPrompt.js'));
    const content = readFileSync('hooks/userPrompt.js', 'utf8');
    assert.ok(content.includes('/api/events/'));
  });

  it('hooks.json is valid and references all hook scripts', () => {
    assert.ok(existsSync('hooks/hooks.json'));
    const config = JSON.parse(readFileSync('hooks/hooks.json', 'utf8'));
    assert.ok(config.hooks, 'should have hooks key');
    assert.ok(config.hooks.UserPromptSubmit, 'should have UserPromptSubmit');
    assert.ok(config.hooks.PermissionRequest, 'should have PermissionRequest');
    assert.ok(config.hooks.PreToolUse, 'should have PreToolUse');
    assert.ok(config.hooks.PostToolUse, 'should have PostToolUse');
    assert.ok(config.hooks.Stop, 'should have Stop');
    // Verify ${CLAUDE_PLUGIN_ROOT} is used for portability
    const json = JSON.stringify(config);
    assert.ok(json.includes('${CLAUDE_PLUGIN_ROOT}'), 'should use ${CLAUDE_PLUGIN_ROOT} paths');
  });

  it('plugin.json is valid and references hooks.json', () => {
    assert.ok(existsSync('.claude-plugin/plugin.json'));
    const manifest = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
    assert.equal(manifest.name, 'claude-dj');
    assert.ok(manifest.hooks, 'should declare hooks');
    assert.ok(manifest.hooks.includes('hooks.json'), 'should reference hooks.json');
  });

  it('choiceParser.js exists and exports parsers', async () => {
    assert.ok(existsSync('hooks/choiceParser.js'));
    const mod = await import('../hooks/choiceParser.js');
    assert.equal(typeof mod.parseFencedChoices, 'function');
    assert.equal(typeof mod.parseRegexChoices, 'function');
  });

  it('choice-format skill exists with correct frontmatter', () => {
    assert.ok(existsSync('skills/choice-format/SKILL.md'));
    const content = readFileSync('skills/choice-format/SKILL.md', 'utf8');
    assert.ok(content.includes('name: choice-format'));
    assert.ok(content.includes('AskUserQuestion'));
  });
});
