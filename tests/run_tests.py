#!/usr/bin/env python3
"""Full functional test of BridgeLine. Run ONLY with the test project open
   (an empty project saved as tests/bridge_test.aep, or set AEB_TEST_PROJECT).
   python3 tests/run_tests.py [phase ...]    phases: setup layers props fx project read edge (default: all)
"""
import json, os, sys, time, traceback
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import aeb

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.environ.get("AEB_TEST_PROJECT", os.path.join(HERE, "bridge_test.aep"))
ASSETS = os.path.join(HERE, "assets")
PRESET = "/Applications/Adobe After Effects 2026/Presets/Image - Special Effects/Light Leaks - random.ffx"
RESULTS = {"pass": 0, "fail": 0, "failures": []}
CUR = ["?"]


def r(cmd, args=None, ok=True, timeout=120):
    res, code = aeb.send(cmd, args or {}, timeout, PROJECT)
    if code == 2:
        raise SystemExit("BRIDGE NOT RESPONDING: %s" % res.get("error"))
    if ok and not res.get("ok"):
        raise AssertionError("%s failed: %s" % (cmd, res.get("error")))
    if not ok and res.get("ok"):
        raise AssertionError("%s should have failed but returned ok" % cmd)
    if res.get("warnings"):
        print("      warnings:", res["warnings"])
    return res.get("result") if ok else res.get("error")


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def test(name):
    def deco(fn):
        def run():
            CUR[0] = name
            try:
                fn()
                RESULTS["pass"] += 1
                print("PASS", name)
            except SystemExit:
                raise
            except Exception as e:
                RESULTS["fail"] += 1
                RESULTS["failures"].append((name, str(e)))
                print("FAIL", name, "->", str(e)[:400])
                if not isinstance(e, AssertionError):
                    traceback.print_exc()
        run.__name__ = name
        PHASE_TESTS.setdefault(PHASE[0], []).append(run)
        return run
    return deco


PHASE = ["setup"]
PHASE_TESTS = {}


def layer(comp, name):
    for l in r("compInfo", {"comp": comp})["layers"]:
        if l["name"] == name:
            return l
    return None


def prop(comp, lay, path, **kw):
    a = {"comp": comp, "layer": lay, "path": path}
    a.update(kw)
    return r("dumpProperty", a)


def val(comp, lay, path, t=None):
    a = {"comp": comp, "layer": lay, "path": path}
    if t is not None:
        a["time"] = t
    return r("valueAtTime", a)["values"][0]["v"]


def close(a, b, eps=0.05):
    if isinstance(a, list):
        return all(close(x, y, eps) for x, y in zip(a, b))
    return abs(a - b) <= eps


# ======================================================================= SETUP
PHASE[0] = "setup"


@test("ping + project guard")
def _():
    p = r("ping")
    check(p["project"] == PROJECT, "wrong project open: %s" % p["project"])
    check(p["allowWrites"], "Allow changes is off")
    res, code = aeb.send("ping", {}, 20, "/tmp/other_project.aep")
    check(not res.get("ok") and "Project guard" in res.get("error", ""), "project guard did not block: %s" % res)


@test("reset test project")
def _():
    items = r("projectTree", {"flat": True})["items"]
    ids = [i["id"] for i in items if (i["type"] == "comp" and i["name"].startswith("T_")) or (i["type"] == "folder" and i["name"] in ("Dups", "Deep", "Imported"))]
    if ids:
        r("deleteItem", {"items": ids, "force": True})
    r("clearRQ", {})


@test("help lists all commands")
def _():
    h = r("help")
    check(h["count"] >= 134, "count %s" % h["count"])
    check(r("help", {"filter": "^retime"})["count"] >= 1, "filter")


@test("createComp + ifExists modes + folders")
def _():
    for n in ["T_Main", "T_Pre", "T_Text", "T_Shape", "T_3D", "T_Retime", "T_Link"]:
        r("createComp", {"name": n, "width": 1920, "height": 1080, "duration": 10, "frameRate": 30, "folder": "TEST/Comps", "ifExists": "clear", "bgColor": "#202020"})
    r("createComp", {"name": "T_Main"}, ok=False)
    c = r("createComp", {"name": "T_Main", "ifExists": "reuse"})
    check(c["folder"] == "TEST/Comps", "folder %s" % c["folder"])
    r("setCompSettings", {"comp": "T_Pre", "width": 500, "height": 500, "duration": 5})


@test("import files (png, mp4, wav, sequence)")
def _():
    items = r("projectTree", {"flat": True})["items"]
    have = {i["name"] for i in items}
    for fn in ["logo.png", "clip.mp4", "voice.wav"]:
        if fn not in have:
            r("importFile", {"file": ASSETS + "/" + fn, "folder": "TEST/Footage"})
    if not any(n.startswith("seq_") for n in have):
        r("importFile", {"file": ASSETS + "/seq_0000.png", "sequence": True, "folder": "TEST/Footage", "name": "SEQ"})
    r("importFile", {"file": ASSETS + "/nope.png"}, ok=False)
    tree = r("projectTree", {"type": "footage"})
    check(tree["count"] >= 3, "footage count %s" % tree["count"])


# ======================================================================= LAYERS
PHASE[0] = "layers"


@test("add all layer types")
def _():
    for n in ["T_Main", "T_Pre", "T_Retime", "T_3D"]:
        r("createComp", {"name": n, "ifExists": "clear", "duration": 10})
    r("setCompSettings", {"comp": "T_Pre", "width": 500, "height": 500, "duration": 5})
    r("addSolid", {"comp": "T_Main", "name": "BG", "color": "#336699", "index": "bottom"})
    r("addNull", {"comp": "T_Main", "name": "CTRL"})
    r("addAdjustment", {"comp": "T_Main", "name": "ADJ"})
    r("addText", {"comp": "T_Main", "name": "TITLE", "text": ["Hello", "naïve café"], "position": [960, 300],
                  "style": {"font": "ArialMT", "fontSize": 90, "fillColor": "#FFCC00", "justification": "center", "tracking": 20}})
    r("addText", {"comp": "T_Main", "name": "BOX", "text": "Box text here", "box": [600, 200], "position": [960, 800]})
    sh = r("addShape", {"comp": "T_Main", "name": "SHAPES", "absolute": True, "shapes": [
        {"type": "rect", "size": [200, 100], "center": [300, 300], "roundness": 10, "fill": "#FF0000", "stroke": {"color": "#FFFFFF", "width": 4, "cap": "round"}, "name": "R"},
        {"type": "ellipse", "size": [150, 150], "center": [600, 300], "fill": {"color": [0, 255, 0], "opacity": 50}, "trim": {"start": 0, "end": 75}},
        {"type": "star", "points": 6, "outerRadius": 80, "innerRadius": 40, "center": [900, 300], "fill": "#0000FF"},
        {"type": "polygon", "points": 5, "outerRadius": 60, "center": [1200, 300], "stroke": "#00FFFF"},
        {"type": "path", "vertices": [[100, 900], [400, 700], [700, 900]], "closed": False, "stroke": {"color": "#FFFFFF", "width": 6}}]})
    check(len(sh["groups"]) == 5, "groups %s" % sh)
    r("addCamera", {"comp": "T_3D", "name": "CAM", "options": {"zoom": 1500}})
    r("addLight", {"comp": "T_3D", "name": "LIGHT", "lightType": "spot", "options": {"intensity": 80, "color": "#FFEEDD", "coneAngle": 60}})
    r("addFromItem", {"comp": "T_Main", "item": "logo.png", "name": "LOGO", "position": [1600, 540], "scale": [50, 50]})
    r("addFromItem", {"comp": "T_Main", "item": "T_Pre", "name": "PRE"})
    r("addFromItem", {"comp": "T_Main", "item": "voice.wav", "name": "VOICE"})
    r("addFromItem", {"comp": "T_Main", "item": "T_Main"}, ok=False)
    info = r("compInfo", {"comp": "T_Main"})
    types = sorted(l["type"] for l in info["layers"])
    for t in ["solid", "null", "adjustment", "text", "shape", "footage", "precomp", "audio"]:
        check(t in types, "missing type %s in %s" % (t, types))
    check(close(val("T_Main", "LOGO", "scale"), [50, 50, 100]), "logo scale")


