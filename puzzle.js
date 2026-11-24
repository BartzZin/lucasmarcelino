(() => {
  'use strict';

  const canvas = document.querySelector('#puzzle');
  const ctx = canvas?.getContext('2d');
  const main = document.querySelector('#principal');
  if (!ctx || !main) return;
  const intro = main.querySelector('.intro');
  const chapters = [...main.querySelectorAll('.story section')];
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const tau = Math.PI * 2;
  const unit = v => Math.max(0, Math.min(1, v));
  const smooth = v => { const t=unit(v); return t*t*(3-2*t); };
  const mix = (a,b,t) => a+(b-a)*t;
  const artBase = new URL('./arte/', document.currentScript?.src || document.baseURI);

  // Pixel positions in the shared studio render, including the transparent
  // padding of each crop. At rest the four layers reproduce that photograph.
  const art = [
    {file:'topo.webp',x:291,y:128,w:555,h:429,turn:-.16},
    {file:'esquerda.webp',x:92,y:381,w:525,h:587,turn:.16},
    {file:'direita.webp',x:629,y:321,w:547,h:475,turn:.15},
    {file:'frente.webp',x:395,y:614,w:596,h:529,turn:-.13}
  ];
  const left=Math.min(...art.map(p=>p.x)), right=Math.max(...art.map(p=>p.x+p.w));
  const top=Math.min(...art.map(p=>p.y)), bottom=Math.max(...art.map(p=>p.y+p.h));
  const artWidth=right-left;
  const midX=(left+right)/2, midY=(top+bottom)/2;
  for(const p of art) {
    p.cx=(p.x+p.w/2-midX)/artWidth; p.cy=(p.y+p.h/2-midY)/artWidth;
    p.width=p.w/artWidth; p.height=p.h/artWidth;
  }

  const stars = [
    [-.52,-.26,4.1],[-.42,-.31,1.5],[-.35,-.43,2.4],[-.31,-.46,1.1],[-.17,-.53,1.5],
    [.40,-.37,1.5],[.55,-.24,2.3],[.61,-.09,1.4],[.54,.31,3.8],[.45,.37,1.2],
    [.37,.41,1.8],[.22,.46,1.1],[-.23,.47,3.0],[-.38,.39,1.1],[-.49,.25,1.6]
  ];
  let width=0,height=0,ratio=1,layout=[],marks=[0,1],flight=null,distance=1;
  let target=0,position=0,clock=0,previous=0,frame=0,replay=null,paused=false,ready=false;
  let enabled = new URLSearchParams(location.search).get('movimento')==='completo';
  const reduced = () => preference.matches && !enabled;
  const cursor={x:0,y:0,tx:0,ty:0};

  function measure(){
    const bounds=canvas.getBoundingClientRect();
    width=bounds.width;height=bounds.height;ratio=Math.min(2,devicePixelRatio||1);
    if (!width || !height) return;
    const pw=Math.round(width*ratio), ph=Math.round(height*ratio);
    if(canvas.width!==pw || canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    const sy=window.scrollY;
    const slot=main.querySelector('.mobile-flight')?.getBoundingClientRect();
    flight=slot&&slot.height ? {x:slot.left+slot.width/2,y:slot.top+sy+slot.height/2,w:slot.width,h:slot.height} : null;
    layout=chapters.map(section=>{
      const box=section.getBoundingClientRect();
      const content=(section.querySelector('.chapter-inner')||section).getBoundingClientRect();
      const onLeft=(content.left+content.right)<width;
      const free=onLeft ? width-content.right : content.left;
      return {top:box.top+sy,bottom:box.bottom+sy,x:onLeft?width-free/2:free/2,free};
    });
    distance=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    marks=[0];
    for(const row of layout){
      const mark=unit((row.top-height*.46)/distance);
      if(mark>marks.at(-1)+.028 && mark<.96) marks.push(mark);
    }
    marks.push(1);
    target=unit(sy/distance);
    schedule();
  }
  function chapterAt(progress){
    let index=0;
    while(index<marks.length-2 && progress>=marks[index+1]) index++;
    return {index,local:unit((progress-marks[index])/(marks[index+1]-marks[index]))};
  }
  function stage(still){
    const sy=window.scrollY;
    if(width<=800){
      const slot=flight||{x:width*.5,y:intro.offsetHeight+80,w:width,h:160};
      const cy=slot.y-sy;
      const rail=still ? (cy<slot.h*.38 ? 1 : 0) : smooth((height*.23+slot.h*.37-cy)/(height*.23+slot.h*.37));
      const railY=height*(still ? .45 : .47+.23*Math.sin(target*tau*2.25-.6));
      return {x:mix(slot.x,width-26,rail),y:mix(cy,railY,rail),w:mix(Math.min(slot.w*.70,slot.h*.82),39,rail),rail};
    }
    const focus=sy+height*.46;
    let x=width*.76,y=height*.44,w=Math.min(width*.35,height*.64,655);
    for(const row of layout){
      const blend=still ? Number(focus>=row.top) : smooth((focus-row.top+height*.19)/(height*.38));
      if(!blend) break;
      const local=unit((focus-row.top)/(row.bottom-row.top||1));
      const crossing=Math.abs(row.x-x)>width*.25 ? Math.sin(Math.PI*blend) : 0;
      x=mix(x,row.x,blend);
      y=mix(y,height*(still ? .46 : .46+.085*Math.sin(local*tau-.32)),blend)-height*.16*crossing;
      w=mix(w,Math.min(row.free*.69,height*.48,515),blend)*(1-.48*crossing);
    }
    return {x,y,w,rail:0};
  }
  function star(x,y,r,color,glow){
    const halo=ctx.createRadialGradient(x,y,0,x,y,r*4);
    halo.addColorStop(0,'rgba('+color+','+glow*.72+')');
    halo.addColorStop(.27,'rgba('+color+','+glow*.29+')');
    halo.addColorStop(1,'rgba('+color+',0)');
    ctx.fillStyle=halo;ctx.fillRect(x-r*4,y-r*4,r*8,r*8);
    ctx.beginPath();ctx.moveTo(x,y-r);
    ctx.quadraticCurveTo(x+r*.13,y-r*.13,x+r*.72,y);
    ctx.quadraticCurveTo(x+r*.13,y+r*.13,x,y+r);
    ctx.quadraticCurveTo(x-r*.13,y+r*.13,x-r*.72,y);
    ctx.quadraticCurveTo(x-r*.13,y-r*.13,x,y-r);
    ctx.fillStyle='rgba(252,248,255,'+glow+')';ctx.fill();
  }
  function atmosphere(w,t,progress){
    // The colored arcs cross behind the sculpture. Only their outer limbs and
    // moving terminals peek out, as in the supplied reference.
    for(let lane=0;lane<2;lane++){
      const rgb=lane?'173,255,207':'217,161,255';
      const rx=w*(lane ? .643 : .644), ry=w*(lane ? .188 : .218);
      const tilt=lane ? .15 : -.40;
      const cy=w*(lane?.131:-.100);
      const head=(lane?-.54:3.05)+(lane?-.19:.21)*t+progress*.66;
      ctx.save();ctx.translate(0,cy);ctx.rotate(tilt);
      ctx.lineCap='round';
      // Fade the orbit toward the tail and concentrate light at its comet.
      for(let i=0;i<30;i++){
        const a=head-tau+(i/30)*tau, b=a+tau/30+.004;
        const light=.20+.46*(i/30)**2;
        ctx.strokeStyle='rgba('+rgb+','+light+')';ctx.lineWidth=Math.max(.72,w*.0017);
        ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,a,b);ctx.stroke();
      }
      ctx.shadowColor='rgb('+rgb+')';ctx.shadowBlur=Math.max(3,w*.012);
      ctx.strokeStyle='rgba('+rgb+',.85)';ctx.lineWidth=Math.max(1,w*.0028);
      ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,head-.27,head);ctx.stroke();
      ctx.shadowBlur=0;
      star(Math.cos(head)*rx, Math.sin(head)*ry, Math.max(2.2,w*.008), rgb,.94);
      ctx.restore();
    }
    stars.forEach(([x,y,r],i)=>{
      const twinkle=.62+.32*Math.sin(t*(.77+(i%3)*.3)+i*1.8);
      const radius=Math.max(.9,w/370*r)*(.78+twinkle*.29);
      star(x*w,y*w,radius,i%4===0?'170,243,207':'215,170,255',twinkle);
    });
  }

  function draw(){
    if(!ready||width<2||height<2)return;
    const still=reduced();
    const progress=still ? target : position;
    const chapter=chapterAt(progress), area=stage(still);
    const t=still ? 0 : clock;
    const ending=1-smooth((progress-.85)/.14);
    const stageRatio=chapter.index/(marks.length-1);
    const fixedOpen=progress>=.97 ? 0 : (chapter.index===0?0:Math.sin(stageRatio*Math.PI)*.37);
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    ctx.save();
    ctx.translate(area.x+(still?0:Math.sin(t*.48)*area.w*.004),area.y+(still?0:Math.sin(t*.65)*area.w*.006));
    if(area.rail<.72)atmosphere(area.w,t,progress);
    const groupTurn=still ? 0 : (.041*Math.sin(t*.68)+cursor.x*.035+cursor.y*.012)*Math.sin(progress*Math.PI)+.061*Math.sin(progress*tau);
    ctx.rotate(groupTurn);
    // Each layer travels out from its own center. A fresh chapter starts with
    // the original alignment, opens, and then brings the four cuts together.
    art.forEach((p,i)=>{
      const beat=unit((chapter.local-i*.037)/(.87-i*.037));
      const chapterOpen=Math.sin(beat*Math.PI)**2*ending;
      let open=still?fixedOpen:chapterOpen;
      if(replay!==null && !still) open=replay.open;
      // The pieces remain separate, including at either end of the journey.
      // Each follows its own breathing cycle even when reading has stopped.
      const breath=still ? 0 : (.5-.5*Math.cos(t*(.83+i*.056)+i*.70));
      const spread=.115+.24*breath+.68*open;
      const idle=still ? 0 : Math.sin(t*.93+i*1.71)*(.006+.009*open);
      const ox=p.cx*(1+spread)+Math.cos(i*1.85+t*.43)*.022*open;
      const oy=p.cy*(1+spread)+idle;
      const turn=p.turn*(.08+.29*breath+open*(1+.26*Math.sin(chapter.index+i)));
      const fit=1-.25*open;
      const dw=p.width*area.w*fit,dh=p.height*area.w*fit;
      ctx.save();
      ctx.translate(area.w*ox*fit,area.w*oy*fit);
      ctx.rotate(turn);
      ctx.drawImage(p.image,-dw/2,-dh/2,dw,dh);
      ctx.restore();
    });
    ctx.restore();
  }
  function schedule(){
    if(!document.hidden && !frame && ready)frame=requestAnimationFrame(tick);
  }
  function tick(now){
    frame=0;if(document.hidden)return;
    const active=!reduced()&&!paused;
    const elapsed=now-(previous||now-41);
    const fast=replay!==null||Math.abs(position-target)>.001;
    if(active&&elapsed<(fast?14:39)){schedule();return;}
    const dt=Math.min(85,elapsed)/1000;
    previous=now;
    if(active){
      clock+=dt;
      position+= (target-position)*(1-Math.exp(-dt*16));
      if(Math.abs(position-target)<.0004)position=target;
      const smoothPointer=1-Math.exp(-dt*7);
      cursor.x=mix(cursor.x,cursor.tx,smoothPointer);cursor.y=mix(cursor.y,cursor.ty,smoothPointer);
      if(replay!==null){
        replay.time+=dt;
        const s=replay.time;
        if(s<1.85) replay.open=mix(replay.from,1,smooth(s/1.85));
        else if(s<2.15) replay.open=1;
        else if(s<5.4) replay.open=1-smooth((s-2.15)/3.25);
        else if(s<6.1) replay.open=0;
        else if(s<7.1) replay.open=smooth((s-6.1))*Math.sin(Math.PI*chapterAt(position).local)**2;
        else replay=null;
      }
    }
    draw();
    if(active)schedule();
  }
  window.addEventListener('cv-progress',e=>{if(Number.isFinite(e.detail)){target=unit(e.detail);schedule();}});
  window.addEventListener('scroll',()=>{target=unit(scrollY/distance);schedule();},{passive:true});
  window.addEventListener('cv-pause',e=>{paused=e.detail===true;previous=0;schedule();});
  window.addEventListener('cv-enable',()=>{enabled=true;previous=0;schedule();});
  window.addEventListener('cv-replay',()=>{
    if(reduced())return;
    replay={time:0,open:0,from:Math.sin(chapterAt(position).local*Math.PI)**2};
    paused=false;previous=0;schedule();
  });
  window.addEventListener('pointermove',e=>{
    if(paused||reduced()||e.pointerType==='touch')return;
    cursor.tx=Math.max(-1, Math.min(1,2*e.clientX/width-1));
    cursor.ty=Math.max(-1, Math.min(1,2*e.clientY/height-1));
  },{passive:true});
  document.addEventListener('pointerleave',()=>{cursor.tx=cursor.ty=0;});
  document.addEventListener('visibilitychange',()=>{if(frame)cancelAnimationFrame(frame);frame=0;previous=0;schedule();});
  preference.addEventListener('change',()=>{enabled=false;replay=null;previous=0;schedule();});
  window.addEventListener('resize',measure,{passive:true});
  if(window.ResizeObserver)new ResizeObserver(measure).observe(main);
  document.fonts?.ready.then(measure);
  measure();
  Promise.all(art.map(p=>new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{p.image=img;resolve();};
    img.onerror=()=>reject(new Error('Falha ao carregar '+p.file));
    img.src=new URL(p.file,artBase).href;
  }))).then(()=>{ready=true;schedule();}).catch(error=>console.error(error));
})();
