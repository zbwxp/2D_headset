# A second layer order for yaw < 0: checklist before any code, for dot's review

## The ask
- **bowen 1791995249:** a mask alone does not make the side face (侧脸) a sheet standing off the face. Turning left needs one stacking order, turning right another. For now, simplified: the layer order at positive yaw may differ from the order at negative yaw.
- **bowen 1791996722:**
  - yaw 0 may use either order; I decide → **yaw ≥ 0 uses today's order**;
  - masks stay as they are: not ordered or switched by view for now.

## What it replaces
`docs/meta-views-plan.md` (bowen 1791650085, Q3): layer, group and fill order are shared by every view, and per-view order is "maybe later". This changes it for **layers only**:
- curve (group) order inside a layer stays shared;
- fill order stays shared.

## 1. Data
- **Today's order:** the network's `layers` list (bottom → top) stays as it is. It is the order for yaw ≥ 0.
- **The left order:** a new optional `leftOrder: Id[]` in the network store, a permutation of the layer ids (bottom → top), used for yaw < 0.
  - Absent means "the same as today's order", which is how every existing drawing opens.
- **The file:**
  - **archive 12 → 13:** a 12 reader would silently ignore `leftOrder` and stack wrongly, so it must refuse;
  - `legacy.fromV12` is identity;
  - **open checks** that `leftOrder`, when present, holds exactly the layer ids, each once.

## 2. Which order a read uses
- **A view's reader** (`core.in(view)`): views at yaw −90 use the left order; yaw 0 and +90 use today's.
- **A pose's reader** (`atPose`, `previewAt`): yaw < 0 uses the left order, yaw ≥ 0 today's. `posedState` is a private copy, so the copy's `layers` list simply takes the left order.
- **What follows the order:**
  - the snapshot's `layers`;
  - `groups`, which `groups.list` flattens in layer order, so the bench's stacking of fills, ink, lines and halos follows it.
- **Unchanged:**
  - hit-testing (kind, then distance);
  - masks (no order);
  - `fills.order`;
  - curve order within a layer.

## 3. Edits
- **`reorderLayer(id, index)`** in a view with yaw < 0 moves the layer in the left order.
  - The first such move starts the left order as a copy of today's.
  - In other views it moves today's order, as now.
  - Effects as now (`shared: structure`).
- **A new layer** (`layer`, `copyLayer`, `above`):
  - inserted in both orders;
  - in the left order it goes directly above the same layer, else on top.
- **A layer removed:** removed from both orders.
- **New: `resetLeftOrder()`.** Drops the left order, so yaw < 0 stacks like yaw ≥ 0 again. One undo step.
- **Playback** does not reorder layers: the gate refuses `reorderLayer`, as today.

## 4. Bench
- **The layers panel** shows the order of the view (or pose) on screen. Its drag reorders that order.
- **A note above the list** when the view or pose has yaw < 0:
  - 「左转顺序（yaw < 0）」 while the left order differs;
  - 「左转顺序（目前同右转）」 while it does not;
  - plus a button 「左转顺序恢复成跟右转一样」 (`resetLeftOrder`).

## 5. Evidence
**Core:**
- with no left order, every view and pose stacks as today, and a file without it opens equal;
- a reorder in view −90 changes the left order only: views 0 / +90 and poses with yaw ≥ 0 keep today's order, while views −90 and poses with yaw < 0 use the new one; one undo step;
- new / copied / removed layers keep both orders permutations;
- `resetLeftOrder` and undo;
- save / open round trip (archive 13);
- a v12 file opens and saves as 13;
- a bad `leftOrder` (missing, extra, repeated id) is refused.

**Bench:**
- with 侧脸 above 左眼 for yaw ≥ 0 and below it for yaw < 0, the canvas stacks them differently in views +90 and −90 and at playback ±30;
- the panel shows each view's order and its note.

**Screenshot:** a pose at +60 and at −60 with the two stackings.
