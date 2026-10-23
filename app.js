const $=id=>document.getElementById(id);
let refImg=null,prevImg=null,rushImgs=[],refModel=null,srcModel=null,match=null,lut=null;

// =====================================================================
//  Principe
//  Les frames (réf + rush) sont traitées comme des images display-referred
//  (sRGB / Rec.709 gamma).  Tout le match se fait en OKLab :
//   1. Luminance : courbe de tonalité monotone qui fait correspondre les
//      percentiles de L du rush à ceux de la référence (histogram matching
//      régularisé sur 11 ancres + spline monotone Fritsch–Carlson).
//   2. Couleur : pour 5 bandes tonales (ombres → hautes lumières), on mesure
//      la dominante (moyenne robuste pondérée vers les neutres) et l'étendue
//      chromatique.  Chaque pixel est recentré sur la dominante du rush,
//      rescalé en chroma, puis replacé sur la dominante de la référence.
//   3. Réglages manuels (trims) appliqués après le match.
//   4. Retour en sRGB avec gamut mapping (on réduit le chroma, pas de clip
//      canal par canal qui casse les teintes).
//  La LUT .cube est indexée en valeurs code (0–1) en entrée ET en sortie :
//  elle s'applique sur la même image que la frame exportée.
// =====================================================================

// ---------- sRGB <-> linéaire (IEC 61966-2-1) ----------
function srgb2lin(c){return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lin2srgb(c){return c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;}
function clamp(x,a,b){return Math.min(b,Math.max(a,x));}
const LIN8=new Float32Array(256);for(let i=0;i<256;i++)LIN8[i]=srgb2lin(i/255);

// ---------- OKLab (Björn Ottosson) ----------
function linRgb2oklab(r,g,b){
  const l=0.4122214708*r+0.5363325363*g+0.0514459929*b;
  const m=0.2119034982*r+0.6806995451*g+0.1073969566*b;
  const s=0.0883024619*r+0.2817188376*g+0.6299787005*b;
  const l_=Math.cbrt(l),m_=Math.cbrt(m),s_=Math.cbrt(s);
  return [0.2104542553*l_+0.7936177850*m_-0.0040720468*s_,
          1.9779984951*l_-2.4285922050*m_+0.4505937099*s_,
          0.0259040371*l_+0.7827717662*m_-0.8086757660*s_];
}
function oklab2linRgb(L,a,b){
  const l_=L+0.3963377774*a+0.2158037573*b;
  const m_=L-0.1055613458*a-0.0638541728*b;
  const s_=L-0.0894841775*a-1.2914855480*b;
  const l=l_*l_*l_,m=m_*m_*m_,s=s_*s_*s_;
  return [4.0767416621*l-3.3077115913*m+0.2309699292*s,
          -1.2684380046*l+2.6097574011*m-0.3413193965*s,
          -0.0041960863*l-0.7034186147*m+1.7076147010*s];
}
function srgb2ok(r,g,b){return linRgb2oklab(srgb2lin(r),srgb2lin(g),srgb2lin(b));}
// OKLab -> sRGB encodé, avec gamut mapping à teinte et luminance constantes.
function ok2srgbMapped(L,a,b){
  L=clamp(L,0,1);
  let q=oklab2linRgb(L,a,b);
  const inGamut=v=>v[0]>=-1e-4&&v[1]>=-1e-4&&v[2]>=-1e-4&&v[0]<=1.0001&&v[1]<=1.0001&&v[2]<=1.0001;
  if(!inGamut(q)){
    let lo=0,hi=1;
    for(let i=0;i<14;i++){const t=(lo+hi)/2;if(inGamut(oklab2linRgb(L,a*t,b*t)))lo=t;else hi=t;}
    q=oklab2linRgb(L,a*lo,b*lo);
  }
  return [lin2srgb(clamp(q[0],0,1)),lin2srgb(clamp(q[1],0,1)),lin2srgb(clamp(q[2],0,1))];
}

// ---------- Linear sRGB -> CIELab (pour le ΔE) ----------
function lin2xyz(r,g,b){
  const X=0.4124*r+0.3576*g+0.1805*b, Y=0.2126*r+0.7152*g+0.0722*b, Z=0.0193*r+0.1192*g+0.9505*b;
  return [X/0.95047,Y/1.0,Z/1.08883];
}
function fxyz(t){return t>0.008856?Math.cbrt(t):(903.3*t+16)/116;}
function xyz2lab(X,Y,Z){
  const fx=fxyz(X),fy=fxyz(Y),fz=fxyz(Z);
  return [116*fy-16,500*(fx-fy),200*(fy-fz)];
}
function rgb2lab(r,g,b){const[x,y,z]=lin2xyz(r,g,b);return xyz2lab(x,y,z);}
function ok2lab(o){const q=oklab2linRgb(o[0],o[1],o[2]).map(v=>clamp(v,0,1));return rgb2lab(q[0],q[1],q[2]);}

// ---------- CIEDE2000 (Sharma et al. 2005) ----------
function deltaE2000(l1,a1,b1,l2,a2,b2){
  const C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),Cm=(C1+C2)/2;
  const G=0.5*(1-Math.sqrt(Math.pow(Cm,7)/(Math.pow(Cm,7)+Math.pow(25,7))));
  const a1p=a1*(1+G),a2p=a2*(1+G);
  const C1p=Math.hypot(a1p,b1),C2p=Math.hypot(a2p,b2);
  let h1p=Math.atan2(b1,a1p),h2p=Math.atan2(b2,a2p);
  if(h1p<0)h1p+=2*Math.PI; if(h2p<0)h2p+=2*Math.PI;
  const dCp=C2p-C1p;
  let dhp=h2p-h1p;
  if(dhp>Math.PI)dhp-=2*Math.PI; else if(dhp<-Math.PI)dhp+=2*Math.PI;
  const dLp=l2-l1, dHp=2*Math.sqrt(C1p*C2p)*Math.sin(dhp/2);
  const Lpm=(l1+l2)/2, Cpm=(C1p+C2p)/2;
  let hm=h1p+h2p;
  if(C1p*C2p!==0){
    if(Math.abs(h1p-h2p)<=Math.PI)hm/=2;
    else if(h1p+h2p<2*Math.PI)hm=(h1p+h2p+2*Math.PI)/2;
    else hm=(h1p+h2p-2*Math.PI)/2;
  }
  const T=1-0.17*Math.cos(hm-Math.PI/6)+0.24*Math.cos(2*hm)+0.32*Math.cos(3*hm+Math.PI/30)-0.20*Math.cos(4*hm-63*Math.PI/180);
  const dTheta=30*Math.exp(-Math.pow((hm-275*Math.PI/180)/(25*Math.PI/180),2));
  const C7=Math.pow(Cpm,7);
  const SC=1+0.045*Cpm;
  const L50=(Lpm-50)*(Lpm-50);
  const SL=1+0.015*L50/Math.sqrt(20+L50);
  const SH=1+0.015*Cpm*T;
  const RT=-2*Math.sqrt(C7/(C7+Math.pow(25,7)))*Math.sin(2*dTheta*Math.PI/180);
  return Math.sqrt(Math.pow(dLp/SL,2)+Math.pow(dCp/SC,2)+Math.pow(dHp/SH,2)+RT*(dCp/SC)*(dHp/SH));
}

