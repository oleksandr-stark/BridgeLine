#!/usr/bin/env python3
"""Client for BridgeLine panel.

  aeb.py COMMAND ['{"json":"args"}'] [--timeout 120] [--max 20000]
  aeb.py COMMAND --args-file args.json
  --project /path/file.aep (or env AEB_PROJECT): panel refuses if another project is open
  aeb.py compare --comp NAME --time T --ref VIDEO --ref-time T2 [--out file.png]

Writes ~/Documents/bridgeline/command.json atomically, waits for result.json with the same id,
prints it. Exit code 0 = ok, 1 = command error, 2 = timeout / panel not listening.
"""
import json, os, subprocess, sys, time, uuid, argparse

ROOT = os.path.expanduser("~/Documents/bridgeline")
CMD = os.path.join(ROOT, "command.json")
RES = os.path.join(ROOT, "result.json")


def send(command, args, timeout=120, project=None):
    os.makedirs(ROOT, exist_ok=True)
    cid = uuid.uuid4().hex[:12]
    if os.path.exists(CMD):
        age = time.time() - os.path.getmtime(CMD)
        if age < 5:
            return {"ok": False, "error": "previous command is still waiting to be picked up"}, 2
        os.remove(CMD)
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
            if not os.path.exists(RES) or _rid() != cid:
                return {"ok": False, "error": "command not picked up in %s s: no listening AE has '%s' open, or the panel is not listening (Window > BridgeLine.jsx, tick Listen)" % (pickup, project or "the project")}, 2
        if _rid() == cid:
            with open(RES, encoding="utf-8") as f:
                res = json.load(f)
            return res, (0 if res.get("ok") else 1)
        time.sleep(0.1)
    return {"ok": False, "error": "timeout after %ss (AE busy?)" % timeout}, 2


def _rid():
    try:
        with open(RES, encoding="utf-8") as f:
            return json.load(f).get("id")
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
