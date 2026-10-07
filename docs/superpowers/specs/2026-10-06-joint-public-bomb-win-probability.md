# Joint Public Bomb Win Probability

## Status

This specification supersedes `docs/superpowers/specs/2026-10-06-public-only-bomb-policy-design.md`. The user rejected `singlePossibleMineRegion` as a shared Planner API and directed that bomb decisions be based on whether a blast can reach the winning score, not on connectedness. The algorithm details are in root `alg.md`. Joint counting, policy integration, paired tournament support, development screening, and held-out validation are complete. Cutoff `0.5` was selected before validation, passed the predeclared paired-outcome criteria against both opponents, and is now the production config. See `docs/superpowers/reports/2026-10-06-joint-bomb-win-probability.md` for results and limitations.

## Goal

Give Invincible an evidence-based public estimate of the chance that each legal bomb reaches the win line, remove region-connectivity heuristics, and use a separately tournament-calibrated cutoff for direct-win overrides.

## Constraints

- No new dependencies; preserve browser JavaScript and Node built-in tests.
- Use only the public AI view for decision-making; never inspect hidden mines, seeds, or post-action data before selecting a coordinate.
- Preserve `Game.canBomb` legality, `Game.bomb(x, y)` resolution, the 5×5 blast geometry, score rules, and human bomb behavior.
- Preserve exact/approximate analysis distinctions. `quality: "exact"` means exact counting under the uniform-valid-layout model only; it is not an exact posterior for the real map generator.
- Keep the one-point-behind 15×15/53-mine opening regression: `neededHits = 27` exceeds the 25-cell maximum blast, so direct-win probability is zero and the high-win override must not fire.

## Probability model and Planner output

For current score `s`, mine count `M`, and win line `floor(M / 2) + 1`:

```text
neededHits = floor(M / 2) + 1 - s
```

For each hidden legal bomb center `c`, let `U_c` be the hidden cells in its board-clipped 5×5 blast and `H_c` the number of mines in those cells. Compute the full joint distribution over layouts satisfying every public clue and `remainMines`, with equal weight for each satisfying layout:

```text
uniformHitCountProbabilities[k] = P_uniform(H_c = k | public observations)
P_uniform_win(c) = sum(uniformHitCountProbabilities[k], k >= neededHits)
```

Planner contract:

- Each `analysis.bombCenters` candidate retains `x`, `y`, `hiddenCount`, and `expectedMines`.
- Add frozen `uniformHitCountProbabilities`, an array of numeric probabilities only when `analysis.quality === "exact"` and joint counts are requested; otherwise use `null` (including approximate analysis).
- The opt-in call is `analyze(view, { includeJointHitDistributions: true })`; default shared analysis skips joint counts. The UI and tournament runtime request them only for a legal Invincible bomb decision with inventory and a configured cutoff.
- `expectedMines` is the first moment of the exact hit-count distribution when available. It remains an expected score yield, not a win probability.
- Remove `analysis.singlePossibleMineRegion` and `estimatedHitCountProbabilities`; the latter is an independence approximation and must not be mistaken for a joint posterior.
- The exact distribution combines per-constraint-component `(totalMines, blastMines)` histograms with BigInt counts, global `remainMines`, and hypergeometric combinations for free cells. Boards with no clue constraints use the direct hypergeometric distribution.
- A candidate with `neededHits > hiddenCount` has direct-win probability zero. Approximate analysis cannot authorize the high-win override.

## Invincible decision policy

1. Check `view.canBomb`, inventory, and existence of hidden candidate centers first. Do not override engine legality.
2. Use the effective `bombWinProbabilityThreshold` only if it is a finite number in `(0, 1]`. An explicit `null`/CLI `off` disables the direct-win override for controls; an omitted runtime/CLI value inherits the production config. A zero cutoff is invalid because it would treat `Pwin = 0` as qualifying.
3. Among exact candidates with `P_uniform_win >= threshold`, choose the highest win probability; break ties by `expectedMines`; return that concrete `{ type: "bomb", x, y }` regardless of score deficit or expected-yield conservation.
4. If no candidate meets the cutoff, use the established comeback fallback: if the maximum `expectedMines` is below `oppScore - score`, spend on the highest-yield center; otherwise conserve the bomb and continue with the existing open policy. An all-zero direct-win probability must never win a direct-win tie by expected yield.
5. Keep all region/connectivity labels out of shared planner analysis and the plugin decision.

The production cutoff was not assumed to be 50%. Development screening compared `0.5`, `0.75`, `0.9`, and `1.0` against a disabled-override control on seeds `100000–100099`; cutoff `0.5` had the highest equal-weight mean paired win-point gain (+0.0325 across Simple and Medium). It was frozen before the disjoint `1000000000–1000000999` validation, where the paired win-point effects and 95% cluster-bootstrap intervals were positive against both opponents and under the equal-opponent combined analysis. The production configuration is now `0.5`; full results, bomb usage, calibration bins, and model limitations are in the linked report.

## Prior-model limitation

`P_uniform` is exact under equal weighting of public-consistent layouts, not necessarily under `js/core.js`'s iterative farthest-placement map generator. Preserve that qualification in code names, reports, and UI-facing descriptions. Use the paired tournaments and traced realized bomb outcomes to evaluate strategic value and calibration. Do not silently call the uniform posterior the generator's true probability.

## Required tests and evidence

- Exhaustive tiny-board oracle compares every candidate's hit-count distribution with direct enumeration of all public-consistent layouts.
- Correlation case: if a clue forces exactly one mine among two cells and a blast covers both, distribution is `[0, 1, 0]`, not a product-of-marginals result.
- Free-cell/global-total and clipped edge/corner cases match the oracle; each exact distribution sums to one and its mean matches `expectedMines` within numeric tolerance.
- Approximate/search-limit analysis and exact analysis without `includeJointHitDistributions: true` set the joint distribution to `null` and never trigger the direct-win override.
- One fewer than `neededHits` does not win; exactly `neededHits` does.
- The 15×15/53-mine one-point-behind opening case never bombs through the direct-win override.
- Different hidden maps with identical public views yield identical joint distributions and actions.
- Threshold configuration is validated and recorded in tournament output; each seed is paired across blue/red Invincible seats with identical map hashes.
- Completed on the standard 15×15/53-mine/one-bomb setup: 100 development seed clusters per threshold/opponent and 1,000 held-out validation clusters each for disabled control and selected `0.5`; chunked artifacts and pairing checks are retained outside the repository.
