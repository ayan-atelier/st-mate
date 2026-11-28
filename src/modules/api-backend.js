/**
 * ST伴侣 (st-mate) · 「API 与模型工作台」纯数据模型与酒馆底层适配引擎
 * 职责边界：
 * 1. 维护酒馆全部 26 个聊天补全来源 (chat_completion_sources) 的中文人话分组、模型字段与原生 DOM 选择器映射；
 * 2. 对接酒馆原生加密保险箱 (/api/secrets/read | write | rotate)，实现每张站子卡片强绑定专属 secretId，绝不明文落盘密钥；
 * 3. 精准同步 ctx.chatCompletionSettings (oai_settings) 与原生表单节点，100% 零触碰对话预设；
 * 4. 支持首次打开自动接管当前连接、增量导入 Connection Manager 配置、URL /v1 检测补全、模型拉取与模糊搜索收藏。
 */

import {
  CHAT_COMPLETION_SOURCE_IDS,
  normalizeApiStation,
  resolveDefaultSecretKey,
  sanitizeEndpointUrl,
} from '../core/schema.js?v=0.9.22';

export const PRIMARY_SOURCE_IDS = Object.freeze([
  'custom',
  'vertexai',
  'makersuite',
  'claude',
  'openrouter',
]);

export const MORE_SOURCE_IDS = Object.freeze(
  CHAT_COMPLETION_SOURCE_IDS.filter(id => !PRIMARY_SOURCE_IDS.includes(id)),
);

/**
 * 全量 26 个酒馆聊天补全来源精确映射字典（与 SillyTavern public/scripts/openai.js 100% 对齐）
 */
export const API_SOURCES = Object.freeze({
  custom: Object.freeze({
    id: 'custom',
    label: '兼容 OpenAI (中转站 / 通用)',
    shortLabel: '通用接口',
    hint: '各类 API 站子 / 商业中转 / 公益站 / 兼容 OpenAI 接口',
    modelField: 'custom_model',
    modelSelectSelector: '#model_custom_select',
    modelInputSelector: '#custom_model_id',
    urlMode: 'custom_url',
    urlSelector: '#custom_api_url_text',
    urlPlaceholder: 'https://接口或站子地址/v1',
    secretKey: 'api_key_custom',
  }),
  vertexai: Object.freeze({
    id: 'vertexai',
    label: 'Google Vertex AI',
    shortLabel: 'Vertex AI',
    hint: 'Google 云 Vertex 通道：支持 Express API Key 或服务账号 JSON 与区域切换',
    modelField: 'vertexai_model',
    modelSelectSelector: '#model_vertexai_select',
    urlMode: 'reverse_proxy',
    urlSelector: '#openai_reverse_proxy',
    urlPlaceholder: '可选反代地址（官方直连留空即可）',
    secretKey: 'api_key_vertexai',
  }),
  makersuite: Object.freeze({
    id: 'makersuite',
    label: 'Google AI Studio',
    shortLabel: 'AI Studio',
    hint: 'Gemini 官方 AI Studio 密钥直连或原生格式反代',
    modelField: 'google_model',
    modelSelectSelector: '#model_google_select',
    urlMode: 'reverse_proxy',
    urlSelector: '#openai_reverse_proxy',
    urlPlaceholder: '可选反代地址（官方直连留空即可）',
    secretKey: 'api_key_makersuite',
  }),
  claude: Object.freeze({
    id: 'claude',
    label: 'Claude 直连/反代',
    shortLabel: 'Claude',
    hint: 'Anthropic 官方密钥或原生 Claude 格式反代（若是兼容 OpenAI 反代请选第一项「自定义」）',
    modelField: 'claude_model',
    modelSelectSelector: '#model_claude_select',
    urlMode: 'reverse_proxy',
    urlSelector: '#openai_reverse_proxy',
    urlPlaceholder: '可选 Claude 原生反代地址（官方直连留空）',
    secretKey: 'api_key_claude',
  }),
  openrouter: Object.freeze({
    id: 'openrouter',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    hint: 'OpenRouter 官方聚合平台，一键拉取全量模型与搜索',
    modelField: 'openrouter_model',
    modelSelectSelector: '#model_openrouter_select',
    urlMode: 'none',
    secretKey: 'api_key_openrouter',
  }),
  openai: Object.freeze({
    id: 'openai',
    label: 'OpenAI 官方',
    shortLabel: 'OpenAI',
    hint: 'OpenAI 官方接口或原生反代',
    modelField: 'openai_model',
    modelSelectSelector: '#model_openai_select',
    urlMode: 'reverse_proxy',
    urlSelector: '#openai_reverse_proxy',
    urlPlaceholder: '可选反代地址（默认 https://api.openai.com/v1）',
    secretKey: 'api_key_openai',
  }),
  deepseek: Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek 官方',
    shortLabel: 'DeepSeek',
    hint: '深度求索官方 API（deepseek-chat / deepseek-reasoner）',
    modelField: 'deepseek_model',
    modelSelectSelector: '#model_deepseek_select',
    urlMode: 'reverse_proxy',
    urlSelector: '#openai_reverse_proxy',
    urlPlaceholder: '可选反代地址（官方直连留空即可）',
    secretKey: 'api_key_deepseek',
  }),
  siliconflow: Object.freeze({
    id: 'siliconflow',
    label: '硅基流动 (SiliconFlow)',
    shortLabel: '硅基流动',
    hint: 'SiliconFlow 官方模型平台',
    modelField: 'siliconflow_model',
    modelSelectSelector: '#model_siliconflow_select',
    urlMode: 'none',
    secretKey: 'api_key_siliconflow',
  }),
  xai: Object.freeze({
    id: 'xai',
    label: 'xAI Grok',
    shortLabel: 'xAI Grok',
    hint: 'xAI 官方 Grok 系列模型接口',
    modelField: 'xai_model',
    modelSelectSelector: '#model_xai_select',
    urlMode: 'reverse_proxy',
    urlSelector: '#openai_reverse_proxy',
    urlPlaceholder: '可选反代地址（官方直连留空即可）',
    secretKey: 'api_key_xai',
  }),
  moonshot: Object.freeze({
    id: 'moonshot',
    label: '月之暗面 (Kimi)',
    shortLabel: 'Kimi',
    hint: 'Moonshot Kimi 官方接口',
    modelField: 'moonshot_model',
    modelSelectSelector: '#model_moonshot_select',
    urlMode: 'reverse_proxy',
    urlSelector: '#openai_reverse_proxy',
    urlPlaceholder: '可选反代地址（官方直连留空即可）',
    secretKey: 'api_key_moonshot',
  }),
  minimax: Object.freeze({
    id: 'minimax',
    label: 'MiniMax',
    shortLabel: 'MiniMax',
    hint: 'MiniMax 官方对话模型接口',
    modelField: 'minimax_model',
    modelSelectSelector: '#model_minimax_select',
    urlMode: 'none',
    secretKey: 'api_key_minimax',
  }),
  zai: Object.freeze({
    id: 'zai',
    label: '智谱 Z.AI (GLM)',
    shortLabel: '智谱 Z.AI',
    hint: '智谱 GLM / Z.AI 官方接口',
    modelField: 'zai_model',
    modelSelectSelector: '#model_zai_select',
    urlMode: 'reverse_proxy',
    urlSelector: '#openai_reverse_proxy',
    urlPlaceholder: '可选反代地址（官方直连留空即可）',
    secretKey: 'api_key_zai',
  }),
  groq: Object.freeze({
    id: 'groq',
    label: 'Groq',
    shortLabel: 'Groq',
    hint: 'Groq 高速推理接口',
    modelField: 'groq_model',
    modelSelectSelector: '#model_groq_select',
    urlMode: 'none',
    secretKey: 'api_key_groq',
  }),
  nanogpt: Object.freeze({
    id: 'nanogpt',
    label: 'NanoGPT',
    shortLabel: 'NanoGPT',
    hint: 'NanoGPT 聚合模型接口',
    modelField: 'nanogpt_model',
    modelSelectSelector: '#model_nanogpt_select',
    urlMode: 'none',
    secretKey: 'api_key_nanogpt',
  }),
  chutes: Object.freeze({
    id: 'chutes',
    label: 'Chutes',
    shortLabel: 'Chutes',
    hint: 'Chutes AI 模型接口',
    modelField: 'chutes_model',
    modelSelectSelector: '#model_chutes_select',
    urlMode: 'none',
    secretKey: 'api_key_chutes',
  }),
  mistralai: Object.freeze({
    id: 'mistralai',
    label: 'Mistral AI',
    shortLabel: 'Mistral',
    hint: 'Mistral 官方或反代接口',
    modelField: 'mistralai_model',
    modelSelectSelector: '#model_mistralai_select',
    urlMode: 'reverse_proxy',
    urlSelector: '#openai_reverse_proxy',
    urlPlaceholder: '可选反代地址（官方直连留空即可）',
    secretKey: 'api_key_mistralai',
  }),
  cohere: Object.freeze({
    id: 'cohere',
    label: 'Cohere',
    shortLabel: 'Cohere',
    hint: 'Cohere Command 系列接口',
    modelField: 'cohere_model',
    modelSelectSelector: '#model_cohere_select',
    urlMode: 'none',
    secretKey: 'api_key_cohere',
  }),
  perplexity: Object.freeze({
    id: 'perplexity',
    label: 'Perplexity',
    shortLabel: 'Perplexity',
    hint: 'Perplexity Sonar 联网与推理模型',
    modelField: 'perplexity_model',
    modelSelectSelector: '#model_perplexity_select',
    urlMode: 'none',
    secretKey: 'api_key_perplexity',
  }),
  fireworks: Object.freeze({
    id: 'fireworks',
    label: 'Fireworks AI',
    shortLabel: 'Fireworks',
    hint: 'Fireworks Serverless 模型接口',
    modelField: 'fireworks_model',
    modelSelectSelector: '#model_fireworks_select',
    urlMode: 'none',
    secretKey: 'api_key_fireworks',
  }),
  cometapi: Object.freeze({
    id: 'cometapi',
    label: 'CometAPI',
    shortLabel: 'CometAPI',
    hint: 'CometAPI 聚合接口',
    modelField: 'cometapi_model',
    modelSelectSelector: '#model_cometapi_select',
    urlMode: 'none',
    secretKey: 'api_key_cometapi',
  }),
  azure_openai: Object.freeze({
    id: 'azure_openai',
    label: 'Azure OpenAI',
    shortLabel: 'Azure',
    hint: '微软 Azure OpenAI 企业部署端点',
    modelField: 'azure_openai_model',
    modelSelectSelector: '#azure_openai_model',
    urlMode: 'azure_base_url',
    urlSelector: '#azure_base_url',
    urlPlaceholder: 'https://你的资源名.openai.azure.com',
    secretKey: 'api_key_azure_openai',
  }),
  workers_ai: Object.freeze({
    id: 'workers_ai',
    label: 'Cloudflare Workers AI',
    shortLabel: 'Workers AI',
    hint: 'Cloudflare Workers AI 推理接口',
    modelField: 'workers_ai_model',
    modelSelectSelector: '#model_workers_ai_select',
    urlMode: 'none',
    secretKey: 'api_key_workers_ai',
  }),
  pollinations: Object.freeze({
    id: 'pollinations',
    label: 'Pollinations',
    shortLabel: 'Pollinations',
    hint: 'Pollinations 文本生成接口',
    modelField: 'pollinations_model',
    modelSelectSelector: '#model_pollinations_select',
    urlMode: 'none',
    secretKey: 'api_key_pollinations',
  }),
  ai21: Object.freeze({
    id: 'ai21',
    label: 'AI21',
    shortLabel: 'AI21',
    hint: 'AI21 Jamba 系列接口',
    modelField: 'ai21_model',
    modelSelectSelector: '#model_ai21_select',
    urlMode: 'none',
    secretKey: 'api_key_ai21',
  }),
  electronhub: Object.freeze({
    id: 'electronhub',
    label: 'ElectronHub',
    shortLabel: 'ElectronHub',
    hint: 'ElectronHub 聚合接口',
    modelField: 'electronhub_model',
    modelSelectSelector: '#model_electronhub_select',
    urlMode: 'none',
    secretKey: 'api_key_electronhub',
  }),
  aimlapi: Object.freeze({
    id: 'aimlapi',
    label: 'AI/ML API',
    shortLabel: 'AI/ML API',
    hint: 'AI/ML API 聚合接口',
    modelField: 'aimlapi_model',
    modelSelectSelector: '#model_aimlapi_select',
    urlMode: 'none',
    secretKey: 'api_key_aimlapi',
  }),
});

