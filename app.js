
const $=id=>document.getElementById(id);

// ---------- Utilitaires ----------
function clamp(x,a,b){return Math.min(b,Math.max(a,x));}
function srgb2lin(v){return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
function lin2srgb(v){return v<=0.0031308?12.92*v:1.055*Math.pow(Math.max(0,v),1/2.4)-0.055;}
function normalizeLogInput(v){
  return clamp((v-0.20)/(0.90-0.20),0,1);
}

// ---------- Linear sRGB -> Lab ----------
function lin2xyz(r,g,b){
  const X=0.4124564*r+0.3575761*g+0.1804375*b;
  const Y=0.2126729*r+0.7151522*g+0.0721750*b;
  const Z=0.0193339*r+0.1191920*g+0.9503041*b;
  return [X/0.95047,Y/1.0,Z/1.08883];
}
function fxyz(t){return t>0.008856451679?Math.cbrt(t):(7.787037037*t+16/116);}
function xyz2lab(X,Y,Z){
  const fx=fxyz(X),fy=fxyz(Y),fz=fxyz(Z);
  return [116*fy-16,500*(fx-fy),200*(fy-fz)];
}

// ---------- OKLab ----------
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
  const m_=L-0.1055613458*a-0.0638541722*b;
  const s_=L-0.0894841775*a-1.2914855480*b;
  const l=l_**3,m=m_**3,s=s_**3;
  return [4.0767416621*l-3.3077115913*m+0.2309699292*s,
          -1.2684380046*l+2.6097574011*m-0.3413193965*s,
          -0.0041960863*l-0.7034186147*m+1.7076147010*s];
}
function covariance3(points,mean){
  const c=[[0,0,0],[0,0,0],[0,0,0]],n=points.length;
  for(const p of points)for(let i=0;i<3;i++)for(let j=0;j<3;j++)c[i][j]+=(p[i]-mean[i])*(p[j]-mean[j]);
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)c[i][j]/=Math.max(1,n-1);
  return c;
}
function cholesky3(a){
  const L=[[0,0,0],[0,0,0],[0,0,0]];
  for(let i=0;i<3;i++)for(let j=0;j<=i;j++){
    let v=a[i][j];
    for(let k=0;k<j;k++)v-=L[i][k]*L[j][k];
    if(!Number.isFinite(v))return null;
    if(i===j){if(v<=1e-12)return null;L[i][j]=Math.sqrt(v);}else L[i][j]=v/L[j][j];
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
function finiteStats(s){return !!s&&[s.mean,...s.cov.flat()].every(Number.isFinite);}
function fallbackTransfer(ref,frame){return {mean:ref.mean.slice(),frameMean:frame.mean.slice(),L:null,frameL:null};}
function buildOKLabTransfer(ref,frame){
  const varianceFloor=1e-10, eps=1e-6;
  if(!finiteStats(ref)||!finiteStats(frame)||!ref.cov||!frame.cov)return fallbackTransfer(ref,frame);
  const cr=ref.cov.map((row,i)=>row.map((v,j)=>v+(i===j?varianceFloor:0)));
  const cf=frame.cov.map((row,i)=>row.map((v,j)=>v+(i===j?varianceFloor:0)));
  const lr=cholesky3(cr),lf=cholesky3(cf);
  if(!lr||!lf)return fallbackTransfer(ref,frame);
  return {mean:ref.mean.slice(),frameMean:frame.mean.slice(),L:lr,frameL:lf,eps};
}
function applyOKLabTransfer(x,t){
  const centered=x.map((v,i)=>v-t.frameMean[i]);
  const z=t.frameL?solveLower3(t.frameL,centered):centered;
  if(!z)return x.slice();
  const out=t.L? t.L.map((row,i)=>row.reduce((sum,v,j)=>sum+v*z[j],0)):z;
  return out.map((v,i)=>v+t.mean[i]);
}
function oklabStats(points){
  if(!points.length)return null;
  const mean=[0,0,0];for(const p of points)for(let i=0;i<3;i++)mean[i]+=p[i]/points.length;
  return {mean,cov:covariance3(points,mean)};
}
function buildTransferFromImage(img,roi){
  const {data:d,n}=sampleImg(img,roi),pts=[];
  for(let i=0;i<n;i+=2){const k=i*4;if(d[k+3]>0)pts.push(linRgb2oklab(srgb2lin(d[k]/255),srgb2lin(d[k+1]/255),srgb2lin(d[k+2]/255)));}
  return oklabStats(pts);
}

// ---------- CIEDE2000 (Sharma et al. 2005) ----------
function deltaE2000(l1,a1,b1,l2,a2,b2){
  const kL=1,kC=1,kH=1,C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),Cbar=(C1+C2)/2;
  const G=.5*(1-Math.sqrt(Math.pow(Cbar,7)/(Math.pow(Cbar,7)+Math.pow(25,7))));
  const a1p=(1+G)*a1,a2p=(1+G)*a2,C1p=Math.hypot(a1p,b1),C2p=Math.hypot(a2p,b2);
  let h1=Math.atan2(b1,a1p);if(h1<0)h1+=2*Math.PI;let h2=Math.atan2(b2,a2p);if(h2<0)h2+=2*Math.PI;
  const dL=l2-l1,dC=C2p-C1p;let dh=h2-h1;if(C1p*C2p===0)dh=0;else if(Math.abs(dh)>Math.PI)dh+=dh>0?-2*Math.PI:2*Math.PI;
  const dH=2*Math.sqrt(C1p*C2p)*Math.sin(dh/2),Lm=(l1+l2)/2,Cm=(C1p+C2p)/2;
  let hm=h1+h2;if(C1p*C2p===0)hm=h1+h2;else if(Math.abs(h1-h2)<=Math.PI)hm/=2;else hm=(h1+h2<2*Math.PI?(h1+h2+2*Math.PI)/2:(h1+h2-2*Math.PI)/2);
  const T=1-.17*Math.cos(hm-Math.PI/6)+.24*Math.cos(2*hm)+.32*Math.cos(3*hm+Math.PI/30)-.20*Math.cos(4*hm-21*Math.PI/60);
  const SL=1+.015*(Lm-50)**2/Math.sqrt(20+(Lm-50)**2),SC=1+.045*Cm,SH=1+.015*Cm*T;
  const RT=-2*Math.sqrt(Math.pow(Cm,7)/(Math.pow(Cm,7)+Math.pow(25,7)))*Math.sin(Math.PI/3*Math.exp(-((hm*180/Math.PI-275)/25)**2));
  return Math.sqrt((dL/(kL*SL))**2+(dC/(kC*SC))**2+(dH/(kH*SH))**2+RT*(dC/(kC*SC))*(dH/(kH*SH)));
}

// ---------- Chargement d'image (robuste) ----------
function loadImageFile(f,cb){if(!f)return;const url=URL.createObjectURL(f),img=new Image();img.onload=()=>cb(img,url);img.onerror=()=>URL.revokeObjectURL(url);img.src=url;}
function addRushFiles(files){const list=[...files];let pending=list.length;if(!pending)return;list.forEach(f=>loadImageFile(f,()=>{pending--;updateRushCount();}));}
function updateRushCount(){const n=rushImgs.length;const e=$('rushCount');if(e)e.textContent=n+' image'+(n===1?'':'s');}
function setupDrop(dropId,cb){const d=$(dropId);if(!d)return;d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('dragover');});d.addEventListener('dragleave',()=>d.classList.remove('dragover'));d.addEventListener('drop',e=>{e.preventDefault();d.classList.remove('dragover');const f=e.dataTransfer.files[0];if(f)loadImageFile(f,cb);});d.addEventListener('click',()=>{const i=document.createElement('input');i.type='file';i.accept='image/*';i.onchange=()=>{if(i.files[0])loadImageFile(i.files[0],cb);};i.click();});}
function sampleImg(img,roi){const rw=roi?.w||1,rh=roi?.h||1,W=Math.max(16,Math.min(256,Math.round(img.width*rw))),H=Math.max(16,Math.min(256,Math.round(img.height*rh))),cv=document.createElement('canvas');cv.width=W;cv.height=H;const ctx=cv.getContext('2d');ctx.drawImage(img,Math.round((roi?.x||0)*img.width),Math.round((roi?.y||0)*img.height),Math.round(img.width*rw),Math.round(img.height*rh),0,0,W,H);return {data:ctx.getImageData(0,0,W,H).data,n:W*H};}
function zoneWarmth(sr,sb,count,globalB){if(!count)return 1;const mr=sr/count,mb=sb/count;if(mr+mb<.01)return 1;if(mb<Math.max(.006,globalB*.2))return 1;return clamp(mr/mb,.6,1.6);}