// ---------- Chargement d'image (robuste) ----------
function loadImageFile(f,cb){
  if(!f)return;
  if(!f.type||!f.type.startsWith('image/')){alert('⚠ Fichier non reconnu comme image ('+(f.type||'type inconnu')+')');return;}
  const url=URL.createObjectURL(f);
  const img=new Image();
  img.onload=()=>cb(img,url);
  img.onerror=()=>{URL.revokeObjectURL(url);alert('⚠ Impossible de décoder cette image (EXR/DPX : exporte un PNG/JPEG/TIFF 8 bits depuis Resolve).');};
  img.src=url;
}
function addRushFiles(files){
  const list=Array.from(files||[]).filter(f=>f.type&&f.type.startsWith('image/'));
  let pending=list.length;if(!pending)return;
  list.forEach(f=>loadImageFile(f,(img,url)=>{rushImgs.push({img,url});pending--;if(!pending){updateRushCount();refreshSource();}}));
}
function updateRushCount(){
  const n=rushImgs.length;
  $('rushCount').textContent=n?(n+' frame'+(n>1?'s':'')+' additionnelle'+(n>1?'s':'')+' dans l\'analyse'):'Aucune frame additionnelle';
}

function setupDrop(dropId,cb){
  const d=$(dropId);
  d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('over');});
  d.addEventListener('dragleave',()=>d.classList.remove('over'));
  d.addEventListener('drop',e=>{e.preventDefault();d.classList.remove('over');loadImageFile(e.dataTransfer.files[0],cb);});
  d.addEventListener('click',()=>{
    if(roiMode)return;
    const i=document.createElement('input');i.type='file';i.accept='image/*';
    i.onchange=()=>{if(i.files&&i.files[0])loadImageFile(i.files[0],cb);};
    i.click();
  });
}

// ---------- Échantillonnage à surface constante (~65k px) ----------
function sampleImg(img,roi){
  const area=65000, x=roi?clamp(roi.x,0,.99):0, y=roi?clamp(roi.y,0,.99):0;
  const rw=roi?clamp(roi.w,.01,1-x):1-x, rh=roi?clamp(roi.h,.01,1-y):1-y;
  const aspect=(img.width*rw)/(img.height*rh);
  const W=Math.max(1,Math.round(Math.sqrt(area*aspect))),H=Math.max(1,Math.round(area/W));
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,x*img.width,y*img.height,rw*img.width,rh*img.height,0,0,W,H);
  return {data:ctx.getImageData(0,0,W,H).data,n:W*H};
}
// Pixels RGBA 8 bits -> échantillons OKLab
function okSamples(d,step){
  step=step||1;
  const n=Math.floor(d.length/4/step),L=new Float32Array(n),A=new Float32Array(n),B=new Float32Array(n);let k=0;
  for(let i=0;i<d.length;i+=4*step){
    if(d[i+3]===0)continue;
    const o=linRgb2oklab(LIN8[d[i]],LIN8[d[i+1]],LIN8[d[i+2]]);
    L[k]=o[0];A[k]=o[1];B[k]=o[2];k++;
  }
  return {L:L.subarray(0,k),A:A.subarray(0,k),B:B.subarray(0,k),n:k};
}
function imagesSamples(imgs,roi){
  const parts=imgs.map(img=>okSamples(sampleImg(img,roi).data));
  const n=parts.reduce((s,p)=>s+p.n,0),L=new Float32Array(n),A=new Float32Array(n),B=new Float32Array(n);
  let o=0;for(const p of parts){L.set(p.L,o);A.set(p.A,o);B.set(p.B,o);o+=p.n;}
  return {L,A,B,n};
}

// ---------- Modèle statistique d'une image (OKLab) ----------
const NQ=1024;
const BANDS=[0.03,0.2,0.5,0.8,0.97], BAND_SIGMA=0.13;
const NEUTRAL_C=0.045; // chroma OKLab sous laquelle un pixel compte comme « neutre » pour la dominante
function bandWeights(p,out){
  let s=0;for(let k=0;k<BANDS.length;k++){const d=p-BANDS[k];out[k]=Math.exp(-d*d/(2*BAND_SIGMA*BAND_SIGMA));s+=out[k];}
  for(let k=0;k<BANDS.length;k++)out[k]/=s;
  return out;
}
function quant(q,p){const x=clamp(p,0,1)*NQ,i=Math.min(Math.floor(x),NQ-1),f=x-i;return q[i]*(1-f)+q[i+1]*f;}
function percentileOf(q,x){
  if(x<=q[0])return 0; if(x>=q[NQ])return 1;
  let lo=0,hi=NQ;while(hi-lo>1){const m=(lo+hi)>>1;if(q[m]<=x)lo=m;else hi=m;}
  if(x===q[lo]){
    // plateau (zone écrêtée) : on prend son milieu
    let a=lo;while(a>0&&q[a-1]===x)a--;
    return (a+lo)/2/NQ;
  }
  return (lo+(x-q[lo])/(q[hi]-q[lo]))/NQ;
}
function buildModel(s){
  if(!s||s.n<16)return null;
  const n=s.n,sorted=Float32Array.from(s.L).sort(),q=new Float32Array(NQ+1);
  for(let i=0;i<=NQ;i++)q[i]=sorted[Math.round(i/NQ*(n-1))];
  const K=BANDS.length,w=new Float64Array(K);
  const sw=new Float64Array(K),swn=new Float64Array(K),na=new Float64Array(K),nb=new Float64Array(K),pa=new Float64Array(K),pb=new Float64Array(K);
  const P=new Float32Array(n);
  for(let i=0;i<n;i++){
    const p=P[i]=percentileOf(q,s.L[i]),a=s.A[i],b=s.B[i],C=Math.hypot(a,b),wn=1/(1+(C/NEUTRAL_C)**2);
    bandWeights(p,w);
    for(let k=0;k<K;k++){const wk=w[k];sw[k]+=wk;swn[k]+=wk*wn;na[k]+=wk*wn*a;nb[k]+=wk*wn*b;pa[k]+=wk*a;pb[k]+=wk*b;}
  }
  // Dominante = moyenne robuste (pondérée vers les neutres), un peu tirée vers la moyenne brute
  const cast=[];for(let k=0;k<K;k++){
    const ma=sw[k]?pa[k]/sw[k]:0,mb=sw[k]?pb[k]/sw[k]:0,ra=swn[k]>1e-6?na[k]/swn[k]:ma,rb=swn[k]>1e-6?nb[k]/swn[k]:mb;
    cast.push([ra*0.75+ma*0.25,rb*0.75+mb*0.25]);
  }
  const sv=new Float64Array(K);
  for(let i=0;i<n;i++){
    bandWeights(P[i],w);
    for(let k=0;k<K;k++){const da=s.A[i]-cast[k][0],db=s.B[i]-cast[k][1];sv[k]+=w[k]*(da*da+db*db);}
  }
  const spread=[];for(let k=0;k<K;k++)spread.push(Math.sqrt(sw[k]?sv[k]/sw[k]:0));
  let cm=0;for(let i=0;i<n;i++)cm+=Math.hypot(s.A[i],s.B[i]);
  return {q,cast,spread,n,meanC:cm/n};
}

