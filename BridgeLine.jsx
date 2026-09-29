/*  BridgeLine \u2014 file based command bridge for After Effects (ExtendScript / ES3)
    Built from src/*.jsx by build.sh -> BridgeLine.jsx. Do not edit the built file.

    Protocol:  ~/Documents/bridgeline/command.json  {id, command, args}
               ~/Documents/bridgeline/result.json   {id, ok, result | error, warnings, ms}
    Safety:    no eval / no running of arbitrary script files / no system.callSystem / no sockets.
               Write commands run only when "Allow changes" is ticked in the panel; each one is a
               single undo step named "BridgeLine: <command>". File writes only inside the bridge
               folder, the project folder and its parent folder.
*/
(function (thisObj) {

var RB = { VERSION: "1.0.2", cmds: {}, logLines: [], warnings: [], busy: false, ui: null };
RB.root = Folder.myDocuments.fsName + "/bridgeline";
RB.cmdPath = RB.root + "/command.json";
RB.resPath = RB.root + "/result.json";

// ---------------------------------------------------------------- ES3 helpers
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function isArr(v) { return v instanceof Array; }
function idxOf(a, v) { for (var i = 0; i < a.length; i++) if (a[i] === v) return i; return -1; }
function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = "0" + n; return n; }
function stamp() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
        pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function fileStamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" +
        pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function rnd(v) {
    if (typeof v === "number") return Math.round(v * 10000) / 10000;
    if (isArr(v)) { var r = []; for (var i = 0; i < v.length; i++) r.push(rnd(v[i])); return r; }
    return v;
}
function fail(msg) { throw new Error(msg); }
function warn(msg) { RB.warnings.push(String(msg)); }
function toRegex(s, flags) {
    if (s instanceof RegExp) return s;
    return new RegExp(String(s), flags === undefined ? "i" : flags);
}
function shorten(s, n) { s = String(s); n = n || 160; return s.length > n ? s.substr(0, n) + "..." : s; }
function safeName(s) { return String(s).replace(/[^A-Za-z0-9_\-.]+/g, "_"); }
function num(v, def) { return (v === undefined || v === null || v === "") ? def : Number(v); }
function errStr(e) {
    var s = (e && e.message) ? e.message : String(e);
    if (e && e.line) s += " (bridge line " + e.line + ")";
    return s;
}
function keysOf(o) { var r = []; for (var k in o) if (has(o, k)) r.push(k); return r; }

// ---------------------------------------------------------------- JSON (no eval)
function jsonEsc(s) {
    return '"' + String(s).replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
        switch (c) {
            case '"': return '\\"';
            case "\\": return "\\\\";
            case "\n": return "\\n";
            case "\r": return "\\r";
            case "\t": return "\\t";
            case "\b": return "\\b";
            case "\f": return "\\f";
        }
        return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
    }) + '"';
}
function jsonStr(v, ind, cur) {
    ind = ind || ""; cur = cur || "";
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return jsonEsc(v);
    if (t === "function") return "null";
    var nxt = cur + ind, parts = [], i;
    if (v instanceof Array) {
        for (i = 0; i < v.length; i++) parts.push(jsonStr(v[i], ind, nxt));
        if (!parts.length) return "[]";
        return ind ? "[\n" + nxt + parts.join(",\n" + nxt) + "\n" + cur + "]" : "[" + parts.join(",") + "]";
    }
    if (v instanceof Date) return jsonEsc(v.toString());
    for (var k in v) {
        if (!has(v, k)) continue;
        var x = v[k];
        if (x === undefined || typeof x === "function") continue;
        parts.push(jsonEsc(k) + (ind ? ": " : ":") + jsonStr(x, ind, nxt));
    }
    if (!parts.length) return "{}";
    return ind ? "{\n" + nxt + parts.join(",\n" + nxt) + "\n" + cur + "}" : "{" + parts.join(",") + "}";
}
function jsonParse(src) {
    var s = String(src), i = 0, n = s.length;
    var ESC = { '"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t" };
    function err(m) { throw new Error("JSON parse error: " + m + " at char " + i); }
    function ws() {
        while (i < n) {
            var c = s.charAt(i);
            if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\ufeff") i++; else break;
        }
    }
    function val() {
        ws();
        var c = s.charAt(i);
        if (c === "{") return obj();
        if (c === "[") return arr();
        if (c === '"') return str();
        if (s.substr(i, 4) === "true") { i += 4; return true; }
        if (s.substr(i, 5) === "false") { i += 5; return false; }
        if (s.substr(i, 4) === "null") { i += 4; return null; }
        return numv();
    }
    function numv() {
        var st = i;
        while (i < n && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        var t = s.substring(st, i);
        if (!/^-?\d+(\.\d+)?([eE][+\-]?\d+)?$/.test(t)) err("bad value '" + shorten(t, 20) + "'");
        return parseFloat(t);
    }
    function str() {
        i++;
        var out = "", st = i;
        while (i < n) {
            var c = s.charAt(i);
            if (c === '"') { out += s.substring(st, i); i++; return out; }
            if (c === "\\") {
                out += s.substring(st, i);
                var e = s.charAt(i + 1);
                if (e === "u") { out += String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)); i += 6; }
                else if (has(ESC, e)) { out += ESC[e]; i += 2; }
                else err("bad escape");
                st = i;
                continue;
            }
            i++;
        }
        err("unterminated string");
    }
    function arr() {
        i++; var r = []; ws();
        if (s.charAt(i) === "]") { i++; return r; }
        while (true) {
            r.push(val()); ws();
            var c = s.charAt(i);
            if (c === ",") { i++; continue; }
            if (c === "]") { i++; return r; }
            err("expected , or ]");
        }
    }
    function obj() {
        i++; var r = {}; ws();
        if (s.charAt(i) === "}") { i++; return r; }
        while (true) {
            ws();
            if (s.charAt(i) !== '"') err("expected key");
            var k = str(); ws();
            if (s.charAt(i) !== ":") err("expected :");
            i++;
            r[k] = val(); ws();
            var c = s.charAt(i);
            if (c === ",") { i++; continue; }
            if (c === "}") { i++; return r; }
            err("expected , or }");
        }
    }
    var v = val(); ws();
    if (i < n) err("trailing characters");
    return v;
}

// ---------------------------------------------------------------- files
function ensureFolder(p) { var f = new Folder(p); if (!f.exists) f.create(); return f; }
function writeText(path, text) {
    var f = new File(path);
    ensureFolder(f.parent.fsName);
    f.encoding = "UTF-8"; f.lineFeed = "Unix";
    if (!f.open("w")) fail("Cannot write file: " + path);
    f.write(text); f.close();
    return f;
}
function readText(path) {
    var f = new File(path);
    if (!f.exists) fail("File not found: " + path);
    f.encoding = "UTF-8";
    if (!f.open("r")) fail("Cannot read file: " + path);
    var t = f.read(); f.close();
    return t;
}
function writeAtomic(path, text) {
    var tmp = path + ".tmp";
    writeText(tmp, text);
    var target = new File(path);
    if (target.exists) target.remove();
    new File(tmp).rename(target.name);
}
function allowedRoots() {
    var r = [new Folder(RB.root).fsName];
    try {
        if (app.project.file) {
            var pf = app.project.file.parent;
            r.push(pf.fsName);
            var pp = pf.parent, home = Folder("~").fsName;
            if (pp && pp.fsName !== home && pp.fsName.split("/").length > 3) r.push(pp.fsName);
        }
    } catch (e) {}
    return r;
}
function safeOut(p) {
    var s = String(p);
    if (/(^|\/)\.\.(\/|$)/.test(s)) fail("'..' is not allowed in output paths: " + s);
    if (s.charAt(0) !== "/" && s.charAt(0) !== "~") s = RB.root + "/" + s;
    var full = new File(s).fsName, roots = allowedRoots();
    for (var i = 0; i < roots.length; i++) {
        if (full === roots[i] || full.indexOf(roots[i] + "/") === 0) {
            ensureFolder(new File(full).parent.fsName);
            return full;
        }
    }
    fail("Writing outside allowed folders is blocked: " + full + " (allowed: " + roots.join(", ") + ")");
}
function outResult(a, r, defName) {
    if (!a.out && !defName) return r;
    var p = safeOut(a.out || defName);
    var txt = jsonStr(r, "  ");
    writeText(p, txt);
    return { written: p, chars: txt.length };
}

// ---------------------------------------------------------------- enums
var ENUM_NAMES = {
    BlendingMode: ["NORMAL", "DISSOLVE", "DANCING_DISSOLVE", "DARKEN", "MULTIPLY", "COLOR_BURN", "CLASSIC_COLOR_BURN",
        "LINEAR_BURN", "DARKER_COLOR", "ADD", "LIGHTEN", "SCREEN", "COLOR_DODGE", "CLASSIC_COLOR_DODGE", "LINEAR_DODGE",
        "LIGHTER_COLOR", "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT", "LINEAR_LIGHT", "VIVID_LIGHT", "PIN_LIGHT", "HARD_MIX",
        "DIFFERENCE", "CLASSIC_DIFFERENCE", "EXCLUSION", "SUBTRACT", "DIVIDE", "HUE", "SATURATION", "COLOR", "LUMINOSITY",
        "STENCIL_ALPHA", "STENCIL_LUMA", "SILHOUETE_ALPHA", "SILHOUETTE_LUMA", "ALPHA_ADD", "LUMINESCENT_PREMUL"],
    TrackMatteType: ["NO_TRACK_MATTE", "ALPHA", "ALPHA_INVERTED", "LUMA", "LUMA_INVERTED"],
    LayerQuality: ["BEST", "DRAFT", "WIREFRAME"],
    LayerSamplingQuality: ["BICUBIC", "BILINEAR"],
    KeyframeInterpolationType: ["LINEAR", "BEZIER", "HOLD"],
    MaskMode: ["NONE", "ADD", "SUBTRACT", "INTERSECT", "LIGHTEN", "DARKEN", "DIFFERENCE"],
    MaskMotionBlur: ["SAME_AS_LAYER", "ON", "OFF"],
    MaskFeatherFalloff: ["FFO_LINEAR", "FFO_SMOOTH"],
    AutoOrientType: ["NO_AUTO_ORIENT", "ALONG_PATH", "CAMERA_OR_POINT_OF_INTEREST", "CHARACTERS_TOWARD_CAMERA"],
    LightType: ["PARALLEL", "SPOT", "POINT", "AMBIENT", "ENVIRONMENT"],
    ParagraphJustification: ["LEFT_JUSTIFY", "RIGHT_JUSTIFY", "CENTER_JUSTIFY", "FULL_JUSTIFY_LASTLINE_LEFT",
        "FULL_JUSTIFY_LASTLINE_RIGHT", "FULL_JUSTIFY_LASTLINE_CENTER", "FULL_JUSTIFY_LASTLINE_FULL", "MULTIPLE_JUSTIFICATIONS"],
    PropertyValueType: ["NO_VALUE", "ThreeD_SPATIAL", "ThreeD", "TwoD_SPATIAL", "TwoD", "OneD", "COLOR", "CUSTOM_VALUE",
        "MARKER", "LAYER_INDEX", "MASK_INDEX", "SHAPE", "TEXT_DOCUMENT"],
    PropertyType: ["PROPERTY", "INDEXED_GROUP", "NAMED_GROUP"],
    FrameBlendingType: ["FRAME_MIX", "NO_FRAME_BLEND", "PIXEL_MOTION"],
    AlphaMode: ["IGNORE", "STRAIGHT", "PREMULTIPLIED"],
    FieldSeparationType: ["OFF", "UPPER_FIELD_FIRST", "LOWER_FIELD_FIRST"],
    ImportAsType: ["COMP_CROPPED_LAYERS", "FOOTAGE", "COMP", "PROJECT"],
    RQItemStatus: ["WILL_CONTINUE", "NEEDS_OUTPUT", "UNQUEUED", "QUEUED", "RENDERING", "USER_STOPPED", "ERR_STOPPED", "DONE"],
    PurgeTarget: ["ALL_CACHES", "UNDO_CACHES", "SNAPSHOT_CACHES", "IMAGE_CACHES"]
};
function enumObj(n) {
    try {
        switch (n) {
            case "BlendingMode": return BlendingMode;
            case "TrackMatteType": return TrackMatteType;
            case "LayerQuality": return LayerQuality;
            case "LayerSamplingQuality": return LayerSamplingQuality;
            case "KeyframeInterpolationType": return KeyframeInterpolationType;
            case "MaskMode": return MaskMode;
            case "MaskMotionBlur": return MaskMotionBlur;
            case "MaskFeatherFalloff": return MaskFeatherFalloff;
            case "AutoOrientType": return AutoOrientType;
            case "LightType": return LightType;
            case "ParagraphJustification": return ParagraphJustification;
            case "PropertyValueType": return PropertyValueType;
            case "PropertyType": return PropertyType;
            case "FrameBlendingType": return FrameBlendingType;
            case "AlphaMode": return AlphaMode;
            case "FieldSeparationType": return FieldSeparationType;
            case "ImportAsType": return ImportAsType;
            case "RQItemStatus": return RQItemStatus;
            case "PurgeTarget": return PurgeTarget;
        }
    } catch (e) {}
    return undefined;
}
function enumName(n, v) {
    var o = enumObj(n), names = ENUM_NAMES[n] || [];
    if (!o) return v;
    for (var i = 0; i < names.length; i++) {
        try { if (o[names[i]] === v) return names[i]; } catch (e) {}
    }
    return v;
}
function enumVal(n, s) {
    if (typeof s === "number") return s;
    var o = enumObj(n);
    if (!o) fail("Enum " + n + " is not available in this AE version");
    var key = String(s).toUpperCase().replace(/[\s\-]+/g, "_");
    var tries = [key, key + "_JUSTIFY", "FFO_" + key];
    if (n === "TrackMatteType" && (key === "NONE" || key === "OFF")) tries.unshift("NO_TRACK_MATTE");
    if (n === "AutoOrientType" && (key === "NONE" || key === "OFF")) tries.unshift("NO_AUTO_ORIENT");
    if (n === "FrameBlendingType" && (key === "NONE" || key === "OFF")) tries.unshift("NO_FRAME_BLEND");
    for (var i = 0; i < tries.length; i++) {
        try { if (o[tries[i]] !== undefined) return o[tries[i]]; } catch (e) {}
    }
    fail("Unknown " + n + " value '" + s + "'. Allowed: " + (ENUM_NAMES[n] || []).join(", "));
}

// ---------------------------------------------------------------- items / comps
function itemType(it) {
    if (it instanceof CompItem) return "comp";
    if (it instanceof FolderItem) return "folder";
    if (it instanceof FootageItem) {
        var s = it.mainSource;
        if (s instanceof SolidSource) return "solid";
        if (s instanceof PlaceholderSource) return "placeholder";
        if (it.hasVideo) return "footage";
        if (it.hasAudio) return "audio";
        return "footage";
    }
    return "item";
}
function iref(it) { return { id: it.id, name: it.name, type: itemType(it) }; }
function folderPath(it) {
    var a = [], f = it.parentFolder;
    while (f && f !== app.project.rootFolder) { a.unshift(f.name); f = f.parentFolder; }
    return a.join("/");
}
function getItem(ref, type) {
    if (ref === undefined || ref === null || ref === "active") {
        var ai = app.project.activeItem;
        if (!ai) fail("No active item (open a composition or pass comp/item)");
        return ai;
    }
    if (typeof ref === "number") {
        for (var q = 1; q <= app.project.numItems; q++) if (app.project.item(q).id === ref) return app.project.item(q);
        fail("No project item with id " + ref);
    }
    if (typeof ref === "object") {
        if (ref.id !== undefined) return getItem(Number(ref.id), type);
        if (ref.name !== undefined) return getItem(String(ref.name), type);
    }
    var name = String(ref), found = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it.name !== name) continue;
        if (type === "comp" && !(it instanceof CompItem)) continue;
        if (type === "footage" && !(it instanceof FootageItem)) continue;
        if (type === "folder" && !(it instanceof FolderItem)) continue;
        found.push(it);
    }
    if (!found.length) fail((type || "item") + " not found: '" + name + "'");
    if (found.length > 1) {
        var ids = []; for (var j = 0; j < found.length; j++) ids.push(found[j].id);
        fail("Ambiguous name '" + name + "' (" + found.length + " items). Use id: " + ids.join(", "));
    }
    return found[0];
}
function getComp(ref) {
    var it = getItem(ref, "comp");
    if (!(it instanceof CompItem)) fail("Not a composition: " + it.name);
    return it;
}
function getComps(a, defaultAll) {
    var r = [], i;
    if (a.comps) { for (i = 0; i < a.comps.length; i++) r.push(getComp(a.comps[i])); return r; }
    if (a.comp !== undefined) return [getComp(a.comp)];
    var re = a.compMatch !== undefined ? toRegex(a.compMatch) : null;
    if (re || defaultAll) {
        for (i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && (!re || re.test(it.name))) r.push(it);
        }
        return r;
    }
    return [getComp("active")];
}
function getFolder(ref, create) {
    if (ref === undefined || ref === null || ref === "" || ref === "/" || ref === "root") return app.project.rootFolder;
    if (typeof ref === "string" && ref.indexOf("/") >= 0) {
        var parts = ref.split("/"), cur = app.project.rootFolder;
        for (var i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            var nxt = null;
            for (var j = 1; j <= cur.numItems; j++) {
                if (cur.item(j) instanceof FolderItem && cur.item(j).name === parts[i]) { nxt = cur.item(j); break; }
            }
            if (!nxt) {
                if (!create) fail("Folder not found: " + ref);
                nxt = app.project.items.addFolder(parts[i]); nxt.parentFolder = cur;
            }
            cur = nxt;
        }
        return cur;
    }
    try { return getItem(ref, "folder"); } catch (e) {
        if (!create || typeof ref !== "string") throw e;
        return app.project.items.addFolder(ref);
    }
}

// ---------------------------------------------------------------- layers
function layerType(l) {
    if (l instanceof TextLayer) return "text";
    if (l instanceof ShapeLayer) return "shape";
    if (l instanceof CameraLayer) return "camera";
    if (l instanceof LightLayer) return "light";
    if (l instanceof AVLayer) {
        if (l.nullLayer) return "null";
        if (l.adjustmentLayer) return "adjustment";
        var s = l.source;
        if (s instanceof CompItem) return "precomp";
        if (s && s.mainSource instanceof SolidSource) return "solid";
        if (s && !s.hasVideo && s.hasAudio) return "audio";
        return "footage";
    }
    return "layer";
}
function lref(l) {
    var r = { index: l.index, name: l.name };
    try { r.id = l.id; } catch (e) {}
    return r;
}
function getLayer(comp, ref) {
    if (ref === undefined || ref === null) fail("layer is required");
    var i;
    if (typeof ref === "number") {
        if (ref < 1 || ref > comp.numLayers) fail("Layer index " + ref + " out of range 1.." + comp.numLayers + " in '" + comp.name + "'");
        return comp.layer(ref);
    }
    if (typeof ref === "object") {
        if (ref.id !== undefined) {
            for (i = 1; i <= comp.numLayers; i++) { try { if (comp.layer(i).id === Number(ref.id)) return comp.layer(i); } catch (e) {} }
            fail("No layer with id " + ref.id + " in '" + comp.name + "'");
        }
        if (ref.index !== undefined) return getLayer(comp, Number(ref.index));
        if (ref.name !== undefined) return getLayer(comp, String(ref.name));
    }
    var s = String(ref), hits = [];
    for (i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === s) hits.push(comp.layer(i));
    if (!hits.length) fail("Layer not found in '" + comp.name + "': '" + s + "'");
    if (hits.length > 1) {
        var ix = []; for (i = 0; i < hits.length; i++) ix.push(hits[i].index);
        fail("Ambiguous layer name '" + s + "' in '" + comp.name + "' (indexes " + ix.join(", ") + "). Use index or {id}.");
    }
    return hits[0];
}
function getLayers(comp, a, allowEmpty) {
    var out = [], i;
    if (a.layers) { for (i = 0; i < a.layers.length; i++) out.push(getLayer(comp, a.layers[i])); }
    else if (a.layer !== undefined) out.push(getLayer(comp, a.layer));
    else if (a.selected) { var sl = comp.selectedLayers; for (i = 0; i < sl.length; i++) out.push(sl[i]); }
    else if (a.match !== undefined || a.all || a.layerType) {
        var re = a.match !== undefined ? toRegex(a.match) : null;
        for (i = 1; i <= comp.numLayers; i++) if (!re || re.test(comp.layer(i).name)) out.push(comp.layer(i));
    }
    if (a.layerType) {
        var f = [];
        for (i = 0; i < out.length; i++) if (layerType(out[i]) === a.layerType) f.push(out[i]);
        out = f;
    }
    if (!out.length && !allowEmpty) fail("No layers matched in '" + comp.name + "' (use layer, layers, selected, match, all or layerType)");
    return out;
}
function withUnlocked(l, fn) {
    var was = l.locked;
    if (was) l.locked = false;
    try { return fn(l); } finally { if (was) l.locked = true; }
}

// ---------------------------------------------------------------- properties
var PROP_ALIAS = {
    transform: ["ADBE Transform Group"],
    anchor: ["ADBE Transform Group", "ADBE Anchor Point"],
    anchorpoint: ["ADBE Transform Group", "ADBE Anchor Point"],
    pointofinterest: ["ADBE Transform Group", "ADBE Anchor Point"],
    position: ["ADBE Transform Group", "ADBE Position"],
    xposition: ["ADBE Transform Group", "ADBE Position_0"],
    yposition: ["ADBE Transform Group", "ADBE Position_1"],
    zposition: ["ADBE Transform Group", "ADBE Position_2"],
    scale: ["ADBE Transform Group", "ADBE Scale"],
    rotation: ["ADBE Transform Group", "ADBE Rotate Z"],
    zrotation: ["ADBE Transform Group", "ADBE Rotate Z"],
    xrotation: ["ADBE Transform Group", "ADBE Rotate X"],
    yrotation: ["ADBE Transform Group", "ADBE Rotate Y"],
    orientation: ["ADBE Transform Group", "ADBE Orientation"],
    opacity: ["ADBE Transform Group", "ADBE Opacity"],
    effects: ["ADBE Effect Parade"],
    masks: ["ADBE Mask Parade"],
    text: ["ADBE Text Properties"],
    sourcetext: ["ADBE Text Properties", "ADBE Text Document"],
    animators: ["ADBE Text Properties", "ADBE Text Animators"],
    pathoptions: ["ADBE Text Properties", "ADBE Text Path Options"],
    moreoptions: ["ADBE Text Properties", "ADBE Text More Options"],
    contents: ["ADBE Root Vectors Group"],
    timeremap: ["ADBE Time Remapping"],
    marker: ["ADBE Marker"],
    audiolevels: ["ADBE Audio Group", "ADBE Audio Levels"],
    material: ["ADBE Material Options Group"],
    cameraoptions: ["ADBE Camera Options Group"],
    lightoptions: ["ADBE Light Options Group"],
    layerstyles: ["ADBE Layer Styles"]
};
function splitPath(path) {
    if (isArr(path)) return path.slice(0);
    return String(path).split("/");
}
function childNames(g) {
    var r = [];
    try { for (var i = 1; i <= g.numProperties && i <= 60; i++) r.push(g.property(i).name); } catch (e) {}
    return r.join(" | ");
}
// A leaf that AE currently hides (e.g. percent "Start" of a Range Selector with Units = Index)
// throws on setValue. Probe with a no-op setValue - only used when names are ambiguous.
function isHiddenLeaf(p) {
    try {
        if (p.propertyType !== PropertyType.PROPERTY || p.propertyValueType === PropertyValueType.NO_VALUE) return false;
        if (p.numKeys > 0 || p.expression !== "") return false;
        p.setValue(p.value);
        return false;
    } catch (e) {
        return /hidden/i.test(String(e.message || e));
    }
}
function childByKey(group, key) {
    if (typeof key === "number") return group.property(key);
    var k = String(key);
    if (/^#\d+$/.test(k)) {
        var ix = parseInt(k.substr(1), 10);
        return (ix >= 1 && ix <= group.numProperties) ? group.property(ix) : null;
    }
    var lk = k.toLowerCase(), byMatch = null, byName = [], i, c;
    for (i = 1; i <= group.numProperties; i++) {
        c = group.property(i);
        if (c.matchName === k) { byMatch = c; break; }
        if (c.name.toLowerCase() === lk || c.matchName.toLowerCase() === lk) byName.push(c);
    }
    if (byMatch) return byMatch;
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
        // same display name used twice (e.g. "Start" percent vs index): prefer the one AE does not hide
        if (RB.allowWrites()) {
            for (i = 0; i < byName.length; i++) if (!isHiddenLeaf(byName[i])) {
                if (i > 0) warn("'" + k + "' is ambiguous under " + group.name + "; used visible " + byName[i].matchName);
                return byName[i];
            }
        }
        var ms = []; for (i = 0; i < byName.length; i++) ms.push(byName[i].matchName);
        warn("'" + k + "' is ambiguous under " + group.name + " (" + ms.join(", ") + "); used the first. Use a matchName to be exact.");
        return byName[0];
    }
    var p = null;
    try { p = group.property(k); } catch (e) { p = null; }
    return p;
}
function resolveProp(layer, path) {
    var segs = splitPath(path);
    if (!segs.length || segs[0] === "") fail("Empty property path");
    if (typeof segs[0] === "string") {
        var al = PROP_ALIAS[segs[0].toLowerCase().replace(/[\s_]/g, "")];
        if (al) segs = al.concat(segs.slice(1));
    }
    var cur = layer;
    for (var i = 0; i < segs.length; i++) {
        if (cur.numProperties === undefined) fail("'" + segs.slice(0, i).join("/") + "' is not a property group");
        var nx = childByKey(cur, segs[i]);
        if (!nx) fail("Property not found: '" + segs[i] + "' under '" + (i ? segs.slice(0, i).join("/") : layer.name) +
            "'. Children: " + childNames(cur));
        cur = nx;
    }
    return cur;
}
function propLayer(p) { return p.propertyDepth > 0 ? p.propertyGroup(p.propertyDepth) : p; }
function propPath(p) {
    var a = [], cur = p;
    while (cur && cur.propertyDepth > 0) { a.unshift(cur.name); cur = cur.parentProperty; }
    return a.join("/");
}
function propMPath(p) {
    var a = [], cur = p;
    while (cur && cur.propertyDepth > 0) {
        var par = cur.parentProperty;
        if (par && par.propertyDepth > 0 && par.propertyType === PropertyType.INDEXED_GROUP) a.unshift("#" + cur.propertyIndex);
        else a.unshift(cur.matchName);
        cur = par;
    }
    return a.join("/");
}
function pref(p) { return { path: propPath(p), mpath: propMPath(p) }; }
function isLeaf(p) { return p.propertyType === PropertyType.PROPERTY; }
function hasValue(p) {
    return isLeaf(p) && p.propertyValueType !== PropertyValueType.NO_VALUE;
}
function walkProps(g, fn) {
    var n = 0;
    try { n = g.numProperties; } catch (e) { return; }
    for (var i = 1; i <= n; i++) {
        var p = null;
        try { p = g.property(i); } catch (e) { continue; }
        if (!p) continue;
        if (p.propertyType === PropertyType.PROPERTY) fn(p); else walkProps(p, fn);
    }
}

