/*
 * Colour Grade Tool — module d'auto-match colorimétrique.
 * Expose : window.CGT_AUTOMATCH = { run, labStats, reinhardMap, autoTune }.
 */
(function(){
  'use strict';

  const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
  const finite=(x,fallback=0)=>Number.isFinite(x)?x:fallback;
  const S2L=window.srgb2lin||function(c){return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  const L2S=window.lin2srgb||function(c){return c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;};
  const rgb2lab=window.rgb2lab||function(r,g,b){
    const X=.4124*r+.3576*g+.1805*b,Y=.2126*r+.7152*g+.0722*b,Z=.0193*r+.1192*g+.9505*b;
    const f=t=>t>.008856?Math.cbrt(t):(903.3*t+16)/116;
    const fx=f(X/.95047),fy=f(Y),fz=f(Z/1.08883);
    return [116*fy-16,500*(fx-fy),200*(fy-fz)];
  };
  function lab2rgb(L,a,b){
    const fy=(L+16)/116,fx=fy+a/500,fz=fy-b/200;
    const fi=t=>{const q=t*t*t;return q>.008856?q:(116*t-16)/903.3;};
    const X=.95047*fi(fx),Y=fi(fy),Z=1.08883*fi(fz);
    return [clamp(L2S(3.2406*X-1.5372*Y-.4986*Z),0,1),clamp(L2S(-.9689*X+1.8758*Y+.0415*Z),0,1),clamp(L2S(.0557*X-.204*Y+1.057*Z),0,1)];
  }
  const dE2000=window.deltaE2000||function(l1,a1,b1,l2,a2,b2){return Math.hypot(l1-l2,a1-a2,b1-b2);};

  function labStats(canvas){
    if(!canvas||!canvas.width||!canvas.height)return {m:[0,0,0],s:[0,0,0],n:0};
    let d;try{d=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;}catch(e){return {m:[0,0,0],s:[0,0,0],n:0};}
    let sl=0,sa=0,sb=0,sl2=0,sa2=0,sb2=0,n=0;
    for(let i=0;i+2<d.length;i+=16){
      const q=rgb2lab(S2L(d[i]/255),S2L(d[i+1]/255),S2L(d[i+2]/255));
      if(!q.every(Number.isFinite))continue;
      sl+=q[0];sa+=q[1];sb+=q[2];sl2+=q[0]*q[0];sa2+=q[1]*q[1];sb2+=q[2]*q[2];n++;
    }
    if(!n)return {m:[0,0,0],s:[0,0,0],n:0};
    const m=[sl/n,sa/n,sb/n];
    return {m,s:[Math.sqrt(Math.max(0,sl2/n-m[0]*m[0])),Math.sqrt(Math.max(0,sa2/n-m[1]*m[1])),Math.sqrt(Math.max(0,sb2/n-m[2]*m[2]))],n};
  }
  function reinhardMap(r,g,b,ref,rush){
    if(!ref||!rush||!ref.n||!rush.n)return [clamp(r,0,1),clamp(g,0,1),clamp(b,0,1)];
    const q=rgb2lab(S2L(r),S2L(g),S2L(b));
    const out=q.map((v,i)=>clamp((v-rush.m[i])*(ref.s[i]/Math.max(rush.s[i],.5))+ref.m[i],0,100));
    return lab2rgb(out[0],out[1],out[2]);
  }

  function autoTune(sampleFn,refSamples,init,steps){
    const p=Object.assign({},init||{}),keys=Object.keys(p||{}),step=Object.assign({},steps||{});
    const samples=Array.isArray(refSamples)?refSamples:[];
    const cost=pp=>{let sum=0,n=0;for(const item of samples){const out=sampleFn(item[0],item[1],item[2],pp);if(!out||out.length<3)continue;const lab=rgb2lab(S2L(out[0]),S2L(out[1]),S2L(out[2]));const ref=item[3];if(lab.every(Number.isFinite)&&ref&&ref.every(Number.isFinite)){const e=dE2000(...lab,...ref);if(Number.isFinite(e)){sum+=e;n++;}}}return n?sum/n:Infinity;};
    let best=cost(p);for(let pass=0;pass<3;pass++)for(const k of keys){const base=p[k],delta=Math.max(Math.abs(step[k]||1)*Math.pow(.5,pass),.01);let val=base,score=best;for(const v of [base+delta,base-delta]){p[k]=v;const c=cost(p);if(c<score){score=c;val=v;}}p[k]=val;best=score;}return {params:p,score:finite(best,Infinity)};
  }

  function imageSamples(refImg,rushImg,maxSide){
    if(!refImg||!rushImg||!refImg.naturalWidth&& !refImg.width||!rushImg.naturalWidth&& !rushImg.width)return [];
    const W=Math.min(maxSide||32,refImg.naturalWidth||refImg.width,rushImg.naturalWidth||rushImg.width),H=Math.min(maxSide||32,refImg.naturalHeight||refImg.height,rushImg.naturalHeight||rushImg.height);
    const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=W;a.height=b.height=H;
    const ca=a.getContext('2d'),cb=b.getContext('2d');ca.drawImage(refImg,0,0,W,H);cb.drawImage(rushImg,0,0,W,H);
    const ra=ca.getImageData(0,0,W,H).data,rb=cb.getImageData(0,0,W,H).data,out=[];
    for(let i=0;i<ra.length;i+=4){const lab=rgb2lab(S2L(ra[i]/255),S2L(ra[i+1]/255),S2L(ra[i+2]/255));if(lab.every(Number.isFinite))out.push([rb[i]/255,rb[i+1]/255,rb[i+2]/255,lab]);}
    return out;
  }
  function controls(){return ['sat','con','warm','zSh','zShW','zMd','zMdW','zHi','zHiW'];}
  function run(opts){
    opts=opts||{};const btn=document.getElementById('btnAuto');
    if(typeof refStats==='undefined'||!refStats){if(window.alert)alert('Charge d’abord une image de référence.');return;}
    if(typeof prevImg==='undefined'||!prevImg){if(window.alert)alert('Charge une frame de rush à prévisualiser.');return;}
    const apply=(id,v)=>{const el=document.getElementById(id);if(!el)return;const lo=Number(el.min),hi=Number(el.max);el.value=clamp(Math.round(v),lo,hi);el.dispatchEvent(new Event('input'));};
    if(btn){btn.disabled=true;btn.textContent=opts.deep?'⏳ Optimisation…':'⏳ Calcul…';}
    const finish=()=>{if(btn){btn.disabled=false;btn.textContent='🎯 Match auto';}};
    setTimeout(()=>{try{
      const cv=document.createElement('canvas'),scale=Math.min(1,640/prevImg.width);cv.width=Math.max(1,Math.round(prevImg.width*scale));cv.height=Math.max(1,Math.round(prevImg.height*scale));cv.getContext('2d').drawImage(prevImg,0,0,cv.width,cv.height);
      const rush=labStats(cv), ref={m:[finite(refStats.meanL,50),0,0],s:[20,20,20],n:1};
      if(Number.isFinite(refStats.meanR)){const q=rgb2lab(refStats.meanR,refStats.meanG,refStats.meanB);ref.m=q;ref.s=[Math.max(refStats.p95-refStats.p5,.02)*110,14,14];}
      const sc=ref.s[0]/Math.max(rush.s[0],.5);
      apply('sat',clamp(100*(.6+.4*sc),40,160));apply('con',clamp(100*sc,55,150));apply('warm',clamp(Math.round((ref.m[2]-rush.m[2])*2.5),-60,60));
      if(opts.deep){
        const samples=imageSamples(document.getElementById('imgRef'),prevImg,32),ids=controls(),init={},steps={};
        ids.forEach(id=>{const el=document.getElementById(id);if(el){init[id]=+el.value;steps[id]=Math.max((+el.max-+el.min)/10,1);}});
        let cached='';
        const tuned=autoTune((r,g,b,p)=>{
          const sig=ids.map(id=>p[id]).join(',');
          if(sig!==cached){ids.forEach(id=>apply(id,p[id]));if(typeof generateLUT==='function')generateLUT(Math.min(5,+(document.getElementById('lutSize')||{value:5}).value));cached=sig;}
          return typeof lutTetra==='function'?lutTetra(r,g,b):[r,g,b];
        },samples,init,steps);
        ids.forEach(id=>{if(tuned.params[id]!==undefined)apply(id,tuned.params[id]);});
      }
      if(typeof syncLabels==='function')syncLabels();if(typeof generateLUT==='function')generateLUT(+(document.getElementById('lutSize')||{value:33}).value);finish();
    }catch(e){console.error(e);finish();if(window.alert)alert('Erreur auto-match : '+e.message);}},30);
  }
  function init(){window.CGT_AUTOMATCH={labStats,reinhardMap,autoTune,run};}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
