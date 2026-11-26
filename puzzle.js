(() => {
  'use strict';

  const canvas = document.querySelector('#puzzle');
  const ctx = canvas?.getContext('2d');
  const main = document.querySelector('#principal');
  if (!ctx || !main) return;

  const intro = main.querySelector('.intro');
  const chapters = [...main.querySelectorAll('.story section')];
  const TEXT_SELECTOR = 'header nav, .intro .eyebrow, .intro h1, .intro p, .intro .actions, .chapter-inner:not(.contact-panel), .story h2:not(#contato-titulo), .story .piece, footer';
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
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
  const stageDest = { x: 0, y: 0, docY: 0, w: 0, rail: 0, side: 1, index: -1, isContact: false, hasSide: false };
  const settledState = { x: 0, y: 0, docY: 0, w: 0, rail: 0, side: 1, index: -1, isContact: false, valid: false };
  const activeStage = { x: 0, y: 0, docY: 0, w: 0, rail: 0, formation: 0, direction: 0, isContact: false };
  const paintedRect = { x: 0, y: 0, w: 0, h: 0, active: false };

  const stars = [
    [-.52, -.26, 4.1], [-.42, -.31, 1.5], [-.35, -.43, 2.4], [-.31, -.46, 1.1], [-.17, -.53, 1.5],
    [.40, -.37, 1.5], [.55, -.24, 2.3], [.61, -.09, 1.4], [.54, .31, 3.8], [.45, .37, 1.2],
    [.37, .41, 1.8], [.22, .46, 1.1], [-.23, .47, 3.0], [-.38, .39, 1.1], [-.49, .25, 1.6]
  ];
  const ORBIT_SEGMENTS = 15;

  let width = 0, height = 0, ratio = 1, layout = [], marks = [0, 1];
  let flight = null, hero = null, distance = 1;
  let mobileRail = null, mobileDock = null;
  let cachedBlocks = [];
  let target = 0, position = 0, clock = .4, previous = 0, frame = 0, ready = false;
  let paintedScroll = -Infinity;
  let clearedScroll = -Infinity;
  let headerSafeBottom = 76;
  let lastScroll = -Infinity;
  let transfer = null, arrival = -Infinity;
  let cinemaPlaying = false, cinemaEnergy = 0, cinemaSpeed = 1, scrollVelocity = 0;
  let reducedDirty = true;
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

    settledState.valid = false;
    transfer = null;
    arrival = -Infinity;

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
        // Dedicated poised, centered finale crest above the contact card
        // (eliminates the tiny ~80px stray clump in the left margin).
        const prevContentBottom = layout.length ? layout[layout.length - 1].contentBottom : box.top + sy;
        const panelTop = content.top + sy;
        const gapAbove = Math.max(0, panelTop - prevContentBottom);
        const contactW = Math.min(
          Math.max(146, gapAbove * .76),
          readingHeight * .33,
          content.width * .32,
          232
        );
        const idealDocY = gapAbove >= 110
          ? panelTop - contactW * .48
          : panelTop - Math.max(26, gapAbove * .30);
        const minDocY = prevContentBottom + contactW * .42;
        const contactDocY = gapAbove >= 110 ? Math.max(minDocY, idealDocY) : idealDocY;

        layout.push({
          top: box.top + sy,
          bottom: box.bottom + sy,
          contentTop: panelTop,
          contentBottom: content.bottom + sy,
          x: content.left + content.width / 2,
          free: content.width,
          side: 0,
          isContact: true,
          contactW,
          contactDocY
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
          contactW: 0,
          contactDocY: 0
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
    target = unit(sy / distance);
    if (preference.matches) position = target;
    reducedDirty = true;
    schedule();
  }

  function updateChapter(progress) {
    let index = 0;
    while (index < marks.length - 2 && progress >= marks[index + 1]) index++;
    chapterState.index = index;
    chapterState.local = unit((progress - marks[index]) / (marks[index + 1] - marks[index]));
    return chapterState;
  }

  function computeStage(gentle, sy) {
    if (width <= 800) {
      const slot = flight || { x: width * .5, y: (intro?.offsetHeight || 260) + 80, w: width, h: 160 };
      const cy = slot.y - sy;
      const displayScroll = position * distance;
      const rail = smooth(displayScroll / Math.max(60, slot.y - height * .32));
      const railY = height * (.47 + (gentle ? .04 : .23) * Math.sin(position * tau * 2.25 - .6));
      const lift = smooth((height * .32 - slot.y + displayScroll) / (height * .22));
      const mr = mobileRail || { x: width * .85, w: Math.min(84, width * .22) };

      stageDest.x = mix(slot.x, mr.x, rail);
      stageDest.y = mix(cy, railY, lift);
      stageDest.w = mix(Math.min(slot.w * .77, slot.h * .79), mr.w, rail);
      stageDest.rail = rail;
      stageDest.hasSide = false;
      stageDest.isContact = false;
      stageDest.index = -1;

      if (mobileDock && rail >= 1) {
        const remaining = distance - displayScroll;
        const approach = Math.min(height * .55, Math.max(190, mobileDock.gap * 2.2));
        const align = smooth((approach - remaining) / (approach * .55));
        const pocketY = mobileDock.y - sy;
        const visible = smooth((height - pocketY - mobileDock.w * .55) / (mobileDock.w * .38));
        const cross = smooth((approach * .45 - remaining) / (approach * .42)) * visible;
        stageDest.y = mix(stageDest.y, pocketY, align);
        stageDest.x = mix(stageDest.x, mobileDock.x, cross);
        stageDest.w = mix(stageDest.w, mobileDock.w, cross);
        stageDest.isContact = cross > .55;
      }
      stageDest.docY = stageDest.y + sy;
      return stageDest;
    }

    const readingHeight = Math.min(height, hero.h / .82);
    const focus = sy + readingHeight * .46;
    let index = -1;
    for (let i = layout.length - 1; i >= 0; i--) {
      if (focus >= layout[i].top) { index = i; break; }
    }
    if (index < 0) {
      const w = Math.min(hero.free * .73, hero.h * .68, readingHeight * .66);
      const docY = hero.top + hero.h * .49;
      stageDest.x = hero.x;
      stageDest.y = docY - sy;
      stageDest.docY = docY;
      stageDest.w = w;
      stageDest.rail = 0;
      stageDest.side = 1;
      stageDest.index = -1;
      stageDest.isContact = false;
      stageDest.hasSide = true;
      return stageDest;
    }

    const row = layout[index];
    if (row.isContact) {
      // Fit and center the finale crest cleanly in the open band between
      // the sticky navbar pill and the top of .contact-panel so topo.webp
      // and upper orbits are never clipped by header clearRect.
      const headerClearBottom = headerSafeBottom + 12;
      const panelVisTop = row.contentTop - sy;
      const openGap = panelVisTop - headerClearBottom;
      const fittedW = openGap >= 115
        ? Math.min(row.contactW, Math.max(114, openGap / 1.24))
        : Math.min(row.contactW, 134);
      const minVisY = headerClearBottom + fittedW * .66;
      const idealVisY = openGap >= fittedW * 1.18
        ? headerClearBottom + openGap * .54
        : panelVisTop - fittedW * .48;
      const y = Math.max(minVisY, idealVisY);
      stageDest.x = row.x;
      stageDest.y = y;
      stageDest.docY = y + sy;
      stageDest.w = fittedW;
      stageDest.rail = 0;
      stageDest.side = 0;
      stageDest.index = index;
      stageDest.isContact = true;
      stageDest.hasSide = true;
      return stageDest;
    }

    const heightAvailable = Math.max(1, row.bottom - row.top);
    const w = Math.min(row.free * .65, readingHeight * .53, heightAvailable * .61);
    const local = unit((focus - row.top) / heightAvailable);
    const desired = focus + readingHeight * (gentle ? .02 : .073) * Math.sin(local * tau - .32);
    const docY = Math.max(row.top + w * .67, Math.min(row.bottom - w * .67, desired));

    stageDest.x = row.x;
    stageDest.y = docY - sy;
    stageDest.docY = docY;
    stageDest.w = w;
    stageDest.rail = 0;
    stageDest.side = row.side;
    stageDest.index = index;
    stageDest.isContact = false;
    stageDest.hasSide = true;
    return stageDest;
  }

  function copyStageToSettled(src) {
    settledState.x = src.x;
    settledState.y = src.y;
    settledState.docY = src.docY;
    settledState.w = src.w;
    settledState.rail = src.rail;
    settledState.side = src.side;
    settledState.index = src.index;
    settledState.isContact = src.isContact;
    settledState.valid = true;
  }

  function resolveTravelingStage(dest, time, dt, sy, gentle) {
    if (!dest.hasSide || gentle) {
      activeStage.x = dest.x;
      activeStage.y = dest.y;
      activeStage.docY = dest.docY;
      activeStage.w = dest.w;
      activeStage.rail = dest.rail;
      activeStage.formation = 0;
      activeStage.direction = 0;
      activeStage.isContact = dest.isContact;
      if (dest.hasSide) copyStageToSettled(dest);
      return activeStage;
    }

    if (!settledState.valid) copyStageToSettled(dest);

    if (
      Math.abs(settledState.index - dest.index) > 1 ||
      (transfer && dest.index !== transfer.fromIndex && dest.index !== transfer.toIndex)
    ) {
      transfer = null;
      copyStageToSettled(dest);
      arrival = time;
    }

    if (!transfer && settledState.side !== dest.side) {
      const border = Math.max(settledState.index, dest.index);
      const before = layout[border - 1];
      const after = layout[border];
      const startDoc = before ? before.contentBottom : hero.top + hero.h;
      const endDoc = after ? after.contentTop : dest.docY;
      const lane = (dest.isContact || settledState.isContact)
        ? (dest.isContact ? dest.docY : settledState.docY)
        : (startDoc + endDoc) / 2;
      const laneWidth = (dest.isContact || settledState.isContact)
        ? Math.min(settledState.w, dest.w) * .92
        : Math.min(settledState.w, dest.w, Math.max(1, (endDoc - startDoc) * 2.5));

      transfer = {
        start: time,
        fromX: settledState.x,
        fromDocY: settledState.docY,
        fromW: settledState.w,
        fromIndex: settledState.index,
        fromSide: settledState.side,
        toX: dest.x,
        toDocY: dest.docY,
        toW: dest.w,
        toIndex: dest.index,
        toSide: dest.side,
        toIsContact: dest.isContact,
        lane,
        laneWidth
      };
    }

    if (!transfer) {
      const easing = 1 - Math.exp(-dt * (12 + cinemaEnergy * 3));
      const y = mix(settledState.y, dest.y, easing);
      settledState.x = mix(settledState.x, dest.x, easing);
      settledState.w = mix(settledState.w, dest.w, easing);
      settledState.y = y;
      settledState.docY = y + sy;
      settledState.rail = dest.rail;
      settledState.side = dest.side;
      settledState.index = dest.index;
      settledState.isContact = dest.isContact;

      activeStage.x = settledState.x;
      activeStage.y = settledState.y;
      activeStage.docY = settledState.docY;
      activeStage.w = settledState.w;
      activeStage.rail = settledState.rail;
      activeStage.formation = 0;
      activeStage.direction = 0;
      activeStage.isContact = settledState.isContact;
      return activeStage;
    }

    const duration = cinemaPlaying ? 1.18 : 1.06;
    const phase = unit((time - transfer.start) / duration);
    const depart = smooth(phase / .18);
    const travel = smooth((phase - .18) / .44);
    const dock = smooth((phase - .62) / .38);
    const formation = depart * (1 - dock);

    const useDest = dest.side === transfer.toSide;
    const landX = useDest ? dest.x : transfer.toX;
    const landDocY = useDest ? dest.docY : transfer.toDocY;
    const landW = useDest ? dest.w : transfer.toW;
    const landIsContact = useDest ? dest.isContact : transfer.toIsContact;

    const docY = mix(mix(transfer.fromDocY, transfer.lane, depart), landDocY, dock);
    activeStage.x = mix(transfer.fromX, landX, travel);
    activeStage.y = docY - sy;
    activeStage.docY = docY;
    activeStage.w = mix(mix(transfer.fromW, transfer.laneWidth, depart), landW, dock);
    activeStage.rail = 0;
    activeStage.formation = formation;
    activeStage.direction = Math.sign(transfer.toX - transfer.fromX) || 1;
    activeStage.isContact = landIsContact && phase > .7;

    if (phase === 1) {
      settledState.x = landX;
      settledState.y = landDocY - sy;
      settledState.docY = landDocY;
      settledState.w = landW;
      settledState.rail = 0;
      settledState.side = transfer.toSide;
      settledState.index = useDest ? dest.index : transfer.toIndex;
      settledState.isContact = landIsContact;
      transfer = null;
      arrival = time;
    }
    return activeStage;
  }

  function stampStar(x, y, r, isMint, alpha) {
    if (alpha <= .01 || r <= .2) return;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * Math.min(1, alpha);
    const extent = r * 4;
    ctx.drawImage(isMint ? mintStarSprite : violetStarSprite, x - extent, y - extent, extent * 2, extent * 2);
    ctx.globalAlpha = prevAlpha;
  }

  function atmosphere(w, t, progress, energy, isContact) {
    const cinemaBoost = cinemaEnergy * .22 + scrollVelocity * .10;
    const finaleSoft = isContact ? .86 : 1;

    // Subtle soft ambient orbital bloom during cinema mode or at the #contato finale
    const bloomAlpha = (.09 + cinemaEnergy * .16 + (isContact ? .14 : 0)) * finaleSoft;
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
      const tilt = (isContact ? (isMint ? .12 : -.12) : (isMint ? .15 : -.40)) + Math.sin(t * .74 + lane) * (isContact ? .04 : .09);
      const cy = w * (isContact ? (isMint ? .06 : -.06) : (isMint ? .131 : -.100));
      const head = (isMint ? -.54 : 3.05) + (isMint ? -.84 : 1.04) * t + progress * 2.1;

      ctx.save();
      ctx.translate(0, cy);
      ctx.rotate(tilt);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(.72, w * .0018);

      // 15 segments per orbit (down from 22) for lighter GPU stroke cost.
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

      // Luminous comet trail — richer and longer during cinema glide
      const tail = .50 + energy * .24 + cinemaEnergy * .28 + scrollVelocity * .15;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, head - tail, head);
      ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, (.11 + cinemaBoost * .22) * finaleSoft).toFixed(3) + ')';
      ctx.lineWidth = Math.max(4, w * (.0115 + cinemaEnergy * .0035));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, (.30 + cinemaBoost * .24) * finaleSoft).toFixed(3) + ')';
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
      const twinkle = .55 + .38 * Math.sin(t * (1.17 + (i % 3) * .37) + i * 1.8);
      const radius = Math.max(.9, (w / 370) * s[2]) * (.78 + twinkle * .29) * (1 + cinemaEnergy * .08);
      const drift = .045 * Math.sin(t * .7 + i);
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
    const tail = direction * size * (.40 + cinemaEnergy * .12);
    ctx.lineCap = 'round';

    // Two tapered translucent arcs replace per-frame createLinearGradient()
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
    const phase = unit(elapsed / .64);
    const glow = (1 - phase) ** 2;
    ctx.save();
    ctx.rotate(-.24);
    for (let ring = 0; ring < 2; ring++) {
      const radius = size * (.19 + .35 * smooth(phase) + ring * .074);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * .48, 0, 0, tau);
      ctx.strokeStyle = ring
        ? 'rgba(173,255,207,' + (glow * .62).toFixed(3) + ')'
        : 'rgba(217,161,255,' + (glow * .84).toFixed(3) + ')';
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
    const inset = 8;

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
    if (!ready || width < 2 || height < 2) return;
    const gentle = preference.matches;
    const sy = window.scrollY;
    const progress = position;
    const t = clock;
    const chapter = updateChapter(progress);
    const dest = computeStage(gentle, sy);
    const area = resolveTravelingStage(dest, t, dt, sy, gentle);
    const formation = area.formation;
    const isContact = area.isContact;
    const landed = t - arrival;
    const orbiting = gentle ? 1 : (1 - smooth(formation * 4)) * smooth(landed / .80);
    const energy = Math.sin(chapter.local * Math.PI) ** 2;

    const margin = Math.ceil(area.w * 1.04 + 14);
    const x = Math.max(0, Math.floor(area.x - margin));
    const y = Math.max(0, Math.floor(area.y - margin));
    const right = Math.min(width, Math.ceil(area.x + margin));
    const bottom = Math.min(height, Math.ceil(area.y + margin));

    clearPainting();
    paintedScroll = sy;
    clearedScroll = sy;
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

    const drift = gentle ? 0 : (isContact ? .55 : 1);
    const hoverX = Math.sin(t * .74) * area.w * .015 * drift;
    const hoverY = Math.sin(t * .87) * area.w * .025 * drift;
    ctx.translate(area.x + hoverX, area.y + hoverY);

    if (area.rail < .72 && formation < .98) {
      ctx.globalAlpha = (1 - formation * .84) * (isContact ? .94 : 1);
      atmosphere(area.w, t, progress, energy, isContact);
      ctx.globalAlpha = 1;
    }
    if (!gentle && landed < .64) arrivalGlow(area.w, landed);

    const pointerTurn = gentle ? 0 : cursor.x * .035 + cursor.y * .012;
    const groupTurn = isContact
      ? (.04 * Math.sin(t * .65) * drift + pointerTurn * .5)
      : (.09 * Math.sin(t * .84) * drift + pointerTurn) * Math.sin(progress * Math.PI) + .13 * Math.sin(progress * tau) * drift;
    ctx.rotate(groupTurn * (1 - formation));

    // Reuse pre-allocated 4-pose object pool in-place (zero allocations)
    for (let i = 0; i < art.length; i++) {
      const p = art[i];
      const pose = poses[i];
      const beat = unit((chapter.local - i * .037) / (.87 - i * .037));
      const openFactor = isContact ? .28 : (gentle ? .22 : 1);
      const open = (Math.sin(beat * Math.PI) ** 2) * openFactor * orbiting;
      const breath = gentle ? .35 : (.5 - .5 * Math.cos(t * (1.38 + i * .094) + i * .64));
      const spread = isContact
        ? (.09 + .16 * breath * drift)
        : (.12 + (.33 * breath + (1.03 + cinemaEnergy * .08) * open) * (gentle ? .45 : 1) * mix(.36, 1, orbiting));
      const idle = gentle ? 0 : Math.sin(t * 1.47 + i * 1.71) * (.016 + .032 * open) * drift;
      const ox = p.cx * (1 + spread) + Math.cos(i * 1.85 + t * .74) * .044 * open;
      const oy = p.cy * (1 + spread) + idle - (i === 0 ? .050 : 0);
      const turn = p.turn * (.08 + .74 * breath + open * (2.1 + .34 * Math.sin(chapter.index + i))) * (gentle ? .4 : drift);
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

    if (!gentle && formation > .01) {
      for (let i = 0; i < poses.length; i++) {
        wake(poses[i].x, poses[i].y, area.w, formation, area.direction, i);
      }
    }

    const world = ctx.getTransform();
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const offset = i * 3;
      particleField[offset] = (world.a * p.x + world.c * p.y + world.e) / ratio;
      particleField[offset + 1] = (world.b * p.x + world.d * p.y + world.f) / ratio;
      particleField[offset + 2] = Math.max(p.w, p.h) * .55;

      if (!p.image) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.turn);
      ctx.drawImage(p.image, -p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    ctx.restore();
    clearTextOverlap(sy);
    window.dispatchEvent(particleEvent);
  }

  function schedule() {
    if (!document.hidden && !frame && ready) {
      if (preference.matches && !reducedDirty) return;
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    frame = 0;
    if (document.hidden || !ready) return;

    if (preference.matches) {
      reducedDirty = false;
      position = target;
      previous = now;
      draw(.016);
      return;
    }

    const elapsed = now - (previous || now - 33);
    const activeMotion = cinemaPlaying || !!transfer || Math.abs(position - target) > .001 || (now - lastScroll < 200);
    // Fluid 60fps during cinema mode / scrolling / transfers; efficient ~30fps when idle.
    const minInterval = activeMotion ? 13 : 32;
    if (paintedScroll === window.scrollY && elapsed < minInterval) {
      schedule();
      return;
    }

    const dt = Math.min(85, Math.max(1, elapsed)) / 1000;
    previous = now;

    // Smoothly damp cinema energy and scroll velocity for silky transitions
    const cinemaTarget = cinemaPlaying ? 1 : 0;
    cinemaEnergy += (cinemaTarget - cinemaEnergy) * (1 - Math.exp(-dt * 4.5));
    if (Math.abs(cinemaEnergy - cinemaTarget) < .002) cinemaEnergy = cinemaTarget;
    scrollVelocity *= Math.exp(-dt * 5.5);

    const speedBoost = 1 + cinemaEnergy * (.18 * cinemaSpeed) + scrollVelocity * .24;
    clock += dt * speedBoost;

    const trackRate = cinemaPlaying ? 14 : 9.5;
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
    if (paintedRect.active && paintedScroll !== sy && clearedScroll !== sy) {
      clearedScroll = sy;
      clearTextOverlap(sy);
    }
    lastScroll = performance.now();
    if (Number.isFinite(progressValue)) {
      target = unit(progressValue);
    } else {
      target = unit(sy / distance);
    }
    if (Number.isFinite(velocityValue)) {
      scrollVelocity = Math.max(scrollVelocity, unit(velocityValue));
    }
    reducedDirty = true;
    schedule();
  }

  window.addEventListener('curriculo:cinema', e => {
    const detail = e.detail;
    if (!detail) return;
    cinemaPlaying = detail.state === 'playing';
    if (Number.isFinite(detail.speed) && detail.speed > 0) cinemaSpeed = detail.speed;
    if (Number.isFinite(detail.progress)) target = unit(detail.progress);
    reducedDirty = true;
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
    if (preference.matches || e.pointerType === 'touch' || width <= 0 || height <= 0) return;
    cursor.tx = Math.max(-1, Math.min(1, 2 * e.clientX / width - 1));
    cursor.ty = Math.max(-1, Math.min(1, 2 * e.clientY / height - 1));
  }, { passive: true });

  document.addEventListener('pointerleave', () => { cursor.tx = cursor.ty = 0; });

  document.addEventListener('visibilitychange', () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    if (!document.hidden) {
      reducedDirty = true;
      schedule();
    }
  });

  preference.addEventListener('change', () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    reducedDirty = true;
    schedule();
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
    reducedDirty = true;
    schedule();
  }).catch(error => console.error(error));
})();