// ---------- Spline monotone (Fritsch–Carlson) ----------
function monotoneCubic(xs,ys){
  const n=xs.length,d=[],m=new Array(n);
  for(let i=0;i<n-1;i++)d[i]=(ys[i+1]-ys[i])/(xs[i+1]-xs[i]);
  m[0]=d[0];m[n-1]=d[n-2];
  for(let i=1;i<n-1;i++)m[i]=d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2;
  for(let i=0;i<n-1;i++){
    if(d[i]===0){m[i]=m[i+1]=0;continue;}
    const a=m[i]/d[i],b=m[i+1]/d[i],h=a*a+b*b;
    if(h>9){const t=3/Math.sqrt(h);m[i]=t*a*d[i];m[i+1]=t*b*d[i];}
  }
  return x=>{
    if(x<=xs[0])return ys[0]+(x-xs[0])*m[0];
    if(x>=xs[n-1])return ys[n-1]+(x-xs[n-1])*m[n-1];
    let i=0;while(i<n-2&&x>xs[i+1])i++;
    const h=xs[i+1]-xs[i],t=(x-xs[i])/h,t2=t*t,t3=t2*t;
    return (2*t3-3*t2+1)*ys[i]+(t3-2*t2+t)*h*m[i]+(-2*t3+3*t2)*ys[i+1]+(t3-t2)*h*m[i+1];
  };
}

// ---------- Courbe de tonalité rush -> référence ----------
const TONE_ANCHORS=[0.005,0.02,0.07,0.17,0.33,0.5,0.67,0.83,0.93,0.98,0.995];
const TONE_N=1024;
function buildToneCurve(src,ref){
  const xs=[],ys=[];
  for(const p of TONE_ANCHORS){
    const x=quant(src.q,p),y=quant(ref.q,p);
    if(xs.length&&x-xs[xs.length-1]<0.012)continue;
    xs.push(x);ys.push(y);
  }
  // pentes bornées : évite les courbes « cassées » quand les contenus diffèrent
  const SMIN=0.2,SMAX=4;
  for(let i=1;i<xs.length;i++){const dx=xs[i]-xs[i-1];ys[i]=clamp(ys[i],ys[i-1]+SMIN*dx,ys[i-1]+SMAX*dx);}
  if(xs.length<2){xs.splice(0,xs.length,0,1);ys.splice(0,ys.length,0,1);}
  // extrémités : prolonge les noirs/blancs avec une pente modérée (préserve fade ou crush de la réf)
  if(xs[0]>0.002){const s0=clamp((ys[1]-ys[0])/(xs[1]-xs[0]),0.3,2);xs.unshift(0);ys.unshift(clamp(ys[0]-xs[1]*s0,0,ys[0]));}
  const N=xs.length;
  if(xs[N-1]<0.998){const s1=clamp((ys[N-1]-ys[N-2])/(xs[N-1]-xs[N-2]),0.3,2);ys.push(clamp(ys[N-1]+(1-xs[N-1])*s1,ys[N-1],1));xs.push(1);}
  const f=monotoneCubic(xs,ys),t=new Float32Array(TONE_N+1);
  for(let i=0;i<=TONE_N;i++)t[i]=clamp(f(i/TONE_N),0,1);
  for(let i=1;i<=TONE_N;i++)t[i]=Math.max(t[i],t[i-1]);
  return t;
}
function applyCurve(t,x){const v=clamp(x,0,1)*TONE_N,i=Math.min(Math.floor(v),TONE_N-1),f=v-i;return t[i]*(1-f)+t[i+1]*f;}

function rebuildMatch(){
  match=(refModel&&srcModel)?{ref:refModel,src:srcModel,tone:buildToneCurve(srcModel,refModel),pivot:quant(refModel.q,0.5)}:null;
  updateUI();
}

// ---------- États de l'interface (progression, verrouillage) ----------
let exported=false;
function updateUI(){
  const hasRef=!!refImg,hasRush=!!prevImg,ready=!!match;
  document.body.classList.toggle('has-ref',hasRef);
  document.body.classList.toggle('has-rush',hasRush);
  document.body.classList.toggle('ready',ready);
  const st=(id,done,cur)=>{const el=$(id);if(!el)return;el.classList.toggle('is-done',done);el.classList.toggle('is-current',!done&&cur);};
  st('stepRef',hasRef,true);
  st('stepRush',hasRush,hasRef);
  st('stepTune',ready&&exported,ready);
  st('stepExport',ready&&exported,ready);
  $('btnDl').disabled=!ready;$('btnReport').disabled=!ready;
}

// ---------- Réglages ----------
const CTL_DEFAULTS={intensity:100,matchLum:100,matchCol:100,sat:100,con:100,warm:0,tint:0,crush:50,zSh:0,zShW:0,zMd:0,zMdW:0,zHi:0,zHiW:0};
const CTL_IDS=Object.keys(CTL_DEFAULTS);
function readParams(){const p={};CTL_IDS.forEach(id=>p[id]=+$(id).value);return p;}

// ---------- Transformation complète d'une couleur (sRGB code -> sRGB code) ----------
function makeMapper(m,P){
  const w=new Float64Array(BANDS.length);
  const kLum=P.matchLum/100,kCol=P.matchCol/100,mix=P.intensity/100,sat=P.sat/100,con=P.con/100;
  const crush=(P.crush-50)/50,warm=P.warm/100,tint=P.tint/100;
  const zL=[P.zSh,P.zMd,P.zHi].map(v=>v/100),zW=[P.zShW,P.zMdW,P.zHiW].map(v=>v/100);
  return (r,g,b)=>{
    const o=srgb2ok(r,g,b),L0=o[0],a0=o[1],b0=o[2];
    let L=L0,a=a0,bb=b0;
    if(m){
      // 1. luminance
      L=L0+(applyCurve(m.tone,L0)-L0)*kLum;
      // 2. couleur par bande tonale (position = percentile du pixel dans le rush)
      bandWeights(percentileOf(m.src.q,L0),w);
      let sa=0,sb=0,ra=0,rb=0,k=0;
      for(let i=0;i<BANDS.length;i++){
        sa+=w[i]*m.src.cast[i][0];sb+=w[i]*m.src.cast[i][1];
        ra+=w[i]*m.ref.cast[i][0];rb+=w[i]*m.ref.cast[i][1];
        k+=w[i]*clamp(m.ref.spread[i]/Math.max(m.src.spread[i],0.004),0.35,2.5);
      }
      const fa=(a0-sa)*k+ra,fb=(b0-sb)*k+rb;
      a=a0+(fa-a0)*kCol;bb=b0+(fb-b0)*kCol;
    }
    // 3. trims manuels
    const pivot=m?m.pivot:0.5;
    L=pivot+(L-pivot)*con;
    if(crush>=0)L-=crush*0.07*Math.pow(clamp(1-L/0.45,0,1),2);
    else L+=-crush*0.06*Math.pow(clamp(1-L/0.6,0,1),2);
    const wSh=Math.pow(clamp(1-L/0.5,0,1),2),wHi=Math.pow(clamp((L-0.5)/0.5,0,1),2),wMd=1-wSh-wHi,zw=[wSh,wMd,wHi];
    let zb=0;for(let i=0;i<3;i++){L+=0.08*zL[i]*zw[i];zb+=zW[i]*zw[i];}
    a*=sat;bb*=sat;
    bb+=0.03*(warm+zb);a+=0.006*(warm+zb)+0.025*tint;
    // 4. intensité globale
    L=L0+(L-L0)*mix;a=a0+(a-a0)*mix;bb=b0+(bb-b0)*mix;
    return ok2srgbMapped(L,a,bb);
  };
}

