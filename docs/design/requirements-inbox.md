# Requirements inbox (bowen 1791550280)

bowen's requirements from trying the bench, recorded as he gives them: in no order, verbatim, with the Slack ts. **No analysis here and no principles** — they are sorted and grouped later (bowen 1791550280: "先记录下来然后之后先整理再归类 目前先记录不要分析原则").

| # | ts | bowen's words | Checked against the bench now |
|---|---|---|---|
| 1 | 1791550341 | 首先我调整handle的时候要能看到handle在动，现在移动handle只能看到线条在改变，看不到handle | Matches. Dragging a handle with A shows only the dashed preview of the line; the handle square stays where it was until release, then jumps (checked in the browser, 2026-10-09). |
| 2 | 1791550416 | 然后我要一个视觉效果和adobe全家桶类似的图层，（在右手边，几个按钮和图层tagbar 图层视口 复刻一下） | Does not exist yet. The bench's layer list is in the left sidebar, under the tools: one plain box per layer with its name, id and line count, and a row of text buttons (rename ↑ ↓ hide/show lock/unlock fills off/on copy delete). There are no thumbnails, no eye or lock icons, and no Adobe-style panel on the right. **Done in the bench** at core/v1 `a0e56e2` (bowen 1791550512: do the layers first), in `bench/src/ui/` until visual principles exist. |

## Found while checking (not bowen's requirements; facts only)

- A handle whose tip lies exactly on its own line (the default straight line's handles) cannot be picked with A. The line wins the tie, so pressing there selects the line.
