# BridgeLine

A ScriptUI panel for Adobe After Effects that lets an AI coding agent work with your live project: [Claude Code](https://claude.com/claude-code), OpenAI Codex CLI, Gemini CLI, Cursor, or any other agent that can run terminal commands. The agent can:
- read the full project state (comps, layers, properties, keys, expressions, text, effects);
- render single frames to PNG to see what it did;
- make precise, undoable changes.

The panel exposes 151 fixed commands and has no `eval`. It cannot run arbitrary code, launch shell commands or open network connections. It is not tied to any template or project.

Version 1.0.5. Tested on After Effects 2026 (26.5) and 27.0 Beta on macOS: 52/52 test scenarios pass on both.
**Windows** support is new in 1.0.3 and not yet tested on a real Windows machine: please report what breaks.

---

## Quick start

Works with agents that run terminal commands (Claude Code, Codex, Gemini CLI) through `aeb.py`, and with MCP clients
(Claude Desktop, Cursor...) through `bridgeline_mcp.py` - see [docs/INSTALL.md](docs/INSTALL.md).

1. Install the panel: see **[docs/INSTALL.md](docs/INSTALL.md)**.
2. In After Effects open **Window → BridgeLine.jsx** and tick **Listen**.
3. Open a terminal in this folder and start your agent (`claude`, `codex`, `gemini`...). It reads [AGENTS.md](AGENTS.md) and knows how to use the bridge.
4. Ask the agent to check the connection:
   ```bash
   python3 aeb.py ping --project "/path/to/Your Project.aep"
   ```
5. When the agent needs to change something, it asks first. Tick **Allow changes** in the panel.

What each button and field in the panel does: **[docs/PANEL.md](docs/PANEL.md)**.

## Folder structure

```
BridgeLine.jsx        built panel (the file you install in AE)
aeb.py                  client: the agent sends commands through it
aeb_support.py          client: doctor, report, review, pixdiff, render, textsheet
bridgeline_mcp.py       MCP server (stdio) for Claude Desktop, Cursor and other MCP clients
build.sh                builds src/*.jsx -> BridgeLine.jsx, runs checks, regenerates docs/COMMANDS.md
install.sh              installs the panel into AE on macOS (uses sudo)
install.ps1             installs the panel into AE on Windows (asks for administrator rights)
src/                    panel source code
  00_core.jsx           JSON, lookup of comps/layers/properties, serialization, keys, 2D math, dispatcher
  10_read.jsx           read commands (dump, render, search, audit, snapshot/diff...)
  20_layers.jsx         layers
  30_props.jsx          properties, keys, expressions, controls, Time Remap, Essential Graphics
  40_fx_text_shape.jsx  effects, masks, text, shape contents
  50_project.jsx        comps, project, markers, retime, import, layout, 3D, render, menu, batch
  90_panel.jsx          panel UI and command polling
tests/
  run_tests.py          full functional test (needs an empty test project, see Testing)
  assets/               small synthetic test files (video, png, wav with a pause, srt, csv, sequence)
tools/
  edit_timemap.py       finds freeze holds / dropped frames: original render vs an edited version
  compare_frames.py     compares renderFrames output with a reference video at the same timecodes
  vo_gaps.py            finds quiet gaps in a voiceover
  beats.py              beats / downbeats / hits of a music file -> CSV for markersFromFile (ffmpeg + numpy)
  gen_commands_doc.py   generates docs/COMMANDS.md
  gen_args.py           argument names of every command (for the "did you mean" warning), run by build.sh
  lint_es3.py           ExtendScript pitfalls node does not catch, run by build.sh
docs/
  INSTALL.md            installation (script and manual)
  PANEL.md              the panel: buttons, fields, typical session
  COMMANDS.md           all commands with arguments (generated)
  RECIPES.md            tested workflows
AGENTS.md               instructions for the agent (CLAUDE.md and GEMINI.md point to it)
CHANGELOG.md            version history
```

## How it works

- The agent and the panel exchange files in `~/Documents/bridgeline/` (on Windows: `Documents\bridgeline`, also when Documents is in OneDrive; `AEB_ROOT` overrides it):
  - `command.json`: a command `{id, command, args, project}`. The client writes it atomically, the panel picks it up and deletes it.
  - `result.json`: the result `{id, ok, result | error, warnings, ms}`.
  - `log.txt`: the panel log. Output folders: `renders/`, `snapshots/`, `previews/`, `dumps/`, `compare/`.
  - `notes.json`, `selection.json`: written by the panel buttons (see [PANEL.md](docs/PANEL.md)).
  - `status/<AE version>.json`: each panel's heartbeat (project, Listen, Allow changes, current command). The client uses it to
    explain a silence and to refuse at once a command for a project no After Effects has open.
  - `results/<id>.json`: the last 100 results by command id (`aeb.py status <id>`).
- The panel checks for a new command every 300 ms while **Listen** is on.
- Nothing here is specific to one AI vendor: any program that writes `command.json` and reads `result.json` can drive the panel. `aeb.py` is just the reference client.
- Client usage:
  ```bash
  python3 aeb.py ping --project "/path/Project.aep"
  python3 aeb.py dumpComp '{"comp":"Main"}' --max 0
  python3 aeb.py batch --args-file plan.json
  AEB_PROJECT="/path/Project.aep" python3 aeb.py compInfo '{"comp":"Main"}'
  python3 aeb.py help '{"filter":"text"}'
  ```
  - Exit codes: 0 ok, 1 command error, 2 panel not responding / timeout.
  - `--max N` truncates the printed output (the full result goes to `~/Documents/bridgeline/last_result.json`), `--max 0` disables truncation.
  - `python3 aeb.py compare --comp X --time T --ref video.mp4 --ref-time T2` puts a rendered frame next to a frame of a reference video (needs ffmpeg).

## Checking results

- `renderFrames` (panel) + the client: frames are complete when the command returns; empty and identical frames are flagged.
- `python3 aeb.py review --comp C --range A B`: a contact sheet of a range (needs ffmpeg).
- `python3 aeb.py pixdiff A.png B.png --heatmap diff.png`: how much changed between two frames and where (needs ffmpeg).
- `python3 aeb.py render --comp C --out file.mp4`: video render in the background with aerender, from a copy of the saved
  project, so After Effects stays free. `render-status` shows progress and ETA, `render-cancel` stops it.

## When something does not work

- `python3 aeb.py doctor` checks the installation and tells you what to fix (works even when the panel does not answer).
- `python3 aeb.py report` makes a bug report for the BridgeLine author: versions, recent errors and the log, with names,
  texts and paths replaced by placeholders. Ask your agent "prepare a BridgeLine bug report", read it, and send it to the
  [BridgeLine Telegram group](https://t.me/+DyrBEadWcxllMmUy) or as a [GitHub issue](https://github.com/oleksandr-stark/BridgeLine/issues/new/choose).
- Questions and ideas: the [Telegram group](https://t.me/+DyrBEadWcxllMmUy).

## Updates

- After a `ping`, the client checks the [latest release](https://github.com/oleksandr-stark/BridgeLine/releases) at most once a day.
  If there is a newer version, the agent tells you and the panel shows a notice under the status line.
- The same notice appears when the files in this folder are newer than the installed panel (updated but not reinstalled).
- To update: `git pull` in this folder (the agent can do it), then run `./install.sh` or `install.ps1` yourself and reopen the panel.
- The panel never goes online itself. Only the client makes one small HTTPS request to the GitHub API;
  set `BRIDGELINE_NO_UPDATE_CHECK=1` to turn it off.

## Safety

- **Read-only by default.** "Allow changes" is off every time the panel starts. Without it only read commands work.
- **Undo.** Every command is one undo step named `BridgeLine: <command>`. `batch` is one step for the whole list.
- **Project guard / addressing.** With `--project` (or `AEB_PROJECT`) a command belongs to the After Effects instance that has that project open.
  If several AE versions are listening (e.g. release and Beta), a panel whose project does not match leaves the command for 15 s so the right one can take it.
  If nobody has that project open, the command is refused with a clear error. Nothing runs in the wrong project.
- **File writes** only go to the exchange folder, the project folder and its parent folder (not your home folder or a volume root). `..` is refused.
- **`confirm:true` is required** for `saveProject`, `startRender`, `cleanupProject`, `menuCommand incrementAndSave`.
- **Menu commands** come only from a fixed list (layer styles, Create Shapes/Masks from Text, Convert Audio to Keyframes, Undo...).
- **Not present on purpose:** eval, running `.jsx` files from disk, `system.callSystem`, sockets, changing AE preferences.

## Property addressing

- **Comp:** name, id (number), or `"active"`.
- **Layer:** index (number), name, or `{id: N}`. Several layers: `layers:[...]`, `match:"regex"`, `selected:true`, `all:true`, `layerType:"text"`.
- **Property path:** `"Transform/Position"`, `"effects/Gaussian Blur/Blurriness"`, `"contents/Group 1/Contents/Fill 1/Color"`, array form `["effects", 2, "Slider"]`, `#N` = index.
  Every segment can be a display name or a matchName.
- **Path shortcuts:** `position`, `anchor`, `scale`, `rotation`, `opacity`, `xPosition`, `sourceText`, `effects`, `masks`, `contents`, `animators`, `timeRemap`, `marker`, `audioLevels`, `material`, `cameraOptions`, `lightOptions`, `layerStyles`.
- **Values:**
  - colors: `"#RRGGBB"` or `[r,g,b]` (0..1 or 0..255);
  - shapes: `{vertices, inTangents, outTangents, closed}`;
  - text: a string or a style object;
  - time: seconds, `"1:02.5"`, `"00:00:02:15"` (frames), `"45f"`.
- **Every write** returns what was changed. Every read can be saved to a file with `out`.

The full command list is in [docs/COMMANDS.md](docs/COMMANDS.md).

## Testing

1. In After Effects create a new, empty project and save it under a name that starts with `bridge_test`, e.g.
   `tests/bridge_test.aep` (git-ignored). The tests use the open project with such a name - the name is the safety check,
   because they create and delete comps. Or point to a file: `AEB_TEST_PROJECT="/path/bridge_test.aep" python3 tests/run_tests.py`.
   An .aep opens only in its own After Effects version or newer, so keep one test project per version you test.
2. Open the panel, tick **Listen** and **Allow changes**.
3. Run `python3 tests/run_tests.py` (about 3 minutes) or single phases: `setup layers props fx project read edge`.
4. The test removes its own `T_*` comps, builds everything from scratch and checks it by reading back and rendering frames.
   Visual renders go to `~/Documents/bridgeline/renders/visual/`.

Never run the tests on a real project: they create and delete comps.

## Development

1. Edit `src/*.jsx` (never the built `BridgeLine.jsx`).
2. `./build.sh` checks syntax (needs Node.js; on Windows run it in Git Bash or WSL) and ExtendScript pitfalls: ES3 reserved words such as `short`, `int`, `.in`, and non-ASCII characters. It also regenerates `docs/COMMANDS.md`.
3. Install again (`./install.sh` or `install.ps1`), then close and reopen the panel.
4. Run the tests.
5. Add a line to `CHANGELOG.md`.

ExtendScript is ES3: no `Array.forEach/map/indexOf`, no `String.trim`, no built-in `JSON`, and the source must be ASCII only.

## Tools outside After Effects

`tools/edit_timemap.py`, `tools/compare_frames.py`, `tools/vo_gaps.py` and `tools/beats.py` need ffmpeg; all but `vo_gaps.py` also need numpy:
```bash
python3 -m venv .venv && .venv/bin/pip install numpy
```
See [docs/RECIPES.md](docs/RECIPES.md) for how they are used.

## Known After Effects limitations

- **Custom values** (gradient colors in shapes, Curves, Levels histogram) cannot be set from a script. Use `applyPreset` (.ffx) or set them by hand.
- **`copyToComp`** does not guarantee where the copy lands in the stack. The panel finds the copy by id. Never rely on "layer 1" after copying.
- **Time Remap** cannot be left without keys.
- **Since AE 24,** `allCaps`/`smallCaps`/`superscript`/`subscript` on a TextDocument are read-only. The panel sets them through `fontCapsOption`/`fontBaselineOption`.
- **`replaceText`** keeps per-character styles (font, size, fill/stroke colors, tracking, faux, caps). Paragraph settings are not changed.
- **2D bounds are approximate:** `sourceRect.compBounds`, `align`, `distribute`, `centerAnchor`, `fitToComp`, `audit`, `checkTextOverlap` ignore 3D, auto-orient and effects.
- **`replaceSource`** renames a layer that has no custom name. Refer to it by `{id}`.
- **`layer.parent = X`** compensates the transform (visually nothing moves). For a jump without compensation use `setParent keepTransform:false`.
- **Essential Graphics** does not accept every property. The command reports what was refused.
- **`renderPreview` / `startRender`** block After Effects until the render finishes.
- **`renderFrames` returns before the PNGs are fully written** (`saveFrameToPng` is asynchronous). Wait a few seconds or poll for the files.
- **Text animator Range Selectors with Units = Index do not follow text changes.** After `replaceText`/`setText`, update `ADBE Text Index Start/End`.
  The percent Start/End with the same names are hidden in that mode. A lookup by name picks the visible one; a matchName is the most reliable.
- **Moving a text layer's inPoint can change its outPoint** (seen in AE 26.5). After `setTiming`, read the layer back and fix the outPoint if needed.
- **Comp duration is rounded to frames** (13.56 s at 30 fps becomes 13.5667). Compare with a tolerance.
- **Precomps with `startTime` ≠ 0** (e.g. 1 s handles): local time = parent time − startTime. Account for it when matching timecodes.

### Measured by others, handled here

Found on live After Effects by [Engine-Room-Games/after-effects-mcp](https://github.com/Engine-Room-Games/after-effects-mcp/blob/main/docs/fragile-areas-ae.md) (MIT) and checked against BridgeLine:
- A TextDocument round trip can come back with another justification (LEFT -> CENTER, CENTER stored as RIGHT). Text commands read it back and set it again, or warn.
- `layer.property("ADBE Audio Levels")` is null on audio layers; the `audioLevels` shortcut works (`placeAudioCues` uses it).
- Enabling Time Remap resets the out point to the end of the source; `timeRemap` puts in/out back.
- A new text layer takes tracking and other settings from the Character panel; `addText` starts neutral.
- Adding an item to a shape group invalidates property objects taken before (BridgeLine re-fetches them).
- `CompItem.duplicate()` is shallow: nested precomps stay shared - use `duplicateComp deep`.
- `exportAsMotionGraphicsTemplate` refuses silently when the Essential Graphics panel of the comp is empty.
- ExtendScript evaluates chained ternaries wrongly; `build.sh` refuses them.

## License

[MIT](LICENSE)