export const POST_PROCESSING_OPTIONS = Object.freeze([
  { id: '', label: '无后处理 (默认)' },
  { id: 'merge', label: '合并同角色消息 (Merge)' },
  { id: 'merge_tools', label: '合并同角色 + 工具调用' },
  { id: 'semi', label: '半严格交替 (Semi-strict)' },
  { id: 'semi_tools', label: '半严格交替 + 工具调用' },
  { id: 'strict', label: '严格交替首条用户 (Strict)' },
  { id: 'strict_tools', label: '严格交替 + 工具调用' },
  { id: 'single', label: '合并为单条用户消息 (Single)' },
]);

/**
 * 酒馆后端 /status 未实现远程列表探测、而是依赖前端静态模型框的来源集合
 */
const STATIC_MODEL_SOURCES = new Set([
  'claude',
  'vertexai',
  'ai21',
  'perplexity',
  'zai',
  'minimax',
]);

const STATIC_FALLBACK_MODELS = Object.freeze({
  claude: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  vertexai: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
  ],
  zai: ['glm-5', 'glm-4.7', 'glm-4.5', 'glm-4-plus'],
  minimax: ['MiniMax-M2.5', 'MiniMax-M2.1', 'MiniMax-Text-01'],
  perplexity: ['sonar-pro', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar'],
  ai21: ['jamba-large', 'jamba-mini'],
});

const SLASH_API_SOURCE_ALIASES = Object.freeze({
  oai: 'openai',
  google: 'makersuite',
});

export function getSourceMeta(source) {
  return API_SOURCES[source] || API_SOURCES.custom;
}

export function resolveSecretKeyForStation(station) {
  const src = station?.source || 'custom';
  return resolveDefaultSecretKey(src, station?.vertexAuthMode || 'express');
}

export function generateStationId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `st_${Date.now().toString(36)}_${rand}`;
}

/**
 * 一键克隆当前站子卡片（方便同一个反代站快速派生不同模型或另一把分组密钥配置）。
 * 默认复用原站子的加密 secretId 与常用收藏模型；若后续在新卡片填入新 Key，writeStationSecret 会生成独立新 UUID 互不覆盖。
 */
export function duplicateApiStation(station, existingStations = []) {
  const base = normalizeApiStation(station || {});
  const usedNames = new Set(
    (Array.isArray(existingStations) ? existingStations : [])
      .map(item => String(item?.name || '').trim())
      .filter(Boolean),
  );
  const stem = base.name.replace(/\s*·\s*副本(?:\s*\d+)?$/, '').trim() || '站子';
  let candidateName = `${stem} · 副本`;
  let seq = 2;
  while (usedNames.has(candidateName)) {
    candidateName = `${stem} · 副本 ${seq}`;
    seq += 1;
  }

  return normalizeApiStation(
    {
      ...base,
      id: generateStationId(),
      name: candidateName,
      favoriteModels: [...(base.favoriteModels || [])],
      cachedModels: [...(base.cachedModels || [])],
    },
    Array.isArray(existingStations) ? existingStations.length : 0,
  );
}

/**
 * 将用户选定的站子卡片设为默认主站并置顶排到第 1 位（纯函数返回新顺序与 defaultStationId）。
 */
export function setPrimaryDefaultStation(stations = [], targetStationId = '') {
  const list = Array.isArray(stations) ? stations.map((st, idx) => normalizeApiStation(st, idx)) : [];
  const targetId = String(targetStationId || '').trim();
  const hit = list.find(st => st.id === targetId);
  if (!hit) {
    return {
      defaultStationId: '',
      stations: list,
    };
  }
  return {
    defaultStationId: hit.id,
    stations: [hit, ...list.filter(st => st.id !== targetId)],
  };
}

