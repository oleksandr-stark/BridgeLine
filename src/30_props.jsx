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
