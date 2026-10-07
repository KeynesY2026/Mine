# Joint Public Bomb-Win Probability: Development and Validation

**Status:** Implemented and enabled for Invincible at threshold `0.5`. The development cutoff was selected before held-out evaluation. Both paired held-out opponents improved; the evidence is limited to this simulator configuration and seed split.

## Policy

For each legal bomb center, the Planner computes the joint distribution of the number of hidden mines in the clipped blast footprint under uniformly weighted layouts consistent with the public clues and global mine count. If `K = floor(mineCount / 2) + 1 - score`, the direct-win estimate is `P_uniform(H >= K)`. The `uniformHitCountProbabilities` distribution is assembled from joint `(component mine count, blast-hit count)` histograms and the remaining free-cell hypergeometric combinations; per-cell marginals are not treated as independent. Approximate analysis does not expose an exact direct-win distribution.

Invincible first checks that engine-provided `canBomb` is true and inventory is available. If the maximum candidate direct-win probability reaches the configured threshold, it bombs the highest-probability center, regardless of the ordinary comeback heuristic. Otherwise, it spends the bomb when the best expected yield is below the score deficit and conserves it when expected yield can meet or exceed the deficit. The direct-win exception does not bypass core legality: the engine still only allows bombing while trailing, while the game is active, with inventory, and when AI bombs are enabled. An omitted runtime or CLI threshold inherits production configuration (`0.5`); explicit `null` / CLI `off` disables the override for controls.

The old shared `singlePossibleMineRegion` property and the independent-marginal hit-count estimate were removed. UI and tournament runtime request joint distributions only when Invincible can legally bomb and has inventory.

## Model limitation

`P_uniform` is exact only under a uniform distribution over public-consistent layouts. MineStorm's actual `makeMap` places mines iteratively using farthest-apart choices, so that generator does not induce this uniform prior. Forecasts are therefore explicitly model-qualified and are not guarantees of actual win probability. The held-out calibration below measures forecasts on selected bomb actions only; it does not establish a general posterior calibration law.

## Cutoff selection

Development screening compared `off`, `0.5`, `0.75`, `0.9`, and `1.0` on seeds `100000–100099`, for Simple and Medium, both Invincible seats. Paired bootstrap intervals resampled seed clusters with 20,000 deterministic replicates. The predeclared rule selected the candidate with highest equal-weight mean paired win-point delta across the two opponents, then margin, then higher cutoff. `selected-threshold.txt` was written as `0.5` before validation began; full development results are in `dev-selection.json`.

| Cutoff | Equal-weight mean paired win-point delta | Equal-weight mean paired score-margin delta |
| ---: | ---: | ---: |
| 0.5 | +0.0325 | +0.1275 |
| 0.75 | +0.0250 | +0.0800 |
| 0.9 | +0.0200 | +0.0600 |
| 1.0 | +0.0175 | +0.0475 |

At the selected `0.5` cutoff, development paired win-point delta was `+0.010` vs Simple (95% CI `−0.010,+0.030`) and `+0.055` vs Medium (`+0.025,+0.085`). The development Simple interval includes zero; the disjoint validation below is the adoption check.

## Held-out paired validation

Validation used disjoint seeds `1000000000–1000000999`: 1,000 paired seed clusters per opponent, with both Invincible seats (2,000 games per opponent and treatment). Control used explicit `off`; treatment used `0.5`. Seed sets, map hashes and seat pairing matched. Paired 95% percentile intervals use 20,000 cluster-bootstrap replicates (`bootstrapSeed: 20261006`); the equal-opponent combined analysis averages both opponents within each shared seed before resampling (`bootstrapSeed: 20261010`).

