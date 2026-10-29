import type { WorldDefinition } from 'cortico/world.ts';
import { Live2dWorld, type Live2dSection } from './world.ts';

export type { Live2dSection };

export const LIVE2D: WorldDefinition<Live2dSection> = {
  id: 'figure',
  label: 'Coo 魔术人偶工坊',
  defaults: () => ({
    enabled: false,
    modelDir: '',
    figuresDir: '',
    workDir: '',
    cover: true,
    texture: 'original',
    autoDelete: false,
  }),
  describe: { tools: [], events: [] },
  create: (ctx) =>
    new Live2dWorld({
      getConfig: () => ctx.cfg,
      persist: (patch) => ctx.persist(patch as never),
      dataDir: ctx.dataDir,
    }),
};

export default LIVE2D;
