#!/usr/bin/env python3
"""
Masters the raw ElevenLabs takes into the files the game plays.

  pnpm audio:master                  # every id with a take in .audio-raw
  pnpm audio:master --only patrol,ko # some ids

For each take in .audio-raw/<kind>/<id>.mp3 (made by scripts/audio/generate.ts):

- One-shots (effects, voices, stings) lose their leading and trailing silence and get short
  fades. A few takes get a hand edit from EDITS below.
- Beds (looping music) get a seamless loop: beats and beat-synced timbre and harmony
  features find a start and an end that match (librosa), the end is refined to the sample
  and crossfaded into the start. The file is the intro, the loop, then the loop's first
  half second, and the loop points go to src/audio/loops.ts. The content before the loop
  start always equals the loop's last 100 ms, so a decoder's MP3 priming offset (0 to 100
  ms) never breaks the seam.
- Loudness is matched with EBU R128: music -16 LUFS, effects and voices -14 LUFS, true peak
  at most -1 dBTP (a limiter only where a one-shot needs it). Volumes in the game are then
  set by the mix in src/audio/player.ts, not by the files.
- Encoded as 44.1 kHz MP3: music 112 kbps stereo, effects 80 kbps mono (112 stereo), voices
  64 kbps mono (96 stereo).

Needs ffmpeg, numpy, scipy and librosa. An id without a take is left as it is.
"""
import argparse
import json
import os
import re
import subprocess
import sys

import numpy as np

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(APP, ".audio-raw")
PUBLIC = os.path.join(APP, "public", "audio")
LOOPS_TS = os.path.join(APP, "src", "audio", "loops.ts")
SR = 44100

TARGET = {"music": -16.0, "sfx": -14.0, "voice": -14.0}
MAX_TP = -1.0
BITRATE = {"music": ("112k", "112k"), "sfx": ("80k", "112k"), "voice": ("64k", "96k")}  # (mono, stereo)
PAD = 0.5  # the loop's head, repeated after the loop end
MARGIN = 0.1  # the loop's tail, repeated before the loop start
XFADE = 0.05  # the seam's crossfade

# Hand edits, in seconds of the raw take.
EDITS = {
    # A 2.5 s sub-bass sweep (silent on phone speakers) between the jingle and its button.
    "music/rug-jingle": {"cut": [(4.03, 6.52)]},
    # The same 2.5 s phrase four times over: keep the first.
    "music/sting-sandwich-man": {"end": 2.5},
    # Three clicks: keep the last, crispest one.
    "sfx/ui-tap": {"window": (0.28, 0.46)},
    # One loud horn every 24 s would give the loop away: push it into the distance.
    "sfx/city-night": {"duck": [(13.3, 15.2, -14.0)]},
}


# ------------------------------------------------------------------ io


def run(cmd, data=None):
    r = subprocess.run(cmd, input=data, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"{' '.join(cmd[:4])} failed: {r.stderr.decode()[-400:]}")
    return r


def decode(path, ch):
    out = run(["ffmpeg", "-v", "error", "-i", path, "-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"]).stdout
    return np.frombuffer(out, dtype=np.float32).reshape(-1, ch).copy()


def measure(y):
    """Integrated loudness (LUFS) and true peak (dBTP). R128 gates in 400 ms blocks, so a
    shorter clip is measured repeated back to back: the loudness of the sound itself."""
    if len(y) < int(1.2 * SR):
        y = np.tile(y, (int(np.ceil(1.2 * SR / max(1, len(y)))), 1))
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-f", "f32le", "-ar", str(SR), "-ac", str(y.shape[1]), "-i", "-", "-af", "ebur128=peak=true", "-f", "null", "-"], y.astype(np.float32).tobytes())
    err = r.stderr.decode()
    i = re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", err)
    p = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", err)
    return float(i[-1]), float(p[-1])


def encode(y, out, kind, gain_db, limit_db):
    ch = y.shape[1]
    af = [f"volume={gain_db:.2f}dB"]
    if limit_db is not None:
        af.append(f"alimiter=limit={10 ** (limit_db / 20):.4f}:attack=1:release=40:level=0:latency=1")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", "-", "-af", ",".join(af), "-c:a", "libmp3lame", "-b:a", BITRATE[kind][ch - 1], "-ar", str(SR), out],
        y.astype(np.float32).tobytes(),
    )


# ------------------------------------------------------------------ editing


def envelope_db(y, win=0.005):
    n = max(1, int(win * SR))
    a = np.abs(y).max(axis=1)
    frames = len(a) // n
    if frames == 0:
        return np.array([-120.0]), n
    rms = np.sqrt((a[: frames * n].reshape(frames, n) ** 2).mean(axis=1))
    return 20 * np.log10(rms + 1e-9), n


