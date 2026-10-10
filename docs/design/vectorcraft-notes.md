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
