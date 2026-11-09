"""AUTOPLAY: event list -> frames -> score -> MP4.

usage: python make_film.py                full render
       python make_film.py --audio        rescore only, needs a previous full render
       python make_film.py --qa 0.5 3 ... contact sheet in out/qa
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

FPS = 30
DUR = 22.8
ROOT = Path(__file__).resolve().parent
SRC = ROOT / "scene.src.html"
HTML = ROOT.parent / "film.html"
OUTDIR = ROOT / "out"
OUTDIR.mkdir(exist_ok=True)
FRAMES = OUTDIR / "frames"
SILENT = OUTDIR / "silent.mp4"
QA = OUTDIR / "qa"
ARGS = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]

CLAIM_D = [0.31, 0.18, 0.42, 0.27, 0.36, 0.22, 0.51, 0.19, 0.33]


def events():
    ev = [{"t": t, "b": b} for t, b in [(0.6, "BUY"), (1.2, "SELL"), (1.5, "DPAD"), (1.8, "CLAIM"), (2.1, "R2")]]
    cycle = [
        ("L", "STICK", "scan routes"),
        ("BUY", "BUY", "entry found"),
        ("R2", "R2", "order filled"),
        ("CLAIM", "CLAIM", None),
        ("SELL", "SELL", "target hit"),
        ("CLAIM", "CLAIM", None),
        ("STAKE", "STAKE", "idle balance"),
        ("CLAIM", "CLAIM", None),
    ]
    claim = 0
    for k in range(24):
        b, tag, log = cycle[k % 8]
        e = {"t": round(12.0 + k * 0.3, 3), "b": b, "tag": tag}
        if b == "CLAIM":
            e["d"] = CLAIM_D[claim]
            e["log"] = f"+{CLAIM_D[claim]:.2f} SOL"
            claim += 1
        else:
            e["log"] = log
        ev.append(e)
    return ev


def build_html():
    HTML.write_text(SRC.read_text(encoding="utf-8").replace("__EVENTS__", json.dumps(events())), encoding="utf-8")


def qa(ts):
    from playwright.sync_api import sync_playwright
    from PIL import Image

    QA.mkdir(exist_ok=True)
    shots = []
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 1920, "height": 1080})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(HTML.as_uri())
        pg.wait_for_function("document.documentElement.dataset.ready==='1'", timeout=90000)
        for t in ts:
            pg.evaluate("(t)=>window.__R.seek(t)", t)
            f = QA / f"t{t:05.2f}.png"
            pg.screenshot(path=str(f))
            shots.append(f)
        print("errors:", errs[:6])
        b.close()
    cols, w, h = 2, 960, 540
    rows = (len(shots) + 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h))
    for k, f in enumerate(shots):
        sheet.paste(Image.open(f).convert("RGB").resize((w, h)), ((k % cols) * w, (k // cols) * h))
    sheet.save(QA / "sheet.png")


def render_frames():
    from playwright.sync_api import sync_playwright

    FRAMES.mkdir(exist_ok=True)
    for p in FRAMES.glob("*.png"):
        p.unlink()
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(HTML.as_uri())
        pg.wait_for_function("document.documentElement.dataset.ready==='1'", timeout=90000)
        for i in range(int(round(DUR * FPS))):
            pg.evaluate("(t)=>window.__R.seek(t)", i / FPS)
            pg.screenshot(path=str(FRAMES / f"{i:04d}.png"))
            if i % 60 == 0:
                print("frame", i, flush=True)
        print("errors:", errs[:5], flush=True)
        b.close()


def encode_silent():
    subprocess.check_call([
        "ffmpeg", "-y", "-v", "error", "-framerate", str(FPS), "-i", str(FRAMES / "%04d.png"),
        "-vf", "scale=1920:1080:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-crf", "15", "-preset", "medium", "-an", "-movflags", "+faststart", str(SILENT),
    ])


if __name__ == "__main__":
    build_html()
    if "--qa" in sys.argv:
        qa([float(a) for a in sys.argv[sys.argv.index("--qa") + 1:]])
    else:
        if "--audio" not in sys.argv:
            render_frames()
            encode_silent()
        import score
        score.main(events())
