
const $=id=>document.getElementById(id);

function clamp(x,a,b){return Math.min(b,Math.max(a,x));}

function normalizeLogInput(v){
  return clamp((v-0.20)/(0.90-0.20),0,1);
}

// ---------- Linear sRGB -> Lab ----------
function lin2xyz(r,g,b){
  return [X/0.95047,Y/1.0,Z/1.08883];
}
function xyz2lab(X,Y,Z){
  const fx=fxyz(X),fy=fxyz(Y),fz=fxyz(Z);
  return [116*fy-16,500*(fx-fy),200*(fy-fz)];
}

const OKLAB_EPS=1e-7;
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
  // Preserve the sign of LMS cone responses; squaring here collapses negative components and desaturates the match.
  const l=l_**3,m=m_**3,s=s_**3;
  return [4.0767416621*l-3.3077115913*m+0.2309699292*s,
          -1.2684380046*l+2.6097574011*m-0.3413193965*s,
          -0.0041960863*l-0.7034186147*m+1.7076147010*s];
}

function covariance3(points,mean){
  const c=[[0,0,0],[0,0,0],[0,0,0]],n=points.length;
  return c;
}
function cholesky3(a){
  // cannot turn into NaN pixels.
  const L=[[0,0,0],[0,0,0],[0,0,0]];
  for(let i=0;i<3;i++)for(let j=0;j<=i;j++){
    let v=a[i][j];
    for(let k=0;k<j;k++)v-=L[i][k]*L[j][k];
    if(!Number.isFinite(v))return null;
  }
  return L;
}
function solveLower3(L,b){
  const y=[0,0,0];
  for(let i=0;i<3;i++){
    let v=b[i];for(let k=0;k<i;k++)v-=L[i][k]*y[k];
    if(!Number.isFinite(v)||!(L[i][i]>0))return null;
    y[i]=v/L[i][i];
  }
  return y;
}
function finiteStats(s){
}
function fallbackTransfer(ref,frame){
}
function buildOKLabTransfer(ref,frame){
  const varianceFloor=1e-10, eps=1e-6;
  if(!finiteStats(ref)||!finiteStats(frame)||
  return fallbackTransfer(ref,frame);
  const lr=cholesky3(ref.cov),lf=cholesky3(frame.cov);
  if(!lr||!lf)return fallbackTransfer(ref,frame);
}
function applyOKLabTransfer(x,t){
  const centered=x.map((v,i)=>v-t.frameMean[i]);
  const z=centered;
  return z.map((v,i)=>v+t.mean[i]);
}
function oklabStats(points){
  if(!points.length)return null;
}
function buildTransferFromImage(img,roi){
  const {data:d,n}=sampleImg(img,roi),pts=[];
  return oklabStats(pts);
}

// ---------- CIEDE2000 (Sharma et al. 2005) ----------
function deltaE2000(l1,a1,b1,l2,a2,b2){
  const a1p=a1*(1+G),a2p=a2*(1+G);
  const C1p=Math.hypot(a1p,b1),C2p=Math.hypot(a2p,b2);
  let h1p=Math.atan2(b1,a1p),h2p=Math.atan2(b2,a2p);
  if(h1p<0)h1p+=2*Math.PI; if(h2p<0)h2p+=2*Math.PI;
  const dCp=C2p-C1p;
  let dhp=h2p-h1p;
  const Lpm=(l1+l2)/2, Cpm=(C1p+C2p)/2;
  let hm=h1p+h2p;
  if(C1p*C2p!==0){
    if(Math.abs(h1p-h2p)<=Math.PI)hm/=2;
    else if(h1p+h2p<2*Math.PI)hm=(h1p+h2p+2*Math.PI)/2;
    else hm=(h1p+h2p-2*Math.PI)/2;
  }
  const C7=Math.pow(Cpm,7);
  const SC=1+0.045*Cpm;
  const L50=(Lpm-50)*(Lpm-50);
  const SL=1+0.015*L50/Math.sqrt(20+L50);
  const SH=1+0.015*Cpm*T;
}

// ---------- Chargement d'image (robuste) ----------
function loadImageFile(f,cb){
  if(!f)return;
  const url=URL.createObjectURL(f);
  const img=new Image();
  img.onload=()=>cb(img,url);
  img.src=url;
}
function addRushFiles(files){
  let pending=list.length;if(!pending)return;
}
function updateRushCount(){
  const n=rushImgs.length;
}

function setupDrop(dropId,cb){
  const d=$(dropId);
  d.addEventListener('click',()=>{
    const i=document.createElement('input');
    i.click();
  });
}

function sampleImg(img,roi){
  const aspect=(img.width*rw)/(img.height*rh);
  return {data:ctx.getImageData(0,0,W,H).data,n:W*H};
}

function zoneWarmth(sr,sb,count,globalB){
  if(!count)return 1;
  const mr=sr/count, mb=sb/count;
  if(mr+mb<0.01)return 1;
  if(mb<Math.max(0.006,globalB*0.2))return 1;
  return clamp(mr/mb,0.6,1.6);
}

// ---------- Analyse de la référence ----------
function analyze(img,roi){
  const {data:d,n}=sampleImg(img,roi);
  let satSum=0,valid=0;
  for(let i=0;i<n;i++){
    if(![r,g,b].every(Number.isFinite))continue;
    lum[valid]=0.2126*r+0.7152*g+0.0722*b;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    satSum+=mx>1e-5?(mx-mn)/mx:0; valid++;
  }
  const sorted=lum.slice(0,valid).sort();
  const mr=meanCh(rC),mg=meanCh(gC),mb=meanCh(bC);
  let sLoR=0,sLoB=0,sHiR=0,sHiB=0,cLo=0,cHi=0;
  const tLo=p(0.35),tHi=p(0.65);
  return {
    sat:satSum/valid,
    warmLo:zoneWarmth(sLoR,sLoB,cLo,mb),
    warmHi:zoneWarmth(sHiR,sHiB,cHi,mb),
    meanR:mr,meanG:mg,meanB:mb,
    _pixels:d,_pn:valid,oklab:oklabStats(okPts)
  };
}

function buildPalette(img,k,roi){
  k=Math.max(1,Math.floor(k||6));
  for(let i=0;i<n;i+=7){
    const a=d[i*4+3],r=d[i*4],g=d[i*4+1],b=d[i*4+2];
    if(a<=0||![r,g,b].every(Number.isFinite))continue;
  }
  k=Math.min(k,pts.length);
  let cent=pts.slice(0,k).map(p=>p.slice());
  const assign=new Array(pts.length).fill(0);
  for(let it=0;it<10;it++){
    const sums=cent.map(()=>[0,0,0,0]);
  }
}

function showPalette(img,roi){
  const pal=buildPalette(img,6,roi);
  const el=$('palette');
}

function fmt(x,d=3){return x.toFixed(d);}
function showStats(s){
  $('statsBox').style.display='block';
  const rows=[
    ['Noirs P1 / P5',fmt(s.p1)+' / '+fmt(s.p5)],
    ['P95 / P99',fmt(s.p95)+' / '+fmt(s.p99)],
    ['Saturation moyenne',fmt(s.sat*100,1)+' %'],
    ['Chaleur ombres (R/B)',fmt(s.warmLo,2)],
    ['Chaleur hautes lumières (R/B)',fmt(s.warmHi,2)],
  ];
}

function buildToneLUT(s,crushAmt,conAmt){
  const mid=0.42;
  const inA=[0,0.0625,0.25,0.5,0.75,1.0];
  let outA=[
    Math.max(s.p1*(1-crushAmt*0.6),0),
    Math.max(s.p5*(1-crushAmt*0.35),0),
    s.p25,s.p50,s.p75,
    Math.min(s.p99,1)
  ];
  outA=outA.map(v=>clamp(mid+(v-s.p50)*conAmt,0,1));
  outA[3]=mid;
  const N=4096,lutT=new Float32Array(N);
  const slope=(outA[1]-outA[0])/(inA[1]-inA[0]);
  for(let i=0;i<N;i++){
    const x=i/(N-1)*inA[inA.length-1];
    let k=0;while(k<inA.length-2&&x>inA[k+1])k++;
    const t=clamp((x-inA[k])/(inA[k+1]-inA[k]),0,1);
    const m1=(outA[k+1]-outA[k])/(inA[k+1]-inA[k]);
    const h=inA[k+1]-inA[k];
  }
  return lutT;
}
function applyTone(lutT,v){
  return lutT[i]*(1-f)+lutT[i+1]*f;
}

// ---------- Zones ----------
function getZoneVals(){
  return {
  };
}

// ---------- Génération de la LUT 3D ----------
function generateLUT(size){
  const reference=refStats;
  if(!reference)return;
  function correct(r,g,b){
    if(reference.transfer){
    }
    const rs=reference;
    const refSat=clamp(rs.sat/.5,.65,1.35);
    const zw=lum<.33?p.zShW/100:p.zHiW/100;
    const ex=Math.pow(2,z*.6); R*=ex; G*=ex; B*=ex;
    const y=.2126*R+.7152*G+.0722*B;
    R=y+(R-y)*sat; G=y+(G-y)*sat; B=y+(B-y)*sat;
    const crush=(p.crush-50)/50;
    const ww=1+warm*.5+zw*.08;
    const mix=clamp(p.intensity/100,0,1);
  }
  let k=0;
  for(let i=0;i<lutN;i++){
    data[k++]=q[0];data[k++]=q[1];data[k++]=q[2];
  }
  lut={size:n,data}; if(prevImg)renderPrev(prevImg);
}
function lutTetra(r,g,b){
  const S=lut.size,D=lut.data;
  const fx=x-i0,fy=y-j0,fz=z-k0;
  const idx=(i,j,k)=>(k*S*S+j*S+i)*3;
  let out=[0,0,0];
  if(fx>fy){
  }else{
  }
  const base=idx(i0,j0,k0);
  out[0]=(1-fx-fy-fz)*D[base]+out[0];
  out[1]=(1-fx-fy-fz)*D[base+1]+out[1];
  out[2]=(1-fx-fy-fz)*D[base+2]+out[2];
}

const ROI_KEY='cgt_match_roi_v1';

function refMeanLab(){
  if(!refStats)return null;
}

// ---------- Affichage du score ΔE ----------
function showDE(de){
  const box=$('deBox');
  let cls,txt;
  box.classList.add(cls);
  $('deNum').textContent=fmt(de,1);
  $('deTxt').innerHTML=txt;
}

function syncLabels(){
  $('vInt').textContent=$('intensity').value+'%';
  ['Sh','Md','Hi'].forEach(z=>{
    $('vZ'+z+'W').textContent=$('z'+z+'W').value;
  });
}

function drawScopes(d){
  tctx.drawImage(d,0,0,W,H);
  // --- Vectorscope (U/V sur grille Rec.709) ---
  const cv=$('cvVector'),ctx=cv.getContext('2d');
  const S=cv.width,cx=S/2,cy=S/2,rad=S/2-8;
  ctx.fillStyle='#101013';ctx.fillRect(0,0,S,S);
  // cible skin-tone (ligne I)
  ctx.strokeStyle='rgba(94,194,106,.45)';
  const img=ctx.getImageData(0,0,S,S),dd=img.data;
  for(let i=0;i<px.length;i+=16){
    const r=px[i]/255,g=px[i+1]/255,b=px[i+2]/255;
    if(x<0||x>=S||y<0||y>=S)continue;
    const o=(y*S+x)*4;
  }
  ctx.putImageData(img,0,0);

  // --- Waveform RGB ---
  const cw=$('cvWave'),wc=cw.getContext('2d');
  const WS=cw.width,HS=cw.height;
  wc.fillStyle='#101013';wc.fillRect(0,0,WS,HS);
  wc.strokeStyle='rgba(255,255,255,.1)';
  const wimg=wc.getImageData(0,0,WS,HS),wd=wimg.data;
  const colOff=[0,1,2];
  for(let i=0;i<px.length;i+=4){
    const x=Math.round((i/4)%W)/W*WS;
    for(let c=0;c<3;c++){
      const o=(y*WS+x)*4+colOff[c];
      wd[o]=Math.min(255,wd[o]+170);wd[o+3]=255;
    }
  }
  wc.putImageData(wimg,0,0);
}

// ---------- Rendu de la prévisualisation ----------
function renderPrev(img){
  if(!lut)return;
  const cv=$('cvPrev');
  const scale=Math.min(1,1280/img.width);
  cv.width=Math.max(1,Math.round(img.width*scale));
  cv.height=Math.max(1,Math.round(img.height*scale));
  const before=$('baBefore');
  if(before.src!==img.src)before.src=img.src;
  ctx.drawImage(img,0,0,cv.width,cv.height);
  let sumDE=0,deCount=0;
  const activeRoi=roiState.prev;
  const rw=activeRoi||{x:0,y:0,w:1,h:1};
  for(let i=0;i<d.length;i+=4){
    const r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255;
    d[i]=clamp(lin2srgb(R0[0]),0,1)*255;
    d[i+1]=clamp(lin2srgb(R0[1]),0,1)*255;
    d[i+2]=clamp(lin2srgb(R0[2]),0,1)*255;
  }
  ctx.putImageData(id,0,0);
  if(deCount)showDE(sumDE/deCount);
  drawScopes(img); // scopes sur l'image gradée
}

// Slider avant/après
(function(){
  const ba=$('baPrev');
  let dragging=false;
  const end=()=>dragging=false;
})();

// ---------- Export .cube ----------
function download(){
  if(!lut)return;
  const S=lut.size;
  const D=lut.data;
  for(let i=0;i<D.length;i+=3){
  }
  const blob=new Blob([out],{type:'text/plain'});
}

// ---------- Presets localStorage ----------
const PKEY='cgt_presets_v31';
function loadPresets(){
}
function refreshPresetList(){
  const ps=loadPresets();
}
function savePreset(){
  const name=$('presetName').value.trim();
  const ps=loadPresets();
  localStorage.setItem(PKEY,JSON.stringify(ps));
}
function applyPreset(){
  const name=$('presetList').value;if(!name)return;
  const ps=loadPresets();if(!ps[name])return;
  syncLabels();
  if(refStats)generateLUT(+$('lutSize').value);
}
function deletePreset(){
  const name=$('presetList').value;if(!name)return;
  const ps=loadPresets();delete ps[name];
}

// ---------- Slots de looks A/B/C ----------
const LOOK_SLOTS_KEY='cgt_look_slots_v1';
const LOOK_ACTIVE_KEY='cgt_look_active_v1';
const LOOK_SLOT_NAMES=['A','B','C'];
let activeLookSlot=null;
function loadLookSlots(){
}
function saveLookSlots(slots){
}
function currentGrade(){
  const grade={};
  CTL_IDS.forEach(id=>{grade[id]=$(id).value;});
  return grade;
}
function updateLookSlotUI(){
  LOOK_SLOT_NAMES.forEach(name=>{
    const card=$('lookSlot'+name);
  });
}
function captureLookSlot(name){
  const slots=loadLookSlots();
  saveLookSlots(slots);
  activeLookSlot=name;
  updateLookSlotUI();
}
function applyLookSlot(name){
  const entry=loadLookSlots()[name];
  activeLookSlot=name;
  syncLabels();
  updateLookSlotUI();
  if(refStats)generateLUT(+$('lutSize').value);
}
LOOK_SLOT_NAMES.forEach(name=>{
});
(function restoreLookSlots(){
  const slots=loadLookSlots();
  const first=Object.keys(slots)[0];
  if(first){
    activeLookSlot=first;
    syncLabels();
  }
  updateLookSlotUI();
})();

// ---------- Export / import presets JSON ----------
function exportPreset(){
  const a=document.createElement('a');
  URL.revokeObjectURL(a.href);
}
function importPresetFile(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const payload=JSON.parse(reader.result);
      const controls=payload.controls||payload;
      syncLabels();
      if(refStats)generateLUT(+$('lutSize').value);
    }catch(e){alert('Preset JSON invalide.');}
  };
  reader.readAsText(file);
}


