// Crash tests du moteur de match, en ligne de commande.
// Exécute le vrai app.js dans Node (DOM factice) sur les paires Tears of Steel
// préparées par tools/make_examples.py, et compare le résultat à l'image finale du film.
//
//   node tools/crashtest.mjs                 tableau détaillé + résumé
//   node tools/crashtest.mjs --sweep         compare plusieurs réglages par défaut
//   node tools/crashtest.mjs --set matchLum=70,matchCol=100
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DATA = path.join(ROOT, 'testdata', 'tos_png');
const PARTNER = { '01_2a': '05_1a', '05_1a': '01_2a', '04_2a': '04_5a', '04_5a': '02_3a', '02_3a': '04_5a', '04_2c': '08_3a', '08_3a': '04_2c' };
const RUSHES = ['rec709', 'slog3', 'logc3'];
// Visages repérés à la main sur les plans alignés : [x0, y0, x1, y1] en fraction de l'image
const FACES = {
  '01_2a': [[0.302, 0.125, 0.349, 0.24], [0.507, 0.175, 0.547, 0.275]],
  '04_2a': [[0.135, 0.2, 0.198, 0.43], [0.667, 0.12, 0.73, 0.35]],
  '05_1a': [[0.41, 0.16, 0.464, 0.345]],
};

// ---------- DOM factice : absorbe tout le câblage d'interface d'app.js ----------
function stubEl() {
  const t = {
    value: '0', style: { setProperty() {} }, dataset: {}, textContent: '', innerHTML: '', disabled: false, hidden: false,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    querySelectorAll: () => [], closest: () => null, getContext: () => null,
  };
  return new Proxy(t, { get: (o, k) => (k in o ? o[k] : () => stubEl()) });
}
const els = new Map();
const document = new Proxy({
  getElementById: id => (els.has(id) || els.set(id, stubEl()), els.get(id)),
  querySelectorAll: () => [], createElement: () => stubEl(), addEventListener() {}, readyState: 'complete', body: stubEl(), activeElement: stubEl(),
}, { get: (o, k) => (k in o ? o[k] : () => stubEl()) });
const store = new Map();
const ctx = vm.createContext({
  document, console, Math, JSON, Float32Array, Float64Array, Uint8ClampedArray, Uint32Array, Set, Map,
  window: { addEventListener() {}, scrollTo() {} },
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  fetch: () => Promise.resolve({ ok: false }), location: { href: 'http://localhost/' }, URL,
  requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {}, alert() {}, Event: class {}, MouseEvent: class {}, KeyboardEvent: class {},
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
const R = code => vm.runInContext(code, ctx);
const E = R('({okSamples,buildModel,makeMapper,applyLutRGBA,matchScore,deltaE2000,rgb2lab,LIN8,CTL_DEFAULTS})');

// ---------- Données ----------
if (!fs.existsSync(path.join(DATA, 'manifest.json'))) {
  console.error('Données absentes : lancer python tools/fetch_tos.py puis python tools/make_examples.py');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const cache = new Map();
function img(name) {
  if (!cache.has(name)) {
    const b = fs.readFileSync(path.join(DATA, name + '.rgba'));
    const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
    cache.set(name, { w, h, d: new Uint8ClampedArray(b.buffer.slice(b.byteOffset + 8, b.byteOffset + 8 + w * h * 4)) });
  }
  return cache.get(name);
}
// ~65k échantillons, comme imagesSamples() dans le navigateur
const samples = im => E.okSamples(im.d, Math.max(1, Math.round(im.w * im.h / 65000)));

function grade(rush, ref, params) {
  ctx.__s = E.buildModel(samples(rush)); ctx.__r = E.buildModel(samples(ref));
  R('srcModel=__s;refModel=__r;pins=[];rebuildMatch();');
  const f = E.makeMapper(R('match'), params), n = 33, data = new Float32Array(n * n * n * 3);
  let k = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const q = f(r / (n - 1), g / (n - 1), b / (n - 1)); data[k++] = q[0]; data[k++] = q[1]; data[k++] = q[2];
  }
  ctx.__lut = { size: n, data }; R('lut=__lut;');
  const out = new Uint8ClampedArray(rush.d); E.applyLutRGBA(out); return out;
}
function pixelDE(a, b) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i += 4 * 29) {
    const x = E.rgb2lab(E.LIN8[a[i]], E.LIN8[a[i + 1]], E.LIN8[a[i + 2]]), y = E.rgb2lab(E.LIN8[b[i]], E.LIN8[b[i + 1]], E.LIN8[b[i + 2]]);
    s += E.deltaE2000(...x, ...y); n++;
  }
  return s / n;
}

