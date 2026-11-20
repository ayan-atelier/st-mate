/**
 * ST伴侣 (st-mate) · 统一的轻量「伴侣助手」底层内核 (assistant-core)
 * 职责边界（领域无关通用层，供预设馆 / 人设馆 / 叙事记忆零成本共用）：
 * 1. 双轨零干扰 API 调用引擎：自动解析副通道站子或跟随主通道，直连 /api/backends/chat-completions/generate (type: 'quiet')，
 *    全程 100% 零篡改用户当前主站子的 oai_settings、主密钥与角色聊天记录；
 * 2. 模型采样兼容与推理剥离：自动剥离 <think>...</think> 推理块，兼容 o1 / claude-opus-5 禁 temperature 与 MiniMax 禁 0 约束，
 *    支持 AbortController 随时中断取消与 90s 长任务超时保护；
 * 3. 鲁棒 JSON 方案提取器：支持纯 JSON、代码块 JSON、自然语言分析附带 JSON、尾随逗号容错，纯问答无 JSON 时安全降级为纯文本回复；
 * 4. 多轮精简会话控制器：维护最近 8 轮精简问答摘要（剥离历史巨型 JSON 防 Token 膨胀），支持一键清空与流中取消。
 */

import { normalizeApiStation, sanitizeEndpointUrl } from '../core/schema.js?v=0.7.8';
import {
  buildHostProxyPresetName,
  buildProbeGenerateBody,
  buildStationFromCurrentHost,
  extractCompletionPayload,
  getHostModelForSource,
  getHostUrlForSource,
  getSourceMeta,
  isTemperatureUnsupportedModel,
  needsV1Suffix,
  resolveAuxApiChannel,
  resolveSecretKeyForStation,
} from './api-backend.js?v=0.7.8';

