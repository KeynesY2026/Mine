const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('js/ui.js', 'utf8');
const core = fs.readFileSync('js/core.js', 'utf8');

test('setup exposes bounded bomb inventory and session-only AI options', () => {
  assert.match(html, /id="cfgBombs"[^>]*max="999"/);
  assert.match(html, /id="cfgDisableAiBombs"/);
  assert.match(html, /id="cfgEnhancedAI"[^>]*checked/);
  assert.doesNotMatch(html.match(/<input[^>]*id="cfgDisableAiBombs"[^>]*>/)?.[0] || '', /checked/);
  assert.doesNotMatch(html, /id="chkComBomb"/);
  assert.match(html, /id="cfgSpeed"/);
  assert.doesNotMatch(html, /makeDecision\(view\)[^\n]*bomb-auto/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
});

test('hint and cheat controls stay hidden until the secret sequence unlocks them', () => {
  assert.match(html, /id="btnHint"[^>]*hidden/);
  assert.match(html, /id="btnCheat"[^>]*hidden/);
  assert.match(ui, /keySequence\.push\(e\.key/);
  assert.match(ui, /keySequence\.isUnlocked\(\)/);
  assert.match(ui, /toggleHint\(\)[\s\S]{0,180}isUnlocked\(\)/);
  assert.doesNotMatch(ui, /setCheat\s*\(/);
  assert.match(ui, /window\.__mine = \{\s*get view\(\)/);
  assert.doesNotMatch(ui, /window\.__mine[\s\S]{0,180}get game\(/);
});

test('AI receives an AI-filtered public view and enhanced dispatch is explicit', () => {
  assert.match(ui, /game\.view\(p,\s*\{\s*ai:\s*true\s*\}\)/);
  assert.match(ui, /enhancedAI:\s*\$\('cfgEnhancedAI'\)\.checked/);
  assert.match(core, /disableAiBombs/);
});

test('game-over announces the winning side and leaves the board available for review', () => {
  const onGameOver = ui.match(/function onGameOver\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(onGameOver, /victoryCelebration\.start\(label\(game\.winner\) \+ '获胜！'\)/);
  assert.doesNotMatch(onGameOver, /showModal|fillResult|dlgResult/);
  assert.doesNotMatch(html, /id="boardOverlay"|id="dlgResult"/);
});

test('invalid decisions get a visible warning and legal fallback; no-move state stops', () => {
  assert.match(ui, /AI 走昏招了！/);
  assert.match(ui, /recoverInvalidDecision\(p\)/);
  assert.match(ui, /resolved\.noMoves/);
  assert.match(ui, /对局无处可走/);
});
