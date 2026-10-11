# Stage 3b, package 4: why the solve rules took more than three versions

Asked by dot 1791694943 (three-strikes rule, bowen 1791652114). Plan versions: `8fcf3f6` → `bbe6bbd` → `1f25fb5` → `ac7a315`, accepted as the basis at `ac7a315`.

## What was mixed

Three different things were written as if they were one:

1. **The algebraic optimum:** the minimum of f(w) in exact arithmetic (does it exist, where are its stationary points, which branch).
2. **The floating-point candidate:** the double the code actually returns (how the equation is scaled, the brackets, the midpoint, where the halving stops, which end is taken).
3. **Whether the candidate is acceptable:** the old knots, links, springs, the other axis, the other layers and the settle, checked after the solve.

Each review found a claim that holds at one level used at another:

| Claim in a draft | Holds at | Was used at | Found by |
|---|---|---|---|
| "the minimum is unique" | 1, per axis, r ≠ 0 | 1 at r = 0 (two optima), and 3 (the whole correction) | dot 1791694376 |
| front → O knots "keep A", so set them to 0 | 1 ((1 − r)·A + r·A = A) | 2 (that sum rounds; r = 1e16 shows 0) | dot 1791694396; my own check (≈ 29% of random cases) |
| the bracket on w³(w − r) − K changes sign | 1 (K > 0) | 2 (K underflows to 0 at c = 1e-200) | dot 1791694458 |
| a margin of 1 makes the outer end ≥ 1 | 1 | 2 (ρ + 1 rounds to 1 at ρ ≈ 1e-16) | my prototype |
| the outer end is the root's double | 2 for small ρ | 2 at ρ = 2⁵³ (the gap is 2; the other end is far cheaper) | dot 1791694778 |
| the settle cannot throw on finite input; O keeps B′ | 3 for ordinary sizes | 3 near the largest numbers, and with three linked members (averaging) | dot 1791694458; my own check (≈ 17%) |
| the final check compares with the published state | 3 for `correct` alone | 3 with an allowed stroke broadcast before it | dot 1791694523 |
| a moved point is "moved" as a whole | 3 per control | 3 per axis (linked b / m, x averaged) | dot 1791694560 |

The pattern is the one of packages 2 and 3: a property derived in exact arithmetic, or for the common case, was stated without saying where it holds, then relied on in floating point or for the whole edit.

## What guarantees each now

1. **The algebraic optimum** (§2 of `docs/stage3b-pkg4-move.md`): used only to justify that a stationary point exists on each branch and which branch to take (by the sign of r). Nothing in the code relies on it being exact. Test: the chosen w satisfies z³(z − ρ) = 1 within rounding.
2. **The floating-point candidate** (§2, scaled form): no K is formed; brackets of width 2 from an inner to an outer end; an overflow-free sign test; the end with the smaller φ; z === ρ gives w = r; any NaN, w = 0 or a non-finite B′ or shown value refuses before writing. Not claimed: the cheapest of all doubles. Tests: the prototype's cases as reproducible tests (fixed inputs, not random counts): ρ = 2⁵³ comparing both ends' φ, c = 1e-200, a tiny negative r, |ρ| beyond 2⁵³, extremes of ρ.
3. **Whether it is acceptable** (§4, §5): the final check on the settled trial, against the draft on entry to `correct`, with a per-axis move mask; the old knots re-solved from their recorded values; `correction-breaks-target`; `coordinates-not-finite` for the settle (`385707a`). A refused candidate does not prove that nothing else would work; it is refused, not searched around.

## What changes

For a numeric rule, each claim in the plan says which of the three levels it is at, and every claim at level 2 has a reproducible test (fixed inputs) before the plan is sent, not a random-sample count in prose.
