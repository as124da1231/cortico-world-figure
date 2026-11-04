export async function useLanguage(){}
export function t(key,values={}){const text={'figure.imageFailed':'贴图加载失败：'+(values.url||''),'figure.notFunction':'模型缺少入口：'+(values.name||''),'figure.missingMethod':'模型缺少方法：'+(values.name||'')}[key];return text||key;}