// ---------------------------------------------------------------- values
function colorIn(v) {
    if (typeof v === "string") {
        var h = v.replace(/^#/, "");
        if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) fail("Bad hex color: " + v);
        var n = parseInt(h.substr(0, 6), 16);
        var c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
        if (h.length === 8) c[3] = parseInt(h.substr(6, 2), 16) / 255;
        return c;
    }
    if (isArr(v)) {
        var big = false, r = [], i;
        for (i = 0; i < 3 && i < v.length; i++) if (v[i] > 1) big = true;
        for (i = 0; i < 3; i++) r.push(big ? v[i] / 255 : v[i]);
        r.push(v.length > 3 ? (v[3] > 1 ? v[3] / 255 : v[3]) : 1);
        return r;
    }
    fail("Bad color: " + v + " (use '#RRGGBB' or [r,g,b] 0..1 or 0..255)");
}
function hexOf(c) {
    function h(x) { return pad(Math.max(0, Math.min(255, Math.round(x * 255))).toString(16)); }
    return "#" + h(c[0]) + h(c[1]) + h(c[2]);
}
function shapeOut(s) {
    return { vertices: rnd(s.vertices), inTangents: rnd(s.inTangents), outTangents: rnd(s.outTangents), closed: s.closed };
}
function shapeIn(o) {
    if (!o || !o.vertices) fail("Shape needs vertices");
    var z = [], i;
    for (i = 0; i < o.vertices.length; i++) z.push([0, 0]);
    var s = new Shape();
    s.vertices = o.vertices;
    s.inTangents = o.inTangents || z;
    s.outTangents = o.outTangents || z;
    s.closed = o.closed !== false;
    return s;
}
function markerOut(m) {
    var o = { comment: m.comment };
    if (m.duration) o.duration = rnd(m.duration);
    if (m.chapter) o.chapter = m.chapter;
    if (m.url) o.url = m.url;
    try { if (m.label) o.label = m.label; } catch (e) {}
    try { if (m.protectedRegion) o.protectedRegion = true; } catch (e) {}
    return o;
}
function markerIn(o) {
    if (typeof o === "string") o = { comment: o };
    var m = new MarkerValue(o.comment || "");
    if (o.duration !== undefined) m.duration = o.duration;
    if (o.chapter) m.chapter = o.chapter;
    if (o.url) m.url = o.url;
    try { if (o.label !== undefined) m.label = o.label; } catch (e) {}
    try { if (o.protectedRegion !== undefined) m.protectedRegion = !!o.protectedRegion; } catch (e) {}
    return m;
}
var TD_READ = ["font", "fontFamily", "fontStyle", "fontSize", "applyFill", "fillColor", "applyStroke", "strokeColor",
    "strokeWidth", "strokeOverFill", "tracking", "leading", "autoLeading", "baselineShift", "horizontalScale",
    "verticalScale", "tsume", "allCaps", "smallCaps", "fauxBold", "fauxItalic", "superscript", "subscript",
    "boxText", "pointText", "boxTextSize", "boxTextPos"];
var TD_WRITE = ["text", "font", "fontSize", "applyFill", "fillColor", "applyStroke", "strokeColor", "strokeWidth",
    "strokeOverFill", "tracking", "autoLeading", "leading", "baselineShift", "horizontalScale", "verticalScale", "tsume",
    "allCaps", "smallCaps", "fauxBold", "fauxItalic", "superscript", "subscript", "boxTextSize", "boxTextPos"];
function textDocOut(d) {
    var o = { text: d.text };
    for (var i = 0; i < TD_READ.length; i++) {
        try {
            var v = d[TD_READ[i]];
            if (v !== undefined && typeof v !== "function") o[TD_READ[i]] = rnd(v);
        } catch (e) {}
    }
    try { o.justification = enumName("ParagraphJustification", d.justification); } catch (e) {}
    return o;
}
function styleApply(target, o, isRange) {
    if (o.leading !== undefined && o.autoLeading === undefined && !isRange) o.autoLeading = false;
    for (var i = 0; i < TD_WRITE.length; i++) {
        var k = TD_WRITE[i];
        if (o[k] === undefined) continue;
        if (isRange && (k === "text" || k === "boxTextSize" || k === "boxTextPos")) continue;
        var v = o[k];
        if (k === "fillColor" || k === "strokeColor") {
            v = colorIn(v).slice(0, 3);
            if (k === "fillColor" && o.applyFill === undefined) target.applyFill = true;
            if (k === "strokeColor" && o.applyStroke === undefined) target.applyStroke = true;
        }
        if (k === "text" && isArr(v)) v = v.join("\r");
        if (k === "allCaps" || k === "smallCaps") {
            try { target.fontCapsOption = v ? (k === "allCaps" ? FontCapsOption.FONT_ALL_CAPS : FontCapsOption.FONT_SMALL_CAPS) : FontCapsOption.FONT_NORMAL_CAPS; continue; } catch (e0) {}
        }
        if (k === "superscript" || k === "subscript") {
            try { target.fontBaselineOption = v ? (k === "superscript" ? FontBaselineOption.FONT_FAUXED_SUPERSCRIPT : FontBaselineOption.FONT_FAUXED_SUBSCRIPT) : FontBaselineOption.FONT_NORMAL_BASELINE; continue; } catch (e1) {}
        }
        try { target[k] = v; } catch (e) { warn("Text style '" + k + "' not applied: " + errStr(e)); }
    }
    if (o.justification !== undefined) {
        try { target.justification = enumVal("ParagraphJustification", o.justification); }
        catch (e) { warn("justification not applied: " + errStr(e)); }
    }
    if (o.resetCharStyle) try { target.resetCharStyle(); } catch (e) {}
    if (o.resetParagraphStyle) try { target.resetParagraphStyle(); } catch (e) {}
}
function valOut(p, v) {
    var t = p.propertyValueType;
    if (t === PropertyValueType.SHAPE) return shapeOut(v);
    if (t === PropertyValueType.TEXT_DOCUMENT) return textDocOut(v);
    if (t === PropertyValueType.MARKER) return markerOut(v);
    if (t === PropertyValueType.CUSTOM_VALUE) return "(custom value)";
    return rnd(v);
}
function valIn(p, v, atTime) {
    var T = p.propertyValueType;
    if (T === PropertyValueType.SHAPE) return shapeIn(v);
    if (T === PropertyValueType.MARKER) return markerIn(v);
    if (T === PropertyValueType.TEXT_DOCUMENT) {
        var d = (atTime !== undefined && p.numKeys > 0) ? p.valueAtTime(atTime, true) : p.value;
        if (typeof v === "string" || isArr(v)) styleApply(d, { text: v });
        else styleApply(d, v);
        return d;
    }
    if (T === PropertyValueType.CUSTOM_VALUE) fail("Custom-value properties (curves, gradient colors...) cannot be set by script: " + propPath(p));
    if (T === PropertyValueType.COLOR) return colorIn(v);
    if (T === PropertyValueType.LAYER_INDEX && typeof v === "string") return getLayer(propLayer(p).containingComp, v).index;
    if (T === PropertyValueType.OneD || T === PropertyValueType.LAYER_INDEX || T === PropertyValueType.MASK_INDEX) {
        if (isArr(v)) v = v[0];
        if (typeof v === "boolean") v = v ? 1 : 0;
        return Number(v);
    }
    return v;
}
function setPropValue(p, v, time) {
    if (!hasValue(p)) fail("Not a value property: " + propPath(p));
    var val = valIn(p, v, time);
    if (time !== undefined && time !== null) { p.setValueAtTime(time, val); return; }
    if (p.numKeys > 0) fail("Property has keyframes, pass 'time' to set a key (or removeKeyframes first): " + propPath(p));
    p.setValue(val);
}
function exprEval(p) {
    var err = "";
    try {
        var c = propLayer(p).containingComp;
        p.valueAtTime(c.time, false);
        err = p.expressionError;
    } catch (e) { err = errStr(e); }
    return err;
}
function setExpr(p, expr, enabled) {
    if (!p.canSetExpression) fail("Expressions are not allowed on " + propPath(p));
    p.expression = String(expr);
    if (String(expr) !== "") p.expressionEnabled = enabled !== false;
    return exprEval(p);
}

// ---------------------------------------------------------------- keyframes
var KIT_NAMES = { LINEAR: 1, BEZIER: 1, HOLD: 1 };
function keysOut(p, withEase) {
    var r = [];
    for (var k = 1; k <= p.numKeys; k++) {
        var o = { t: rnd(p.keyTime(k)), v: valOut(p, p.keyValue(k)) };
        try {
            var ii = p.keyInInterpolationType(k), oi = p.keyOutInterpolationType(k);
            if (ii !== KeyframeInterpolationType.LINEAR || oi !== KeyframeInterpolationType.LINEAR)
                o.interp = [enumName("KeyframeInterpolationType", ii), enumName("KeyframeInterpolationType", oi)];
            if (withEase && (ii === KeyframeInterpolationType.BEZIER || oi === KeyframeInterpolationType.BEZIER)) {
                var ei = p.keyInTemporalEase(k), eo = p.keyOutTemporalEase(k), a = [], b = [], j;
                for (j = 0; j < ei.length; j++) a.push([rnd(ei[j].speed), rnd(ei[j].influence)]);
                for (j = 0; j < eo.length; j++) b.push([rnd(eo[j].speed), rnd(eo[j].influence)]);
                o.ease = [a, b];
            }
        } catch (e) {}
        r.push(o);
    }
    return r;
}
function keyCapture(p, k) {
    var c = { t: p.keyTime(k), v: p.keyValue(k) };
    try { c.ii = p.keyInInterpolationType(k); c.oi = p.keyOutInterpolationType(k); } catch (e) {}
    try { c.ei = p.keyInTemporalEase(k); c.eo = p.keyOutTemporalEase(k); } catch (e) {}
    try { c.tc = p.keyTemporalContinuous(k); c.tab = p.keyTemporalAutoBezier(k); } catch (e) {}
    if (p.isSpatial) {
        try {
            c.sti = p.keyInSpatialTangent(k); c.sto = p.keyOutSpatialTangent(k);
            c.sc = p.keySpatialContinuous(k); c.sab = p.keySpatialAutoBezier(k); c.rov = p.keyRoving(k);
        } catch (e) {}
    }
    try { c.lab = p.keyLabel(k); } catch (e) {}
    return c;
}
function keyRestore(p, c, t) {
    p.setValueAtTime(t, c.v);
    var k = p.nearestKeyIndex(t);
    try { if (c.ii !== undefined) p.setInterpolationTypeAtKey(k, c.ii, c.oi); } catch (e) {}
    try { if (c.ei) p.setTemporalEaseAtKey(k, c.ei, c.eo); } catch (e) {}
    try { if (c.tc !== undefined) { p.setTemporalContinuousAtKey(k, c.tc); p.setTemporalAutoBezierAtKey(k, c.tab); } } catch (e) {}
    if (c.sti) {
        try {
            p.setSpatialContinuousAtKey(k, c.sc);
            p.setSpatialAutoBezierAtKey(k, c.sab);
            if (!c.sab) p.setSpatialTangentsAtKey(k, c.sti, c.sto);
        } catch (e) {}
    }
    try { if (c.rov) p.setRovingAtKey(k, true); } catch (e) {}
    try { if (c.lab) p.setLabelAtKey(k, c.lab); } catch (e) {}
    return k;
}
// fn(time, keyIndex) -> new time, or null to keep. Returns number of moved keys.
function remapKeys(p, fn) {
    var n = p.numKeys, caps = [], moved = 0, k, i;
    if (!n) return 0;
    for (k = 1; k <= n; k++) {
        var c = keyCapture(p, k), nt = fn(c.t, k);
        c.nt = (nt === null || nt === undefined) ? c.t : nt;
        if (Math.abs(c.nt - c.t) > 1e-6) moved++;
        caps.push(c);
    }
    if (!moved) return 0;
    for (k = n; k >= 1; k--) p.removeKey(k);
    for (i = 0; i < caps.length; i++) keyRestore(p, caps[i], caps[i].nt);
    if (p.numKeys < caps.length) warn("Some keys collided on the same time in " + propPath(p));
    return moved;
}
function easeArray(p, k, spec, side) {
    var cur = side === "in" ? p.keyInTemporalEase(k) : p.keyOutTemporalEase(k), r = [];
    for (var j = 0; j < cur.length; j++) {
        var s = spec, speed = 0, infl = 33.333;
        if (isArr(s) && isArr(s[0])) s = s[Math.min(j, s.length - 1)];
        if (isArr(s)) { speed = s[0]; infl = s[1]; }
        else if (typeof s === "number") infl = s;
        r.push(new KeyframeEase(speed, Math.max(0.1, Math.min(100, infl))));
    }
    return r;
}
// spec: {interp:"linear|bezier|hold"|[in,out], ease:"easy|easyIn|easyOut"|influence|[speed,influence], easeIn, easeOut}
function applyKeySpec(p, k, spec) {
    var KIT = KeyframeInterpolationType;
    if (spec.interp !== undefined) {
        var ii = isArr(spec.interp) ? spec.interp[0] : spec.interp, oi = isArr(spec.interp) ? spec.interp[1] : spec.interp;
        p.setInterpolationTypeAtKey(k, enumVal("KeyframeInterpolationType", ii), enumVal("KeyframeInterpolationType", oi));
    }
    var ein = spec.easeIn, eout = spec.easeOut;
    if (spec.ease !== undefined) {
        if (spec.ease === "easy") { ein = 33.333; eout = 33.333; }
        else if (spec.ease === "easyIn") ein = 33.333;
        else if (spec.ease === "easyOut") eout = 33.333;
        else { ein = spec.ease; eout = spec.ease; }
    }
    if (ein !== undefined || eout !== undefined) {
        if (spec.interp === undefined) {
            p.setInterpolationTypeAtKey(k,
                ein !== undefined ? KIT.BEZIER : p.keyInInterpolationType(k),
                eout !== undefined ? KIT.BEZIER : p.keyOutInterpolationType(k));
        }
        var a = ein !== undefined ? easeArray(p, k, ein, "in") : p.keyInTemporalEase(k);
        var b = eout !== undefined ? easeArray(p, k, eout, "out") : p.keyOutTemporalEase(k);
        p.setTemporalEaseAtKey(k, a, b);
    }
    if (spec.spatial !== undefined && p.isSpatial) {
        if (spec.spatial === "linear") { p.setSpatialAutoBezierAtKey(k, false); p.setSpatialContinuousAtKey(k, false); p.setSpatialTangentsAtKey(k, [0, 0, 0].slice(0, p.keyValue(k).length), [0, 0, 0].slice(0, p.keyValue(k).length)); }
        else if (spec.spatial === "auto") p.setSpatialAutoBezierAtKey(k, true);
        else if (spec.spatial === "continuous") p.setSpatialContinuousAtKey(k, true);
    }
    if (spec.roving !== undefined) try { p.setRovingAtKey(k, !!spec.roving); } catch (e) {}
    if (spec.label !== undefined) try { p.setLabelAtKey(k, spec.label); } catch (e) {}
}

// ---------------------------------------------------------------- 2D transform math (approximate: ignores 3D, orientation, auto-orient)
function posAt(tr, t) {
    var p = tr.property("ADBE Position");
    if (p.dimensionsSeparated) return [tr.property("ADBE Position_0").valueAtTime(t, false), tr.property("ADBE Position_1").valueAtTime(t, false)];
    return p.valueAtTime(t, false);
}
function matMul(P, C) {
    return [P[0] * C[0] + P[2] * C[1], P[1] * C[0] + P[3] * C[1], P[0] * C[2] + P[2] * C[3], P[1] * C[2] + P[3] * C[3],
        P[0] * C[4] + P[2] * C[5] + P[4], P[1] * C[4] + P[3] * C[5] + P[5]];
}
function layerMatrix(l, t) {
    var tr = l.property("ADBE Transform Group");
    var ap = tr.property("ADBE Anchor Point").valueAtTime(t, false);
    var pos = posAt(tr, t);
    var sc = [100, 100], rot = 0;
    try { sc = tr.property("ADBE Scale").valueAtTime(t, false); } catch (e) {}
    try { rot = tr.property("ADBE Rotate Z").valueAtTime(t, false) * Math.PI / 180; } catch (e) {}
    var sx = sc[0] / 100, sy = sc[1] / 100, cs = Math.cos(rot), sn = Math.sin(rot);
    var a = cs * sx, b = sn * sx, c = -sn * sy, d = cs * sy;
    var m = [a, b, c, d, pos[0] - (a * ap[0] + c * ap[1]), pos[1] - (b * ap[0] + d * ap[1])];
    if (l.parent) m = matMul(layerMatrix(l.parent, t), m);
    return m;
}
function applyMat(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
function compBounds(l, t) {
    var r;
    try { r = l.sourceRectAtTime(t, false); } catch (e) { return null; }
    var m = layerMatrix(l, t);
    var pts = [applyMat(m, r.left, r.top), applyMat(m, r.left + r.width, r.top),
        applyMat(m, r.left, r.top + r.height), applyMat(m, r.left + r.width, r.top + r.height)];
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < 4; i++) {
        x0 = Math.min(x0, pts[i][0]); y0 = Math.min(y0, pts[i][1]);
        x1 = Math.max(x1, pts[i][0]); y1 = Math.max(y1, pts[i][1]);
    }
    return { left: rnd(x0), top: rnd(y0), right: rnd(x1), bottom: rnd(y1), width: rnd(x1 - x0), height: rnd(y1 - y0) };
}
function activeAt(l, t) { return l.enabled && t >= l.inPoint && t < l.outPoint; }
// move a layer by (dx, dy) in comp pixels; shifts all position keys if keyed
function moveLayerBy(l, dx, dy) {
    var t = l.containingComp.time, lx = dx, ly = dy;
    if (l.parent) {
        var M = layerMatrix(l.parent, t), det = M[0] * M[3] - M[2] * M[1];
        if (Math.abs(det) < 1e-9) fail("Parent of '" + l.name + "' has zero scale");
        lx = (M[3] * dx - M[2] * dy) / det;
        ly = (-M[1] * dx + M[0] * dy) / det;
    }
    var tr = l.property("ADBE Transform Group"), p = tr.property("ADBE Position");
    function shift(prop, delta) {
        if (prop.numKeys) {
            for (var k = 1; k <= prop.numKeys; k++) {
                var v = prop.keyValue(k);
                if (isArr(v)) { v[0] += delta[0]; v[1] += delta[1]; } else v += delta;
                prop.setValueAtKey(k, v);
            }
        } else {
            var w = prop.value;
            if (isArr(w)) { w[0] += delta[0]; w[1] += delta[1]; } else w += delta;
            prop.setValue(w);
        }
    }
    withUnlocked(l, function () {
        if (p.dimensionsSeparated) { shift(tr.property("ADBE Position_0"), lx); shift(tr.property("ADBE Position_1"), ly); }
        else shift(p, [lx, ly]);
    });
}

// ---------------------------------------------------------------- serialization of props / layers / comps
function dumpOpts(a, comp) {
    return {
        depth: num(a.depth, 30), all: !!a.all, ease: a.ease !== false, props: a.props !== false,
        evaluated: !!a.evaluated, time: num(a.time, comp ? comp.time : 0), maxExpr: num(a.maxExpr, 0)
    };
}
function dumpProp(p, o, depth) {
    var r = { n: p.name, m: p.matchName };
    try { r.i = p.propertyIndex; } catch (e) {}
    try { if (p.canSetEnabled && !p.enabled) r.off = true; } catch (e) {}
    if (p.propertyType === PropertyType.PROPERTY) {
        if (p.propertyValueType === PropertyValueType.NO_VALUE) return o.all ? r : null;
        var hasX = false;
        try { hasX = p.canSetExpression && p.expression !== ""; } catch (e) {}
        var modified = true;
        try { modified = p.isModified; } catch (e) {}
        if (!o.all && !modified && p.numKeys === 0 && !hasX) return null;
        try {
            if (p.numKeys > 0) r.k = keysOut(p, o.ease);
            else r.v = valOut(p, p.value);
        } catch (e) { r.err = errStr(e); }
        if (hasX) {
            r.x = o.maxExpr ? shorten(p.expression, o.maxExpr) : p.expression;
            if (!p.expressionEnabled) r.xOff = true;
            try { if (p.expressionError) r.xErr = p.expressionError; } catch (e) {}
            if (o.evaluated) try { r.ve = valOut(p, p.valueAtTime(o.time, false)); } catch (e) {}
        }
        try { if (p.dimensionsSeparated) r.sep = true; } catch (e) {}
        return r;
    }
    var added = false;
    try { added = p.parentProperty && p.parentProperty.propertyDepth > 0 && p.parentProperty.propertyType === PropertyType.INDEXED_GROUP; } catch (e) {}
    try { if (!added && p.parentProperty && p.parentProperty.propertyType === PropertyType.INDEXED_GROUP) added = true; } catch (e) {}
    if (depth >= o.depth) { r.more = p.numProperties; return r; }
    var kids = [];
    for (var i = 1; i <= p.numProperties; i++) {
        var c = null;
        try { c = dumpProp(p.property(i), o, depth + 1); } catch (e) { c = null; }
        if (c) kids.push(c);
    }
    if (!kids.length && !o.all && !added) return null;
    if (kids.length) r.c = kids;
    return r;
}
function markersOut(prop) {
    var r = [];
    for (var k = 1; k <= prop.numKeys; k++) {
        var m = markerOut(prop.keyValue(k));
        m.t = rnd(prop.keyTime(k));
        r.push(m);
    }
    return r;
}
function layerOut(l, o) {
    var r = lref(l);
    r.type = layerType(l);
    r.inPoint = rnd(l.inPoint); r.outPoint = rnd(l.outPoint); r.startTime = rnd(l.startTime);
    try { if (l.stretch !== 100) r.stretch = rnd(l.stretch); } catch (e) {}
    if (!l.enabled) r.enabled = false;
    if (l.solo) r.solo = true;
    if (l.locked) r.locked = true;
    if (l.shy) r.shy = true;
    if (l.label) r.label = l.label;
    if (l.comment) r.comment = l.comment;
    if (l.parent) r.parent = lref(l.parent);
    if (!(l instanceof CameraLayer) && !(l instanceof LightLayer)) {
        try {
            if (l.threeDLayer) r.threeD = true;
            if (l.motionBlur) r.motionBlur = true;
        } catch (e) {}
        try {
            if (l.collapseTransformation) r.collapse = true;
            if (l.guideLayer) r.guide = true;
            if (l.blendingMode !== BlendingMode.NORMAL) r.blend = enumName("BlendingMode", l.blendingMode);
            if (l.quality !== LayerQuality.BEST) r.quality = enumName("LayerQuality", l.quality);
            if (l.timeRemapEnabled) r.timeRemap = true;
            if (l.frameBlendingType !== FrameBlendingType.NO_FRAME_BLEND) r.frameBlending = enumName("FrameBlendingType", l.frameBlendingType);
            if (l.isTrackMatte) r.isMatte = true;
            if (!l.effectsActive) r.effectsActive = false;
            if (l.preserveTransparency) r.preserveTransparency = true;
        } catch (e) {}
        try {
            if (l.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) {
                r.matte = { type: enumName("TrackMatteType", l.trackMatteType) };
                try { if (l.trackMatteLayer) r.matte.layer = lref(l.trackMatteLayer); } catch (e) {}
            }
        } catch (e) {}
        try { if (l.source && !l.nullLayer) r.source = iref(l.source); } catch (e) {}
        try { if (l.autoOrient !== AutoOrientType.NO_AUTO_ORIENT) r.autoOrient = enumName("AutoOrientType", l.autoOrient); } catch (e) {}
    }
    try { var mk = l.property("ADBE Marker"); if (mk.numKeys) r.markers = markersOut(mk); } catch (e) {}
    if (l instanceof TextLayer) {
        try { r.text = textDocOut(l.property("ADBE Text Properties").property("ADBE Text Document").valueAtTime(o.time, false)); } catch (e) {}
    }
    if (o.props) {
        var kids = [];
        for (var i = 1; i <= l.numProperties; i++) {
            var p = l.property(i);
            if (p.matchName === "ADBE Marker") continue;
            var c = null;
            try { c = dumpProp(p, o, 1); } catch (e) {}
            if (c) kids.push(c);
        }
        r.props = kids;
    }
    return r;
}
function compOut(c) {
    var r = iref(c);
    r.width = c.width; r.height = c.height; r.pixelAspect = rnd(c.pixelAspect);
    r.frameRate = rnd(c.frameRate); r.duration = rnd(c.duration); r.frames = Math.round(c.duration * c.frameRate);
    r.bgColor = rnd(c.bgColor); r.time = rnd(c.time);
    r.workArea = [rnd(c.workAreaStart), rnd(c.workAreaDuration)];
    if (c.displayStartTime) r.displayStartTime = rnd(c.displayStartTime);
    r.numLayers = c.numLayers;
    r.folder = folderPath(c);
    if (c.comment) r.comment = c.comment;
    try { r.renderer = c.renderer; } catch (e) {}
    if (c.motionBlur) { r.motionBlur = true; r.shutterAngle = c.shutterAngle; r.shutterPhase = c.shutterPhase; }
    if (c.frameBlending) r.frameBlending = true;
    if (c.hideShyLayers) r.hideShyLayers = true;
    try { var mk = c.markerProperty; if (mk.numKeys) r.markers = markersOut(mk); } catch (e) {}
    var u = c.usedIn, names = [];
    for (var i = 0; i < u.length; i++) names.push(u[i].name);
    r.usedIn = names;
    return r;
}
function itemOut(it) {
    var r = iref(it);
    var fp = folderPath(it); if (fp) r.folder = fp;
    if (it.comment) r.comment = it.comment;
    if (it.label) r.label = it.label;
    if (it instanceof CompItem) {
        r.width = it.width; r.height = it.height; r.frameRate = rnd(it.frameRate); r.duration = rnd(it.duration); r.numLayers = it.numLayers;
    } else if (it instanceof FootageItem) {
        r.width = it.width; r.height = it.height;
        if (it.duration) r.duration = rnd(it.duration);
        try { if (it.file) r.file = it.file.fsName; } catch (e) {}
        if (it.footageMissing) r.missing = true;
        try { if (it.mainSource instanceof SolidSource) r.color = hexOf(it.mainSource.color); } catch (e) {}
        try { if (it.useProxy) r.useProxy = true; } catch (e) {}
    }
    if (!(it instanceof FolderItem)) { try { r.usedIn = it.usedIn.length; } catch (e) {} }
    return r;
}

