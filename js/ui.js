"use strict";
/* ================================================================
   UI 层 — DOM 渲染 + 控制器 + 插件加载
   只读 Game 状态; 规则逻辑全部在 core (Game 类)
   ================================================================ */
(() => {
const C = MineCore;
const $ = id => document.getElementById(id);
const label = p => (p === 'blue' ? '蓝方' : '红方');
const other = p => (p === 'blue' ? 'red' : 'blue');

let game = null;
let kind = { blue: 'human', red: 'strong' };   // human | weak | strong | plugin
let plugin = { blue: null, red: null };         // {name, fn}
let comBomb = true;
let speed = 6;
let hintOn = false, cheatOn = false;
let bombPreviewCenter = null;
let aiTimer = null;
let timers = { blue: 0, red: 0 };               // AI 思考耗时 ms
let session = { blue: 0, red: 0, draw: 0, total: 0 };

const boardEl = $('board');
const boardWrap = $('boardWrap');

function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg;
  t.className = err ? 'show err' : 'show';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = '', 2400);
}

/* ---------------- 棋盘构建 ---------------- */
function layout() {
  if (!game) return;
  const w = game.w, h = game.h;
  const availW = boardWrap.clientWidth - 36, availH = boardWrap.clientHeight - 36;
  const cs = Math.max(16, Math.min(44,
    Math.floor(Math.min((availW - (w - 1) * 3 - 16) / w, (availH - (h - 1) * 3 - 16) / h))));
  document.documentElement.style.setProperty('--cs', cs + 'px');
  boardEl.style.gridTemplateColumns = `repeat(${w}, var(--cs))`;
}

function buildBoard() {
  boardEl.innerHTML = '';
  const w = game.w, h = game.h;
  layout();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < game.total; i++) {
    const d = document.createElement('div');
    d.className = 'cell hidden';
    const x = i % w, y = (i / w) | 0;
    d.addEventListener('click', () => onCellClick(x, y));
    d.addEventListener('pointerenter', () => {
      if (!game.bombMode) return;
      bombPreviewCenter = { x, y };
      render();
    });
    frag.appendChild(d);
  }
  boardEl.appendChild(frag);
}
boardWrap.addEventListener('contextmenu', e => {
  e.preventDefault();
  hintOn = !hintOn;
  $('btnHint').classList.toggle('on', hintOn);
  render();
});
boardEl.addEventListener('pointerleave', () => {
  if (!bombPreviewCenter) return;
  bombPreviewCenter = null;
  render();
});
window.addEventListener('resize', () => { layout(); });

const cellEl = i => boardEl.children[i];

/* ---------------- 渲染 ---------------- */
function render() {
  if (!game) return;
  document.body.classList.toggle('bombing', game.bombMode);
  const previewCells = game.bombMode && bombPreviewCenter
    ? new Set(game.bombAreaCells(bombPreviewCenter.x, bombPreviewCenter.y)) : null;
  let probs = null;
  if (hintOn) {
    try { probs = C.computeProbabilities(game.view('blue')); } catch (e) { probs = null; }
  }
  for (let i = 0; i < game.total; i++) {
    const el = cellEl(i);
    if (!game.revealed[i]) {
      el.className = 'cell hidden' + (cheatOn && game.mines[i] ? ' cheat' : '')
        + (previewCells && previewCells.has(i) ? ' bomb-preview' : '')
        + (game.bombMode && bombPreviewCenter && i === bombPreviewCenter.y * game.w + bombPreviewCenter.x ? ' bomb-preview-center' : '');
      el.innerHTML = '';
      if (cheatOn && game.mines[i]) {
        const cm = document.createElement('div');
        cm.className = 'cheatmark';
        el.appendChild(cm);
      }
      if (hintOn && probs && probs.has(i)) {
        const hd = document.createElement('div');
        hd.className = 'hintp';
        hd.textContent = Math.round(probs.get(i) * 100) + '%';
        el.appendChild(hd);
      }
      continue;
    }
    if (game.mines[i]) {
      el.className = 'cell revealed mine owner-' + (game.owner[i] === 1 ? 'blue' : game.owner[i] === 2 ? 'red' : '')
        + (previewCells && previewCells.has(i) ? ' bomb-preview' : '')
        + (game.bombMode && bombPreviewCenter && i === bombPreviewCenter.y * game.w + bombPreviewCenter.x ? ' bomb-preview-center' : '');
      el.innerHTML = '<span class="num" style="font-size:calc(var(--cs)*.55)">💣</span>';
    } else {
      el.className = 'cell revealed n' + game.numbers[i] + ' owner-' + (game.owner[i] === 1 ? 'blue' : game.owner[i] === 2 ? 'red' : '')
        + (previewCells && previewCells.has(i) ? ' bomb-preview' : '')
        + (game.bombMode && bombPreviewCenter && i === bombPreviewCenter.y * game.w + bombPreviewCenter.x ? ' bomb-preview-center' : '');
      el.innerHTML = '<span class="num">' + game.numbers[i] + '</span>';
    }
  }
  const lm = game.lastMove;
  for (const el of boardEl.children) el.classList.remove('lastmove', 'who-blue', 'who-red');
  if (lm && lm.x !== undefined) {
    const targets = (lm.kind === 'bomb' && lm.cells) ? lm.cells : [lm.y * game.w + lm.x];
    const who = lm.player === 'blue' ? 'who-blue' : 'who-red';
    for (const i of targets) if (i >= 0 && i < game.total) cellEl(i).classList.add('lastmove', who);
  }
  updateHUD();
  renderOverlay();
}

