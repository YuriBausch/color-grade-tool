# Colour Grade Tool

Ref shot → analyse perceptuelle → LUT `.cube` pour DaVinci Resolve / Premiere / Flame.

- 100 % client-side (aucune image envoyée), hébergeable sur GitHub Pages
- Traitement en espace linéaire (décodage sRGB IEC 61966-2-1)
- Courbe de tonalité ancrée sur les percentiles P1–P99 de la référence
- Export conforme à la spec `.cube` (LUT_3D_SIZE, DOMAIN_MIN/MAX)
- Prévisualisation avant/après avec slider, LUT 33³ ou 65³

## Utilisation

1. Déposez la frame de référence (le look visé)
2. Déposez une frame de rush pour prévisualiser avant/après
3. Ajustez les réglages, téléchargez la LUT, importez-la dans Resolve

## Look Match v2

Le module **Look Match · adaptation statistique** compare les percentiles P2/P50/P98 par canal en log2, le chroma médian des tons moyens et la saturation. Il dérive un lift/gain/scale ainsi que des corrections chroma/saturation adaptées au rush, plutôt que de copier platement la référence.

L'interface v2 ajoute les entrées **Référence**, **Frame à adapter**, **Analyser & adapter**, **LUT .cube 33³** et **Paramètres JSON**, avec aperçu avant/après. Les calculs restent dans le navigateur. PNG/JPEG sont recommandés ; les fichiers EXR doivent être convertis en proxy PNG/JPEG si le navigateur ne les décode pas.

La convention `.cube` est RGB, avec la composante R en boucle interne, puis G et B. Valeurs de sanity-check du pipeline candlelight : black `-15.19`, mid `-11.89`, white `-3.47` (log2), chroma mids `[+0.374, -0.096, -0.147]`, saturation `0.566`.
