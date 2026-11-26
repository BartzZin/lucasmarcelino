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
  const pathSample = {
    x: 0,
    docY: 0,
    visY: 0,
    w: 0,
    formation: 0,
    rail: 0,
    direction: 1,
    contact: 0,
    inCorridor: false
  };
  const nextSample = {
    x: 0,
    docY: 0,
    visY: 0,
    w: 0,
    formation: 0,
    rail: 0,
    direction: 1,
    contact: 0,
    inCorridor: false
  };
  const axisOut = { pos: 0, vel: 0 };
  const pathSpring = {
    s: 0,
    vs: 0,
    formation: 0,
    direction: 1,
    contact: 0,
    rail: 0,
    initialized: false
  };
  const paintedRect = { x: 0, y: 0, w: 0, h: 0, active: false };

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
  let layout = [], corridors = [], marks = [0, 1];
  let hero = null, flight = null, mobileLane = null;
  let cachedObstacles = [];
  let headerSafeBottom = 76;
  let target = 0, position = 0, clock = .4, previous = 0, frame = 0, frameCount = 0, ready = false;
  let arrival = -10;
  let cinemaPlaying = false, cinemaEnergy = 0, cinemaSpeed = 1, scrollVelocity = 0;
  const cursor = { x: 0, y: 0, tx: 0, ty: 0 };

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

  function buildCorridors() {
    const list = [];
    if (!hero || !layout.length) {
      corridors = list;
      return;
    }

    const isMobile = width <= 800;
    const focusRatio = isMobile ? .44 : .46;
    const halfBand = isMobile
      ? Math.min(96, Math.max(66, height * .115))
      : Math.min(168, Math.max(96, readingHeight * .21));
    const maxFocus = distance + readingHeight * focusRatio;

    // Corridor 0: Hero -> Chapter 0 (#trajetoria)
    const first = layout[0];
    if (isMobile) {
      const bayTop = hero.docBottom + 10;
      const bayBottom = first.contentTop - 10;
      const bayMid = (bayTop + bayBottom) * .5;
      // Start gliding right early inside .mobile-flight and finish entering the right lane
      // BEFORE #trajetoria h2 reaches the upper viewport!
      const heroStart = Math.min(bayMid - 18, readingHeight * focusRatio + 24);
      const heroEnd = Math.max(heroStart + 96, first.contentTop - 22);
      list.push({
        start: heroStart,
        end: heroEnd,
        gapTop: bayTop,
        gapBottom: bayBottom,
        gapMid: bayMid,
        crossSide: true,
        isHeroExit: true
      });
    } else {
      const gapTop = hero.docBottom;
      const gapBottom = first.contentTop;
      const gapMid = (gapTop + gapBottom) * .5;
      const start = Math.max(readingHeight * focusRatio + 18, hero.docTop + hero.h * .55);
      const end = Math.max(start + 120, first.contentTop + 72);
      list.push({
        start,
        end,
        gapTop,
        gapBottom,
        gapMid,
        crossSide: first.side !== 1,
        isHeroExit: true
      });
    }

    // Corridors 1..N-1: Chapter (i-1) -> Chapter i
    for (let i = 1; i < layout.length; i++) {
      const prev = layout[i - 1];
      const next = layout[i];
      const gapTop = prev.contentBottom;
      const gapBottom = next.contentTop;
      const gapMid = (gapTop + gapBottom) * .5;
      let start = gapMid - halfBand;
      let end = gapMid + halfBand;

      if (next.isContact) {
        const panelCenter = (next.contentTop + next.contentBottom) * .5;
        const restSy = clamp(panelCenter - height * .5, 0, distance);
        const restFocus = Math.min(maxFocus, restSy + readingHeight * focusRatio);
        // Finish crossing strictly ABOVE .contact-panel.top and before restFocus/maxFocus
        end = Math.min(gapBottom - 20, restFocus - 24);
        start = Math.max(prev.contentTop + 56, end - halfBand * 1.85);
      }

      if (end < start + 64) end = start + 64;
      list.push({
        start,
        end,
        gapTop,
        gapBottom,
        gapMid,
        crossSide: isMobile ? true : (prev.side !== next.side),
        isHeroExit: false
      });
    }

    // Strictly non-overlapping corridor bands for C1 continuity
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (a.end > b.start - 12) {
        const split = (a.end + b.start) * .5;
        a.end = Math.max(a.start + 36, split - 6);
        b.start = Math.min(b.end - 36, split + 6);
      }
    }

    corridors = list;
  }

  function measure() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!width || !height) return;

    ratio = Math.min(1.75, window.devicePixelRatio || 1);
    ratio = Math.min(ratio, Math.sqrt(4_500_000 / (width * height)));
    const pw = Math.max(1, Math.round(width * ratio));
    const ph = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      paintedRect.active = false;
    }

    const sy = window.scrollY;
    const isMobile = width <= 800;
    const contentBox = main.getBoundingClientRect();
    const introRect = intro
      ? getRestDocRect(intro, sy)
      : { left: contentBox.left, right: contentBox.left + contentBox.width * .6, docTop: 0, docBottom: height * .8, width: contentBox.width * .6, height: height * .8 };

    // Hero open lane (desktop right of .intro)
    const heroLaneLeft = introRect.right + LANE_PAD;
    const heroLaneRight = width - EDGE_PAD;
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
    flight = slotRect && slotRect.height > 20
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
      for (let j = 0; j < innerNodes.length; j++) {
        const rr = getRestDocRect(innerNodes[j], sy);
        if (rr.width <= 0 || rr.height <= 0) continue;
        if (rr.docTop < minTop) minTop = rr.docTop;
        if (rr.docBottom > maxBottom) maxBottom = rr.docBottom;
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
          Math.max(104, (gapAbove - 36) / 1.44),
          readingHeight * .30,
          (maxRight - minLeft) * .30,
          216
        );
        layout.push({
          top: secBox.top + sy,
          bottom: secBox.bottom + sy,
          contentTop: minTop,
          contentBottom: maxBottom,
          contentLeft: minLeft,
          contentRight: maxRight,
          x: (minLeft + maxRight) * .5,
          usableW: Math.max(80, width - EDGE_PAD * 2),
          side: 0,
          isContact: true,
          contactW,
          laneW: contactW
        });
      } else {
        const onLeft = (minLeft + maxRight) < (contentBox.left + contentBox.right);
        const laneLeft = onLeft ? (maxRight + LANE_PAD) : EDGE_PAD;
        const laneRight = onLeft ? (width - EDGE_PAD) : (minLeft - LANE_PAD);
        const usableW = Math.max(64, laneRight - laneLeft);
        const laneW = Math.min(
          usableW / 1.44,
          readingHeight * .48,
          Math.max(140, maxBottom - minTop) * .55
        );
        layout.push({
          top: secBox.top + sy,
          bottom: secBox.bottom + sy,
          contentTop: minTop,
          contentBottom: maxBottom,
          contentLeft: minLeft,
          contentRight: maxRight,
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
        // Vertical 4-piece ribbon fits effortlessly inside mobile right lane
        railW: clamp(mUsable * 1.48, 44, 88)
      };
    } else {
      mobileLane = null;
    }

    cacheObstacles(sy);

    distance = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    marks = [0];
    for (let i = 0; i < layout.length; i++) {
      const mark = unit((layout[i].top - readingHeight * .46) / distance);
      if (mark > marks[marks.length - 1] + .028 && mark < .96) marks.push(mark);
    }
    marks.push(1);

    buildCorridors();

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
      const fittedW = Math.min(wingW / 1.44, 152);
      const visMid = clamp((headerSafeBottom + hudTop) * .5, headerSafeBottom + fittedW * .70 + 10, hudTop - fittedW * .70 - 10);
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
    const maxWFromHeight = Math.max(64, (clampedBayH - 14) / 1.40);
    const maxWFromWidth = (width - EDGE_PAD * 2 - 16) / 1.44;
    const fittedW = Math.min(row.contactW, maxWFromHeight, maxWFromWidth, isMobile ? 156 : 212);
    const compact = clampedBayH < 128 ? smooth((128 - clampedBayH) / 56) * .55 : 0;
    return { x: row.x, bayTopDoc, bayBottomDoc, bayH: clampedBayH, bayMidDoc, fittedW, compact };
  }

  function heroStationW() {
    return Math.min(hero.usableW / 1.44, hero.h * .60, readingHeight * .56);
  }

  // Evaluate 100% obstacle-free 1D corridor-locked path at scalar document parameter `s`
  function evalSafePath(s, sy, hudTop, out) {
    const isMobile = width <= 800;

    if (isMobile) {
      evalMobileSafePath(s, sy, hudTop, out);
      return out;
    }

    const heroW = heroStationW();
    const heroMinDocY = headerSafeBottom + heroW * .70 + 10;
    const heroDocY = Math.max(heroMinDocY, hero.docTop + hero.h * .49);

    if (!corridors.length || s <= corridors[0].start) {
      out.x = hero.x;
      out.docY = heroDocY;
      out.visY = out.docY - sy;
      out.w = heroW;
      out.formation = 0;
      out.rail = 0;
      out.direction = 1;
      out.contact = 0;
      out.inCorridor = false;
      return out;
    }

    for (let k = 0; k < corridors.length; k++) {
      const c = corridors[k];
      const next = layout[Math.min(layout.length - 1, k)];
      const prev = k === 0 ? null : layout[k - 1];

      if (s < c.end) {
        const u = unit((s - c.start) / Math.max(1, c.end - c.start));

        if (!c.crossSide) {
          // Same-side transition (Hero -> #trajetoria, both in Right lane)
          const endDocY = clamp(c.end, next.contentTop + 36, next.contentBottom - 36);
          const curDocY = mix(heroDocY, endDocY, smooth(u));
          // Only shift X from heroLane to trajLane once clear of .intro bottom
          const clearT = smooth((curDocY - (hero.docBottom - 10)) / 90);
          out.x = mix(hero.x, next.x, clearT);
          out.docY = curDocY;
          out.visY = out.docY - sy;
          out.w = mix(heroW, next.laneW, smooth(u));
          out.formation = 0;
          out.rail = 0;
          out.direction = 1;
          out.contact = 0;
          out.inCorridor = false;
          return out;
        }

        // Cross-side corridor: 3-phase locked highway through open inter-section sky!
        // Phase 1 [0..0.22]: Stay in prev side lane, descend to gapMid, compact to horizontal stream.
        // Phase 2 [0.22..0.78]: LOCK Y strictly inside [gapTop, gapBottom] & [header, hud], glide X across!
        // Phase 3 [0.78..1.00]: Stay in next side lane (or contact center), unfurl & settle.
        const startX = prev ? prev.x : hero.x;
        const startW = prev ? prev.laneW : heroW;
        const startDocY = prev
          ? clamp(c.start, prev.contentTop + 32, Math.max(prev.contentTop + 32, Math.min(c.gapMid, prev.contentBottom - 32)))
          : heroDocY;

        let endX = next.x;
        let endW = next.laneW;
        let endDocY = clamp(c.end, Math.min(next.contentBottom - 32, Math.max(c.gapMid, next.contentTop + 32)), Math.max(next.contentTop + 32, next.contentBottom - 32));
        let lockedDocY = c.gapMid;
        let endCompact = 0;

        if (next.isContact) {
          const bay = computeContactBay(next, sy, hudTop);
          endX = bay.x;
          endW = bay.fittedW;
          endDocY = bay.bayMidDoc;
          lockedDocY = clamp(bay.bayMidDoc, c.gapTop + 34, c.gapBottom - 34);
          endCompact = bay.compact;
        }

        const gapH = Math.max(64, c.gapBottom - c.gapTop);
        // Horizontal flight stream vertical total height is ~0.26*w -> fits effortlessly inside gapH
        const corridorW = Math.min(startW, Math.max(endW, 130), (gapH - 54) / .38, 224);
        const streamHalfH = corridorW * .16 + 18;
        const gapMinDocY = c.gapTop + streamHalfH;
        const gapMaxDocY = Math.max(gapMinDocY, c.gapBottom - streamHalfH);
        const safeMinDocY = Math.max(gapMinDocY, sy + headerSafeBottom + streamHalfH);
        const safeMaxDocY = Math.min(gapMaxDocY, sy + hudTop - streamHalfH);
        if (safeMaxDocY >= safeMinDocY) {
          lockedDocY = clamp(lockedDocY, safeMinDocY, safeMaxDocY);
        } else {
          // NEVER leave the physical inter-section corridor [gapMinDocY, gapMaxDocY]!
          lockedDocY = clamp(lockedDocY, gapMinDocY, gapMaxDocY);
        }

        const dir = Math.sign(endX - startX) || 1;
        out.direction = dir;
        out.rail = 0;

        if (u < .16) {
          const p1 = smooth(u / .16);
          out.x = startX;
          out.docY = mix(startDocY, lockedDocY, p1);
          out.w = mix(startW, corridorW, p1);
          out.formation = p1;
          out.contact = 0;
          out.inCorridor = p1 > .25;
        } else if (u <= .84) {
          const p2 = smooth((u - .16) / .68);
          out.x = mix(startX, endX, p2);
          out.docY = lockedDocY;
          out.w = corridorW;
          out.formation = 1;
          out.contact = next.isContact ? p2 * .5 : 0;
          out.inCorridor = true;
        } else {
          const p3 = smooth((u - .84) / .16);
          out.x = endX;
          out.docY = mix(lockedDocY, endDocY, p3);
          out.w = mix(corridorW, endW, p3);
          out.formation = mix(1, endCompact, p3);
          out.contact = next.isContact ? mix(.5, 1, p3) : 0;
          out.inCorridor = p3 < .75;
        }

        out.visY = out.docY - sy;
        return out;
      }

      // Resting / cruising inside chapter `next` side lane (strictly between corridors)
      if (k === corridors.length - 1 || s <= corridors[k + 1].start) {
        if (next.isContact) {
          const bay = computeContactBay(next, sy, hudTop);
          out.x = bay.x;
          out.docY = bay.bayMidDoc;
          out.visY = out.docY - sy;
          out.w = bay.fittedW;
          out.formation = bay.compact;
          out.rail = 0;
          out.direction = 1;
          out.contact = 1;
          out.inCorridor = false;
          return out;
        }

        const segStart = c.end;
        const segEnd = k < corridors.length - 1 ? corridors[k + 1].start : next.contentBottom;
        const segLen = Math.max(1, segEnd - segStart);
        const segT = unit((s - segStart) / segLen);
        // Gentle editorial wave that vanishes smoothly at both corridor boundaries
        const waveEnv = Math.sin(segT * Math.PI);
        const wave = Math.sin(segT * tau) * 14 * waveEnv * waveEnv;

        const minDoc = next.contentTop + 32;
        const maxDoc = Math.max(minDoc, next.contentBottom - 32);
        let docY = clamp(s + wave, minDoc, maxDoc);

        // Keep comfortably inside visible vertical viewport bounds (clear of header & cinema HUD)
        const halfH = next.laneW * .66 + 12;
        const visMin = sy + headerSafeBottom + halfH;
        const visMax = sy + hudTop - halfH;
        if (visMax > visMin) {
          docY = clamp(docY, Math.max(minDoc, visMin), Math.min(maxDoc, visMax));
        }

        out.x = next.x;
        out.docY = docY;
        out.visY = docY - sy;
        out.w = next.laneW;
        out.formation = 0;
        out.rail = 0;
        out.direction = 1;
        out.contact = 0;
        out.inCorridor = false;
        return out;
      }
    }

    // Fallback to last station
    const last = layout[layout.length - 1];
    const bay = computeContactBay(last, sy, hudTop);
    out.x = bay.x;
    out.docY = bay.bayMidDoc;
    out.visY = out.docY - sy;
    out.w = bay.fittedW;
    out.formation = bay.compact;
    out.rail = 0;
    out.direction = 1;
    out.contact = 1;
    out.inCorridor = false;
  }

  // Mobile 1D safe path: Hero bay -> open right vertical lane -> open inter-section corridors -> Contact bay
  function evalMobileSafePath(s, sy, hudTop, out) {
    const first = layout[0];
    const bayTop = hero.docBottom + 12;
    const bayBottom = first ? first.contentTop - 12 : (flight ? flight.docBottom - 12 : bayTop + 200);
    const bayH = Math.max(80, bayBottom - bayTop);
    const bayMid = (bayTop + bayBottom) * .5;
    const heroBayW = Math.min((width - 36) / 1.44, (bayH - 20) / 1.44, 210);
    const mLaneX = mobileLane ? mobileLane.x : width - 38;
    const mRailW = mobileLane ? mobileLane.railW : 58;

    if (!corridors.length || s <= corridors[0].start) {
      out.x = width * .5;
      out.docY = bayMid;
      out.visY = bayMid - sy;
      out.w = heroBayW;
      out.formation = 0;
      out.rail = 0;
      out.direction = 1;
      out.contact = 0;
      out.inCorridor = false;
      return out;
    }

    for (let k = 0; k < corridors.length; k++) {
      const c = corridors[k];
      const next = layout[Math.min(layout.length - 1, k)];

      if (s < c.end) {
        const u = unit((s - c.start) / Math.max(1, c.end - c.start));

        // Corridor 0: Mobile Hero bay -> Right open lane (glide right strictly inside .mobile-flight!)
        if (c.isHeroExit) {
          const safeExitDocY = clamp(bayMid + 18, bayTop + 34, Math.max(bayTop + 34, bayBottom - 34));
          const enterLaneDocY = clamp(next.contentTop + 26, safeExitDocY, Math.max(safeExitDocY, next.contentBottom - 26));
          if (u < .68) {
            const p1 = smooth(u / .68);
            out.x = mix(width * .5, mLaneX, p1);
            out.docY = mix(bayMid, safeExitDocY, p1);
            out.w = mix(heroBayW, mRailW, p1);
            out.formation = Math.sin(p1 * Math.PI) * .60;
            out.rail = p1;
            out.direction = 1;
            out.contact = 0;
            out.inCorridor = true;
          } else {
            const p2 = smooth((u - .68) / .32);
            out.x = mLaneX;
            out.docY = mix(safeExitDocY, enterLaneDocY, p2);
            out.w = mRailW;
            out.formation = 0;
            out.rail = 1;
            out.direction = 1;
            out.contact = 0;
            out.inCorridor = false;
          }
          out.visY = out.docY - sy;
          return out;
        }

        // Last corridor: Right open lane -> Mobile Contact bay above .contact-panel
        if (next.isContact) {
          const bay = computeContactBay(next, sy, hudTop);
          const startDocY = clamp(c.start, layout[k - 1].contentTop + 32, bay.bayMidDoc);
          const lockedDocY = clamp(bay.bayMidDoc, c.gapTop + 30, c.gapBottom - 30);
          if (u < .24) {
            const p1 = smooth(u / .24);
            out.x = mLaneX;
            out.docY = mix(startDocY, lockedDocY, p1);
            out.w = mRailW;
            out.formation = 0;
            out.rail = 1;
            out.direction = -1;
            out.contact = 0;
            out.inCorridor = false;
          } else if (u <= .76) {
            const p2 = smooth((u - .24) / .52);
            out.x = mix(mLaneX, width * .5, p2);
            out.docY = lockedDocY;
            out.w = mix(mRailW, Math.min(bay.fittedW, 132), p2);
            out.formation = Math.sin(p2 * Math.PI) * .85;
            out.rail = 1 - p2;
            out.direction = -1;
            out.contact = p2 * .6;
            out.inCorridor = true;
          } else {
            const p3 = smooth((u - .76) / .24);
            out.x = width * .5;
            out.docY = mix(lockedDocY, bay.bayMidDoc, p3);
            out.w = mix(Math.min(bay.fittedW, 132), bay.fittedW, p3);
            out.formation = mix(0, bay.compact, p3);
            out.rail = 0;
            out.direction = -1;
            out.contact = mix(.6, 1, p3);
            out.inCorridor = false;
          }
          out.visY = out.docY - sy;
          return out;
        }

        // Inter-section mobile corridor: glide gracefully out into open sky between chapters & back to right lane!
        const gapH = Math.max(56, c.gapBottom - c.gapTop);
        const corridorW = Math.min((width - 48) * .56, (gapH - 42) / .40, 152);
        const streamHalfH = corridorW * .16 + 16;
        const gapMin = c.gapTop + streamHalfH;
        const gapMax = Math.max(gapMin, c.gapBottom - streamHalfH);
        const safeMin = Math.max(gapMin, sy + headerSafeBottom + streamHalfH);
        const safeMax = Math.min(gapMax, sy + hudTop - streamHalfH);
        const lockedDocY = safeMax >= safeMin ? clamp(c.gapMid, safeMin, safeMax) : clamp(c.gapMid, gapMin, gapMax);
        const prevSec = layout[k - 1];
        const startDocY = prevSec
          ? clamp(c.start, prevSec.contentTop + 26, Math.max(prevSec.contentTop + 26, Math.min(lockedDocY, prevSec.contentBottom - 26)))
          : Math.min(c.start, lockedDocY);
        const endDocY = clamp(c.end, Math.min(next.contentBottom - 26, Math.max(lockedDocY, next.contentTop + 26)), Math.max(next.contentTop + 26, next.contentBottom - 26));

        if (u < .22) {
          const p1 = smooth(u / .22);
          out.x = mLaneX;
          out.docY = mix(startDocY, lockedDocY, p1);
          out.w = mRailW;
          out.formation = 0;
          out.rail = 1;
          out.direction = -1;
          out.contact = 0;
          out.inCorridor = false;
        } else if (u <= .78) {
          const phase = (u - .22) / .56;
          const arch = Math.sin(phase * Math.PI);
          const archSmooth = smooth(arch);
          out.x = mix(mLaneX, width * .46, archSmooth);
          out.docY = lockedDocY;
          out.w = mix(mRailW, corridorW, archSmooth);
          out.formation = archSmooth;
          out.rail = 1 - archSmooth;
          out.direction = phase < .5 ? -1 : 1;
          out.contact = 0;
          out.inCorridor = true;
        } else {
          const p3 = smooth((u - .78) / .22);
          out.x = mLaneX;
          out.docY = mix(lockedDocY, endDocY, p3);
          out.w = mRailW;
          out.formation = 0;
          out.rail = 1;
          out.direction = 1;
          out.contact = 0;
          out.inCorridor = false;
        }
        out.visY = out.docY - sy;
        return out;
      }

      if (k === corridors.length - 1 || s <= corridors[k + 1].start) {
        if (next.isContact) {
          const bay = computeContactBay(next, sy, hudTop);
          out.x = width * .5;
          out.docY = bay.bayMidDoc;
          out.visY = out.docY - sy;
          out.w = bay.fittedW;
          out.formation = bay.compact;
          out.rail = 0;
          out.direction = 1;
          out.contact = 1;
          out.inCorridor = false;
          return out;
        }

        const minDoc = next.contentTop + 26;
        const maxDoc = Math.max(minDoc, next.contentBottom - 26);
        let docY = clamp(s, minDoc, maxDoc);
        const railHalfH = mRailW * .62 + 10;
        const visMin = sy + headerSafeBottom + railHalfH;
        const visMax = sy + hudTop - railHalfH;
        if (visMax > visMin) {
          docY = clamp(docY, Math.max(minDoc, visMin), Math.min(maxDoc, visMax));
        }

        out.x = mLaneX;
        out.docY = docY;
        out.visY = docY - sy;
        out.w = mRailW;
        out.formation = 0;
        out.rail = 1;
        out.direction = 1;
        out.contact = 0;
        out.inCorridor = false;
        return out;
      }
    }

    const last = layout[layout.length - 1];
    const bay = computeContactBay(last, sy, hudTop);
    out.x = width * .5;
    out.docY = bay.bayMidDoc;
    out.visY = out.docY - sy;
    out.w = bay.fittedW;
    out.formation = bay.compact;
    out.rail = 0;
    out.direction = 1;
    out.contact = 1;
    out.inCorridor = false;
  }

  // Exact analytical critically-damped 2nd-order spring along 1D safe path parameter `s`
  function stepSpringAxis(cur, vel, targetVal, omega, dt, maxSpeed, maxFrameStep) {
    const e = Math.exp(-omega * dt);
    const diff = cur - targetVal;
    const temp = (vel + omega * diff) * dt;
    let nextPos = targetVal + (diff + temp) * e;
    let nextVel = (vel - omega * temp) * e;

    const maxStep = Math.min(maxSpeed * dt, maxFrameStep);
    const delta = nextPos - cur;
    if (delta > maxStep) {
      nextPos = cur + maxStep;
      nextVel = Math.min(maxSpeed, maxStep / dt);
    } else if (delta < -maxStep) {
      nextPos = cur - maxStep;
      nextVel = -Math.min(maxSpeed, maxStep / dt);
    }

    axisOut.pos = nextPos;
    axisOut.vel = nextVel;
  }

  function advanceAlongSafePath(sy, hudTop, dt) {
    const focusRatio = width <= 800 ? .44 : .46;
    const targetS = sy + readingHeight * focusRatio;

    if (!pathSpring.initialized) {
      pathSpring.s = targetS;
      pathSpring.vs = 0;
      evalSafePath(targetS, sy, hudTop, pathSample);
      pathSpring.formation = pathSample.formation;
      pathSpring.direction = pathSample.direction;
      pathSpring.contact = pathSample.contact;
      pathSpring.rail = pathSample.rail;
      pathSpring.initialized = true;
      return pathSample;
    }

    const gapToTarget = Math.abs(targetS - pathSpring.s);
    // If an external script/button jumped scrollY by > 1.25 viewports in one instant (e.g. Replay to top),
    // align directly onto the safe path at the new viewport rather than dragging offscreen.
    if (gapToTarget > height * 1.25) {
      pathSpring.s = targetS;
      pathSpring.vs = 0;
      evalSafePath(targetS, sy, hudTop, pathSample);
      pathSpring.formation = pathSample.formation;
      pathSpring.direction = pathSample.direction;
      pathSpring.contact = pathSample.contact;
      pathSpring.rail = pathSample.rail;
      return pathSample;
    }

    // Responsive critically-damped spring along the 1D safe path (zero stale-corridor lag, zero snaps!)
    const omega = mix(14.5, 16.5, cinemaEnergy);
    const maxSPerSec = Math.max(2400, height * 3.2);
    const maxSFrame = Math.max(68, height * .12);

    stepSpringAxis(pathSpring.s, pathSpring.vs, targetS, omega, dt, maxSPerSec, maxSFrame);
    // Guarantee `s` never falls behind `targetS` far enough for an open corridor to scroll above header nav
    const maxLag = width <= 800 ? 60 : 78;
    const candidateS = clamp(axisOut.pos, targetS - maxLag, targetS + maxLag);
    const candidateVs = (candidateS !== axisOut.pos) ? 0 : axisOut.vel;

    evalSafePath(candidateS, sy, hudTop, nextSample);

    const prevFormation = pathSpring.formation;
    pathSpring.s = candidateS;
    pathSpring.vs = candidateVs;

    const blend = 1 - Math.exp(-dt * 12);
    pathSpring.formation += (nextSample.formation - pathSpring.formation) * blend;
    if (Math.abs(pathSpring.formation - nextSample.formation) < .002) pathSpring.formation = nextSample.formation;
    if (prevFormation >= .32 && pathSpring.formation < .32 && nextSample.formation < .15) {
      arrival = clock;
    }

    pathSpring.direction += (nextSample.direction - pathSpring.direction) * (1 - Math.exp(-dt * 11));
    pathSpring.contact += (nextSample.contact - pathSpring.contact) * blend;
    if (Math.abs(pathSpring.contact - nextSample.contact) < .002) pathSpring.contact = nextSample.contact;
    pathSpring.rail += (nextSample.rail - pathSpring.rail) * blend;
    if (Math.abs(pathSpring.rail - nextSample.rail) < .002) pathSpring.rail = nextSample.rail;

    nextSample.formation = pathSpring.formation;
    nextSample.direction = pathSpring.direction;
    nextSample.contact = pathSpring.contact;
    nextSample.rail = pathSpring.rail;
    return nextSample;
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
        // Tail extends left from startX
        if (b.right <= startX) {
          const gap = startX - b.right - 8;
          if (gap < maxLen) maxLen = Math.max(0, gap);
        } else if (b.left < startX) {
          return 0;
        }
      } else {
        // Tail extends right from startX
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

  function circleClearOfAll(x, y, minDist) {
    for (let i = 0; i < liveObstacleCount; i++) {
      const b = liveObstacles[i];
      const cx = clamp(x, b.left, b.right);
      const cy = clamp(y, b.top, b.bottom);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < minDist * minDist) return false;
    }
    return true;
  }

  // Hard iterative Circle-vs-AABB obstacle push-out for a single piece (zero overlap guarantee!)
  function resolvePieceObstacles(pose, hudTop, safeLaneX) {
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

    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let i = 0; i < liveObstacleCount; i++) {
        const b = liveObstacles[i];
        const cx = clamp(x, b.left, b.right);
        const cy = clamp(y, b.top, b.bottom);
        const dx = x - cx;
        const dy = y - cy;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDist * minDist) {
          if (distSq > 1e-4 && (b.isBand || Math.abs(dx) >= Math.abs(dy))) {
            const dist = Math.sqrt(distSq);
            const push = minDist - dist;
            x += (dx / dist) * push;
            y += (dy / dist) * push;
          } else {
            // Inside AABB or grazing top/bottom of a vertically stacked card:
            // Prefer escaping horizontally into the open side lane for non-band obstacles
            // so pieces NEVER ping-pong vertically between stacked cards!
            const candLeft = b.left - minDist;
            const candRight = b.right + minDist;
            const candTop = b.top - minDist;
            const candBottom = b.bottom + minDist;
            const bMidX = (b.left + b.right) * .5;

            let bestCost = Infinity;
            let bestX = x, bestY = y;

            if (candLeft >= minX) {
              const laneBonus = (!b.isBand && safeLaneX < bMidX) ? .45 : 1;
              const cost = Math.abs(x - candLeft) * laneBonus;
              if (cost < bestCost) { bestCost = cost; bestX = candLeft; bestY = y; }
            }
            if (candRight <= maxX) {
              const laneBonus = (!b.isBand && safeLaneX >= bMidX) ? .45 : 1;
              const cost = Math.abs(candRight - x) * laneBonus;
              if (cost < bestCost) { bestCost = cost; bestX = candRight; bestY = y; }
            }
            // Only allow vertical escape on non-band cards if horizontal escape is blocked or top/bottom is genuinely clear
            const vertPenalty = b.isBand ? .85 : 2.2;
            if (candTop >= minY) {
              const cost = Math.abs(y - candTop) * vertPenalty;
              if (cost < bestCost) { bestCost = cost; bestX = x; bestY = candTop; }
            }
            if (candBottom <= maxY) {
              const cost = Math.abs(candBottom - y) * vertPenalty;
              if (cost < bestCost) { bestCost = cost; bestX = x; bestY = candBottom; }
            }
            x = bestX;
            y = bestY;
          }
          x = clamp(x, minX, maxX);
          y = clamp(y, minY, maxY);
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Final safety guarantee: if still overlapping any obstacle, jump cleanly to nearest collision-free open lane slot
    if (!circleClearOfAll(x, y, r + 4)) {
      const lx = clamp(safeLaneX, minX, maxX);
      if (circleClearOfAll(lx, y, r + 4)) {
        x = lx;
      } else {
        // Check a few vertical offsets in the open lane
        for (let step = 28; step <= 260; step += 28) {
          if (y - step >= minY && circleClearOfAll(lx, y - step, r + 4)) { x = lx; y -= step; break; }
          if (y + step <= maxY && circleClearOfAll(lx, y + step, r + 4)) { x = lx; y += step; break; }
        }
      }
    }

    // Ultra-tight bay fallback: if still squeezed between two obstacles, scale sprite down so clearance >= 2px
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
      const shrink = clamp((r - worstOverlap) / r, 0.28, 1);
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

  function clearPainting() {
    if (!paintedRect.active) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(paintedRect.x, paintedRect.y, paintedRect.w, paintedRect.h);
    paintedRect.active = false;
  }

  function draw(dt) {
    if (!ready || width < 2 || height < 2 || !hero) return;
    const sy = window.scrollY;
    const hudTop = collectLiveObstacles(sy);
    const progress = position;
    const t = clock;
    const chapter = updateChapter(progress);
    const area = advanceAlongSafePath(sy, hudTop, dt);

    const formation = area.formation;
    const rail = area.rail;
    const contactMix = area.contact;
    const landed = t - arrival;
    const orbiting = 1 - smooth(Math.max(formation, rail) * 1.55);
    const energy = Math.sin(chapter.local * Math.PI) ** 2;

    clearPainting();

    // Gentle 3D levitation (attenuated vertically during tight corridor flights)
    const drift = mix(1, .58, contactMix);
    const hoverX = Math.sin(t * .74) * area.w * .014 * drift * (1 - rail * .75);
    const hoverY = Math.sin(t * .92) * area.w * .024 * drift * (1 - formation * .86);
    const centerX = area.x + hoverX;
    const centerY = area.visY + hoverY;

    // Group rotation (zeroed during horizontal corridor stream or mobile vertical ribbon)
    const pointerTurn = cursor.x * .034 + cursor.y * .012;
    const idleSway = (.050 * Math.sin(t * .72) + .020 * Math.cos(t * .41)) * drift;
    const normalTurn = idleSway
      + (.058 * Math.sin(t * .88) * drift + pointerTurn) * (.45 + .55 * Math.sin(progress * Math.PI))
      + .095 * Math.sin(progress * tau) * drift;
    const contactTurn = .042 * Math.sin(t * .68) * drift + pointerTurn * .45;
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
      const breath = .5 - .5 * Math.cos(t * (1.42 + i * .098) + i * .64);
      const normalSpread = .11 + (.28 * breath + (.72 + cinemaEnergy * .08) * open) * mix(.34, 1, orbiting);
      const contactSpread = .08 + .15 * breath * drift;
      const spread = mix(normalSpread, contactSpread, contactMix);
      const idleX = Math.cos(t * 1.12 + i * 1.92) * (.010 + .028 * open) * drift;
      const idleY = Math.sin(t * 1.48 + i * 1.68) * (.020 + .026 * open) * drift;
      const ox = p.cx * (1 + spread) + idleX;
      const oy = p.cy * (1 + spread) + idleY - (i === 0 ? .046 : 0);
      const baseTurn = p.turn * (.12 + .72 * breath + open * (1.85 + .30 * Math.sin(chapter.index + i))) * drift;
      const fit = 1 - .28 * open;
      const inset = .90 - .08 * open;
      const bob = Math.sin(t * 5.6 - p.lane * 1.6);

      // Blend: Orbiting cluster <-> Horizontal corridor stream (`formation`) <-> Mobile vertical right-lane ribbon (`rail`)
      let lx = area.w * ox * fit;
      let ly = area.w * oy * fit;
      let scale = area.w * fit * inset;
      let localTurn = baseTurn;

      if (formation > .001) {
        lx = mix(lx, area.w * p.lane * .26, formation);
        ly = mix(ly, area.w * bob * .016, formation);
        scale = mix(scale, area.w * .40, formation);
        localTurn = mix(localTurn, area.direction * (.20 + bob * .10), formation);
      }
      if (rail > .001) {
        lx = mix(lx, area.w * bob * .018, rail);
        ly = mix(ly, area.w * p.lane * .36, rail);
        scale = mix(scale, area.w * .45, rail);
        localTurn = mix(localTurn, bob * .14, rail);
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

      // Hard per-piece obstacle avoidance (zero-overlap guarantee against every DOM object!)
      const safeLaneX = width <= 800
        ? (mobileLane ? mobileLane.x : width - 38)
        : (area.x >= width * .5 ? width - EDGE_PAD - 90 : EDGE_PAD + 90);
      resolvePieceObstacles(pose, hudTop, safeLaneX);
    }

    // Compute safe halo scale from exact clearance around centerX, centerY
    const centerClearance = minObstacleClearance(centerX, centerY);
    const maxSafeHaloR = Math.max(0, centerClearance - 10);
    const desiredHaloR = Math.max(1, area.w * .66);
    const haloScale = Math.min(1, maxSafeHaloR / desiredHaloR);

    let drawnHaloR = 0;

    // Compute dirty paint bounding box before drawing (full union of halo + wakes + all 4 pieces)
    let minX = width, minY = height, maxX = 0, maxY = 0;
    const includeBox = (bx0, by0, bx1, by1) => {
      if (bx0 < minX) minX = bx0;
      if (by0 < minY) minY = by0;
      if (bx1 > maxX) maxX = bx1;
      if (by1 > maxY) maxY = by1;
    };

    const showAtmosphere = rail < .65 && formation < .92 && haloScale > .32;
    const showArrival = landed >= 0 && landed < .68 && haloScale > .35;
    if (showAtmosphere || showArrival) {
      const hr = desiredHaloR * haloScale + 18;
      includeBox(centerX - hr, centerY - hr, centerX + hr, centerY + hr);
    }
    const wakeMargin = formation > .02 ? area.w * .52 + 16 : 0;
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const pad = p.r + 12;
      includeBox(p.wx - pad - wakeMargin, p.wy - pad, p.wx + pad + wakeMargin, p.wy + pad);
    }

    const px0 = Math.max(0, Math.floor(minX));
    const py0 = Math.max(0, Math.floor(minY));
    const px1 = Math.min(width, Math.ceil(maxX));
    const py1 = Math.min(height, Math.ceil(maxY));

    if (px1 <= px0 || py1 <= py0) {
      particleField.fill(0);
      window.dispatchEvent(particleEvent);
      return;
    }

    paintedRect.x = px0;
    paintedRect.y = py0;
    paintedRect.w = px1 - px0;
    paintedRect.h = py1 - py0;
    paintedRect.active = true;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(paintedRect.x, paintedRect.y, paintedRect.w, paintedRect.h);
    ctx.clip();

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