function updateHUD() {
  if (!game) return;
  const tb = $('turnBadge');
  if (game.over) {
    tb.className = 'over';
    $('turnText').textContent = game.winner === 'draw' ? '平局' : label(game.winner) + '胜';
  } else {
    tb.className = game.turn;
    $('turnText').textContent = label(game.turn) + (isAI(game.turn) ? ' · AI 思考中…' : ' · 你的回合');
  }
  const lmb = $('lastMoveBar');
  const lm = game.lastMove;
  if (!lm) { lmb.className = 'none'; $('lastMoveText').textContent = '尚未落子'; }
  else {
    const kindTxt = lm.kind === 'mine' ? '点开雷 +1' : lm.kind === 'bomb' ? '炸弹扫区' + (lm.mines ? ' · 炸中 ' + lm.mines + ' 雷' : '') : lm.kind === 'empty' ? '展开空区' : '点开数字';
    lmb.className = lm.player;
    $('lastMoveText').textContent = '最后: ' + label(lm.player) + ' ' + kindTxt + ' (' + lm.x + ',' + lm.y + ')';
  }
  for (const p of ['blue', 'red']) {
    const cap = p === 'blue' ? 'Blue' : 'Red';
    $('score' + cap).textContent = game.scores[p];
    $('max' + cap).textContent = '/ 胜线 ' + game.winNeed;
    $('bar' + cap).style.width = Math.min(100, game.scores[p] / game.winNeed * 100) + '%';
    let bs = '';
    for (let i = 0; i < game.bombMax; i++) bs += '<span class="' + (i < game.bombs[p] ? '' : 'used') + '">💣</span>';
    $('bombs' + cap).innerHTML = game.bombMax > 0 ? bs : '<span style="opacity:.35;font-size:11px;color:var(--dim)">本局无炸弹</span>';
    $('time' + cap).textContent = (timers[p] / 1000).toFixed(1) + 's';
    $('round' + cap).textContent = game.rounds[p];
    $('panel' + cap).classList.toggle('active', !game.over && game.turn === p);
    $('think' + cap).classList.toggle('show', !game.over && game.turn === p && isAI(p));
    $('kind' + cap).textContent = kind[p] === 'human' ? '人类' : kind[p] === 'weak' ? '弱 AI' : kind[p] === 'strong' ? '强 AI' : (plugin[p] ? '插件' : '插件(缺失)');
  }
  const bb = $('btnBomb');
  bb.disabled = !game || game.over;
  bb.className = 'toggle bomb' + (game && game.bombMode ? ' on' : '') + (!game.over && game.canBomb(game.turn) ? ' ready' : '');
  bb.textContent = game.bombMode ? '💣 取消炸弹' : '💣 炸弹模式';
  $('bombGuide').classList.toggle('show', game.bombMode);
  $('bombGuide').textContent = game.bombMode
    ? '炸弹范围最多 ' + (2 * game.bombRadiusH + 1) + '×' + (2 * game.bombRadiusV + 1) + '（边缘会裁切）· 移动鼠标预览 · 点击中心引爆 · 再点按钮取消 · 剩余 ' + game.bombs[game.turn] + ' 枚'
    : '';
  $('mineInfo').innerHTML = game.w + '×' + game.h + ' · 雷 <b>' + game.mineCount + '</b> · 胜线 <b>' + game.winNeed + '</b> · 炸弹 <b>' + (2 * game.bombRadiusH + 1) + '×' + (2 * game.bombRadiusV + 1) + '</b>';
  $('rulesInfo').textContent = '点开雷 +1 并续回合 · 点开数字/0 格换回合 · 落后方可炸弹 · 剩雷 ' + game.remainMines;
  $('sessBlue').textContent = session.blue;
  $('sessRed').textContent = session.red;
  $('sessDraw').textContent = session.draw;
  $('sessTotal').textContent = session.total;
}

