(() => {
  'use strict';

  const canvas = document.querySelector('#puzzle');
  const ctx = canvas?.getContext('2d');
  const main = document.querySelector('#principal');
  if (!ctx || !main) return;
  const intro = main.querySelector('.intro');
  const chapters = [...main.querySelectorAll('.story section')];
  const textBlocks = [...document.querySelectorAll(
    'header, .intro h1, .intro p, .intro .actions, .chapter-inner, .story h2, .story .piece, footer'
  )];
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
  const queue = art.slice().sort((a,b)=>a.cx-b.cx);
  queue.forEach((piece,index)=>{piece.lane=index-1.5;});

  const stars = [
    [-.52,-.26,4.1],[-.42,-.31,1.5],[-.35,-.43,2.4],[-.31,-.46,1.1],[-.17,-.53,1.5],
    [.40,-.37,1.5],[.55,-.24,2.3],[.61,-.09,1.4],[.54,.31,3.8],[.45,.37,1.2],
    [.37,.41,1.8],[.22,.46,1.1],[-.23,.47,3.0],[-.38,.39,1.1],[-.49,.25,1.6]
  ];
  let width=0,height=0,ratio=1,layout=[],marks=[0,1],flight=null,hero=null,distance=1;
  let target=0,position=0,clock=0,previous=0,frame=0,ready=false;
  let painted=null;
  let paintedScroll=-Infinity;
  let settled=null, transfer=null, arrival=-Infinity;
  let protectedRects=null, protectedScroll=-Infinity;
  const cursor={x:0,y:0,tx:0,ty:0};

  function measure(){
    const bounds=canvas.getBoundingClientRect();
    width=bounds.width;height=bounds.height;ratio=Math.min(2,devicePixelRatio||1);
    if (!width || !height) return;
    settled=null;
    transfer=null;
    arrival=-Infinity;
    protectedRects=null;
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
      return {
        top:box.top+sy,bottom:box.bottom+sy,
        contentTop:content.top+sy,contentBottom:content.bottom+sy,
        x:onLeft?content.right+free/2:contentBox.left+free/2,free,
        side:onLeft?1:-1
      };
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
      const rail=smooth(sy/Math.max(60,slot.y-height*.32));
      const railY=height*(.47+(gentle ? .055 : .23)*Math.sin(target*tau*2.25-.6));
      const lift=rail===1 ? smooth((height*.32-cy)/(height*.22)) : 0;
      return {x:mix(slot.x,width-21,rail),y:mix(cy,railY,lift),w:mix(Math.min(slot.w*.70,slot.h*.73),32,rail),rail};
    }
    const readingHeight=Math.min(height,hero.h/.82);
    const focus=sy+readingHeight*.46;
    const index=layout.findLastIndex(row=>focus>=row.top);
    if(index<0){
      const w=Math.min(hero.free*.73,hero.h*.68,readingHeight*.66);
      const docY=hero.top+hero.h*.49;
      return {x:hero.x,y:docY-sy,docY,w,rail:0,side:1,index};
    }
    const row=layout[index];
    const heightAvailable=row.bottom-row.top;
    const w=Math.min(row.free*.65,readingHeight*.53,heightAvailable*.61);
    const local=unit((focus-row.top)/heightAvailable);
    const desired=focus+readingHeight*(gentle ? .026 : .073)*Math.sin(local*tau-.32);
    const docY=Math.max(row.top+w*.67,Math.min(row.bottom-w*.67,desired));
    return {x:row.x,y:docY-sy,docY,w,rail:0,side:row.side,index};
  }

  function travelingStage(destination,time){
    if(destination.side===undefined) return destination;
    settled??=destination;
    if(Math.abs(settled.index-destination.index)>1 ||
      (transfer && destination.index!==transfer.from.index && destination.index!==transfer.to.index)){
      transfer=null;
      settled=destination;
      arrival=time;
    }
    if(!transfer && settled.side!==destination.side){
      const border=Math.max(settled.index,destination.index);
      const before=layout[border-1], after=layout[border];
      const start=before?.contentBottom ?? hero.top+hero.h;
      const lane=(start+after.contentTop)/2;
      const laneWidth=Math.min(settled.w,destination.w,Math.max(1,(after.contentTop-start)*2.5));
      transfer={start:time,from:settled,to:destination,lane,laneWidth};
    }
    if(!transfer){
      const docY=mix(settled.docY,destination.docY,.22);
      settled={...destination,
        x:mix(settled.x,destination.x,.22),
        w:mix(settled.w,destination.w,.22),
        docY,y:docY-window.scrollY
      };
      return settled;
    }
    const {from,to,start,lane,laneWidth}=transfer;
    const phase=unit((time-start)/1.08);
    const depart=smooth(phase/.18);
    const travel=smooth((phase-.18)/.44);
    const dock=smooth((phase-.62)/.38);
    const formation=depart*(1-dock);
    if(phase===1){
      settled=destination.side===to.side ? destination : to;
      transfer=null;
      arrival=time;
    }
    const landing=destination.side===to.side ? destination : to;
    const docY=mix(mix(from.docY,lane,depart),landing.docY,dock);
    return {
      x:mix(from.x,landing.x,travel),
      y:docY-window.scrollY,
      w:mix(mix(from.w,laneWidth,depart),landing.w,dock),
      rail:0,
      formation,
      direction:Math.sign(to.x-from.x)
    };
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

  function protectText(){
    if(!protectedRects || protectedScroll!==window.scrollY){
      protectedScroll=window.scrollY;
      protectedRects=textBlocks.map(node=>node.getBoundingClientRect())
        .filter(box=>box.width>0 && box.height>0 && box.bottom>-8 && box.top<height+8);
    }
    // Intersect the existing clip with the area outside each content block.
    // Separate clips also cover overlapping text and transformed project rows.
    for(const box of protectedRects){
      const inset=8;
      if(box.right+inset<=painted.x || box.left-inset>=painted.x+painted.w ||
        box.bottom+inset<=painted.y || box.top-inset>=painted.y+painted.h) continue;
      ctx.beginPath();
      ctx.rect(-20,-20,width+40,height+40);
      ctx.rect(Math.floor(box.left-inset),Math.floor(box.top-inset),
        Math.ceil(box.width+2*inset+1),Math.ceil(box.height+2*inset+1));
      ctx.clip('evenodd');
    }
  }

  function wake(x,y,size,strength,direction,index){
    const color=index%2===0 ? '217,161,255' : '173,255,207';
    const tail=direction*size*.40;
    const light=ctx.createLinearGradient(x-tail,y,x,y);
    light.addColorStop(0,'rgba('+color+',0)');
    light.addColorStop(.74,'rgba('+color+','+strength*.38+')');
    light.addColorStop(1,'rgba('+color+','+strength*.84+')');
    ctx.strokeStyle=light;
    ctx.lineWidth=Math.max(1,size*.006);
    for(let band=0;band<2;band++){
      const vertical=(band-.5)*size*.023;
      ctx.beginPath();
      ctx.moveTo(x-tail,y+vertical+size*.043);
      ctx.quadraticCurveTo(x-tail*.44,y+vertical-size*.032,x,y+vertical);
      ctx.stroke();
    }
    star(x-tail*.63,y+size*.013,Math.max(1,size*.006),color,strength*.72);
  }

  function arrivalGlow(size,elapsed){
    const phase=unit(elapsed/.64);
    const glow=(1-phase)**2;
    ctx.save();
    ctx.rotate(-.24);
    for(let ring=0;ring<2;ring++){
      const radius=size*(.19+.35*smooth(phase)+ring*.074);
      ctx.beginPath();
      ctx.ellipse(0,0,radius,radius*.48,0,0,tau);
      ctx.strokeStyle=ring ? 'rgba(173,255,207,'+glow*.60+')' : 'rgba(217,161,255,'+glow*.82+')';
      ctx.lineWidth=Math.max(1,size*.008*glow);
      ctx.stroke();
    }
    for(let i=0;i<8;i++){
      const angle=i*tau/8+.4;
      const radius=size*(.16+.44*smooth(phase));
      star(Math.cos(angle)*radius,Math.sin(angle)*radius*.58,Math.max(1.2,size*.009),i%2?'173,255,207':'217,161,255',glow);
    }
    ctx.restore();
  }

  function clearPainting(){
    if(!painted) return;
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(painted.x,painted.y,painted.w,painted.h);
    painted=null;
  }

  function draw(){
    if(!ready||width<2||height<2)return;
    const gentle=preference.matches;
    const progress=position;
    const t=clock;
    const chapter=chapterAt(progress), area=travelingStage(stage(gentle),t);
    const formation=area.formation??0;
    const landed=t-arrival;
    const orbiting=(1-smooth(formation*4))*smooth(landed/.80);
    const energy=Math.sin(chapter.local*Math.PI)**2;
    const margin=Math.ceil(area.w*1.01+12);
    const x=Math.max(0,Math.floor(area.x-margin)), y=Math.max(0,Math.floor(area.y-margin));
    const right=Math.min(width,Math.ceil(area.x+margin)), bottom=Math.min(height,Math.ceil(area.y+margin));
    clearPainting();
    paintedScroll=window.scrollY;
    if(right<=x || bottom<=y) return;
    ctx.setTransform(ratio,0,0,ratio,0,0);
    painted={x,y,w:right-x,h:bottom-y};
    ctx.save();
    ctx.beginPath();ctx.rect(painted.x,painted.y,painted.w,painted.h);ctx.clip();
    protectText();
    const drift=gentle ? .62 : 1;
    ctx.translate(area.x+Math.sin(t*.74)*area.w*.015*drift,area.y+Math.sin(t*.87)*area.w*.025*drift);
    if(area.rail<.72 && formation<.98){
      ctx.globalAlpha=1-formation*.84;
      atmosphere(area.w,t,progress,energy);
      ctx.globalAlpha=1;
    }
    if(landed<.64)arrivalGlow(area.w,landed);
    const pointerTurn=gentle ? 0 : cursor.x*.035+cursor.y*.012;
    const groupTurn=(.09*Math.sin(t*.84)*drift+pointerTurn)*Math.sin(progress*Math.PI)+.13*Math.sin(progress*tau)*drift;
    ctx.rotate(groupTurn*(1-formation));
    // Each layer travels out from its own center. A fresh chapter starts with
    // the original alignment, opens, and then brings the four cuts together.
    const poses=art.map((p,i)=>{
      const beat=unit((chapter.local-i*.037)/(.87-i*.037));
      const open=Math.sin(beat*Math.PI)**2*(gentle ? .68 : 1)*orbiting;
      // The pieces remain separate, including at either end of the journey.
      // Each follows its own breathing cycle even when reading has stopped.
      const breath=(.5-.5*Math.cos(t*(1.38+i*.094)+i*.64));
      const spread=.12+(.33*breath+1.03*open)*drift*mix(.36,1,orbiting);
      const idle=Math.sin(t*1.47+i*1.71)*(.016+.032*open)*drift;
      const ox=p.cx*(1+spread)+Math.cos(i*1.85+t*.74)*.044*open;
      // The upper socket releases vertically before the left tab turns.
      const oy=p.cy*(1+spread)+idle-(i===0 ? .050 : 0);
      const turn=p.turn*(.08+.74*breath+open*(2.1+.34*Math.sin(chapter.index+i)))*drift;
      const fit=1-.31*open;
      // Insets keep the glossy tabs clear of neighbouring sockets even when
      // the independently rotating silhouettes cross in projection.
      const inset=.92-.09*open;
      const scale=area.w*mix(fit*inset,.41,formation);
      const bob=Math.sin(t*6-p.lane*1.6);
      return {
        image:p.image,
        x:area.w*mix(ox*fit,p.lane*.27,formation),
        y:area.w*mix(oy*fit,bob*.018,formation),
        turn:mix(turn,(area.direction??0)*(.22+bob*.12),formation),
        w:p.width*scale,h:p.height*scale
      };
    });
    if(formation>.01){
      poses.forEach((p,i)=>wake(p.x,p.y,area.w,formation,area.direction,i));
    }
    for(const p of poses){
      ctx.save();
      ctx.translate(p.x,p.y);
      ctx.rotate(p.turn);
      ctx.drawImage(p.image,-p.w/2,-p.h/2,p.w,p.h);
      ctx.restore();
    }
    ctx.restore();
  }
  function schedule(){
    if(!document.hidden && !frame && ready)frame=requestAnimationFrame(tick);
  }
  function tick(now){
    frame=0;if(document.hidden)return;
    const elapsed=now-(previous||now-41);
    const fast=Math.abs(position-target)>.001;
    if(paintedScroll===window.scrollY && elapsed<(fast?14:21)){schedule();return;}
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
  window.addEventListener('cv-progress',e=>{
    protectedRects=null;
    if(Number.isFinite(e.detail)){target=unit(e.detail);schedule();}
  });
  window.addEventListener('scroll',()=>{
    // Browser scrolling can expose a different text column between paints.
    if(paintedScroll!==window.scrollY) clearPainting();
    target=unit(scrollY/distance);
    schedule();
  },{passive:true});
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
