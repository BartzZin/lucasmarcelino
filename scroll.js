(() => {
  'use strict';

  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const desktopQuery = matchMedia('(min-width: 801px)');
  const canHover = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
  const smoothstep = (n) => { const t = clamp(n); return t * t * (3 - 2 * t); };

  // DOM references (null-guarded)
  const chapterNodes = [...document.querySelectorAll('.story section')];
  const archiveEl = document.querySelector('.archive');
  const milestoneNodes = archiveEl ? [...archiveEl.querySelectorAll('time')] : [];
  const navLinks = [...document.querySelectorAll('header.bar nav a[href^="#"]')];
  const trajetoriaEl = document.getElementById('trajetoria');
  const contatoEl = document.getElementById('contato');
  const contatoPanelEl = contatoEl?.querySelector('.contact-panel') || contatoEl;

  const hudEl = document.getElementById('cinema-hud');
  const hudChapterEl = hudEl?.querySelector('[data-cinema-chapter]') || null;
  const hudFillEl = hudEl?.querySelector('[data-cinema-fill]') || null;
  const hudToggleEl = hudEl?.querySelector('[data-cinema-toggle]') || null;
  const hudToggleLabelEl = hudEl?.querySelector('[data-cinema-toggle-label]') || null;
  const hudSpeedEl = hudEl?.querySelector('[data-cinema-speed]') || null;
  const hudExitEl = hudEl?.querySelector('[data-cinema-exit]') || null;

  const textSelector = '.intro .eyebrow,.intro h1,.intro p,.intro .actions,.chapter-inner h2,.story .piece,.section-note,#contato .whatsapp,#contato .phone-row,#contato .contact-phone,#contato .phone,#contato .links';
  const rawTextNodes = [...document.querySelectorAll(textSelector)];
  const textNodeSet = new Set(rawTextNodes);
  const textItems = rawTextNodes
    .filter((node) => {
      for (let p = node.parentElement; p; p = p.parentElement) {
        if (textNodeSet.has(p)) return false;
      }
      return true;
    })
    .map((node) => ({
      node, inIntro: Boolean(node.closest('.intro')),
      top: 0, bottom: 0, height: 0, travel: 16,
      enterStart: 0, enterEnd: 0, hasEnter: true,
      exitStart: 0, exitEnd: 0, shift: 0, opacity: 1, active: false
    }));

  // Cached document-space geometry (zero getBoundingClientRect during scroll/rAF)
  let viewportW = root.clientWidth || window.innerWidth;
  let viewportH = root.clientHeight || window.innerHeight;
  let docHeight = root.scrollHeight;
  let maxScroll = Math.max(0, docHeight - viewportH);
  let layoutDirty = true;
  let trajetoriaTop = 0;
  let cinemaTargetY = 0;

  const chapters = chapterNodes.map((node) => {
    const heading = node.querySelector('h2');
    const fallback = heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '';
    return {
      node, id: node.id || '', heading,
      label: node.getAttribute('data-chapter-label') || fallback || node.id || '',
      top: 0, bottom: 0, height: 0, center: 0, headingTop: 0, headingCenter: 0, lastUnread: ''
    };
  });

  const archiveGeo = { top: 0, bottom: 0, height: 1, lastRead: '' };
  const milestones = milestoneNodes.map((node) => ({
    node, item: node.closest('li') || node.parentElement, top: 0
  }));
  const navMap = navLinks.map((link) => ({ link, id: (link.getAttribute('href') || '').slice(1) }));

  function getVerticalShift(node) {
    const t = getComputedStyle(node).transform;
    if (!t || t === 'none') return 0;
    try { return new DOMMatrixReadOnly(t).m42 || 0; } catch { return 0; }
  }

  function measureLayout() {
    const scrollY = window.scrollY;
    viewportW = root.clientWidth || window.innerWidth;
    viewportH = root.clientHeight || window.innerHeight;
    docHeight = root.scrollHeight;
    maxScroll = Math.max(0, docHeight - viewportH);

    // Subtle, clip-safe travel distance
    const travel = desktopQuery.matches
      ? Math.min(18, Math.max(10, viewportW * 0.011))
      : Math.min(18, Math.max(10, viewportH * 0.02));

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const r = ch.node.getBoundingClientRect();
      ch.top = r.top + scrollY;
      ch.bottom = r.bottom + scrollY;
      ch.height = r.height;
      ch.center = (ch.top + ch.bottom) * 0.5;
      if (ch.heading) {
        const hr = ch.heading.getBoundingClientRect();
        const hs = ch.heading.hasAttribute('data-scroll-text') ? getVerticalShift(ch.heading) : 0;
        ch.headingTop = hr.top + scrollY - hs;
        ch.headingCenter = ch.headingTop + hr.height * 0.5;
      } else {
        ch.headingTop = ch.top;
        ch.headingCenter = ch.top + Math.min(60, ch.height * 0.2);
      }
    }

    if (archiveEl) {
      const ar = archiveEl.getBoundingClientRect();
      archiveGeo.top = ar.top + scrollY;
      archiveGeo.bottom = ar.bottom + scrollY;
      archiveGeo.height = Math.max(1, ar.height);
      for (let i = 0; i < milestones.length; i++) {
        milestones[i].top = milestones[i].node.getBoundingClientRect().top + scrollY;
      }
    }

    for (let i = 0; i < textItems.length; i++) {
      const item = textItems[i];
      const r = item.node.getBoundingClientRect();
      const sy = item.active ? getVerticalShift(item.node) : 0;
      item.top = r.top + scrollY - sy;
      item.bottom = r.bottom + scrollY - sy;
      item.height = r.height;
      item.travel = travel;
      item.hasEnter = !(item.inIntro && item.top < viewportH);
      item.enterStart = item.top - viewportH * 0.98;
      item.enterEnd = item.top - viewportH * 0.80;
      item.exitStart = item.bottom - viewportH * 0.14;
      item.exitEnd = item.bottom - viewportH * 0.01;
    }

    trajetoriaTop = trajetoriaEl ? Math.max(0, trajetoriaEl.getBoundingClientRect().top + scrollY - 72) : 0;

    if (contatoPanelEl) {
      const cr = contatoPanelEl.getBoundingClientRect();
      const center = cr.top + scrollY + cr.height * 0.5;
      cinemaTargetY = clamp(center - viewportH * 0.5, 0, maxScroll);
      if (maxScroll - cinemaTargetY < 48) cinemaTargetY = maxScroll;
    } else {
      cinemaTargetY = maxScroll;
    }

    layoutDirty = false;
  }

  // Scroll & Cinema state
  let rafId = 0;
  let lastRenderTime = 0;
  let prevScrollY = window.scrollY;
  let smoothedVelocity = 0;
  let lastProgress = '';
  let lastScrolledFlag = null;
  let lastVelocityStr = '';
  let activeChapter = null;
  let activeChapterId = 'inicio';
  let activeChapterLabel = 'Início';
  let activeMilestoneItem = null;

  const SPEED_CYCLE = [1, 1.5, 0.7];
  let speedIndex = 0;
  let cinemaSpeed = SPEED_CYCLE[0];
  let cinemaState = 'idle'; // 'idle' | 'playing' | 'paused' | 'finished'
  let virtualY = window.scrollY;
  let cinemaElapsed = 0;
  let lastCinemaTime = 0;
  let currentCinemaPxPerSec = 0;
  let hudHideTimer = 0;
  let lastHudChapter = '';
  let lastHudFill = '';

  const formatSpeed = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) + '\u00D7';

  function dispatchCinemaEvent() {
    const progress = maxScroll > 0 ? clamp(window.scrollY / maxScroll) : 1;
    window.dispatchEvent(new CustomEvent('curriculo:cinema', {
      detail: { state: cinemaState, speed: cinemaSpeed, progress, chapterId: activeChapterId, chapterLabel: activeChapterLabel }
    }));
  }

  function syncHud(progress) {
    if (!hudEl) return;

    if (cinemaState !== 'idle') {
      if (hudHideTimer) { clearTimeout(hudHideTimer); hudHideTimer = 0; }
      if (hudEl.hidden) {
        hudEl.hidden = false;
        requestAnimationFrame(() => {
          if (cinemaState !== 'idle') hudEl.setAttribute('data-visible', 'true');
        });
      } else if (hudEl.getAttribute('data-visible') !== 'true') {
        hudEl.setAttribute('data-visible', 'true');
      }
    } else if (!hudEl.hidden || hudEl.hasAttribute('data-visible')) {
      hudEl.removeAttribute('data-visible');
      if (reducedMotion.matches) {
        hudEl.hidden = true;
      } else if (!hudHideTimer) {
        hudHideTimer = window.setTimeout(() => {
          hudHideTimer = 0;
          if (cinemaState === 'idle') hudEl.hidden = true;
        }, 260);
      }
    }

    hudEl.setAttribute('data-state', cinemaState);

    if (hudChapterEl && activeChapterLabel !== lastHudChapter) {
      hudChapterEl.textContent = activeChapterLabel;
      lastHudChapter = activeChapterLabel;
    }

    if (hudFillEl) {
      const fillVal = (cinemaState === 'finished' ? 1 : clamp(progress)).toFixed(4);
      if (fillVal !== lastHudFill) {
        hudFillEl.style.transform = 'scaleX(' + fillVal + ')';
        lastHudFill = fillVal;
      }
    }

    if (hudToggleEl) {
      const playing = cinemaState === 'playing';
      const finished = cinemaState === 'finished';
      hudToggleEl.setAttribute('aria-pressed', playing ? 'true' : 'false');
      hudToggleEl.setAttribute('data-state', cinemaState);
      const label = playing ? 'Pausar' : (finished ? 'Rever' : 'Continuar');
      hudToggleEl.setAttribute('aria-label', playing ? 'Pausar apresentação' : (finished ? 'Rever apresentação do início' : 'Continuar apresentação'));
      if (hudToggleLabelEl && hudToggleLabelEl.textContent !== label) hudToggleLabelEl.textContent = label;
    }

    if (hudSpeedEl) {
      const text = formatSpeed(cinemaSpeed);
      if (hudSpeedEl.textContent !== text) hudSpeedEl.textContent = text;
      hudSpeedEl.setAttribute('aria-label', 'Velocidade ' + text + '. Alterar velocidade');
    }
  }

  function setCinemaState(nextState) {
    if (cinemaState === nextState) return;
    cinemaState = nextState;
    root.setAttribute('data-cinema', cinemaState);
    root.style.setProperty('--cinema-active', (cinemaState === 'playing' || cinemaState === 'paused') ? '1' : '0');
    syncHud(maxScroll > 0 ? clamp(window.scrollY / maxScroll) : 1);
    dispatchCinemaEvent();
  }

  function startCinema(options) {
    if (reducedMotion.matches) {
      if (layoutDirty) measureLayout();
      if (trajetoriaEl) trajetoriaEl.scrollIntoView({ behavior: 'auto', block: 'start' });
      else window.scrollTo({ top: trajetoriaTop, behavior: 'auto' });
      return;
    }

    if (layoutDirty) measureLayout();

    const forceTop = Boolean(options && options.fromTop);
    const currentY = window.scrollY;
    const progress = maxScroll > 0 ? clamp(currentY / maxScroll) : 1;
    const nearEnd = forceTop || progress > 0.92 || cinemaState === 'finished' || currentY >= cinemaTargetY - 40;

    root.setAttribute('data-cinema', 'playing');
    root.style.setProperty('--cinema-active', '1');

    if (nearEnd) {
      virtualY = 0;
      prevScrollY = 0;
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      virtualY = currentY;
      prevScrollY = currentY;
    }

    cinemaElapsed = 0;
    lastCinemaTime = 0;
    currentCinemaPxPerSec = 0;
    updateChaptersAndNav(virtualY, true);

    if (cinemaState === 'playing') {
      syncHud(maxScroll > 0 ? clamp(virtualY / maxScroll) : 0);
      dispatchCinemaEvent();
    } else {
      setCinemaState('playing');
    }
    scheduleFrame();
  }

  function pauseCinema() {
    if (cinemaState !== 'playing') return;
    currentCinemaPxPerSec = 0;
    lastCinemaTime = 0;
    setCinemaState('paused');
    scheduleFrame();
  }

  function resumeCinema() {
    if (cinemaState !== 'paused') return;
    if (reducedMotion.matches) { exitCinema(); return; }
    if (layoutDirty) measureLayout();
    virtualY = window.scrollY;
    cinemaElapsed = 0;
    lastCinemaTime = 0;
    setCinemaState('playing');
    scheduleFrame();
  }

  function finishCinema() {
    currentCinemaPxPerSec = 0;
    lastCinemaTime = 0;
    setCinemaState('finished');
    scheduleFrame();
  }

  function exitCinema() {
    if (cinemaState === 'idle') return;
    currentCinemaPxPerSec = 0;
    lastCinemaTime = 0;
    setCinemaState('idle');
    scheduleFrame();
  }

  function cycleCinemaSpeed() {
    speedIndex = (speedIndex + 1) % SPEED_CYCLE.length;
    cinemaSpeed = SPEED_CYCLE[speedIndex];
    syncHud(maxScroll > 0 ? clamp(window.scrollY / maxScroll) : 1);
    dispatchCinemaEvent();
  }

  function stepCinema(now) {
    if (cinemaState !== 'playing') return;
    if (reducedMotion.matches) { exitCinema(); return; }
    if (layoutDirty) measureLayout();

    // Respectful takeover if user drags native scrollbar
    if (cinemaElapsed > 0.25 && Math.abs(window.scrollY - virtualY) > 64) {
      exitCinema();
      return;
    }

    const dt = lastCinemaTime > 0 ? Math.min(0.05, Math.max(0.001, (now - lastCinemaTime) / 1000)) : 0.016;
    lastCinemaTime = now;
    cinemaElapsed += dt;

    const remaining = cinemaTargetY - virtualY;
    if (remaining <= 1.5) {
      virtualY = cinemaTargetY;
      window.scrollTo({ top: cinemaTargetY, behavior: 'instant' });
      finishCinema();
      return;
    }

    // 1.15s silky ease-in dolly ramp
    const rampFactor = 0.06 + 0.94 * smoothstep(cinemaElapsed / 1.15);
    const baseSpeed = desktopQuery.matches ? 92 : 72;

    // Smooth ease-out landing on #contato (bypass chapterDamp inside decelZone & on #contato)
    const decelZone = Math.min(210, viewportH * 0.26);
    const inDecel = remaining < decelZone;
    const endFactor = inDecel
      ? 0.26 + 0.74 * Math.sin((remaining / decelZone) * Math.PI * 0.5)
      : 1;

    // Editorial breathing (~0.62x) as chapters 01-04 h2 glide through upper-middle sweet spot
    let chapterDamp = 1;
    if (!inDecel) {
      const sweetY = viewportH * 0.34;
      const band = Math.max(120, viewportH * 0.24);
      for (let i = 0; i < chapters.length; i++) {
        if (chapters[i].node === contatoEl) continue;
        const dist = Math.abs((chapters[i].headingCenter - virtualY) - sweetY);
        if (dist < band) {
          const proximity = 0.5 * (1 + Math.cos((Math.PI * dist) / band));
          const damp = 1 - 0.38 * proximity;
          if (damp < chapterDamp) chapterDamp = damp;
        }
      }
    }

    currentCinemaPxPerSec = baseSpeed * cinemaSpeed * rampFactor * chapterDamp * endFactor;
    virtualY += Math.min(remaining, currentCinemaPxPerSec * dt);
    window.scrollTo({ top: virtualY, behavior: 'instant' });
  }

  // Unified Frame Render (zero getBoundingClientRect)
  function updateTextChoreography(scrollY, motion) {
    for (let i = 0; i < textItems.length; i++) {
      const item = textItems[i];
      let inP = 1;
      let outP = 0;
      if (motion) {
        if (item.hasEnter) {
          const span = item.enterEnd - item.enterStart;
          inP = span > 0 ? smoothstep((scrollY - item.enterStart) / span) : Number(scrollY >= item.enterEnd);
        }
        const outSpan = item.exitEnd - item.exitStart;
        outP = outSpan > 0 ? smoothstep((scrollY - item.exitStart) / outSpan) : Number(scrollY >= item.exitEnd);
      }

      const rawShift = (1 - inP - outP) * item.travel;
      const shift = Math.abs(rawShift) < 0.08 ? 0 : Math.round(rawShift * 100) / 100;
      const rawOpacity = 1 - (1 - inP) * 0.52 - outP * 0.48;
      const opacity = rawOpacity > 0.996 ? 1 : Math.round(rawOpacity * 1000) / 1000;

      if (shift === item.shift && opacity === item.opacity) continue;
      item.shift = shift;
      item.opacity = opacity;
      item.active = shift !== 0 || opacity !== 1;
      if (item.active) {
        item.node.style.setProperty('--text-shift', shift + 'px');
        item.node.style.setProperty('--text-opacity', String(opacity));
        item.node.setAttribute('data-scroll-text', '');
      } else {
        item.node.style.removeProperty('--text-shift');
        item.node.style.removeProperty('--text-opacity');
        item.node.removeAttribute('data-scroll-text');
      }
    }
  }

  function updateChaptersAndNav(scrollY, motion) {
    const focalY = scrollY + viewportH * 0.42;
    const atBottom = maxScroll > 0 && scrollY >= maxScroll - 24;
    let nextActive = null;

    if (chapters.length > 0) {
      if (atBottom) {
        nextActive = chapters[chapters.length - 1];
      } else {
        for (let i = 0; i < chapters.length; i++) {
          if (chapters[i].top <= focalY) nextActive = chapters[i];
          else break;
        }
      }
    }

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const arrival = clamp((viewportH - (ch.top - scrollY)) / (viewportH * 0.49));
      const unread = motion ? (1 - arrival).toFixed(3) : '0';
      if (unread !== ch.lastUnread) {
        ch.node.style.setProperty('--unread', unread);
        ch.lastUnread = unread;
      }
    }

    if (nextActive !== activeChapter) {
      if (activeChapter) activeChapter.node.removeAttribute('data-chapter-active');
      if (nextActive) nextActive.node.setAttribute('data-chapter-active', '');
      activeChapter = nextActive;
      activeChapterId = nextActive ? nextActive.id : 'inicio';
      activeChapterLabel = nextActive ? nextActive.label : 'Início';

      for (let i = 0; i < navMap.length; i++) {
        const { link, id } = navMap[i];
        if (id && id === activeChapterId) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }

      if (cinemaState !== 'idle') dispatchCinemaEvent();
    }
  }

  function updateArchive(scrollY) {
    if (!archiveEl) return;
    const readingLineDoc = scrollY + viewportH * 0.64;
    let markerItem = null;
    if (archiveGeo.top <= readingLineDoc && archiveGeo.bottom - scrollY > 0) {
      for (let i = 0; i < milestones.length; i++) {
        if (milestones[i].top > readingLineDoc) break;
        markerItem = milestones[i].item;
      }
    }
    if (markerItem !== activeMilestoneItem) {
      if (activeMilestoneItem) activeMilestoneItem.removeAttribute('aria-current');
      if (markerItem) markerItem.setAttribute('aria-current', 'step');
      activeMilestoneItem = markerItem;
    }
    const timelineRead = clamp((readingLineDoc - archiveGeo.top) / archiveGeo.height).toFixed(4);
    if (timelineRead !== archiveGeo.lastRead) {
      archiveEl.style.setProperty('--timeline-read', timelineRead);
      archiveGeo.lastRead = timelineRead;
    }
  }

  function renderFrame(now) {
    rafId = 0;
    if (layoutDirty) {
      measureLayout();
      if (cinemaState === 'playing') virtualY = Math.min(virtualY, cinemaTargetY);
    }
    if (cinemaState === 'playing') stepCinema(now);

    const scrollY = cinemaState === 'playing' ? virtualY : window.scrollY;
    const progress = maxScroll > 0 ? clamp(scrollY / maxScroll) : 1;
    const motion = !reducedMotion.matches;

    const dt = lastRenderTime > 0 ? Math.min(0.1, Math.max(0.008, (now - lastRenderTime) / 1000)) : 0.016;
    lastRenderTime = now;
    const pxPerSec = cinemaState === 'playing' ? currentCinemaPxPerSec : Math.abs(scrollY - prevScrollY) / dt;
    const targetVel = clamp(pxPerSec / 1200, 0, 1);
    smoothedVelocity += (targetVel - smoothedVelocity) * (targetVel > smoothedVelocity ? 0.35 : 0.18);
    if (smoothedVelocity < 0.004 && targetVel < 0.004) smoothedVelocity = 0;
    prevScrollY = scrollY;

    const scrolled = scrollY > 40;
    if (scrolled !== lastScrolledFlag) {
      if (scrolled) root.setAttribute('data-scrolled', 'true');
      else root.removeAttribute('data-scrolled');
      lastScrolledFlag = scrolled;
    }

    const progressStr = progress.toFixed(4);
    if (progressStr !== lastProgress) {
      root.style.setProperty('--read', progressStr);
      root.style.setProperty('--scroll-progress', progressStr);
      lastProgress = progressStr;
    }

    const velStr = smoothedVelocity.toFixed(3);
    if (velStr !== lastVelocityStr) {
      root.style.setProperty('--scroll-velocity', velStr);
      lastVelocityStr = velStr;
    }

    updateTextChoreography(scrollY, motion);
    updateChaptersAndNav(scrollY, motion);
    updateArchive(scrollY);
    if (cinemaState !== 'idle') syncHud(progress);

    window.dispatchEvent(new CustomEvent('curriculo:scroll', {
      detail: { progress, scrollY, velocity: smoothedVelocity, chapterId: activeChapterId }
    }));
    window.dispatchEvent(new CustomEvent('cv-progress', { detail: progress }));

    if (cinemaState === 'playing' || smoothedVelocity > 0) scheduleFrame();
  }

  function scheduleFrame() {
    if (!rafId) rafId = requestAnimationFrame(renderFrame);
  }
  function markLayoutDirty() {
    layoutDirty = true;
    scheduleFrame();
  }

  // Cinema controls & respectful manual override
  const isInsideHud = (t) => Boolean(hudEl && t instanceof Element && hudEl.contains(t));
  const isInteractive = (t) => t instanceof Element && Boolean(
    t.closest('button,a,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"]')
  );

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const trigger = target.closest('[data-cinema-trigger], .explore');
    if (trigger) {
      event.preventDefault();
      if (event.detail > 0 && typeof trigger.blur === 'function') trigger.blur();
      if (reducedMotion.matches) { startCinema(); return; }
      const isFooterReplay = Boolean(trigger.closest('footer'));
      if (cinemaState === 'playing') {
        if (isFooterReplay) startCinema({ fromTop: true });
        else pauseCinema();
      } else if (cinemaState === 'paused') {
        if (isFooterReplay) startCinema({ fromTop: true });
        else resumeCinema();
      } else {
        startCinema({ fromTop: isFooterReplay });
      }
      return;
    }

    if (hudToggleEl && target.closest('[data-cinema-toggle]')) {
      event.preventDefault();
      if (cinemaState === 'playing') pauseCinema();
      else if (cinemaState === 'paused') resumeCinema();
      else if (cinemaState === 'finished') startCinema({ fromTop: true });
      return;
    }

    if (hudSpeedEl && target.closest('[data-cinema-speed]')) {
      event.preventDefault();
      cycleCinemaSpeed();
      return;
    }

    if (hudExitEl && target.closest('[data-cinema-exit]')) {
      event.preventDefault();
      exitCinema();
      return;
    }

    if (cinemaState !== 'idle' && target.closest('a[href^="#"]')) exitCinema();
  });

  window.addEventListener('wheel', () => { if (cinemaState !== 'idle') exitCinema(); }, { passive: true });
  window.addEventListener('touchstart', (e) => {
    if (cinemaState !== 'idle' && !isInsideHud(e.target)) exitCinema();
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    if (cinemaState === 'idle') return;
    const t = e.target instanceof Element ? e.target : null;
    if (isInsideHud(t) || t?.closest('[data-cinema-trigger], .explore')) return;
    exitCinema();
  }, { passive: true });

  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
  window.addEventListener('keydown', (e) => {
    if (cinemaState === 'idle') return;
    if (e.key === 'Escape') { e.preventDefault(); exitCinema(); return; }
    if ((e.code === 'Space' || e.key === ' ') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if ((cinemaState === 'playing' || cinemaState === 'paused') && !isInteractive(e.target)) {
        e.preventDefault();
        if (cinemaState === 'playing') pauseCinema();
        else resumeCinema();
      }
      return;
    }
    if (SCROLL_KEYS.has(e.key)) {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !t.closest('input,textarea,select,[contenteditable="true"]')) exitCinema();
    }
  });

  // Print & Copy-Phone utilities
  document.querySelectorAll('#print, [data-print-trigger]').forEach((btn) => {
    btn.hidden = false;
    btn.addEventListener('click', () => {
      if (cinemaState !== 'idle') exitCinema();
      window.print();
    });
  });

  function copyFallback(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  document.querySelectorAll('[data-copy-phone]').forEach((btn) => {
    let timer = 0;
    btn.addEventListener('click', () => {
      const value = btn.getAttribute('data-copy-value') || '+5546984159384';
      const done = () => {
        btn.setAttribute('data-copied', 'true');
        if (timer) clearTimeout(timer);
        timer = window.setTimeout(() => { timer = 0; btn.removeAttribute('data-copied'); }, 2000);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(value).then(done).catch(() => { if (copyFallback(value)) done(); });
      } else if (copyFallback(value)) {
        done();
      }
    });
  });

  // Water-text IntersectionObserver
  if ('IntersectionObserver' in window) {
    const waterNodes = document.querySelectorAll('.water-text');
    if (waterNodes.length > 0) {
      const flowObserver = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          entries[i].target.toggleAttribute('data-flow-active', entries[i].isIntersecting);
        }
      });
      waterNodes.forEach((node) => flowObserver.observe(node));
    }
  }

  // GPU-composited Cursor Glow
  const halo = document.getElementById('cursor-glow');
  if (halo) {
    let haloFrame = 0, hx = 0, hy = 0, tx = 0, ty = 0;
    const moveHalo = () => {
      haloFrame = 0;
      const arrived = reducedMotion.matches || Math.hypot(tx - hx, ty - hy) < 0.65;
      hx = arrived ? tx : hx + (tx - hx) * 0.36;
      hy = arrived ? ty : hy + (ty - hy) * 0.36;
      halo.style.transform = 'translate3d(' + hx.toFixed(2) + 'px,' + hy.toFixed(2) + 'px,0)';
      if (!arrived) haloFrame = requestAnimationFrame(moveHalo);
    };
    const hideHalo = () => {
      halo.removeAttribute('data-visible');
      if (haloFrame) { cancelAnimationFrame(haloFrame); haloFrame = 0; }
    };
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !canHover.matches) { hideHalo(); return; }
      tx = e.clientX; ty = e.clientY;
      if (!halo.hasAttribute('data-visible')) {
        hx = tx; hy = ty; moveHalo(); halo.setAttribute('data-visible', '');
      } else if (!haloFrame) {
        haloFrame = requestAnimationFrame(moveHalo);
      }
    }, { passive: true });
    root.addEventListener('pointerleave', hideHalo, { passive: true });
    window.addEventListener('blur', hideHalo, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) hideHalo(); });
  }

  // Lifecycle listeners
  window.addEventListener('scroll', () => { if (cinemaState !== 'playing') scheduleFrame(); }, { passive: true });
  window.addEventListener('resize', markLayoutDirty, { passive: true });
  window.addEventListener('load', markLayoutDirty, { passive: true });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && cinemaState !== 'idle') exitCinema();
    markLayoutDirty();
  });
  desktopQuery.addEventListener('change', markLayoutDirty);
  if ('ResizeObserver' in window && document.body) new ResizeObserver(markLayoutDirty).observe(document.body);
  document.fonts?.ready.then(markLayoutDirty);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && cinemaState === 'playing') { lastCinemaTime = 0; scheduleFrame(); }
  });

  // Initial state
  root.setAttribute('data-cinema', 'idle');
  root.style.setProperty('--cinema-active', '0');
  root.style.setProperty('--scroll-velocity', '0');
  syncHud(0);
  scheduleFrame();
})();