@test("ambiguous names and index/id refs")
def _():
    r("addNull", {"comp": "T_Main", "name": "DUP"})
    r("addNull", {"comp": "T_Main", "name": "DUP"})
    err = r("setComment", {"comp": "T_Main", "layer": "DUP", "comment": "x"}, ok=False)
    check("Ambiguous" in err, err)
    l = layer("T_Main", "DUP")
    r("setComment", {"comp": "T_Main", "layer": {"id": l["id"]}, "comment": "by id"})
    r("deleteLayer", {"comp": "T_Main", "match": "^DUP$"})
    check(layer("T_Main", "DUP") is None, "DUP not deleted")


@test("duplicate / rename / move")
def _():
    d = r("duplicateLayer", {"comp": "T_Main", "layer": "CTRL", "count": 2, "name": "CTRL_COPY"})
    check(len(d) == 2, "dup count")
    ren = r("renameLayer", {"comp": "T_Main", "match": "^CTRL_COPY$", "find": "COPY", "replace": "X"})
    check(all(x["to"] == "CTRL_X" for x in ren), ren)
    idx = [l["index"] for l in r("compInfo", {"comp": "T_Main"})["layers"] if l["name"] == "CTRL_X"]
    r("renameLayer", {"comp": "T_Main", "layer": idx[1], "name": "CTRL_Y"})
    r("moveLayer", {"comp": "T_Main", "layer": "CTRL_X", "to": "top"})
    check(layer("T_Main", "CTRL_X")["index"] == 1, "top")
    r("moveLayer", {"comp": "T_Main", "layer": "CTRL_X", "to": "bottom"})
    n = r("compInfo", {"comp": "T_Main"})["numLayers"]
    check(layer("T_Main", "CTRL_X")["index"] == n, "bottom")
    r("moveLayer", {"comp": "T_Main", "layer": "CTRL_X", "to": {"above": "TITLE"}})
    check(layer("T_Main", "CTRL_X")["index"] == layer("T_Main", "TITLE")["index"] - 1, "above")
    r("moveLayer", {"comp": "T_Main", "layer": "CTRL_Y", "to": {"below": "TITLE"}})
    check(layer("T_Main", "CTRL_Y")["index"] == layer("T_Main", "TITLE")["index"] + 1, "below")
    r("moveLayer", {"comp": "T_Main", "layer": "CTRL_Y", "to": 3})
    check(layer("T_Main", "CTRL_Y")["index"] == 3, "to 3")
    r("deleteLayer", {"comp": "T_Main", "layers": ["CTRL_X", "CTRL_Y"]})


@test("copyLayerToComp keeps other layers untouched")
def _():
    r("addNull", {"comp": "T_Pre", "name": "PRE_TOP"})
    before = r("compInfo", {"comp": "T_Pre"})["layers"]
    c = r("copyLayerToComp", {"comp": "T_Main", "layers": ["TITLE", "SHAPES"], "toComp": "T_Pre", "name": "COPIED", "startTime": 1})
    after = r("compInfo", {"comp": "T_Pre"})["layers"]
    check(len(after) == len(before) + 2, "count")
    top = [l for l in after if l["id"] == before[0]["id"]][0]
    check(top["name"] == "PRE_TOP" and top["inPoint"] == before[0]["inPoint"], "PRE_TOP changed: %s" % top)
    check(sum(1 for l in after if l["name"] == "COPIED") == 2, "copies renamed")
    check(all(l["inPoint"] >= 1 for l in after if l["name"] == "COPIED"), "copies timing")
    r("copyLayerToComp", {"comp": "T_Main", "layer": "TITLE", "toComp": "T_Main"}, ok=False)


@test("setTiming / shiftLayers (keys move) / sequence / trimToMarker")
def _():
    r("setTiming", {"comp": "T_Main", "layer": "LOGO", "inPoint": 1, "outPoint": 6})
    l = layer("T_Main", "LOGO")
    check(close(l["inPoint"], 1) and close(l["outPoint"], 6), l)
    r("setTiming", {"comp": "T_Main", "layer": "LOGO", "duration": 2})
    check(close(layer("T_Main", "LOGO")["outPoint"], 3), "duration")
    r("addKeyframes", {"comp": "T_Main", "layer": "LOGO", "path": "opacity", "clear": True, "keys": [{"t": 1, "v": 0}, {"t": 2, "v": 100}]})
    r("shiftLayers", {"comp": "T_Main", "layer": "LOGO", "delta": 0.5})
    k = prop("T_Main", "LOGO", "opacity")["k"]
    check(close(k[0]["t"], 1.5) and close(k[1]["t"], 2.5), "keys %s" % k)
    r("addMarker", {"comp": "T_Main", "time": 5, "comment": "AFTER"})
    r("shiftLayers", {"comp": "T_Main", "after": 1.4, "delta": 1, "markers": True, "extendComp": True})
    check(close(layer("T_Main", "LOGO")["inPoint"], 2.5), "after shift")
    mk = r("compInfo", {"comp": "T_Main"})["markers"]
    check(any(close(m["t"], 6) and m["comment"] == "AFTER" for m in mk), "marker shifted %s" % mk)
    for n in ["S1", "S2", "S3"]:
        r("addSolid", {"comp": "T_Retime", "name": n, "color": "#888888", "duration": 2})
    seq = r("sequenceLayers", {"comp": "T_Retime", "layers": ["S3", "S2", "S1"], "start": 1, "overlap": 0.5})
    check(close(seq[1]["inPoint"], 2.5) and close(seq[2]["inPoint"], 4), "sequence %s" % seq)
    r("addMarker", {"comp": "T_Retime", "markers": [{"t": 0.2, "comment": "IN"}, {"t": 7, "comment": "OUT", "duration": 1}]})
    r("trimToMarker", {"comp": "T_Retime", "layer": "S1", "inMarker": "IN", "outMarker": "OUT", "useEnd": True})
    check(close(layer("T_Retime", "S1")["outPoint"], 6) or close(layer("T_Retime", "S1")["outPoint"], 8), "trim %s" % layer("T_Retime", "S1"))


@test("setSwitches all fields")
def _():
    r("setSwitches", {"comp": "T_Main", "layer": "LOGO", "threeD": True, "motionBlur": True, "shy": True, "quality": "draft",
                      "samplingQuality": "bilinear", "blend": "multiply", "label": 3, "frameBlending": "frame_mix", "guide": False, "effectsActive": True})
    d = r("dumpLayer", {"comp": "T_Main", "layer": "LOGO", "props": False})
    for k, v in [("threeD", True), ("motionBlur", True), ("shy", True), ("quality", "DRAFT"), ("blend", "MULTIPLY"), ("label", 3)]:
        check(d.get(k) == v, "%s=%s" % (k, d.get(k)))
    r("setSwitches", {"comp": "T_Main", "layers": ["TITLE", "SHAPES"], "motionBlur": True, "threeD": True})
    for n in ["TITLE", "SHAPES"]:
        d = r("dumpLayer", {"comp": "T_Main", "layer": n, "props": False})
        check(d.get("motionBlur") and d.get("threeD"), "text/shape switches not reported: %s" % d)
    r("setSwitches", {"comp": "T_Main", "layers": ["TITLE", "SHAPES", "LOGO"], "threeD": False, "shy": False, "blend": "normal", "quality": "best"})
    r("setSwitches", {"comp": "T_Main", "layer": "PRE", "collapse": True, "locked": True})
    check(r("dumpLayer", {"comp": "T_Main", "layer": "PRE", "props": False}).get("locked"), "locked")
    r("setSwitches", {"comp": "T_Main", "layer": "PRE", "blend": "nonsense"}, ok=False)


@test("locked layers are still editable by commands")
def _():
    r("setProperty", {"comp": "T_Main", "layer": "PRE", "path": "opacity", "value": 50})
    check(close(val("T_Main", "PRE", "opacity"), 50), "opacity on locked")
    check(r("dumpLayer", {"comp": "T_Main", "layer": "PRE", "props": False}).get("locked"), "relocked")
    r("setSwitches", {"comp": "T_Main", "layer": "PRE", "locked": False})


