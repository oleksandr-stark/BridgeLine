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
