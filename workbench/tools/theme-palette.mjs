// Colour values from Coopanion 0.2.23, desktop-pet/web/whale/figure.json.
export const FIGURE_THEME_AXIS = 'figuretheme';
export const FIGURE_THEME_NAME = {
  zh: '配色', 'zh-Hant': '配色', en: 'Colours', ja: 'カラー', ko: '색상',
  fr: 'Couleurs', de: 'Farben', 'es-419': 'Colores', 'pt-BR': 'Cores', it: 'Colori', ru: 'Цвета',
};

export const FIGURE_THEME_PALETTES = Object.freeze([
  {
    id: 'deepseek', name: { zh: '蓝色', 'zh-Hant': '藍色', en: 'Blue' }, accent: '#4D6BFE',
    console: {
      light: { a: '#4562f5', a2: '#7b90fe', on: '#ffffff', t: '#3550d6', c3: '#8ea0c8', c4: '#8a8a90' },
      dark: { a: '#7b93ff', a2: '#a3b3ff', on: '#0d1640', t: '#9aabff', c3: '#8ea0c8', c4: '#9a9aa0' },
    },
  },
  {
    id: 'chatgpt', name: { zh: '黑色', en: 'Black' }, accent: '#303030',
    console: {
      light: { a: '#2f2f2f', a2: '#8e8ea0', on: '#ffffff', t: '#202123', c3: '#10a37f', c4: '#b4b4c0' },
      dark: { a: '#ececf1', a2: '#a9a9b8', on: '#202123', t: '#d9d9e3', c3: '#19c37d', c4: '#6e6e80' },
    },
  },
  {
    id: 'claude', name: { zh: '橙色', en: 'Orange' }, accent: '#D97757',
    console: {
      light: { a: '#d97757', a2: '#c2928a', on: '#1f0f08', t: '#a84e2f', c3: '#7b7974', c4: '#c6a58c' },
      dark: { a: '#e08a6c', a2: '#d9a497', on: '#1f0f08', t: '#eba287', c3: '#97958d', c4: '#c6a58c' },
    },
  },
  {
    id: 'qwen', name: { zh: '紫色', en: 'Purple' }, accent: '#7F69F0',
    console: {
      light: { a: '#7560ea', a2: '#a294f5', on: '#ffffff', t: '#5b45d0', c3: '#b8a9e8', c4: '#8a8a90' },
      dark: { a: '#a596ff', a2: '#c2b8ff', on: '#1a1240', t: '#b3a6ff', c3: '#8f82c9', c4: '#9a9aa0' },
    },
  },
  {
    id: 'minimax', name: { zh: '粉色', en: 'Pink' }, accent: '#D92D7A',
    console: {
      light: { a: '#d92d7a', a2: '#f2762e', on: '#ffffff', t: '#b51f62', c3: '#e8a0c0', c4: '#8a8a90' },
      dark: { a: '#f0619e', a2: '#ff9a5c', on: '#2a0617', t: '#f58ab6', c3: '#c97aa0', c4: '#9a9aa0' },
    },
  },
]);

export const FIGURE_THEME_ALIASES = Object.freeze({ harness: 'chatgpt', gemini: 'deepseek', kimi: 'deepseek' });

export function normalizeFigureThemes(value) {
  const ids = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(id => id.trim()) : [];
  const requested = new Set(ids.map(id => typeof id === 'string' && Object.hasOwn(FIGURE_THEME_ALIASES, id) ? FIGURE_THEME_ALIASES[id] : id));
  return FIGURE_THEME_PALETTES.map(palette => palette.id).filter(id => requested.has(id));
}
