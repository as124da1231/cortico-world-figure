import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { FIGURE_THEME_ALIASES, FIGURE_THEME_AXIS, FIGURE_THEME_NAME, FIGURE_THEME_PALETTES, normalizeFigureThemes } from './theme-palette.mjs';

const thumbDir = 'thumb/themes';
const optionId = id => FIGURE_THEME_AXIS + id;
const renamedOptions = new Map(Object.entries(FIGURE_THEME_ALIASES).map(([old, current]) => [optionId(old), optionId(current)]));
const themeIds = new Set([...FIGURE_THEME_PALETTES.map(palette => optionId(palette.id)), ...renamedOptions.keys()]);
const legacyBubbles = [
  ['#fff5f7', '#552438', '#a34c6e', '#34202a', '#ffe2ec', '#dc91aa'],
  ['#eff5ff', '#223962', '#5a7aad', '#202d44', '#e1ecff', '#91aee2'],
  ['#fff5e3', '#543214', '#9b662e', '#382919', '#ffe9c6', '#d9a86a'],
];

function themeSwatch(palette) {
  const width = 64, centre = (width - 1) / 2;
  const data = Buffer.alloc(width * width * 4);
  const rgb = hex => hex.slice(1).match(/../g).map(byte => parseInt(byte, 16));
  const ink = rgb(palette.accent);
  const tint = rgb(palette.console.light.a2).map(channel => Math.round(216 + channel * .15));
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const radius = Math.hypot(x - centre, y - centre);
      if (radius >= 22) continue;
      const color = radius < 8 || radius > 18 ? ink : tint;
      const offset = (y * width + x) * 4;
      data.set([...color, Math.round(255 * Math.min(1, 22 - radius))], offset);
    }
  }
  return PNG.sync.write({ width, height: width, data });
}

/** Populate Coo's settings-window presets and its independent Dress up colour axis. */
export async function writePackThemes(pack, manifest, selection) {
  const axes = manifest.axes ?? [];
  const index = axes.findIndex(axis => axis.id === FIGURE_THEME_AXIS);
  const previous = axes[index];
  if (selection === undefined && !previous) return;
  const ids = normalizeFigureThemes(selection === undefined
    ? previous.options.map(option => option.id.slice(FIGURE_THEME_AXIS.length))
    : selection);
  if (previous && !previous.options.every(option => themeIds.has(option.id))) {
    if (selection !== undefined && ids.length) throw Error('主题配色栏位与已有装扮分组重复');
    return;
  }

  // Migrate only the reply-bubble colours written by the previous Figure build.
  const bubble = ['light', 'dark'].flatMap(mode => ['fill', 'text', 'line'].map(key => manifest.bubble?.[mode]?.[key]));
  if (selection !== undefined && legacyBubbles.some(colors => colors.every((color, i) => color === bubble[i]))) delete manifest.bubble;
  const palettes = FIGURE_THEME_PALETTES.filter(palette => ids.includes(palette.id));
  if (!previous && !palettes.length) return;

  const options = palettes.map(palette => ({
    id: optionId(palette.id), name: palette.name, accent: palette.accent, thumb: `${thumbDir}/${palette.id}.png`,
  }));
  const presets = (manifest.presets ?? []).filter(preset =>
    !previous || !themeIds.has(preset.id) || preset.pick?.[FIGURE_THEME_AXIS] !== preset.id);
  if (options.some(option => presets.some(preset => preset.id === option.id))) {
    throw Error('主题配色预设与已有装扮预设重复');
  }
  if (options.length) {
    const axis = { id: FIGURE_THEME_AXIS, name: FIGURE_THEME_NAME, options };
    if (previous) axes[index] = axis;
    else axes.push(axis);
  } else {
    axes.splice(index, 1);
  }
  manifest.axes = axes;
  for (const preset of presets) {
    if (!options.length) {
      delete preset.pick[FIGURE_THEME_AXIS];
    } else {
      const pick = preset.pick[FIGURE_THEME_AXIS];
      const allowed = renamedOptions.get(pick) ?? pick;
      preset.pick[FIGURE_THEME_AXIS] = options.find(option => option.id === allowed)?.id ?? options[0].id;
    }
  }
  const defaults = Object.fromEntries(axes.map(axis => [axis.id, axis.options[0].id]));
  // Identical picks on the other axes keep Coo's nearest-preset match on the chosen colour.
  manifest.presets = [...presets, ...palettes.map(palette => ({
    id: optionId(palette.id), name: palette.name, accent: palette.accent,
    pick: { ...defaults, [FIGURE_THEME_AXIS]: optionId(palette.id) }, console: palette.console,
  }))];

  if (options.length) {
    await mkdir(join(pack, thumbDir), { recursive: true });
    await Promise.all(palettes.map((palette, i) => writeFile(join(pack, options[i].thumb), themeSwatch(palette))));
  }
  for (const option of previous?.options ?? []) {
    const id = option.id.slice(FIGURE_THEME_AXIS.length);
    const thumb = `${thumbDir}/${id}.png`;
    if (!ids.includes(id) && option.thumb === thumb) {
      await rm(join(pack, thumb), { force: true });
    }
  }
}
