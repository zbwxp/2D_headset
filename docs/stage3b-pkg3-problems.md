# Stage 3b, package 3: problem summary after three commits

Asked by dot 1791693476 (three-strikes rule, bowen 1791652114). Package: `correct` on an edge, `a4329a1`, fixed by `1bed3ff` and `d6502dc`.

## 1. Why "open allows near coincidence" was read as "each member's solve is the same"

- **The rule I wrote** (§3 of `docs/stage3b-pkg3-correct.md`, before `1bed3ff`): "the members coincide in every view … so A, B, r and the solve are the same".
- **Where coincidence is really enforced:**
  - after a commit, `links.align` sets a group's members to one position, but only for groups the edit acted on (`src/links/index.ts` `align`: `if (!acted.length) continue`);
  - at open, `importState` only checks that linked points are within 1e-9 (`src/document/index.ts`), and re-settling leaves an untouched group as it is.
  - So the invariant is exact for a group an edit has moved, and only within 1e-9 for any other group. A file can carry a pair 1e-10 apart indefinitely; `correct` moves no point, so it never re-aligns them.
- **Why I missed it:** I checked where the *response* identity is enforced (open compares the sets exactly) and took the *position* identity from package 2's link rule, without looking up its enforcement at each entry. Response identity is exact; position identity is not. One solve per member then gives rounding-different knots, which open later refuses.
- **The tests missed it** because they were written from the same rule: every linked fixture was made by `link`, which aligns exactly.

## 2. Why the final evaluation's failure did not take a declared refusal path

- **The rule I wrote** (§5): the final check compares the pose with the targets, "anything else refuses the whole edit (`correction-not-reproduced`)".
- **What the code did:** the check first calls `posed()` → `evaluate`, which throws its own plain `Error` (`pose-not-finite`) when a sum is not finite. That throw happened before any comparison, so it left as an ordinary error with no `Refusal.code`.
- **Why I missed it:** I listed the refusals of my own rule (bad target, link conflict, locks, the three axis cases, too many knots, not reproduced), but not the throws of the functions the path calls. The overflow I did consider was in the solve (a non-finite w); I did not consider a finite w whose blend overflows (A = 1e308, B = 1.1e308, q = −1e308 gives w = −20).
- **The tests missed it** for the same reason: the number cases came from my list of the solve's failure modes.

## Both are repeats

- §1 repeats stage 3a package 2's lesson: "for every invariant a new read relies on, find where it is enforced at the data entry point". I applied it to the response sets, not to the positions.
- §2 repeats stage 3b package 2's lesson: "check final results are finite". I applied it to w, not to the value the pose shows.

So the lessons were too loose to apply mechanically. The list below makes them a checklist in the plan, checked by dot before code.

## 3. What changes from now on

Before the first code commit of a package, its plan lists:
1. **Every invariant the code relies on, with where it is enforced and how strongly, at each entry** that can create the state (an edit's commit, open, paste). An invariant enforced only within a tolerance at some entry is designed for at that tolerance, or refused there, explicitly.
2. **Every throw of every function on the operation's path** (not only its own checks), each mapped to a declared refusal or stated as an internal error the operation does not expect.
3. A test for each item that is reachable, built through the weakest entry (e.g. a file, not only the editor operation).

This applies to package 4 (the 90° move), whose plan has not been written yet.