// ---------- Génération de la LUT 3D ----------
function generateLUT(size){
  if(!match){lut=null;return;}
  const n=Math.max(2,Math.round(size||33)),data=new Float32Array(n*n*n*3),f=makeMapper(match,readParams());
  let k=0;
  // convention .cube : R varie le plus vite, puis G, puis B
  for(let bi=0;bi<n;bi++)for(let gi=0;gi<n;gi++)for(let ri=0;ri<n;ri++){
    const q=f(ri/(n-1),gi/(n-1),bi/(n-1));
    data[k++]=q[0];data[k++]=q[1];data[k++]=q[2];
  }
  lut={size:n,data};
}
let regenPending=false;
function scheduleRegen(){
  if(regenPending)return;regenPending=true;
  requestAnimationFrame(()=>{regenPending=false;generateLUT(+$('lutSize').value);if(prevImg)renderPrev(prevImg);});
}
function refreshSource(){
  const list=[prevImg,...rushImgs.map(x=>x.img)].filter(Boolean);
  srcModel=list.length?buildModel(imagesSamples(list,roiState.prev)):null;
  rebuildMatch();showStats();scheduleRegen();
}
function refreshAnalysis(){
  if(!refImg)return;
  refModel=buildModel(imagesSamples([refImg],roiState.ref));
  showPalette(refImg,roiState.ref);
  rebuildMatch();showStats();scheduleRegen();
}

// ---------- Interpolation tétraédrique de la LUT (valeurs code) ----------
function lutTetra(r,g,b){
  const S=lut.size,D=lut.data;
  const x=clamp(r,0,1)*(S-1),y=clamp(g,0,1)*(S-1),z=clamp(b,0,1)*(S-1);
  const i0=Math.min(Math.floor(x),S-2),j0=Math.min(Math.floor(y),S-2),k0=Math.min(Math.floor(z),S-2);
  const fx=x-i0,fy=y-j0,fz=z-k0;
  const idx=(i,j,k)=>(k*S*S+j*S+i)*3;
  const c000=idx(i0,j0,k0),c100=idx(i0+1,j0,k0),c010=idx(i0,j0+1,k0),c110=idx(i0+1,j0+1,k0);
  const c001=idx(i0,j0,k0+1),c101=idx(i0+1,j0,k0+1),c011=idx(i0,j0+1,k0+1),c111=idx(i0+1,j0+1,k0+1);
  let w0,w1,w2,w3,A,B;
  if(fx>fy){
    if(fy>fz){w0=1-fx;w1=fx-fy;w2=fy-fz;w3=fz;A=c100;B=c110;}
    else if(fx>fz){w0=1-fx;w1=fx-fz;w2=fz-fy;w3=fy;A=c100;B=c101;}
    else{w0=1-fz;w1=fz-fx;w2=fx-fy;w3=fy;A=c001;B=c101;}
  }else{
    if(fz>fy){w0=1-fz;w1=fz-fy;w2=fy-fx;w3=fx;A=c001;B=c011;}
    else if(fz>fx){w0=1-fy;w1=fy-fz;w2=fz-fx;w3=fx;A=c010;B=c011;}
    else{w0=1-fy;w1=fy-fx;w2=fx-fz;w3=fz;A=c010;B=c110;}
  }
  return [w0*D[c000]+w1*D[A]+w2*D[B]+w3*D[c111],
          w0*D[c000+1]+w1*D[A+1]+w2*D[B+1]+w3*D[c111+1],
          w0*D[c000+2]+w1*D[A+2]+w2*D[B+2]+w3*D[c111+2]];
}

