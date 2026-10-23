"""Télécharge des paires rush brut / image finale de Tears of Steel (CC-BY 3.0,
(CC) Blender Foundation | mango.blender.org) depuis media.xiph.org."""
import re, sys, urllib.request, urllib.error, pathlib
B = "https://media.xiph.org/tearsofsteel"
SHOTS = ["01_2a", "02_3a", "03_2a", "04_2c", "04_5a", "05_3a", "07_1a", "08_3a",
         "03_2e", "04_2a", "05_1a", "06_1a", "07_2c"]  # les suivants servent de remplaçants
WANT = 8
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "testdata/tos")
out.mkdir(parents=True, exist_ok=True)
get = lambda u: urllib.request.urlopen(u, timeout=60).read()
def listing(u):
    try: return get(u).decode()
    except urllib.error.HTTPError: return ""
done = 0
for s in SHOTS:
    if done >= WANT: break
    finals = sorted(set(re.findall(rf'href="({s}_(\d+)\.exr)"', listing(f"{B}/tearsofsteel-frames-exr/{s}/final/"))))
    if not finals:
        print(s, "pas d'image finale"); continue
    raws = set(int(n) for n in re.findall(rf'href="{s}_(\d+)\.exr"', listing(f"{B}/tearsofsteel-footage-exr/{s}/linear_hd/")))
    both = [(n, k) for n, k in finals if int(k) in raws]
    if not both:
        print(s, "ignoré : pas de rush HD correspondant"); continue
    name, num = both[len(both) // 2]
    raw = f"{s}_{int(num):05d}.exr"
    for url, dst in [(f"{B}/tearsofsteel-frames-exr/{s}/final/{name}", out / f"{s}_final.exr"),
                     (f"{B}/tearsofsteel-footage-exr/{s}/linear_hd/{raw}", out / f"{s}_raw.exr")]:
        if dst.exists(): continue
        dst.write_bytes(get(url))
        print(f"{dst.name:20s} {dst.stat().st_size/1e6:5.1f} Mo  <- {url}")
    done += 1
