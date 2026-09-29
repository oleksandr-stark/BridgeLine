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
