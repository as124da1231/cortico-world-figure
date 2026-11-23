export const DRAG_FEEDBACK_BASE = .75;

export function normalizeDragFeedback(value) {
  return typeof value === 'number' && value >= 0 && value <= 1.5 ? value : 1;
}

export function nextHandlingBlend(mode, current, dt) {
  if (mode === 'drag' || mode === 'air' || mode === 'land' || (mode === 'dizzy' && current > .01)) return 1;
  return current * Math.exp(-14 * Math.max(0, Number(dt) || 0));
}

// Keep Kit in charge of motion, input and hit tests across host versions.
export function createFigureBodyWithKit(kit, host, opts, {
  fixedFacing = false, breathingScale = true, dragFeedback,
} = {}) {
  if (!fixedFacing && breathingScale && dragFeedback === undefined) return kit.createBody(host, opts);
  const figure = opts.figure;
  const effects = breathingScale ? {} : { breathing: false };
  let ownsFigure = false;
  const candidate = kit.createBody(host, {
    ...opts,
    bodyEffects: effects,
    figure: Object.assign(Object.create(figure), {
      dispose() { if (ownsFigure) figure.dispose?.(); },
    }),
  });
  const nativeDirectionalFrames = Boolean(candidate.layout().touchFrame);
  const hasFacingOption = !fixedFacing || nativeDirectionalFrames;
  const effectKeys = Object.keys(effects);
  const supportsEffects = effectKeys.every(key => candidate.capabilities?.bodyEffects?.includes(key));
  if ((dragFeedback === undefined && hasFacingOption && supportsEffects) || typeof kit.createPet !== 'function') {
    ownsFigure = true;
    if (effectKeys.length && supportsEffects) {
      const set = candidate.set.bind(candidate);
      candidate.set = state => set(state.bodyEffects
        ? { ...state, bodyEffects: { ...state.bodyEffects, ...effects } } : state);
    }
    return candidate;
  }
  candidate.dispose();
  return createTunedBody(kit, host, opts, {
    fixedFacing: fixedFacing && !nativeDirectionalFrames,
    nativeBreathing: effectKeys.length > 0 && supportsEffects,
    breathingScale, dragFeedback,
  });
}

