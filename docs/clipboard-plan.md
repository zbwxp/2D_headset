# Copy and paste: plan and acceptance list

Sorted as bowen asked (1791513310). Posted at Slack 1791513392.

## Principles (graph rows already confirmed; nothing new)

- **Cut, paste / copy:**
  - cut and paste are edits; copy does not change the document;
  - locked elements can be copied, and the pasted copy carries the lock;
  - a paste may not bypass locks already in the target.
- **Copy (layer, lines, groups):**
  - a new-identity copy of the chosen range;
  - point–line connections, joins and fill boundaries inside the range are remapped;
  - endpoint links are never copied.
- **No two endpoints in one layer coincide:** coincident ones bind automatically, and the existing point stays.

## Notes (unique consequences of the principles)

- **Copy acts on lines:**
  - a selection of only points or handles is refused with `select-lines-to-copy`, as delete is;
  - points and handles in a mixed selection add nothing.
- **What comes along:** joins whose two lines are both in the range; end strokes on copied points; fills whose boundary lines are all in the range, with colour and state.
- **Not copied:** endpoint links. Mirror pairs are not copied either, because the copy row lists only connections, joins and fills as remapped.
- **Pasted content:**
  - new ids;
  - names "<name>副本" (then 副本2…) for every copied line, and for every continuous curve copied whole;
  - a curve copied in part is a new curve with a default name.
- **Paste and locks:** if a bind triggered by the paste would change a locked line, the whole paste is refused (the normal lock check).

## Common sense (mature-tool defaults; not in the graph)

- **The clipboard** is plain data outside the document and outside undo. It can be pasted into another document as well.
- **Where it lands:** the caller's layer (the bench uses the current layer), moved by an offset the caller gives. The bench offsets each repeat of the same clip one step further (interaction backlog 5, bowen 1791464156).
- **Selection:** the pasted lines become the selection, in the same edit.
- **Cut is not in this round:** it keeps ids (graph Q31), which needs a separate decision about mirror links. It is asked separately.

## Module

`src/clipboard`, depending on `network`, `groups`, `joins`, `fills` and `names`:
- `extract(doc, lines) → Clip` reads the range.
- `paste(doc, ch, clip, layer, offset, idOf)` writes it through each module's own insert:
  - `network.insertLines`, which `copyLines` now uses too;
  - `joins.insert`, which `joins.copy` now uses;
  - `fills.insert`, which `fills.copy` now uses;
  - `names.copyFrom`.

`document`:
- `Core.copy(lines?)` reads the published state, using the selection's lines if none are given.
- `Editor.paste(clip, layer, offset, prefix)` gives every new id as `<prefix>/<old id>`, as `copyLayer` does with its layer id.
- `copyLayer` becomes extract + paste with no offset, so the two share one path.

## Acceptance (`test/clipboard.test.ts`)

1. **Copy:**
   - does not change the document or its history, even with locked lines selected;
   - a selection of only points or handles is refused with `select-lines-to-copy`.
2. **Paste into a layer with an offset:**
   - the same shape, moved by the offset;
   - joins (smooth, cusp, arc with radius), end strokes, fills (colour, visible, locked), and line state and stroke all carried;
   - endpoint links and mirror pairs not carried.
3. **New ids and names:** pasting twice gives two new sets; names "<name>副本", then "<name>副本2"; a curve copied in part gets a default curve name.
4. **Binding and locks:**
   - pasting with no offset onto the original's own layer binds at every endpoint, and the originals stay;
   - if that bind would change a locked original, the paste is refused and nothing changes.
5. **Locks carried:** a pasted locked line is locked afterwards, and a later edit that changes it is refused.
6. **Other documents:** a clip from one document pastes into another; the clip is plain JSON.
7. **One undo step:** one paste is one step; undo removes everything it added, and redo brings it back.
8. **`copyLayer` unchanged:** all existing layer-copy tests still pass on the new shared path.
9. **Round trip:** a document with pasted content saves and opens equal.
10. **Boundary:** `clipboard` imports only `network`, `groups`, `joins`, `fills` and `names`, and only `document` imports it.
