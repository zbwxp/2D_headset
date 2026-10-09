# 22 — The interaction module: plan (before code)

bowen 1791543087: write the graph rows; write a plan before code. Interaction is an independent module, and where a function's package is unclear, it is discussed.

Graph section "Interaction" (design `1e0d9cf`):
1. **One owner per state.** The drawing, the selection and the undo history belong to core. The current tool and every unfinished operation belong to interaction.
2. **Cancellable, atomic commit.** A preview never writes.
3. **Explicit targets.**

Earlier frame (doc 21 §0, bowen 1791477975): parts with a graph are never polluted, and the rest is a throwaway bench. Interaction now has a graph, so it leaves the bench and becomes a module held to those rules.

## 1. Packages

| Package | Has a graph | Owns | Does | Never does |
|---|---|---|---|---|
| `core` (exists) | yes | the drawing, the selection, the undo history | every drawing rule; one edit = one commit; copy / clip, save / open | know about pointers, keys, screens, tools |
| `interaction` (new, `headset-core/interaction/`) | yes (this section) | the current tool; unfinished operations (drag, pending cut, two-click first pick, pen chain, snap hint); the clipboard and its paste count | turns input events (in document coordinates) into core calls; keeps each unfinished operation's target fixed; ends unfinished state on commit, cancel, failure (by its rule), tool change and drawing change; describes previews and refusal marks as plain data | draw anything; hold a copy of the drawing; make any drawing rule; reach core except through its public interface |
| `view` (bench for now) | no | the camera | draws the drawing, plus interaction's preview / mark description; maps screen ↔ document | change any state |
| `app` (bench for now) | no | which drawing is open; panels; files | wires the parts together; file download / upload; buttons and panels | rules |

Boundary tests, as core already has:
- `interaction` imports only core's public entry.
- Core never imports `interaction`.
- `view` and `app` may import both, but not each other's insides.

## 2. What moves out of the bench into `interaction`

Each item goes in with its tests (scripted input → expected core calls / preview data, without a browser).

**Tools:**
- pen: chain of clicks; first pick held until the next one;
- V / A: select, and drag with a ghost;
- split, bind, merge position, link, unbind, join (two clicks, in click order), fill.

**Unfinished operations:**
- **drag:** start → move (preview offset) → release (one `core.edit`), or cancel (Esc, pointer cancel, lost capture);
- **pending cut:** mark → paste (a move) or cancel;
- **two-click pick:** first pick → second pick, or cancel.

**Lifecycle per the graph:**
- **Commit:** a commit ends the operation.
- **Cancel:** a cancel drops only what is not committed.
- **Failure:** the gesture ends, and a pending cut stays.
- **Drawing change:** opening or switching drawings ends everything tied to the old drawing.

**Clipboard:**
- copy replaces the clip and ends a pending cut;
- paste offsets each repeat by one step.

## 2b. The core operations interaction calls (public interface only; dot 1791543119)

| Interaction does | Core calls |
|---|---|
| **Reads** (for picking, previews, panels) | `snapshot()` and `geometry()` |
| | `pickLoop(at)` (fill) |
| | `canUndo` / `canRedo` |
| **Selects** (a pre-edit, one step) | `edit(e => e.select(units, mode))` |
| | `edit(e => e.selectGroup(line, mode))` |
| **Commits a drag** | `edit(e => e.translate(dx, dy))`, on the selection fixed at the drag's start |
| **Pen** | `edit(e => e.line(id, a, b))` |
| **Two-click tools** | `bind(keep, remove)` |
| | `mergePosition(target, moving)` |
| | `link(a, b)` |
| | `join(point, l1, l2, opts)` |
| | `removeJoin(…)` |
| **One-click tools** | `split(line, t, …)` |
| | `unbind(point, [line], id)` |
| | `fill(loop, colour)` / `clearFill(loop)` |
| **Buttons it owns** | `rotate`, `scale`, `flip` |
| | `deleteSelection()` |
| | `lineState`, `lineStroke` |
| | `mirrorApply`, `mirrorLink`, `unmirror` |
| **Clipboard** | `copy(lines?)` → a clip it holds |
| | `edit(e => e.paste(clip, layer, offset, prefix))` |
| | pending cut, then `edit(e => { for (g) e.moveGroup(g, layer) })` |
| **History** | `undo()` / `redo()` (never inside an edit) |

**Not interaction's:**
- layer panel operations (`layer`, `renameLayer`, `reorderLayer`, `layerState`, `copyLayer`, `deleteLayer`): panels, in `app`;
- `save` / `open`: files, in `app`.

**Who owns what:**

| State | Owner | Why |
|---|---|---|
| The drawing | core | graph row "State has one owner" |
| The selection | core | graph row "State has one owner" |
| The undo history | core | graph row "State has one owner" |
| Current tool and tool options (join mode, arc radius, fill colour, width field) | interaction | belongs to the tool |
| Drag in progress (start, offset, target selection) | interaction | an unfinished operation |
| Pending cut (groups, drawing it belongs to) | interaction | an unfinished operation |
| Two-click first pick | interaction | an unfinished operation |
| Pen chain | interaction | an unfinished operation |
| Snap hint | interaction | an unfinished operation |
| Clipboard and its paste count | interaction | the clipboard is tied to copy / paste, which interaction drives |
| Camera (pan, zoom) | view | display only |
| Which drawing is open | app | not part of any drawing |
| Mirror "source" picked for apply / link (bench's Set source) | interaction | the first step of a two-step operation |

## 3. Unclear: which package (for discussion with bowen)

1. **Hit testing** (which point / handle / line is under the cursor).
   - *Option 1:* a read-only query next to core (geometry it already owns), used by interaction, view and the AI. The tolerance is given by the caller.
   - *Option 2:* inside interaction.
   - Today the bench lets SVG elements catch the pointer, which ties hit testing to the drawing code.
   - Suggestion: option 1.
2. **Ids for new objects.**
   - Core asks the caller for every new id. Interaction then has to make ids, and ids are identity, which is core's.
   - *Option 1:* core allocates when no id is given.
   - *Option 2:* interaction keeps making them, with a session prefix as the bench does.
   - Suggestion: option 1, a small core addition.
3. **Where a refusal is shown.**
   - A red cross needs to know which object was refused. Core's refusals are text today, and parsing text would put core's meaning inside interaction.
   - *Option:* core refusals carry `{ code, objects }`.
   - Suggestion: yes. This is a core interface addition, not a rule change.
4. **Exact preview.**
   - The graph does not fix how exact a preview is.
   - The bench draws a rough ghost. An exact preview would need core to run an edit on a draft and return it without publishing.
   - Suggestion: not now. Keep the rough ghost; add the core preview later if the ghost misleads.

## 4. Process

- Once bowen answers §3: write `interaction/` plan and acceptance list (commands and preview data per scripted input, the lifecycle cases above), then code. dot reviews.
- The bench keeps drawing and panels; its tool code is replaced by `interaction`.