// ---------------------------------------------------------------- common layer setters
function moveLayerTo(comp, l, to) {
    withUnlocked(l, function () {
        if (to === "top" || to === 1) { l.moveToBeginning(); return; }
        if (to === "bottom") { l.moveToEnd(); return; }
        if (typeof to === "object" && to !== null && (to.above !== undefined || to.below !== undefined)) {
            var ref = getLayer(comp, to.above !== undefined ? to.above : to.below);
            if (ref === l) return;
            if (to.above !== undefined) l.moveBefore(ref); else l.moveAfter(ref);
            return;
        }
        var ix = Number(to);
        if (ix >= comp.numLayers) { l.moveToEnd(); return; }
        var target = comp.layer(ix);
        if (target === l) return;
        if (l.index < ix) l.moveAfter(target); else l.moveBefore(target);
    });
}
function setParentRef(comp, l, ref, keepTransform) {
    var p = (ref === null || ref === "" || ref === false) ? null : getLayer(comp, ref);
    withUnlocked(l, function () {
        if (keepTransform === false && p) l.setParentWithJump(p);
        else if (keepTransform === false && !p) l.setParentWithJump(null);
        else l.parent = p;
    });
}
function applyLayerCommon(comp, l, a) {
    if (a.name !== undefined) l.name = a.name;
    if (a.comment !== undefined) l.comment = a.comment;
    if (a.label !== undefined) l.label = a.label;
    if (a.threeD !== undefined) l.threeDLayer = !!a.threeD;
    if (a.blend !== undefined) l.blendingMode = enumVal("BlendingMode", a.blend);
    if (a.stretch !== undefined) l.stretch = a.stretch;
    if (a.startTime !== undefined) l.startTime = a.startTime;
    if (a.inPoint !== undefined) l.inPoint = a.inPoint;
    if (a.outPoint !== undefined) l.outPoint = a.outPoint;
    var tf = ["anchor", "position", "scale", "rotation", "opacity"];
    for (var i = 0; i < tf.length; i++) if (a[tf[i]] !== undefined) setPropValue(resolveProp(l, tf[i]), a[tf[i]]);
    var k;
    if (a.props) for (k in a.props) if (has(a.props, k)) setPropValue(resolveProp(l, k), a.props[k]);
    if (a.expressions) for (k in a.expressions) if (has(a.expressions, k)) setExpr(resolveProp(l, k), a.expressions[k]);
    if (a.parent !== undefined) setParentRef(comp, l, a.parent, a.keepTransform);
    if (a.index !== undefined) moveLayerTo(comp, l, a.index);
    if (a.enabled !== undefined) l.enabled = !!a.enabled;
    if (a.shy !== undefined) l.shy = !!a.shy;
    if (a.locked !== undefined) l.locked = !!a.locked;
}
function parseTime(s, fps) {
    if (typeof s === "number") return s;
    var t = trim(s).replace(",", ".");
    var m;
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    if ((m = /^(\d+):(\d+):(\d+):(\d+)$/.exec(t))) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / (fps || 30);
    if ((m = /^(\d+):(\d+):(\d+(\.\d+)?)$/.exec(t))) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    if ((m = /^(\d+):(\d+(\.\d+)?)$/.exec(t))) return (+m[1]) * 60 + parseFloat(m[2]);
    if ((m = /^(\d+)f$/.exec(t))) return (+m[1]) / (fps || 30);
    fail("Cannot parse time: " + s);
}

// ---------------------------------------------------------------- registry & dispatch
// flags: {w: write command, noUndo: do not wrap in undo group}
function def(name, flags, doc, fn) { RB.cmds[name] = { w: !!flags.w, noUndo: !!flags.noUndo, doc: doc, fn: fn }; }
RB.allowWrites = function () { return !!(RB.ui && RB.ui.allow && RB.ui.allow.value); };
RB.run = function (command, args, inBatch) {
    var c = RB.cmds[command];
    if (!c) fail("Unknown command: " + command + " (use 'help')");
    if (c.w && !RB.allowWrites()) fail("'" + command + "' changes the project, but 'Allow changes' is off in the BridgeLine panel");
    if (!c.w || c.noUndo || inBatch) return c.fn(args || {});
    app.beginUndoGroup("BridgeLine: " + command);
    try { return c.fn(args || {}); } finally { app.endUndoGroup(); }
};
RB.log = function (s) {
    var line = stamp().substr(11) + "  " + s;
    RB.logLines.push(line);
    if (RB.logLines.length > 500) RB.logLines.shift();
    try {
        var f = new File(RB.root + "/log.txt");
        f.encoding = "UTF-8";
        if (f.open("a")) { f.writeln(stamp().substr(0, 10) + " " + line); f.close(); }
    } catch (e) {}
    if (RB.ui && RB.ui.list) {
        try {
            RB.ui.list.add("item", shorten(line, 200));
            while (RB.ui.list.items.length > 200) RB.ui.list.remove(0);
            RB.ui.list.revealItem(RB.ui.list.items.length - 1);
        } catch (e) {}
    }
};
// ================================================================ READ-ONLY COMMANDS

def("ping", {}, "Bridge/AE/project status.", function (a) {
    var r = {
        bridge: RB.VERSION, ae: app.version, project: app.project.file ? app.project.file.fsName : null,
        numItems: app.project.numItems, allowWrites: RB.allowWrites(), bridgeFolder: RB.root,
        allowedWriteRoots: allowedRoots(), time: stamp()
    };
    try { r.dirty = app.project.dirty; } catch (e) {}
    try { if (app.project.activeItem) r.activeItem = iref(app.project.activeItem); } catch (e) {}
    return r;
});

def("help", {}, "List commands. args: [filter] regex on name/doc, [writeOnly], [readOnly]", function (a) {
    var re = a.filter ? toRegex(a.filter) : null, r = [], names = keysOf(RB.cmds).sort();
    for (var i = 0; i < names.length; i++) {
        var c = RB.cmds[names[i]];
        if (re && !re.test(names[i]) && !re.test(c.doc)) continue;
        if (a.writeOnly && !c.w) continue;
        if (a.readOnly && c.w) continue;
        r.push({ name: names[i], write: c.w, doc: c.doc });
    }
    return { count: r.length, commands: r };
});

def("projectTree", {}, "Project items. args: [flat] list instead of tree, [type] comp|footage|solid|folder|audio|placeholder, [match] regex, [out] file", function (a) {
    var re = a.match ? toRegex(a.match) : null;
    if (a.flat || re || a.type) {
        var list = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (a.type && itemType(it) !== a.type) continue;
            if (re && !re.test(it.name)) continue;
            list.push(itemOut(it));
        }
        return outResult(a, { count: list.length, items: list });
    }
    function walk(folder) {
        var arr = [];
        for (var j = 1; j <= folder.numItems; j++) {
            var x = folder.item(j), o = itemOut(x);
            if (x instanceof FolderItem) o.items = walk(x);
            arr.push(o);
        }
        return arr;
    }
    return outResult(a, { project: app.project.file ? app.project.file.fsName : null, items: walk(app.project.rootFolder) });
});

def("compInfo", {}, "Comp settings + short layer list. args: comp", function (a) {
    var c = getComp(a.comp), r = compOut(c), ls = [];
    for (var i = 1; i <= c.numLayers; i++) {
        var l = c.layer(i), o = lref(l);
        o.type = layerType(l); o.inPoint = rnd(l.inPoint); o.outPoint = rnd(l.outPoint);
        if (!l.enabled) o.enabled = false;
        if (l.parent) o.parent = l.parent.index;
        try { if (l.source && !l.nullLayer && l.source instanceof CompItem) o.source = l.source.name; } catch (e) {}
        try { if (l.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) o.matte = enumName("TrackMatteType", l.trackMatteType); } catch (e) {}
        ls.push(o);
    }
    r.layers = ls;
    return outResult(a, r);
});

def("dumpComp", {}, "Full JSON of a comp (only modified props unless all). args: comp, [layers|layer|match|selected], [all], [depth], [evaluated], [time], [props:false], [maxExpr], [out] file", function (a) {
    var c = getComp(a.comp), o = dumpOpts(a, c), r = compOut(c);
    var ls = (a.layers || a.layer !== undefined || a.match !== undefined || a.selected || a.layerType) ? getLayers(c, a, true) : null;
    r.layers = [];
    if (ls) { for (var i = 0; i < ls.length; i++) r.layers.push(layerOut(ls[i], o)); }
    else { for (var j = 1; j <= c.numLayers; j++) r.layers.push(layerOut(c.layer(j), o)); }
    return outResult(a, r);
});

def("dumpLayer", {}, "Full JSON of one layer. args: comp, layer, [all], [depth], [evaluated], [time]", function (a) {
    var c = getComp(a.comp);
    return outResult(a, layerOut(getLayer(c, a.layer), dumpOpts(a, c)));
});

def("dumpProperty", {}, "JSON of a property or group. args: comp, layer, path, [all=true], [depth], [evaluated], [time]", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), p = resolveProp(l, a.path);
    if (a.all === undefined) a.all = true;
    var o = dumpOpts(a, c), r = dumpProp(p, o, 0) || { n: p.name, m: p.matchName };
    r.path = propPath(p); r.mpath = propMPath(p);
    if (isLeaf(p)) {
        try { r.type = enumName("PropertyValueType", p.propertyValueType); } catch (e) {}
        try { r.canVary = p.canVaryOverTime; r.spatial = p.isSpatial; } catch (e) {}
        try { if (p.hasMin) r.min = p.minValue; if (p.hasMax) r.max = p.maxValue; } catch (e) {}
        try { if (p.unitsText) r.units = p.unitsText; } catch (e) {}
    } else {
        try { r.canAdd = p.propertyType === PropertyType.INDEXED_GROUP; } catch (e) {}
    }
    return r;
});

def("findLayers", {}, "Search layers across comps. args: [name] regex, [layerType], [comps|compMatch], [effect] regex (name/matchName), [text] regex, [expression] regex, [comment] regex, [source] regex, [hasExpressions], [hasKeys], [disabled], [limit=500]", function (a) {
    var comps = getComps(a, true), res = [], limit = num(a.limit, 500);
    var reN = a.name !== undefined ? toRegex(a.name) : null, reE = a.effect !== undefined ? toRegex(a.effect) : null;
    var reT = a.text !== undefined ? toRegex(a.text) : null, reX = a.expression !== undefined ? toRegex(a.expression) : null;
    var reC = a.comment !== undefined ? toRegex(a.comment) : null, reS = a.source !== undefined ? toRegex(a.source) : null;
    for (var ci = 0; ci < comps.length && res.length < limit; ci++) {
        var c = comps[ci];
        for (var i = 1; i <= c.numLayers && res.length < limit; i++) {
            var l = c.layer(i), hit = { comp: iref(c), layer: lref(l), type: layerType(l) };
            if (reN && !reN.test(l.name)) continue;
            if (a.layerType && hit.type !== a.layerType) continue;
            if (reC && !reC.test(l.comment)) continue;
            if (a.disabled !== undefined && (!l.enabled) !== !!a.disabled) continue;
            if (reS) { var sn = ""; try { sn = l.source ? l.source.name : ""; } catch (e) {} if (!reS.test(sn)) continue; hit.source = sn; }
            if (reE) {
                var fx = l.property("ADBE Effect Parade"), fl = [];
                if (fx) for (var f = 1; f <= fx.numProperties; f++) {
                    var e1 = fx.property(f);
                    if (reE.test(e1.name) || reE.test(e1.matchName)) fl.push(e1.name);
                }
                if (!fl.length) continue;
                hit.effects = fl;
            }
            if (reT) {
                if (!(l instanceof TextLayer)) continue;
                var tx = l.property("ADBE Text Properties").property("ADBE Text Document").value.text;
                if (!reT.test(tx)) continue;
                hit.text = shorten(tx, 200);
            }
            if (reX || a.hasExpressions || a.hasKeys) {
                var xs = [], keyed = 0;
                walkProps(l, function (p) {
                    try {
                        if (p.numKeys) keyed++;
                        if (p.canSetExpression && p.expression !== "" && (!reX || reX.test(p.expression))) xs.push(propPath(p));
                    } catch (e) {}
                });
                if ((reX || a.hasExpressions) && !xs.length) continue;
                if (a.hasKeys && !keyed) continue;
                if (xs.length) hit.expressions = xs;
                if (keyed) hit.keyedProps = keyed;
            }
            res.push(hit);
        }
    }
    return outResult(a, { count: res.length, truncated: res.length >= limit, layers: res });
});

def("listExpressions", {}, "All expressions. args: [comps|compMatch|comp], [match] regex on expression, [errorsOnly], [full] untruncated, [out]", function (a) {
    var comps = getComps(a, true), res = [], re = a.match ? toRegex(a.match) : null;
    for (var ci = 0; ci < comps.length; ci++) {
        var c = comps[ci];
        for (var i = 1; i <= c.numLayers; i++) {
            var l = c.layer(i);
            walkProps(l, function (p) {
                try {
                    if (!p.canSetExpression || p.expression === "") return;
                    if (re && !re.test(p.expression)) return;
                    var err = p.expressionEnabled ? exprEval(p) : "";
                    if (a.errorsOnly && !err) return;
                    var o = { comp: c.name, layer: lref(l), path: propPath(p), expression: a.full ? p.expression : shorten(p.expression, 300) };
                    if (!p.expressionEnabled) o.enabled = false;
                    if (err) o.error = err;
                    res.push(o);
                } catch (e) {}
            });
        }
    }
    return outResult(a, { count: res.length, expressions: res });
});

def("listFonts", {}, "Fonts used by text layers (+ missing). args: [available] also list installed fonts, [match] regex for installed list", function (a) {
    var used = {}, comps = getComps(a, true);
    function note(font, where) {
        if (!used[font]) used[font] = { count: 0, where: [] };
        used[font].count++;
        if (used[font].where.length < 10) used[font].where.push(where);
    }
    for (var ci = 0; ci < comps.length; ci++) {
        var c = comps[ci];
        for (var i = 1; i <= c.numLayers; i++) {
            var l = c.layer(i);
            if (!(l instanceof TextLayer)) continue;
            var p = l.property("ADBE Text Properties").property("ADBE Text Document");
            var docs = [];
            if (p.numKeys) { for (var k = 1; k <= p.numKeys; k++) docs.push(p.keyValue(k)); } else docs.push(p.value);
            for (var d = 0; d < docs.length; d++) {
                var seen = {};
                try {
                    if (docs[d].characterRange) {
                        var len = docs[d].text.length;
                        for (var ch = 0; ch < len; ch++) {
                            var fnm = docs[d].characterRange(ch, ch + 1).font;
                            if (!seen[fnm]) { seen[fnm] = 1; note(fnm, c.name + " / " + l.name); }
                        }
                    }
                } catch (e) {}
                if (!keysOf(seen).length) note(docs[d].font, c.name + " / " + l.name);
            }
        }
    }
    var r = { used: used };
    try {
        var miss = app.fonts.missingOrSubstitutedFonts, ml = [];
        for (var m = 0; m < miss.length; m++) ml.push(miss[m].postScriptName);
        r.missingOrSubstituted = ml;
    } catch (e) {}
    if (a.available) {
        try {
            var all = app.fonts.allFonts, list = [], re = a.match ? toRegex(a.match) : null;
            for (var g = 0; g < all.length; g++) {
                for (var h = 0; h < all[g].length; h++) {
                    var fo = all[g][h];
                    var s = fo.postScriptName + " | " + fo.familyName + " " + fo.styleName;
                    if (!re || re.test(s)) list.push(s);
                }
            }
            r.available = list;
        } catch (e) { r.available = "app.fonts is not available: " + errStr(e); }
    }
    return outResult(a, r);
});

def("listEffects", {}, "Installed effects. args: [match] regex on name/matchName/category", function (a) {
    var re = a.match ? toRegex(a.match) : null, r = [], fx = app.effects;
    for (var i = 0; i < fx.length; i++) {
        var e = fx[i];
        if (re && !re.test(e.displayName) && !re.test(e.matchName) && !re.test(e.category)) continue;
        r.push({ name: e.displayName, matchName: e.matchName, category: e.category });
    }
    return outResult(a, { count: r.length, effects: r });
});

def("renderFrames", {}, "Save comp frames as PNG. args: comp, [time]|[times]|[range:[start,end], step]|[markers:true], [folder] (default bridge/renders), [prefix]", function (a) {
    var c = getComp(a.comp), times = [], i;
    if (a.times) times = a.times;
    else if (a.markers) { var mk = c.markerProperty; for (i = 1; i <= mk.numKeys; i++) times.push(mk.keyTime(i)); }
    else if (a.range) { var st = num(a.step, 1); for (var t = a.range[0]; t <= a.range[1] + 1e-6; t += st) times.push(t); }
    else times.push(num(a.time, c.time));
    if (times.length > 200) fail("Too many frames (" + times.length + "), max 200");
    var folder = safeOut((a.folder || "renders") + "/x.png");
    folder = new File(folder).parent.fsName;
    var out = [];
    for (i = 0; i < times.length; i++) {
        var tt = parseTime(times[i], c.frameRate);
        var name = (a.prefix || safeName(c.name)) + "_" + pad(Math.round(tt * 1000), 6) + "ms.png";
        var f = new File(folder + "/" + name);
        c.saveFrameToPng(tt, f);
        out.push({ time: rnd(tt), file: f.fsName });
    }
    return { count: out.length, frames: out };
});

def("valueAtTime", {}, "Evaluated value(s). args: comp, layer, path, [time]|[times], [preExpression]", function (a) {
    var c = getComp(a.comp), p = resolveProp(getLayer(c, a.layer), a.path);
    if (!hasValue(p)) fail("Not a value property: " + propPath(p));
    var times = a.times || [num(a.time, c.time)], r = [];
    for (var i = 0; i < times.length; i++) {
        var t = parseTime(times[i], c.frameRate);
        r.push({ t: rnd(t), v: valOut(p, p.valueAtTime(t, !!a.preExpression)) });
    }
    var o = { path: propPath(p), values: r };
    try { if (p.expression !== "") { o.expression = p.expression; o.expressionError = p.expressionError; } } catch (e) {}
    return o;
});

def("sourceRect", {}, "Layer rect in layer space + approx comp-space bounds. args: comp, layer(s)/match/selected, [time], [extents]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), t = num(a.time, c.time), r = [];
    for (var i = 0; i < ls.length; i++) {
        var o = lref(ls[i]);
        try {
            var s = ls[i].sourceRectAtTime(t, !!a.extents);
            o.rect = { left: rnd(s.left), top: rnd(s.top), width: rnd(s.width), height: rnd(s.height) };
            o.compBounds = compBounds(ls[i], t);
        } catch (e) { o.error = errStr(e); }
        r.push(o);
    }
    return { time: rnd(t), layers: r };
});

def("activeState", {}, "What is open/selected in AE now (active comp, CTI, selected layers/properties/keys, selected project items).", function (a) {
    var r = { time: stamp() }, it = app.project.activeItem, i;
    r.activeItem = it ? itemOut(it) : null;
    var sel = app.project.selection, si = [];
    for (i = 0; i < sel.length; i++) si.push(iref(sel[i]));
    r.selectedItems = si;
    if (it instanceof CompItem) {
        r.cti = rnd(it.time);
        r.workArea = [rnd(it.workAreaStart), rnd(it.workAreaDuration)];
        var sl = it.selectedLayers, ls = [];
        for (i = 0; i < sl.length; i++) { var o = lref(sl[i]); o.type = layerType(sl[i]); ls.push(o); }
        r.selectedLayers = ls;
        var sp = it.selectedProperties, ps = [];
        for (i = 0; i < sp.length; i++) {
            var p = sp[i], po = { layer: lref(propLayer(p)), path: propPath(p), mpath: propMPath(p) };
            try {
                if (hasValue(p)) {
                    po.value = valOut(p, p.valueAtTime(it.time, false));
                    if (p.expression !== "") po.expression = p.expression;
                    var sk = p.selectedKeys, kt = [];
                    for (var k = 0; k < sk.length; k++) kt.push(rnd(p.keyTime(sk[k])));
                    if (kt.length) po.selectedKeyTimes = kt;
                    if (p.numKeys) po.numKeys = p.numKeys;
                }
            } catch (e) {}
            ps.push(po);
        }
        r.selectedProperties = ps;
    }
    return r;
});

def("whereUsed", {}, "Where an item is used (layers) and which expressions mention it. args: item | text (string to search in expressions)", function (a) {
    var r = {}, i, j;
    var needle = a.text;
    if (a.item !== undefined) {
        var it = getItem(a.item);
        r.item = iref(it);
        needle = needle || it.name;
        var uses = [];
        if (!(it instanceof FolderItem)) {
            var u = it.usedIn;
            for (i = 0; i < u.length; i++) {
                for (j = 1; j <= u[i].numLayers; j++) {
                    try { if (u[i].layer(j).source === it) uses.push({ comp: iref(u[i]), layer: lref(u[i].layer(j)) }); } catch (e) {}
                }
            }
        }
        r.layers = uses;
    }
    if (needle) {
        var xs = [], comps = getComps({}, true);
        for (i = 0; i < comps.length; i++) {
            for (j = 1; j <= comps[i].numLayers; j++) {
                var l = comps[i].layer(j);
                walkProps(l, function (p) {
                    try { if (p.canSetExpression && p.expression.indexOf(needle) >= 0) xs.push({ comp: comps[i].name, layer: lref(l), path: propPath(p) }); } catch (e) {}
                });
            }
        }
        r.expressionRefs = xs;
    }
    return r;
});

def("dependencyGraph", {}, "Nested comp tree. args: comp, [footage] include footage/solids, [maxDepth=20]", function (a) {
    var maxD = num(a.maxDepth, 20);
    function node(c, depth, stack) {
        var r = { id: c.id, name: c.name, duration: rnd(c.duration) }, kids = [];
        if (depth >= maxD) { r.more = true; return r; }
        for (var i = 1; i <= c.numLayers; i++) {
            var l = c.layer(i), s = null;
            try { s = l.source; } catch (e) {}
            if (!s || l.nullLayer) continue;
            if (s instanceof CompItem) {
                if (idxOf(stack, s.id) >= 0) { kids.push({ name: s.name, cycle: true }); continue; }
                var k = node(s, depth + 1, stack.concat([s.id]));
                k.layer = l.name; k.at = rnd(l.startTime);
                kids.push(k);
            } else if (a.footage) kids.push({ name: s.name, type: itemType(s), layer: l.name });
        }
        if (kids.length) r.children = kids;
        return r;
    }
    var c = getComp(a.comp);
    return outResult(a, node(c, 0, [c.id]));
});

// ---------------------------------------------------------------- snapshot / diff
function flattenDump(d, map) {
    function put(k, v) { map[k] = jsonStr(v); }
    function props(prefix, arr) {
        for (var i = 0; i < arr.length; i++) {
            var p = arr[i], key = prefix + "/" + p.n;
            if (p.v !== undefined) put(key, p.v);
            if (p.k !== undefined) put(key + " [keys]", p.k);
            if (p.x !== undefined) put(key + " [expr]", p.x);
            if (p.off) put(key + " [disabled]", true);
            if (p.c) props(key, p.c);
        }
    }
    var cp = "comp:" + d.name + "#" + d.id, skip = { layers: 1, time: 1, usedIn: 1 };
    for (var k in d) if (has(d, k) && !skip[k]) put(cp + "." + k, d[k]);
    for (var j = 0; j < d.layers.length; j++) {
        var l = d.layers[j], lp = cp + " > L" + l.id;
        for (var f in l) {
            if (!has(l, f) || f === "props" || f === "id") continue;
            put(lp + "." + f, l[f]);
        }
        if (l.props) props(lp, l.props);
    }
}
def("snapshot", {}, "Save a JSON snapshot of comps for later diff. args: [comps|comp|compMatch], [name] (default: first comp name)", function (a) {
    var comps = getComps(a, false), dumps = [];
    for (var i = 0; i < comps.length; i++) {
        var c = comps[i], o = dumpOpts({ ease: true }, c), r = compOut(c);
        r.layers = [];
        for (var j = 1; j <= c.numLayers; j++) r.layers.push(layerOut(c.layer(j), o));
        dumps.push(r);
    }
    var name = safeName(a.name || comps[0].name);
    var p = safeOut("snapshots/" + name + ".json");
    writeText(p, jsonStr({ created: stamp(), comps: dumps }));
    return { written: p, comps: comps.length };
});
def("diff", {}, "Compare current state with a snapshot. args: name, [limit=300]", function (a) {
    if (!a.name) fail("name is required");
    var snap = jsonParse(readText(safeOut("snapshots/" + safeName(a.name) + ".json")));
    var before = {}, after = {}, i;
    for (i = 0; i < snap.comps.length; i++) {
        flattenDump(snap.comps[i], before);
        var c = null;
        try { c = getComp(snap.comps[i].id); } catch (e) {}
        if (c) {
            var r = compOut(c), o = dumpOpts({ ease: true }, c);
            r.layers = [];
            for (var j = 1; j <= c.numLayers; j++) r.layers.push(layerOut(c.layer(j), o));
            flattenDump(r, after);
        }
    }
    var changed = [], added = [], removed = [], limit = num(a.limit, 300), k;
    for (k in before) {
        if (!has(before, k)) continue;
        if (!has(after, k)) removed.push(k);
        else if (after[k] !== before[k]) changed.push({ key: k, before: shorten(before[k], 400), after: shorten(after[k], 400) });
    }
    for (k in after) if (has(after, k) && !has(before, k)) added.push(k + " = " + shorten(after[k], 200));
    return {
        snapshot: snap.created, changedCount: changed.length, addedCount: added.length, removedCount: removed.length,
        changed: changed.slice(0, limit), added: added.slice(0, limit), removed: removed.slice(0, limit)
    };
});

