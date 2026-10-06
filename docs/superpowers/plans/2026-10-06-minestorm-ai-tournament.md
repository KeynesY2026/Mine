# MineStorm AI Tournament and Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic whole-game tournament runner, measure the current Invincible AI against Simple and Medium AI on standard boards, and produce auditable evidence for the next strategy-optimization plan.

**Architecture:** Load the real game core, planner, decision guard, and AI implementations in a Node `vm` context with a seeded Web Crypto-compatible random source. Separate game simulation, paired-match statistics, and CLI/report formatting so each layer is testable; do not modify production strategy while establishing the baseline.

**Tech Stack:** Node.js built-ins (`node:vm`, `node:crypto`, `node:test`, `node:fs`); existing browser-global JavaScript modules; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-minestorm-ai-tournament-design.md`

## Global Constraints

- Standard board is `15×15`, `53` mines, `1` bomb per player; `cfgEnhancedAI` is enabled and AI bombs are not disabled.
- Invincible must reach at least `70%` against Simple and `60%` against Medium; each final 95% confidence interval must have a lower bound above `50%`.
- Pair every board seed with both Invincible seat assignments; keep development and validation seed ranges separate.
- AI plugins receive only the public view and shared analysis; preserve the existing authorized `Game.bombBest()` engine-side `bomb-auto` exception without exposing hidden mines to plugins.
- No production AI strategy changes in this plan. The measured baseline and read-only model review determine the separate strategy experiment plan.
- Use only Node built-ins; do not add package dependencies or alter production randomness for benchmark determinism.

---

### Task 1: Create deterministic isolated AI runtimes

**Files:**
- Create: `scripts/ai-tournament-runtime.js`
- Test: `test/ai-tournament.test.js`

**Interfaces:**
- `createSeededCrypto(seed)` returns `{ getRandomValues(typedArray): typedArray }`; every output word is a deterministic 32-bit value and the same seed reproduces the same sequence.
- `createRuntime(seed)` loads `js/core.js`, `js/ai-planner.js`, `js/ai-decision.js`, `plugin/ai-heuristic.js`, `plugin/ai-global-probability.js`, and `plugin/ai-constraint-probability.js` in a fresh VM context, with a minimal `MineAIPlugins.register` collector. It returns `{ core, planner, decisionGuard, decisions }`, where `decisions` maps `heuristic`, `global-probability`, and `constraint-probability` to their actual decision functions.
- The runtime does not expose any function that passes `Game.mines` to a plugin.

- [ ] **Step 1: Add failing deterministic RNG and runtime tests**

In `test/ai-tournament.test.js`, require `createSeededCrypto` and `createRuntime`. Assert two RNGs initialized with seed `12345` fill equal `Uint32Array(8)` values; assert a subsequent fill continues the sequence rather than restarting it. Create two runtimes with the same seed, construct `new core.MineCore.Game({width:7,height:7,mineCount:9,bombCount:1})`, and assert their mine arrays are equal. Assert each of the three decision IDs is callable.

- [ ] **Step 2: Run the new test to verify it fails**

Run: `node --test test/ai-tournament.test.js`
Expected: FAIL because `scripts/ai-tournament-runtime.js` and its exports do not yet exist.

- [ ] **Step 3: Implement the seeded VM runtime**

Implement a deterministic xorshift32 word generator; normalize seed `0` to a fixed nonzero state, fill every element in the supplied typed array, and return that array. Create a VM context with `window`, `crypto`, and the plugin registry. Load the real core, planner, decision guard, and plugins using paths rooted at `process.cwd()`. Resolve Simple and Medium through `core.MineCore.weakDecide` and `core.MineCore.strongDecide`; resolve Invincible from the registry callback for `constraint-probability`. Throw on duplicate or missing registrations.

- [ ] **Step 4: Run deterministic runtime tests**

Run: `node --test test/ai-tournament.test.js`
Expected: same-seed random words and maps match exactly; all three AI functions load; a different seed produces a different random sequence.

- [ ] **Step 5: Commit the isolated runtime**

```bash
git add scripts/ai-tournament-runtime.js test/ai-tournament.test.js
git commit -m "test: add seeded AI tournament runtime"
```

### Task 2: Simulate one complete official-rule match

**Files:**
- Modify: `scripts/ai-tournament-runtime.js`
- Modify: `test/ai-tournament.test.js`

**Interfaces:**
- `runMatch({ seed, invincibleSide, opponentId, width = 15, height = 15, mineCount = 53, bombCount = 1, includeTrace = false, includeHiddenMap = false })` returns `{ seed, invincibleSide, opponentId, winner, scores, scoreMargin, bombsUsed, moveCount, mapHash, trace? }`.
- `mapHash` is computed for evaluator use after board creation and is never included in a plugin view.
- If `includeTrace` is true, each entry records the actor, pre-move public board, public scores and bomb state, decision, resolved action, revealed cells, and resulting scores. If `includeHiddenMap` is true, the hidden map is attached only after game completion.

- [ ] **Step 1: Add failing whole-match and information-boundary tests**

Extend `test/ai-tournament.test.js` with a small-board test that runs the same match twice and compares winner, scores, move count, and map hash. Assert the match ends within `width * height + 1` actions. Add a trace assertion that public snapshots contain no `mines` property and that requesting `includeHiddenMap` adds it only to the completed result, not to recorded plugin inputs.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/ai-tournament.test.js`
Expected: FAIL because `runMatch()` is not implemented.

