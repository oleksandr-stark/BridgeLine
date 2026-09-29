# The panel

"The agent" below is whatever AI coding agent you use with the bridge (Claude Code, Codex, Gemini CLI...).

**Window → BridgeLine.jsx.** Top to bottom:

```
┌─────────────────────────────────────┐
│ BridgeLine v1.0.3                   │  version
│ Listening  |  read-only             │  status line
│ [x] Listen   [ ] Allow changes      │
│ [Send selection]  [Undo last]       │
│ ┌─────────────────────────────────┐ │
│ │ note text                       │ │  note field
│ └─────────────────────────────────┘ │
│ [Send note]  [Open folder]          │
│ ┌─────────────────────────────────┐ │
│ │ log                             │ │  log
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## Status line

Shows whether the panel is listening and whether changes are allowed:
- `Listening | read-only`: the agent can read the project and render frames, but cannot change anything.
- `Listening | CHANGES ALLOWED`: the agent can also change the project.
- `Paused | ...`: **Listen** is off, commands are not picked up.
- `Running: <command>`: a command is being executed right now.

## Listen

Turns the connection on and off. While it is on, the panel checks every 300 ms for a new command from the agent.
The setting is remembered between launches.

Turn it off when you want to be sure the agent does nothing in After Effects, for example while you work on another project.
The agent then gets a "not picked up" error and tells you.

## Allow changes

Off by default, and **off again after every launch** of the panel. While it is off, only read commands work
(inspecting comps, layers, expressions, rendering frames to PNG).

Tick it when you have agreed with the agent on a change. Untick it again when you are done if you like.
Every change the agent makes is a separate undo step named `BridgeLine: <command>`, so **Edit → Undo** works as usual.

## Send selection

Saves what is selected in After Effects right now: the active comp, the time indicator position, selected layers,
properties and keyframes, and selected items in the Project panel. The agent reads it with `getNotes`.

When to use it: to point the agent at something without describing it. Select the layers or keys, press **Send selection**,
then write to the agent "look at what I sent".

The agent can also read the **current** selection at any moment (`activeState`), so for a quick question you can just
select something and ask "what is this?". The button is useful when you want to fix a selection and then keep working
in AE: the saved copy does not change when you click elsewhere.

## Note field + Send note

A text field for a comment about the current place in the project. **Send note** saves:
- the text;
- the active comp and the time indicator position;
- the selected layers.

Then the field is cleared. Notes pile up in a list until The agent reads them and clears them (`getNotes {"clear":true}`).

The agent does **not** see notes automatically. After sending, tell the agent "read my notes".

When to use it: collect edits while you watch the animation. Go to a moment, select a layer,
write "this should come in later" → **Send**, go to the next moment → another note... then ask the agent to go through all of them.
Every note knows its comp, time and layers, so you do not have to type timecodes.

## Undo last

The same as **Edit → Undo**: it undoes the last undo step, whether it was the agent's change or yours.
Handy when the panel is docked away from the menu.

## Open folder

Opens the exchange folder `~/Documents/bridgeline/` in Finder (on Windows: `Documents\bridgeline` in Explorer). There you find:
- rendered frames (`renders/`), previews (`previews/`), snapshots (`snapshots/`), dumps (`dumps/`);
- `log.txt`, the full log;
- `notes.json` and `selection.json` from the buttons above.

You can delete old render folders from there at any time.

## Log

The last lines of the log:
- `> command {...}`: a command arrived;
- `ok (120 ms)`: it worked;
- `! error text`: it failed (the agent gets the same message);
- `~ command: addressed to another project...`: the command was meant for another After Effects instance and was left for it.

## A typical session

1. Open and save your project, open the panel, **Listen** on.
2. Ask the agent something: "what is in the Main comp?", "why does this expression error?", "render frames at 2, 4 and 6 seconds".
3. For changes, the agent first reads the project and proposes a plan.
4. You agree → tick **Allow changes** → the agent makes the changes and checks them by reading back and rendering frames.
5. Not happy → **Undo last** or Edit → Undo, one step per command.
