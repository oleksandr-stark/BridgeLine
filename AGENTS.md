# BridgeLine — instructions for the AI agent

Read `README.md` (overview, safety, addressing, limitations), `docs/PANEL.md` (what the user sees) and `docs/COMMANDS.md` (all commands) before working.
Commands are sent with `python3 aeb.py <command> '<json args>' --project "<path to the .aep>"`.

On Windows:
- Python is usually `python` or `py`, not `python3`.
- Windows PowerShell 5.1 strips the double quotes from JSON passed to native programs. In PowerShell, write the args to a
  file and use `--args-file args.json`; in Git Bash or cmd the normal quoting works.
- Pass Windows paths as they are (`--project "C:\Work\Proj.aep"`); the panel compares paths without case.

## Working with the user
- Answer in the user's language.
- **Real projects:**
  1. Read the state first (`ping`, `compInfo`, `dumpComp`, `renderFrames`, `activeState`, `getNotes`).
  2. Show a plan of changes and wait for the user's approval.
  3. Ask the user to tick **Allow changes** in the panel.
  4. Run the commands.
  5. Verify by reading back + `renderFrames`.
- Never run `startRender`, `queueInAME`, `saveProject`, `cleanupProject` or `menuCommand incrementAndSave` without asking first.
- When the user says "stop", stop and run nothing.
- `tests/run_tests.py` creates and deletes comps. Run it only on an empty test project, never on a real one.
- Installing the panel needs administrator rights (sudo on macOS, UAC on Windows). Never enter passwords: after changes
  to `src/`, run `./build.sh`, then ask the user to run `./install.sh` (macOS) or `install.ps1` (Windows) and reopen the panel.

## Rules that caught bugs before
- **Always pass `--project "<path to the .aep>"`** (or `AEB_PROJECT`) so a command cannot hit the wrong project.
  It also *addresses* the command: with several AE versions listening (release + Beta), a panel that does not have
  that project open leaves the command for the right instance. Never omit it when more than one AE is running.
- **After every write**, verify the result by reading back. Compare ids and names of the neighbouring layers too.
  Never assume a new or copied layer is "layer 1"; find it by id.
- **Complex changes** go in several steps: first create/copy → check → then configure by name/id.
- **Group related changes** into `batch` (one undo step). Do not put `noUndo` commands (save, render, menu) inside a batch.
- **Before bulk operations** (`retimeByMap`, `replaceText`, `replaceInExpressions`, `replaceItemUsage`) run with `dryRun: true`.
- **`renderFrames` returns before the PNGs are written.** Wait or poll for the files before reading them.
- **ExtendScript = ES3** (when editing `src/`):
  - no `forEach/map/indexOf` on arrays, `trim`, `JSON`;
  - reserved words are forbidden as names: `short`, `int`, `char`, `float`, `class`, `in`...;
  - code must be ASCII only. `build.sh` checks this.
- **Output via `aeb.py`** is truncated by `--max`. For large dumps use `--max 0` and parse with python, or `out` to a file.

## Useful recipes
Full workflows are in `docs/RECIPES.md`. Short versions:
- **What the user is showing:** `activeState` (live selection) or `getNotes` (the "Send selection" / "Send note" buttons).
- **Check a transition:** `renderFrames` with `times` around the cut → contact sheet via ffmpeg `hstack/vstack`.
- **Find everything related to a control:** `whereUsed {"text":"GLOBAL_CTRL"}`.
- **See what the user changed by hand:** `snapshot` before the work, `diff` after.
- **Retime to a voiceover:**
  - if the timing was edited in an NLE with freeze frames: `tools/edit_timemap.py` → "live" holds per scene → `tools/compare_frames.py`;
  - otherwise: `audioToKeyframes` (pauses) and/or `markersFromFile` (SRT/CSV) → `retimeByMap` with `dryRun` → apply.
- **Replace placeholders with real files:** `importFile`, then `replaceItemUsage {"from":"LOGO_x","to":"logo.ai","dryRun":true}`.
