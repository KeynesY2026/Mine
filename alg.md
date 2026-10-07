# Public-Information Bomb Win-Probability Algorithm

**Status:** Reviewed by GPT-6.1 Sol; joint counting and Invincible policy are implemented, development screening and disjoint held-out validation are complete, and the empirically selected `0.5` cutoff is enabled in production config. The evidence and limitations are documented in `docs/superpowers/reports/2026-10-06-joint-bomb-win-probability.md`.  
**Scope:** evaluate whether one legal bomb can immediately reach the AI's winning score, using only information available to the AI. No hidden-map oracle and no change to board, scoring, or bomb geometry.

## 1. Decision target

The game ends when a player's score reaches

```text
winNeed = floor(mineCount / 2) + 1
neededHits = winNeed - currentScore
```

A bomb does **not** need to hit every unclaimed mine. It wins immediately if its blast hits at least `neededHits`; other mines may remain hidden. Connectivity of possible mine cells is irrelevant and must not be used as a special endgame signal.

For each legal hidden bomb center `c`, let `U_c` be the still-hidden cells in its clipped 5×5 blast footprint, and let

```text
H_c = sum(mine[cell] for cell in U_c)
Pwin(c) = P(H_c >= neededHits | public observations)
```

If `neededHits <= 0`, the game is already won. If `neededHits > |U_c|`, then `Pwin(c) = 0` without further counting. The decision policy ranks centers by `Pwin`; the cutoff for calling a probability “high” is a separate policy parameter and must be calibrated, not confused with this probability calculation.

## 2. Public evidence and constraints

The posterior may use only the public AI view:

- board dimensions and each cell's public state;
- revealed clue values, with already revealed mines subtracted from adjacent clue totals;
- total mine count and `remainMines` (unclaimed mines among still-hidden cells);
- current score, bomb availability/legality, and public bomb geometry.

It must not read `Game.mines`, the seed, post-game maps, or any hidden truth. For each revealed clue `j`, create the constraint

```text
sum(x_i for hidden neighbors i of j) = clue_j - revealedMinesAdjacentTo(j)
```

where each hidden-cell variable `x_i` is 0 or 1. Also enforce

```text
sum(x_i for all hidden cells i) = remainMines
```

The legal hidden maps are assignments satisfying all clue constraints and the global remaining-mine total.

## 3. Joint hit-count distribution under the uniform-valid-layout model

The current planner already decomposes clue-frontier cells into independent constraint components and enumerates satisfying assignments. Extend that enumeration for each candidate blast center; do **not** multiply per-cell marginals as if cells were independent.

For each component `j`, candidate center `c`, and satisfying component assignment, count both:

- `m`: mines in the component;
- `b`: those mines that lie in `U_c`.

Accumulate a two-dimensional integer histogram `W_j[m][b]` (number of component assignments with those counts). Combine component histograms with dynamic programming/convolution, tracking total frontier mines and total blast hits. Use `BigInt` counts until the final probability division.

Let there be `F` unconstrained/free hidden cells, of which `f_c` lie in `U_c`. Conditional on `q` mines among all `F` free cells, the number of placements with `h` free-cell hits in the blast is

```text
choose(f_c, h) * choose(F - f_c, q - h)
```

For every combined frontier state with `m` mines and `b` blast hits, use `q = remainMines - m`, multiply by the free-cell placement count above, and add the result to the count for `H_c = b + h`. Summing over all states gives `N_c[k]`, the number of satisfying layouts with exactly `k` hits in this blast.

The denominator is the count of all satisfying layouts under this model:

```text
D = sum_k N_c[k]
P_uniform(H_c = k | public observations) = N_c[k] / D
P_uniform_win(c) = sum_{k >= neededHits} N_c[k] / D
```

The denominator is independent of the center; it may be shared across candidates. A brute-force tiny-board test should verify this DP against direct enumeration.

### Why per-cell marginals are insufficient

`expectedMines(c) = sum(probability(cell is a mine) for cell in U_c)` is a useful, candidate-specific expected yield. Under exact marginals it gives the first moment `E[H_c]`, but it does not determine `P(H_c >= neededHits)`. For example, if a clue says exactly one of two cells is mined, each cell has marginal 0.5, but the probability both are mines is 0—not 0.25.

The removed legacy `estimatedHitCountProbabilities` construction convolved independent Bernoulli marginals. That is only an independence approximation and must not be reintroduced or described as the exact joint blast distribution. The current planner exposes `uniformHitCountProbabilities` only when `analyze(view, { includeJointHitDistributions: true })` is requested; default shared analysis leaves those candidate fields `null` to avoid paying for all-center joint counts when the direct-win policy is inactive.

