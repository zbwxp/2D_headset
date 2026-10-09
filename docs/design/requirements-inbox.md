# Requirements inbox (bowen 1791550280)

bowen's requirements from trying the bench, recorded as he gives them: in no order, verbatim, with the Slack ts. **No analysis here and no principles** — they are sorted and grouped later (bowen 1791550280: "先记录下来然后之后先整理再归类 目前先记录不要分析原则").

| # | ts | bowen's words | Checked against the bench now |
|---|---|---|---|
| 1 | 1791550341 | 首先我调整handle的时候要能看到handle在动，现在移动handle只能看到线条在改变，看不到handle | Matches. Dragging a handle with A shows only the dashed preview of the line; the handle square stays where it was until release, then jumps (checked in the browser, 2026-10-09). |
| 2 | 1791550416 | 然后我要一个视觉效果和adobe全家桶类似的图层，（在右手边，几个按钮和图层tagbar 图层视口 复刻一下） | Does not exist yet. The bench's layer list is in the left sidebar, under the tools: one plain box per layer with its name, id and line count, and a row of text buttons (rename ↑ ↓ hide/show lock/unlock fills off/on copy delete). There are no thumbnails, no eye or lock icons, and no Adobe-style panel on the right. **Done in the bench** at core/v1 `a0e56e2` (bowen 1791550512: do the layers first), in `bench/src/ui/` until visual principles exist. |
| 3 | 1791551539 | 图层最底部的四个按钮 那个开关图层的图标太没有辨识性了。然后这四个图标放到上面，和"图层"那两个字放一排。 | Matches. The four buttons sit in the panel's bottom bar (fills on/off, new, copy, delete); the fills icon is a plain square split in four, hard to read. The title row "图层" has no buttons. |
| 4 | 1791551539 | 然后一个交互上的恶劣体验， 画一条线 它纯直线，然后a选择 我从来没有成功选中过线上面的handle，选了直接选到曲线，然后只能通过移动端点。让handle错位 才能移动handle。 | Matches (also noted below, 2026-10-09). A pen line is straight, with its handles lying on the line. Pressing a handle with A selects the line, because the line is at the same distance and wins. A handle can only be picked once something has moved it off the line. |
| 5 | 1791551581 | 然后a选中 v选中貌似是得先点击触发select，然后才能移动？无法做到点击然后按住不放直接移动？ | Partly. Pressing **on a line** (within a few pixels) and holding works in one go: it selects, and the release moves it (checked with a real mouse drag in the browser). Pressing **inside a filled shape**, or anywhere not near a line, selects nothing and pans the canvas, because V and A pick lines, points and handles only. So the object is grabbed only if the press lands near its outline. |

## Found while checking (not bowen's requirements; facts only)

- A handle whose tip lies exactly on its own line (the default straight line's handles) cannot be picked with A. The line wins the tie, so pressing there selects the line. → bowen raised it as #4.
