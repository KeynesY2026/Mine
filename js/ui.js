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
const mineFeedback = MineFeedback;
const mineIcons = MineIcons;
const boardLayout = MineBoardLayout;
const humanTimer = MineTurnTimer.create(() => performance.now());
const keySequence = MineKeySequence.create('cheat', 1500);
const $ = id => document.getElementById(id);
const victoryCelebration = MineVictoryCelebration.create($('victoryFireworks'), $('winnerMessage'));
const audioFeedback = MineAudioFeedback.create();
const label = p => (p === 'blue' ? '蓝方' : '红方');
const other = p => (p === 'blue' ? 'red' : 'blue');

let game = null;
let gameLog = null;
let boardRevision = 0;
let kind = { blue: 'human', red: window.MineAIConfig?.defaultBySide?.red || 'human' };
let speed = 6;
let hintOn = false, cheatOn = false;
let hintTogglePending = false;
let analysisCache = null;
let bombPreviewCenter = null;
let bombPreviewCells = new Set();
let aiTimer = null;
let timers = { blue: 0, red: 0 };               // AI 思考耗时 ms
let session = { blue: 0, red: 0, draw: 0, total: 0 };

const boardEl = $('board');
const boardViewport = $('boardViewport');

function toast(msg, err, flash = false, durationMs = flash ? 1500 : 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '') + (flash ? ' flash' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = '', durationMs);
}

function syncSoundButton() {
  const button = $('btnSound');
  const enabled = audioFeedback.isEnabled();
  button.setAttribute('aria-pressed', String(enabled));
  button.setAttribute('aria-label', enabled ? '关闭音效' : '开启音效');
  button.firstElementChild.textContent = enabled ? '🔊' : '🔇';
  button.lastElementChild.textContent = enabled ? '音效开' : '音效关';
}

/* ---------------- 棋盘构建 ---------------- */
function layout() {
  if (!game) return;
  const w = game.w, h = game.h;
  const cs = boardLayout.cellSize(w, h, boardViewport.clientWidth, boardViewport.clientHeight);
  document.documentElement.style.setProperty('--cs', cs + 'px');
  boardEl.style.gridTemplateColumns = `repeat(${w}, var(--cs))`;
  boardEl.style.gridTemplateRows = `repeat(${h}, var(--cs))`;
}

function buildBoard() {
  bombPreviewCenter = null;
  bombPreviewCells.clear();
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
      updateBombPreview(x, y);
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
    audioFeedback.play('click');
    return true;
  } catch (error) {
    toast('概率分析失败: ' + error.message, true);
    return false;
  } finally {
    hintTogglePending = false;
  }
}

boardViewport.addEventListener('contextmenu', e => {
  e.preventDefault();
  toggleHint();
});
boardEl.addEventListener('pointerleave', clearBombPreview);
const boardResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
if (boardResizeObserver) boardResizeObserver.observe(boardViewport);
window.addEventListener('resize', layout);

const cellEl = i => boardEl.children[i];

function updateBombPreview(x, y) {
  if (!game || !game.bombMode) return;
  if (bombPreviewCenter?.x === x && bombPreviewCenter?.y === y) return;
  const nextPreviewCells = new Set(game.bombAreaCells(x, y));
  for (const i of bombPreviewCells) {
    if (!nextPreviewCells.has(i)) cellEl(i)?.classList.remove('bomb-preview');
  }
  for (const i of nextPreviewCells) {
    if (!bombPreviewCells.has(i)) cellEl(i)?.classList.add('bomb-preview');
  }
  const previousCenter = bombPreviewCenter ? bombPreviewCenter.y * game.w + bombPreviewCenter.x : -1;
  const nextCenter = y * game.w + x;
  if (previousCenter !== nextCenter) {
    if (previousCenter >= 0) cellEl(previousCenter)?.classList.remove('bomb-preview-center');
    cellEl(nextCenter)?.classList.add('bomb-preview-center');
  }
  bombPreviewCenter = { x, y };
  bombPreviewCells = nextPreviewCells;
}

function clearBombPreview() {
  for (const i of bombPreviewCells) cellEl(i)?.classList.remove('bomb-preview');
  if (bombPreviewCenter) {
    const center = bombPreviewCenter.y * game.w + bombPreviewCenter.x;
    cellEl(center)?.classList.remove('bomb-preview-center');
  }
  bombPreviewCells.clear();
  bombPreviewCenter = null;
}

