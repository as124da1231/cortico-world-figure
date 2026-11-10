import {createEmotionEffects} from './emotion-effects.js';

// The adjacent emotion-* modules are from cortico-world-image-figure 3.10.0,
// by as124da1231 (AGPL-3.0-or-later), revision e637c53.
const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE_SCALES = {small: .6, medium: .8, large: 1};

function scaleLayers(make, layers, [left, top, right, bottom], style, scale) {
  const height = bottom - top;
  let x = (left + right) / 2;
  let y = top + height / 2;
  if (style === 'orb' || style === 'bubbles') {
    x = right;
    y = top + height * .23;
  } else if (style !== 'flow' && style !== 'softglow') {
    x = left;
    y = top + height * .10;
  }
  const transform = `translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`;
  for (const layer of layers) {
    const children = [...layer.childNodes];
    // Keep the painter's outer group free to mirror independently of size.
    make('g', {transform}, layer).append(...children);
  }
}

export function createPetEmotionEffects({doc, parent, art, bounds, style, size, theme}) {
  const scale = Object.hasOwn(SIZE_SCALES, size) ? SIZE_SCALES[size] : SIZE_SCALES.medium;
  const make = (tag, attrs, container) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    container.appendChild(node);
    return node;
  };
  // Soft glow can animate the donor's flat artwork. Give it an inert sibling
  // instead so Cubism remains responsible for the model pose and geometry.
  const marker = make('g', {'aria-hidden': 'true'}, parent);
  if (art?.parentNode === parent) parent.insertBefore(marker, art);
  const media = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let effects, geometry, pending;
  let scheme = theme;

  return {
    draw(frame, visible = typeof bounds === 'function' ? bounds() : bounds) {
      if (!Number.isFinite(frame.t) || !Array.isArray(visible) || visible.length !== 4
        || !visible.every(Number.isFinite) || visible[2] <= visible[0] || visible[3] <= visible[1]) return;

      if (!geometry || visible.some((value, index) => value !== geometry[index])) {
        effects?.dispose();
        geometry = [...visible];
        const layers = [];
        const makeEffectNode = (tag, attrs, container) => {
          const node = make(tag, attrs, container);
          if (container === parent) layers.push(node);
          return node;
        };
        effects = createEmotionEffects({make: scale === 1 ? make : makeEffectNode, parent, art: marker, media,
          model: {visible: geometry, effectStyle: style, emotionIntensity: 'natural'}});
        scaleLayers(make, layers, geometry, style, scale);
        effects.setTheme?.(scheme);
      }
      if (pending !== undefined) {
        effects.trigger(pending);
        pending = undefined;
      }
      effects.draw(frame);
    },
    setTheme(value) {
      scheme = value;
      effects?.setTheme?.(value);
    },
    trigger(word) { pending = word; },
    dispose() {
      effects?.dispose();
      marker.remove();
    },
  };
}
