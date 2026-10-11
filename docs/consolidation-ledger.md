# Consolidation ledger: what is not yet clean and must be brought together later

bowen 1791683116: «你们把这个事情记下来 之后写代码哪里不够优雅未来需要整合的也记下来别忘了整合».

**Rules for this ledger:**
- Every place found inelegant while writing code gets a row here, in the same commit that finds it.
- Each row names the place in the code, why it is not clean, and **when** it must be consolidated (a trigger, not "some day").
- Every plan document checks this ledger first. A plan whose work hits a trigger includes that consolidation, or says why it waits.
- A row is closed only by a commit that dot accepts. Closed rows move to the bottom with that commit.
- Line count alone is not a reason for a row (dot 1791682887). Moving code without changing its rules or dependencies does not close a row.

## Open

| # | Where | What is not clean | Consolidate when | Source |
|---|---|---|---|---|
| 1 | `document` commit: `KEEPS_GEOMETRY`, `STAGE2` name lists, `CommitMode` | What a commit settles is chosen from **lists of operation names**. A new operation missing from a list raises no error; it silently gets the full settle. | Before any new editing operation that needs a settle other than full (the earliest is stage 3's in-between correction, if it enters the transaction). **Target:** each operation declares which layers it writes and which version it reads. The transaction checks and merges those declarations in one place; an operation never sets the commit rule itself; a missing declaration is an error, never a default full settle (dot 1791682947). | Claude 1791682922, dot 1791682887, 1791682947 |
| 2 | stage-2 boundary `stage2-alone` | Broadcast, fit and draft must stand alone in their edit. This sidesteps "move then broadcast in one edit: in what order?" rather than solving it. | When bowen needs a stage-2 operation combined with other edits in one undo step. Needs its own design, not a patch. | `docs/stage2-plan.md` rule 0; dot 1791680149 |
| 3 | `links` × `base:angle` | Creating a link moves the second point in every view but not in the baseline. The front can then differ from the baseline, and a broadcast is refused if the two sides' differences differ, until both sides are fitted together. | When stage 3 or bowen's use shows this in practice; decide whether creating a link also moves the baseline. | `docs/stage2-summary.md`; dot 1791682283 |
| 4 | `document` Transaction `ops` | `ops` (a Set) is still filled on every call but no longer read; `calls` replaced it in stage 2. Dead field. | Next commit that touches the transaction (with #1 at the latest). | found 2026-10-11 while writing this ledger |
| 5 | `clipboard` lines 63–64 | It repeats the layer kinds `'view' \| 'expression' \| 'record'` literally instead of using `shapes.KINDS` / `LayerKind`: two definitions of one list, which can drift apart. (`expression` already exists as a kind; stage 4 starts using expression layers, it does not add the kind; dot 1791683214.) | Before stage 4 starts using expression layers, or earlier with any clipboard change. | found 2026-10-11 while writing this ledger; wording dot 1791683214 |
| 6 | `Core` front shortcuts (`snapshot`, `geometry`, `copy`, `nearby`, …) and `State.network` bound to the front | Two ways to read: `in(view)` and front-only shortcuts kept for the single-view entry. | The next time a read API is added or the compatibility entry is touched: review all read entries together once. (Interaction and the bench already read per view since stage 1, so that is not a trigger; dot 1791683214.) **Triggered by stage 3a**, which adds `Core.model()` / `Core.pose()`. | `docs/architecture-multiview.md` §2, package 6; dot 1791683214 |
| 7 | auto-bind scope | Auto-bind considers every coincidence in the edited view, not only what the edit touched. Only selection-only and broadcast-only edits skip it. | Separate proposal, before any feature where an unrelated coincidence would bind by surprise. | dot 1791655898; `docs/step7-view-picker.md` |
| 8 | bench `Open` | File reads are asynchronous with no ordering check: a slower earlier read can replace a later one. Bench glue, not a graph module. | Next bench change to Open/Save. | dot 1791656976; `docs/step7-view-picker.md` |
| 9 | `evaluate` slots A (appearance at a pose) and B (joins after the blend) | Placeholders, not answers: appearance switches at the dominant view (width, profile, end strokes jump there); smooth joins are left as blended, bend not measured. | When bowen takes up playback interaction / rendering, or before playback is treated as finished. Filling a slot may need its inputs extended. Not closed by 3a: a temporary checking bench is not finished playback interaction / rendering (dot 1791684410). | bowen 1791684302; dot 1791684152; `docs/stage3a-playback-plan.md` rule 5 |
| 10 | `joins.EndStroke` type | The type allows `undefined` values, but `setEndStroke` drops them, so stored and read end strokes never hold one. Readers that need the exact type have to filter (`document` `modelOf`, stage 3a). | Next change to end strokes, or the next reader that has to filter. | found 2026-10-11 in stage 3a package 2 |

## Closed

(none yet)
