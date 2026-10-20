# 🎬 Color Grade Tool

Outil web d'aide à l'étalonnage : **charge une frame de référence (ref shot), l'outil analyse la palette et génère une LUT 3D `.cube` prête à importer dans DaVinci Resolve** (ou Premiere, Final Cut, sur un monitor…).

## 🚀 Utilisation (Windows / Mac / Linux)

Aucune installation nécessaire — 100 % local, aucune image n'est envoyée sur un serveur.

### Option 1 : Directement en ligne
Ouvre `https://yuribausch.github.io/color-grade-tool/` (activer GitHub Pages si besoin : Settings → Pages → Source: main).

### Option 2 : En local
1. Cloner le repo :
   ```
   git clone https://github.com/YuriBausch/color-grade-tool.git
   ```
2. Ouvrir `index.html` dans un navigateur (double-clic suffit).

## 📖 Workflow

1. **Ref shot** → glisse ta frame de référence (ex : une frame de *Road to Perdition*).
2. L'outil extrait la **palette dominante** et les stats : luminance médiane, niveau des ombres/hautes lumières, saturation, dominante chaude/froide.
3. **Auto-match** → les réglages sont déduits automatiquement de la référence (affinables manuellement) :
   - Saturation
   - Chaleur (warm / cool)
   - Crush des noirs
   - Contraste (pivot bas — look sombre)
   - Soft clip des hautes lumières (blanc cassé)
   - Intensité du look (mix)
4. **Aperçu** → charge une frame de tes rushes pour prévisualiser le look avant export.
5. **Export** → télécharge la LUT `.cube` (33³ points).

## 🎥 Dans DaVinci Resolve

- Color page → clique-droit sur un node → **LUT 3D → Import** → sélectionne le `.cube`.
- Ou : Generate LUT à partir du node, appliqué après ta normalisation (CST / balance).
- ⚠️ La LUT gère le **look global** (contraste, désat, dominante). Ce qu'une LUT 3D ne peut pas faire : fenêtres, tracking, qualifiers, halation, grain — à ajouter en nodes dans Resolve.

## ⚠️ Bonnes pratiques
- La colo se joue d'abord **à la lumière au tournage** (silhouettes, brume, sources) — la LUT ne fait que renforcer.
- Place la LUT **après** ta normalisation technique (DaVinci Wide Gamut → Rec.709).
- Vérifie le look sur plusieurs plans avant de l'appliquer en série.

## 🛠️ Tech
- HTML / CSS / JavaScript vanilla — zéro dépendance, zéro build.
- Génération LUT `.cube` (format Resolve/Lustre, 33×33×33).

---

*Le grain, la fenêtre et la brume, ça se règle dans Resolve. La silhouette, ça se règle au tournage.* 🎬