// ---------- Analyse de la référence ----------
function analyze(img,roi){const {data:d,n}=sampleImg(img,roi),lum=[],rC=[],gC=[],bC=[],okPts=[];let satSum=0,valid=0;for(let i=0;i<n;i++){const k=i*4,r=srgb2lin(d[k]/255),g=srgb2lin(d[k+1]/255),b=srgb2lin(d[k+2]/255);if(![r,g,b].every(Number.isFinite))continue;const y=.2126*r+.7152*g+.0722*b;lum[valid]=y;rC[valid]=r;gC[valid]=g;bC[valid]=b;okPts.push(linRgb2oklab(r,g,b));const mx=Math.max(r,g,b),mn=Math.min(r,g,b);satSum+=mx>1e-5?(mx-mn)/mx:0;valid++;}const sorted=lum.slice(0,valid).sort((a,b)=>a-b),p=q=>sorted[Math.min(valid-1,Math.floor(q*(valid-1)))],meanCh=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length),mr=meanCh(rC),mg=meanCh(gC),mb=meanCh(bC);return {p1:p(.01),p5:p(.05),p25:p(.25),p50:p(.5),p75:p(.75),p95:p(.95),p99:p(.99),sat:satSum/Math.max(1,valid),warmLo:zoneWarmth(0,0,0,mb),warmHi:zoneWarmth(0,0,0,mb),meanR:mr,meanG:mg,meanB:mb,_pixels:d,_pn:valid,oklab:oklabStats(okPts)};}
function buildPalette(img,k,roi){k=Math.max(1,Math.floor(k||6));const {data:d,n}=sampleImg(img,roi),pts=[];for(let i=0;i<n;i+=7){const a=d[i*4+3],r=d[i*4],g=d[i*4+1],b=d[i*4+2];if(a>0)pts.push([r,g,b]);}if(!pts.length)return [];k=Math.min(k,pts.length);let cent=pts.slice(0,k).map(p=>p.slice());const assign=new Array(pts.length).fill(0);for(let it=0;it<10;it++){const sums=cent.map(()=>[0,0,0,0]);for(let i=0;i<pts.length;i++){let bi=0,bd=1e99;for(let j=0;j<cent.length;j++){const q=pts[i],c=cent[j],dd=(q[0]-c[0])**2+(q[1]-c[1])**2+(q[2]-c[2])**2;if(dd<bd){bd=dd;bi=j;}}assign[i]=bi;sums[bi][0]+=pts[i][0];sums[bi][1]+=pts[i][1];sums[bi][2]+=pts[i][2];sums[bi][3]++;}for(let j=0;j<cent.length;j++)if(sums[j][3])cent[j]=sums[j].slice(0,3).map(v=>v/sums[j][3]);}return cent;}
function showPalette(img,roi){const pal=buildPalette(img,6,roi),el=$('palette');if(!el)return;el.innerHTML=pal.map(c=>`<span style="background:rgb(${c.join(',')})"></span>`).join('');}
function fmt(x,d=3){return Number(x).toFixed(d);}
function showStats(s){const box=$('statsBox');if(!box)return;box.style.display='block';const rows=[['Noirs P1 / P5',fmt(s.p1)+' / '+fmt(s.p5)],['P25 / P50 / P75',fmt(s.p25)+' / '+fmt(s.p50)+' / '+fmt(s.p75)],['P95 / P99',fmt(s.p95)+' / '+fmt(s.p99)],['Saturation moyenne',fmt(s.sat*100,1)+' %'],['Chaleur ombres (R/B)',fmt(s.warmLo,2)],['Chaleur hautes lumières (R/B)',fmt(s.warmHi,2)]];box.innerHTML=rows.map(r=>`<div><b>${r[0]}</b><span>${r[1]}</span></div>`).join('');}

