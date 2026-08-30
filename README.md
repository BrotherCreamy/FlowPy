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

It's also a PWA (`manifest.webmanifest` + `sw.js`) — installable, and once loaded once it caches its own app shell so it keeps working with no network at all (the offline "fast" simulator engine already needs none; this just means the page itself doesn't either). Service workers only register on a secure context (`https://`, `file://`, `localhost`), so this applies when hosting on a real site or dev server — not to the plain-`http://` ESP32 hosting case below, which doesn't need it anyway since nothing there comes from the internet to begin with.

## What it does

| Requirement | How |
|---|---|
| Position is computed, never stored | No x/y is ever saved. Every render lays the whole diagram out fresh from two things only: which block feeds which (its column) and the order blocks appear in the underlying model (its row). **Everything still lands on a 20 px grid** |
| No arbitrarily long wires | A block fed by a forward wire always sits at **exactly** the minimum distance from its source — never more slack than that, and never less |
| Deterministic order, not free placement | A block with nothing feeding it forward — the start of an unconnected island — always aligns to the same leftmost column; there's no free-floating starting x. Between blocks whose order isn't already pinned by a wire (different islands, or parallel branches), whichever comes first in the underlying order runs first |
| Dragging reorders, it doesn't place | Grab a block and everything it feeds moves with it as one unit (**Alt-drag** moves just that block). As you drag past another block or island they visibly swap places, live, before you let go — release to commit the new order, and the generated code follows immediately |
| Disconnecting never repositions | Cutting a wire between two islands doesn't touch either island's place in line — nothing shifts except the piece that just became free, which takes the next open row, the same way deleting a line shifts the ones below it and nothing above it |
| Join outputs and inputs with wires | Drag output port → input port. Drag off an input to detach. Wires are **straight orthogonal runs** with the vertical shaft pushed as far left as it goes (one unit clear of the output) and a 45° corner half a unit by half a unit at every turn — stub, corner, shaft, corner, stub. Obstructed wires fall back to an A* search around the blockage, still preferring left-hand verticals |
| A second wire onto a used input merges | Wiring a second signal onto an input that's already fed splices in a small auto-managed **OR** (boolean) or **ADD** (numeric) block so both reach it, chaining further for a 3rd+ source, and collapsing back to a plain wire once disconnected down to one |
| Direction = timing | A wire running **left→right** is evaluated in the **same scan**. A wire's direction is never a choice — connecting an output to the input of a block that's already upstream of it (directly, or through a chain) automatically becomes feedback: drawn dashed with a `↺ z⁻¹` tag, carrying the **previous scan's** value, because that's the only thing the connection could mean. Anything else reads forward |
| Click a block's type name to retype it | Matches an existing type's name to switch to it (with its ports and params); an unknown name creates a fresh type of the same kind and switches to that. Double-click opens the full type editor |
| New FB / F types in Python | `+F` / `+FB`, Type tab → *Python source*. F = one function body, FB = `__init__` + `step` |
| New FB / F types as flow diagrams | Type tab → *Flow diagram* → "Open flow implementation". IN/OUT nodes appear automatically from the port list. Nests arbitrarily deep |
| Variable references | An FB type can declare named reference slots (Type tab), bound per-instance to a variable in the Inspector. The block's own code gets the variable's name and reads/writes it via `getattr`/`setattr(V, self._ref_X)` on its own terms, instead of a value copied in/out every scan |
| Boolean wire state | Square ports; wire glows green when TRUE, dim when FALSE |
| Analog wire state | Round ports; auto-scaled blue→amber→red colour ramp, thickness follows magnitude, live numeric label on the wire |
| Live debugging | Every signal streams back from the board each telemetry period. Values also show in the Inspector, in a tooltip next to the pointer when you hover a wire/input, and inside composite blocks (with an instance picker when a block is used more than once) |
| On-the-fly editing | **Live patch ⚡** re-sends the program into the running loop over the same serial link — Python bodies, parameters, even new blocks — without resetting block state |
| Variables | Vars tab: name, type, initial value. A variable is a plain box with just its name — no ports shown until you hover it, or permanently once something's wired to it. Live values shown, and `⇢` forces a value onto the running device |

