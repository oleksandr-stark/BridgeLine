"""Support commands for the BridgeLine client (used by aeb.py; no After Effects needed for most checks).

  aeb.py doctor [--json]                 checks the installation and says what to fix
  aeb.py review --comp C [--range A B] [--frames N] [--cols 4] [--width 480] [--project P] [--out sheet.png]
                                         renders N frames of a range and makes a contact sheet on mid grey (needs ffmpeg)
  aeb.py pixdiff A.png B.png [--threshold 8] [--heatmap out.png]
                                         how much changed between two frames and where (needs ffmpeg)
  aeb.py render --comp C --out FILE [--range A B] [--om TEMPLATE] [--rs TEMPLATE] [--project P]
                                         renders in the background with aerender from a copy of the saved project
                                         (After Effects stays free); prints a job id
  aeb.py render-status [ID]              progress / ETA / result of render jobs
  aeb.py render-cancel ID                stops a render job
  aeb.py textsheet export --comp C [--comp D | --comp re:REGEX] --out sheet.csv [--slack 0.15]
  aeb.py textsheet apply sheet.csv [--dry-run] [--glossary terms.csv] [--keep keep.txt]
                                         translation round trip: CSV with a character budget per layer and {br} line
                                         breaks; apply checks length / breaks / numbers / glossary, keeps per-char styles
  aeb.py report [--raw] [--lines 80] [--project P] [--out FILE]
                                         bug report for the BridgeLine author, as Markdown.
                                         Names (comps, layers, text, files) and your user name are replaced by
                                         placeholders unless --raw. Renders and the project are never included.
"""
import glob, json, os, platform, re, subprocess, sys, time

import aeb

OK, WARN, FAIL, INFO = "ok", "warn", "FAIL", "info"


# ---------------------------------------------------------------- After Effects installs
def _ver_of(path):
    m = re.search(r'VERSION: "([0-9.]+)"', open(path, encoding="utf-8", errors="replace").read(4000))
    return m.group(1) if m else "?"


def ae_installs():
    """[{name, app_dir, version, panel, panel_version, other_panels, prefs, prefs_dir}]"""
    out = []
    if sys.platform == "darwin":
        apps = sorted(glob.glob("/Applications/Adobe After Effects*"))
        panels_rel = os.path.join("Scripts", "ScriptUI Panels")
    elif os.name == "nt":
        base = os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Adobe")
        apps = sorted(glob.glob(os.path.join(base, "Adobe After Effects*")))
        panels_rel = os.path.join("Support Files", "Scripts", "ScriptUI Panels")
    else:
        return out
    for app in apps:
        name = os.path.basename(app)
        beta = "(Beta)" in name
        d = {"name": name, "app_dir": app, "version": None, "panel": None, "panel_version": None, "other_panels": []}
        pdir = os.path.join(app, panels_rel)
        p = os.path.join(pdir, "BridgeLine.jsx")
        if os.path.exists(p):
            d["panel"], d["panel_version"] = p, _ver_of(p)
        for old in ("mcp-bridge-auto.jsx",):  # the panel of another AE bridge that also polls a command file
            if os.path.exists(os.path.join(pdir, old)):
                d["other_panels"].append(old)
        d["version"], d["prefs"], d["prefs_dir"] = _prefs(name, beta)
        out.append(d)
    return out


def _prefs(app_name, beta):
    """(version folder, {key: value}, folder) of the newest prefs that belong to this AE."""
    if sys.platform == "darwin":
        root = os.path.expanduser("~/Library/Preferences/Adobe")
    else:
        root = os.path.join(os.environ.get("APPDATA", ""), "Adobe")
    root = os.path.join(root, "After Effects (Beta)" if beta else "After Effects")
    m = re.search(r"20(\d\d)", app_name)
    major = m.group(1) if m else None
    cands = []
    for d in glob.glob(os.path.join(root, "*")):
        v = os.path.basename(d)
        if not re.match(r"^\d+(\.\d+)*$", v) or (major and not v.startswith(major + ".")):
            continue
        f = glob.glob(os.path.join(d, "Adobe After Effects * Prefs.txt"))
        if f:
            cands.append((tuple(int(x) for x in v.split(".")), v, f[0], d))
    if not cands:
        return None, {}, None
    _, v, f, d = sorted(cands)[-1]
    keys = {}
    try:
        t = open(f, encoding="utf-8", errors="replace").read()
        for k in ("Pref_SCRIPTING_FILE_NETWORK_SECURITY", "Disable ScriptUI"):
            m = re.search(r'"%s"\s*=\s*"?([0-9]+)' % re.escape(k), t)
            if m:
                keys[k] = m.group(1)
    except OSError:
        pass
    return v, keys, d


def ae_running():
    try:
        if sys.platform == "darwin":
            r = subprocess.run(["pgrep", "-fl", "After Effects"], capture_output=True, text=True, timeout=5)
            return [l.split(" ", 1)[1] for l in r.stdout.splitlines() if ".app/Contents/MacOS/" in l]
        if os.name == "nt":
            r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq AfterFX.exe", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=10)
            return [l for l in r.stdout.splitlines() if "AfterFX" in l]
    except Exception:
        pass
    return None


