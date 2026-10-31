# Changelog

## 1.0.7
- **Windows + MCP: fixed "Transport closed"** and garbled non-English names. The clients now talk UTF-8 on every system.
- **The panel recovers if its checking stops** (seen on Windows after File > Project Settings): untick and tick Listen,
  or just click the panel.
- A silent panel gets an answer at once, with what to do, instead of a long wait.
- MCP: commands wait up to 50 s by default (clients cut longer calls off); the server keeps a log for bug reports.

## 1.0.6
- **Fix: `addText` made every new text 100 times larger** (1.0.5). Character scale (`horizontalScale`, `verticalScale`)
  is now in percent everywhere, like the Character panel.
- `fitBox`: the right plate size for a scaled text.
- `sourceRect`, `textLayout`, `fitBox` warn when a size is over 10x the comp.
- Fewer false "unknown argument" warnings.

## 1.0.5
- **MCP server** `bridgeline_mcp.py` (stdio, no dependencies): BridgeLine in Claude Desktop, Cursor and other MCP clients.
  Tools for any panel command, help, frames and contact sheets returned as images, pixdiff, status, doctor, report and
  background renders; the agent instructions as a prompt and the command list as a resource.
- **Unknown arguments are reported:** a misspelled argument (`postion`) used to be ignored silently; now the result warns
  "Unknown argument 'postion' ... Did you mean 'position'?" (the list comes from the code, generated at build time).
  An unknown command gets a suggestion too.
- **`aeb.py doctor`**: checks the installation without the panel - Python, exchange folder, BridgeLine.jsx in each After Effects
  and its version, the "Allow Scripts to Write Files" setting, whether AE runs and the panel answers - and says what to fix.
- **`aeb.py report`**: a bug report for the author as Markdown (versions, doctor, recent errors with context, last log lines,
  last result). Names, texts and paths are replaced by placeholders unless `--raw`; renders and the project are never included.
  GitHub issue template "Bug report".
- Panel log: rotated at ~1 MB (`log.1.txt`), Unix line endings, a start line with BridgeLine / After Effects / system versions,
  and the full arguments of a command that failed. `ping` also returns the OS and the After Effects UI language.
- Error messages put layer, comp and item names in quotes.
- **Nothing blocks on a dialog:** every command runs with After Effects dialogs suppressed (except menu commands).
- **Renders write what you asked for:** `addToRenderQueue` picks an output template that writes the file's extension and refuses
  if AE would write another container (an `.mp4` path with the default template used to become a huge lossless `.mov`),
  adds `[#####]` for image sequences, clamps the range to the comp, checks template names, needs `overwrite:true` for an
  existing file and returns the real output path. `startRender` reports which output files exist (frames for sequences).
- **Timeouts say whether resending is safe** (`retry_safe` in the result); a command the panel never took is withdrawn.
- **`batch` is atomic:** if a step fails, the steps before it are undone (`atomic:false` keeps them). Results carry
  `revision` (before/after) when After Effects reports it, so a write that changed nothing is visible.
- `retimeByMap` / `moveKeyframes` refuse, before changing anything, when two keys would land on the same time
  (`dryRun` lists them); before, the colliding keys were silently merged.
- `bakeExpression` writes the new keys before removing old ones and falls back to per-key writes (paths), so a property is
  never left without keys.
- `audit` also lists disabled expressions (AE disables one that errors) and footage files deleted from disk after import.
- Commands Edit > Undo cannot take back are marked `W!` in COMMANDS.md and `undoable:false` in `help`.
- **Panel heartbeat:** each panel writes `status/<AE version>.json` every ~2 s. A command for a project that no listening
  After Effects has open is refused at once (no 20 s wait), and timeouts say what the panels are doing (closed, Listen off,
  busy with which command for how long, silent = frozen or a dialog). Every result is also kept as `results/<id>.json`
  (last 100) and `aeb.py status [id]` shows the panels or a command's result, so a late answer is not lost.
