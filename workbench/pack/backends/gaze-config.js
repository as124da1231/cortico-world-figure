export const GAZE_SPEED_MIN = .25;
export const GAZE_SPEED_MAX = 2.5;
export const GAZE_SPEED_STEP = .05;

export function normalizeGazeConfig(value) {
  const speed = Number.isFinite(value?.speed)
    ? Math.max(GAZE_SPEED_MIN, Math.min(GAZE_SPEED_MAX, value.speed)) : 1;
  return { enabled: value?.enabled !== false, speed };
}
