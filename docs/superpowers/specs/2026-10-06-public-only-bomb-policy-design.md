# Public-Information-Only Bomb Policy

## Status

Design approved by the user on 2026-10-06. This document defines the implementation and test scope; no production code changes are included yet.

## Problem

Invincible currently emits `bomb-auto`. The UI and tournament runtime call `Game.bombBest()`, which scans `Game.mines` and chooses the center with the most actual mine hits. Its `immediateWinOnly` option additionally verifies an actual winning blast before acting. This lets hidden board state select or veto the AI's action. It also makes bomb decisions differ from what the AI could know from public clues.

The user wants the AI to decide from public information. `Game.bombBest()` and its hidden-map selection/verification behavior must be removed. The engine must still resolve a chosen bomb's real effects after the AI commits to a coordinate.

## Goals

1. Remove the `Game.bombBest()` method and all `immediateWinOnly` / coordinate-free `bomb-auto` plumbing from the AI, UI, decision guard, tournament runtime, traces, and tests.
2. Have Invincible choose a concrete bomb coordinate using only its public `analysis` and public player state.
3. Apply one policy across board states; do not branch on labels such as opening, middle, or endgame. Unknown-cell probabilities and the public single-region endgame condition determine the decision.
4. Cover bomb-use and bomb-preservation cases with tests, including different unknown-region sizes and hidden-map invariance.

## Non-goals

- Do not prevent `Game.bomb(x, y)` from reading actual mines to reveal cells, award points, update the winner, and emit the real move result. This is normal game resolution after the AI has selected a coordinate, not a pre-action oracle.
- Do not alter human-controlled bomb behavior, bomb legality, blast geometry, or score rules.
- Do not add hidden-map fields to the AI view or tournament decision input.
- Do not claim a public probability estimate guarantees the blast's actual result.

## Public decision model

### Inputs and estimates

Invincible may use only:

- Public scores, bomb inventory, and `canBomb` legality.
- Public cells and remaining-mine totals.
- Public planner probabilities, including `analysis.bombCenters[].expectedMines` and each center's hidden-cell count.
- A public structural predicate for the last unresolved mine region.

For a candidate center, `expectedMines` is the sum of public marginal mine probabilities over the hidden cells in that blast. It is an expected score yield, not a probability that the bomb wins.

Let `tieGap = oppScore - score`. The policy is evaluated only when `canBomb` is true, so the AI is behind and the engine permits an AI bomb.

### Unified use-versus-save rule

1. **Legality:** If there is no bomb, `canBomb` is false, AI bombs are disabled, or no hidden center exists, do not return a bomb action.
2. **Pre-endgame desperate use:** If the board is not in the public single-region endgame state and the maximum public `expectedMines` across candidate centers is less than `tieGap`, use the bomb now. The expected bomb yield cannot reach even a tie, so conserving the last bomb for a later comeback is not justified.
3. **Pre-endgame conservation:** If the maximum expected yield is at least `tieGap`, do not spend the bomb under this rule; preserve the opportunity for a later decisive move.
4. **Public single-region endgame:** If public analysis establishes that the remaining possible mines are confined to one connected unresolved region, and the AI is behind with a legal bomb, use a bomb immediately. This is the one-move decision point; do not conserve it.
5. **Target selection:** Choose a concrete center based only on public analysis. In the ordinary/desperate branch, maximize `expectedMines`. In the single-region endgame branch, maximize the public estimated probability that the blast yields enough mines to reach the win line; break ties by `expectedMines`. The probability is an estimate from public marginals and must never query actual `Game.mines`.

The policy has no explicit opening/middle/late phase flags. Different unknown-region sizes and public probabilities naturally change the branch outcome. The single-region condition is structural and public, not a time/phase label.

## Endgame-region definition

For exact public analysis, consider hidden cells with nonzero posterior mine probability. They form a public 8-neighbor graph. The single-region predicate is true when these cells form exactly one connected component and every hidden cell outside it has zero posterior mine probability. If the analysis is approximate or cannot establish this condition, do not assert the endgame exception; use the pre-endgame expected-yield rule.

## Action and data flow

- Invincible returns `{ type: 'bomb', x, y }` with the selected public center, or its existing legal open action.
- The decision guard checks only action shape, hidden center, player authorization, and `canBomb`; it does not check mine hits or whether the blast wins.
- The UI and tournament runtime pass the selected coordinate to `Game.bomb(x, y, { ai: true })`.
- `Game.bomb()` applies the 5×5 blast and determines actual score/winner only after selection.
- Remove `Game.bombBest()`; no AI-facing method may scan hidden mine locations to select, validate, or veto a target.

## Test plan

Use public-view fixtures and real planner/plugin execution where practical:

1. **Large unknown region, far behind:** maximum public expected bomb yield is below `tieGap`; Invincible returns the highest-expected-yield coordinate bomb.
2. **Different unknown-region size, same rule:** when expected yield reaches `tieGap` and the single-region condition is false, Invincible opens instead and conserves the bomb. No phase label is supplied to the plugin.
3. **Single remaining public mine region:** AI is behind and legal to bomb; it returns a concrete coordinate selected by public endgame probability even if the ordinary expected-yield branch would conserve.
4. **Legality controls:** leading, no bomb, disabled AI bombs, or no hidden center never produce a bomb.
5. **No hidden-map leakage:** two boards with identical public state but different actual mine layouts produce identical analyses and identical bomb decisions/coordinates.
6. **Execution integration:** the selected coordinate is exactly the coordinate passed to `Game.bomb`; the engine's actual hit count is only observed after the move resolves.
7. Remove tests asserting `bombBest()` or `immediateWinOnly`; replace them with observable public decision and coordinate-resolution behavior.

## Risks and limitations

- Marginal mine probabilities are correlated. The endgame win probability computed from marginals is an estimate and may be less accurate than an exact joint posterior. It must be named/documented as an estimate and must never be silently substituted with actual-map checking.
- The endgame single-region predicate must be conservative when planner quality is approximate.
- Removing automatic best-hit selection changes all Invincible bomb behavior; simulation and public-invariance tests are required before accepting the change.