- **Frames you can trust:** after `renderFrames` the client waits until every PNG is complete (not just "file exists"),
  asks once more for frames that did not appear, and flags empty (fully transparent) and identical frames. New options:
  `resolution` (half/third/quarter for cheaper frames) and `isolate` (render one layer alone), both restored after;
  times outside the comp are clamped to its first/last frame; an OCIO project gets a colour warning.
- **`aeb.py review`**: a range of a comp as one contact sheet on mid grey.
- **`aeb.py pixdiff`**: share of changed pixels, their bounding box and a heatmap between two frames.
- **`aeb.py render`**: video render in the background with aerender from a snapshot of the saved project (After Effects stays
  free), with `render-status` (progress, ETA, files) and `render-cancel`. If the project was saved by another AE version
  (e.g. the Beta), it restarts with the matching aerender.
- **Text and language versions:**
  - `textLayout`: composed lines, paragraphs, whether AE re-wrapped a line, box overflow (AE 24.6+), missing glyphs, bounds -
    without rendering;
  - `checkGlyphs` and `audit` find fonts that cannot show the text (Cyrillic in a Latin-only font; AE 25.1+); `audit` also
    lists overflowing box text;
  - fonts by name: `font` / `to` accept a PostScript name, "Family Style" (`Montserrat Bold`) or a family; an unknown font
    fails with similar families;
  - `replaceFont` lists layers whose text the new font cannot show;
  - menus by label (AE 26+): dumps show `label` and `options` of popups (Dropdown Menu Control and built-in effect popups),
    `setProperty` accepts the label ("On Transparent") instead of a number;
  - `duplicateComp deep:true|'text'`: copies nested precomps (all, or only those with text - for language versions) and
    re-points `comp("Name")` expressions; `dryRun` shows what would be copied;
  - `resizeComp`: new comp size keeping the content in place relative to an anchor (keys included) - for V/VQ versions;
  - `fitBox`: a plate behind a text layer that fits the text plus padding and keeps fitting when the text changes;
  - `addText` starts with neutral tracking/scale/baseline instead of the Character panel's settings;
  - `aeb.py textsheet export|apply`: translation sheet (CSV) with a character budget per layer and `{br}` line breaks;
    apply checks length, breaks, numbers, glossary and do-not-translate terms, keeps per-character styles and reports
    overflow / missing glyphs afterwards.
- **Editing helpers:**
  - `offsetValues`: add a delta to a property on every key (timing and easing stay) or to its static value - "move it 40 px up";
  - `reverseKeyframes` (easing mirrored), `removeKeyframes keepValue` ('first' / 'last' / a value instead of whatever is
    under the time indicator), `splitLayer`;
  - `cameraMove`: dolly, truck, pedestal, orbit, dolly zoom (zoom keeps the subject size), handheld;
  - `lintMotion` (read-only): keys between frames, one-frame jumps without motion blur, linear transform keys, text shorter
    than its reading time, rotation over 180 deg between keys, solo left on, comp resolution / Draft 3D;
  - `batch diff:true` returns what changed in the comps it touched;
  - `listBackups` / `restoreBackup` (the current state is backed up first);
  - `tools/beats.py`: beats, downbeats and hits of a music file as CSV for `markersFromFile` (ffmpeg + numpy).
- **Layout and more helpers:** `stack` (layers one after another with a gap), `pin` (against an edge / corner / title-safe),
  `zoomToRect` (push in on a rectangle or a layer with a rig null - the target does not drift), `setPathKeys` (mask / shape
  path animation from JSON, e.g. roto from another tool), `trackerToNull` (a Motion Tracker point as a null),
  `placeAudioCues` (sound effects from a cue list, checked first, all or nothing).
- Fixes for After Effects behaviour measured by others: text justification is read back and re-set after text edits,
  `timeRemap` keeps the layer's in/out when it enables Time Remap, audio levels via the shortcut that works on audio layers.
- `build.sh` checks for chained ternaries (ExtendScript evaluates `a ? b : c ? d : e` wrongly).
- **Fix: `addControl` dropdown kept the default name** ("Dropdown Menu Control") instead of the given one, so expressions
  like `effect("MyMenu")(1)` failed with "effect is missing". Setting the menu items rebuilds the effect in AE 26+ and drops
  a custom name; the name is now applied after the items. The test checks it.

