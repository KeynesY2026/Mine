# MineStorm Unified AI Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three unified AI tiers, fair-by-default decisions with an opt-in max-yield bomb API, bomb and hidden-mode settings, invalid-move recovery, and settings that persist across games within one page session.

**Architecture:** Keep `makeDecision(view)` as the common AI contract and preserve lazy loading. Add a no-coordinate `Game.bombBest()` engine operation that validates normal bomb rules and keeps the true map private; the UI scheduler only uses it for AI bomb actions when “增强 AI” is enabled. Add a small, testable decision guard for invalid actions and legal random fallback; keep UI settings in current-page state without browser storage.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript; Node.js built-in `node:test`; no new dependencies, server, or BAT file.

**Spec:** `docs/superpowers/specs/2026-10-05-minestorm-unified-ai-design.md`

## Global Constraints

- AI menu order is “简单 / 中等 / 无敌”; do not group by built-in/external; keep all three on `makeDecision(view)`.
- Load only the selected AI script; preserve existing AI registration IDs to avoid breaking plugin registrations.
- Ordinary AI decisions receive public `view` only; no true mine map in `view` or plugin registry. `Game.bombBest()` is the sole hidden-state exception, used only for a legal AI bomb when enhanced mode is enabled.
- Bomb count is 0–999 per player, default 1; there is no unlimited option. “禁用 AI 炸弹” defaults unchecked and affects every AI, not humans.
- A bomb is legal only when the current player is behind and has remaining bombs. Invalid AI decisions show “AI 走昏招了！” and fall back to a random legal unopened cell; if none exists, do not move and report no legal move.
- `keynesy` unlocks player cheat/probability controls at any point in the page session; per-key gap is at most 1.5 seconds. Before unlock, right-click cannot show probabilities.
- Settings, selected AIs, and AI thinking speed persist across new games in this page only; a reload restores defaults. Do not use `localStorage`.
- Do not implement undo. Do not add a server, BAT file, or dependency.

## File Map

- `js/core.js`: `Game` state, `canBomb(p)`, `bomb(x, y)`, `view(forPlayer)`; add clamped bomb count and no-coordinate max-yield bomb operation.
- `js/ai-registry.js`, `plugin/ai-config.js`: lazy AI manifest and public metadata; flatten display order and descriptions.
- `plugin/ai-heuristic.js`, `plugin/ai-global-probability.js`, `plugin/ai-constraint-probability.js`: existing decision algorithms; retain public-view-only decisions and improve the strongest AI’s bomb conservation policy.
- `js/ai-decision.js` (new): pure validation/normalization for AI decisions and random legal fallback, without mine-map access.
- `js/key-sequence.js` (new): testable `keynesy` sequence detector.
- `js/game-settings.js` (new): pure bomb-count/manual-mine normalizers and numeric remaining-bomb formatter shared by form handling and tests.
- `js/ui.js`: settings, descriptions, hint/cheat lock, keyboard input, AI dispatch, counters, persistence, and debug handle.
- `index.html`, `css/style.css`: setup fields, AI descriptions, hidden controls, bomb display, warning animation, plugin-interface text.
- `test/bomb-area.test.js`, `test/plugin-registry.test.js`, `test/strong-plugin.test.js` and new `test/ai-decision.test.js`, `test/key-sequence.test.js`, `test/ai-settings.test.js`: focused regressions.

---

### Task 1: Add safe core bomb inventory and max-yield bomb API

**Files:**
- Modify: `js/core.js`
- Modify: `test/bomb-area.test.js`

**Interfaces:**
- Preserve the existing human-call defaults while extending `Game.canBomb(p, {ai = false} = {})`, `Game.bomb(x, y, {ai = false} = {})`, and `Game.view(forPlayer, {ai = false} = {})` for the scheduler.
- Store `cfg.disableAiBombs` in the game and reject AI bomb checks/actions when enabled while leaving human bomb calls unchanged.
- Add `Game.bombBest()` with no parameters. It uses AI bomb authorization, returns the same result shape as `bomb(x, y)`, and chooses the legal blast center that scores the greatest number of unrevealed mines; ties use row-major order.
- Clamp `cfg.bombCount` to an integer in `[0, 999]`, defaulting to `1` when absent or invalid.

- [ ] **Step 1: Add failing core tests**

Append tests to `test/bomb-area.test.js`:

```js
test('bombBest selects the center with the most unrevealed mines', () => {
  const board = new Game({ width: 7, height: 7, mineCount: 9, bombCount: 1 });
  board.mines.fill(0);
  for (const i of [16, 17, 18, 23, 24, 25, 30, 31, 32]) board.mines[i] = 1;
  board.scores.red = 1;

  const result = board.bombBest();

  assert.equal(result.ok, true);
  assert.deepEqual([result.x, result.y], [3, 3]);
  assert.equal(result.mines, 9);
  assert.equal(board.bombs.blue, 0);
});

test('bombBest uses row-major order for equally valuable regions', () => {
  const board = new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1 });
  board.mines.fill(0);
  board.scores.red = 1;

  const result = board.bombBest();

  assert.equal(result.ok, true);
  assert.deepEqual([result.x, result.y], [0, 0]);
});

test('bombBest refuses to fire when bombing is illegal or AI bombs are disabled', () => {
  const board = new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1, disableAiBombs: true });
  board.scores.red = 1;
  const before = board.bombs.blue;

  assert.equal(board.canBomb('blue'), true);
  assert.equal(board.canBomb('blue', { ai: true }), false);
  assert.equal(board.view('blue').canBomb, true);
  assert.equal(board.view('blue', { ai: true }).canBomb, false);
  assert.equal(board.bombBest().ok, false);
  assert.equal(board.bombs.blue, before);
});

test('bomb count is clamped to 0..999 and defaults to one', () => {
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1 }).bombMax, 1);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1200 }).bombMax, 999);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: -4 }).bombMax, 0);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test test/bomb-area.test.js`\
Expected: failures for missing `bombBest()` and unbounded/default bomb inventory.

- [ ] **Step 3: Implement the minimum core behavior**

In `Game` constructor normalize bomb count and set `this.disableAiBombs = !!cfg.disableAiBombs`. Change `canBomb(p)` to `canBomb(p, { ai = false } = {})`; when `ai` is true and `this.disableAiBombs` is set, return false before the normal behind/inventory check. Change `bomb(x,y)` to `bomb(x,y,{ai = false} = {})` and pass `{ai}` to `canBomb`. Change `view(forPlayer)` to `view(forPlayer,{ai = false} = {})` and compute `canBomb` with that actor flag. Existing human calls omit the option and preserve their behavior.