function buildToneLUT(s,crushAmt,conAmt){const mid=.42,inA=[0,.0625,.25,.5,.75,1],outA=[Math.max(s.p1*(1-crushAmt*.6),0),Math.max(s.p5*(1-crushAmt*.35),0),s.p25,s.p50,s.p75,Math.min(s.p99,1)].map(v=>clamp(mid+(v-s.p50)*conAmt,0,1));outA[3]=mid;const N=4096,lutT=new Float32Array(N);for(let i=0;i<N;i++){const x=i/(N-1),q=x*(inA.length-1),k=Math.min(inA.length-2,Math.floor(q)),t=q-k;lutT[i]=outA[k]*(1-t)+outA[k+1]*t;}return lutT;}
function applyTone(lutT,v){const x=clamp(v,0,1)*(lutT.length-1),i=Math.min(lutT.length-2,Math.floor(x)),f=x-i;return lutT[i]*(1-f)+lutT[i+1]*f;}
function getZoneVals(){return {zShW:+$('zShW')?.value||0,zMdW:+$('zMdW')?.value||0,zHiW:+$('zHiW')?.value||0};}
function generateLUT(size){if(!refStats)return;const n=Math.max(2,Math.floor(size||17)),data=new Float32Array(n*n*n*3),p={};CTL_IDS.forEach(id=>p[id]=+$(`${id}`)?.value||50);const correct=(r,g,b)=>{const o=linRgb2oklab(r,g,b),rs=refStats;let q=o;if(rs.transfer)q=applyOKLabTransfer(o,rs.transfer);let R=oklab2linRgb(q[0],q[1],q[2]);const lum=.2126*R[0]+.7152*R[1]+.0722*R[2],sat=clamp((p.intensity||50)/50,.2,2),z=lum<.33?p.zShW/100:p.zHiW/100,ex=Math.pow(2,z*.6);R=R.map(v=>v*ex);const y=.2126*R[0]+.7152*R[1]+.0722*R[2];R=R.map(v=>y+(v-y)*sat);return R.map(v=>clamp(v,0,1));};let k=0;for(let bz=0;bz<n;bz++)for(let gy=0;gy<n;gy++)for(let rx=0;rx<n;rx++){const q=correct(rx/(n-1),gy/(n-1),bz/(n-1));data[k++]=q[0];data[k++]=q[1];data[k++]=q[2];}lut={size:n,data};if(prevImg)renderPrev(prevImg);}
function lutTetra(r,g,b){const S=lut.size,D=lut.data,x=clamp(r,0,1)*(S-1),y=clamp(g,0,1)*(S-1),z=clamp(b,0,1)*(S-1),i0=Math.min(S-2,Math.floor(x)),j0=Math.min(S-2,Math.floor(y)),k0=Math.min(S-2,Math.floor(z)),fx=x-i0,fy=y-j0,fz=z-k0,idx=(i,j,k)=>(k*S*S+j*S+i)*3;const c=(i,j,k)=>{const q=idx(i,j,k);return [D[q],D[q+1],D[q+2]];};const a=c(i0,j0,k0),out=[0,0,0];for(let i=0;i<3;i++)out[i]=a[i];return out;}

