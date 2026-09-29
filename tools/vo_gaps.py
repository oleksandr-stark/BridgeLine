#!/usr/bin/env python3
"""Find quiet gaps in a voiceover inside a time window.

Usage: vo_gaps.py AUDIO [t0 t1] [--min-gap 0.08] [--pct 25]
Decodes to 16 kHz mono, computes RMS over 20 ms windows, reports runs below
the threshold (percentile of frame energy) with their centre time.
"""
import subprocess, sys, math, array, argparse

def rms_map(path, sr=16000, win=0.02):
    raw = subprocess.run(["ffmpeg","-v","quiet","-i",path,"-map","0:a:0",
                          "-ac","1","-ar",str(sr),"-f","s16le","-"],
                         capture_output=True, check=True).stdout
    a = array.array("h"); a.frombytes(raw[:len(raw)//2*2])
    n = int(sr*win); out = []
    for i in range(0, len(a)-n, n):
        s = 0
        for v in a[i:i+n]: s += v*v
        out.append(10*math.log10(s/n/(32768.0**2)+1e-12))
    return out, win

def main():
    p = argparse.ArgumentParser()
    p.add_argument("audio"); p.add_argument("t0", nargs="?", type=float, default=0)
    p.add_argument("t1", nargs="?", type=float, default=1e9)
    p.add_argument("--min-gap", type=float, default=0.08)
    p.add_argument("--pct", type=float, default=25)
    a = p.parse_args()
    db, win = rms_map(a.audio)
    srt = sorted(db); thr = srt[int(len(srt)*a.pct/100)]
    i0, i1 = int(a.t0/win), min(len(db), int(a.t1/win))
    print("threshold %.1f dB, window %.0f ms" % (thr, win*1000))
    run = None
    for i in range(i0, i1):
        if db[i] < thr:
            if run is None: run = i
        elif run is not None:
            if (i-run)*win >= a.min_gap:
                print("  %7.2f - %7.2f  (%.2f s)" % (run*win, i*win, (i-run)*win))
            run = None
if __name__ == "__main__": main()
