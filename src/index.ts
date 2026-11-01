import type { WorldDefinition } from 'cortico/world.ts';
import type { EventDescribe } from 'cortico/core/types.ts';
import { Live2dWorld, type Live2dSection } from './world.ts';
import { FIGURE_TOOL_DECLS, FIGURE_EVENTS, FIGURE_SUMMARIES } from './automation.mjs';

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
    clean: false,
    autoDelete: false,
    assistMotions: false,
    assistGear: 'auto',
    assistDepth: 'standard',
    assistAuto: false,
    modelRoots: '',
  }),
  describe: { tools: FIGURE_TOOL_DECLS.map(({name,description,parameters,tags}) => ({name,description,parameters,tags,summary:FIGURE_SUMMARIES[name as keyof typeof FIGURE_SUMMARIES]})), events: FIGURE_EVENTS as EventDescribe[] },
  create: (ctx) =>
    new Live2dWorld({
      getConfig: () => ctx.cfg,
      persist: (patch) => ctx.persist(patch as never),
      dataDir: ctx.dataDir,
    }),
};

export default LIVE2D;
