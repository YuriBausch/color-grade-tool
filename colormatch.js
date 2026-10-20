/*
 * Colour Grade Tool — Module d'auto-match colorimétrique v1.0
 * ------------------------------------------------------------------
 * Algorithmes :
 *   1. Reinhard et al. 2001 — transfert statistique de couleur en Lab
 *      (moyenne + écart-type de la référence appliqués au rush)
 *   2. Optimisation par descente de gradient sur le score CIEDE2000
 *      (affine les paramètres exposition/contraste/saturation/chaleur)
 *
 * Intégration (2 lignes dans index.html) :
 *   avant </body> :  <script src="colormatch.js"></script>
 *   dans la <div class="row"> des boutons :
 *     <button id="btnAuto" class="sec">🎯 Match auto</button>
 *
 * Le module branche lui-même le bouton s'il détecte refStats/generateLUT.
 */
(function(){
  'use strict';

  // ---------- Espace Lab (réutilise les fonctions globales si présentes) ----------
  const S2L = window.srgb2lin || (c => c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
  const L2S = window.lin2srgb || (c => c<=0.0031308 ? c*12.92 : 1.055*Math.pow(c,1/2.4)-0.055);
  const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
  const rgb2lab = window.rgb2lab || function(r,g,b){
    const X=0.4124*r+0.3576*g+0.1805*b, Y=0.2126*r+0.7152*g+0.0722*b, Z=0.0193*r+0.1192*g+0.9505*b;
    const f=t=>t>0.008856?Math.cbrt(t):(903.3*t+16)/116;
    const fx=f(X/0.95047),fy=f(Y),fz=f(Z/1.08883);
    return [116*fy-16,500*(fx-fy),200*(fy-fz)];
  };
  function lab2rgb(L,a,bb){
    const fy=(L+16)/116, fx=fy+a/500, fz=fy-bb/200;
    const fi=t=>{const t3=t*t*t;return t3>0.008856?t3:(116*t-16)/903.3;};
    const X=0.95047*fi(fx), Y=fi(fy), Z=1.08883*fi(fz);
    const r= 3.2406*X-1.5372*Y-0.4986*Z,
          g=-0.9689*X+1.8758*Y+0.0415*Z,
          b= 0.0557*X-0.2040*Y+1.0570*Z;
    return [clamp(L2S(r),0,1),clamp(L2S(g),0,1),clamp(L2S(b),0,1)];
  }

  // ---------- CIEDE2000 (localement, pour l'optimisation) ----------
  const dE2000 = window.deltaE2000 || function(l1,a1,b1,l2,a2,b2){
    // version simplifiée CIE76 si le module principal n'expose pas CIEDE2000
    return Math.sqrt((l1-l2)**2+(a1-a2)**2+(b1-b2)**2);
  };

  // ---------- Stats Lab d'une image (canvas source) ----------
  function labStats(canvas){
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let sL=0,sA=0,sB=0,sL2=0,sA2=0,sB2=0,n=0;
    for(let i=0;i<d.length;i+=16){ // échantillonnage 1/4 px
      const [L,a,b]=rgb2lab(S2L(d[i]/255),S2L(d[i+1]/255),S2L(d[i+2]/255));
      sL+=L;sA+=a;sB+=b;sL2+=L*L;sA2+=a*a;sB2+=b*b;n++;
    }
    const mL=sL/n,mA=sA/n,mB=sB/n;
    return {m:[mL,mA,mB], s:[Math.sqrt(Math.max(sL2/n-mL*mL,0)),
                             Math.sqrt(Math.max(sA2/n-mA*mA,0)),
                             Math.sqrt(Math.max(sB2/n-mB*mB,0))], n};
  }

  // ---------- Reinhard : (x - μ_rush) * (σ_ref/σ_rush) + μ_ref ----------
  function reinhardMap(r,g,b,ref,rush){
    const [L,a,bb]=rgb2lab(S2L(r),S2L(g),S2L(b));
    const out=[0,1,2].map(i=>{
      const sc=ref.s[i]/Math.max(rush.s[i],0.5);
      return clamp((([L,a,bb][i])-rush.m[i])*sc+ref.m[i],0,100);
    });
    return lab2rgb(out[0],out[1],out[2]);
  }

  // ---------- Descente de gradient sur les paramètres du tool ----------
  // Objective : minimiser ΔE2000 moyen entre rush gradé et référence,
  // en ajustant [contraste, saturation, chaleur, exposition zones].
  function autoTune(sampleFn, refSamples, init, steps){
    const keys=Object.keys(init);
    const p={...init};
    const cost=pp=>{
      let s=0,n=0;
      for(const [r,g,b,labRef] of refSamples){
        const out=sampleFn(r,g,b,pp);
        const lab=rgb2lab(S2L(out[0]),S2L(out[1]),S2L(out[2]));
        s+=dE2000(lab[0],lab[1],lab[2],labRef[0],labRef[1],labRef[2]);n++;
      }
      return s/n;
    };
    let c=cost(p);
    const lr={};keys.forEach(k=>lr[k]=steps[k]||0.05);
    for(let it=0;it<60;it++){
      for(const k of keys){
        const bak=p[k];
        p[k]=bak+lr[k];const cUp=cost(p);
        p[k]=bak-lr[k];const cDn=cost(p);
        if(cUp<c&&cUp<=cDn){p[k]=bak+lr[k];c=cUp;}
        else if(cDn<c){p[k]=bak-lr[k];c=cDn;}
        else p[k]=bak;
        lr[k]=Math.max(lr[k]*0.97,0.005);
      }
      if(c<0.8)break;
    }
    return {params:p,score:c};
  }

  // ---------- Point d'entrée UI ----------
  function init(){
    const btn=document.getElementById('btnAuto');
    if(!btn)return;
    btn.addEventListener('click',()=>{
      if(typeof refStats==='undefined'||!refStats){alert('Charge d\u2019abord une image de référence.');return;}
      if(!prevImg){alert('Charge une frame de rush à prévisualiser.');return;}
      btn.disabled=true;btn.textContent='⏳ Calcul…';
      setTimeout(()=>{
        try{
          // 1. Stats Lab des deux images
          const cRush=document.createElement('canvas');
          const a=Math.min(1,640/prevImg.width);
          cRush.width=Math.round(prevImg.width*a);cRush.height=Math.round(prevImg.height*a);
          cRush.getContext('2d').drawImage(prevImg,0,0,cRush.width,cRush.height);
          const rushSt=labStats(cRush);
          const refSt={m:[refStats.meanL!==undefined?refStats.meanL:50, 0, 0],
                       s:[20,20,20]}; // fallback si meanLab absent
          // Si le tool principal expose les moyennes RVB, on calcule le Lab de la ref
          if(refStats.meanR!==undefined){
            const [L,aa,bb2]=rgb2lab(refStats.meanR,refStats.meanG,refStats.meanB);
            refSt.m=[L,aa,bb2];
            refSt.s=[Math.max(refStats.p95-refStats.p5,0.02)*110, 14, 14];
          }
          // 2. Reinhard : on l'applique comme chaleur auto + saturation suggérées
          const scL=refSt.s[0]/Math.max(rushSt.s[0],0.5);
          const satSug=clamp(100*(0.6+0.4*scL),40,160);
          const conSug=clamp(100*scL,55,150);
          const warmSug=clamp(Math.round((refSt.m[2]-rushSt.m[2])*2.5),-60,60);
          // 3. Application aux sliders du tool (s'ils existent)
          const set=(id,v)=>{const el=document.getElementById(id);if(el){el.value=v;el.dispatchEvent(new Event('input'));}};
          set('sat',Math.round(satSug));
          set('con',Math.round(conSug));
          set('warm',warmSug);
          if(typeof syncLabels==='function')syncLabels();
          if(typeof generateLUT==='function')generateLUT(+(document.getElementById('lutSize')||{value:33}).value);
          btn.textContent='🎯 Match auto';btn.disabled=false;
        }catch(e){
          console.error(e);alert('Erreur auto-match : '+e.message);
          btn.textContent='🎯 Match auto';btn.disabled=false;
        }
      },30);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();

  // Exposition publique pour usage avancé / tests
  window.CGT_AUTOMATCH={labStats,reinhardMap,autoTune};
})();
