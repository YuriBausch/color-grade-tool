# Colour Grade Tool

Ref shot + frame de rush → LUT `.cube` qui donne au rush le look de la référence (DaVinci Resolve / Premiere / Flame).

- 100 % client-side (aucune image envoyée), hébergeable sur GitHub Pages
- Match automatique dès que les deux images sont chargées
- Export `.cube` 33³ ou 65³, entrée et sortie en valeurs code sRGB / Rec.709

## Utilisation

1. Déposez la frame de référence (le look visé)
2. Déposez une frame de votre rush, exportée depuis Resolve **au point de la chaîne où vous poserez la LUT** (en général après la conversion log → Rec.709)
3. Affinez si besoin (intensité, lumière/couleur de la réf, saturation, contraste, noirs, température, teinte, zones), puis exportez la LUT et posez-la sur un node

Pour un rush dont le contenu diffère beaucoup de la réf : dessinez une **zone de match** sur des éléments comparables, ou ajoutez plusieurs frames du plan (match multi-rushs).

## Algorithme (app.js)

Tout se passe en OKLab :

1. **Luminance** — courbe de tonalité monotone qui envoie les percentiles de L du rush sur ceux de la référence (11 ancres P0.5→P99.5, pentes bornées, spline Fritsch–Carlson).
2. **Couleur** — 5 bandes tonales en percentile (ombres → hautes lumières). Pour chacune : dominante (moyenne robuste pondérée vers les pixels neutres) et étendue chromatique. Chaque pixel est recentré sur la dominante du rush, rescalé en chroma, puis replacé sur la dominante de la référence.
3. **Trims manuels** appliqués après le match.
4. **Gamut mapping** : réduction du chroma à teinte/luminance constantes au lieu d'un clip par canal.

Le score affiché est le ΔE2000 moyen entre les couleurs moyennes des ombres / tons moyens / hautes lumières de la réf et du rush gradé (avant/après).
