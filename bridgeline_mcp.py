#!/usr/bin/env python3
"""BridgeLine as an MCP server (stdio, no dependencies) - for Claude Desktop, Cursor, Claude Code and other MCP clients.

  claude mcp add bridgeline -- python3 /path/to/BridgeLine/bridgeline_mcp.py
  Claude Desktop / Cursor: {"mcpServers": {"bridgeline": {"command": "python3", "args": ["/path/to/BridgeLine/bridgeline_mcp.py"]}}}

It uses the same file protocol as aeb.py (the panel in After Effects still does the work and still needs Listen and,
for changes, Allow changes). Frames come back as images. Env: AEB_PROJECT (default project), AEB_ROOT (exchange folder),
BRIDGELINE_MCP_ALL_TOOLS=1 (also one tool per panel command - many clients cope badly with 140+ tools).
"""
import base64, json, os, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aeb            # noqa: E402
import aeb_support    # noqa: E402

VERSION = aeb.repo_version() or "?"
PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"]
MAX_TEXT = 60000

INSTRUCTIONS = """BridgeLine drives a live Adobe After Effects project through a panel (Window > BridgeLine.jsx).
- Always pass `project` (path of the .aep open in AE) unless AEB_PROJECT is set; several AE versions can be open.
- Start with bridgeline_command {"command":"ping"}; read before you change (compInfo, dumpComp, textLayout, renderFrames).
- Changes need the user to tick 'Allow changes' in the panel; show a plan first on real projects. Every command is one undo step.
- Use bridgeline_help to find commands; full docs: prompt 'bridgeline' and resource bridgeline://commands.
- Never resend a change after a timeout with retry_safe:false - read the state first.
- If nothing answers: bridgeline_doctor; to report a problem: bridgeline_report."""


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required)}


PROJ = {"type": "string", "description": "Path of the .aep open in After Effects (default: AEB_PROJECT)"}
TOOLS = [
    {"name": "bridgeline_command", "description": "Run any BridgeLine panel command (see bridgeline_help / resource bridgeline://commands). "
     "Returns the panel's JSON result (warnings included). renderFrames results also return the frames as images.",
     "inputSchema": obj({"command": {"type": "string"}, "args": {"type": "object", "description": "Arguments of the command"},
                         "project": PROJ, "timeout": {"type": "number", "description": "seconds, default 120"}}, ["command"])},
    {"name": "bridgeline_help", "description": "List panel commands with their arguments. filter = regex on name/description.",
     "inputSchema": obj({"filter": {"type": "string"}, "project": PROJ})},
    {"name": "bridgeline_frames", "description": "Render comp frames and return them as images (complete PNGs, empty/identical frames flagged). "
     "Use 1 frame for a static change, 2+ for a direction, a range for timing.",
     "inputSchema": obj({"comp": {"type": ["string", "number"]}, "time": {"type": ["number", "string"]}, "times": {"type": "array"},
                         "range": {"type": "array"}, "step": {"type": "number"}, "isolate": {"type": ["string", "array"]},
                         "maxWidth": {"type": "number", "description": "downscale images for the model, default 960"},
                         "project": PROJ}, ["comp"])},
    {"name": "bridgeline_review", "description": "Contact sheet of a range of a comp as one image (mid grey = transparent).",
     "inputSchema": obj({"comp": {"type": ["string", "number"]}, "range": {"type": "array"}, "frames": {"type": "number"},
                         "cols": {"type": "number"}, "project": PROJ}, ["comp"])},
    {"name": "bridgeline_pixdiff", "description": "What changed between two PNG frames: share of pixels, bounding box, heatmap image.",
     "inputSchema": obj({"a": {"type": "string"}, "b": {"type": "string"}, "threshold": {"type": "number"}}, ["a", "b"])},
    {"name": "bridgeline_status", "description": "What each open BridgeLine panel is doing (project, Listen, Allow changes, busy command); with id: that command's stored result.",
     "inputSchema": obj({"id": {"type": "string"}})},
    {"name": "bridgeline_doctor", "description": "Check the installation (works without the panel) and say what to fix.",
     "inputSchema": obj({"project": PROJ})},
    {"name": "bridgeline_report", "description": "Anonymized bug report for the BridgeLine author (Markdown). Fill in 'What happened' and show it to the user before sending.",
     "inputSchema": obj({"raw": {"type": "boolean", "description": "keep real names (only if the user asks)"}, "project": PROJ})},
    {"name": "bridgeline_render", "description": "Render a comp to a video file in the background with aerender (from a copy of the saved project; AE stays free). Ask the user first.",
     "inputSchema": obj({"comp": {"type": "string"}, "out": {"type": "string"}, "range": {"type": "array"}, "outputTemplate": {"type": "string"},
                         "project": PROJ}, ["comp", "out"])},
    {"name": "bridgeline_render_status", "description": "Progress / ETA / result of background renders (all, or one job id).",
     "inputSchema": obj({"id": {"type": "string"}})},
]


