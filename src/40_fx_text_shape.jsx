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
