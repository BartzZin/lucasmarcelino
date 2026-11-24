(() => {
  const pieces = [...document.querySelectorAll('.piece')];
  const chapters = [...document.querySelectorAll('.story section')];
  const hero = document.querySelector('.intro');
  const archive = document.querySelector('.archive');
  const milestones = [...archive.querySelectorAll('time')];
  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = n => Math.max(0, Math.min(1, n));
  let pending = false;
  let activeMilestone = null;

  function render() {
    pending = false;
    const viewport = document.documentElement.clientHeight;
    const distance = document.documentElement.scrollHeight - viewport;
    const progress = distance > 0 ? clamp(window.scrollY / distance) : 1;
    window.dispatchEvent(new CustomEvent('cv-progress', {detail: progress}));
    const motion = !reducedMotion.matches;
    const bounds = chapters.map(chapter => chapter.getBoundingClientRect());
    const tops = pieces.map(piece => piece.offsetTop + piece.offsetParent.getBoundingClientRect().top);
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
    hero.style.setProperty('--hero-exit', motion ? clamp(scrollY / viewport).toFixed(3) : 0);
    chapters.forEach((chapter, index) => {
      const box = bounds[index];
      const arrival = clamp((viewport - box.top) / (viewport * .49));
      chapter.style.setProperty('--arrive', motion ? arrival.toFixed(3) : 1);
      chapter.style.setProperty('--unread', motion ? (1 - arrival).toFixed(3) : 0);
    });
    pieces.forEach((piece, i) => {
      const entering = motion ? clamp((tops[i] - viewport * .56) / (viewport * .47)) : 0;
      const direction = i % 2 === 0 ? -1 : 1;
      piece.style.setProperty('--offset', entering.toFixed(3));
      piece.style.setProperty('--side', direction);
    });
  }

  function schedule() {
    if (!pending) {
      pending = true;
      requestAnimationFrame(render);
    }
  }
  window.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('resize', schedule);
  reducedMotion.addEventListener('change', schedule);
  const printButton = document.querySelector('#print');
  printButton.hidden = false;
  printButton.addEventListener('click', () => window.print());
  schedule();

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
