#!/usr/bin/env python3
"""Generates docs/COMMANDS.md from def(...) declarations in src/*.jsx (no AE needed)."""
import glob, os, re
root = os.path.join(os.path.dirname(__file__), "..")
rx = re.compile(r'^def\("([A-Za-z0-9]+)", \{([^}]*)\}, "((?:[^"\\]|\\.)*)"', re.M)
sections = {"00": "Core", "10": "Read (no changes)", "20": "Layers", "30": "Properties, keyframes, expressions",
            "40": "Effects, masks, text, shapes", "50": "Comps, project, markers, retime, layout, 3D, render, menu, batch"}
out = ["# BridgeLine - commands", "", "Generated from `src/*.jsx` by `tools/gen_commands_doc.py`. W = changes the project (needs 'Allow changes').", ""]
total = 0
for f in sorted(glob.glob(os.path.join(root, "src", "*.jsx"))):
    cmds = rx.findall(open(f, encoding="utf-8").read())
    if not cmds:
        continue
    out += ["## " + sections.get(os.path.basename(f)[:2], os.path.basename(f)), "", "| Command | W | Description / args |", "|---|---|---|"]
    for name, flags, doc in cmds:
        out.append("| `%s` | %s | %s |" % (name, "W" if "w" in flags else "", doc.replace("|", "\\|").replace('\\"', '"')))
        total += 1
    out.append("")
out.insert(3, "Total: %d commands." % total)
open(os.path.join(root, "docs", "COMMANDS.md"), "w", encoding="utf-8").write("\n".join(out) + "\n")