- [ ] **Step 3: Implement the official-rule decision loop**

Create `MineCore.Game` with the supplied board config. For each turn, materialize an immutable snapshot using `game.view(player,{ai:true})`, compute `planner.MineAIPlanner.analyze(snapshot)`, then build the UI-compatible frozen view containing `width`, `height`, `score`, `oppScore`, `mineCount`, `remainMines`, `bombs`, `canBomb`, `enhancedAI:true`, bomb radii, `turn`, `analysis`, and `cellAt`. No game object, hidden-map array, or evaluator-only hash is passed to the decision function.

Call the selected decision function. Compute the fallback with `planner.MineAIPlanner.chooseFallback(view,analysis,core.MineCore.randInt)`, then call `decisionGuard.resolve(game,player,decision,{fallbackDecision,pluginId,enhancedAI:true})`. Execute `open` or coordinate `bomb` through `Game`; for authorized Invincible `bomb-auto`, call `game.bombBest()`, and on failure execute the validated `fallbackAction` as the UI does. Record a trace entry only from the public view plus observed action result. Treat a thrown plugin error, failed action after fallback, or failure to finish by the move cap as a benchmark error, never as a counted win/loss.

- [ ] **Step 4: Run runtime and whole-match tests**

Run: `node --test test/ai-tournament.test.js`
Expected: deterministic complete matches finish legally, trace does not disclose mines to decisions, and hidden-map data exists only in post-game output when requested.

- [ ] **Step 5: Commit match simulation**

```bash
git add scripts/ai-tournament-runtime.js test/ai-tournament.test.js
git commit -m "feat: simulate complete AI tournament matches"
```

### Task 3: Add paired tournament statistics and confidence intervals

**Files:**
- Create: `scripts/ai-tournament-stats.js`
- Modify: `test/ai-tournament.test.js`

**Interfaces:**
- `runTournament({ opponentId, seedStart, seedCount, width = 15, height = 15, mineCount = 53, bombCount = 1, includeTrace = false, includeHiddenMap = false })` runs two matches per seed, Invincible as blue and red, and returns `{ opponentId, seedStart, seedCount, matches, seedClusters }`.
- Each seed cluster is `{ seed, mapHash, games: [blueSeatResult, redSeatResult] }`; the two games must have identical `mapHash`. Wins/draws/losses, score margin, and bomb use are always reported from Invincible's perspective; `scoreMargin` is Invincible score minus opponent score, and `bombsUsed` counts only Invincible's bombs.
- `summarizeTournament(seedClusters,{bootstrapSeed,bootstrapReplicates=10000})` returns `{ games, wins, draws, losses, winRate, confidence95, averageScoreMargin, bombUseRate, errors }`.
- `summarizeTournament` uses cluster bootstrap: sample `seedClusters` with replacement, calculate each sample's win points (`1` win, `0.5` draw, `0` loss) over both games per cluster, and use the 2.5th and 97.5th percentiles from deterministic bootstrap replicates.