# ---------------------------------------------------------------- doctor
def doctor(ping_timeout=6, project=None):
    checks, info = [], {}

    def add(level, what, hint=""):
        checks.append({"level": level, "check": what, "hint": hint})

    info["os"] = platform.platform()
    info["python"] = sys.version.split()[0]
    info["client"] = os.path.abspath(aeb.__file__)
    info["files_version"] = aeb.repo_version()
    info["exchange_folder"] = aeb.ROOT
    add(OK if sys.version_info >= (3, 7) else FAIL, "Python %s" % info["python"], "Python 3.7 or newer is needed.")

    # exchange folder
    if os.path.isdir(aeb.ROOT):
        try:
            t = os.path.join(aeb.ROOT, ".write_test")
            open(t, "w").close(); os.remove(t)
            add(OK, "Exchange folder is writable: %s" % aeb.ROOT)
        except OSError as e:
            add(FAIL, "Exchange folder is not writable: %s (%s)" % (aeb.ROOT, e))
    else:
        add(WARN, "Exchange folder does not exist yet: %s" % aeb.ROOT,
            "It is created when the panel starts. Open Window > BridgeLine.jsx in After Effects.")
    log = os.path.join(aeb.ROOT, "log.txt")
    if os.path.exists(log):
        info["log_size"] = os.path.getsize(log)
        info["log_modified"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(log)))
        started = [l for l in _tail_lines(log, 4000) if "Started" in l]
        if started:
            info["last_panel_start"] = started[-1].strip()

    # installs
    installs = ae_installs()
    info["after_effects"] = installs
    if not installs:
        add(FAIL if sys.platform in ("darwin", "win32") else INFO, "No After Effects found in the usual place",
            "Install the panel by hand into your After Effects 'ScriptUI Panels' folder (docs/INSTALL.md).")
    fv = aeb._ver(info["files_version"])
    for d in installs:
        label = "%s (%s)" % (d["name"], d["version"] or "no prefs yet")
        if not d["panel"]:
            add(WARN, "%s: BridgeLine.jsx is not installed" % label, "Run install.sh / install.ps1 if you use this version.")
        else:
            pv = aeb._ver(d["panel_version"])
            if fv and pv and pv < fv:
                add(WARN, "%s: panel %s is older than the files here (%s)" % (label, d["panel_version"], info["files_version"]),
                    "Run install.sh / install.ps1, then close and reopen the panel.")
            else:
                add(OK, "%s: panel %s installed" % (label, d["panel_version"]))
        if d["other_panels"]:
            add(WARN, "%s: old bridge panels still installed: %s" % (d["name"], ", ".join(d["other_panels"])),
                "Remove them from 'ScriptUI Panels' to avoid two panels answering.")
        flag = d["prefs"].get("Pref_SCRIPTING_FILE_NETWORK_SECURITY")
        if flag == "1":
            add(OK, "%s: 'Allow Scripts to Write Files and Access Network' is on" % d["name"])
        elif flag == "0":
            add(FAIL, "%s: 'Allow Scripts to Write Files and Access Network' is OFF" % d["name"],
                "After Effects > Settings (Windows: Edit > Preferences) > Scripting & Expressions: turn it on.")
        if d["prefs"].get("Disable ScriptUI") == "1":
            add(FAIL, "%s: ScriptUI panels are disabled in the preferences" % d["name"])

    running = ae_running()
    if running is not None:
        info["ae_running"] = running
        add(OK if running else WARN, "After Effects is %s" % ("running" if running else "not running"),
            "" if running else "Start After Effects and open Window > BridgeLine.jsx.")

    # ping (short)
    if running is None or running:
        res, code = aeb.send("ping", {}, ping_timeout, project)
        info["ping"] = res
        if code == 0:
            r = res.get("result", {})
            add(OK, "Panel answers: BridgeLine %s, AE %s, project %s, changes %s" % (
                r.get("bridge"), r.get("ae"), "saved" if r.get("project") else "not saved / none",
                "allowed" if r.get("allowWrites") else "not allowed (read-only)"))
            if r.get("bridgeFolder") and os.path.normcase(os.path.abspath(r["bridgeFolder"])) != os.path.normcase(os.path.abspath(aeb.ROOT)):
                add(FAIL, "Panel uses another exchange folder: %s" % r["bridgeFolder"], "Set AEB_ROOT to that folder.")
        else:
            add(WARN, "Panel did not answer: %s" % res.get("error"),
                "Open Window > BridgeLine.jsx, tick Listen; close any dialog in After Effects.")
    return {"checks": checks, "info": info}


