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
