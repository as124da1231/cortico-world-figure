import type { WorldDefinition } from 'cortico/world.ts';
import type { EventDescribe } from 'cortico/core/types.ts';
import { Live2dWorld, type Live2dSection } from './world.ts';
import { FIGURE_TOOL_DECLS, FIGURE_EVENTS, FIGURE_SUMMARIES } from './automation.mjs';
import { VOICE_CONTROLS } from './voice-settings.mjs';
import { FIGURE_SPEAK } from './voice.ts';

export type { Live2dSection };

export const LIVE2D: WorldDefinition<Live2dSection> = {
  id: 'figure',
  label: 'Live2D 模型一键安装',
  defaults: () => ({
    enabled: false,
    modelDir: '',
    figuresDir: '',
    workDir: '',
    cover: true,
    texture: 'original',
    quality: 'balanced',
    previewSize: '512',
    emotionEffect: 'native',
    emotionEffectSize: 'medium',
    gearTheme: 'red',
    particleEffect: 'stars',
    uiMaterial: 'matte',
    uiMode: 'auto',
    uiCorners: 'standard',
    uiGlow: 'subtle',
    uiStyle: 'custom',
    uiButtonFill: 'gradient',
    clean: false,
    autoDelete: false,
    adaptationMode: '', // Unset preserves the legacy AI preference.
    assistMotions: false,
    assistGear: 'auto',
    assistDepth: 'standard',
    assistAuto: true,
    assistConfirmFallback: false,
    modelRoots: '',
    ...VOICE_CONTROLS,
  }),
  describe: {
    tools: [
      ...FIGURE_TOOL_DECLS.map(({name,description,parameters,tags}) => ({name,description,parameters,tags,summary:FIGURE_SUMMARIES[name as keyof typeof FIGURE_SUMMARIES]})),
      { name: FIGURE_SPEAK.name, description: FIGURE_SPEAK.description, parameters: FIGURE_SPEAK.parameters, tags: FIGURE_SPEAK.tags, summary: 'Start the configured Figure voice alongside the Coo reply bubble.' },
    ],
    events: FIGURE_EVENTS as EventDescribe[],
  },
  create: (ctx) =>
    new Live2dWorld({
      getConfig: () => ctx.cfg,
      persist: (patch) => ctx.persist(patch as never),
      dataDir: ctx.dataDir,
      botDir: ctx.botDir,
      secret: name => ctx.secret(name),
      storeSecret: (name, value) => ctx.storeSecret(name, value),
    }),
};

export default LIVE2D;