export const DEFAULT_ASSISTANT_TIMEOUT_MS = 90000;
export const DEFAULT_MAX_HISTORY_TURNS = 8;

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function clampFloat(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function resolveEndpointHref(apiPath, doc = globalThis.document) {
  const clean = String(apiPath || '').replace(/^\/+/, '');
  const candidates = [doc?.baseURI, globalThis.location?.href];
  for (const base of candidates) {
    if (typeof base === 'string' && /^(?:https?|tauri|capacitor|app):\/\//i.test(base)) {
      try {
        return new URL(clean, base).href;
      } catch {
        // fall through
      }
    }
  }
  return `/${clean}`;
}

function normalizeUrlForCompare(rawUrl) {
  return String(rawUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * 从酒馆 oai_settings.proxies 中只读匹配某张反代站子对应的密码（绝不修改原 oai_settings）。
 */
function lookupStationProxyPassword(oaiSettings, station) {
  const meta = getSourceMeta(station?.source);
  if (!station || meta.urlMode !== 'reverse_proxy' || !station.url) {
    return '';
  }

  const proxies = Array.isArray(oaiSettings?.proxies) ? oaiSettings.proxies : [];
  const slotName = buildHostProxyPresetName(station.id);

  const byId = proxies.find(item => item && item.name === slotName);
  if (byId && typeof byId.password === 'string') {
    return byId.password;
  }

  const targetNorm = normalizeUrlForCompare(station.url);
  if (targetNorm) {
    const byUrl = proxies.find(
      item =>
        item &&
        typeof item.url === 'string' &&
        normalizeUrlForCompare(item.url) === targetNorm &&
        typeof item.password === 'string' &&
        item.password.length > 0,
    );
    if (byUrl) {
      return byUrl.password;
    }

    if (
      typeof oaiSettings?.reverse_proxy === 'string' &&
      normalizeUrlForCompare(oaiSettings.reverse_proxy) === targetNorm &&
      typeof oaiSettings?.proxy_password === 'string'
    ) {
      return oaiSettings.proxy_password;
    }
  }

  return '';
}

function resolveFallbackSecretId(station, secretsMap = {}) {
  if (station?.secretId) return station.secretId;
  const keyType = resolveSecretKeyForStation(station);
  const list = Array.isArray(secretsMap?.[keyType]) ? secretsMap[keyType] : [];
  const active = list.find(item => item?.active) || list[0] || null;
  return typeof active?.id === 'string' ? active.id.trim() : '';
}

/**
 * 解析当前伴侣助手运行时生效的 API 通道（纯只读计算，100% 零篡改宿主连接与配置）。
 */
export function resolveAssistantRuntimeChannel({
  store = null,
  settings = null,
  getContext = null,
  secretsMap = {},
} = {}) {
  const effectiveSettings = settings || store?.get?.() || {};
  const ctx = getContext?.();
  const oai = ctx?.chatCompletionSettings || {};

  const auxResolved = resolveAuxApiChannel(effectiveSettings);

  // 1. 副通道模式：玩家显式指定了某张已存副站子卡片
  if (auxResolved.mode === 'station' && auxResolved.station) {
    const baseStation = normalizeApiStation(auxResolved.station);
    const model = String(auxResolved.model || baseStation.model || '').trim();
    const secretId = resolveFallbackSecretId(baseStation, secretsMap);
    const station = {
      ...baseStation,
      model,
      secretId,
    };
    const meta = getSourceMeta(station.source);
    const proxyPassword = lookupStationProxyPassword(oai, station);
    const displayModel = model || '未选模型';

    return {
      mode: 'station',
      channelType: 'aux',
      station,
      sourceMeta: meta,
      model,
      proxyPassword,
      badgeLabel: `副通道 · ${model || station.name || meta.shortLabel}`,
      detailLabel: `副通道（${station.name} · ${displayModel}）`,
    };
  }

  // 2. 默认零配置跟随主对话 API：优先匹配 apiStudio.activeStationId 并与宿主实时模型对齐，未建站子时直接从宿主构造
  const stations = Array.isArray(effectiveSettings?.apiStudio?.stations)
    ? effectiveSettings.apiStudio.stations
    : [];
  const activeStationId = String(effectiveSettings?.apiStudio?.activeStationId || '').trim();
  const matchedActive = activeStationId
    ? stations.find(item => item && item.id === activeStationId) || null
    : null;

  const hostLiveSource =
    typeof oai.chat_completion_source === 'string' && oai.chat_completion_source.trim()
      ? oai.chat_completion_source.trim()
      : '';

  let station = null;
  if (matchedActive && (!hostLiveSource || hostLiveSource === matchedActive.source)) {
    const normalized = normalizeApiStation(matchedActive);
    const liveModel = getHostModelForSource(oai, normalized.source) || normalized.model || '';
    const liveUrl = normalized.url || getHostUrlForSource(oai, normalized.source) || '';
    const secretId = resolveFallbackSecretId(normalized, secretsMap);
    station = {
      ...normalized,
      url: liveUrl,
      model: liveModel,
      secretId,
    };
  } else {
    station = buildStationFromCurrentHost(ctx, secretsMap);
  }

  const meta = getSourceMeta(station.source);
  const proxyPassword =
    lookupStationProxyPassword(oai, station) ||
    (meta.urlMode === 'reverse_proxy' && station.url ? String(oai.proxy_password || '') : '');
  const model = String(station.model || '').trim();

  return {
    mode: 'follow_main',
    channelType: 'main',
    station,
    sourceMeta: meta,
    model,
    proxyPassword,
    badgeLabel: `主通道 · ${model || meta.shortLabel}`,
    detailLabel: `主通道（${station.name || meta.shortLabel} · ${model || '未选模型'}）`,
  };
}

/**
 * 判断模型是否拒绝接收 temperature 采样参数（如 o1/o3/o4 推理系列、Claude Opus 4.7+/5/Fable 与部分 Gemini 3 Flash）。
 */
export function isTemperatureForbiddenModel(model = '') {
  return isTemperatureUnsupportedModel(model);
}

/**
 * 严格归一化发往 `/api/backends/chat-completions/generate` 的消息序列：
 * 1. 合并前置 `system` 为唯一顶置系统消息，中途零散 `system` 安全并入 `user`；
 * 2. 剔除空白消息，自动合并相邻同角色消息，确保对话流严格遵循 `user <-> assistant` 交替；
 * 3. 确保非 system 对话首条必为 `user`、末条必为 `user`（彻底杜绝 Claude Strict / Thinking / Gemini 3 报 `400 roles must alternate` 或 `prefill not supported`）。
 */
export function normalizeAssistantMessages(rawMessages = []) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return [];

  const systemParts = [];
  const rawTurns = [];
  let seenDialogueTurn = false;

  for (const item of rawMessages) {
    if (!item || typeof item !== 'object') continue;
    const rawRole = String(item.role || '').trim().toLowerCase();
    const text =
      typeof item.content === 'string'
        ? item.content.trim()
        : Array.isArray(item.content)
          ? item.content
              .map(part => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
              .join('\n')
              .trim()
          : '';
    if (!text) continue;

    if (rawRole === 'system') {
      if (!seenDialogueTurn) {
        systemParts.push(text);
      } else {
        rawTurns.push({ role: 'user', content: text });
      }
      continue;
    }

    const normalizedRole = rawRole === 'assistant' || rawRole === 'model' ? 'assistant' : 'user';
    seenDialogueTurn = true;
    rawTurns.push({ role: normalizedRole, content: text });
  }

  const alternating = [];
  for (const turn of rawTurns) {
    if (alternating.length === 0 && turn.role === 'assistant') {
      alternating.push({ role: 'user', content: '请按系统要求开始分析。' });
    }
    const prev = alternating[alternating.length - 1];
    if (prev && prev.role === turn.role) {
      prev.content = `${prev.content}\n\n${turn.content}`;
    } else {
      alternating.push({ role: turn.role, content: turn.content });
    }
  }

  if (alternating.length > 0 && alternating[alternating.length - 1].role === 'assistant') {
    alternating.push({ role: 'user', content: '请继续。' });
  }

  const result = [];
  if (systemParts.length > 0) {
    result.push({ role: 'system', content: systemParts.join('\n\n') });
  }
  result.push(...alternating);
  return result;
}

/**
 * 构造发送至 `/api/backends/chat-completions/generate` 的零干扰静默生成请求体。
 */
export function buildAssistantGenerateBody(
  channel,
  messages = [],
  { oaiSettings = {}, maxTokens = 4096, temperature = 0.4 } = {},
) {
  const station = channel?.station || {};
  const model = String(channel?.model || station.model || '').trim();
  const stationForCall = {
    ...station,
    model,
  };

  // 使用浅拷贝隔离反代密码与系统提示开关，绝不触碰宿主真实 oai_settings 对象
  const isolatedOai = {
    ...(oaiSettings && typeof oaiSettings === 'object' ? oaiSettings : {}),
    proxy_password: channel?.proxyPassword ?? oaiSettings?.proxy_password ?? '',
    use_sysprompt:
      oaiSettings?.use_sysprompt !== undefined ? Boolean(oaiSettings.use_sysprompt) : true,
  };

  const body = buildProbeGenerateBody(stationForCall, isolatedOai);
  body.type = 'quiet';
  body.stream = false;
  body.messages = normalizeAssistantMessages(messages);
  body.max_tokens = clampInt(maxTokens, 128, 32768, 4096);

  if (isTemperatureForbiddenModel(model)) {
    delete body.temperature;
  } else {
    let safeTemp = Math.round(clampFloat(temperature, 0, 2, 0.4) * 100) / 100;
    // 兼容 MiniMax 严禁 temperature === 0 的接口约束
    if (
      safeTemp <= 0 &&
      (stationForCall.source === 'minimax' || /minimax/i.test(model))
    ) {
      safeTemp = 0.01;
    }
    body.temperature = safeTemp;
  }

  return body;
}

/**
 * 剥离模型输出中的 `<think>...</think>` 或 `<thinking>...</thinking>` 推理过程块，保留纯净正文。
 */
export function stripThinkingBlocks(rawText = '') {
  const source = typeof rawText === 'string' ? rawText : '';
  if (!source) {
    return { cleanText: '', thinkingText: '' };
  }

  const capturedThoughts = [];
  let cleaned = source.replace(
    /<(think|thinking)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_match, _tag, inner) => {
      if (typeof inner === 'string' && inner.trim()) {
        capturedThoughts.push(inner.trim());
      }
      return '';
    },
  );

  // 若输出因 max_tokens 截断导致存在未闭合的前置 <think> 标签，安全剥离未闭合推理段
  const unclosedMatch = cleaned.match(/<(?:think|thinking)\b[^>]*>([\s\S]*)$/i);
  if (unclosedMatch) {
    const beforeTag = cleaned.slice(0, unclosedMatch.index).trim();
    if (unclosedMatch[1]?.trim()) {
      capturedThoughts.push(unclosedMatch[1].trim());
    }
    cleaned = beforeTag;
  }

  return {
    cleanText: cleaned.trim(),
    thinkingText: capturedThoughts.join('\n\n').trim(),
  };
}

function extractErrorDetail(payload, rawText = '') {
  const candidates = [
    payload?.error?.message,
    payload?.message,
    typeof payload?.error === 'string' ? payload.error : '',
    rawText,
  ];
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim() && item.trim() !== 'true') {
      const compact = item.replace(/\s+/g, ' ').trim();
      if (!compact.startsWith('<!DOCTYPE') && !compact.startsWith('<html')) {
        return compact.slice(0, 120);
      }
    }
  }
  return '';
}