/**
 * 生成当前选中站子的单行紧凑状态摘要（日常态默认收起表单时展示，消灭上下重复与大段灰字）。
 */
export function formatStationCompactSummary(station, secStatus = {}) {
  if (!station) return '';
  const meta = getSourceMeta(station.source);
  const parts = [];

  if (station.source === 'vertexai') {
    parts.push(`Vertex AI (${station.vertexRegion || 'global'})`);
  } else {
    parts.push(meta.shortLabel);
  }

  if (station.url) {
    try {
      const parsed = new URL(station.url);
      const cleanHost = (parsed.host || parsed.hostname || '').replace(/^www\./i, '');
      if (cleanHost) parts.push(cleanHost);
    } catch {
      parts.push(station.url.slice(0, 32));
    }
  } else if (station.source === 'custom') {
    parts.push('待填地址');
  }

  if (secStatus?.valid) {
    parts.push(secStatus.maskedValue ? `密钥 ${secStatus.maskedValue}` : '密钥已绑');
  } else if (station.source !== 'pollinations') {
    parts.push('待填密钥');
  }

  if (station.postProcessing) {
    const ppHit = POST_PROCESSING_OPTIONS.find(opt => opt.id === station.postProcessing);
    const shortPp = ppHit ? ppHit.label.replace(/\s*\(.+?\)\s*/g, '') : station.postProcessing;
    parts.push(`后处理:${shortPp}`);
  }

  return parts.join(' · ');
}

/**
 * 判断自定义兼容 OpenAI 地址是否可以提示一键补全 `/v1`。
 * 仅当来源为 `custom`、URL 合法非空、且路径尚未以 `/v1` 或 `/v1/` 结尾时返回 true。
 */
export function needsV1Suffix(rawUrl, source = 'custom') {
  if (source !== 'custom' || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.search || parsed.hash) return false;
    return !/\/v1\/?$/i.test(parsed.pathname || '');
  } catch {
    return false;
  }
}

/**
 * 为自定义地址智能补齐 `/v1` 尾缀（幂等不重复追加）。
 */
export function appendV1Suffix(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (/\/v1$/i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }
  return `${withoutTrailingSlash}/v1`;
}

/**
 * 模糊搜索过滤模型列表：支持空格分隔多词同时命中，前缀/完整子串优先排序。
 */