// ---------------------------------------------------------------- audit
def("audit", {}, "Project problems report: missing footage/fonts, expression errors, texts outside frame/safe area, empty comps, unused items, layers outside comp time, missing effects. args: [comps|compMatch], [safe=0.9] title-safe ratio, [limit=100]", function (a) {
    var limit = num(a.limit, 100), safe = num(a.safe, 0.9), comps = getComps(a, true), i, j;
    var r = { missingFootage: [], unusedItems: [], emptyComps: [], expressionErrors: [], textOutsideFrame: [], textOutsideSafe: [], layersOutsideCompTime: [], missingEffects: [] };
    function push(list, v) { if (list.length < limit) list.push(v); }
    for (i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof FootageItem) {
            if (it.footageMissing) push(r.missingFootage, iref(it));
            if (!it.usedIn.length) push(r.unusedItems, iref(it));
        }
    }
    var known = {};
    try { for (i = 0; i < app.effects.length; i++) known[app.effects[i].matchName] = 1; } catch (e) {}
    for (i = 0; i < comps.length; i++) {
        var c = comps[i];
        if (!c.numLayers) push(r.emptyComps, iref(c));
        var mx = c.width * (1 - safe) / 2, my = c.height * (1 - safe) / 2;
        for (j = 1; j <= c.numLayers; j++) {
            var l = c.layer(j), where = c.name + " / " + l.name + " (#" + l.index + ")";
            if (l.outPoint <= 0 || l.inPoint >= c.duration) push(r.layersOutsideCompTime, where);
            var fx = l.property("ADBE Effect Parade");
            if (fx) for (var f = 1; f <= fx.numProperties; f++) if (!known[fx.property(f).matchName]) push(r.missingEffects, where + ": " + fx.property(f).matchName);
            walkProps(l, function (p) {
                try {
                    if (p.canSetExpression && p.expression !== "" && p.expressionEnabled) {
                        var err = exprEval(p);
                        if (err) push(r.expressionErrors, { where: where, path: propPath(p), error: err });
                    }
                } catch (e) {}
            });
            if (l instanceof TextLayer && l.enabled) {
                var t = Math.max(l.inPoint, Math.min(c.duration, l.outPoint) - c.frameDuration);
                t = Math.max(0, Math.min(t, (l.inPoint + Math.min(l.outPoint, c.duration)) / 2));
                var b = compBounds(l, t);
                if (!b || !b.width) continue;
                if (b.left < 0 || b.top < 0 || b.right > c.width || b.bottom > c.height) push(r.textOutsideFrame, { where: where, time: rnd(t), bounds: b });
                else if (b.left < mx || b.top < my || b.right > c.width - mx || b.bottom > c.height - my) push(r.textOutsideSafe, { where: where, time: rnd(t), bounds: b });
            }
        }
    }
    try {
        var miss = app.fonts.missingOrSubstitutedFonts, ml = [];
        for (i = 0; i < miss.length; i++) ml.push(miss[i].postScriptName);
        r.missingFonts = ml;
    } catch (e) { r.missingFonts = "not available in this AE version"; }
    r.note = "Bounds are approximate (2D transforms incl. parents; 3D, auto-orient and effects are ignored).";
    return outResult(a, r);
});

def("checkTextOverlap", {}, "Text layers whose bounding box overlaps other visible layers. args: comp, [time]|[times], [ignore] regex of layer names, [maxCover=0.9] ignore layers covering more than this share of frame", function (a) {
    var c = getComp(a.comp), times = a.times || [num(a.time, c.time)], ign = a.ignore ? toRegex(a.ignore) : null;
    var maxCover = num(a.maxCover, 0.9), out = [];
    for (var ti = 0; ti < times.length; ti++) {
        var t = parseTime(times[ti], c.frameRate), boxes = [], i, j;
        for (i = 1; i <= c.numLayers; i++) {
            var l = c.layer(i), ty = layerType(l);
            if (!activeAt(l, t) || ty === "camera" || ty === "light" || ty === "null" || ty === "adjustment" || l.guideLayer) continue;
            if (ign && ign.test(l.name)) continue;
            try { if (l.isTrackMatte) continue; } catch (e) {}
            var b = compBounds(l, t);
            if (!b || !b.width || !b.height) continue;
            var cover = (Math.min(b.right, c.width) - Math.max(b.left, 0)) * (Math.min(b.bottom, c.height) - Math.max(b.top, 0)) / (c.width * c.height);
            if (ty !== "text" && cover > maxCover) continue;
            boxes.push({ l: l, b: b, text: ty === "text" });
        }
        for (i = 0; i < boxes.length; i++) {
            if (!boxes[i].text) continue;
            var A = boxes[i].b;
            for (j = 0; j < boxes.length; j++) {
                if (i === j) continue;
                var B = boxes[j].b;
                var w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
                if (w <= 0 || h <= 0) continue;
                out.push({ time: rnd(t), text: lref(boxes[i].l), other: lref(boxes[j].l), otherType: layerType(boxes[j].l), overlapOfText: rnd(w * h / (A.width * A.height)) });
            }
        }
    }
    return { count: out.length, overlaps: out, note: "Bounding boxes, not pixels." };
});

def("getLog", {}, "Last panel log lines. args: [lines=100]", function (a) {
    var n = num(a.lines, 100);
    return RB.logLines.slice(Math.max(0, RB.logLines.length - n));
});

def("getNotes", {}, "Notes and selection the user sent from the panel. args: [clear] empty the notes file afterwards", function (a) {
    var r = { notes: [], selection: null };
    try { r.notes = jsonParse(readText(RB.root + "/notes.json")); } catch (e) {}
    try { r.selection = jsonParse(readText(RB.root + "/selection.json")); } catch (e) {}
    if (a.clear) writeText(RB.root + "/notes.json", "[]");
    return r;
});

def("listRQ", {}, "Render queue items. args: [templates] include available template names", function (a) {
    var rq = app.project.renderQueue, r = [];
    for (var i = 1; i <= rq.numItems; i++) {
        var q = rq.item(i), o = { index: i, comp: q.comp.name, status: enumName("RQItemStatus", q.status), render: q.render };
        try { o.start = rnd(q.timeSpanStart); o.duration = rnd(q.timeSpanDuration); } catch (e) {}
        try { o.outputs = []; for (var m = 1; m <= q.numOutputModules; m++) o.outputs.push(q.outputModule(m).file ? q.outputModule(m).file.fsName : null); } catch (e) {}
        if (a.templates) { try { o.renderTemplates = q.templates; o.outputTemplates = q.outputModule(1).templates; } catch (e) {} }
        r.push(o);
    }
    return { numItems: rq.numItems, rendering: rq.rendering, items: r };
});

def("listGuides", {}, "Comp guides. args: comp", function (a) {
    var c = getComp(a.comp), r = [];
    try {
        var g = c.guides;
        for (var i = 0; i < g.length; i++) r.push({ index: i, orientation: g[i].orientationType === 0 ? "horizontal" : "vertical", position: g[i].position });
    } catch (e) { fail("Guides API not available: " + errStr(e)); }
    return r;
});
// ================================================================ LAYERS
// Common optional args for all add* commands: name, index ("top"|"bottom"|n|{above}|{below}), parent, keepTransform,
// startTime, inPoint, outPoint, anchor, position, scale, rotation, opacity, props {path:value}, expressions {path:expr},
// threeD, blend, label, comment, enabled, shy, locked

function created(comp, l) { var r = lref(l); r.type = layerType(l); r.comp = comp.name; return r; }

def("addSolid", { w: 1 }, "Add solid. args: comp, [color='#000000'], [width], [height], [duration], [adjustment] + common", function (a) {
    var c = getComp(a.comp), col = colorIn(a.color || "#000000");
    var l = c.layers.addSolid(col.slice(0, 3), a.name || "Solid", num(a.width, c.width), num(a.height, c.height), c.pixelAspect, num(a.duration, c.duration));
    if (a.adjustment) l.adjustmentLayer = true;
    if (a.duration !== undefined) l.outPoint = l.inPoint + a.duration;
    applyLayerCommon(c, l, a);
    return created(c, l);
});

def("addNull", { w: 1 }, "Add null. args: comp, [duration] + common", function (a) {
    var c = getComp(a.comp), l = c.layers.addNull(num(a.duration, c.duration));
    if (a.duration !== undefined) l.outPoint = l.inPoint + a.duration;
    if (!a.name) a.name = "Null";
    applyLayerCommon(c, l, a);
    return created(c, l);
});

def("addAdjustment", { w: 1 }, "Add adjustment layer. args: comp + common", function (a) {
    var c = getComp(a.comp);
    var l = c.layers.addSolid([1, 1, 1], a.name || "Adjustment Layer", c.width, c.height, c.pixelAspect, c.duration);
    l.adjustmentLayer = true;
    applyLayerCommon(c, l, a);
    return created(c, l);
});

def("addText", { w: 1 }, "Add text. args: comp, text (string or lines[]), [box:[w,h]], [style:{font,fontSize,fillColor,justification,tracking,leading,...}] + common", function (a) {
    var c = getComp(a.comp), txt = isArr(a.text) ? a.text.join("\r") : String(a.text === undefined ? "Text" : a.text);
    var l = a.box ? c.layers.addBoxText(a.box, txt) : c.layers.addText(txt);
    if (a.style) {
        var p = l.property("ADBE Text Properties").property("ADBE Text Document"), d = p.value;
        styleApply(d, a.style);
        p.setValue(d);
    }
    applyLayerCommon(c, l, a);
    return created(c, l);
});

// shape spec: {type:"rect"|"ellipse"|"star"|"polygon"|"path", name, size, center, roundness, points, outerRadius, innerRadius,
//   vertices, inTangents, outTangents, closed, fill:"#hex"|{color,opacity}, stroke:{color,width,opacity,cap,join},
//   trim:{start,end,offset}, groupPosition, groupAnchor, groupScale, groupRotation, groupOpacity}
function buildShapeGroup(layer, rootPath, s) {
    function root() { return resolveProp(layer, rootPath); }
    var g = root().addProperty("ADBE Vector Group");
    var gi = g.propertyIndex;
    function grp() { return root().property(gi); }
    function vc() { return grp().property("ADBE Vectors Group"); }
    if (s.name) grp().name = s.name;
    var t = String(s.type || "rect").toLowerCase(), it;
    if (t === "rect") {
        it = vc().addProperty("ADBE Vector Shape - Rect");
        it.property("ADBE Vector Rect Size").setValue(s.size || [100, 100]);
        if (s.center) it.property("ADBE Vector Rect Position").setValue(s.center);
        if (s.roundness) it.property("ADBE Vector Rect Roundness").setValue(s.roundness);
    } else if (t === "ellipse") {
        it = vc().addProperty("ADBE Vector Shape - Ellipse");
        it.property("ADBE Vector Ellipse Size").setValue(s.size || [100, 100]);
        if (s.center) it.property("ADBE Vector Ellipse Position").setValue(s.center);
    } else if (t === "star" || t === "polygon") {
        it = vc().addProperty("ADBE Vector Shape - Star");
        it.property("ADBE Vector Star Type").setValue(t === "star" ? 1 : 2);
        it.property("ADBE Vector Star Points").setValue(num(s.points, 5));
        if (s.center) it.property("ADBE Vector Star Position").setValue(s.center);
        it.property("ADBE Vector Star Outer Radius").setValue(num(s.outerRadius, 50));
        if (t === "star") it.property("ADBE Vector Star Inner Radius").setValue(num(s.innerRadius, 25));
        if (s.rotation !== undefined) it.property("ADBE Vector Star Rotation").setValue(s.rotation);
    } else if (t === "path") {
        it = vc().addProperty("ADBE Vector Shape - Group");
        it.property("ADBE Vector Shape").setValue(shapeIn(s));
    } else fail("Unknown shape type: " + s.type);
    if (s.fill !== undefined && s.fill !== false && s.fill !== null) {
        var fo = (typeof s.fill === "object" && !isArr(s.fill)) ? s.fill : { color: s.fill };
        var f = vc().addProperty("ADBE Vector Graphic - Fill");
        if (fo.color !== undefined) f.property("ADBE Vector Fill Color").setValue(colorIn(fo.color));
        if (fo.opacity !== undefined) vc().property(vc().numProperties).property("ADBE Vector Fill Opacity").setValue(fo.opacity);
    }
    if (s.stroke) {
        var so = (typeof s.stroke === "object" && !isArr(s.stroke)) ? s.stroke : { color: s.stroke };
        vc().addProperty("ADBE Vector Graphic - Stroke");
        var st = function () { return vc().property(vc().numProperties); };
        if (so.color !== undefined) st().property("ADBE Vector Stroke Color").setValue(colorIn(so.color));
        if (so.width !== undefined) st().property("ADBE Vector Stroke Width").setValue(so.width);
        if (so.opacity !== undefined) st().property("ADBE Vector Stroke Opacity").setValue(so.opacity);
        var caps = { butt: 1, round: 2, projecting: 3, square: 3 }, joins = { miter: 1, round: 2, bevel: 3 };
        if (so.cap) st().property("ADBE Vector Stroke Line Cap").setValue(caps[so.cap] || so.cap);
        if (so.join) st().property("ADBE Vector Stroke Line Join").setValue(joins[so.join] || so.join);
    }
    if (s.trim) {
        vc().addProperty("ADBE Vector Filter - Trim");
        var tr = function () { return vc().property(vc().numProperties); };
        if (s.trim.start !== undefined) tr().property("ADBE Vector Trim Start").setValue(s.trim.start);
        if (s.trim.end !== undefined) tr().property("ADBE Vector Trim End").setValue(s.trim.end);
        if (s.trim.offset !== undefined) tr().property("ADBE Vector Trim Offset").setValue(s.trim.offset);
    }
    var gt = function () { return grp().property("ADBE Vector Transform Group"); };
    if (s.groupPosition) gt().property("ADBE Vector Position").setValue(s.groupPosition);
    if (s.groupAnchor) gt().property("ADBE Vector Anchor").setValue(s.groupAnchor);
    if (s.groupScale) gt().property("ADBE Vector Scale").setValue(s.groupScale);
    if (s.groupRotation !== undefined) gt().property("ADBE Vector Rotation").setValue(s.groupRotation);
    if (s.groupOpacity !== undefined) gt().property("ADBE Vector Group Opacity").setValue(s.groupOpacity);
    return pref(grp());
}

def("addShape", { w: 1 }, "Add shape layer. args: comp, shapes:[spec...] (see buildShapeGroup: type rect|ellipse|star|polygon|path, size, center, vertices, fill, stroke, trim...), [absolute] layer at [0,0] with anchor [0,0] so path coords are comp coords + common", function (a) {
    var c = getComp(a.comp), l = c.layers.addShape();
    if (a.absolute) {
        l.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        l.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
    }
    var groups = [], shapes = a.shapes || (a.shape ? [a.shape] : []);
    for (var i = 0; i < shapes.length; i++) groups.push(buildShapeGroup(l, "ADBE Root Vectors Group", shapes[i]));
    if (!a.name) a.name = "Shape Layer";
    applyLayerCommon(c, l, a);
    var r = created(c, l); r.groups = groups;
    return r;
});

def("addCamera", { w: 1 }, "Add camera. args: comp, [name], [pointOfInterest:[x,y]], [options:{zoom,depthOfField,focusDistance,aperture,blurLevel}] + common", function (a) {
    var c = getComp(a.comp), l = c.layers.addCamera(a.name || "Camera", a.pointOfInterest || [c.width / 2, c.height / 2]);
    if (a.options) setGroupValues(l, "ADBE Camera Options Group", a.options, CAMERA_KEYS);
    applyLayerCommon(c, l, a);
    return created(c, l);
});

def("addLight", { w: 1 }, "Add light. args: comp, [name], [lightType] parallel|spot|point|ambient, [center:[x,y]], [options:{intensity,color,coneAngle,coneFeather,castsShadows,shadowDarkness,shadowDiffusion}] + common", function (a) {
    var c = getComp(a.comp), l = c.layers.addLight(a.name || "Light", a.center || [c.width / 2, c.height / 2]);
    if (a.lightType) l.lightType = enumVal("LightType", a.lightType);
    if (a.options) setGroupValues(l, "ADBE Light Options Group", a.options, LIGHT_KEYS);
    applyLayerCommon(c, l, a);
    return created(c, l);
});

def("addFromItem", { w: 1 }, "Add project item (footage/comp/solid) as a layer. args: comp, item, [duration] + common", function (a) {
    var c = getComp(a.comp), it = getItem(a.item);
    if (it instanceof FolderItem) fail("Cannot add a folder as a layer");
    if (it === c) fail("Cannot add a comp into itself");
    var l = a.duration !== undefined ? c.layers.add(it, a.duration) : c.layers.add(it);
    applyLayerCommon(c, l, a);
    return created(c, l);
});

def("duplicateLayer", { w: 1 }, "Duplicate layer(s). args: comp, layer|layers, [count=1] + common (applied to each copy)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [], n = num(a.count, 1);
    for (var i = 0; i < ls.length; i++) {
        for (var k = 0; k < n; k++) {
            var d = ls[i].duplicate();
            var aa = {};
            for (var key in a) if (has(a, key) && key !== "layer" && key !== "layers" && key !== "comp" && key !== "count") aa[key] = a[key];
            applyLayerCommon(c, d, aa);
            r.push(created(c, d));
        }
    }
    return r;
});

def("deleteLayer", { w: 1 }, "Delete layer(s) (undoable). args: comp, layer|layers|match|selected", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = ls.length - 1; i >= 0; i--) {
        r.push(lref(ls[i]));
        ls[i].locked = false;
        ls[i].remove();
    }
    return { deleted: r };
});

def("renameLayer", { w: 1 }, "Rename. args: comp, layer, name  OR  layers + find/replace (regex)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        var old = ls[i].name;
        ls[i].name = a.find !== undefined ? old.replace(toRegex(a.find, "g"), a.replace || "") : a.name;
        r.push({ from: old, to: ls[i].name });
    }
    return r;
});

def("moveLayer", { w: 1 }, "Change stacking order. args: comp, layer|layers, to: 'top'|'bottom'|index|{above:layer}|{below:layer}", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    if (a.to === undefined) fail("to is required");
    var list = ls.slice(0);
    if (a.to === "bottom" || (typeof a.to === "object" && a.to.below !== undefined)) list.reverse();
    for (var i = 0; i < list.length; i++) moveLayerTo(c, list[i], a.to);
    for (var j = 0; j < ls.length; j++) r.push(lref(ls[j]));
    return r;
});

def("copyLayerToComp", { w: 1 }, "Copy layer(s) to another comp (goes on top there). args: comp, layer|layers, toComp + common", function (a) {
    var c = getComp(a.comp), dest = getComp(a.toComp), ls = getLayers(c, a), r = [];
    if (dest === c) fail("Use duplicateLayer inside the same comp");
    for (var i = ls.length - 1; i >= 0; i--) {
        var before = {}, j;
        for (j = 1; j <= dest.numLayers; j++) before[dest.layer(j).id] = 1;
        ls[i].copyToComp(dest);
        // the copy's position in the stack is not guaranteed: find it by a new layer id, never by index
        var nl = null;
        for (j = 1; j <= dest.numLayers; j++) if (!before[dest.layer(j).id]) { nl = dest.layer(j); break; }
        if (!nl) fail("Copy of '" + ls[i].name + "' is not visible yet in '" + dest.name + "'. Nothing else was changed; modify the copy with a separate command by name.");
        if (nl.name !== ls[i].name) fail("Found new layer '" + nl.name + "' but expected a copy of '" + ls[i].name + "'. Stopped without changes.");
        var aa = {};
        for (var key in a) if (has(a, key) && idxOf(["comp", "layer", "layers", "toComp", "match", "selected"], key) < 0) aa[key] = a[key];
        applyLayerCommon(dest, nl, aa);
        r.push(created(dest, nl));
    }
    return r;
});

def("setTiming", { w: 1 }, "Timing. args: comp, layer(s), [startTime], [inPoint], [outPoint], [duration] (out = in + duration), [shift] delta for startTime, [stretch]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        withUnlocked(ls[i], function (l) {
            if (a.stretch !== undefined) l.stretch = a.stretch;
            if (a.shift !== undefined) l.startTime += a.shift;
            if (a.startTime !== undefined) l.startTime = a.startTime;
            if (a.inPoint !== undefined) l.inPoint = a.inPoint;
            if (a.outPoint !== undefined) l.outPoint = a.outPoint;
            if (a.duration !== undefined) l.outPoint = l.inPoint + a.duration;
        });
        r.push({ layer: lref(ls[i]), inPoint: rnd(ls[i].inPoint), outPoint: rnd(ls[i].outPoint), startTime: rnd(ls[i].startTime) });
    }
    return r;
});

def("shiftLayers", { w: 1 }, "Move layers in time together with their keys. args: comp, delta, and layer(s)|match|selected|after (all layers with inPoint >= after), [markers] also shift comp markers >= after, [extendComp]", function (a) {
    var c = getComp(a.comp), d = Number(a.delta), ls = [], i;
    if (isNaN(d)) fail("delta is required");
    if (a.after !== undefined) { for (i = 1; i <= c.numLayers; i++) if (c.layer(i).inPoint >= a.after - 1e-4) ls.push(c.layer(i)); }
    else ls = getLayers(c, a);
    for (i = 0; i < ls.length; i++) withUnlocked(ls[i], function (l) { l.startTime += d; });
    var mk = 0;
    if (a.markers && a.after !== undefined) mk = remapKeys(c.markerProperty, function (t) { return t >= a.after - 1e-4 ? t + d : null; });
    if (a.extendComp) {
        var end = 0;
        for (i = 1; i <= c.numLayers; i++) end = Math.max(end, c.layer(i).outPoint);
        if (end > c.duration) c.duration = end;
    }
    var r = [];
    for (i = 0; i < ls.length; i++) r.push(lref(ls[i]));
    return { shifted: r, markersMoved: mk, compDuration: rnd(c.duration) };
});

function findMarkerTime(prop, ref, useEnd) {
    for (var k = 1; k <= prop.numKeys; k++) {
        var mv = prop.keyValue(k);
        if ((typeof ref === "number" && k === ref) || (typeof ref === "string" && (mv.comment === ref || toRegex(ref).test(mv.comment))))
            return prop.keyTime(k) + (useEnd ? mv.duration : 0);
    }
    fail("Marker not found: " + ref);
}
def("trimToMarker", { w: 1 }, "Trim in/out to markers. args: comp, layer(s), [inMarker], [outMarker] (index or comment/regex), [layerMarkers] use the layer's own markers, [useEnd] use marker end (duration)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i], mp = a.layerMarkers ? l.property("ADBE Marker") : c.markerProperty;
        withUnlocked(l, function () {
            if (a.inMarker !== undefined) l.inPoint = findMarkerTime(mp, a.inMarker, false);
            if (a.outMarker !== undefined) l.outPoint = findMarkerTime(mp, a.outMarker, !!a.useEnd);
        });
        r.push({ layer: lref(l), inPoint: rnd(l.inPoint), outPoint: rnd(l.outPoint) });
    }
    return r;
});

def("setSwitches", { w: 1 }, "Layer switches. args: comp, layer(s), any of: enabled, solo, locked, shy, threeD, motionBlur, collapse, adjustment, guide, effectsActive, audioEnabled, preserveTransparency, quality(best|draft|wireframe), samplingQuality(bicubic|bilinear), blend, label(0-16), frameBlending(frame_mix|pixel_motion|none), autoOrient(none|along_path|camera_or_point_of_interest)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    var map = { enabled: "enabled", solo: "solo", shy: "shy", threeD: "threeDLayer", motionBlur: "motionBlur", collapse: "collapseTransformation",
        adjustment: "adjustmentLayer", guide: "guideLayer", effectsActive: "effectsActive", audioEnabled: "audioEnabled", preserveTransparency: "preserveTransparency" };
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i];
        withUnlocked(l, function () {
            for (var k in map) if (has(map, k) && a[k] !== undefined) { try { l[map[k]] = !!a[k]; } catch (e) { warn(l.name + ": " + k + " " + errStr(e)); } }
            if (a.quality !== undefined) l.quality = enumVal("LayerQuality", a.quality);
            if (a.samplingQuality !== undefined) l.samplingQuality = enumVal("LayerSamplingQuality", a.samplingQuality);
            if (a.blend !== undefined) l.blendingMode = enumVal("BlendingMode", a.blend);
            if (a.label !== undefined) l.label = a.label;
            if (a.frameBlending !== undefined) l.frameBlendingType = enumVal("FrameBlendingType", a.frameBlending);
            if (a.autoOrient !== undefined) l.autoOrient = enumVal("AutoOrientType", a.autoOrient);
        });
        if (a.locked !== undefined) l.locked = !!a.locked;
        r.push(lref(l));
    }
    return r;
});

