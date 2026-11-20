"""Passenger announcements (PA) for /departures – the skin-independent engine.

Three PAs, one of each type (spec: Matrixbox project, claude/pa-spec.md v3):

  fs  Full-screen  every panel row is fixed or scrolling text; replaces the
                   departures; start now / at a time, end never / at a time.
  sc  Scrolling    one scrolling text in the bottom row, loops endlessly;
                   start now / at a time, end never / at a time.
  rm  Reminder     a scrolling text in the bottom row that comes back every
                   N minutes for `loops` loops; only an on/off switch.

Rules that matter:
  * A full-screen PA hides the Scrolling PA (hard stop) and cuts a running
    reminder off. The Scrolling PA comes back by itself afterwards while it's
    still live; if its end passes while hidden it switches itself off.
  * A reminder never overrides: if anything is on screen when it's due it is
    skipped and tried again a full interval later.
  * A Scrolling PA that becomes live while a reminder runs waits until the
    reminder's current loop has left the screen.
  * Soft ends: an end time or switching off lets the current pass finish.

The engine only does timing and geometry (pixels, via the skin's text width
function). The skin draws. Time inside the engine is integer milliseconds
(time.monotonic_ns) because CircuitPython floats are too coarse for long
uptimes; the wall clock is the box clock the app takes from the data server.

Settings live at app level in settings["pa"] (see defaults()).
"""
import time, json

try:
    import varinit
    _HOST = True
except ImportError:      # desktop tests
    varinit = None
    _HOST = False

SPEEDS = {"slow": 3, "normal": 4, "fast": 5.5}     # characters per second
EVERY = (2, 5, 10, 15, 20, 25, 30, 60)            # reminder interval, minutes
MAX_TEXT = 250
MAX_SEP = 10
MAX_LOOPS = 5
DEFAULT_SEP = "***"
CLOCK_SYNC_MS = 30 * 60 * 1000                    # correct the box clock every 30 min
MIN_PANEL_W = 64
SAMPLE = "Forgalmi rend változás, kérjük figyeljék a tájékoztatást"   # for chars/s -> px/s


def _ms():
    try: return time.monotonic_ns() // 1000000
    except Exception: return int(time.monotonic() * 1000)

ms = _ms                 # tests replace this


def defaults():
    return {"speed": "normal",
            "fs": {"on": 0, "start": 0, "end": 0, "rows": [], "sep": DEFAULT_SEP},
            "sc": {"on": 0, "start": 0, "end": 0, "text": "", "sep": DEFAULT_SEP},
            "rm": {"on": 0, "text": "", "sep": DEFAULT_SEP, "loops": 1, "every": 10}}


def _settings():
    return varinit.settings if _HOST else _TEST_SETTINGS

_TEST_SETTINGS = {}


_cfg_seen = [None]      # id of the settings["pa"] dict already completed with defaults

def cfg():
    """settings["pa"], completed with defaults (stored back so it persists).
    Called every animation frame: once a dict has been checked it is returned
    as it is, so no garbage is made per frame (garbage collection = stutter)."""
    s = _settings()
    raw = s.get("pa")
    if raw is not None and id(raw) == _cfg_seen[0]: return raw
    d = defaults()
    if not isinstance(raw, dict):
        s["pa"] = d
        return d
    for k in ("fs", "sc", "rm"):
        if not isinstance(raw.get(k), dict): raw[k] = d[k]
        for kk, vv in d[k].items():
            if kk not in raw[k]: raw[k][kk] = vv
    if raw.get("speed") not in SPEEDS: raw["speed"] = "normal"
    _cfg_seen[0] = id(raw)
    return raw


def persist():
    """Write settings.txt quietly (no 'saving' message on the board)."""
    if not _HOST: return
    try:
        with open("settings.txt", "w") as f:
            f.write(json.dumps(varinit.settings))
    except Exception as e:
        print("PA: settings not saved:", e)