- [ ] **Step 1: Add failing paired-seed and bootstrap tests**

Add tests asserting a one-seed tournament creates exactly two games with opposing Invincible seats and identical map hashes. For statistics, use four synthetic clusters with known win points and assert exact counts, point win rate, average margin, and bomb-use rate. Run bootstrap twice with the same bootstrap seed and assert identical confidence bounds; assert both bounds lie in `[0,1]` and lower is no greater than upper.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/ai-tournament.test.js`
Expected: FAIL because paired tournament and statistics exports are absent.

- [ ] **Step 3: Implement paired runs and cluster bootstrap**

For each numeric seed, construct a fresh runtime with that seed for each seat-swapped game so both games regenerate the same initial map; compare hashes and fail explicitly if they differ. Aggregate only successful games. If a match fails, stop that tournament with a structured incomplete result containing the failed seed/seat, error count, and successful partial games; do not report a win-rate conclusion for an incomplete batch. Implement deterministic bootstrap sampling from the supplied seed, preserving whole seed clusters. Report win rate as mean points per game.

- [ ] **Step 4: Run pairing and statistics tests**

Run: `node --test test/ai-tournament.test.js`
Expected: paired maps match, game counts and summary values are correct, and bootstrap output is reproducible.

- [ ] **Step 5: Commit tournament aggregation**

```bash
git add scripts/ai-tournament-stats.js test/ai-tournament.test.js
git commit -m "feat: add paired AI tournament statistics"
```

### Task 4: Add the tournament CLI and machine-readable reports

**Files:**
- Create: `scripts/ai-tournament.js`
- Modify: `test/ai-tournament.test.js`

**Interfaces:**
- `parseArgs(argv)` accepts `--opponent heuristic|global-probability|both`, `--seed-start N`, `--seed-count N`, `--split dev|validation`, `--trace-dir PATH`, `--include-hidden-map`, `--output PATH`, and `--help`; invalid/missing values throw a user-readable error and exit nonzero. `--include-hidden-map` requires `--trace-dir` and writes hidden maps in a separate post-game JSONL file, never in decision-time trace entries.
- The CLI default is one opponent (`heuristic`), `100` seeds, and split `dev`; the default `dev` seed start is `100000` and the default `validation` seed start is `1000000000`, giving disjoint default ranges. Standard board and bomb defaults remain `15×15`, `53`, and `1`; seed values are constrained to unsigned 32-bit integers to match the seeded RNG.
- `runCli(options)` returns JSON-serializable summaries and optionally writes one JSONL trace file per opponent plus a JSON summary file. `--opponent both` runs separate complete tournaments for both baselines.
- Validation seed range is disjoint from the default development range; explicit `--seed-start` remains supported for reproducibility.

- [ ] **Step 1: Add failing CLI parser tests**

Assert `parseArgs(['--opponent','both','--seed-start','10','--seed-count','20','--split','validation'])` returns the exact normalized options; assert `--seed-count 0`, out-of-range seed, unknown opponent, missing numeric value, unknown flag, and `--include-hidden-map` without `--trace-dir` throw an error. Assert `--help` returns help without launching a game.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/ai-tournament.test.js`
Expected: FAIL because the CLI and parser do not exist.

- [ ] **Step 3: Implement CLI, validation, and output**

Keep argument parsing and `runCli` exported for tests; call `runCli(parseArgs(process.argv.slice(2)))` only when the file is the process entry point. Write public traces as JSONL with one completed game per line; when explicitly requested, write hidden maps to a separate post-game JSONL file. Write aggregate summaries as JSON; default to concise JSON on stdout and do not write artifacts unless a path is supplied. Create output directories explicitly and return nonzero on a simulation error.