def print_doctor(d):
    mark = {OK: "  ok ", WARN: " warn", FAIL: " FAIL", INFO: " info"}
    for c in d["checks"]:
        print("%s  %s" % (mark[c["level"]], c["check"]))
        if c["hint"] and c["level"] in (WARN, FAIL):
            print("         -> " + c["hint"])
    bad = [c for c in d["checks"] if c["level"] == FAIL]
    print("\n%s" % ("Problems found: %d" % len(bad) if bad else "No blocking problems found."))


# ---------------------------------------------------------------- report
def _tail_lines(path, n):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().replace("\r\n", "\n").replace("\r", "\n").splitlines()[-n:]
    except OSError:
        return []


NAME_KEYS = ("comp", "toComp", "egComp", "layer", "toLayer", "name", "newName", "text", "find", "replace", "comment", "item",
             "from", "to", "folder", "file", "files", "project", "expression", "template", "prefix", "out", "lines",
             "label", "chapter", "url", "match", "toMatch", "compMatch", "layerMatch", "items", "undoName", "templateName",
             "layers", "toLayers", "comps", "names", "ignore")


def anonymize(text):
    home = os.path.expanduser("~")
    user = os.path.basename(home)
    t = text
    if home and home != "/":
        t = t.replace(home, "~")
    # absolute paths -> <path>/<file type>
    t = re.sub(r'(?:[A-Za-z]:\\|~?/)(?:[^"\'\s,;)\]}]+[\\/])+([^"\'\s,;)\]}\\/]*?)(\.[A-Za-z0-9]{1,5})?(?=["\'\s,;)\]}]|$)',
               lambda m: "<path>/<file>%s" % (m.group(2) or ""), t)
    # JSON-ish values of name-carrying keys
    keys = "|".join(NAME_KEYS)
    t = re.sub(r'("(?:%s)"\s*:\s*)"(?:[^"\\]|\\.)*"' % keys, r'\1"<name>"', t)
    t = re.sub(r'("(?:%s)"\s*:\s*)\[[^\]]*\]' % keys, r'\1["<names>"]', t)
    # names without quotes in messages of panels before 1.0.5
    for pat in (r"(not found on )(.+?)(\. Effects:)", r"(Effect cannot be added to )(.+?)(: )", r"(Comp already exists: )(.+?)( \(id )",
                r"(comp\(s\): )(.+?)( \(pass)", r"(Folder is not empty: )(.+?)( \(pass)", r"(Cannot import )(.+?)( as )",
                r"(Anchor of )(.+?)( is keyed)"):
        t = re.sub(pat, lambda m: m.group(1) + "'<name>'" + m.group(3), t)
    # quoted names in error messages
    t = re.sub(r"'[^'\n]{1,120}'", "'<name>'", t)
    t = re.sub(r"\u2018[^\u2019\n]{1,120}\u2019", "\u2018<name>\u2019", t)
    # shortened values at the end of a log line ("text":"long text...)
    t = re.sub(r'("(?:%s)"\s*:\s*)"[^"\n]*\.\.\.$' % keys, r'\1"<name>..."', t, flags=re.M)
    # any other non-ASCII words (names and texts in other languages)
    t = re.sub(r"[^\x00-\x7F]+", lambda m: "<text>" if any(c.isalpha() for c in m.group()) else m.group(), t)
    t = re.sub(r"<text>(?:[\s\-_.,0-9]*<text>)+", "<text>", t)
    return _private(t)


def _private(t):
    """Home folder and user name only (for our own messages)."""
    home = os.path.expanduser("~")
    user = os.path.basename(home)
    if home and home != "/":
        t = t.replace(home, "~")
    if user and len(user) > 2:
        t = re.sub(re.escape(user), "<user>", t, flags=re.I)
    return t


