# FlowPy — browser node/flow IDE that deploys MicroPython

Static site, no build step: `index.html` + `css/style.css` + `js/*.js`. Open `index.html` in Chrome or Edge, or serve the folder — no install, no build required.

```
FlowPy/
├── index.html        markup only
├── css/style.css      all styles
└── js/
    ├── model.js       project model, builtin block library, grid geometry
    ├── editor.js       canvas/palette UI, drag & wire interactions, inspector, tabs
    ├── router.js       orthogonal wire routing (A* around obstacles)
    ├── codegen.js       MicroPython code generator + runtime prelude
    ├── sim-fast.js       offline JS interpreter for the same graph model
    └── device.js        Web Serial device I/O, Pyodide simulator, project save/load, demo project, boot
```

Files are loaded as plain (non-module) scripts in dependency order and share one global scope, same as the original single-file build — just split along its existing section boundaries.

## What it does

| Requirement | How |
|---|---|
| Drag blocks around | Drag from the palette onto the canvas; drag headers to move; wheel to zoom, background-drag to pan. **Everything is on a 20 px grid** — positions, block widths/heights, and every port centre, so nothing can sit off-grid |
| Blocks never overlap | Dropping or dragging a block onto another **pushes the blocks in the way aside**, keeping at least one grid cell clear on some axis. The block you're placing is authoritative — everything else yields |
| No arbitrarily long wires | A block fed by a forward wire always sits at **exactly** the minimum distance from its source (two grid cells) — never more slack than that. Drag a connected block further away and it snaps straight back the moment you release it |
| Deterministic order, not free placement | A block with nothing feeding it forward — the start of an unconnected island — always aligns to the same leftmost column; there's no free-floating starting x. Between blocks whose order isn't already pinned by a wire (different islands, or parallel branches), whichever sits higher (smaller y) executes first — dragging above/below a sibling is what reorders them, live, as you drag, and the generated code reflects the new order the moment you let go |
| Join outputs and inputs with wires | Drag output port → input port. Drag off an input to detach. One source per input. Wires are **straight orthogonal runs** with the vertical shaft pushed as far left as it goes (one unit clear of the output) and a 45° corner half a unit by half a unit at every turn — stub, corner, shaft, corner, stub. Obstructed wires fall back to an A* search around the blockage, still preferring left-hand verticals |
| Blocks keep their relationships | Dragging a block carries everything it feeds (transitively) by the same Δx/Δy, so chain spacing survives edits; upstream stays put. **Alt-drag** moves one block alone |
| Direction = timing | A wire running **left→right** is evaluated in the **same scan**. A wire's direction is never a choice — connecting an output to the input of a block that's already upstream of it automatically becomes feedback: drawn dashed with a `↺ z⁻¹` tag, carrying the **previous scan's** value, because that's the only thing the connection could mean. Anything else reads forward |
| New FB / F types in Python | `+F` / `+FB`, Type tab → *Python source*. F = one function body, FB = `__init__` + `step` |
| New FB / F types as flow diagrams | Type tab → *Flow diagram* → "Open flow implementation". IN/OUT nodes appear automatically from the port list. Nests arbitrarily deep |
| Boolean wire state | Square ports; wire glows green when TRUE, dim when FALSE |
| Analog wire state | Round ports; auto-scaled blue→amber→red colour ramp, thickness follows magnitude, live numeric label on the wire |
| Live debugging | Every signal streams back from the board each telemetry period. Values also show in the Inspector and inside composite blocks (with an instance picker when a block is used more than once) |
| On-the-fly editing | **Live patch ⚡** re-sends the program into the running loop over the same serial link — Python bodies, parameters, even new blocks — without resetting block state |
| Variables | Vars tab: name, type, initial value. Drop GET/SET nodes on any diagram. Live values shown, and `⇢` forces a value onto the running device |

## Running it

**Simulate ▶** — two engines, chosen with the dropdown:
- *Python (Pyodide)*: runs the exact generated MicroPython in the browser with a `machine` shim (virtual pins, synthetic ADC). Downloads Pyodide from a CDN on first use.
- *fast (offline)*: a native interpreter over the same graph. Builtin blocks are exact; user Python blocks are supported when the body is a single `return <expr>`. Needs no network, starts instantly, and applies edits live with no deploy.

**Connect device ▶ Deploy** — Web Serial (Chrome/Edge desktop). Works with any board running MicroPython (ESP32, RP2040, STM32…); nothing needs to be installed on the board. FlowPy interrupts whatever is running, enters the raw REPL, uploads the generated program and starts it.

## How the generated code works

The Code tab shows it, and you can download it as a plain `.py`.

- `F` types → module-level functions. `FB` types → classes with `step()`. Composite types → classes whose `step()` runs the sub-graph.
- The whole design becomes `Main.step()`, executed in a fixed-period scan loop.
- Methods are bound after class creation (`FB_x.step = _FB_x_step`) so a live patch can replace logic while instances keep their state.
- The loop polls `sys.stdin`, so `P<json>` (patch), `V<name>=<value>` (force a variable) and `Q` (quit) work while it runs.
- Every output port writes into a flat `W[]` array which is emitted as `!T[...]` JSON each telemetry period — that is what colours the wires.

## Look

Blocks are black with a 1 px white border and a white tag line carrying the block name in black; every corner in the
editor is square. Colour is reserved for one thing only — live signal values on the wires — so a running diagram reads
at a glance: booleans green, numerics on a blue→amber→red ramp, everything else monochrome.

## Direction is the execution model

Every forward wire strictly increases x (a block's output is always to the right of its inputs), so the same-scan graph
is acyclic **by construction** — layout *is* execution order, and the code generator can never hit an unresolvable loop.

Any wire that doesn't run left-to-right becomes a one-scan delay. In the generated Python that is a `self._z<node>_<port>`
attribute: read into a local at the top of `step()`, written back at the end. The demo includes a self-resetting counter
built this way (`COUNTER → A > B → back into rst`), which ramps 0…5 and rolls over — reaching 5 rather than 4 precisely
because the reset arrives one scan late.

Each wire's direction is read off the current geometry every time, not recorded as a choice: connecting an output to
the input of a block that's already upstream of it reads back-to-front, so it's feedback; anything else is forward.
After every edit, a relayout pass pulls every forward-fed block to the exact minimum distance from its source (never
more, never less), pins every block with no forward source to the same leftmost column, and pushes apart any blocks
left overlapping — so this holds after a drag, a resize (new ports on one of your own types), or a load, not just at
the moment a wire is drawn. Among blocks whose order isn't already pinned by a wire, relative y decides who runs
first — dragging one above or below another reorders them, and the generated code follows immediately.

The **DELAY z⁻¹** block is still there for when you want an explicit delay on a forward-running wire.

## Save / open

Projects are plain JSON (`Save` / `Open…`). Ctrl-S saves.
