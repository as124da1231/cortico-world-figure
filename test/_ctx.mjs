import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
/** 测试共用的模型目录：由环境变量提供，没有就跳过。 */
export const MODEL = (process.env.L2D_MODEL || '').trim();

export const fixtureManifest = (fields = {}) => ({
  id:'sample', manifest:2, api:2, entry:'figure.js', export:'createFigureBody',
  name:{zh:'名字'}, about:{zh:'旧简介'}, vocab:[], ...fields,
});

export function needModel() {
  if (!MODEL) {
    console.log('skip: 设置 L2D_MODEL 指向一个含 .model3.json 的目录后重跑');
    process.exit(0);
  }
  return MODEL;
}

/** 造一个 World 上下文，目录全在临时目录里。 */
export function makeCtx(tmp, cfg, id = 'figure') {
  return {
    id,
    cfg,
    timezone: 'Asia/Shanghai',
    botName: 'test',
    botDir: tmp,
    packageDir: tmp,
    dataDir: tmp,
    repoRoot: tmp,
    secret: () => '',
    storeSecret: () => {},
    persist: (patch) => Object.assign(cfg, patch),
    restart: async () => {},
  };
}

/** Real-model tests reuse an accepted, prepared runtime and work offline. */
export async function copyTestCubismRuntime(workDir) {
  const source = (process.env.L2D_CORE || '').trim();
  if (!source) throw new Error('设置 L2D_CORE 指向已同意许可并校验的 Core 文件后重跑');
  await mkdir(join(workDir, 'sdk'), { recursive: true });
  await cp(source, join(workDir, 'sdk', 'live2dcubismcore.min.js'));
  for (const file of ['framework.js', 'shaders.js']) await cp(join(dirname(source), file), join(workDir, 'sdk', file));
}

export async function prepareWorld(world, workDir) {
  await copyTestCubismRuntime(workDir);
  await world.start({});
  const invoke = world.webUi('zh').invoke;
  const state = await invoke('workbench', 'state', []);
  await invoke('workbench', 'noticeAccept', [state.notice.revision]);
}
