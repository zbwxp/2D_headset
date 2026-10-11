# Stage 3b, package 4 body: why it took three commits

Asked by dot 1791696344 (three-strikes rule, bowen 1791652114). Body `2e42f60`, fixed by `ed63549` and `302b35c`.

## 1. Why the original r's meaning was lost after scaling (`ed63549`, dot 1791696097)

- **The rule** (plan §2): the branch follows the sign of r.
- **What I wrote:** `solveScaled(ρ)` chose the branch from its own argument, and `solveMove` passed it ρ = r / √a. The rule names r; the code decided on a quantity derived from it.
- **Why I missed it:** in exact arithmetic sign(r / √a) = sign(r), so I did not see the substitution as a claim at all. In doubles a strictly negative r can underflow to −0 and take the positive branch. This is the level mix of `docs/stage3b-pkg4-solve-problems.md` again (exact → doubles), at a step I did not list as a claim. The final check could not catch it: the wrong branch still reaches the target.

## 2. Why the composite keys did not allow every legal id (`302b35c`, dot 1791696205)

- **What I wrote:** the final check keyed scalars as `layer|control|axis` and split them back with `split('|')`.
- **Why I missed it:** the rule "any legal id is an ordinary key" (packages 2 and 3: `__proto__`, `constructor`) was applied to stored records (own properties), not to keys I built myself. `keyOf` was safe because it is only built, never parsed; joining it with a separator and parsing it back opened the hole. Ids are arbitrary strings, so any parse of joined ids is ambiguous.

## 3. Why the success test did not operate the linked group (`302b35c`, dot 1791696205)

- **What I wrote:** a test titled "exactly linked members move together" whose target was the unlinked c, asserting only that b and m stayed equal.
- **Why I missed it:** the test name came from the plan item, the body from the nearest fixture; it passed, and I did not check that its assertions contain the effect its title names. Mutation checks did not catch it: no rule removal fails a test that never exercises the rule.

## What changes

1. **Decision points use the quantity the rule names.** Before hand-in, list each branch or comparison in new code and the plan quantity it decides on; a derived quantity (scaled, rounded, re-keyed) at a decision point is a claim at the doubles level and needs a fixed-input test.
2. **No parsed composite keys.** Composite keys are structured or JSON-encoded; `split(` in new code is checked before hand-in.
3. **Feature-off check for success tests.** Besides rule-removal mutations, each success test is run with the feature it names switched off (e.g. no link expansion, no move); it must fail. A test that still passes does not test its title.
