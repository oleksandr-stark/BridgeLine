#!/usr/bin/env python3
"""Compare frames rendered by the bridge (renderFrames, files named <comp>_<ms>ms.png) with a reference video
at the same timecodes. Prints a difference per frame (0 = identical, <6 usually "same shot") and the best
offset within +-3 frames.

  python3 tools/compare_frames.py RENDER_FOLDER REFERENCE.mov [--fps 25] [--threshold 6]

Wait until renderFrames has finished writing (saveFrameToPng is asynchronous). Needs numpy.
"""
import argparse, glob, re, subprocess
import numpy as np

W, H = 48, 27


def gray(args):
    raw = subprocess.run(["ffmpeg", "-v", "error"] + args + ["-map", "0:v:0", "-vf", "scale=%d:%d:flags=area,format=gray" % (W, H), "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, W * H).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder"); ap.add_argument("reference")
    ap.add_argument("--fps", type=float, default=25); ap.add_argument("--threshold", type=float, default=6)
    a = ap.parse_args()
    ref = gray(["-i", a.reference])
    for f in sorted(glob.glob(a.folder + "/*_*ms.png"), key=lambda p: int(re.search(r"_(\d+)ms", p).group(1))):
        t = int(re.search(r"_(\d+)ms", f).group(1)) / 1000
        img = gray(["-i", f])[0]
        i = int(round(t * a.fps))
        cand = range(max(0, i - 3), min(len(ref), i + 4))
        best = min(cand, key=lambda k: np.abs(ref[k] - img).mean())
        d, db = np.abs(ref[min(i, len(ref) - 1)] - img).mean(), np.abs(ref[best] - img).mean()
        print("%8.2fs  diff %5.2f  best %+d fr %5.2f  %s" % (t, d, best - i, db, "OK" if db < a.threshold else "CHECK"))


if __name__ == "__main__":
    main()
