(() => {
  const pieces = [...document.querySelectorAll('.piece')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = n => Math.max(0, Math.min(1, n));
  let pending = false;
  const stage = document.querySelector('#stage');
  const phases = ['Em órbita', 'Aproximação', 'Encaixe', 'Montagem final'];

  function render() {
    pending = false;
    const viewport = document.documentElement.clientHeight;
    const distance = document.documentElement.scrollHeight - viewport;
    const progress = distance > 0 ? clamp(window.scrollY / distance) : 1;
    window.dispatchEvent(new CustomEvent('cv-progress', {detail: progress}));
    const phase = Math.min(3, Math.floor(progress * 4));
    stage.textContent = '0' + (phase + 1) + ' / 04 · ' + phases[phase];
    const tops = pieces.map(piece => piece.offsetTop + piece.offsetParent.getBoundingClientRect().top);
    pieces.forEach((piece, i) => {
      const entering = reducedMotion.matches ? 0 : clamp((tops[i] - viewport * .72) / (viewport * .34));
      const direction = i % 2 === 0 ? -1 : 1;
      piece.style.transform = entering
        ? 'perspective(900px) translate3d(' + direction * entering * 15 + 'px,' + entering * 20 + 'px,0) rotateX(' + entering * 13 + 'deg) rotateY(' + direction * entering * 7 + 'deg)'
        : 'none';
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
  const setReplayVisibility = () => { replay.hidden = reducedMotion.matches; };
  setReplayVisibility();
  reducedMotion.addEventListener('change', setReplayVisibility);
  replay.addEventListener('click', () => {
    window.dispatchEvent(new Event('cv-replay'));
  });
  printButton.hidden = false;
  printButton.addEventListener('click', () => window.print());
  schedule();
})();