export function filterModelsByQuery(models = [], query = '') {
  const list = Array.isArray(models) ? models.filter(m => typeof m === 'string' && m.trim()) : [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...list];

  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = [];

  for (const modelId of list) {
    const lower = modelId.toLowerCase();
    if (!tokens.every(tok => lower.includes(tok))) continue;
    let score = 0;
    if (lower === q) score = 300;
    else if (lower.startsWith(q)) score = 200;
    else if (lower.includes(q)) score = 100;
    else if (tokens[0] && lower.startsWith(tokens[0])) score = 50;
    scored.push({ modelId, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(item => item.modelId);
}

/**
 * 切换某个模型在当前站子收藏胶囊中的存在状态（纯函数）。
 */
export function toggleFavoriteModel(favoriteModels = [], modelId = '') {
  const target = String(modelId || '').trim();
  const base = Array.isArray(favoriteModels)
    ? favoriteModels.map(x => String(x || '').trim()).filter(Boolean)
    : [];
  if (!target) return [...new Set(base)];
  if (base.includes(target)) {
    return base.filter(x => x !== target);
  }
  return [...new Set([...base, target])];
}

/**
 * 从酒馆 chatCompletionSettings (oai_settings) 读取指定来源当前配置的模型名。
 */
export function getHostModelForSource(oaiSettings = {}, source = 'custom') {
  const meta = getSourceMeta(source);
  const val = oaiSettings?.[meta.modelField];
  if (typeof val !== 'string') return '';
  if (source === 'openrouter' && val === 'OR_Website') return '';
  return val.trim();
}

/**
 * 从酒馆 chatCompletionSettings 读取指定来源当前生效的地址或反代 URL。
 */
export function getHostUrlForSource(oaiSettings = {}, source = 'custom') {
  const meta = getSourceMeta(source);
  if (meta.urlMode === 'custom_url') {
    return sanitizeEndpointUrl(oaiSettings?.custom_url || '');
  }
  if (meta.urlMode === 'azure_base_url') {
    return sanitizeEndpointUrl(oaiSettings?.azure_base_url || '');
  }
  if (meta.urlMode === 'reverse_proxy') {
    return sanitizeEndpointUrl(oaiSettings?.reverse_proxy || '');
  }
  return '';
}

function resolveEndpointHref(apiPath) {
  const clean = String(apiPath || '').replace(/^\/+/, '');
  const base = globalThis.document?.baseURI;
  if (base && /^https?:\/\//i.test(base)) {
    try {
      return new URL(clean, base).href;
    } catch {
      // fall through
    }
  }
  return `/${clean}`;
}

async function tryRefreshNativeSecretsMemory() {
  const base = globalThis.document?.baseURI;
  if (!base || !/^https?:\/\//i.test(base)) return;
  try {
    const secretsMod = await import(new URL('scripts/secrets.js', base).href);
    if (typeof secretsMod?.readSecretState === 'function') {
      await secretsMod.readSecretState();
    }
  } catch {
    // 离线测试或部分宿主版本忽略即可
  }
}

/**
 * 判断当前酒馆 `/api/secrets/read` 返回值是否为低于 1.13.1 的旧版布尔字典（如 `{ api_key_custom: true }`）。
 */
export function isLegacySecretsMap(secretsMap) {
  if (!secretsMap || typeof secretsMap !== 'object') return false;
  const values = Object.values(secretsMap);
  if (values.length === 0) return false;
  return values.some(val => typeof val === 'boolean') && !values.some(val => Array.isArray(val));
}

/**
 * 读取酒馆加密密钥状态字典 (`POST /api/secrets/read`)。
 */
export async function readSecretsMap({ getContext, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') return {};
  try {
    const ctx = getContext?.();
    const headers =
      typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders({ omitContentType: true })
        : {};
    const res = await fetchImpl(resolveEndpointHref('api/secrets/read'), {
      method: 'POST',
      headers,
    });
    if (!res?.ok) return {};
    const data = await res.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/**
 * 将新输入的密钥安全写入酒馆原生加密保险箱 (`POST /api/secrets/write`)，返回生成的专属 secretId。
 * 温和兼容低于 1.13.1 的旧版酒馆（HTTP 200 纯文本响应、无多密钥 UUID）。
 */
export async function writeStationSecret({
  key,
  value,
  label,
  getContext,
  fetchImpl = globalThis.fetch,
  syncNativeMemory = true,
} = {}) {
  const cleanVal = String(value || '').trim();
  if (!key || !cleanVal || typeof fetchImpl !== 'function') {
    return null;
  }

  const cleanLabel = String(label || 'ST伴侣站子').trim().slice(0, 80) || 'ST伴侣站子';
  const ctx = getContext?.();
  const headers =
    typeof ctx?.getRequestHeaders === 'function'
      ? ctx.getRequestHeaders()
      : { 'Content-Type': 'application/json' };

  const res = await fetchImpl(resolveEndpointHref('api/secrets/write'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ key, value: cleanVal, label: cleanLabel }),
  });

  if (!res?.ok) {
    throw new Error(`密钥保存失败 (HTTP ${res?.status || 'ERR'})`);
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  if (!id && payload !== null && typeof payload === 'object') {
    throw new Error('酒馆未返回有效的密钥 ID');
  }

  if (syncNativeMemory) {
    await tryRefreshNativeSecretsMemory();
  }

  return id
    ? { id, label: cleanLabel }
    : { id: '', label: cleanLabel, legacySingleKey: true };
}

/**
 * 切换酒馆指定来源下当前激活的密钥 ID (`POST /api/secrets/rotate`)。
 * 旧版酒馆 (`< 1.13.1`) 无 `/api/secrets/rotate` 端点返回 `404` 时静默返回 `false`，保持布尔返回约定不变。
 */
export async function rotateStationSecret({
  key,
  id,
  getContext,
  fetchImpl = globalThis.fetch,
  syncNativeMemory = true,
} = {}) {
  if (!key || !id || typeof fetchImpl !== 'function') return false;
  try {
    const ctx = getContext?.();
    const headers =
      typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };

    const res = await fetchImpl(resolveEndpointHref('api/secrets/rotate'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ key, id }),
    });

    if (!res?.ok) return false;
    if (syncNativeMemory) {
      await tryRefreshNativeSecretsMemory();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验某张站子卡片的密钥绑定状态（用于面板实时徽章展示）。
 * 温和兼容低于 1.13.1 的旧版酒馆布尔型 `secretsMap`（如 `{ api_key_custom: true }`）。
 */
export function inspectStationSecretStatus(station, secretsMap = {}) {
  const secretKeyType = resolveSecretKeyForStation(station);
  const rawEntry = secretsMap?.[secretKeyType];

  if (rawEntry === true) {
    return {
      secretKeyType,
      bound: false,
      valid: true,
      active: true,
      missing: false,
      inherited: true,
      legacySingleKey: true,
      secretId: '',
      label: '',
      maskedValue: '',
      statusText: '已存密钥（当前酒馆低于 1.13.1，同类站子共用单密钥）',
    };
  }

  if (rawEntry === false && isLegacySecretsMap(secretsMap)) {
    return {
      secretKeyType,
      bound: false,
      valid: false,
      active: false,
      missing: false,
      inherited: false,
      legacySingleKey: true,
      secretId: '',
      label: '',
      maskedValue: '',
      statusText: '未绑定密钥',
    };
  }

  const list = Array.isArray(rawEntry) ? rawEntry : [];

  if (station?.secretId) {
    const matched = list.find(item => item && item.id === station.secretId);
    if (matched) {
      const label = matched.label || station.secretLabel || '专属密钥';
      const masked = matched.value ? ` (${matched.value})` : '';
      return {
        secretKeyType,
        bound: true,
        valid: true,
        active: Boolean(matched.active),
        missing: false,
        inherited: false,
        secretId: matched.id,
        label,
        maskedValue: matched.value || '',
        statusText: `已绑定专属密钥：${label}${masked}`,
      };
    }
    return {
      secretKeyType,
      bound: false,
      valid: false,
      active: false,
      missing: true,
      inherited: false,
      secretId: station.secretId,
      label: station.secretLabel || '',
      maskedValue: '',
      statusText: '原绑定密钥已在酒馆中移除，请重新填入密钥',
    };
  }

  const activeFallback = list.find(item => item?.active) || list[0] || null;
  if (activeFallback) {
    const label = activeFallback.label || activeFallback.value || '已存密钥';
    return {
      secretKeyType,
      bound: false,
      valid: true,
      active: Boolean(activeFallback.active),
      missing: false,
      inherited: true,
      secretId: activeFallback.id || '',
      label: activeFallback.label || '',
      maskedValue: activeFallback.value || '',
      statusText: `复用酒馆当前密钥：${label}`,
    };
  }

  return {
    secretKeyType,
    bound: false,
    valid: false,
    active: false,
    missing: false,
    inherited: false,
    secretId: '',
    label: '',
    maskedValue: '',
    statusText: '未绑定密钥',
  };
}

function findSecretMetaById(secretsMap, secretId) {
  if (!secretId || !secretsMap || typeof secretsMap !== 'object') return null;
  for (const [keyType, entries] of Object.entries(secretsMap)) {
    if (!Array.isArray(entries)) continue;
    const hit = entries.find(item => item?.id === secretId);
    if (hit) {
      return { keyType, id: hit.id, label: hit.label || '' };
    }
  }
  return null;
}

export function guessFriendlyStationName(source, url, fallbackLabel = '') {
  const meta = getSourceMeta(source);
  if (fallbackLabel && !/^\d{1,4}[/-]\d{1,2}/.test(fallbackLabel)) {
    return fallbackLabel.slice(0, 40);
  }
  if (url) {
    try {
      const parsed = new URL(url);
      const host = (parsed.host || parsed.hostname || '').replace(/^www\./i, '');
      if (host) {
        return (source === 'custom' ? host : `${meta.shortLabel} · ${host}`).slice(0, 40);
      }
    } catch {
      // ignore
    }
  }
  return meta.shortLabel;
}

/**
 * 从酒馆当前生效的 `ctx.chatCompletionSettings` 生成一张站子卡片。
 */
export function buildStationFromCurrentHost(ctx, secretsMap = {}) {
  const oai = ctx?.chatCompletionSettings || {};
  const rawSource = typeof oai.chat_completion_source === 'string' ? oai.chat_completion_source.trim() : 'custom';
  const source = API_SOURCES[rawSource] ? rawSource : 'custom';
  const vertexAuthMode = oai.vertexai_auth_mode === 'full' ? 'full' : 'express';
  const secretKeyType = resolveDefaultSecretKey(source, vertexAuthMode);
  const url = getHostUrlForSource(oai, source);
  const model = getHostModelForSource(oai, source);

  const secretEntries = Array.isArray(secretsMap?.[secretKeyType]) ? secretsMap[secretKeyType] : [];
  const activeSecret = secretEntries.find(item => item?.active) || secretEntries[0] || null;

  return normalizeApiStation({
    id: generateStationId(),
    name: guessFriendlyStationName(source, url, activeSecret?.label || ''),
    source,
    url,
    secretKeyType,
    secretId: activeSecret?.id || '',
    secretLabel: activeSecret?.label || '',
    model,
    favoriteModels: model ? [model] : [],
    cachedModels: [],
    postProcessing: oai.custom_prompt_post_processing || '',
    vertexAuthMode,
    vertexRegion: oai.vertexai_region || 'global',
    vertexProjectId: oai.vertexai_express_project_id || '',
  });
}

function resolveProfileChatSource(profileApi, ctx) {
  const key = String(profileApi || '').trim().toLowerCase();
  if (!key) return null;
  const fromHostMap = ctx?.CONNECT_API_MAP?.[key];
  if (fromHostMap) {
    if (fromHostMap.selected === 'openai' && fromHostMap.source && API_SOURCES[fromHostMap.source]) {
      return fromHostMap.source;
    }
    return null;
  }
  const aliased = SLASH_API_SOURCE_ALIASES[key] || key;
  return API_SOURCES[aliased] ? aliased : null;
}

/**
 * 从酒馆原生 `extensionSettings.connectionManager.profiles` 提取所有聊天补全配置（保留 secret-id）。
 */
export function extractStationsFromConnectionProfiles(ctx, secretsMap = {}) {
  const profiles = ctx?.extensionSettings?.connectionManager?.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) return [];

  const proxies = Array.isArray(ctx?.chatCompletionSettings?.proxies)
    ? ctx.chatCompletionSettings.proxies
    : [];
  const extracted = [];

  for (let i = 0; i < profiles.length; i += 1) {
    const p = profiles[i];
    if (!p || typeof p !== 'object') continue;
    if (p.mode && p.mode !== 'cc') continue;

    const source = resolveProfileChatSource(p.api, ctx);
    if (!source) continue;

    let url = typeof p['api-url'] === 'string' ? p['api-url'].trim() : '';
    if (!url && typeof p.proxy === 'string' && p.proxy.trim()) {
      const matchedProxy = proxies.find(pr => pr && pr.name === p.proxy);
      if (matchedProxy?.url) {
        url = String(matchedProxy.url).trim();
      }
    }

    const secretId = typeof p['secret-id'] === 'string' ? p['secret-id'].trim() : '';
    const secretHit = findSecretMetaById(secretsMap, secretId);
    const model = typeof p.model === 'string' ? p.model.trim() : '';

    extracted.push(
      normalizeApiStation(
        {
          id: `cm_${String(p.id || i + 1).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`,
          name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : guessFriendlyStationName(source, url),
          source,
          url,
          secretKeyType: secretHit?.keyType || resolveDefaultSecretKey(source, 'express'),
          secretId,
          secretLabel: secretHit?.label || '',
          model,
          favoriteModels: model ? [model] : [],
          postProcessing: typeof p['prompt-post-processing'] === 'string' ? p['prompt-post-processing'] : '',
        },
        i,
      ),
    );
  }

  return extracted;
}

function stationFingerprint(st) {
  return `${st.source}|${(st.url || '').replace(/\/+$/, '').toLowerCase()}|${st.secretId || ''}`;
}

/**
 * 首次智能接管或增量导入酒馆已有连接：
 * - 若现有 `existingStations` 为空，优先接管当前活跃设置，并合并导入 `connectionManager.profiles`；
 * - 若已有站子，则增量合并不重复的新配置（不覆盖用户已编辑的站子）。
 */
export function mergeImportedStations({ existingStations = [], ctx, secretsMap = {} } = {}) {
  const nextList = existingStations.map((st, idx) => normalizeApiStation(st, idx));
  const seenIds = new Set(nextList.map(st => st.id));
  const seenPrints = new Set(nextList.map(stationFingerprint));
  let addedCount = 0;

  const tryPush = candidate => {
    if (!candidate) return;
    const fp = stationFingerprint(candidate);
    if (seenIds.has(candidate.id) || seenPrints.has(fp)) return;
    seenIds.add(candidate.id);
    seenPrints.add(fp);
    nextList.push(candidate);
    addedCount += 1;
  };

  // 当前宿主连接始终作为首优候选
  const currentHostStation = buildStationFromCurrentHost(ctx, secretsMap);
  tryPush(currentHostStation);

  // 合并原生 Connection Manager 里的聊天补全档案
  const cmStations = extractStationsFromConnectionProfiles(ctx, secretsMap);
  for (const item of cmStations) {
    tryPush(item);
  }

  return {
    stations: nextList,
    addedCount,
    currentHostStation,
  };
}

function dispatchDomEvent(el, eventName, root = globalThis) {
  if (!el || typeof el.dispatchEvent !== 'function') return;
  const EventCtor = root?.Event || globalThis.Event;
  if (typeof EventCtor === 'function') {
    el.dispatchEvent(new EventCtor(eventName, { bubbles: true }));
  }
}

function ensureSelectOptionAndValue(doc, selectEl, value, root = globalThis) {
  if (!selectEl) return false;
  const strVal = String(value ?? '');
  if (strVal) {
    const options = Array.from(selectEl.options || []);
    const exists = options.some(opt => opt.value === strVal);
    if (!exists && doc && typeof doc.createElement === 'function') {
      const opt = doc.createElement('option');
      opt.value = strVal;
      opt.textContent = strVal;
      if (typeof selectEl.appendChild === 'function') {
        selectEl.appendChild(opt);
      } else if (Array.isArray(selectEl.options)) {
        selectEl.options.push(opt);
      }
    }
  }
  const changed = selectEl.value !== strVal;
  selectEl.value = strVal;
  if (changed) {
    dispatchDomEvent(selectEl, 'change', root);
  }
  return changed;
}

const STM_HOST_PROXY_PREFIX = '[ST伴侣] ';

export function buildHostProxyPresetName(stationId) {
  return `${STM_HOST_PROXY_PREFIX}${String(stationId || '').trim()}`;
}

function findMatchingHostProxyPassword(oai, station) {
  if (!oai || !station?.url || !Array.isArray(oai.proxies)) return null;
  const exactName = buildHostProxyPresetName(station.id);
  const byId = oai.proxies.find(item => item && item.name === exactName);
  if (byId && typeof byId.password === 'string') {
    return byId.password;
  }
  const cleanTargetUrl = station.url.replace(/\/+$/, '').toLowerCase();
  const byUrl = oai.proxies.find(
    item =>
      item &&
      typeof item.url === 'string' &&
      item.url.trim().replace(/\/+$/, '').toLowerCase() === cleanTargetUrl &&
      typeof item.password === 'string' &&
      item.password.length > 0,
  );
  return byUrl ? byUrl.password : null;
}

/**
 * 酒馆底层 `chat-completions.js` 在 `reverse_proxy` 非空时不读取 `secrets.json`，而只读取 `oai_settings.proxy_password`。
 * 为使 Claude / AI Studio / Vertex / DeepSeek 等原生格式反代 100% 通畅且不在 `st_mate` 落盘任何明文，
 * 将反代凭据同步维护在酒馆原生自身的 `oai_settings.proxies` 槽位中，切站子时自动还原对应的 `proxy_password`。
 */
export function syncReverseProxyCredentialToHost(
  station,
  rawSecret,
  { getContext, doc = globalThis.document, root = globalThis } = {},
) {
  const cleanVal = String(rawSecret || '').trim();
  const meta = getSourceMeta(station?.source);
  if (!station || meta.urlMode !== 'reverse_proxy' || !station.url || !cleanVal) {
    return false;
  }
  const ctx = getContext?.();
  const oai = ctx?.chatCompletionSettings;
  if (!oai || typeof oai !== 'object') return false;

  if (!Array.isArray(oai.proxies)) {
    oai.proxies = [{ name: 'None', url: '', password: '' }];
  }
  const slotName = buildHostProxyPresetName(station.id);
  const existingIdx = oai.proxies.findIndex(item => item && item.name === slotName);
  const nextEntry = { name: slotName, url: station.url, password: cleanVal };
  if (existingIdx >= 0) {
    oai.proxies[existingIdx] = nextEntry;
  } else {
    oai.proxies.push(nextEntry);
  }
  oai.proxy_password = cleanVal;

  const proxyPwdInput = doc?.getElementById?.('openai_proxy_access_key');
  if (proxyPwdInput && proxyPwdInput.value !== cleanVal) {
    proxyPwdInput.value = cleanVal;
    dispatchDomEvent(proxyPwdInput, 'input', root);
  }
  ctx?.saveSettingsDebounced?.();
  return true;
}

/**
 * 将站子配置精准同步到酒馆 `ctx.chatCompletionSettings` 与对应原生表单节点。
 * 铁律：
 * 1. 严禁修改 `preset_settings_openai` 或触发 `#settings_preset_openai` 预设切换；
 * 2. 先锁死 URL 与目标模型字段，再按需触发 `#chat_completion_source` change，最后二次补齐 `<option>` 并复核模型与地址，
 *    确保原生 `toggleChatCompletionForms` / `getStatusOpen` 绝不会吞空或覆盖刚设置的 `custom_url` 与 `custom_model`。
 */
export function applyStationToHost(station, { getContext, doc = globalThis.document, root = globalThis } = {}) {
  if (!station) return false;
  const ctx = getContext?.();
  const oai = ctx?.chatCompletionSettings;
  const meta = getSourceMeta(station.source);
  const preservedPreset = oai ? oai.preset_settings_openai : undefined;
  const targetUrl = station.url || '';
  const targetModel = String(station.model || '').trim();

  // 1. 确保主 API 切至聊天补全 ('openai')
  const mainApiSelect = doc?.getElementById?.('main_api');
  if (mainApiSelect && mainApiSelect.value !== 'openai') {
    ensureSelectOptionAndValue(doc, mainApiSelect, 'openai', root);
  }

  // 2. 先写入地址、反代密码槽、Vertex 参数、后处理与目标模型字段（确保后续 source change 读取到新值）
  let matchedProxyPwd = null;
  if (oai && typeof oai === 'object') {
    if (meta.urlMode === 'custom_url') {
      oai.custom_url = targetUrl;
    } else if (meta.urlMode === 'azure_base_url') {
      oai.azure_base_url = targetUrl;
    } else if (meta.urlMode === 'reverse_proxy') {
      oai.reverse_proxy = targetUrl;
      if (targetUrl) {
        matchedProxyPwd = findMatchingHostProxyPassword(oai, station);
        if (matchedProxyPwd !== null) {
          oai.proxy_password = matchedProxyPwd;
        }
      }
    }

    if (station.source === 'vertexai') {
      oai.vertexai_auth_mode = station.vertexAuthMode || 'express';
      oai.vertexai_region = station.vertexRegion || 'global';
      oai.vertexai_express_project_id = station.vertexProjectId || '';
    }

    oai.custom_prompt_post_processing = station.postProcessing || '';
    oai[meta.modelField] = targetModel;
  }

  // 同步 URL 与反代密码输入框 DOM
  if (meta.urlSelector && doc?.querySelector) {
    const urlInput = doc.querySelector(meta.urlSelector);
    if (urlInput && urlInput.value !== targetUrl) {
      urlInput.value = targetUrl;
      dispatchDomEvent(urlInput, 'input', root);
    }
  }
  if (meta.urlMode === 'reverse_proxy' && matchedProxyPwd !== null && doc?.getElementById) {
    const proxyPwdInput = doc.getElementById('openai_proxy_access_key');
    if (proxyPwdInput && proxyPwdInput.value !== matchedProxyPwd) {
      proxyPwdInput.value = matchedProxyPwd;
      dispatchDomEvent(proxyPwdInput, 'input', root);
    }
  }

  // 同步 Vertex AI 原生控件 DOM
  if (station.source === 'vertexai' && doc?.getElementById) {
    const authSelect = doc.getElementById('vertexai_auth_mode');
    if (authSelect) {
      ensureSelectOptionAndValue(doc, authSelect, station.vertexAuthMode || 'express', root);
    }
    const regionInput = doc.getElementById('vertexai_region');
    if (regionInput && regionInput.value !== (station.vertexRegion || 'global')) {
      regionInput.value = station.vertexRegion || 'global';
      dispatchDomEvent(regionInput, 'input', root);
    }
    const projInput = doc.getElementById('vertexai_express_project_id');
    if (projInput && projInput.value !== (station.vertexProjectId || '')) {
      projInput.value = station.vertexProjectId || '';
      dispatchDomEvent(projInput, 'input', root);
    }
  }

  // 预先把 option 补入模型下拉框（不抢先触发旧来源冲突，供 source change 内部 toggleChatCompletionForms 直接命中）
  if (meta.modelSelectSelector && doc?.querySelector && targetModel) {
    const preSelect = doc.querySelector(meta.modelSelectSelector);
    if (preSelect) {
      const options = Array.from(preSelect.options || []);
      if (!options.some(opt => opt.value === targetModel) && typeof doc.createElement === 'function') {
        const opt = doc.createElement('option');
        opt.value = targetModel;
        opt.textContent = targetModel;
        if (typeof preSelect.appendChild === 'function') preSelect.appendChild(opt);
        else if (Array.isArray(preSelect.options)) preSelect.options.push(opt);
      }
      preSelect.value = targetModel;
    }
  }

  // 3. 同步聊天补全来源（跨来源切换时原生监听器可能清空 .model_custom_select，由第 4 步立即补回）
  if (oai && typeof oai === 'object') {
    oai.chat_completion_source = station.source;
  }
  const sourceSelect = doc?.getElementById?.('chat_completion_source');
  if (sourceSelect && sourceSelect.value !== station.source) {
    ensureSelectOptionAndValue(doc, sourceSelect, station.source, root);
  }

  // 4. 同步对应来源模型（若原生 <select> 无该 option 或刚被 source change 清空，动态补齐再设值，防吞空！）
  if (meta.modelSelectSelector && doc?.querySelector && targetModel) {
    const modelSelect = doc.querySelector(meta.modelSelectSelector);
    if (modelSelect) {
      ensureSelectOptionAndValue(doc, modelSelect, targetModel, root);
    }
  }
  if (meta.modelInputSelector && doc?.querySelector) {
    const modelInput = doc.querySelector(meta.modelInputSelector);
    if (modelInput && modelInput.value !== targetModel) {
      modelInput.value = targetModel;
      dispatchDomEvent(modelInput, 'input', root);
    }
  }
  // 二次强制锁死 oai_settings[modelField] 与 URL 字段，彻底免疫原生异步/同步回写覆盖
  if (oai && typeof oai === 'object') {
    oai[meta.modelField] = targetModel;
    if (meta.urlMode === 'custom_url') oai.custom_url = targetUrl;
    else if (meta.urlMode === 'azure_base_url') oai.azure_base_url = targetUrl;
    else if (meta.urlMode === 'reverse_proxy') oai.reverse_proxy = targetUrl;
  }

  // 5. 同步消息后处理下拉框
  const ppSelect = doc?.getElementById?.('custom_prompt_post_processing');
  if (ppSelect) {
    ensureSelectOptionAndValue(doc, ppSelect, station.postProcessing || '', root);
  }

  // 6. 守护预设字段绝不被改动，并防抖持久化
  if (oai && preservedPreset !== undefined && oai.preset_settings_openai !== preservedPreset) {
    oai.preset_settings_openai = preservedPreset;
  }
  ctx?.saveSettingsDebounced?.();
  return true;
}

function readStaticModelsFromDomOrFallback(source, doc = globalThis.document) {
  const meta = getSourceMeta(source);
  const selectEl = meta.modelSelectSelector ? doc?.querySelector?.(meta.modelSelectSelector) : null;
  if (selectEl && selectEl.options && selectEl.options.length > 0) {
    const domModels = Array.from(selectEl.options)
      .map(opt => String(opt?.value || '').trim())
      .filter(v => v && v !== 'OR_Website');
    if (domModels.length > 0) {
      return [...new Set(domModels)];
    }
  }
  return [...(STATIC_FALLBACK_MODELS[source] || [])];
}

function populateHostModelSelectOptions(source, models, selectedModel, doc = globalThis.document) {
  if (!doc || !Array.isArray(models) || models.length === 0) return;
  const meta = getSourceMeta(source);
  const selectEl = meta.modelSelectSelector ? doc.querySelector?.(meta.modelSelectSelector) : null;
  if (!selectEl || typeof doc.createElement !== 'function') return;

  const existingValues = new Set(Array.from(selectEl.options || []).map(o => o.value));
  for (const id of models) {
    if (!id || existingValues.has(id)) continue;
    const opt = doc.createElement('option');
    opt.value = id;
    opt.textContent = id;
    selectEl.appendChild?.(opt);
    existingValues.add(id);
  }
  if (selectedModel && existingValues.has(selectedModel)) {
    selectEl.value = selectedModel;
  }
}

/**
 * 构造 `/api/backends/chat-completions/status` 请求体（与酒馆 openai.js 保持一致）。
 */
export function buildStatusRequestBody(station, oaiSettings = {}) {
  const meta = getSourceMeta(station?.source);
  const matchedProxyPwd =
    meta.urlMode === 'reverse_proxy' && station?.url
      ? findMatchingHostProxyPassword(oaiSettings, station)
      : null;
  const body = {
    chat_completion_source: station.source,
    reverse_proxy: meta.urlMode === 'reverse_proxy' ? station.url || '' : '',
    proxy_password: matchedProxyPwd !== null ? matchedProxyPwd : oaiSettings?.proxy_password || '',
  };

  if (station.secretId) {
    body.secret_id = station.secretId;
  }
  if (station.source === 'custom') {
    body.custom_url = station.url || '';
    body.custom_include_headers = oaiSettings?.custom_include_headers || '';
  } else if (station.source === 'azure_openai') {
    body.azure_base_url = station.url || oaiSettings?.azure_base_url || '';
    body.azure_deployment_name = oaiSettings?.azure_deployment_name || '';
    body.azure_api_version = oaiSettings?.azure_api_version || '';
  } else if (station.source === 'siliconflow') {
    body.siliconflow_endpoint = oaiSettings?.siliconflow_endpoint || 'cn';
  } else if (station.source === 'minimax') {
    body.minimax_endpoint = oaiSettings?.minimax_endpoint || 'cn';
  } else if (station.source === 'workers_ai') {
    body.workers_ai_account_id = oaiSettings?.workers_ai_account_id || '';
  } else if (station.source === 'pollinations') {
    body.pollinations_endpoint = oaiSettings?.pollinations_endpoint || 'authenticated';
  }

  return body;
}

/**
 * 拉取当前站子的可用模型列表并检测连接状态。
 */
export async function fetchStationModels(
  station,
  {
    getContext,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
    syncHostSelect = true,
    secretsMap = null,
  } = {},
) {
  if (!station) {
    return { ok: false, models: [], message: '未选择站子卡片' };
  }

  if (station.source === 'custom' && !sanitizeEndpointUrl(station.url)) {
    return { ok: false, models: [], message: '请先填写有效的 http(s) 接口地址' };
  }

  // 针对酒馆后端不提供远程 /status 列表的 6 个内置模型来源，直接读取宿主内置模型表
  if (STATIC_MODEL_SOURCES.has(station.source)) {
    const presetModels = readStaticModelsFromDomOrFallback(station.source, doc);
    return {
      ok: true,
      bypassed: true,
      models: presetModels,
      message:
        presetModels.length > 0
          ? `连接就绪 · 已载入 ${presetModels.length} 个内置可选模型`
          : '连接就绪（可直接手输模型名称）',
    };
  }

  if (typeof fetchImpl !== 'function') {
    return { ok: false, models: [], message: '当前环境不支持网络请求' };
  }

  try {
    const ctx = getContext?.();
    const headers =
      typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };

    let effectiveStation = station;
    if (!station.secretId && secretsMap && typeof secretsMap === 'object') {
      const secStatus = inspectStationSecretStatus(station, secretsMap);
      if (secStatus.secretId) {
        effectiveStation = { ...station, secretId: secStatus.secretId };
      }
    }
    const reqBody = buildStatusRequestBody(effectiveStation, ctx?.chatCompletionSettings);

    const res = await fetchImpl(resolveEndpointHref('api/backends/chat-completions/status'), {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
      cache: 'no-cache',
    });

    if (!res?.ok) {
      return {
        ok: false,
        models: [],
        message: `连接失败 (HTTP ${res?.status || 'ERR'})，请检查地址或密钥`,
      };
    }

    const payload = await res.json();
    const rawArr = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.data?.data)
        ? payload.data.data
        : [];

    const models = [];
    const seen = new Set();
    for (const item of rawArr) {
      const id = typeof item === 'string' ? item.trim() : typeof item?.id === 'string' ? item.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push(id);
    }

    if (payload?.error && models.length === 0) {
      if (payload?.bypass || station.source === 'custom') {
        return {
          ok: true,
          bypassed: true,
          models: [],
          message: '接口未公开 /models 列表，可直接手输模型名称对话',
        };
      }
      return {
        ok: false,
        models: [],
        message: payload?.message || '连接校验未通过，请检查地址或密钥是否正确',
      };
    }

    if (syncHostSelect) {
      populateHostModelSelectOptions(station.source, models, station.model, doc);
    }

    return {
      ok: true,
      bypassed: Boolean(payload?.bypass),
      models,
      message:
        models.length > 0
          ? `已连接 · 发现 ${models.length} 个可用模型`
          : '连接就绪（可直接手输模型名称）',
    };
  } catch (err) {
    return {
      ok: false,
      models: [],
      message: `连接失败，请检查接口地址或网络 (${err?.message || '网络异常'})`,
    };
  }
}

/**
 * 判断模型在原生或反代渠道下是否禁传 `temperature` 采样参数（对齐酒馆 chat-completions.js 最新列表）。
 */
export function isTemperatureUnsupportedModel(model = '') {
  const clean = String(model || '').trim();
  if (!clean) return false;
  return (
    /(?:^|\/)o[134](?:-|$)/i.test(clean) ||
    /claude-(?:fable|opus-4-[78]|opus-5|sonnet-5)/i.test(clean) ||
    /gemini-3\.(?:[67]-flash|5-flash-lite)/i.test(clean)
  );
}

/**
 * 构造真实最小对话测活请求体（对接 `/api/backends/chat-completions/generate`，零污染当前角色聊天记录）。
 */
export function buildProbeGenerateBody(station, oaiSettings = {}) {
  const meta = getSourceMeta(station?.source);
  const model = String(station?.model || '').trim();
  const body = {
    type: 'quiet',
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    model,
    max_tokens: 16,
    stream: false,
    chat_completion_source: station.source,
    custom_prompt_post_processing: station.postProcessing || '',
  };

  // o1/o3/o4、Claude Opus 4.7+/5/Fable 及部分 Gemini 3 Flash 拒绝采样温度参数，其余渠道统一传温和合法值 1（兼容 MiniMax 禁 0 约束）
  if (!isTemperatureUnsupportedModel(model)) {
    body.temperature = 1;
  }

  if (station.secretId) {
    body.secret_id = station.secretId;
  }

  if (meta.urlMode === 'reverse_proxy' && station.url) {
    body.reverse_proxy = station.url;
    body.proxy_password = oaiSettings?.proxy_password || '';
  }

  if (station.source === 'custom') {
    body.custom_url = station.url || '';
    body.custom_include_headers = oaiSettings?.custom_include_headers || '';
    body.custom_include_body = oaiSettings?.custom_include_body || '';
    body.custom_exclude_body = oaiSettings?.custom_exclude_body || '';
  } else if (station.source === 'vertexai') {
    body.vertexai_auth_mode = station.vertexAuthMode || 'express';
    body.vertexai_region = station.vertexRegion || 'global';
    body.vertexai_express_project_id = station.vertexProjectId || '';
    body.use_sysprompt = Boolean(oaiSettings?.use_sysprompt);
  } else if (station.source === 'makersuite' || station.source === 'claude') {
    body.use_sysprompt = Boolean(oaiSettings?.use_sysprompt);
  } else if (station.source === 'azure_openai') {
    body.azure_base_url = station.url || oaiSettings?.azure_base_url || '';
    body.azure_deployment_name = oaiSettings?.azure_deployment_name || '';
    body.azure_api_version = oaiSettings?.azure_api_version || '';
  } else if (station.source === 'siliconflow') {
    body.siliconflow_endpoint = oaiSettings?.siliconflow_endpoint || 'cn';
  } else if (station.source === 'minimax') {
    body.minimax_endpoint = oaiSettings?.minimax_endpoint || 'cn';
  } else if (station.source === 'zai') {
    body.zai_endpoint = oaiSettings?.zai_endpoint || 'common';
    body.top_p = 0.9;
  } else if (station.source === 'pollinations') {
    body.pollinations_endpoint = oaiSettings?.pollinations_endpoint || 'authenticated';
  } else if (station.source === 'workers_ai') {
    body.workers_ai_account_id = oaiSettings?.workers_ai_account_id || '';
  } else if (station.source === 'nanogpt') {
    body.nanogpt_provider = oaiSettings?.nanogpt_provider || '';
  }

  return body;
}

function extractProbeErrorDetail(payload, rawText = '') {
  const candidates = [
    payload?.error?.message,
    payload?.message,
    typeof payload?.error === 'string' ? payload.error : '',
    rawText,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && c.trim() !== 'true') {
      const clean = c.replace(/\s+/g, ' ').trim();
      if (!clean.startsWith('<!DOCTYPE') && !clean.startsWith('<html')) {
        return clean.slice(0, 90);
      }
    }
  }
  return '';
}

/**
 * 对齐酒馆后端 `chat-completions.js` 全量 26 渠道在 `stream: false` 下的真实响应结构：
 * - 优先解析顶层 `payload.content`（修复酒馆后端 `sendClaudeRequest` 在 Extended Thinking 下 `choices[0].message.content` 为空串的包装盲区）；
 * - 完整兼容 OpenAI 字符串/分段数组（含 Mistral thinking 数组）、DeepSeek/OpenRouter/xAI `reasoning_content`、
 *   Gemini/Vertex `candidates[0].content.parts` / `responseContent.parts`（过滤 `thought: true`）、Cohere V2 `message.content` 及 Workers AI 等网关格式。
 */
export function extractCompletionPayload(payload) {
  if (typeof payload === 'string') {
    return { text: payload, reasoningText: '' };
  }
  if (!payload || typeof payload !== 'object') {
    return { text: '', reasoningText: '' };
  }

  const reasoningParts = [];
  const pushReasoning = val => {
    if (typeof val === 'string' && val.trim()) {
      const trimmed = val.trim();
      if (!reasoningParts.includes(trimmed)) {
        reasoningParts.push(trimmed);
      }
    }
  };

  let resolvedText = '';

  // 1. Anthropic 原生 Messages 结构 & 酒馆 sendClaudeRequest 包装顶层 content 数组
  if (Array.isArray(payload.content)) {
    const claudeTexts = [];
    for (const block of payload.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        pushReasoning(block.thinking);
      } else if (block.type === 'text' && typeof block.text === 'string') {
        claudeTexts.push(block.text);
      }
    }
    const joined = claudeTexts.join('\n\n');
    if (joined.trim().length > 0) {
      resolvedText = joined;
    }
  }

  // 2. OpenAI / DeepSeek / OpenRouter / xAI / MistralAI / Custom 标准 choices[0].message
  const choiceMsg = payload?.choices?.[0]?.message;
  if (choiceMsg && typeof choiceMsg === 'object') {
    pushReasoning(choiceMsg.reasoning_content);
    pushReasoning(choiceMsg.reasoning);

    if (!resolvedText) {
      if (typeof choiceMsg.content === 'string' && choiceMsg.content.length > 0) {
        resolvedText = choiceMsg.content;
      } else if (Array.isArray(choiceMsg.content)) {
        const msgTexts = [];
        for (const part of choiceMsg.content) {
          if (!part) continue;
          if (typeof part === 'string') {
            msgTexts.push(part);
            continue;
          }
          if (part.type === 'redacted_thinking') continue;
          if (part.type === 'thinking' || part.type === 'reasoning' || part.thought === true) {
            if (typeof part.thinking === 'string') {
              pushReasoning(part.thinking);
            } else if (Array.isArray(part.thinking)) {
              for (const sub of part.thinking) {
                if (typeof sub?.text === 'string') pushReasoning(sub.text);
              }
            }
            if (typeof part.text === 'string') {
              pushReasoning(part.text);
            }
            continue;
          }
          if (typeof part.text === 'string') {
            msgTexts.push(part.text);
          }
        }
        const joined = msgTexts.join('');
        if (joined.length > 0) {
          resolvedText = joined;
        }
      }
    }
  }

  // 3. OpenAI Text Completion choices[0].text
  if (!resolvedText && typeof payload?.choices?.[0]?.text === 'string' && payload.choices[0].text.length > 0) {
    resolvedText = payload.choices[0].text;
  }

  // 4. Cohere V2 Chat 结构 (payload.message.content 数组)
  if (Array.isArray(payload?.message?.content)) {
    const cohereTexts = [];
    for (const part of payload.message.content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'thinking' && typeof part.thinking === 'string') {
        pushReasoning(part.thinking);
      } else if ((part.type === 'text' || !part.type) && typeof part.text === 'string') {
        cohereTexts.push(part.text);
      }
    }
    if (!resolvedText && cohereTexts.join('').length > 0) {
      resolvedText = cohereTexts.join('\n\n');
    }
  }
  if (!resolvedText && typeof payload?.message?.tool_plan === 'string' && payload.message.tool_plan.length > 0) {
    resolvedText = payload.message.tool_plan;
  }

  // 5. Google Makersuite / Vertex AI 原生 candidates[0].content.parts 及酒馆包装 responseContent.parts
  const geminiParts = Array.isArray(payload?.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts
    : Array.isArray(payload?.responseContent?.parts)
      ? payload.responseContent.parts
      : null;
  if (geminiParts) {
    const geminiTexts = [];
    for (const part of geminiParts) {
      if (!part || typeof part !== 'object') continue;
      if (part.thought) {
        if (typeof part.text === 'string') pushReasoning(part.text);
      } else if (typeof part.text === 'string') {
        geminiTexts.push(part.text);
      }
    }
    if (!resolvedText && geminiTexts.join('').length > 0) {
      resolvedText = geminiTexts.join('\n\n');
    }
  }
  if (!resolvedText && typeof payload?.candidates?.[0]?.output === 'string' && payload.candidates[0].output.length > 0) {
    resolvedText = payload.candidates[0].output;
  }

  // 6. Workers AI / 各类网关直返字符串字段兜底
  if (!resolvedText) {
    const fallbacks = [
      payload?.text,
      payload?.response,
      payload?.result?.response,
      payload?.output_text,
      payload?.results?.[0]?.text,
    ];
    for (const candidate of fallbacks) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        resolvedText = candidate;
        break;
      }
    }
  }

  return {
    text: resolvedText,
    reasoningText: reasoningParts.join('\n\n').trim(),
  };
}