def fade(y, fin=0.0, fout=0.0):
    y = y.copy()
    if fin > 0:
        k = min(len(y), int(fin * SR))
        y[:k] *= np.sin(np.linspace(0, np.pi / 2, k))[:, None] ** 2
    if fout > 0:
        k = min(len(y), int(fout * SR))
        y[-k:] *= np.cos(np.linspace(0, np.pi / 2, k))[:, None] ** 2
    return y


def trim(y, lead_db=-45, tail_db=-50, pre=0.004, post=0.03):
    """Cut silence relative to the loudest moment; keep a little air either side."""
    env, n = envelope_db(y)
    top = env.max()
    above = np.where(env > top + lead_db)[0]
    tail = np.where(env > top + tail_db)[0]
    if len(above) == 0:
        return y
    s = max(0, above[0] * n - int(pre * SR))
    e = min(len(y), (tail[-1] + 1) * n + int(post * SR))
    return y[s:e]


def snap_onset(y, t, before=True, search=0.12):
    """The onset nearest t (within search), so a cut lands just before a hit."""
    import librosa

    mono = y.mean(axis=1)
    hop = 256
    onsets = librosa.onset.onset_detect(y=mono, sr=SR, hop_length=hop, units="samples", backtrack=True)
    near = [o for o in onsets if abs(o / SR - t) <= search]
    s = min(near, key=lambda o: abs(o / SR - t)) if near else int(t * SR)
    return max(0, s - int(0.004 * SR)) if before else s


def clones(y):
    """The Sybil: the same voice four more times, a touch faster or slower, spread out."""
    mono = y[:, 0]
    copies = [(1.035, 0.018, 0.5, -0.7), (0.968, 0.031, 0.5, 0.7), (1.07, 0.047, 0.32, -0.35), (0.94, 0.06, 0.32, 0.4)]
    length = int(len(mono) / min(c[0] for c in copies)) + int(0.08 * SR)
    out = np.zeros((length, 2), dtype=np.float32)
    out[: len(mono)] += mono[:, None] * 0.75
    for rate, delay, gain, pan in copies:
        idx = np.arange(0, len(mono) - 1, rate)
        c = np.interp(idx, np.arange(len(mono)), mono).astype(np.float32)
        d = int(delay * SR)
        ang = (pan + 1) * np.pi / 4
        out[d : d + len(c), 0] += c * gain * np.cos(ang)
        out[d : d + len(c), 1] += c * gain * np.sin(ang)
    return out


def mono_if_same(y):
    if y.shape[1] == 1:
        return y
    l, r = y[:, 0].astype(np.float64), y[:, 1].astype(np.float64)
    corr = (l * r).sum() / np.sqrt((l * l).sum() * (r * r).sum() + 1e-12)
    return y.mean(axis=1, keepdims=True) if corr > 0.97 else y


# ------------------------------------------------------------------ loops


def find_loop(y, loop_from=0.0):
    """A start beat and an end beat whose surroundings sound alike, the end refined to the sample."""
    import librosa
    from scipy.signal import correlate

    sr = 22050
    hop = 512
    mono44 = y.mean(axis=1)
    mono = librosa.resample(mono44, orig_sr=SR, target_sr=sr)
    onset = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=hop)
    _, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop)
    times = librosa.frames_to_time(beats, sr=sr, hop_length=hop)

    chroma = librosa.feature.chroma_cqt(y=mono, sr=sr, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=mono, sr=sr, hop_length=hop, n_mfcc=20)
    mfcc = (mfcc - mfcc.mean(axis=1, keepdims=True)) / (mfcc.std(axis=1, keepdims=True) + 1e-9)
    on = onset[None, :] / (onset.max() + 1e-9)
    n = min(chroma.shape[1], mfcc.shape[1], on.shape[1])
    feats = np.vstack([chroma[:, :n], 0.5 * mfcc[:, :n], 2.0 * on[:, :n]])
    sync = librosa.util.sync(feats, beats[beats < n], aggregate=np.mean)[:, 1:]
    sync = sync / (np.linalg.norm(sync, axis=0, keepdims=True) + 1e-9)
    nb = sync.shape[1]

    env, en = envelope_db(y, 0.05)
    content_end = (np.where(env > np.median(env) - 12)[0][-1] + 1) * en / SR

    before, after = 8, 4
    lo = max(before, int(np.searchsorted(times, max(loop_from, 1.0))))
    cands = []
    for i in range(lo, min(lo + 40, nb)):
        for j in range(i + 16, nb - after):
            if times[j] > content_end - 0.5 or (j - i) % 4:
                continue
            sim = float(np.mean([sync[:, i + k] @ sync[:, j + k] for k in range(-before, after)]))
            cands.append((sim, times[j] - times[i], i, j))
    if not cands:
        sys.exit("no loop found")
    # The longest loop that still matches well; a short loop repeats too soon to be worth a
    # slightly better seam.
    min_len = min(28.0, 0.6 * (content_end - times[lo]))
    pick = None
    for tier in (0.9, 0.85, 0.8, 0.72):
        ok = [c for c in cands if c[0] >= tier and c[1] >= min_len]
        if ok:
            pick = max(ok, key=lambda c: (c[1], c[0]))
            break
    if pick is None:
        pick = max(cands, key=lambda c: c[0] + 0.1 * c[1] / 60)
    sim, _, i, j = pick

    s = int(round(times[i] * SR))
    e0 = int(round(times[j] * SR))
    # Refine the end so the waveform around it lines up with the waveform around the start.
    w1, w2, d = int(0.15 * SR), int(0.1 * SR), int(0.03 * SR)
    a = mono44[s - w1 : s + w2]
    b = mono44[e0 - w1 - d : e0 + w2 + d]
    c = correlate(b, a, mode="valid", method="fft")
    energy = np.sqrt(np.convolve(b * b, np.ones(len(a)), mode="valid") + 1e-9)
    k = int(np.argmax(c / energy))
    e = e0 - d + k
    return s, e, sim


