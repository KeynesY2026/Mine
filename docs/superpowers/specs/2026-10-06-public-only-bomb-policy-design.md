# Superseded: Public-Information-Only Bomb Policy

> **Status:** Superseded by [`2026-10-06-joint-public-bomb-win-probability.md`](2026-10-06-joint-public-bomb-win-probability.md) and root [`alg.md`](../../../alg.md).

This earlier design introduced the `singlePossibleMineRegion` analysis property and an independent-marginal hit-count estimate. The user later rejected region-connectivity as a generic Planner API and specified that the policy should evaluate whether a bomb can reach the winning score using the joint hit-count probability.

Do not use this document as the implementation contract. The replacement keeps the public-only constraint, removes `singlePossibleMineRegion`, computes a model-qualified joint distribution, and calibrates the direct-win cutoff empirically. Git history retains the original proposal.
