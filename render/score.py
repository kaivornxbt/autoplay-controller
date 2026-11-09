"""AUTOPLAY score: console chiptune, B minor, 100 BPM. Every sound is synthesized here."""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 48000
DUR = 22.8
N = int(DUR * SR)
BEAT = 0.6
E8 = 0.3
S16 = 0.15
BAR = 2.4
ROOT = Path(__file__).resolve().parent
SILENT = ROOT / "out" / "silent.mp4"
BUS = ROOT / "out" / "bus.wav"
OUT = ROOT / "out" / "autoplay-controller.mp4"
rng = np.random.default_rng(100)

NOTE = {"G": 7, "A": 9, "B": 11, "C#": 1, "D": 2, "E": 4, "F#": 6}


def hz(name):
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[n] + 12 * (o + 1) - 69) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def ad(n, atk=0.003, dec=0.1):
    a = np.minimum(1, np.arange(n) / max(1, int(atk * SR)))
    return a * np.exp(-np.arange(n) / (dec * SR))


def lowp(x, fc):
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.zeros_like(x)
    s = 0.0
    for i, v in enumerate(x):
        s += a * (v - s)
        y[i] = s
    return y


def pulse(f, dur, duty=0.25, dec=0.2, vib=0.0, slide=0.0):
    t = tt(dur)
    fr = f * (1 + slide * t / max(dur, 1e-3)) * (1 + vib * np.sin(2 * np.pi * 5.6 * t) * np.minimum(1, t / 0.12))
    ph = np.cumsum(fr) / SR % 1
    x = (ph < duty).astype(float) * 2 - 1
    x -= x.mean()
    return x * ad(len(t), 0.002, dec) * np.minimum(1, (len(t) - np.arange(len(t))) / (0.004 * SR))


def tri(f, dur, dec=0.5):
    t = tt(dur)
    ph = f * t % 1
    x = 4 * np.abs(ph - 0.5) - 1
    x = np.round(x * 7.5) / 7.5                                  # four bit stairs
    return x * ad(len(t), 0.002, dec) * np.minimum(1, (len(t) - np.arange(len(t))) / (0.006 * SR))


def fm(f, dur, ratio=3.5, idx=2.2, dec=0.7):
    t = tt(dur)
    e = ad(len(t), 0.004, dec)
    return np.sin(2 * np.pi * f * t + idx * np.exp(-t / (dec * 0.35)) * np.sin(2 * np.pi * f * ratio * t)) * e