def("setParent", { w: 1 }, "Parent layers. args: comp, layer(s), parent (layer ref or null), [keepTransform=true] (false = jump, no compensation)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        setParentRef(c, ls[i], a.parent === undefined ? null : a.parent, a.keepTransform);
        r.push({ layer: lref(ls[i]), parent: ls[i].parent ? lref(ls[i].parent) : null });
    }
    return r;
});

def("setTrackMatte", { w: 1 }, "Track matte. args: comp, layer(s), matte (layer ref) or null to remove, [type=alpha] alpha|alpha_inverted|luma|luma_inverted", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i];
        if (a.matte === null || a.type === "none") {
            try { l.removeTrackMatte(); } catch (e) {}
            try { if (l.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) l.trackMatteType = TrackMatteType.NO_TRACK_MATTE; } catch (e) {}
            if (l.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) fail("Could not remove track matte from " + l.name);
        } else {
            var m = getLayer(c, a.matte), ty = enumVal("TrackMatteType", a.type || "alpha");
            try { l.setTrackMatte(m, ty); }
            catch (e) {
                if (m.index !== l.index - 1) fail("This AE version needs the matte directly above the layer: " + errStr(e));
                l.trackMatteType = ty;
            }
        }
        r.push(lref(l));
    }
    return r;
});

def("setComment", { w: 1 }, "Comment on layer(s) or project item. args: comp + layer(s) | item, comment, [append]", function (a) {
    var targets = [];
    if (a.item !== undefined) targets.push(getItem(a.item));
    else { var c = getComp(a.comp); targets = getLayers(c, a); }
    for (var i = 0; i < targets.length; i++) targets[i].comment = a.append && targets[i].comment ? targets[i].comment + " " + a.comment : String(a.comment);
    return { count: targets.length };
});

def("precompose", { w: 1 }, "Precompose layers. args: comp, layer(s), name, [moveAllAttributes=true], [folder]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), ix = [];
    for (var i = 0; i < ls.length; i++) ix.push(ls[i].index);
    ix.sort(function (x, y) { return x - y; });
    var nc = c.layers.precompose(ix, a.name || "Pre-comp", a.moveAllAttributes !== false);
    if (a.folder !== undefined) nc.parentFolder = getFolder(a.folder, true);
    var nl = null;
    for (var j = 1; j <= c.numLayers; j++) if (c.layer(j).source === nc) { nl = c.layer(j); break; }
    return { comp: iref(nc), layer: nl ? lref(nl) : null };
});

def("sequenceLayers", { w: 1 }, "Place layers one after another. args: comp, layer(s) (in given order), [start] time of first, [overlap=0] seconds (negative = gap), [reverse]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), t = num(a.start, ls[0].inPoint), ov = num(a.overlap, 0), r = [];
    if (a.reverse) ls.reverse();
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i];
        withUnlocked(l, function () { l.startTime += t - l.inPoint; });
        r.push({ layer: lref(l), inPoint: rnd(l.inPoint), outPoint: rnd(l.outPoint) });
        t = l.outPoint - ov;
    }
    return r;
});

def("replaceSource", { w: 1 }, "Replace layer source. args: comp, layer(s), item, [fixExpressions=true]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), it = getItem(a.item);
    for (var i = 0; i < ls.length; i++) ls[i].replaceSource(it, a.fixExpressions !== false);
    return { count: ls.length, source: iref(it) };
});

def("replaceItemUsage", { w: 1 }, "Everywhere in the project, replace layers using item 'from' with item 'to' (e.g. logo placeholder -> real logo). args: from, to, [fixExpressions=true], [dryRun]", function (a) {
    var from = getItem(a.from), to = getItem(a.to), r = [];
    var u = from.usedIn;
    for (var i = 0; i < u.length; i++) {
        for (var j = 1; j <= u[i].numLayers; j++) {
            var l = u[i].layer(j);
            try {
                if (l.source !== from) continue;
                r.push({ comp: u[i].name, layer: lref(l) });
                if (!a.dryRun) withUnlocked(l, function () { l.replaceSource(to, a.fixExpressions !== false); });
            } catch (e) {}
        }
    }
    return { dryRun: !!a.dryRun, count: r.length, layers: r };
});

def("selectLayers", {}, "Select layers in a comp (UI only). args: comp, layer(s)|match|all, [add] keep current selection, [open] open comp in viewer", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a, true);
    if (!a.add) for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
    for (var j = 0; j < ls.length; j++) ls[j].selected = true;
    if (a.open) c.openInViewer();
    return { selected: ls.length };
});
// ================================================================ PROPERTIES / KEYFRAMES / EXPRESSIONS

var CAMERA_KEYS = { zoom: "ADBE Camera Zoom", depthOfField: "ADBE Camera Depth of Field", focusDistance: "ADBE Camera Focus Distance",
    aperture: "ADBE Camera Aperture", blurLevel: "ADBE Camera Blur Level" };
var LIGHT_KEYS = { intensity: "ADBE Light Intensity", color: "ADBE Light Color", coneAngle: "ADBE Light Cone Angle",
    coneFeather: "ADBE Light Cone Feather 2", castsShadows: "ADBE Light Casts Shadows", shadowDarkness: "ADBE Light Shadow Darkness",
    shadowDiffusion: "ADBE Light Shadow Diffusion", falloff: "ADBE Light Falloff Type", radius: "ADBE Light Falloff Start", falloffDistance: "ADBE Light Falloff Distance" };
var MATERIAL_KEYS = { castsShadows: "ADBE Casts Shadows", lightTransmission: "ADBE Light Transmission", acceptsShadows: "ADBE Accepts Shadows",
    acceptsLights: "ADBE Accepts Lights", ambient: "ADBE Ambient Coefficient", diffuse: "ADBE Diffuse Coefficient",
    specular: "ADBE Specular Coefficient", shininess: "ADBE Shininess Coefficient", metal: "ADBE Metal Coefficient" };

function setGroupValues(layer, groupPath, values, keyMap) {
    var done = [];
    for (var k in values) {
        if (!has(values, k)) continue;
        var seg = (keyMap && keyMap[k]) ? keyMap[k] : k, p = null;
        try { p = resolveProp(layer, splitPath(groupPath).concat([seg])); }
        catch (e) {
            var human = k.replace(/([A-Z])/g, " $1");
            human = human.charAt(0).toUpperCase() + human.substr(1);
            p = resolveProp(layer, splitPath(groupPath).concat([human]));
        }
        setPropValue(p, values[k]);
        done.push(propPath(p));
    }
    return done;
}

def("setProperty", { w: 1 }, "Set a value (or a key if time given). args: comp, layer(s)|match|selected, path, value, [time]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        var p = resolveProp(ls[i], a.path);
        withUnlocked(ls[i], function () { setPropValue(p, a.value, a.time); });
        r.push({ layer: lref(ls[i]), path: propPath(p), value: valOut(p, a.time !== undefined ? p.valueAtTime(a.time, true) : p.value) });
    }
    return r;
});

def("setProperties", { w: 1 }, "Many values at once. args: comp, items:[{layer, path, value, [time]}]  OR  layer(s) + values:{path:value}, [time]", function (a) {
    var c = getComp(a.comp), r = [], i;
    if (a.items) {
        for (i = 0; i < a.items.length; i++) {
            var it = a.items[i], l = getLayer(c, it.layer), p = resolveProp(l, it.path);
            withUnlocked(l, function () { setPropValue(p, it.value, it.time !== undefined ? it.time : a.time); });
            r.push({ layer: l.name, path: propPath(p) });
        }
        return { count: r.length, set: r };
    }
    var ls = getLayers(c, a);
    for (i = 0; i < ls.length; i++) {
        for (var k in a.values) {
            if (!has(a.values, k)) continue;
            var pp = resolveProp(ls[i], k);
            withUnlocked(ls[i], function () { setPropValue(pp, a.values[k], a.time); });
            r.push({ layer: ls[i].name, path: propPath(pp) });
        }
    }
    return { count: r.length, set: r };
});

def("addKeyframes", { w: 1 }, "Add keys. args: comp, layer(s), path, keys:[{t, v, interp, ease:'easy'|'easyIn'|'easyOut'|influence|[speed,influence], easeIn, easeOut, spatial:'linear'|'auto'|'continuous', roving}], [relativeTo] 'in'|'out' (t relative to layer in/out point), [clear] remove existing keys first", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    if (!a.keys || !a.keys.length) fail("keys are required");
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i], p = resolveProp(l, a.path);
        if (!p.canVaryOverTime) fail("Property cannot be keyframed: " + propPath(p));
        withUnlocked(l, function () {
            if (a.clear) for (var q = p.numKeys; q >= 1; q--) p.removeKey(q);
            for (var j = 0; j < a.keys.length; j++) {
                var ks = a.keys[j], t = parseTime(ks.t, c.frameRate);
                if (a.relativeTo === "in") t += l.inPoint;
                else if (a.relativeTo === "out") t += l.outPoint;
                if (ks.v !== undefined) p.setValueAtTime(t, valIn(p, ks.v, t));
                else p.addKey(t);
                applyKeySpec(p, p.nearestKeyIndex(t), ks);
            }
        });
        r.push({ layer: lref(l), path: propPath(p), numKeys: p.numKeys });
    }
    return r;
});

function keySelector(p, a, c) {
    var ids = [], k, tol = c.frameDuration / 2;
    for (k = 1; k <= p.numKeys; k++) {
        var t = p.keyTime(k), ok = false;
        if (a.all || (!a.times && !a.range && !a.indexes && !a.selectedKeys)) ok = true;
        if (a.times) for (var i = 0; i < a.times.length; i++) if (Math.abs(t - parseTime(a.times[i], c.frameRate)) <= tol) ok = true;
        if (a.range && t >= a.range[0] - tol && t <= a.range[1] + tol) ok = true;
        if (a.indexes && idxOf(a.indexes, k) >= 0) ok = true;
        if (a.selectedKeys) try { if (p.keySelected(k)) ok = true; } catch (e) {}
        if (ok) ids.push(k);
    }
    return ids;
}
function keyedProps(l, a) {
    if (a.path !== undefined) return [resolveProp(l, a.path)];
    if (a.paths) { var r = []; for (var i = 0; i < a.paths.length; i++) r.push(resolveProp(l, a.paths[i])); return r; }
    var all = [];
    walkProps(l, function (p) { try { if (p.numKeys > 0) all.push(p); } catch (e) {} });
    return all;
}

def("removeKeyframes", { w: 1 }, "Remove keys. args: comp, layer(s), [path|paths] (default: all keyed props), and [times]|[range:[t0,t1]]|[indexes]|[selectedKeys]|[all] (default all)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), n = 0;
    for (var i = 0; i < ls.length; i++) {
        var ps = keyedProps(ls[i], a);
        withUnlocked(ls[i], function () {
            for (var j = 0; j < ps.length; j++) {
                var ids = keySelector(ps[j], a, c);
                for (var k = ids.length - 1; k >= 0; k--) { ps[j].removeKey(ids[k]); n++; }
            }
        });
    }
    return { removed: n };
});

def("moveKeyframes", { w: 1 }, "Move keys in time. args: comp, layer(s), [path|paths] (default all keyed props), delta seconds, and optional key filter [range]|[times]|[indexes]|[selectedKeys]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), n = 0, d = Number(a.delta);
    if (isNaN(d)) fail("delta is required");
    for (var i = 0; i < ls.length; i++) {
        var ps = keyedProps(ls[i], a);
        withUnlocked(ls[i], function () {
            for (var j = 0; j < ps.length; j++) {
                var ids = keySelector(ps[j], a, c);
                n += remapKeys(ps[j], function (t, k) { return idxOf(ids, k) >= 0 ? t + d : null; });
            }
        });
    }
    return { moved: n };
});

def("setKeyInterpolation", { w: 1 }, "Interpolation / easing on existing keys. args: comp, layer(s), [path|paths], key filter ([times]|[range]|[indexes]|[selectedKeys]|all), interp, ease, easeIn, easeOut, spatial, roving", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), n = 0;
    for (var i = 0; i < ls.length; i++) {
        var ps = keyedProps(ls[i], a);
        withUnlocked(ls[i], function () {
            for (var j = 0; j < ps.length; j++) {
                var ids = keySelector(ps[j], a, c);
                for (var k = 0; k < ids.length; k++) { applyKeySpec(ps[j], ids[k], a); n++; }
            }
        });
    }
    return { keys: n };
});

def("setExpression", { w: 1 }, "Set expression. args: comp, layer(s)|match, path, expression, [enabled=true]. Returns expression errors.", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    if (a.expression === undefined) fail("expression is required");
    for (var i = 0; i < ls.length; i++) {
        var p = resolveProp(ls[i], a.path), err;
        withUnlocked(ls[i], function () { err = setExpr(p, a.expression, a.enabled); });
        var o = { layer: lref(ls[i]), path: propPath(p) };
        if (err) o.error = err;
        r.push(o);
    }
    return r;
});

def("removeExpression", { w: 1 }, "Remove expression(s). args: comp, layer(s), [path] (default: all expressions on the layer)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), n = 0;
    for (var i = 0; i < ls.length; i++) {
        withUnlocked(ls[i], function (l) {
            if (a.path !== undefined) { resolveProp(l, a.path).expression = ""; n++; return; }
            walkProps(l, function (p) { try { if (p.canSetExpression && p.expression !== "") { p.expression = ""; n++; } } catch (e) {} });
        });
    }
    return { removed: n };
});

def("enableExpressions", { w: 1 }, "Enable/disable existing expressions without deleting. args: comp, layer(s), [path], enabled", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), n = 0;
    for (var i = 0; i < ls.length; i++) {
        withUnlocked(ls[i], function (l) {
            var fn = function (p) { try { if (p.canSetExpression && p.expression !== "") { p.expressionEnabled = !!a.enabled; n++; } } catch (e) {} };
            if (a.path !== undefined) fn(resolveProp(l, a.path)); else walkProps(l, fn);
        });
    }
    return { changed: n };
});

def("replaceInExpressions", { w: 1 }, "Find/replace inside expressions. args: find, replace, [regex], [matchCase], [comps|compMatch|comp] (default all), [layerMatch], [dryRun]", function (a) {
    if (a.find === undefined) fail("find is required");
    var comps = getComps(a, true), r = [], lre = a.layerMatch ? toRegex(a.layerMatch) : null;
    var re = a.regex ? new RegExp(a.find, a.matchCase ? "g" : "gi") : null;
    for (var ci = 0; ci < comps.length; ci++) {
        var c = comps[ci];
        for (var i = 1; i <= c.numLayers; i++) {
            var l = c.layer(i);
            if (lre && !lre.test(l.name)) continue;
            walkProps(l, function (p) {
                try {
                    if (!p.canSetExpression || p.expression === "") return;
                    var e = p.expression, ne;
                    if (re) ne = e.replace(re, a.replace);
                    else ne = e.split(a.find).join(a.replace);
                    if (ne === e) return;
                    var o = { comp: c.name, layer: l.name, path: propPath(p) };
                    if (!a.dryRun) withUnlocked(l, function () { p.expression = ne; var err = exprEval(p); if (err) o.error = err; });
                    r.push(o);
                } catch (e2) {}
            });
        }
    }
    return { dryRun: !!a.dryRun, count: r.length, changed: r };
});

def("bakeExpression", { w: 1 }, "Convert expression to keys. args: comp, layer, path, [range:[t0,t1]] (default layer in/out), [step=1] frames, [keepExpression] (disabled, not deleted, default true)", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), p = resolveProp(l, a.path);
    if (!p.canVaryOverTime || p.expression === "") fail("Nothing to bake on " + propPath(p));
    var t0 = a.range ? a.range[0] : Math.max(0, l.inPoint), t1 = a.range ? a.range[1] : Math.min(c.duration, l.outPoint);
    var step = c.frameDuration * num(a.step, 1), times = [], vals = [];
    for (var t = t0; t <= t1 + 1e-6; t += step) { times.push(t); vals.push(p.valueAtTime(t, false)); }
    withUnlocked(l, function () {
        if (a.keepExpression === false) p.expression = ""; else p.expressionEnabled = false;
        for (var k = p.numKeys; k >= 1; k--) p.removeKey(k);
        p.setValuesAtTimes(times, vals);
    });
    return { path: propPath(p), keys: times.length };
});

def("addProperty", { w: 1 }, "Generic: add a property/group into an indexed group (effect, mask, shape item, text animator, selector, layer style...). args: comp, layer(s), parent path (e.g. 'effects', 'contents', 'contents/Group 1/Contents'), matchName, [name], [values:{childPath:value}], [expressions:{childPath:expr}], [index]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i];
        withUnlocked(l, function () {
            var par = resolveProp(l, a.parent);
            if (par.propertyType === undefined || par.propertyType !== PropertyType.INDEXED_GROUP) {
                var inner = null;
                try { inner = par.property("ADBE Vectors Group"); } catch (e) {}
                if (inner) par = inner;
            }
            if (!par.canAddProperty(a.matchName)) fail("Cannot add '" + a.matchName + "' to " + propPath(par));
            var np = par.addProperty(a.matchName), mp = propMPath(np);
            if (a.name) np.name = a.name;
            if (a.index !== undefined) { np.moveTo(a.index); mp = propMPath(resolveProp(l, propMPath(par) + "/#" + a.index)); }
            var k;
            if (a.values) for (k in a.values) if (has(a.values, k)) setPropValue(resolveProp(l, mp + "/" + k), a.values[k]);
            if (a.expressions) for (k in a.expressions) if (has(a.expressions, k)) setExpr(resolveProp(l, mp + "/" + k), a.expressions[k]);
            var fin = resolveProp(l, mp);
            r.push({ layer: lref(l), path: propPath(fin), mpath: mp, children: childNames(fin) });
        });
    }
    return r;
});

def("removeProperty", { w: 1 }, "Remove an added property (effect, mask, shape group, animator...). args: comp, layer(s), path", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        var p = resolveProp(ls[i], a.path), nm = propPath(p);
        withUnlocked(ls[i], function () { p.remove(); });
        r.push({ layer: lref(ls[i]), removed: nm });
    }
    return r;
});

def("reorderProperty", { w: 1 }, "Move a property inside its indexed group. args: comp, layer, path, index", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), p = resolveProp(l, a.path);
    withUnlocked(l, function () { p.moveTo(a.index); });
    return { ok: true };
});

def("renameProperty", { w: 1 }, "Rename an effect/mask/shape group/animator. args: comp, layer, path, name", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), p = resolveProp(l, a.path);
    withUnlocked(l, function () { p.name = a.name; });
    return pref(p);
});

def("setEnabled", { w: 1 }, "Enable/disable an effect, mask, shape group, animator, layer style (eye icon). args: comp, layer(s), path, enabled", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        var p = resolveProp(ls[i], a.path);
        if (!p.canSetEnabled) fail("Cannot toggle " + propPath(p));
        withUnlocked(ls[i], function () { p.enabled = !!a.enabled; });
        r.push({ layer: lref(ls[i]), path: propPath(p), enabled: p.enabled });
    }
    return r;
});

def("separateDimensions", { w: 1 }, "Separate / join dimensions (Position). args: comp, layer(s), [path='position'], separated", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a);
    for (var i = 0; i < ls.length; i++) {
        var p = resolveProp(ls[i], a.path || "position");
        withUnlocked(ls[i], function () { p.dimensionsSeparated = !!a.separated; });
    }
    return { count: ls.length };
});

var CONTROL_TYPES = {
    slider: "ADBE Slider Control", angle: "ADBE Angle Control", checkbox: "ADBE Checkbox Control", color: "ADBE Color Control",
    point: "ADBE Point Control", point3d: "ADBE Point3D Control", layer: "ADBE Layer Control", dropdown: "ADBE Dropdown Control"
};
def("addControl", { w: 1 }, "Expression control effect. args: comp, layer, type slider|angle|checkbox|color|point|point3d|layer|dropdown, name, [value], [items] for dropdown", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), mn = CONTROL_TYPES[String(a.type).toLowerCase()];
    if (!mn) fail("Unknown control type " + a.type + ". Allowed: " + keysOf(CONTROL_TYPES).join(", "));
    var r;
    withUnlocked(l, function () {
        var fx = l.property("ADBE Effect Parade"), e = fx.addProperty(mn), ix = e.propertyIndex;
        if (a.name) e.name = a.name;
        if (a.type === "dropdown" && a.items) {
            fx.property(ix).property(1).setPropertyParameters(a.items);
        }
        if (a.value !== undefined) setPropValue(fx.property(ix).property(1), a.value);
        var ef = fx.property(ix);
        r = { layer: lref(l), effect: ef.name, path: propPath(ef.property(1)), expressionRef: exprRef(c, l, ef.property(1)) };
    });
    return r;
});

// Build an expression reference string to property p (as seen from a layer in comp 'fromComp')
function exprRef(fromComp, l, p) {
    var c = l.containingComp;
    var s = (c === fromComp ? "thisComp" : 'comp("' + c.name.replace(/"/g, '\\"') + '")') + '.layer("' + l.name.replace(/"/g, '\\"') + '")';
    var chain = [], cur = p;
    while (cur && cur.propertyDepth > 0) { chain.unshift(cur); cur = cur.parentProperty; }
    for (var i = 0; i < chain.length; i++) {
        var q = chain[i], par = q.parentProperty, key;
        if (par && par.propertyDepth > 0 && par.propertyType === PropertyType.INDEXED_GROUP) key = '"' + q.name.replace(/"/g, '\\"') + '"';
        else key = '"' + q.matchName + '"';
        s += "(" + key + ")";
    }
    return s;
}
def("linkProperty", { w: 1 }, "Link property to another property (usually a control) via expression. args: comp, layer(s), path, source:{comp, layer, path}, [template] e.g. '$ * 2' or 'value + $' ($ = reference)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    if (!a.source) fail("source is required");
    var sc = getComp(a.source.comp !== undefined ? a.source.comp : c), sl = getLayer(sc, a.source.layer), sp = resolveProp(sl, a.source.path);
    var ref = exprRef(c, sl, sp);
    var expr = a.template ? String(a.template).split("$").join(ref) : ref;
    for (var i = 0; i < ls.length; i++) {
        var p = resolveProp(ls[i], a.path), err;
        withUnlocked(ls[i], function () { err = setExpr(p, expr); });
        var o = { layer: lref(ls[i]), path: propPath(p), expression: expr };
        if (err) o.error = err;
        r.push(o);
    }
    return r;
});

def("timeRemap", { w: 1 }, "Time remapping. args: comp, layer(s), [enable=true], [freezeAt] source time to freeze, [keys:[{t,v}]] (t comp time, v source time), [frameBlending]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i];
        withUnlocked(l, function () {
            if (a.enable === false) { l.timeRemapEnabled = false; return; }
            if (!l.canSetTimeRemapEnabled) fail("Time remap not possible on " + l.name);
            l.timeRemapEnabled = true;
            var p = l.property("ADBE Time Remapping"), keep = [], j, k;
            var newKeys = a.keys || (a.freezeAt !== undefined ? [{ t: l.inPoint, v: a.freezeAt, interp: "hold" }] : []);
            if (newKeys.length) {
                // AE does not allow an empty Time Remap: add new keys first, then remove the old ones
                for (j = 0; j < newKeys.length; j++) { p.setValueAtTime(newKeys[j].t, newKeys[j].v); keep.push(newKeys[j].t); }
                for (k = p.numKeys; k >= 1; k--) {
                    var kt = p.keyTime(k), hit = false;
                    for (j = 0; j < keep.length; j++) if (Math.abs(kt - keep[j]) < 1e-4) hit = true;
                    if (!hit) p.removeKey(k);
                }
                for (j = 0; j < newKeys.length; j++) applyKeySpec(p, p.nearestKeyIndex(newKeys[j].t), newKeys[j]);
            }
            if (a.frameBlending !== undefined) l.frameBlendingType = enumVal("FrameBlendingType", a.frameBlending);
        });
        r.push(lref(l));
    }
    return r;
});

def("addToEssentialGraphics", { w: 1 }, "Add properties to Essential Graphics. args: comp (layer's comp), layer, path|paths, [names] same order, [egComp] target comp (default comp), [templateName]", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), eg = a.egComp !== undefined ? getComp(a.egComp) : c;
    var paths = a.paths || [a.path], r = [];
    if (a.templateName) eg.motionGraphicsTemplateName = a.templateName;
    for (var i = 0; i < paths.length; i++) {
        var p = resolveProp(l, paths[i]);
        if (!p.canAddToMotionGraphicsTemplate(eg)) fail("Cannot add to Essential Graphics: " + propPath(p));
        var ok = (a.names && a.names[i]) ? p.addToMotionGraphicsTemplateAs(eg, a.names[i]) : p.addToMotionGraphicsTemplate(eg);
        r.push({ path: propPath(p), added: ok });
    }
    return r;
});

def("exportMogrt", { w: 1, noUndo: 1 }, "Export comp as Motion Graphics template. args: comp, file (.mogrt, inside allowed folders), [overwrite]", function (a) {
    var c = getComp(a.comp), p = safeOut(a.file);
    var ok = c.exportAsMotionGraphicsTemplate(!!a.overwrite, p);
    return { ok: ok, file: p };
});
// ================================================================ EFFECTS / MASKS / TEXT / SHAPES

function effectMatchName(key) {
    var fx = app.effects, k = String(key), lk = k.toLowerCase(), i;
    for (i = 0; i < fx.length; i++) if (fx[i].matchName === k) return k;
    for (i = 0; i < fx.length; i++) if (fx[i].displayName.toLowerCase() === lk) return fx[i].matchName;
    fail("Effect not found: '" + key + "' (use listEffects)");
}
function effectParams(e) {
    var r = [];
    for (var i = 1; i <= e.numProperties; i++) {
        var p = e.property(i), o = { i: i, n: p.name, m: p.matchName };
        try { if (hasValue(p)) o.v = valOut(p, p.value); } catch (x) {}
        r.push(o);
    }
    return r;
}
function getEffect(l, ref) {
    var fx = l.property("ADBE Effect Parade");
    if (typeof ref === "number") { if (ref < 1 || ref > fx.numProperties) fail("Effect index out of range on " + l.name); return fx.property(ref); }
    var e = childByKey(fx, ref);
    if (!e) fail("Effect '" + ref + "' not found on " + l.name + ". Effects: " + childNames(fx));
    return e;
}