## 1.0.4
- **Update notice.** After a `ping`, `aeb.py` checks the latest release on GitHub (at most once a day, 3 s timeout) and
  compares it, and the panel file in its own folder, with the panel that answered:
  - the ping result gets an `update` field, so the agent can tell you;
  - the panel shows a line: "BridgeLine vX is available: ask your agent to update", or
    "Files are at vX: reinstall the panel" when the files were updated but the panel was not reinstalled.
  The panel itself still has no network access: it only reads `update.json` written by the client.
  `BRIDGELINE_NO_UPDATE_CHECK=1` turns the GitHub request off.
- Releases are published on GitHub with `BridgeLine.jsx` attached.

## 1.0.3
- **Windows support** (not yet tested on a real Windows machine):
  - file paths are compared in a Windows-aware way (backslashes, drive letters, UNC, case-insensitive), so
    `renderFrames`, `snapshot`/`diff`, `out`, `backupProject` and the project guard work with `C:\...` paths;
  - `aeb.py` finds the same Documents folder as After Effects, also when Documents is moved to OneDrive; `AEB_ROOT` overrides it;
  - `install.ps1` installs the panel (asks for administrator rights);
  - the tests find the stock preset and temp folder on either system.
- The panel no longer runs a command twice if it cannot delete `command.json` (it retries on the next tick),
  and retries replacing `result.json` while another program is reading it.

## 1.0.2
- First public release, under the name BridgeLine. Works with any AI agent that can run terminal commands (instructions in `AGENTS.md`). Tests: 47 passed on AE 27.0 Beta.
- **Commands are addressed to the right After Effects instance.** With two AE versions running (release + Beta), both
  panels watch the same exchange folder. Before, whichever polled first took the command and answered "wrong project".
  Now a panel that does not have the command's project open leaves the command for 15 s so the right instance can take it.
  After that any listening panel takes it and returns the project-guard error, so the client never just times out.
- `aeb.py` waits up to 20 s for an addressed command to be picked up.
- `install.sh all` installs into every After Effects found.

## 1.0.1
- Property lookup by name: when two children share a display name (e.g. the percent and index "Start" of a Range Selector),
  the visible one is chosen and a warning is returned. An exact matchName always wins.
- New tools: `tools/edit_timemap.py` (DTW match of an original render to an edited version → freeze holds and dropped frames),
  `tools/compare_frames.py` (bridge renders vs a reference video).
- New `docs/RECIPES.md`. More known AE limitations in the README.

## 1.0.0
First release: 134 commands, file-based protocol, read-only by default, one undo step per command, project guard,
functional test with 46 scenarios.

Bugs found and fixed before the release:
1. `short` used as a function name (an ES3 reserved word) stopped the panel from loading. `build.sh` now checks reserved words.
2. Copying the panel from an external drive with `cp` gave it `rwx------` permissions. Install with `install -m 644`.
3. `copyLayerToComp`, `menuCommand`, `audioToKeyframes` assumed the new layer is "layer 1" and could change the wrong layers. New layers are found by id.
4. `addSolid` / `addNull`: `duration` did not trim the layer.
5. `setParent keepTransform:false` without a parent failed.
6. `setTrackMatte` remove left the matte type.
7. `timeRemap`: Time Remap cannot lose all its keys; new keys are added before old ones are removed.
8. `importProject` returned a random item instead of the new folder.
9. `retimeByMap` did not remap marker durations.
10. `setGradient` used wrong matchNames.
11. `allCaps` / `superscript` are read-only in AE 24+; set through `fontCapsOption` / `fontBaselineOption`.
12. `replaceText` reset per-character styles; now kept via characterRange.
13. `lightOptions` / `cameraOptions` lookup by a readable name.
14. `deleteItem` of a folder and an item inside it in one call caused an AE internal error.
15. Dumps did not show the switches (motionBlur/collapse/threeD) for text and shape layers.
