# Colour Grade Tool

Ref shot → analyse perceptuelle → LUT `.cube` pour DaVinci Resolve / Premiere / Flame.

- 100 % client-side (aucune image envoyée), hébergeable sur GitHub Pages
- Traitement en espace linéaire (décodage sRGB IEC 61966-2-1)
- Courbe de tonalité ancrée sur les percentiles P1–P99 de la référence (interpolation monotone)
- Saturation en chroma CIE, transfert statistique type Reinhard et al. 2001
- Export conforme à la spec .cube Autodesk/ASC (LUT_3D_SIZE, DOMAIN_MIN/MAX)
- Prévisualisation avant/après avec slider, LUT 33³ ou 65³

## Utilisation

1. Dépose la frame de référence (le look visé)
2. Dépose une frame de tes rushes pour prévisualiser (slider avant/après)
3. Ajuste les réglages, télécharge la LUT, importe-la dans Resolve