# --- wall clock ------------------------------------------------------------------
def wall(now_ms=None):
    """Box local time in whole seconds, or None while it isn't known yet."""
    if not _HOST: return _TEST_WALL[0]
    ct = getattr(varinit, "currenttime", "")
    if not isinstance(ct, int) or ct <= 0:
        try: ct = int(ct)
        except Exception: return None
        if ct <= 0: return None
    at = getattr(varinit, "currenttime_ms", None)
    if at is None: return ct
    return ct + ((ms() if now_ms is None else now_ms) - at) // 1000

_TEST_WALL = [None]


def clock_age_ms():
    if not _HOST: return _TEST_CLOCK_AGE[0]
    at = getattr(varinit, "currenttime_ms", None)
    return None if at is None else ms() - at

_TEST_CLOCK_AGE = [None]


def parse_dt(s):
    """'YYYY-MM-DDTHH:MM' (browser datetime-local) -> box seconds, or None."""
    try:
        s = s.strip().replace(" ", "T")
        d, t = s.split("T")
        y, mo, da = [int(v) for v in d.split("-")]
        hh, mi = [int(v) for v in t.split(":")[:2]]
        return int(time.mktime(time.struct_time((y, mo, da, hh, mi, 0, 0, -1, -1))))
    except Exception:
        return None


def fmt_dt(e, iso=False):
    if not e: return ""
    t = time.localtime(int(e))
    sep = "T" if iso else " "
    return "%04d-%02d-%02d%s%02d:%02d" % (t[0], t[1], t[2], sep, t[3], t[4])


def _started(c, now_w):
    if not c.get("start"): return True
    return now_w is not None and now_w >= c["start"]


def _ended(c, now_w):
    if not c.get("end"): return False
    return now_w is not None and now_w >= c["end"]


def needs_clock():
    """True while a PA waits for a start or end time."""
    c = cfg()
    w = wall()
    for k in ("fs", "sc"):
        p = c[k]
        if not p["on"]: continue
        if p.get("end"): return True
        if p.get("start") and (w is None or w < p["start"]): return True
    return False


def clock_due():
    """A request just for the time is due (used where no requests run anyway:
    static mode and full-screen PAs)."""
    if not needs_clock(): return False
    age = clock_age_ms()
    return wall() is None or age is None or age >= CLOCK_SYNC_MS


# --- geometry ---------------------------------------------------------------------
class Strip:
    """A scrolling text in one row: separators and messages laid out in pixels.

    It enters at the right edge (x = panel width) and is done when it has
    completely left the left edge. x(now) is the strip's left edge on the panel.
    """
    def __init__(self, parts, width_fn, panel_w, px10, gap_px, now):
        self.items, self.seps, self.ends = [], [], []
        x, first_sep = 0, True
        for kind, text in parts:
            if kind == "sep":
                if text:
                    t = " " + text + " "
                    w = width_fn(t)
                    self.items.append((x, t))
                else:
                    w = gap_px
                self.seps.append((x, x + w))
                if not first_sep: self.ends.append(x + w)
                first_sep = False
            else:
                w = width_fn(text)
                self.items.append((x, text))
            x += w + 1
        self.w = max(1, x - 1)
        self.limit = self.w          # cut_after_current() can shorten it
        self.panel_w, self.px10 = panel_w, max(1, px10)
        self.t0 = now

    def restart(self, now):
        self.t0, self.limit = now, self.w

    def shift(self, dt_ms):
        self.t0 += dt_ms

    def x(self, now):
        return self.panel_w - ((now - self.t0) * self.px10) // 10000

    def done(self, now):
        return self.x(now) + self.limit <= 0

    def entered(self, now):
        return self.panel_w - self.x(now)

    def sep_visible(self, now):
        x = self.x(now)
        for a, b in self.seps:
            if a < self.limit and x + a >= 0 and x + b <= self.panel_w: return True
        return False

    def cut_after_current(self, now):
        """End the strip after the loop that is currently entering the panel."""
        e = self.entered(now)
        for b in self.ends:
            if b >= e:
                self.limit = min(self.limit, b)
                return
        self.limit = min(self.limit, self.w)


