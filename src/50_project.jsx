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
