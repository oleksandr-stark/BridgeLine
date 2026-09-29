#!/usr/bin/env python3
"""Client for BridgeLine panel.

  aeb.py COMMAND ['{"json":"args"}'] [--timeout 120] [--max 20000]
  aeb.py COMMAND --args-file args.json
  --project /path/file.aep (or env AEB_PROJECT): panel refuses if another project is open
  aeb.py compare --comp NAME --time T --ref VIDEO --ref-time T2 [--out file.png]

Writes <Documents>/bridgeline/command.json atomically, waits for result.json with the same id,
prints it. Exit code 0 = ok, 1 = command error, 2 = timeout / panel not listening.
<Documents> is the same folder the panel uses (on Windows also when Documents is moved to OneDrive).
Set AEB_ROOT to override the exchange folder.

Updates: after a successful `ping` the client checks (at most once a day) the latest release on GitHub and
compares it, and the version of BridgeLine.jsx next to this file, with the panel that answered. If something is
newer, the ping result gets an "update" field and update.json tells the panel to show a notice.
Set BRIDGELINE_NO_UPDATE_CHECK=1 to skip the GitHub request (the local check still runs).
"""
import json, os, re, subprocess, sys, time, uuid, argparse



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
    tmp = CMD + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        msg = {"id": cid, "command": command, "args": args}
        project = project or os.environ.get("AEB_PROJECT")
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
                return {"ok": False, "error": "command not picked up in %s s: no listening AE has '%s' open, or the panel is not listening (Window > BridgeLine.jsx, tick Listen). The client uses %s; if the panel log shows another bridge folder, set AEB_ROOT to it." % (pickup, project or "the project", ROOT)}, 2
        res = _result()
        if res and res.get("id") == cid:
            return res, (0 if res.get("ok") else 1)
        time.sleep(0.1)
    return {"ok": False, "error": "timeout after %ss (AE busy?)" % timeout}, 2


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
    main()