- [ ] **Step 4: Run CLI tests and a one-seed smoke match**

Run: `node --test test/ai-tournament.test.js`
Run: `node scripts/ai-tournament.js --opponent heuristic --seed-start 42 --seed-count 1`
Expected: tests pass and CLI reports two seat-swapped games with the same map hash and valid final outcomes.

- [ ] **Step 5: Commit the CLI**

```bash
git add scripts/ai-tournament.js test/ai-tournament.test.js
git commit -m "feat: add AI tournament command line"
```

### Task 5: Validate baseline tooling and produce the strategy-review packet

**Files:**
- Create: `docs/superpowers/reports/2026-10-06-minestorm-ai-baseline.md`
- No production strategy files are modified in this task.

**Interfaces:**
- The report contains tool commit, exact command/config, seed ranges, pair/game counts, per-opponent wins/draws/losses, win rate, 95% cluster-bootstrap interval, score margin, bomb-use rate, wall time, errors, and a short interpretation.
- Full baseline raw traces are not required; summary JSON covers every seed cluster. Bounded representative loss traces and their separately saved post-game maps remain outside the repository, and the report records their exact paths and seed IDs so a reviewer can reproduce them.
- The strategy-review packet contains aggregate statistics plus representative loss traces from development seeds only. It is read-only input for independent model analysis.

- [ ] **Step 1: Run all unit tests**

Run: `node --test test/*.test.js`
Expected: all existing and new tests pass; no production AI policy changes are present.

- [ ] **Step 2: Measure simulator throughput**

Run: `node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 10`.
Record wall time and verify both opponents get ten paired seeds. Use the observed throughput to choose a practical batch size that yields at least `1000` seed clusters per opponent for the initial formal baseline; if that run is operationally excessive, increase in documented batches while reporting uncertainty.

- [ ] **Step 3: Run and save the development baseline**

Run the standard settings for both opponents over disjoint development seeds starting at `100000`, with at least `1000` clusters each, initially without full traces. Save summary JSON outside the repository. From completed losses, select up to ten representative seed clusters per opponent, then rerun only those seeds with public JSONL traces and separately saved post-game hidden maps for model review. Verify every baseline cluster has two matching map hashes, both seats appear equally often, and the error count is zero. If the sample does not establish whether each win rate is significantly above `50%`, increase the seed count before drawing a conclusion.

- [ ] **Step 4: Write the baseline report**

Create `docs/superpowers/reports/2026-10-06-minestorm-ai-baseline.md` with the exact commands, actual seed counts, performance, per-opponent metrics, confidence intervals, and reproducibility data. Categorize observed losses (including risky opens, missed certain mines, bomb timing, and failure to convert expected score into a win). Clearly state whether the `70%` and `60%` point thresholds are met and whether both lower confidence bounds exceed `50%`.

- [ ] **Step 5: Obtain read-only model review of baseline losses**

Prepare a bounded packet from development-seed traces: summary tables, repeated loss patterns, and representative complete losses with post-game map separated from decision-time public observations. Ask an independent large model to identify plausible root causes and rank falsifiable strategy hypotheses; explicitly prohibit it from treating post-game hidden mines as information the live AI could use. Add its findings to the report as hypotheses, not established facts.

- [ ] **Step 6: Run source/test audit and commit the report**

Run: `git diff --check` and `node --test test/*.test.js`.
Expected: no whitespace errors; the complete test suite passes.

```bash
git add docs/superpowers/reports/2026-10-06-minestorm-ai-baseline.md
git commit -m "docs: record AI tournament baseline"
```

**Handoff after Task 5:** Do not make a speculative policy change in this plan. Use the baseline and independent review to define a separate strategy-experiment plan with one falsifiable hypothesis per iteration. The first hypothesis must revisit the requested bomb policy: replace a fixed deficit-only gate with bomb-yield/comeback reasoning, and allow a last bomb that has high probability of winning to bypass ordinary use restrictions. Current `analysis.bombCenters[].expectedMines` is expected yield, not win probability; any actual win-probability criterion must be independently defined and tested rather than inferred from expectation alone.