Add:
bombBest() {
  if (!this.canBomb(this.turn, { ai: true })) return { ok: false, why: 'cannot' };
  let best = null;
  let bestMines = -1;
  for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
    let mines = 0;
    for (const i of this.bombAreaCells(x, y)) {
      if (!this.revealed[i] && this.mines[i]) mines++;
    }
    if (mines > bestMines) { bestMines = mines; best = { x, y }; }
  }
  return best ? this.bomb(best.x, best.y, { ai: true }) : { ok: false, why: 'no-target' };
}
```

The method must check `canBomb(this.turn, {ai:true})` before reading `this.mines`, then call `bomb(best.x, best.y, {ai:true})`; do not return mine locations or the scan result to callers beyond the ordinary bomb action result.

- [ ] **Step 4: Run core tests and the full suite**

Run: `node --test test/bomb-area.test.js` then `node --test`.\
Expected: all focused tests and existing tests pass.

- [ ] **Step 5: Commit the core increment**

```bash
git add js/core.js test/bomb-area.test.js
git commit -m "feat: add validated max-yield bomb action"
```

### Task 2: Unify AI labels, metadata, descriptions, and list rendering

**Files:**
- Modify: `plugin/ai-config.js`
- Modify: `js/ai-registry.js`
- Modify: `js/ui.js`
- Modify: `index.html`, `css/style.css`
- Modify: `test/plugin-registry.test.js`

**Interfaces:**
- Keep registry IDs `heuristic`, `global-probability`, and `constraint-probability` unchanged, and retain current side defaults (`blue: human`, `red: constraint-probability`).
- Each public agent includes `id`, `label`, `description`, and `loaded`.
- UI lists human first, then “简单”, “中等”, “无敌”, with no `<optgroup>` categories.

- [ ] **Step 1: Update the registry test first**

Change the expected labels in `test/plugin-registry.test.js` to `['简单', '中等', '无敌']`; assert the list has those IDs in that order and that each public agent exposes a non-empty description while unselected scripts remain unloaded.

- [ ] **Step 2: Run the registry test and confirm the metadata assertions fail**

Run: `node --test test/plugin-registry.test.js`\
Expected: current labels/categories and missing descriptions fail the new assertions.

- [ ] **Step 3: Implement unified metadata and UI display**

Set config entries in order with labels and concise descriptions, e.g.:

```js
{
  id: 'heuristic',
  label: '简单',
  description: '轻量的局部规则判断，复杂局面偶尔需要猜测。',
  src: 'plugin/ai-heuristic.js',
  coreMethod: 'weakDecide',
},
{
  id: 'global-probability',
  label: '中等',
  description: '结合全局剩余雷数估算概率，偏向高收益选择。',
  src: 'plugin/ai-global-probability.js',
  coreMethod: 'strongDecide',
},
{
  id: 'constraint-probability',
  label: '无敌',
  description: '枚举线索约束，优先低风险，并谨慎规划炸弹。',
  src: 'plugin/ai-constraint-probability.js',
},
```

Remove `category` metadata. Include `description` in `publicAgent()`. Replace optgroup construction in `refreshAgentOptions()` with flat `<option>` elements and update one description element per side on initial population and `change`. Keep lazy `load()` behavior untouched. Add accessible description containers to both side blocks in `index.html` and minimal readable styles in `css/style.css`.

- [ ] **Step 4: Run registry tests and full tests**

Run: `node --test test/plugin-registry.test.js` then `node --test`.\
Expected: order, descriptions, lazy-loading, cache, registration, and error-path assertions pass.

- [ ] **Step 5: Commit**

```bash
git add plugin/ai-config.js js/ai-registry.js js/ui.js index.html css/style.css test/plugin-registry.test.js
git commit -m "feat: present AI tiers in one explained list"
```

### Task 3: Validate AI decisions and recover from invalid moves

**Files:**
- Create: `js/ai-decision.js`
- Create: `test/ai-decision.test.js`
- Modify: `index.html`, `js/ui.js`, `css/style.css`

**Interfaces:**

```js
MineAIDecision.resolve(game, player, decision, options)
  -> { action: object|null, invalid: boolean, noMoves: boolean }
```

`options` is `{ enhancedAI, randomIndex }`; `randomIndex(n)` returns an integer in `[0,n)`. AI bomb-disable rules are queried through `game.canBomb(player, {ai:true})` so the engine remains authoritative. The module reads `game.w`, `game.h`, `game.revealed`, and `game.canBomb(player, {ai:true})` only; it must never read `game.mines`.

- [ ] **Step 1: Write failing tests**

Create `test/ai-decision.test.js` with this VM setup and tests:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('js/ai-decision.js', 'utf8'), context);
const resolve = context.window.MineAIDecision?.resolve;
const game = revealed => ({ w: 2, h: 1, revealed: Uint8Array.from(revealed), canBomb: () => true });

test('invalid opens fall back to a random legal unopened cell', () => {
  assert.equal(typeof resolve, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(resolve(game([1, 0]), 'red',
    { type: 'open', x: 0, y: 0 }, { randomIndex: () => 0 }))),
    { action: { type: 'open', x: 1, y: 0 }, invalid: true, noMoves: false });
});

test('no unopened cells do not produce a fallback move', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(resolve(game([1, 1]), 'red', null,
    { randomIndex: () => 0 }))),
    { action: null, invalid: false, noMoves: true });
});
```

Also cover a revealed/out-of-range open, a bomb requested while behind/stock/AI-enable checks fail, a normal coordinate bomb, and a coordinate-free bomb normalized to `{ type: 'bomb-auto' }` only when `enhancedAI` is true and `game.canBomb(player)` is true.

- [ ] **Step 2: Run the decision tests and confirm they fail**

Run: `node --test test/ai-decision.test.js`\
Expected: module/`resolve` not found.

- [ ] **Step 3: Implement pure decision normalization**

Add `window.MineAIDecision.resolve`. Scan only unrevealed cells to build legal random fallbacks. Return `noMoves: true` with no action when no unopened cells exist. Accept an open only for integer, in-range, unrevealed coordinates. Accept a bomb only when `game.canBomb(player, {ai:true})` is true; with enhanced mode, normalize a bomb request to `{type:'bomb-auto'}` without forwarding coordinates; otherwise require in-range integer bomb-center coordinates. Any other action selects a random legal open and sets `invalid: true`.

