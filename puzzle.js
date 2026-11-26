(() => {
  'use strict';

  const canvas = document.querySelector('#puzzle');
  const ctx = canvas?.getContext('2d');
  const main = document.querySelector('#principal');
  if (!ctx || !main) return;

  const intro = main.querySelector('.intro');
  const chapters = [...main.querySelectorAll('.story section')];
  const hudEl = document.querySelector('#cinema-hud');

  // Every solid UI obstacle that puzzle pieces & orbital halos must NEVER touch or cross
  const OBSTACLE_SELECTOR = 'header nav, .intro, .story h2, .section-note, .story .piece, #contato .contact-panel, footer';

  const tau = Math.PI * 2;
  const unit = v => Math.max(0, Math.min(1, v));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = v => { const t = unit(v); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const artBase = new URL('./arte/', document.currentScript?.src || document.baseURI);

  // Offscreen pre-rendered sprites (zero per-frame radial gradient allocations)
  function makeStarSprite(rgb, coreFill) {
    const off = document.createElement('canvas');
    off.width = off.height = 64;
    const g = off.getContext('2d');
    if (!g) return off;
    const halo = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    halo.addColorStop(0, 'rgba(' + rgb + ',.76)');
    halo.addColorStop(.26, 'rgba(' + rgb + ',.32)');
    halo.addColorStop(.62, 'rgba(' + rgb + ',.07)');
    halo.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 64, 64);

    const r = 8.6;
    g.beginPath();
    g.moveTo(32, 32 - r);
    g.quadraticCurveTo(32 + r * .13, 32 - r * .13, 32 + r * .74, 32);
    g.quadraticCurveTo(32 + r * .13, 32 + r * .13, 32, 32 + r);
    g.quadraticCurveTo(32 - r * .13, 32 + r * .13, 32 - r * .74, 32);
    g.quadraticCurveTo(32 - r * .13, 32 - r * .13, 32, 32 - r);
    g.fillStyle = coreFill;
    g.fill();
    return off;
  }

  function makeOrbitalBloom() {
    const off = document.createElement('canvas');
    off.width = off.height = 64;
    const g = off.getContext('2d');
    if (!g) return off;
    const halo = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    halo.addColorStop(0, 'rgba(217,161,255,.28)');
    halo.addColorStop(.45, 'rgba(173,255,207,.11)');
    halo.addColorStop(1, 'rgba(173,255,207,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 64, 64);
    return off;
  }

  const violetStarSprite = makeStarSprite('217,161,255', 'rgba(252,248,255,1)');
  const mintStarSprite = makeStarSprite('173,255,207', 'rgba(246,255,250,1)');
  const orbitalBloomSprite = makeOrbitalBloom();

  // Four interlocking isometric puzzle layers normalized to shared studio render
  const art = [
    { file: 'topo.webp', x: 291, y: 128, w: 555, h: 429, turn: -.16, image: null, cx: 0, cy: 0, width: 0, height: 0, lane: 0 },
    { file: 'esquerda.webp', x: 92, y: 381, w: 525, h: 587, turn: .16, image: null, cx: 0, cy: 0, width: 0, height: 0, lane: 0 },
    { file: 'direita.webp', x: 629, y: 321, w: 547, h: 475, turn: .15, image: null, cx: 0, cy: 0, width: 0, height: 0, lane: 0 },
    { file: 'frente.webp', x: 395, y: 614, w: 596, h: 529, turn: -.13, image: null, cx: 0, cy: 0, width: 0, height: 0, lane: 0 }
  ];
  const artLeft = Math.min(...art.map(p => p.x));
  const artRight = Math.max(...art.map(p => p.x + p.w));
  const artTop = Math.min(...art.map(p => p.y));
  const artBottom = Math.max(...art.map(p => p.y + p.h));
  const artWidth = artRight - artLeft;
  const midX = (artLeft + artRight) / 2;
  const midY = (artTop + artBottom) / 2;
  for (const p of art) {
    p.cx = (p.x + p.w / 2 - midX) / artWidth;
    p.cy = (p.y + p.h / 2 - midY) / artWidth;
    p.width = p.w / artWidth;
    p.height = p.h / artWidth;
  }
  const queue = art.slice().sort((a, b) => a.cx - b.cx);
  queue.forEach((piece, index) => { piece.lane = index - 1.5; });

  // Pre-allocated pools (zero per-frame allocations)
  const poses = art.map(() => ({
    image: null,
    wx: 0,
    wy: 0,
    turn: 0,
    w: 0,
    h: 0,
    r: 0,
    lane: 0
  }));
  const particleField = new Float32Array(art.length * 3);
  const particleEvent = new CustomEvent('cv-puzzle-field', { detail: particleField });
  const chapterState = { index: 0, local: 0 };
  const areaOut = {
    x: 0,
    visY: 0,
    w: 0,
    formation: 0,
    rail: 0,
    direction: 1,
    contact: 0,
    inCorridor: false,
    safeLaneX: 0
  };
  const axisOut = { pos: 0, vel: 0 };

  // Autonomous corridor flight + smooth viewport-space motion state
  // Decoupled from chunky 100px mouse-wheel steps so crossings NEVER teleport or park mid-corridor!
  const nav = {
    initialized: false,
    chapter: 0,          // Committed endpoint chapter index (desktop: 0..N-1; mobile: -1=hero, 0..N-1)
    x: 0,
    vx: 0,
    visY: 0,
    vy: 0,
    w: 0,
    formation: 0,
    rail: 0,
    direction: 1,
    contact: 0,
    haloScale: 1,
    lastSy: -1,
    scrollDir: 1,
    // Autonomous corridor crossing flight
    flightActive: false,
    flightCorridorIdx: -1,
    flightFromChapter: 0,
    flightToChapter: 0,
    flightU: 0,          // Smooth continuous 0 -> 1 progress
    flightTargetU: 1,    // 1 = forward to flightToChapter, 0 = smooth reversal back to flightFromChapter
    flightSpeedU: 0,     // Current dU/dt for C1 smooth reversal & acceleration
    flightFromX: 0,
    flightToX: 0,
    flightFromVisY: 0,
    flightExitVisY: 0,
    flightExitCaptured: false,
    flightFromW: 0,
    flightToW: 0,
    flightDir: 1,
    flightIsMobileArch: false,
    flightIsMobileHero: false,
    flightArrivalFired: false
  };

  // Pre-allocated live viewport obstacle boxes
  const MAX_LIVE_OBS = 64;
  const liveObstacles = Array.from({ length: MAX_LIVE_OBS }, () => ({ left: 0, right: 0, top: 0, bottom: 0, isBand: false }));
  let liveObstacleCount = 0;

  // Read-only telemetry mutated in-place (exposes exact rendered piece circles { x, y, r })
  const debugState = {
    x: 0,
    y: 0,
    w: 0,
    t: 0,
    frame: 0,
    formation: 0,
    contact: 0,
    haloRadius: 0,
    chapter: 0,
    corridorActive: false,
    pieces: [
      { x: 0, y: 0, r: 0 },
      { x: 0, y: 0, r: 0 },
      { x: 0, y: 0, r: 0 },
      { x: 0, y: 0, r: 0 }
    ]
  };
  window.__curriculoPuzzleState = debugState;

  const stars = [
    [-.50, -.25, 3.8], [-.40, -.30, 1.5], [-.34, -.41, 2.3], [-.30, -.44, 1.1], [-.17, -.50, 1.5],
    [.38, -.35, 1.5], [.52, -.23, 2.2], [.57, -.09, 1.4], [.51, .29, 3.6], [.43, .35, 1.2],
    [.35, .39, 1.8], [.21, .44, 1.1], [-.22, .45, 2.8], [-.36, .37, 1.1], [-.46, .24, 1.6]
  ];
  const ORBIT_SEGMENTS = 15;
  const LANE_PAD = 22;
  const EDGE_PAD = 16;
  const PIECE_PAD = 10;

  let width = 0, height = 0, ratio = 1, distance = 1, readingHeight = 800;
  let lastWinW = 0, lastWinH = 0, lastDpr = 0, contentRefW = 1280;
  let layout = [], corridors = [], marks = [0, 1];
  let hero = null, flightSlot = null, mobileLane = null;
  let cachedObstacles = [];
  let headerSafeBottom = 76;
  let target = 0, position = 0, clock = .4, previous = 0, frame = 0, frameCount = 0, ready = false;
  let arrival = -10;
  let cinemaPlaying = false, cinemaEnergy = 0, cinemaSpeed = 1, scrollVelocity = 0;
  const cursor = { x: 0, y: 0, tx: 0, ty: 0 };

  function getFocusRatio() {
    return width <= 800 ? .50 : .52;
  }

  // Reads untransformed rest-state document box (compensating scroll.js --text-shift/--text-scale)
  function getRestDocRect(el, sy) {
    const r = el.getBoundingClientRect();
    let shift = 0;
    let scale = 1;
    if (el.hasAttribute('data-scroll-text')) {
      const sVal = parseFloat(el.style.getPropertyValue('--text-shift'));
      const scVal = parseFloat(el.style.getPropertyValue('--text-scale'));
      if (Number.isFinite(sVal)) shift = sVal;
      if (Number.isFinite(scVal) && scVal > 0.1) scale = scVal;
    }
    const docH = r.height / scale;
    const docTop = r.top + sy - shift;
    return {
      left: r.left,
      right: r.right,
      docTop,
      docBottom: docTop + docH,
      width: r.width,
      height: docH
    };
  }

  function cacheObstacles(sy) {
    const nodes = document.querySelectorAll(OBSTACLE_SELECTOR);
    const list = [];
    headerSafeBottom = 64;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const box = node.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      const isHeader = !!node.closest('header');
      const isBand = isHeader
        || node.classList.contains('contact-panel')
        || node.tagName === 'FOOTER'
        || (width <= 800 && node.classList.contains('intro'));
      if (isHeader) {
        headerSafeBottom = Math.max(headerSafeBottom, box.bottom);
        list.push({
          el: node,
          left: box.left,
          right: box.right,
          docTop: box.top,
          docBottom: box.bottom,
          fixed: true,
          isBand: true
        });
      } else {
        const rest = getRestDocRect(node, sy);
        list.push({
          el: node,
          left: rest.left,
          right: rest.right,
          docTop: rest.docTop,
          docBottom: rest.docBottom,
          fixed: false,
          isBand
        });
      }
    }
    cachedObstacles = list;
  }

  // Collect exact live viewport bounding rects for obstacles near the current viewport
  function collectLiveObstacles(sy) {
    let count = 0;
    let liveHeaderBottom = 56;
    let liveHudTop = height;

    for (let i = 0; i < cachedObstacles.length && count < MAX_LIVE_OBS - 1; i++) {
      const obs = cachedObstacles[i];
      if (!obs.fixed) {
        if (obs.docBottom - sy < -160 || obs.docTop - sy > height + 160) continue;
      }
      const r = obs.el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (obs.fixed) {
        liveHeaderBottom = Math.max(liveHeaderBottom, r.bottom);
      } else if (r.bottom < -120 || r.top > height + 120) {
        continue;
      }
      const slot = liveObstacles[count++];
      slot.left = r.left;
      slot.right = r.right;
      slot.top = r.top;
      slot.bottom = r.bottom;
      slot.isBand = obs.isBand;
    }

    if (hudEl && !hudEl.hidden && hudEl.getAttribute('data-visible') === 'true' && count < MAX_LIVE_OBS) {
      const hr = hudEl.getBoundingClientRect();
      if (hr.width > 0 && hr.height > 0) {
        liveHudTop = Math.min(liveHudTop, hr.top);
        const slot = liveObstacles[count++];
        slot.left = hr.left;
        slot.right = hr.right;
        slot.top = hr.top;
        slot.bottom = hr.bottom;
        slot.isBand = true;
      }
    }

    liveObstacleCount = count;
    headerSafeBottom = liveHeaderBottom;
    return liveHudTop;
  }

  // Query live viewport gap bounds [gapTopVis, gapBottomVis] accounting for any CSS scroll transforms
  function getLiveCorridorGapVis(c, sy) {
    let topVis = c.gapTop - sy;
    let bottomVis = c.gapBottom - sy;
    if (c.upperEl) {
      const ur = c.upperEl.getBoundingClientRect();
      if (ur.height > 0) topVis = Math.max(topVis, ur.bottom);
    }
    if (c.lowerEl) {
      const lr = c.lowerEl.getBoundingClientRect();
      if (lr.height > 0) bottomVis = Math.min(bottomVis, lr.top);
    }
    if (bottomVis < topVis + 48) {
      topVis = c.gapTop - sy;
      bottomVis = c.gapBottom - sy;
    }
    return { topVis, bottomVis, midVis: (topVis + bottomVis) * .5 };
  }

  function buildCorridors() {
    const list = [];
    if (!hero || !layout.length) {
      corridors = list;
      return;
    }

    const isMobile = width <= 800;
    const focusRatio = getFocusRatio();
    const maxFocus = distance + readingHeight * focusRatio;

    // Corridor 0: Hero -> Chapter 0 (#trajetoria)
    const first = layout[0];
    if (isMobile) {
      const bayTop = hero.docBottom + 10;
      const bayBottom = first.contentTop - 10;
      const bayMid = (bayTop + bayBottom) * .5;
      list.push({
        fromChapter: -1,
        toChapter: 0,
        gapTop: bayTop,
        gapBottom: bayBottom,
        gapMid: bayMid,
        triggerY: Math.max(readingHeight * focusRatio + 160, bayMid - 40),
        crossSide: true,
        isHeroExit: true,
        upperEl: intro,
        lowerEl: first.firstEl
      });
    } else {
      const gapTop = hero.docBottom;
      const gapBottom = first.contentTop;
      const gapMid = (gapTop + gapBottom) * .5;
      list.push({
        fromChapter: -1,
        toChapter: 0,
        gapTop,
        gapBottom,
        gapMid,
        triggerY: gapMid,
        crossSide: first.side !== 1,
        isHeroExit: true,
        upperEl: intro,
        lowerEl: first.firstEl
      });
    }

    // Corridors 1..N-1: Chapter (i-1) -> Chapter i
    for (let i = 1; i < layout.length; i++) {
      const prev = layout[i - 1];
      const next = layout[i];
      const gapTop = prev.contentBottom;
      const gapBottom = next.contentTop;
      const gapMid = (gapTop + gapBottom) * .5;
      let triggerY = gapMid;

      if (next.isContact) {
        // Ensure contact crest flight always triggers comfortably before bottom of page
        triggerY = Math.min(gapMid, maxFocus - (isMobile ? 68 : 110));
      }

      list.push({
        fromChapter: i - 1,
        toChapter: i,
        gapTop,
        gapBottom,
        gapMid,
        triggerY,
        crossSide: isMobile ? true : (prev.side !== next.side),
        isHeroExit: false,
        upperEl: prev.lastEl,
        lowerEl: next.firstEl
      });
    }

    corridors = list;
  }

  function measure() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!width || !height) return;

    lastWinW = window.innerWidth;
    lastWinH = window.innerHeight;
    lastDpr = window.devicePixelRatio || 1;

    ratio = Math.min(1.75, Math.max(.25, lastDpr));
    ratio = Math.min(ratio, Math.sqrt(4_500_000 / (width * height)));
    const pw = Math.max(1, Math.round(width * ratio));
    const ph = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    // Always wipe the entire backing buffer cleanly on every measure/zoom/resize (zero stale ghosts!)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sy = window.scrollY;
    const isMobile = width <= 800;
    const contentBox = main.getBoundingClientRect();
    contentRefW = clamp(contentBox.width || width, 320, 1360);
    const introRect = intro
      ? getRestDocRect(intro, sy)
      : { left: contentBox.left, right: contentBox.left + contentBox.width * .6, docTop: 0, docBottom: height * .8, width: contentBox.width * .6, height: height * .8 };

    // Hero open lane (desktop right of .intro; stays gracefully paired near content column when zoomed out)
    const heroLaneLeft = introRect.right + LANE_PAD;
    const heroLaneRight = Math.min(width - EDGE_PAD, Math.max(heroLaneLeft + 120, contentBox.right + 140));
    const heroUsableW = Math.max(72, heroLaneRight - heroLaneLeft);
    hero = {
      x: (heroLaneLeft + heroLaneRight) * .5,
      usableW: heroUsableW,
      laneLeft: heroLaneLeft,
      laneRight: heroLaneRight,
      docTop: introRect.docTop,
      docBottom: introRect.docBottom,
      h: Math.max(120, introRect.height)
    };

    const slotEl = main.querySelector('.mobile-flight');
    const slotRect = slotEl ? slotEl.getBoundingClientRect() : null;
    flightSlot = slotRect && slotRect.height > 20
      ? {
          x: width * .5,
          docTop: slotRect.top + sy,
          docBottom: slotRect.bottom + sy,
          docY: slotRect.top + sy + slotRect.height * .5,
          w: width,
          h: slotRect.height
        }
      : null;

    readingHeight = Math.min(height, isMobile ? height : hero.h / .82);

    layout = [];
    let maxMobileChapterRight = 0;

    for (let i = 0; i < chapters.length; i++) {
      const section = chapters[i];
      const secBox = section.getBoundingClientRect();
      const contentEl = section.querySelector('.chapter-inner') || section;
      const isContact = section.id === 'contato';

      // Measure true rest-state vertical & horizontal bounds of obstacles inside this chapter
      const innerNodes = isContact
        ? [contentEl]
        : [...section.querySelectorAll('h2, .section-note, .piece')];
      let minTop = Infinity;
      let maxBottom = -Infinity;
      let minLeft = Infinity;
      let maxRight = -Infinity;
      let firstEl = contentEl;
      let lastEl = contentEl;
      for (let j = 0; j < innerNodes.length; j++) {
        const rr = getRestDocRect(innerNodes[j], sy);
        if (rr.width <= 0 || rr.height <= 0) continue;
        if (rr.docTop < minTop) { minTop = rr.docTop; firstEl = innerNodes[j]; }
        if (rr.docBottom > maxBottom) { maxBottom = rr.docBottom; lastEl = innerNodes[j]; }
        if (rr.left < minLeft) minLeft = rr.left;
        if (rr.right > maxRight) maxRight = rr.right;
      }
      if (!Number.isFinite(minTop)) {
        const fb = getRestDocRect(contentEl, sy);
        minTop = fb.docTop;
        maxBottom = fb.docBottom;
        minLeft = fb.left;
        maxRight = fb.right;
      }

      if (!isContact && maxRight > maxMobileChapterRight) {
        maxMobileChapterRight = maxRight;
      }

      if (isContact) {
        const prevBottom = layout.length ? layout[layout.length - 1].contentBottom : secBox.top + sy;
        const gapAbove = Math.max(40, minTop - prevBottom);
        const contactW = Math.min(
          Math.max(104, (gapAbove - 42) / 1.48),
          readingHeight * .29,
          (maxRight - minLeft) * .29,
          210
        );
        layout.push({
          top: secBox.top + sy,
          bottom: secBox.bottom + sy,
          contentTop: minTop,
          contentBottom: maxBottom,
          contentLeft: minLeft,
          contentRight: maxRight,
          firstEl,
          lastEl,
          x: (minLeft + maxRight) * .5,
          usableW: Math.max(80, width - EDGE_PAD * 2),
          side: 0,
          isContact: true,
          contactW,
          laneW: contactW
        });
      } else {
        const onLeft = (minLeft + maxRight) < (contentBox.left + contentBox.right);
        const laneLeft = onLeft
          ? (maxRight + LANE_PAD)
          : Math.max(EDGE_PAD, Math.min(minLeft - LANE_PAD - 120, contentBox.left - 140));
        const laneRight = onLeft
          ? Math.min(width - EDGE_PAD, Math.max(maxRight + LANE_PAD + 120, contentBox.right + 140))
          : (minLeft - LANE_PAD);
        const usableW = Math.max(64, laneRight - laneLeft);
        // Keep full orbiting cluster comfortably inside [safeMin + 14, safeMax - 14] and balanced even at 33%-50% zoom
        const laneW = Math.min(
          usableW / 1.60,
          readingHeight * .42,
          Math.max(140, maxBottom - minTop) * .52,
          contentRefW * .32,
          390
        );
        layout.push({
          top: secBox.top + sy,
          bottom: secBox.bottom + sy,
          contentTop: minTop,
          contentBottom: maxBottom,
          contentLeft: minLeft,
          contentRight: maxRight,
          firstEl,
          lastEl,
          x: (laneLeft + laneRight) * .5,
          usableW,
          side: onLeft ? 1 : -1,
          isContact: false,
          contactW: 0,
          laneW
        });
      }
    }

    if (isMobile) {
      const mLeft = maxMobileChapterRight + 14;
      const mRight = width - 8;
      const mUsable = Math.max(36, mRight - mLeft);
      mobileLane = {
        x: (mLeft + mRight) * .5,
        usableW: mUsable,
        railW: clamp(mUsable * 1.42, 44, 84)
      };
    } else {
      mobileLane = null;
    }

    cacheObstacles(sy);

    distance = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    marks = [0];
    for (let i = 0; i < layout.length; i++) {
      const mark = unit((layout[i].top - readingHeight * getFocusRatio()) / distance);
      if (mark > marks[marks.length - 1] + .028 && mark < .96) marks.push(mark);
    }
    marks.push(1);

    buildCorridors();

    // Re-sync lane X/Y cleanly on resize or zoom without mid-corridor glitch
    if (nav.initialized) {
      nav.flightActive = false;
      nav.flightCorridorIdx = -1;
      nav.initialized = false;
    }

    target = unit(sy / distance);
    schedule();
  }

  function updateChapter(progress) {
    let index = 0;
    while (index < marks.length - 2 && progress >= marks[index + 1]) index++;
    chapterState.index = index;
    chapterState.local = unit((progress - marks[index]) / (marks[index + 1] - marks[index]));
    return chapterState;
  }

  function computeContactBay(row, sy, hudTop) {
    const prevBottom = layout.length >= 2 ? layout[layout.length - 2].contentBottom : row.top;
    const visHeaderClear = headerSafeBottom + 14;
    const bayTopDoc = Math.max(prevBottom + 14, sy + visHeaderClear);
    const bayBottomDoc = Math.min(row.contentTop - 14, sy + hudTop - 14);
    const bayH = bayBottomDoc - bayTopDoc;
    const isMobile = width <= 800;

    // Extreme short-window fallback on desktop: rest cleanly in the open left wing beside .contact-panel
    if (!isMobile && bayH < 108 && row.contentLeft >= 170) {
      const wingLeft = EDGE_PAD;
      const wingRight = row.contentLeft - LANE_PAD;
      const wingW = Math.max(80, wingRight - wingLeft);
      const fittedW = Math.min(wingW / 1.54, 148);
      const visMid = clamp((headerSafeBottom + hudTop) * .5, headerSafeBottom + fittedW * .68 + 10, hudTop - fittedW * .68 - 10);
      return {
        x: (wingLeft + wingRight) * .5,
        bayTopDoc,
        bayBottomDoc,
        bayH: Math.max(108, bayH),
        bayMidDoc: sy + visMid,
        fittedW,
        compact: 0
      };
    }

    const clampedBayH = Math.max(48, bayH);
    const bayMidDoc = bayH > 0
      ? (bayTopDoc + bayBottomDoc) * .5
      : Math.min(row.contentTop - 36, sy + visHeaderClear + 28);
    const maxWFromHeight = Math.max(64, (clampedBayH - 18) / 1.44);
    const maxWFromWidth = (width - EDGE_PAD * 2 - 20) / 1.54;
    const fittedW = Math.min(row.contactW, maxWFromHeight, maxWFromWidth, isMobile ? 152 : 206);
    const compact = clampedBayH < 128 ? smooth((128 - clampedBayH) / 56) * .55 : 0;
    return { x: row.x, bayTopDoc, bayBottomDoc, bayH: clampedBayH, bayMidDoc, fittedW, compact };
  }

  function heroStationW(hudTop) {
    const availH = Math.max(180, hudTop - headerSafeBottom - 40);
    return Math.min(hero.usableW / 1.54, hero.h * .56, readingHeight * .52, availH / 1.44, contentRefW * .36, 460);
  }

  function computeCorridorW(c, prev, next) {
    const gapH = Math.max(64, c.gapBottom - c.gapTop);
    if (width <= 800) {
      const maxHorizW = Math.max(100, (width - 36) / 2.06);
      const maxGapW = Math.max(100, (gapH - 42) / .48);
      return Math.min(maxHorizW, maxGapW, 152);
    }
    const startLaneW = prev ? prev.usableW : hero.usableW;
    const endLaneW = next.isContact ? (width - EDGE_PAD * 2) : next.usableW;
    // Outermost crossing piece reach = 0.78*w + 0.22*w = 1.00*w; vertical reach = 0.22*w + wave + pad
    const maxHorizW = Math.max(120, Math.min(startLaneW, endLaneW) * .5 - 24);
    const maxGapW = Math.max(120, (gapH - 60) / .48);
    const corridorCap = Math.min(256, readingHeight * .335, contentRefW * .22);
    return Math.min(maxGapW, maxHorizW, corridorCap);
  }

  // Exact analytical critically-damped 2nd-order spring (ZERO hard lag clamps!)
  function stepSpringAxis(cur, vel, targetVal, omega, dt, maxSpeed) {
    const e = Math.exp(-omega * dt);
    const diff = cur - targetVal;
    const temp = (vel + omega * diff) * dt;
    let nextPos = targetVal + (diff + temp) * e;
    let nextVel = (vel - omega * temp) * e;

    if (maxSpeed > 0) {
      const maxStep = maxSpeed * dt;
      const delta = nextPos - cur;
      if (delta > maxStep) {
        nextPos = cur + maxStep;
        nextVel = maxSpeed;
      } else if (delta < -maxStep) {
        nextPos = cur - maxStep;
        nextVel = -maxSpeed;
      }
    }

    axisOut.pos = nextPos;
    axisOut.vel = nextVel;
  }

  // Compute desired discrete chapter directly from scroll focus (no hysteresis — used for init / large jumps)
  function chapterAtFocus(focusDocY) {
    const isMobile = width <= 800;
    if (!corridors.length) return 0;
    if (isMobile) {
      let ch = -1;
      for (let k = 0; k < corridors.length; k++) {
        if (focusDocY >= corridors[k].triggerY) ch = corridors[k].toChapter;
      }
      return ch;
    }
    let ch = 0;
    for (let k = 1; k < corridors.length; k++) {
      if (focusDocY >= corridors[k].triggerY) ch = corridors[k].toChapter;
    }
    return ch;
  }

  // Update target chapter with clean ±HYST deadband around every corridor midpoint (ZERO ping-pong!)
  function nextChapterWithHysteresis(currentCh, focusDocY) {
    const isMobile = width <= 800;
    const hyst = cinemaPlaying ? 10 : (isMobile ? 20 : 22);
    const minCh = isMobile ? -1 : 0;
    const maxCh = layout.length - 1;
    let ch = clamp(currentCh, minCh, maxCh);

    // Check forward transitions
    while (ch < maxCh) {
      const corrIdx = ch + 1; // Corridor between ch and ch+1
      const c = corridors[corrIdx];
      if (!c) break;
      if (focusDocY >= c.triggerY + hyst) {
        ch++;
      } else {
        break;
      }
    }

    // Check backward transitions
    while (ch > minCh) {
      const corrIdx = ch; // Corridor between ch-1 and ch
      const c = corridors[corrIdx];
      if (!c) break;
      if (focusDocY <= c.triggerY - hyst) {
        ch--;
      } else {
        break;
      }
    }

    return ch;
  }

  // Compute exact resting lane geometry for a given chapter index at current scrollY
  function getStationPose(chIdx, sy, hudTop) {
    const isMobile = width <= 800;
    const focusRatio = getFocusRatio();

    if (isMobile) {
      const first = layout[0];
      const bayTop = hero.docBottom + 12;
      const bayBottom = first ? first.contentTop - 12 : (flightSlot ? flightSlot.docBottom - 12 : bayTop + 200);
      const bayH = Math.max(80, bayBottom - bayTop);
      const bayMid = (bayTop + bayBottom) * .5;
      const heroBayW = Math.min((width - 36) / 1.54, (bayH - 22) / 1.50, 204);
      const mLaneX = mobileLane ? mobileLane.x : width - 38;
      const mRailW = mobileLane ? mobileLane.railW : 58;

      if (chIdx < 0 || !layout.length) {
        const halfH = heroBayW * .64 + 12;
        const minVis = Math.max(headerSafeBottom + halfH, bayTop - sy + halfH);
        const maxVis = Math.min(hudTop - halfH, bayBottom - sy - halfH);
        const visY = maxVis >= minVis ? clamp(bayMid - sy, minVis, maxVis) : (bayMid - sy);
        return {
          x: width * .5,
          visY,
          minVis: bayTop - sy + halfH,
          maxVis: bayBottom - sy - halfH,
          w: heroBayW,
          formation: 0,
          rail: 0,
          contact: 0,
          safeLaneX: width * .5
        };
      }

      const row = layout[clamp(chIdx, 0, layout.length - 1)];
      if (row.isContact) {
        const bay = computeContactBay(row, sy, hudTop);
        const halfH = bay.fittedW * .64 + 12;
        return {
          x: width * .5,
          visY: bay.bayMidDoc - sy,
          minVis: Math.max(headerSafeBottom + halfH, bay.bayTopDoc - sy + halfH),
          maxVis: Math.min(hudTop - halfH, bay.bayBottomDoc - sy - halfH),
          w: bay.fittedW,
          formation: bay.compact,
          rail: 0,
          contact: 1,
          safeLaneX: width * .5
        };
      }

      const railHalfH = mRailW * .62 + 14;
      const visMin = Math.max(headerSafeBottom + railHalfH, row.contentTop - sy + 20);
      const visMax = Math.min(hudTop - railHalfH, row.contentBottom - sy - 20);
      const targetVis = visMax >= visMin
        ? clamp(readingHeight * focusRatio, visMin, visMax)
        : clamp(readingHeight * focusRatio, headerSafeBottom + railHalfH, Math.max(headerSafeBottom + railHalfH, hudTop - railHalfH));
      return {
        x: mLaneX,
        visY: targetVis,
        minVis: headerSafeBottom + railHalfH,
        maxVis: Math.max(headerSafeBottom + railHalfH, hudTop - railHalfH),
        w: mRailW,
        formation: 0,
        rail: 1,
        contact: 0,
        safeLaneX: mLaneX
      };
    }

    // Desktop / Laptop
    const row = layout[clamp(chIdx, 0, layout.length - 1)];
    if (!row) {
      const hw = heroStationW(hudTop);
      return {
        x: hero.x,
        visY: hero.docTop + hero.h * .49 - sy,
        minVis: headerSafeBottom + hw * .64 + 14,
        maxVis: hudTop - hw * .64 - 14,
        w: hw,
        formation: 0,
        rail: 0,
        contact: 0,
        safeLaneX: hero.x
      };
    }

    if (row.isContact) {
      const bay = computeContactBay(row, sy, hudTop);
      const halfH = bay.fittedW * .64 + 12;
      return {
        x: bay.x,
        visY: bay.bayMidDoc - sy,
        minVis: Math.max(headerSafeBottom + halfH, bay.bayTopDoc - sy + halfH),
        maxVis: Math.min(hudTop - halfH, bay.bayBottomDoc - sy - halfH),
        w: bay.fittedW,
        formation: bay.compact,
        rail: 0,
        contact: 1,
        safeLaneX: bay.x
      };
    }

    // Side-lane station (Chapter 0 seamlessly shares the right lane with Hero)
    const prevCorr = chIdx > 0 ? corridors[chIdx] : null;
    const prevRow = chIdx > 0 ? layout[chIdx - 1] : null;
    const nextCorr = chIdx < layout.length - 1 ? corridors[chIdx + 1] : null;
    const nextRow = chIdx < layout.length - 1 ? layout[chIdx + 1] : null;

    // Measure live vertical lane boundaries (between opposite-side chapters above/below & header/HUD)
    let rawCeilVis = headerSafeBottom;
    let rawFloorVis = hudTop;
    if (prevCorr && prevRow && prevRow.side !== row.side) {
      const prevBotVis = prevRow.lastEl ? prevRow.lastEl.getBoundingClientRect().bottom : (prevCorr.gapTop - sy);
      rawCeilVis = Math.max(rawCeilVis, prevBotVis);
    }
    if (nextCorr && nextRow && nextRow.side !== row.side) {
      const nextTopVis = nextRow.firstEl ? nextRow.firstEl.getBoundingClientRect().top : (nextCorr.gapBottom - sy);
      rawFloorVis = Math.min(rawFloorVis, nextTopVis);
    }

    const availLaneH = Math.max(130, rawFloorVis - rawCeilVis - 28);
    const baseLaneW = Math.min(row.laneW, (hudTop - headerSafeBottom - 44) / 1.40, availLaneH / 1.38);
    let stationX = row.x;
    let stationW = baseLaneW;
    let desiredVisY = readingHeight * focusRatio;

    if (chIdx === 0 && row.side === 1) {
      // Smooth Hero -> #trajetoria blend in the shared Right lane
      const hw = Math.min(heroStationW(hudTop), availLaneH / 1.38);
      const heroVisY = Math.max(headerSafeBottom + hw * .64 + 14, hero.docTop + hero.h * .49 - sy);
      const blendT = smooth((sy + readingHeight * focusRatio - (hero.docBottom - 60)) / 240);
      const clearX = smooth((sy + readingHeight * focusRatio - (hero.docBottom + 10)) / 140);
      stationX = mix(hero.x, row.x, clearX);
      stationW = mix(hw, baseLaneW, blendT);
      desiredVisY = mix(heroVisY, readingHeight * focusRatio, blendT);
    }

    const halfH = stationW * .64 + 14;
    const minVis = rawCeilVis + halfH;
    const maxVis = rawFloorVis - halfH;

    // Subtle editorial vertical wave inside chapter span (zero jump at boundaries)
    const spanLen = Math.max(1, row.contentBottom - row.contentTop);
    const chapFrac = unit((sy + readingHeight * focusRatio - row.contentTop) / spanLen);
    const waveEnv = Math.sin(chapFrac * Math.PI);
    desiredVisY += Math.sin(chapFrac * tau) * 10 * waveEnv * waveEnv;

    // Gentle anticipatory cushion so approaching opposite-side chapters lift/lower desiredVisY smoothly
    // BEFORE a 100px mouse-wheel tick can ever slam into minVis/maxVis!
    const cushion = Math.min(84, Math.max(0, (maxVis - minVis) * .35));
    const softMinVis = nav.scrollDir < 0 ? (minVis + cushion) : minVis;
    const softMaxVis = nav.scrollDir > 0 ? (maxVis - cushion) : maxVis;

    if (softMaxVis >= softMinVis) {
      desiredVisY = clamp(desiredVisY, softMinVis, softMaxVis);
    } else if (maxVis >= minVis) {
      desiredVisY = clamp(desiredVisY, minVis, maxVis);
    } else {
      desiredVisY = (rawCeilVis + rawFloorVis) * .5;
    }

    return {
      x: stationX,
      visY: desiredVisY,
      minVis,
      maxVis,
      w: stationW,
      formation: 0,
      rail: 0,
      contact: 0,
      safeLaneX: stationX
    };
  }

  function startCorridorFlight(fromCh, toCh, sy, hudTop) {
    const isMobile = width <= 800;
    const forward = toCh > fromCh;
    const corrIdx = forward ? toCh : fromCh;
    const c = corridors[corrIdx];
    if (!c) {
      nav.chapter = toCh;
      nav.flightActive = false;
      return;
    }

    const fromPose = getStationPose(fromCh, sy, hudTop);
    const toPose = getStationPose(toCh, sy, hudTop);
    const isMobileHero = isMobile && (fromCh < 0 || toCh < 0);
    const isMobileArch = isMobile && !isMobileHero && !layout[fromCh]?.isContact && !layout[toCh]?.isContact;

    nav.flightActive = true;
    nav.flightCorridorIdx = corrIdx;
    nav.flightFromChapter = fromCh;
    nav.flightToChapter = toCh;
    nav.flightU = 0;
    nav.flightTargetU = 1;
    nav.flightSpeedU = 0;
    nav.flightFromX = nav.x;
    nav.flightToX = toPose.x;
    nav.flightFromVisY = nav.visY;
    nav.flightExitVisY = nav.visY;
    nav.flightExitCaptured = false;
    nav.flightFromW = nav.w || fromPose.w;
    nav.flightToW = toPose.w;
    nav.flightDir = isMobileArch ? -1 : (Math.sign(toPose.x - nav.x) || 1);
    nav.flightIsMobileArch = isMobileArch;
    nav.flightIsMobileHero = isMobileHero;
    nav.flightArrivalFired = false;
  }

  function advanceNavigation(sy, hudTop, dt) {
    const isMobile = width <= 800;
    const focusRatio = getFocusRatio();
    const focusDocY = sy + readingHeight * focusRatio;

    if (nav.lastSy < 0) {
      nav.lastSy = sy;
    } else {
      const dSy = sy - nav.lastSy;
      if (Math.abs(dSy) > .5) {
        nav.scrollDir = dSy > 0 ? 1 : -1;
      }
    }

    const instantJump = nav.initialized && Math.abs(sy - nav.lastSy) > height * 1.15;
    nav.lastSy = sy;

    if (!nav.initialized || instantJump) {
      const ch = chapterAtFocus(focusDocY);
      const pose = getStationPose(ch, sy, hudTop);
      position = target;
      nav.chapter = ch;
      nav.x = pose.x;
      nav.vx = 0;
      nav.visY = pose.visY;
      nav.vy = 0;
      nav.w = pose.w;
      nav.formation = pose.formation;
      nav.rail = pose.rail;
      nav.contact = pose.contact;
      nav.direction = 1;
      nav.flightActive = false;
      nav.flightCorridorIdx = -1;
      nav.initialized = true;

      areaOut.x = nav.x;
      areaOut.visY = nav.visY;
      areaOut.w = nav.w;
      areaOut.formation = nav.formation;
      areaOut.rail = nav.rail;
      areaOut.direction = nav.direction;
      areaOut.contact = nav.contact;
      areaOut.inCorridor = false;
      areaOut.safeLaneX = pose.safeLaneX;
      return areaOut;
    }

    // 1. Check whether user scroll crossed a hysteresis threshold to trigger (or smoothly reverse) a corridor flight
    const refCh = nav.flightActive
      ? (nav.flightTargetU > .5 ? nav.flightToChapter : nav.flightFromChapter)
      : nav.chapter;
    const desiredCh = nextChapterWithHysteresis(refCh, focusDocY);

    if (!nav.flightActive && desiredCh !== nav.chapter) {
      // Advance/retreat one corridor at a time so pieces ALWAYS travel through the open sky gap!
      const stepCh = nav.chapter + Math.sign(desiredCh - nav.chapter);
      startCorridorFlight(nav.chapter, stepCh, sy, hudTop);
    } else if (nav.flightActive) {
      // Smooth C1 reversal only if user clearly scrolled back across the threshold of this corridor
      if (nav.flightTargetU > .5 && desiredCh === nav.flightFromChapter && nav.flightU < .72) {
        nav.flightTargetU = 0;
      } else if (nav.flightTargetU < .5 && desiredCh === nav.flightToChapter && nav.flightU > .28) {
        nav.flightTargetU = 1;
      }
    }

    // 2. Active Autonomous Corridor Flight (pure time-based smooth motion, decoupled from wheel ticks!)
    if (nav.flightActive) {
      const c = corridors[nav.flightCorridorIdx];
      const fromCh = nav.flightFromChapter;
      const toCh = nav.flightToChapter;
      const prevChap = c.fromChapter >= 0 ? layout[c.fromChapter] : null;
      const nextChap = layout[clamp(c.toChapter, 0, layout.length - 1)];
      const liveGap = getLiveCorridorGapVis(c, sy);

      // Update live endpoint targets (e.g. if contact bay shifted slightly while scrolling)
      const toPose = getStationPose(toCh, sy, hudTop);
      const fromPose = getStationPose(fromCh, sy, hudTop);
      nav.flightToX = toPose.x;
      nav.flightToW = toPose.w;

      // Compute bold crossing size that strictly fits inside open gap with generous clearance
      let corridorW = computeCorridorW(c, prevChap, nextChap);
      const visGapTop = Math.max(liveGap.topVis, headerSafeBottom);
      const visGapBot = Math.min(liveGap.bottomVis, hudTop);
      const availGapH = Math.max(48, visGapBot - visGapTop);
      // Smooth dynamic fit only if extreme scrolling squeezes the visible gap near viewport edge
      const tightFitW = Math.max(88, (availGapH - 26) / .48);
      if (tightFitW < corridorW) {
        corridorW = Math.max(tightFitW, nav.w > 0 ? mix(nav.w, tightFitW, 1 - Math.exp(-dt * 14)) : tightFitW);
      }

      // Smooth urgency pacing: silky ~0.62s desktop / ~0.58s laptop / ~0.56s mobile,
      // gently accelerates (up to 1.48x) ONLY if rapid wheel scrolling carries the gap toward header/HUD
      const baseDur = isMobile ? .56 : (width <= 1320 ? .58 : .62);
      const neededGapH = corridorW * .48 + 30;
      const marginTop = liveGap.bottomVis - (headerSafeBottom + neededGapH);
      const marginBot = (hudTop - neededGapH) - liveGap.topVis;
      const approachMargin = nav.scrollDir > 0 ? marginTop : marginBot;
      const urgency = approachMargin < 260
        ? 1 + smooth((260 - approachMargin) / 220) * .48
        : 1;
      const desiredSpeedU = (nav.flightTargetU > .5 ? 1 : -1) * (urgency / baseDur);
      // Smooth velocity ramp so mid-flight reversals or urgency boosts are 100% C1 continuous!
      const velBlend = 1 - Math.exp(-dt * 16);
      nav.flightSpeedU += (desiredSpeedU - nav.flightSpeedU) * velBlend;
      nav.flightU = clamp(nav.flightU + nav.flightSpeedU * dt, 0, 1);

      const u = nav.flightU;
      const toIsContact = toCh >= 0 && !!layout[toCh]?.isContact;
      const fromIsContact = fromCh >= 0 && !!layout[fromCh]?.isContact;

      let targetX = nav.x;
      let targetW = nav.w;
      let targetFormation = 0;
      let targetRail = 0;
      let targetContact = 0;
      let targetDir = nav.flightDir;
      let inCorridor = false;

      if (nav.flightIsMobileHero) {
        // Mobile Hero bay <-> Right vertical lane strictly inside .mobile-flight
        const goingToLane = toCh >= 0;
        const p = smooth(u);
        const laneMix = goingToLane ? p : (1 - p);
        targetX = mix(width * .5, mobileLane ? mobileLane.x : width - 38, laneMix);
        targetW = mix(goingToLane ? nav.flightFromW : toPose.w, goingToLane ? toPose.w : nav.flightFromW, laneMix);
        targetFormation = Math.sin(p * Math.PI) * .48;
        targetRail = laneMix;
        targetContact = 0;
        targetDir = goingToLane ? 1 : -1;
        inCorridor = p > .05 && p < .95;
      } else if (nav.flightIsMobileArch) {
        // Mobile inter-section showcase: Right lane -> bold center showcase in open gap -> Right lane
        const mLaneX = mobileLane ? mobileLane.x : width - 38;
        const mRailW = mobileLane ? mobileLane.railW : 58;
        const arch = u < .26
          ? smooth(u / .26)
          : (u > .74 ? smooth((1 - u) / .26) : 1);
        targetX = mix(mLaneX, width * .50, arch);
        targetW = mix(mRailW, corridorW, arch);
        targetFormation = arch;
        targetRail = 1 - arch;
        targetContact = 0;
        targetDir = u < .5 ? -1 : 1;
        inCorridor = arch > .05;
      } else if (isMobile && (toIsContact || fromIsContact)) {
        // Mobile Right lane <-> Contact crest bay
        const mLaneX = mobileLane ? mobileLane.x : width - 38;
        const mRailW = mobileLane ? mobileLane.railW : 58;
        const contactPose = toIsContact ? toPose : fromPose;
        const p = smooth(u);
        const cMix = toIsContact ? p : (1 - p);
        targetX = mix(mLaneX, width * .5, cMix);
        targetW = mix(mRailW, contactPose.w, cMix);
        targetFormation = mix(0, contactPose.formation, cMix) + Math.sin(p * Math.PI) * .72 * (1 - contactPose.formation);
        targetRail = 1 - cMix;
        targetContact = cMix;
        targetDir = toIsContact ? -1 : 1;
        inCorridor = p > .08 && p < .92;
      } else {
        // Desktop / Laptop continuous smooth autonomous highway across the open inter-section sky!
        // Horizontal glide spans [0.05..0.95] (wide silky smoothstep, zero Phase 1/3 backup reversals!),
        // while formation smoothly compacts [0..0.20], holds bold crossing row [0.20..0.80], and unfurls [0.80..1.00].
        const endForm = toIsContact ? toPose.formation : 0;
        const startForm = fromIsContact ? fromPose.formation : 0;
        const pHoriz = smooth((u - .05) / .90);
        targetX = mix(nav.flightFromX, nav.flightToX, pHoriz);

        if (u < .20) {
          const p1 = smooth(u / .20);
          targetW = mix(nav.flightFromW, corridorW, p1);
          targetFormation = mix(startForm, 1, p1);
          targetContact = fromIsContact ? mix(1, .5, p1) : 0;
        } else if (u <= .80) {
          targetW = corridorW;
          targetFormation = 1;
          targetContact = toIsContact ? mix(0, .6, (u - .20) / .60) : (fromIsContact ? mix(.5, 0, (u - .20) / .60) : 0);
        } else {
          const p3 = smooth((u - .80) / .20);
          targetW = mix(corridorW, nav.flightToW, p3);
          targetFormation = mix(1, endForm, p3);
          targetContact = toIsContact ? mix(.6, 1, p3) : 0;
        }
        inCorridor = pHoriz > .08 && pHoriz < .88;
        targetDir = nav.flightTargetU > .5 ? nav.flightDir : -nav.flightDir;
      }

      // Compute vertical Y target strictly inside the open inter-section sky gap!
      // Use constant corridorW for streamHalfH throughout the flight so safeMinVis never drifts
      // downward as targetW ramps up (eliminating spring back-drift reversals on wheel ticks!)
      const streamHalfH = corridorW * .230 + PIECE_PAD + 6;
      const gapMinVis = liveGap.topVis + streamHalfH;
      const gapMaxVis = Math.max(gapMinVis, liveGap.bottomVis - streamHalfH);
      const safeMinVis = Math.max(gapMinVis, headerSafeBottom + streamHalfH);
      const safeMaxVis = Math.min(gapMaxVis, hudTop - streamHalfH);

      let desiredGapVisY = liveGap.midVis;
      if (toIsContact && u > .72) {
        desiredGapVisY = mix(liveGap.midVis, toPose.visY, smooth((u - .72) / .28));
      } else if (safeMaxVis - safeMinVis > 6) {
        // Hold near current height if already safely inside the leading half of the gap (zero wasted Y motion!),
        // otherwise aim cleanly inside the leading safe cushion for max headroom on 100px wheel ticks.
        const leadTarget = nav.scrollDir > 0
          ? (safeMinVis + Math.min(8, (safeMaxVis - safeMinVis) * .20))
          : (safeMaxVis - Math.min(8, (safeMaxVis - safeMinVis) * .20));
        desiredGapVisY = nav.scrollDir > 0
          ? Math.min(nav.flightFromVisY, leadTarget)
          : Math.max(nav.flightFromVisY, leadTarget);
      }

      if (safeMaxVis >= safeMinVis) {
        desiredGapVisY = clamp(desiredGapVisY, safeMinVis, safeMaxVis);
      } else {
        desiredGapVisY = clamp(desiredGapVisY, gapMinVis, gapMaxVis);
      }

      // Blend Y with exact C1 endpoint continuity:
      // - Phase 1 [0..0.16]: direct smoothstep flightFromVisY -> desiredGapVisY
      // - Phase 2 [0.16..0.78]: smooth critically-damped tracking inside desiredGapVisY
      // - Phase 3 [0.78..1.00]: direct smoothstep from captured exit Y -> toPose.visY
      //   so at u=1.0 nav.visY === toPose.visY EXACTLY (ZERO handoff snap!)
      const isDesktopFlight = !nav.flightIsMobileHero && !nav.flightIsMobileArch && !isMobile;
      if (isDesktopFlight && u < .16) {
        const p1 = smooth(u / .16);
        nav.visY = mix(nav.flightFromVisY, desiredGapVisY, p1);
        nav.vy = 0;
      } else if (isDesktopFlight && u >= .78) {
        if (!nav.flightExitCaptured) {
          nav.flightExitVisY = nav.visY;
          nav.flightExitCaptured = true;
        }
        const pExit = smooth((u - .78) / .22);
        nav.visY = mix(nav.flightExitVisY, toPose.visY, pExit);
        nav.vy = 0;
      } else {
        let targetVisY = desiredGapVisY;
        if (!isDesktopFlight && !inCorridor && u < .18) {
          targetVisY = mix(fromPose.visY, desiredGapVisY, smooth(u / .18));
        } else if (!isDesktopFlight && !inCorridor && u > .82) {
          targetVisY = mix(desiredGapVisY, toPose.visY, smooth((u - .82) / .18));
        }

        // Smooth critically-damped Y spring (ZERO hard lag clamp!)
        stepSpringAxis(nav.visY, nav.vy, targetVisY, 13.5, dt, 0);
        nav.visY = axisOut.pos;
        nav.vy = axisOut.vel;
      }

      // Strictly keep Y inside the physical open sky gap ONLY while horizontally crossing cards
      if (inCorridor) {
        const hardHalfH = targetW * .220 + PIECE_PAD + 2;
        const hardMin = Math.max(liveGap.topVis + hardHalfH, headerSafeBottom + hardHalfH);
        const hardMax = Math.min(liveGap.bottomVis - hardHalfH, hudTop - hardHalfH);
        if (hardMax >= hardMin) {
          if (nav.visY < hardMin) { nav.visY = hardMin; nav.vy = Math.max(0, nav.vy); }
          else if (nav.visY > hardMax) { nav.visY = hardMax; nav.vy = Math.min(0, nav.vy); }
        } else {
          const physMin = liveGap.topVis + hardHalfH;
          const physMax = Math.max(physMin, liveGap.bottomVis - hardHalfH);
          nav.visY = clamp(nav.visY, physMin, physMax);
          nav.vy = 0;
        }
      }

      // On desktop Phase 3 unfurl, gently keep expansion size within live vertical clearance of the lane
      // so expanding top/bottom pieces NEVER clip the previous chapter's bottom edge!
      if (isDesktopFlight && u > .82 && !toIsContact) {
        const destRow = layout[clamp(toCh, 0, layout.length - 1)];
        const prevRow = toCh > 0 ? layout[toCh - 1] : null;
        const nextRow = toCh < layout.length - 1 ? layout[toCh + 1] : null;
        let laneCeilVis = headerSafeBottom;
        let laneFloorVis = hudTop;
        if (prevRow && prevRow.side !== destRow.side) {
          const prevBot = prevRow.lastEl ? prevRow.lastEl.getBoundingClientRect().bottom : (prevRow.contentBottom - sy);
          laneCeilVis = Math.max(laneCeilVis, prevBot);
        }
        if (nextRow && nextRow.side !== destRow.side) {
          const nextTop = nextRow.firstEl ? nextRow.firstEl.getBoundingClientRect().top : (nextRow.contentTop - sy);
          laneFloorVis = Math.min(laneFloorVis, nextTop);
        }
        const availVert = Math.max(60, Math.min(nav.visY - laneCeilVis, laneFloorVis - nav.visY) - PIECE_PAD - 8);
        const maxOrbitW = availVert / .64;
        const unfurlWeight = 1 - targetFormation;
        if (unfurlWeight > .01 && targetW > maxOrbitW) {
          targetW = mix(targetW, Math.max(corridorW * .78, maxOrbitW), unfurlWeight);
        }
      }

      nav.x = targetX;
      nav.vx = 0;
      nav.w = targetW;
      nav.formation = targetFormation;
      nav.rail = targetRail;
      nav.contact = targetContact;
      nav.direction += (targetDir - nav.direction) * (1 - Math.exp(-dt * 12));

      if (!nav.flightArrivalFired && u >= .88 && nav.flightTargetU > .5 && !nav.flightIsMobileArch) {
        nav.flightArrivalFired = true;
        arrival = clock;
      }

      // Finish autonomous flight cleanly on endpoint!
      if ((nav.flightTargetU > .5 && u >= 1) || (nav.flightTargetU < .5 && u <= 0)) {
        nav.chapter = nav.flightTargetU > .5 ? toCh : fromCh;
        nav.flightActive = false;
        nav.flightCorridorIdx = -1;
        nav.flightSpeedU = 0;
      }

      areaOut.x = nav.x;
      areaOut.visY = nav.visY;
      areaOut.w = nav.w;
      areaOut.formation = nav.formation;
      areaOut.rail = nav.rail;
      areaOut.direction = nav.direction;
      areaOut.contact = nav.contact;
      areaOut.inCorridor = inCorridor;
      // Always report the lane closer to current nav.x so barrier NEVER teleports across a card!
      areaOut.safeLaneX = (u < .5) ? fromPose.safeLaneX : toPose.safeLaneX;
      return areaOut;
    }

    // 3. Calm Side-Lane Orbiting / Cruising (smooth critically-damped viewport-space springs, ZERO wheel snap!)
    const station = getStationPose(nav.chapter, sy, hudTop);
    const omegaX = 10.5;
    const omegaY = mix(9.0, 11.5, cinemaEnergy);
    stepSpringAxis(nav.x, nav.vx, station.x, omegaX, dt, 0);
    nav.x = axisOut.pos;
    nav.vx = axisOut.vel;

    stepSpringAxis(nav.visY, nav.vy, station.visY, omegaY, dt, 0);
    nav.visY = axisOut.pos;
    nav.vy = axisOut.vel;

    // Softly enforce side-lane physical ceiling/floor with actual nav.w radius so wheel ticks never hard-snap
    const actualHalfH = nav.w * .58 + PIECE_PAD + 4;
    const softMin = station.minVis - Math.max(0, (station.w * .64 + 14) - actualHalfH);
    const softMax = station.maxVis + Math.max(0, (station.w * .64 + 14) - actualHalfH);
    if (softMax >= softMin) {
      if (nav.visY < softMin) { nav.visY = softMin; nav.vy = Math.max(0, nav.vy); }
      else if (nav.visY > softMax) { nav.visY = softMax; nav.vy = Math.min(0, nav.vy); }
    }

    const blend = 1 - Math.exp(-dt * 10);
    nav.w += (station.w - nav.w) * blend;
    nav.formation += (station.formation - nav.formation) * blend;
    if (Math.abs(nav.formation - station.formation) < .002) nav.formation = station.formation;
    nav.rail += (station.rail - nav.rail) * blend;
    if (Math.abs(nav.rail - station.rail) < .002) nav.rail = station.rail;
    nav.contact += (station.contact - nav.contact) * blend;
    if (Math.abs(nav.contact - station.contact) < .002) nav.contact = station.contact;
    nav.direction += (1 - nav.direction) * (1 - Math.exp(-dt * 8));

    areaOut.x = nav.x;
    areaOut.visY = nav.visY;
    areaOut.w = nav.w;
    areaOut.formation = nav.formation;
    areaOut.rail = nav.rail;
    areaOut.direction = nav.direction;
    areaOut.contact = nav.contact;
    areaOut.inCorridor = false;
    areaOut.safeLaneX = station.safeLaneX;
    return areaOut;
  }

  // Exact minimum clearance from point (x, y) to every live obstacle rect and viewport edge
  function minObstacleClearance(x, y) {
    let best = Math.min(x - 6, width - 6 - x, y - 6, height - 6 - y);
    for (let i = 0; i < liveObstacleCount; i++) {
      const b = liveObstacles[i];
      const dx = Math.max(b.left - x, x - b.right, 0);
      const dy = Math.max(b.top - y, y - b.bottom, 0);
      const d = (dx > 0 && dy > 0) ? Math.hypot(dx, dy) : (dx > dy ? dx : dy);
      if (d < best) best = d;
      if (best <= 0) return 0;
    }
    return best;
  }

  // Check if horizontal segment from x1 to x2 at row y (half-height hh) hits any live obstacle
  function clampWakeTail(wx, wy, dir, desiredTail, hh) {
    const startX = wx;
    let maxLen = Math.abs(desiredTail);
    const stepSign = -Math.sign(dir || 1); // tail extends behind direction of travel
    for (let i = 0; i < liveObstacleCount; i++) {
      const b = liveObstacles[i];
      if (wy + hh < b.top - 4 || wy - hh > b.bottom + 4) continue;
      if (stepSign < 0) {
        if (b.right <= startX) {
          const gap = startX - b.right - 8;
          if (gap < maxLen) maxLen = Math.max(0, gap);
        } else if (b.left < startX) {
          return 0;
        }
      } else {
        if (b.left >= startX) {
          const gap = b.left - startX - 8;
          if (gap < maxLen) maxLen = Math.max(0, gap);
        } else if (b.right > startX) {
          return 0;
        }
      }
    }
    return Math.sign(dir || 1) * maxLen;
  }

  // Smooth, axis-consistent Circle-vs-AABB safety barrier (ZERO horizontal<->vertical flip-flopping!)
  function resolvePieceObstacles(pose, hudTop, safeLaneX, inCorridor) {
    let x = pose.wx;
    let y = pose.wy;
    const r = pose.r;
    const minDist = r + PIECE_PAD;
    const minX = r + 6;
    const maxX = Math.max(minX, width - r - 6);
    const minY = Math.max(r + 6, headerSafeBottom + r + PIECE_PAD);
    const maxY = Math.max(minY, Math.min(height - r - 6, hudTop - r - PIECE_PAD));

    x = clamp(x, minX, maxX);
    y = clamp(y, minY, maxY);

    for (let iter = 0; iter < 6; iter++) {
      let moved = false;
      for (let i = 0; i < liveObstacleCount; i++) {
        const b = liveObstacles[i];
        const cx = clamp(x, b.left, b.right);
        const cy = clamp(y, b.top, b.bottom);
        const dx = x - cx;
        const dy = y - cy;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDist * minDist) {
          const bMidX = (b.left + b.right) * .5;
          const bMidY = (b.top + b.bottom) * .5;
          const candTop = b.top - minDist;
          const candBot = b.bottom + minDist;
          const candL = b.left - minDist;
          const candR = b.right + minDist;

          if (b.isBand) {
            if (y <= bMidY && candTop >= minY) y = candTop;
            else if (candBot <= maxY) y = candBot;
            else if (candTop >= minY) y = candTop;
          } else {
            // Minimum-penetration escape among all valid sides: NEVER teleports 600px horizontally
            // when a 10px vertical push escapes cleanly, and never flips axes arbitrarily!
            const costTop = candTop >= minY ? Math.abs(y - candTop) : Infinity;
            const costBot = candBot <= maxY ? Math.abs(candBot - y) : Infinity;
            const costL = candL >= minX ? Math.abs(x - candL) * (safeLaneX < bMidX ? .85 : 1.05) : Infinity;
            const costR = candR <= maxX ? Math.abs(candR - x) * (safeLaneX >= bMidX ? .85 : 1.05) : Infinity;
            const vertBias = inCorridor ? .65 : 1.0;
            const vTop = costTop * vertBias;
            const vBot = costBot * vertBias;

            let best = vTop, bestAxis = 0;
            if (vBot < best) { best = vBot; bestAxis = 1; }
            if (costL < best) { best = costL; bestAxis = 2; }
            if (costR < best) { best = costR; bestAxis = 3; }

            if (Number.isFinite(best)) {
              if (bestAxis === 0) y = candTop;
              else if (bestAxis === 1) y = candBot;
              else if (bestAxis === 2) x = candL;
              else x = candR;
            } else if (distSq > 1e-4) {
              const dist = Math.sqrt(distSq);
              const push = minDist - dist;
              x += (dx / dist) * push;
              y += (dy / dist) * push;
            }
          }
          x = clamp(x, minX, maxX);
          y = clamp(y, minY, maxY);
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Ultra-tight bay fallback: if squeezed simultaneously between two opposing obstacles, scale sprite smoothly
    let worstOverlap = 0;
    for (let i = 0; i < liveObstacleCount; i++) {
      const b = liveObstacles[i];
      const cx = clamp(x, b.left, b.right);
      const cy = clamp(y, b.top, b.bottom);
      const d = Math.hypot(x - cx, y - cy);
      const deficit = (r + 4) - d;
      if (deficit > worstOverlap) worstOverlap = deficit;
    }
    if (worstOverlap > 0 && r > 1) {
      const shrink = clamp((r - worstOverlap) / r, 0.32, 1);
      pose.w *= shrink;
      pose.h *= shrink;
      pose.r *= shrink;
    }

    pose.wx = x;
    pose.wy = y;
  }

  function stampStar(x, y, r, isMint, alpha) {
    if (alpha <= .01 || r <= .2) return;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * Math.min(1, alpha);
    const extent = r * 4;
    ctx.drawImage(isMint ? mintStarSprite : violetStarSprite, x - extent, y - extent, extent * 2, extent * 2);
    ctx.globalAlpha = prevAlpha;
  }

  function atmosphere(w, t, progress, energy, contactMix, haloScale) {
    if (haloScale <= .32) return 0;
    const scaleFade = smooth((haloScale - .32) / .28);
    const effW = w * haloScale;
    const cinemaBoost = cinemaEnergy * .22 + scrollVelocity * .10;
    const finaleSoft = mix(1, .88, contactMix) * scaleFade;

    // Soft ambient orbital bloom (clamped strictly inside open clearance)
    const bloomAlpha = (.09 + cinemaEnergy * .14 + contactMix * .12) * finaleSoft;
    if (bloomAlpha > .02) {
      const prevAlpha = ctx.globalAlpha;
      const br = effW * .66;
      ctx.globalAlpha = prevAlpha * bloomAlpha;
      ctx.drawImage(orbitalBloomSprite, -br, -br * .76, br * 2, br * 1.52);
      ctx.globalAlpha = prevAlpha;
    }

    for (let lane = 0; lane < 2; lane++) {
      const isMint = lane === 1;
      const rgb = isMint ? '173,255,207' : '217,161,255';
      const rx = effW * (isMint ? .60 : .605);
      const ry = effW * (isMint ? .175 : .202);
      const baseTilt = mix(isMint ? .15 : -.38, isMint ? .12 : -.12, contactMix);
      const tiltAmp = mix(.085, .042, contactMix);
      const tilt = baseTilt + Math.sin(t * .74 + lane) * tiltAmp;
      const cy = effW * mix(isMint ? .11 : -.085, isMint ? .05 : -.05, contactMix);
      const head = (isMint ? -.54 : 3.05) + (isMint ? -.88 : 1.08) * t + progress * 2.1;

      ctx.save();
      ctx.translate(0, cy);
      ctx.rotate(tilt);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(.72, effW * .0018);

      const step = tau / ORBIT_SEGMENTS;
      for (let i = 0; i < ORBIT_SEGMENTS; i++) {
        const frac = i / ORBIT_SEGMENTS;
        const a = head - tau + frac * tau;
        const light = (.14 + .56 * frac * frac) * (1 + cinemaBoost * .5) * finaleSoft;
        ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, light).toFixed(3) + ')';
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, a, a + step + .005);
        ctx.stroke();
      }

      const tail = .52 + energy * .24 + cinemaEnergy * .28 + scrollVelocity * .15;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, head - tail, head);
      ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, (.12 + cinemaBoost * .22) * finaleSoft).toFixed(3) + ')';
      ctx.lineWidth = Math.max(3.6, effW * (.011 + cinemaEnergy * .003));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, (.32 + cinemaBoost * .24) * finaleSoft).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2.2, effW * .0055);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, (.92 + cinemaBoost * .06) * finaleSoft).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.1, effW * .0025);
      ctx.stroke();

      for (let i = 0; i < 4; i++) {
        const a = head - .14 * i;
        const shimmer = (1 - i * .2) * (1 + cinemaEnergy * .15);
        stampStar(Math.cos(a) * rx, Math.sin(a) * ry, Math.max(1.0, effW * .0088) * shimmer, isMint, Math.min(1, .90 * shimmer * finaleSoft));
      }
      ctx.restore();
    }

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const twinkle = .55 + .38 * Math.sin(t * (1.22 + (i % 3) * .37) + i * 1.8);
      const radius = Math.max(.85, (effW / 370) * s[2]) * (.78 + twinkle * .29) * (1 + cinemaEnergy * .08);
      const drift = .042 * Math.sin(t * .72 + i);
      stampStar(
        (s[0] + drift) * effW,
        (s[1] - drift * .62) * effW,
        radius,
        i % 4 === 0,
        Math.min(1, twinkle * (1 + cinemaEnergy * .16) * finaleSoft)
      );
    }

    return effW * .66;
  }

  function wakeWorld(wx, wy, size, strength, direction, index) {
    const desiredTail = direction * size * (.38 + cinemaEnergy * .10);
    const tail = clampWakeTail(wx, wy, direction, desiredTail, Math.max(8, size * .05));
    if (Math.abs(tail) < 6) return 0;

    const isMint = index % 2 !== 0;
    const color = isMint ? '173,255,207' : '217,161,255';
    ctx.lineCap = 'round';

    for (let band = 0; band < 2; band++) {
      const vertical = (band - .5) * size * .022;
      ctx.beginPath();
      ctx.moveTo(wx - tail, wy + vertical + size * .036);
      ctx.quadraticCurveTo(wx - tail * .44, wy + vertical - size * .026, wx, wy + vertical);
      ctx.strokeStyle = 'rgba(' + color + ',' + (strength * (.24 + cinemaEnergy * .14)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2.0, size * .010);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(wx - tail * .58, wy + vertical + size * .010);
      ctx.quadraticCurveTo(wx - tail * .24, wy + vertical - size * .015, wx, wy + vertical);
      ctx.strokeStyle = 'rgba(' + color + ',' + (strength * (.72 + cinemaEnergy * .16)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, size * .0048);
      ctx.stroke();
    }
    stampStar(wx - tail * .58, wy + size * .010, Math.max(1.0, size * .0062), isMint, strength * (.74 + cinemaEnergy * .14));
    return Math.abs(tail);
  }

  function arrivalGlow(size, elapsed, haloScale) {
    if (haloScale <= .35) return 0;
    const phase = unit(elapsed / .68);
    const glow = Math.sin(phase * Math.PI) * (1 - phase * .55) * smooth((haloScale - .35) / .25);
    if (glow <= .01) return 0;
    const eff = size * haloScale;
    ctx.save();
    ctx.rotate(-.24);
    for (let ring = 0; ring < 2; ring++) {
      const radius = eff * (.18 + .32 * smooth(phase) + ring * .068);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * .46, 0, 0, tau);
      ctx.strokeStyle = ring
        ? 'rgba(173,255,207,' + (glow * .55).toFixed(3) + ')'
        : 'rgba(217,161,255,' + (glow * .74).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, eff * .0075 * glow);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const angle = i * tau / 8 + .4;
      const radius = eff * (.15 + .40 * smooth(phase));
      stampStar(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * .56,
        Math.max(1.1, eff * .0088),
        i % 2 !== 0,
        glow
      );
    }
    ctx.restore();
    return eff * .58;
  }

  function draw(dt) {
    if (!ready || width < 2 || height < 2 || !hero) return;
    const sy = window.scrollY;
    const hudTop = collectLiveObstacles(sy);
    const progress = position;
    const t = clock;
    const chapter = updateChapter(progress);
    const area = advanceNavigation(sy, hudTop, dt);

    const formation = area.formation;
    const rail = area.rail;
    const contactMix = area.contact;
    const landed = t - arrival;
    const orbiting = 1 - smooth(Math.max(formation, rail) * 1.55);
    const energy = Math.sin(chapter.local * Math.PI) ** 2;

    // ALWAYS clear the ENTIRE raw backing buffer in identity pixel coordinates (zero ghosting on any zoom/DPR!)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / width;
    const scaleY = canvas.height / height;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    // Gentle 3D levitation (calm & strictly bounded inside open clearance)
    const drift = mix(1, .56, contactMix);
    const hoverX = Math.sin(t * .70) * area.w * .012 * drift * (1 - rail * .80) * (1 - formation * .90);
    const hoverY = Math.sin(t * .88) * area.w * .020 * drift * (1 - formation * .92);
    const centerX = area.x + hoverX;
    const centerY = area.visY + hoverY;

    // Group rotation (zeroed during horizontal corridor stream or mobile vertical ribbon)
    const pointerTurn = cursor.x * .030 + cursor.y * .010;
    const idleSway = (.044 * Math.sin(t * .68) + .018 * Math.cos(t * .39)) * drift;
    const normalTurn = idleSway
      + (.052 * Math.sin(t * .84) * drift + pointerTurn) * (.45 + .55 * Math.sin(progress * Math.PI))
      + .082 * Math.sin(progress * tau) * drift;
    const contactTurn = .038 * Math.sin(t * .64) * drift + pointerTurn * .42;
    const groupTurn = mix(normalTurn, contactTurn, contactMix) * (1 - Math.max(formation, rail));
    const cosG = Math.cos(groupTurn);
    const sinG = Math.sin(groupTurn);

    // Compute world coordinates & true bounding radii of all 4 puzzle pieces
    for (let i = 0; i < art.length; i++) {
      const p = art[i];
      const pose = poses[i];
      const beat = unit((chapter.local - i * .037) / (.87 - i * .037));
      const openFactor = mix(1, .28, contactMix);
      const open = (Math.sin(beat * Math.PI) ** 2) * openFactor * orbiting;
      const breath = .5 - .5 * Math.cos(t * (1.36 + i * .092) + i * .64);
      const normalSpread = .10 + (.24 * breath + (.56 + cinemaEnergy * .06) * open) * mix(.34, 1, orbiting);
      const contactSpread = .08 + .14 * breath * drift;
      const spread = mix(normalSpread, contactSpread, contactMix);
      const idleX = Math.cos(t * 1.06 + i * 1.92) * (.009 + .022 * open) * drift;
      const idleY = Math.sin(t * 1.38 + i * 1.68) * (.016 + .022 * open) * drift;
      const ox = p.cx * (1 + spread) + idleX;
      const oy = p.cy * (1 + spread) + idleY - (i === 0 ? .044 : 0);
      const baseTurn = p.turn * (.12 + .64 * breath + open * (1.65 + .26 * Math.sin(chapter.index + i))) * drift;
      const fit = 1 - .25 * open;
      const inset = .90 - .08 * open;
      // Calm, low-frequency crossing wave so pieces NEVER bounce off gap margins
      const bob = Math.sin(t * 2.4 - p.lane * 1.25);

      // Blend: Orbiting cluster <-> Horizontal corridor stream (`formation`) <-> Mobile vertical right-lane ribbon (`rail`)
      let lx = area.w * ox * fit;
      let ly = area.w * oy * fit;
      let scale = area.w * fit * inset;
      let localTurn = baseTurn;

      if (formation > .001) {
        lx = mix(lx, area.w * p.lane * .52, formation);
        ly = mix(ly, area.w * bob * .008, formation);
        scale = mix(scale, area.w * .72, formation);
        localTurn = mix(localTurn, area.direction * (.11 + bob * .022), formation);
      }
      if (rail > .001) {
        lx = mix(lx, area.w * bob * .014, rail);
        ly = mix(ly, area.w * p.lane * .36, rail);
        scale = mix(scale, area.w * .45, rail);
        localTurn = mix(localTurn, bob * .10, rail);
      }

      const wx = centerX + lx * cosG - ly * sinG;
      const wy = centerY + lx * sinG + ly * cosG;
      const totalTurn = groupTurn + localTurn;
      const pw = p.width * scale;
      const ph = p.height * scale;
      const cT = Math.abs(Math.cos(totalTurn));
      const sT = Math.abs(Math.sin(totalTurn));
      const halfW = (cT * pw + sT * ph) * .5;
      const halfH = (sT * pw + cT * ph) * .5;

      pose.image = p.image;
      pose.wx = wx;
      pose.wy = wy;
      pose.turn = totalTurn;
      pose.w = pw;
      pose.h = ph;
      pose.r = Math.max(halfW, halfH);
      pose.lane = p.lane;

      // Axis-consistent safety barrier (rarely even invoked due to built-in >= 14px margin!)
      resolvePieceObstacles(pose, hudTop, area.safeLaneX, area.inCorridor);
    }

    // Compute safe halo scale from exact clearance around centerX, centerY (shrink immediately, expand smoothly)
    const centerClearance = minObstacleClearance(centerX, centerY);
    const maxSafeHaloR = Math.max(0, centerClearance - 14);
    const desiredHaloR = Math.max(1, area.w * .66);
    const rawHaloScale = Math.min(1, maxSafeHaloR / desiredHaloR);
    if (rawHaloScale < nav.haloScale) {
      nav.haloScale = rawHaloScale;
    } else {
      nav.haloScale += (rawHaloScale - nav.haloScale) * (1 - Math.exp(-dt * 10));
    }
    const haloScale = Math.min(rawHaloScale, nav.haloScale);

    let drawnHaloR = 0;

    const showAtmosphere = rail < .65 && formation < .92 && haloScale > .32;
    const showArrival = landed >= 0 && landed < .68 && haloScale > .35;

    ctx.save();

    // 1. Orbital atmosphere & arrival shimmer strictly clamped to open clearance
    if (showAtmosphere || showArrival) {
      ctx.save();
      ctx.translate(centerX, centerY);
      if (showAtmosphere) {
        ctx.globalAlpha = (1 - formation * .92) * (1 - rail * .92) * mix(1, .94, contactMix);
        drawnHaloR = Math.max(drawnHaloR, atmosphere(area.w, t, progress, energy, contactMix, haloScale));
        ctx.globalAlpha = 1;
      }
      if (showArrival) {
        drawnHaloR = Math.max(drawnHaloR, arrivalGlow(area.w, landed, haloScale));
      }
      ctx.restore();
    }

    // 2. Comet wakes during corridor flight (clamped so tails never cross obstacles)
    if (formation > .03) {
      for (let i = 0; i < poses.length; i++) {
        const p = poses[i];
        wakeWorld(p.wx, p.wy, area.w, formation, area.direction, i);
      }
    }

    // 3. Draw all 4 puzzle pieces intact (ZERO clearRect chopping!) & update telemetry + particle field
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const offset = i * 3;
      particleField[offset] = p.wx;
      particleField[offset + 1] = p.wy;
      particleField[offset + 2] = p.r * 1.1;

      debugState.pieces[i].x = p.wx;
      debugState.pieces[i].y = p.wy;
      debugState.pieces[i].r = p.r;

      if (!p.image) continue;
      ctx.save();
      ctx.translate(p.wx, p.wy);
      ctx.rotate(p.turn);
      ctx.drawImage(p.image, -p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    ctx.restore();

    frameCount++;
    debugState.x = centerX;
    debugState.y = centerY;
    debugState.w = area.w;
    debugState.t = t;
    debugState.frame = frameCount;
    debugState.formation = formation;
    debugState.contact = contactMix;
    debugState.haloRadius = drawnHaloR;
    debugState.chapter = nav.chapter;
    debugState.corridorActive = nav.flightActive;

    window.dispatchEvent(particleEvent);
  }

  function schedule() {
    if (!document.hidden && !frame && ready) {
      frame = requestAnimationFrame(tick);
    }
  }

  // Native 60fps+ continuous animation loop (always active by default, pauses only when hidden)
  function tick(now) {
    frame = 0;
    if (document.hidden || !ready) return;

    // Detect browser zoom (Ctrl+Scroll), DPR changes, or viewport changes reliably every frame
    const curDpr = window.devicePixelRatio || 1;
    if (Math.abs(curDpr - lastDpr) > .001 || window.innerWidth !== lastWinW || window.innerHeight !== lastWinH) {
      measure();
    }

    const elapsed = previous ? (now - previous) : 16.667;
    const dt = Math.min(.034, Math.max(.001, elapsed / 1000));
    previous = now;

    const cinemaTarget = cinemaPlaying ? 1 : 0;
    cinemaEnergy += (cinemaTarget - cinemaEnergy) * (1 - Math.exp(-dt * 4.5));
    if (Math.abs(cinemaEnergy - cinemaTarget) < .002) cinemaEnergy = cinemaTarget;
    scrollVelocity *= Math.exp(-dt * 5.5);

    const speedBoost = 1 + cinemaEnergy * (.18 * cinemaSpeed) + scrollVelocity * .24;
    clock += dt * speedBoost;

    const trackRate = cinemaPlaying ? 12 : 9;
    position += (target - position) * (1 - Math.exp(-dt * trackRate));
    if (Math.abs(position - target) < .00035) position = target;

    const smoothPointer = 1 - Math.exp(-dt * 7);
    cursor.x = mix(cursor.x, cursor.tx, smoothPointer);
    cursor.y = mix(cursor.y, cursor.ty, smoothPointer);

    draw(dt);
    schedule();
  }

  function handleProgress(progressValue, velocityValue) {
    const sy = window.scrollY;
    if (Number.isFinite(progressValue)) {
      target = unit(progressValue);
    } else {
      target = unit(sy / distance);
    }
    if (Number.isFinite(velocityValue)) {
      scrollVelocity = Math.max(scrollVelocity, unit(velocityValue));
    }
    schedule();
  }

  window.addEventListener('curriculo:cinema', e => {
    const detail = e.detail;
    if (!detail) return;
    cinemaPlaying = detail.state === 'playing';
    if (Number.isFinite(detail.speed) && detail.speed > 0) cinemaSpeed = detail.speed;
    if (Number.isFinite(detail.progress)) target = unit(detail.progress);
    schedule();
  });

  window.addEventListener('curriculo:scroll', e => {
    const detail = e.detail;
    handleProgress(detail?.progress, detail?.velocity);
  });

  window.addEventListener('cv-progress', e => {
    handleProgress(e.detail, undefined);
  });

  window.addEventListener('scroll', () => {
    handleProgress(undefined, undefined);
  }, { passive: true });

  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || width <= 0 || height <= 0) return;
    cursor.tx = clamp(2 * e.clientX / width - 1, -1, 1);
    cursor.ty = clamp(2 * e.clientY / height - 1, -1, 1);
  }, { passive: true });

  document.addEventListener('pointerleave', () => { cursor.tx = cursor.ty = 0; });

  document.addEventListener('visibilitychange', () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    if (!document.hidden) schedule();
  });

  window.addEventListener('resize', measure, { passive: true });
  window.visualViewport?.addEventListener('resize', measure, { passive: true });
  window.addEventListener('load', measure, { once: true });
  if (window.ResizeObserver) new ResizeObserver(measure).observe(main);
  document.fonts?.ready.then(measure);

  measure();
  Promise.all(art.map(p => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { p.image = img; resolve(); };
    img.onerror = () => reject(new Error('Falha ao carregar ' + p.file));
    img.src = new URL(p.file, artBase).href;
  }))).then(() => {
    ready = true;
    schedule();
  }).catch(error => console.error(error));
})();