def make_loop(y, loop_from=0.0):
    s, e, sim = find_loop(y, loop_from)
    start = max(0, int(np.argmax(envelope_db(y)[0] > envelope_db(y)[0].max() - 50)) * int(0.005 * SR) - int(0.004 * SR))
    m, x = int(MARGIN * SR), int(XFADE * SR)
    body = y[s:e].copy()
    # The body's last MARGIN is the audio just before the start; before that, a crossfade
    # from the audio before the end into it.
    t = np.linspace(0, np.pi / 2, x)[:, None]
    body[-m - x : -m] = y[e - m - x : e - m] * np.cos(t) ** 2 + y[s - m - x : s - m] * np.sin(t) ** 2
    body[-m:] = y[s - m : s]
    intro = fade(y[start:s], fin=0.003)
    head = fade(y[s : s + int(PAD * SR)], fout=0.02)
    out = np.concatenate([intro, body, head])
    loop = (len(intro) / SR, (len(intro) + len(body)) / SR)
    return out, loop, sim


def make_ambience_loop(y, duck=()):
    """A take generated as a seamless loop: drop the codec's silence, add the margin and head."""
    a = np.abs(y).max(axis=1)
    nz = np.where(a > 10 ** (-75 / 20))[0]
    y = y[nz[0] : nz[-1] + 1]
    for t0, t1, db in duck:
        g = np.ones(len(y), dtype=np.float32)
        a0, a1 = int(t0 * SR), int(t1 * SR)
        ramp = int(0.4 * SR)
        floor = 10 ** (db / 20)
        g[a0:a1] = floor
        g[a0 - ramp : a0] = np.linspace(1, floor, ramp)
        g[a1 : a1 + ramp] = np.linspace(floor, 1, ramp)
        y = y * g[:, None]
    m, h = int(MARGIN * SR), int(PAD * SR)
    out = np.concatenate([y[-m:], y, y[:h]])
    return out, (m / SR, (m + len(y)) / SR)


# ------------------------------------------------------------------ mastering


def manifest():
    code = "import { SFX, MUSIC, VOICES } from './src/audio/manifest.ts'; console.log(JSON.stringify({ SFX, MUSIC, VOICES }));"
    out = run(["pnpm", "exec", "tsx", "--eval", code]).stdout.decode()
    return json.loads(out[out.index("{") :])