# ---------------------------------------------------------------- helpers
def text(s):
    s = s if isinstance(s, str) else json.dumps(s, ensure_ascii=False, indent=1)
    if len(s) > MAX_TEXT:
        dump = os.path.join(aeb.ROOT, "mcp_last_result.json")
        try:
            with open(dump, "w", encoding="utf-8") as f:
                f.write(s)
        except OSError:
            dump = "(not saved)"
        s = s[:MAX_TEXT] + "\n... truncated (%d chars). Full: %s - or ask for less (filters, layers, out file)." % (len(s), dump)
    return {"type": "text", "text": s}


def image(path, max_w=960):
    """PNG as MCP image content, downscaled for the model (sips on macOS, else ffmpeg, else the original)."""
    src = path
    try:
        w = aeb_support._png_size(path)[0]
        if max_w and w > max_w:
            tmp = os.path.join(tempfile.gettempdir(), "bridgeline_mcp_%d.png" % abs(hash(path)))
            if sys.platform == "darwin" and shutil.which("sips"):
                subprocess.run(["sips", "-Z", str(int(max_w)), path, "--out", tmp], capture_output=True, check=True)
                src = tmp
            elif shutil.which("ffmpeg"):
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-vf", "scale=%d:-2" % max_w, tmp], check=True)
                src = tmp
    except Exception:
        src = path
    with open(src, "rb") as f:
        return {"type": "image", "data": base64.b64encode(f.read()).decode("ascii"), "mimeType": "image/png"}


def project_of(args):
    return args.get("project") or os.environ.get("AEB_PROJECT")


def send(command, cargs, project, timeout=120):
    res, code = aeb.send(command, cargs or {}, timeout, project)
    if command == "ping" and code == 0:
        aeb.check_updates(res)
    return res, code


def frames_content(res, max_w=960, limit=8):
    out = []
    frames = ((res.get("result") or {}).get("frames")) or []
    for fr in frames[:limit]:
        if fr.get("state") in ("ok", "empty", None) and os.path.exists(fr.get("file", "")):
            out.append(text("t=%s s%s" % (fr.get("time"), "  (empty)" if fr.get("state") == "empty" else "")))
            out.append(image(fr["file"], max_w))
    if len(frames) > limit:
        out.append(text("%d more frames not shown as images (files are listed above)." % (len(frames) - limit)))
    return out


# ---------------------------------------------------------------- tools
def call_tool(name, a):
    proj = project_of(a)
    if name == "bridgeline_command":
        res, code = send(a["command"], a.get("args") or {}, proj, a.get("timeout", 120))
        content = [text(res)]
        if a["command"] == "renderFrames" and code == 0:
            content += frames_content(res)
        return content, code != 0
    if name == "bridgeline_help":
        res, code = send("help", {"filter": a["filter"]} if a.get("filter") else {}, proj, 30)
        if code == 0:
            res = {"count": res["result"]["count"], "commands": ["%s%s: %s" % (c["name"], " (changes the project%s)" % (", cannot be undone" if c.get("undoable") is False else "") if c["write"] else "", c["doc"])
                                                                    for c in res["result"]["commands"]]}
        return [text(res)], code != 0
    if name == "bridgeline_frames":
        cargs = {k: a[k] for k in ("comp", "time", "times", "range", "step", "isolate") if k in a}
        cargs.setdefault("folder", "renders/mcp")
        res, code = send("renderFrames", cargs, proj, 180)
        content = [text(res)]
        if code == 0:
            content += frames_content(res, a.get("maxWidth", 960))
        return content, code != 0
    if name == "bridgeline_review":
        res, code = aeb_support.review(a["comp"], a.get("range"), a.get("frames"), a.get("cols", 4), 480, proj, None)
        content = [text(res)]
        if code == 0:
            content.append(image(res["sheet"], 1600))
        return content, code != 0
    if name == "bridgeline_pixdiff":
        heat = os.path.join(aeb.ROOT, "renders", "mcp", "pixdiff_%d.png" % int(time.time()))
        os.makedirs(os.path.dirname(heat), exist_ok=True)
        res, code = aeb_support.pixdiff(a["a"], a["b"], int(a.get("threshold", 8)), heat)
        content = [text(res)]
        if code == 0 and os.path.exists(heat):
            content.append(image(heat, 960))
        return content, code != 0
    if name == "bridgeline_status":
        if a.get("id"):
            f = os.path.join(aeb.ROOT, "results", a["id"] + ".json")
            if os.path.exists(f):
                return [text(open(f, encoding="utf-8").read())], False
            return [text({"id": a["id"], "state": "not finished or unknown", "panels": aeb.explain_silence()})], False
        return [text({"panels": aeb.panel_statuses(), "summary": aeb.explain_silence()})], False
    if name == "bridgeline_doctor":
        d = aeb_support.doctor(project=proj)
        lines = ["%-4s %s%s" % (c["level"], c["check"], ("  -> " + c["hint"]) if c["hint"] and c["level"] in ("warn", "FAIL") else "") for c in d["checks"]]
        return [text("\n".join(lines))], False
    if name == "bridgeline_report":
        return [text(aeb_support.report(raw=bool(a.get("raw")), project=proj))], False
    if name == "bridgeline_render":
        res, code = aeb_support.render(a["comp"], a["out"], a.get("range"), a.get("outputTemplate"), None, proj)
        return [text(res)], code != 0
    if name == "bridgeline_render_status":
        res, code = aeb_support.render_status(a.get("id"))
        return [text(res)], code != 0
    if name.startswith("bl_"):          # BRIDGELINE_MCP_ALL_TOOLS: one tool per panel command
        cargs = dict(a)
        cargs.pop("project", None)
        res, code = send(name[3:], cargs, proj)
        content = [text(res)]
        if name == "bl_renderFrames" and code == 0:
            content += frames_content(res)
        return content, code != 0
    raise KeyError(name)