function renderOverlay() {
  const ov = $('boardOverlay');
  if (!game.over) { ov.classList.remove('show'); return; }
  const big = $('overlayBig');
  if (game.winner === 'draw') { big.className = 'big win-draw'; big.textContent = '平 局'; }
  else if (game.winner === 'blue') { big.className = 'big win-blue'; big.textContent = '蓝 方 胜'; }
  else { big.className = 'big win-red'; big.textContent = '红 方 胜'; }
  $('overlaySmall').textContent = '比分 蓝 ' + game.scores.blue + ' : ' + game.scores.red + ' 红 · 胜线 ' + game.winNeed;
  ov.classList.add('show');
}

function isAI(p) { return kind[p] !== 'human'; }
function aiWorks(p) {
  if (kind[p] === 'plugin') return !!plugin[p];
  return true;
}

/* ---------------- 交互 ---------------- */
function onCellClick(x, y) {
  if (!game || game.over) return;
  if (isAI(game.turn)) { toast('AI 回合中', true); return; }
  let r;
  if (game.bombMode) r = game.bomb(x, y);
  else r = game.open(x, y);
  if (r.ok) afterMove(r);
}

function afterMove(r, extraDelay) {
  if (r.kind === 'bomb') bombPreviewCenter = null;
  render();
  // 涟漪动画: 洪水填充按距离延迟
  if (r.cells && r.kind === 'empty' && r.x !== undefined) {
    for (const i of r.cells) {
      const x = i % game.w, y = (i / game.w) | 0;
      const dist = Math.max(Math.abs(x - r.x), Math.abs(y - r.y));
      const el = cellEl(i);
      const n = el.querySelector('.num');
      if (n) n.style.transitionDelay = Math.min(400, dist * 22) + 'ms';
    }
  }
  if (r.kind === 'bomb' && r.cells) {
    boardEl.classList.add('shake');
    setTimeout(() => boardEl.classList.remove('shake'), 450);
    for (const i of r.cells) {
      if (game.mines[i]) {
        cellEl(i).classList.add('blast');
        setTimeout(el => el.classList.remove('blast'), 500, cellEl(i));
      }
    }
  }
  if (game.over) { onGameOver(); return; }
  if (isAI(game.turn)) scheduleAI();
}

/* ---------------- AI 调度 ---------------- */
function makeView(p) {
  const v = game.view(p);
  return comBomb ? v : Object.assign({}, v, { canBomb: false });
}

function scheduleAI() {
  if (!game || game.over) return;
  clearTimeout(aiTimer);
  const p = game.turn;
  if (!aiWorks(p)) {
    // 插件缺失 → 回退强 AI
    toast(label(p) + ' 插件未加载, 回退强 AI', true);
    kind[p] = 'strong';
    updateHUD();
  }
  const delay = 100 + (10 - speed) * 200;
  const t0 = performance.now();
  aiTimer = setTimeout(() => {
    if (!game || game.over || game.turn !== p) return;
    let d = null;
    try {
      const v = makeView(p);
      if (kind[p] === 'plugin') d = plugin[p].fn(v);
      else if (kind[p] === 'weak') d = C.weakDecide(v);
      else d = C.strongDecide(v);
    } catch (e) {
      console.error('AI 异常', e);
      toast(label(p) + ' AI 异常: ' + e.message + '（降级随机）', true);
    }
    if (d && (d.x === undefined || d.y === undefined || d.x < 0 || d.y < 0 || d.x >= game.w || d.y >= game.h)) d = null;
    if (!d) d = randomOpen();
    timers[p] += performance.now() - t0;
    applyDecision(p, d);
  }, delay);
}

function randomOpen() {
  const hidden = [];
  for (let y = 0; y < game.h; y++) for (let x = 0; x < game.w; x++)
    if (!game.revealed[y * game.w + x]) hidden.push({ x, y });
  if (!hidden.length) return null;
  const c = hidden[C.randInt(hidden.length)];
  return { type: 'open', x: c.x, y: c.y };
}

