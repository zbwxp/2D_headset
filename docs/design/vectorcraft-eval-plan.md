# VectorCraft evaluation plan

**Requirement:** bowen 1791628701: "行 就是评估一下它重点不要动我们现有的任何系统，可以为它单独制定一套知识图谱方便于我们的进行对照". Scope and acceptance agreed with dot (1791628569, 1791628621).

## Hard boundaries

- **No existing system of ours is changed:** code, configuration, the core knowledge graph (the walkthrough), services. That covers headset-core, the headset workspace, the bench on 5190, the proto worktrees and dot's folder. In headset-design, nothing existing is edited.
- **The only additions are new, standalone documents** in headset-design `docs/design/vectorcraft-*.md` (this plan, the VectorCraft graph, the report). They stay there, rather than only in the evaluation folder, so dot can review them on GitHub (zbwxp/2D_headset, `design/architecture`). They reference nothing of ours as changed (dot 1791628937, point 1).
- **Everything that runs happens in a new folder,** `~/Documents/vectorcraft-eval/`: a clone of github.com/storytold/vectorcraft at commit `5b198f3c009c07d7729ac92152940dd537022551`, its build, and raw run output (screenshots, exported documents).
- **No code of theirs goes into ours** in this round.
- **Clean-room courtesy:** we only read their public repository and run their app.

## Steps

1. **Clone and record the commit.**
   - Check the toolchain VectorCraft itself requires (its `Cargo.toml` / `rust-toolchain` / docs; dot 1791628621), against local cargo 1.89.
   - Build the desktop app in release, in the background.
2. **The VectorCraft graph** (bowen: "单独制定一套知识图谱"), in `docs/design/vectorcraft-graph.md`.
   - Rows in our format: subject | relation | object | evidence (`path:line` at the recorded commit).
   - Sections mirror ours so they can be read side by side: points and lines (anchors, paths, handles); continuous curves / paths; joins and corners; links; closed curves and fills; layers; locks; undo and transactions; editing (selection, transforms); interaction (tools, Begin / Preview / Commit); names; save and open.
   - **Facts only, no judgements.** A section with no counterpart says so.
3. **The flow test** (dot 1791628569), driven through its control channel (`--control <port>`, JSON lines) with screenshots:
   1. two lines that share an end point;
   2. drag that point (do both lines follow?);
   3. split one line;
   4. undo, and undo again.
   Recorded at each step:
   - Can it express a *shared* end point, or only two coinciding anchors (or a joined path)?
   - Does that survive the split and the undos?
   - **Identity, not only pictures** (dot 1791628937, point 2): after each step, export the document and record each end point's identity / references and the connections between paths. Two points with equal coordinates moving together must not be taken for a native shared end point.
   - **Model commands vs real dragging:** label each step as either a command that edits the model directly, or a simulated pointer gesture on a tool (if the control channel offers tool events). Only the latter counts as "dragging verified".
4. **Report**, in `docs/design/vectorcraft-eval-report.md`:
   - **Native** (what VectorCraft already does) apart from **the relation layer we would add** (bindings, end-point / mirror links, 骨线, angle / expression animation), with the touch points and rough size of that layer;
   - which of the four outcomes the evidence supports (replace; keep our relation layer on its geometry and editing; its UI and rendering on our core; ideas only);
   - what this round **cannot** say (dot 1791628621): total savings for the whole project.

## Writing rules (dot 1791628937, point 3)

- **Negatives:** a feature not found is written "not found in this check", never "not supported".
- **Pinning:** source evidence is pinned to the full commit hash above.
- **Run results vs source reading:** results of actually running the app are reported apart from conclusions inferred from reading source.

## Not in this round

Porting, WASM bindings to our TypeScript, performance measurement, or any decision. bowen decides after the report.