/**
 * 执行一次零干扰伴侣助手补全请求（支持主/副通道自动路由、AbortController 取消、超时保护与人话报错）。
 */
export async function requestAssistantCompletion({
  messages = [],
  store = null,
  settings = null,
  getContext = null,
  secretsMap = {},
  fetchImpl = globalThis.fetch,
  signal = null,
  timeoutMs = DEFAULT_ASSISTANT_TIMEOUT_MS,
  maxTokens = 4096,
  temperature = 0.4,
  doc = globalThis.document,
} = {}) {
  const channel = resolveAssistantRuntimeChannel({ store, settings, getContext, secretsMap });
  const station = channel.station;
  const channelTitle = channel.channelType === 'aux' ? '副通道' : '主通道';

  if (station.source === 'custom' && !sanitizeEndpointUrl(station.url)) {
    return {
      ok: false,
      aborted: false,
      latencyMs: 0,
      channel,
      rawText: '',
      cleanText: '',
      thinkingText: '',
      message: `${channelTitle}尚未填写有效的 http(s) 接口地址，请先在顶栏「API 与模型工作台」配置连接`,
    };
  }

  if (!channel.model) {
    return {
      ok: false,
      aborted: false,
      latencyMs: 0,
      channel,
      rawText: '',
      cleanText: '',
      thinkingText: '',
      message: `${channelTitle}尚未选择模型名称，请先在顶栏「API 与模型工作台」选择模型后再试`,
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      aborted: false,
      latencyMs: 0,
      channel,
      rawText: '',
      cleanText: '',
      thinkingText: '',
      message: '当前运行环境不支持网络请求',
    };
  }

  const startedAt = Date.now();
  const internalController =
    typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
  let timedOut = false;
  let userAborted = Boolean(signal?.aborted);

  const onExternalAbort = () => {
    userAborted = true;
    internalController?.abort();
  };

  if (signal && typeof signal.addEventListener === 'function') {
    if (signal.aborted) {
      onExternalAbort();
    } else {
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer =
    internalController && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          internalController.abort();
        }, timeoutMs)
      : 0;

  try {
    if (userAborted) {
      const abortErr = new Error('Aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const ctx = getContext?.();
    const headers =
      typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };

    const reqBody = buildAssistantGenerateBody(channel, messages, {
      oaiSettings: ctx?.chatCompletionSettings,
      maxTokens,
      temperature,
    });

    const effectiveSignal = internalController ? internalController.signal : signal;
    const res = await fetchImpl(resolveEndpointHref('api/backends/chat-completions/generate', doc), {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
      ...(effectiveSignal ? { signal: effectiveSignal } : {}),
    });

    const latencyMs = Math.max(1, Date.now() - startedAt);
    let payload = null;
    let rawBodyText = '';

    if (typeof res?.text === 'function') {
      rawBodyText = await res.text();
      try {
        payload = rawBodyText ? JSON.parse(rawBodyText) : null;
      } catch {
        payload = null;
      }
    } else if (typeof res?.json === 'function') {
      payload = await res.json();
    }

    if (!res?.ok || payload?.error) {
      const status = Number(res?.status || 0);
      const detail = extractErrorDetail(payload, rawBodyText);
      const tail = detail ? `（${detail}）` : '';

      if (status === 401 || status === 403) {
        return {
          ok: false,
          aborted: false,
          latencyMs,
          channel,
          rawText: '',
          cleanText: '',
          thinkingText: '',
          message: `${channelTitle}鉴权未通过 (HTTP ${status})：密钥无效或无模型「${channel.model}」访问权限${tail}`,
        };
      }
      if (status === 404) {
        const v1Hint = needsV1Suffix(station.url, station.source)
          ? '建议在 API 工作台点击「补全 /v1」后再试'
          : `请检查接口地址路径或模型名「${channel.model}」拼写是否正确`;
        return {
          ok: false,
          aborted: false,
          latencyMs,
          channel,
          rawText: '',
          cleanText: '',
          thinkingText: '',
          message: `${channelTitle}请求未找到 (HTTP 404)：${v1Hint}${tail}`,
        };
      }
      if (status === 429) {
        return {
          ok: false,
          aborted: false,
          latencyMs,
          channel,
          rawText: '',
          cleanText: '',
          thinkingText: '',
          message: `${channelTitle}请求受限 (HTTP 429)：当前密钥额度不足或请求过快，可稍候重试或切换副通道${tail}`,
        };
      }
      return {
        ok: false,
        aborted: false,
        latencyMs,
        channel,
        rawText: '',
        cleanText: '',
        thinkingText: '',
        message: `${channelTitle}请求失败${status ? ` (HTTP ${status})` : ''}：${detail || '请检查接口地址、密钥与模型是否匹配'}`,
      };
    }

    const extracted = extractCompletionPayload(payload);
    const rawText = extracted.text;
    const stripped = stripThinkingBlocks(rawText);
    const cleanText = stripped.cleanText;
    const thinkingText = [extracted.reasoningText, stripped.thinkingText]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    if (!cleanText) {
      return {
        ok: false,
        aborted: false,
        latencyMs,
        channel,
        rawText,
        cleanText: '',
        thinkingText,
        message: `${channelTitle}返回了空内容（可能是输出长度过小被推理过程占满，请重试或更换模型）`,
      };
    }

    return {
      ok: true,
      aborted: false,
      latencyMs,
      channel,
      rawText,
      cleanText,
      thinkingText,
      message: 'ok',
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const isAbort = err?.name === 'AbortError' || userAborted || timedOut;
    if (isAbort && userAborted && !timedOut) {
      return {
        ok: false,
        aborted: true,
        latencyMs,
        channel,
        rawText: '',
        cleanText: '',
        thinkingText: '',
        message: '已停止本次生成',
      };
    }
    if (isAbort && timedOut) {
      return {
        ok: false,
        aborted: false,
        latencyMs,
        channel,
        rawText: '',
        cleanText: '',
        thinkingText: '',
        message: `伴侣助手响应超时 (${Math.round(timeoutMs / 1000)}s)：预设较长或接口响应过慢，可切换更快的副通道模型重试`,
      };
    }
    return {
      ok: false,
      aborted: false,
      latencyMs,
      channel,
      rawText: '',
      cleanText: '',
      thinkingText: '',
      message: `${channelTitle}网络异常：${err?.message || '请检查网络连接或接口地址'}`,
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ============================================================================
// 二、鲁棒 JSON 方案提取器 (extractAssistantPlan)
// ============================================================================

/**
 * 引号感知的 JSON 尾随逗号清理器（仅移除字符串字面量外部紧邻 `}` 或 `]` 前的多余逗号，绝不误伤提示词正文）。
 */
export function removeJsonTrailingCommas(rawJson = '') {
  const src = String(rawJson || '').replace(/^\uFEFF/, '');
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ',') {
      let lookahead = i + 1;
      while (lookahead < src.length && /\s/.test(src[lookahead])) {
        lookahead += 1;
      }
      if (src[lookahead] === '}' || src[lookahead] === ']') {
        continue;
      }
    }

    out += ch;
  }

  return out;
}

function tryParseLenientJson(candidateText) {
  if (typeof candidateText !== 'string') return null;
  const trimmed = candidateText.trim();
  if (!trimmed.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    // 尝试清理常见尾随逗号后二次解析
  }

  try {
    const repaired = removeJsonTrailingCommas(trimmed);
    const parsed = JSON.parse(repaired);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function looksLikeAssistantPlanObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return (
    Array.isArray(obj.operations) ||
    Array.isArray(obj.ops) ||
    Array.isArray(obj.actions) ||
    typeof obj.reply === 'string' ||
    typeof obj.message === 'string' ||
    typeof obj.explanation === 'string' ||
    typeof obj.summary === 'string'
  );
}

/**
 * 引号感知地扫描文本中所有配平的顶层 `{ ... }` 子串区间（自动忽略 `{{user}}` 等非 JSON 宏语法）。
 */
function findBalancedBraceSpans(text = '') {
  const spans = [];
  let depth = 0;
  let startIdx = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      if (depth > 0) {
        inString = true;
      }
      continue;
    }

    if (ch === '{') {
      if (depth === 0) {
        startIdx = i;
      }
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && startIdx >= 0) {
        spans.push({
          start: startIdx,
          end: i + 1,
          raw: text.slice(startIdx, i + 1),
        });
        startIdx = -1;
      }
    }
  }

  return spans;
}

function normalizeParsedPlan(parsedObj, outsideProse = '') {
  const rawOps = Array.isArray(parsedObj.operations)
    ? parsedObj.operations
    : Array.isArray(parsedObj.ops)
      ? parsedObj.ops
      : Array.isArray(parsedObj.actions)
        ? parsedObj.actions
        : [];

  const operations = rawOps.filter(item => item && typeof item === 'object' && !Array.isArray(item));

  const innerReply = [parsedObj.reply, parsedObj.message, parsedObj.explanation, parsedObj.summary].find(
    val => typeof val === 'string' && val.trim().length > 0,
  );
  const cleanInner = typeof innerReply === 'string' ? innerReply.trim() : '';
  const cleanOutside = String(outsideProse || '').trim();

  let reply = cleanInner;
  if (cleanOutside && cleanInner) {
    // 若代码块外有实质前置分析且未被包含在 JSON reply 内，自然拼接保留完整分析脉络
    if (!cleanInner.includes(cleanOutside) && !cleanOutside.includes(cleanInner)) {
      reply = `${cleanOutside}\n\n${cleanInner}`;
    } else {
      reply = cleanOutside.length >= cleanInner.length ? cleanOutside : cleanInner;
    }
  } else if (!reply && cleanOutside) {
    reply = cleanOutside;
  }

  if (!reply && operations.length > 0) {
    reply = '已为你整理好预设修改方案，请在下方确认勾选后点击应用。';
  }

  return {
    reply,
    operations,
    hasStructuredPlan: true,
  };
}

/**
 * 从模型原始输出中鲁棒提取 `{ reply, operations }`：
 * - 支持 `<think>...</think>` 前置推理自动剥离；
 * - 支持纯 JSON、` ```json ... ``` ` 代码块、自然语言分析附带裸 JSON 对象及尾随逗号容错；
 * - 当模型仅做纯文本诊断问答未给 JSON 时，原样安全降级为 `{ reply: cleanText, operations: [] }` 展示，绝不报错崩溃！
 */
export function extractAssistantPlan(rawText = '') {
  const { cleanText } = stripThinkingBlocks(rawText);
  if (!cleanText) {
    return { reply: '', operations: [], hasStructuredPlan: false };
  }

  // 1. 尝试整段纯 JSON 解析
  const directObj = tryParseLenientJson(cleanText);
  if (directObj && looksLikeAssistantPlanObject(directObj)) {
    return normalizeParsedPlan(directObj, '');
  }

  // 2. 尝试匹配 ```json ... ``` 或 ``` ... ``` 代码块（从后往前优先匹配最终方案块）
  const fenceRegex = /```(?:json|jsonc|javascript|js)?\s*([\s\S]*?)```/gi;
  const fences = [];
  let match = fenceRegex.exec(cleanText);
  while (match !== null) {
    fences.push({
      fullMatch: match[0],
      inner: match[1],
      index: match.index,
      end: match.index + match[0].length,
    });
    match = fenceRegex.exec(cleanText);
  }

  for (let i = fences.length - 1; i >= 0; i -= 1) {
    const f = fences[i];
    const parsed = tryParseLenientJson(f.inner);
    if (parsed && looksLikeAssistantPlanObject(parsed)) {
      const outside = `${cleanText.slice(0, f.index)}\n${cleanText.slice(f.end)}`.trim();
      return normalizeParsedPlan(parsed, outside);
    }
  }

  // 3. 尝试从自然语言分析 + 裸 JSON 对象混合文本中扫描配平的 `{ ... }` 块
  const braceSpans = findBalancedBraceSpans(cleanText);
  for (let i = braceSpans.length - 1; i >= 0; i -= 1) {
    const span = braceSpans[i];
    // 跳过 `{{user}}` 等极短酒馆宏花括号
    if (span.raw.startsWith('{{') && span.raw.endsWith('}}')) continue;
    const parsed = tryParseLenientJson(span.raw);
    if (parsed && looksLikeAssistantPlanObject(parsed)) {
      const outside = `${cleanText.slice(0, span.start)}\n${cleanText.slice(span.end)}`.trim();
      return normalizeParsedPlan(parsed, outside);
    }
  }

  // 4. 纯自然语言回复兜底（如纯预设诊断解答，无任何 JSON 动作）
  return {
    reply: cleanText,
    operations: [],
    hasStructuredPlan: false,
  };
}

// ============================================================================
// 三、通用多轮精简会话控制器 (createAssistantSession)
// ============================================================================

function defaultSummarizeOperations(operations = []) {
  if (!Array.isArray(operations) || operations.length === 0) return '';
  const briefItems = operations.slice(0, 8).map(op => {
    const type = String(op?.type || 'op');
    const target = String(op?.name || op?.identifier || '').trim();
    return target ? `${type}(${target})` : type;
  });
  const more = operations.length > 8 ? ` 等共 ${operations.length} 项` : '';
  return `[本轮生成操作建议: ${briefItems.join(', ')}${more}]`;
}

function buildCompactAssistantDigest(turn, summarizeOpsFn) {
  const shortReply = String(turn?.reply || '')
    .trim()
    .slice(0, 600);
  const ops = Array.isArray(turn?.operations) ? turn.operations : [];
  const opsSummary = ops.length > 0 ? summarizeOpsFn(ops) : '';
  const appliedNote = turn?.appliedSummary ? `[${turn.appliedSummary}]` : '';
  return [shortReply, opsSummary, appliedNote].filter(Boolean).join('\n') || '[已完成本轮分析]';
}

function createTurnId() {
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 创建领域无关的多轮伴侣助手会话控制器：
 * - 维护最近 `maxHistoryTurns`（默认 8）轮精简问答历史；
 * - 发包时历史消息仅携带「用户原始诉求」与「助手精简文字摘要 + 单行操作概览」，绝不把历史巨型 JSON 或旧快照反复叠进上下文！
 */
export function createAssistantSession({
  domainId = 'generic',
  systemPromptBuilder,
  contextBuilder,
  summarizeOperations = defaultSummarizeOperations,
  maxHistoryTurns = DEFAULT_MAX_HISTORY_TURNS,
  store = null,
  getContext = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_ASSISTANT_TIMEOUT_MS,
  maxTokens = 4096,
  temperature = 0.4,
} = {}) {
  const maxTurns = clampInt(maxHistoryTurns, 1, 20, DEFAULT_MAX_HISTORY_TURNS);
  const completedTurns = []; // 每项为一轮已完成的 { id, userText, reply, operations, appliedSummary, createdAt }
  let inFlightController = null;

  /**
   * 组装即将发送给模型的 messages 数组（供真实请求与离线单测断言共用）。
   */
  function buildRequestMessages(userText, explicitContext = undefined) {
    const cleanUserText = String(userText || '').trim();
    const liveContext =
      explicitContext !== undefined
        ? explicitContext
        : typeof contextBuilder === 'function'
          ? contextBuilder({ userText: cleanUserText, domainId })
          : '';

    const systemPrompt =
      typeof systemPromptBuilder === 'function'
        ? String(systemPromptBuilder({ domainId, context: liveContext }) || '').trim()
        : '';

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 仅截取最近 maxTurns 轮精简对话历史，杜绝历史巨型 JSON 堆积
    const recentSlice = completedTurns.slice(-maxTurns);
    for (const turn of recentSlice) {
      messages.push({
        role: 'user',
        content: turn.userText,
      });
      messages.push({
        role: 'assistant',
        content: buildCompactAssistantDigest(turn, summarizeOperations),
      });
    }

    const contextBlock =
      typeof liveContext === 'string'
        ? liveContext.trim()
        : liveContext && typeof liveContext === 'object'
          ? JSON.stringify(liveContext)
          : '';

    const currentUserPayload = contextBlock
      ? `【当前实时上下文快照】\n${contextBlock}\n\n【用户本轮诉求】\n${cleanUserText}`
      : cleanUserText;

    messages.push({
      role: 'user',
      content: currentUserPayload,
    });

    return normalizeAssistantMessages(messages);
  }

  /**
   * 发送一轮用户消息并自动解析结构化方案，成功后归档入最近 8 轮精简历史。
   */
  async function send(
    userText,
    {
      settings = null,
      secretsMap = {},
      fetchOverride = null,
      doc = globalThis.document,
    } = {},
  ) {
    const cleanPrompt = String(userText || '').trim();
    if (!cleanPrompt) {
      return {
        ok: false,
        aborted: false,
        message: '请输入你的需求或问题',
      };
    }

    if (inFlightController) {
      return {
        ok: false,
        aborted: false,
        busy: true,
        message: '伴侣助手正在思考上一条请求，请等待完成或点击「停止」',
      };
    }

    const controller =
      typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    inFlightController = controller;

    try {
      const liveContext =
        typeof contextBuilder === 'function'
          ? await contextBuilder({ userText: cleanPrompt, domainId })
          : '';
      const reqMessages = buildRequestMessages(cleanPrompt, liveContext);

      const completion = await requestAssistantCompletion({
        messages: reqMessages,
        store,
        settings,
        getContext,
        secretsMap,
        fetchImpl: fetchOverride || fetchImpl,
        signal: controller?.signal || null,
        timeoutMs,
        maxTokens,
        temperature,
        doc,
      });

      if (!completion.ok) {
        return {
          ok: false,
          aborted: Boolean(completion.aborted),
          latencyMs: completion.latencyMs,
          channel: completion.channel,
          message: completion.message,
        };
      }

      const plan = extractAssistantPlan(completion.cleanText);
      const turnRecord = {
        id: createTurnId(),
        userText: cleanPrompt,
        reply: plan.reply,
        operations: plan.operations,
        hasStructuredPlan: plan.hasStructuredPlan,
        appliedSummary: '',
        createdAt: Date.now(),
      };

      completedTurns.push(turnRecord);
      // 内存历史上限保护（保留最近 maxTurns * 2 轮供会话摘要滑动，发包严格截取最近 maxTurns 轮）
      if (completedTurns.length > maxTurns * 2) {
        completedTurns.splice(0, completedTurns.length - maxTurns * 2);
      }

      return {
        ok: true,
        aborted: false,
        turnId: turnRecord.id,
        latencyMs: completion.latencyMs,
        channel: completion.channel,
        reply: plan.reply,
        operations: plan.operations,
        hasStructuredPlan: plan.hasStructuredPlan,
        thinkingText: completion.thinkingText,
      };
    } finally {
      if (inFlightController === controller) {
        inFlightController = null;
      }
    }
  }

  function markTurnApplied(turnId, summaryText = '用户已应用本轮修改') {
    const hit = completedTurns.find(item => item.id === turnId);
    if (hit) {
      hit.appliedSummary = String(summaryText || '').trim();
      return true;
    }
    return false;
  }

  function abort() {
    if (!inFlightController) return false;
    const ctrl = inFlightController;
    inFlightController = null;
    ctrl.abort();
    return true;
  }

  function clearHistory() {
    abort();
    completedTurns.length = 0;
  }

  return {
    domainId,
    send,
    abort,
    clearHistory,
    markTurnApplied,
    buildRequestMessages,
    isBusy: () => Boolean(inFlightController),
    getHistoryTurns: () => completedTurns.slice(-maxTurns).map(t => ({ ...t })),
    getTurnCount: () => Math.min(completedTurns.length, maxTurns),
  };
}
