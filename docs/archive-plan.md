# Save and open: plan and acceptance list

Graph section "Save and open" (headset-design `977137f`; bowen 1791511525):
- **Principle:** save / open is an independent module.
- **Scope note (dot 1791511131):** a v3 drawing is saved, then opened whole.
- **Not now:** UUIDs, importing v1/v2 drawings, format migration.

## Choices (implementation, mature-tool defaults)

- **What is saved:** the drawing.
  - Layers, points, lines, groups (ids and order), joins, endpoint links, fills, names, the axis, and mirror pairs.
  - The modules' own counters (e.g. the next group number), so ids made after opening never collide with saved ones.
- **Not saved:** the selection and the undo history.
  - Opening gives an empty selection and an empty history.
  - This matches common editors, where a reopened file starts a fresh undo history.
- **After opening, everything equals what was saved:** the snapshot (selection apart) and the geometry.
- **A file that cannot be opened is refused whole:** opening builds a new document and returns it, so the current one is never touched.
- **Format:** `{ format: "headset-v3-drawing", version: 1, document: … }`. Any other format or version is refused, because there is no migration yet.

## Module

`src/archive`: `save(core) → string` and `open(text) → Core`.
- It depends on `document` only.
- `document` gains two internal functions that the package root does not export:
  - `exportState(core)`: the state as plain data, without the selection;
  - `importState(data)`: checks the data and returns a new `Core`.
- The package root exports `save` and `open`.

### How `importState` checks a file

1. **Each module restores its own part** (dot 1791512144): `network`, `groups`, `joins`, `links`, `fills`, `apply` and `names` each export `restore(data, …)`, which checks types and internal consistency and returns a copy. Examples:
   - coordinates are finite numbers;
   - ids are unique and marked as used;
   - line ends exist in one layer;
   - groups are exactly the connected curves, and the group counter is past every `g<k>`;
   - joins and links sit on lines that end at their points;
   - every line and group has exactly one name.

   Where a module keeps one stored form (unordered pairs written smaller id first, sorted rows), `restore` writes the data again through the module's normal writers (`setJoin`, `setEndStroke`, `link`, link `setJoin`; the mirror pairs' sort). The result must equal the file, so restoring shares the writers' parameter checks. A reversed pair, a repeat or an extra value is refused (dot 1791512476).

   `document` calls them in dependency order. `archive` only handles the file envelope and holds no rules of its own.
2. **Reads:** the reads the editor relies on run without error: snapshot, geometry, closed-loop discovery and the names check.
3. **Ids and links:** no id is used twice, and endpoint-linked points coincide. A smooth join is a spring: where several pull on one handle the result is a compromise, so it is not checked (found by the fuzz round trip).
4. **Settled:** running the commit pipeline again on a copy changes nothing. A saved document is always a settled one, so any difference means the file was edited or damaged.

Any failure gives `open-failed: <reason>`.

## Acceptance (`test/archive.test.ts`)

1. **Round trip:** `open(save(d))` gives the same snapshot (selection empty) and the same geometry, for:
   - the demo eyes (joins, arc, fill, names, mirror link, endpoint link);
   - the v2 right eye with its mirror-linked copy;
   - every published state of a fuzz run.
2. **The opened document works:**
   - its undo history is empty;
   - an edit after opening gives the same result as the same edit on the original;
   - new groups and names continue without collisions.
3. **Damaged or foreign files are refused with `open-failed`:**
   - not JSON;
   - wrong format or version;
   - a missing part;
   - a line pointing to a missing point;
   - a duplicate name;
   - linked points apart;
   - data that reads fine but would break a later edit (dot 1791512144): missing or emptied `usedLines`, a group counter behind an existing group id, a coordinate that is text, a line across layers, a join or link on the wrong line, a fill or mirror pair on a missing line, a line without a name.
4. **Boundary:**
   - `archive` imports only `document`, and nothing imports `archive`.
   - The package root exports `save` and `open`, but not `exportState` / `importState`.

## Bench

Save downloads a `.json` file. Open reads a file and replaces the bench's document only if `open` succeeds; on a refusal the current drawing stays. New bench ids skip any id already in the document.