function applyDecision(p, d) {
  let r;
  if (d.type === 'bomb') {
    if (!game.setBombMode(true)) { r = { ok: false }; }
    else r = game.bomb(d.x, d.y);
    if (!r.ok) { r = game.open(d.x, d.y); }
  } else {
    r = game.open(d.x, d.y);
  }
  if (r.ok) afterMove(r);
  else {
    const ro = randomOpen();
    if (ro) { const r2 = game.open(ro.x, ro.y); if (r2.ok) { afterMove(r2); return; } }
    toast(label(p) + ' 无合法走法');
  }
}

function onGameOver() {
  clearTimeout(aiTimer);
  session.total++;
  if (game.winner === 'blue') session.blue++;
  else if (game.winner === 'red') session.red++;
  else session.draw++;
  updateHUD();
  setTimeout(() => {
    fillResult();
    $('dlgResult').showModal();
  }, 700);
}

function fillResult() {
  const b = $('resultBanner');
  if (game.winner === 'draw') { b.className = 'draw'; b.textContent = '平 局'; }
  else if (game.winner === 'blue') { b.className = 'blue'; b.textContent = '蓝 方 获 胜'; }
  else { b.className = 'red'; b.textContent = '红 方 获 胜'; }
  const rows = [];
  for (const p of ['blue', 'red']) {
    const avg = game.rounds[p] ? (timers[p] / game.rounds[p] / 1000).toFixed(2) + 's' : '—';
    rows.push('<div class="rs">' + label(p) + ' 得分<b>' + game.scores[p] + '</b></div>');
    rows.push('<div class="rs">' + label(p) + ' 回合 / 思考均值<b>' + game.rounds[p] + ' / ' + avg + '</b></div>');
  }
  $('resultStats').innerHTML = rows.join('');
}

/* ---------------- 新对局 / 设置 ---------------- */
function forceOdd(m, total) {
  m = Math.round(m);
  if (m % 2 === 0) m += 1;
  return C.clamp(m, 1, total - 2);
}

function syncMineField() {
  const w = C.clamp(+$('cfgW').value || 15, 7, 35);
  const h = C.clamp(+$('cfgH').value || 15, 7, 35);
  const pct = C.clamp(+$('cfgPct').value || 23, 10, 90);
  $('cfgMines').value = forceOdd(w * h * pct / 100, w * h);
}

function newGame() {
  clearTimeout(aiTimer);
  $('dlgNewGame').close();
  $('dlgResult').close();
  const w = C.clamp(+$('cfgW').value || 15, 7, 35);
  const h = C.clamp(+$('cfgH').value || 15, 7, 35);
  const pct = C.clamp(+$('cfgPct').value || 23, 10, 90);
  let m = +$('cfgMines').value;
  if (!m || m < 1) m = w * h * pct / 100;
  m = forceOdd(m, w * h);
  const bombs = C.clamp(+$('cfgBombs').value || 1, 0, 9);
  speed = C.clamp(+$('cfgSpeed').value || 6, 1, 10);
  $('rngSpeed').value = speed; $('speedVal').textContent = speed;
  comBomb = $('chkComBomb').checked;
  kind.blue = $('cfgBlueKind').value;
  kind.red = $('cfgRedKind').value;
  timers = { blue: 0, red: 0 };
  hintOn = false; cheatOn = false;
  bombPreviewCenter = null;
  $('btnHint').classList.remove('on');
  $('btnCheat').classList.remove('on');
  document.body.classList.remove('bombing');
  game = new C.Game({ width: w, height: h, mineCount: m, bombCount: bombs });
  buildBoard();
  render();
  if (isAI('blue')) scheduleAI();
}

/* ---------------- 插件 ---------------- */
function samplePlugin() {
  return [
    '// 雷暴示例插件 — 保存为 .js 后在新对局设置中选择',
    '// 接口: makeDecision(view) -> {type:"open"|"bomb", x, y} | null(随机)',
    '// view: width height score oppScore mineCount remainMines bombs',
    '//       canBomb bombRadiusH bombRadiusV turn cellAt(x,y)',
    'function makeDecision(view) {',
    '  const w = view.width, h = view.height;',
    '  let best = null, bestP = -1;',
    '  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {',
    '    if (view.cellAt(x, y) !== -2) continue;',
    '    let p = 0.35;',
    '    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {',
    '      const c = view.cellAt(x + dx, y + dy);',
    '      if (c >= 1 && c <= 8) p = Math.max(p, c / 9);',
    '    }',
    '    if (p > bestP) { bestP = p; best = { type: "open", x, y }; }',
    '  }',
    '  return best;',
    '}',
  ].join('\n');
}