def master(kind, item):
    key = f"{kind}/{item['id']}"
    raw = os.path.join(RAW, kind, f"{item['id']}.mp3")
    out = os.path.join(PUBLIC, kind, f"{item['id']}.mp3")
    edit = EDITS.get(key, {})
    y = decode(raw, 1 if kind == "voice" else 2)
    loop = None
    note = ""

    if kind == "music":
        # Some takes end on a click in their last few milliseconds.
        y = y[: -int(0.06 * SR)]
    if "window" in edit:
        a, b = edit["window"]
        y = y[int(a * SR) : int(b * SR)]
    if "cut" in edit:
        for a, b in sorted(edit["cut"], reverse=True):
            ca, cb = snap_onset(y, a), snap_onset(y, b)
            x = int(0.008 * SR)
            joint = y[ca - x : ca] * np.linspace(1, 0, x)[:, None] + y[cb - x : cb] * np.linspace(0, 1, x)[:, None]
            y = np.concatenate([y[: ca - x], joint, y[cb:]])
            note += f" cut {ca / SR:.2f}-{cb / SR:.2f}s"
    if "end" in edit:
        cut = snap_onset(y, edit["end"])
        y = fade(y[:cut], fout=0.12)
        note += f" end {cut / SR:.2f}s"

    if kind == "music" and item.get("loop"):
        y, loop, sim = make_loop(y, edit.get("loop_from", 0.0))
        note += f" loop sim {sim:.3f}"
    elif kind == "sfx" and item.get("loop"):
        y, loop = make_ambience_loop(y, edit.get("duck", ()))
    elif kind == "music":
        y = fade(trim(y, lead_db=-50, tail_db=-48, pre=0.004, post=0.05), fin=0.002, fout=0.35)
    elif kind == "voice":
        if item.get("effect") == "clones":
            y = clones(trim(y, lead_db=-45, tail_db=-45))
        y = fade(trim(y, lead_db=-45, tail_db=-45, pre=0.03, post=0.08), fin=0.01, fout=0.05)
    else:
        y = fade(mono_if_same(trim(y, lead_db=-40, tail_db=-52, pre=0.002, post=0.02)), fin=0.001, fout=0.02)

    if kind == "sfx" and not item.get("loop"):
        y = mono_if_same(y)

    target = TARGET[kind]
    lufs, tp = measure(y)
    gain = target - lufs
    # Beds never pass through a limiter (it would change the level across the seam): if the
    # peaks won't fit, the gain gives way instead.
    limiter_ok = not loop
    limit = None
    if tp + gain > MAX_TP - 0.5:
        if limiter_ok:
            limit = MAX_TP - 0.6
        else:
            gain = MAX_TP - 0.6 - tp
    for _ in range(5):
        encode(y, out, kind, gain, limit)
        got_i, got_tp = measure(decode(out, y.shape[1]))
        if got_tp > MAX_TP:
            if limit is None and limiter_ok:
                limit = MAX_TP - 0.6
            elif limit is not None:
                limit -= got_tp - MAX_TP + 0.15
            else:
                gain -= got_tp - MAX_TP + 0.15
            continue
        # A limited one-shot loses some loudness: push it harder, within reason (a hit can
        # take more limiting than a voice).
        if limit is not None and got_i < target - 0.6 and gain < target - lufs + (9 if kind == "sfx" else 6):
            gain += min(target - got_i, 3)
            continue
        break
    # Out of tries with the peak still over: back the gain off until it fits.
    while got_tp > MAX_TP:
        gain -= got_tp - MAX_TP + 0.2
        encode(y, out, kind, gain, limit)
        got_i, got_tp = measure(decode(out, y.shape[1]))
    kb = os.path.getsize(out) / 1024
    dur = len(y) / SR
    return dict(key=key, dur=round(dur, 2), lufs=got_i, tp=got_tp, kb=round(kb, 1), ch=y.shape[1], loop=loop, note=note.strip(), limited=limit is not None)


def read_loops():
    if not os.path.exists(LOOPS_TS):
        return {}
    text = open(LOOPS_TS).read()
    return {k: (float(a), float(b)) for k, a, b in re.findall(r'"([\w/-]+)": \{ start: ([\d.]+), end: ([\d.]+) \}', text)}


def write_loops(loops):
    lines = [
        "/**",
        " * Generated by scripts/audio/master.py: where each looping file's seamless loop starts and",
        " * ends, in seconds. Re-master instead of editing by hand.",
        " */",
        "export const LOOPS: Readonly<Partial<Record<string, { start: number; end: number }>>> = {",
    ]
    for k in sorted(loops):
        a, b = loops[k]
        lines.append(f'  "{k}": {{ start: {a:.5f}, end: {b:.5f} }},')
    lines.append("};")
    open(LOOPS_TS, "w").write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = set(filter(None, args.only.split(",")))
    m = manifest()
    items = [("sfx", s) for s in m["SFX"]] + [("music", x) for x in m["MUSIC"]] + [("voice", v) for v in m["VOICES"]]
    loops = read_loops()
    rows = []
    for kind, item in items:
        if only and item["id"] not in only:
            continue
        if not os.path.exists(os.path.join(RAW, kind, f"{item['id']}.mp3")):
            continue
        r = master(kind, item)
        if r["loop"]:
            loops[r["key"]] = r["loop"]
        rows.append(r)
        print(f"{r['key']:<28} {r['dur']:>6.2f}s {r['lufs']:>6.1f} LUFS {r['tp']:>5.1f} dBTP {r['kb']:>7.1f} KB {'stereo' if r['ch'] == 2 else 'mono  '} {'limited ' if r['limited'] else ''}{r['note']}", flush=True)
    write_loops(loops)
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(PUBLIC) for f in fs if f.endswith(".mp3"))
    print(f"\nmastered {len(rows)}; public/audio is {total / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