function createTunedBody(kit, host, {figure, words, css, moves}, {
  fixedFacing, nativeBreathing, breathingScale, dragFeedback,
}) {
  const doc = host.root.ownerDocument;
  const style = doc.createElement('style');
  style.textContent = `
    svg.kit{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}
    .shadow{fill:var(--shadow,rgba(27,22,38,.12))}
    .tearf{fill:var(--tear,#5aaef0)}
    .p-heart{stroke:var(--heart,#f0567a)}
    .p-dust{stroke:var(--dust,#a39db0)}
    .eye{stroke:var(--skin-eye,#00a870)}
    ${css}
  `;
  doc.head.append(style);
  const svg = doc.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','kit');
  svg.setAttribute('aria-hidden','true');
  svg.innerHTML = '<ellipse class="shadow" cx="0" cy="0" rx="0" ry="0"/><g></g><g></g>';
  host.root.append(svg);
  const [shadowEl, petG, fxG] = svg.children;
  const start = host.start ?? {};
  let dialogOpen = false, still = false;
  const controlledFigure = breathingScale || nativeBreathing ? figure : Object.assign(Object.create(figure), {
    draw(...args) {
      removeBreathingScale(true);
      figure.draw(...args);
    },
  });
  const ctl = kit.createPet({shadowEl,petG,fxG}, {
    figure:controlledFigure, words, skin:start.skin ?? null, startX:start.x, startY:start.y,
    startZ:start.z, startFacing:start.facing, enter:start.enter,
    ...(!breathingScale && {bodyEffects:{breathing:false}}),
    bounds:host.bounds, onEvent:host.emit, sfx:{play:host.sound},
    dialogOpen:() => dialogOpen, still:() => still,
  });
  const {pet} = ctl;
  pet.facing = pet.faceVis = start.facing === -1 ? -1 : 1;

  let breathingScaleRemoved = false, deformationBlend = 0;
  function removeBreathingScale(draw) {
    if (breathingScaleRemoved) return;
    breathingScaleRemoved = true;
    // Legacy Kit applies these multipliers to the whole figure, independent of Live2D.
    const breath = Math.sin(ctl.time * (pet.mode === 'sleep' ? 1.7 : 2.4));
    const xf = pet.xf;
    xf.kx /= 1 - .009 * breath;
    xf.ky /= 1 + .016 * breath;
    if (draw) {
      const { AX, AY, ax, ay, kx, ky, rot } = xf;
      petG.setAttribute('transform', `translate(${AX} ${AY}) rotate(${rot}) scale(${kx.toFixed(4)} ${ky.toFixed(4)}) translate(${-ax} ${-ay})`);
    }
  }

  const body = {
    step(dt, draw=true) {
      ctl.step(dt);
      breathingScaleRemoved = false;
      const { faceVis, sq, stretch } = pet;
      if (dragFeedback !== undefined) {
        // Preserve the spring state, then scale just the two values used to draw.
        deformationBlend = nextHandlingBlend(pet.mode, deformationBlend, dt);
        const scale = DRAG_FEEDBACK_BASE * (1 + (dragFeedback - 1) * deformationBlend);
        pet.sq = sq * scale;
        pet.stretch = stretch * scale;
      }
      if (fixedFacing) {
        figure.kitFacing = pet.facing;
        pet.faceVis = 1;
      }
      try {
        ctl.render(draw);
        if (!breathingScale && !nativeBreathing && !draw) removeBreathingScale(false);
      } finally {
        pet.faceVis = faceVis;
        pet.sq = sq;
        pet.stretch = stretch;
      }
    },
    layout:ctl.layout,
    resize:ctl.resize,
    do:ctl.doWord,
    words:[...kit.KIT_EXPRESSIONS,...kit.KIT_MOTIONS,...Object.keys(words)],
    walk:ctl.walkTo,
    stopWalk:ctl.stopWalk,
    move(args, id) {
      if (args?.windowLedge === true) return ctl.climbWindow?.(id, !!args.run) ?? false;
      const resolve = moves?.[args?.to];
      const point = typeof resolve === 'function' ? resolve(args.params ?? {}, { ...host.bounds(), ...ctl.bounds }) : null;
      return !!point && ctl.walkTo(point.x, !!args.run, id, point.y);
    },
    pointer(type, point) {
      if (type === 'down') return ctl.pointerDown(point);
      if (type === 'move') return ctl.pointerMove(point);
      if (type === 'up') return ctl.pointerUp(point);
      if (type === 'cancel') return ctl.pointerUp({ ...point, cancelled: true });
      if (type === 'leave') return ctl.pointerLeave();
      if (type === 'shake') return ctl.shake?.();
    },
    drop:ctl.dropAt,
    shift:ctl.shiftDrag,
    place(x, facing, y, settle = false, z) {
      if (pet.mode === 'drag' || pet.mode === 'air') {
        if (!settle || !ctl.settle) return;
        ctl.doWord('stand');
        ctl.settle();
      }
      if (settle && (pet.mode === 'walk' || pet.mode === 'run')) ctl.settle?.();
      ctl.clearWindowSupport?.();
      ctl.setDepth?.(z);
      const {minX,maxX,minY,floorY} = ctl.bounds;
      pet.x = pet.target = kit.clamp(x,minX,maxX);
      if (ctl.freeGround && Number.isFinite(y)) pet.gy = pet.targetY = pet.fy = kit.clamp(y,minY,floorY);
      if (facing === 1 || facing === -1) pet.facing = pet.faceVis = facing;
    },
    set(state) {
      if (typeof state.bounds?.freeGround === 'boolean') ctl.setFreeGround?.(state.bounds.freeGround);
      if (Object.hasOwn(state, 'desktopWindows')) ctl.setDesktopWindows?.(state.desktopWindows);
      if (state.bodyEffects) ctl.setBodyEffects?.(breathingScale ? state.bodyEffects : { ...state.bodyEffects, breathing:false });
      if (state.roam) ctl.setRoam(state.roam);
      if (typeof state.hold === 'number') ctl.holdRoam(state.hold);
      if (typeof state.dialogOpen === 'boolean') dialogOpen = state.dialogOpen;
      if (typeof state.still === 'boolean') still = state.still;
      if (typeof state.listening === 'boolean') ctl.setListening(state.listening);
      if (typeof state.thinking === 'boolean') ctl.setThinking(state.thinking);
      if (typeof state.thoughtShown === 'boolean') ctl.setThoughtShown(state.thoughtShown);
      if ('status' in state) ctl.setStatus(state.status);
      if (state.skin) ctl.setSkin(state.skin);
      if (state.theme) doc.documentElement.dataset.theme = state.theme;
    },
    cue(kind) {
      if (kind === 'perk') { pet.sqv += .6; ctl.setExpr('surprised',.5); }
      else if (kind === 'heard') pet.sqv += .9;
      else if (kind === 'cheer') ctl.setExpr('happy');
      else if (kind === 'bounce') pet.sqv += 1.2;
    },
    talk:ctl.talk,
    setScheme:(id, opts) => figure.setScheme?.(id, opts),
    get z() { return figure.colors?.z ?? null; },
    dispose() { figure.dispose?.(); svg.remove(); style.remove(); },
  };
  if (ctl.bodyEffects) {
    body.capabilities = { bodyEffects:Object.keys(ctl.bodyEffects), speech:{pulse:true,release:true} };
    Object.defineProperties(body, {
      bodyEffects:{ get:() => ctl.bodyEffects },
      speechState:{ get:() => ({ pulse:pet.talkK }) },
    });
    body.speech = command => {
      if (command?.kind === 'pulse') ctl.talk();
      else if (command?.kind === 'release') ctl.releaseSpeech();
      else throw new TypeError('Unknown body speech command');
    };
  }
  return body;
}