const ROI_KEY='cgt_match_roi_v1';
let refImg=null,prevImg=null,refStats=null,frameStats=null,lut=null,rushImgs=[];const roiState={ref:{x:0,y:0,w:1,h:1},prev:{x:0,y:0,w:1,h:1}};
function refMeanLab(){if(!refStats)return null;return xyz2lab(...lin2xyz(refStats.meanR,refStats.meanG,refStats.meanB));}
function showDE(de){const box=$('deBox');if(!box)return;box.style.display='block';$('deNum').textContent=fmt(de,1);$('deTxt').textContent=de<2?'Très proche':de<5?'Proche':'Différence visible';}
function syncLabels(){['intensity','crush','contrast','zShW','zMdW','zHiW'].forEach(id=>{const v=$(id),o=$('v'+id[0].toUpperCase()+id.slice(1));if(v&&o)o.textContent=v.value+'%';});}
function drawScopes(d){const cv=$('cvVector');if(!cv)return;const ctx=cv.getContext('2d');ctx.fillStyle='#101013';ctx.fillRect(0,0,cv.width,cv.height);}
function renderPrev(img){if(!lut)return;const cv=$('cvPrev'),scale=Math.min(1,1280/img.width);cv.width=Math.max(1,Math.round(img.width*scale));cv.height=Math.max(1,Math.round(img.height*scale));const ctx=cv.getContext('2d');ctx.drawImage(img,0,0,cv.width,cv.height);const id=ctx.getImageData(0,0,cv.width,cv.height),d=id.data;for(let i=0;i<d.length;i+=4){const q=lutTetra(d[i]/255,d[i+1]/255,d[i+2]/255);d[i]=clamp(lin2srgb(q[0]),0,1)*255;d[i+1]=clamp(lin2srgb(q[1]),0,1)*255;d[i+2]=clamp(lin2srgb(q[2]),0,1)*255;}ctx.putImageData(id,0,0);drawScopes(cv);}
function download(){if(!lut)return;const out=['TITLE "Colour Grade Tool"','LUT_3D_SIZE '+lut.size];for(let i=0;i<lut.data.length;i+=3)out.push(lut.data[i]+' '+lut.data[i+1]+' '+lut.data[i+2]);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([out.join('\n')],{type:'text/plain'}));a.download='grade.cube';a.click();}
const PKEY='cgt_presets_v31';function loadPresets(){try{return JSON.parse(localStorage.getItem(PKEY)||'{}');}catch{return {};}}function refreshPresetList(){}function savePreset(){const name=$('presetName')?.value.trim();if(!name)return;const ps=loadPresets();ps[name]={};localStorage.setItem(PKEY,JSON.stringify(ps));}function applyPreset(){}function deletePreset(){}
const LOOK_SLOTS_KEY='cgt_look_slots_v1',LOOK_ACTIVE_KEY='cgt_look_active_v1',LOOK_SLOT_NAMES=['A','B','C'];let activeLookSlot=null;function loadLookSlots(){try{return JSON.parse(localStorage.getItem(LOOK_SLOTS_KEY)||'{}');}catch{return {};}}function saveLookSlots(slots){localStorage.setItem(LOOK_SLOTS_KEY,JSON.stringify(slots));}function currentGrade(){const grade={};(typeof CTL_IDS==='undefined'?[]:CTL_IDS).forEach(id=>{grade[id]=$(id)?.value;});return grade;}function updateLookSlotUI(){}function captureLookSlot(name){const s=loadLookSlots();s[name]=currentGrade();saveLookSlots(s);activeLookSlot=name;}function applyLookSlot(){}
function exportPreset(){}function importPresetFile(){}
const CTL_IDS=['intensity','crush','contrast','zShW','zMdW','zHiW'];
setupDrop('dropRef',img=>{refImg=img;refStats=analyze(img,roiState.ref);refStats.transfer=null;showStats(refStats);showPalette(img,roiState.ref);const ir=$('imgRef');if(ir){ir.src=img.src;ir.style.display='block';}$('ringRef')?.style&&($('ringRef').style.display='none');generateLUT(+$('lutSize')?.value||17);});
setupDrop('dropPrev',img=>{prevImg=img;if(!lut){$('baBefore')?.setAttribute('src',img.src);return;}renderPrev(img);});
$('btnDl')?.addEventListener('click',download);function runAutoMatch(){if(!refStats)return false;if(prevImg){frameStats=buildTransferFromImage(prevImg,roiState.prev);refStats.transfer=buildOKLabTransfer(refStats.oklab,frameStats);}syncLabels();generateLUT(+$('lutSize')?.value||17);return true;}$('btnAuto')?.addEventListener('click',runAutoMatch);$('btnReset')?.addEventListener('click',()=>{syncLabels();if(refStats)generateLUT(+$('lutSize')?.value||17);});$('btnSave')?.addEventListener('click',savePreset);$('btnLoad')?.addEventListener('click',applyPreset);$('btnDel')?.addEventListener('click',deletePreset);
(() => {const t=$('modeExpert');if(!t)return;const key='cgt_expert_mode_v1',saved=localStorage.getItem(key)==='1';t.checked=saved;document.body.classList.toggle('expert-mode',saved);t.addEventListener('change',()=>{document.body.classList.toggle('expert-mode',t.checked);localStorage.setItem(key,t.checked?'1':'0');});})();
