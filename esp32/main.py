# FlowPy static-site host for MicroPython (ESP32, RP2040 w/ wifi, etc.)
#
# Serves index.html/css/js/fonts straight from the board's filesystem over
# plain HTTP, so the editor can be opened from a phone/laptop browser --
# WiFi and WebREPL (the wireless deploy/patch/telemetry channel) are
# already up by the time this runs, brought up in boot.py.
#
# Deploying a FlowPy program interrupts THIS script the same way Ctrl-C
# would over a USB REPL -- the deployed program becomes the new foreground
# script and this file server stops responding to new page loads until the
# board is reset. The browser tab that did the deploying keeps working
# throughout, though: it's already loaded, and it talks to the board over
# the WebREPL connection from here on, not by re-fetching pages.
import os
try:
    import uasyncio as asyncio
except ImportError:
    import asyncio

CONTENT_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
    '.py': 'text/x-python',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
}


def content_type(path):
    for ext, ctype in CONTENT_TYPES.items():
        if path.endswith(ext):
            return ctype
    return 'application/octet-stream'


async def handle(reader, writer):
    try:
        req = await reader.readline()
        if not req:
            return
        try:
            _, path, _ = req.decode().split(' ', 2)
        except ValueError:
            path = '/'
        while True:
            line = await reader.readline()
            if not line or line in (b'\r\n', b'\n'):
                break
        path = path.split('?', 1)[0]
        if path == '/' or not path:
            path = '/index.html'
        if '..' in path:
            path = '/index.html'
        fpath = path.lstrip('/')
        try:
            size = os.stat(fpath)[6]
        except OSError:
            body = b'404 not found'
            writer.write(('HTTP/1.0 404 Not Found\r\nContent-Type: text/plain\r\n'
                           'Content-Length: %d\r\nConnection: close\r\n\r\n' % len(body)).encode())
            writer.write(body)
            await writer.drain()
            return
        writer.write(('HTTP/1.0 200 OK\r\nContent-Type: %s\r\n'
                       'Content-Length: %d\r\nConnection: close\r\n\r\n' % (content_type(fpath), size)).encode())
        await writer.drain()
        with open(fpath, 'rb') as f:
            while True:
                chunk = f.read(1024)
                if not chunk:
                    break
                writer.write(chunk)
                await writer.drain()
    except Exception as e:
        print('request error:', e)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def main():
    await asyncio.start_server(handle, '0.0.0.0', 80)
    print('FlowPy serving on port 80')
    while True:
        await asyncio.sleep(3600)


try:
    asyncio.run(main())
except KeyboardInterrupt:
    pass
