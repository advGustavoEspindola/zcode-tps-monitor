#!/usr/bin/env python3
# Barra de tok/s no rodape do ZCode (Linux X11, estilo DSH web).
# Linha unica centralizada abaixo do composer: texto terciario 13px nas cores
# do DSH (escuro #ADB2B8), sem fundo, instancia unica, click-through, segue a
# janela principal do ZCode e se oculta quando outra janela assume o foco.
# Requer: python3 + GTK3 (gi) + wmctrl + xprop (X11).
# Seguranca: instancia unica por socket abstrato (sem arquivo, sem caminho);
# comandos externos sao listas literais fixas (shell=False, sem variavel);
# HTTP restrito ao painel local fixo 127.0.0.1:7423 (literais, sem redirect);
# IDs de janela e numeros vindos do sistema sao validados por regex e faixa.

import json
import re
import signal
import socket
import subprocess
import sys
import http.client

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib, Pango
import cairo

PANEL_HOST = "127.0.0.1"
PANEL_PORT = 7423
PANEL_PATH = "/api/token-rate"
STRIP_H = 20
FSZ_PX = 13
OFF_Y = 30
DOT = "·"
INK_DARK = "#ADB2B8"
WID_RE = re.compile(r"^0x[0-9a-fA-F]+$")
DESK_RE = re.compile(r"^-?\d+$")

# Instancia unica: socket abstrato (namespace, nao toca o sistema de arquivos).
_LOCK = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    _LOCK.bind("\0zcode-tps-monitor-overlay")
except OSError:
    sys.exit(0)


def wmctrl_list():
    try:
        out = subprocess.run(
            ["wmctrl", "-lGx"],
            capture_output=True, text=True, timeout=5, shell=False,
        ).stdout
        return out if isinstance(out, str) else ""
    except Exception:
        return ""


def xprop_active():
    try:
        out = subprocess.run(
            ["xprop", "-root", "_NET_ACTIVE_WINDOW"],
            capture_output=True, text=True, timeout=5, shell=False,
        ).stdout
        return out if isinstance(out, str) else ""
    except Exception:
        return ""


def wmctrl_desks():
    try:
        out = subprocess.run(
            ["wmctrl", "-d"],
            capture_output=True, text=True, timeout=5, shell=False,
        ).stdout
        return out if isinstance(out, str) else ""
    except Exception:
        return ""


def find_zcode():
    best = None
    best_area = 0
    for line in wmctrl_list().splitlines():
        parts = line.split(None, 8)
        if len(parts) < 8:
            continue
        zid, desk = parts[0], parts[1]
        if not WID_RE.match(zid) or not DESK_RE.match(desk):
            continue
        try:
            x, y, w, h = int(parts[2]), int(parts[3]), int(parts[4]), int(parts[5])
            desk_i = int(desk)
        except ValueError:
            continue
        if not (0 <= w <= 10000 and 0 <= h <= 10000):
            continue
        if "zcode" not in parts[6].lower():
            continue
        area = w * h
        if area > best_area:
            best_area = area
            best = {"id": zid, "desk": desk_i, "x": x, "y": y, "w": w, "h": h}
    return best


def active_window():
    m = re.search(r"0x[0-9a-fA-F]+", xprop_active())
    if not m or not WID_RE.match(m.group(0)):
        return None
    try:
        return int(m.group(0), 16)
    except ValueError:
        return None


def current_desktop():
    for line in wmctrl_desks().splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "*" and DESK_RE.match(parts[0]):
            try:
                return int(parts[0])
            except ValueError:
                return None
    return None


def place(win_w):
    win_w = int(win_w)
    sidebar, right = 248, 0
    if win_w < 900:
        sidebar = 0
    if win_w > 1400:
        right = 360
    content_w = max(420, win_w - sidebar - right - 24)
    card_w = min(952, content_w - 48)
    strip_w = max(420, card_w - 32)
    return sidebar, content_w, card_w, strip_w


def fmt_dec(n):
    q = round(float(n), 1)
    return str(int(q)) if q == int(q) else "%.1f" % q