def crunch(dur, dec, rate=18000):
    n = int(dur * SR)
    hold = max(1, int(SR / rate))
    v = rng.uniform(-1, 1, n // hold + 2)
    return np.repeat(v, hold)[:n] * ad(n, 0.001, dec)


def zap_kick():
    t = tt(0.24)
    ph = np.cumsum(46 + 190 * np.exp(-t / 0.026)) / SR % 1
    return (4 * np.abs(ph - 0.5) - 1) * ad(len(t), 0.001, 0.09)


def clack(pitch=1.0):
    t = tt(0.16)
    body = sum(a * np.sin(2 * np.pi * f * pitch * t) * np.exp(-t / d) for f, a, d in [(620, 0.8, 0.03), (1730, 0.7, 0.012), (3350, 0.5, 0.006)])
    return body + crunch(0.16, 0.006, 24000) * 0.8


def whirr(dur, f0, f1):
    t = tt(dur)
    u = t / dur
    ph = np.cumsum(f0 + (f1 - f0) * u) / SR % 1
    x = (ph < 0.5).astype(float) * 2 - 1
    return lowp(x, 2400) * np.sin(np.pi * u) ** 0.6 * (0.7 + 0.3 * np.sin(2 * np.pi * 46 * t))


def sweep(dur, up=True):
    n = int(dur * SR)
    u = np.arange(n) / n
    x = crunch(dur, 99, 12000) * (u ** 2 if up else (1 - u) ** 2)
    return lowp(x, 5200)


CHORDS = [  # one per 2.4 s bar
    ("B1", ["B3", "D4", "F#4"]), ("B1", ["B3", "D4", "F#4"]), ("G1", ["G3", "B3", "D4"]), ("D2", ["A3", "D4", "F#4"]),
    ("A1", ["A3", "C#4", "E4"]), ("B1", ["B3", "D4", "F#4"]), ("G1", ["G3", "B3", "D4"]), ("D2", ["A3", "D4", "F#4"]),
    ("A1", ["A3", "C#4", "E4"]), ("B1", ["B3", "D4", "F#4"]),
]
LEAD = {
    5: ["B4", 0, "D5", "F#5", 0, "E5", "D5", "B4"],
    6: ["D5", 0, "B4", "G4", 0, "B4", "D5", "E5"],
    7: ["F#5", 0, "A5", "F#5", "D5", 0, "E5", "F#5"],
}


def place(bus, sig, t, gain=1.0):
    i0 = int(round(t * SR))
    n = min(len(sig), N - i0)
    if n > 0 and i0 >= 0:
        bus[i0:i0 + n] += sig[:n] * gain


def main(events):
    drums, bass, arpL, arpR, lead, bell, fx = (np.zeros(N) for _ in range(7))
    K, ratio = zap_kick(), 1.0

    def groove(t0, t1, g):
        s = int(round(t0 / S16))
        while s * S16 < t1 - 1e-6:
            st, tb = s % 16, s * S16
            if st in (0, 6, 10):
                place(drums, K, tb, 0.8 * g)
            if st in (4, 12):
                place(drums, crunch(0.18, 0.05, 11000), tb, 0.5 * g)
            if st % 2 == 1:
                place(drums, crunch(0.04, 0.009, 24000), tb, 0.2 * g)
            s += 1

    groove(3.6, 7.5, 0.72)
    groove(12.0, 19.2, 1.0)

    for b, (root, ch) in enumerate(CHORDS):
        t0 = b * BAR
        if t0 >= 21.6:
            break
        if t0 >= 2.4 or b == 0:                                   # intro bell, then bass enters
            for k, n in enumerate(ch):
                if t0 < 3.6 or 7.2 <= t0 < 9.6 or 19.2 <= t0:
                    place(bell, fm(hz(n), 2.2, 3.5, 1.8, 0.8), t0 + k * E8, 0.34)
        for s in range(16):
            ts = t0 + s * S16
            active = 3.6 <= ts < 7.5 or 9.6 <= ts < 19.2
            if not active:
                continue
            if s % 2 == 0 and s not in (6, 14):
                f = hz(root) * (2 if s in (4, 12) else 1)
                place(bass, tri(f, E8 * 0.95, 0.3), ts, 0.62)
            if 12.0 <= ts < 19.2 or 3.6 <= ts < 7.5:
                n = ch[[0, 1, 2, 1][s % 4]]
                f = hz(n) * 2
                sig = pulse(f, S16 * 0.85, 0.125, 0.05)
                place(arpL if s % 2 else arpR, sig, ts, 0.13 if ts >= 12 else 0.09)

    for b, mel in LEAD.items():
        for k, n in enumerate(mel):
            if n:
                tn = b * BAR + k * E8
                hold = E8 * (1.9 if k + 1 < 8 and mel[k + 1] == 0 else 0.95)
                place(lead, pulse(hz(n), hold, 0.25, 0.32, vib=0.006), tn, 0.18)
                place(lead, pulse(hz(n) * 1.004, hold, 0.5, 0.2), tn + 0.018, 0.05)

    # hero: every button the controller presses by itself
    blip = {
        "BUY": lambda: pulse(hz("B5"), 0.07, 0.25, 0.03) + np.pad(pulse(hz("F#6"), 0.07, 0.25, 0.03), (int(0.05 * SR), 0))[:int(0.07 * SR)],
        "SELL": lambda: pulse(hz("F#6"), 0.12, 0.25, 0.05, slide=-0.28),
        "STAKE": lambda: fm(hz("D5"), 0.35, 2.0, 1.4, 0.12),
        "DPAD": lambda: pulse(hz("E5"), 0.05, 0.5, 0.02),
        "R2": lambda: tri(hz("B2"), 0.16, 0.06) + crunch(0.16, 0.012) * 0.5,
        "L": lambda: pulse(hz("D5"), 0.26, 0.125, 0.1, vib=0.07, slide=0.5),
    }
    claim_i = 0
    claim_scale = ["D6", "E6", "F#6", "A6", "B6", "D6", "F#6", "A6", "B6"]
    for e in events:
        place(fx, clack(1.5), e["t"], 0.13)
        if e["b"] == "CLAIM":
            if e.get("d"):
                base = hz(claim_scale[claim_i])
                claim_i += 1
                for k, m in enumerate([1, 1.26, 1.498]):
                    place(fx, pulse(base * m, 0.11, 0.5, 0.06), e["t"] + k * 0.05, 0.16)
                place(fx, crunch(0.3, 0.09, 16000), e["t"], 0.09)
                place(fx, whirr(0.5, 300, 1700), e["t"], 0.035)
            else:
                place(fx, pulse(hz("A5"), 0.08, 0.5, 0.04), e["t"], 0.16)
        else:
            place(fx, blip[e["b"]](), e["t"], 0.17)

    # the shoulders lift, the shell comes off
    place(fx, whirr(1.0, 90, 520), 2.4, 0.09)
    place(fx, clack(0.8), 2.4, 0.4)
    place(fx, sweep(1.1), 2.5, 0.2)
    for ts, p in [(3.6, 0.7), (3.9, 0.85), (4.2, 1.0)]:
        place(fx, clack(p), ts, 0.55)
        place(fx, whirr(0.9, 620, 140), ts, 0.05)
    for k, ts in enumerate([4.8, 5.1, 5.4, 5.7]):                 # four labels
        place(fx, pulse(hz(["B5", "D6", "E6", "F#6"][k]), 0.09, 0.125, 0.05), ts, 0.13)
    place(fx, sweep(0.9, True), 6.9, 0.22)
    t_ = 7.8                                                      # the agent core ticks like a clock
    while t_ < 8.4:
        place(fx, fm(hz("B2"), 0.28, 1.41, 3.0, 0.08), t_, 0.5)
        t_ += E8

    # reassembly: one clack per layer, rising
    for k, ts in enumerate([8.4, 8.7, 9.0, 9.3, 9.6, 9.9]):
        place(fx, clack(0.72 + k * 0.1), ts, 0.62)
        place(fx, tri(hz(["B2", "D3", "E3", "F#3", "A3", "B3"][k]), 0.2, 0.08), ts, 0.45)

    # the terminal rises and unfolds
    place(fx, whirr(0.75, 110, 880), 10.2, 0.16)
    place(fx, sweep(1.2), 10.8, 0.24)
    for ts, p in [(10.95, 0.9), (11.5, 1.2)]:
        place(fx, clack(p), ts, 0.5)
    for k in range(6):                                            # boot arpeggio
        place(fx, pulse(hz(["A4", "C#5", "E5", "A5", "C#6", "E6"][k]), 0.1, 0.25, 0.05), 11.1 + k * S16, 0.15)
    place(fx, crunch(0.5, 0.14, 12000), 12.0, 0.28)
    place(fx, fm(hz("B3"), 1.4, 2.0, 2.4, 0.4), 12.0, 0.36)

    # fold back
    place(fx, whirr(0.6, 900, 260), 19.2, 0.14)
    place(fx, sweep(0.9, False), 19.2, 0.2)
    place(fx, whirr(0.6, 600, 90), 19.8, 0.14)
    place(fx, clack(0.8), 20.4, 0.7)
    for n, d in [("B3", 0), ("F#4", 0.05), ("B4", 0.1), ("D5", 0.15), ("F#5", 0.2)]:
        place(bell, fm(hz(n), 1.2, 3.5, 1.6, 0.5), 21.6 + d, 0.17)
    place(bass, tri(hz("B1"), 1.2, 0.5), 21.6, 0.36)

    # a little room on the bells only
    wet = np.zeros(N)
    for d, g in [(0.15, 0.3), (0.3, 0.17), (0.45, 0.09)]:
        i = int(d * SR)
        wet[i:] += bell[:-i] * g
    left = drums + bass + arpL * 1.0 + arpR * 0.35 + lead * 0.85 + bell + wet * 1.1 + fx
    right = drums + bass + arpR * 1.0 + arpL * 0.35 + lead * 1.1 + bell * 0.9 + wet * 0.8 + fx
    out = np.stack([left, right], 1)
    fade = int(0.02 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)[:, None]
    out = np.tanh(out * 0.85)
    sf.write(str(BUS), (out / (np.abs(out).max() + 1e-9) * 0.7).astype(np.float32), SR)

    subprocess.check_call([
        "ffmpeg", "-y", "-v", "error", "-i", str(SILENT), "-i", str(BUS),
        "-filter_complex", "[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.72:level=false[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-movflags", "+faststart", str(OUT),
    ])
    print("DONE", OUT, flush=True)
