#!/usr/bin/env python3
"""Find where an edited version of a render was stretched (freeze frames / holds) or trimmed.

  python3 tools/edit_timemap.py ORIGINAL.mov EDITED.mov [--fps 25] [--json out.json]

Both videos are decoded to 48x27 grayscale, then aligned with DTW (each edited frame maps to one original
frame, the original index advances by 0 = hold, 1 = normal, 2 = one frame dropped). Prints holds:
"edited time | original time | hold length" and dropped frames. Needs numpy (python3 -m venv v && v/bin/pip install numpy).
The edit must keep the original order (no rearranged shots). Holds inside static parts of the original can be
placed anywhere inside that static part - pick the calmest moment of the scene when rebuilding in AE.
"""
import argparse, json, subprocess, sys
import numpy as np

W, H = 48, 27


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-vf", "scale=%d:%d:flags=area,format=gray" % (W, H),
                          "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, W * H).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("original"); ap.add_argument("edited")
    ap.add_argument("--fps", type=float, default=25); ap.add_argument("--json")
    ap.add_argument("--min-hold", type=int, default=3, help="report holds of at least N frames")
    a = ap.parse_args()
    src, prx = decode(a.original), decode(a.edited)
    ns, npx = len(src), len(prx)
    extra = max(0, npx - ns)
    low, high = extra + 90, 60
    INF = 1e18
    prev = np.full(ns, INF)
    j0 = np.arange(0, min(ns, high + 1))
    prev[j0] = np.abs(src[j0] - prx[0]).mean(1) + np.where(j0 == 0, 0, 1e6)
    backs = []
    for i in range(1, npx):
        lo, hi = max(0, i - low), min(ns - 1, i + high)
        js = np.arange(lo, hi + 1)
        d = np.abs(src[js] - prx[i]).mean(1)
        c0 = prev[js]
        c1 = np.where(js >= 1, prev[np.maximum(js - 1, 0)], INF)
        c2 = np.where(js >= 2, prev[np.maximum(js - 2, 0)], INF) + 8.0
        st = np.vstack([c0, c1, c2])
        cur = np.full(ns, INF); cur[js] = st.min(0) + d
        backs.append((lo, st.argmin(0).astype(np.int8)))
        prev = cur
    j = ns - 1; path = [j]
    for i in range(npx - 1, 0, -1):
        lo, b = backs[i - 1]; j -= int(b[j - lo]); path.append(j)
    path = np.array(path[::-1]); steps = np.diff(path)
    holds, i = [], 0
    while i < len(steps):
        if steps[i] == 0:
            k = i
            while k < len(steps) and steps[k] == 0: k += 1
            holds.append({"edited": round(i / a.fps, 3), "original": round(int(path[i]) / a.fps, 3), "frames": k - i, "seconds": round((k - i) / a.fps, 3)})
            i = k
        else:
            i += 1
    drops = [{"edited": round(int(i) / a.fps, 3), "original": round(int(path[i]) / a.fps, 3)} for i in np.where(steps >= 2)[0]]
    print("original %d frames, edited %d frames, difference %+d" % (ns, npx, npx - ns))
    for h in holds:
        if h["frames"] >= a.min_hold:
            print("edited %8.2fs | original %8.2fs | hold %6.2fs (%d fr)" % (h["edited"], h["original"], h["seconds"], h["frames"]))
    small = [h for h in holds if h["frames"] < a.min_hold]
    if small: print("small holds (<%d fr): %d, total %d fr" % (a.min_hold, len(small), sum(h["frames"] for h in small)))
    if drops: print("dropped frames:", drops)
    if a.json:
        json.dump({"fps": a.fps, "holds": holds, "drops": drops, "map": path.tolist()}, open(a.json, "w"))


if __name__ == "__main__":
    sys.exit(main())
