
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
function lin2xyz(r,g,b){const X=0.4124*r+0.3576*g+0.1805*b, Y=0.2126*r+0.7152*g+0.0722*b, Z=0.0193*r+0.1192*g+0.9505*b;return [X/0.95047,Y/1.0,Z/1.08883];}
function fxyz(t){return t>0.008856?Math.cbrt(t):(903.3*t+16)/116;}
function xyz2lab(X,Y,Z){const fx=fxyz(X),fy=fxyz(Y),fz=fxyz(Z);return [116*fy-16,500*(fx-fy),200*(fy-fz)];}
function rgb2lab(r,g,b){const[x,y,z]=lin2xyz(r,g,b);return xyz2lab(x,y,z);}

// ---------- CIEDE2000 (Sharma et al. 2005) ----------
function deltaE2000(l1,a1,b1,l2,a2,b2){
  const C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),Cm=(C1+C2)/2;
  const G=0.5*(1-Math.sqrt(Math.pow(Cm,7)/(Math.pow(Cm,7)+Math.pow(25,7))));
  const a1p=a1*(1+G),a2p=a2*(1+G);
  const C1p=Math.hypot(a1p,b1),C2p=Math.hypot(a2p,b2);
  let h1p=Math.atan2(b1,a1p),h2p=Math.atan2(b2,a2p);
  if(h1p<0)h1p+=2*Math.PI; if(h2p<0)h2p+=2*Math.PI;
  const dCp=C2p-C1p; let dhp=h2p-h1p;
  if(dhp>Math.PI)dhp-=2*Math.PI; else if(dhp<-Math.PI)dhp+=2*Math.PI;
  const dLp=l2-l1, dHp=2*Math.sqrt(C1p*C2p)*Math.sin(dhp/2), Lpm=(l1+l2)/2, Cpm=(C1p+C2p)/2;
  let hm=h1p+h2p;
  if(C1p*C2p!==0){if(Math.abs(h1p-h2p)<=Math.PI)hm/=2;else if(h1p+h2p<2*Math.PI)hm=(h1p+h2p+2*Math.PI)/2;else hm=(h1p+h2p-2*Math.PI)/2;}
  const T=1-0.17*Math.cos(hm-Math.PI/6)+0.24*Math.cos(2*hm)+0.32*Math.cos(3*hm+Math.PI/30)-0.20*Math.cos(4*hm-63*Math.PI/180), dTheta=30*Math.exp(-Math.pow((hm-275*Math.PI/180)/(25*Math.PI/180),2)), C7=Math.pow(Cpm,7), SC=1+0.045*Cpm, L50=(Lpm-50)*(Lpm-50), SL=1+0.015*L50/Math.sqrt(20+L50), SH=1+0.015*Cpm*T, RT=-2*Math.sqrt(C7/(C7+Math.pow(25,7)))*Math.sin(2*dTheta*Math.PI/180);
  return Math.sqrt(Math.pow(dLp/SL,2)+Math.pow(dCp/SC,2)+Math.pow(dHp/SH,2)+RT*(dCp/SC)*(dHp/SH));
}

// ---------- Chargement d'image (robuste) ----------
function loadImageFile(f,cb){
  if(!f)return;
  if(!f.type||!f.type.startsWith('image/')){alert('⚠ Fichier non reconnu comme image ('+(f.type||'type inconnu')+')');return;}
  const url=URL.createObjectURL(f), img=new Image();
  img.onload=()=>cb(img,url); img.onerror=()=>{URL.revokeObjectURL(url);alert('⚠ Impossible de décoder cette image.');}; img.src=url;
}
function addRushFiles(files){const list=Array.from(files||[]).filter(f=>f.type&&f.type.startsWith('image/'));let pending=list.length;if(!pending)return;list.forEach(f=>loadImageFile(f,(img,url)=>{rushImgs.push({img,url});pending--;if(!pending)updateRushCount();}));}
function updateRushCount(){const n=rushImgs.length;$('rushCount').textContent=n?(n+' rush'+(n>1?'s':'')+' inclus dans le match'):'Aucun rush additionnel';}
function setupDrop(dropId,cb){const d=$(dropId);d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('over');});d.addEventListener('dragleave',()=>d.classList.remove('over'));d.addEventListener('drop',e=>{e.preventDefault();d.classList.remove('over');loadImageFile(e.dataTransfer.files[0],cb);});d.addEventListener('click',()=>{const i=document.createElement('input');i.type='file';i.accept='image/*';i.onchange=()=>{if(i.files&&i.files[0])loadImageFile(i.files[0],cb);};i.click();});}

/* REST OF ORIGINAL FILE */
// ---------- Pipeline import preview ----------
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