| Opponent | Win rate, off → 0.5 | Paired win-point delta (95% CI) | Mean score margin, off → 0.5; paired delta (95% CI) | Invincible bombs used / games | Direct overrides / override wins |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simple (`heuristic`) | 60.4% → 62.5% | +2.10 pp (+1.45,+2.80) | 2.7445 → 2.8455; +0.101 (+0.0695,+0.134) | 919/2000 (45.95%) | 79 / 54 |
| Medium (`global-probability`) | 71.0% → 73.6% | +2.60 pp (+1.90,+3.35) | 5.656 → 5.777; +0.121 (+0.090,+0.155) | 562/2000 (28.10%) | 88 / 58 |

Across equal-weight opponents, paired win-point delta was `+0.0235` (95% CI `+0.0185,+0.0285`) and score-margin delta was `+0.111` (`+0.08825,+0.13425`). Both opponent-specific intervals and the combined interval are positive, satisfying the adoption rule. No opponent regressed on point estimate.

### Forecast calibration on selected bomb actions

These diagnostics include only Invincible bomb actions for which an exact public forecast was recorded. `Observed` is the fraction of those bombs that actually reached the win line after resolution.

| Opponent | Forecast count | Mean `P_uniform` | Observed direct-win rate | Brier score |
| --- | ---: | ---: | ---: | ---: |
| Simple | 875 | 0.06401 | 0.06171 | 0.01601 |
| Medium | 554 | 0.11885 | 0.10650 | 0.02721 |

| Opponent | `P < .1` mean / observed (n) | `.1 ≤ P < .5` mean / observed (n) | `.5 ≤ P < .75` mean / observed (n) | `.75 ≤ P < .9` mean / observed (n) | `.9 ≤ P ≤ 1` mean / observed (n) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simple | 0.00133 / 0% (791) | 0.11552 / 0% (5) | 0.59015 / 56.90% (58) | 0.84077 / 100% (5) | 0.99632 / 100% (16) |
| Medium | 0.00275 / 0% (455) | 0.13720 / 9.09% (11) | 0.57820 / 46.15% (52) | 0.79657 / 85.71% (14) | 0.99385 / 100% (22) |

High-forecast observations are encouraging but small and action-selected (16 and 22 samples at `P_uniform ≥ .9`). Do not interpret these bins as calibration over arbitrary game states or as a generator posterior.

## Runtime and tests

On an 84-move seeded game, requesting joint distributions without gating took 962.16 ms total (948.56 ms in Planner, 84 requests). With cutoff `off`, gating made zero joint requests and took 59.20 ms total (46.00 ms in Planner). At cutoff `.75`, five states requested joint analysis; the game took 116.88 ms total (106.71 ms in Planner). A standard 15×15/53-mine opening fixture with a revealed clue had 223 hidden cells and candidate centers; the exact pass took 19.353 ms and returned direct-win probability zero when the 27-point win line exceeded the 25-cell maximum blast size. These are local measurements, not browser performance guarantees; Planner does not expose a search-node counter.

`node --test test/*.test.js`: 108 tests passed, 0 failed. Coverage includes joint-distribution brute-force oracles, correlated clues, free-cell/global-total combinations, approximate-quality behavior, public hidden-map invariance, opening zero-win conservation, certain direct wins, threshold selection, pairing, calibration, CLI inheritance and UI contract. Standard setup is 15×15, 53 mines, one bomb per player. The win line is 27 points.

## Artifacts and reproduction

Tournament outputs were retained outside the repository under `C:/Users/keyn1/AppData/Local/Temp/minestorm-joint-bomb-probability/`:

- `dev-selection.json`, `selected-threshold.txt` — development comparison and frozen cutoff.
- `validation-comparison.json`, `validation-combined.json` — held-out paired effects and calibration.
- `validation-off/`, `validation-selected/` — chunked treatment/control reports.

The comparator validates complete seed clusters, both seats, matching seed sets and map hashes before calculating paired cluster bootstrap intervals. The baseline report at `2026-10-06-minestorm-ai-baseline.md` summarizes the current result and retains prior experiments as history.