"use strict";
/* ================================================================
   UI 层 — DOM 渲染 + 控制器 + 插件加载
   只读 Game 状态; 规则逻辑全部在 core (Game 类)
   ================================================================ */
(() => {
const C = MineCore;
const aiRegistry = MineAIRegistry.create(C, window.MineAIConfig);
const decisionGuard = MineAIDecision;
const gameSettings = MineGameSettings;
const keySequence = MineKeySequence.create('keynesy', 1500);
const $ = id => document.getElementById(id);
const victoryCelebration = MineVictoryCelebration.create($('victoryFireworks'), $('winnerMessage'));
const label = p => (p === 'blue' ? '蓝方' : '红方');
const other = p => (p === 'blue' ? 'red' : 'blue');

let game = null;
let boardRevision = 0;
let kind = { blue: 'human', red: window.MineAIConfig?.defaultBySide?.red || 'human' };
let speed = 6;
let hintOn = false, cheatOn = false;
let hintTogglePending = false;
let analysisCache = null;
let bombPreviewCenter = null;
let aiTimer = null;
let timers = { blue: 0, red: 0 };               // AI 思考耗时 ms
let session = { blue: 0, red: 0, draw: 0, total: 0 };

const boardEl = $('board');
const boardWrap = $('boardWrap');

function toast(msg, err, flash = false, durationMs = flash ? 1500 : 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '') + (flash ? ' flash' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = '', durationMs);
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
function toggleHint() {
  if (!keySequence.isUnlocked() || hintTogglePending) return false;
  hintTogglePending = true;
  try {
    if (!hintOn) getSharedAnalysis();
    hintOn = !hintOn;
    $('btnHint').classList.toggle('on', hintOn);
    render();
    return true;
  } catch (error) {
    toast('概率分析失败: ' + error.message, true);
    return false;
  } finally {
    hintTogglePending = false;
  }
}

boardWrap.addEventListener('contextmenu', e => {
  e.preventDefault();
  toggleHint();
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
  let analysis = null;
  if (hintOn) {
    try { analysis = getSharedAnalysis().analysis; } catch (e) { analysis = null; }
  }
  for (let i = 0; i < game.total; i++) {
    const el = cellEl(i);
    const x = i % game.w, y = Math.floor(i / game.w);
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
      if (hintOn && analysis) {
        const probability = analysis.mineProbabilityAt(x, y);
        if (Number.isFinite(probability)) {
          const hd = document.createElement('div');
          hd.className = 'hintp';
          hd.textContent = (analysis.quality === 'approximate' ? '≈' : '') + Math.round(probability * 100) + '%';
          hd.title = analysis.quality === 'exact' ? '等权约束模型下的精确概率' : '近似概率；不表示确定安全或确定有雷';
          el.appendChild(hd);
        }
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
    for (const i of targets) if (i >= 0 && i < game.total) {
      const cell = cellEl(i);
      cell.classList.add('lastmove', who);
      if (lm.kind === 'mine') cell.classList.add('mine-capture');
    }
  }
  updateHUD();
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
    $('bombs' + cap).textContent = gameSettings.formatBombStatus(game.bombs[p], game.bombMax);
    $('time' + cap).textContent = (timers[p] / 1000).toFixed(1) + 's';
    $('round' + cap).textContent = game.rounds[p];
    $('panel' + cap).classList.toggle('active', !game.over && game.turn === p);
    $('think' + cap).classList.toggle('show', !game.over && game.turn === p && isAI(p));
    const agent = aiRegistry.get(kind[p]);
    $('kind' + cap).textContent = agent ? agent.label : 'AI 缺失';
  }
  const bb = $('btnBomb');
  bb.disabled = !game || game.over;
  bb.className = 'toggle bomb' + (game && game.bombMode ? ' on' : '')
    + (!game.over && game.canBomb(game.turn, { ai: isAI(game.turn) }) ? ' ready' : '');
  bb.textContent = game.bombMode ? '💣 取消炸弹' : '💣 炸弹模式';
  $('bombGuide').classList.toggle('show', game.bombMode);
  $('bombGuide').textContent = game.bombMode
    ? '炸弹范围固定 5×5（边缘会裁切）· 飞机图标标记轰炸中心，红色区域为范围 · 点击未翻开的中心引爆 · 再点按钮取消 · 剩余 ' + game.bombs[game.turn] + ' 枚'
    : '';
  $('mineInfo').innerHTML = game.w + '×' + game.h + ' · 雷 <b>' + game.mineCount + '</b> · 胜线 <b>' + game.winNeed + '</b> · 炸弹 <b>5×5</b>';
  $('rulesInfo').textContent = '点开雷 +1 并续回合 · 点开数字/0 格换回合 · 落后方可炸弹 · 剩雷 ' + game.remainMines;
  $('sessBlue').textContent = session.blue;
  $('sessRed').textContent = session.red;
  $('sessDraw').textContent = session.draw;
  $('sessTotal').textContent = session.total;
}

function isAI(p) { return kind[p] !== 'human'; }
function aiWorks(p) {
  return kind[p] !== 'human' && !!aiRegistry.get(kind[p]);
}

/* ---------------- 交互 ---------------- */
function onCellClick(x, y) {
  if (!game || game.over) return;
  if (isAI(game.turn)) { toast('AI 回合中', true); return; }
  let r;
  if (game.bombMode) r = game.bomb(x, y);
  else r = game.open(x, y);
  if (r.ok) afterMove(r);
  else if (r.why === 'center-not-hidden') toast('炸弹中心必须选择未翻开的格子', true);
}

function afterMove(r, extraDelay) {
  boardRevision++;
  analysisCache = null;
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
function getSharedAnalysis() {
  if (!game) throw new Error('对局尚未开始');
  const source = game.view('blue', { ai: true });
  const values = Array.from({ length: game.total }, (_, i) => source.cellAt(i % game.w, Math.floor(i / game.w)));
  const key = [game.w, game.h, game.mineCount, game.remainMines, values.join(',')].join('|');
  const stateKey = [key, source.score, source.oppScore, source.bombs, source.turn, source.canBomb].join('|');
  if (!analysisCache || analysisCache.key !== key) {
    const frozenValues = Object.freeze(values);
    const width = game.w, height = game.h;
    const snapshot = Object.freeze({
      width,
      height,
      mineCount: game.mineCount,
      remainMines: game.remainMines,
      cellAt(x, y) {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return -2;
        return frozenValues[y * width + x];
      },
    });
    analysisCache = { key, snapshot, analysis: MineAIPlanner.analyze(snapshot) };
  }
  return { ...analysisCache, stateKey };
}

function makeView(p, shared = getSharedAnalysis()) {
  const source = game.view(p, { ai: true });
  return Object.freeze({
    width: source.width,
    height: source.height,
    score: source.score,
    oppScore: source.oppScore,
    mineCount: source.mineCount,
    remainMines: source.remainMines,
    bombs: source.bombs,
    canBomb: source.canBomb,
    enhancedAI: $('cfgEnhancedAI').checked,
    bombRadiusH: source.bombRadiusH,
    bombRadiusV: source.bombRadiusV,
    turn: source.turn,
    analysis: shared.analysis,
    cellAt: shared.snapshot.cellAt,
  });
}

function scheduleAI() {
  if (!game || game.over) return;
  clearTimeout(aiTimer);
  const p = game.turn;
  if (!aiWorks(p)) {
    toast(label(p) + ' AI 不可用，回退默认 AI', true);
    kind[p] = aiRegistry.fallbackId;
    updateHUD();
  }
  const delay = 100 + (10 - speed) * 200;
  const t0 = performance.now();
  const gameAtSchedule = game;
  const revisionAtSchedule = boardRevision;
  aiTimer = setTimeout(async () => {
    if (!game || game !== gameAtSchedule || game.over || game.turn !== p) return;
    let scheduledShared;
    try {
      scheduledShared = getSharedAnalysis();
    } catch (error) {
      console.error('共享概率分析失败', error);
      toast('共享概率分析失败: ' + error.message, true);
      return;
    }
    const scheduledView = makeView(p, scheduledShared);
    const isScheduledStateCurrent = () => {
      if (!game || game !== gameAtSchedule || game.over || game.turn !== p || boardRevision !== revisionAtSchedule) return false;
      try { return getSharedAnalysis().stateKey === scheduledShared.stateKey; }
      catch (error) {
        console.error('共享概率分析失败', error);
        return false;
      }
    };
    let decision = null;
    let decisionSourceFailed = false;
    try {
      const decide = await aiRegistry.load(kind[p]);
      if (!isScheduledStateCurrent()) return;
      if (decide) decision = decide(scheduledView);
    } catch (e) {
      decisionSourceFailed = true;
      console.error('AI 异常', e);
      toast(label(p) + ' AI 异常: ' + e.message + '（降级公开策略）', true);
      if (kind[p] !== aiRegistry.fallbackId && aiWorks(p) && isScheduledStateCurrent()) {
        kind[p] = aiRegistry.fallbackId;
        updateHUD();
        try {
          const fallback = await aiRegistry.load(kind[p]);
          if (!isScheduledStateCurrent()) return;
          if (fallback) {
            decision = fallback(scheduledView);
            decisionSourceFailed = false;
          }
        } catch (fallbackError) {
          console.error('默认 AI 加载失败', fallbackError);
        }
      }
    }
    if (!isScheduledStateCurrent()) return;
    const currentShared = getSharedAnalysis();
    const currentView = makeView(p, currentShared);
    const fallbackDecision = MineAIPlanner.chooseFallback(currentView, currentShared.analysis, C.randInt);
    timers[p] += performance.now() - t0;
    const resolved = decisionGuard.resolve(game, p, decision, {
      fallbackDecision,
      pluginId: kind[p],
      enhancedAI: $('cfgEnhancedAI').checked,
    });
    if (resolved.noMoves) {
      toast('对局无处可走', true);
      return;
    }
    if (resolved.invalid && !decisionSourceFailed) toast('AI 走昏招了！', true, true);
    applyDecision(p, resolved.action, resolved.fallbackAction);
  }, delay);
}

function recoverInvalidDecision(p) {
  const view = makeView(p);
  const fallbackDecision = MineAIPlanner.chooseFallback(view, view.analysis, C.randInt);
  const retry = decisionGuard.resolve(game, p, null, { fallbackDecision });
  if (retry.noMoves) {
    toast('对局无处可走', true);
    return;
  }
  const result = game.open(retry.action.x, retry.action.y);
  if (result.ok) afterMove(result);
  else toast(label(p) + ' 无合法走法', true);
}

function applyDecision(p, decision, fallbackAction) {
  if (!game || game.over || game.turn !== p || !decision) return;
  let action = decision;
  if (decision.type === 'bomb-auto') {
    const authorized = kind[p] === 'constraint-probability' && $('cfgEnhancedAI').checked &&
      game.canBomb(p, { ai: true });
    if (authorized) {
      const automatic = game.bombBest();
      if (automatic?.ok) { afterMove(automatic); return; }
    }

    const currentShared = getSharedAnalysis();
    const currentView = makeView(p, currentShared);
    const publicFallback = MineAIPlanner.chooseFallback(currentView, currentShared.analysis, C.randInt);
    const resolvedFallback = decisionGuard.resolve(game, p, fallbackAction, { fallbackDecision: publicFallback });
    if (resolvedFallback.noMoves) {
      toast('对局无处可走', true);
      return;
    }
    if (resolvedFallback.invalid) toast('AI 自动炸弹未执行，改走公开回退着法', true, true);
    action = resolvedFallback.action;
  }

  let result;
  if (action.type === 'bomb') result = game.bomb(action.x, action.y, { ai: true });
  else if (action.type === 'open') result = game.open(action.x, action.y);
  else result = { ok: false };
  if (result?.ok) afterMove(result);
  else {
    toast('AI 走昏招了！', true, true);
    recoverInvalidDecision(p);
  }
}

function onGameOver() {
  clearTimeout(aiTimer);
  session.total++;
  if (game.winner === 'blue') session.blue++;
  else if (game.winner === 'red') session.red++;
  else session.draw++;
  updateHUD();
  if (game.winner === 'draw') toast('本局平局', false, false, 2000);
  else victoryCelebration.start(label(game.winner) + '获胜！');
}

/* ---------------- 新对局 / 设置 ---------------- */
function syncMineField() {
  const w = Math.round(C.clamp(+$('cfgW').value || 15, 7, 35));
  const h = Math.round(C.clamp(+$('cfgH').value || 15, 7, 35));
  const pct = C.clamp(+$('cfgPct').value || 23, 10, 90);
  $('cfgW').value = w;
  $('cfgH').value = h;
  $('cfgPct').value = pct;
  $('cfgMines').value = gameSettings.normalizeMineCount(w * h * pct / 100, w, h);
}

function newGame() {
  clearTimeout(aiTimer);
  boardRevision++;
  analysisCache = null;
  $('dlgNewGame').close();
  const w = Math.round(C.clamp(+$('cfgW').value || 15, 7, 35));
  const h = Math.round(C.clamp(+$('cfgH').value || 15, 7, 35));
  const pct = C.clamp(+$('cfgPct').value || 23, 10, 90);
  const requestedMines = $('cfgMines').value === '' ? w * h * pct / 100 : $('cfgMines').value;
  const m = gameSettings.normalizeMineCount(requestedMines, w, h);
  const bombs = gameSettings.normalizeBombCount($('cfgBombs').value);
  $('cfgW').value = w; $('cfgH').value = h; $('cfgPct').value = pct;
  $('cfgMines').value = m; $('cfgBombs').value = bombs;
  speed = C.clamp(+$('cfgSpeed').value || 6, 1, 10);
  $('cfgSpeed').value = speed;
  $('rngSpeed').value = speed; $('speedVal').textContent = speed;
  kind.blue = $('cfgBlueKind').value;
  kind.red = $('cfgRedKind').value;
  timers = { blue: 0, red: 0 };
  hintOn = false; cheatOn = false;
  bombPreviewCenter = null;
  $('btnHint').classList.remove('on');
  $('btnCheat').classList.remove('on');
  document.body.classList.remove('bombing');
  game = new C.Game({
    width: w,
    height: h,
    mineCount: m,
    bombCount: bombs,
    disableAiBombs: $('cfgDisableAiBombs').checked,
  });
  buildBoard();
  render();
  if (isAI('blue')) scheduleAI();
}

/* ---------------- AI 配置 ---------------- */
function refreshAgentOptions() {
  const agents = aiRegistry.list();
  for (const side of ['blue', 'red']) {
    const cap = side === 'blue' ? 'Blue' : 'Red';
    const select = $('cfg' + cap + 'Kind');
    const previous = select.value;
    select.innerHTML = '';
    const human = document.createElement('option');
    human.value = 'human';
    human.textContent = '人类';
    select.appendChild(human);

    for (const agent of agents) {
      if (agent.id === 'human') continue;
      const option = document.createElement('option');
      option.value = agent.id;
      option.textContent = agent.label;
      select.appendChild(option);
    }

    const preferred = previous || aiRegistry.defaultBySide[side] || 'human';
    select.value = aiRegistry.get(preferred) ? preferred : 'human';
    const description = $('desc' + cap + 'Kind');
    description.textContent = aiRegistry.get(select.value)?.description || '';
    select.addEventListener('change', () => {
      description.textContent = aiRegistry.get(select.value)?.description || '';
    });
  }
}

/* ---------------- 初始化 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  $('btnNewGame').addEventListener('click', () => $('dlgNewGame').showModal());
  $('btnNewOk').addEventListener('click', newGame);
  $('btnNewCancel').addEventListener('click', () => $('dlgNewGame').close());
  ['cfgW', 'cfgH', 'cfgPct'].forEach(id => $(id).addEventListener('input', syncMineField));
  $('btnHint').addEventListener('click', toggleHint);
  $('btnCheat').addEventListener('click', () => {
    if (!keySequence.isUnlocked()) return;
    cheatOn = !cheatOn;
    $('btnCheat').classList.toggle('on', cheatOn);
    render();
  });
  window.addEventListener('keydown', e => {
    if (keySequence.push(e.key, Date.now(), e)) {
      $('btnHint').hidden = false;
      $('btnCheat').hidden = false;
      toast('隐藏辅助模式已解锁');
    }
  });
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
  $('rngSpeed').addEventListener('input', e => {
    speed = +e.target.value;
    $('cfgSpeed').value = speed;
    $('speedVal').textContent = speed;
  });
  $('cfgSpeed').addEventListener('input', e => {
    speed = C.clamp(+e.target.value || 6, 1, 10);
    $('cfgSpeed').value = speed;
    $('rngSpeed').value = speed;
    $('speedVal').textContent = speed;
  });
  refreshAgentOptions();
  syncMineField();
  newGame();
});
/* 调试句柄 (控制台/自动化用) */
window.__mine = {
  get view() { return game ? makeView('blue') : null; },
  get hintOn() { return hintOn; },
  get cheatOn() { return cheatOn; },
};
})();