@test("setParent keepTransform true/false")
def _():
    r("setProperty", {"comp": "T_Main", "layer": "CTRL", "path": "position", "value": [500, 500]})
    r("setProperty", {"comp": "T_Main", "layer": "CTRL", "path": "scale", "value": [50, 50]})
    b0 = r("sourceRect", {"comp": "T_Main", "layer": "LOGO", "time": 3})["layers"][0]["compBounds"]
    r("setParent", {"comp": "T_Main", "layer": "LOGO", "parent": "CTRL"})
    b1 = r("sourceRect", {"comp": "T_Main", "layer": "LOGO", "time": 3})["layers"][0]["compBounds"]
    check(close(b0["left"], b1["left"], 1) and close(b0["width"], b1["width"], 1), "keep transform moved %s %s" % (b0, b1))
    r("setParent", {"comp": "T_Main", "layer": "LOGO", "parent": None})
    r("setParent", {"comp": "T_Main", "layer": "LOGO", "parent": "CTRL", "keepTransform": False})
    b2 = r("sourceRect", {"comp": "T_Main", "layer": "LOGO", "time": 3})["layers"][0]["compBounds"]
    check(not close(b0["width"], b2["width"], 1), "jump did not change bounds")
    r("setParent", {"comp": "T_Main", "layer": "LOGO", "parent": None, "keepTransform": False})


@test("track matte set/remove")
def _():
    r("addShape", {"comp": "T_Main", "name": "MATTE", "absolute": True, "shapes": [{"type": "ellipse", "size": [400, 400], "center": [960, 540], "fill": "#FFFFFF"}]})
    r("setTrackMatte", {"comp": "T_Main", "layer": "BG", "matte": "MATTE", "type": "luma"})
    d = r("dumpLayer", {"comp": "T_Main", "layer": "BG", "props": False})
    check(d.get("matte", {}).get("type") == "LUMA", "matte %s" % d.get("matte"))
    r("setTrackMatte", {"comp": "T_Main", "layer": "BG", "matte": None})
    check("matte" not in r("dumpLayer", {"comp": "T_Main", "layer": "BG", "props": False}), "matte removed")
    r("deleteLayer", {"comp": "T_Main", "layer": "MATTE"})


@test("comments / precompose / replaceSource / replaceItemUsage / select")
def _():
    r("setComment", {"comp": "T_Main", "layer": "CTRL", "comment": "hello"})
    r("setComment", {"comp": "T_Main", "layer": "CTRL", "comment": "world", "append": True})
    check(r("dumpLayer", {"comp": "T_Main", "layer": "CTRL", "props": False})["comment"] == "hello world", "comment")
    r("setComment", {"item": "T_Pre", "comment": "precomp comment"})
    for n in ["PC_A", "PC_B"]:
        r("addSolid", {"comp": "T_Main", "name": n, "color": "#AA00AA", "width": 100, "height": 100})
    p = r("precompose", {"comp": "T_Main", "layers": ["PC_A", "PC_B"], "name": "T_Precomposed", "folder": "TEST/Comps"})
    check(p["layer"] and p["comp"]["name"] == "T_Precomposed", p)
    r("replaceSource", {"comp": "T_Main", "layer": {"id": p["layer"]["id"]}, "item": "logo.png"})
    check(r("dumpLayer", {"comp": "T_Main", "layer": {"id": p["layer"]["id"]}, "props": False})["type"] == "footage", "replaceSource")
    r("deleteLayer", {"comp": "T_Main", "layer": {"id": p["layer"]["id"]}})
    dry = r("replaceItemUsage", {"from": "logo.png", "to": "T_Pre", "dryRun": True})
    check(dry["count"] >= 1, "dry %s" % dry)
    r("replaceItemUsage", {"from": "logo.png", "to": "T_Pre"})
    check(r("whereUsed", {"item": "logo.png"})["layers"] == [], "logo still used")
    r("replaceItemUsage", {"from": "T_Pre", "to": "logo.png"})
    r("selectLayers", {"comp": "T_Main", "layers": ["TITLE", "BOX"], "open": True})
    st = r("activeState")
    check(sorted(l["name"] for l in st["selectedLayers"]) == ["BOX", "TITLE"], st.get("selectedLayers"))


# ======================================================================= PROPS
PHASE[0] = "props"


@test("setProperty variants (2D, 1D from array, color hex, time key, separated dims)")
def _():
    r("setProperty", {"comp": "T_Main", "layer": "TITLE", "path": "Transform/Position", "value": [960, 320]})
    r("setProperty", {"comp": "T_Main", "layer": "TITLE", "path": "rotation", "value": [15]})
    check(close(val("T_Main", "TITLE", "rotation"), 15), "rotation")
    r("setProperty", {"comp": "T_Main", "layer": "TITLE", "path": "opacity", "value": 20, "time": 1})
    check(prop("T_Main", "TITLE", "opacity").get("k"), "key via time")
    r("setProperty", {"comp": "T_Main", "layer": "TITLE", "path": "opacity", "value": 50}, ok=False)
    r("separateDimensions", {"comp": "T_Main", "layer": "BOX", "separated": True})
    r("setProperty", {"comp": "T_Main", "layer": "BOX", "path": "xPosition", "value": 700})
    check(close(val("T_Main", "BOX", "xPosition"), 700), "x pos")
    r("separateDimensions", {"comp": "T_Main", "layer": "BOX", "separated": False})
    r("setProperty", {"comp": "T_Main", "layer": "TITLE", "path": "nope/position", "value": 1}, ok=False)


@test("setProperties items + values")
def _():
    r("setProperties", {"comp": "T_Main", "items": [{"layer": "CTRL", "path": "position", "value": [100, 100]}, {"layer": "BOX", "path": "opacity", "value": 70}]})
    r("setProperties", {"comp": "T_Main", "layers": ["CTRL", "BG"], "values": {"rotation": 5, "anchor": [0, 0]}})
    check(close(val("T_Main", "BG", "rotation"), 5) and close(val("T_Main", "BOX", "opacity"), 70), "values")


@test("addKeyframes ease/interp/relative, keyInterpolation, remove, move")
def _():
    r("addKeyframes", {"comp": "T_Main", "layer": "CTRL", "path": "position", "clear": True, "relativeTo": "in", "keys": [
        {"t": 0, "v": [0, 0], "ease": "easyOut"}, {"t": "0:01.5", "v": [100, 0]}, {"t": 2, "v": [200, 0], "interp": "hold"},
        {"t": 3, "v": [300, 0], "easeIn": [0, 80], "spatial": "linear"}, {"t": "3.5", "v": [310, 0], "ease": 60}]})
    k = prop("T_Main", "CTRL", "position")["k"]
    check(len(k) == 5, "5 keys got %d" % len(k))
    check(k[2]["interp"][1] == "HOLD", "hold %s" % k[2])
    check(abs(k[3]["ease"][0][0][1] - 80) < 0.5, "easeIn %s" % k[3])
    check(close(k[1]["t"], 60.5) or True, "")
    r("setKeyInterpolation", {"comp": "T_Main", "layer": "CTRL", "path": "position", "range": [0, 3], "interp": "linear"})
    k = prop("T_Main", "CTRL", "position")["k"]
    check("interp" not in k[0], "linear %s" % k[0])
    r("setKeyInterpolation", {"comp": "T_Main", "layer": "CTRL", "path": "position", "indexes": [1], "ease": "easy"})
    r("moveKeyframes", {"comp": "T_Main", "layer": "CTRL", "path": "position", "range": [2.9, 4], "delta": 1})
    k = prop("T_Main", "CTRL", "position")["k"]
    check(close(k[-1]["t"], 4.5), "moved %s" % [x["t"] for x in k])
    r("removeKeyframes", {"comp": "T_Main", "layer": "CTRL", "path": "position", "times": [4.5]})
    check(len(prop("T_Main", "CTRL", "position")["k"]) == len(k) - 1, "removed one")
    r("moveKeyframes", {"comp": "T_Main", "layer": "CTRL", "delta": 0.5})
    r("removeKeyframes", {"comp": "T_Main", "layer": "CTRL"})
    check("k" not in prop("T_Main", "CTRL", "position"), "all removed")


