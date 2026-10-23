# Colour Grade Tool

Ref shot + frame de rush → LUT `.cube` qui donne au rush le look de la référence (DaVinci Resolve / Premiere / Flame).

- 100 % client-side (aucune image envoyée), hébergeable sur GitHub Pages
- Match automatique dès que les deux images sont chargées
- Export `.cube` 33³ ou 65³, entrée et sortie en valeurs code sRGB / Rec.709

## Utilisation

1. Déposez la frame de référence (le look visé)
2. Déposez une frame de votre rush, exportée depuis Resolve **au point de la chaîne où vous poserez la LUT** (en général après la conversion log → Rec.709)
3. Affinez si besoin (intensité, lumière/couleur de la réf, saturation, contraste, noirs, température, teinte, zones), puis exportez la LUT et posez-la sur un node

Raccourcis : **F** preview agrandie (Échap pour revenir), **R** référence en incrustation, **B** basculer en plein cadre avant ↔ après, **C** comparer avant/après ↔ réf/après.

**Points de couleur (pipette)** : clique un élément dans la réf puis le même dans ton plan (peau, ciel…). L'outil aligne précisément cette couleur, avec une correction locale qui épargne les couleurs éloignées.

Pour un rush dont le contenu diffère beaucoup de la réf : dessinez une **zone de match** sur des éléments comparables, ou ajoutez plusieurs frames du plan (match multi-rushs).

## Algorithme (app.js)

Tout se passe en OKLab :

1. **Luminance** — courbe de tonalité paramétrique : noirs (P1) et blancs (P99) de la référence, contraste des tons moyens de la référence (rapport des écarts interquartiles), exposition déplacée aux 3/4 vers celle de la référence. On copie le look sans recopier le contenu de la réf (pentes bornées, spline Fritsch–Carlson).
2. **Couleur** — 5 bandes tonales en percentile (ombres → hautes lumières). Pour chacune : dominante (moyenne robuste pondérée vers les pixels neutres) et étendue chromatique. Chaque pixel est recentré sur la dominante du rush, rescalé en chroma, puis replacé sur la dominante de la référence.
3. **Trims manuels** appliqués après le match.
4. **Gamut mapping** : réduction du chroma à teinte/luminance constantes au lieu d'un clip par canal.

Le score affiché est le ΔE2000 moyen entre les couleurs moyennes des ombres / tons moyens / hautes lumières de la réf et du rush gradé (avant/après).

## Crash tests

Paires de test tirées de *Tears of Steel* ((CC) Blender Foundation | mango.blender.org, CC BY 3.0) : rush brut et image finale du film pour un même plan. Les rushs sont ré-encodés en Rec.709, S-Log3/S-Gamut3.Cine et LogC3/AWG3.

```bash
python -m pip install numpy OpenEXR pillow
python tools/fetch_tos.py        # ~90 Mo dans testdata/ (non versionné)
python tools/make_examples.py    # PNG de test + images d'exemple dans examples/
node tools/crashtest.mjs         # tableau des écarts ΔE avant → après
```

`tests/crashtest.html` affiche les mêmes cas dans le navigateur, avec aperçus (servir le dossier en local, par ex. `python -m http.server`).
