#!/bin/bash
# Builds ./BridgeLine.jsx from src/*.jsx and runs syntax / ES3 checks.
set -e
cd "$(dirname "$0")"
OUT="BridgeLine.jsx"
cat src/*.jsx > "$OUT"
cp "$OUT" /tmp/bridgeline_check.js
node --check /tmp/bridgeline_check.js
if grep -nE '\.(in|default|delete|new|class|function|return|var|typeof|switch|case|throw|try|catch|finally|with|void|while|do|if|else|for|break|continue|const|enum|export|import|super|extends|let|static|yield)\b\s*[=(:;,)]' "$OUT" | grep -v '^\s*//' ; then echo "ES3: reserved word used as property"; exit 1; fi
if grep -nE '[{,]\s*(in|default|delete|new|class|function|return|var|typeof|switch|case|if|else|for|do|while|const|enum)\s*:' "$OUT"; then echo "ES3: reserved word as object key"; exit 1; fi
if grep -nE '(function|var|,)\s+(abstract|boolean|byte|char|double|final|float|goto|implements|int|interface|long|native|package|private|protected|public|short|synchronized|throws|transient|volatile|debugger|export|import|super|enum|class|const|extends|as)\b\s*[(=,;]' "$OUT"; then echo "ES3: future reserved word used as identifier"; exit 1; fi
if grep -nE '\.(abstract|boolean|byte|char|double|final|float|goto|implements|int|interface|long|native|package|private|protected|public|short|synchronized|throws|transient|volatile|debugger|export|import|super|enum|class|const|extends)\b' "$OUT"; then echo "ES3: reserved word as property"; exit 1; fi
python3 -c "import sys;d=open(sys.argv[1],encoding='utf-8').read();sys.exit(1 if any(ord(c)>127 for c in d) else 0)" "$OUT" || { echo "Non-ASCII characters found"; exit 1; }
python3 tools/gen_commands_doc.py
echo "OK: $(wc -l < "$OUT") lines, $(grep -c '^def("' "$OUT") commands"