export function extractProbeReplyText(payload) {
  const { text } = extractCompletionPayload(payload);
  if (typeof text !== 'string' || !text) return '';
  const withoutThink = text
    .replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:think|thinking)\b[^>]*>[\s\S]*$/i, '');
  return withoutThink.replace(/\s+/g, ' ').trim().slice(0, 28);
}

/**
 * 向当前站子发送一条真实极简非流式测试请求（快速测活），返回端到端耗时与精准人话诊断。
 */
export async function testStationChatReply(
  station,
  { getContext, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {},
) {
  if (!station) {
    return { ok: false, latencyMs: 0, replyPreview: '', message: '未选择站子卡片' };
  }
  if (station.source === 'custom' && !sanitizeEndpointUrl(station.url)) {
    return { ok: false, latencyMs: 0, replyPreview: '', message: '请先填写有效的 http(s) 接口地址' };
  }
  if (!String(station.model || '').trim()) {
    return { ok: false, latencyMs: 0, replyPreview: '', message: '请先在下方选择或手输一个模型名称再测活' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, latencyMs: 0, replyPreview: '', message: '当前环境不支持网络请求' };
  }

  const startedAt = Date.now();
  const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
  const timer =
    controller && timeoutMs > 0
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : 0;

  try {
    const ctx = getContext?.();
    const headers =
      typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };
    const reqBody = buildProbeGenerateBody(station, ctx?.chatCompletionSettings);

    const res = await fetchImpl(resolveEndpointHref('api/backends/chat-completions/generate'), {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
      ...(controller ? { signal: controller.signal } : {}),
    });

    const latencyMs = Math.max(1, Date.now() - startedAt);
    let payload = null;
    let rawText = '';
    if (typeof res?.text === 'function') {
      rawText = await res.text();
      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        payload = null;
      }
    } else if (typeof res?.json === 'function') {
      payload = await res.json();
    }

    if (!res?.ok || payload?.error) {
      const status = Number(res?.status || 0);
      const detail = extractProbeErrorDetail(payload, rawText);
      const tail = detail ? `（${detail}）` : '';

      if (status === 401 || status === 403) {
        return {
          ok: false,
          latencyMs,
          replyPreview: '',
          message: `测活未通过 (HTTP ${status})：密钥无效或无该模型权限${tail}`,
        };
      }
      if (status === 404) {
        const v1Tip = needsV1Suffix(station.url, station.source)
          ? '建议点地址栏旁「补全 /v1」后再试'
          : '请检查接口地址路径或模型名拼写';
        return {
          ok: false,
          latencyMs,
          replyPreview: '',
          message: `测活未通过 (HTTP 404)：${v1Tip}${tail}`,
        };
      }
      if (status === 429) {
        return {
          ok: false,
          latencyMs,
          replyPreview: '',
          message: `测活受限 (HTTP 429)：当前密钥额度不足或请求过快${tail}`,
        };
      }
      return {
        ok: false,
        latencyMs,
        replyPreview: '',
        message: `测活未通过${status ? ` (HTTP ${status})` : ''}：${detail || '请检查地址、密钥与模型是否匹配'}`,
      };
    }

    const replyPreview = extractProbeReplyText(payload);
    const previewSuffix = replyPreview ? `「${replyPreview}」` : '';
    return {
      ok: true,
      latencyMs,
      replyPreview,
      message: `测活通过 (${latencyMs}ms) · 模型响应正常${previewSuffix ? `：${previewSuffix}` : ''}`,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      latencyMs,
      replyPreview: '',
      message: isAbort
        ? `测活超时 (${Math.round(timeoutMs / 1000)}s)：接口响应过慢或网络不通`
        : `测活连接异常：${err?.message || '请检查接口地址与网络'}`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 解析当前「伴侣助手副 API」通道配置（供第 3 单统一伴侣助手直接读取调用）。
 */
export function resolveAuxApiChannel(settings = {}) {
  const aux = settings?.auxApi || {};
  const stations = Array.isArray(settings?.apiStudio?.stations) ? settings.apiStudio.stations : [];

  if (aux.mode === 'station' && aux.stationId) {
    const matched = stations.find(st => st.id === aux.stationId);
    if (matched) {
      return {
        mode: 'station',
        station: matched,
        model: aux.model || matched.model || '',
      };
    }
  }

  return {
    mode: 'follow_main',
    station: null,
    model: '',
  };
}