## Running it

**Simulate ▶** — two engines, chosen with the dropdown:
- *Python (Pyodide)*: runs the exact generated MicroPython in the browser with a `machine` shim (virtual pins, synthetic ADC). Downloads Pyodide from a CDN on first use.
- *fast (offline)*: a native interpreter over the same graph. Builtin blocks are exact; user Python blocks are supported when the body is a single `return <expr>`. Needs no network, starts instantly, and applies edits live with no deploy.

**Connect device ▶ Deploy** — Web Serial (Chrome/Edge desktop). Works with any board running MicroPython (ESP32, RP2040, STM32…); nothing needs to be installed on the board. FlowPy interrupts whatever is running, enters the raw REPL, uploads the generated program and starts it.

**Running entirely from an ESP32** — see [esp32/README.md](esp32/README.md): connect to the board's WiFi, open its IP for the full editor, then Connect device/Deploy/Live patch all work wirelessly too (over MicroPython's built-in WebREPL) — no USB cable, no dev-machine server, no second board.

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

## Layout is a pure function of the diagram

There is no stored position anywhere in a project file — no x, no y, no special layout section. `computeLayout()`
(`js/model.js`) derives every block's coordinates from scratch on every render, from exactly two things:

- **x — dependency depth.** A block sits exactly `MINGAP` right of the rightmost thing that forward-feeds it. A block
  with no forward source pins to the same leftmost column instead of floating free. Single deterministic pass in
  topological order; nothing to iterate or converge, because there's nothing to correct — it's computed right the
  first time.
- **y — row order.** Driven purely by the order blocks appear in the underlying node list, the only place "where
  things are relative to each other" is recorded at all. A block chained by exactly one forward wire to a single
  consumer keeps its source's row, so a straight run reads as one line; a fan-out gives every further branch, and
  every root with nothing feeding it, the next free row, in the order they appear in that list.

Because x strictly increases along a forward chain, the same-scan graph is acyclic **by construction**, and because two
blocks can only ever share a row by being on that same chain, overlap is impossible by construction too — there's no
separate collision pass, because there's nothing left for one to catch.

**Dragging is reordering, not placement.** It edits the one thing that *is* stored — the order of that node list — not
a pair of coordinates. Grab a block (and everything it feeds moves with it) and, as you drag past a sibling or another
island, the live preview shows them swapping places by re-running `computeLayout()` against the order the drag would
produce if released right now; letting go commits it. x is never touched by a drag — it's always exactly whatever the
current wires require, before, during, and after.

This is also what makes disconnecting safe: cutting a wire doesn't edit the node list, so an island's row can only ever
shift because something *else* just became its own root and needed a row of its own — never because it was, itself,
touched. Nothing jumps.

**Wire direction works the same way — computed, not stored-then-corrected.** Whether a wire is forward or feedback is
decided once, when it's made, by asking "would treating this as forward close a same-scan loop?" (is the wire's source
already reachable from its target through existing forward wires?) — if so it's feedback, right-to-left, drawn dashed
with a `↺ z⁻¹` tag, and it becomes a `self._z<node>_<port>` attribute in the generated Python: read into a local at the
top of `step()`, written back at the end. The demo includes a self-resetting counter built this way
(`COUNTER → A > B → back into rst`), which ramps 0…5 and rolls over — reaching 5 rather than 4 precisely because the
reset arrives one scan late. Anything else is forward, same scan. That decision is never revisited from geometry after
the fact — geometry is downstream of it, not the other way around, so there's no chicken-and-egg between "where is it"
and "what does the wire mean."

The **DELAY z⁻¹** block is still there for when you want an explicit delay on a forward-running wire.

## Save / open

Projects are plain JSON (`Save` / `Open…`). Ctrl-S saves. Nodes still carry `x`/`y` fields in the saved file (a
harmless byproduct of serializing live objects), but nothing on load ever reads them as truth — the first render calls
`computeLayout()` and overwrites them unconditionally, same as every other render.