def px10(width_fn):
    """Pixels per 10 seconds for the speed setting."""
    cps = SPEEDS.get(cfg()["speed"], 4)
    per_char = (width_fn(SAMPLE) + 1) / len(SAMPLE)
    return int(cps * per_char * 10 + 0.5)


def gap_px(width_fn):
    return 5 * (width_fn("n") + 1)


def _pass_parts(text, sep, loops=1):
    parts = [("sep", sep)]
    for _ in range(loops):
        parts.append(("msg", text))
        parts.append(("sep", sep))
    return parts


# --- runtime state --------------------------------------------------------------
class Engine:
    """One per skin session. update() every animation tick; read the view."""

    def __init__(self, width_fn, panel_w, rows_n):
        self.width_fn, self.panel_w, self.rows_n = width_fn, panel_w, rows_n
        self.fs = None           # {"rows": [str | Strip | None], "ending": bool, "auto_off": bool}
        self.sc = None           # {"strip": Strip, "ending": bool}
        self.rm = None           # {"strip": Strip, "ending": bool}
        self.rm_next = 0         # ms when the reminder is due (0 = now)
        self.rm_was_on = False
        self.speed = None
        self.version = 0         # bumps whenever what's on screen changes structurally

    # -- helpers --
    def enabled(self):
        return self.panel_w >= MIN_PANEL_W

    def _strip(self, text, sep, loops, now):
        return Strip(_pass_parts(text, sep, loops), self.width_fn, self.panel_w,
                     px10(self.width_fn), gap_px(self.width_fn), now)

    def _auto_off(self, key):
        c = cfg()
        if c[key]["on"]:
            c[key]["on"] = 0
            persist()

    def shift(self, dt_ms):
        """The board froze for dt_ms (a data request): scrolling resumes where it stopped."""
        for st in self.strips():
            st.shift(dt_ms)

    def strips(self):
        out = []
        if self.fs:
            out += [r for r in self.fs["rows"] if isinstance(r, Strip)]
        if self.sc: out.append(self.sc["strip"])
        if self.rm: out.append(self.rm["strip"])
        return out

    # -- view --
    def fullscreen(self):
        return self.fs is not None

    def bottom(self):
        """The Strip in the bottom row (Scrolling PA or reminder), or None."""
        if self.fs: return None
        if self.sc: return self.sc["strip"]
        if self.rm: return self.rm["strip"]
        return None

    def bottom_kind(self):
        if self.fs: return None
        return "sc" if self.sc else ("rm" if self.rm else None)

    def busy_scrolling(self):
        return self.bottom() is not None

    # -- the state machine --
    def update(self, now=None):
        """Advance all PAs. Returns True if the layout changed (skin redraws)."""
        if not self.enabled(): return False
        if now is None: now = ms()
        c = cfg()
        w = wall(now)
        changed = False

        sp = c["speed"]
        if sp != self.speed:
            if self.speed is not None:
                p = px10(self.width_fn)
                for st in self.strips():          # keep the position, change the pace
                    travelled = st.panel_w - st.x(now)
                    st.px10 = p
                    st.t0 = now - (travelled * 10000) // p
            self.speed = sp

        # ---- full screen ----
        f = c["fs"]
        f_live = bool(f["on"]) and _started(f, w) and not _ended(f, w) and _fs_has_text(f)
        if self.fs is not None:
            if not f_live and not self.fs["ending"]:
                self.fs["ending"] = True
                self.fs["auto_off"] = bool(f["on"]) and _ended(f, w)
            rows = self.fs["rows"]
            if self.fs["ending"]:
                for i, r in enumerate(rows):
                    if isinstance(r, Strip) and r.done(now):
                        rows[i] = None
                        changed = True
                if not any(isinstance(r, Strip) for r in rows):
                    if self.fs["auto_off"]: self._auto_off("fs")
                    self.fs = None
                    changed = True
            else:
                for r in rows:
                    if isinstance(r, Strip) and r.done(now): r.restart(now)
        elif f_live:
            self.fs = {"rows": self._fs_rows(f, now), "ending": False, "auto_off": False}
            if self.sc: self.sc = None                       # hard stop, comes back later
            if self.rm:                                      # cut off, next try a full interval later
                self.rm = None
                self.rm_next = now + _every_ms(c["rm"])
            changed = True
        elif f["on"] and _ended(f, w):
            self._auto_off("fs")

        # ---- scrolling ----
        s = c["sc"]
        s_live = bool(s["on"]) and _started(s, w) and not _ended(s, w) and bool(s["text"])
        if self.fs is not None:
            if s["on"] and _ended(s, w): self._auto_off("sc")
        elif self.sc is not None:
            st = self.sc["strip"]
            if not s_live: self.sc["ending"] = True
            if st.done(now):
                if self.sc["ending"]:
                    if s["on"] and _ended(s, w): self._auto_off("sc")
                    self.sc = None
                    changed = True
                else:
                    st.restart(now)
        elif s_live:
            if self.rm is not None:
                self.rm["strip"].cut_after_current(now)       # wait for its current loop
            else:
                self.sc = {"strip": self._strip(s["text"], s["sep"], 1, now), "ending": False}
                changed = True
        elif s["on"] and _ended(s, w):
            self._auto_off("sc")

        # ---- reminder ----
        r = c["rm"]
        r_on = bool(r["on"]) and bool(r["text"])
        if r_on and not self.rm_was_on: self.rm_next = 0      # first appearance right away
        self.rm_was_on = r_on
        if self.rm is not None:
            st = self.rm["strip"]
            if not r_on and not self.rm["ending"]:
                self.rm["ending"] = True
                st.cut_after_current(now)
            if st.done(now):
                self.rm = None
                self.rm_next = now + _every_ms(r)
                changed = True
        elif r_on and now >= self.rm_next:
            if self.fs is not None or self.sc is not None:
                self.rm_next = now + _every_ms(r)             # skipped, no catching up
            else:
                loops = min(MAX_LOOPS, max(1, int(r.get("loops", 1))))
                self.rm = {"strip": self._strip(r["text"], r["sep"], loops, now), "ending": False}
                changed = True

        if changed: self.version += 1
        return changed

    def _fs_rows(self, f, now):
        out = []
        rows = f.get("rows") or []
        for i in range(self.rows_n):
            row = rows[i] if i < len(rows) and isinstance(rows[i], dict) else {}
            text = str(row.get("t", ""))
            if not text: out.append(None)
            elif row.get("s"): out.append(self._strip(text, f["sep"], 1, now))
            else: out.append(text)
        return out

    def status(self, key, now=None):
        """For the settings page: off / scheduled / live / hidden / ending / waiting / showing."""
        c = cfg()
        p = c[key]
        if now is None: now = ms()
        if key == "fs":
            if self.fs is not None: return "ending" if self.fs["ending"] else "live"
            if not p["on"]: return "off"
            return "scheduled" if not _started(p, wall()) else "live"
        if key == "sc":
            if self.sc is not None: return "ending" if self.sc["ending"] else "live"
            if not p["on"]: return "off"
            if not _started(p, wall()): return "scheduled"
            if self.fs is not None: return "hidden"
            return "waiting" if self.rm is not None else "live"
        if self.rm is not None: return "ending" if self.rm["ending"] else "showing"
        if not p["on"]: return "off"
        return "waiting"


