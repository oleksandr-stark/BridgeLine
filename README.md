# BridgeLine

A ScriptUI panel for Adobe After Effects that lets an AI coding agent work with your live project: [Claude Code](https://claude.com/claude-code), OpenAI Codex CLI, Gemini CLI, Cursor, or any other agent that can run terminal commands. The agent can:
- read the full project state (comps, layers, properties, keys, expressions, text, effects);
- render single frames to PNG to see what it did;
- make precise, undoable changes.

The panel exposes 134 fixed commands and has no `eval`. It cannot run arbitrary code, launch shell commands or open network connections. It is not tied to any template or project.

Version 1.0.2. Tested on After Effects 2026 (26.5), macOS. Windows is not supported yet (file paths are handled the macOS way).

---

## Quick start

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
build.sh                builds src/*.jsx -> BridgeLine.jsx, runs checks, regenerates docs/COMMANDS.md
install.sh              installs the panel into AE on macOS (uses sudo)
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
  gen_commands_doc.py   generates docs/COMMANDS.md
docs/
  INSTALL.md            installation (script and manual)
  PANEL.md              the panel: buttons, fields, typical session
  COMMANDS.md           all commands with arguments (generated)
  RECIPES.md            tested workflows
AGENTS.md               instructions for the agent (CLAUDE.md and GEMINI.md point to it)
CHANGELOG.md            version history
```

## How it works

- The agent and the panel exchange files in `~/Documents/bridgeline/`:
  - `command.json`: a command `{id, command, args, project}`. The client writes it atomically, the panel picks it up and deletes it.
  - `result.json`: the result `{id, ok, result | error, warnings, ms}`.
  - `log.txt`: the panel log. Output folders: `renders/`, `snapshots/`, `previews/`, `dumps/`, `compare/`.
  - `notes.json`, `selection.json`: written by the panel buttons (see [PANEL.md](docs/PANEL.md)).
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

1. In After Effects create a new, empty project and save it as `tests/bridge_test.aep` (this file is git-ignored).
   Any other empty project works too: `AEB_TEST_PROJECT="/path/test.aep" python3 tests/run_tests.py`.
2. Open the panel, tick **Listen** and **Allow changes**.
3. Run `python3 tests/run_tests.py` (about 3 minutes) or single phases: `setup layers props fx project read edge`.
4. The test removes its own `T_*` comps, builds everything from scratch and checks it by reading back and rendering frames.
   Visual renders go to `~/Documents/bridgeline/renders/visual/`.

Never run the tests on a real project: they create and delete comps.

## Development

1. Edit `src/*.jsx` (never the built `BridgeLine.jsx`).
2. `./build.sh` checks syntax (needs Node.js) and ExtendScript pitfalls: ES3 reserved words such as `short`, `int`, `.in`, and non-ASCII characters. It also regenerates `docs/COMMANDS.md`.
3. Install again (`./install.sh`), then close and reopen the panel.
4. Run the tests.
5. Add a line to `CHANGELOG.md`.

ExtendScript is ES3: no `Array.forEach/map/indexOf`, no `String.trim`, no built-in `JSON`, and the source must be ASCII only.

## Tools outside After Effects

`tools/edit_timemap.py`, `tools/compare_frames.py` and `tools/vo_gaps.py` need ffmpeg; the first two also need numpy:
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

## License

[MIT](LICENSE)
