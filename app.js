
const $=id=>document.getElementById(id);
let refStats=null,lut=null,prevImg=null,rushImgs=[],refImg=null;

// ---------- sRGB <-> linéaire (IEC 61966-2-1) ----------
function srgb2lin(c){return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lin2srgb(c){return c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;}
function clamp(x,a,b){return Math.min(b,Math.max(a,x));}
// ---------- Input log normalization (before creative grade) ----------
// The toggle is intentionally part of the input stage: the generated 3D LUT
// contains this transform, so preview, auto-match and .cube export agree.
function normalizeLogInput(v){
  const enabled=!$('logNormalize')||$('logNormalize').checked;
  return enabled?clamp((v-0.20)/(0.90-0.20),0,1):v;
}

// ---------- Linear sRGB -> Lab ----------
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
  // Sharma et al. 2005: chroma scale factor (the validated form).
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
  img.onerror=()=>{URL.revokeObjectURL(url);alert('⚠ Impossible de décoder cette image.');};
  img.src=url;
}
function addRushFiles(files){
  const list=Array.from(files||[]).filter(f=>f.type&&f.type.startsWith('image/'));
  let pending=list.length;if(!pending)return;
  list.forEach(f=>loadImageFile(f,(img,url)=>{rushImgs.push({img,url});pending--;if(!pending)updateRushCount();}));
}
function updateRushCount(){
  const n=rushImgs.length;
  $('rushCount').textContent=n?(n+' rush'+(n>1?'s':'')+' inclus dans le match'):'Aucun rush additionnel';
}

