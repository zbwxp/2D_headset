# VectorCraft: facts and what we can learn (2026-10-10)

For bowen 1791625088 ("你们查一下getartcraft这个网站 据说用ai重写了ps illustrator之类的…从这里能吸取到什么经验").

**Correction.** Claude first looked only at **ArtCraft** (github.com/storytold/artcraft, an AI image / video tool) and concluded "no vector editing, little help for our core" (1791625150). dot (1791627854) found the team's vector editor, **VectorCraft**. That earlier conclusion is withdrawn.

Facts below are from pages Claude opened: the VectorCraft README and `AGENTS.md`. Quotes are short.

## What it is

- **What it says it is:** "an open-source, clean-room reimplementation of Adobe Illustrator, rebuilt in pure Rust". It runs natively on macOS / Windows / Linux / FreeBSD, and in the browser via WebAssembly. Siblings: PhotoCraft (Photoshop-class), PDFCraft. Built by the ArtCraft team.
- **Licence:** code and original assets are MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`). The ArtCraft logos in `docs/brand/` are trademarks, not open source.
  - **ArtCraft's licence, resolved (dot 1791627930):** commit `8abde751` (storytold/artcraft, today 08:14 UTC) changed it from a custom "fair source" `LICENSE.md` to MIT / Apache-2.0 with a `NOTICE`. dot had read the page from before that commit; Claude (1791627873) had read the current `main`. Third-party material is still checked against `NOTICE`.
- **Features (README):**
  - Pen and Direct Selection with "real Bézier anchors and handles";
  - **Live Blends** ("editable key paths, smooth colour"), i.e. interpolation between paths;
  - **Envelope Distort** (warping shapes through an envelope);
  - Gradient Mesh, Perspective Grid, exact curve booleans (Pathfinder);
  - unlimited undo via structural sharing;
  - a documented JSON native format with property-tested file round trips;
  - SVG / PDF import and export.
- **Agent-native:** "Every menu item, tool gesture, panel and dialog can be driven over a JSON control channel and an MCP server".

## Rules in its `AGENTS.md` that match our problems

| VectorCraft rule (quoted / summarised) | Ours today |
|---|---|
| "Everything is a command": each user-visible behaviour is a command (id, label, menu path, shortcut, params doc, `enabled`, `run`) plus tests. "Tools emit commands (Begin/Preview/Commit)." | Graph "Interaction": unfinished operations are cancellable and committed atomically; core edits are one transaction. There is no single registry of named commands; the bench wires buttons and keys by hand (cf. inbox #20, blocked shortcuts). |
| "Layering is enforced by `cargo xtask layers`. Nothing below L6 depends on" UI libraries. | "Graph modules must not be polluted"; one interaction test checks imports. Not a general CI layering check. |
| "The UI is thin: panels read engine state and act through `app.run(id, params)`." | The visual package reads core types and acts through callbacks; the bench is glue. |
| "Never crash": `Result` everywhere; a guard catches a panic, rolls the document back and reports; untrusted input is fuzzed. | Core refuses with codes and is atomic; no fuzzing. |
| Clean-room: behaviour only from public documentation, "cited by URL". | Our "evidence before claims" rule. |
| One file for agents (`AGENTS.md`, `CLAUDE.md`) with structure, rules and quality gates. | Inbox #30 (bowen: use later, when optimising interaction). |

## What we can learn (Claude's reading; for discussion)

1. **A command registry.** Name every user action once (id, label, shortcut, enabled, run), and let buttons, keys and agents all call it. This would settle "shortcuts never blocked" (#20) and the tool / button confusion at the root. It matches our Begin / Preview / Commit flow.
2. **Automated layering.** Turn "graph modules are never polluted" into a check that runs every time, as their `xtask layers` does.
3. **Live Blends and Envelope Distort are the closest open, permissively licensed relatives** of our in-betweening and deformation.
   - Their code may show how they pair the points of two paths (correspondence) and how an envelope carries a shape.
   - Not read yet; Rust / egui / WASM, so ideas, not code, unless ported with attribution under MIT / Apache.
4. **An agent control channel** (every command over JSON / MCP) would let dot and Claude drive the real bench in checks, instead of jsdom alone.
5. **The rules file** (inbox #30): theirs is the model to follow.

## Bézier foundations (bowen 1791628328: "有没有更优秀的贝塞尔曲线基座的开源软件存在？最近用ai重写的")

Claude 1791628397; repo pages opened unless marked.

- **VectorCraft's own foundation.** Its curves come from **kurbo 0.13** and its rendering from **vello_cpu** (its `Cargo.toml`). Its own crates (`geom`, `pathops`, `doc`, `render`…) sit on top.
- **kurbo** (github.com/linebender/kurbo):
  - "A Rust 2D curves library" for curves and vector paths, focused on accuracy, with analytical solutions where practical (area by Green's theorem);
  - "still in fairly early development"; "Licensed under either of" two licences (dual).
  - Its README names similar crates: **lyon_geom** (many vector algorithms, focused on rendering), **flo_curves** ("good Bézier primitives, and seems tuned for animation"), **vek** (game engines).
- **Graphite** (github.com/GraphiteEditor/Graphite): "a free, open source vector and raster graphics engine", node-based, aiming at real-time motion graphics; alpha. Licence not checked (Apache-2.0 from memory).
- **JS (from memory, unchecked):** Paper.js, Pomax's bezier.js.
- **For us:**
  - Our core is TypeScript with its own curve maths (e.g. nearest point by quintic roots); these are mostly Rust.
  - Use them to borrow algorithms and compare accuracy: kurbo's arc length / nearest point / offset; flo_curves' interpolation; VectorCraft's Live Blends correspondence.
  - kurbo is a ready base if the core ever moves to Rust + WASM. No change proposed now.

## As a possible editor base (dot 1791628473, 1791628510; Claude 1791628493)

- **Withdrawn:** Claude's "Rust, so ideas only". VectorCraft is MIT / Apache (forkable) and already builds to WebAssembly, so it is a real candidate base.
- **Key check (Claude):** does its document model hold our *network* (shared end points, bindings, joins, end-point and mirror links, fills on closed loops; graph) or only Illustrator-style *paths*?
- **dot:** don't presume. Even if it does not hold networks natively, our relation layer might stay ours while reusing its path geometry and editing. dot maps the layer boundaries first, then the cost of adapting; no "replace everything" from a feature list alone.
- **Possible outcomes, for bowen once dot's check is in:**
  1. replace with it;
  2. keep our relation layer, reuse its geometry and editing;
  3. its interface and rendering with our core;
  4. ideas only.

**dot (1791628569):** recommends making VectorCraft a **formal base candidate**.
- It already has a whole editor (pen / anchors and handles, snapping, layers, undo, path booleans, import / export) with engine and UI apart.
- WASM does not mean an interface for our TypeScript exists.
- Its own ROADMAP still lists interaction, stability and performance as to be verified; not shown more reliable than our core.
- Its paths are anchor chains (`crates/geom/src/path.rs`); no shared-end-point network seen. Curve operations, path operations and rendering may still be reused, with our relations kept.
- **The real cost** is keeping correspondence through splits, joins and deletes, undone together.
- **Next:** test one small flow, not feature lists: two lines sharing an end point → drag linked → split → undo.

**Claude (1791628602):** agrees; asked bowen to approve the experiment (plan first).
- **Questions it answers:**
  1. Can it express a shared end point, or only two coinciding points?
  2. Does sharing survive split and undo?
  3. If not, roughly how much changes to hang our relation layer on its paths?
- **Setup:** a separate folder clone, driven through its control channel. Rust toolchain present (cargo 1.89). None of our repositories touched.

**dot (1791628621), acceptance for the experiment:**
- Report "native in VectorCraft" separately from "relation layer we would add". A missing native shared end point does not by itself make it unfit.
- This round judges integration difficulty and whether to continue; it does not yet say precisely how much work the whole project saves.
- The toolchain requirement is VectorCraft's own, not kurbo's.

## Closed (bowen 1791633410)

- **Decided by bowen:** no experiment and no Rust install; VectorCraft may itself be unsupervised AI code. Its own ROADMAP also lists interaction and stability as unverified.
- **Outcome:** ideas only.
- **Candidate principles for our interaction** (Claude 1791633438; into the graph only when bowen says "写"):
  1. **Every user action is one named command, registered once** (name, shortcut, when enabled, what it does).
     - Buttons, keys, menus and any outside control only call it.
     - Tools with a process (drag, pen) only issue start / preview / commit / cancel.
     - Answers: inbox #20 (shortcuts blocked by focused buttons); "what is a tool vs an edit"; each command testable alone.
  2. **Module boundaries are checked by machine on every commit, not by memory.** Makes "graph modules are never polluted" automatic: core depends on neither interaction nor visual; interaction does not depend on visual.
- **Already ours:** one edit = one undo step with whole rollback on error (graph); the UI reads state and acts through callbacks (visual package).

**dot (1791633744): keep both, tighter, so no big framework grows.**
1. **One execution rule per operation, shared by every entry.** Delete, flip, switch tool…: buttons, menus and shortcuts share one logic and one "when enabled". Mouse moves, hovers and panel toggles are not commands; not every command enters the document's undo.
2. **Tools handle the interaction process; the existing edit transactions change data.**
   - Tools still hold hit-testing and gesture logic.
   - Drags go begin / preview / commit / cancel into the existing undo and rollback.
   - One-step actions (delete) are not forced into four phases.
   - No second history system.
3. **Module boundaries checked automatically; behaviour guarded by tests.**
   - core depends on neither interaction nor visual; interaction does not depend on visual.
   - The check covers aliases, re-exports and indirect dependencies, and runs in the shared pre-commit gate (CI), not only local hooks.
   - Cancel restoring, previews not polluting undo, etc. stay behaviour tests; a passing dependency check does not replace them.

**Key correction to Claude:** a command table alone does not fix the focused-button problem (#20). The key is stopped at input routing, before any command. Focus, input-field protection and shortcut priority need explicit rules.

**Claude (1791633773):** agrees; withdraws "solves #20" and "tools write no logic". Posted the three tightened principles to bowen, plus a separate to-do: rules for focus, input-field protection and shortcut priority. Into the graph (Interaction) only when bowen says "写".

**dot (1791633792), wording:**
- Principle 1 says mouse moves, hovers and panel toggles **need not all be** commands, not that they may never be.
- The focus / input-field / shortcut-priority rules join the later interaction cleanup. The focused-button bug of #20 is already fixed (core/v1 `287da8f`) and is not reopened.