def fmt_dur(ms):
    s = float(ms) / 1000.0
    if s < 60:
        return fmt_dec(s) + "s"
    whole = int(round(s))
    return "%dm%ds" % (whole // 60, whole % 60)


def fmt_tps(v):
    if v is None:
        return None
    n = max(0.0, float(v))
    return str(int(round(n))) if n >= 10 else fmt_dec(n)


def fmt_tok(n):
    n = float(n)
    if n < 1000:
        return str(int(n))

    def scaled(v):
        return str(int(round(v))) if v >= 100 else fmt_dec(v)

    if n < 1000000:
        return scaled(n / 1000) + "K"
    return scaled(n / 1000000) + "M"


def format_line(d):
    if not isinstance(d, dict):
        return ""
    s = d.get("session") if isinstance(d.get("session"), dict) else None
    l = d.get("latest") if isinstance(d.get("latest"), dict) else None
    if not s and not l:
        return ""
    groups = []
    turns, steps = 0, 0
    if s:
        try:
            turns = int(s.get("turns") or s.get("requests") or 0)
            steps = int(s.get("requests") or 0)
        except (TypeError, ValueError):
            turns, steps = 0, 0
    if steps > 0:
        groups.append("%d turns %s %d steps" % (turns, DOT, steps))
        try:
            gen = float(s.get("totalGenMs") or 0)
        except (TypeError, ValueError):
            gen = 0
        if gen > 0:
            groups.append("LLM " + fmt_dur(gen))
        speeds = []
        ttft = s.get("avgTtftMs")
        if ttft is None and l:
            ttft = l.get("ttftMs")
        try:
            if ttft is not None:
                speeds.append("TTFT avg " + fmt_dur(float(ttft)))
        except (TypeError, ValueError):
            pass
        tps = s.get("tokPerSec")
        if tps is None and l:
            tps = l.get("tokPerSec")
        try:
            tps = fmt_tps(float(tps)) if tps is not None else None
        except (TypeError, ValueError):
            tps = None
        if tps:
            speeds.append("%s tok/s" % tps)
        if speeds:
            groups.append((" %s " % DOT).join(speeds))
    if s:
        try:
            total_in = float(s.get("totalInput") or 0)
        except (TypeError, ValueError):
            total_in = 0
        if total_in > 0:
            try:
                cached = float(s.get("totalCacheRead") or 0)
            except (TypeError, ValueError):
                cached = 0
            hit = int(round(100.0 * cached / total_in))
            groups.append("Cache hit %d%%" % max(0, min(100, hit)))
            try:
                out = float(s.get("totalOutput") or 0) + float(s.get("totalReasoning") or 0)
            except (TypeError, ValueError):
                out = 0
            groups.append("Input %s tok %s Output %s tok" % (fmt_tok(total_in), DOT, fmt_tok(out)))
    return " | ".join(groups)


def fetch():
    # Destino fixo: painel local do proprio plugin; http.client nao segue
    # redirect e o host e literal (sem DNS, sem entrada do usuario).
    conn = None
    try:
        conn = http.client.HTTPConnection(PANEL_HOST, PANEL_PORT, timeout=2)
        conn.request("GET", PANEL_PATH, headers={"Accept": "application/json"})
        resp = conn.getresponse()
        if resp.status != 200:
            return None
        data = json.loads(resp.read().decode("utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass


win = Gtk.Window(type=Gtk.WindowType.POPUP)
win.set_app_paintable(True)
screen = win.get_screen()
visual = screen.get_rgba_visual()
if visual:
    win.set_visual(visual)
win.set_decorated(False)
win.set_skip_taskbar_hint(True)
win.set_skip_pager_hint(True)
win.set_accept_focus(False)
win.set_focus_on_map(False)

label = Gtk.Label()
label.set_halign(Gtk.Align.FILL)
label.set_valign(Gtk.Align.CENTER)
label.set_hexpand(True)
label.set_vexpand(True)
label.set_single_line_mode(True)
label.set_line_wrap(False)
label.set_ellipsize(Pango.EllipsizeMode.END)
label.set_justify(Gtk.Justification.CENTER)
win.add(label)

css = Gtk.CssProvider()
Gtk.StyleContext.add_provider_for_screen(
    screen, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
)
try:
    css.load_from_data(
        ("label { color: %s; font-size: %dpx; }" % (INK_DARK, FSZ_PX)).encode()
    )
except Exception:
    pass


def on_draw(widget, cr):
    cr.set_source_rgba(0, 0, 0, 0)
    cr.set_operator(cairo.OPERATOR_SOURCE)
    cr.paint()
    return False


win.connect("draw", on_draw)

state = {"shaped": False}


def tick():
    try:
        z = find_zcode()
        visible = False
        if z:
            act = active_window()
            try:
                zid = int(z["id"], 16)
            except ValueError:
                zid = None
            desk = current_desktop()
            visible = (
                zid is not None
                and act == zid
                and (z["desk"] == -1 or desk is None or z["desk"] == desk)
            )
        if not visible:
            if win.get_visible():
                win.hide()
            return True
        _, content_w, card_w, strip_w = place(z["w"])
        sidebar = 248
        if z["w"] < 900:
            sidebar = 0
        card_left = z["x"] + sidebar + (content_w - card_w) // 2
        px = card_left + (card_w - strip_w) // 2
        py = z["y"] + z["h"] - OFF_Y
        px = max(z["x"] + 8, min(px, z["x"] + z["w"] - strip_w - 8))
        py = max(z["y"] + 8, min(py, z["y"] + z["h"] - STRIP_H - 8))
        win.move(px, py)
        win.resize(strip_w, STRIP_H)
        if not win.get_visible():
            win.show_all()
        if not state["shaped"]:
            try:
                win.get_window().input_shape_combine_region(cairo.Region(), 0, 0)
                state["shaped"] = True
            except Exception:
                pass
        d = fetch()
        if d:
            txt = format_line(d)
            if txt:
                label.set_text(txt)
    except Exception:
        pass
    return True


def on_term(*args):
    Gtk.main_quit()


signal.signal(signal.SIGTERM, on_term)
signal.signal(signal.SIGINT, on_term)

GLib.timeout_add_seconds(1, tick)
Gtk.main()
