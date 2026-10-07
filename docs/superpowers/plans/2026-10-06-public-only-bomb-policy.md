# Superseded: Public-Information-Only Bomb Policy Implementation Plan

> **Status:** Superseded by [`2026-10-06-joint-public-bomb-win-probability.md`](../specs/2026-10-06-joint-public-bomb-win-probability.md) and [`2026-10-06-joint-public-bomb-win-probability.md` implementation plan](2026-10-06-joint-public-bomb-win-probability.md).

The earlier plan implemented a shared `singlePossibleMineRegion` flag and an independent-marginal win estimate. The user rejected region connectivity as the decision API and clarified that the strategy must evaluate the probability of reaching the win line from a bomb.

Do not execute this plan. Its initial public-only removal of hidden-map auto-targeting was completed in the integration commit; the revised probability model, Invincible policy, regression tests, and threshold calibration are tracked by the replacement plan. Git history retains the original task details.
