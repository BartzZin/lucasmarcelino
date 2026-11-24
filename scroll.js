(() => {
  const pieces = [...document.querySelectorAll('.piece')];
  const chapters = [...document.querySelectorAll('.story section')];
  const hero = document.querySelector('.intro');
  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = n => Math.max(0, Math.min(1, n));
  let pending = false;
  let paused = false;
  // The motion preview opens with the full choreography. The standard URL
  // follows the visitor's system preference.
  let optedIn = new URLSearchParams(location.search).get('movimento') === 'completo';
  if (optedIn) window.dispatchEvent(new Event('cv-enable'));

  function render() {
    pending = false;
    const viewport = document.documentElement.clientHeight;
    const distance = document.documentElement.scrollHeight - viewport;
    const progress = distance > 0 ? clamp(window.scrollY / distance) : 1;
    window.dispatchEvent(new CustomEvent('cv-progress', {detail: progress}));
    const motion = !paused && (!reducedMotion.matches || optedIn);
    const bounds = chapters.map(chapter => chapter.getBoundingClientRect());
    const tops = pieces.map(piece => piece.offsetTop + piece.offsetParent.getBoundingClientRect().top);
    root.style.setProperty('--read', progress.toFixed(4));
    hero.style.setProperty('--hero-exit', motion ? clamp(scrollY / viewport).toFixed(3) : 0);
    chapters.forEach((chapter, index) => {
      const box = bounds[index];
      const arrival = clamp((viewport - box.top) / (viewport * .49));
      const read = clamp((viewport * .75 - box.top) / Math.max(1, box.height));
      chapter.style.setProperty('--arrive', motion ? arrival.toFixed(3) : 1);
      chapter.style.setProperty('--unread', motion ? (1 - arrival).toFixed(3) : 0);
      chapter.style.setProperty('--chapter-read', read.toFixed(3));
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
  const replay = document.querySelector('#replay');
  const pause = document.querySelector('#pause');
  const setReplayVisibility = () => {
    const needsActivation = reducedMotion.matches && !optedIn;
    replay.hidden = false;
    replay.textContent = needsActivation ? '▷ Ativar animação' : '▷ Reproduzir montagem';
    pause.hidden = needsActivation;
    replay.disabled = paused;
  };
  pause.addEventListener('click', () => {
    paused = !paused;
    const label = paused ? 'Retomar animação' : 'Pausar animação';
    pause.textContent = paused ? '▷' : 'Ⅱ';
    pause.setAttribute('aria-label', label);
    pause.title = label;
    window.dispatchEvent(new CustomEvent('cv-pause', {detail:paused}));
    setReplayVisibility();
    schedule();
  });
  setReplayVisibility();
  reducedMotion.addEventListener('change', () => {
    optedIn = false;
    paused = false;
    pause.textContent = 'Ⅱ';
    pause.title = 'Pausar animação';
    pause.setAttribute('aria-label', pause.title);
    window.dispatchEvent(new CustomEvent('cv-pause', {detail:false}));
    setReplayVisibility();
  });
  replay.addEventListener('click', () => {
    if (reducedMotion.matches && !optedIn) {
      optedIn = true;
      window.dispatchEvent(new Event('cv-enable'));
      setReplayVisibility();
    }
    window.dispatchEvent(new Event('cv-replay'));
  });
  printButton.hidden = false;
  printButton.addEventListener('click', () => window.print());
  schedule();
})();