def report(raw=False, lines=80, project=None):
    d = doctor(ping_timeout=6, project=project)
    log = os.path.join(aeb.ROOT, "log.txt")
    tail = _tail_lines(os.path.join(aeb.ROOT, "log.1.txt"), 400) + _tail_lines(log, 4000)
    errors = []
    for i, l in enumerate(tail):
        if re.search(r"\d\d:\d\d:\d\d  ! ", l):
            errors.append("\n".join(tail[max(0, i - 2):i + 2]))
    errors = errors[-8:]
    last = tail[-lines:]
    res = None
    try:
        with open(aeb.RES, encoding="utf-8") as f:
            res = json.load(f)
        if isinstance(res.get("result"), (dict, list)):
            s = json.dumps(res["result"], ensure_ascii=False)
            res["result"] = s[:1500] + (" ...(cut)" if len(s) > 1500 else "")
    except Exception:
        pass

    info = d["info"]
    ping = (info.get("ping") or {}).get("result") or {}
    out = ["# BridgeLine bug report", "",
           "_Created %s with `aeb.py report`%s. Renders and the project file are not included._" %
           (time.strftime("%Y-%m-%d %H:%M"), "" if raw else "; names, texts and paths are replaced by placeholders"), "",
           "## What happened", "",
           "<!-- The agent or you: what was asked, what was expected, what happened instead. -->", "",
           "## Environment", "",
           "| | |", "|---|---|",
           "| BridgeLine panel (answering) | %s |" % (ping.get("bridge") or "no answer"),
           "| BridgeLine files | %s |" % info.get("files_version"),
           "| After Effects (answering) | %s %s |" % (ping.get("ae") or "-", ping.get("aeLanguage") or ""),
           "| OS | %s |" % info.get("os"),
           "| Python | %s |" % info.get("python"),
           "| Changes allowed | %s |" % ping.get("allowWrites"),
           "| Project saved | %s |" % ("yes" if ping.get("project") else "no / unknown"),
           ""]
    for a in info.get("after_effects", []):
        out.append("- %s: panel %s, prefs %s, scripting access %s%s" % (
            a["name"], a["panel_version"] or "not installed", a["version"] or "-",
            {"1": "on", "0": "OFF"}.get(a["prefs"].get("Pref_SCRIPTING_FILE_NETWORK_SECURITY"), "?"),
            (", old panels: " + ", ".join(a["other_panels"])) if a["other_panels"] else ""))
    out += ["", "## Doctor", "", "```"]
    out += ["%-4s %s" % (c["level"], c["check"]) for c in d["checks"]]
    out += ["```", "", "## Recent errors (%d)" % len(errors), "", "```"]
    out += errors or ["(none in the log)"]
    out += ["```", "", "## Last %d log lines" % len(last), "", "```"] + last + ["```", ""]
    mcp = _tail_lines(os.path.join(aeb.ROOT, "mcp_log.txt"), 40)
    if mcp:   # bridgeline_mcp.py: start, client, tool calls, how the session ended ("Transport closed" on the client side)
        out += ["## MCP server log (last %d lines)" % len(mcp), "", "```"] + mcp + ["```", ""]
    if res:
        out += ["## Last result.json", "", "```json", json.dumps(res, ensure_ascii=False, indent=1)[:4000], "```", ""]
    if raw:
        return "\n".join(str(x) for x in out)
    head, body = out[:out.index("## Recent errors (%d)" % len(errors))], out[out.index("## Recent errors (%d)" % len(errors)):]
    return _private("\n".join(str(x) for x in head)) + "\n" + anonymize("\n".join(str(x) for x in body))


# ---------------------------------------------------------------- review / pixdiff (ffmpeg)
def _ffmpeg():
    import shutil
    f = shutil.which("ffmpeg")
    if not f:
        raise SystemExit("ffmpeg is needed for this command (macOS: brew install ffmpeg, Windows: winget install Gyan.FFmpeg)")
    return f


def _png_size(path):
    import struct
    with open(path, "rb") as f:
        d = f.read(32)
    return struct.unpack(">II", d[16:24])