function setupDrop(dropId,cb){
  const d=$(dropId);
  d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('over');});
  d.addEventListener('dragleave',()=>d.classList.remove('over'));
  d.addEventListener('drop',e=>{e.preventDefault();d.classList.remove('over');loadImageFile(e.dataTransfer.files[0],cb);});
  d.addEventListener('click',()=>{
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

// ---------- Chaleur de zone bornée et conditionnée au signal ----------
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
  const lum=new Float32Array(n),rC=new Float32Array(n),gC=new Float32Array(n),bC=new Float32Array(n);
  let satSum=0, valid=0;
  for(let i=0;i<n;i++){
    const a=d[i*4+3], rr=d[i*4],gg=d[i*4+1],bb=d[i*4+2];
    if(a<=0||![rr,gg,bb].every(Number.isFinite))continue;
    let r=srgb2lin(rr/255),g=srgb2lin(gg/255),b=srgb2lin(bb/255);
    r=normalizeLogInput(r);g=normalizeLogInput(g);b=normalizeLogInput(b);
    if(![r,g,b].every(Number.isFinite))continue;
    rC[valid]=r;gC[valid]=g;bC[valid]=b;
    lum[valid]=0.2126*r+0.7152*g+0.0722*b;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    satSum+=mx>1e-5?(mx-mn)/mx:0; valid++;
  }
  if(!valid)throw new Error('Aucun pixel valide dans la ROI');
  const sorted=lum.slice(0,valid).sort();
  const p=f=>sorted[clamp(Math.floor(f*(valid-1)),0,valid-1)];
  const meanCh=a=>{let s=0;for(let i=0;i<valid;i++)s+=a[i];return s/valid;};
  const mr=meanCh(rC),mg=meanCh(gC),mb=meanCh(bC);
  let sLoR=0,sLoB=0,sHiR=0,sHiB=0,cLo=0,cHi=0;
  const tLo=p(0.35),tHi=p(0.65);
  for(let i=0;i<valid;i++){if(lum[i]<tLo){sLoR+=rC[i];sLoB+=bC[i];cLo++;}else if(lum[i]>tHi){sHiR+=rC[i];sHiB+=bC[i];cHi++;}}
  return {
    p1:p(0.01),p5:p(0.05),p25:p(0.25),p50:p(0.50),p75:p(0.75),p95:p(0.95),p99:p(0.99),
    sat:satSum/valid,
    warmLo:zoneWarmth(sLoR,sLoB,cLo,mb),
    warmHi:zoneWarmth(sHiR,sHiB,cHi,mb),
    meanR:mr,meanG:mg,meanB:mb,
    _pixels:d,_pn:valid
  };
}

// ---------- Palette dominante (k-means, 6 couleurs) ----------
function buildPalette(img,k,roi){
  k=Math.max(1,Math.floor(k||6));
  const {data:d,n}=sampleImg(img,roi),pts=[],seen=new Set();
  for(let i=0;i<n;i+=7){
    const a=d[i*4+3],r=d[i*4],g=d[i*4+1],b=d[i*4+2];
    if(a<=0||![r,g,b].every(Number.isFinite))continue;
    const key=r+','+g+','+b;if(seen.has(key))continue;seen.add(key);pts.push([r,g,b]);
  }
  if(!pts.length)throw new Error('Aucun pixel valide pour la palette');
  k=Math.min(k,pts.length);
  let cent=pts.slice(0,k).map(p=>p.slice());
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
  el.innerHTML=pal.map(s=>`<div class="swatch" style="background:${s.hex}" title="${s.hex} — ${s.pct.toFixed(1)}%"><em>${s.pct.toFixed(0)}%</em><span>${s.hex}</span></div>`).join('');
  el.style.display='flex';$('paletteTitle').style.display='block';
}

function fmt(x,d=3){return x.toFixed(d);}
function showStats(s){
  $('statsBox').style.display='block';
  const rows=[
    ['Noirs P1 / P5',fmt(s.p1)+' / '+fmt(s.p5)],
    ['P25 / P50 / P75',fmt(s.p25)+' / '+fmt(s.p50)+' / '+fmt(s.p75)],
    ['P95 / P99',fmt(s.p95)+' / '+fmt(s.p99)],
    ['Saturation moyenne',fmt(s.sat*100,1)+' %'],
    ['Chaleur ombres (R/B)',fmt(s.warmLo,2)],
    ['Chaleur hautes lumières (R/B)',fmt(s.warmHi,2)],
    ['Dynamic range P5→P95',fmt(Math.log2(Math.max(s.p95,1e-6)/Math.max(s.p5,1e-6)),1)+' stops']
  ];
  $('statsBody').innerHTML=rows.map(r=>`<div class="statrow"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
}

// ---------- Courbe de tonalité monotone (Hermite) ----------
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
  for(let i=1;i<outA.length;i++)outA[i]=Math.max(outA[i],outA[i-1]+0.001);
  const N=4096,lutT=new Float32Array(N);
  const slope=(outA[1]-outA[0])/(inA[1]-inA[0]);
  for(let i=0;i<N;i++){
    const x=i/(N-1)*inA[inA.length-1];
    let k=0;while(k<inA.length-2&&x>inA[k+1])k++;
    const t=clamp((x-inA[k])/(inA[k+1]-inA[k]),0,1);
    const m0=k>0?(outA[k]-outA[k-1])/(inA[k]-inA[k-1]):slope;
    const m1=(outA[k+1]-outA[k])/(inA[k+1]-inA[k]);
    const mm=clamp((m0+m1)/2,0,3*Math.min(Math.abs(m0),Math.abs(m1))||(m0+m1)/2);
    const h=inA[k+1]-inA[k];
    const h00=(1+2*t)*(1-t)*(1-t),h10=t*(1-t)*(1-t),h01=t*t*(3-2*t),h11=t*t*(t-1);
    lutT[i]=clamp(h00*outA[k]+h10*h*m0+h01*outA[k+1]+h11*h*m1,0,1);
  }
  return lutT;
}
function applyTone(lutT,v){
  const N=lutT.length-1,x=clamp(v,0,1)*N,i=Math.min(Math.floor(x),N-1),f=x-i;
  return lutT[i]*(1-f)+lutT[i+1]*f;
}

// ---------- Zones ----------
function getZoneVals(){
  return {
    sh:(+$('zSh').value)/100, shW:(+$('zShW').value)/100,
    md:(+$('zMd').value)/100, mdW:(+$('zMdW').value)/100,
    hi:(+$('zHi').value)/100, hiW:(+$('zHiW').value)/100
  };
}

// ---------- Génération de la LUT 3D ----------
function generateLUT(size){
  // Always snapshot the current reference and controls at generation time.  The
  // preview must never retain a LUT from a previous reference/auto-match.
  const reference=refStats;
  if(!reference)return;
  const n=Math.max(2,Math.round(size||17)), data=new Float32Array(n*n*n*3),
    p={intensity:+$('intensity').value,sat:+$('sat').value,con:+$('con').value,warm:+$('warm').value,crush:+$('crush').value,
       zSh:+$('zSh').value,zShW:+$('zShW').value,zMd:+$('zMd').value,
       zMdW:+$('zMdW').value,zHi:+$('zHi').value,zHiW:+$('zHiW').value};
  function correct(r,g,b){
    // Normalize log input before any creative grade operation.
    r=normalizeLogInput(r);g=normalizeLogInput(g);b=normalizeLogInput(b);
    // The reference analysis is the source of the automatic look. Previously this
    // function only read UI controls, so changing the reference could not change
    // the generated LUT. Keep manual controls additive so presets still work.
    const rs=reference;
    const refWarm=clamp((rs.meanR-rs.meanB)*1.5,-.25,.25);
    const refContrast=clamp((rs.p95-rs.p5)/.73,.65,1.35);
    const refSat=clamp(rs.sat/.5,.65,1.35);
    const sat=clamp((p.sat/100)*refSat,.05,2.5), con=clamp((p.con/100)*refContrast,.25,2.5), warm=p.warm/100+refWarm, lum=.2126*r+.7152*g+.0722*b;
    let R=(r-.5)*con+.5,G=(g-.5)*con+.5,B=(b-.5)*con+.5;
    const z=lum<.33?p.zSh/100:lum>.66?p.zHi/100:p.zMd/100;
    const zw=lum<.33?p.zShW/100:p.zHiW/100;
    const ex=Math.pow(2,z*.6); R*=ex; G*=ex; B*=ex;
    const y=.2126*R+.7152*G+.0722*B;
    R=y+(R-y)*sat; G=y+(G-y)*sat; B=y+(B-y)*sat;
    // Apply the black-density control in the same linear-light domain as the LUT.
    // It was previously exposed and wired to regeneration, but never consumed.
    const crush=(p.crush-50)/50;
    if(crush>=0){R*=1-.35*crush;G*=1-.35*crush;B*=1-.35*crush;}
    else{const lift=-crush*.25;R+= (1-R)*lift;G+=(1-G)*lift;B+=(1-B)*lift;}
    const ww=1+warm*.5+zw*.08;
    const graded=[clamp(R*ww,0,1),clamp(G,0,1),clamp(B/ww,0,1)];
    const mix=clamp(p.intensity/100,0,1);
    return [r+(graded[0]-r)*mix,g+(graded[1]-g)*mix,b+(graded[2]-b)*mix];
  }
  let k=0;
  for(let bi=0;bi<n;bi++)for(let gi=0;gi<n;gi++)for(let ri=0;ri<n;ri++){
    const q=correct(srgb2lin(ri/(n-1)),srgb2lin(gi/(n-1)),srgb2lin(bi/(n-1)));
    data[k++]=q[0];data[k++]=q[1];data[k++]=q[2];
  }
  lut={size:n,data}; if(prevImg)renderPrev(prevImg);
}
// ---------- Interpolation tétraédrique de la LUT ----------
function lutTetra(r,g,b){
  const S=lut.size,D=lut.data;
  const x=clamp(r,0,1)*(S-1),y=clamp(g,0,1)*(S-1),z=clamp(b,0,1)*(S-1);
  const i0=Math.min(Math.floor(x),S-2),j0=Math.min(Math.floor(y),S-2),k0=Math.min(Math.floor(z),S-2);
  const fx=x-i0,fy=y-j0,fz=z-k0;
  const idx=(i,j,k)=>(k*S*S+j*S+i)*3;
  const c000=idx(i0,j0,k0),   c100=idx(i0+1,j0,k0),   c010=idx(i0,j0+1,k0),   c110=idx(i0+1,j0+1,k0);
  const c001=idx(i0,j0,k0+1), c101=idx(i0+1,j0,k0+1), c011=idx(i0,j0+1,k0+1),c111=idx(i0+1,j0+1,k0+1);
  let out=[0,0,0];
  const acc=(w,v0,v1,v2)=>{out[0]+=w*v0;out[1]+=w*v1;out[2]+=w*v2;};
  if(fx>fy){
    if(fy>fz){acc(fx,D[c100],D[c100+1],D[c100+2]);acc(fy,D[c110],D[c110+1],D[c110+2]);acc(fz,D[c111],D[c111+1],D[c111+2]);}
    else if(fx>fz){acc(fx,D[c100],D[c100+1],D[c100+2]);acc(fz,D[c101],D[c101+1],D[c101+2]);acc(fy,D[c111],D[c111+1],D[c111+2]);}
    else{acc(fz,D[c001],D[c001+1],D[c001+2]);acc(fx,D[c101],D[c101+1],D[c101+2]);acc(fy,D[c111],D[c111+1],D[c111+2]);}
  }else{
    if(fz>fy){acc(fz,D[c001],D[c001+1],D[c001+2]);acc(fy,D[c011],D[c011+1],D[c011+2]);acc(fx,D[c111],D[c111+1],D[c111+2]);}
    else if(fx>fz){acc(fy,D[c010],D[c010+1],D[c010+2]);acc(fx,D[c110],D[c110+1],D[c110+2]);acc(fz,D[c111],D[c111+1],D[c111+2]);}
    else{acc(fy,D[c010],D[c010+1],D[c010+2]);acc(fz,D[c011],D[c011+1],D[c011+2]);acc(fx,D[c111],D[c111+1],D[c111+2]);}
  }
  const base=idx(i0,j0,k0);
  out[0]=(1-fx-fy-fz)*D[base]+out[0];
  out[1]=(1-fx-fy-fz)*D[base+1]+out[1];
  out[2]=(1-fx-fy-fz)*D[base+2]+out[2];
  return [clamp(out[0],0,1),clamp(out[1],0,1),clamp(out[2],0,1)];
}

// ---------- ROI dessinable, persistante et partagée par l’analyse ----------
const ROI_KEY='cgt_match_roi_v1';
let roiState={ref:null,prev:null},roiMode=false,roiDrag=null;
function loadROI(){try{const v=JSON.parse(localStorage.getItem(ROI_KEY));if(v&&typeof v==='object')roiState={ref:v.ref||null,prev:v.prev||null};}catch(e){}}
function saveROI(){try{localStorage.setItem(ROI_KEY,JSON.stringify(roiState));}catch(e){}}
function roiLabel(){const r=roiState.prev||roiState.ref; $('roiStatus').textContent=roiMode?'Dessinez une zone sur l’image active · double-clic pour supprimer':(r?'ROI active · '+Math.round(r.w*100)+'×'+Math.round(r.h*100)+'%':'Mode inactif · ROI image entière');}
function drawROI(which){const r=roiState[which],el=$('roiOverlay'+(which==='ref'?'Ref':'Prev'));if(!el)return;el.style.display=r?'block':'none';if(r){el.style.setProperty('--rx',(r.x*100)+'%');el.style.setProperty('--ry',(r.y*100)+'%');el.style.setProperty('--rx2',((r.x+r.w)*100)+'%');el.style.setProperty('--ry2',((r.y+r.h)*100)+'%');}}
function refreshAnalysis(){if(!refImg)return;refStats=analyze(refImg,roiState.ref);showStats(refStats);showPalette(refImg,roiState.ref);if(refStats)generateLUT(+$('lutSize').value);}
function setROI(which,r){roiState[which]=r;drawROI(which);saveROI();roiLabel();if(which==='ref'&&refImg)refreshAnalysis();if(which==='prev'&&prevImg&&lut)renderPrev(prevImg);}
function bindROI(which,stageId){const stage=$(stageId);stage.addEventListener('pointerdown',e=>{if(!roiMode)return;e.preventDefault();const b=stage.getBoundingClientRect();roiDrag={which,x0:clamp((e.clientX-b.left)/b.width,0,1),y0:clamp((e.clientY-b.top)/b.height,0,1)};stage.setPointerCapture(e.pointerId);});stage.addEventListener('pointermove',e=>{if(!roiDrag||roiDrag.which!==which)return;const b=stage.getBoundingClientRect(),x=clamp((e.clientX-b.left)/b.width,0,1),y=clamp((e.clientY-b.top)/b.height,0,1);const x0=Math.min(roiDrag.x0,x),y0=Math.min(roiDrag.y0,y),w=Math.max(.01,Math.abs(x-roiDrag.x0)),h=Math.max(.01,Math.abs(y-roiDrag.y0));setROI(which,{x:x0,y:y0,w:Math.min(w,1-x0),h:Math.min(h,1-y0)});});stage.addEventListener('pointerup',()=>{roiDrag=null;});stage.addEventListener('click',e=>{if(roiMode)e.stopPropagation();});stage.addEventListener('dblclick',e=>{if(roiMode){e.preventDefault();setROI(which,null);}});}
function toggleROIMode(){roiMode=!roiMode;document.body.classList.toggle('roi-mode',roiMode);$('btnRoi').classList.toggle('active',roiMode);roiLabel();}


// ---------- Lab moyen de la référence (pour ΔE) ----------
function refMeanLab(){
  if(!refStats)return null;
  return rgb2lab(refStats.meanR,refStats.meanG,refStats.meanB);
}

// ---------- Affichage du score ΔE ----------
function showDE(de){
  const box=$('deBox');
  box.classList.remove('descore--ok','descore--warn','descore--bad');
  let cls,txt;
  if(de<2){cls='descore--ok';txt='<b>ΔE '+fmt(de,1)+' — Excellent match 🟢</b><br>Le look gradé est quasi imperceptiblement différent de la référence. Tu peux exporter la LUT en confiance.';}
  else if(de<5){cls='descore--warn';txt='<b>ΔE '+fmt(de,1)+' — Bon match 🟡</b><br>Différences légères visibles côte à côte. Ajuste saturation / chaleur / zones pour affiner.';}
  else{cls='descore--bad';txt='<b>ΔE '+fmt(de,1)+' — Match approximatif 🔴</b><br>Le look s\'écarte nettement de la référence. Vérifie que la frame de rush est comparable à la référence (exposition, contenu).';}
  box.classList.add(cls);
  $('deNum').textContent=fmt(de,1);
  $('deTxt').innerHTML=txt;
}

function syncLabels(){
  $('vInt').textContent=$('intensity').value+'%';
  $('vSat').textContent=$('sat').value==100?'auto':$('sat').value+'%';
  $('vWarm').textContent=$('warm').value==0?'auto':$('warm').value;
  $('vCrush').textContent=$('crush').value==50?'auto':$('crush').value;
  $('vCon').textContent=$('con').value==100?'auto':$('con').value+'%';
  $('vWskin').textContent=(+$('wSkin').value).toFixed(1);
  $('vWdetail').textContent=(+$('wDetail').value).toFixed(1);
  $('vWextreme').textContent=(+$('wExtreme').value).toFixed(2);
  ['Sh','Md','Hi'].forEach(z=>{
    $('vZ'+z).textContent=(+$('z'+z).value/100).toFixed(2);
    $('vZ'+z+'W').textContent=$('z'+z+'W').value;
  });
}

// ---------- Scopes : vectorscope + waveform RGB ----------
function drawScopes(d){
  const W=128,H=128; // échantillonnage réduit pour la perf
  const tmp=document.createElement('canvas');tmp.width=W;tmp.height=H;
  const tctx=tmp.getContext('2d',{willReadFrequently:true});
  tctx.drawImage(d,0,0,W,H);
  const px=tctx.getImageData(0,0,W,H).data;

  // --- Vectorscope (U/V sur grille Rec.709) ---
  const cv=$('cvVector'),ctx=cv.getContext('2d');
  const S=cv.width,cx=S/2,cy=S/2,rad=S/2-8;
  ctx.fillStyle='#101013';ctx.fillRect(0,0,S,S);
  ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(cx,cy,rad,0,2*Math.PI);ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx-rad,cy);ctx.lineTo(cx+rad,cy);ctx.moveTo(cx,cy-rad);ctx.lineTo(cx,cy+rad);ctx.stroke();
  // cible skin-tone (ligne I)
  ctx.strokeStyle='rgba(94,194,106,.45)';
  ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+rad*Math.cos(123*Math.PI/180),cy-rad*Math.sin(123*Math.PI/180));ctx.stroke();
  const img=ctx.getImageData(0,0,S,S),dd=img.data;
  for(let i=0;i<px.length;i+=16){
    const r=px[i]/255,g=px[i+1]/255,b=px[i+2]/255;
    const u=-0.147*r-0.289*g+0.436*b, v=0.615*r-0.515*g-0.100*b;
    const x=Math.round(cx+u*rad*2.1), y=Math.round(cy-v*rad*2.1);
    if(x<0||x>=S||y<0||y>=S)continue;
    const o=(y*S+x)*4;
    dd[o]=Math.min(255,dd[o]+160);dd[o+1]=Math.min(255,dd[o+1]+150);dd[o+2]=Math.min(255,dd[o+2]+120);dd[o+3]=255;
  }
  ctx.putImageData(img,0,0);

  // --- Waveform RGB ---
  const cw=$('cvWave'),wc=cw.getContext('2d');
  const WS=cw.width,HS=cw.height;
  wc.fillStyle='#101013';wc.fillRect(0,0,WS,HS);
  wc.strokeStyle='rgba(255,255,255,.1)';
  for(let q=1;q<4;q++){wc.beginPath();wc.moveTo(0,HS*q/4);wc.lineTo(WS,HS*q/4);wc.stroke();}
  const wimg=wc.getImageData(0,0,WS,HS),wd=wimg.data;
  const colOff=[0,1,2];
  for(let i=0;i<px.length;i+=4){
    const x=Math.round((i/4)%W)/W*WS;
    for(let c=0;c<3;c++){
      const y=Math.round(HS-1-clamp(px[i+c],0,255)/255*(HS-1));
      const o=(y*WS+x)*4+colOff[c];
      wd[o]=Math.min(255,wd[o]+170);wd[o+3]=255;
    }
  }
  wc.putImageData(wimg,0,0);
  $('scopesEmpty').style.display='none';$('scopesGrid').style.display='grid';
}

// ---------- Rendu de la prévisualisation ----------
function renderPrev(img){
  if(!lut)return;
  const cv=$('cvPrev');
  const scale=Math.min(1,1280/img.width);
  cv.width=Math.max(1,Math.round(img.width*scale));
  cv.height=Math.max(1,Math.round(img.height*scale));
  $('baEmpty').style.display='none';$('baPrev').style.display='block';$('tagPrev').style.display='block';
  const before=$('baBefore');
  if(before.src!==img.src)before.src=img.src;
  const ctx=cv.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(img,0,0,cv.width,cv.height);
  const id=ctx.getImageData(0,0,cv.width,cv.height);const d=id.data;
  let sumDE=0,deCount=0;
  const activeRoi=roiState.prev;
  const rw=activeRoi||{x:0,y:0,w:1,h:1};
  const roiX0=Math.floor(rw.x*cv.width),roiY0=Math.floor(rw.y*cv.height),roiX1=Math.ceil((rw.x+rw.w)*cv.width),roiY1=Math.ceil((rw.y+rw.h)*cv.height);
  for(let i=0;i<d.length;i+=4){
    const r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255;
    // LUT generation is linear-light; convert the sRGB canvas samples in and
    // convert the transformed result back before writing to the canvas.
    const R0=lutTetra(srgb2lin(r),srgb2lin(g),srgb2lin(b));
    d[i]=clamp(lin2srgb(R0[0]),0,1)*255;
    d[i+1]=clamp(lin2srgb(R0[1]),0,1)*255;
    d[i+2]=clamp(lin2srgb(R0[2]),0,1)*255;
    const pix=i>>2,px=pix%cv.width,py=Math.floor(pix/cv.width);
    if(px>=roiX0&&px<roiX1&&py>=roiY0&&py<roiY1&&(i>>2)%16===0&&d[i+3]>0&&[r,g,b].every(Number.isFinite)){
      const lab1=rgb2lab(srgb2lin(r),srgb2lin(g),srgb2lin(b));
      const lab2=rgb2lab(srgb2lin(R0[0]),srgb2lin(R0[1]),srgb2lin(R0[2]));
      sumDE+=deltaE2000(lab1[0],lab1[1],lab1[2],lab2[0],lab2[1],lab2[2]);
      deCount++;
    }
  }
  ctx.putImageData(id,0,0);
  if(deCount)showDE(sumDE/deCount);
  drawScopes(img); // scopes sur l'image gradée
}

// Slider avant/après
(function(){
  const ba=$('baPrev');
  let dragging=false;
  const set=x=>{const r=ba.getBoundingClientRect();const pct=clamp((x-r.left)/r.width*100,0,100);ba.style.setProperty('--split',pct+'%');};
  const start=e=>{dragging=true;set((e.touches?e.touches[0]:e).clientX);};
  const move=e=>{if(!dragging)return;e.preventDefault();set((e.touches?e.touches[0]:e).clientX);};
  const end=()=>dragging=false;
  ba.addEventListener('mousedown',start);ba.addEventListener('touchstart',start,{passive:true});
  window.addEventListener('mousemove',move);window.addEventListener('touchmove',move,{passive:false});
  window.addEventListener('mouseup',end);window.addEventListener('touchend',end);
})();

// ---------- Export .cube ----------
function download(){
  if(!lut)return;
  const S=lut.size;
  let out='# Created with Colour Grade Tool v3.2\n# look derived from reference shot (linear-light percentile match, tetrahedral preview, CIEDE2000 scored)\nLUT_3D_SIZE '+S+'\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n\n';
  const D=lut.data;
  for(let i=0;i<D.length;i+=3){
    out+=D[i].toFixed(6)+' '+D[i+1].toFixed(6)+' '+D[i+2].toFixed(6)+'\n';
  }
  const blob=new Blob([out],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='colour_grade_tool_look.cube';a.click();
}

// ---------- Presets localStorage ----------
const PKEY='cgt_presets_v31';
const CTL_IDS=['intensity','sat','warm','crush','con','zSh','zShW','zMd','zMdW','zHi','zHiW','wSkin','wDetail','wExtreme'];
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
  ps[name]={};CTL_IDS.forEach(id=>ps[name][id]=$(id).value);
  localStorage.setItem(PKEY,JSON.stringify(ps));
  $('presetName').value='';refreshPresetList();$('presetList').value=name;
}
function applyPreset(){
  const name=$('presetList').value;if(!name)return;
  const ps=loadPresets();if(!ps[name])return;
  CTL_IDS.forEach(id=>{if(ps[name][id]!==undefined)$(id).value=ps[name][id];});
  syncLabels();
  if(refStats)generateLUT(+$('lutSize').value);
}
function deletePreset(){
  const name=$('presetList').value;if(!name)return;
  const ps=loadPresets();delete ps[name];
  localStorage.setItem(PKEY,JSON.stringify(ps));refreshPresetList();
}

// ---------- Slots de looks A/B/C ----------
const LOOK_SLOTS_KEY='cgt_look_slots_v1';
const LOOK_ACTIVE_KEY='cgt_look_active_v1';
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
  slots[name]={version:1,date:new Date().toISOString(),controls:currentGrade()};
  saveLookSlots(slots);
  try{localStorage.setItem(LOOK_ACTIVE_KEY,name);}catch(e){}
  activeLookSlot=name;
  updateLookSlotUI();
}
function applyLookSlot(name){
  const entry=loadLookSlots()[name];
  if(!entry||!entry.controls){alert('Le slot '+name+' est vide. Capture d’abord le grade courant.');return;}
  CTL_IDS.forEach(id=>{if(entry.controls[id]!==undefined)$(id).value=entry.controls[id];});
  activeLookSlot=name;
  try{localStorage.setItem(LOOK_ACTIVE_KEY,name);}catch(e){}
  syncLabels();
  updateLookSlotUI();
  if(refStats)generateLUT(+$('lutSize').value);
}
LOOK_SLOT_NAMES.forEach(name=>{
  $('saveLook'+name).addEventListener('click',()=>captureLookSlot(name));
  $('loadLook'+name).addEventListener('click',()=>applyLookSlot(name));
});
(function restoreLookSlots(){
  const slots=loadLookSlots();
  let saved=null;try{saved=localStorage.getItem(LOOK_ACTIVE_KEY);}catch(e){}
  const first=saved&&slots[saved]&&slots[saved].controls?saved:LOOK_SLOT_NAMES.find(name=>slots[name]&&slots[name].controls);
  if(first){
    activeLookSlot=first;
    CTL_IDS.forEach(id=>{if(slots[first].controls[id]!==undefined)$(id).value=slots[first].controls[id];});
    syncLabels();
  }
  updateLookSlotUI();
})();

// ---------- Export / import presets JSON ----------
function exportPreset(){
  const name=$('presetName').value.trim()||$('presetList').value||'preset';
  const payload={version:1,name:name,date:new Date().toISOString(),controls:currentGrade()};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='preset-'+Date.now()+'.json';a.click();
  URL.revokeObjectURL(a.href);
}
function importPresetFile(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const payload=JSON.parse(reader.result);
      const controls=payload.controls||payload;
      CTL_IDS.forEach(id=>{if(controls[id]!==undefined)$(id).value=controls[id];});
      if(payload.name)$('presetName').value=payload.name;
      syncLabels();
      if(refStats)generateLUT(+$('lutSize').value);
    }catch(e){alert('Preset JSON invalide.');}
  };
  reader.readAsText(file);
}

$('rushFiles').addEventListener('change',e=>{addRushFiles(e.target.files);e.target.value='';});

// ---------- Wiring ----------
setupDrop('dropRef',img=>{
  refImg=img;
  refStats=analyze(img,roiState.ref);
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
    $('baEmpty').style.display='none';$('baPrev').style.display='block';$('tagPrev').style.display='block';
    $('baBefore').src=img.src;
    const cv=$('cvPrev');cv.width=img.width;cv.height=img.height;
    cv.getContext('2d').drawImage(img,0,0);
    return;
  }
  renderPrev(img);
});
['intensity','sat','warm','crush','con','zSh','zShW','zMd','zMdW','zHi','zHiW','wSkin','wDetail','wExtreme'].forEach(id=>{
  $(id).addEventListener('input',()=>{syncLabels();if(refStats)generateLUT(+$('lutSize').value);});
});
$('lutSize').addEventListener('change',()=>{if(refStats)generateLUT(+$('lutSize').value);});
$('logNormalize').addEventListener('change',()=>{if(refImg)refreshAnalysis();else if(refStats)generateLUT(+$('lutSize').value);});
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
  c.fillStyle='#f4f1ea';c.font='700 24px system-ui';c.fillText('Score ΔE CIEDE2000 : '+($('deNum').textContent||'—'),pad,682);
  c.fillStyle='#bdb9b2';c.font='16px system-ui';
  const interpretation=$('deTxt').innerText.replace(/\n+/g,' ');c.fillText(interpretation.slice(0,112),pad,712);c.fillText(interpretation.slice(112,224),pad,737);
  const settings=['Intensité '+$('intensity').value+'%','Saturation '+$('sat').value+'%','Chaleur '+$('warm').value,'Crush '+$('crush').value,'Contraste '+$('con').value+'%','LUT '+$('lutSize').value+'³','Preset '+($('presetList').value||'—')];
  c.fillStyle='#f4f1ea';c.font='700 18px system-ui';c.fillText('Réglages actuels',pad,787);
  c.fillStyle='#bdb9b2';c.font='16px system-ui';c.fillText(settings.join('  ·  '),pad,814);
  c.fillStyle='#f4f1ea';c.font='700 18px system-ui';c.fillText('Palette dominante',pad,864);
  c.font='16px system-ui';c.fillStyle='#bdb9b2';
  const palette=[...document.querySelectorAll('#palette .swatch')].map(x=>x.title).filter(Boolean).join('  ·  ');
  c.fillText(palette||'—',pad,891);
  cv.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rapport-match-'+Date.now()+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},'image/png');
}

$('btnDl').addEventListener('click',download);
$('btnReport').addEventListener('click',exportMatchReport);
function runAutoMatch(){
  if(!refStats){alert('Charge une référence avant le match auto.');return false;}
  const range=Math.max(0.001,refStats.p95-refStats.p5);
  $('warm').value=Math.round(clamp((refStats.meanR-refStats.meanB)*150,-100,100));
  $('con').value=Math.round(clamp(100*range/.73,50,150));
  $('sat').value=Math.round(clamp(100*(refStats.sat/.5),0,200));
  $('crush').value=Math.round(clamp(50*(1-refStats.p1/.08),0,100));
  syncLabels();
  generateLUT(+$('lutSize').value);
  return true;
}
$('btnAuto').addEventListener('click',runAutoMatch);
$('btnReset').addEventListener('click',()=>{
  $('intensity').value=100;$('sat').value=100;$('warm').value=0;$('crush').value=50;$('con').value=100;
  ['zSh','zShW','zMd','zMdW','zHi','zHiW'].forEach(id=>$(id).value=0);
  syncLabels();
  if(refStats)generateLUT(+$('lutSize').value);
});
$('btnSave').addEventListener('click',savePreset);
$('btnLoad').addEventListener('click',applyPreset);
$('btnDel').addEventListener('click',deletePreset);
$('btnExportPreset').addEventListener('click',exportPreset);
$('btnImportPreset').addEventListener('click',()=>$('presetFile').click());
$('presetFile').addEventListener('change',e=>{importPresetFile(e.target.files[0]);e.target.value='';});
loadROI();bindROI('ref','roiStageRef');bindROI('prev','baPrev');drawROI('ref');drawROI('prev');$('btnRoi').addEventListener('click',toggleROIMode);$('btnRoiReset').addEventListener('click',()=>{roiState={ref:null,prev:null};saveROI();drawROI('ref');drawROI('prev');roiLabel();if(refImg)refreshAnalysis();if(prevImg&&lut)renderPrev(prevImg);});roiLabel();syncLabels();refreshPresetList();


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
    document.body.classList.toggle('expert-mode',enabled);
    localStorage.setItem(key,enabled?'1':'0');
  });
})();

(function(){
  const fire=id=>{const el=document.getElementById(id);if(el)el.click();};
  const set=(id,v)=>{const el=document.getElementById(id);if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));}};
  document.querySelectorAll('[data-simple-action]').forEach(btn=>btn.addEventListener('click',function(){
    const a=this.dataset.simpleAction;
    if(a==='auto'){runAutoMatch();return;}
    if(a==='reset'){fire('btnReset');return;}
    if(a==='warm'){set('sat',108);set('warm',28);set('con',104);return;}
    if(a==='cool'){set('sat',104);set('warm',-28);set('con',102);return;}
    if(a==='cinema'){set('sat',104);set('crush',67);set('con',116);return;}
  }));
})();


(function(){
 const root=document.querySelector('.pipeline-shell'), state={step:1,files:[],ref:null}; if(!root)return;
 const steps=[...root.querySelectorAll('[data-pipe-step]')], stages=[...root.querySelectorAll('[data-pipe-stage]')];
 const setStep=n=>{state.step=n; stages.forEach(s=>s.classList.toggle('is-active',+s.dataset.pipeStage===n)); steps.forEach(s=>s.classList.toggle('is-active',+s.dataset.pipeStep===n)); steps.forEach(s=>s.classList.toggle('is-done',+s.dataset.pipeStep<n));};
 const addFiles=(files,isRef)=>{[...files].filter(f=>f.type.startsWith('image/')).forEach(f=>{const u=URL.createObjectURL(f),im=new Image();im.onload=()=>{const item={file:f,url:u,w:im.naturalWidth,h:im.naturalHeight,ref:isRef};state.files=state.files.filter(x=>!(isRef&&x.ref));if(isRef)state.ref=item;state.files.push(item);render();};im.src=u;});};
 const render=()=>{const grid=document.getElementById('pipePreviewGrid'), status=document.getElementById('pipePreviewStatus'), imp=document.getElementById('pipeImportStatus');grid.innerHTML=''; if(!state.files.length)grid.innerHTML='<div class="preview-empty">Your imported images will appear here.</div>'; state.files.forEach((x,i)=>{const c=document.createElement('article');c.className='preview-card';c.innerHTML='<img src="'+x.url+'" alt="'+x.file.name+'"><div class="preview-card__meta"><div class="preview-card__name">'+x.file.name+'</div><div class="preview-card__dims">'+x.w+' × '+x.h+' · '+(x.ref?'Reference':'Frame')+'</div></div>';c.onclick=()=>{document.getElementById('pipeModalImg').src=x.url;document.getElementById('pipeModal').classList.add('is-open')};grid.appendChild(c);});const n=state.files.length;status.classList.toggle('is-ok',n>0);status.querySelector('span').textContent=n?(n+' image'+(n===1?'':'s')+' ready to review'):'No images ready';imp.classList.toggle('is-ok',!!state.ref&&state.files.length>1);imp.querySelector('span').textContent=state.ref?(state.files.length>1?'Reference and frames imported':'Reference imported — add at least one frame'):'Waiting for imports';};
 const wire=(drop,input,isRef)=>{const d=document.getElementById(drop),i=document.getElementById(input);d.addEventListener('click',ev=>{if(ev.target===i)return;ev.preventDefault();ev.stopPropagation();i.click();});i.addEventListener('click',ev=>ev.stopPropagation());i.onchange=()=>addFiles(i.files,isRef);['dragenter','dragover'].forEach(e=>d.addEventListener(e,ev=>{ev.preventDefault();d.classList.add('is-over')}));['dragleave','drop'].forEach(e=>d.addEventListener(e,ev=>{ev.preventDefault();d.classList.remove('is-over')}));d.addEventListener('drop',ev=>addFiles(ev.dataTransfer.files,isRef));};
 wire('pipeRefDrop','pipeRefInput',true);wire('pipeFramesDrop','pipeFramesInput',false);render();
 root.addEventListener('click',e=>{const s=e.target.closest('[data-pipe-step]'),n=e.target.closest('[data-pipe-next]'),p=e.target.closest('[data-pipe-prev]');if(s)setStep(+s.dataset.pipeStep);if(n)setStep(+n.dataset.pipeNext);if(p)setStep(+p.dataset.pipePrev);if(e.target.id==='pipeModal'||e.target.id==='pipeModalClose')document.getElementById('pipeModal').classList.remove('is-open');if(e.target.id==='pipeExportLut')document.getElementById('btnDl')?.click();if(e.target.id==='pipeExportJson')document.getElementById('btnExportPreset')?.click()});
})();