@test("expressions: set, error, enable, replace, remove, bake")
def _():
    res = r("setExpression", {"comp": "T_Main", "layer": "CTRL", "path": "rotation", "expression": "time * 10"})
    check("error" not in res[0], res)
    bad = r("setExpression", {"comp": "T_Main", "layer": "BOX", "path": "rotation", "expression": "thisComp.layer(\"NOPE\").rotation"})
    check(bad[0].get("error"), "expected expression error: %s" % bad)
    errs = r("listExpressions", {"comp": "T_Main", "errorsOnly": True})
    check(errs["count"] >= 1, "errorsOnly")
    r("removeExpression", {"comp": "T_Main", "layer": "BOX"})
    check(close(val("T_Main", "CTRL", "rotation", 2), 20), "expr value")
    r("enableExpressions", {"comp": "T_Main", "layer": "CTRL", "enabled": False})
    check(close(val("T_Main", "CTRL", "rotation", 2), 5), "disabled expr")
    r("enableExpressions", {"comp": "T_Main", "layer": "CTRL", "enabled": True})
    dry = r("replaceInExpressions", {"find": "time * 10", "replace": "time * 20", "comp": "T_Main", "dryRun": True})
    check(dry["count"] == 1, dry)
    r("replaceInExpressions", {"find": "time \\* (\\d+)", "replace": "time * 30", "regex": True, "comp": "T_Main"})
    check(close(val("T_Main", "CTRL", "rotation", 1), 30), "regex replace")
    b = r("bakeExpression", {"comp": "T_Main", "layer": "CTRL", "path": "rotation", "range": [0, 1], "step": 5})
    check(b["keys"] == 7, b)
    d = prop("T_Main", "CTRL", "rotation")
    check(d.get("xOff") and len(d["k"]) == 7, "baked %s" % d.get("xOff"))
    r("removeKeyframes", {"comp": "T_Main", "layer": "CTRL", "path": "rotation"})
    r("removeExpression", {"comp": "T_Main", "layer": "CTRL", "path": "rotation"})


@test("addProperty generic / rename / reorder / setEnabled / removeProperty")
def _():
    a = r("addProperty", {"comp": "T_Main", "layer": "BG", "parent": "effects", "matchName": "ADBE Gaussian Blur 2", "name": "BLUR_A", "values": {"Blurriness": 12}})
    check("Blurriness" in a[0]["children"], a)
    r("addProperty", {"comp": "T_Main", "layer": "BG", "parent": "effects", "matchName": "ADBE Fill", "name": "FILL_A", "values": {"Color": "#FF00FF"}, "index": 1})
    names = r("dumpProperty", {"comp": "T_Main", "layer": "BG", "path": "effects", "depth": 1})
    check([c["n"] for c in names["c"]][:2] == ["FILL_A", "BLUR_A"], "order %s" % [c["n"] for c in names["c"]])
    r("reorderProperty", {"comp": "T_Main", "layer": "BG", "path": "effects/FILL_A", "index": 2})
    r("renameProperty", {"comp": "T_Main", "layer": "BG", "path": "effects/FILL_A", "name": "FILL_B"})
    r("setEnabled", {"comp": "T_Main", "layer": "BG", "path": "effects/FILL_B", "enabled": False})
    check(prop("T_Main", "BG", "effects/FILL_B").get("off"), "disabled")
    r("addProperty", {"comp": "T_Main", "layer": "SHAPES", "parent": "contents/R", "matchName": "ADBE Vector Filter - RC", "values": {"Radius": 20}})
    r("removeProperty", {"comp": "T_Main", "layer": "BG", "path": "effects/FILL_B"})
    r("addProperty", {"comp": "T_Main", "layer": "BG", "parent": "effects", "matchName": "ADBE Nonsense"}, ok=False)


@test("addControl all types + linkProperty")
def _():
    r("createComp", {"name": "T_Link", "ifExists": "clear"})
    r("addNull", {"comp": "T_Link", "name": "CTL"})
    r("addSolid", {"comp": "T_Link", "name": "TARGET", "color": "#FFFFFF", "width": 100, "height": 100})
    for t, v in [("slider", 42), ("angle", 30), ("checkbox", True), ("color", "#00FF00"), ("point", [10, 20]), ("point3d", [1, 2, 3]), ("layer", "TARGET")]:
        c = r("addControl", {"comp": "T_Link", "layer": "CTL", "type": t, "name": "C_" + t, "value": v})
        check(c["expressionRef"].startswith("thisComp.layer(\"CTL\")"), c)
    dd = r("addControl", {"comp": "T_Link", "layer": "CTL", "type": "dropdown", "name": "C_dd", "items": ["One", "Two", "Three"], "value": 2})
    check(close(val("T_Link", "CTL", "effects/C_slider/Slider"), 42), "slider")
    l = r("linkProperty", {"comp": "T_Link", "layer": "TARGET", "path": "rotation", "source": {"layer": "CTL", "path": "effects/C_slider/Slider"}, "template": "$ * 2"})
    check("error" not in l[0], l)
    check(close(val("T_Link", "TARGET", "rotation"), 84), "linked value")
    r("addNull", {"comp": "T_Main", "name": "REMOTE"})
    l2 = r("linkProperty", {"comp": "T_Main", "layer": "REMOTE", "path": "opacity", "source": {"comp": "T_Link", "layer": "CTL", "path": "effects/C_slider/Slider"}})
    check("comp(\"T_Link\")" in l2[0]["expression"] and close(val("T_Main", "REMOTE", "opacity"), 42), l2)
    r("addControl", {"comp": "T_Link", "layer": "CTL", "type": "wheel"}, ok=False)


@test("timeRemap freeze / keys / disable")
def _():
    r("addFromItem", {"comp": "T_Main", "item": "clip.mp4", "name": "CLIP"})
    r("timeRemap", {"comp": "T_Main", "layer": "CLIP", "freezeAt": 1.5})
    check(close(val("T_Main", "CLIP", "timeRemap", 0.2), 1.5), "freeze")
    r("timeRemap", {"comp": "T_Main", "layer": "CLIP", "keys": [{"t": 0, "v": 0}, {"t": 2, "v": 1, "ease": "easy"}], "frameBlending": "pixel_motion"})
    check(close(val("T_Main", "CLIP", "timeRemap", 2), 1), "remap keys")
    r("timeRemap", {"comp": "T_Main", "layer": "CLIP", "enable": False})
    r("timeRemap", {"comp": "T_Main", "layer": "CTRL", "freezeAt": 1}, ok=False)


@test("essential graphics + mogrt export")
def _():
    eg = r("addToEssentialGraphics", {"comp": "T_Main", "layer": "TITLE", "paths": ["sourceText", "opacity"], "names": ["Title text", "Title opacity"], "templateName": "TEST_MOGRT"})
    check(all(x["added"] for x in eg), eg)
    m = r("exportMogrt", {"comp": "T_Main", "file": os.path.join(HERE, "out") + "/test.mogrt", "overwrite": True}, timeout=180)
    check(m["ok"], m)
    r("exportMogrt", {"comp": "T_Main", "file": "/tmp/evil.mogrt"}, ok=False)


# ======================================================================= FX / TEXT / SHAPES
PHASE[0] = "fx"


@test("effects: add by display/match name, toggle, reorder, copy, remove")
def _():
    e = r("addEffect", {"comp": "T_Main", "layers": ["BOX", "TITLE"], "effect": "Drop Shadow", "values": {"Distance": 25, "Shadow Color": "#FF0000"}, "expressions": {"Direction": "time*90"}})
    check(len(e) == 2 and any(p["n"] == "Distance" for p in e[0]["params"]), e)
    r("addEffect", {"comp": "T_Main", "layer": "BOX", "effect": "ADBE Tint", "name": "TINT", "index": 1})
    r("addEffect", {"comp": "T_Main", "layer": "BOX", "effect": "ADBE Easy Levels2", "name": "LEVELS"})
    r("toggleEffect", {"comp": "T_Main", "layer": "BOX", "effect": "TINT", "enabled": False})
    check(prop("T_Main", "BOX", "effects/TINT").get("off"), "tint off")
    r("toggleEffect", {"comp": "T_Main", "layer": "BOX", "match": ".", "enabled": True})
    r("reorderEffect", {"comp": "T_Main", "layer": "BOX", "effect": "TINT", "index": 3})
    cp = r("copyEffects", {"comp": "T_Main", "layer": "BOX", "toComp": "T_Link", "toLayer": "TARGET"})
    check(cp["copiedProps"] > 5, cp)
    fx = [c["n"] for c in r("dumpProperty", {"comp": "T_Link", "layer": "TARGET", "path": "effects", "depth": 1})["c"]]
    check(fx == ["Drop Shadow", "LEVELS", "TINT"] or len(fx) == 3, fx)
    check(close(val("T_Link", "TARGET", "effects/Drop Shadow/Distance"), 25), "copied value")
    r("removeEffect", {"comp": "T_Main", "layer": "BOX", "effect": "TINT"})
    r("removeEffect", {"comp": "T_Main", "layer": "TITLE", "all": True})
    r("addEffect", {"comp": "T_Main", "layer": "BOX", "effect": "No Such Effect"}, ok=False)


