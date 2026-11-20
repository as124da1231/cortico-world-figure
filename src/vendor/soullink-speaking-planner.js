/* SoulLink Emotion SDK 02cd75ac0a085a87d84d1a885f1b33eca8742d53, Apache-2.0. See workbench/pack/vendor/soullink/LICENSE. */

// ../_tmp/figure-soullink-planner-3ac61f2b03ee4d8186d7eea7f3295fe7/SoullinkSpeakingMotionPlanner.ts
import {
  clamp
} from "../../workbench/pack/vendor/soullink/index.js";

// ../_tmp/figure-soullink-planner-3ac61f2b03ee4d8186d7eea7f3295fe7/OpenAICompatibleClient.ts
var OpenAIClientNotConfiguredError = class extends Error {
  constructor() {
    super("OpenAI-compatible client is not configured. Pass an apiKey or an injected client.");
    this.name = "OpenAIClientNotConfiguredError";
  }
};
var OpenAICompatibleClient = class {
  apiKey;
  baseURL;
  model;
  organization;
  project;
  timeoutMs;
  fetchImpl;
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.baseURL = this.normalizeBaseURL(options.baseURL ?? "https://api.openai.com/v1");
    this.model = options.model ?? "gpt-4.1-mini";
    this.organization = options.organization;
    this.project = options.project;
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.fetchImpl = options.fetch;
  }
  get configured() {
    return Boolean(this.apiKey);
  }
  isConfigured(options = {}) {
    return Boolean(options.apiKey ?? this.apiKey);
  }
  get config() {
    return {
      configured: this.configured,
      baseURL: this.baseURL,
      model: this.model,
      timeoutMs: this.timeoutMs
    };
  }
  async createChatCompletion(request, options = {}) {
    const apiKey = options.apiKey ?? this.apiKey;
    const baseURL = this.normalizeBaseURL(options.baseURL ?? this.baseURL);
    const model = options.model ?? request.model ?? this.model;
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? this.timeoutMs);
    const fetchImpl = options.fetch ?? this.fetchImpl ?? globalThis.fetch;
    if (!apiKey) {
      throw new OpenAIClientNotConfiguredError();
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("No fetch implementation is available. Pass OpenAIClientOptions.fetch.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders({
          apiKey,
          organization: options.organization ?? this.organization,
          project: options.project ?? this.project
        }),
        body: JSON.stringify({
          ...request,
          model,
          stream: false
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI-compatible request failed with ${response.status}: ${body}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
  getHeaders(options) {
    const headers = {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    };
    if (options.organization) headers["OpenAI-Organization"] = options.organization;
    if (options.project) headers["OpenAI-Project"] = options.project;
    return headers;
  }
  normalizeBaseURL(baseURL) {
    return baseURL.replace(/\/+$/u, "");
  }
};
function isOpenAICompatibleClientLike(value) {
  if (!value || typeof value !== "object") return false;
  const client = value;
  return typeof client.isConfigured === "function" && typeof client.createChatCompletion === "function";
}
function normalizeTimeout(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 3e4;
}

// ../_tmp/figure-soullink-planner-3ac61f2b03ee4d8186d7eea7f3295fe7/SoullinkSpeakingMotionPlanner.ts
var defaultSpeakingMotionGenerationConfig = Object.freeze({
  mode: "fixed",
  fixedFrameCount: 4,
  frameIntervalSec: 1,
  minFrameCount: 1,
  maxFrameCount: 60,
  twoStage: true,
  temperature: 0.22,
  jointMotionBoost: 1.35,
  eyeOpenBinary: true,
  minVisibleRatio: 0.08,
  maxPromptParameters: 96
});
function resolveSpeakingMotionGenerationConfig(config = {}) {
  const minFrameCount = integer(config.minFrameCount, 1, 600, 1);
  const maxFrameCount = integer(config.maxFrameCount, minFrameCount, 600, 60);
  return {
    mode: config.mode === "duration" ? "duration" : "fixed",
    fixedFrameCount: integer(config.fixedFrameCount, minFrameCount, maxFrameCount, 4),
    frameIntervalSec: number(config.frameIntervalSec, 0.1, 30, 1),
    minFrameCount,
    maxFrameCount,
    twoStage: config.twoStage ?? true,
    temperature: number(config.temperature, 0, 2, 0.22),
    jointMotionBoost: number(config.jointMotionBoost, 0.25, 4, 1.35),
    eyeOpenBinary: config.eyeOpenBinary ?? true,
    minVisibleRatio: number(config.minVisibleRatio, 0, 0.5, 0.08),
    maxPromptParameters: integer(config.maxPromptParameters, 8, 256, 96)
  };
}
function resolveSpeakingMotionFrameCount(request, config) {
  if (positive(request.frameCount)) {
    return clampInteger(request.frameCount, config.minFrameCount, config.maxFrameCount);
  }
  if (config.mode === "fixed") {
    return clampInteger(config.fixedFrameCount, config.minFrameCount, config.maxFrameCount);
  }
  if (!positive(request.durationSec)) return 0;
  return clampInteger(
    Math.ceil(request.durationSec / config.frameIntervalSec),
    config.minFrameCount,
    config.maxFrameCount
  );
}
var SoullinkSpeakingMotionPlanner = class _SoullinkSpeakingMotionPlanner {
  client;
  openAIOptions;
  generation;
  constructor(clientOrOptions = {}, generationConfig = {}) {
    this.client = isOpenAICompatibleClientLike(clientOrOptions) ? clientOrOptions : new OpenAICompatibleClient(clientOrOptions);
    this.openAIOptions = isOpenAICompatibleClientLike(clientOrOptions) ? {} : { ...clientOrOptions };
    this.generation = resolveSpeakingMotionGenerationConfig(generationConfig);
  }
  static create(options = {}) {
    return new _SoullinkSpeakingMotionPlanner(
      options.client ?? options.openAI ?? {},
      options.generation
    );
  }
  get config() {
    return { openAI: this.client.config, generation: { ...this.generation } };
  }
  async plan(request) {
    const startedAt = Date.now();
    const generation = resolveSpeakingMotionGenerationConfig({
      ...this.generation,
      mode: request.mode ?? this.generation.mode,
      frameIntervalSec: request.frameIntervalSec ?? this.generation.frameIntervalSec
    });
    const frameCount = resolveSpeakingMotionFrameCount(request, generation);
    const available = sanitizeAvailableParameters(request.availableParameters);
    const speech = analyzeSpeech(request.speechText, request.userMessage);
    const openAI = {
      ...this.openAIOptions,
      ...request.openAI,
      ...request.model ? { model: request.model } : {}
    };
    const debug = (detail) => ({
      model: request.model ?? openAI.model ?? this.client.config.model,
      baseURL: openAI.baseURL ?? this.client.config.baseURL,
      generationMode: generation.mode,
      requestedFrameCount: frameCount,
      availableParameterCount: Object.keys(available).length,
      finalFrameCount: 0,
      frameIntervalSec: generation.frameIntervalSec,
      frameDurationMs: generation.frameIntervalSec * 1e3,
      speechTextForMotion: speech.speechTextForMotion,
      explicitMotionDirectives: speech.explicitMotionDirectives,
      jointMotionBoost: generation.jointMotionBoost,
      eyeOpenBinary: generation.eyeOpenBinary,
      minVisibleRatio: generation.minVisibleRatio,
      elapsedMs: Date.now() - startedAt,
      ...detail
    });
    const vadFacs = (code, reason, detail = {}) => ({
      parameterPlan: [],
      provider: "vad-facs",
      motionPlan: detail.motionPlan,
      rawMessage: detail.rawMessage,
      rawMotionPlanMessage: detail.rawMotionPlanMessage,
      debug: debug({
        actionProvider: detail.actionProvider,
        actionFrameCount: detail.actionFrameCount,
        rawFrameCount: detail.rawFrameCount,
        usableRawFrameCount: detail.usableRawFrameCount,
        responseFormat: detail.responseFormat,
        fallbackCode: code,
        fallbackReason: reason
      })
    });
    if (generation.mode === "duration" && frameCount === 0) {
      return vadFacs("invalid_duration", "duration mode requires a positive durationSec");
    }
    if (Object.keys(available).length === 0) {
      return vadFacs("no_available_parameters", "No usable Live2D parameters were provided");
    }
    if (!this.client.isConfigured(openAI)) {
      return vadFacs("not_configured", "OpenAI-compatible client is not configured");
    }
    const actions = await this.planActions(request, available, frameCount, generation, openAI, speech);
    if (generation.twoStage && actions.provider !== "openai-compatible") {
      return vadFacs("action_planning_failed", errorText(actions.error, "Semantic action planning failed"), {
        rawMotionPlanMessage: actions.rawMessage,
        actionProvider: actions.provider,
        actionFrameCount: actions.frames.length
      });
    }
    let lastError;
    let rawMessage;
    let rawFrameCount = 0;
    let usableFrameCount = 0;
    let formatName;
    for (const format of formats(speakingMotionResponseFormat)) {
      formatName = responseFormatName(format);
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? openAI.model,
          messages: buildParameterMessages(
            request,
            available,
            frameCount,
            generation.frameIntervalSec,
            actions.frames,
            speech,
            generation.maxPromptParameters
          ),
          temperature: request.temperature ?? generation.temperature,
          max_tokens: Math.max(1800, frameCount * 260),
          ...format ? { response_format: format } : {}
        }, openAI);
        rawMessage = completion.choices[0]?.message;
        const raw = parseJSON(rawMessage?.content ?? "");
        const rawPlan = raw.parameterPlan ?? raw.parameter_plan ?? raw.frames;
        rawFrameCount = Array.isArray(rawPlan) ? rawPlan.length : 0;
        const parameterPlan = sanitizeParameterPlan(
          rawPlan,
          available,
          frameCount,
          generation.frameIntervalSec,
          generation
        );
        usableFrameCount = parameterPlan.length;
        if (parameterPlan.length !== frameCount) {
          lastError = new Error(
            "LLM returned " + parameterPlan.length + "/" + frameCount + " usable parameter frames"
          );
          continue;
        }
        return {
          parameterPlan,
          provider: "openai-compatible",
          motionPlan: actions.frames.length ? actions.frames : void 0,
          rawMessage,
          rawMotionPlanMessage: actions.rawMessage,
          debug: debug({
            actionProvider: actions.provider,
            actionFrameCount: actions.frames.length,
            rawFrameCount,
            usableRawFrameCount: usableFrameCount,
            finalFrameCount: parameterPlan.length,
            responseFormat: formatName
          })
        };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) break;
      }
    }
    return vadFacs("parameter_planning_failed", errorText(lastError, "Parameter planning failed"), {
      motionPlan: actions.frames,
      rawMessage,
      rawMotionPlanMessage: actions.rawMessage,
      actionProvider: actions.provider,
      actionFrameCount: actions.frames.length,
      rawFrameCount,
      usableRawFrameCount: usableFrameCount,
      responseFormat: formatName
    });
  }
  async planActions(request, available, frameCount, generation, openAI, speech) {
    if (!generation.twoStage) return { frames: [], provider: "disabled" };
    let lastError;
    let rawMessage;
    for (const format of formats(speakingMotionActionResponseFormat)) {
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? openAI.model,
          messages: buildActionMessages(
            request,
            available,
            frameCount,
            generation.frameIntervalSec,
            speech,
            generation.maxPromptParameters
          ),
          temperature: Math.max(request.temperature ?? generation.temperature, 0.32),
          max_tokens: Math.max(900, frameCount * 150),
          ...format ? { response_format: format } : {}
        }, openAI);
        rawMessage = completion.choices[0]?.message;
        const raw = parseJSON(rawMessage?.content ?? "");
        const frames = sanitizeActionPlan(raw.motionPlan ?? raw.motion_plan ?? raw.frames, frameCount);
        if (frames.length !== frameCount) {
          lastError = new Error(
            "LLM returned " + frames.length + "/" + frameCount + " semantic action frames"
          );
          continue;
        }
        return { frames, provider: "openai-compatible", rawMessage };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) break;
      }
    }
    return { frames: [], provider: "vad-facs", rawMessage, error: lastError };
  }
};
function createSoullinkSpeakingMotionPlanner(options = {}) {
  return SoullinkSpeakingMotionPlanner.create(options);
}
function isMouthOrJawOpenParameter(id, info) {
  const identifier = normalize(id + " " + (info?.name ?? ""));
  if (has(identifier, [
    "mouthform",
    "mouthshape",
    "lipform",
    "lipshape",
    "lippucker",
    "smile",
    "lipcorner",
    "lippressor",
    "liptightener",
    "lipstretcher",
    "phoneme",
    "vowel",
    "\u5634\u578B",
    "\u53E3\u578B",
    "\u5507\u5F62",
    "\u5FAE\u7B11",
    "\u561F\u5634"
  ])) return false;
  const text2 = identifier;
  return [
    "mouthopen",
    "openmouth",
    "jawopen",
    "openjaw",
    "jawdrop",
    "parammouthopeny",
    "\u5634\u5DF4\u5F00\u5408",
    "\u5634\u5DF4\u5F20\u5408",
    "\u53E3\u90E8\u5F00\u5408",
    "\u53E3\u90E8\u5F20\u5408",
    "\u4E0B\u989A\u5F00\u5408",
    "\u4E0B\u5DF4\u5F00\u5408",
    "\u5F20\u5634",
    "\u5634\u5F20\u5F00",
    "\u5F20\u53E3"
  ].some((hint) => text2.includes(normalize(hint)));
}
function sanitizeSpeakingMotionParameters(value, available, config = {}) {
  if (!value || typeof value !== "object") return {};
  const resolved = resolveSpeakingMotionGenerationConfig(config);
  const result = {};
  for (const [id, raw] of Object.entries(value)) {
    const info = available[id];
    if (!info || isMouthOrJawOpenParameter(id, info)) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    result[id] = tune(id, raw, info, resolved);
  }
  return result;
}
function sanitizeAvailableParameters(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const [id, raw] of Object.entries(value)) {
    const record = raw && typeof raw === "object" ? raw : {};
    const defaults = defaultRange(id);
    const a = finite(record.min, defaults.min);
    const b = finite(record.max, defaults.max);
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    const info = {
      name: typeof record.name === "string" ? record.name : id,
      groupId: typeof record.groupId === "string" ? record.groupId : void 0,
      groupName: typeof record.groupName === "string" ? record.groupName : void 0,
      min,
      max,
      default: clamp(finite(record.default, defaults.default), min, max)
    };
    if (!isMouthOrJawOpenParameter(id, info)) result[id] = info;
  }
  return result;
}
function sanitizeParameterPlan(value, available, frameCount, interval, generation) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, frameCount).map((item, index) => {
    const record = item && typeof item === "object" ? item : {};
    return {
      time: index * interval,
      duration: interval,
      label: text(record.label ?? record.expression, "speaking-parameter-frame"),
      parameters: sanitizeSpeakingMotionParameters(record.parameters, available, generation)
    };
  }).filter((beat) => Object.keys(beat.parameters).length > 0);
}
function sanitizeActionPlan(value, frameCount) {
  if (!Array.isArray(value)) return [];
  const frames = /* @__PURE__ */ new Map();
  value.slice(0, frameCount).forEach((item, index) => {
    const record = item && typeof item === "object" ? item : {};
    const frameIndex = clampInteger(finite(record.frameIndex ?? record.frame_index, index), 0, frameCount - 1);
    const action = text(record.action ?? record.label ?? record.expression, "");
    if (!action) return;
    frames.set(frameIndex, {
      frameIndex,
      action: action.slice(0, 120),
      emphasis: typeof record.emphasis === "string" ? record.emphasis.slice(0, 120) : void 0
    });
  });
  return Array.from({ length: frameCount }, (_, index) => frames.get(index)).filter((frame) => Boolean(frame));
}
function buildParameterMessages(request, available, frameCount, interval, motionPlan, speech, maxParameters) {
  const descriptions = selectParameters(available, maxParameters).map(([id, info]) => "- " + id + ": " + label(id, info) + ", category=" + group(id, info) + ", range[" + info.min + ", " + info.max + "], default=" + info.default).join("\n");
  return [
    {
      role: "system",
      content: [
        "\u4F60\u662F Live2D \u8FDE\u7EED\u52A8\u4F5C\u63A7\u5236\u5668\u3002\u628A\u8BED\u4E49\u52A8\u4F5C\u811A\u672C\u7FFB\u8BD1\u6210\u53EF\u6267\u884C\u7684\u6A21\u578B\u53C2\u6570\u5173\u952E\u5E27\u3002",
        "\u4E3B\u8868\u60C5\u7531 VAD/FACS \u8D1F\u8D23\uFF1B\u8FD9\u91CC\u53EA\u8865\u5145\u5934\u90E8\u3001\u8EAB\u4F53\u3001\u89C6\u7EBF\u548C\u81EA\u7136\u7684\u9762\u90E8\u6216\u6A21\u578B\u7EC6\u8282\u3002",
        "\u53EA\u80FD\u4F7F\u7528\u4EE5\u4E0B\u6A21\u578B\u771F\u5B9E\u53C2\u6570 ID\uFF1A",
        descriptions,
        "\u8FD4\u56DE JSON\uFF0C\u6839\u5B57\u6BB5\u4E3A parameterPlan\uFF0C\u6BCF\u5E27\u5305\u542B time\u3001duration\u3001label\u3001parameters\u3002",
        "\u5FC5\u987B\u4E25\u683C\u8F93\u51FA " + frameCount + " \u5E27\uFF0C\u6570\u7EC4\u987A\u5E8F\u5BF9\u5E94 motionPlan\uFF0C\u5E27\u95F4\u9694\u548C duration \u5747\u4E3A " + interval + " \u79D2\u3002",
        "\u53C2\u6570\u503C\u662F\u7EDD\u5BF9\u76EE\u6807\u503C\u5E76\u4E14\u5FC5\u987B\u4F4D\u4E8E\u771F\u5B9E range \u5185\u3002\u6BCF\u5E27\u4E0D\u5F97\u4E3A\u7A7A\uFF0C\u52A8\u4F5C\u4E4B\u95F4\u8981\u8FDE\u8D2F\u3002",
        "\u7981\u6B62\u8F93\u51FA mouth-open \u6216 jaw-open \u7C7B\u5634\u90E8\u5F00\u5408\u53C2\u6570\uFF0C\u56E0\u4E3A LipSync \u72EC\u5360\u5F00\u5408\u3002",
        "MouthForm\u3001smile\u3001pucker\u3001lip shape\u3001\u5634\u578B\u7B49\u975E\u5F00\u5408\u53C2\u6570\u5141\u8BB8\u4F7F\u7528\uFF0C\u7EDD\u5BF9\u4E0D\u80FD\u4E00\u5E76\u6392\u9664\u3002",
        "\u7528\u6237\u6216\u53F0\u8BCD\u4E2D\u7684\u7728\u773C\u3001\u8F6C\u5934\u3001\u6325\u624B\u7B49\u663E\u5F0F\u52A8\u4F5C\u6307\u4EE4\u4F18\u5148\u7EA7\u6700\u9AD8\u3002",
        "\u53EA\u8FD4\u56DE JSON\uFF0C\u4E0D\u8981 markdown \u6216\u89E3\u91CA\u3002"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        characterName: request.characterName,
        characterProfile: request.characterProfile,
        speechText: speech.speechTextForMotion,
        userMessage: request.userMessage ?? null,
        explicitMotionDirectives: speech.explicitMotionDirectives,
        durationSec: request.durationSec ?? null,
        intent: request.intent ?? null,
        vad: request.vad ?? null,
        expression: request.expression ?? null,
        frameCount,
        frameIntervalSec: interval,
        motionPlan
      })
    }
  ];
}
function buildActionMessages(request, available, frameCount, interval, speech, maxParameters) {
  const capabilities = capabilitySummary(selectParameters(available, maxParameters));
  return [
    {
      role: "system",
      content: [
        "\u4F60\u662F Live2D \u8BED\u4E49\u52A8\u4F5C\u89C4\u5212\u5668\u3002\u5148\u89C4\u5212\u8FDE\u7EED\u52A8\u4F5C\uFF0C\u4E0B\u4E00\u9636\u6BB5\u4F1A\u7FFB\u8BD1\u4E3A\u771F\u5B9E\u6A21\u578B\u53C2\u6570\u3002",
        "\u5F53\u524D\u6A21\u578B\u80FD\u529B\u6765\u81EA\u53C2\u6570\u4E0E CDI3 \u5143\u6570\u636E\uFF1A",
        capabilities,
        "\u8FD4\u56DE JSON\uFF0C\u6839\u5B57\u6BB5\u4E3A motionPlan\uFF0C\u6BCF\u5E27\u5305\u542B frameIndex\u3001action\u3001emphasis\u3002",
        "\u4E25\u683C\u8F93\u51FA " + frameCount + " \u5E27\uFF0CframeIndex \u4ECE 0 \u8FDE\u7EED\u9012\u589E\uFF0C\u6BCF\u5E27\u8DE8\u5EA6 " + interval + " \u79D2\u3002",
        "\u6BCF\u4E2A\u52A8\u4F5C\u5E94\u5177\u4F53\u3001\u53EF\u6267\u884C\u3001\u524D\u540E\u8FDE\u8D2F\uFF0C\u5E76\u7EC4\u5408\u5934\u8EAB\u3001\u89C6\u7EBF\u3001\u7709\u773C\u3001\u5634\u578B\u6216\u6A21\u578B\u79C1\u6709\u80FD\u529B\u3002",
        "explicitMotionDirectives \u4F18\u5148\u7EA7\u6700\u9AD8\uFF0C\u5FC5\u987B\u5728\u524D\u9762\u7684\u5E27\u4E2D\u51C6\u786E\u6267\u884C\u3002",
        "\u53EA\u8FD4\u56DE JSON\uFF0C\u4E0D\u8981 markdown \u6216\u89E3\u91CA\u3002"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        characterName: request.characterName,
        characterProfile: request.characterProfile,
        speechText: speech.speechTextForMotion,
        userMessage: request.userMessage ?? null,
        explicitMotionDirectives: speech.explicitMotionDirectives,
        durationSec: request.durationSec ?? null,
        intent: request.intent ?? null,
        vad: request.vad ?? null,
        expression: request.expression ?? null,
        frameCount,
        frameIntervalSec: interval
      })
    }
  ];
}
function analyzeSpeech(speechText, userMessage) {
  const originalSpeechText = speechText ?? "";
  const directives = [];
  if (looksLikeDirective(userMessage ?? "")) addUnique(directives, (userMessage ?? "").trim().slice(0, 120));
  const speechTextForMotion = originalSpeechText.replace(
    /[（(【\[]([^（）()\[\]【】]{1,120})[）)】\]]/gu,
    (match, content) => {
      if (!looksLikeDirective(content)) return match;
      addUnique(directives, content.trim());
      return "";
    }
  ).replace(/\s{2,}/gu, " ").trim();
  return {
    originalSpeechText,
    speechTextForMotion: speechTextForMotion || originalSpeechText,
    explicitMotionDirectives: directives.slice(0, 6)
  };
}
function looksLikeDirective(value) {
  const normalized = normalize(value);
  return [
    "wink",
    "\u7728\u773C",
    "\u95ED\u773C",
    "\u7741\u773C",
    "\u8F6C\u5934",
    "\u6B6A\u5934",
    "\u70B9\u5934",
    "\u6447\u5934",
    "\u6325\u624B",
    "\u62AC\u624B",
    "\u6BD4\u5FC3",
    "\u97A0\u8EAC",
    "\u770B\u5411",
    "\u770B\u7740",
    "\u4F4E\u5934",
    "\u62AC\u5934"
  ].some((hint) => normalized.includes(hint));
}
function selectParameters(available, max) {
  return Object.entries(available).sort(([a, ai], [b, bi]) => rank(a, ai) - rank(b, bi) || a.localeCompare(b)).slice(0, max);
}
function capabilitySummary(parameters) {
  const groups = /* @__PURE__ */ new Map();
  for (const [id, info] of parameters) {
    const key = group(id, info);
    groups.set(key, [...groups.get(key) ?? [], label(id, info) + " (" + id + ")"]);
  }
  return [...groups].map(([key, values]) => "- " + key + ": " + values.slice(0, 12).join(", ")).join("\n");
}
function rank(id, info) {
  return ["head", "body", "gaze", "brow", "mouthForm", "eyeSmile"].includes(group(id, info)) ? 0 : 10;
}
function group(id, info) {
  const value = normalize(id + " " + (info.name ?? "") + " " + (info.groupName ?? ""));
  if (has(value, ["body", "torso", "spine", "\u8EAB\u4F53", "\u8EAF\u5E72"])) return "body";
  if (has(value, ["angle", "head", "neck", "\u5934", "\u9888"])) return "head";
  if (has(value, ["eyeball", "gaze", "\u773C\u7403", "\u89C6\u7EBF"])) return "gaze";
  if (has(value, ["brow", "\u7709"])) return "brow";
  if (has(value, ["mouthform", "mouthshape", "lipshape", "pucker", "smile", "\u5634\u578B", "\u53E3\u578B"])) return "mouthForm";
  if (has(value, ["eyesmile", "\u7B11\u773C"])) return "eyeSmile";
  if (has(value, ["arm", "hand", "ear", "tail", "wing", "\u624B", "\u8033", "\u5C3E", "\u7FC5"])) return "appendage";
  return info.groupName || info.groupId || "other";
}
function tune(id, value, info, config) {
  let next = clamp(value, info.min, info.max);
  const normalized = normalize(id);
  const eyeOpen = normalized.includes("eye") && normalized.includes("open");
  const joint = !eyeOpen && has(normalized, [
    "angle",
    "body",
    "head",
    "neck",
    "shoulder",
    "arm",
    "hand",
    "wrist",
    "elbow",
    "spine",
    "torso",
    "hip",
    "leg",
    "knee",
    "foot"
  ]);
  if (joint) next = info.default + (next - info.default) * config.jointMotionBoost;
  if (eyeOpen && config.eyeOpenBinary) {
    next = next >= (info.min + info.max) / 2 ? info.max : info.min;
  }
  const range = Math.abs(info.max - info.min);
  const delta = next - info.default;
  const minimum = range * config.minVisibleRatio;
  if (range && Math.abs(delta) > 0 && Math.abs(delta) < minimum) {
    next = info.default + Math.sign(delta) * minimum;
  }
  return clamp(next, info.min, info.max);
}
function defaultRange(id) {
  const value = normalize(id);
  if (value.includes("angle")) return { min: -30, max: 30, default: 0 };
  if (has(value, ["eyeball", "mouthform", "mouthshape", "brow", "pucker", "smile"])) {
    return { min: -1, max: 1, default: 0 };
  }
  if (value.includes("eyeopen")) return { min: 0, max: 1, default: 1 };
  return { min: 0, max: 1, default: 0 };
}
function formats(schema) {
  return [schema, { type: "json_object" }, void 0];
}
function responseFormatName(format) {
  if (!format) return "none";
  return format.type === "json_schema" ? "json_schema:" + format.json_schema.name : format.type;
}
function parseJSON(content) {
  const value = content.trim();
  if (!value) throw new Error("LLM returned empty content");
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
    throw new Error("LLM did not return JSON: " + value.slice(0, 160));
  }
}
function label(id, info) {
  const labels = [info.name, info.groupName].filter((value) => Boolean(value?.trim()));
  return labels.length ? Array.from(new Set(labels)).join(" / ") : id;
}
function normalize(value) {
  return value.replace(/\s+/gu, "").replace(/[＿_\-　]/gu, "").toLowerCase();
}
function has(value, hints) {
  return hints.some((hint) => value.includes(normalize(hint)));
}
function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function clampInteger(value, min, max) {
  return Math.round(clamp(value, min, max));
}
function integer(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? clampInteger(value, min, max) : clampInteger(fallback, min, max);
}
function number(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}
function errorText(error, fallback) {
  return error instanceof Error ? error.message : error == null ? fallback : String(error);
}
function addUnique(values, value) {
  if (value && !values.includes(value)) values.push(value);
}
var parameterFrameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["time", "duration", "label", "parameters"],
  properties: {
    time: { type: "number", minimum: 0 },
    duration: { type: "number", minimum: 0.1, maximum: 30 },
    label: { type: "string" },
    parameters: {
      type: "object",
      minProperties: 1,
      maxProperties: 12,
      additionalProperties: { type: "number" }
    }
  }
};
var actionFrameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["frameIndex", "action", "emphasis"],
  properties: {
    frameIndex: { type: "number", minimum: 0 },
    action: { type: "string" },
    emphasis: { type: "string" }
  }
};
var speakingMotionResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_speaking_parameter_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["parameterPlan"],
      properties: { parameterPlan: { type: "array", items: parameterFrameSchema } }
    }
  }
};
var speakingMotionActionResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_speaking_motion_actions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["motionPlan"],
      properties: { motionPlan: { type: "array", items: actionFrameSchema } }
    }
  }
};
export {
  SoullinkSpeakingMotionPlanner,
  createSoullinkSpeakingMotionPlanner,
  defaultSpeakingMotionGenerationConfig,
  isMouthOrJawOpenParameter,
  resolveSpeakingMotionFrameCount,
  resolveSpeakingMotionGenerationConfig,
  sanitizeSpeakingMotionParameters,
  speakingMotionActionResponseFormat,
  speakingMotionResponseFormat
};
