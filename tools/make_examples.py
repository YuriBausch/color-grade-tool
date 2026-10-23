"""Prépare les images d'exemple et de crash test à partir des paires Tears of Steel
téléchargées par fetch_tos.py (EXR scene-linear Rec.709).

Pour chaque plan :
  final.png      image finale du film, vue display (référence / vérité terrain)
  rec709.png     rush brut, même vue display  -> « rush déjà converti en Rec.709 »
  slog3.png      rush brut encodé S-Log3 / S-Gamut3.Cine  -> « rush log Sony »
  logc3.png      rush brut encodé LogC3 (EI 800) / ARRI Wide Gamut 3 -> « rush log ARRI »
Les rushs sont recadrés pour être alignés au pixel près sur l'image finale.

Vue display : courbe ACES approchée (Narkowicz 2015) + OETF sRGB.  Ce n'est pas
l'étalonnage officiel du film, mais la même vue est appliquée au rush et au final,
donc l'écart entre les deux est bien celui de l'étalonnage/compositing du film.

Images : (CC) Blender Foundation | mango.blender.org — CC BY 3.0
Usage : python tools/make_examples.py [testdata/tos] [testdata/tos_png] [examples]
"""
import sys, pathlib, json
import numpy as np
import OpenEXR
from PIL import Image

src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "testdata/tos")
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "testdata/tos_png")
web = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else "examples")
out.mkdir(parents=True, exist_ok=True); web.mkdir(parents=True, exist_ok=True)

def read_exr(p):
    with OpenEXR.File(str(p)) as f:
        ch = f.channels()
        a = ch["RGB"].pixels if "RGB" in ch else np.dstack([ch[k].pixels for k in "RGB"])
    return np.nan_to_num(np.asarray(a, np.float32)[..., :3], nan=0.0, posinf=0.0, neginf=0.0)

def srgb_oetf(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)

def view(lin):
    x = np.maximum(lin, 0) * 0.6
    return srgb_oetf((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))

# Gamuts caméra -> Rec.709 (matrices publiées par ARRI et Sony) ; on applique l'inverse.
AWG3_TO_709 = np.array([[1.617523, -0.537287, -0.080237], [-0.070573, 1.334613, -0.264040], [-0.021102, -0.226954, 1.248056]])
SG3C_TO_709 = np.array([[1.6269474, -0.5401385, -0.0868089], [-0.1785155, 1.4179409, -0.2394254], [-0.0444504, -0.1959425, 1.2403929]])
def to_gamut(lin, m): return lin @ np.linalg.inv(m).T

def slog3(x):
    return np.where(x >= 0.01125, (420 + np.log10((np.maximum(x, 0.01125) + 0.01) / 0.19) * 261.5) / 1023,
                    (x * (171.2102946929 - 95) / 0.01125 + 95) / 1023)

def logc3(x):  # EI 800
    cut, a, b, c, d, e, f = 0.010591, 5.555556, 0.052272, 0.247190, 0.385537, 5.367655, 0.092809
    return np.where(x > cut, c * np.log10(a * np.maximum(x, cut) + b) + d, e * x + f)

def save_rgba(a, p, size=960):
    """Pixels bruts pour le crash test Node : en-tête largeur/hauteur (uint32) + RGBA 8 bits."""
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).convert("RGBA")
    im = im.resize((size, round(im.height * size / im.width)), Image.LANCZOS)
    p.write_bytes(np.array([im.width, im.height], "<u4").tobytes() + im.tobytes())

def save(a, p, size=None, q=None):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    if size: im = im.resize((size, round(im.height * size / im.width)), Image.LANCZOS)
    im.save(p, quality=q) if q else im.save(p)