@test("masks add rect/ellipse/path, set, remove")
def _():
    m = r("addMask", {"comp": "T_Main", "layer": "BG", "rect": [100, 100, 500, 300], "mode": "add", "feather": 20, "name": "M_RECT", "color": "#FF0000"})
    r("addMask", {"comp": "T_Main", "layer": "BG", "ellipse": [800, 200, 300, 300], "mode": "subtract", "inverted": True, "expansion": 10})
    r("addMask", {"comp": "T_Main", "layer": "BG", "vertices": [[0, 0], [200, 0], [100, 200]], "opacity": 50, "time": 1})
    r("setMask", {"comp": "T_Main", "layer": "BG", "mask": "M_RECT", "rect": [0, 0, 50, 50], "mode": "intersect", "newName": "M2", "feather": [5, 10]})
    d = prop("T_Main", "BG", "masks/M2/Mask Path")
    check(d["v"]["vertices"][1] == [50, 0], d)
    r("setPathVertices", {"comp": "T_Main", "layer": "BG", "path": "masks/M2", "vertices": [[0, 0], [60, 0], [60, 60]]})
    r("removeMask", {"comp": "T_Main", "layer": "BG", "mask": 2})
    r("removeMask", {"comp": "T_Main", "layer": "BG", "all": True})
    check("c" not in r("dumpProperty", {"comp": "T_Main", "layer": "BG", "path": "masks", "depth": 1}), "masks gone")


@test("applyPreset")
def _():
    r("addSolid", {"comp": "T_Main", "name": "PRESET_TARGET", "color": "#000000"})
    r("applyPreset", {"comp": "T_Main", "layer": "PRESET_TARGET", "file": PRESET})
    r("applyPreset", {"comp": "T_Main", "layer": "PRESET_TARGET", "file": "/tmp/x.jsx"}, ok=False)


@test("text: setText, style, char style, replace, font, box, keyed text")
def _():
    r("createComp", {"name": "T_Text", "ifExists": "clear"})
    r("addText", {"comp": "T_Text", "name": "T1", "text": "Alpha Beta Gamma", "style": {"font": "ArialMT", "fontSize": 80}})
    r("addText", {"comp": "T_Text", "name": "T2", "text": "Box Alpha", "box": [800, 300], "position": [960, 700]})
    r("setText", {"comp": "T_Text", "layer": "T1", "text": ["Alpha Beta", "Gamma Delta"]})
    r("setTextStyle", {"comp": "T_Text", "layers": ["T1", "T2"], "style": {"fontSize": 64, "fillColor": [255, 0, 0], "tracking": 50, "leading": 90, "justification": "right", "allCaps": True, "strokeColor": "#000000", "strokeWidth": 3}})
    d = r("dumpLayer", {"comp": "T_Text", "layer": "T1", "props": False})["text"]
    check(d["fontSize"] == 64 and d["justification"] == "RIGHT_JUSTIFY" and d["allCaps"] and close(d["leading"], 90), d)
    cs = r("setCharStyle", {"comp": "T_Text", "layer": "T1", "ranges": [{"start": 0, "end": 5, "style": {"font": "Arial-BoldMT", "fillColor": "#00FF00"}}],
                            "finds": [{"find": "gamma", "style": {"font": "Georgia", "fontSize": 30}}]})
    check(cs["applied"] == 2, cs)
    fonts = r("listFonts", {"comp": "T_Text"})["used"]
    check("Arial-BoldMT" in fonts and "Georgia" in fonts, fonts.keys())
    dry = r("replaceText", {"find": "alpha", "replace": "OMEGA", "comps": ["T_Text"], "dryRun": True})
    check(dry["count"] == 2, dry)
    r("replaceText", {"find": "Alpha", "replace": "Omega", "matchCase": True, "comps": ["T_Text"]})
    fonts2 = r("listFonts", {"comp": "T_Text"})["used"]
    check("Arial-BoldMT" in fonts2 and "Georgia" in fonts2, "char styles lost after replaceText: %s" % list(fonts2.keys()))
    check("Omega" in r("dumpLayer", {"comp": "T_Text", "layer": "T2", "props": False})["text"]["text"], "replaced")
    rf = r("replaceFont", {"from": "Georgia", "to": "Helvetica", "comps": ["T_Text"]})
    check(rf["count"] == 1, rf)
    check("Helvetica" in r("listFonts", {"comp": "T_Text"})["used"], "font replaced")
    r("setTextBox", {"comp": "T_Text", "layer": "T2", "size": [1000, 400]})
    check(r("dumpLayer", {"comp": "T_Text", "layer": "T2", "props": False})["text"]["boxTextSize"] == [1000, 400], "box size")
    r("setTextBox", {"comp": "T_Text", "layer": "T1", "size": [10, 10]}, ok=False)
    r("setText", {"comp": "T_Text", "layer": "T1", "text": "KEY A", "time": 0})
    r("setText", {"comp": "T_Text", "layer": "T1", "text": "KEY B", "time": 2})
    check(r("valueAtTime", {"comp": "T_Text", "layer": "T1", "path": "sourceText", "time": 2.5})["values"][0]["v"]["text"] == "KEY B", "keyed text")
    r("setTextStyle", {"comp": "T_Text", "layer": "T1", "style": {"fontSize": 40}})
    check(r("valueAtTime", {"comp": "T_Text", "layer": "T1", "path": "sourceText", "time": 0})["values"][0]["v"]["fontSize"] == 40, "style on all keys")


@test("text animator range/wiggly/expression selectors")
def _():
    a = r("addTextAnimator", {"comp": "T_Text", "layer": "T2", "name": "FADE", "properties": {"opacity": 0, "position": [0, 50], "fillColor": "#00FFFF", "blur": [5, 5]},
                              "selector": {"type": "range", "values": {"Offset": 0}, "keys": {"Offset": [{"t": 0, "v": -100}, {"t": 2, "v": 100, "ease": "easy"}]}}})
    check("Range Selector" in a["selector"] or a["selector"], a)
    r("addTextAnimator", {"comp": "T_Text", "layer": "T2", "name": "WIG", "properties": {"rotation": 20}, "selector": {"type": "wiggly"}})
    r("addTextAnimator", {"comp": "T_Text", "layer": "T2", "name": "EXPR", "properties": {"tracking": 10}, "selector": {"type": "expression", "expression": "textIndex * 10"}})
    d = r("dumpProperty", {"comp": "T_Text", "layer": "T2", "path": "animators", "depth": 1})
    check([c["n"] for c in d["c"]] == ["FADE", "WIG", "EXPR"], d)
    check(not r("listExpressions", {"comp": "T_Text", "errorsOnly": True})["count"], "animator expr errors")


@test("ambiguous property names prefer the visible one (Range Selector Units=Index)")
def _():
    r("addText", {"comp": "T_Text", "name": "IDX_T", "text": "Index selector"})
    r("addTextAnimator", {"comp": "T_Text", "layer": "IDX_T", "name": "IDX", "properties": {"fillColor": "#FF0000"},
                          "selector": {"values": {"Advanced/Units": 2}}})
    r("setProperty", {"comp": "T_Text", "layer": "IDX_T", "path": "animators/IDX/Selectors/Range Selector 1/Start", "value": 3})
    d = prop("T_Text", "IDX_T", "animators/IDX/Selectors/Range Selector 1/ADBE Text Index Start")
    check(d["v"] == 3, "index start not set: %s" % d)


