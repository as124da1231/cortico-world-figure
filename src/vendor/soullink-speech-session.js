// SoulLink Emotion SDK runtime-core, 02cd75ac0a085a87d84d1a885f1b33eca8742d53 (Apache-2.0). See NOTICE.

// ../_tmp/figure-soullink-runtime-02cd75a/createSoullinkSession.ts
import {
  getVADPreset,
  SoullinkRuntime
} from "../../workbench/pack/vendor/soullink/index.js";

// ../_tmp/figure-soullink-runtime-02cd75a/clocks.ts
function nowSeconds() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now() / 1e3;
  }
  return Date.now() / 1e3;
}
function createRafClock() {
  let handle = null;
  let running = false;
  let last = nowSeconds();
  const hasRaf = typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
  return {
    now: nowSeconds,
    start(cb) {
      if (running) return;
      running = true;
      last = nowSeconds();
      const loop = () => {
        if (!running) return;
        const now = nowSeconds();
        const dt = now - last;
        last = now;
        cb(now, dt);
        handle = hasRaf ? requestAnimationFrame(loop) : setTimeout(loop, 1e3 / 60);
      };
      handle = hasRaf ? requestAnimationFrame(loop) : setTimeout(loop, 1e3 / 60);
    },
    stop() {
      running = false;
      if (handle === null) return;
      if (hasRaf) cancelAnimationFrame(handle);
      else clearTimeout(handle);
      handle = null;
    }
  };
}

