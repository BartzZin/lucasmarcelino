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
  let width=0,height=0,ratio=1,layout=[],marks=[0,1],flight=null,hero=null,distance=1;
  let target=0,position=0,clock=0,previous=0,frame=0,ready=false;
  let painted=null;
  const cursor={x:0,y:0,tx:0,ty:0};

  function measure(){
    const bounds=canvas.getBoundingClientRect();
    width=bounds.width;height=bounds.height;ratio=Math.min(2,devicePixelRatio||1);
    if (!width || !height) return;
    ratio=Math.min(ratio,Math.sqrt(7_000_000/(width*height)));
    const pw=Math.round(width*ratio), ph=Math.round(height*ratio);
    if(canvas.width!==pw || canvas.height!==ph){canvas.width=pw;canvas.height=ph;painted=null;}
    const sy=window.scrollY;
    const contentBox=main.getBoundingClientRect();
    const introBox=intro.getBoundingClientRect();
    const heroGap=Math.max(0,contentBox.right-introBox.right);
    hero={x:introBox.right+heroGap/2,free:heroGap,top:introBox.top+sy,h:introBox.height};
    const slot=main.querySelector('.mobile-flight')?.getBoundingClientRect();
    flight=slot&&slot.height ? {x:slot.left+slot.width/2,y:slot.top+sy+slot.height/2,w:slot.width,h:slot.height} : null;
    layout=chapters.map(section=>{
      const box=section.getBoundingClientRect();
      const content=(section.querySelector('.chapter-inner')||section).getBoundingClientRect();
      const onLeft=(content.left+content.right)<contentBox.left+contentBox.right;
      const free=onLeft ? contentBox.right-content.right : content.left-contentBox.left;
      return {top:box.top+sy,bottom:box.bottom+sy,x:onLeft?content.right+free/2:contentBox.left+free/2,free};
    });
    distance=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    marks=[0];
    for(const row of layout){
      const mark=unit((row.top-Math.min(height,hero.h/.82)*.46)/distance);
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
  function stage(gentle){
    const sy=window.scrollY;
    if(width<=800){
      const slot=flight||{x:width*.5,y:intro.offsetHeight+80,w:width,h:160};
      const cy=slot.y-sy;
      const rail=smooth((height*.23+slot.h*.37-cy)/(height*.23+slot.h*.37));
      const railY=height*(.47+(gentle ? .055 : .23)*Math.sin(target*tau*2.25-.6));
      return {x:mix(slot.x,width-26,rail),y:mix(cy,railY,rail),w:mix(Math.min(slot.w*.70,slot.h*.82),39,rail),rail};
    }
    const readingHeight=Math.min(height,hero.h/.82);
    const focus=sy+readingHeight*.46;
    let x=hero.x,y=Math.max(readingHeight*.24,hero.top-sy+Math.min(hero.h,readingHeight)*.49);
    let w=Math.min(hero.free*.78,hero.h*.72,readingHeight*.66);
    let opacity=1;
    for(const row of layout){
      const blend=smooth((focus-row.top+readingHeight*.19)/(readingHeight*.38));
      if(!blend) break;
      const local=unit((focus-row.top)/(row.bottom-row.top||1));
      const crossing=Math.abs(row.x-x)>row.free*.6 ? Math.sin(Math.PI*blend) : 0;
      x=mix(x,row.x,blend);
      y=mix(y,readingHeight*(.46+(gentle ? .026 : .085)*Math.sin(local*tau-.32)),blend)-readingHeight*(gentle ? .06 : .16)*crossing;
      w=mix(w,Math.min(row.free*.69,readingHeight*.54),blend)*(1-.48*crossing);
      opacity*=1-.56*crossing;
    }
    return {x,y,w,rail:0,opacity};
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
  function atmosphere(w,t,progress,energy){
    for(let lane=0;lane<2;lane++){
      const rgb=lane?'173,255,207':'217,161,255';
      const rx=w*(lane ? .643 : .644), ry=w*(lane ? .188 : .218);
      const tilt=(lane ? .15 : -.40)+Math.sin(t*.74+lane)*.09;
      const cy=w*(lane?.131:-.100);
      const head=(lane?-.54:3.05)+(lane?-.84:1.04)*t+progress*2.1;
      ctx.save();ctx.translate(0,cy);ctx.rotate(tilt);
      ctx.lineCap='round';
      // Fade the orbit toward the tail and concentrate light at its comet.
      for(let i=0;i<22;i++){
        const a=head-tau+(i/22)*tau, b=a+tau/22+.004;
        const light=.15+.60*(i/22)**2;
        ctx.strokeStyle='rgba('+rgb+','+light+')';ctx.lineWidth=Math.max(.72,w*.0017);
        ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,a,b);ctx.stroke();
      }
      const tail=.50+energy*.24;
      ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,head-tail,head);
      ctx.strokeStyle='rgba('+rgb+',.10)';ctx.lineWidth=Math.max(4,w*.011);ctx.stroke();
      ctx.strokeStyle='rgba('+rgb+',.28)';ctx.lineWidth=Math.max(2.4,w*.0055);ctx.stroke();
      ctx.strokeStyle='rgba('+rgb+',.94)';ctx.lineWidth=Math.max(1.2,w*.0025);ctx.stroke();
      for(let i=0;i<4;i++){
        const a=head-.14*i, shimmer=1-i*.2;
        star(Math.cos(a)*rx,Math.sin(a)*ry,Math.max(1.1,w*.009)*shimmer,rgb,.92*shimmer);
      }
      ctx.restore();
    }
    stars.forEach(([x,y,r],i)=>{
      const twinkle=.55+.38*Math.sin(t*(1.17+(i%3)*.37)+i*1.8);
      const radius=Math.max(.9,w/370*r)*(.78+twinkle*.29);
      const drift=.045*Math.sin(t*.7+i);
      star((x+drift)*w,(y-drift*.62)*w,radius,i%4===0?'170,243,207':'215,170,255',twinkle);
    });
  }

  function draw(){
    if(!ready||width<2||height<2)return;
    const gentle=preference.matches;
    const progress=position;
    const chapter=chapterAt(progress), area=stage(gentle);
    const t=clock;
    const energy=Math.sin(chapter.local*Math.PI)**2;
    const margin=Math.ceil(area.w*1.01+12);
    const x=Math.max(0,Math.floor(area.x-margin)), y=Math.max(0,Math.floor(area.y-margin));
    ctx.setTransform(ratio,0,0,ratio,0,0);
    if(painted)ctx.clearRect(painted.x,painted.y,painted.w,painted.h);
    painted={x,y,w:Math.min(width,Math.ceil(area.x+margin))-x,h:Math.min(height,Math.ceil(area.y+margin))-y};
    ctx.save();
    ctx.beginPath();ctx.rect(painted.x,painted.y,painted.w,painted.h);ctx.clip();
    ctx.globalAlpha=area.opacity??1;
    const drift=gentle ? .62 : 1;
    ctx.translate(area.x+Math.sin(t*.74)*area.w*.015*drift,area.y+Math.sin(t*.87)*area.w*.025*drift);
    if(area.rail<.72)atmosphere(area.w,t,progress,energy);
    const pointerTurn=gentle ? 0 : cursor.x*.035+cursor.y*.012;
    const groupTurn=(.09*Math.sin(t*.84)*drift+pointerTurn)*Math.sin(progress*Math.PI)+.13*Math.sin(progress*tau)*drift;
    ctx.rotate(groupTurn);
    // Each layer travels out from its own center. A fresh chapter starts with
    // the original alignment, opens, and then brings the four cuts together.
    art.forEach((p,i)=>{
      const beat=unit((chapter.local-i*.037)/(.87-i*.037));
      const open=Math.sin(beat*Math.PI)**2*(gentle ? .68 : 1);
      // The pieces remain separate, including at either end of the journey.
      // Each follows its own breathing cycle even when reading has stopped.
      const breath=(.5-.5*Math.cos(t*(1.38+i*.094)+i*.64));
      const spread=.12+(.33*breath+1.03*open)*drift;
      const idle=Math.sin(t*1.47+i*1.71)*(.016+.032*open)*drift;
      const ox=p.cx*(1+spread)+Math.cos(i*1.85+t*.74)*.044*open;
      // The upper socket releases vertically before the left tab turns.
      const oy=p.cy*(1+spread)+idle-(i===0 ? .050 : 0);
      const turn=p.turn*(.08+.74*breath+open*(2.1+.34*Math.sin(chapter.index+i)))*drift;
      const fit=1-.31*open;
      // Insets keep the glossy tabs clear of neighbouring sockets even when
      // the independently rotating silhouettes cross in projection.
      const inset=.92-.09*open;
      const dw=p.width*area.w*fit*inset,dh=p.height*area.w*fit*inset;
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
    const elapsed=now-(previous||now-41);
    const fast=Math.abs(position-target)>.001;
    if(elapsed<(fast?14:21)){schedule();return;}
    const dt=Math.min(85,elapsed)/1000;
    previous=now;
    clock+=dt*(preference.matches ? .78 : 1);
    position+=(target-position)*(1-Math.exp(-dt*9));
    if(Math.abs(position-target)<.0004)position=target;
    const smoothPointer=1-Math.exp(-dt*7);
    cursor.x=mix(cursor.x,cursor.tx,smoothPointer);cursor.y=mix(cursor.y,cursor.ty,smoothPointer);
    draw();
    schedule();
  }
  window.addEventListener('cv-progress',e=>{if(Number.isFinite(e.detail)){target=unit(e.detail);schedule();}});
  window.addEventListener('scroll',()=>{target=unit(scrollY/distance);schedule();},{passive:true});
  window.addEventListener('pointermove',e=>{
    if(preference.matches||e.pointerType==='touch')return;
    cursor.tx=Math.max(-1, Math.min(1,2*e.clientX/width-1));
    cursor.ty=Math.max(-1, Math.min(1,2*e.clientY/height-1));
  },{passive:true});
  document.addEventListener('pointerleave',()=>{cursor.tx=cursor.ty=0;});
  document.addEventListener('visibilitychange',()=>{if(frame)cancelAnimationFrame(frame);frame=0;previous=0;schedule();});
  preference.addEventListener('change',()=>{previous=0;schedule();});
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