### Probability-conversion prerequisite (review finding, now fixed)

GPT-6.1 Sol identified a scaling defect in the prior `ratio()` implementation: when numerator and denominator had unequal digit lengths below the 16-digit prefix limit, it applied an extra power of ten. For example, the exact free-cell probability `39732 / 446985 = 4 / 45` was returned as `4 / 450`; `freeMineProbability` and `mineProbabilityAt` disagreed, and marginals summed to less than `remainMines` despite `quality: "exact"`.

This was independently reproduced and fixed in `js/ai-planner.js:265-274` by scaling only digits omitted from each prefix. `test/ai-planner.test.js:79-95` now checks free-cell probabilities and the exact marginal-sum invariant; the test was observed failing before the fix and passing afterward. New joint probabilities must continue to use a correctly scaled conversion.

## 4. Important prior-model limitation

The exact component-counting method above is exact **only if all valid hidden layouts are assigned equal prior probability**. The actual map generator is not uniform: `js/core.js:50-80` places mines iteratively as far apart as possible, breaking distance ties randomly. Therefore label the result `P_uniform` (or otherwise explicitly model-qualified); `quality: "exact"` in the current planner does not mean exact probability under the actual map generator.

The generator-consistent target is

```text
P_gen_win(c) =
  sum_{M consistent with public observations} P_gen(M) * I[H_c(M) >= neededHits]
  --------------------------------------------------------------------------
  sum_{M consistent with public observations} P_gen(M)
```

where `P_gen(M)` is the probability that the existing `makeMap` process produces map `M`. A practical estimator is to sample maps from that exact generator, retain only maps consistent with the current public observations, and estimate the conditional win fraction among retained samples. Report sample count and a confidence interval; if too few matching samples survive, mark the estimate unavailable rather than claiming certainty. This conditional rejection sampler may be too expensive in deep states, so its acceptance rate and calibration must be measured before using it in the live decision path.

## 5. Approximate planner states and safe fallback

The current planner can return `quality: "approximate"` after a search limit or inconsistent/incomplete constraints. In that case, the exact joint-count algorithm above is unavailable and candidate distributions are `null`; the distribution is also `null` during ordinary analysis unless explicitly requested. Do not present a product-of-marginals distribution as exact or authorize the direct-win override without a requested, available exact joint distribution. The physical impossibility shortcut `|U_c| < neededHits => Pwin(c)=0` remains valid. The normal expected-yield/comeback policy may still use its explicitly approximate expectation.

## 6. Bomb policy integration

1. Preserve the engine's existing `canBomb`/inventory legality checks.
2. Remove the planner-level `singlePossibleMineRegion` property and the Invincible strategy branch based on it; no contiguity test is needed.
3. For each legal center, evaluate the joint hit-count distribution and direct-win probability using the defined model/quality.
4. Never select a direct-win bomb when every candidate has `Pwin = 0`; in particular, do not break an all-zero win-probability tie by choosing the largest `expectedMines`.
5. If a candidate meets the separately calibrated high-win-probability policy, it may override the ordinary score-gap heuristic. Otherwise retain the approved non-winning fallback: compare maximum expected blast yield with the comeback deficit, spending only when the expected yield cannot make the comeback and conserving when it can.

A one-point-behind opening regression should use a 15×15, 53-mine public state where `neededHits` exceeds every candidate's maximum blast capacity. It must assert that Invincible does not return a bomb. This directly guards against the observed bug without relying on any region/connectivity API.

## 7. Required validation

- Tiny-board exhaustive oracle: compare every candidate's `N_c[k]` and `Pwin(c)` with direct enumeration of all public-consistent hidden maps.
- Correlation regression: a clue forcing exactly one mine among two cells must produce `P(H=2)=0` for a blast covering both.
- Opening regression: one-point deficit with `neededHits` greater than every blast's hidden-cell count must never trigger the direct-win bomb path.
- Winning-threshold regression: a candidate needs exactly `neededHits` hits to count as a win; one fewer is not a win.
- Boundary geometry: clipped edge/corner blast footprints count only in-bounds hidden cells.
- Approximate-quality regression: do not label a marginal-independence estimate as exact or use it as a guaranteed direct win.
- Calibration: compare model probabilities against held-out maps generated by the actual `makeMap` process; report generator-model mismatch and confidence intervals before selecting a probability cutoff.
