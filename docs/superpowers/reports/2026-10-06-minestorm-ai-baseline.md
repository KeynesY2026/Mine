# MineStorm AI development baseline

**Status:** The formal baseline was rerun with strict invalid-decision rejection. Both opponent tournaments completed with no invalid decisions or incomplete matches; every reported result is from a valid decision sequence. No strategy changes were made; this report documents the verified baseline and review.

## Run identity and protocol

- Tournament tooling commit: `8c441b712a8b1b590e749cebbab9376d87eb25d3` (`feat: add AI tournament command line`). Strict invalid-decision validation and regression test: `c44d904` (`fix: reject invalid tournament decisions`). Tasks 1–4 are present in the committed history: seeded runtime `62f8df7`, match simulator `856c6e8`, paired statistics `3997c19`, and CLI `8c441b7`.
- Runtime: Node.js `v24.14.0`.
- Standard configuration: `15×15`, `53` mines, `1` bomb per player, enhanced AI enabled; AI bombs were not disabled.
- Split/range: development seeds `100000–100999`, inclusive; `1000` seed clusters per opponent. Every cluster ran Invincible as blue and red, for `2000` games per opponent and `4000` baseline games total. The validation split was not used.
- The baseline used no full-match traces. Each per-batch and consolidated JSON includes all seed clusters, paired game outcomes, scores, move counts, and map hashes. Artifacts are outside the repository under `C:\Users\keyn1\AppData\Local\Temp\minestorm-ai-baseline-Kk2vfn\`.

### Commands and runtime

Full tests and runtime version:

```sh
node --version && node --test test/*.test.js
```

Result: Node `v24.14.0`; all `101` tests passed after strict invalid-decision validation.

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

## Independent read-only review

### Review

- **Correct:** Paired maps, equal seat assignments, and separation of public traces from postgame hidden maps match the available baseline artifacts. Mine-hit labels and final scores are post-action/postgame evidence only; they do not imply the AI knew hidden mines live.
- **Finding — P1 (resolved):** The original implementation could silently execute a legal fallback for an invalid AI action. Commit `c44d904` now throws when `resolved.invalid === true` before the fallback is executed; regression test `runMatch rejects an invalid AI decision instead of executing its legal fallback` verifies this behavior. The strict full baseline and all selected loss replays completed without invalid-decision errors.
- **Policy hypotheses remain unproven:** The simulator correction changes only tournament validity handling, not gameplay strategy. The hypotheses below remain proposals for paired experiments, not established causes.

### Report-ready findings: ranked falsifiable hypotheses

1. **Test a less restrictive final-bomb policy, using win probability rather than expected yield.** The baseline used no Invincible bombs in 4,000 games. In the selected trace audit, Invincible had `canBomb` on 559 Simple and 388 Medium turns, but no selected turn met both current gates: deficit ≥4 and coverage ≥2/3. The policy also conserves its last bomb unless `score + bestYield` reaches the win line (`plugin/ai-constraint-probability.js:51-70`). Separately, 401/864 Simple losses and 344/634 Medium losses ended with Invincible at ≥24 points; that is a postgame category, not evidence of a live opportunity. For example, in the paired games on seed `100001` against Medium, Invincible lost `24–27` as blue and `21–27` as red, with no bomb used (per-seed summary).

   **Test:** On held-out paired seeds, compare the current policy with a last-bomb rule based on the estimated probability of winning after the actual bomb action versus continuing without it. Derive that probability from public-state posterior possibilities and the authorized engine action semantics; do not give the plugin hidden maps. `expectedMines` is a sum of posterior mine probabilities (`js/ai-planner.js:296-309`), not the probability of reaching the winning score. **Uncertainty/counterevidence:** The selected packet contains no bomb-use example meeting both current gates, so it cannot establish that loosening them helps; a bomb can consume the turn and leave a playable board to the opponent.

2. **Ablate the close-out low-risk preference against a win-probability objective.** The loss table records 745/1,498 losses ending at ≥24 points, three or fewer points short of the 27-point winning threshold on a 53-mine board. The policy has a special case when scores are within two and either player is within three of the win line; it then chooses the lowest-risk hidden cell adjacent to a revealed mine (`plugin/ai-constraint-probability.js:98-103`). This is a plausible decision seam to test, **not evidence that the branch caused those losses**; final scores are retrospective.

   **Test:** Replay decision states in this endgame condition with a policy that compares candidate actions by estimated chance of reaching/defending the win line before yielding the turn, versus the current preference. Falsify the hypothesis if paired held-out outcomes show no improvement. **Uncertainty/counterevidence:** The audit does not establish that this branch fired in the cited losses or that a higher-risk action would have won.

3. **Test score- and turn-aware open selection; do not globally suppress risky opens.** In the selected loss replays, post-action map verification found 341 mine hits on non-certain, nonzero-risk opens among 1,274 Invincible opens against Simple, and 365/1,316 against Medium. Examples include seed `100000` (Simple, red Invincible lost by one with 17 such hits) and seed `100001` (Medium, blue Invincible lost by three with 21). The trace audit also found zero missed certain mines among 153 Simple and 113 Medium certain-mine opportunities. These mine-hit counts require postgame outcomes; the posterior risk and selected actions were public at decision time.

   **Test:** Compare the current score/risk selection with a score- and turn-conditioned action-value rule on paired seeds. **Uncertainty/counterevidence:** A mine hit scores a point and retains the player's turn (`js/core.js:190-205`); hits are not intrinsically mistakes. The certain-mine audit is positive evidence against missed forced scores being a repeated pattern in this packet.

**Evidence scope:** I checked the baseline report, its bounded replay audit and named per-seed summaries, source policy seams, and sample trace/map artifacts. The raw JSONL games are single lines exceeding the read tool's 50 KiB limit, so I could not manually traverse every decision in the full traces. The packet is also a selected loss sample (ten clusters per opponent), not a representative sample for estimating policy effects. These hypotheses require paired validation, not causal conclusions from this review.

- **Prior merge verdict:** BLOCK pending invalid-decision enforcement and a strict rerun. That blocker is now resolved by `c44d904`; the validated results above supersede the provisional baseline. The review was analysis only; no strategy code was changed.
