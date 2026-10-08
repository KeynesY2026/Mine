const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('js/ui.js', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');

test('new-game settings use one square size and density-only automatic mines', () => {
  assert.match(html, /id="cfgSize"[^>]*min="10"[^>]*max="99"/);
  assert.match(html, /id="cfgBombs"[^>]*max="99"/);
  assert.match(html, /<input type="range" id="cfgPct"[^>]*min="10"[^>]*max="90"/);
  assert.match(html, /id="autoMineSummary"/);
  assert.doesNotMatch(html, /cfgH|cfgMines|mineMode|manualMine/);
  assert.doesNotMatch(html, /id="cfgSpeed"/);
  assert.match(ui, /gameSettings\.resolveMineCount\(\{ width: size, height: size, densityPercent: pct \}\)/);
  assert.match(ui, /const size = Math\.round\(C\.clamp\(\+\$\('cfgSize'\)\.value \|\| 15, 10, 99\)\)/);
  assert.match(ui, /width: size,[\s\S]{0,80}height: size/);
});

test('remaining global mines and bomb inventory are visually rendered with accessible counts', () => {
  assert.match(html, /id="remainMines"/);
  assert.match(html, /id="bombsBlue"[^>]*aria-label/);
  assert.match(html, /id="bombButtonCount" class="bombs bomb-button-inventory"/);
  assert.match(ui, /renderBombInventory\(\$\('bombButtonCount'\), game\.bombs\[game\.turn\]\)/);
  assert.match(ui, /function renderBombInventory\(container, remaining\)[\s\S]*gameSettings\.formatBombInventory\(remaining\)/);
  assert.match(ui, /remainMines/);
  assert.match(ui, /mineIcons\.bombSvg\(\)/);
  assert.match(css, /\.attack-bomb-svg/);
  assert.match(html, /id="mineCounterIcon"/);
  assert.match(css, /\.counter-mine-svg/);
  assert.match(css, /\.mine-counter/);
});

test('bomb inventory names and the attack button expose exact counts to assistive technology', () => {
  assert.match(html, /id="bombsBlue" role="img"/);
  assert.match(html, /id="bombsRed" role="img"/);
  assert.match(html, /id="bombButtonCount" class="bombs bomb-button-inventory" aria-hidden="true"/);
  assert.match(html, /id="bombButtonCountText" class="visually-hidden"/);
  assert.match(ui, /container\.setAttribute\('role', 'img'\)/);
  assert.match(ui, /container\.setAttribute\('aria-label', display\.label\)/);
  assert.match(ui, /bombButtonCountText'\)\.textContent = '当前回合剩余炸弹 ' \+ game\.bombs\[game\.turn\] \+ ' 枚'/);
  assert.match(css, /\.visually-hidden\s*\{/);
});

test('session statistics explain their zero values through hover and keyboard/touch disclosure', () => {
  assert.match(html, /class="session-help"/);
  assert.match(html, /当前页面中已结束的对局/);
  assert.match(html, /<summary aria-label="会话统计说明">/);
  assert.match(css, /\.session-help:hover \.help-popover/);
  assert.match(css, /\.session-help:focus-within \.help-popover/);
});

test('human play time is tracked separately and capture feedback includes an animated mine emblem', () => {
  assert.match(html, /id="timeLabelBlue"/);
  assert.match(html, /<script src="js\/turn-timer\.js"><\/script>/);
  assert.match(ui, /humanTimer\.endTurn\(/);
  assert.match(ui, /humanTimer\.elapsed\(/);
  assert.match(html, /<script src="js\/mine-icons\.js"><\/script>/);
  assert.match(ui, /mineIcons\.mineSvg\(owner, capture\)/);
  assert.match(css, /\.mine-svg\.capture \.mine-glyph\s*\{[^}]*animation:\s*mineEmerge/);
  assert.match(css, /@keyframes mineEmerge/);
  assert.doesNotMatch(css, /mine-flag|flagUnfurl/);
});

test('direct and bomb mine captures apply the ceremony to captured mines only', () => {
  assert.match(html, /<script src="js\/mine-feedback\.js"><\/script>/);
  assert.match(ui, /mineFeedback\.capturedMineIndices\(game\.lastMove, game\.mines, game\.owner\)/);
  assert.match(ui, /if \(mineCaptures\.has\(i\)\) cell\.classList\.add\('mine-capture'\)/);
  assert.match(ui, /const capture = mineCaptures\.has\(i\)/);
  assert.match(ui, /mineIcons\.mineSvg\(owner, capture\)/);
});

test('mine capture keyframes avoid filter animation that freezes Chromium rendering', () => {
  const captureKeyframes = css.match(/@keyframes mineCapture\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(captureKeyframes, 'mine capture feedback remains animated');
  assert.doesNotMatch(captureKeyframes, /(?:^|[;{])\s*(?:-webkit-)?filter\s*:/,
    'animating filters on captured grid cells can freeze the board');
});

test('the board viewport scrolls oversized boards, centers fitting boards, and owns the winner overlay', () => {
  assert.match(html, /id="boardViewport"[\s\S]*id="board"[\s\S]*id="winnerMessage"/);
  assert.match(html, /<script src="js\/board-layout\.js"><\/script>/);
  assert.match(ui, /boardLayout\.cellSize\(w, h, boardViewport\.clientWidth, boardViewport\.clientHeight\)/);
  assert.doesNotMatch(ui, /Math\.min\(44/);
  assert.match(ui, /ResizeObserver/);
  assert.match(ui, /addEventListener\('resize', layout\)/);
  assert.match(css, /#boardViewport\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /#winnerMessage\s*\{[^}]*position:\s*absolute/);
});

test('bomb-mode pointer previews update only the old/new affected cells', () => {
  const pointerHandler = ui.match(/d\.addEventListener\('pointerenter', \(\) => \{([\s\S]*?)\n\s*\}\);/)?.[1] || '';
  const previewUpdater = ui.match(/function updateBombPreview\(x, y\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(pointerHandler, /updateBombPreview\(x, y\)/);
  assert.doesNotMatch(pointerHandler, /render\(/);
  assert.match(previewUpdater, /game\.bombAreaCells\(x, y\)/);
  assert.match(previewUpdater, /for \(const i of bombPreviewCells\)/);
  assert.match(previewUpdater, /for \(const i of nextPreviewCells\)/);
  assert.doesNotMatch(previewUpdater, /game\.total|render\(/);
  assert.match(ui, /function clearBombPreview\(\)[\s\S]*?bombPreviewCells\.clear\(\)/);
});

test('compact screens keep a useful board viewport and allow vertical page scrolling', () => {
  const compactRules = css.match(/@media \(max-width:\s*760px\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(compactRules, /body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(compactRules, /#app\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*100vh/);
  assert.match(compactRules, /main\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(compactRules, /#boardWrap\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(compactRules, /#boardStage\s*\{[^}]*height:\s*clamp\(260px,\s*48svh,\s*440px\)/);
});

test('mobile layout separates the status row, keeps both players visible, and provides touch-sized controls', () => {
  const compactRules = css.match(/@media \(max-width:\s*760px\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(compactRules, /header\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(compactRules, /#lastMoveBar\s*\{[^}]*flex:\s*1\s+0\s+100%/);
  assert.match(compactRules, /aside\s+\.player\s*\{[^}]*flex:\s*1\s+1\s+calc\(50%/);
  assert.match(compactRules, /\.btnrow,\s*\.bomb-guide,\s*\.ctl\s*\{[^}]*flex:\s*1\s+1\s+100%/);
  assert.match(compactRules, /button\s*\{[^}]*min-height:\s*44px/);
  assert.match(compactRules, /#boardStage\s*\{[^}]*min-height:\s*260px/);
  assert.match(compactRules, /#boardStage\s*\{[^}]*svh/);
});

test('mobile controls fill one shared width and action buttons use equal columns', () => {
  const compactRules = css.match(/@media \(max-width:\s*760px\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(compactRules, /\.btnrow,\s*\.bomb-guide,\s*\.ctl\s*\{[^}]*width:\s*100%/);
  assert.match(compactRules, /\.btnrow\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test('winner overlay remains centered while the oversized board scrolls independently', () => {
  assert.match(html, /<div id="boardStage">[\s\S]*<div id="boardViewport">[\s\S]*<div id="board"><\/div>[\s\S]*<div id="winnerMessage"/);
  assert.match(css, /#boardStage\s*\{[^}]*position:\s*relative/);
  assert.match(css, /#boardViewport\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /#winnerMessage\s*\{[^}]*position:\s*absolute/);
});

test('board cells use raised and recessed metal styling without per-mine SVG filters', () => {
  assert.match(css, /#board\s*\{[^}]*inset/);
  assert.match(css, /\.cell\s*\{[^}]*border:\s*1px solid/);
  assert.match(css, /\.cell\.revealed\s*\{[^}]*inset/);
  assert.doesNotMatch(css, /\.mine-svg\.owner-(?:blue|red)\s*\{[^}]*filter:/);
});

test('victory presentation is centered, glassy, gently pulsing, and visible over the board', () => {
  assert.match(html, /id="boardViewport"[\s\S]*id="winnerMessage"/);
  assert.match(css, /#winnerMessage\s*\{[^}]*backdrop-filter:\s*blur\(/);
  assert.match(css, /#winnerMessage\.show\s*\{[^}]*animation:\s*winnerPulse\s+3\.[0-9]s/);
  assert.match(css, /@keyframes winnerPulse/);
  assert.match(css, /#victoryFireworks\.show\s*\{[^}]*opacity:\s*\.4[0-9]/);
});

test('bomb attack button describes availability and victory effects remain low-obstruction', () => {
  assert.match(html, /id="bombButtonLabel"/);
  assert.match(ui, /炸弹攻击/);
  assert.match(ui, /仅落后时可用/);
  assert.doesNotMatch(ui, /可用 · 剩余 ' \+ game\.bombs\[game\.turn\]/);
  assert.match(ui, /canBomb \? '可用 · 攻击范围 5×5。'/);
  assert.match(css, /#victoryFireworks\.show\s*\{[^}]*opacity:\s*\.4[0-9]/);
  assert.match(css, /#winnerMessage\s*\{[^}]*top:/);
  assert.match(css, /prefers-reduced-motion/);
});
