# Changelog

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