function loadPlugin(side, file) {
  if (!file) return;
  file.text().then(src => {
    let fn = null;
    try {
      const factory = new Function(src + '\n;return (typeof makeDecision === "function") ? makeDecision : null;');
      fn = factory();
    } catch (e) {
      toast('插件语法错误: ' + e.message, true);
      $(side === 'blue' ? 'cfgBlueFileName' : 'cfgRedFileName').textContent = '❌ 语法错误';
      return;
    }
    if (typeof fn !== 'function') {
      toast('插件需定义全局函数 makeDecision(view)', true);
      $(side === 'blue' ? 'cfgBlueFileName' : 'cfgRedFileName').textContent = '❌ 缺少 makeDecision';
      return;
    }
    plugin[side] = { name: file.name, fn };
    $(side === 'blue' ? 'cfgBlueFileName' : 'cfgRedFileName').textContent = '✅ ' + file.name;
    toast('已加载' + label(side) + '插件: ' + file.name);
    if (game && !game.over) { render(); }
  });
}

function downloadSample() {
  const blob = new Blob([samplePlugin()], { type: 'text/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mine-ai-sample.js';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------- 初始化 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  $('btnNewGame').addEventListener('click', () => { syncMineField(); $('dlgNewGame').showModal(); });
  $('overlaySettings').addEventListener('click', () => { syncMineField(); $('dlgNewGame').showModal(); });
  $('btnNewOk').addEventListener('click', newGame);
  $('btnNewCancel').addEventListener('click', () => $('dlgNewGame').close());
  ['cfgW', 'cfgH', 'cfgPct'].forEach(id => $(id).addEventListener('input', syncMineField));
  $('cfgBlueFile').addEventListener('change', e => { kind.blue = 'plugin'; $('cfgBlueKind').value = 'plugin'; loadPlugin('blue', e.target.files[0]); });
  $('cfgRedFile').addEventListener('change', e => { kind.red = 'plugin'; $('cfgRedKind').value = 'plugin'; loadPlugin('red', e.target.files[0]); });
  $('btnSampleBlue').addEventListener('click', downloadSample);
  $('btnSampleRed').addEventListener('click', downloadSample);
  $('btnHint').addEventListener('click', () => { hintOn = !hintOn; $('btnHint').classList.toggle('on', hintOn); render(); });
  $('btnCheat').addEventListener('click', () => { cheatOn = !cheatOn; $('btnCheat').classList.toggle('on', cheatOn); render(); });
  $('btnBomb').addEventListener('click', () => {
    if (!game || game.over) return;
    if (isAI(game.turn)) { toast('AI 回合中，无法切换炸弹模式', true); return; }
    if (game.bombMode) {
      game.setBombMode(false);
      bombPreviewCenter = null;
      document.body.classList.remove('bombing');
      render();
      return;
    }
    if (!game.setBombMode(true)) {
      toast('炸弹仅落后时可用 (当前 蓝 ' + game.scores.blue + ' : ' + game.scores.red + ' 红)，剩 ' + game.bombs[game.turn] + ' 枚', true);
      return;
    }
    bombPreviewCenter = null;
    document.body.classList.add('bombing');
    toast('炸弹模式已开启：移动鼠标预览范围，点击中心引爆');
    render();
  });
  $('rngSpeed').addEventListener('input', e => { speed = +e.target.value; $('speedVal').textContent = speed; });
  $('overlayAgain').addEventListener('click', newGame);
  $('btnResClose').addEventListener('click', () => $('dlgResult').close());
  $('btnResAgain').addEventListener('click', () => { $('dlgResult').close(); newGame(); });
  // 默认: 蓝=人类, 红=强AI
  syncMineField();
  newGame();
});
/* 调试句柄 (控制台/自动化用) */
window.__mine = {
  get game() { return game; },
  C, render, newGame, scheduleAI, afterMove, applyDecision,
  get hintOn() { return hintOn; }, setHint(v) { hintOn = v; render(); },
  get cheatOn() { return cheatOn; }, setCheat(v) { cheatOn = v; render(); },
};
})();
