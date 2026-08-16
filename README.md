# FlowPy — browser node/flow IDE that deploys MicroPython

One file: `flowpy.html`. Open it in Chrome or Edge (double-click, or serve it). No install, no build, no server.

## What it does

| Requirement | How |
|---|---|
| Drag blocks around | Drag from the palette onto the canvas; drag headers to move; wheel to zoom, background-drag to pan. **Everything is on a 20 px grid** — positions, block widths/heights, and every port centre, so nothing can sit off-grid |
| Join outputs and inputs with wires | Drag output port → input port. Drag off an input to detach. One source per input. Wires are **straight orthogonal runs** with the vertical shaft pushed as far left as it goes (one unit clear of the output) and a 45° corner half a unit by half a unit at every turn — stub, corner, shaft, corner, stub. A downstream block sits at least **two units** clear of its source, exactly the room those pieces need. Obstructed wires fall back to an A* search around the blockage, still preferring left-hand verticals |
| Blocks keep their relationships | Dragging a block carries everything it feeds (transitively) by the same Δx/Δy, so chain spacing survives edits; upstream stays put. **Alt-drag** moves one block alone. Every drag is clamped so no wire can change type — you cannot push a block behind a block it takes input from, and a feedback wire cannot be flattened into a same-scan one. Y is never constrained |
| Direction = timing | A wire running **left→right** is evaluated in the **same scan**. A wire running **right→left** is drawn dashed violet with a `↺ z⁻¹` tag and carries the **previous scan's** value. Feedback is just a backwards wire — no special block needed |
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

Each wire records its type when you draw it, and the editor guarantees geometry keeps agreeing: drags are clamped
(bounds are computed once per drag from every wire crossing the moving set, so it costs nothing per frame), and if a
block gets wider — you added ports to one of your own types — its dependents are pushed right until every forward wire
points forward again.

The **DELAY z⁻¹** block is still there for when you want an explicit delay on a forward-running wire.

## Save / open

Projects are plain JSON (`Save` / `Open…`). Ctrl-S saves.
