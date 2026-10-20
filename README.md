# 🎬 Colour Grade Tool

Analyse une **image de référence** et génère une **LUT 3D `.cube`** prête à charger dans **DaVinci Resolve** (ou Premiere, Flame, etc.). Application web 100 % locale — aucune image ne quitte ton ordinateur.

## 🌐 Utiliser en ligne (GitHub Pages)

1. Sur ce repo : **Settings → Pages**
2. **Source : Deploy from a branch** → Branch : `main` / `(root)` → **Save**
3. Attends ~1 min, l'outil est disponible sur :
   `https://yuribausch.github.io/color-grade-tool/`

Ou en local : télécharge `index.html` et ouvre-le dans n'importe quel navigateur. Fonctionne hors-ligne.

## 📋 Workflow

1. **Image de référence** : glisse une frame du look visé (ex : style *Road to Perdition*)
2. L'outil analyse : percentiles de luminance (P1→P99), saturation, chaleur ombres/hautes lumières, dynamique en stops — **en espace linéaire**
3. **Rush à prévisualiser** : glisse une frame de ton tournage pour voir le résultat
4. Affine avec les sliders (les positions « auto » utilisent les valeurs analysées)
5. **Télécharger la LUT .cube** → dans Resolve : node → *Open LUT Folder* → *Refresh* → applique la LUT

## 🔬 Moteur (v2) — précision

- **Espace de traitement en lumière linéaire** (décodage sRGB IEC 61966-2-1 exact, pas de gamma naïf 2.2)
- **Courbe de tonalité ancrée sur les percentiles** P1/P5/P25/P50/P75/P99 de la référence, interpolation **monotone de Hermite** (Fritsch-Carlson) → pas d'overshoot ni d'inversion
- **Saturation mesurée en chroma relatif** dans l'espace linéaire, appliquée autour de la luminance (préservation de la luminance type Rec.709)
- **Chaleur séparée ombres / hautes lumières** (ratio R/B par zone, dérivée des percentiles)
- **Transfert statistique type Reinhard** (*Color Transfer between Images*, Reinhard et al. 2001)
- **Export conforme à la spec `.cube` Autodesk/ASC** (`LUT_3D_SIZE`, `DOMAIN_MIN/MAX`), en 33³ ou **65³**
- Blend d'intensité effectué **en linéaire** (mélange photométriquement correct)

### Limites connues (honnêtes)
Une LUT 3D est un look **global** : pas de windows, tracking ni qualificateurs. Le grind/diffusion et les silhouettes se font à la lumière au tournage ou dans Resolve.

## 🗺️ Roadmap
- [ ] Presets sauvegardables (JSON import/export)
- [ ] Analyse multi-frames (moyenne de plusieurs refs)
- [ ] Interpolation trilinéaire/tétrahédrique côté preview
- [ ] Export `.cube` 1D + CDL (.ccc)

## Licence
MIT