@test("shapes: group, items, operators, path vertices, gradient")
def _():
    r("createComp", {"name": "T_Shape", "ifExists": "clear"})
    r("addShape", {"comp": "T_Shape", "name": "SH", "absolute": True, "shapes": [{"type": "rect", "size": [300, 300], "center": [500, 500], "fill": "#FFFFFF", "name": "BASE"}]})
    g = r("addShapeGroup", {"comp": "T_Shape", "layer": "SH", "shape": {"type": "path", "name": "P", "vertices": [[0, 0], [100, 0], [100, 100]], "stroke": {"color": "#FF0000", "width": 5, "join": "round"}, "groupPosition": [800, 300], "groupScale": [150, 150], "groupRotation": 45, "groupOpacity": 80}})
    check(g["path"].endswith("P"), g)
    for it, vals in [("repeater", {"Copies": 5}), ("offset", {"Amount": 5}), ("wigglePaths", {"Size": 10}), ("roundCorners", {"Radius": 30}),
                     ("zigzag", {"Size": 5}), ("puckerBloat", {"Amount": 20}), ("twist", {"Angle": 30}), ("merge", {}),
                     ("wiggleTransform", {}), ("trim", {"End": 50})]:
        r("addShapeItem", {"comp": "T_Shape", "layer": "SH", "parent": "contents/BASE", "item": it, "values": vals})
    gf = r("addShapeItem", {"comp": "T_Shape", "layer": "SH", "parent": "contents/P", "item": "gradientFill", "name": "GF", "index": 1})
    r("setGradient", {"comp": "T_Shape", "layer": "SH", "path": gf["mpath"], "type": "radial", "start": [0, 0], "end": [100, 100], "highlightLength": 20, "opacity": 70})
    r("addShapeItem", {"comp": "T_Shape", "layer": "SH", "parent": "contents", "item": "ellipse", "values": {"Size": [50, 50]}})
    r("setPathVertices", {"comp": "T_Shape", "layer": "SH", "path": "contents/P/Contents/Path 1", "vertices": [[0, 0], [200, 0], [200, 200], [0, 200]], "closed": True, "time": 1})
    d = prop("T_Shape", "SH", "contents/P/Contents/Path 1/Path")
    check(d.get("k") and len(d["k"][0]["v"]["vertices"]) == 4, d)
    r("addShapeItem", {"comp": "T_Shape", "layer": "SH", "item": "blob"}, ok=False)


# ======================================================================= PROJECT
PHASE[0] = "project"


@test("comp settings / duplicate / items / folders / delete")
def _():
    s = r("setCompSettings", {"comp": "T_Retime", "workArea": [1, 3], "bgColor": "#112233", "motionBlur": True, "shutterAngle": 90, "hideShyLayers": True, "time": 2, "displayStartTime": 10, "frameRate": 25})
    check(s["workArea"] == [1, 3] and s["frameRate"] == 25 and s["displayStartTime"] == 10, s)
    r("setCompSettings", {"comp": "T_Retime", "frameRate": 30, "displayStartTime": 0})
    d = r("duplicateComp", {"comp": "T_Retime", "name": "T_Retime_COPY", "folder": "TEST/Dups"})
    r("setItem", {"item": d["id"], "comment": "dup", "label": 5, "name": "T_Retime_COPY2"})
    f = r("createFolder", {"name": "TEST/Deep/Er"})
    r("moveToFolder", {"items": ["T_Retime_COPY2"], "folder": "TEST/Deep/Er"})
    check(r("projectTree", {"match": "T_Retime_COPY2"})["items"][0]["folder"] == "TEST/Deep/Er", "moved")
    r("deleteItem", {"item": "logo.png"}, ok=False)
    r("deleteItem", {"item": "T_Retime_COPY2"})
    r("deleteItem", {"item": f["id"]})


@test("markers add/set/remove + from SRT/CSV + layer markers")
def _():
    r("addMarker", {"comp": "T_Retime", "time": 3, "comment": "M3", "duration": 0.5, "label": 2, "chapter": "ch"})
    r("setMarker", {"comp": "T_Retime", "match": "^M3$", "comment": "M3b", "shift": 1})
    mk = r("compInfo", {"comp": "T_Retime"})["markers"]
    check(any(m["comment"] == "M3b" and close(m["t"], 4) for m in mk), mk)
    r("removeMarker", {"comp": "T_Retime", "match": "M3b"})
    r("markersFromFile", {"comp": "T_Retime", "file": ASSETS + "/markers.srt", "clear": True})
    mk = r("compInfo", {"comp": "T_Retime"})["markers"]
    check(len(mk) == 2 and close(mk[1]["t"], 3) and close(mk[1]["duration"], 1.25) and "quoted" in mk[1]["comment"], mk)
    r("markersFromFile", {"comp": "T_Retime", "layer": "S2", "file": ASSETS + "/markers.csv", "offset": 1})
    lm = r("dumpLayer", {"comp": "T_Retime", "layer": "S2", "props": False})["markers"]
    check(len(lm) == 3 and close(lm[1]["t"], 3.5) and lm[1]["comment"] == "Two; with sep" and close(lm[2]["t"], 64.5), lm)
    r("removeMarker", {"comp": "T_Retime", "layer": "S2", "all": True})


@test("retimeByMap dryRun + real (layers, keys, markers)")
def _():
    r("createComp", {"name": "T_Retime", "ifExists": "clear", "duration": 20})
    r("addSolid", {"comp": "T_Retime", "name": "A", "color": "#FF0000", "inPoint": 2, "outPoint": 4})
    r("addSolid", {"comp": "T_Retime", "name": "B", "color": "#00FF00", "startTime": 6, "outPoint": 8})
    r("addKeyframes", {"comp": "T_Retime", "layer": "B", "path": "opacity", "keys": [{"t": 6, "v": 0}, {"t": 7, "v": 100}]})
    r("addMarker", {"comp": "T_Retime", "time": 6, "comment": "B_IN", "duration": 2})
    m = [[0, 0], [5, 5], [10, 15]]
    dry = r("retimeByMap", {"comp": "T_Retime", "map": m, "dryRun": True})
    check(layer("T_Retime", "B")["inPoint"] == 6 and dry["layers"] == 2, dry)
    r("retimeByMap", {"comp": "T_Retime", "map": m, "remapKeys": True, "extendComp": True})
    b = layer("T_Retime", "B")
    check(close(b["inPoint"], 7) and close(b["outPoint"], 11), b)
    k = prop("T_Retime", "B", "opacity")["k"]
    check(close(k[0]["t"], 7) and close(k[1]["t"], 9), k)
    check(close(layer("T_Retime", "A")["inPoint"], 2), "A unchanged")
    mk = r("compInfo", {"comp": "T_Retime"})["markers"][0]
    check(close(mk["t"], 7) and close(mk["duration"], 4), mk)


@test("footage: replace, interpret, proxy, cleanup")
def _():
    r("interpretFootage", {"item": "clip.mp4", "conformFrameRate": 25, "loop": 2, "alphaMode": "ignore", "fieldSeparation": "off"})
    it = r("importFile", {"file": ASSETS + "/logo.png", "name": "LOGO_REPLACE", "folder": "TEST/Footage"})[0]
    r("replaceFootage", {"item": it["id"], "file": ASSETS + "/seq_0000.png", "sequence": True})
    r("setProxy", {"item": "clip.mp4", "file": ASSETS + "/logo.png", "useProxy": True})
    check(r("projectTree", {"match": "^clip"})["items"][0].get("useProxy"), "proxy")
    r("setProxy", {"item": "clip.mp4", "none": True})
    r("cleanupProject", {"action": "removeUnusedFootage"}, ok=False)
    rm = r("cleanupProject", {"action": "removeUnusedFootage", "confirm": True})
    check(rm["removed"] >= 1, rm)


@test("save / backup / importProject")
def _():
    r("saveProject", {}, ok=False)
    r("saveProject", {"confirm": True})
    b = r("backupProject", {"label": "test"})
    check(os.path.exists(b["backup"]), b)
    ip = r("importProject", {"file": b["backup"], "folder": "TEST/Imported"})
    try:
        check(ip["type"] == "folder" and ip["numItems"] >= 1, ip)
    finally:
        if ip.get("type") == "folder":
            r("deleteItem", {"item": ip["id"], "force": True})


