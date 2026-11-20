import { createSoullinkSession } from './vendor/soullink-speech-session.js';

export type SpeakingBeat = { time: number; duration: number; parameters: Record<string, number> };
type Parameter = { name: string; min: number; max: number; default: number };
export type MotionInput = {
  speechText: string;
  durationSec: number;
  frameCount?: number;
  availableParameters?: Record<string, Parameter>;
  expression?: { emotion?: string } | null;
  userMessage?: string;
};
export type MotionResult = { parameterPlan?: SpeakingBeat[]; provider?: string };
type SpeechOptions = {
  text: string;
  durationSec: number;
  name: string;
  emotion?: string;
  directives?: string;
  parameters: Record<string, Parameter>;
  signal: AbortSignal;
  prepare?(): Promise<void>;
  plan(input: MotionInput): Promise<MotionResult>;
  play(beats: SpeakingBeat[]): Promise<{ finished?: Promise<void> }>;
};

// Send recognized movement requests in their original order. Free-form chat
// and surrounding text stay with the main session.
const action = /(?:(?:向|往|朝)[左右前后上下](?:边|侧)?|(?:先|再|最后|然后|轻轻|慢慢|快速|轻微)){0,3}(?:眨(?:一?下)?眼|闭眼|睁眼|转头|歪头|点(?:一?下)?头|摇头|挥(?:一?下)?手|抬手|举手|比(?:个|一颗)?心|鞠躬|看向[左右上下]|低头|抬头)(?:[一二两三四五12345](?:下|次|秒))?|\b(?:(?:slightly|slowly|quickly)\s+)?(?:wink|blink|nod|shake your head|tilt your head|look (?:left|right|up|down)|wave|raise your hand|bow)(?:\s+(?:left|right|twice|once))?\b/giu;
export function speakingDirectives(text: unknown) {
  if (typeof text !== 'string') return undefined;
  const normalized = text.normalize('NFKC').slice(0, 600);
  const matches = [...normalized.matchAll(action)].filter(match =>
    !/(?:不要|不用|别|不许|莫|do not|don't|never)\s*(?:先|再|去|做)?\s*$/iu.test(normalized.slice(Math.max(0, match.index - 18), match.index)));
  const cues = matches.slice(0, 6).map(([value]) => value
    .replace(/眨(?:一?下)眼/u, '眨眼').replace(/点(?:一?下)头/u, '点头')
    .replace(/挥(?:一?下)手/u, '挥手').replace(/比(?:个|一颗)心/u, '比心'));
  return cues.length ? cues.join('，') : undefined;
}

export async function runOriginalSpeech(options: SpeechOptions) {
  let beats: SpeakingBeat[] = [];
  let error: unknown;
  let outputStarted = false;
  const session = createSoullinkSession({
    profile: {
      schemaVersion: 2, modelId: 'figure-live', displayName: options.name, version: '1',
      modelPath: '', parameterMap: {}, neutralParams: {}, idleConfig: {},
    },
    persona: { name: options.name, profile: 'A Coo desktop companion performing on a Live2D model.' },
    clock: { now: () => performance.now() / 1000, start() {}, stop() {} },
    speakingMotionScheduling: {
      mode: 'fixed-parallel', fixedFrameCount: Math.max(2, Math.min(16, Math.ceil(options.durationSec))), frameIntervalSec: 1,
    },
    voiceModel: {
      async synthesize() {
        try {
          await options.prepare?.();
          return { durationSec: options.durationSec };
        } catch (cause) { error = cause; throw cause; }
      },
    },
    motionPlanner: {
      async planSpeakingMotion(input: MotionInput) {
        const result = await options.plan(input);
        if (result.provider !== 'vad-facs') beats = result.parameterPlan ?? [];
        return result;
      },
    },
    audio: {
      async play() {
        try {
          options.signal.throwIfAborted();
          const playback = await options.play(beats);
          outputStarted = true;
          return { durationSec: options.durationSec, finished: playback.finished };
        } catch (cause) { error = cause; throw cause; }
      },
      stop() {},
    },
  });
  const cancel = () => session.stopVoice();
  options.signal.throwIfAborted();
  options.signal.addEventListener('abort', cancel, { once: true });
  try {
    session.setSpeakingMotionParameters(options.parameters);
    await session.speak({ text: options.text, emotion: options.emotion, userMessage: options.directives, planSpeakingMotion: true });
    if (error) throw error;
    return outputStarted;
  } finally {
    options.signal.removeEventListener('abort', cancel);
    session.stop();
  }
}