def("addEffect", { w: 1 }, "Add effect. args: comp, layer(s)|match, effect (matchName or display name), [name], [values:{param:value}], [expressions:{param:expr}], [index], [listParams=true]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), mn = effectMatchName(a.effect), r = [];
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i];
        withUnlocked(l, function () {
            var fx = l.property("ADBE Effect Parade");
            if (!fx.canAddProperty(mn)) fail("Effect cannot be added to " + l.name + ": " + mn);
            var e = fx.addProperty(mn), ix = e.propertyIndex, k;
            if (a.name) e.name = a.name;
            if (a.index !== undefined) { e.moveTo(a.index); ix = a.index; }
            var ef = function () { return l.property("ADBE Effect Parade").property(ix); };
            if (a.values) for (k in a.values) if (has(a.values, k)) setPropValue(resolveProp(l, ["ADBE Effect Parade", ix, k]), a.values[k]);
            if (a.expressions) for (k in a.expressions) if (has(a.expressions, k)) setExpr(resolveProp(l, ["ADBE Effect Parade", ix, k]), a.expressions[k]);
            var o = { layer: lref(l), effect: ef().name, index: ix, path: propPath(ef()) };
            if (a.listParams !== false) o.params = effectParams(ef());
            r.push(o);
        });
    }
    return r;
});

def("removeEffect", { w: 1 }, "Remove effect(s). args: comp, layer(s), effect (name/matchName/index) | match regex | all", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), n = 0;
    for (var i = 0; i < ls.length; i++) {
        withUnlocked(ls[i], function (l) {
            var fx = l.property("ADBE Effect Parade");
            if (a.effect !== undefined) { getEffect(l, a.effect).remove(); n++; return; }
            var re = a.match ? toRegex(a.match) : null;
            if (!re && !a.all) fail("Pass effect, match or all");
            for (var k = fx.numProperties; k >= 1; k--) {
                var e = fx.property(k);
                if (!re || re.test(e.name) || re.test(e.matchName)) { e.remove(); n++; }
            }
        });
    }
    return { removed: n };
});

def("toggleEffect", { w: 1 }, "Enable/disable effect(s). args: comp, layer(s), effect | match, enabled", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), n = 0;
    for (var i = 0; i < ls.length; i++) {
        withUnlocked(ls[i], function (l) {
            var fx = l.property("ADBE Effect Parade"), re = a.match ? toRegex(a.match) : null;
            for (var k = 1; k <= fx.numProperties; k++) {
                var e = fx.property(k);
                var hit = a.effect !== undefined ? (e === getEffect(l, a.effect) || e.name === a.effect || k === a.effect) : (!re || re.test(e.name) || re.test(e.matchName));
                if (hit) { e.enabled = !!a.enabled; n++; }
            }
        });
    }
    return { changed: n };
});

def("reorderEffect", { w: 1 }, "Move effect in stack. args: comp, layer, effect, index", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer);
    withUnlocked(l, function () { getEffect(l, a.effect).moveTo(a.index); });
    return { effects: childNames(l.property("ADBE Effect Parade")) };
});

function copyPropTree(src, dst, stats) {
    if (src.propertyType === PropertyType.PROPERTY) {
        try {
            if (src.propertyValueType === PropertyValueType.NO_VALUE) return;
            if (src.propertyValueType === PropertyValueType.CUSTOM_VALUE) { stats.skipped.push(propPath(src)); return; }
            for (var q = dst.numKeys; q >= 1; q--) dst.removeKey(q);
            if (src.numKeys > 0) { for (var k = 1; k <= src.numKeys; k++) keyRestore(dst, keyCapture(src, k), src.keyTime(k)); }
            else if (src.propertyValueType !== PropertyValueType.LAYER_INDEX || src.value) dst.setValue(src.value);
            if (src.canSetExpression && src.expression !== "") { dst.expression = src.expression; dst.expressionEnabled = src.expressionEnabled; }
            stats.copied++;
        } catch (e) { stats.skipped.push(propPath(src) + " (" + errStr(e) + ")"); }
        return;
    }
    for (var i = 1; i <= src.numProperties && i <= dst.numProperties; i++) copyPropTree(src.property(i), dst.property(i), stats);
}
def("copyEffects", { w: 1 }, "Copy effects (values, keys, expressions) from one layer to others, any comp. Custom values (curves, gradients) are skipped - use applyPreset for those. args: comp, layer (source), [effects] names (default all), toComp (default comp), toLayers|toLayer|toMatch", function (a) {
    var c = getComp(a.comp), src = getLayer(c, a.layer), dc = a.toComp !== undefined ? getComp(a.toComp) : c;
    var dl = getLayers(dc, { layers: a.toLayers, layer: a.toLayer, match: a.toMatch });
    var sfx = src.property("ADBE Effect Parade"), stats = { copied: 0, skipped: [] }, r = [];
    for (var i = 0; i < dl.length; i++) {
        if (dl[i] === src) continue;
        withUnlocked(dl[i], function (l) {
            for (var k = 1; k <= sfx.numProperties; k++) {
                var se = sfx.property(k);
                if (a.effects && idxOf(a.effects, se.name) < 0) continue;
                var fx = l.property("ADBE Effect Parade"), ne = fx.addProperty(se.matchName), ix = ne.propertyIndex;
                ne.name = se.name;
                copyPropTree(se, l.property("ADBE Effect Parade").property(ix), stats);
                l.property("ADBE Effect Parade").property(ix).enabled = se.enabled;
            }
        });
        r.push(lref(dl[i]));
    }
    return { to: r, copiedProps: stats.copied, skipped: stats.skipped };
});

// ---------------------------------------------------------------- masks
function rectShape(x, y, w, h) {
    return shapeIn({ vertices: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true });
}
function ellipseShape(x, y, w, h) {
    var k = 0.5523, rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    return shapeIn({
        vertices: [[cx, y], [x + w, cy], [cx, y + h], [x, cy]],
        inTangents: [[-rx * k, 0], [0, -ry * k], [rx * k, 0], [0, ry * k]],
        outTangents: [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]], closed: true
    });
}
function maskShapeFromArgs(a) {
    if (a.rect) return rectShape(a.rect[0], a.rect[1], a.rect[2], a.rect[3]);
    if (a.ellipse) return ellipseShape(a.ellipse[0], a.ellipse[1], a.ellipse[2], a.ellipse[3]);
    if (a.vertices) return shapeIn(a);
    return null;
}
function applyMaskArgs(l, ix, a) {
    var m = function () { return l.property("ADBE Mask Parade").property(ix); };
    if (a.name) m().name = a.name;
    var sh = maskShapeFromArgs(a);
    if (sh) { if (a.time !== undefined) m().property("ADBE Mask Shape").setValueAtTime(a.time, sh); else m().property("ADBE Mask Shape").setValue(sh); }
    if (a.mode !== undefined) m().maskMode = enumVal("MaskMode", a.mode);
    if (a.inverted !== undefined) m().inverted = !!a.inverted;
    if (a.feather !== undefined) m().property("ADBE Mask Feather").setValue(isArr(a.feather) ? a.feather : [a.feather, a.feather]);
    if (a.opacity !== undefined) m().property("ADBE Mask Opacity").setValue(a.opacity);
    if (a.expansion !== undefined) m().property("ADBE Mask Offset").setValue(a.expansion);
    if (a.color !== undefined) m().color = colorIn(a.color).slice(0, 3);
    if (a.locked !== undefined) m().locked = !!a.locked;
    if (a.motionBlur !== undefined) m().maskMotionBlur = enumVal("MaskMotionBlur", a.motionBlur);
    if (a.featherFalloff !== undefined) m().maskFeatherFalloff = enumVal("MaskFeatherFalloff", a.featherFalloff);
    return { name: m().name, index: ix };
}
def("addMask", { w: 1 }, "Add mask (layer coords). args: comp, layer(s), rect:[x,y,w,h] | ellipse:[x,y,w,h] | vertices/inTangents/outTangents/closed, [mode=add], [inverted], [feather], [opacity], [expansion], [name], [color], [time]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        withUnlocked(ls[i], function (l) {
            var m = l.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
            r.push({ layer: lref(l), mask: applyMaskArgs(l, m.propertyIndex, a) });
        });
    }
    return r;
});
def("setMask", { w: 1 }, "Modify mask. args: comp, layer, mask (name or index), + any addMask fields", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), mp = l.property("ADBE Mask Parade");
    var m = typeof a.mask === "number" ? mp.property(a.mask) : childByKey(mp, a.mask);
    if (!m) fail("Mask not found: " + a.mask + ". Masks: " + childNames(mp));
    var r;
    withUnlocked(l, function () { var aa = {}; for (var k in a) if (has(a, k) && k !== "name") aa[k] = a[k]; if (a.newName) aa.name = a.newName; r = applyMaskArgs(l, m.propertyIndex, aa); });
    return r;
});
def("removeMask", { w: 1 }, "Remove mask(s). args: comp, layer(s), mask (name/index) | all", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), n = 0;
    for (var i = 0; i < ls.length; i++) {
        withUnlocked(ls[i], function (l) {
            var mp = l.property("ADBE Mask Parade");
            if (a.all) { while (mp.numProperties) { mp.property(1).remove(); n++; } return; }
            var m = typeof a.mask === "number" ? mp.property(a.mask) : childByKey(mp, a.mask);
            if (!m) fail("Mask not found: " + a.mask);
            m.remove(); n++;
        });
    }
    return { removed: n };
});

def("applyPreset", { w: 1 }, "Apply an animation preset (.ffx). args: comp, layer(s), file", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), f = new File(a.file);
    if (!f.exists) fail("Preset not found: " + a.file);
    if (!/\.ffx$/i.test(f.name)) fail("Only .ffx presets are allowed");
    for (var i = 0; i < ls.length; i++) withUnlocked(ls[i], function (l) { l.applyPreset(f); });
    return { count: ls.length };
});

// ---------------------------------------------------------------- text
function textProp(l) {
    if (!(l instanceof TextLayer)) fail("Not a text layer: " + l.name);
    return l.property("ADBE Text Properties").property("ADBE Text Document");
}
function editDoc(l, time, fn) {
    var p = textProp(l);
    withUnlocked(l, function () {
        if (time !== undefined) { var d = p.valueAtTime(time, true); fn(d); p.setValueAtTime(time, d); }
        else if (p.numKeys > 0) {
            for (var k = 1; k <= p.numKeys; k++) { var dk = p.keyValue(k); fn(dk); p.setValueAtKey(k, dk); }
        } else { var d2 = p.value; fn(d2); p.setValue(d2); }
    });
}

def("setText", { w: 1 }, "Set text content (keeps style of first character). args: comp, layer(s), text (string or lines[]), [time] (sets a key; without time all keys are changed)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), txt = isArr(a.text) ? a.text.join("\r") : String(a.text);
    for (var i = 0; i < ls.length; i++) editDoc(ls[i], a.time, function (d) { d.text = txt; });
    return { count: ls.length };
});

def("setTextStyle", { w: 1 }, "Whole-layer text style. args: comp, layer(s)|match|layerType, style:{font, fontSize, fillColor, applyFill, strokeColor, strokeWidth, applyStroke, strokeOverFill, tracking, leading, autoLeading, baselineShift, horizontalScale, verticalScale, allCaps, smallCaps, fauxBold, fauxItalic, justification left|center|right|full..., boxTextSize, resetCharStyle}, [time]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a);
    if (!a.style) fail("style is required");
    for (var i = 0; i < ls.length; i++) editDoc(ls[i], a.time, function (d) { styleApply(d, a.style); });
    return { count: ls.length };
});

def("setCharStyle", { w: 1 }, "Style a range of characters (AE 24.3+). args: comp, layer, ranges:[{start, end, style}] and/or finds:[{find, style, [all=true], [matchCase]}], [time]", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), applied = 0;
    editDoc(l, a.time, function (d) {
        if (!d.characterRange) fail("characterRange API needs AE 24.3+");
        var i;
        if (a.ranges) for (i = 0; i < a.ranges.length; i++) {
            var rg = a.ranges[i];
            styleApply(d.characterRange(rg.start, rg.end), rg.style, true); applied++;
        }
        if (a.finds) for (i = 0; i < a.finds.length; i++) {
            var f = a.finds[i], hay = f.matchCase ? d.text : d.text.toLowerCase(), needle = f.matchCase ? f.find : String(f.find).toLowerCase();
            var pos = hay.indexOf(needle);
            if (pos < 0) warn("Not found in text: " + f.find);
            while (pos >= 0) {
                styleApply(d.characterRange(pos, pos + needle.length), f.style, true); applied++;
                if (f.all === false) break;
                pos = hay.indexOf(needle, pos + needle.length);
            }
        }
    });
    return { applied: applied };
});

var CHAR_ATTRS = ["font", "fontSize", "applyFill", "fillColor", "applyStroke", "strokeColor", "strokeWidth", "tracking", "baselineShift",
    "fauxBold", "fauxItalic", "horizontalScale", "verticalScale", "fontCapsOption", "fontBaselineOption"];
function readCharStyles(d) {
    var out = [];
    if (!d.characterRange) return null;
    for (var i = 0; i < d.text.length; i++) {
        var cr = d.characterRange(i, i + 1), st = {};
        for (var k = 0; k < CHAR_ATTRS.length; k++) { try { var v = cr[CHAR_ATTRS[k]]; if (v !== undefined) st[CHAR_ATTRS[k]] = v; } catch (e) {} }
        out.push(st);
    }
    return out;
}
function styleSig(st) { return jsonStr(st); }
// replace text keeping per-character styles; matches: [{start, end, text}] sorted, non-overlapping
function replaceKeepingStyles(d, matches) {
    var old = d.text, styles = readCharStyles(d), nt = "", map = [], pos = 0, i, j;
    for (i = 0; i < matches.length; i++) {
        var m = matches[i];
        for (j = pos; j < m.start; j++) { nt += old.charAt(j); map.push(j); }
        for (j = 0; j < m.text.length; j++) { nt += m.text.charAt(j); map.push(Math.min(m.start + j, Math.max(m.start, m.end - 1))); }
        pos = m.end;
    }
    for (j = pos; j < old.length; j++) { nt += old.charAt(j); map.push(j); }
    d.text = nt;
    if (!styles || !styles.length) return nt;
    var runStart = 0;
    for (i = 1; i <= nt.length; i++) {
        if (i < nt.length && styleSig(styles[map[i]]) === styleSig(styles[map[runStart]])) continue;
        var st = styles[map[runStart]], cr = d.characterRange(runStart, i);
        for (var k = 0; k < CHAR_ATTRS.length; k++) {
            var key = CHAR_ATTRS[k];
            if (st[key] === undefined) continue;
            if ((key === "fillColor" && st.applyFill === false) || (key === "strokeColor" && st.applyStroke === false)) continue;
            try { cr[key] = st[key]; } catch (e) {}
        }
        runStart = i;
    }
    return nt;
}
function findMatches(text, a) {
    var r = [], m;
    if (a.regex) {
        var re = new RegExp(a.find, a.matchCase ? "g" : "gi");
        while ((m = re.exec(text)) !== null) {
            if (m[0] === "") { re.lastIndex++; continue; }
            r.push({ start: m.index, end: m.index + m[0].length, text: m[0].replace(new RegExp(a.find, a.matchCase ? "" : "i"), a.replace) });
        }
        return r;
    }
    var hay = a.matchCase ? text : text.toLowerCase(), needle = a.matchCase ? String(a.find) : String(a.find).toLowerCase(), p = hay.indexOf(needle);
    while (needle && p >= 0) { r.push({ start: p, end: p + needle.length, text: String(a.replace) }); p = hay.indexOf(needle, p + needle.length); }
    return r;
}
def("replaceText", { w: 1 }, "Find/replace in text layers project-wide, keeping per-character styles (colors/fonts of words). args: find, replace, [regex], [matchCase], [comps|compMatch|comp], [layerMatch], [dryRun]", function (a) {
    var comps = getComps(a, true), res = [], lre = a.layerMatch ? toRegex(a.layerMatch) : null;
    for (var ci = 0; ci < comps.length; ci++) {
        var c = comps[ci];
        for (var i = 1; i <= c.numLayers; i++) {
            var l = c.layer(i);
            if (!(l instanceof TextLayer) || (lre && !lre.test(l.name))) continue;
            var p = textProp(l), d0 = p.numKeys ? p.keyValue(1) : p.value, before = d0.text;
            var mt = findMatches(before, a);
            if (!mt.length && !p.numKeys) continue;
            var after = before;
            if (mt.length) { var tmp = { text: before, characterRange: null }; after = ""; var ps = 0; for (var q = 0; q < mt.length; q++) { after += before.substring(ps, mt[q].start) + mt[q].text; ps = mt[q].end; } after += before.substring(ps); }
            if (!a.dryRun) editDoc(l, undefined, function (d) { var mm = findMatches(d.text, a); if (mm.length) replaceKeepingStyles(d, mm); });
            if (after !== before) res.push({ comp: c.name, layer: lref(l), before: shorten(before, 200), after: shorten(after, 200) });
        }
    }
    return { dryRun: !!a.dryRun, count: res.length, changed: res };
});

def("replaceFont", { w: 1 }, "Replace font project-wide, including per-character runs. args: from (PostScript name or regex), to (PostScript name), [regex], [comps|compMatch], [dryRun]", function (a) {
    var comps = getComps(a, true), res = [];
    function hit(f) { return a.regex ? toRegex(a.from).test(f) : f === a.from; }
    for (var ci = 0; ci < comps.length; ci++) {
        var c = comps[ci];
        for (var i = 1; i <= c.numLayers; i++) {
            var l = c.layer(i);
            if (!(l instanceof TextLayer)) continue;
            var found = 0;
            var fn = function (d) {
                if (d.characterRange) {
                    for (var ch = 0; ch < d.text.length; ch++) {
                        var cr = d.characterRange(ch, ch + 1);
                        if (hit(cr.font)) { found++; if (!a.dryRun) cr.font = a.to; }
                    }
                } else if (hit(d.font)) { found++; if (!a.dryRun) d.font = a.to; }
            };
            if (a.dryRun) { var p = textProp(l); fn(p.numKeys ? p.keyValue(1) : p.value); }
            else editDoc(l, undefined, fn);
            if (found) res.push({ comp: c.name, layer: lref(l), chars: found });
        }
    }
    return { dryRun: !!a.dryRun, count: res.length, layers: res };
});

def("setTextBox", { w: 1 }, "Resize paragraph (box) text. args: comp, layer(s), size:[w,h], [position:[x,y]]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a);
    for (var i = 0; i < ls.length; i++) editDoc(ls[i], undefined, function (d) {
        if (!d.boxText) fail("Not box text: " + ls[i].name);
        if (a.size) d.boxTextSize = a.size;
        if (a.position) d.boxTextPos = a.position;
    });
    return { count: ls.length };
});

var ANIM_PROPS = { opacity: "ADBE Text Opacity", position: "ADBE Text Position 3D", scale: "ADBE Text Scale 3D", rotation: "ADBE Text Rotation",
    anchor: "ADBE Text Anchor Point 3D", skew: "ADBE Text Skew", fillColor: "ADBE Text Fill Color", strokeColor: "ADBE Text Stroke Color",
    strokeWidth: "ADBE Text Stroke Width", tracking: "ADBE Text Tracking Amount", blur: "ADBE Text Blur", lineSpacing: "ADBE Text Line Spacing",
    fillHue: "ADBE Text Fill Hue", fillBrightness: "ADBE Text Fill Brightness", fillOpacity: "ADBE Text Fill Opacity", characterOffset: "ADBE Text Character Offset" };
var SELECTOR_TYPES = { range: "ADBE Text Selector", wiggly: "ADBE Text Wiggly Selector", expression: "ADBE Text Expressible Selector" };
def("addTextAnimator", { w: 1 }, "Text animator. args: comp, layer, [name], properties:{opacity|position|scale|rotation|fillColor|tracking|blur|...|matchName: value}, [selector:{type range|wiggly|expression, values:{Start:0, End:100, Offset:0, 'Advanced/Units':1...}, keys:{path:[{t,v,ease}]}, expression (amount expr for expression selector)}]", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), r;
    textProp(l);
    withUnlocked(l, function () {
        var anims = function () { return l.property("ADBE Text Properties").property("ADBE Text Animators"); };
        var an = anims().addProperty("ADBE Text Animator"), ai = an.propertyIndex, k;
        var A = function () { return anims().property(ai); };
        if (a.name) A().name = a.name;
        if (a.properties) for (k in a.properties) {
            if (!has(a.properties, k)) continue;
            var mn = ANIM_PROPS[k] || k;
            var np = A().property("ADBE Text Animator Properties").addProperty(mn);
            var ni = np.propertyIndex;
            setPropValue(A().property("ADBE Text Animator Properties").property(ni), a.properties[k]);
        }
        var sel = a.selector || { type: "range" };
        var smn = SELECTOR_TYPES[sel.type || "range"];
        if (!smn) fail("Unknown selector type " + sel.type);
        var S0 = A().property("ADBE Text Selectors");
        var si = null;
        if (sel.type && sel.type !== "range") {
            si = S0.addProperty(smn).propertyIndex;
        } else if (S0.numProperties) si = 1;
        else si = S0.addProperty(smn).propertyIndex;
        var base = [ "ADBE Text Properties", "ADBE Text Animators", ai, "ADBE Text Selectors", si ];
        if (sel.values) for (k in sel.values) if (has(sel.values, k)) setPropValue(resolveProp(l, base.concat(splitPath(k))), sel.values[k]);
        if (sel.keys) for (k in sel.keys) {
            if (!has(sel.keys, k)) continue;
            var kp = resolveProp(l, base.concat(splitPath(k)));
            for (var j = 0; j < sel.keys[k].length; j++) {
                var ks = sel.keys[k][j];
                kp.setValueAtTime(ks.t, valIn(kp, ks.v));
                applyKeySpec(kp, kp.nearestKeyIndex(ks.t), ks);
            }
        }
        if (sel.expression !== undefined) setExpr(resolveProp(l, base.concat(["ADBE Text Expressible Amount"])), sel.expression);
        r = { layer: lref(l), animator: A().name, index: ai, selector: childNames(resolveProp(l, base)) };
    });
    return r;
});

// ---------------------------------------------------------------- shape contents
var SHAPE_ITEMS = {
    rect: "ADBE Vector Shape - Rect", ellipse: "ADBE Vector Shape - Ellipse", star: "ADBE Vector Shape - Star", path: "ADBE Vector Shape - Group",
    fill: "ADBE Vector Graphic - Fill", stroke: "ADBE Vector Graphic - Stroke", gradientFill: "ADBE Vector Graphic - G-Fill", gradientStroke: "ADBE Vector Graphic - G-Stroke",
    trim: "ADBE Vector Filter - Trim", repeater: "ADBE Vector Filter - Repeater", offset: "ADBE Vector Filter - Offset", wigglePaths: "ADBE Vector Filter - Roughen",
    roundCorners: "ADBE Vector Filter - RC", merge: "ADBE Vector Filter - Merge", zigzag: "ADBE Vector Filter - Zigzag", puckerBloat: "ADBE Vector Filter - PB",
    twist: "ADBE Vector Filter - Twist", wiggleTransform: "ADBE Vector Filter - Wiggler", group: "ADBE Vector Group"
};
function shapeContents(l, path) {
    var p = resolveProp(l, path === undefined ? "contents" : path);
    if (p.matchName === "ADBE Vector Group") p = p.property("ADBE Vectors Group");
    return propMPath(p);
}
def("addShapeGroup", { w: 1 }, "Add a shape group to a shape layer. args: comp, layer, [parent] path (default contents; a group path is fine), shape spec (type, size, center, vertices, fill, stroke, trim, name, groupPosition...)", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer);
    if (!(l instanceof ShapeLayer)) fail("Not a shape layer: " + l.name);
    var r;
    withUnlocked(l, function () { r = buildShapeGroup(l, shapeContents(l, a.parent), a.shape || a); });
    return r;
});
def("addShapeItem", { w: 1 }, "Add shape item/operator. args: comp, layer, [parent] (contents or group path), item: rect|ellipse|star|path|fill|stroke|gradientFill|gradientStroke|trim|repeater|offset|wigglePaths|roundCorners|merge|zigzag|puckerBloat|twist|wiggleTransform|group, [name], [values:{childName:value}], [expressions], [index]", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), mn = SHAPE_ITEMS[a.item] || a.item, r;
    withUnlocked(l, function () {
        var parentM = shapeContents(l, a.parent), par = resolveProp(l, parentM);
        if (!par.canAddProperty(mn)) fail("Cannot add " + mn + " to " + propPath(par));
        var np = par.addProperty(mn), ix = np.propertyIndex;
        if (a.name) resolveProp(l, parentM + "/#" + ix).name = a.name;
        if (a.index !== undefined) { resolveProp(l, parentM + "/#" + ix).moveTo(a.index); ix = a.index; }
        var mp = parentM + "/#" + ix, k;
        if (a.values) for (k in a.values) if (has(a.values, k)) setPropValue(resolveProp(l, mp + "/" + k), a.values[k]);
        if (a.expressions) for (k in a.expressions) if (has(a.expressions, k)) setExpr(resolveProp(l, mp + "/" + k), a.expressions[k]);
        var fin = resolveProp(l, mp);
        r = { path: propPath(fin), mpath: mp, children: childNames(fin) };
    });
    return r;
});