/* ---------------- 渲染 ---------------- */
function render() {
  if (!game) return;
  document.body.classList.toggle('bombing', game.bombMode);
  if (!game.bombMode) bombPreviewCenter = null;
  const previewCells = game.bombMode && bombPreviewCenter
    ? new Set(game.bombAreaCells(bombPreviewCenter.x, bombPreviewCenter.y)) : null;
  bombPreviewCells = previewCells || new Set();
  let analysis = null;
  if (hintOn) {
    try { analysis = getSharedAnalysis().analysis; } catch (e) { analysis = null; }
  }
  const mineCaptures = new Set(mineFeedback.capturedMineIndices(game.lastMove, game.mines, game.owner));
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
      const owner = game.owner[i] === 1 ? 'blue' : game.owner[i] === 2 ? 'red' : null;
      const capture = mineCaptures.has(i);
      el.innerHTML = '<span class="mine-emblem">' + mineIcons.mineSvg(owner, capture) + '</span>';
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
      if (mineCaptures.has(i)) cell.classList.add('mine-capture');
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
    renderBombInventory($('bombs' + cap), game.bombs[p]);
    $('timeLabel' + cap).textContent = isAI(p) ? 'AI 用时' : '人类用时';
    $('time' + cap).textContent = formatClock(isAI(p) ? timers[p] : humanTimer.elapsed(p));
    $('round' + cap).textContent = game.rounds[p];
    $('panel' + cap).classList.toggle('active', !game.over && game.turn === p);
    $('think' + cap).classList.toggle('show', !game.over && game.turn === p && isAI(p));
    const agent = aiRegistry.get(kind[p]);
    $('kind' + cap).textContent = agent ? agent.label : 'AI 缺失';
  }
  const bb = $('btnBomb');
  const canBomb = !game.over && game.canBomb(game.turn, { ai: isAI(game.turn) });
  bb.disabled = !game || game.over || (!game.bombMode && (isAI(game.turn) || !canBomb));
  bb.className = 'toggle bomb' + (game.bombMode ? ' on' : '') + (canBomb && !game.bombMode ? ' ready' : '');
  $('bombButtonLabel').textContent = game.bombMode ? '取消攻击' : '炸弹攻击';
  renderBombInventory($('bombButtonCount'), game.bombs[game.turn]);
  $('bombButtonCountText').textContent = '当前回合剩余炸弹 ' + game.bombs[game.turn] + ' 枚';
  $('bombGuide').classList.add('show');
  $('bombGuide').textContent = game.bombMode
    ? '选择轰炸中心 · 范围 5×5（边缘裁切）；点击未翻开的格子引爆，再按按钮取消。'
    : isAI(game.turn) ? '等待人类回合后使用炸弹。'
      : game.bombs[game.turn] <= 0 ? '炸弹库存已用尽。'
        : canBomb ? '可用 · 攻击范围 5×5。'
          : '仅落后时可用；落后后可攻击 5×5 区域。';
  $('mineInfo').innerHTML = game.w + '×' + game.h + ' · 雷 <b>' + game.mineCount + '</b> · 胜线 <b>' + game.winNeed + '</b> · 炸弹 <b>5×5</b>';
  $('remainMines').textContent = game.remainMines;
  $('mineCounter').setAttribute('aria-label', '棋盘剩余地雷 ' + game.remainMines + ' 枚');
  $('rulesInfo').textContent = '点开雷 +1 并续回合 · 点开数字/0 格换回合 · 落后方可使用炸弹。';
  $('sessBlue').textContent = session.blue;
  $('sessRed').textContent = session.red;
  $('sessDraw').textContent = session.draw;
  $('sessTotal').textContent = session.total;
}

function renderBombInventory(container, remaining) {
  const display = gameSettings.formatBombInventory(remaining);
  container.innerHTML = '';
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', display.label);
  container.title = display.label;
  if (display.empty) {
    const empty = document.createElement('span');
    empty.className = 'bombs-empty';
    empty.textContent = '已用尽';
    container.appendChild(empty);
    return;
  }
  for (let i = 0; i < display.iconCount; i++) {
    const icon = document.createElement('span');
    icon.className = 'bomb-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = mineIcons.bombSvg();
    container.appendChild(icon);
  }
  if (display.multiplier !== null) {
    const multiplier = document.createElement('span');
    multiplier.className = 'bomb-multiplier';
    multiplier.textContent = '×' + display.multiplier;
    container.appendChild(multiplier);
  }
}

