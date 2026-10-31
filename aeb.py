#!/usr/bin/env python3
"""Client for BridgeLine panel.

  aeb.py COMMAND ['{"json":"args"}'] [--timeout 120] [--max 20000]
  aeb.py COMMAND --args-file args.json
  --project /path/file.aep (or env AEB_PROJECT): panel refuses if another project is open
  aeb.py compare --comp NAME --time T --ref VIDEO --ref-time T2 [--out file.png]
  aeb.py status [id]              what each panel is doing; with an id: the stored result of that command
  aeb.py review --comp C [--range A B]   contact sheet of a range (ffmpeg)
  aeb.py pixdiff A.png B.png      what changed between two frames and where (ffmpeg)
  aeb.py textsheet export|apply   translation sheet (CSV) for text layers, see aeb_support.py
  aeb.py render --comp C --out F  background render with aerender from a copy of the saved project; render-status / render-cancel
  aeb.py doctor [--json]          check the installation (works without the panel)
  aeb.py report [--raw]           bug report for the BridgeLine author (anonymized Markdown)

Writes <Documents>/bridgeline/command.json atomically, waits for result.json with the same id,
prints it. Exit code 0 = ok, 1 = command error, 2 = timeout / panel not listening.
<Documents> is the same folder the panel uses (on Windows also when Documents is moved to OneDrive).
Set AEB_ROOT to override the exchange folder.

Updates: after a successful `ping` the client checks (at most once a day) the latest release on GitHub and
compares it, and the version of BridgeLine.jsx next to this file, with the panel that answered. If something is
newer, the ping result gets an "update" field and update.json tells the panel to show a notice.
Set BRIDGELINE_NO_UPDATE_CHECK=1 to skip the GitHub request (the local check still runs).
"""
import glob, json, os, re, subprocess, sys, time, uuid, argparse



def utf8_stdio(lf=False):
    """UTF-8 on stdin/stdout/stderr. On Windows a piped stdout uses the ANSI code page (cp1252/cp1251): a Cyrillic layer
    name in a result raised UnicodeEncodeError (or went out as non-UTF-8) and Cyrillic arguments came in garbled.
    lf=True also writes plain \\n line ends (JSON-RPC over stdio)."""
    for s, kw in ((sys.stdin, {}), (sys.stdout, {"newline": "\n"} if lf else {}), (sys.stderr, {})):
        try:
            s.reconfigure(encoding="utf-8", errors="replace", **kw)
        except Exception:
            pass


def documents_dir():
    """The user's Documents folder, as After Effects (Folder.myDocuments) sees it."""
    if os.name == "nt":
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(1024)
            # CSIDL_PERSONAL = 5: follows Documents redirection (OneDrive, another drive)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:
                return buf.value
        except Exception:
            pass
    return os.path.join(os.path.expanduser("~"), "Documents")


ROOT = os.environ.get("AEB_ROOT") or os.path.join(documents_dir(), "bridgeline")
CMD = os.path.join(ROOT, "command.json")
RES = os.path.join(ROOT, "result.json")
HERE = os.path.dirname(os.path.abspath(__file__))
RELEASES_API = "https://api.github.com/repos/oleksandr-stark/BridgeLine/releases/latest"
RELEASES_PAGE = "https://github.com/oleksandr-stark/BridgeLine/releases"
UPDATE_CACHE = os.path.join(ROOT, "update_check.json")   # last GitHub answer
UPDATE_NOTE = os.path.join(ROOT, "update.json")          # read by the panel
CHECK_EVERY = 24 * 3600


def panel_statuses(max_age=None):
    """Heartbeats written by the panels (one per After Effects): [{ae, panel, listen, allowChanges, project, busy, age}]."""
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, "status", "*.json"))):
        try:
            with open(f, encoding="utf-8") as fh:
                st = json.load(fh)
            st["age"] = round(time.time() - st.get("time", 0) / 1000.0, 1)
            if max_age is None or st["age"] <= max_age:
                out.append(st)
        except Exception:
            pass
    return out


def _same_path(a, b):
    n = lambda p: os.path.normcase(os.path.normpath(os.path.abspath(os.path.expanduser(p))))
    try:
        return n(a) == n(b)
    except Exception:
        return False


def explain_silence():
    """One line about what the panels are doing, for timeout messages."""
    sts = panel_statuses()
    if not sts:
        return "No panel heartbeat found (panel 1.0.5+ not open)."
    parts = []
    for st in sts:
        who = "AE %s" % st.get("ae")
        if st["age"] > 15:
            if st.get("busy"):
                parts.append("%s: busy with '%s' for %d s (long command, or a dialog is open)" % (who, st["busy"].get("command"), time.time() - st.get("busySince", 0) / 1000.0))
            else:
                parts.append("%s: silent for %d s (After Effects closed, frozen, or a modal dialog is open; if no dialog is open, untick and tick Listen in the panel or reopen it)" % (who, st["age"]))
        elif not st.get("listen"):
            parts.append("%s: Listen is off" % who)
        else:
            parts.append("%s: listening, project %s, changes %s" % (who, os.path.basename(st.get("project") or "-") or "-", "allowed" if st.get("allowChanges") else "off"))
    return "Panels: " + "; ".join(parts) + "."