def("setPathVertices", { w: 1 }, "Set a path (shape path or mask). args: comp, layer, path (to 'Path' property, shape path group, or mask), vertices, [inTangents], [outTangents], [closed], [time]", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), p = resolveProp(l, a.path);
    if (p.matchName === "ADBE Vector Shape - Group") p = p.property("ADBE Vector Shape");
    else if (p.matchName === "ADBE Mask Atom") p = p.property("ADBE Mask Shape");
    if (p.propertyValueType !== PropertyValueType.SHAPE) fail("Not a path property: " + propPath(p));
    withUnlocked(l, function () { setPropValue(p, a, a.time); });
    return pref(p);
});

def("setGradient", { w: 1 }, "Gradient fill/stroke geometry (colors can NOT be set by scripting - only type/points/highlight). args: comp, layer, path (to Gradient Fill/Stroke), [type] linear|radial, [start:[x,y]], [end:[x,y]], [highlightLength], [highlightAngle], [opacity]", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), g = resolveProp(l, a.path);
    function gp(names) {
        for (var i = 0; i < names.length; i++) { var q = childByKey(g, names[i]); if (q) return q; }
        fail("Gradient property not found (" + names.join(" / ") + ") in " + propPath(g) + ". Children: " + childNames(g));
    }
    withUnlocked(l, function () {
        if (a.type) gp(["ADBE Vector Grad Type", "Type"]).setValue(a.type === "radial" ? 2 : 1);
        if (a.start) gp(["ADBE Vector Grad Start Pt", "Start Point"]).setValue(a.start);
        if (a.end) gp(["ADBE Vector Grad End Pt", "End Point"]).setValue(a.end);
        if (a.highlightLength !== undefined) gp(["ADBE Vector Grad HiLite Length", "Highlight Length"]).setValue(a.highlightLength);
        if (a.highlightAngle !== undefined) gp(["ADBE Vector Grad HiLite Angle", "Highlight Angle"]).setValue(a.highlightAngle);
        if (a.opacity !== undefined) gp(["ADBE Vector Fill Opacity", "ADBE Vector Stroke Opacity", "Opacity"]).setValue(a.opacity);
    });
    warn("Gradient colors are a custom value and cannot be changed by script; use a Gradient Ramp effect or edit manually.");
    return pref(g);
});
// ================================================================ COMPS / PROJECT / MARKERS / RETIME / LAYOUT / 3D / RENDER / MENU

def("createComp", { w: 1 }, "Create comp. args: name, [width=1920], [height=1080], [pixelAspect=1], [duration=10], [frameRate=30], [bgColor], [folder], [ifExists] 'error'|'reuse' (keep as is)|'clear' (remove layers & markers, keep links)", function (a) {
    if (!a.name) fail("name is required");
    var ex = null;
    for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof CompItem && it.name === a.name) { ex = it; break; } }
    var W = num(a.width, 1920), H = num(a.height, 1080), D = num(a.duration, 10), F = num(a.frameRate, 30), c;
    if (ex) {
        var mode = a.ifExists || "error";
        if (mode === "error") fail("Comp already exists: " + a.name + " (id " + ex.id + "). Use ifExists 'reuse' or 'clear'.");
        c = ex;
        if (mode === "clear") {
            while (c.numLayers > 0) { c.layer(1).locked = false; c.layer(1).remove(); }
            while (c.markerProperty.numKeys > 0) c.markerProperty.removeKey(1);
            c.width = W; c.height = H; c.duration = D; c.frameRate = F;
        }
    } else c = app.project.items.addComp(a.name, W, H, num(a.pixelAspect, 1), D, F);
    if (a.bgColor !== undefined) c.bgColor = colorIn(a.bgColor).slice(0, 3);
    if (a.folder !== undefined) c.parentFolder = getFolder(a.folder, true);
    return compOut(c);
});

def("setCompSettings", { w: 1 }, "Comp settings. args: comp, any of: name, width, height, pixelAspect, duration, frameRate, bgColor, workArea:[start,duration], displayStartTime, motionBlur, shutterAngle, shutterPhase, motionBlurSamplesPerFrame, motionBlurAdaptiveSampleLimit, hideShyLayers, frameBlending, draft3D, renderer, resolutionFactor:[x,y], preserveNestedFrameRate, preserveNestedResolution, dropFrame, motionGraphicsTemplateName, time (CTI), comment, label", function (a) {
    var c = getComp(a.comp);
    var simple = ["name", "width", "height", "pixelAspect", "duration", "frameRate", "displayStartTime", "motionBlur", "shutterAngle", "shutterPhase",
        "motionBlurSamplesPerFrame", "motionBlurAdaptiveSampleLimit", "hideShyLayers", "frameBlending", "draft3D", "renderer", "resolutionFactor",
        "preserveNestedFrameRate", "preserveNestedResolution", "dropFrame", "motionGraphicsTemplateName", "time", "comment", "label"];
    for (var i = 0; i < simple.length; i++) {
        var k = simple[i];
        if (a[k] === undefined) continue;
        try { c[k] = a[k]; } catch (e) { warn(k + ": " + errStr(e)); }
    }
    if (a.bgColor !== undefined) c.bgColor = colorIn(a.bgColor).slice(0, 3);
    if (a.workArea) { c.workAreaStart = a.workArea[0]; c.workAreaDuration = a.workArea[1]; }
    return compOut(c);
});

def("duplicateComp", { w: 1 }, "Duplicate comp (not nested comps). args: comp, [name], [folder]", function (a) {
    var c = getComp(a.comp), d = c.duplicate();
    if (a.name) d.name = a.name;
    if (a.folder !== undefined) d.parentFolder = getFolder(a.folder, true);
    return compOut(d);
});

def("setItem", { w: 1 }, "Rename / comment / label a project item. args: item, [name], [comment], [label]", function (a) {
    var it = getItem(a.item);
    if (a.name !== undefined) it.name = a.name;
    if (a.comment !== undefined) it.comment = a.comment;
    if (a.label !== undefined) it.label = a.label;
    return itemOut(it);
});

def("moveToFolder", { w: 1 }, "Move items to a folder. args: items:[ref...] | item, folder (name, id or 'A/B/C' path; created if missing), [create=true]", function (a) {
    var f = getFolder(a.folder, a.create !== false), items = a.items || [a.item], r = [];
    for (var i = 0; i < items.length; i++) { var it = getItem(items[i]); it.parentFolder = f; r.push(iref(it)); }
    return { folder: iref(f), moved: r };
});

def("createFolder", { w: 1 }, "Create folder. args: name or path 'A/B'", function (a) {
    return iref(getFolder(a.name, true));
});

def("deleteItem", { w: 1 }, "Remove project item(s) from the project (undoable; files on disk are not touched). Refuses items in use unless force. args: items|item, [force]", function (a) {
    var refs = a.items || [a.item], list = [], r = [], i;
    for (i = 0; i < refs.length; i++) {
        var it = getItem(refs[i]);
        if (!a.force && !(it instanceof FolderItem) && it.usedIn.length) fail("Item is used in " + it.usedIn.length + " comp(s): " + it.name + " (pass force)");
        if (!a.force && it instanceof FolderItem && it.numItems) fail("Folder is not empty: " + it.name + " (pass force)");
        list.push({ id: it.id, ref: iref(it) });
    }
    for (i = 0; i < list.length; i++) {
        // an item may already be gone because its parent folder was removed earlier in this call
        var cur = null;
        for (var j = 1; j <= app.project.numItems; j++) if (app.project.item(j).id === list[i].id) { cur = app.project.item(j); break; }
        if (!cur) { r.push(list[i].ref); continue; }
        r.push(list[i].ref);
        cur.remove();
    }
    return { removed: r };
});

// ---------------------------------------------------------------- markers
function markerTarget(a) {
    var c = getComp(a.comp);
    if (a.layer !== undefined) { var l = getLayer(c, a.layer); return { prop: l.property("ADBE Marker"), layer: l, comp: c }; }
    return { prop: c.markerProperty, comp: c };
}
function markerIndexes(p, a, c) {
    var ids = [], tol = c.frameDuration / 2;
    for (var k = 1; k <= p.numKeys; k++) {
        var mv = p.keyValue(k), t = p.keyTime(k);
        if (a.all) ids.push(k);
        else if (a.index !== undefined && a.index === k) ids.push(k);
        else if (a.time !== undefined && Math.abs(t - a.time) <= tol) ids.push(k);
        else if (a.match !== undefined && toRegex(a.match).test(mv.comment)) ids.push(k);
    }
    return ids;
}
def("addMarker", { w: 1 }, "Add marker(s) to comp or layer. args: comp, [layer], time + comment/duration/label/chapter/url  OR  markers:[{t, comment, duration, label}]", function (a) {
    var T = markerTarget(a), list = a.markers || [{ t: a.time, comment: a.comment, duration: a.duration, label: a.label, chapter: a.chapter, url: a.url }], n = 0;
    var go = function () {
        for (var i = 0; i < list.length; i++) {
            var t = parseTime(list[i].t !== undefined ? list[i].t : list[i].time, T.comp.frameRate);
            T.prop.setValueAtTime(t, markerIn(list[i])); n++;
        }
    };
    if (T.layer) withUnlocked(T.layer, go); else go();
    return { added: n, total: T.prop.numKeys };
});
def("setMarker", { w: 1 }, "Modify marker(s). args: comp, [layer], select by index|time|match|all, and new: [comment], [duration], [label], [chapter], [url], [newTime] or [shift]", function (a) {
    var T = markerTarget(a), p = T.prop, ids = markerIndexes(p, a, T.comp), n = 0;
    var go = function () {
        for (var i = 0; i < ids.length; i++) {
            var k = ids[i], mv = p.keyValue(k);
            if (a.comment !== undefined) mv.comment = a.comment;
            if (a.duration !== undefined) mv.duration = a.duration;
            if (a.chapter !== undefined) mv.chapter = a.chapter;
            if (a.url !== undefined) mv.url = a.url;
            try { if (a.label !== undefined) mv.label = a.label; } catch (e) {}
            p.setValueAtKey(k, mv); n++;
        }
        if (a.newTime !== undefined || a.shift !== undefined) {
            remapKeys(p, function (t, k) { return idxOf(ids, k) >= 0 ? (a.newTime !== undefined ? a.newTime : t + a.shift) : null; });
        }
    };
    if (T.layer) withUnlocked(T.layer, go); else go();
    return { changed: n };
});
def("removeMarker", { w: 1 }, "Remove marker(s). args: comp, [layer], index|time|match|all", function (a) {
    var T = markerTarget(a), p = T.prop, ids = markerIndexes(p, a, T.comp);
    var go = function () { for (var i = ids.length - 1; i >= 0; i--) p.removeKey(ids[i]); };
    if (T.layer) withUnlocked(T.layer, go); else go();
    return { removed: ids.length };
});

function parseCSVLine(line, sep) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (q) {
            if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
            else if (ch === '"') q = false;
            else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === sep) { out.push(cur); cur = ""; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}
def("markersFromFile", { w: 1 }, "Markers from SRT, CSV (time;[duration];comment - separator ; , or tab, header optional) or JSON [{t,comment,duration}]. args: file, comp, [layer], [clear], [offset=0]", function (a) {
    var T = markerTarget(a), txt = readText(a.file), fps = T.comp.frameRate, list = [], off = num(a.offset, 0), m, i;
    if (/\.srt$/i.test(a.file)) {
        var blocks = txt.replace(/\r/g, "").split(/\n\s*\n/);
        for (i = 0; i < blocks.length; i++) {
            var lines = blocks[i].split("\n"), tl = -1;
            for (var j = 0; j < lines.length; j++) if (lines[j].indexOf("-->") >= 0) { tl = j; break; }
            if (tl < 0) continue;
            var parts = lines[tl].split("-->");
            var t0 = parseTime(trim(parts[0]), fps), t1 = parseTime(trim(parts[1]), fps);
            list.push({ t: t0, duration: t1 - t0, comment: lines.slice(tl + 1).join(" ") });
        }
    } else if (/\.json$/i.test(a.file)) {
        list = jsonParse(txt);
    } else {
        var rows = txt.replace(/\r/g, "").split("\n");
        var sep = rows[0].indexOf("\t") >= 0 ? "\t" : (rows[0].indexOf(";") >= 0 ? ";" : ",");
        for (i = 0; i < rows.length; i++) {
            if (!trim(rows[i])) continue;
            var cols = parseCSVLine(rows[i], sep), tt;
            try { tt = parseTime(cols[0], fps); } catch (e) { continue; }
            if (cols.length >= 3) list.push({ t: tt, duration: parseTime(cols[1] || 0, fps), comment: cols.slice(2).join(sep) });
            else list.push({ t: tt, comment: cols[1] || "" });
        }
    }
    var go = function () {
        if (a.clear) while (T.prop.numKeys) T.prop.removeKey(1);
        for (i = 0; i < list.length; i++) T.prop.setValueAtTime(parseTime(list[i].t, fps) + off, markerIn(list[i]));
    };
    if (T.layer) withUnlocked(T.layer, go); else go();
    return { added: list.length, total: T.prop.numKeys };
});

// ---------------------------------------------------------------- retime
// remap marker times AND durations (fn: stored marker time -> new time)
function remapMarkers(prop, fn) {
    var list = [], k;
    for (k = 1; k <= prop.numKeys; k++) {
        var mv = prop.keyValue(k), t = prop.keyTime(k), nt = fn(t);
        list.push({ v: mv, t: nt, d: mv.duration ? Math.max(0, fn(t + mv.duration) - nt) : 0 });
    }
    for (k = prop.numKeys; k >= 1; k--) prop.removeKey(k);
    for (k = 0; k < list.length; k++) {
        if (list[k].v.duration) list[k].v.duration = list[k].d;
        prop.setValueAtTime(list[k].t, list[k].v);
    }
    return list.length;
}
function mapFn(map) {
    var pts = map.slice(0).sort(function (x, y) { return x[0] - y[0]; });
    if (!pts.length) fail("map is empty");
    return function (t) {
        if (t <= pts[0][0]) return t + (pts[0][1] - pts[0][0]);
        for (var i = 1; i < pts.length; i++) {
            if (t <= pts[i][0]) {
                var a0 = pts[i - 1], a1 = pts[i], span = a1[0] - a0[0];
                if (span <= 0) return a1[1];
                return a0[1] + (t - a0[0]) * (a1[1] - a0[1]) / span;
            }
        }
        var last = pts[pts.length - 1];
        return t + (last[1] - last[0]);
    };
}
def("retimeByMap", { w: 1 }, "Retime comps by a time map (piecewise linear old->new). Each layer moves so its inPoint = f(in) (keys move with it); [trimOut=true] sets outPoint = f(out); [remapKeys] also re-times keys inside layers; comp & layer markers remapped. Nested comps are NOT retimed automatically. args: map:[[old,new],...], [comps|comp|compMatch], [trimOut], [remapKeys], [markers=true], [extendComp], [dryRun]", function (a) {
    if (!a.map) fail("map is required");
    var f = mapFn(a.map), comps = getComps(a, false), plan = [], i, j;
    for (i = 0; i < comps.length; i++) {
        var c = comps[i];
        for (j = 1; j <= c.numLayers; j++) {
            var l = c.layer(j), oi = l.inPoint, oo = l.outPoint, ni = f(oi), no = f(oo), delta = ni - oi;
            var o = { comp: c.name, layer: l.name, index: l.index, inPoint: [rnd(oi), rnd(ni)], outPoint: [rnd(oo), rnd(a.trimOut === false ? oo + delta : no)] };
            plan.push(o);
            if (a.dryRun || (Math.abs(delta) < 1e-6 && Math.abs(no - oo) < 1e-6 && !a.remapKeys)) continue;
            withUnlocked(l, function () {
                l.startTime += delta;
                if (a.remapKeys) {
                    walkProps(l, function (p) {
                        try { if (p.numKeys > 0 && p.matchName !== "ADBE Marker") remapKeys(p, function (t) { return f(t - delta); }); } catch (e) {}
                    });
                }
                if (a.markers !== false) { try { remapMarkers(l.property("ADBE Marker"), function (t) { return f(t - delta) ; }); } catch (e) {} }
                if (a.trimOut !== false && no > ni) l.outPoint = no;
            });
        }
        if (!a.dryRun && a.markers !== false) remapMarkers(c.markerProperty, function (t) { return f(t); });
        if (!a.dryRun && a.extendComp) { var nd = f(c.duration); if (nd > c.duration) c.duration = nd; }
    }
    return { dryRun: !!a.dryRun, layers: plan.length, plan: plan.slice(0, 300) };
});

// ---------------------------------------------------------------- import / footage
def("importFile", { w: 1 }, "Import file(s). args: file | files[], [as] footage|comp|compCroppedLayers|project, [sequence], [forceAlphabetical], [folder], [name]", function (a) {
    var files = a.files || [a.file], r = [];
    for (var i = 0; i < files.length; i++) {
        var f = new File(files[i]);
        if (!f.exists) fail("File not found: " + files[i]);
        var io = new ImportOptions(f);
        if (a["as"]) {
            var ty = { footage: "FOOTAGE", comp: "COMP", compcroppedlayers: "COMP_CROPPED_LAYERS", project: "PROJECT" }[String(a["as"]).toLowerCase()];
            if (!ty) fail("Unknown import type: " + a["as"]);
            if (!io.canImportAs(ImportAsType[ty])) fail("Cannot import " + f.name + " as " + a["as"]);
            io.importAs = ImportAsType[ty];
        }
        if (a.sequence) io.sequence = true;
        if (a.forceAlphabetical) io.forceAlphabetical = true;
        var it = app.project.importFile(io);
        if (a.name && files.length === 1) it.name = a.name;
        if (a.folder !== undefined) it.parentFolder = getFolder(a.folder, true);
        r.push(itemOut(it));
    }
    return r;
});

def("importProject", { w: 1 }, "Import another .aep into this project (comes in as a folder). args: file, [folder]", function (a) {
    var f = new File(a.file);
    if (!f.exists) fail("File not found: " + a.file);
    var io = new ImportOptions(f), before = {}, i;
    io.importAs = ImportAsType.PROJECT;
    for (i = 1; i <= app.project.numItems; i++) before[app.project.item(i).id] = 1;
    app.project.importFile(io);
    var root = null;
    for (i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (!before[it.id] && it instanceof FolderItem && it.parentFolder === app.project.rootFolder) { root = it; break; }
    }
    if (!root) fail("Imported, but the new project folder was not found");
    if (a.folder !== undefined) root.parentFolder = getFolder(a.folder, true);
    var r = itemOut(root); r.numItems = root.numItems;
    return r;
});

def("replaceFootage", { w: 1 }, "Replace a footage item's file. args: item, file, [sequence], [forceAlphabetical]", function (a) {
    var it = getItem(a.item, "footage"), f = new File(a.file);
    if (!f.exists) fail("File not found: " + a.file);
    if (a.sequence) it.replaceWithSequence(f, !!a.forceAlphabetical); else it.replace(f);
    return itemOut(it);
});

def("interpretFootage", { w: 1 }, "Interpret footage. args: item, [alphaMode] ignore|straight|premultiplied, [premulColor], [invertAlpha], [conformFrameRate], [loop], [fieldSeparation] off|upper_field_first|lower_field_first, [removePulldown], [pixelAspect]", function (a) {
    var it = getItem(a.item, "footage"), s = it.mainSource;
    if (a.alphaMode !== undefined) s.alphaMode = enumVal("AlphaMode", a.alphaMode);
    if (a.premulColor !== undefined) s.premulColor = colorIn(a.premulColor).slice(0, 3);
    if (a.invertAlpha !== undefined) s.invertAlpha = !!a.invertAlpha;
    if (a.conformFrameRate !== undefined) s.conformFrameRate = a.conformFrameRate;
    if (a.loop !== undefined) s.loop = a.loop;
    if (a.fieldSeparation !== undefined) s.fieldSeparationType = enumVal("FieldSeparationType", a.fieldSeparation);
    if (a.pixelAspect !== undefined) it.pixelAspect = a.pixelAspect;
    return itemOut(it);
});

def("setProxy", { w: 1 }, "Proxy. args: item, file | none:true, [sequence], [useProxy]", function (a) {
    var it = getItem(a.item);
    if (a.none) it.setProxyToNone();
    else if (a.file) {
        var f = new File(a.file);
        if (!f.exists) fail("File not found: " + a.file);
        if (a.sequence) it.setProxyWithSequence(f, false); else it.setProxy(f);
    }
    if (a.useProxy !== undefined) it.useProxy = !!a.useProxy;
    return itemOut(it);
});

def("cleanupProject", { w: 1 }, "Project cleanup (needs confirm:true). args: action removeUnusedFootage|consolidateFootage|reduceProject, [comps] for reduceProject, confirm", function (a) {
    if (a.confirm !== true) fail("Pass confirm:true");
    if (a.action === "removeUnusedFootage") return { removed: app.project.removeUnusedFootage() };
    if (a.action === "consolidateFootage") return { consolidated: app.project.consolidateFootage() };
    if (a.action === "reduceProject") {
        var cs = []; for (var i = 0; i < a.comps.length; i++) cs.push(getComp(a.comps[i]));
        return { removed: app.project.reduceProject(cs) };
    }
    fail("Unknown action " + a.action);
});

def("openComp", {}, "Open comp in viewer (UI). args: comp, [time] set CTI, [workArea:[start,dur]]", function (a) {
    var c = getComp(a.comp);
    c.openInViewer();
    if (a.time !== undefined) c.time = parseTime(a.time, c.frameRate);
    if (a.workArea) { c.workAreaStart = a.workArea[0]; c.workAreaDuration = a.workArea[1]; }
    return { comp: c.name, time: rnd(c.time) };
});

def("saveProject", { w: 1, noUndo: 1 }, "Save the project to its current file. args: confirm:true", function (a) {
    if (a.confirm !== true) fail("Pass confirm:true");
    if (!app.project.file) fail("Project was never saved - save it manually first");
    app.project.save();
    return { saved: app.project.file.fsName };
});

def("backupProject", { w: 1, noUndo: 1 }, "Copy the project file to <project folder>/_backup/<name>_<date>.aep. args: [save] save first (default false = copy last saved state), [label]", function (a) {
    if (!app.project.file) fail("Project was never saved");
    if (a.save) app.project.save();
    var pf = app.project.file, base = pf.name.replace(/\.aep$/i, "");
    var dest = safeOut(pf.parent.fsName + "/_backup/" + base + "_" + fileStamp() + (a.label ? "_" + safeName(a.label) : "") + ".aep");
    if (!pf.copy(dest)) fail("Copy failed: " + pf.error);
    var r = { backup: dest, fromSavedState: true };
    try { r.unsavedChangesNotIncluded = app.project.dirty; } catch (e) {}
    return r;
});

// ---------------------------------------------------------------- guides & layout
def("guides", { w: 1 }, "Comp guides. args: comp, [add:[{orientation:'h'|'v', position}]], [remove:[index...]|'all']", function (a) {
    var c = getComp(a.comp), i;
    if (a.remove === "all") { while (c.guides.length) c.removeGuide(0); }
    else if (a.remove) { var rm = a.remove.slice(0).sort(function (x, y) { return y - x; }); for (i = 0; i < rm.length; i++) c.removeGuide(rm[i]); }
    if (a.add) for (i = 0; i < a.add.length; i++) c.addGuide(String(a.add[i].orientation).charAt(0) === "h" ? 0 : 1, a.add[i].position);
    return { count: c.guides.length };
});

function boundsOf(l, t) { var b = compBounds(l, t); if (!b) fail("No bounds for " + l.name); return b; }
def("align", { w: 1 }, "Align layers (by visual bounds). args: comp, layer(s), edge left|hcenter|right|top|vcenter|bottom, [to] 'comp' (default)|'selection'|layer ref|number (pixel), [time]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), t = num(a.time, c.time), e = a.edge, i;
    if (!e) fail("edge is required");
    var horiz = e === "left" || e === "hcenter" || e === "right";
    function val(b) {
        switch (e) {
            case "left": return b.left; case "right": return b.right; case "hcenter": return (b.left + b.right) / 2;
            case "top": return b.top; case "bottom": return b.bottom; case "vcenter": return (b.top + b.bottom) / 2;
        }
        fail("Bad edge " + e);
    }
    var target;
    if (typeof a.to === "number") target = a.to;
    else if (a.to === undefined || a.to === "comp") target = val({ left: 0, top: 0, right: c.width, bottom: c.height });
    else if (a.to === "selection") {
        var u = { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 };
        for (i = 0; i < ls.length; i++) { var bb = boundsOf(ls[i], t); u.left = Math.min(u.left, bb.left); u.top = Math.min(u.top, bb.top); u.right = Math.max(u.right, bb.right); u.bottom = Math.max(u.bottom, bb.bottom); }
        target = val(u);
    } else target = val(boundsOf(getLayer(c, a.to), t));
    var r = [];
    for (i = 0; i < ls.length; i++) {
        var d = target - val(boundsOf(ls[i], t));
        moveLayerBy(ls[i], horiz ? d : 0, horiz ? 0 : d);
        r.push({ layer: lref(ls[i]), moved: rnd(d) });
    }
    return r;
});

def("distribute", { w: 1 }, "Distribute layers evenly between the outermost ones. args: comp, layer(s) (3+), axis x|y, [by] center|gap, [time]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), t = num(a.time, c.time), X = a.axis !== "y", i;
    if (ls.length < 3) fail("Need at least 3 layers");
    var items = [];
    for (i = 0; i < ls.length; i++) { var b = boundsOf(ls[i], t); items.push({ l: ls[i], lo: X ? b.left : b.top, hi: X ? b.right : b.bottom }); }
    items.sort(function (p, q) { return (p.lo + p.hi) - (q.lo + q.hi); });
    var first = items[0], last = items[items.length - 1], n = items.length;
    if (a.by === "gap") {
        var total = 0; for (i = 0; i < n; i++) total += items[i].hi - items[i].lo;
        var gap = (last.hi - first.lo - total) / (n - 1), pos = first.hi + gap;
        for (i = 1; i < n - 1; i++) { var d = pos - items[i].lo; moveLayerBy(items[i].l, X ? d : 0, X ? 0 : d); pos += items[i].hi - items[i].lo + gap; }
    } else {
        var c0 = (first.lo + first.hi) / 2, c1 = (last.lo + last.hi) / 2;
        for (i = 1; i < n - 1; i++) { var dd = c0 + (c1 - c0) * i / (n - 1) - (items[i].lo + items[i].hi) / 2; moveLayerBy(items[i].l, X ? dd : 0, X ? 0 : dd); }
    }
    return { count: n };
});

