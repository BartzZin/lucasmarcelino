(() => {
  'use strict';

  const canvas = document.querySelector('#puzzle');
  const ctx = canvas?.getContext('2d');
  const main = document.querySelector('#principal');
  if (!ctx || !main) return;

  const intro = main.querySelector('.intro');
  const chapters = [...main.querySelectorAll('.story section')];
  const TEXT_SELECTOR = 'header nav, .intro .eyebrow, .intro h1, .intro p, .intro .actions, .chapter-inner:not(.contact-panel), .story h2:not(#contato-titulo), .story .piece, footer';
  const tau = Math.PI * 2;
  const unit = v => Math.max(0, Math.min(1, v));
  const smooth = v => { const t = unit(v); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const artBase = new URL('./arte/', document.currentScript?.src || document.baseURI);

  // Pre-render offscreen 64x64 star+halo sprites (violet + mint) and orbital bloom
  // once at startup — eliminates all per-frame createRadialGradient() calls.
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

    // 4-point diamond star core matched to 1:4 core-to-halo ratio
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
    halo.addColorStop(0, 'rgba(217,161,255,.32)');
    halo.addColorStop(.45, 'rgba(173,255,207,.12)');
    halo.addColorStop(1, 'rgba(173,255,207,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 64, 64);
    return off;
  }

  const violetStarSprite = makeStarSprite('217,161,255', 'rgba(252,248,255,1)');
  const mintStarSprite = makeStarSprite('173,255,207', 'rgba(246,255,250,1)');
  const orbitalBloomSprite = makeOrbitalBloom();

  // Pixel positions in the shared studio render, including the transparent
  // padding of each crop. At rest the four layers reproduce that photograph.
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

  // Pre-allocated object pools & reusable typed buffer (zero per-frame allocations)
  const poses = art.map(() => ({ image: null, x: 0, y: 0, turn: 0, w: 0, h: 0 }));
  const particleField = new Float32Array(art.length * 3);
  const particleEvent = new CustomEvent('cv-puzzle-field', { detail: particleField });
  const chapterState = { index: 0, local: 0 };
  const stationA = { x: 0, docY: 0, w: 0, side: 1, isContact: false };
  const stationB = { x: 0, docY: 0, w: 0, side: 1, isContact: false };
  const stageDest = { x: 0, y: 0, w: 0, rail: 0, formation: 0, direction: 1, contact: 0 };
  const axisOut = { pos: 0, vel: 0 };
  const spring = {
    x: 0, vx: 0,
    y: 0, vy: 0,
    w: 0, vw: 0,
    formation: 0,
    direction: 1,
    contact: 0,
    rail: 0,
    initialized: false
  };
  const paintedRect = { x: 0, y: 0, w: 0, h: 0, active: false };

  // Read-only telemetry state mutated in-place (zero per-frame allocations)
  const debugState = {
    x: 0,
    y: 0,
    w: 0,
    t: 0,
    frame: 0,
    formation: 0,
    contact: 0,
    pieces: [[0, 0], [0, 0], [0, 0], [0, 0]]
  };
  window.__curriculoPuzzleState = debugState;

  const stars = [
    [-.52, -.26, 4.1], [-.42, -.31, 1.5], [-.35, -.43, 2.4], [-.31, -.46, 1.1], [-.17, -.53, 1.5],
    [.40, -.37, 1.5], [.55, -.24, 2.3], [.61, -.09, 1.4], [.54, .31, 3.8], [.45, .37, 1.2],
    [.37, .41, 1.8], [.22, .46, 1.1], [-.23, .47, 3.0], [-.38, .39, 1.1], [-.49, .25, 1.6]
  ];
  const ORBIT_SEGMENTS = 15;

  let width = 0, height = 0, ratio = 1, layout = [], corridors = [], marks = [0, 1];
  let flight = null, hero = null, distance = 1;
  let mobileRail = null, mobileDock = null;
  let cachedBlocks = [];
  let target = 0, position = 0, clock = .4, previous = 0, frame = 0, frameCount = 0, ready = false;
  let headerSafeBottom = 76;
  let arrival = -10;
  let cinemaPlaying = false, cinemaEnergy = 0, cinemaSpeed = 1, scrollVelocity = 0;
  const cursor = { x: 0, y: 0, tx: 0, ty: 0 };

  function cacheTextBlocks(sy) {
    const nodes = document.querySelectorAll(TEXT_SELECTOR);
    const list = [];
    headerSafeBottom = 64;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const box = node.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      const isHeader = !!node.closest('header');
      if (isHeader) headerSafeBottom = Math.max(headerSafeBottom, box.bottom);
      list.push({
        left: box.left,
        right: box.right,
        top: isHeader ? box.top : box.top + sy,
        bottom: isHeader ? box.bottom : box.bottom + sy,
        fixed: isHeader
      });
    }
    cachedBlocks = list;
  }

  function buildCorridors(readingHeight) {
    const list = [];
    if (!hero || !layout.length) {
      corridors = list;
      return;
    }

    const halfBand = Math.min(175, Math.max(105, readingHeight * .21));
    const maxFocus = distance + readingHeight * .46;

    // Corridor 0: Hero -> Chapter 0 (smooth continuous vertical & width glide on right side)
    const first = layout[0];
    const heroStart = readingHeight * .46 + 24;
    const heroEnd = Math.max(
      heroStart + 120,
      first.top + Math.min(180, Math.max(80, (first.bottom - first.top) * .22))
    );
    list.push({
      start: heroStart,
      end: heroEnd,
      corridorDocY: (hero.top + hero.h + first.contentTop) * .5,
      crossSide: first.side !== 1
    });

    // Corridors 1..N-1: Chapter (k-1) -> Chapter k
    for (let i = 1; i < layout.length; i++) {
      const prev = layout[i - 1];
      const next = layout[i];
      const mid = (prev.contentBottom + next.contentTop) * .5;
      let start = mid - halfBand;
      let end = mid + halfBand;

      if (next.isContact) {
        // Ensure the puzzle finishes gliding smoothly into the centered #contato crest
        // right when cinema mode or bottom scroll rests on the contact panel.
        const panelCenter = (next.contentTop + next.contentBottom) * .5;
        const restSy = Math.min(distance, Math.max(0, panelCenter - height * .5));
        const restFocus = Math.min(maxFocus, restSy + readingHeight * .46);
        end = Math.min(end, restFocus - 16);
        start = Math.max(prev.top + 60, end - halfBand * 1.9);
      }

      if (end < start + 60) end = start + 60;
      list.push({
        start,
        end,
        corridorDocY: mid,
        crossSide: prev.side !== next.side
      });
    }

    // Guarantee strictly non-overlapping corridor bands so transitions stay C1-continuous.
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (a.end > b.start - 10) {
        const split = (a.end + b.start) * .5;
        a.end = Math.max(a.start + 30, split - 5);
        b.start = Math.min(b.end - 30, split + 5);
      }
    }

    corridors = list;
  }

  function measure() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!width || !height) return;

    // Cap DPR at 1.75 with a 4.5M pixel budget to keep GPU fill-rate ultra-light.
    ratio = Math.min(1.75, window.devicePixelRatio || 1);
    ratio = Math.min(ratio, Math.sqrt(4_500_000 / (width * height)));
    const pw = Math.max(1, Math.round(width * ratio));
    const ph = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      paintedRect.active = false;
    }

    // Note: Do NOT reset spring.initialized here! Preserving the spring state across
    // layout/font/ResizeObserver updates prevents any sudden mid-scroll teleport.

    const sy = window.scrollY;
    const contentBox = main.getBoundingClientRect();
    const introBox = intro ? intro.getBoundingClientRect() : { right: contentBox.left + contentBox.width * .6, top: 0, height: height * .8 };
    const heroGap = Math.max(0, contentBox.right - introBox.right);
    hero = {
      x: introBox.right + heroGap / 2,
      free: heroGap,
      top: introBox.top + sy,
      h: Math.max(120, introBox.height)
    };

    const slot = main.querySelector('.mobile-flight')?.getBoundingClientRect();
    flight = slot && slot.height
      ? { x: slot.left + slot.width / 2, y: slot.top + sy + slot.height / 2, w: slot.width, h: slot.height }
      : null;

    if (width <= 800) {
      const textEdge = Math.max(
        0,
        ...chapters
          .filter(section => section.id !== 'contato')
          .map(section => (section.querySelector('.chapter-inner') || section).getBoundingClientRect().right)
      );
      const free = Math.max(1, width - textEdge);
      mobileRail = { x: textEdge + free * .52, w: free * .79 };
      const contact = main.querySelector('#contato');
      const panel = contact?.querySelector('.contact-panel')?.getBoundingClientRect();
      const start = contact?.getBoundingClientRect().top;
      const gap = panel && Number.isFinite(start) ? panel.top - start : 0;
      mobileDock = gap > 38 && panel
        ? {
            x: panel.left + panel.width / 2,
            y: sy + start + gap * .52,
            w: Math.min(Math.max(88, gap * .72), width * .48),
            gap
          }
        : null;
    } else {
      mobileRail = null;
      mobileDock = null;
    }

    const readingHeight = Math.min(height, hero.h / .82);
    layout = [];
    for (let i = 0; i < chapters.length; i++) {
      const section = chapters[i];
      const box = section.getBoundingClientRect();
      const contentEl = section.querySelector('.chapter-inner') || section;
      const content = contentEl.getBoundingClientRect();
      const isContact = section.id === 'contato';

      if (isContact) {
        const prevContentBottom = layout.length ? layout[layout.length - 1].contentBottom : box.top + sy;
        const panelTop = content.top + sy;
        const gapAbove = Math.max(0, panelTop - prevContentBottom);
        const contactW = Math.min(
          Math.max(146, gapAbove * .76),
          readingHeight * .33,
          content.width * .32,
          232
        );

        layout.push({
          top: box.top + sy,
          bottom: box.bottom + sy,
          contentTop: panelTop,
          contentBottom: content.bottom + sy,
          x: content.left + content.width / 2,
          free: content.width,
          side: 0,
          isContact: true,
          contactW
        });
      } else {
        const onLeft = content.left + content.right < contentBox.left + contentBox.right;
        const free = onLeft ? contentBox.right - content.right : content.left - contentBox.left;
        layout.push({
          top: box.top + sy,
          bottom: box.bottom + sy,
          contentTop: content.top + sy,
          contentBottom: content.bottom + sy,
          x: onLeft ? content.right + free / 2 : contentBox.left + free / 2,
          free,
          side: onLeft ? 1 : -1,
          isContact: false,
          contactW: 0
        });
      }
    }

    cacheTextBlocks(sy);

    distance = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    marks = [0];
    for (let i = 0; i < layout.length; i++) {
      const mark = unit((layout[i].top - readingHeight * .46) / distance);
      if (mark > marks[marks.length - 1] + .028 && mark < .96) marks.push(mark);
    }
    marks.push(1);
    buildCorridors(readingHeight);

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

  // Pure, continuous evaluation of station s (0 = hero, 1..N = chapters)
  function evalStation(s, sy, focus, readingHeight, out) {
    if (s <= 0 || !layout.length) {
      out.w = Math.min(hero.free * .73, hero.h * .68, readingHeight * .66);
      out.x = hero.x;
      out.docY = hero.top + hero.h * .49;
      out.side = 1;
      out.isContact = false;
      return out;
    }

    const row = layout[Math.min(layout.length - 1, s - 1)];
    if (row.isContact) {
      // C1-continuous contact crest fit between sticky header and .contact-panel
      const headerClearBottom = headerSafeBottom + 12;
      const panelVisTop = row.contentTop - sy;
      const openGap = Math.max(0, panelVisTop - headerClearBottom);
      const fittedW = Math.min(row.contactW, Math.max(108, openGap / 1.28));
      const minVisY = headerClearBottom + fittedW * .64;
      const maxVisY = Math.max(minVisY, panelVisTop - fittedW * .54);
      const centeredVisY = headerClearBottom + openGap * .52;
      const visY = Math.max(minVisY, Math.min(maxVisY, centeredVisY));

      out.w = fittedW;
      out.x = row.x;
      out.docY = visY + sy;
      out.side = 0;
      out.isContact = true;
      return out;
    }

    const heightAvailable = Math.max(1, row.bottom - row.top);
    const w = Math.min(row.free * .65, readingHeight * .53, heightAvailable * .61);
    const local = unit((focus - row.top) / heightAvailable);
    const desired = focus + readingHeight * .068 * Math.sin(local * tau - .32);
    const minDoc = row.top + w * .67;
    const maxDoc = Math.max(minDoc, row.bottom - w * .67);

    out.w = w;
    out.x = row.x;
    out.docY = Math.max(minDoc, Math.min(maxDoc, desired));
    out.side = row.side;
    out.isContact = false;
    return out;
  }

  // Computes a 100% C1-continuous target stage for any scrollY (zero boundary snaps)
  function computeTargetStage(sy) {
    if (width <= 800) {
      const slot = flight || { x: width * .5, y: (intro?.offsetHeight || 260) + 80, w: width, h: 160 };
      const cy = slot.y - sy;
      const scrollRatio = unit(sy / distance);
      const rail = smooth(sy / Math.max(60, slot.y - height * .32));
      const railY = height * (.47 + .21 * Math.sin(scrollRatio * tau * 2.25 - .6));
      const lift = smooth((height * .32 - slot.y + sy) / (height * .22));
      const mr = mobileRail || { x: width * .85, w: Math.min(84, width * .22) };

      let tx = mix(slot.x, mr.x, rail);
      let ty = mix(cy, railY, lift);
      let tw = mix(Math.min(slot.w * .77, slot.h * .79), mr.w, rail);
      let contact = 0;

      if (mobileDock) {
        const remaining = Math.max(0, distance - sy);
        const approach = Math.min(height * .55, Math.max(190, mobileDock.gap * 2.2));
        const align = smooth((approach - remaining) / (approach * .55)) * rail;
        const pocketY = mobileDock.y - sy;
        const visible = smooth((height - pocketY - mobileDock.w * .55) / (mobileDock.w * .38));
        const cross = smooth((approach * .45 - remaining) / (approach * .42)) * visible * rail;
        ty = mix(ty, pocketY, align);
        tx = mix(tx, mobileDock.x, cross);
        tw = mix(tw, mobileDock.w, cross);
        contact = cross;
      }

      stageDest.x = tx;
      stageDest.y = ty;
      stageDest.w = tw;
      stageDest.rail = rail;
      stageDest.formation = 0;
      stageDest.direction = 1;
      stageDest.contact = contact;
      return stageDest;
    }

    const readingHeight = Math.min(height, hero.h / .82);
    const focus = sy + readingHeight * .46;

    if (!corridors.length || focus <= corridors[0].start) {
      evalStation(0, sy, focus, readingHeight, stationA);
      stageDest.x = stationA.x;
      stageDest.y = stationA.docY - sy;
      stageDest.w = stationA.w;
      stageDest.rail = 0;
      stageDest.formation = 0;
      stageDest.direction = 1;
      stageDest.contact = 0;
      return stageDest;
    }

    for (let k = 0; k < corridors.length; k++) {
      const c = corridors[k];
      if (focus < c.end) {
        // Inside smooth transition corridor between station k and station k+1
        const u = smooth((focus - c.start) / Math.max(1, c.end - c.start));
        evalStation(k, sy, focus, readingHeight, stationA);
        evalStation(k + 1, sy, focus, readingHeight, stationB);

        if (!c.crossSide) {
          // Same-side transition (e.g., Hero -> #trajetoria)
          stageDest.x = mix(stationA.x, stationB.x, u);
          stageDest.y = mix(stationA.docY, stationB.docY, u) - sy;
          stageDest.w = mix(stationA.w, stationB.w, u);
          stageDest.rail = 0;
          stageDest.formation = 0;
          stageDest.direction = Math.sign(stationB.x - stationA.x) || 1;
          stageDest.contact = mix(stationA.isContact ? 1 : 0, stationB.isContact ? 1 : 0, u);
          return stageDest;
        }

        // Cross-side corridor flight: smoothly aligns into the open gap between chapters,
        // flies across in sleek formation with comet wakes, and settles onto the new side.
        const bell = Math.sin(u * Math.PI);
        const xTravel = smooth((u - .14) / .72);
        const linearDocY = mix(stationA.docY, stationB.docY, u);
        const corridorTargetDocY = stationB.isContact
          ? Math.min(stationB.docY, c.corridorDocY)
          : c.corridorDocY;
        const docY = mix(linearDocY, corridorTargetDocY, bell * .68);
        const corridorW = Math.min(stationA.w, stationB.w) * .88;

        stageDest.x = mix(stationA.x, stationB.x, xTravel);
        stageDest.y = docY - sy;
        stageDest.w = mix(mix(stationA.w, stationB.w, u), corridorW, bell * .55);
        stageDest.rail = 0;
        stageDest.formation = bell * bell;
        stageDest.direction = Math.sign(stationB.x - stationA.x) || 1;
        stageDest.contact = mix(stationA.isContact ? 1 : 0, stationB.isContact ? 1 : 0, u);
        return stageDest;
      }

      if (k === corridors.length - 1 || focus <= corridors[k + 1].start) {
        evalStation(k + 1, sy, focus, readingHeight, stationA);
        stageDest.x = stationA.x;
        stageDest.y = stationA.docY - sy;
        stageDest.w = stationA.w;
        stageDest.rail = 0;
        stageDest.formation = 0;
        stageDest.direction = 1;
        stageDest.contact = stationA.isContact ? 1 : 0;
        return stageDest;
      }
    }

    evalStation(layout.length, sy, focus, readingHeight, stationA);
    stageDest.x = stationA.x;
    stageDest.y = stationA.docY - sy;
    stageDest.w = stationA.w;
    stageDest.rail = 0;
    stageDest.formation = 0;
    stageDest.direction = 1;
    stageDest.contact = stationA.isContact ? 1 : 0;
    return stageDest;
  }

  // Exact analytical critically-damped 2nd-order spring step with gentle speed & per-frame step ceiling:
  // guarantees C1-continuous velocity, zero overshoot, and zero single-frame teleports even across GC stalls.
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

  function advanceRenderedStage(dest, dt) {
    if (!spring.initialized) {
      spring.x = dest.x; spring.vx = 0;
      spring.y = dest.y; spring.vy = 0;
      spring.w = dest.w; spring.vw = 0;
      spring.formation = dest.formation;
      spring.direction = dest.direction || 1;
      spring.contact = dest.contact;
      spring.rail = dest.rail;
      spring.initialized = true;
      return spring;
    }

    // Silky critically-damped spring tracking (zero snap, zero laggy rubber-banding)
    const omega = mix(9.2, 10.8, cinemaEnergy);
    const maxPosSpeed = Math.min(960, Math.max(660, width * .68));
    const maxFramePos = width <= 800 ? 15 : 22;

    stepSpringAxis(spring.x, spring.vx, dest.x, omega, dt, maxPosSpeed, maxFramePos);
    spring.x = axisOut.pos;
    spring.vx = axisOut.vel;

    stepSpringAxis(spring.y, spring.vy, dest.y, omega, dt, maxPosSpeed, maxFramePos);
    spring.y = axisOut.pos;
    spring.vy = axisOut.vel;

    stepSpringAxis(spring.w, spring.vw, dest.w, omega * .92, dt, 380, 9);
    spring.w = axisOut.pos;
    spring.vw = axisOut.vel;

    // Combine corridor formation + smooth speed-driven flight formation during rapid glides
    const horizSpeed = Math.abs(spring.vx);
    const speedFormation = smooth((horizSpeed - 190) / 460) * (1 - dest.contact * .45);
    const targetFormation = Math.max(dest.formation, speedFormation);
    const prevFormation = spring.formation;
    spring.formation += (targetFormation - spring.formation) * (1 - Math.exp(-dt * 9.5));
    if (spring.formation < .001 && targetFormation === 0) spring.formation = 0;

    if (prevFormation >= .28 && spring.formation < .28 && targetFormation < .15) {
      arrival = clock;
    }

    const targetDir = horizSpeed > 25 ? Math.sign(spring.vx) : (dest.direction || spring.direction || 1);
    spring.direction += (targetDir - spring.direction) * (1 - Math.exp(-dt * 10));

    const blendEase = 1 - Math.exp(-dt * 8.5);
    spring.contact += (dest.contact - spring.contact) * blendEase;
    if (Math.abs(spring.contact - dest.contact) < .001) spring.contact = dest.contact;
    spring.rail += (dest.rail - spring.rail) * blendEase;

    return spring;
  }

  function stampStar(x, y, r, isMint, alpha) {
    if (alpha <= .01 || r <= .2) return;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * Math.min(1, alpha);
    const extent = r * 4;
    ctx.drawImage(isMint ? mintStarSprite : violetStarSprite, x - extent, y - extent, extent * 2, extent * 2);
    ctx.globalAlpha = prevAlpha;
  }

  function atmosphere(w, t, progress, energy, contactMix) {
    const cinemaBoost = cinemaEnergy * .22 + scrollVelocity * .10;
    const finaleSoft = mix(1, .88, contactMix);

    // Subtle soft ambient orbital bloom — always gently glowing, richer during cinema/finale
    const bloomAlpha = (.10 + cinemaEnergy * .16 + contactMix * .14) * finaleSoft;
    if (bloomAlpha > .02) {
      const prevAlpha = ctx.globalAlpha;
      const br = w * (.72 + cinemaEnergy * .10);
      ctx.globalAlpha = prevAlpha * bloomAlpha;
      ctx.drawImage(orbitalBloomSprite, -br, -br * .78, br * 2, br * 1.56);
      ctx.globalAlpha = prevAlpha;
    }

    for (let lane = 0; lane < 2; lane++) {
      const isMint = lane === 1;
      const rgb = isMint ? '173,255,207' : '217,161,255';
      const rx = w * (isMint ? .643 : .644);
      const ry = w * (isMint ? .188 : .218);
      const baseTilt = mix(isMint ? .15 : -.40, isMint ? .12 : -.12, contactMix);
      const tiltAmp = mix(.09, .045, contactMix);
      const tilt = baseTilt + Math.sin(t * .74 + lane) * tiltAmp;
      const cy = w * mix(isMint ? .131 : -.100, isMint ? .06 : -.06, contactMix);
      const head = (isMint ? -.54 : 3.05) + (isMint ? -.88 : 1.08) * t + progress * 2.1;

      ctx.save();
      ctx.translate(0, cy);
      ctx.rotate(tilt);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(.72, w * .0018);

      const step = tau / ORBIT_SEGMENTS;
      for (let i = 0; i < ORBIT_SEGMENTS; i++) {
        const frac = i / ORBIT_SEGMENTS;
        const a = head - tau + frac * tau;
        const light = (.14 + .58 * frac * frac) * (1 + cinemaBoost * .5) * finaleSoft;
        ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, light).toFixed(3) + ')';
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, a, a + step + .005);
        ctx.stroke();
      }

      // Luminous comet trail — continuously gliding, richer during cinema mode
      const tail = .52 + energy * .24 + cinemaEnergy * .28 + scrollVelocity * .15;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, head - tail, head);
      ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, (.12 + cinemaBoost * .22) * finaleSoft).toFixed(3) + ')';
      ctx.lineWidth = Math.max(4, w * (.0115 + cinemaEnergy * .0035));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, (.32 + cinemaBoost * .24) * finaleSoft).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2.4, w * .0058);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, (.94 + cinemaEnergy * .06) * finaleSoft).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.2, w * .0026);
      ctx.stroke();

      for (let i = 0; i < 4; i++) {
        const a = head - .14 * i;
        const shimmer = (1 - i * .2) * (1 + cinemaEnergy * .15);
        stampStar(Math.cos(a) * rx, Math.sin(a) * ry, Math.max(1.1, w * .0092) * shimmer, isMint, Math.min(1, .92 * shimmer * finaleSoft));
      }
      ctx.restore();
    }

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const twinkle = .55 + .38 * Math.sin(t * (1.22 + (i % 3) * .37) + i * 1.8);
      const radius = Math.max(.9, (w / 370) * s[2]) * (.78 + twinkle * .29) * (1 + cinemaEnergy * .08);
      const drift = .048 * Math.sin(t * .72 + i);
      stampStar(
        (s[0] + drift) * w,
        (s[1] - drift * .62) * w,
        radius,
        i % 4 === 0,
        Math.min(1, twinkle * (1 + cinemaEnergy * .16) * finaleSoft)
      );
    }
  }

  function wake(x, y, size, strength, direction, index) {
    const isMint = index % 2 !== 0;
    const color = isMint ? '173,255,207' : '217,161,255';
    const tail = direction * size * (.42 + cinemaEnergy * .12);
    ctx.lineCap = 'round';

    for (let band = 0; band < 2; band++) {
      const vertical = (band - .5) * size * .023;
      ctx.beginPath();
      ctx.moveTo(x - tail, y + vertical + size * .043);
      ctx.quadraticCurveTo(x - tail * .44, y + vertical - size * .032, x, y + vertical);
      ctx.strokeStyle = 'rgba(' + color + ',' + (strength * (.26 + cinemaEnergy * .14)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2.2, size * .011);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x - tail * .58, y + vertical + size * .012);
      ctx.quadraticCurveTo(x - tail * .24, y + vertical - size * .018, x, y + vertical);
      ctx.strokeStyle = 'rgba(' + color + ',' + (strength * (.74 + cinemaEnergy * .16)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, size * .005);
      ctx.stroke();
    }
    stampStar(x - tail * .60, y + size * .012, Math.max(1.1, size * .0065), isMint, strength * (.76 + cinemaEnergy * .15));
  }

  function arrivalGlow(size, elapsed) {
    const phase = unit(elapsed / .68);
    // Smooth fade-in and fade-out (zero pop at phase = 0)
    const glow = Math.sin(phase * Math.PI) * (1 - phase * .55);
    if (glow <= .01) return;
    ctx.save();
    ctx.rotate(-.24);
    for (let ring = 0; ring < 2; ring++) {
      const radius = size * (.19 + .35 * smooth(phase) + ring * .074);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * .48, 0, 0, tau);
      ctx.strokeStyle = ring
        ? 'rgba(173,255,207,' + (glow * .58).toFixed(3) + ')'
        : 'rgba(217,161,255,' + (glow * .78).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, size * .008 * glow);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const angle = i * tau / 8 + .4;
      const radius = size * (.16 + .44 * smooth(phase));
      stampStar(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * .58,
        Math.max(1.2, size * .0092),
        i % 2 !== 0,
        glow
      );
    }
    ctx.restore();
  }

  // Fast post-draw clear over cached doc-space text blocks (zero DOM reads, zero clip('evenodd'))
  function clearTextOverlap(sy) {
    if (!paintedRect.active) return;
    const px = paintedRect.x, py = paintedRect.y;
    const pr = px + paintedRect.w, pb = py + paintedRect.h;
    const inset = 6;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    for (let i = 0; i < cachedBlocks.length; i++) {
      const b = cachedBlocks[i];
      const top = b.fixed ? b.top : b.top - sy;
      const bottom = b.fixed ? b.bottom : b.bottom - sy;
      if (bottom + inset <= py || top - inset >= pb) continue;
      if (b.right + inset <= px || b.left - inset >= pr) continue;

      const cx = Math.floor(b.left - inset);
      const cy = Math.floor(top - inset);
      const cw = Math.ceil(b.right - b.left + inset * 2 + 1);
      const ch = Math.ceil(bottom - top + inset * 2 + 1);
      ctx.clearRect(cx, cy, cw, ch);
    }
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
    const progress = position;
    const t = clock;
    const chapter = updateChapter(progress);
    const dest = computeTargetStage(sy);
    const area = advanceRenderedStage(dest, dt);
    const formation = area.formation;
    const contactMix = area.contact;
    const landed = t - arrival;
    const orbiting = 1 - smooth(formation * 1.6);
    const energy = Math.sin(chapter.local * Math.PI) ** 2;

    const margin = Math.ceil(area.w * 1.08 + 16);
    const x = Math.max(0, Math.floor(area.x - margin));
    const y = Math.max(0, Math.floor(area.y - margin));
    const right = Math.min(width, Math.ceil(area.x + margin));
    const bottom = Math.min(height, Math.ceil(area.y + margin));

    clearPainting();
    if (right <= x || bottom <= y) {
      particleField.fill(0);
      window.dispatchEvent(particleEvent);
      return;
    }

    paintedRect.x = x;
    paintedRect.y = y;
    paintedRect.w = right - x;
    paintedRect.h = bottom - y;
    paintedRect.active = true;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(paintedRect.x, paintedRect.y, paintedRect.w, paintedRect.h);
    ctx.clip();

    // Continuous lively 3D levitation & subtle sway (always active, even at scrollY = 0)
    const drift = mix(1, .62, contactMix);
    const hoverX = Math.sin(t * .74) * area.w * .018 * drift;
    const hoverY = Math.sin(t * .92) * area.w * .030 * drift;
    ctx.translate(area.x + hoverX, area.y + hoverY);

    if (area.rail < .72 && formation < .98) {
      ctx.globalAlpha = (1 - formation * .84) * mix(1, .94, contactMix);
      atmosphere(area.w, t, progress, energy, contactMix);
      ctx.globalAlpha = 1;
    }
    if (landed >= 0 && landed < .68) arrivalGlow(area.w, landed);

    const pointerTurn = cursor.x * .038 + cursor.y * .014;
    const idleSway = (.055 * Math.sin(t * .72) + .022 * Math.cos(t * .41)) * drift;
    const normalTurn = idleSway
      + (.065 * Math.sin(t * .88) * drift + pointerTurn) * (.45 + .55 * Math.sin(progress * Math.PI))
      + .11 * Math.sin(progress * tau) * drift;
    const contactTurn = .045 * Math.sin(t * .68) * drift + pointerTurn * .5;
    const groupTurn = mix(normalTurn, contactTurn, contactMix);
    ctx.rotate(groupTurn * (1 - formation));

    // Reuse pre-allocated 4-pose object pool in-place (zero allocations)
    for (let i = 0; i < art.length; i++) {
      const p = art[i];
      const pose = poses[i];
      const beat = unit((chapter.local - i * .037) / (.87 - i * .037));
      const openFactor = mix(1, .30, contactMix);
      const open = (Math.sin(beat * Math.PI) ** 2) * openFactor * orbiting;
      const breath = .5 - .5 * Math.cos(t * (1.42 + i * .098) + i * .64);
      const normalSpread = .13 + (.34 * breath + (1.02 + cinemaEnergy * .08) * open) * mix(.38, 1, orbiting);
      const contactSpread = .10 + .18 * breath * drift;
      const spread = mix(normalSpread, contactSpread, contactMix);
      const idleX = Math.cos(t * 1.12 + i * 1.92) * (.011 + .034 * open) * drift;
      const idleY = Math.sin(t * 1.48 + i * 1.68) * (.024 + .032 * open) * drift;
      const ox = p.cx * (1 + spread) + idleX;
      const oy = p.cy * (1 + spread) + idleY - (i === 0 ? .050 : 0);
      const turn = p.turn * (.12 + .78 * breath + open * (2.05 + .34 * Math.sin(chapter.index + i))) * drift;
      const fit = 1 - .31 * open;
      const inset = .92 - .09 * open;
      const scale = area.w * mix(fit * inset, .41, formation);
      const bob = Math.sin(t * 6 - p.lane * 1.6);

      pose.image = p.image;
      pose.x = area.w * mix(ox * fit, p.lane * .27, formation);
      pose.y = area.w * mix(oy * fit, bob * .018, formation);
      pose.turn = mix(turn, area.direction * (.22 + bob * .12), formation);
      pose.w = p.width * scale;
      pose.h = p.height * scale;
    }

    if (formation > .02) {
      for (let i = 0; i < poses.length; i++) {
        wake(poses[i].x, poses[i].y, area.w, formation, area.direction, i);
      }
    }

    const world = ctx.getTransform();
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const offset = i * 3;
      const wx = (world.a * p.x + world.c * p.y + world.e) / ratio;
      const wy = (world.b * p.x + world.d * p.y + world.f) / ratio;
      particleField[offset] = wx;
      particleField[offset + 1] = wy;
      particleField[offset + 2] = Math.max(p.w, p.h) * .55;

      debugState.pieces[i][0] = wx;
      debugState.pieces[i][1] = wy;

      if (!p.image) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.turn);
      ctx.drawImage(p.image, -p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    ctx.restore();
    clearTextOverlap(sy);

    frameCount++;
    debugState.x = area.x;
    debugState.y = area.y;
    debugState.w = area.w;
    debugState.t = t;
    debugState.frame = frameCount;
    debugState.formation = formation;
    debugState.contact = contactMix;

    window.dispatchEvent(particleEvent);
  }

  function schedule() {
    if (!document.hidden && !frame && ready) {
      frame = requestAnimationFrame(tick);
    }
  }

  // Full native 60fps+ continuous animation loop (pauses only when document.hidden)
  function tick(now) {
    frame = 0;
    if (document.hidden || !ready) return;

    const elapsed = previous ? (now - previous) : 16.667;
    const dt = Math.min(.034, Math.max(.001, elapsed / 1000));
    previous = now;

    // Smoothly damp cinema energy and scroll velocity for silky transitions
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
    cursor.tx = Math.max(-1, Math.min(1, 2 * e.clientX / width - 1));
    cursor.ty = Math.max(-1, Math.min(1, 2 * e.clientY / height - 1));
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
