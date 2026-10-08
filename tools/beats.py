#!/usr/bin/env python3
"""Beats, downbeats and onsets of a music file -> CSV for markersFromFile (time;duration;comment).

  python3 tools/beats.py MUSIC.wav [--what beats|downbeats|onsets|all] [--bpm 120] [--start 0] [--end 60]
                         [--offset 0] [--out markers.csv]
  then:  aeb.py markersFromFile '{"comp":"Main","file":"markers.csv"}'

Decodes with ffmpeg to 22.05 kHz mono, onset strength = spectral flux; tempo by autocorrelation of the onset
envelope (70-180 BPM, or --bpm); beats = the beat grid aligned to the strongest onsets; downbeats = every 4th beat
starting from the strongest bar phase (an estimate - check the first one by ear). Needs numpy
(python3 -m venv .venv && .venv/bin/pip install numpy).
"""
import argparse, subprocess, sys
import numpy as np

SR, HOP, WIN = 22050, 512, 2048


def decode(path, start, end):
    args = ["ffmpeg", "-v", "error"]
    if start:
        args += ["-ss", str(start)]
    args += ["-i", path]
    if end:
        args += ["-t", str(end - (start or 0))]
    args += ["-map", "0:a:0", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(args, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def onset_envelope(x):
    n = 1 + max(0, (len(x) - WIN) // HOP)
    frames = np.lib.stride_tricks.as_strided(x, shape=(n, WIN), strides=(x.strides[0] * HOP, x.strides[0]))
    mag = np.abs(np.fft.rfft(frames * np.hanning(WIN), axis=1))
    logm = np.log1p(10 * mag)
    flux = np.maximum(0, np.diff(logm, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    flux -= np.convolve(flux, np.ones(16) / 16, mode="same")   # remove the slow loudness trend
    return np.maximum(flux, 0)


def tempo(env, lo=70, hi=180):
    fps = SR / HOP
    ac = np.correlate(env, env, mode="full")[len(env) - 1:]
    lags = np.arange(len(ac))
    bpm = 60 * fps / np.maximum(lags, 1)
    ok = (bpm >= lo) & (bpm <= hi)
    lag = lags[ok][np.argmax(ac[ok])]
    return 60 * fps / lag, lag


def main():
    p = argparse.ArgumentParser()
    p.add_argument("audio")
    p.add_argument("--what", default="beats", choices=["beats", "downbeats", "onsets", "all"])
    p.add_argument("--bpm", type=float)
    p.add_argument("--start", type=float, default=0)
    p.add_argument("--end", type=float)
    p.add_argument("--offset", type=float, default=0, help="add to every time (e.g. where the music starts in the comp)")
    p.add_argument("--out")
    a = p.parse_args()
    x = decode(a.audio, a.start, a.end)
    if len(x) < WIN * 4:
        sys.exit("audio too short")
    env = onset_envelope(x)
    fps = SR / HOP
    bpm, lag = (a.bpm, 60 * fps / a.bpm) if a.bpm else tempo(env)
    lag = float(lag)

    def grid_score(lg, ph):
        idx = np.round(np.arange(ph, len(env), lg)).astype(int).clip(0, len(env) - 1)
        return env[idx].sum() + 0.5 * env[(idx + 1).clip(0, len(env) - 1)].sum() + 0.5 * env[(idx - 1).clip(0)].sum()

    # fine tempo (+-3 %, sub-frame) and phase: the grid that collects the most onset energy
    best = (-1, lag, 0.0)
    for lg in ([lag] if a.bpm else np.linspace(lag * 0.97, lag * 1.03, 121)):
        for ph in np.arange(0, lg, 0.25):
            sc = grid_score(lg, ph)
            if sc > best[0]:
                best = (sc, lg, ph)
    _, lag, ph = best
    bpm = 60 * fps / lag
    beats = np.arange(ph, len(env), lag)
    bars = [env[np.round(beats[k::4]).astype(int).clip(0, len(env) - 1)].sum() for k in range(4)]
    k0 = int(np.argmax(bars))
    # frame f of the onset envelope covers samples f*HOP .. f*HOP+WIN: take the window centre as its time
    t = lambda f: round((float(f) * HOP + WIN / 2.0) / SR + a.start + a.offset, 3)
    rows = []
    if a.what in ("beats", "all"):
        rows += [(t(b), 0, "beat %d" % (i + 1)) for i, b in enumerate(beats)]
    if a.what in ("downbeats", "all"):
        rows += [(t(b), 0, "DOWN %d" % (i + 1)) for i, b in enumerate(beats[k0::4])]
    if a.what in ("onsets", "all"):
        thr = env.mean() + 2 * env.std()
        pk = [i for i in range(1, len(env) - 1) if env[i] > thr and env[i] >= env[i - 1] and env[i] > env[i + 1]]
        last = -1e9
        for i in pk:
            if i - last >= fps * 0.1:
                rows.append((t(i), 0, "hit"))
                last = i
    rows.sort()
    lines = ["time;duration;comment"] + ["%s;%s;%s" % r for r in rows]
    text = "\n".join(lines) + "\n"
    if a.out:
        open(a.out, "w", encoding="utf-8").write(text)
    print("BPM %.1f, %d beats, %d markers%s" % (bpm, len(beats), len(rows), (" -> " + a.out) if a.out else ""), file=sys.stderr)
    if not a.out:
        print(text, end="")


if __name__ == "__main__":
    main()