// ΔE moyen sur les pixels de peau des visages (filtrés par teinte dans l'image finale)
function skinDE(out, truth, shot) {
  const faces = FACES[shot]; if (!faces) return null;
  let s = 0, n = 0;
  for (const [x0, y0, x1, y1] of faces) for (let y = Math.floor(y0 * truth.h); y < y1 * truth.h; y++) for (let x = Math.floor(x0 * truth.w); x < x1 * truth.w; x++) {
    const i = (y * truth.w + x) * 4, t = truth.d;
    const lt = E.rgb2lab(E.LIN8[t[i]], E.LIN8[t[i + 1]], E.LIN8[t[i + 2]]), h = Math.atan2(lt[2], lt[1]) * 180 / Math.PI, C = Math.hypot(lt[1], lt[2]);
    if (h < 15 || h > 95 || C < 6 || lt[0] < 15) continue; // cheveux, fond, ombres très sombres
    const lo = E.rgb2lab(E.LIN8[out[i]], E.LIN8[out[i + 1]], E.LIN8[out[i + 2]]);
    s += E.deltaE2000(...lo, ...lt); n++;
  }
  return n > 50 ? s / n : null;
}
function run(params, rushes = RUSHES) {
  const res = [];
  for (const m of manifest) for (const rk of rushes) for (const refShot of [m.shot, PARTNER[m.shot]]) {
    if (!refShot) continue;
    const rush = img(`${m.shot}_${rk}`), ref = img(`${refShot}_final`), truth = img(`${m.shot}_final`);
    const out = grade(rush, ref, params), ts = E.okSamples(truth.d, 4);
    res.push({
      shot: m.shot, rush: rk, refShot, vfx: !m.pixelAligned,
      zoneBefore: E.matchScore(E.okSamples(rush.d, 4), ts), zoneAfter: E.matchScore(E.okSamples(out, 4), ts),
      pixBefore: m.pixelAligned ? pixelDE(rush.d, truth.d) : null, pixAfter: m.pixelAligned ? pixelDE(out, truth.d) : null,
      skinBefore: skinDE(rush.d, truth, m.shot), skinAfter: skinDE(out, truth, m.shot),
    });
  }
  return res;
}
const avg = (xs, f) => { const v = xs.map(f).filter(x => x != null); return v.reduce((a, b) => a + b, 0) / v.length; };
const f1 = v => (v == null ? '   —' : v.toFixed(1).padStart(4));
function summary(res) {
  const same = res.filter(r => r.refShot === r.shot), other = res.filter(r => r.refShot !== r.shot), al = res.filter(r => r.pixAfter != null);
  return {
    'réf même plan (ΔE zones)': `${f1(avg(same, r => r.zoneBefore))} → ${f1(avg(same, r => r.zoneAfter))}`,
    'réf autre plan (ΔE zones)': `${f1(avg(other, r => r.zoneBefore))} → ${f1(avg(other, r => r.zoneAfter))}`,
    'plans alignés (ΔE pixel)': `${f1(avg(al, r => r.pixBefore))} → ${f1(avg(al, r => r.pixAfter))}`,
    'peau, même plan (ΔE)': `${f1(avg(same, r => r.skinBefore))} → ${f1(avg(same, r => r.skinAfter))}`,
    'peau, autre plan (ΔE)': `${f1(avg(other, r => r.skinBefore))} → ${f1(avg(other, r => r.skinAfter))}`,
  };
}

const args = process.argv.slice(2);
const base = { ...Object.fromEntries(Object.entries(E.CTL_DEFAULTS).map(([k, v]) => [k, +v])) };
if (args[0] === '--sweep') {
  const configs = [{}, { matchLum: 70 }, { matchLum: 50 }, { matchCol: 80 }, { matchLum: 70, matchCol: 80 }];
  for (const c of configs) {
    const t = Date.now(), s = summary(run({ ...base, ...c }, ['rec709', 'slog3']));
    console.log((JSON.stringify(c) === '{}' ? 'défaut' : JSON.stringify(c)).padEnd(32), Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(' | '), `(${Date.now() - t} ms)`);
  }
} else {
  const set = args[0] === '--set' ? Object.fromEntries(args[1].split(',').map(kv => kv.split('=')).map(([k, v]) => [k, +v])) : {};
  const res = run({ ...base, ...set });
  console.log('plan   rush    réf          ΔE zones avant→après   ΔE pixel avant→après');
  for (const r of res) console.log(`${r.shot}  ${r.rush.padEnd(6)}  ${(r.refShot === r.shot ? 'même plan' : 'autre ' + r.refShot).padEnd(12)} ${f1(r.zoneBefore)} → ${f1(r.zoneAfter)}            ${r.pixAfter == null ? '   (VFX)' : f1(r.pixBefore) + ' → ' + f1(r.pixAfter)}`);
  console.log('\nRésumé :', summary(res));
}