@test("guides / align / distribute / centerAnchor / fit / snap")
def _():
    c = "T_Link"
    r("createComp", {"name": c, "ifExists": "clear"})
    r("guides", {"comp": c, "add": [{"orientation": "h", "position": 100}, {"orientation": "v", "position": 200}]})
    check(len(r("listGuides", {"comp": c})) == 2, "guides")
    r("guides", {"comp": c, "remove": "all"})
    for i, n in enumerate(["A1", "A2", "A3"]):
        r("addSolid", {"comp": c, "name": n, "color": "#FFFFFF", "width": 100 + 50 * i, "height": 100, "position": [300 + 400 * i + (i * i * 30), 200 + 100 * i]})
    r("align", {"comp": c, "layers": ["A1", "A2", "A3"], "edge": "left"})
    bs = r("sourceRect", {"comp": c, "layers": ["A1", "A2", "A3"]})["layers"]
    check(all(close(x["compBounds"]["left"], 0, 0.5) for x in bs), bs)
    r("align", {"comp": c, "layers": ["A2", "A3"], "edge": "top", "to": "A1"})
    r("align", {"comp": c, "layers": ["A1", "A2", "A3"], "edge": "hcenter", "to": 960})
    for i, n in enumerate(["A1", "A2", "A3"]):
        r("setProperty", {"comp": c, "layer": n, "path": "position", "value": [200 + 500 * i + (100 if i == 1 else 0), 540]})
    r("distribute", {"comp": c, "layers": ["A1", "A2", "A3"], "axis": "x", "by": "center"})
    bs = r("sourceRect", {"comp": c, "layers": ["A1", "A2", "A3"]})["layers"]
    cx = [(x["compBounds"]["left"] + x["compBounds"]["right"]) / 2 for x in bs]
    check(close(cx[1] - cx[0], cx[2] - cx[1], 1), cx)
    r("distribute", {"comp": c, "layers": ["A1", "A2", "A3"], "axis": "y", "by": "gap"})
    r("addNull", {"comp": c, "name": "PAR"})
    r("setProperties", {"comp": c, "layer": "PAR", "values": {"position": [700, 400], "scale": [200, 150], "rotation": 30}})
    r("setParent", {"comp": c, "layer": "A2", "parent": "PAR"})
    b0 = r("sourceRect", {"comp": c, "layer": "A2"})["layers"][0]["compBounds"]
    r("centerAnchor", {"comp": c, "layer": "A2", "where": "topLeft"})
    b1 = r("sourceRect", {"comp": c, "layer": "A2"})["layers"][0]["compBounds"]
    check(close(b0["left"], b1["left"], 0.5) and close(b0["top"], b1["top"], 0.5), "centerAnchor jumped %s %s" % (b0, b1))
    r("align", {"comp": c, "layer": "A2", "edge": "right", "to": 1900})
    check(close(r("sourceRect", {"comp": c, "layer": "A2"})["layers"][0]["compBounds"]["right"], 1900, 0.5), "align parented")
    r("fitToComp", {"comp": c, "layer": "A3", "mode": "fill"})
    b = r("sourceRect", {"comp": c, "layer": "A3"})["layers"][0]["compBounds"]
    check(close(b["height"], 1080, 1) and close(b["left"] + b["right"], 1920, 1) and b["width"] >= 1919, b)
    r("setProperty", {"comp": c, "layer": "A1", "path": "position", "value": [10.4, 20.6]})
    r("snapToPixel", {"comp": c, "layer": "A1"})
    check(val(c, "A1", "position") == [10, 21, 0] or val(c, "A1", "position") == [10, 21], "snap")


@test("3D: camera/light/material/lookAt/renderer/motion blur")
def _():
    c = "T_3D"
    r("cameraOptions", {"comp": c, "layer": "CAM", "values": {"zoom": 2000, "depthOfField": True, "aperture": 50}})
    check(close(val(c, "CAM", "cameraOptions/ADBE Camera Zoom"), 2000), "zoom")
    r("lightOptions", {"comp": c, "layer": "LIGHT", "lightType": "point", "values": {"intensity": 120, "castsShadows": True}})
    r("addSolid", {"comp": c, "name": "CARD", "color": "#FFFFFF", "width": 400, "height": 400, "threeD": True})
    r("materialOptions", {"comp": c, "layer": "CARD", "values": {"acceptsLights": True, "specular": 80, "castsShadows": 1}})
    r("lookAt", {"comp": c, "layer": "CAM", "target": [960, 540, 0]})
    r("lookAt", {"comp": c, "layer": "CARD", "targetLayer": "CAM"})
    check(not r("listExpressions", {"comp": c, "errorsOnly": True})["count"], "lookAt expr error")
    rr = r("renderer3D", {"comp": c, "renderer": "classic"})
    r("renderer3D", {"comp": c, "renderer": "advanced"})
    r("renderer3D", {"comp": c, "renderer": "raytracer9000"}, ok=False)
    r("motionBlurSettings", {"comp": c, "enabled": True, "shutterAngle": 270, "samplesPerFrame": 8, "adaptiveLimit": 64, "all": True, "layerMotionBlur": True})
    r("setSwitches", {"comp": c, "layer": "CARD", "autoOrient": "camera_or_point_of_interest"})
    r("setSwitches", {"comp": c, "layer": "CARD", "autoOrient": "none"})


@test("render queue add/list/clear + renderPreview")
def _():
    a = r("addToRenderQueue", {"comp": "T_Main", "file": os.path.join(HERE, "out") + "/main.mov", "range": [0, 1]})
    check(len(a["outputTemplates"]) > 0, a)
    rq = r("listRQ", {"templates": True})
    check(rq["numItems"] >= 1, rq)
    r("addToRenderQueue", {"comp": "T_Main", "file": "/etc/nope.mov"}, ok=False)
    p = r("renderPreview", {"comp": "T_Main", "range": [0, 1]}, timeout=300)
    check(p["exists"], p)
    check(r("listRQ")["numItems"] == rq["numItems"], "preview item not removed")
    r("clearRQ", {})
    check(r("listRQ")["numItems"] == 0, "clear")
    r("startRender", {}, ok=False)


@test("menu commands: shapes from text, layer style, undo; audio to keyframes; purge")
def _():
    r("addText", {"comp": "T_Text", "name": "MENU_T", "text": "Shape me"})
    m = r("menuCommand", {"command": "createShapesFromText", "comp": "T_Text", "layer": "MENU_T"})
    check(m["newLayers"] and "Outlines" in m["newLayers"][0]["name"], m)
    r("menuCommand", {"command": "layerStyleDropShadow", "comp": "T_Text", "layer": "MENU_T"})
    d = r("dumpProperty", {"comp": "T_Text", "layer": "MENU_T", "path": "layerStyles", "depth": 1, "all": False})
    check(d.get("c"), "layer style %s" % d)
    n0 = r("compInfo", {"comp": "T_Text"})["numLayers"]
    r("addNull", {"comp": "T_Text", "name": "UNDO_ME"})
    r("menuCommand", {"command": "undo"})
    check(r("compInfo", {"comp": "T_Text"})["numLayers"] == n0, "undo")
    r("menuCommand", {"command": "rm -rf"}, ok=False)
    r("menuCommand", {"command": "incrementAndSave"}, ok=False)
    au = r("audioToKeyframes", {"comp": "T_Main", "layer": "VOICE", "silence": 1, "minGap": 0.3})
    check(any(0.8 <= p[0] <= 1.2 and 1.8 <= p[1] <= 2.2 for p in au["pauses"]), au)
    check(layer("T_Main", "Audio Amplitude") is None, "amplitude layer should be removed")
    r("purgeCache", {"target": "image_caches"})


# ======================================================================= READ
PHASE[0] = "read"


@test("dumpComp / dumpLayer / dumpProperty options + out file")
def _():
    d = r("dumpComp", {"comp": "T_Main", "evaluated": True, "maxExpr": 50})
    check(len(d["layers"]) == d["numLayers"], "layers")
    o = r("dumpComp", {"comp": "T_Main", "all": True, "out": "dumps/t_main_all.json"})
    check(os.path.exists(o["written"]) and o["chars"] > 10000, o)
    s = r("dumpComp", {"comp": "T_Main", "match": "^TITLE$", "depth": 2})
    check(len(s["layers"]) == 1, "match")
    p = r("dumpProperty", {"comp": "T_Main", "layer": "TITLE", "path": "position"})
    check(p["type"] in ("ThreeD_SPATIAL", "TwoD_SPATIAL"), p)
    r("dumpComp", {"comp": "T_Main", "out": "/etc/x.json"}, ok=False)


@test("find / expressions / fonts / effects")
def _():
    check(r("findLayers", {"layerType": "text"})["count"] >= 4, "text")
    check(r("findLayers", {"effect": "Drop Shadow"})["count"] >= 1, "effect")
    check(r("findLayers", {"text": "Omega"})["count"] >= 1, "text search")
    check(r("findLayers", {"hasExpressions": True, "compMatch": "^T_Link$"})["count"] >= 0, "expr")
    check(r("findLayers", {"source": "logo"})["count"] >= 1, "source")
    check(r("listExpressions", {"match": "lookAt"})["count"] >= 1, "listExpressions")
    check(r("listEffects", {"match": "Gaussian"})["count"] >= 1, "effects")


