# Runs once at every power-on/hard-reset, before main.py -- brings up WiFi
# and WebREPL (MicroPython's built-in wireless REPL, ws://<ip>:8266/).
#
# This is what makes wireless deploy/patch/telemetry survive Deploy
# replacing main.py: both WiFi and WebREPL are wired into MicroPython below
# the level of whatever script currently owns the foreground, so once
# they're up here they keep working no matter what main.py (FlowPy's own
# static file server) or a later deployed FlowPy program does.
import network
import webrepl
from wifi_config import WIFI_SSID, WIFI_PASSWORD, AP_SSID, AP_PASSWORD


def start_network():
    if WIFI_SSID:
        sta = network.WLAN(network.STA_IF)
        sta.active(True)
        if not sta.isconnected():
            print('connecting to', WIFI_SSID, '...')
            sta.connect(WIFI_SSID, WIFI_PASSWORD)
            import time
            for _ in range(40):
                if sta.isconnected():
                    break
                time.sleep(0.5)
        if sta.isconnected():
            print('joined wifi -- open http://%s/ in Chrome or Edge' % sta.ifconfig()[0])
            return
        print('could not join "%s" -- falling back to access point' % WIFI_SSID)
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    ap.config(essid=AP_SSID, password=AP_PASSWORD, authmode=network.AUTH_WPA_WPA2_PSK)
    print('access point "%s" (password: %s)' % (AP_SSID, AP_PASSWORD))
    print('open http://%s/ in Chrome or Edge' % ap.ifconfig()[0])


start_network()
webrepl.start()  # password comes from webrepl_cfg.py