def("centerAnchor", { w: 1 }, "Move anchor point to content center (or a corner) without visual jump. args: comp, layer(s), [where] center|topLeft|top|topRight|left|right|bottomLeft|bottom|bottomRight, [time]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), t = num(a.time, c.time), r = [];
    var W = { center: [0.5, 0.5], topLeft: [0, 0], top: [0.5, 0], topRight: [1, 0], left: [0, 0.5], right: [1, 0.5], bottomLeft: [0, 1], bottom: [0.5, 1], bottomRight: [1, 1] }[a.where || "center"];
    if (!W) fail("Bad where: " + a.where);
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i], tr = l.property("ADBE Transform Group"), ap = tr.property("ADBE Anchor Point");
        if (ap.numKeys || ap.expression !== "") fail("Anchor of " + l.name + " is keyed or has an expression");
        var s = l.sourceRectAtTime(t, false), old = ap.value;
        var na = [s.left + s.width * W[0], s.top + s.height * W[1]];
        var M = layerMatrix(l, t), p0 = applyMat(M, old[0], old[1]), p1 = applyMat(M, na[0], na[1]);
        withUnlocked(l, function () {
            var nv = old.slice(0); nv[0] = na[0]; nv[1] = na[1];
            ap.setValue(nv);
            moveLayerBy(l, p1[0] - p0[0], p1[1] - p0[1]);
        });
        r.push({ layer: lref(l), anchor: rnd(na) });
    }
    return r;
});

def("fitToComp", { w: 1 }, "Scale & center layers to the comp. args: comp, layer(s), [mode] fit|fill|width|height|none (none = only center), [time]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), t = num(a.time, c.time), r = [];
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i];
        if (l.parent) fail("fitToComp works on unparented layers: " + l.name);
        RB.cmds.centerAnchor.fn({ comp: c.id, layer: l.index, time: t });
        var tr = l.property("ADBE Transform Group"), s = l.sourceRectAtTime(t, false), sc = tr.property("ADBE Scale");
        var fx = c.width / s.width, fy = c.height / s.height, k = null;
        switch (a.mode || "fit") {
            case "fit": k = Math.min(fx, fy); break;
            case "fill": k = Math.max(fx, fy); break;
            case "width": k = fx; break;
            case "height": k = fy; break;
        }
        withUnlocked(l, function () {
            if (k !== null) { var v = sc.value.slice(0); v[0] = k * 100 * (v[0] < 0 ? -1 : 1); v[1] = k * 100 * (v[1] < 0 ? -1 : 1); sc.setValue(v); }
            var b = compBounds(l, t);
            moveLayerBy(l, c.width / 2 - (b.left + b.right) / 2, c.height / 2 - (b.top + b.bottom) / 2);
        });
        r.push({ layer: lref(l), scale: rnd(sc.value) });
    }
    return r;
});

def("snapToPixel", { w: 1 }, "Round static position and anchor values to whole pixels. args: comp, layer(s)", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), n = 0;
    for (var i = 0; i < ls.length; i++) {
        withUnlocked(ls[i], function (l) {
            var tr = l.property("ADBE Transform Group"), ps = [tr.property("ADBE Anchor Point")];
            if (tr.property("ADBE Position").dimensionsSeparated) { ps.push(tr.property("ADBE Position_0")); ps.push(tr.property("ADBE Position_1")); }
            else ps.push(tr.property("ADBE Position"));
            for (var j = 0; j < ps.length; j++) {
                var p = ps[j];
                if (p.numKeys || p.expression !== "") continue;
                var v = p.value;
                if (isArr(v)) { for (var k = 0; k < v.length; k++) v[k] = Math.round(v[k]); } else v = Math.round(v);
                p.setValue(v); n++;
            }
        });
    }
    return { rounded: n };
});

// ---------------------------------------------------------------- 3D
def("cameraOptions", { w: 1 }, "Camera options. args: comp, layer, values:{zoom, depthOfField, focusDistance, aperture, blurLevel, or any option name}", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), r;
    if (!(l instanceof CameraLayer)) fail("Not a camera: " + l.name);
    withUnlocked(l, function () { r = setGroupValues(l, "ADBE Camera Options Group", a.values || {}, CAMERA_KEYS); });
    return { set: r };
});
def("lightOptions", { w: 1 }, "Light options. args: comp, layer, [lightType], values:{intensity, color, coneAngle, coneFeather, castsShadows, shadowDarkness, shadowDiffusion, ...}", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), r;
    if (!(l instanceof LightLayer)) fail("Not a light: " + l.name);
    withUnlocked(l, function () {
        if (a.lightType) l.lightType = enumVal("LightType", a.lightType);
        r = setGroupValues(l, "ADBE Light Options Group", a.values || {}, LIGHT_KEYS);
    });
    return { set: r };
});
def("materialOptions", { w: 1 }, "3D material options. args: comp, layer(s), values:{castsShadows, lightTransmission, acceptsShadows, acceptsLights, ambient, diffuse, specular, shininess, metal}", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) withUnlocked(ls[i], function (l) { r.push(setGroupValues(l, "ADBE Material Options Group", a.values || {}, MATERIAL_KEYS)); });
    return { set: r };
});
def("lookAt", { w: 1 }, "Aim a camera/light (point of interest) or orient a 3D layer toward a point or layer. args: comp, layer(s), target:[x,y,z] | targetLayer, [live] use an expression that follows the target", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), r = [];
    for (var i = 0; i < ls.length; i++) {
        var l = ls[i], isCam = (l instanceof CameraLayer) || (l instanceof LightLayer);
        withUnlocked(l, function () {
            var tref = a.targetLayer !== undefined ? getLayer(c, a.targetLayer) : null;
            var tExpr = tref ? 'thisComp.layer("' + tref.name.replace(/"/g, '\\"') + '").toWorld([0,0,0])' : "[" + a.target.join(",") + "]";
            if (isCam) {
                var poi = l.property("ADBE Transform Group").property("ADBE Anchor Point");
                if (a.live || tref) setExpr(poi, tExpr); else poi.setValue(a.target);
            } else {
                if (!l.threeDLayer) fail("lookAt needs a 3D layer: " + l.name);
                setExpr(l.property("ADBE Transform Group").property("ADBE Orientation"), "lookAt(toWorld(anchorPoint), " + tExpr + ")");
            }
        });
        r.push(lref(l));
    }
    return r;
});
def("renderer3D", { w: 1 }, "Comp 3D renderer. args: comp, renderer classic|cinema4d|advanced|<internal name>", function (a) {
    var c = getComp(a.comp), map = { classic: "ADBE Calder", cinema4d: "ADBE Ernst", advanced: "ADBE Advanced 3d" };
    var name = map[String(a.renderer).toLowerCase()] || a.renderer;
    if (idxOf(c.renderers, name) < 0) fail("Renderer not available: " + name + ". Available: " + c.renderers.join(", "));
    c.renderer = name;
    return { renderer: c.renderer };
});
def("motionBlurSettings", { w: 1 }, "Motion blur. args: comp, [enabled] comp switch, [shutterAngle], [shutterPhase], [samplesPerFrame], [adaptiveLimit], [layers|match|all] + [layerMotionBlur] bool", function (a) {
    var c = getComp(a.comp);
    if (a.enabled !== undefined) c.motionBlur = !!a.enabled;
    if (a.shutterAngle !== undefined) c.shutterAngle = a.shutterAngle;
    if (a.shutterPhase !== undefined) c.shutterPhase = a.shutterPhase;
    if (a.samplesPerFrame !== undefined) c.motionBlurSamplesPerFrame = a.samplesPerFrame;
    if (a.adaptiveLimit !== undefined) c.motionBlurAdaptiveSampleLimit = a.adaptiveLimit;
    var n = 0;
    if (a.layerMotionBlur !== undefined) {
        var ls = getLayers(c, a);
        for (var i = 0; i < ls.length; i++) withUnlocked(ls[i], function (l) { try { l.motionBlur = !!a.layerMotionBlur; n++; } catch (e) {} });
    }
    return { comp: compOut(c), layersChanged: n };
});

// ---------------------------------------------------------------- render
function addRQ(c, a, file) {
    var q = app.project.renderQueue.items.add(c);
    if (a.renderTemplate) q.applyTemplate(a.renderTemplate);
    if (a.outputTemplate) q.outputModule(1).applyTemplate(a.outputTemplate);
    if (a.range) { q.timeSpanStart = a.range[0]; q.timeSpanDuration = a.range[1] - a.range[0]; }
    else if (a.workArea !== false) { q.timeSpanStart = c.workAreaStart; q.timeSpanDuration = c.workAreaDuration; }
    q.outputModule(1).file = new File(file);
    return q;
}
def("addToRenderQueue", { w: 1 }, "Add comp to Render Queue (does not render). args: comp, file (output, allowed folders), [renderTemplate], [outputTemplate], [range:[start,end]] or [workArea=true]", function (a) {
    var c = getComp(a.comp), file = safeOut(a.file || ("renders/" + safeName(c.name) + ".mov"));
    var q = addRQ(c, a, file);
    return { index: app.project.renderQueue.numItems, file: file, renderTemplates: q.templates, outputTemplates: q.outputModule(1).templates };
});
def("clearRQ", { w: 1 }, "Remove render queue items. args: [onlyDone] | [indexes]", function (a) {
    var rq = app.project.renderQueue, n = 0;
    for (var i = rq.numItems; i >= 1; i--) {
        var q = rq.item(i);
        if (q.status === RQItemStatus.RENDERING) continue;
        if (a.indexes && idxOf(a.indexes, i) < 0) continue;
        if (a.onlyDone && q.status !== RQItemStatus.DONE) continue;
        q.remove(); n++;
    }
    return { removed: n };
});
def("startRender", { w: 1, noUndo: 1 }, "Render the whole queue now (blocks AE until done). args: confirm:true", function (a) {
    if (a.confirm !== true) fail("Pass confirm:true");
    app.project.renderQueue.render();
    return RB.cmds.listRQ.fn({});
});
def("queueInAME", { w: 1, noUndo: 1 }, "Send queued items to Adobe Media Encoder. args: [render] start immediately", function (a) {
    var rq = app.project.renderQueue;
    if (!rq.canQueueInAME) fail("Nothing to queue or AME not available");
    rq.queueInAME(!!a.render);
    return { queued: true };
});
def("renderPreview", { w: 1, noUndo: 1 }, "Quick H.264 preview of a range (blocks AE while rendering; other queue items are kept but skipped). args: comp, [range:[start,end]] (default work area), [file], [half=true] half resolution", function (a) {
    var c = getComp(a.comp), rq = app.project.renderQueue;
    var file = safeOut(a.file || ("previews/" + safeName(c.name) + "_" + fileStamp() + ".mp4"));
    var states = [];
    for (var i = 1; i <= rq.numItems; i++) { try { states.push([i, rq.item(i).render]); if (rq.item(i).status !== RQItemStatus.DONE) rq.item(i).render = false; } catch (e) {} }
    var q = app.project.renderQueue.items.add(c), qi = rq.numItems;
    try {
        var oms = q.outputModule(1).templates, pick = null, prefs = ["H.264 - Match Render Settings - 15 Mbps", "H.264 - Match Render Settings - 5 Mbps", "H.264 - Match Render Settings - 40 Mbps"];
        for (var p = 0; p < prefs.length && !pick; p++) if (idxOf(oms, prefs[p]) >= 0) pick = prefs[p];
        if (!pick) for (var o = 0; o < oms.length && !pick; o++) if (/H\.?264/i.test(oms[o])) pick = oms[o];
        if (pick) q.outputModule(1).applyTemplate(pick); else warn("No H.264 output template found, using default output module");
        if (idxOf(q.templates, "Draft Settings") >= 0) q.applyTemplate("Draft Settings");
        if (a.half !== false) try { q.setSetting("Resolution", "Half"); } catch (e) {}
        if (a.range) { q.timeSpanStart = a.range[0]; q.timeSpanDuration = a.range[1] - a.range[0]; }
        else { q.timeSpanStart = c.workAreaStart; q.timeSpanDuration = c.workAreaDuration; }
        q.outputModule(1).file = new File(file);
        rq.render();
    } finally {
        try { rq.item(qi).remove(); } catch (e) {}
        for (var s = 0; s < states.length; s++) { try { rq.item(states[s][0]).render = states[s][1]; } catch (e) {} }
    }
    var out = new File(file);
    return { file: file, exists: out.exists };
});

// ---------------------------------------------------------------- menu commands (fixed whitelist only)
var MENU = {
    undo: { id: 16 },
    createShapesFromText: { name: "Create Shapes from Text", id: 3781 },
    createShapesFromVectorLayer: { name: "Create Shapes from Vector Layer", id: 3973 },
    createMasksFromText: { name: "Create Masks from Text", id: 2933 },
    layerStyleDropShadow: { id: 9000 }, layerStyleInnerShadow: { id: 9001 }, layerStyleOuterGlow: { id: 9002 }, layerStyleInnerGlow: { id: 9003 },
    layerStyleBevelEmboss: { id: 9004 }, layerStyleSatin: { id: 9005 }, layerStyleColorOverlay: { id: 9006 }, layerStyleGradientOverlay: { id: 9007 },
    layerStyleStroke: { id: 9008 },
    convertAudioToKeyframes: { name: "Convert Audio to Keyframes" },
    convertToEditableText: { name: "Convert to Editable Text" },
    incrementAndSave: { name: "Increment and Save" }
};
function runMenu(key, c, ls) {
    var m = MENU[key];
    if (!m) fail("Menu command not in whitelist: " + key + ". Allowed: " + keysOf(MENU).join(", "));
    var id = m.id;
    if (m.name) {
        var found = 0;
        try { found = app.findMenuCommandId(m.name); } catch (e) {}
        if (found) id = found;
        if (!id) fail("Menu item '" + m.name + "' not found (AE UI language?)");
    }
    if (c) {
        c.openInViewer();
        if (ls) {
            for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
            for (var j = 0; j < ls.length; j++) ls[j].selected = true;
        }
    }
    app.executeCommand(id);
    return id;
}
def("menuCommand", { w: 1, noUndo: 1 }, "Run a whitelisted AE menu command on selected layers. args: command (undo|createShapesFromText|createShapesFromVectorLayer|createMasksFromText|layerStyleDropShadow|...Stroke|convertAudioToKeyframes|convertToEditableText|incrementAndSave), [comp], [layer(s)] to select first", function (a) {
    var c = a.comp !== undefined ? getComp(a.comp) : null, ls = null;
    if (c && (a.layer !== undefined || a.layers || a.match !== undefined)) ls = getLayers(c, a);
    if (a.command === "incrementAndSave" && a.confirm !== true) fail("Pass confirm:true (this changes the working project file name)");
    var before = {}, j;
    if (c) for (j = 1; j <= c.numLayers; j++) before[c.layer(j).id] = 1;
    var id = runMenu(a.command, c, ls);
    var r = { command: a.command, id: id, newLayers: [] };
    if (c) for (j = 1; j <= c.numLayers; j++) if (!before[c.layer(j).id]) r.newLayers.push(lref(c.layer(j)));
    return r;
});
def("audioToKeyframes", { w: 1, noUndo: 1 }, "Analyze audio layer(s): creates 'Audio Amplitude' null (via menu) and reports pauses. args: comp, layer(s), [silence=2] amplitude threshold, [minGap=0.25] s, [keep=false] keep the null layer", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), before = {}, j, nl = null;
    for (j = 1; j <= c.numLayers; j++) before[c.layer(j).id] = 1;
    runMenu("convertAudioToKeyframes", c, ls);
    for (j = 1; j <= c.numLayers; j++) if (!before[c.layer(j).id] && /Audio Amplitude/i.test(c.layer(j).name)) { nl = c.layer(j); break; }
    if (!nl) fail("Audio Amplitude layer was not found after the menu command");
    var fx = nl.property("ADBE Effect Parade"), sl = null;
    for (var i = 1; i <= fx.numProperties; i++) if (/Both/i.test(fx.property(i).name)) sl = fx.property(i).property(1);
    if (!sl) sl = fx.property(1).property(1);
    var thr = num(a.silence, 2), minGap = num(a.minGap, 0.25), pauses = [], start = null, peak = 0;
    for (var k = 1; k <= sl.numKeys; k++) {
        var v = sl.keyValue(k), t = sl.keyTime(k);
        peak = Math.max(peak, v);
        if (v < thr) { if (start === null) start = t; }
        else if (start !== null) { if (t - start >= minGap) pauses.push([rnd(start), rnd(t)]); start = null; }
    }
    if (start !== null && sl.numKeys && sl.keyTime(sl.numKeys) - start >= minGap) pauses.push([rnd(start), rnd(sl.keyTime(sl.numKeys))]);
    var r = { peak: rnd(peak), threshold: thr, pauses: pauses };
    if (!a.keep) { nl.remove(); } else r.layer = lref(nl);
    return r;
});

def("purgeCache", {}, "Purge AE caches. args: [target] all_caches|undo_caches|snapshot_caches|image_caches", function (a) {
    app.purge(enumVal("PurgeTarget", a.target || "ALL_CACHES"));
    return { purged: a.target || "ALL_CACHES" };
});

// ---------------------------------------------------------------- batch
def("batch", {}, "Run several commands in order as ONE undo step. Stops at first error. args: commands:[{command, args}], [undoName]", function (a) {
    if (!a.commands || !a.commands.length) fail("commands are required");
    var anyWrite = false, i;
    for (i = 0; i < a.commands.length; i++) {
        var cm = RB.cmds[a.commands[i].command];
        if (!cm) fail("Unknown command in batch: " + a.commands[i].command);
        if (a.commands[i].command === "batch") fail("Nested batch is not allowed");
        if (cm.w) anyWrite = true;
        if (cm.noUndo && cm.w) fail("'" + a.commands[i].command + "' cannot run inside batch");
    }
    if (anyWrite && !RB.allowWrites()) fail("Batch contains write commands, but 'Allow changes' is off");
    var results = [];
    if (anyWrite) app.beginUndoGroup("BridgeLine: " + (a.undoName || "batch"));
    try {
        for (i = 0; i < a.commands.length; i++) {
            try { results.push({ command: a.commands[i].command, ok: true, result: RB.run(a.commands[i].command, a.commands[i].args || {}, true) }); }
            catch (e) { results.push({ command: a.commands[i].command, ok: false, error: errStr(e) }); fail("Batch stopped at #" + (i + 1) + " " + a.commands[i].command + ": " + errStr(e) + " | done before: " + i); }
        }
    } finally { if (anyWrite) app.endUndoGroup(); }
    return results;
});
// ================================================================ PANEL UI + POLLING

// Several AE versions (e.g. 2026 and Beta) can run at once, each with this panel
// listening to the same exchange folder. A command that carries a "project" field
// belongs to the instance that has that project open: every other instance leaves
// the file untouched for RB.claimWait seconds so the right one can claim it.
// After that the command is taken anyway and answered with the project-guard error,
// so the client gets a clear message instead of a timeout.
RB.claimWait = 15;
RB.skippedId = null;

function projectMatches(p) {
    var cur = app.project.file ? app.project.file.fsName : "(unsaved project)";
    var want = p;
    try { want = new File(p).fsName; } catch (e) {}
    return cur === want;
}

function cmdAgeSec(f) {
    try {
        var m = f.modified;
        if (!m) return 9999;
        return (new Date().getTime() - m.getTime()) / 1000;
    } catch (e) { return 9999; }
}

RB.tick = function () {
    if (RB.busy || !RB.ui || !RB.ui.listen.value) return;
    var f = new File(RB.cmdPath);
    if (!f.exists) return;
    RB.busy = true;
    var raw = null;
    try { raw = readText(RB.cmdPath); }
    catch (e) { RB.busy = false; return; }
    var t0 = new Date().getTime(), res = { id: null, ok: false }, cmd = null, peek = null;
    RB.warnings = [];
    try { peek = jsonParse(raw); } catch (ep) { peek = null; }
    if (peek && peek.project && !projectMatches(peek.project) && cmdAgeSec(f) < RB.claimWait) {
        if (RB.skippedId !== peek.id) {
            RB.skippedId = peek.id;
            RB.log("~ " + peek.command + ": addressed to another project, left for the other AE instance");
        }
        RB.busy = false;
        return;
    }
    if (!f.exists) { RB.busy = false; return; }
    try { f.remove(); } catch (er) { RB.busy = false; return; }
    try {
        cmd = jsonParse(raw);
        res.id = cmd.id; res.command = cmd.command;
        if (cmd.project && !projectMatches(cmd.project)) {
            var cur = app.project.file ? app.project.file.fsName : "(unsaved project)";
            fail("Project guard: command is for '" + cmd.project + "' but the open project is '" + cur + "'. Nothing was run. (No listening AE has that project open.)");
        }
        RB.log("> " + cmd.command + " " + shorten(jsonStr(cmd.args || {}), 140));
        RB.setStatus("Running: " + cmd.command);
        res.result = RB.run(cmd.command, cmd.args || {});
        res.ok = true;
        RB.log("  ok (" + (new Date().getTime() - t0) + " ms)");
    } catch (e) {
        res.error = errStr(e);
        RB.log("! " + res.error);
    }
    res.ms = new Date().getTime() - t0;
    res.finished = stamp();
    if (RB.warnings.length) res.warnings = RB.warnings;
    try { writeAtomic(RB.resPath, jsonStr(res, " ")); }
    catch (e2) { RB.log("! cannot write result: " + errStr(e2)); }
    RB.setStatus();
    RB.busy = false;
};

RB.setStatus = function (s) {
    if (!RB.ui) return;
    try {
        RB.ui.status.text = s || ((RB.ui.listen.value ? "Listening" : "Paused") + "  |  " + (RB.allowWrites() ? "CHANGES ALLOWED" : "read-only"));
    } catch (e) {}
};

function saveSetting(k, v) { try { app.settings.saveSetting("BridgeLine", k, v); } catch (e) {} }
function loadSetting(k, def) {
    try { if (app.settings.haveSetting("BridgeLine", k)) return app.settings.getSetting("BridgeLine", k); } catch (e) {}
    return def;
}

function buildUI(thisObj) {
    var w = (thisObj instanceof Panel) ? thisObj : new Window("palette", "BridgeLine", undefined, { resizeable: true });
    w.orientation = "column"; w.alignChildren = ["fill", "top"]; w.spacing = 4; w.margins = 6;

    var title = w.add("statictext", undefined, "BridgeLine v" + RB.VERSION);
    var status = w.add("statictext", undefined, "", { truncate: "end" });
    status.preferredSize.width = 260;

    var g1 = w.add("group"); g1.alignChildren = ["left", "center"];
    var listen = g1.add("checkbox", undefined, "Listen");
    var allow = g1.add("checkbox", undefined, "Allow changes");
    listen.value = loadSetting("listen", "1") === "1";
    allow.value = false; // always start read-only

    var g2 = w.add("group"); g2.alignChildren = ["fill", "center"];
    var bSel = g2.add("button", undefined, "Send selection");
    var bUndo = g2.add("button", undefined, "Undo last");

    var note = w.add("edittext", undefined, "", { multiline: true, scrollable: true });
    note.preferredSize.height = 48;
    var g3 = w.add("group"); g3.alignChildren = ["fill", "center"];
    var bNote = g3.add("button", undefined, "Send note");
    var bOpen = g3.add("button", undefined, "Open folder");

    var list = w.add("listbox", undefined, []);
    list.preferredSize.height = 180;
    list.alignment = ["fill", "fill"];

    RB.ui = { win: w, status: status, listen: listen, allow: allow, list: list };

    listen.onClick = function () { saveSetting("listen", listen.value ? "1" : "0"); RB.setStatus(); };
    allow.onClick = function () { RB.log(allow.value ? "Changes ALLOWED" : "Read-only"); RB.setStatus(); };
    bSel.onClick = function () {
        try {
            var st = RB.cmds.activeState.fn({});
            writeText(RB.root + "/selection.json", jsonStr(st, " "));
            RB.log("Selection sent (" + (st.selectedLayers ? st.selectedLayers.length : 0) + " layers, " + (st.selectedProperties ? st.selectedProperties.length : 0) + " props)");
        } catch (e) { RB.log("! " + errStr(e)); }
    };
    bUndo.onClick = function () {
        try { app.executeCommand(16); RB.log("Undo"); } catch (e) { RB.log("! " + errStr(e)); }
    };
    bNote.onClick = function () {
        var txt = trim(note.text);
        if (!txt) return;
        try {
            var notes = [];
            try { notes = jsonParse(readText(RB.root + "/notes.json")); } catch (e0) {}
            var entry = { time: stamp(), text: txt };
            try {
                var st = RB.cmds.activeState.fn({});
                entry.activeItem = st.activeItem ? st.activeItem.name : null;
                entry.cti = st.cti; entry.selectedLayers = st.selectedLayers;
            } catch (e1) {}
            notes.push(entry);
            writeText(RB.root + "/notes.json", jsonStr(notes, " "));
            note.text = "";
            RB.log("Note sent");
        } catch (e) { RB.log("! " + errStr(e)); }
    };
    bOpen.onClick = function () { new Folder(RB.root).execute(); };

    w.onResizing = w.onResize = function () { this.layout.resize(); };
    RB.setStatus();
    if (w instanceof Window) { w.center(); w.show(); } else { w.layout.layout(true); w.layout.resize(); }
    return w;
}

// ---------------------------------------------------------------- start
ensureFolder(RB.root);
buildUI(thisObj);
RB.log("Started. Bridge folder: " + RB.root + "  (" + keysOf(RB.cmds).length + " commands)");
$.global.__bridgeLineTick = function () { try { RB.tick(); } catch (e) { RB.busy = false; } };
try { if ($.global.__bridgeLineTask) app.cancelTask($.global.__bridgeLineTask); } catch (e) {}
$.global.__bridgeLineTask = app.scheduleTask("__bridgeLineTick()", 300, true);

})(this);