- [ ] **Step 4: Integrate normalization into `scheduleAI()` and `applyDecision()`**

Load `js/ai-decision.js` before `js/ui.js`. After the scheduled AI returns and the turn is revalidated, call `resolve`. On `invalid`, use a 1.5-second flashing toast reading “AI 走昏招了！”; on `noMoves`, show “对局无处可走” and do not call `applyDecision`. Add a `flash` class to the existing toast and a CSS keyframe that alternates opacity/brightness rapidly during those 1.5 seconds. Route `bomb-auto` to `game.bombBest()`; route coordinate bomb to `game.bomb(x,y,{ai:true})`. Do not open the failed bomb’s requested coordinate as fallback. If an engine action unexpectedly fails, run the same invalid-action fallback once.

- [ ] **Step 5: Run decision tests and full tests**

Run: `node --test test/ai-decision.test.js` then `node --test`.\
Expected: invalid actions get a legal fallback; no-move returns no action; enhanced bombs carry no coordinates.

- [ ] **Step 6: Commit**

```bash
git add js/ai-decision.js test/ai-decision.test.js index.html js/ui.js css/style.css
git commit -m "fix: guard invalid AI actions with legal fallback"
```

### Task 4: Improve strongest AI bomb conservation strategy

**Files:**
- Modify: `plugin/ai-constraint-probability.js`
- Modify: `test/strong-plugin.test.js`

**Interfaces:**
- Preserve registration ID `constraint-probability` and `makeDecision(view)`.
- Use `view.bombs`, `view.canBomb`, `view.score`, `view.oppScore`, `view.mineCount`, and the existing bomb radius/probability inputs; no new map fields.

- [ ] **Step 1: Add failing strategy tests**

Add tests where the AI has no bombs/cannot bomb and must open; where `view(5,1,[-2,-2,-2,-2,-2], {mineCount:3, remainMines:2, bombs:1, canBomb:true, score:0})` predicts a non-winning expected yield and conserves its last bomb; and where a single hidden cell with `mineCount:1`, `score:0`, `remainMines:1`, `bombs:1`, `canBomb:true`, and zero blast radii makes a bomb reach the win line and is selected despite the normal yield threshold. Keep the view fixture free of a `mines` field.

- [ ] **Step 2: Run the strong-AI test and confirm the tactical-win case fails**

Run: `node --test test/strong-plugin.test.js`\
Expected: the new immediate-win/conservation expectation fails before strategy changes.

- [ ] **Step 3: Implement the bounded policy change**

Calculate `winNeed = Math.floor(view.mineCount / 2) + 1`. Keep the existing exact constraint probabilities and expected bomb-yield scan, but return the best candidate with its `expectedMines`, `hiddenCount`, and threshold instead of discarding it before policy evaluation. If `view.bombs === 1`, bomb only when `view.score + expectedMines >= winNeed`; if more than one bomb remains, bomb when that winning condition or the existing expected-yield threshold is met. Otherwise open the minimum-risk cell. Always require `view.canBomb && view.bombs > 0`.

- [ ] **Step 4: Run strong-AI and full tests**

Run: `node --test test/strong-plugin.test.js` then `node --test`.\
Expected: the no-bomb, conserve-bomb, and tactical-win cases all pass.

- [ ] **Step 5: Commit**

```bash
git add plugin/ai-constraint-probability.js test/strong-plugin.test.js
git commit -m "feat: conserve bombs for decisive AI turns"
```

### Task 5: Add bomb controls, enhanced mode, and visible remaining counts

**Files:**
- Modify: `index.html`, `js/ui.js`, `js/core.js`, `css/style.css`
- Modify: `test/bomb-area.test.js`
- Create: `js/game-settings.js`, `test/ai-settings.test.js`

**Interfaces:**
- New-game options: `cfgBombs` in `[0,999]`, default `1`; `cfgDisableAiBomb`; `cfgEnhancedAI`.
- `makeView(p)` calls `game.view(p,{ai:true})`, preserving public `bombs` and enforcing `canBomb:false` for AI when disabled.
- The core also rejects `game.bomb(...,{ai:true})` and `game.bombBest()` when disabled; human `game.canBomb(p)` and `game.bomb(x,y)` remain unaffected.