function formatClock(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function updateTimeDisplays() {
  if (!game) return;
  for (const p of ['blue', 'red']) {
    const cap = p === 'blue' ? 'Blue' : 'Red';
    $('timeLabel' + cap).textContent = isAI(p) ? 'AI 用时' : '人类用时';
    $('time' + cap).textContent = formatClock(isAI(p) ? timers[p] : humanTimer.elapsed(p));
  }
}

function isAI(p) { return kind[p] !== 'human'; }
function aiWorks(p) {
  return kind[p] !== 'human' && !!aiRegistry.get(kind[p]);
}
function diagnosticThreshold() {
  const threshold = window.MineAIConfig?.bombWinProbabilityThreshold;
  return Number.isFinite(threshold) ? threshold : null;
}
function diagnosticGameState() {
  return {
    scores: { blue: game.scores.blue, red: game.scores.red },
    bombs: { blue: game.bombs.blue, red: game.bombs.red },
    remainMines: game.remainMines,
    turn: game.turn,
    over: game.over,
    winner: game.winner,
  };
}
function recordDiagnosticMove(move) {
  if (!gameLog) return;
  try {
    MineDiagnosticLog.recordMove(gameLog, { ...move, after: diagnosticGameState() });
  } catch (error) {
    console.error('诊断日志记录失败', error);
  }
}

/* ---------------- 交互 ---------------- */
function onCellClick(x, y) {
  if (!game || game.over) return;
  if (isAI(game.turn)) { toast('AI 回合中', true); return; }
  const player = game.turn;
  const action = game.bombMode ? { type: 'bomb', x, y } : { type: 'open', x, y };
  const before = MineDiagnosticLog.captureView(game.view(player, { ai: true }), diagnosticThreshold());
  const r = action.type === 'bomb' ? game.bomb(x, y) : game.open(x, y);
  if (r.ok) {
    recordDiagnosticMove({ player, agent: 'human', before, requestedAction: action, executedAction: action, result: r });
    afterMove(r);
  } else if (r.why === 'center-not-hidden') toast('炸弹中心必须选择未翻开的格子', true);
}

function afterMove(r, extraDelay) {
  if (r.kind === 'bomb') audioFeedback.play('bomb');
  else if (r.kind === 'mine') audioFeedback.play('mine');
  else audioFeedback.play('open');
  humanTimer.endTurn(game.lastMove?.player, game.turn, !game.over && !isAI(game.turn), game.over);
  boardRevision++;
  analysisCache = null;
  if (r.kind === 'bomb') clearBombPreview();
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
    setTimeout(() => boardEl.classList.remove('shake'), 1050);
    for (const i of r.cells) {
      if (game.mines[i]) {
        cellEl(i).classList.add('blast');
        setTimeout(el => el.classList.remove('blast'), 1500, cellEl(i));
      }
    }
  }
  if (game.over) { onGameOver(); return; }
  if (isAI(game.turn)) scheduleAI();
}

/* ---------------- AI 调度 ---------------- */
function getSharedAnalysis(player = game?.turn) {
  if (!game) throw new Error('对局尚未开始');
  const source = game.view('blue', { ai: true });
  const playerSource = game.view(player, { ai: true });
  const threshold = window.MineAIConfig?.bombWinProbabilityThreshold;
  const includeJointHitDistributions = isAI(player) && kind[player] === 'constraint-probability'
    && Number.isFinite(threshold) && threshold > 0 && threshold <= 1
    && playerSource.canBomb && playerSource.bombs > 0;
  const values = Array.from({ length: game.total }, (_, i) => source.cellAt(i % game.w, Math.floor(i / game.w)));
  const key = [game.w, game.h, game.mineCount, game.remainMines, values.join(',')].join('|');
  const stateKey = [key, source.score, source.oppScore, source.bombs, source.turn, source.canBomb].join('|');
  const cacheKey = `${key}|joint:${includeJointHitDistributions}`;
  if (!analysisCache || analysisCache.key !== cacheKey) {
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
    analysisCache = {
      key: cacheKey,
      snapshot,
      analysis: MineAIPlanner.analyze(snapshot, { includeJointHitDistributions }),
    };
  }
  return { ...analysisCache, stateKey };
}

