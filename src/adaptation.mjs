// Missing mode preserves existing installations' AI switch until explicitly changed.
export const adaptationMode = cfg => ['none','manual','ai'].includes(cfg.adaptationMode)
  ? cfg.adaptationMode : cfg.assistMotions === true ? 'ai' : 'none';
export const aiEnabled = cfg => adaptationMode(cfg) === 'ai';
