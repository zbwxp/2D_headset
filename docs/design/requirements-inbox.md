# Requirements inbox (bowen 1791550280)

bowen's requirements from trying the bench, recorded as he gives them: in no order, verbatim, with the Slack ts. **No analysis here and no principles** — they are sorted and grouped later (bowen 1791550280: "先记录下来然后之后先整理再归类 目前先记录不要分析原则").

| # | ts | bowen's words | Checked against the bench now |
|---|---|---|---|
| 1 | 1791550341 | 首先我调整handle的时候要能看到handle在动，现在移动handle只能看到线条在改变，看不到handle | Matches. Dragging a handle with A shows only the dashed preview of the line; the handle square stays where it was until release, then jumps (checked in the browser, 2026-10-09). |

## Found while checking (not bowen's requirements; facts only)

- A handle whose tip lies exactly on its own line (the default straight line's handles) cannot be picked with A. The line wins the tie, so pressing there selects the line.
