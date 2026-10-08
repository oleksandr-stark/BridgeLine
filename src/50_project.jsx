// ================================================================ COMPS / PROJECT / MARKERS / RETIME / LAYOUT / 3D / RENDER / MENU

def("createComp", { w: 1 }, "Create comp. args: name, [width=1920], [height=1080], [pixelAspect=1], [duration=10], [frameRate=30], [bgColor], [folder], [ifExists] 'error'|'reuse' (keep as is)|'clear' (remove layers & markers, keep links)", function (a) {
    if (!a.name) fail("name is required");
    var ex = null;
    for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof CompItem && it.name === a.name) { ex = it; break; } }
    var W = num(a.width, 1920), H = num(a.height, 1080), D = num(a.duration, 10), F = num(a.frameRate, 30), c;
    if (ex) {
        var mode = a.ifExists || "error";
        if (mode === "error") fail("Comp already exists: '" + a.name + "' (id " + ex.id + "). Use ifExists 'reuse' or 'clear'.");
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

def("duplicateComp", { w: 1 }, "Duplicate comp. deep:true also duplicates nested precomps (each once, cycles safe); deep:'text' only the precomps that contain text layers (language versions: everything else stays shared). Expressions in the copies that name a duplicated comp (comp(\"Name\")) are re-pointed. args: comp, [name], [folder], [deep] false|true|'text', [suffix] for nested copies (default ' copy'), [dryRun]", function (a) {
    var c = getComp(a.comp), deep = a.deep, suffix = a.suffix !== undefined ? String(a.suffix) : " copy";
    var memo = {}, plan = [], shared = [], map = {}, renames = [], k;
    function hasText(cc, seen) {
        if (memo[cc.id] !== undefined) return memo[cc.id];
        if (seen[cc.id]) return false;
        seen[cc.id] = 1;
        var r = false;
        for (var i = 1; i <= cc.numLayers && !r; i++) {
            var l = cc.layer(i);
            if (l instanceof TextLayer) r = true;
            else if (l.source instanceof CompItem && hasText(l.source, seen)) r = true;
        }
        memo[cc.id] = r;
        return r;
    }
    function wanted(cc) { return deep === true || (deep === "text" && hasText(cc, {})); }
    function walkPlan(cc, seen) {
        for (var i = 1; i <= cc.numLayers; i++) {
            var src = cc.layer(i).source;
            if (!(src instanceof CompItem) || seen[src.id]) continue;
            seen[src.id] = 1;
            if (wanted(src)) { plan.push(src.name); walkPlan(src, seen); } else shared.push(src.name);
        }
    }
    if (deep) walkPlan(c, {});
    if (a.dryRun) return { dryRun: true, comp: c.name, nestedToDuplicate: plan, nestedShared: shared };
    function dup(cc, name, folder) {
        var d = cc.duplicate();
        d.name = name;
        if (folder) d.parentFolder = folder;
        map[cc.id] = d;
        renames.push([cc.name, d.name]);
        if (!deep) return d;
        for (var i = 1; i <= d.numLayers; i++) {
            var l = d.layer(i), src = l.source;
            if (!(src instanceof CompItem) || !wanted(src)) continue;
            if (!map[src.id]) { map[src.id] = "busy"; dup(src, src.name + suffix, folder); }
            if (map[src.id] !== "busy") withUnlocked(l, function (x) { x.replaceSource(map[src.id], false); });
        }
        return d;
    }
    var folder = a.folder !== undefined ? getFolder(a.folder, true) : null;
    var top = dup(c, a.name || (c.name + " copy"), folder);
    // re-point expressions in the copies: comp("Old") -> comp("New")
    var fixed = 0;
    if (deep) {
        for (k in map) if (has(map, k) && map[k] !== "busy") {
            var cc = map[k];
            for (var i = 1; i <= cc.numLayers; i++) walkProps(cc.layer(i), function (p) {
                try {
                    if (!p.canSetExpression || p.expression === "") return;
                    var e = p.expression, e2 = e;
                    for (var j = 0; j < renames.length; j++) e2 = e2.split('comp("' + renames[j][0] + '")').join('comp("' + renames[j][1] + '")');
                    if (e2 !== e) { p.expression = e2; fixed++; }
                } catch (x) {}
            });
        }
    }
    var out = compOut(top);
    out.duplicated = renames.length;
    out.copies = renames;
    out.nestedShared = shared;
    if (fixed) out.expressionsRepointed = fixed;
    return out;
});

def("resizeComp", { w: 1 }, "Change comp size and keep the content where it was relative to an anchor (layers without a parent move, keys included; cameras/lights keep their aim). For V/VQ/16x9 versions. args: comp, width, height, [anchor] center|topLeft|top|topRight|left|right|bottomLeft|bottom|bottomRight", function (a) {
    var c = getComp(a.comp), w0 = c.width, h0 = c.height, w1 = Math.round(num(a.width, w0)), h1 = Math.round(num(a.height, h0));
    var an = String(a.anchor || "center"), fx = /Left$|^left$/.test(an) ? 0 : (/Right$|^right$/.test(an) ? 1 : 0.5), fy = /^top/.test(an) ? 0 : (/^bottom/.test(an) ? 1 : 0.5);
    var dx = (w1 - w0) * fx, dy = (h1 - h0) * fy, moved = 0;
    c.width = w1; c.height = h1;
    for (var i = 1; i <= c.numLayers; i++) {
        var l = c.layer(i);
        if (l.parent || (dx === 0 && dy === 0)) continue;
        withUnlocked(l, function (x) {
            moveLayerBy(x, dx, dy);
            if (x instanceof CameraLayer || x instanceof LightLayer) {
                try {   // point of interest lives in the anchor point of cameras and lights
                    var poi = x.property("ADBE Transform Group").property("ADBE Anchor Point");
                    if (poi.numKeys) { for (var k = 1; k <= poi.numKeys; k++) { var v = poi.keyValue(k); v[0] += dx; v[1] += dy; poi.setValueAtKey(k, v); } }
                    else { var v2 = poi.value; v2[0] += dx; v2[1] += dy; poi.setValue(v2); }
                } catch (e) {}
            }
        });
        moved++;
    }
    return { comp: compOut(c), from: [w0, h0], to: [w1, h1], anchor: an, offset: [rnd(dx), rnd(dy)], layersMoved: moved };
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
        if (!a.force && !(it instanceof FolderItem) && it.usedIn.length) fail("Item is used in " + it.usedIn.length + " comp(s): '" + it.name + "' (pass force)");
        if (!a.force && it instanceof FolderItem && it.numItems) fail("Folder is not empty: '" + it.name + "' (pass force)");
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
    var f = mapFn(a.map), comps = getComps(a, false), plan = [], collisions = [], i, j;
    if (a.remapKeys) {
        // check every keyed property first: refuse before anything moves if two keys would land on the same time
        for (i = 0; i < comps.length; i++) for (j = 1; j <= comps[i].numLayers; j++) {
            (function (c, l) {
                walkProps(l, function (p) {
                    try {
                        if (!p.numKeys || p.matchName === "ADBE Marker") return;
                        var caps = [];
                        for (var k = 1; k <= p.numKeys; k++) caps.push({ t: p.keyTime(k), nt: f(p.keyTime(k)) });
                        var hit = keyCollisions(caps);
                        if (hit && collisions.length < 20) collisions.push({ comp: c.name, layer: l.name, path: propPath(p), keys: hit });
                    } catch (e) {}
                });
            })(comps[i], comps[i].layer(j));
        }
        if (collisions.length && !a.dryRun) fail("The map would put two keys on the same time in " + collisions.length + " place(s), nothing was changed. First: " +
            collisions[0].comp + " / " + collisions[0].layer + " / " + collisions[0].path + " (" + collisions[0].keys + "). Run with dryRun:true to see all.");
    }
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
    return { dryRun: !!a.dryRun, layers: plan.length, keyCollisions: collisions, plan: plan.slice(0, 300) };
});

def("placeAudioCues", { w: 1 }, "Place sound effects from a cue list. Everything is checked first (files, items, times) and nothing changes if anything is wrong; dryRun shows the plan. Files are imported once into [folder]. args: comp, cues:[{t, file | item, [name], [level] dB, [duration]}], [folder='SFX'], [dryRun]", function (a) {
    var c = getComp(a.comp), cues = a.cues, plan = [], errs = [], i;
    if (!cues || !cues.length) fail("cues are required");
    for (i = 0; i < cues.length; i++) {
        var q = cues[i], t = q.t !== undefined ? parseTime(q.t, c.frameRate) : null, src = null;
        if (t === null || isNaN(t)) errs.push("cue " + (i + 1) + ": no time");
        else if (t < 0 || t >= c.duration) errs.push("cue " + (i + 1) + ": time " + rnd(t) + " is outside the comp (0-" + rnd(c.duration) + ")");
        if (q.item !== undefined) { try { src = getItem(q.item); } catch (e) { errs.push("cue " + (i + 1) + ": " + errStr(e)); } }
        else if (q.file) { if (!new File(q.file).exists) errs.push("cue " + (i + 1) + ": file not found: " + q.file); }
        else errs.push("cue " + (i + 1) + ": file or item is required");
        plan.push({ cue: i + 1, t: t === null ? null : rnd(t), source: q.item !== undefined ? String(q.item) : q.file, name: q.name || null, level: q.level === undefined ? null : q.level });
    }
    if (errs.length) fail("Nothing was placed: " + errs.join("; "));
    if (a.dryRun) return { dryRun: true, cues: plan };
    var imported = {}, out = [], folder = getFolder(a.folder || "SFX", true);
    for (i = 0; i < cues.length; i++) {
        var cq = cues[i], it = null;
        if (cq.item !== undefined) it = getItem(cq.item);
        else {
            var key = new File(cq.file).fsName;
            if (!imported[key]) { imported[key] = app.project.importFile(new ImportOptions(new File(key))); imported[key].parentFolder = folder; }
            it = imported[key];
        }
        var l = c.layers.add(it);
        l.startTime = parseTime(cq.t, c.frameRate);
        if (cq.name) l.name = cq.name;
        if (cq.duration) l.outPoint = l.startTime + Number(cq.duration);
        if (cq.level !== undefined) {
            // layer.property("ADBE Audio Levels") is null on audio layers: use the shortcut, the group walk as a fallback
            var lv = null; try { lv = l.audioLevels; } catch (e0) {}
            if (!lv) try { lv = l.property("ADBE Audio Group").property("ADBE Audio Levels"); } catch (e1) {}
            if (lv) lv.setValue([Number(cq.level), Number(cq.level)]); else warn("Audio Levels not reachable on " + l.name + ": level not set");
        }
        out.push(lref(l));
    }
    return { placed: out.length, layers: out, imported: keysOf(imported).length };
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
            if (!io.canImportAs(ImportAsType[ty])) fail("Cannot import '" + f.name + "' as " + a["as"]);
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

def("cleanupProject", { w: 1, irreversible: 1 }, "Project cleanup (needs confirm:true). args: action removeUnusedFootage|consolidateFootage|reduceProject, [comps] for reduceProject, confirm", function (a) {
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

function backupFolder() {
    if (!app.project.file) fail("Project was never saved");
    return new Folder(app.project.file.parent.fsName + "/_backup");
}
def("listBackups", {}, "Backups of the open project in <project folder>/_backup (newest first). args: [limit=30]", function (a) {
    var pf = app.project.file, base = pf ? pf.name.replace(/\.aep$/i, "") : "", fo = backupFolder(), out = [];
    var fs = fo.exists ? fo.getFiles(function (f) { return f instanceof File && /\.aep$/i.test(f.name) && f.name.indexOf(base + "_") === 0; }) : [];
    fs.sort(function (x, y) { return y.modified.getTime() - x.modified.getTime(); });
    for (var i = 0; i < fs.length && i < num(a.limit, 30); i++) out.push({ file: fs[i].fsName, name: fs[i].name, modified: fs[i].modified.toString(), bytes: fs[i].length });
    return { folder: fo.fsName, count: fs.length, backups: out };
});
def("restoreBackup", { w: 1, noUndo: 1 }, "Replace the project with a backup and reopen it. The current saved file is first backed up as '..._before_restore'. Refuses with unsaved changes unless discardUnsaved. args: file (from listBackups), confirm:true, [discardUnsaved]", function (a) {
    if (a.confirm !== true) fail("Pass confirm:true");
    var pf = app.project.file;
    if (!pf) fail("Project was never saved");
    var src = new File(a.file);
    if (!src.exists) fail("Backup not found: " + a.file);
    if (!isUnder(src.fsName, backupFolder().fsName)) fail("Only files from " + backupFolder().fsName + " can be restored");
    var dirty = false; try { dirty = app.project.dirty; } catch (e) {}
    if (dirty && a.discardUnsaved !== true) fail("The project has unsaved changes. Save first (saveProject) or pass discardUnsaved:true");
    var safety = RB.cmds.backupProject.fn({ label: "before_restore" }).backup;
    var path = pf.fsName;
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    var dest = new File(path);
    if (dest.exists) dest.remove();
    if (!src.copy(path)) fail("Copy failed: " + src.error + " (the previous state is in " + safety + ")");
    app.open(new File(path));
    return { restored: src.fsName, project: path, previousStateSavedAs: safety };
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
def("stack", { w: 1 }, "Line layers up one after another by their visual bounds with a gap (first layer stays, or starts at 'start'). args: comp, layers (in order), [axis] y|x (default y), [gap=20] px, [align] start|center|end on the other axis (default: keep), [start] [x,y] top-left of the first, [time]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), t = num(a.time, c.time), ax = a.axis === "x" ? "x" : "y", gap = num(a.gap, 20), i, out = [];
    if (ls.length < 2 && !a.start) fail("stack needs 2+ layers (or a start position)");
    var b0 = boundsOf(ls[0], t);
    if (a.start) { moveLayerBy(ls[0], a.start[0] - b0.left, a.start[1] - b0.top); b0 = boundsOf(ls[0], t); }
    var ref = b0, cursor = ax === "y" ? b0.bottom : b0.right;
    for (i = 1; i < ls.length; i++) {
        var b = boundsOf(ls[i], t), dx = 0, dy = 0;
        if (ax === "y") {
            dy = cursor + gap - b.top;
            if (a.align === "start") dx = ref.left - b.left; else if (a.align === "end") dx = ref.right - b.right; else if (a.align === "center") dx = (ref.left + ref.right) / 2 - (b.left + b.right) / 2;
        } else {
            dx = cursor + gap - b.left;
            if (a.align === "start") dy = ref.top - b.top; else if (a.align === "end") dy = ref.bottom - b.bottom; else if (a.align === "center") dy = (ref.top + ref.bottom) / 2 - (b.top + b.bottom) / 2;
        }
        moveLayerBy(ls[i], dx, dy);
        var nb = boundsOf(ls[i], t);
        cursor = ax === "y" ? nb.bottom : nb.right;
        out.push({ layer: lref(ls[i]), moved: rnd([dx, dy]) });
    }
    return { axis: ax, gap: gap, layers: out };
});

def("pin", { w: 1 }, "Put layers against an edge or corner of the frame by their visual bounds, with a margin (px, [x,y], or safe:0.9 = title-safe area). args: comp, layer(s), edge top|bottom|left|right|topLeft|topRight|bottomLeft|bottomRight|center, [margin=0], [safe] ratio, [time]", function (a) {
    var c = getComp(a.comp), ls = getLayers(c, a), t = num(a.time, c.time), e = String(a.edge || ""), out = [];
    var m = isArr(a.margin) ? a.margin : [num(a.margin, 0), num(a.margin, 0)];
    if (a.safe) { m = [m[0] + c.width * (1 - a.safe) / 2, m[1] + c.height * (1 - a.safe) / 2]; }
    var L = m[0], T = m[1], R = c.width - m[0], B = c.height - m[1];
    if (!/^(top|bottom|left|right|topLeft|topRight|bottomLeft|bottomRight|center)$/.test(e)) fail("edge must be top, bottom, left, right, topLeft, topRight, bottomLeft, bottomRight or center");
    for (var i = 0; i < ls.length; i++) {
        var b = boundsOf(ls[i], t), dx = 0, dy = 0;
        if (/left/i.test(e)) dx = L - b.left; else if (/right/i.test(e)) dx = R - b.right; else if (e !== "top" && e !== "bottom") dx = c.width / 2 - (b.left + b.right) / 2;
        if (/^top/.test(e)) dy = T - b.top; else if (/^bottom/.test(e)) dy = B - b.bottom; else if (e !== "left" && e !== "right") dy = c.height / 2 - (b.top + b.bottom) / 2;
        if (e === "top" || e === "bottom") dx = 0;
        if (e === "left" || e === "right") dy = 0;
        moveLayerBy(ls[i], dx, dy);
        out.push({ layer: lref(ls[i]), moved: rnd([dx, dy]) });
    }
    return { edge: e, margin: rnd(m), layers: out };
});

def("zoomToRect", { w: 1 }, "Push in on a rectangle or a layer: a rig null (anchor on the target) parents the layers and animates position + scale, so the target stays exactly on its path (no drift). args: comp, rect [x,y,w,h] | target (layer), range:[t0,t1], [fill=0.9] share of the frame the target fills, [layers] to put under the rig (default: all layers without a parent, not cameras/lights), [name='ZOOM_RIG'], [ease='easy'], [time] for the target bounds", function (a) {
    var c = getComp(a.comp), t = num(a.time, a.range ? a.range[0] : c.time), r, i;
    if (a.rect) r = { left: a.rect[0], top: a.rect[1], width: a.rect[2], height: a.rect[3] };
    else if (a.target !== undefined) { var tb = boundsOf(getLayer(c, a.target), t); r = { left: tb.left, top: tb.top, width: tb.right - tb.left, height: tb.bottom - tb.top }; }
    else fail("rect or target is required");
    if (!a.range) fail("range [t0,t1] is required");
    var t0 = parseTime(a.range[0], c.frameRate), t1 = parseTime(a.range[1], c.frameRate);
    var C = [r.left + r.width / 2, r.top + r.height / 2], fill = num(a.fill, 0.9);
    var s = Math.min(c.width * fill / r.width, c.height * fill / r.height) * 100;
    var rig = c.layers.addNull();
    rig.name = a.name || "ZOOM_RIG";
    var tr = rig.property("ADBE Transform Group"), P = tr.property("ADBE Position"), S = tr.property("ADBE Scale"), A = tr.property("ADBE Anchor Point");
    // the null's anchor sits at the centre of its 100x100 source: put its position on the target, scale around it
    P.setValue(C);
    var kids = [];
    if (a.layers) kids = getLayers(c, { layers: a.layers });
    else for (i = 1; i <= c.numLayers; i++) { var l = c.layer(i); if (l !== rig && !l.parent && !(l instanceof CameraLayer) && !(l instanceof LightLayer)) kids.push(l); }
    for (i = 0; i < kids.length; i++) withUnlocked(kids[i], function (x) { x.parent = rig; });   // parent with compensation: nothing moves
    var spec = { ease: a.ease === undefined ? "easy" : a.ease };
    P.setValueAtTime(t0, C); P.setValueAtTime(t1, [c.width / 2, c.height / 2]);
    S.setValueAtTime(t0, [100, 100]); S.setValueAtTime(t1, [s, s]);
    applyKeySpec(P, 1, spec); applyKeySpec(P, 2, spec); applyKeySpec(S, 1, spec); applyKeySpec(S, 2, spec);
    try { P.setSpatialTangentsAtKey(1, [0, 0], [0, 0]); P.setSpatialTangentsAtKey(2, [0, 0], [0, 0]); } catch (e) {}   // straight path
    rig.moveToBeginning();
    return { rig: lref(rig), target: { center: rnd(C), size: rnd([r.width, r.height]) }, scale: rnd(s), layersParented: kids.length, range: [rnd(t0), rnd(t1)] };
});

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
        if (ap.numKeys || ap.expression !== "") fail("Anchor of '" + l.name + "' is keyed or has an expression");
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

def("cameraMove", { w: 1 }, "Animate a camera with one move: dolly (toward the point of interest), truck (sideways), pedestal (up/down: negative = up), orbit (degrees around the point of interest), dollyZoom (dolly + zoom that keeps the subject size: Vertigo), handheld (wiggle). args: comp, layer (camera), move, amount (px; degrees for orbit; shake px for handheld), [range:[t0,t1]] (default work area), [ease='easy'], [steps=12] for orbit, [frequency=1.5] for handheld", function (a) {
    var c = getComp(a.comp), l = getLayer(c, a.layer), mv = String(a.move || "");
    if (!(l instanceof CameraLayer)) fail("cameraMove needs a camera layer: '" + l.name + "'");
    var tr = l.property("ADBE Transform Group"), P = tr.property("ADBE Position"), A = tr.property("ADBE Anchor Point");
    var twoNode = false; try { twoNode = l.autoOrient === AutoOrientType.CAMERA_OR_POINT_OF_INTEREST; } catch (e) {}
    var t0 = a.range ? parseTime(a.range[0], c.frameRate) : c.workAreaStart, t1 = a.range ? parseTime(a.range[1], c.frameRate) : c.workAreaStart + c.workAreaDuration;
    if (t1 <= t0) fail("range must go forward");
    var amt = num(a.amount, 0), spec = { ease: a.ease === undefined ? "easy" : a.ease }, out = { camera: l.name, move: mv, range: [rnd(t0), rnd(t1)] };
    var P0 = P.valueAtTime(t0, false), A0 = A.valueAtTime(t0, false);
    function key(p, t, v, sp) { p.setValueAtTime(t, v); if (sp) applyKeySpec(p, p.nearestKeyIndex(t), sp); }
    function plus(v, d) { return [v[0] + d[0], v[1] + d[1], v[2] + d[2]]; }
    var dir = [A0[0] - P0[0], A0[1] - P0[1], A0[2] - P0[2]], d0 = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if ((mv === "dolly" || mv === "dollyZoom" || mv === "orbit") && !twoNode) fail(mv + " needs a two-node camera (Auto-Orient towards point of interest)");
    withUnlocked(l, function () {
        if (mv === "dolly" || mv === "dollyZoom") {
            if (d0 < 1e-6) fail("camera sits on its point of interest");
            var u = [dir[0] / d0, dir[1] / d0, dir[2] / d0], P1 = plus(P0, [u[0] * amt, u[1] * amt, u[2] * amt]);
            key(P, t0, P0, spec); key(P, t1, P1, spec);
            if (mv === "dollyZoom") {
                var Z = l.property("ADBE Camera Options Group").property("ADBE Camera Zoom"), z0 = Z.valueAtTime(t0, false), d1 = d0 - amt;
                if (d1 <= 1) fail("dollyZoom amount brings the camera past its point of interest");
                key(Z, t0, z0, spec); key(Z, t1, z0 * d1 / d0, spec);
                out.zoom = [rnd(z0), rnd(z0 * d1 / d0)];
            }
            out.position = [rnd(P0), rnd(P1)];
        } else if (mv === "truck" || mv === "pedestal") {
            var d = mv === "truck" ? [amt, 0, 0] : [0, amt, 0];
            key(P, t0, P0, spec); key(P, t1, plus(P0, d), spec);
            if (twoNode) { key(A, t0, A0, spec); key(A, t1, plus(A0, d), spec); }
            out.offset = d;
        } else if (mv === "orbit") {
            var n = Math.max(2, Math.round(num(a.steps, 12))), ox = P0[0] - A0[0], oz = P0[2] - A0[2];
            for (var k = 0; k <= n; k++) {
                var ang = amt * k / n * Math.PI / 180, cs = Math.cos(ang), sn = Math.sin(ang);
                key(P, t0 + (t1 - t0) * k / n, [A0[0] + ox * cs - oz * sn, P0[1], A0[2] + ox * sn + oz * cs], (k === 0 || k === n) ? spec : null);
            }
            for (k = 2; k <= n; k++) try { P.setRovingAtKey(P.nearestKeyIndex(t0 + (t1 - t0) * (k - 1) / n), true); } catch (e) {}  // even speed
            out.degrees = amt; out.keys = n + 1;
        } else if (mv === "handheld") {
            var f = num(a.frequency, 1.5), am = amt || 15;
            setExpr(P, "wiggle(" + f + ", " + am + ")");
            if (twoNode) setExpr(A, "wiggle(" + f + ", " + (am * 0.6) + ")");
            out.expression = "wiggle(" + f + ", " + am + ")";
        } else fail("move must be dolly, truck, pedestal, orbit, dollyZoom or handheld");
    });
    return out;
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
// Output templates that write each extension (AE picks the container from the template, not from the file name:
// an .mp4 path with the default template silently becomes a huge lossless .mov).
var EXT_TEMPLATES = {
    mp4: /H\.?264/i, mov: /ProRes|Lossless|QuickTime|High Quality/i, avi: /AVI/i, png: /PNG/i, jpg: /JPE?G/i, jpeg: /JPE?G/i,
    tif: /TIFF/i, tiff: /TIFF/i, tga: /Targa/i, exr: /EXR/i, dpx: /DPX|Cineon/i, psd: /Photoshop/i, wav: /WAV|Audio Only/i, mp3: /MP3/i
};
var SEQ_EXT = { png: 1, jpg: 1, jpeg: 1, tif: 1, tiff: 1, tga: 1, exr: 1, dpx: 1, psd: 1 };
function fileExt(p) { var m = String(p).match(/\.([A-Za-z0-9]+)$/); return m ? m[1].toLowerCase() : ""; }
function clampSpan(c, a, q) {
    var t0 = a.range ? Number(a.range[0]) : (a.workArea !== false ? c.workAreaStart : 0);
    var t1 = a.range ? Number(a.range[1]) : (a.workArea !== false ? c.workAreaStart + c.workAreaDuration : c.duration);
    var c0 = Math.max(0, t0), c1 = Math.min(c.duration, t1);
    if (c0 !== t0 || c1 !== t1) warn("Render range clamped to the comp: [" + rnd(c0) + ", " + rnd(c1) + "] (asked [" + t0 + ", " + t1 + "])");
    if (c1 - c0 < c.frameDuration) fail("Render range is empty after clamping to the comp duration " + rnd(c.duration) + " s");
    q.timeSpanStart = c0; q.timeSpanDuration = c1 - c0;
}
function addRQ(c, a, file) {
    var ext = fileExt(file);
    if (SEQ_EXT[ext] && !/\[#+\]/.test(file)) file = file.replace(/\.([A-Za-z0-9]+)$/, "_[#####].$1");
    if (!SEQ_EXT[ext] && new File(file).exists && a.overwrite !== true) fail("Output file exists: '" + file + "'. Pass overwrite:true or another file.");
    var q = app.project.renderQueue.items.add(c), ok = false;
    try {
        if (a.renderTemplate) {
            if (idxOf(q.templates, a.renderTemplate) < 0) fail("Render template not found: '" + a.renderTemplate + "'. Available: " + q.templates.join(", "));
            q.applyTemplate(a.renderTemplate);
        }
        var om = q.outputModule(1), tpl = a.outputTemplate;
        if (tpl && idxOf(om.templates, tpl) < 0) fail("Output template not found: '" + tpl + "'. Available: " + om.templates.join(", "));
        if (tpl) om.applyTemplate(tpl);
        clampSpan(c, a, q);
        om.file = new File(file);
        var real = om.file ? om.file.fsName : "", rext = fileExt(real);
        if (!a.outputTemplate && ext && rext !== ext && EXT_TEMPLATES[ext]) {
            // the default template writes another container: try the templates that write this extension
            for (var i = 0; i < om.templates.length && rext !== ext; i++) {
                var t = om.templates[i];
                if (!EXT_TEMPLATES[ext].test(t) || /^_HIDDEN/.test(t)) continue;
                om.applyTemplate(t); om.file = new File(file);
                real = om.file ? om.file.fsName : ""; rext = fileExt(real); tpl = t;
            }
        }
        if (ext && rext && rext !== ext) fail("After Effects would write '." + rext + "', not '." + ext + "' (output template '" + (tpl || "default") +
            "'). " + (tpl ? "" : "No output template here writes ." + ext + ": make one in AE (Edit > Templates > Output Module), or use another extension. ") +
            "Templates: " + om.templates.join(", "));
        ok = true;
        return { q: q, file: real, template: tpl || null };
    } finally {
        if (!ok) try { q.remove(); } catch (e) {}
    }
}
def("addToRenderQueue", { w: 1 }, "Add comp to Render Queue (does not render). Picks an output template that writes the file's extension, refuses if AE would write another container, adds [#####] for image sequences, clamps the range to the comp. args: comp, file (output, allowed folders), [renderTemplate], [outputTemplate], [range:[start,end]] or [workArea=true], [overwrite]", function (a) {
    var c = getComp(a.comp), file = safeOut(a.file || ("renders/" + safeName(c.name) + ".mov"));
    var r = addRQ(c, a, file), q = r.q;
    return { index: app.project.renderQueue.numItems, file: r.file, outputTemplate: r.template, start: rnd(q.timeSpanStart), duration: rnd(q.timeSpanDuration),
             renderTemplates: q.templates, outputTemplates: q.outputModule(1).templates };
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
    var r = RB.cmds.listRQ.fn({});
    // which outputs really exist (an image sequence: count the frames)
    var outs = [];
    try {
        var rq = app.project.renderQueue;
        for (var i = 1; i <= rq.numItems; i++) {
            var q = rq.item(i);
            for (var m = 1; m <= q.numOutputModules; m++) {
                var f = q.outputModule(m).file;
                if (!f) continue;
                var o = { item: i, file: f.fsName, exists: f.exists };
                if (/\[#+\]/.test(f.name)) {
                    var pre = f.name.split("[")[0], list = f.parent.getFiles(function (x) { return x instanceof File && x.name.indexOf(pre) === 0; });
                    o.frames = list.length; o.exists = list.length > 0;
                }
                outs.push(o);
            }
        }
    } catch (e) {}
    r.outputs = outs;
    return r;
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
        clampSpan(c, a, q);
        q.outputModule(1).file = new File(file);
        var real = q.outputModule(1).file.fsName;
        if (fileExt(real) !== fileExt(file)) { file = real; warn("After Effects writes '." + fileExt(real) + "' with the chosen template: " + real); }
        rq.render();
    } finally {
        try { rq.item(qi).remove(); } catch (e) {}
        for (var s = 0; s < states.length; s++) { try { rq.item(states[s][0]).render = states[s][1]; } catch (e) {} }
    }
    var out = new File(file);
    return { file: file, exists: out.exists, bytes: out.exists ? out.length : 0 };
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
def("batch", {}, "Run several commands in order as ONE undo step. Stops at the first error and rolls back the steps already done (atomic:false keeps them). diff:true returns {results, diff} with what changed in the comps the batch touches. args: commands:[{command, args}], [undoName], [atomic=true], [diff]", function (a) {
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
    var results = [], err = null, at = -1, rev0 = projRevision(), before = null, dcomps = [];
    if (a.diff) {
        // comps named in the commands (comp / toComp) - fingerprint them before
        var seen = {};
        for (i = 0; i < a.commands.length; i++) {
            var ar = a.commands[i].args || {}, refs = [ar.comp, ar.toComp];
            for (var q = 0; q < refs.length; q++) {
                if (refs[q] === undefined) continue;
                try { var cc = getComp(refs[q]); if (!seen[cc.id]) { seen[cc.id] = 1; dcomps.push(cc); } } catch (e0) {}
            }
        }
        before = {};
        for (i = 0; i < dcomps.length; i++) flattenDump(compFull(dcomps[i]), before);
    }
    if (anyWrite) app.beginUndoGroup("BridgeLine: " + (a.undoName || "batch"));
    try {
        for (i = 0; i < a.commands.length; i++) {
            try { results.push({ command: a.commands[i].command, ok: true, result: RB.run(a.commands[i].command, a.commands[i].args || {}, true) }); }
            catch (e) { results.push({ command: a.commands[i].command, ok: false, error: errStr(e) }); err = e; at = i; break; }
        }
    } finally { if (anyWrite) app.endUndoGroup(); }
    if (err) {
        var kept = "done before: " + at + " (kept)";
        if (anyWrite && at > 0 && a.atomic !== false) {
            // undo our own group only: the revision proves it changed something (so the last undo step is ours)
            var rev1 = projRevision();
            if (rev0 !== null && rev1 !== null && rev1 !== rev0) { app.executeCommand(16); kept = "the " + at + " step(s) before were rolled back, nothing changed"; }
            else if (rev0 === null) kept += "; this AE cannot report changes, so no automatic rollback - use Undo if needed";
        }
        fail("Batch stopped at #" + (at + 1) + " " + a.commands[at].command + ": " + errStr(err) + " | " + kept);
    }
    if (!a.diff) return results;
    var after = {};
    for (i = 0; i < dcomps.length; i++) { try { flattenDump(compFull(dcomps[i]), after); } catch (e1) {} }
    return { results: results, diff: flatDiff(before, after, num(a.diffLimit, 200)) };
});