- [ ] **Step 1: Add failing tests for AI bomb permission and display formatting**

In `test/ai-settings.test.js`, test `normalizeBombCount(value)` at 0, 1, 999, 1000, and non-numeric input; test `normalizeMineCount(value,width,height)` yields an odd in-range number; test `formatBombStatus(999,999)` returns `剩余炸弹 999/999` and `formatBombStatus(0,0)` returns `本局无炸弹`.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test test/ai-settings.test.js`\
Expected: `MineGameSettings` and its normalizers/formatter do not exist yet.

- [ ] **Step 3: Implement setup fields and game integration**

Create `js/game-settings.js` with `normalizeBombCount(value)`, `normalizeMineCount(value,width,height)`, and `formatBombStatus(remaining,total)`; load it before `js/ui.js`. In `index.html`, change the bomb input to `min="0" max="999" value="1"`; add an unchecked “禁用 AI 炸弹” checkbox and an unchecked “增强 AI” checkbox. In `newGame()`, normalize bomb and mine counts with `MineGameSettings`, write the actual normalized values back to the form inputs, pass them and `disableAiBombs` to `new C.Game({ width, height, mineCount, bombCount, disableAiBombs })`, and retain both checkbox values in page-level state. Change the old computer-bomb setting to “禁用 AI 炸弹” semantics, default unchecked. Use `formatBombStatus(game.bombs[p], game.bombMax)` to display remaining counts for both player panels without creating hundreds of icon nodes.

- [ ] **Step 4: Route AI bomb requests and validate all settings**

Ensure `scheduleAI()` passes `{enhancedAI}` to `MineAIDecision.resolve`. For `bomb-auto`, call `game.bombBest()`; otherwise call `game.bomb(d.x,d.y)`. Confirm the core rejects AI bombs when not behind, out of stock, or disabled; human bomb rules remain unaffected. Keep human `btnBomb` governed by `game.canBomb()` only.

- [ ] **Step 5: Run focused bomb/settings tests and full suite**

Run: `node --test test/bomb-area.test.js test/ai-settings.test.js` then `node --test`.\
Expected: counts 0/1/999, AI-only disable, enhanced target, and human bomb permissions pass.

- [ ] **Step 6: Commit**

```bash
git add index.html js/ui.js js/core.js css/style.css test/bomb-area.test.js test/ai-settings.test.js
git commit -m "feat: configure AI bomb limits and enhancement"
```

### Task 6: Lock player cheat/probability tools behind the secret sequence

**Files:**
- Create: `js/key-sequence.js`
- Create: `test/key-sequence.test.js`
- Modify: `index.html`, `js/ui.js`, `css/style.css`

**Interfaces:**
- `MineKeySequence.create(sequence, timeoutMs)` returns `{ push(key, now), isUnlocked() }`; `push` returns true once on first completion, and `isUnlocked()` remains true for that page session.
- Use sequence `keynesy`, timeout `1500` ms, and a global `keydown` listener so it works at any time.

- [ ] **Step 1: Add failing key-sequence tests**

Test exact lowercase and uppercase matching, a wrong character breaking a partial sequence, a gap over 1500 ms resetting the sequence, and a full sequence completing at most once per entry.

- [ ] **Step 2: Run key-sequence tests and confirm they fail**

Run: `node --test test/key-sequence.test.js`\
Expected: module/`create()` not found.

- [ ] **Step 3: Implement the sequence detector**

Maintain a matched-prefix length, last-key time, and unlocked flag. Ignore non-single-character keys and modifier combinations; lowercase each accepted character so uppercase input also works. On each character, reset the prefix if `now - lastKeyAt > timeoutMs`; advance on the next expected letter; on mismatch retain a one-character prefix only if the current letter equals the secret’s first letter. On full match set the unlocked flag, reset the prefix, and return true once; keep `isUnlocked()` true until the gate is recreated on page reload.

- [ ] **Step 4: Integrate locked controls and probability behavior**

Load `js/key-sequence.js` before `js/ui.js`. Create the gate with `MineKeySequence.create('keynesy', 1500)` and hide the cheat and probability controls until `isUnlocked()` is true. The global listener reveals the controls when `push()` first returns true. In the board `contextmenu` listener, always prevent the browser menu; return without changing `hintOn` until unlocked. After unlock, preserve the existing probability-toggle behavior. The cheat button remains user-controlled and unavailable before unlock. On new game reset the active hint/cheat toggles, but retain the gate’s unlocked state until page reload.

- [ ] **Step 5: Test locked/unlocked behavior and full suite**

Assert in `test/key-sequence.test.js` that the gate reports locked before a full match, unlocks after `keynesy`, remains unlocked for the page session, and starts locked when a new gate is created. Verify the UI context-menu handler checks this gate before toggling `hintOn`. Run `node --test test/key-sequence.test.js` then `node --test`.

- [ ] **Step 6: Commit**

```bash
git add js/key-sequence.js test/key-sequence.test.js index.html js/ui.js css/style.css
git commit -m "feat: unlock player hints with secret key sequence"
```

### Task 7: Preserve setup and thinking speed across new games

**Files:**
- Modify: `js/ui.js`, `index.html`

**Interfaces:**
- Persist values in existing DOM controls/page-level state only; no storage API.
- Synchronize `cfgSpeed` and the in-game `rngSpeed` control so either control remains authoritative.

- [ ] **Step 1: Reproduce the failing form-lifecycle regression**

Record a browser smoke sequence: change the manual mine count and AI speed, open/cancel/reopen setup, then start a new game and reopen. It should fail on current code because merely opening settings calls `syncMineField()` and the range speed is not copied back into `cfgSpeed`.

- [ ] **Step 2: Reproduce the settings lifecycle failure before editing**

Run the smoke sequence from Step 1 in the browser and record the overwritten mine count/stale speed. The normalizer tests from Task 5 should already pass; this step verifies the separate form-lifecycle defect.

- [ ] **Step 3: Implement session-only retention**

Remove `syncMineField()` calls from both dialog-open handlers; retain it on width, height, and density input events and once during initial page load. Synchronize `rngSpeed` input to `cfgSpeed` and `speed`, and synchronize dialog speed changes to the range/value display. Do not clear AI selections, bomb options, or speed on `newGame()`; do not write to `localStorage`.

- [ ] **Step 4: Narrow the debug handle and validate UI state**

Remove direct `window.__mine.game` access so plugin scripts do not receive a direct `Game` instance. Keep only debug methods that do not return hidden board state. Update any existing tests/automation references to use public views.

- [ ] **Step 5: Run tests and the setup-retention smoke test**

Run: `node --test test/ai-settings.test.js` then `node --test`. In the browser, record the AI selections, dimensions, density, manual mine count, bomb count, both AI checkboxes, and speed; cancel/reopen the dialog and start a new game; verify the recorded values remain. Then edit width and verify mine count recalculates, edit the sidebar speed and start another game to verify the dialog speed matches, and reload the page to verify defaults return.\
Expected: in-page values remain stable between new games; reloading uses manifest/form defaults; no persistent browser storage is used.

- [ ] **Step 6: Commit**

```bash
git add js/ui.js index.html
git commit -m "fix: preserve game setup across new rounds"
```

### Task 8: Final integration checks and documentation cleanup

**Files:**
- Modify: `index.html`, `css/style.css`, any tests exposed by integration.

- [ ] **Step 1: Update interface help and footer**

Replace the old claim that right-click always shows probability. Document that it requires the secret unlock. Document the unified AI labels, `makeDecision(view)`, public bomb fields, and that enhanced AI bomb requests may omit coordinates while the core selects the maximum-yield area.

- [ ] **Step 2: Run every static and unit check**

Run:

```bash
node --test
node --check js/core.js
node --check js/ai-registry.js
node --check js/ai-decision.js
node --check js/key-sequence.js
node --check js/game-settings.js
node --check js/ui.js
node --check plugin/ai-config.js
node --check plugin/ai-heuristic.js
node --check plugin/ai-global-probability.js
node --check plugin/ai-constraint-probability.js
git diff --check
```

Expected: all tests pass, all scripts parse, and there is no whitespace error.

- [ ] **Step 3: Review the final diff and ensure commits are scoped**

Run `git diff --stat` and `git status --short`; do not stage pre-existing unrelated worktree changes. Confirm `window.__mine` no longer exposes the game, no AI view includes a mines array, no `localStorage` was introduced, and no undo feature was added.

- [ ] **Step 4: Commit final documentation/test integration**

```bash
git add index.html css/style.css test
git commit -m "test: verify unified AI and game settings"
```