def _fs_has_text(f):
    for r in f.get("rows") or ():
        if isinstance(r, dict) and r.get("t"): return True      # stored already cleaned
    return False


def _every_ms(r):
    try: m = int(r.get("every", 10))
    except Exception: m = 10
    if m not in EVERY: m = 10
    return m * 60000


# --- the one engine for the running skin ---------------------------------------------
_engine = None

def engine():
    return _engine

def start(width_fn, panel_w, rows_n):
    """Called by a skin that can show PAs (on_enter)."""
    global _engine
    _engine = Engine(width_fn, panel_w, rows_n)
    return _engine

def stop():
    global _engine
    _engine = None


# --- settings page: validation and saving -----------------------------------------
def _clean(text, limit):
    text = str(text).replace("\r", " ").replace("\n", " ").replace("\t", " ")
    while "  " in text: text = text.replace("  ", " ")
    return text.strip()[:limit]


def _times(d, now_w):
    """('now'|'at', dt) + ('none'|'at', dt) -> (start, end) or raises ValueError(msg)."""
    start = 0
    if d.get("start_mode") == "at":
        start = parse_dt(d.get("start", ""))
        if start is None: raise ValueError("Pick a start date and time.")
        if now_w is not None and start <= now_w: start = 0      # in the past = immediately
    end = 0
    if d.get("end_mode") == "at":
        end = parse_dt(d.get("end", ""))
        if end is None: raise ValueError("Pick an end date and time.")
        if start and end <= start: raise ValueError("The end can't be before the start.")
        if now_w is not None and end <= now_w: raise ValueError("The end is in the past.")
    return start, end