def send(command, args, timeout=120, project=None):
    os.makedirs(ROOT, exist_ok=True)
    cid = uuid.uuid4().hex[:12]
    if os.path.exists(CMD):
        age = time.time() - os.path.getmtime(CMD)
        if age < 5:
            return {"ok": False, "error": "previous command is still waiting to be picked up"}, 2
        try:
            os.remove(CMD)
        except OSError:
            pass
    project = project or os.environ.get("AEB_PROJECT")
    if project:
        # fast answer when fresh heartbeats show that no listening panel has this project open
        recent = panel_statuses(max_age=3600)   # a busy panel does not refresh its heartbeat (ExtendScript is single-threaded)
        fresh = [st for st in recent if st["age"] <= 6 and st.get("listen")]
        if fresh and not any(st.get("project") and _same_path(st["project"], project) for st in recent) and not any(st.get("busy") for st in recent):
            opened = ", ".join("AE %s: %s" % (st.get("ae"), st.get("project") or "unsaved project") for st in fresh)
            return {"ok": False, "retry_safe": True, "error": "no listening After Effects has '%s' open (%s). Nothing was sent. Open the project, or pass the path of the open one." % (project, opened)}, 2
        # every panel with this project open has been silent for a while and is not running a command: the command would
        # only wait out the pickup window (and maybe an MCP client's tool timeout). Answer now.
        mine = [st for st in recent if st.get("project") and _same_path(st["project"], project)]
        if mine and not any(st["age"] <= 15 or st.get("busy") for st in mine):
            return {"ok": False, "retry_safe": True, "error": "the BridgeLine panel with '%s' open has been silent for %d s and is not running a command. Nothing was sent. A dialog may be open in After Effects (close it), or AE is closed or frozen. If no dialog is open, untick and tick Listen in the panel (or reopen Window > BridgeLine.jsx), then send again." % (os.path.basename(project), min(st["age"] for st in mine))}, 2
    tmp = CMD + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        msg = {"id": cid, "command": command, "args": args}
        if project:
            msg["project"] = project
        json.dump(msg, f, ensure_ascii=False)
    os.replace(tmp, CMD)
    # A panel that does not have `project` open leaves the command file in place for
    # ~15 s so another AE instance can claim it (bridge >= 1.0.2). Only treat an
    # untouched file as "nobody is listening" after that window has passed.
    pickup = 20 if project else 4
    t0 = time.time()
    while time.time() - t0 < timeout:
        if os.path.exists(CMD) and time.time() - t0 > pickup:
            try:
                os.remove(CMD)
            except OSError:
                pass
            res = _result()
            if not res or res.get("id") != cid:
                return {"ok": False, "retry_safe": True,
                        "error": "command not picked up in %s s, nothing was run (safe to send again): no listening AE has '%s' open, or the panel is not listening (Window > BridgeLine.jsx, tick Listen). %s The client uses %s; if the panel log shows another bridge folder, set AEB_ROOT to it. `aeb.py doctor` checks the setup." % (pickup, project or "the project", explain_silence(), ROOT)}, 2
        res = _result()
        if res and res.get("id") == cid:
            if res.get("ok") and command == "renderFrames":
                wait_frames(res)
                missing = [f["time"] for f in res["result"]["frames"] if f.get("state") in ("missing", "partial")]
                if missing and not args.get("_retried"):
                    # frames that never appeared: ask once more for just those times
                    a2 = dict(args, times=missing, _retried=True)
                    a2.pop("range", None); a2.pop("markers", None); a2.pop("time", None)
                    r2, c2 = send(command, a2, timeout, project)
                    if c2 == 0:
                        again = {f["time"]: f for f in r2["result"]["frames"]}
                        res["result"]["frames"] = [again.get(f["time"], f) if f["time"] in missing else f for f in res["result"]["frames"]]
                        res["frameCheck"]["retried"] = missing
                        res["frameCheck"]["ready"] = all(f.get("state") not in ("missing", "partial") for f in res["result"]["frames"])
            return res, (0 if res.get("ok") else 1)
        time.sleep(0.1)
    if os.path.exists(CMD):
        # still waiting in the folder: the panel never took it, so it is safe to withdraw and resend
        try:
            os.remove(CMD)
            return {"ok": False, "retry_safe": True, "error": "timeout after %ss: the panel did not pick the command up, nothing was run (safe to send again). %s" % (timeout, explain_silence())}, 2
        except OSError:
            pass
    return {"ok": False, "retry_safe": False, "id": cid,
            "error": "timeout after %ss: the panel took the command but has not answered. It may still be running, or After Effects shows a dialog. %s "
                     "Do NOT resend a change: `aeb.py status %s` shows its result when it finishes; otherwise read the state first." % (timeout, explain_silence(), cid)}, 2