def review(comp, rng=None, frames=None, cols=4, width=480, project=None, out=None):
    info, code = aeb.send("compInfo", {"comp": comp}, 30, project)
    if code:
        return info, code
    ci = info["result"]
    c = ci.get("comp", ci)
    dur, fps = float(c.get("duration")), float(c.get("frameRate", 25))
    t0, t1 = (float(rng[0]), float(rng[1])) if rng else (0.0, dur)
    t1 = min(t1, dur - 1.0 / fps)
    n = int(frames or max(6, min(16, round((t1 - t0) * 2) + 1)))
    times = [round(t0 + (t1 - t0) * i / max(1, n - 1), 4) for i in range(n)]
    folder = "review/%s_%s" % (re.sub(r"[^A-Za-z0-9_-]+", "_", str(comp)), time.strftime("%Y%m%d_%H%M%S"))
    res, code = aeb.send("renderFrames", {"comp": comp, "times": times, "folder": folder, "prefix": "f"}, 120, project)
    if code:
        return res, code
    fr = [f for f in res["result"]["frames"] if f.get("state") in ("ok", "empty")]
    if not fr:
        return {"ok": False, "error": "no frames were written", "renderFrames": res}, 1
    w, h = _png_size(fr[0]["file"])
    tw = int(width); th = int(round(h * tw / float(w) / 2) * 2)
    cols = max(1, min(int(cols), len(fr))); rows = (len(fr) + cols - 1) // cols
    out = out or os.path.join(os.path.dirname(fr[0]["file"]), "sheet.png")
    args = [_ffmpeg(), "-y", "-loglevel", "error"]
    for f in fr:
        args += ["-i", f["file"]]
    pad = 6
    W, H = cols * tw + (cols + 1) * pad, rows * th + (rows + 1) * pad
    fc = ["color=c=0x808080:s=%dx%d:d=1[bg0]" % (W, H)]
    prev = "bg0"
    for i in range(len(fr)):
        x, y = pad + (i % cols) * (tw + pad), pad + (i // cols) * (th + pad)
        fc.append("[%d]scale=%d:%d[s%d]" % (i, tw, th, i))
        fc.append("[%s][s%d]overlay=%d:%d[bg%d]" % (prev, i, x, y, i + 1))
        prev = "bg%d" % (i + 1)
    args += ["-filter_complex", ";".join(fc), "-map", "[%s]" % prev, "-frames:v", "1", out]
    subprocess.run(args, check=True)
    order = [{"tile": i + 1, "row": i // cols + 1, "col": i % cols + 1, "time": f["time"], "state": f["state"]} for i, f in enumerate(fr)]
    return {"ok": True, "sheet": out, "frames": len(fr), "grid": [cols, rows], "tiles": order,
            "warnings": res.get("warnings", []), "note": "Tiles left to right, top to bottom; mid grey = transparent."}, 0


def pixdiff(a, b, threshold=8, heatmap=None):
    """Share of pixels that differ by more than threshold (0-255, max over channels incl. alpha) and their bounding box."""
    wa, ha = _png_size(a)
    wb, hb = _png_size(b)
    if (wa, ha) != (wb, hb):
        return {"ok": False, "error": "different sizes: %dx%d vs %dx%d" % (wa, ha, wb, hb)}, 1
    ff = _ffmpeg()
    # per-pixel max difference over R, G, B and alpha, then threshold -> 0/255 mask
    flt = ("[0]format=gbrap[a];[1]format=gbrap[b];[a][b]blend=all_mode=difference,extractplanes=r+g+b+a[r][g][bb][al];"
           "[r][g]blend=all_mode=lighten[rg];[bb][al]blend=all_mode=lighten[ba];[rg][ba]blend=all_mode=lighten,"
           "lut=y='if(gt(val,%d),255,0)'[m]" % threshold)
    raw = subprocess.run([ff, "-loglevel", "error", "-i", a, "-i", b, "-filter_complex", flt, "-map", "[m]",
                          "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    w, h = wa, ha
    changed = len(raw) - raw.count(0)
    top = bottom = left = right = None
    if changed:
        for y in range(h):
            row = raw[y * w:(y + 1) * w]
            if row.count(0) == w:
                continue
            l = len(row) - len(row.lstrip(b"\x00")); r = len(row.rstrip(b"\x00")) - 1
            top = y if top is None else top; bottom = y
            left = l if left is None else min(left, l); right = r if right is None else max(right, r)
    out = {"ok": True, "size": [w, h], "changedPixels": changed, "changedPercent": round(100.0 * changed / (w * h), 3), "threshold": threshold,
           "bbox": None if not changed else {"left": left, "top": top, "right": right, "bottom": bottom, "width": right - left + 1, "height": bottom - top + 1}}
    if heatmap:
        # the new frame dimmed in grey, changed pixels in red
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", a, "-i", b, "-filter_complex",
                        flt + ";[1]format=gray,lut=y='val*0.45',format=rgb24[base];[m]format=rgb24,colorchannelmixer=rr=1:gg=0:bb=0[hot];"
                        "[base][hot]blend=all_mode=lighten", "-frames:v", "1", heatmap], check=True)
        out["heatmap"] = heatmap
    return out, 0


# ---------------------------------------------------------------- background render (aerender)
JOBS = os.path.join(aeb.ROOT, "render_jobs")
OM_FOR_EXT = {".mp4": "H.264 - Match Render Settings - 15 Mbps", ".png": "PNG Sequence", ".tif": "TIFF Sequence with Alpha",
              ".jpg": "JPEG Sequence", ".wav": "WAV"}


def _aerender_for(ae_version):
    """aerender of the After Effects whose version answered the ping (major version), else the newest one."""
    apps = ae_installs()
    major = (ae_version or "").split(".")[0]
    pick = None
    for d in apps:
        m = re.search(r"20(\d\d)", d["name"])
        if major and m and m.group(1) == major:
            pick = d
    if major and not pick:
        for d in apps:   # the Beta is the next major version (its prefs folder says which)
            if "(Beta)" in d["name"] and (d.get("version") or "").startswith(major + "."):
                pick = d
    pick = pick or (apps[-1] if apps else None)
    if not pick:
        return None
    for rel in ("aerender", os.path.join("Support Files", "aerender.exe")):
        f = os.path.join(pick["app_dir"], rel)
        if os.path.exists(f):
            return f
    return None


def render(comp, out, rng=None, om=None, rs=None, project=None):
    import shutil, uuid
    ping, code = aeb.send("ping", {}, 20, project)
    pr = (ping.get("result") or {}) if code == 0 else {}
    proj = project or pr.get("project")
    if not proj or not os.path.exists(proj):
        return {"ok": False, "error": "aerender renders the saved .aep file: pass --project, or save the project open in After Effects"}, 1
    warns = []
    if pr.get("dirty"):
        warns.append("the project has unsaved changes: they are NOT in this render (save first if they should be)")
    exe = _aerender_for(pr.get("ae"))
    if not exe:
        return {"ok": False, "error": "aerender not found next to After Effects"}, 1
    jid = time.strftime("%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:4]
    jd = os.path.join(JOBS, jid)
    os.makedirs(jd)
    # a snapshot next to the original (so footage paths relative to the project still resolve); the user can keep
    # working and saving; removed when the job is finished (render-status)
    base, ext0 = os.path.splitext(proj)
    copy = "%s.bridgeline-render-%s%s" % (base, jid, ext0)
    shutil.copy2(proj, copy)
    out = os.path.abspath(os.path.expanduser(out))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    ext = os.path.splitext(out)[1].lower()
    om = om or OM_FOR_EXT.get(ext)
    if ext in (".png", ".tif", ".jpg") and "[#" not in out:
        out = out[:-len(ext)] + "_[#####]" + ext
    args = [exe, "-project", copy, "-comp", comp, "-output", out]
    total = None
    if rng:
        ci, c2 = aeb.send("compInfo", {"comp": comp}, 20, project)
        fps = float(((ci.get("result") or {}).get("comp") or ci.get("result") or {}).get("frameRate", 25)) if c2 == 0 else 25.0
        s0, s1 = int(round(rng[0] * fps)), int(round(rng[1] * fps)) - 1
        args += ["-s", str(s0), "-e", str(s1)]
        total = s1 - s0 + 1
    if om:
        args += ["-OMtemplate", om]
    if rs:
        args += ["-RStemplate", rs]
    log = os.path.join(jd, "aerender.log")
    kw = {"start_new_session": True} if os.name != "nt" else {"creationflags": 0x00000008 | 0x00000200}
    with open(log, "w", encoding="utf-8") as lf:
        p = subprocess.Popen(args, stdout=lf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, **kw)
    job = {"id": jid, "pid": p.pid, "comp": comp, "output": out, "outputTemplate": om, "project": proj, "copy": copy,
           "log": log, "args": args, "started": time.time(), "totalFrames": total, "warnings": warns}
    with open(os.path.join(jd, "job.json"), "w", encoding="utf-8") as f:
        json.dump(job, f, ensure_ascii=False, indent=1)
    return {"ok": True, "job": jid, "pid": p.pid, "output": out, "outputTemplate": om, "aerender": exe, "warnings": warns,
            "next": "python3 aeb.py render-status %s" % jid}, 0


def _alive(pid):
    try:
        if os.name == "nt":
            r = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/NH"], capture_output=True, text=True)
            return str(pid) in r.stdout
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False


def render_status(jid=None):
    jobs = []
    for jf in sorted(glob.glob(os.path.join(JOBS, "*", "job.json")))[-20:]:
        j = json.load(open(jf, encoding="utf-8"))
        if jid and j["id"] != jid:
            continue
        txt = open(j["log"], encoding="utf-8", errors="replace").read() if os.path.exists(j["log"]) else ""
        frames = re.findall(r"PROGRESS:\s+\S+ \((\d+)\)", txt)
        done_frames = len(set(frames))
        alive = _alive(j["pid"])
        err = re.findall(r"(?i)aerender error[^\n]*|\berror:[^\n]*", txt)
        m = re.search(r"created with After Effects version (\d+)\.(\d+)", txt)
        if m and not alive and not j.get("retried"):
            # saved by another AE version (e.g. Beta): run again with the matching aerender
            exe = _aerender_for(m.group(1) + "." + m.group(2))
            if exe and exe != j["args"][0]:
                j["args"][0] = exe; j["retried"] = True; j["started"] = time.time()
                kw = {"start_new_session": True} if os.name != "nt" else {"creationflags": 0x00000008 | 0x00000200}
                with open(j["log"], "w", encoding="utf-8") as lf:
                    j["pid"] = subprocess.Popen(j["args"], stdout=lf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, **kw).pid
                j.setdefault("warnings", []).append("the project was saved by After Effects %s.%s: restarted with %s" % (m.group(1), m.group(2), exe))
                json.dump(j, open(jf, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
                txt, alive, err = "", True, []
        finished = "Total Time Elapsed" in txt or "Finished composition" in txt
        state = "running" if alive else ("failed" if err or not finished else "done")
        o = {"id": j["id"], "comp": j["comp"], "state": state, "framesDone": done_frames, "totalFrames": j.get("totalFrames"),
             "elapsed": int(time.time() - j["started"]), "output": j["output"], "warnings": j.get("warnings", [])}
        if j.get("totalFrames") and done_frames and state == "running":
            o["percent"] = round(100.0 * done_frames / j["totalFrames"], 1)
            o["eta"] = int(o["elapsed"] * (j["totalFrames"] - done_frames) / max(1, done_frames))
        if err:
            o["errors"] = err[-3:]
        if state != "running" and j.get("copy") and os.path.exists(j["copy"]) and ".bridgeline-render-" in j["copy"]:
            try:
                os.remove(j["copy"])
                import shutil
                shutil.rmtree(j["copy"] + " Logs", ignore_errors=True)   # aerender writes "<project> Logs" next to it
            except OSError:
                pass
        if state != "running":
            outs = glob.glob(j["output"].replace("[#####]", "*")) if "[#" in j["output"] else [p for p in [j["output"]] if os.path.exists(p)]
            if not outs:   # aerender may have changed the extension
                base = os.path.splitext(j["output"])[0]
                outs = glob.glob(base + ".*")
            o["files"] = len(outs) if "[#" in j["output"] else outs
            if state == "done" and not outs:
                o["state"] = "failed"; o.setdefault("errors", []).append("no output file found")
        jobs.append(o)
    if jid and not jobs:
        return {"ok": False, "error": "no such job: " + jid}, 1
    return {"ok": True, "jobs": jobs}, 0


def render_cancel(jid):
    jf = os.path.join(JOBS, jid, "job.json")
    if not os.path.exists(jf):
        return {"ok": False, "error": "no such job: " + jid}, 1
    j = json.load(open(jf, encoding="utf-8"))
    if not _alive(j["pid"]):
        return {"ok": True, "note": "not running"}, 0
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(j["pid"]), "/T", "/F"], capture_output=True)
    else:
        import signal
        try:
            os.killpg(j["pid"], signal.SIGTERM)
        except OSError:
            os.kill(j["pid"], signal.SIGTERM)
    return {"ok": True, "cancelled": jid}, 0


# ---------------------------------------------------------------- translation sheet
BR = "{br}"


def textsheet_export(comps, out, slack=0.15, project=None):
    """All text layers of the comps -> CSV for a translator: comp, layer_id, layer, lines, box, source, target, max_chars, notes."""
    import csv, math
    if len(comps) == 1 and comps[0].startswith("re:"):
        tree, code = aeb.send("projectTree", {"flat": True, "type": "comp", "match": comps[0][3:]}, 60, project)
        if code:
            return tree, code
        items = tree["result"].get("items", [])
        comps = [it["name"] for it in items]
    rows = []
    for cn in comps:
        res, code = aeb.send("textLayout", {"comp": cn, "full": True}, 60, project)
        if code:
            return res, code
        for L in res["result"]["layers"]:
            src = L["text"].replace("\r\n", "\r").replace("\n", "\r").replace("\r", BR)
            rows.append({"comp": cn, "layer_id": L["layer"]["id"], "layer": L["layer"]["name"], "lines": L.get("lines", ""),
                         "box": "x".join(str(int(v)) for v in L["boxSize"]) if L.get("boxSize") else "", "source": src, "target": "",
                         "max_chars": int(math.ceil(len(src.replace(BR, "")) * (1 + slack))), "notes": ""})
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["comp", "layer_id", "layer", "lines", "box", "source", "target", "max_chars", "notes"])
        w.writeheader()
        w.writerows(rows)
    return {"ok": True, "file": out, "rows": len(rows), "comps": comps,
            "note": "Fill 'target'. Keep %s where a line must break; max_chars is the source length +%d%%." % (BR, round(slack * 100))}, 0


def _terms(path):
    import csv
    if not path:
        return []
    with open(path, encoding="utf-8-sig") as f:
        return [r for r in csv.reader(f) if r and r[0].strip() and not r[0].startswith("#")]


def textsheet_apply(sheet, dry_run=False, glossary=None, keep=None, project=None):
    """Checks each filled 'target' (length, line breaks, numbers, glossary, do-not-translate terms), then replaces the text
    layer by layer keeping per-character styles, and reports overflow / missing glyphs / re-wrapped lines afterwards."""
    import csv
    with open(sheet, encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("target") or "").strip()]
    gl = _terms(glossary)
    kp = [r[0].strip() for r in _terms(keep)]
    checked, problems = [], 0
    for r in rows:
        src, tgt, issues = r["source"], r["target"].strip(), []
        n = len(tgt.replace(BR, ""))
        if r.get("max_chars") and n > int(r["max_chars"]):
            issues.append("too long: %d chars, budget %s" % (n, r["max_chars"]))
        if src.count(BR) != tgt.count(BR):
            issues.append("line breaks: source %d, target %d" % (src.count(BR), tgt.count(BR)))
        ns, nt = sorted(re.findall(r"\d+(?:[.,]\d+)?", src)), sorted(re.findall(r"\d+(?:[.,]\d+)?", tgt))
        if ns != nt:
            issues.append("numbers differ: %s -> %s" % (ns, nt))
        for g in gl:
            if len(g) > 1 and g[0].lower() in src.lower() and g[1].lower() not in tgt.lower():
                issues.append("glossary: '%s' should be '%s'" % (g[0], g[1]))
        for k in kp:
            if k.lower() in src.lower() and k not in tgt:
                issues.append("keep untranslated: '%s'" % k)
        problems += bool(issues)
        checked.append({"comp": r["comp"], "layer": r["layer"], "layer_id": r["layer_id"], "issues": issues})
    if dry_run:
        return {"ok": True, "dryRun": True, "rows": len(rows), "withIssues": problems, "rows_checked": checked}, 0
    applied = []
    for r, c in zip(rows, checked):
        find, repl = r["source"].replace(BR, "\r"), r["target"].strip().replace(BR, "\r")
        res, code = aeb.send("replaceText", {"find": find, "replace": repl, "comps": [r["comp"]],
                                             "layerMatch": "^" + re.escape(r["layer"]) + "$"}, 60, project)
        c["applied"] = code == 0 and bool((res.get("result") or {}).get("count", 1))
        if code:
            c["issues"].append("not applied: " + str(res.get("error"))[:200])
        applied.append(c)
    after = {}
    for cn in sorted(set(r["comp"] for r in rows)):
        res, code = aeb.send("textLayout", {"comp": cn}, 60, project)
        if code == 0:
            for L in res["result"]["layers"]:
                after[(cn, str(L["layer"]["id"]))] = L
    for c in applied:
        L = after.get((c["comp"], str(c["layer_id"])))
        if L:
            if L.get("overflow"):
                c["issues"].append("after: text overflows its box")
            if L.get("missingGlyphs"):
                c["issues"].append("after: font has no glyphs for '%s'" % L["missingGlyphs"])
            if L.get("rewrapped"):
                c["issues"].append("after: AE wraps it into %s lines" % L.get("lines"))
    return {"ok": True, "applied": sum(1 for c in applied if c.get("applied")), "rows": len(rows),
            "withIssues": sum(1 for c in applied if c["issues"]), "rows_checked": applied}, 0


def main(argv):
    import argparse
    p = argparse.ArgumentParser(prog="aeb.py " + argv[0])
    p.add_argument("cmd")
    p.add_argument("--json", action="store_true")
    p.add_argument("--raw", action="store_true", help="keep names, texts and paths (default: anonymized)")
    p.add_argument("--lines", type=int, default=80)
    p.add_argument("--project")
    p.add_argument("--out")
    p.add_argument("files", nargs="*")
    p.add_argument("--comp", action="append", dest="comps"); p.add_argument("--range", nargs=2, type=float); p.add_argument("--frames", type=int)
    p.add_argument("--cols", type=int, default=4); p.add_argument("--width", type=int, default=480)
    p.add_argument("--threshold", type=int, default=8); p.add_argument("--heatmap")
    p.add_argument("--om"); p.add_argument("--rs")
    p.add_argument("--slack", type=float, default=0.15); p.add_argument("--dry-run", action="store_true")
    p.add_argument("--glossary"); p.add_argument("--keep")
    a = p.parse_args(argv)
    if a.cmd == "textsheet":
        if not a.files or a.files[0] not in ("export", "apply"):
            raise SystemExit("textsheet export --comp C [--comp D | --comp re:REGEX] --out sheet.csv | textsheet apply sheet.csv [--dry-run] [--glossary g.csv] [--keep terms.txt]")
        proj = a.project or os.environ.get("AEB_PROJECT")
        if a.files[0] == "export":
            if not (a.comps and a.out):
                raise SystemExit("--comp and --out are required")
            res, code = textsheet_export(a.comps, a.out, a.slack, proj)
        else:
            if len(a.files) < 2:
                raise SystemExit("textsheet apply needs the CSV file")
            res, code = textsheet_apply(a.files[1], a.dry_run, a.glossary, a.keep, proj)
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return code
    if a.cmd in ("render", "render-status", "render-cancel"):
        if a.cmd == "render":
            if not (a.comps and a.out):
                raise SystemExit("--comp and --out are required")
            res, code = render(a.comps[0], a.out, a.range, a.om, a.rs, a.project or os.environ.get("AEB_PROJECT"))
        elif a.cmd == "render-status":
            res, code = render_status(a.files[0] if a.files else None)
        else:
            if not a.files:
                raise SystemExit("render-cancel needs a job id")
            res, code = render_cancel(a.files[0])
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return code
    if a.cmd in ("review", "pixdiff"):
        if a.cmd == "review":
            if not a.comps:
                raise SystemExit("--comp is required")
            res, code = review(a.comps[0], a.range, a.frames, a.cols, a.width, a.project or os.environ.get("AEB_PROJECT"), a.out)
        else:
            if len(a.files) != 2:
                raise SystemExit("pixdiff needs two PNG files")
            res, code = pixdiff(a.files[0], a.files[1], a.threshold, a.heatmap)
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return code
    if a.cmd == "doctor":
        d = doctor(project=a.project)
        if a.json:
            print(json.dumps(d, ensure_ascii=False, indent=1))
        else:
            print_doctor(d)
        return 1 if any(c["level"] == FAIL for c in d["checks"]) else 0
    text = report(raw=a.raw, lines=a.lines, project=a.project)
    out = a.out or os.path.join(aeb.ROOT, "report_%s.md" % time.strftime("%Y%m%d_%H%M%S"))
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
    except OSError:
        out = None
    print(text)
    if out:
        print("\n(saved to %s)" % out, file=sys.stderr)
    return 0
