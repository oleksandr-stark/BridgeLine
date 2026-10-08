#!/usr/bin/env python3
"""ExtendScript pitfalls that `node --check` does not see. Used by build.sh.

  - chained ternaries without parentheses (`a ? b : c ? d : e`): ExtendScript evaluates them wrongly.
    Write `a ? b : (c ? d : e)`.
Exit 1 and print file:line for every hit.
"""
import re, sys


def strip(line):
    """Remove string literals, regex literals and // comments (rough, line based)."""
    out, i, n = [], 0, len(line)
    while i < n:
        ch = line[i]
        if ch in "\"'":
            q, i = ch, i + 1
            while i < n and line[i] != q:
                i += 2 if line[i] == "\\" else 1
            i += 1
            out.append('""')
            continue
        if ch == "/" and i + 1 < n and line[i + 1] == "/":
            break
        if ch == "/" and re.search(r"[=(,:!&|?{};]\s*$", "".join(out) or "="):
            j = i + 1
            while j < n and line[j] != "/":
                j += 2 if line[j] == "\\" else 1
            i = j + 1
            out.append("/r/")
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def chained(code):
    depth, state = 0, {}
    for ch in code:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            state.pop(depth, None)
            depth -= 1
        elif ch in ",;":
            state.pop(depth, None)
        elif ch == "?":
            if state.get(depth) == "colon":
                return True
            state[depth] = "q"
        elif ch == ":" and state.get(depth) == "q":
            state[depth] = "colon"
    return False


def main(paths):
    bad = 0
    for p in paths:
        for no, line in enumerate(open(p, encoding="utf-8"), 1):
            if chained(strip(line)):
                print("%s:%d: chained ternary without parentheses: %s" % (p, no, line.strip()[:120]))
                bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