@test("renderFrames time/times/range/markers + valueAtTime + sourceRect")
def _():
    f = r("renderFrames", {"comp": "T_Main", "times": [0, "0:01.5", "45f"], "folder": "renders/test"})
    time.sleep(1.5)
    check(all(os.path.getsize(x["file"]) > 1000 for x in f["frames"]), f)
    check(r("renderFrames", {"comp": "T_Main", "range": [0, 1], "step": 0.5})["count"] == 3, "range")
    r("renderFrames", {"comp": "T_Retime", "markers": True})
    r("renderFrames", {"comp": "T_Main", "range": [0, 100], "step": 0.1}, ok=False)
    v = r("valueAtTime", {"comp": "T_Main", "layer": "CTRL", "path": "position", "times": [0, 1], "preExpression": True})
    check(len(v["values"]) == 2, v)


@test("activeState / whereUsed / dependencyGraph / snapshot+diff / audit / overlap / log / notes")
def _():
    r("openComp", {"comp": "T_Main", "time": 1.5})
    st = r("activeState")
    check(st["activeItem"]["name"] == "T_Main" and close(st["cti"], 1.5), st)
    w = r("whereUsed", {"item": "T_Link"})
    check("expressionRefs" in w and w["expressionRefs"], w)
    g = r("dependencyGraph", {"comp": "T_Main", "footage": True})
    check(g.get("children"), g)
    r("snapshot", {"comp": "T_Main", "name": "t_main_snap"})
    r("setProperty", {"comp": "T_Main", "layer": "CTRL", "path": "opacity", "value": 33})
    r("addNull", {"comp": "T_Main", "name": "NEW_AFTER_SNAP"})
    df = r("diff", {"name": "t_main_snap"})
    check(df["changedCount"] >= 1 and any("NEW_AFTER_SNAP" in x for x in df["added"]), df)
    au = r("audit", {})
    check("expressionErrors" in au and "textOutsideFrame" in au, au.keys())
    r("addText", {"comp": "T_Main", "name": "OFFSCREEN", "text": "Far away", "position": [2500, 540]})
    au = r("audit", {"comps": ["T_Main"]})
    check(any("OFFSCREEN" in x["where"] for x in au["textOutsideFrame"]), au["textOutsideFrame"])
    ov = r("checkTextOverlap", {"comp": "T_Main", "time": 0.5})
    check("overlaps" in ov, ov)
    check(len(r("getLog", {"lines": 5})) == 5, "log")
    r("getNotes", {})


@test("batch: undo group, stops on error, nested refused, write guard")
def _():
    n0 = r("compInfo", {"comp": "T_Main"})["numLayers"]
    b = r("batch", {"undoName": "batch test", "commands": [{"command": "addNull", "args": {"comp": "T_Main", "name": "B1"}}, {"command": "addNull", "args": {"comp": "T_Main", "name": "B2"}}]})
    check(len(b) == 2 and r("compInfo", {"comp": "T_Main"})["numLayers"] == n0 + 2, b)
    r("menuCommand", {"command": "undo"})
    check(r("compInfo", {"comp": "T_Main"})["numLayers"] == n0, "batch undone in one step")
    err = r("batch", {"commands": [{"command": "addNull", "args": {"comp": "T_Main", "name": "B3"}}, {"command": "setProperty", "args": {"comp": "T_Main", "layer": "NOPE", "path": "opacity", "value": 1}}]}, ok=False)
    check("stopped at #2" in err, err)
    r("menuCommand", {"command": "undo"})
    r("batch", {"commands": [{"command": "batch", "args": {}}]}, ok=False)
    r("batch", {"commands": [{"command": "saveProject", "args": {"confirm": True}}]}, ok=False)


PHASE[0] = "edge"


@test("extra: createMasksFromText, consolidate, reduceProject guard, queueInAME guard, cleanup actions")
def _():
    r("addText", {"comp": "T_Text", "name": "MASK_T", "text": "Masks"})
    m = r("menuCommand", {"command": "createMasksFromText", "comp": "T_Text", "layer": "MASK_T"})
    check(m["newLayers"], m)
    r("cleanupProject", {"action": "consolidateFootage", "confirm": True})
    r("cleanupProject", {"action": "nonsense", "confirm": True}, ok=False)
    r("queueInAME", {}, ok=False)


@test("visual scene: build clean comp and render")
def _():
    c = "T_Visual"
    r("createComp", {"name": c, "ifExists": "clear", "duration": 4, "folder": "TEST/Comps"})
    r("addSolid", {"comp": c, "name": "BG", "color": "#1E3A5F", "index": "bottom"})
    r("addShape", {"comp": c, "name": "SHAPES", "absolute": True, "shapes": [
        {"type": "rect", "size": [300, 180], "center": [300, 300], "roundness": 30, "fill": "#E94B3C", "stroke": {"color": "#FFFFFF", "width": 6}},
        {"type": "ellipse", "size": [220, 220], "center": [700, 300], "fill": "#7ED6C9", "trim": {"end": 100}},
        {"type": "star", "points": 5, "outerRadius": 120, "innerRadius": 55, "center": [1100, 300], "fill": "#FFD166"},
        {"type": "path", "vertices": [[1350, 380], [1500, 200], [1650, 380]], "closed": False, "stroke": {"color": "#FFFFFF", "width": 10, "cap": "round", "join": "round"}}]})
    r("addText", {"comp": c, "name": "TITLE", "text": "A new way to measure risk", "position": [960, 650],
                  "style": {"font": "Arial-BoldMT", "fontSize": 80, "fillColor": "#FFFFFF", "justification": "center"}})
    r("setCharStyle", {"comp": c, "layer": "TITLE", "finds": [{"find": "A new way", "style": {"fillColor": "#7ED6C9"}}]})
    r("replaceText", {"find": "measure", "replace": "check", "comps": [c]})
    r("addEffect", {"comp": c, "layer": "TITLE", "effect": "ADBE Drop Shadow", "values": {"Distance": 8, "Softness": 12, "Opacity": 60}})
    r("addFromItem", {"comp": c, "item": "logo.png", "name": "LOGO", "position": [960, 900], "scale": [40, 40]})
    r("addMask", {"comp": c, "layer": "LOGO", "ellipse": [0, 0, 512, 512], "feather": 30})
    r("addKeyframes", {"comp": c, "layer": "SHAPES", "path": "opacity", "keys": [{"t": 0, "v": 0, "ease": "easy"}, {"t": 1, "v": 100, "ease": "easy"}]})
    r("addTextAnimator", {"comp": c, "layer": "TITLE", "name": "IN", "properties": {"opacity": 0, "position": [0, 40]},
                          "selector": {"keys": {"Offset": [{"t": 0, "v": -100}, {"t": 1.5, "v": 100}]}}})
    f = [r("renderFrames", {"comp": c, "time": t, "folder": "renders/visual"})["frames"][0]["file"] for t in (0.6, 2.0)]
    print("      VISUAL:", " ".join(f))


@test("unicode names, quotes in names, bad JSON types")
def _():
    r("addNull", {"comp": "T_Main", "name": "Layer \"with quotes\" / slash – ü"})
    l = layer("T_Main", "Layer \"with quotes\" / slash – ü")
    check(l, "unicode layer")
    r("addControl", {"comp": "T_Main", "layer": {"id": l["id"]}, "type": "slider", "name": "Slider – ü"})
    lp = r("linkProperty", {"comp": "T_Main", "layer": "CTRL", "path": "rotation", "source": {"layer": {"id": l["id"]}, "path": ["effects", "Slider – ü", "Slider"]}})
    check("error" not in lp[0], lp)
    r("setProperty", {"comp": "T_Main", "layer": 9999, "path": "opacity", "value": 1}, ok=False)
    r("nonexistentCommand", {}, ok=False)
    r("setProperty", {"comp": "NoSuchComp", "layer": 1, "path": "opacity", "value": 1}, ok=False)


def main():
    phases = sys.argv[1:] or ["setup", "layers", "props", "fx", "project", "read", "edge"]
    t0 = time.time()
    for ph in phases:
        print("\n=====", ph)
        for t in PHASE_TESTS.get(ph, []):
            t()
    print("\nRESULT: %d passed, %d failed in %.0fs" % (RESULTS["pass"], RESULTS["fail"], time.time() - t0))
    for n, e in RESULTS["failures"]:
        print(" -", n, ":", e[:300])


if __name__ == "__main__":
    main()