def all_tools():
    tools = list(TOOLS)
    if os.environ.get("BRIDGELINE_MCP_ALL_TOOLS"):
        res, code = aeb.send("help", {}, 5, os.environ.get("AEB_PROJECT"))
        if code == 0:
            for c in res["result"]["commands"]:
                tools.append({"name": "bl_" + c["name"], "description": c["doc"][:1000],
                              "inputSchema": {"type": "object", "properties": {"project": PROJ}, "additionalProperties": True}})
    return tools


def read_file(rel):
    for base in (HERE, os.path.join(HERE, "public")):   # public repo: next to this file; private repo: public/
        try:
            with open(os.path.join(base, rel), encoding="utf-8") as f:
                return f.read()
        except OSError:
            pass
    return "(%s not found next to bridgeline_mcp.py)" % rel


RESOURCES = [
    {"uri": "bridgeline://commands", "name": "BridgeLine commands", "mimeType": "text/markdown", "description": "All panel commands with arguments"},
    {"uri": "bridgeline://agents", "name": "BridgeLine agent instructions", "mimeType": "text/markdown", "description": "How to work with the bridge (AGENTS.md)"},
    {"uri": "bridgeline://status", "name": "Panel status", "mimeType": "application/json", "description": "What each open panel is doing"},
]


# ---------------------------------------------------------------- JSON-RPC over stdio
def reply(id_, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": id_}
    if error:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle(msg):
    method, id_, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if id_ is None:
        return                                  # notification (initialized, cancelled...)
    if method == "initialize":
        want = params.get("protocolVersion")
        reply(id_, {"protocolVersion": want if want in PROTOCOLS else PROTOCOLS[0],
                    "capabilities": {"tools": {}, "prompts": {}, "resources": {}},
                    "serverInfo": {"name": "bridgeline", "version": VERSION}, "instructions": INSTRUCTIONS})
    elif method == "ping":
        reply(id_, {})
    elif method == "tools/list":
        reply(id_, {"tools": all_tools()})
    elif method == "tools/call":
        try:
            content, is_err = call_tool(params.get("name"), params.get("arguments") or {})
            reply(id_, {"content": content, "isError": bool(is_err)})
        except KeyError as e:
            reply(id_, error={"code": -32602, "message": "unknown tool or missing argument: %s" % e})
        except Exception as e:
            reply(id_, {"content": [text("BridgeLine MCP error: %s: %s" % (type(e).__name__, e))], "isError": True})
    elif method == "prompts/list":
        reply(id_, {"prompts": [{"name": "bridgeline", "description": "How to work with After Effects through BridgeLine (AGENTS.md)"}]})
    elif method == "prompts/get":
        reply(id_, {"description": "BridgeLine instructions", "messages": [{"role": "user", "content": {"type": "text", "text": read_file("AGENTS.md")}}]})
    elif method == "resources/list":
        reply(id_, {"resources": RESOURCES})
    elif method == "resources/read":
        uri = params.get("uri")
        if uri == "bridgeline://commands":
            body, mt = read_file(os.path.join("docs", "COMMANDS.md")), "text/markdown"
        elif uri == "bridgeline://agents":
            body, mt = read_file("AGENTS.md"), "text/markdown"
        elif uri == "bridgeline://status":
            body, mt = json.dumps({"panels": aeb.panel_statuses(), "summary": aeb.explain_silence()}, ensure_ascii=False, indent=1), "application/json"
        else:
            return reply(id_, error={"code": -32602, "message": "unknown resource " + str(uri)})
        reply(id_, {"contents": [{"uri": uri, "mimeType": mt, "text": body}]})
    else:
        reply(id_, error={"code": -32601, "message": "method not found: " + str(method)})


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            reply(None, error={"code": -32700, "message": "parse error"})
            continue
        for m in (msg if isinstance(msg, list) else [msg]):
            handle(m)


if __name__ == "__main__":
    main()
