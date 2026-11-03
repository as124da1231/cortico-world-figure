import type { MovementInput } from "../lib/ecctrl/index";

export function createQuickControls(resetPlayer: () => void, openModel: () => void, toggleInspector: () => void) {
  let scripted: MovementInput | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { clearTimeout(timer); scripted = null; };
  const run = (running: boolean) => {
    stop(); scripted = { forward: true, backward: false, leftward: false, rightward: false, run: running, jump: false };
    timer = setTimeout(stop, running ? 1800 : 3000);
  };
  const bindings: Array<[HTMLElement, () => void]> = [];
  for (const [id, handler] of Object.entries({ "demo-open": openModel, "demo-inspector": toggleInspector, "demo-walk": () => run(false), "demo-run": () => run(true), "demo-stop": stop, "demo-reset": () => { stop(); resetPlayer(); } })) {
    const button = document.getElementById(id); if (!button) continue;
    button.addEventListener("click", handler); bindings.push([button, handler]);
  }
  window.addEventListener("keydown", stop); window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", stop);
  return {
    get input() { return scripted; },
    dispose() { stop(); for (const [button, handler] of bindings) button.removeEventListener("click", handler); window.removeEventListener("keydown", stop); window.removeEventListener("blur", stop); document.removeEventListener("visibilitychange", stop); },
  };
}
