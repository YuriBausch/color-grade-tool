/*
 * Colour Grade Tool — module d'auto-match colorimétrique.
 * L'optimisation profonde est exécutée dans un Web Worker inline afin de
 * laisser l'interface réactive pendant les 9 itérations.
 */
(function(){
  'use strict';
  const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
  const finite=(x,fallback=0)=>Number.isFinite(x)?x:fallback;
  const S2L=window.srgb2lin||function(c){return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);};
  const L2S=window.lin2srgb||function(c){return c<=.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-.055;};
  const rgb2lab=window.rgb2lab||function(r,g,b){
    const X=.4124*r+.3576*g+.1805*b,Y=.2126*r+.7152*g+.0722*b,Z=.0193*r+.1192*g+.9505*b;
    const f=t=>t>.008856?Math.cbrt(t):(903.3*t+16)/116;
    const fx=f(X/.95047),fy=f(Y),fz=f(Z/1.08883);
    return [116*fy-16,500*(fx-fy),200*(fy-fz)];
  };
  const dE2000=window.deltaE2000||function(l1,a1,b1,l2,a2,b2){return Math.hypot(l1-l2,a1-a2,b1-b2);};
  function lab2rgb(L,a,b){const fy=(L+16)/116,fx=fy+a/500,fz=fy-b/200,fi=t=>{const q=t*t*t;return q>.008856?q:(116*t-16)/903.3;};const X=.95047*fi(fx),Y=fi(fy),Z=1.08883*fi(fz);return [clamp(L2S(3.2406*X-1.5372*Y-.4986*Z),0,1),clamp(L2S(-.9689*X+1.8758*Y+.0415*Z),0,1),clamp(L2S(.0557*X-.204*Y+1.057*Z),0,1)];}
  function labStats(canvas){
    if(!canvas||!canvas.width||!canvas.height)return {m:[0,0,0],s:[0,0,0],n:0};
    let d;try{d=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;}catch(e){return {m:[0,0,0],s:[0,0,0],n:0};}
    let sl=0,sa=0,sb=0,sl2=0,sa2=0,sb2=0,n=0;
    for(let i=0;i+2<d.length;i+=16){const q=rgb2lab(S2L(d[i]/255),S2L(d[i+1]/255),S2L(d[i+2]/255));if(!q.every(Number.isFinite))continue;sl+=q[0];sa+=q[1];sb+=q[2];sl2+=q[0]*q[0];sa2+=q[1]*q[1];sb2+=q[2]*q[2];n++;}
    if(!n)return {m:[0,0,0],s:[0,0,0],n:0};const m=[sl/n,sa/n,sb/n];return {m,s:[Math.sqrt(Math.max(0,sl2/n-m[0]*m[0])),Math.sqrt(Math.max(0,sa2/n-m[1]*m[1])),Math.sqrt(Math.max(0,sb2/n-m[2]*m[2]))],n};
  }
  function reinhardMap(r,g,b,ref,rush){if(!ref||!rush||!ref.n||!rush.n)return [clamp(r,0,1),clamp(g,0,1),clamp(b,0,1)];const q=rgb2lab(S2L(r),S2L(g),S2L(b));const out=q.map((v,i)=>clamp((v-rush.m[i])*(ref.s[i]/Math.max(rush.s[i],.5))+ref.m[i],0,100));return lab2rgb(out[0],out[1],out[2]);}
  function imageSamples(refImg,rushImg,maxSide){
    const rw=refImg.naturalWidth||refImg.width,rh=refImg.naturalHeight||refImg.height,uw=rushImg.naturalWidth||rushImg.width,uh=rushImg.naturalHeight||rushImg.height;if(!rw||!rh||!uw||!uh)return [];
    const W=Math.min(maxSide||32,rw,uw),H=Math.min(maxSide||32,rh,uh),a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=W;a.height=b.height=H;a.getContext('2d').drawImage(refImg,0,0,W,H);b.getContext('2d').drawImage(rushImg,0,0,W,H);const ra=a.getContext('2d').getImageData(0,0,W,H).data,rb=b.getContext('2d').getImageData(0,0,W,H).data,out=[];for(let i=0;i<ra.length;i+=4){const lab=rgb2lab(S2L(ra[i]/255),S2L(ra[i+1]/255),S2L(ra[i+2]/255));if(lab.every(Number.isFinite)){const hue=(Math.atan2(lab[2],lab[1])*180/Math.PI+360)%360,chroma=Math.hypot(lab[1],lab[2]),lum=lab[0]/100;let weight=1;if(hue>=10&&hue<=40&&chroma>=12&&chroma<=55)weight*=3.5;else if(lum>=.12&&lum<=.88)weight*=1.6;if(lum<.05||lum>.95)weight*=.35;out.push([rb[i]/255,rb[i+1]/255,rb[i+2]/255,lab,weight]);}}return out;
  }
  const controls=()=>['sat','con','warm','zSh','zShW','zMd','zMdW','zHi','zHiW'];
  const workerSource=()=>`self.onmessage=function(e){const d=e.data,S2L=c=>c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4),cl=(x,a,b)=>Math.min(b,Math.max(a,x)),lab=(r,g,b)=>{const X=.4124*r+.3576*g+.1805*b,Y=.2126*r+.7152*g+.0722*b,Z=.0193*r+.1192*g+.9505*b,f=t=>t>.008856?Math.cbrt(t):(903.3*t+16)/116,fx=f(X/.95047),fy=f(Y),fz=f(Z/1.08883);return[116*fy-16,500*(fx-fy),200*(fy-fz)]},de=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]),apply=(r,g,b,p)=>{const sat=(p.sat||100)/100,con=(p.con||100)/100,w=(p.warm||0)/100,lum=.2126*r+.7152*g+.0722*b;let R=(r-.5)*con+.5,G=(g-.5)*con+.5,B=(b-.5)*con+.5;const y=lum<.33?(p.zSh||0)/100:lum>.66?(p.zHi||0)/100:(p.zMd||0)/100,zw=lum<.33?(p.zShW||0)/100:lum>.66?(p.zHiW||0)/100:(p.zMdW||0)/100;const ex=Math.pow(2,y*.6);R*=ex;G*=ex;B*=ex;const yy=.2126*R+.7152*G+.0722*B;R=yy+(R-yy)*sat;G=yy+(G-yy)*sat;B=yy+(B-yy)*sat;const ww=1+w*.5+zw*.08;return[cl(R*ww,0,1),cl(G,0,1),cl(B/ww,0,1)]};const cost=p=>{let s=0,n=0;for(const x of d.samples){const q=lab(...apply(x[0],x[1],x[2],p).map(S2L)),z=de(q,x[3]);if(Number.isFinite(z)){const w=Number.isFinite(x[4])?x[4]:1;s+=z*w;n+=w}}return n?s/n:Infinity};let p=Object.assign({},d.init),best=cost(p),bestP=Object.assign({},p),keys=d.keys;for(let it=1;it<=9;it++){const pass=Math.floor((it-1)/3),k=keys[(it-1)%keys.length],base=p[k],delta=Math.max(Math.abs(d.steps[k]||1)*Math.pow(.5,pass),.01);for(const v of[base+delta,base-delta]){p[k]=v;const c=cost(p);if(c<best){best=c;bestP=Object.assign({},p)}}p[k]=bestP[k];self.postMessage({type:'progress',iteration:it,params:bestP,score:best})}self.postMessage({type:'done',params:bestP,score:best})};`;
  let activeWorker=null;
  function apply(id,v){const el=document.getElementById(id);if(!el)return;el.value=clamp(Math.round(v),Number(el.min),Number(el.max));el.dispatchEvent(new Event('input'));}
  function finish(btn){if(btn){btn.disabled=false;btn.textContent='🎯 Match auto';}activeWorker=null;}
  function run(opts){
    opts=opts||{};const btn=document.getElementById('btnAuto');if(typeof refStats==='undefined'||!refStats){alert('Charge d’abord une image de référence.');return;}if(typeof prevImg==='undefined'||!prevImg){alert('Charge une frame de rush à prévisualiser.');return;}
    if(activeWorker){activeWorker.terminate();finish(btn);return;}
    const cv=document.createElement('canvas'),scale=Math.min(1,640/prevImg.width);cv.width=Math.max(1,Math.round(prevImg.width*scale));cv.height=Math.max(1,Math.round(prevImg.height*scale));cv.getContext('2d').drawImage(prevImg,0,0,cv.width,cv.height);const rush=labStats(cv),ref={m:[finite(refStats.meanL,50),0,0],s:[20,20,20],n:1};if(Number.isFinite(refStats.meanR)){ref.m=rgb2lab(refStats.meanR,refStats.meanG,refStats.meanB);ref.s=[Math.max(refStats.p95-refStats.p5,.02)*110,14,14];}const sc=ref.s[0]/Math.max(rush.s[0],.5);apply('sat',clamp(100*(.6+.4*sc),40,160));apply('con',clamp(100*sc,55,150));apply('warm',clamp(Math.round((ref.m[2]-rush.m[2])*2.5),-60,60));
    if(!opts.deep){if(typeof syncLabels==='function')syncLabels();if(typeof generateLUT==='function')generateLUT(+(document.getElementById('lutSize')||{value:33}).value);finish(btn);return;}
    const ids=controls(),init={},steps={};ids.forEach(id=>{const el=document.getElementById(id);if(el){init[id]=+el.value;steps[id]=Math.max((+el.max-+el.min)/10,1);}});const samples=imageSamples(document.getElementById('imgRef'),prevImg,32);if(btn){btn.disabled=false;btn.textContent='⏳ Optimisation… itération 0/9';}
    activeWorker=new Worker(URL.createObjectURL(new Blob([workerSource()],{type:'application/javascript'})));activeWorker.onmessage=e=>{const m=e.data;if(m.type==='progress'){if(btn)btn.textContent='⏳ Optimisation… itération '+m.iteration+'/9';ids.forEach(id=>{if(m.params[id]!==undefined)apply(id,m.params[id]);});if(typeof generateLUT==='function')generateLUT(Math.min(5,+(document.getElementById('lutSize')||{value:5}).value));}else{ids.forEach(id=>{if(m.params[id]!==undefined)apply(id,m.params[id]);});if(typeof syncLabels==='function')syncLabels();if(typeof generateLUT==='function')generateLUT(+(document.getElementById('lutSize')||{value:33}).value);finish(btn);}};activeWorker.onerror=e=>{console.error(e);finish(btn);alert('Erreur auto-match : '+e.message);};activeWorker.postMessage({samples,init,steps,keys:ids});
  }
  function init(){window.CGT_AUTOMATCH={labStats,reinhardMap,run};}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
