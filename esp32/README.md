# Running FlowPy entirely from an ESP32

Connect to the board's WiFi, open its IP, build a graph, and deploy/patch it
wirelessly — no USB cable, no dev-machine web server, no second board.

## How it fits together

- **boot.py** joins your WiFi (or starts an access point if none is
  configured) and starts MicroPython's built-in **WebREPL** — a
  WebSocket-tunneled REPL at `ws://<board-ip>:8266/`. This is the same
  raw-REPL byte stream Web Serial normally gets over USB: `\x01`/`\x04`
  control bytes, `!T`/`!L`/`!E`/`!K` telemetry lines, `P`/`V`/`Q` commands.
  It's wired into MicroPython below the level of whatever script owns the
  foreground, so it keeps working across a Deploy.
- **main.py** serves the FlowPy editor itself (index.html/css/js/fonts)
  over plain HTTP on port 80.
- **js/device.js**, unchanged in its deploy/patch/telemetry logic, gains a
  WebSocket transport alongside Web Serial. When the page is loaded from
  the board itself, there's only one connection to speak of — it's already
  open, the same way the HTTP link that served the page was — so FlowPy
  connects to it automatically on load. No Connect device button, no port
  picker, no password field: just a status pill reading connected /
  reconnecting. (On a normal secure-context page — `file://` or a
  dev-machine server with Web Serial available — the USB flow is
  unchanged and Connect device still asks you to pick a port, since that's
  the one step a browser won't let a page do without a click.)

Because both transports feed the same `handleLine()`/telemetry pipeline,
everything that already reads live device state — wire colors, the
Inspector, the Vars tab — works identically over WiFi. There's nothing
extra to build for remote variable/state display; it's the same mechanism
USB deploys already use.

## 1. Flash MicroPython

```
esptool.py --chip esp32 erase_flash
esptool.py --chip esp32 write_flash -z 0x1000 ESP32_GENERIC-<version>.bin
```

Get the firmware from micropython.org/download. Standard ESP32 builds
include `webrepl`/`websocket_helper` already — nothing extra to compile in.

## 2. Configure WiFi and the WebREPL password

Edit [wifi_config.py](wifi_config.py):
- Fill in `WIFI_SSID`/`WIFI_PASSWORD` to join your network, or leave
  `WIFI_SSID` empty for the board to start its own access point (`FlowPy` /
  `flowpy123` by default).

Edit [webrepl_cfg.py](webrepl_cfg.py) if you want a WebREPL password other
than the default `flowpy` — keep it matching the password field that
appears in the IDE toolbar when it auto-switches to WiFi mode.

## 3. Upload everything

```
mpremote cp index.html :index.html
mpremote cp manifest.webmanifest :manifest.webmanifest
mpremote cp icon.svg :icon.svg
mpremote cp sw.js :sw.js
mpremote cp -r css :css
mpremote cp -r js :js
mpremote cp -r fonts :fonts
mpremote cp esp32/boot.py :boot.py
mpremote cp esp32/main.py :main.py
mpremote cp esp32/wifi_config.py :wifi_config.py
mpremote cp esp32/webrepl_cfg.py :webrepl_cfg.py
mpremote reset
```

(rshell/ampy/Thonny work too — just preserve the `css/`, `js/`, `fonts/`
folder structure, since `index.html`/`css/style.css` reference files by
relative path.)

## 4. Use it

1. Connect your laptop/phone to the board's WiFi (its own AP, or the same
   network you configured it to join).
2. Watch the board's serial console once (`mpremote` prints it after
   `reset`) for the IP it's serving on, or just try `http://192.168.4.1/`
   for AP mode.
3. Open that address in Chrome or Edge — you get the full FlowPy editor,
   and the status pill in the toolbar reads **connected** within a second
   or two, automatically. Nothing to click.
4. Build your graph.
5. **Deploy ▶** — the board starts running your program immediately,
   wirelessly.
6. **Live patch ⚡** re-sends edits into the running program without
   resetting its state, same as over USB. Wire colors, the Inspector, and
   the Vars tab update live the same way too.

If the pill ever reads **reconnecting…**, FlowPy lost the WebREPL link
(board reset, out of range) and is retrying every few seconds — it
reconnects on its own the moment the board is reachable again, since it's
still the same one link the page itself depends on.

## Things worth knowing

- **Reloading the page after Deploy won't work** until the board is reset —
  Deploy interrupts `main.py` (the file server) the same way Ctrl-C would
  over a USB REPL, and the deployed program becomes the new foreground
  script. The tab you deployed from keeps working fine (it's already
  loaded, and talks to the board over the WebREPL connection, not by
  re-fetching pages) — just don't refresh it mid-session unless you're
  ready to power-cycle the board afterward.
- **No real security beyond the WebREPL password** — anyone on the same
  WiFi network (or joining the board's AP) who knows it can drive the
  board. Fine for a hobby/lab setup; don't expose the AP beyond a trusted
  network.
- **A deployed program isn't persisted** — it runs from RAM, same as a USB
  deploy. Power-cycle the board and you're back to `boot.py` + `main.py`
  (WiFi/WebREPL + the file server) automatically.
- If your firmware build genuinely lacks `webrepl` (unusual for a stock
  ESP32 build), `boot.py`'s `import webrepl` will fail at boot — check
  MicroPython's WebREPL docs for enabling it in your build.
- The IDE is a PWA (`manifest.webmanifest` + `sw.js`) and can cache itself
  for fully offline loading — but Chrome only allows a page to register a
  service worker on a "secure context" (`https://`, `file://`, or
  `localhost`), and `http://<board-ip>/` doesn't qualify, so that caching
  won't actually activate here. It doesn't matter for this setup though:
  the page is already being served locally with nothing fetched from the
  internet, so there's nothing for it to cache you don't already have.
  The service-worker caching is for the other use case — hosting FlowPy on
  a real HTTPS site, or a dev server, where you want it installable and
  usable with no network at all.