def best_offset(raw_disp, fin_disp):
    """Décalage vertical (et horizontal) qui aligne le rush sur le final (corrélation de luminance)."""
    H, W = fin_disp.shape[:2]
    g = lambda a: a.mean(-1)[::4, ::4]
    f = g(fin_disp); f = (f - f.mean()) / (f.std() + 1e-6)
    best = (-1, 0, 0)
    for dy in range(0, raw_disp.shape[0] - H + 1, 2):
        for dx in range(0, raw_disp.shape[1] - W + 1, 2):
            r = g(raw_disp[dy:dy + H, dx:dx + W]); r = (r - r.mean()) / (r.std() + 1e-6)
            c = float((r * f).mean())
            if c > best[0]: best = (c, dy, dx)
    return best

# Sélection publiée sur le site (panneau « Exemples ») : (plan, variante) -> libellé
SHOWCASE = [
    ("01_2a", "final", "ref", "Amsterdam, jour"),
    ("04_2a", "final", "ref", "Intérieur chaud"),
    ("04_2c", "final", "ref", "Nuit sci-fi"),
    ("08_3a", "final", "ref", "Atelier sombre"),
    ("05_1a", "slog3", "rush", "Rue · S-Log3"),
    ("01_2a", "logc3", "rush", "Pont · LogC3"),
    ("04_2a", "slog3", "rush", "Intérieur · S-Log3"),
    ("02_3a", "logc3", "rush", "Machine · LogC3"),
]
for old in web.glob("tos_*.jpg"): old.unlink()

manifest = []
for fin_p in sorted(src.glob("*_final.exr")):
    shot = fin_p.name[:-len("_final.exr")]
    raw_p = src / f"{shot}_raw.exr"
    if not raw_p.exists(): continue
    fin, raw = read_exr(fin_p), read_exr(raw_p)
    fd, rd = view(fin), view(raw)
    corr, dy, dx = best_offset(rd, fd)
    H, W = fin.shape[:2]
    aligned = corr >= 0.9
    if not aligned:  # plan VFX (décor composité) : on garde le recadrage centré standard
        dy, dx = (raw.shape[0] - H) // 2, (raw.shape[1] - W) // 2
    raw = raw[dy:dy + H, dx:dx + W]
    variants = {
        "final": fd,
        "rec709": view(raw),
        "slog3": slog3(np.maximum(to_gamut(raw, SG3C_TO_709), 0)),
        "logc3": logc3(np.maximum(to_gamut(raw, AWG3_TO_709), 0)),
    }
    for k, a in variants.items():
        save(a, out / f"{shot}_{k}.png")
        save_rgba(a, out / f"{shot}_{k}.rgba")
        if any(s == shot and v == k for s, v, _, _ in SHOWCASE):
            save(a, web / f"tos_{shot}_{k}.jpg", size=1280, q=88)
    manifest.append({"shot": shot, "offset": [dy, dx], "corr": round(corr, 3), "pixelAligned": aligned})
    print(f"{shot}: corrélation {corr:.3f} -> " + ("aligné au pixel" if aligned else "plan VFX, comparaison statistique seulement"))

(out / "manifest.json").write_text(json.dumps(manifest, indent=1))
(web / "showcase.json").write_text(json.dumps([
    {"kind": kind, "label": label, "file": f"tos_{s}_{v}.jpg"} for s, v, kind, label in SHOWCASE
    if (web / f"tos_{s}_{v}.jpg").exists()], ensure_ascii=False, indent=1), encoding="utf-8")
(web / "CREDITS.md").write_text(
    "# Crédits des images d'exemple\n\n"
    "Les fichiers `tos_*` proviennent de *Tears of Steel* — (CC) Blender Foundation | mango.blender.org — "
    "licence [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). "
    "Les acteurs conservent leurs droits à l'image : pas d'usage publicitaire.\n\n"
    "Modifications : vue display ACES approchée ; les rushs `slog3` / `logc3` sont des ré-encodages "
    "S-Log3/S-Gamut3.Cine et LogC3/AWG3 des rushs bruts publiés (EXR linéaires), recadrés sur l'image finale.\n",
    encoding="utf-8")