function makeView(p, shared = getSharedAnalysis(p)) {
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
  const agentAtSchedule = kind[p];
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
    const diagnosticBefore = MineDiagnosticLog.captureView(scheduledView, diagnosticThreshold());
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
    let decisionError = null;
    try {
      const decide = await aiRegistry.load(kind[p]);
      if (!isScheduledStateCurrent()) return;
      if (decide) decision = decide(scheduledView);
    } catch (e) {
      decisionSourceFailed = true;
      decisionError = e?.message || String(e);
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
          decisionError = fallbackError?.message || String(fallbackError);
          console.error('默认 AI 加载失败', fallbackError);
        }
      }
    }
    if (!isScheduledStateCurrent()) return;
    const currentShared = getSharedAnalysis();
    const currentView = makeView(p, currentShared);
    const fallbackDecision = MineAIPlanner.chooseFallback(currentView, currentShared.analysis, C.randInt);
    timers[p] += performance.now() - t0;
    const resolved = decisionGuard.resolve(game, p, decision, { fallbackDecision });
    if (resolved.noMoves) {
      toast('对局无处可走', true);
      return;
    }
    if (resolved.invalid && !decisionSourceFailed) toast('AI 走昏招了！', true, true);
    applyDecision(p, resolved.action, {
      before: diagnosticBefore,
      agent: agentAtSchedule,
      fallbackAgent: kind[p] === agentAtSchedule ? null : kind[p],
      requestedAction: decision,
      invalid: resolved.invalid,
      decisionSourceFailed,
      decisionError,
    });
  }, delay);
}

function recoverInvalidDecision(p) {
  const view = makeView(p);
  const before = MineDiagnosticLog.captureView(view, diagnosticThreshold());
  const fallbackDecision = MineAIPlanner.chooseFallback(view, view.analysis, C.randInt);
  const retry = decisionGuard.resolve(game, p, null, { fallbackDecision });
  if (retry.noMoves) {
    toast('对局无处可走', true);
    return;
  }
  const result = game.open(retry.action.x, retry.action.y);
  recordDiagnosticMove({
    player: p, agent: kind[p], before, requestedAction: null, executedAction: retry.action,
    invalid: false, decisionSourceFailed: false, decisionError: 'legal fallback after rejected action', result,
  });
  if (result.ok) afterMove(result);
  else toast(label(p) + ' 无合法走法', true);
}

function applyDecision(p, action, diagnostic = {}) {
  if (!game || game.over || game.turn !== p || !action) return;
  const before = diagnostic.before || MineDiagnosticLog.captureView(makeView(p), diagnosticThreshold());
  let result;
  if (action.type === 'bomb') result = game.bomb(action.x, action.y, { ai: true });
  else if (action.type === 'open') result = game.open(action.x, action.y);
  else result = { ok: false };
  recordDiagnosticMove({
    player: p, agent: diagnostic.agent || kind[p], fallbackAgent: diagnostic.fallbackAgent,
    before,
    requestedAction: diagnostic.requestedAction,
    executedAction: action,
    invalid: diagnostic.invalid,
    decisionSourceFailed: diagnostic.decisionSourceFailed,
    decisionError: diagnostic.decisionError,
    result,
  });
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
  if (game.winner !== 'draw') audioFeedback.play('victory');
  victoryCelebration.start(game.winner === 'draw' ? '本局平局' : label(game.winner) + '获胜！');
}

function exportDiagnosticLog() {
  if (!cheatOn || !game || !gameLog) {
    toast('请先开启作弊模式再导出日志', true);
    return false;
  }
  try {
    const exportedAt = new Date().toISOString();
    const report = MineDiagnosticLog.createExportDocument(gameLog, diagnosticGameState(), exportedAt);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'minestorm-debug-' + exportedAt.replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    toast('分析日志已下载（含本局雷图）');
    return true;
  } catch (error) {
    console.error('诊断日志导出失败', error);
    toast('诊断日志导出失败: ' + error.message, true);
    return false;
  }
}

/* ---------------- 新对局 / 设置 ---------------- */
function syncMineField() {
  const size = Math.round(C.clamp(+$('cfgSize').value || 15, 10, 99));
  const pct = Math.round(C.clamp(+$('cfgPct').value || 23, 10, 90));
  $('cfgSize').value = size;
  $('cfgPct').value = pct;
  $('cfgPctValue').textContent = pct + '%';
  $('cfgPct').style.setProperty('--density-progress', ((pct - 10) / 80 * 100) + '%');
  const mineCount = gameSettings.resolveMineCount({ width: size, height: size, densityPercent: pct });
  $('autoMineSummary').textContent = '生成 ' + mineCount + ' 枚奇数雷';
}