// ---------- Palette dominante (k-means, 6 couleurs) ----------
function buildPalette(img,k,roi){
  k=Math.max(1,Math.floor(k||6));
  const {data:d,n}=sampleImg(img,roi),pts=[],seen=new Set();
  for(let i=0;i<n;i+=7){
    const a=d[i*4+3],r=d[i*4],g=d[i*4+1],b=d[i*4+2];
    if(a<=0)continue;
    const key=r+','+g+','+b;if(seen.has(key))continue;seen.add(key);pts.push([r,g,b]);
  }
  if(!pts.length)return [];
  k=Math.min(k,pts.length);
  let cent=[];for(let c=0;c<k;c++)cent.push(pts[Math.floor((c+0.5)/k*pts.length)].slice());
  const assign=new Array(pts.length).fill(0);
  for(let it=0;it<10;it++){
    for(let i=0;i<pts.length;i++){let bi=0,bd=Infinity;for(let c=0;c<k;c++){const dr=pts[i][0]-cent[c][0],dg=pts[i][1]-cent[c][1],db=pts[i][2]-cent[c][2],dist=dr*dr+dg*dg+db*db;if(dist<bd){bd=dist;bi=c;}}assign[i]=bi;}
    const sums=cent.map(()=>[0,0,0,0]);
    for(let i=0;i<pts.length;i++){const q=sums[assign[i]];q[0]+=pts[i][0];q[1]+=pts[i][1];q[2]+=pts[i][2];q[3]++;}
    for(let c=0;c<k;c++)cent[c]=sums[c][3]?sums[c].slice(0,3).map(v=>v/sums[c][3]):pts[(c+it)%pts.length].slice();
  }
  const counts=new Array(k).fill(0);for(const a of assign)counts[a]++;
  return cent.map((c,i)=>({hex:'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join(''),pct:counts[i]/pts.length*100})).sort((a,b)=>b.pct-a.pct);
}
function showPalette(img,roi){
  const pal=buildPalette(img,6,roi);
  const el=$('palette');
  el.innerHTML=pal.map(s=>`<div class="swatch" style="background:${s.hex};flex:${Math.max(s.pct,4).toFixed(1)}" title="${s.hex} — ${s.pct.toFixed(1)}%"><em>${s.pct.toFixed(0)}%</em><span>${s.hex}</span></div>`).join('');
  el.style.display='flex';$('paletteTitle').style.display='block';
}

// ---------- Analyse affichée ----------
function fmt(x,d=3){return x.toFixed(d);}
function castLabel(c){
  const C=Math.hypot(c[0],c[1]);if(C<0.006)return 'neutre';
  const h=(Math.atan2(c[1],c[0])*180/Math.PI+360)%360;
  const name=h<35?'magenta-rouge':h<75?'orange':h<110?'jaune':h<160?'vert':h<220?'cyan / teal':h<290?'bleu':h<330?'violet':'magenta';
  return name+' '+fmt(C*100,1);
}
function showStats(){
  const r=refModel,s=srcModel;if(!r&&!s)return;
  $('statsBox').style.display='';
  const col=(m,f)=>m?f(m):'—';
  const rows=[
    ['Noirs P2 · L',m=>fmt(quant(m.q,.02)*100,1)],
    ['Médiane · L',m=>fmt(quant(m.q,.5)*100,1)],
    ['Blancs P98 · L',m=>fmt(quant(m.q,.98)*100,1)],
    ['Contraste P2→P98',m=>fmt((quant(m.q,.98)-quant(m.q,.02))*100,1)],
    ['Chroma moyen',m=>fmt(m.meanC*100,1)],
    ['Dominante ombres',m=>castLabel(m.cast[1])],
    ['Dominante tons moyens',m=>castLabel(m.cast[2])],
    ['Dominante hautes lumières',m=>castLabel(m.cast[3])]
  ];
  $('statsBody').innerHTML='<div class="statrow statrow--head"><span></span><b>Réf</b><b>Rush</b></div>'+rows.map(x=>`<div class="statrow"><span>${x[0]}</span><b>${col(r,x[1])}</b><b>${col(s,x[1])}</b></div>`).join('');
}

// ---------- Score : écart réf ↔ image, par zone tonale ----------
// Compare les couleurs moyennes des ombres / tons moyens / hautes lumières (ΔE2000).
function zoneMeans(s){
  const sorted=Float32Array.from(s.L).sort(),n=s.n;
  const ranges=[[0,.2],[.4,.6],[.8,1]].map(([a,b])=>[sorted[Math.floor(a*(n-1))],sorted[Math.floor(b*(n-1))]]);
  return ranges.map(([lo,hi])=>{let c=0,L=0,A=0,B=0;for(let i=0;i<n;i++){const v=s.L[i];if(v>=lo&&v<=hi){L+=v;A+=s.A[i];B+=s.B[i];c++;}}return c?[L/c,A/c,B/c]:[0,0,0];});
}
function matchScore(a,b){
  const za=zoneMeans(a),zb=zoneMeans(b);let s=0;
  for(let i=0;i<3;i++){const x=ok2lab(za[i]),y=ok2lab(zb[i]);s+=deltaE2000(x[0],x[1],x[2],y[0],y[1],y[2]);}
  return s/3;
}
let refSamplesCache=null,lastDE=null;
function showDE(before,after){
  const box=$('deBox');
  box.classList.remove('descore--ok','descore--warn','descore--bad');
  let cls,title,advice;
  if(after<3){cls='descore--ok';title='Très proche de la référence';advice='Tu peux exporter, ou affiner à l\'œil avec les retouches.';}
  else if(after<6){cls='descore--warn';title='Proche de la référence';advice='Affine avec les retouches ou les zones de luminosité.';}
  else{cls='descore--bad';title='Encore éloigné de la référence';advice='Si les contenus sont très différents, dessine une zone de match sur des éléments comparables.';}
  box.classList.add(cls,'has-score');
  lastDE=after;
  $('deNum').innerHTML=fmt(after,1)+'<small>ΔE · avant '+fmt(before,1)+'</small>';
  $('deTxt').innerHTML='<b>'+title+'</b><br>'+advice+' <span style="color:var(--faint)">Le score compare les couleurs moyennes des ombres, tons moyens et lumières.</span>';
  const pos=v=>clamp(v/12*100,1,99)+'%';
  $('meterAfter').style.setProperty('--m',pos(after));
  $('meterBefore').style.setProperty('--m',pos(before));
}

function syncLabels(){
  const pct=id=>$(id).value+'%';
  $('vInt').textContent=pct('intensity');
  $('vLum').textContent=pct('matchLum');
  $('vCol').textContent=pct('matchCol');
  $('vSat').textContent=pct('sat');
  $('vCon').textContent=pct('con');
  $('vWarm').textContent=$('warm').value;
  $('vTint').textContent=$('tint').value;
  $('vCrush').textContent=$('crush').value==50?'0':String($('crush').value-50);
  ['Sh','Md','Hi'].forEach(z=>{
    $('vZ'+z).textContent=(+$('z'+z).value/100).toFixed(2);
    $('vZ'+z+'W').textContent=$('z'+z+'W').value;
  });
  document.querySelectorAll('input[type=range]').forEach(r=>r.style.setProperty('--p',((r.value-r.min)/(r.max-r.min)*100)+'%'));
}

// ---------- Scopes : vectorscope + waveform RGB ----------
function drawScopes(d){
  const W=128,H=128;
  const tmp=document.createElement('canvas');tmp.width=W;tmp.height=H;
  const tctx=tmp.getContext('2d',{willReadFrequently:true});
  tctx.drawImage(d,0,0,W,H);
  const px=tctx.getImageData(0,0,W,H).data;

  const cv=$('cvVector'),ctx=cv.getContext('2d');
  const S=cv.width,cx=S/2,cy=S/2,rad=S/2-8;
  ctx.fillStyle='#101013';ctx.fillRect(0,0,S,S);
  ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(cx,cy,rad,0,2*Math.PI);ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx-rad,cy);ctx.lineTo(cx+rad,cy);ctx.moveTo(cx,cy-rad);ctx.lineTo(cx,cy+rad);ctx.stroke();
  ctx.strokeStyle='rgba(94,194,106,.45)';
  ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+rad*Math.cos(123*Math.PI/180),cy-rad*Math.sin(123*Math.PI/180));ctx.stroke();
  const img=ctx.getImageData(0,0,S,S),dd=img.data;
  for(let i=0;i<px.length;i+=4){
    const r=px[i]/255,g=px[i+1]/255,b=px[i+2]/255;
    const u=-0.147*r-0.289*g+0.436*b, v=0.615*r-0.515*g-0.100*b;
    const x=Math.round(cx+u*rad*2.1), y=Math.round(cy-v*rad*2.1);
    if(x<0||x>=S||y<0||y>=S)continue;
    const o=(y*S+x)*4;
    dd[o]=Math.min(255,dd[o]+60);dd[o+1]=Math.min(255,dd[o+1]+55);dd[o+2]=Math.min(255,dd[o+2]+45);dd[o+3]=255;
  }
  ctx.putImageData(img,0,0);

  const cw=$('cvWave'),wc=cw.getContext('2d');
  const WS=cw.width,HS=cw.height;
  wc.fillStyle='#101013';wc.fillRect(0,0,WS,HS);
  wc.strokeStyle='rgba(255,255,255,.1)';
  for(let q=1;q<4;q++){wc.beginPath();wc.moveTo(0,HS*q/4);wc.lineTo(WS,HS*q/4);wc.stroke();}
  const wimg=wc.getImageData(0,0,WS,HS),wd=wimg.data;
  for(let i=0;i<px.length;i+=4){
    const x=Math.min(WS-1,Math.floor(((i/4)%W)/W*WS));
    for(let c=0;c<3;c++){
      const y=Math.round(HS-1-px[i+c]/255*(HS-1));
      const o=(y*WS+x)*4+c;
      wd[o]=Math.min(255,wd[o]+70);wd[o+3]=255;
    }
  }
  wc.putImageData(wimg,0,0);
  $('scopesEmpty').style.display='none';$('scopesGrid').style.display='grid';
}

// ---------- Rendu de la prévisualisation ----------
function renderPrev(img){
  const cv=$('cvPrev');
  const scale=Math.min(1,(focusMode?1920:1280)/img.width);
  cv.width=Math.max(1,Math.round(img.width*scale));
  cv.height=Math.max(1,Math.round(img.height*scale));
  $('baEmpty').style.display='none';$('baPrev').style.display='block';$('tagPrev').style.display='block';
  const before=$('baBefore');
  if(before.src!==img.src)before.src=img.src;
  const ctx=cv.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(img,0,0,cv.width,cv.height);
  if(!lut)return;
  const id=ctx.getImageData(0,0,cv.width,cv.height);
  applyLutRGBA(id.data);
  ctx.putImageData(id,0,0);
  // score + scopes : coûteux, recalculés seulement quand l'utilisateur s'arrête
  clearTimeout(scoreTimer);scoreTimer=setTimeout(()=>updateScoreAndScopes(img),180);
}
let scoreTimer=null,beforeCache={key:null,value:0};
function updateScoreAndScopes(img){
  const cv=$('cvPrev');
  if(refImg&&lut){
    if(!refSamplesCache){refSamplesCache=imagesSamples([refImg],roiState.ref);beforeCache.key=null;}
    const key=img.src+'|'+JSON.stringify(roiState);
    if(beforeCache.key!==key)beforeCache={key,value:matchScore(refSamplesCache,imagesSamples([img],roiState.prev))};
    showDE(beforeCache.value,matchScore(refSamplesCache,imagesSamples([cv],roiState.prev)));
  }
  drawScopes(cv);
}
// Application de la LUT sur un buffer RGBA 8 bits (tétraédrique, sans allocation par pixel)
function applyLutRGBA(d){
  const S=lut.size,D=lut.data,S1=S-1,f=S1/255,SS=S*S;
  for(let p=0;p<d.length;p+=4){
    const x=d[p]*f,y=d[p+1]*f,z=d[p+2]*f;
    const i0=Math.min(x|0,S-2),j0=Math.min(y|0,S-2),k0=Math.min(z|0,S-2);
    const fx=x-i0,fy=y-j0,fz=z-k0;
    const c000=(k0*SS+j0*S+i0)*3,c111=c000+(SS+S+1)*3;
    let w0,w1,w2,w3,A,B;
    if(fx>fy){
      if(fy>fz){w0=1-fx;w1=fx-fy;w2=fy-fz;w3=fz;A=c000+3;B=c000+(S+1)*3;}
      else if(fx>fz){w0=1-fx;w1=fx-fz;w2=fz-fy;w3=fy;A=c000+3;B=c000+(SS+1)*3;}
      else{w0=1-fz;w1=fz-fx;w2=fx-fy;w3=fy;A=c000+SS*3;B=c000+(SS+1)*3;}
    }else{
      if(fz>fy){w0=1-fz;w1=fz-fy;w2=fy-fx;w3=fx;A=c000+SS*3;B=c000+(SS+S)*3;}
      else if(fz>fx){w0=1-fy;w1=fy-fz;w2=fz-fx;w3=fx;A=c000+S*3;B=c000+(SS+S)*3;}
      else{w0=1-fy;w1=fy-fx;w2=fx-fz;w3=fz;A=c000+S*3;B=c000+(S+1)*3;}
    }
    d[p]=(w0*D[c000]+w1*D[A]+w2*D[B]+w3*D[c111])*255+0.5;
    d[p+1]=(w0*D[c000+1]+w1*D[A+1]+w2*D[B+1]+w3*D[c111+1])*255+0.5;
    d[p+2]=(w0*D[c000+2]+w1*D[A+2]+w2*D[B+2]+w3*D[c111+2])*255+0.5;
  }
}

// ---------- ROI dessinable, persistante et partagée par l’analyse ----------
const ROI_KEY='cgt_match_roi_v1';
let roiState={ref:null,prev:null},roiMode=false,roiDrag=null;
function loadROI(){try{const v=JSON.parse(localStorage.getItem(ROI_KEY));if(v&&typeof v==='object')roiState={ref:v.ref||null,prev:v.prev||null};}catch(e){}}
function saveROI(){try{localStorage.setItem(ROI_KEY,JSON.stringify(roiState));}catch(e){}}
function roiLabel(){const z=[roiState.ref&&'réf',roiState.prev&&'plan'].filter(Boolean);$('roiStatus').textContent=roiMode?'Trace un rectangle sur chaque image…':(z.length?'Zone active sur : '+z.join(' + '):'');$('btnRoi').textContent=roiMode?'✓ Terminer':'⌗ Dessiner une zone';}
function drawROI(which){const r=roiState[which],el=$('roiOverlay'+(which==='ref'?'Ref':'Prev'));if(!el)return;el.style.display=r?'block':'none';if(r){el.style.setProperty('--rx',(r.x*100)+'%');el.style.setProperty('--ry',(r.y*100)+'%');el.style.setProperty('--rx2',((r.x+r.w)*100)+'%');el.style.setProperty('--ry2',((r.y+r.h)*100)+'%');}}
let roiTimer=null;
function setROI(which,r){roiState[which]=r;drawROI(which);saveROI();roiLabel();clearTimeout(roiTimer);roiTimer=setTimeout(()=>{if(which==='ref'){refSamplesCache=null;refreshAnalysis();}else refreshSource();},120);}
function bindROI(which,stageId){const stage=$(stageId);stage.addEventListener('pointerdown',e=>{if(!roiMode)return;e.preventDefault();const b=stage.getBoundingClientRect();roiDrag={which,x0:clamp((e.clientX-b.left)/b.width,0,1),y0:clamp((e.clientY-b.top)/b.height,0,1)};stage.setPointerCapture(e.pointerId);});stage.addEventListener('pointermove',e=>{if(!roiDrag||roiDrag.which!==which)return;const b=stage.getBoundingClientRect(),x=clamp((e.clientX-b.left)/b.width,0,1),y=clamp((e.clientY-b.top)/b.height,0,1);const x0=Math.min(roiDrag.x0,x),y0=Math.min(roiDrag.y0,y),w=Math.max(.01,Math.abs(x-roiDrag.x0)),h=Math.max(.01,Math.abs(y-roiDrag.y0));setROI(which,{x:x0,y:y0,w:Math.min(w,1-x0),h:Math.min(h,1-y0)});});stage.addEventListener('pointerup',()=>{roiDrag=null;});stage.addEventListener('click',e=>{if(roiMode)e.stopPropagation();});stage.addEventListener('dblclick',e=>{if(roiMode){e.preventDefault();setROI(which,null);}});}
function toggleROIMode(){roiMode=!roiMode;document.body.classList.toggle('roi-mode',roiMode);$('btnRoi').classList.toggle('active',roiMode);roiLabel();}

// Slider avant/après
(function(){
  const ba=$('baPrev');
  let dragging=false;
  const set=x=>{const r=ba.getBoundingClientRect();const pct=clamp((x-r.left)/r.width*100,0,100);ba.style.setProperty('--split',pct+'%');};
  const start=e=>{if(roiMode)return;dragging=true;set((e.touches?e.touches[0]:e).clientX);};
  const move=e=>{if(!dragging)return;e.preventDefault();set((e.touches?e.touches[0]:e).clientX);};
  const end=()=>dragging=false;
  ba.addEventListener('mousedown',start);ba.addEventListener('touchstart',start,{passive:true});
  ba.addEventListener('click',e=>e.stopPropagation());
  window.addEventListener('mousemove',move);window.addEventListener('touchmove',move,{passive:false});
  window.addEventListener('mouseup',end);window.addEventListener('touchend',end);
})();

// ---------- Export .cube ----------
function download(){
  if(!match){alert('Charge une référence ET une frame de rush pour générer la LUT.');return;}
  generateLUT(+$('lutSize').value);
  const S=lut.size,D=lut.data,lines=[];
  lines.push('TITLE "Colour Grade Tool match"','# Created with Colour Grade Tool v4','# OKLab tone + per-zone colour match, sRGB/Rec.709 display-referred in & out','LUT_3D_SIZE '+S,'DOMAIN_MIN 0.0 0.0 0.0','DOMAIN_MAX 1.0 1.0 1.0','');
  for(let i=0;i<D.length;i+=3)lines.push(D[i].toFixed(6)+' '+D[i+1].toFixed(6)+' '+D[i+2].toFixed(6));
  const blob=new Blob([lines.join('\n')+'\n'],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='colour_grade_tool_match_'+S+'.cube';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  exported=true;updateUI();
}

// ---------- Presets localStorage ----------
const PKEY='cgt_presets_v4';
function setControls(c){CTL_IDS.forEach(id=>{if(c[id]!==undefined)$(id).value=c[id];});syncLabels();scheduleRegen();}
function loadPresets(){
  try{return JSON.parse(localStorage.getItem(PKEY))||{};}catch(e){return {};}
}
function refreshPresetList(){
  const ps=loadPresets();
  $('presetList').innerHTML='<option value="">— Presets sauvegardés —</option>'+Object.keys(ps).map(k=>`<option>${k}</option>`).join('');
}
function savePreset(){
  const name=$('presetName').value.trim();
  if(!name){$('presetName').placeholder='⚠ Donne un nom au preset';return;}
  const ps=loadPresets();
  ps[name]=currentGrade();
  localStorage.setItem(PKEY,JSON.stringify(ps));
  $('presetName').value='';refreshPresetList();$('presetList').value=name;
}
function applyPreset(){
  const name=$('presetList').value;if(!name)return;
  const ps=loadPresets();if(ps[name])setControls(ps[name]);
}
function deletePreset(){
  const name=$('presetList').value;if(!name)return;
  const ps=loadPresets();delete ps[name];
  localStorage.setItem(PKEY,JSON.stringify(ps));refreshPresetList();
}

// ---------- Slots de looks A/B/C ----------
const LOOK_SLOTS_KEY='cgt_look_slots_v4';
const LOOK_ACTIVE_KEY='cgt_look_active_v4';
const LOOK_SLOT_NAMES=['A','B','C'];
let activeLookSlot=null;
function loadLookSlots(){
  try{return JSON.parse(localStorage.getItem(LOOK_SLOTS_KEY))||{};}catch(e){return {}; }
}
function saveLookSlots(slots){
  try{localStorage.setItem(LOOK_SLOTS_KEY,JSON.stringify(slots));}catch(e){console.warn('Slots de looks non persistés',e);}
}
function currentGrade(){
  const grade={};
  CTL_IDS.forEach(id=>{grade[id]=$(id).value;});
  return grade;
}
function updateLookSlotUI(){
  $('activeLookSlot').textContent=activeLookSlot||'—';
  LOOK_SLOT_NAMES.forEach(name=>{
    const card=$('lookSlot'+name);
    if(card)card.classList.toggle('is-active',activeLookSlot===name);
  });
}
function captureLookSlot(name){
  const slots=loadLookSlots();
  slots[name]={version:4,date:new Date().toISOString(),controls:currentGrade()};
  saveLookSlots(slots);
  try{localStorage.setItem(LOOK_ACTIVE_KEY,name);}catch(e){}
  activeLookSlot=name;
  updateLookSlotUI();
}
function applyLookSlot(name){
  const entry=loadLookSlots()[name];
  if(!entry||!entry.controls){alert('Le slot '+name+' est vide. Capture d’abord le grade courant.');return;}
  activeLookSlot=name;
  try{localStorage.setItem(LOOK_ACTIVE_KEY,name);}catch(e){}
  setControls(entry.controls);
  updateLookSlotUI();
}
LOOK_SLOT_NAMES.forEach(name=>{
  $('saveLook'+name).addEventListener('click',()=>captureLookSlot(name));
  $('loadLook'+name).addEventListener('click',()=>applyLookSlot(name));
});

// ---------- Export / import presets JSON ----------
function exportPreset(){
  const name=$('presetName').value.trim()||$('presetList').value||'preset';
  const payload={version:4,name:name,date:new Date().toISOString(),controls:currentGrade()};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='preset-'+Date.now()+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function importPresetFile(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const payload=JSON.parse(reader.result);
      setControls(payload.controls||payload);
      if(payload.name)$('presetName').value=payload.name;
    }catch(e){alert('Preset JSON invalide.');}
  };
  reader.readAsText(file);
}

// ---------- Rapport de match PNG ----------
function exportMatchReport(){
  const ref=$('imgRef'), graded=$('cvPrev');
  if(!ref.naturalWidth || !graded.width){
    alert('Charge une référence et une frame de rush avant d’exporter le rapport.');
    return;
  }
  const W=1400,H=980, pad=52, gap=28, panelW=(W-pad*2-gap)/2, panelH=510;
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const c=cv.getContext('2d');
  c.fillStyle='#111115';c.fillRect(0,0,W,H);
  c.fillStyle='#f4f1ea';c.font='700 34px system-ui';c.fillText('Colour Grade Tool — Rapport de match',pad,58);
  c.fillStyle='#aaa6a0';c.font='16px system-ui';c.fillText(new Date().toLocaleString('fr-FR'),pad,86);
  const contain=(image,x,y,w,h)=>{
    const iw=image.naturalWidth||image.width, ih=image.naturalHeight||image.height;
    const scale=Math.min(w/iw,h/ih), dw=iw*scale, dh=ih*scale;
    c.drawImage(image,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
  };
  c.fillStyle='#222228';c.fillRect(pad,112,panelW,panelH);c.fillRect(pad+panelW+gap,112,panelW,panelH);
  contain(ref,pad,112,panelW,panelH);contain(graded,pad+panelW+gap,112,panelW,panelH);
  c.fillStyle='#fff';c.font='700 20px system-ui';c.fillText('RÉFÉRENCE',pad+18,145);c.fillText('RUSH GRADÉ',pad+panelW+gap+18,145);
  c.fillStyle='#f4f1ea';c.font='700 24px system-ui';c.fillText('Score ΔE2000 par zone : '+(lastDE===null?'—':fmt(lastDE,1)),pad,682);
  c.fillStyle='#bdb9b2';c.font='16px system-ui';
  const interpretation=$('deTxt').innerText.replace(/\n+/g,' ');c.fillText(interpretation.slice(0,112),pad,712);c.fillText(interpretation.slice(112,224),pad,737);
  const g=currentGrade();
  const settings=['Intensité '+g.intensity+'%','Lumière réf '+g.matchLum+'%','Couleur réf '+g.matchCol+'%','Saturation '+g.sat+'%','Contraste '+g.con+'%','Chaleur '+g.warm,'Teinte '+g.tint,'Noirs '+(g.crush-50),'LUT '+$('lutSize').value+'³'];
  c.fillStyle='#f4f1ea';c.font='700 18px system-ui';c.fillText('Réglages actuels',pad,787);
  c.fillStyle='#bdb9b2';c.font='16px system-ui';c.fillText(settings.join('  ·  '),pad,814);
  c.fillStyle='#f4f1ea';c.font='700 18px system-ui';c.fillText('Palette dominante',pad,864);
  c.font='16px system-ui';c.fillStyle='#bdb9b2';
  const palette=[...document.querySelectorAll('#palette .swatch')].map(x=>x.title).filter(Boolean).join('  ·  ');
  c.fillText(palette||'—',pad,891);
  cv.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rapport-match-'+Date.now()+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},'image/png');
}

// ---------- Wiring ----------
setupDrop('dropRef',img=>{
  refImg=img;refSamplesCache=null;
  const ir=$('imgRef');
  ir.src=img.src;ir.style.display='block';
  $('ringRef').style.display='none';
  $('tagRef').style.display='block';
  $('pipRef').src=img.src;updatePip();
  refreshAnalysis();
});
setupDrop('dropPrev',img=>{
  prevImg=img;
  drawROI('prev');
  refreshSource();
  renderPrev(img);
});
$('rushFiles').addEventListener('change',e=>{addRushFiles(e.target.files);e.target.value='';});
CTL_IDS.forEach(id=>{
  $(id).addEventListener('input',()=>{syncLabels();scheduleRegen();});
  $(id).addEventListener('dblclick',()=>{$(id).value=CTL_DEFAULTS[id];syncLabels();scheduleRegen();});
});
$('lutSize').addEventListener('change',scheduleRegen);
function resetControls(){setControls(CTL_DEFAULTS);}
function runAutoMatch(){
  if(!refImg||!prevImg){alert('Charge une référence et une frame de rush.');return false;}
  resetControls();return true;
}
$('btnDl').addEventListener('click',download);
$('btnReport').addEventListener('click',exportMatchReport);
$('btnAuto').addEventListener('click',runAutoMatch);
$('btnReset').addEventListener('click',resetControls);
$('btnSave').addEventListener('click',savePreset);
$('btnLoad').addEventListener('click',applyPreset);
$('btnDel').addEventListener('click',deletePreset);
$('btnExportPreset').addEventListener('click',exportPreset);
$('btnImportPreset').addEventListener('click',()=>$('presetFile').click());
$('presetFile').addEventListener('change',e=>{importPresetFile(e.target.files[0]);e.target.value='';});
loadROI();bindROI('ref','roiStageRef');bindROI('prev','baPrev');drawROI('ref');drawROI('prev');$('btnRoi').addEventListener('click',toggleROIMode);$('btnRoiReset').addEventListener('click',()=>{roiState={ref:null,prev:null};saveROI();drawROI('ref');drawROI('prev');roiLabel();refSamplesCache=null;if(refImg)refreshAnalysis();if(prevImg)refreshSource();});roiLabel();syncLabels();refreshPresetList();updateUI();
(function restoreLookSlots(){
  let saved=null;try{saved=localStorage.getItem(LOOK_ACTIVE_KEY);}catch(e){}
  if(saved&&loadLookSlots()[saved])activeLookSlot=saved;
  updateLookSlotUI();
})();

// ---------- Preview agrandie (F) + référence en incrustation (R) ----------
let focusMode=false,pipOn=true;
function updatePip(){$('pipRef').hidden=!(focusMode&&pipOn&&refImg);$('btnPip').classList.toggle('active',pipOn);}
function setFocus(on){
  focusMode=on;document.body.classList.toggle('focus',on);
  $('btnFocus').textContent=on?'⤡ Réduire':'⤢ Agrandir';
  updatePip();
  if(prevImg)renderPrev(prevImg);
  if(on)window.scrollTo({top:0});
}
$('btnFocus').addEventListener('click',()=>setFocus(!focusMode));
$('btnPip').addEventListener('click',()=>{pipOn=!pipOn;updatePip();});
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)&&e.target.type!=='range')return;
  const k=e.key.toLowerCase();
  if(k==='f'&&prevImg){e.preventDefault();setFocus(!focusMode);}
  else if(k==='escape'&&focusMode)setFocus(false);
  else if(k==='r'&&focusMode){pipOn=!pipOn;updatePip();}
});

// ---------- Mode expert persistant ----------
(function(){
  const toggle=$('modeExpert');
  if(!toggle)return;
  const key='cgt_expert_mode_v1';
  let saved=false;try{saved=localStorage.getItem(key)==='1';}catch(e){}
  toggle.checked=saved;
  document.body.classList.toggle('expert-mode',saved);
  toggle.addEventListener('change',function(){
    const enabled=toggle.checked;
    document.body.classList.toggle('expert-mode',enabled);
    try{localStorage.setItem(key,enabled?'1':'0');}catch(e){}
  });
})();

(function(){
  document.querySelectorAll('[data-simple-action]').forEach(btn=>btn.addEventListener('click',function(){
    const a=this.dataset.simpleAction;
    if(a==='auto'){runAutoMatch();return;}
    if(a==='reset'){resetControls();return;}
    if(a==='warm'){setControls({warm:30,tint:0});return;}
    if(a==='cool'){setControls({warm:-30,tint:0});return;}
    if(a==='cinema'){setControls({con:115,crush:68});return;}
  }));
})();
