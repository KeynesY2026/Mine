# MineStorm AI development baseline

**Status:** The strict baseline and corrected paired final-bomb direct-win experiment below are historical. The unified public-only coordinate-bomb treatment is documented first. All new treatment matches passed strict decision validation, pairing checks, and the bounded replay audit. Public hit-count and win estimates are approximate, not win guarantees.

## Unified public-only coordinate-bomb policy (paired follow-up)

The engine-side hidden selector and `bomb-auto` route have been removed. Invincible now commits to a concrete hidden-cell coordinate selected only from the shared public analysis and public score state. When the exact analysis identifies a single possible mine region, it ranks candidate blasts by the public marginal estimate of reaching the win line. Otherwise it chooses the highest public expected-yield blast only when that expected yield is below the current score gap, and conserves the bomb when the expected yield could meet or exceed that gap. `cfgDisableAiBombs`, engine legality, and ordinary `Game.bomb(x, y)` resolution remain in force. Probability-derived hit-count and win estimates are approximate and are not actual-win guarantees; actual hits are resolved only after the coordinate is chosen.

### Method and pairing

- Runtime: Node.js `v24.14.0`; configuration `15×15`, `53` mines, `1` bomb per player; both seats and both opponents (`heuristic`, `global-probability`); seeds `100000–100999` inclusive (`1000` paired map clusters per opponent, `2000` games per opponent).
- The pre-treatment comparator is the corrected direct-win artifact `C:\Users\keyn1\AppData\Local\Temp\minestorm-ai-baseline-Kk2vfn\direct-win-1000-post-certain-fix.json`. The range/configuration and map hashes were verified against it, including blue-then-red seat order: `1000/1000` matching hashes and seats for each opponent.
- To avoid the timeout of one monolithic run, the treatment was run in distinct bounded seed chunks (first 25 seeds; then nine 100-seed chunks; then 75 seeds). All `1000` clusters were aggregated only after every chunk completed. Chunk wall times totalled `646.971 s` (`10m46.971s`); there were no incomplete tournaments, invalid decisions, or errors.
- Treatment outputs and the separate chunk JSON/stdout files are under `C:\Users\keyn1\AppData\Local\Temp\public-only-bomb-policy\`. Aggregated results are `public-only-1000.json` and `public-only-1000.stdout.json`; pairing and bootstrap calculations are in `paired-analysis.json`. The analysis script is `aggregate-public-only.js`.

### Results

The ordinary tournament intervals below are game-level normal 95% intervals computed separately for each tournament while treating its `2000` games as independent. They describe each tournament and are not used as treatment-effect intervals. Paired deltas instead use `20,000` deterministic bootstrap replicates resampling the `1000` matched seed clusters, retaining both seat-swapped games together. Paired bootstrap seeds are recorded with the results.

| Opponent | Direct-win comparator wins / rate; independent 95% CI | Public-only wins / rate; independent 95% CI | Paired win-rate delta; 95% paired-cluster CI | Mean margin comparator → treatment; paired delta 95% CI | Invincible bomb use | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple (`heuristic`) | 1226/2000 (61.30%; 59.16–63.44%) | 1248/2000 (62.40%; 60.28–64.52%) | +1.10 pp (−1.90 to +4.10 pp); seed `20261012` | +2.159 → +2.739; +0.580 (95% CI +0.168 to +0.982); seed `20261014` | 1892/2000 games (94.60%) | 0 |
| Medium (`global-probability`) | 1458/2000 (72.90%; 70.95–74.85%) | 1526/2000 (76.30%; 74.44–78.16%) | +3.40 pp (95% CI +0.90 to +5.90 pp); seed `20261013` | +4.905 → +6.3255; +1.4205 (95% CI +1.066 to +1.779); seed `20261015` | 1423/2000 games (71.15%) | 0 |

Win-rate cluster outcomes improved/tied/worsened were `313/395/292` (Simple) and `262/529/209` (Medium). Score-margin clusters improved/tied/worsened were `528/24/448` (Simple) and `534/126/340` (Medium). The Simple paired win-rate CI includes zero; the Medium paired win-rate and both paired score-margin intervals are above zero. The independent tournament intervals must not be mistaken for paired CIs on those deltas.

### Bomb replay and trace audit

Ten bomb-using clusters per opponent were replayed (seeds `100000–100009` for each; both seats, `20` games per opponent). Public action traces and post-game hidden maps are stored separately under `C:\Users\keyn1\AppData\Local\Temp\public-only-bomb-policy\replays\`; the audit is `replay-audit.json`, and `audit-replays.js` reproduces the checks. Across the selected replays there were `39` bomb actions total for Simple (19 by Invincible, 20 by the opponent) and `15` for Medium (15 by Invincible, none by the opponent). The audit checked `1786` (Simple) and `2018` (Medium) public trace entries. Every bomb was a legal concrete coordinate matching the recorded decision and executed action; the recorded map hash matched the separately stored 225-cell/53-mine hidden map, and recomputed blast hit counts matched the score change. No trace exposed the hidden map.

### Limitations

These paired results evaluate this seed range and the specified opponent/runtime configuration only; they do not establish general strategy optimality. The single-region win estimates derive from public marginal hit-count probabilities and remain approximate. Independent game-level intervals assume independent games despite seat-swapped shared maps; treatment deltas should be interpreted using the paired seed-cluster intervals instead. Previous baseline and direct-win-only results and conclusions below remain historical, not results for this unified policy.

## Run identity and protocol

- Tournament tooling commit: `8c441b712a8b1b590e749cebbab9376d87eb25d3` (`feat: add AI tournament command line`). Strict invalid-decision validation and regression test: `c44d904` (`fix: reject invalid tournament decisions`). Direct-win exception: `e709774`; exact-analysis bypass correction: `47dae46`. Tasks 1–4 are present in the committed history: seeded runtime `62f8df7`, match simulator `856c6e8`, paired statistics `3997c19`, and CLI `8c441b7`.
- Runtime: Node.js `v24.14.0`.
- Standard configuration: `15×15`, `53` mines, `1` bomb per player, enhanced AI enabled; AI bombs were not disabled.
- Split/range: development seeds `100000–100999`, inclusive; `1000` seed clusters per opponent. Every cluster ran Invincible as blue and red, for `2000` games per opponent and `4000` baseline games total. The validation split was not used.
- The baseline used no full-match traces. Each per-batch and consolidated JSON includes all seed clusters, paired game outcomes, scores, move counts, and map hashes. Artifacts are outside the repository under `C:\Users\keyn1\AppData\Local\Temp\minestorm-ai-baseline-Kk2vfn\`.

### Commands and runtime

Full tests and runtime version:

```sh
node --version && node --test test/*.test.js
```

Baseline validation result: Node `v24.14.0`; all `101` tests passed after strict invalid-decision validation. The initial direct-win override passed `104` tests; after adding the exact-certain-mine bypass regression and correction, `node --test test/*.test.js` passed all `105` tests.

Task 4 smoke match:

```sh
node scripts/ai-tournament.js --opponent heuristic --seed-start 42 --seed-count 1
```

Result: two seat-swapped games, zero errors under strict decision validation, same map hash; Invincible lost both games on this one-seed smoke check. This was a CLI smoke check, not part of the formal baseline.

Throughput probe (wall time `9.09 s`; ten paired seed clusters per opponent):

```sh
time node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 10 --output 'C:/Users/keyn1/AppData/Local/Temp/minestorm-ai-baseline-Kk2vfn/throughput-probe-summary.json' > 'C:/Users/keyn1/AppData/Local/Temp/minestorm-ai-baseline-Kk2vfn/throughput-probe.stdout.json'
```

The verified formal baseline rerun used strict decision validation across the complete development range in one command:

```sh
node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 1000 --output 'C:/Users/keyn1/AppData/Local/Temp/mine27b-baseline-1000.json'
```

Both opponent runs completed without an invalid-decision exception or incomplete result. The full seed-cluster output is `C:\Users\keyn1\AppData\Local\Temp\mine27b-baseline-1000.json`; an audit confirmed exactly `1000` clusters and `2000` games per opponent, balanced seats, identical paired map hashes, and `errors: 0`. The strict rerun wall time was not separately captured. The earlier `1043 s` measurement belongs to the superseded pre-validation run and is not reported as the strict run's timing.

## Baseline results

All win/draw/loss counts and score margins are from Invincible's perspective. Confidence intervals are deterministic 95% cluster-bootstrap percentile intervals, resampling whole paired seed clusters (not individual games).

| Opponent | Clusters | Games | Wins | Draws | Losses | Win rate | 95% cluster-bootstrap CI | Avg. score margin | Bomb-use rate | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple (`heuristic`) | 1000 | 2000 | 1136 | 0 | 864 | 56.80% | 54.65%–58.95% | +2.049 | 0/2000 (0%) | 0 |
| Medium (`global-probability`) | 1000 | 2000 | 1366 | 0 | 634 | 68.30% | 66.30%–70.35% | +4.757 | 0/2000 (0%) | 0 |

**Decision-validity audit (resolved):** The independent review found that `js/ai-decision.js` marks invalid actions and supplies legal fallbacks, but the tournament runtime did not reject `resolved.invalid`. Commit `c44d904` adds that rejection before any fallback can be executed and adds a regression test. Under this strict runtime, an invalid decision throws and the tournament returns an incomplete result rather than a win-rate conclusion. The full rerun completed for both opponents with `errors: 0`, so all counted games passed the invalid-action guard.

**Thresholds:** Simple's `70%` point target was not met (`56.80%`). Medium's `60%` point target was met (`68.30%`). Both lower 95% confidence bounds exceed `50%` (`54.65%` and `66.30%`) under strict decision validation.

**Pairing/error audit:** Each opponent has exactly `1000` blue-seat and `1000` red-seat games. All `1000/1000` paired clusters per opponent have identical map hashes across the two seat assignments. The strict run completed with no draws and `errors: 0`; because `runMatch` now throws on `resolved.invalid === true`, these are verified completed games rather than silently accepted fallbacks. The JSON audit command checked all `2000` clusters across both opponents for sequence, seat balance, and map-hash pairing.

## Loss patterns and bounded trace review packet

Loss totals below come from all baseline game summaries. Deficit bins are the absolute final score margin in Invincible-losing games. “Scored at least 20/24” is a descriptive final-score category; it is not by itself proof of a decision error or causal root cause.

| Opponent | Losing clusters (≥1 loss) | Losing games | 1-point deficit | 2–3 point deficit | 4–7 point deficit | 8+ point deficit | Losses with Invincible ≥20 points | Losses with Invincible ≥24 points |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple | 673 | 864 | 102 | 299 | 303 | 160 | 704 | 401 |
| Medium | 534 | 634 | 85 | 259 | 191 | 99 | 535 | 344 |

The `≥24`-point losses are close-out losses: Invincible collected substantial score but did not reach the winning threshold before the opponent. They account for `401/864` Simple losses and `344/634` Medium losses. This is an observed outcome category, not evidence that expected score was miscomputed.

Ten losing clusters per opponent were selected at evenly spaced ranks among that opponent's losing seeds; every selected cluster includes at least one Invincible loss. Each selected seed was rerun only for that opponent, in both Invincible seats. Seed IDs:

- Simple: `100000, 100126, 100240, 100342, 100459, 100565, 100677, 100783, 100890, 100999`.
- Medium: `100001, 100115, 100244, 100358, 100467, 100561, 100684, 100793, 100888, 100999`.

For each selected seed, `loss-replays/<opponent>/seed-<seed>/<opponent>.jsonl` contains the two public match traces and `<opponent>-hidden-maps.jsonl` contains the two post-game hidden maps separately. Per-seed summary JSON and concise stdout are saved beside them. The exact twenty replay CLI invocations are recorded in `C:\Users\keyn1\AppData\Local\Temp\minestorm-ai-baseline-Kk2vfn\replay-commands.txt`; the original audit is `loss-replay-audit.json` and the strict rerun audit is `strict-replay-audit.json` in the same artifact root.

After strict validation was added, all `40` selected replay games (20 per opponent) completed and matched the full rerun's winners, scores, move count, score margin, and map hash. All `20` separately stored maps per opponent contain exactly `53` mines and the two seat maps for each seed are identical. The strict audit checked `2445` public trace entries for Simple and `2637` for Medium; no decision-time view contained `mines`, `hiddenMap`, or `mapHash`, and the public trace files did not include hidden maps. The simulator records hidden maps only after a match finishes and the CLI writes them to separate post-game files.

Descriptive tactical checks reconstructed the real planner analysis solely from the selected traces' public cells:

- **Risky opens:** selected Simple replays had `341` Invincible mine hits on non-certain opens with nonzero public posterior probability across `1274` Invincible open actions; selected Medium replays had `365/1316`. These are observed risk-taking outcomes in a bounded loss packet, not proof those choices were avoidable.
- **Missed certain mines:** `0` misses among `153` Simple and `113` Medium Invincible turns where the exact public analysis exposed at least one certain mine. This is limited to the selected replays.
- **Bomb timing:** no Invincible bombs were used in the full baseline (`0/4000` games). In the selected traces, Invincible had `canBomb` on `559` Simple and `388` Medium turns, but none also met both the current deficit threshold (`≥4`) and bomb-coverage threshold (`≥2/3`). The packet therefore does not provide an observed bomb-use/timing example; it cannot establish whether an alternate bomb policy would improve results.
- **Score conversion / close-out:** the loss counts above show frequent losses after scoring at least `20` and, more specifically, at least `24`. Review these as endgame opportunities to investigate, not established causes.

## Paired final-bomb direct-win experiment (corrected)

The narrow policy allows the last bomb to bypass the usual deficit, coverage, and expected-yield gates only when public blast capacity could physically reach the win line. It requests `Game.bombBest({ immediateWinOnly: true })`, which checks actual engine state and spends the bomb only if the blast reaches the win line; otherwise the plugin takes its legal open fallback. `hiddenCount` is only a necessary physical-capacity check, not an estimated win probability.

**Important correction:** The first treatment version (`e709774`) checked the direct-win exception only after an early return for exact analyses with certain mines. That meant some winning-bomb states still opened a certain mine. A regression test reproduced this (`actual 'open', expected 'bomb-auto'`). Commit `47dae46` moves the same public-capacity check onto that early-return path while retaining the certain mine as fallback. The earlier treatment metrics from `e709774` are superseded below; they are not results for the corrected final policy.

The corrected treatment used `47dae46` on the same `100000–100999` seeds, both seat assignments, and identical maps as baseline. The command completed in `9m31.987s`:

```sh
time node scripts/ai-tournament.js --opponent both --seed-start 100000 --seed-count 1000 --output 'C:/Users/keyn1/AppData/Local/Temp/minestorm-ai-baseline-Kk2vfn/direct-win-1000-post-certain-fix.json' > 'C:/Users/keyn1/AppData/Local/Temp/minestorm-ai-baseline-Kk2vfn/direct-win-1000-post-certain-fix.stdout.json'
```

| Opponent | Baseline wins / rate | Corrected treatment wins / rate | Treatment 95% cluster CI | Paired win-rate change (95% paired-cluster bootstrap CI) | Average margin: baseline → treatment | Paired margin change (95% CI) | Bomb-using games | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple (`heuristic`) | 1136/2000 (56.80%) | 1226/2000 (61.30%) | 59.15%–63.40% | +4.50 pp (+1.50 to +7.35 pp) | +2.049 → +2.159 | +0.110 (−0.285 to +0.503) | 136/2000 | 0 |
| Medium (`global-probability`) | 1366/2000 (68.30%) | 1458/2000 (72.90%) | 70.85%–74.85% | +4.60 pp (+2.25 to +6.95 pp) | +4.757 → +4.905 | +0.148 (−0.163 to +0.456) | 131/2000 | 0 |

Paired bootstrap resampled the `1000` matched seed clusters, keeping the two seat-swapped games together, for `20000` replicates. Win-rate delta seeds were `20261008` (Simple) and `20261009` (Medium); margin-delta seeds were `20261010` and `20261011`. Simple clusters improved/worsened/tied `331/257/412`; Medium `266/192/542`. Treatment maps and seat assignments matched the strict baseline in all `1000/1000` clusters per opponent. Both win-rate difference intervals are above zero; paired score-margin intervals cross zero. This supports the corrected direct-win-only rule on this seed range, not the separate broad “spend the last bomb even when it is unlikely to recover the deficit” policy.

The corrected bounded audit reran ten treatment clusters per opponent where at least one bomb was used, both seats, with public traces and separate postgame hidden maps. In those `20` games per opponent there were `10` actual winning bombs each; every actual bomb used `immediateWinOnly: true` and reached the win line. There were also `514` (Simple) and `545` (Medium) strict attempts that found no actual winning blast and therefore used the open fallback without spending the bomb. All `20` hidden maps per opponent contain exactly `53` mines, paired seat maps are identical, and public traces contain no hidden map. Artifacts are under `C:\Users\keyn1\AppData\Local\Temp\minestorm-ai-baseline-Kk2vfn\direct-win-post-certain-replays\`; audit JSON is `C:\Users\keyn1\AppData\Local\Temp\minestorm-ai-baseline-Kk2vfn\direct-win-post-certain-audit.json`. Inputs are `C:\Users\keyn1\AppData\Local\Temp\mine27b-baseline-1000.json` and `C:\Users\keyn1\AppData\Local\Temp\minestorm-ai-baseline-Kk2vfn\direct-win-1000-post-certain-fix.json`.

**Interpretation:** The corrected direct-win exception improved paired win rate against both opponents, while average score-margin changes remain uncertain. This does not establish that spending a bomb without an immediate win is beneficial. Independent code review of both `e709774` and the follow-up `47dae46` found no issues; the follow-up reviewer did not rerun the 105-test suite or tournament.

## Independent read-only review

### Baseline analysis review

- **Correct:** Paired maps, equal seat assignments, and separation of public traces from postgame hidden maps match the available baseline artifacts. Mine-hit labels and final scores are post-action/postgame evidence only; they do not imply the AI knew hidden mines live.
- **Finding — P1 (resolved):** The original implementation could silently execute a legal fallback for an invalid AI action. Commit `c44d904` now throws when `resolved.invalid === true` before the fallback is executed; regression test `runMatch rejects an invalid AI decision instead of executing its legal fallback` verifies this behavior. The strict full baseline and all selected loss replays completed without invalid-decision errors.
- **Policy hypotheses:** At the time of the baseline review, gameplay hypotheses were unproven. The narrow direct-win last-bomb exception has since been tested in the paired experiment above; the broader comeback-bomb and close-out/open-selection hypotheses below remain untested.

### Report-ready findings: ranked falsifiable hypotheses

1. **Direct-win final-bomb exception (tested; see experiment above).** The strict baseline used no bombs in 4000 Invincible games. In the selected loss traces, Invincible had `canBomb` on 559 Simple and 388 Medium turns, but none met both old gates (deficit ≥4, coverage ≥2/3); it also conserved the last bomb unless `score + bestYield` reached the win line (`plugin/ai-constraint-probability.js:51-70`). The corrected paired follow-up bypasses these gates on both the ordinary and exact-certain-mine paths, only for an engine-verified immediate win. On the corrected evaluated seed range, paired win-rate gains were +4.50 percentage points vs Simple (95% CI +1.50 to +7.35) and +4.60 points vs Medium (+2.25 to +6.95). This supports the narrow actual-winning-bomb exception on that seed range. It does **not** validate use of an expected yield as win probability or a policy that spends a last bomb when no direct win exists. The 401/864 Simple losses and 344/634 Medium losses at ≥24 points are still only postgame close-out categories, not evidence for that broader policy.

2. **Ablate the close-out low-risk preference against a win-probability objective.** The loss table records 745/1,498 losses ending at ≥24 points, three or fewer points short of the 27-point winning threshold on a 53-mine board. The policy has a special case when scores are within two and either player is within three of the win line; it then chooses the lowest-risk hidden cell adjacent to a revealed mine (`plugin/ai-constraint-probability.js:98-103`). This is a plausible decision seam to test, **not evidence that the branch caused those losses**; final scores are retrospective.

   **Test:** Replay decision states in this endgame condition with a policy that compares candidate actions by estimated chance of reaching/defending the win line before yielding the turn, versus the current preference. Falsify the hypothesis if paired held-out outcomes show no improvement. **Uncertainty/counterevidence:** The audit does not establish that this branch fired in the cited losses or that a higher-risk action would have won.

3. **Test score- and turn-aware open selection; do not globally suppress risky opens.** In the selected loss replays, post-action map verification found 341 mine hits on non-certain, nonzero-risk opens among 1,274 Invincible opens against Simple, and 365/1,316 against Medium. Examples include seed `100000` (Simple, red Invincible lost by one with 17 such hits) and seed `100001` (Medium, blue Invincible lost by three with 21). The trace audit also found zero missed certain mines among 153 Simple and 113 Medium certain-mine opportunities. These mine-hit counts require postgame outcomes; the posterior risk and selected actions were public at decision time.

   **Test:** Compare the current score/risk selection with a score- and turn-conditioned action-value rule on paired seeds. **Uncertainty/counterevidence:** A mine hit scores a point and retains the player's turn (`js/core.js:190-205`); hits are not intrinsically mistakes. The certain-mine audit is positive evidence against missed forced scores being a repeated pattern in this packet.

**Evidence scope:** The baseline review checked the report, bounded loss-replay audit and named per-seed summaries, source policy seams, and sample traces/maps. The follow-up experiment separately uses 1000 matched seed clusters/opponent and bounded bomb-use traces; its external inputs and machine-readable audit are named above. The remaining close-out and general comeback hypotheses still require paired validation, not causal conclusions from the baseline loss packet.

- **Prior merge verdict:** BLOCK pending invalid-decision enforcement and a strict rerun. That blocker was resolved by `c44d904`; the validated results above supersede the provisional baseline. This baseline review preceded the direct-win strategy commit `e709774`.

### Direct-win code reviews

- **Finding:** No Critical, Important, or Minor code issues. Reviewers verified that the plugin triggers strict mode using only public `hiddenCount`, the engine filters actual non-winning blasts, the exact-certain-mine path retains a legal fallback, and UI/decision-guard/tournament runtime preserve authorization and the strict-mode flag.
- **Tests cited:** `test/strong-plugin.test.js:187-203`, `test/bomb-area.test.js:166-196`, `test/ai-decision.test.js:89-100`, `test/ai-tournament.test.js:161-201`.
- **Verdict:** OK. The follow-up reviewer inspected the exact working-tree patch for `47dae46` and source; they did not rerun the 105-test suite or full tournament, which were verified by the parent.