function newGame() {
  clearTimeout(aiTimer);
  victoryCelebration.stop();
  boardRevision++;
  analysisCache = null;
  syncMineField();
  $('dlgNewGame').close();
  const size = Math.round(C.clamp(+$('cfgSize').value || 15, 10, 99));
  const pct = Math.round(C.clamp(+$('cfgPct').value || 23, 10, 90));
  const m = gameSettings.resolveMineCount({ width: size, height: size, densityPercent: pct });
  const bombs = gameSettings.normalizeBombCount($('cfgBombs').value);
  $('cfgSize').value = size; $('cfgPct').value = pct;
  $('cfgPctValue').textContent = pct + '%';
  $('cfgBombs').value = bombs;
  speed = C.clamp(+$('rngSpeed').value || 6, 1, 10);
  $('rngSpeed').value = speed; $('speedVal').textContent = speed;
  kind.blue = $('cfgBlueKind').value;
  kind.red = $('cfgRedKind').value;
  timers = { blue: 0, red: 0 };
  hintOn = false; cheatOn = false;
  bombPreviewCenter = null;
  $('btnHint').classList.remove('on');
  $('btnCheat').classList.remove('on');
  $('btnExportLog').hidden = true;
  document.body.classList.remove('bombing');
  game = new C.Game({
    width: size,
    height: size,
    mineCount: m,
    bombCount: bombs,
    disableAiBombs: $('cfgDisableAiBombs').checked,
  });
  humanTimer.reset();
  if (!isAI(game.turn)) humanTimer.start(game.turn);
  gameLog = MineDiagnosticLog.createGameLog({
    startedAt: new Date().toISOString(),
    width: size,
    height: size,
    settings: {
      mineCount: m,
      bombCount: bombs,
      disableAiBombs: $('cfgDisableAiBombs').checked,
      aiSpeed: speed,
      bombWinProbabilityThreshold: diagnosticThreshold(),
    },
    aiBySide: { blue: kind.blue, red: kind.red },
    actualMineMap: Array.from(game.mines),
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

  }
}

/* ---------------- 初始化 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  $('mineCounterIcon').innerHTML = mineIcons.counterMineSvg();
  syncSoundButton();
  $('btnSound').addEventListener('click', () => {
    if (audioFeedback.toggle()) audioFeedback.play('click');
    syncSoundButton();
  });
  $('btnNewGame').addEventListener('click', () => {
    audioFeedback.play('click');
    $('dlgNewGame').showModal();
  });
  $('btnNewOk').addEventListener('click', () => {
    audioFeedback.play('click');
    newGame();
  });
  $('btnNewCancel').addEventListener('click', () => {
    audioFeedback.play('click');
    $('dlgNewGame').close();
  });
  $('dlgNewGame').addEventListener('change', e => {
    if (e.target.matches('input, select')) audioFeedback.play('click');
  });
  ['cfgSize', 'cfgPct'].forEach(id => $(id).addEventListener('input', syncMineField));
  $('btnHint').addEventListener('click', toggleHint);
  $('btnCheat').addEventListener('click', () => {
    if (!keySequence.isUnlocked()) return;
    audioFeedback.play('click');
    cheatOn = !cheatOn;
    $('btnCheat').classList.toggle('on', cheatOn);
    $('btnExportLog').hidden = !cheatOn;
    render();
  });
  $('btnExportLog').addEventListener('click', () => {
    audioFeedback.play('click');
    exportDiagnosticLog();
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
      audioFeedback.play('click');
      game.setBombMode(false);
      clearBombPreview();
      document.body.classList.remove('bombing');
      render();
      return;
    }
    if (!game.setBombMode(true)) {
      toast('炸弹仅落后时可用 (当前 蓝 ' + game.scores.blue + ' : ' + game.scores.red + ' 红)，剩 ' + game.bombs[game.turn] + ' 枚', true);
      return;
    }
    clearBombPreview();
    audioFeedback.play('click');
    document.body.classList.add('bombing');
    toast('炸弹模式已开启：移动鼠标预览范围，点击中心引爆');
    render();
  });
  $('rngSpeed').addEventListener('input', e => {
    speed = C.clamp(+e.target.value || 6, 1, 10);
    $('speedVal').textContent = speed;
  });
  $('rngSpeed').addEventListener('change', () => audioFeedback.play('click'));
  refreshAgentOptions();
  syncMineField();
  setInterval(updateTimeDisplays, 200);
  newGame();
});
/* 调试句柄 (控制台/自动化用) */
window.__mine = {
  get view() { return game ? makeView('blue') : null; },
  get hintOn() { return hintOn; },
  get cheatOn() { return cheatOn; },
};
})();