// ---------- Wiring ----------
setupDrop('dropRef',img=>{
  refImg=img;
  refStats=analyze(img,roiState.ref);
  refStats.transfer=null;
  showStats(refStats);
  showPalette(img,roiState.ref);
  const ir=$('imgRef');
  ir.src=img.src;ir.style.display='block';
  $('ringRef').style.display='none';
  $('tagRef').style.display='block';
  generateLUT(+$('lutSize').value);
});
setupDrop('dropPrev',img=>{
  prevImg=img;
  drawROI('prev');
  if(!lut){
    $('baBefore').src=img.src;
    cv.getContext('2d').drawImage(img,0,0);
    return;
  }
  renderPrev(img);
});

// ---------- Rapport de match PNG ----------
function exportMatchReport(){
  const ref=$('imgRef'),graded=$('cvPrev');
  if(!ref.naturalWidth || !graded.width){
    return;
  }
  const c=cv.getContext('2d');
  c.fillStyle='#111115';c.fillRect(0,0,W,H);
  const contain=(image,x,y,w,h)=>{
    c.drawImage(image,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
  };
  c.fillStyle='#bdb9b2';c.font='16px system-ui';
  c.font='16px system-ui';c.fillStyle='#bdb9b2';
  c.fillText(palette||'—',pad,891);
}

$('btnDl').addEventListener('click',download);
function runAutoMatch(){
  if(frameStats){
  }else{
    refStats.transfer=null;
  }
  const range=Math.max(0.001,refStats.p95-refStats.p5);
  syncLabels();
  generateLUT(+$('lutSize').value);
  return true;
}
$('btnAuto').addEventListener('click',runAutoMatch);
$('btnReset').addEventListener('click',()=>{
  syncLabels();
  if(refStats)generateLUT(+$('lutSize').value);
});
$('btnSave').addEventListener('click',savePreset);
$('btnLoad').addEventListener('click',applyPreset);
$('btnDel').addEventListener('click',deletePreset);

// ---------- Mode expert persistant ----------
(function(){
  const toggle=$('modeExpert');
  if(!toggle)return;
  const key='cgt_expert_mode_v1';
  const saved=localStorage.getItem(key)==='1';
  toggle.checked=saved;
  document.body.classList.toggle('expert-mode',saved);
  toggle.addEventListener('change',function(){
    const enabled=toggle.checked;
    localStorage.setItem(key,enabled?'1':'0');
  });
})();

(function(){
  const a=this.dataset.simpleAction;
  if(a==='auto'){runAutoMatch();return;}
  if(a==='reset'){fire('btnReset');return;}
})();