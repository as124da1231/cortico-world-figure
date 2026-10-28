/** 测试共用的模型目录：由环境变量提供，没有就跳过。 */
export const MODEL = (process.env.L2D_MODEL || '').trim();

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
