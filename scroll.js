(() => {
  const chapters = [...document.querySelectorAll('.story section')];
  const archive = document.querySelector('.archive');
  const milestones = [...archive.querySelectorAll('time')];
  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const sideMotion = matchMedia('(width > 800px)');
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = n => { const t=clamp(n); return t*t*(3-2*t); };
  const textItems = Array.from(document.querySelectorAll(
    '.intro h1, .intro p, .intro .actions, .chapter-inner h2, .story .piece, .section-note, #contato .whatsapp, #contato .phone, #contato .links'
  ), node => ({node,shift:0,opacity:1}));
  let pending = false;
  let activeMilestone = null;
  let textLayoutDirty = true;

  function measureText(viewport, scroll){
    const travel = sideMotion.matches
      ? Math.min(84,root.clientWidth*.043)
      : Math.max(12,Math.min(26,viewport*.031));
    const intervals = [];
    for(const item of textItems){
      const rect=item.node.getBoundingClientRect();
      const transform=getComputedStyle(item.node).transform;
      const shifted=transform==='none' ? 0 : new DOMMatrixReadOnly(transform).m42;
      const top=rect.top+scroll-shifted;
      const bottom=rect.bottom+scroll-shifted;
      item.travel=travel;
      item.enter=item.node.closest('.intro') && top<viewport
        ? null
        : {start:top-viewport*.99,end:top-viewport*.75,order:1};
      item.exit={start:bottom-viewport*.23,end:bottom-viewport*.025,order:0};
      if(item.enter) intervals.push(item.enter);
      intervals.push(item.exit);
    }
    for(const interval of intervals) interval.center=(interval.start+interval.end)/2;
    intervals.sort((a,b)=>a.center-b.center || a.order-b.order);
    // Adjacent windows meet at their midpoint, so only one text block moves
    // at a given scroll position even when both viewport edges contain text.
    for(let i=0;i<intervals.length;i++){
      const here=intervals[i], before=intervals[i-1], after=intervals[i+1];
      if(before) here.start=Math.max(here.start,(before.center+here.center)/2);
      if(after) here.end=Math.min(here.end,(here.center+after.center)/2);
    }
    textLayoutDirty=false;
  }

  function moveText(scroll, motion){
    const phase=({start,end})=>end>start ? smooth((scroll-start)/(end-start)) : Number(scroll>=end);
    for(const item of textItems){
      const inProgress=motion && item.enter ? phase(item.enter) : 1;
      const outProgress=motion ? phase(item.exit) : 0;
      const direction=sideMotion.matches ? 1 : -1;
      const shift=Math.round((1-inProgress+direction*outProgress)*item.travel*100)/100;
      const opacity=Math.round((1-(1-inProgress)*.66-outProgress*.64)*1000)/1000;
      if(shift===item.shift && opacity===item.opacity) continue;
      item.shift=shift;
      item.opacity=opacity;
      item.node.style.setProperty('--text-shift',shift+'px');
      item.node.style.setProperty('--text-opacity',opacity);
      item.node.toggleAttribute('data-scroll-text',shift!==0 || opacity!==1);
    }
  }

  function render() {
    pending = false;
    const viewport = document.documentElement.clientHeight;
    const distance = document.documentElement.scrollHeight - viewport;
    const scroll=window.scrollY;
    const progress = distance > 0 ? clamp(scroll / distance) : 1;
    const motion = !reducedMotion.matches;
    if(textLayoutDirty) measureText(viewport,scroll);
    moveText(scroll,motion);
    const bounds = chapters.map(chapter => chapter.getBoundingClientRect());
    const archiveBox = archive.getBoundingClientRect();
    const readingLine = viewport * .64;
    let marker = null;
    if (archiveBox.top <= readingLine && archiveBox.bottom > 0) {
      for (const date of milestones) {
        if (date.getBoundingClientRect().top > readingLine) break;
        marker = date;
      }
    }
    if (marker !== activeMilestone) {
      activeMilestone?.parentElement.removeAttribute('aria-current');
      marker?.parentElement.setAttribute('aria-current', 'step');
      activeMilestone = marker;
    }
    archive.style.setProperty('--timeline-read', clamp((readingLine - archiveBox.top) / archiveBox.height).toFixed(4));
    root.style.setProperty('--read', progress.toFixed(4));
    chapters.forEach((chapter, index) => {
      const box = bounds[index];
      const arrival = clamp((viewport - box.top) / (viewport * .49));
      chapter.style.setProperty('--unread', motion ? (1 - arrival).toFixed(3) : 0);
    });
    window.dispatchEvent(new CustomEvent('cv-progress', {detail: progress}));
  }

  function schedule() {
    if (!pending) {
      pending = true;
      requestAnimationFrame(render);
    }
  }
  function relayout(){
    textLayoutDirty=true;
    schedule();
  }
  window.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('resize', relayout);
  reducedMotion.addEventListener('change', relayout);
  if(window.ResizeObserver) new ResizeObserver(relayout).observe(document.querySelector('main'));
  document.fonts?.ready.then(relayout);
  const printButton = document.querySelector('#print');
  printButton.hidden = false;
  printButton.addEventListener('click', () => window.print());
  schedule();

  if(window.IntersectionObserver){
    const flowObserver=new IntersectionObserver(entries=>{
      for(const entry of entries) entry.target.toggleAttribute('data-flow-active',entry.isIntersecting);
    });
    document.querySelectorAll('.water-text').forEach(node=>flowObserver.observe(node));
  }

  const halo = document.querySelector('#cursor-glow');
  const canHover = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  let haloFrame = 0;
  let x = 0, y = 0, targetX = 0, targetY = 0;

  function moveHalo() {
    haloFrame = 0;
    const arrived = reducedMotion.matches || Math.hypot(targetX - x, targetY - y) < 0.65;
    x = arrived ? targetX : x + (targetX - x) * .36;
    y = arrived ? targetY : y + (targetY - y) * .36;
    halo.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
    if (!arrived) haloFrame = requestAnimationFrame(moveHalo);
  }

  function hideHalo() {
    halo.removeAttribute('data-visible');
    cancelAnimationFrame(haloFrame);
    haloFrame = 0;
  }

  window.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || !canHover.matches) {
      hideHalo();
      return;
    }
    targetX = event.clientX;
    targetY = event.clientY;
    if (!halo.hasAttribute('data-visible')) {
      x = targetX;
      y = targetY;
      moveHalo();
      halo.setAttribute('data-visible', '');
    } else if (!haloFrame) {
      haloFrame = requestAnimationFrame(moveHalo);
    }
  }, {passive: true});
  document.documentElement.addEventListener('pointerleave', hideHalo);
  window.addEventListener('blur', hideHalo);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideHalo();
  });
})();
