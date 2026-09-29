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
    if (!app.project.file) return false;
    try { return samePath(app.project.file.fsName, p); } catch (e) { return false; }
}

function cmdAgeSec(f) {
    try {
        var m = f.modified;
        if (!m) return 9999;
        return (new Date().getTime() - m.getTime()) / 1000;
    } catch (e) { return 9999; }
}

// ---------------------------------------------------------------- update notice
// The panel has no network access. The client (aeb.py) checks for a newer version after a ping and writes
// update.json into the exchange folder; the panel only reads it and shows a notice.
RB.updPath = RB.root + "/update.json";
RB.updStamp = null;
RB.updTicks = 0;

function versionNewer(a, b) {
    var x = String(a).split("."), y = String(b).split("."), i, n = Math.max(x.length, y.length);
    for (i = 0; i < n; i++) {
        var p = parseInt(x[i] || "0", 10), q = parseInt(y[i] || "0", 10);
        if (p !== q) return p > q;
    }
    return false;
}

RB.checkUpdateNote = function () {
    if (!RB.ui || !RB.ui.upd) return;
    var f = new File(RB.updPath), stamp = "none", msg = "";
    try { if (f.exists) stamp = String(f.modified.getTime()); } catch (e0) {}
    if (stamp === RB.updStamp) return;
    RB.updStamp = stamp;
    if (stamp !== "none") {
        try {
            var u = jsonParse(readText(RB.updPath)), v = String(u.available || "");
            if (/^\d+(\.\d+)*$/.test(v) && versionNewer(v, RB.VERSION)) {
                msg = u.where === "files"
                    ? "Files are at v" + v + ": reinstall the panel (install.sh / install.ps1)"
                    : "BridgeLine v" + v + " is available: ask your agent to update";
            }
        } catch (e1) {}
    }
    RB.ui.upd.text = msg;
    RB.ui.upd.visible = msg !== "";
    try { RB.ui.win.layout.layout(true); } catch (e2) {}
};

RB.tick = function () {
    if (!RB.busy && (RB.updTicks++ % 20) === 0) { try { RB.checkUpdateNote(); } catch (eu) {} }
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
    // if the file cannot be removed (e.g. Windows file lock) try again on the next tick instead of running it twice
    var removed = false;
    try { removed = f.remove(); } catch (er) {}
    if (!removed) { RB.busy = false; return; }
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
    var upd = w.add("statictext", undefined, "", { truncate: "end" });
    upd.preferredSize.width = 260;
    try { upd.graphics.foregroundColor = upd.graphics.newPen(upd.graphics.PenType.SOLID_COLOR, [1, 0.72, 0.2], 1); } catch (eg) {}
    upd.visible = false;

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

    RB.ui = { win: w, status: status, upd: upd, listen: listen, allow: allow, list: list };

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
    RB.checkUpdateNote();
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