// ../_tmp/figure-soullink-runtime-02cd75a/createSoullinkSession.ts
var DEFAULT_REFLECTION_IDLE_DELAY_SECONDS = 5;
var DEFAULT_SPEAKING_MOTION_SCHEDULING = {
  mode: "fixed-parallel",
  fixedFrameCount: 4,
  frameIntervalSec: 1
};
function createSoullinkSession(options) {
  const persona = options.persona;
  const planner = options.textModel ?? options.planner;
  const motionPlanner = options.motionPlanner ?? (planner?.planSpeakingMotion ? { planSpeakingMotion: planner.planSpeakingMotion.bind(planner) } : void 0);
  const tts = options.voiceModel ?? options.tts;
  const classifier = options.classifier;
  const clock = options.clock ?? createRafClock();
  const audio = options.audio;
  const onSnapshot = options.onSnapshot;
  const reflectionIdleDelaySeconds = options.reflectionIdleDelaySeconds ?? DEFAULT_REFLECTION_IDLE_DELAY_SECONDS;
  const speakingMotionScheduling = resolveSpeakingMotionScheduling(options.speakingMotionScheduling);
  const runtime = new SoullinkRuntime({
    profile: options.profile,
    motionStyle: options.motionStyle,
    audioLevelAnalyzer: options.audioLevelAnalyzer
  });
  let profile = options.profile;
  let runtimeSnapshot = null;
  let planning = false;
  let apiError = null;
  let lastReply = "";
  let voiceStatus = "idle";
  let autoVoiceEnabled = true;
  let proactiveDraft = null;
  let conversation = [];
  let speakingMotionParameters = {};
  let started = false;
  let currentTime = clock.now?.() ?? 0;
  let reactionRequestId = 0;
  let pendingReflectionTopic = "";
  let idleReflectionStartedAt = null;
  let reflectionTriggeredForTurn = false;
  let reflectionRequestId = 0;
  let voiceRequestId = 0;
  let currentPlaybackSettle = null;
  let proactiveDraftRequestId = 0;
  let lastProactiveEventId = "";
  function now() {
    return clock.now?.() ?? currentTime;
  }
  function emit() {
    if (!onSnapshot) return;
    onSnapshot(getSnapshot());
  }
  function getSnapshot() {
    return {
      runtime: runtimeSnapshot,
      planning,
      apiError,
      lastReply,
      voiceStatus,
      autoVoiceEnabled,
      proactiveDraft,
      conversation
    };
  }
  function tick(tickNow, dt) {
    currentTime = tickNow;
    const delta = Math.min(0.05, dt || 1 / 60);
    const updated = runtime.update(tickNow, delta);
    if (triggerProactivePresetLoop(updated.proactive, tickNow)) {
      runtimeSnapshot = runtime.update(tickNow, 0);
      queueProactiveDraft(null);
    } else {
      runtimeSnapshot = updated;
      queueProactiveDraft(updated.proactive);
    }
    updateIdleReflectionTrigger(tickNow);
    emit();
  }
  function start() {
    if (started) return;
    started = true;
    runtimeSnapshot = runtime.getSnapshot();
    emit();
    clock.start(tick);
  }
  function stop() {
    reactionRequestId += 1;
    planning = false;
    if (started) {
      started = false;
      clock.stop();
    }
    stopVoice();
    if (voiceStatus === "loading" || voiceStatus === "playing") {
      voiceStatus = "idle";
    }
    emit();
  }
  async function sendMessage(message, sendOptions = {}) {
    if (!message.trim()) return null;
    const requestId = ++reactionRequestId;
    clearIdleReflectionTrigger();
    const currentVAD = runtimeSnapshot?.vad.current;
    const userTurn = { role: "user", content: message };
    stopVoice();
    if (voiceStatus === "loading" || voiceStatus === "playing") {
      voiceStatus = "idle";
    }
    conversation = [...conversation, userTurn];
    planning = true;
    apiError = null;
    emit();
    let immediateIntent = null;
    try {
      if (!classifier) throw new Error("no-classifier");
      const result = await classifier.classify(message);
      immediateIntent = result.intent;
      if (requestId !== reactionRequestId) return immediateIntent;
      runtime.triggerIntent(immediateIntent, now());
    } catch {
      if (requestId !== reactionRequestId) return immediateIntent;
      immediateIntent = runtime.sendMessage(message, now());
    }
    emit();
    const replyTask = runReactionReply(
      requestId,
      message,
      immediateIntent,
      currentVAD,
      [...conversation]
    ).finally(() => {
      if (requestId !== reactionRequestId) return;
      planning = false;
      emit();
    });
    if (sendOptions.awaitReply) {
      await replyTask;
    }
    return immediateIntent;
  }
  async function runReactionReply(requestId, message, immediateIntent, currentVAD, reactionConversation) {
    if (requestId !== reactionRequestId) return;
    if (!planner?.planReaction) {
      armIdleReflection(message);
      return;
    }
    try {
      const plan = await planner.planReaction({
        message,
        conversation: reactionConversation,
        characterName: persona.name,
        characterProfile: persona.profile,
        vad: currentVAD
      });
      if (requestId !== reactionRequestId) return;
      runtime.triggerPlan(plan, now());
      if (plan.replyDraft) {
        conversation = [...conversation, { role: "assistant", content: plan.replyDraft }];
        lastReply = plan.replyDraft;
        emit();
        await speak({
          text: plan.replyDraft,
          emotion: plan.intent.naturalEmotion ?? plan.intent.emotion,
          vad: plan.vadTarget ?? plan.intent.naturalVAD ?? currentVAD,
          intent: plan.intent,
          parameterPlan: plan.parameterPlan,
          planSpeakingMotion: true,
          userMessage: message
        });
      }
      if (requestId !== reactionRequestId) return;
      armIdleReflection(message);
    } catch (cause) {
      if (requestId !== reactionRequestId) return;
      apiError = `API fallback: ${describeError(cause)}`;
      const fallbackReply = createFallbackReply(immediateIntent?.emotion ?? "neutral");
      conversation = [...conversation, { role: "assistant", content: fallbackReply }];
      lastReply = fallbackReply;
      emit();
      armIdleReflection(message);
    }
  }
  function triggerIntent(intent, triggerOptions) {
    runtime.triggerIntent(intent, now(), triggerOptions);
  }
  function triggerProactivePresetLoop(event, atTime) {
    if (!event?.reason.startsWith("repeat_vad_preset:")) return false;
    runtime.triggerIntent(proactiveIntent(event.emotion, event.intensity, event.suggestedMessage), atTime, {
      provider: "local",
      replyDraft: ""
    });
    runtime.consumeProactive();
    proactiveDraft = null;
    lastProactiveEventId = "";
    return true;
  }
  async function planProactive(event) {
    if (!planner?.planProactive) {
      return {
        message: event.suggestedMessage,
        emotion: event.emotion,
        reason: event.reason,
        provider: "local"
      };
    }
    return planner.planProactive({
      characterName: persona.name,
      characterProfile: persona.profile,
      proactive: event,
      conversation,
      reflection: runtimeSnapshot?.reflection ?? null,
      vad: runtimeSnapshot?.vad.current
    });
  }
  async function acceptProactive() {
    const event = runtimeSnapshot?.proactive;
    if (!event) return;
    planning = true;
    apiError = null;
    emit();
    try {
      const plan = proactiveDraft?.eventId === event.id && proactiveDraft.status === "ready" ? draftToPlan(proactiveDraft) : await planProactive(event);
      const intent = proactiveIntent(plan.emotion, event.intensity, plan.message);
      runtime.triggerIntent(intent, now(), { provider: plan.provider, replyDraft: plan.message });
      runtime.consumeProactive();
      proactiveDraft = null;
      lastProactiveEventId = "";
      pushAssistantTurn(plan.message);
      void speak({
        text: plan.message,
        emotion: intent.naturalEmotion ?? intent.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current
      });
    } catch (cause) {
      apiError = `Proactive fallback: ${describeError(cause)}`;
      const message = event.suggestedMessage;
      runtime.triggerIntent(proactiveIntent(event.emotion, event.intensity, message), now(), {
        provider: "local",
        replyDraft: message
      });
      runtime.consumeProactive();
      proactiveDraft = null;
      lastProactiveEventId = "";
      pushAssistantTurn(message);
      void speak({
        text: message,
        emotion: event.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current
      });
    } finally {
      planning = false;
      emit();
    }
  }
  async function deliverProactive(event, deliverOptions = {}) {
    planning = true;
    apiError = null;
    emit();
    try {
      const plan = await planProactive(event);
      const rawMessage = plan.message || event.suggestedMessage;
      const message = deliverOptions.transformMessage ? deliverOptions.transformMessage(rawMessage) : rawMessage;
      const intent = proactiveIntent(
        plan.emotion || deliverOptions.fallbackEmotion || event.emotion,
        event.intensity,
        message
      );
      runtime.triggerIntent(intent, now(), { provider: plan.provider, replyDraft: message });
      pushAssistantTurn(message);
      void speak({
        text: message,
        emotion: intent.naturalEmotion ?? intent.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current,
        intent,
        planSpeakingMotion: true
      });
      return true;
    } catch (cause) {
      apiError = `${deliverOptions.errorLabel ?? "Proactive fallback"}: ${describeError(cause)}`;
      const message = event.suggestedMessage;
      const intent = proactiveIntent(deliverOptions.fallbackEmotion || event.emotion, event.intensity, message);
      runtime.triggerIntent(intent, now(), { provider: "local", replyDraft: message });
      pushAssistantTurn(message);
      void speak({
        text: message,
        emotion: intent.naturalEmotion ?? intent.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current,
        intent,
        planSpeakingMotion: true
      });
      return true;
    } finally {
      planning = false;
      emit();
    }
  }
  function queueProactiveDraft(event) {
    if (!event) {
      if (proactiveDraft) proactiveDraft = null;
      lastProactiveEventId = "";
      return;
    }
    if (event.id === lastProactiveEventId) return;
    lastProactiveEventId = event.id;
    const requestId = ++proactiveDraftRequestId;
    proactiveDraft = {
      eventId: event.id,
      status: "loading",
      message: "",
      emotion: event.emotion,
      reason: event.reason,
      provider: "local"
    };
    void planProactive(event).then((plan) => {
      if (requestId !== proactiveDraftRequestId || runtimeSnapshot?.proactive?.id !== event.id) return;
      proactiveDraft = {
        eventId: event.id,
        status: "ready",
        message: plan.message,
        emotion: plan.emotion,
        reason: plan.reason,
        provider: plan.provider
      };
      emit();
    }).catch((cause) => {
      if (requestId !== proactiveDraftRequestId || runtimeSnapshot?.proactive?.id !== event.id) return;
      proactiveDraft = {
        eventId: event.id,
        status: "error",
        message: softerProactiveFallback(event.emotion),
        emotion: event.emotion,
        reason: describeError(cause),
        provider: "local"
      };
      emit();
    });
  }
  function pushAssistantTurn(content) {
    conversation = [...conversation, { role: "assistant", content }];
    lastReply = content;
    emit();
  }
  async function requestReflection(topic) {
    if (!planner?.planReflection) return;
    const requestId = ++reflectionRequestId;
    if (pendingReflectionTopic) reflectionTriggeredForTurn = true;
    try {
      const plan = await planner.planReflection({
        conversation,
        vad: runtimeSnapshot?.vad.current,
        topic,
        characterName: persona.name,
        characterProfile: persona.profile
      });
      if (requestId !== reflectionRequestId) return;
      runtime.setReflection(
        {
          thought: plan.thought,
          reason: plan.reason,
          emotion: plan.emotion,
          vadTarget: plan.vadTarget
        },
        now()
      );
    } catch (cause) {
      if (requestId !== reflectionRequestId) return;
      apiError = `Reflection skipped: ${describeError(cause)}`;
      emit();
    }
  }
  function armIdleReflection(topic) {
    reflectionRequestId += 1;
    pendingReflectionTopic = topic;
    idleReflectionStartedAt = null;
    reflectionTriggeredForTurn = false;
  }
  function clearIdleReflectionTrigger() {
    reflectionRequestId += 1;
    pendingReflectionTopic = "";
    idleReflectionStartedAt = null;
    reflectionTriggeredForTurn = false;
  }
  function updateIdleReflectionTrigger(atTime) {
    if (!pendingReflectionTopic || reflectionTriggeredForTurn || !runtimeSnapshot) return;
    const dialogueSettled = runtimeSnapshot.state === "IDLE" && voiceStatus !== "loading" && voiceStatus !== "playing";
    if (!dialogueSettled) {
      idleReflectionStartedAt = null;
      return;
    }
    idleReflectionStartedAt ??= atTime;
    if (atTime - idleReflectionStartedAt < reflectionIdleDelaySeconds) return;
    reflectionTriggeredForTurn = true;
    void requestReflection(pendingReflectionTopic);
  }
  async function synthesizeLastReply() {
    await speak({
      text: lastReply,
      emotion: runtimeSnapshot?.vad.dominantEmotion ?? runtimeSnapshot?.emotionIntent?.emotion,
      vad: runtimeSnapshot?.vad.current,
      force: true
    });
  }
  function primeSpeakingEmotionState(request) {
    const snapshot = runtime.update(now(), 0);
    const requestedIntent = request.intent ?? createSpeakingIntent(request, snapshot);
    const requestedVAD = request.vad ?? requestedIntent?.naturalVAD;
    if (requestedIntent && !sameSpeakingIntent(snapshot.emotionIntent, requestedIntent)) {
      runtime.triggerIntent(requestedIntent, now(), {
        ...requestedVAD ? { vadTarget: requestedVAD } : {},
        provider: "vad-facs"
      });
    } else if (requestedVAD && !matchesVAD(snapshot.vad.target, requestedVAD)) {
      runtime.applyVADTarget(requestedVAD, 0.45);
    }
  }
  function createSpeakingIntent(request, snapshot) {
    const emotion = request.emotion?.trim();
    if (!emotion) return null;
    const variant = persona.variantByEmotion?.[emotion] ?? "neutral_ack";
    return {
      emotion,
      variant,
      naturalEmotion: emotion,
      naturalVAD: request.vad ?? getVADPreset(emotion, variant),
      intensity: clampNumber(snapshot.vad.intensity || 0.6, 0.35, 1),
      contextTags: ["speaking"],
      sourceMessage: request.text
    };
  }
  function buildSpeakingMotionInput(request, durationSec, mode) {
    const snapshot = runtime.getSnapshot();
    return {
      speechText: request.text,
      durationSec,
      mode,
      ...mode === "fixed-parallel" ? { frameCount: speakingMotionScheduling.fixedFrameCount } : {},
      frameIntervalSec: speakingMotionScheduling.frameIntervalSec,
      availableParameters: buildSpeakingMotionParameters(speakingMotionParameters, profile),
      intent: request.intent ?? snapshot.emotionIntent ?? void 0,
      vad: request.vad ?? snapshot.vad.current,
      expression: snapshot.runtimeExpression ? {
        emotion: snapshot.runtimeExpression.emotion,
        variant: snapshot.runtimeExpression.variant,
        intensity: snapshot.runtimeExpression.intensity,
        peakFACS: snapshot.runtimeExpression.peakFACS
      } : null,
      characterName: persona.name,
      characterProfile: persona.profile,
      userMessage: request.userMessage
    };
  }
  async function requestSpeakingMotion(input, requestId) {
    try {
      return await motionPlanner.planSpeakingMotion(input);
    } catch (cause) {
      const fallbackReason = describeError(cause);
      if (requestId === voiceRequestId && voiceStatus === "loading") {
        apiError = `Speaking motion skipped: ${fallbackReason}`;
        emit();
      }
      return { parameterPlan: [], provider: "vad-facs", fallbackReason };
    }
  }
  async function speak(request) {
    if (!request.text.trim()) return;
    if (!request.force && !autoVoiceEnabled) return;
    if (!tts || !audio) return;
    stopVoice();
    const requestId = ++voiceRequestId;
    let settlePlayback = () => {
    };
    const playbackFinished = new Promise((resolve) => {
      settlePlayback = resolve;
    });
    const finished = () => {
      if (currentPlaybackSettle === settlePlayback) currentPlaybackSettle = null;
      settlePlayback();
    };
    currentPlaybackSettle = settlePlayback;
    primeSpeakingEmotionState(request);
    const waitingMotionSeed = createVoiceWaitingMotionSeed(request.text, request.emotion, requestId, now());
    const waitingMotionContext = {
      emotion: request.emotion ?? request.intent?.naturalEmotion ?? request.intent?.emotion ?? runtimeSnapshot?.vad.dominantEmotion ?? runtimeSnapshot?.emotionIntent?.emotion,
      intensity: request.intent?.intensity ?? runtimeSnapshot?.vad.intensity,
      vad: request.vad ?? request.intent?.naturalVAD ?? runtimeSnapshot?.vad.current
    };
    runtime.startVoiceWaitingMotion(now(), waitingMotionSeed, waitingMotionContext);
    runtimeSnapshot = runtime.update(now(), 0);
    voiceStatus = "loading";
    emit();
    try {
      const ttsTask = tts.synthesize(request.text, {
        emotion: request.emotion,
        vad: request.vad,
        intent: request.intent
      });
      const shouldPlanSpeakingMotion = Boolean(request.planSpeakingMotion && motionPlanner?.planSpeakingMotion);
      const parallelMotionTask = shouldPlanSpeakingMotion && speakingMotionScheduling.mode === "fixed-parallel" ? requestSpeakingMotion(
        buildSpeakingMotionInput(
          request,
          speakingMotionScheduling.fixedFrameCount * speakingMotionScheduling.frameIntervalSec,
          "fixed-parallel"
        ),
        requestId
      ) : null;
      const [result, parallelMotion] = parallelMotionTask ? await Promise.all([ttsTask, parallelMotionTask]) : [await ttsTask, null];
      if (requestId !== voiceRequestId) return finished();
      const durationSec = result.durationSec ?? estimateSpeechDurationFromText(request.text);
      const motion = parallelMotion ?? (shouldPlanSpeakingMotion ? await requestSpeakingMotion(buildSpeakingMotionInput(request, durationSec, "duration"), requestId) : null);
      const pendingSpeechMotion = motion?.provider !== "vad-facs" && motion?.parameterPlan?.length ? motion.parameterPlan : request.parameterPlan?.length ? request.parameterPlan : void 0;
      if (requestId !== voiceRequestId) return finished();
      voiceStatus = "playing";
      emit();
      const playback = await audio.play({ url: result.url, bytes: result.bytes });
      if (requestId !== voiceRequestId) return finished();
      const playbackStart = now();
      runtime.startSpeechMotion(pendingSpeechMotion, playbackStart, durationSec);
      runtime.setVoicePlaybackActive(true);
      void Promise.resolve(playback.finished).then(() => {
        if (requestId === voiceRequestId) {
          voiceStatus = "idle";
          runtime.setVoicePlaybackActive(false);
          runtime.clearVoiceWaitingMotion();
          runtime.clearSpeechMotion();
          emit();
        }
        finished();
      });
      await playbackFinished;
    } catch (cause) {
      if (requestId !== voiceRequestId) return finished();
      apiError = `Voice failed: ${describeError(cause)}`;
      runtime.setVoicePlaybackActive(false);
      runtime.clearVoiceWaitingMotion();
      runtime.clearSpeechMotion();
      voiceStatus = "error";
      emit();
      finished();
    }
  }
  function stopVoice() {
    voiceRequestId += 1;
    runtime.setVoicePlaybackActive(false);
    runtime.clearVoiceWaitingMotion();
    audio?.stop();
    runtime.clearSpeechMotion();
    if (currentPlaybackSettle) {
      const settle = currentPlaybackSettle;
      currentPlaybackSettle = null;
      settle();
    }
  }
  function setAutoVoiceEnabled(enabled) {
    autoVoiceEnabled = enabled;
    if (!enabled) {
      stopVoice();
      if (voiceStatus === "loading" || voiceStatus === "playing") {
        voiceStatus = "idle";
      }
    }
    emit();
  }
  function reset() {
    reactionRequestId += 1;
    planning = false;
    runtime.reset(now());
    lastReply = "";
    conversation = [];
    apiError = null;
    clearIdleReflectionTrigger();
    proactiveDraft = null;
    lastProactiveEventId = "";
    stopVoice();
    voiceStatus = "idle";
    runtimeSnapshot = runtime.getSnapshot();
    emit();
  }
  function setProfile(nextProfile) {
    const modelChanged = nextProfile.modelPath !== profile.modelPath || nextProfile.modelId !== profile.modelId;
    profile = nextProfile;
    if (modelChanged) speakingMotionParameters = {};
    runtime.setProfile(nextProfile);
    runtime.setPrivateVADParameters(speakingMotionParameters);
    runtimeSnapshot = runtime.getSnapshot();
    emit();
  }
  function setSpeakingMotionParameters(parameters) {
    speakingMotionParameters = parameters;
    runtime.setPrivateVADParameters(parameters);
  }
  function proactiveIntent(emotion, intensity, sourceMessage) {
    const variant = persona.variantByEmotion?.[emotion] ?? "neutral_ack";
    return {
      emotion,
      variant,
      naturalEmotion: emotion,
      naturalVAD: getVADPreset(emotion, variant),
      intensity: Math.max(0.62, Math.min(0.86, intensity || 0.68)),
      contextTags: ["proactive_idle"],
      sourceMessage
    };
  }
  function createFallbackReply(emotion) {
    return persona.fallbacks?.[emotion] ?? persona.fallbacks?.neutral ?? "嗯，我在。";
  }
  function softerProactiveFallback(emotion) {
    return persona.proactiveFallbacks?.[emotion] ?? persona.proactiveFallbacks?.neutral ?? "我刚刚有点走神想到你了，就轻轻冒个头。";
  }
  return {
    start,
    stop,
    sendMessage,
    triggerIntent,
    acceptProactive,
    deliverProactive,
    planProactive,
    pushAssistantTurn,
    requestReflection,
    synthesizeLastReply,
    speak,
    stopVoice,
    reset,
    setProfile,
    getSnapshot,
    getRuntimeSnapshot: () => runtimeSnapshot,
    getRuntime: () => runtime,
    getProfile: () => profile,
    setSpeakingMotionParameters,
    setAutoVoiceEnabled,
    setIdleEnabled: (enabled) => runtime.setIdleEnabled(enabled),
    setLipSyncEnabled: (enabled) => runtime.setLipSyncEnabled(enabled),
    setManualFACS: (facs) => runtime.setManualFACS(facs),
    setManualActionUnits: (actionUnits) => runtime.setManualActionUnits(actionUnits),
    setManualParameters: (parameters) => runtime.setCustomChannels(parameters),
    setParameterGain: (gain) => runtime.setParameterGain(gain),
    setBodyMotionGain: (gain) => runtime.setBodyMotionGain(gain),
    setVADDecayRate: (rate) => runtime.setVADDecayRate(rate),
    setProactiveRepeatEnabled: (enabled) => runtime.setProactiveRepeatEnabled(enabled)
  };
}
function describeError(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
function draftToPlan(draft) {
  return {
    message: draft.message,
    emotion: draft.emotion,
    reason: draft.reason,
    provider: draft.provider === "openai-compatible" ? "openai-compatible" : "fallback"
  };
}
function estimateSpeechDurationFromText(text) {
  const visibleLength = text.replace(/\s+/gu, "").length;
  return Math.max(0.8, Math.min(30, visibleLength * 0.16));
}
function resolveSpeakingMotionScheduling(config) {
  const requestedFrameCount = Number.isFinite(config?.fixedFrameCount) ? config.fixedFrameCount : DEFAULT_SPEAKING_MOTION_SCHEDULING.fixedFrameCount;
  const requestedFrameInterval = Number.isFinite(config?.frameIntervalSec) ? config.frameIntervalSec : DEFAULT_SPEAKING_MOTION_SCHEDULING.frameIntervalSec;
  return {
    mode: config?.mode === "duration" ? "duration" : DEFAULT_SPEAKING_MOTION_SCHEDULING.mode,
    fixedFrameCount: clampNumber(Math.round(requestedFrameCount), 1, 120),
    frameIntervalSec: clampNumber(requestedFrameInterval, 0.1, 30)
  };
}
function sameSpeakingIntent(current, requested) {
  if (!current) return false;
  return current.emotion === requested.emotion && (current.variant ?? "") === (requested.variant ?? "") && Math.abs(current.intensity - requested.intensity) <= 0.08;
}
function matchesVAD(current, requested) {
  const axes = ["valence", "arousal", "dominance"];
  return axes.every((axis) => requested[axis] === void 0 || Math.abs(current[axis] - requested[axis]) <= 0.04);
}
function createVoiceWaitingMotionSeed(text, emotion, requestId, timeSeconds) {
  let hash = 2166136261;
  const input = `${text}|${emotion ?? ""}|${requestId}|${Math.round(timeSeconds * 1e3)}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
function buildSpeakingMotionParameters(cdiParameters, modelProfile) {
  if (Object.keys(cdiParameters).length > 0) return cdiParameters;
  return buildProfileMotionParameters(modelProfile);
}
function buildProfileMotionParameters(modelProfile) {
  if (!modelProfile) return {};
  const result = {};
  const add = (id, min, max) => {
    if (!id) return;
    const fallback = defaultParameterInfo(id, modelProfile.neutralParams?.[id]);
    const nextMin = Number.isFinite(min) ? min : fallback.min;
    const nextMax = Number.isFinite(max) ? max : fallback.max;
    const normalizedMin = Math.min(nextMin, nextMax);
    const normalizedMax = Math.max(nextMin, nextMax);
    const defaultValue = clampNumber(modelProfile.neutralParams?.[id] ?? fallback.default, normalizedMin, normalizedMax);
    const existing = result[id];
    result[id] = existing ? {
      name: id,
      min: Math.min(existing.min, normalizedMin),
      max: Math.max(existing.max, normalizedMax),
      default: defaultValue
    } : {
      name: id,
      min: normalizedMin,
      max: normalizedMax,
      default: defaultValue
    };
  };
  for (const rule of Object.values(modelProfile.parameterMap)) {
    if (!rule) continue;
    const targets = rule.targets?.length ? rule.targets : rule.target ? [rule.target] : [];
    for (const target of targets) add(target, rule.min, rule.max);
  }
  for (const id of Object.keys(modelProfile.neutralParams ?? {})) {
    add(id);
  }
  return result;
}
function defaultParameterInfo(id, defaultValue = 0) {
  const normalized = id.replace(/\s+/gu, "").replace(/[＿_\-　]/gu, "").toLowerCase();
  if (normalized.includes("angle")) return { min: -30, max: 30, default: 0 };
  if (normalized.includes("eyeball") || normalized.includes("mouthform") || normalized.includes("brow")) {
    return { min: -1, max: 1, default: 0 };
  }
  if (normalized.includes("eyeopen")) return { min: 0, max: 1, default: 1 };
  return { min: 0, max: 1, default: defaultValue };
}
function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
export {
  createSoullinkSession
};
