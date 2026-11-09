"""Builds ../index.html, the live page, from scene.src.html and the event list."""
import json
from pathlib import Path

from make_film import events

ROOT = Path(__file__).resolve().parent
page = (ROOT / "scene.src.html").read_text(encoding="utf-8").replace("__EVENTS__", json.dumps(events()))
for a, b in [
    ("renderer.setPixelRatio(window.devicePixelRatio);", "renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));"),
    ("<title>Autoplay controller</title>",
     '<title>AUTOPLAY, the controller that plays itself</title>\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'
     '<meta name="description" content="A 3D controller nobody is holding, and a paper SOL simulator where you deploy your own agent. No wallet, no real funds.">\n'
     '<link rel="stylesheet" href="web/app.css">'),
    ("</body></html>", '<script src="web/app.js"></script>\n</body></html>'),
]:
    assert a in page, a
    page = page.replace(a, b)
(ROOT.parent / "index.html").write_text(page, encoding="utf-8")
print("built index.html")