def _ver(v):
    """'1.0.10' -> (1, 0, 10); None if it is not a version."""
    m = re.match(r"^v?(\d+(?:\.\d+)*)$", str(v or "").strip())
    return tuple(int(x) for x in m.group(1).split(".")) if m else None


def repo_version():
    """Version of the panel file next to this client (what install.sh / install.ps1 would install)."""
    for f in (os.path.join(HERE, "BridgeLine.jsx"), os.path.join(HERE, "src", "00_core.jsx")):
        try:
            with open(f, encoding="utf-8") as fh:
                m = re.search(r'VERSION: "([0-9.]+)"', fh.read(4000))
            if m:
                return m.group(1)
        except OSError:
            pass
    return None


def latest_release():
    """Latest public release (cached for a day). None when unknown or disabled."""
    cache = {}
    try:
        with open(UPDATE_CACHE, encoding="utf-8") as f:
            cache = json.load(f)
    except Exception:
        pass
    if os.environ.get("BRIDGELINE_NO_UPDATE_CHECK") or time.time() - cache.get("checked", 0) < CHECK_EVERY:
        return cache.get("latest")
    cache["checked"] = time.time()  # also after a failure: do not retry on every ping
    try:
        import urllib.request
        req = urllib.request.Request(RELEASES_API, headers={"User-Agent": "BridgeLine-client", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=3) as r:
            tag = json.load(r).get("tag_name")
        if _ver(tag):
            cache["latest"] = tag.lstrip("v")
    except Exception:
        pass
    try:
        with open(UPDATE_CACHE, "w", encoding="utf-8") as f:
            json.dump(cache, f)
    except OSError:
        pass
    return cache.get("latest")


def check_updates(res):
    """Add res['update'] and write update.json for the panel if the panel is older than the files or the latest release."""
    try:
        installed = res["result"]["bridge"]
    except (KeyError, TypeError):
        return
    inst, repo, latest = _ver(installed), repo_version(), latest_release()
    installer = "install.ps1" if os.name == "nt" else "install.sh"
    upd = None
    newer_release = _ver(latest) and inst and _ver(latest) > inst and (not _ver(repo) or _ver(latest) > _ver(repo))
    if not newer_release and _ver(repo) and inst and _ver(repo) > inst:
        upd = {"installed": installed, "available": repo, "where": "files",
               "message": "The panel (%s) is older than the files in %s (%s). Run %s there, then reopen the panel." % (installed, HERE, repo, installer)}
    elif newer_release:
        upd = {"installed": installed, "available": latest, "where": "release",
               "message": "BridgeLine %s is available (installed %s): %s. Update the files in %s (git pull), then run %s and reopen the panel." % (latest, installed, RELEASES_PAGE, HERE, installer)}
    try:
        if upd:
            res["update"] = upd
            with open(UPDATE_NOTE, "w", encoding="utf-8") as f:
                json.dump({"installed": installed, "available": upd["available"], "where": upd["where"]}, f)
        elif os.path.exists(UPDATE_NOTE):
            os.remove(UPDATE_NOTE)
    except OSError:
        pass


PNG_END = b"\x00\x00\x00\x00IEND\xaeB`\x82"


def png_state(path):
    """'missing' | 'partial' | 'empty' (complete, every pixel transparent black) | 'ok'. 8-bit PNGs as written by AE."""
    import struct, zlib
    try:
        with open(path, "rb") as f:
            d = f.read()
    except OSError:
        return "missing"
    if len(d) < 60 or not d.endswith(PNG_END):
        return "partial"
    try:
        h = struct.unpack(">I", d[20:24])[0]
        pos, idat = 8, []
        while pos < len(d):
            ln, typ = struct.unpack(">I4s", d[pos:pos + 8])
            if typ == b"IDAT":
                idat.append(d[pos + 8:pos + 8 + ln])
            pos += 12 + ln
        raw = zlib.decompress(b"".join(idat))
        # every byte zero except at most one filter byte per row = nothing visible
        if raw.count(0) >= len(raw) - h:
            return "empty"
    except Exception:
        return "ok"
    return "ok"


def wait_frames(res, timeout=20):
    """After renderFrames: wait until every PNG is complete (saveFrameToPng returns before the file is written),
    then flag empty frames and frames identical to another one. Adds res['frameCheck'] and warnings."""
    import hashlib
    frames = ((res.get("result") or {}).get("frames")) or []
    t0, states = time.time(), {}
    while time.time() - t0 < timeout:
        states = {fr["file"]: png_state(fr["file"]) for fr in frames}
        if all(v not in ("missing", "partial") for v in states.values()):
            break
        time.sleep(0.25)
    seen, same, warns = {}, [], res.setdefault("warnings", [])
    for fr in frames:
        st = states.get(fr["file"])
        fr["state"] = st
        if st in ("ok", "empty"):
            hsh = hashlib.sha1(open(fr["file"], "rb").read()).hexdigest()
            if hsh in seen:
                same.append([seen[hsh], fr["time"]])
            else:
                seen[hsh] = fr["time"]
    bad = [fr["time"] for fr in frames if fr.get("state") in ("missing", "partial")]
    empty = [fr["time"] for fr in frames if fr.get("state") == "empty"]
    if bad:
        warns.append("frames not written completely after %d s: %s" % (timeout, bad))
    if empty:
        warns.append("empty (fully transparent) frames at %s: nothing visible, or the layers are off at that time" % empty)
    if same:
        warns.append("identical frames (time -> same picture as): %s - a static moment, or AE returned a cached frame" % same)
    res["frameCheck"] = {"ready": not bad, "waited": round(time.time() - t0, 2), "empty": empty, "identical": same}
    if not warns:
        res.pop("warnings")
    return res


def _result():
    # None while the file is missing or being replaced by the panel
    try:
        with open(RES, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def compare(a):
    res, code = send("renderFrames", {"comp": a.comp, "time": a.time, "folder": "compare"})
    if code:
        return res, code
    ours = res["result"]["frames"][0]["file"]
    ref = os.path.join(ROOT, "compare", "ref.png")
    out = a.out or os.path.join(ROOT, "compare", "compare_%s.png" % str(a.time).replace(".", "_"))
    time.sleep(0.5)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", a.ref, "-ss", str(a.ref_time), "-frames:v", "1", ref], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", ours, "-i", ref, "-filter_complex",
                    "[0]scale=960:-2[a];[1]scale=960:-2[b];[a][b]hstack", out], check=True)
    return {"ok": True, "result": {"compare": out, "ours": ours, "ref": ref}}, 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "status":
        # aeb.py status [id]: panel heartbeats, or the stored result of a command by id
        if len(sys.argv) > 2:
            f = os.path.join(ROOT, "results", re.sub(r"[^A-Za-z0-9_-]", "_", sys.argv[2]) + ".json")
            if os.path.exists(f):
                print(open(f, encoding="utf-8").read()); sys.exit(0)
            busy = [st for st in panel_statuses() if (st.get("busy") or {}).get("id") == sys.argv[2]]
            print(json.dumps({"ok": False, "id": sys.argv[2], "state": "running" if busy else "unknown (not finished, or older than the last 100 results)",
                              "panels": explain_silence()}, indent=1)); sys.exit(2)
        print(json.dumps({"panels": panel_statuses(), "summary": explain_silence()}, ensure_ascii=False, indent=1)); sys.exit(0)
    if len(sys.argv) > 1 and sys.argv[1] in ("doctor", "report", "review", "pixdiff", "render", "render-status", "render-cancel", "textsheet"):
        sys.path.insert(0, HERE)
        import aeb_support
        sys.exit(aeb_support.main(sys.argv[1:]))
    if len(sys.argv) > 1 and sys.argv[1] == "compare":
        p = argparse.ArgumentParser()
        p.add_argument("cmd"); p.add_argument("--comp", required=True); p.add_argument("--time", type=float, required=True)
        p.add_argument("--ref", required=True); p.add_argument("--ref-time", type=float, required=True); p.add_argument("--out")
        res, code = compare(p.parse_args())
    else:
        p = argparse.ArgumentParser()
        p.add_argument("command"); p.add_argument("args", nargs="?", default="{}")
        p.add_argument("--args-file"); p.add_argument("--project"); p.add_argument("--timeout", type=float, default=120); p.add_argument("--max", type=int, default=20000)
        a = p.parse_args()
        args = json.load(open(a.args_file, encoding="utf-8")) if a.args_file else json.loads(a.args)
        res, code = send(a.command, args, a.timeout, a.project)
        if a.command == "ping" and code == 0:
            check_updates(res)
        text = json.dumps(res, ensure_ascii=False, indent=1)
        if a.max and len(text) > a.max:
            dump = os.path.join(ROOT, "last_result.json")
            with open(dump, "w", encoding="utf-8") as f:
                f.write(text)
            text = text[:a.max] + "\n... truncated (%d chars). Full: %s" % (len(text), dump)
        print(text)
        sys.exit(code)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    sys.exit(code)


if __name__ == "__main__":
    utf8_stdio()
    main()
