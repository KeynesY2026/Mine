const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('js/ui.js', 'utf8');
const core = fs.readFileSync('js/core.js', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');

test('setup exposes bounded bomb inventory and session-only AI options', () => {
  assert.match(html, /id="cfgBombs"[^>]*max="999"/);
  assert.match(html, /id="cfgDisableAiBombs"/);
  assert.doesNotMatch(html, /cfgEnhancedAI|增强 AI/);
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

test('AI receives a frozen shared public analysis and coordinate-only actions', () => {
  assert.match(ui, /analysis:\s*shared\.analysis/);
  assert.match(ui, /cellAt:\s*shared\.snapshot\.cellAt/);
  assert.match(ui, /MineAIPlanner\.chooseFallback/);
  assert.match(ui, /MineAIPlanner\.analyze\(snapshot\)/);
  assert.doesNotMatch(ui, /game\.bombBest|bomb-auto|cfgEnhancedAI/);
  assert.doesNotMatch(core, /bombBest\s*\(/);
  assert.match(core, /disableAiBombs/);

  const coreScript = html.indexOf('<script src="js/core.js"></script>');
  const plannerScript = html.indexOf('<script src="js/ai-planner.js"></script>');
  const pluginScript = html.indexOf('<script src="plugin/ai-config.js"></script>');
  const uiScript = html.indexOf('<script src="js/ui.js"></script>');
  assert.ok(coreScript >= 0 && coreScript < plannerScript && plannerScript < pluginScript && pluginScript < uiScript);
});

test('AI snapshots public state before lazy load and rejects stale asynchronous decisions', () => {
  const schedule = ui.slice(ui.indexOf('function scheduleAI()'), ui.indexOf('function recoverInvalidDecision'));
  const snapshotAt = schedule.indexOf('scheduledShared = getSharedAnalysis()');
  const firstLoadAt = schedule.indexOf('await aiRegistry.load(kind[p])');

  assert.ok(snapshotAt >= 0 && firstLoadAt > snapshotAt);
  assert.match(schedule, /const revisionAtSchedule = boardRevision/);
  assert.match(schedule, /boardRevision !== revisionAtSchedule/);
  assert.match(schedule, /if \(!isScheduledStateCurrent\(\)\) return;\s*if \(decide\) decision = decide\(scheduledView\)/);
  assert.match(schedule, /getSharedAnalysis\(\)\.stateKey === scheduledShared\.stateKey/);
});

test('game-over announces the winning side and leaves the board available for review', () => {
  const onGameOver = ui.match(/function onGameOver\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(onGameOver, /victoryCelebration\.start\(label\(game\.winner\) \+ '获胜！'\)/);
  assert.doesNotMatch(onGameOver, /showModal|fillResult|dlgResult/);
  assert.doesNotMatch(html, /id="boardOverlay"|id="dlgResult"/);
});

test('mine captures pulse in the scorer color and show a floating point while keeping ownership visible', () => {
  const render = ui.match(/function render\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(render, /lm\.kind === 'mine'[\s\S]*mine-capture/);
  assert.match(css, /\.cell\.mine\.owner-blue\s*\{[^}]*background:/);
  assert.match(css, /\.cell\.mine\.owner-red\s*\{[^}]*background:/);
  assert.match(css, /\.cell\.mine-capture::before\s*\{[^}]*content:\s*['"]\+1['"]/);
  assert.match(css, /\.cell\.mine-capture\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.cell\.mine-capture::before\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /@keyframes mineCapture/);
});

test('invalid decisions get a visible warning and legal fallback; no-move state stops', () => {
  assert.match(ui, /AI 走昏招了！/);
  assert.match(ui, /recoverInvalidDecision\(p\)/);
  assert.match(ui, /resolved\.noMoves/);
  assert.match(ui, /对局无处可走/);
});