def apply(key, d, rows_n=4, panel_w=128, width_fn=None):
    """Settings page request for one PA. d: decoded JSON. Returns (ok, message).

    {"on": 0}                      switch off (soft end; fields stay)
    {"on": 1, fields...}           validate, store and switch on
    {"speed": "slow|normal|fast"}  (key "speed")
    """
    c = cfg()
    if key == "speed":
        sp = d.get("speed")
        if sp not in SPEEDS: return False, "Unknown speed."
        c["speed"] = sp
        persist()
        return True, ""
    if key not in ("fs", "sc", "rm"): return False, "Unknown PA."
    p = c[key]
    if not int(d.get("on", 0)):
        p["on"] = 0
        persist()
        return True, ""
    if p["on"]: return False, "This PA is on. Switch it off to edit it."

    now_w = wall()
    if now_w is None: now_w = parse_dt(d.get("now", ""))     # box time unknown: the browser's
    sep = _clean(d.get("sep", DEFAULT_SEP), MAX_SEP)
    try:
        if key == "fs":
            rows = []
            for i, r in enumerate((d.get("rows") or [])[:rows_n]):
                scroll = 1 if r.get("s") else 0
                t = _clean(r.get("t", ""), MAX_TEXT)
                if not scroll and width_fn is not None and width_fn(t) > panel_w:
                    raise ValueError("Row %d is too wide for the board." % (i + 1))
                rows.append({"s": scroll, "t": t})
            if not any(r["t"] for r in rows): raise ValueError("Write at least one row.")
            start, end = _times(d, now_w)
            p.update({"rows": rows, "sep": sep, "start": start, "end": end})
        elif key == "sc":
            t = _clean(d.get("text", ""), MAX_TEXT)
            if not t: raise ValueError("Write the text first.")
            start, end = _times(d, now_w)
            p.update({"text": t, "sep": sep, "start": start, "end": end})
        else:
            t = _clean(d.get("text", ""), MAX_TEXT)
            if not t: raise ValueError("Write the text first.")
            loops = int(d.get("loops", 1))
            every = int(d.get("every", 10))
            if not 1 <= loops <= MAX_LOOPS: raise ValueError("Loops must be 1 to %d." % MAX_LOOPS)
            if every not in EVERY: raise ValueError("Pick an interval.")
            p.update({"text": t, "sep": sep, "loops": loops, "every": every})
    except ValueError as e:
        return False, str(e)
    p["on"] = 1
    persist()
    return True, ""


def state_json(rows_n=4, panel_w=128):
    """Everything the settings page shows, as JSON."""
    c = cfg()
    e = _engine
    now_w = wall()
    out = {"box_time": fmt_dt(now_w) if now_w else "", "speed": c["speed"],
           "rows": rows_n, "width": panel_w, "enabled": panel_w >= MIN_PANEL_W, "pa": {}}
    for k in ("fs", "sc", "rm"):
        p = dict(c[k])
        for t in ("start", "end"):
            if t in p: p[t] = fmt_dt(p[t], iso=True)
        p["status"] = e.status(k) if e else ("off" if not c[k]["on"] else "inactive")
        out["pa"][k] = p
    if e and e.rm is None and c["rm"]["on"]:
        out["rm_next_s"] = max(0, (e.rm_next - ms()) // 1000)
    return json.dumps(out)
