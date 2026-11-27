/**
 * ST伴侣 (st-mate) · 「预设馆面板」纯数据模型、角色双向绑定与酒馆预设持久化引擎
 * 职责边界：
 * 1. 全局默认预设 + 角色/群聊唯一键 (`char:<avatar>` / `group:<id>`) 专属预设双向绑定与切卡无感秒切；
 * 2. 常用预设与预设仓库（归档收纳）双视图分流，以及改名/删除时的引用无损自动联动；
 * 3. 预设 JSON 导入脱敏、纯净导出、另存副本，以及供「伴侣预设助手」与自动落盘队列共用的快照捕获/无损恢复接口；
 * 4. 核心生成参数（上下文自动破除锁定上限 / 最大回复 / 温度）与提示词条目 (`prompts` + `prompt_order`) 开关、排序、增删改与防白改自动落盘。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.9.9';
import { STM_NAMESPACE, normalizePresetStudio } from '../core/schema.js?v=0.9.9';

export const UNLOCKED_MAX_CONTEXT = 2000000;

export const CONTEXT_QUICK_TIERS = Object.freeze([
  { label: '16K', value: 16384, minMatch: 16000, maxMatch: 16500 },
  { label: '32K', value: 32768, minMatch: 32000, maxMatch: 33000 },
  { label: '64K', value: 65536, minMatch: 64000, maxMatch: 66000 },
  { label: '128K', value: 128000, minMatch: 127000, maxMatch: 132000 },
  { label: '200K', value: 200000, minMatch: 199000, maxMatch: 205000 },
  { label: '1M', value: 1000000, minMatch: 990000, maxMatch: 1060000 },
  { label: '2M', value: 2000000, minMatch: 1990000, maxMatch: 2050000 },
]);

export const MAX_TOKENS_QUICK_TIERS = Object.freeze([
  { label: '1K', value: 1024 },
  { label: '4K', value: 4096 },
  { label: '8K', value: 8192 },
  { label: '16K', value: 16384 },
  { label: '32K', value: 32768 },
  { label: '64K', value: 65535 },
]);

export const PROMPT_ROLE_OPTIONS = Object.freeze([
  { id: 'system', label: 'System · 系统指令', shortLabel: 'SYS' },
  { id: 'user', label: 'User · 用户口吻', shortLabel: 'USER' },
  { id: 'assistant', label: 'Assistant · AI口吻', shortLabel: 'AI' },
]);

export const MARKER_DESCRIPTIONS = Object.freeze({
  charDescription: '此处自动注入角色卡的「角色描述 (Description)」设定',
  charPersonality: '此处自动注入角色卡的「性格特征 (Personality)」设定',
  scenario: '此处自动注入角色卡的「场景背景 (Scenario)」设定',
  personaDescription: '此处自动注入你当前启用的「用户人设 (Persona)」描述',
  worldInfoBefore: '此处自动注入设为「角色定义前 (↑Char)」的世界书条目',
  worldInfoAfter: '此处自动注入设为「角色定义后 (↓Char)」的世界书条目',
  dialogueExamples: '此处自动注入角色卡的「对话示例 (Example Dialogue)」',
  chatHistory: '此处按上下文预算自动填入当前聊天的「历史对话记录」',
});

export const SYSTEM_PROTECTED_PROMPT_IDS = new Set([
  'main',
  'nsfw',
  'jailbreak',
  'enhanceDefinitions',
  ...Object.keys(MARKER_DESCRIPTIONS),
]);

/**
 * 外部预设导入/导出时需剥离的连接层敏感字段（与 SillyTavern public/scripts/openai.js sensitiveFields 对齐并增强）。
 */
export const PRESET_SENSITIVE_FIELDS = Object.freeze([
  'reverse_proxy',
  'proxy_password',
  'custom_url',
  'custom_include_body',
  'custom_exclude_body',
  'custom_include_headers',
  'vertexai_region',
  'vertexai_express_project_id',
  'azure_base_url',
  'azure_deployment_name',
  'workers_ai_account_id',
]);

const EXTRA_STRIP_KEYS = Object.freeze([
  'api_key',
  'apiKey',
  'rawKey',
  'secret_id',
  'secretId',
  'proxies',
]);

/**
 * 酒馆 Chat Completion 预设文件标准字段映射（presetKey -> oai_settings 内存字段名）。
 * 注意：唯独温度在预设 JSON 中叫 `temperature`，而在 oai_settings 内存中叫 `temp_openai`！
 */
const OAI_PRESET_KEY_PAIRS = Object.freeze([
  ['temperature', 'temp_openai'],
  ['frequency_penalty', 'freq_pen_openai'],
  ['presence_penalty', 'pres_pen_openai'],
  ['top_p', 'top_p_openai'],
  ['top_k', 'top_k_openai'],
  ['top_a', 'top_a_openai'],
  ['min_p', 'min_p_openai'],
  ['repetition_penalty', 'repetition_penalty_openai'],
  ['max_context_unlocked', 'max_context_unlocked'],
  ['openai_max_context', 'openai_max_context'],
  ['openai_max_tokens', 'openai_max_tokens'],
  ['names_behavior', 'names_behavior'],
  ['send_if_empty', 'send_if_empty'],
  ['impersonation_prompt', 'impersonation_prompt'],
  ['new_chat_prompt', 'new_chat_prompt'],
  ['new_group_chat_prompt', 'new_group_chat_prompt'],
  ['new_example_chat_prompt', 'new_example_chat_prompt'],
  ['continue_nudge_prompt', 'continue_nudge_prompt'],
  ['bias_preset_selected', 'bias_preset_selected'],
  ['wi_format', 'wi_format'],
  ['scenario_format', 'scenario_format'],
  ['personality_format', 'personality_format'],
  ['group_nudge_prompt', 'group_nudge_prompt'],
  ['stream_openai', 'stream_openai'],
  ['prompts', 'prompts'],
  ['prompt_order', 'prompt_order'],
  ['assistant_prefill', 'assistant_prefill'],
  ['assistant_impersonation', 'assistant_impersonation'],
  ['use_sysprompt', 'use_sysprompt'],
  ['squash_system_messages', 'squash_system_messages'],
  ['media_inlining', 'media_inlining'],
  ['inline_image_quality', 'inline_image_quality'],
  ['continue_prefill', 'continue_prefill'],
  ['continue_postfix', 'continue_postfix'],
  ['function_calling', 'function_calling'],
  ['tool_call_recurse_limit', 'tool_call_recurse_limit'],
  ['show_thoughts', 'show_thoughts'],
  ['reasoning_effort', 'reasoning_effort'],
  ['verbosity', 'verbosity'],
  ['enable_web_search', 'enable_web_search'],
  ['seed', 'seed'],
  ['n', 'n'],
  ['tool_reasoning_mode', 'tool_reasoning_mode'],
  ['request_images', 'request_images'],
  ['request_image_aspect_ratio', 'request_image_aspect_ratio'],
  ['request_image_resolution', 'request_image_resolution'],
  ['extensions', 'extensions'],
]);

let hostOpenAiModPromise = null;
let cachedHostOpenAiMod = null;
let hostPmRenderTimer = 0;

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

function resolveHostBaseHref(doc = globalThis.document) {
  const candidates = [doc?.baseURI, globalThis.location?.href];
  for (const raw of candidates) {
    if (typeof raw === 'string' && /^(?:https?|tauri|capacitor|app):\/\//i.test(raw)) {
      return raw;
    }
  }
  return '';
}

function resolveEndpointHref(apiPath, doc = globalThis.document) {
  const clean = String(apiPath || '').replace(/^\/+/, '');
  const base = resolveHostBaseHref(doc);
  if (base) {
    try {
      return new URL(clean, base).href;
    } catch {
      // fall through
    }
  }
  return `/${clean}`;
}

/**
 * 安全桥接酒馆宿主 `scripts/openai.js` 导出的实时引用（`promptManager` / `openai_settings` / `openai_setting_names` / `getChatCompletionPreset`）。
 * 兼容桌面浏览器与 TauriTavern 自定义协议，同时支持单测显式注入 `openAiModule`。
 */
export async function primeHostOpenAiModule({ openAiModule = null, doc = globalThis.document } = {}) {
  if (openAiModule !== undefined && openAiModule !== null) {
    cachedHostOpenAiMod = openAiModule;
    return cachedHostOpenAiMod;
  }
  if (cachedHostOpenAiMod) return cachedHostOpenAiMod;
  const base = resolveHostBaseHref(doc);
  if (!base) return null;
  hostOpenAiModPromise ||= import(new URL('scripts/openai.js', base).href)
    .then(mod => {
      cachedHostOpenAiMod = mod || null;
      return cachedHostOpenAiMod;
    })
    .catch(() => {
      hostOpenAiModPromise = null;
      return null;
    });
  return hostOpenAiModPromise;
}

export function getCachedHostOpenAiModule() {
  return cachedHostOpenAiMod;
}

function generateUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 清洗预设名称（剥离首尾空白与 .json/.settings/.preset 扩展名；过滤内置占位 'gui'）。
 */
export function cleanPresetName(rawName) {
  if (typeof rawName !== 'string') return '';
  const cleaned = rawName
    .trim()
    .replace(/\.(?:json|settings|preset)$/i, '')
    .trim()
    .slice(0, 200);
  if (!cleaned || /^gui(?:\s+koboldai\s+settings)?$/i.test(cleaned)) {
    return '';
  }
  return cleaned;
}

// ============================================================================
// 一、实体唯一键与角色⇄预设双向绑定引擎（同时供第 4 单「角色档案页」直接复用）
// ============================================================================

/**
 * 计算聊天实体（单人角色卡或群聊）的稳定唯一绑定键：
 * - 单人角色卡：`char:<avatar>`（如 `char:裴敬之.png`，改角色名或同名卡均不串台）
 * - 群聊：`group:<groupId>`
 * 支持直接传入已格式化的键字符串、酒馆 `ctx` 上下文、单张 `character` 对象或 `group` 对象。
 */
export function getEntityBindingKey(ctxOrChar) {
  if (!ctxOrChar) return '';

  if (typeof ctxOrChar === 'string') {
    const trimmed = ctxOrChar.trim();
    return /^(?:char|group):.+/.test(trimmed) ? trimmed : '';
  }

  if (typeof ctxOrChar !== 'object') return '';

  // 1. 宿主 getContext() 对象（含 groupId 或 characterId + characters）
  if ('groupId' in ctxOrChar || 'characterId' in ctxOrChar) {
    if (ctxOrChar.groupId !== undefined && ctxOrChar.groupId !== null && String(ctxOrChar.groupId).trim() !== '') {
      return `group:${String(ctxOrChar.groupId).trim()}`;
    }
    if (!hasActiveChatSelection(ctxOrChar)) return '';
    const char = ctxOrChar.characters?.[ctxOrChar.characterId];
    const avatar = typeof char?.avatar === 'string' ? char.avatar.trim() : '';
    if (avatar) return `char:${avatar}`;
    const fallbackName = String(char?.name || ctxOrChar.name2 || '').trim();
    return fallbackName ? `char:${fallbackName}` : '';
  }

  // 2. 群聊实体对象（如 ctx.groups[i]）
  if (
    (ctxOrChar.is_group === true || Array.isArray(ctxOrChar.members)) &&
    ctxOrChar.id !== undefined &&
    ctxOrChar.id !== null &&
    String(ctxOrChar.id).trim() !== ''
  ) {
    return `group:${String(ctxOrChar.id).trim()}`;
  }

  // 3. 单人角色对象（如 ctx.characters[i] 或 getCurrentEntityMeta 结果）
  if (typeof ctxOrChar.avatarKey === 'string' && /^(?:char|group):.+/.test(ctxOrChar.avatarKey.trim())) {
    return ctxOrChar.avatarKey.trim();
  }

  const avatar = typeof ctxOrChar.avatar === 'string' ? ctxOrChar.avatar.trim() : '';
  if (avatar) return `char:${avatar}`;

  const name = typeof ctxOrChar.name === 'string' ? ctxOrChar.name.trim() : '';
  return name ? `char:${name}` : '';
}

/**
 * 查询某实体（角色卡或群聊）当前显式绑定的专属预设名称（未绑定返回空字符串）。
 */
export function getBoundPresetForEntity(presetStudio, ctxOrChar) {
  const key = getEntityBindingKey(ctxOrChar);
  if (!key) return '';
  return cleanPresetName(presetStudio?.charBindings?.[key]);
}

/**
 * 为某实体设置或解除专属绑定预设（纯函数，返回归一化后的新 `presetStudio`）。
 * 传入空字符串或 null 即解除绑定，回退跟随全局默认预设。
 */
export function setBoundPresetForEntity(presetStudio, ctxOrChar, presetName) {
  const base = normalizePresetStudio(presetStudio);
  const key = getEntityBindingKey(ctxOrChar);
  if (!key) return base;

  const nextBindings = { ...base.charBindings };
  const target = cleanPresetName(presetName);
  if (target) {
    nextBindings[key] = target;
  } else {
    delete nextBindings[key];
  }

  return normalizePresetStudio({
    ...base,
    charBindings: nextBindings,
  });
}

/**
 * 设置或取消全局默认预设（纯函数，返回新 `presetStudio`）。
 */
export function setDefaultPresetName(presetStudio, presetName) {
  const base = normalizePresetStudio(presetStudio);
  return normalizePresetStudio({
    ...base,
    defaultPreset: cleanPresetName(presetName),
  });
}

/**
 * 一对多批量设定绑定到某预设的全部实体唯一键集合（纯函数）：
 * - 原本绑在该预设但不在 `entityKeys` 中的角色自动解除绑定（回退全局默认）；
 * - 原本绑在其他预设但被纳入 `entityKeys` 的角色自动平滑转移绑定到 `presetName`；
 * - 绑在其他预设且未被选中的角色保持原样不受影响。
 */
export function setEntitiesBoundToPreset(presetStudio, presetName, entityKeys = []) {
  const base = normalizePresetStudio(presetStudio);
  const target = cleanPresetName(presetName);
  if (!target) return base;

  const selectedSet = new Set(
    (Array.isArray(entityKeys) ? entityKeys : [])
      .map(item => getEntityBindingKey(item))
      .filter(Boolean),
  );

  const nextBindings = {};
  for (const [key, bound] of Object.entries(base.charBindings)) {
    if (bound === target) {
      if (selectedSet.has(key)) {
        nextBindings[key] = target;
      }
    } else if (!selectedSet.has(key)) {
      nextBindings[key] = bound;
    }
  }

  for (const key of selectedSet) {
    nextBindings[key] = target;
  }

  return normalizePresetStudio({
    ...base,
    charBindings: nextBindings,
  });
}

function buildThumbForCharAvatar(avatarFile, getThumbnailUrl) {
  if (!avatarFile) return '';
  if (typeof getThumbnailUrl === 'function') {
    try {
      return getThumbnailUrl('avatar', avatarFile);
    } catch {
      // ignore
    }
  }
  const base = globalThis.document?.baseURI;
  if (base && /^https?:\/\//i.test(base)) {
    try {
      return new URL(`characters/${encodeURIComponent(avatarFile)}`, base).href;
    } catch {
      // ignore
    }
  }
  return `characters/${encodeURIComponent(avatarFile)}`;
}

/**
 * 查询当前绑定到某套预设的全部角色/群聊实体详情列表。
 */
export function getEntitiesBoundToPreset(
  presetStudio,
  presetName,
  { characters = null, groups = null, getThumbnailUrl = null } = {},
) {
  const target = cleanPresetName(presetName);
  if (!target) return [];
  const bindings = presetStudio?.charBindings || {};
  const matchedKeys = Object.entries(bindings)
    .filter(([, val]) => cleanPresetName(val) === target)
    .map(([key]) => key);

  if (matchedKeys.length === 0) return [];

  const charMap = new Map();
  if (Array.isArray(characters)) {
    for (const ch of characters) {
      const k = getEntityBindingKey(ch);
      if (k) charMap.set(k, ch);
    }
  }

  const groupMap = new Map();
  if (Array.isArray(groups)) {
    for (const grp of groups) {
      const k = getEntityBindingKey({ ...grp, is_group: true });
      if (k) groupMap.set(k, grp);
    }
  }

  return matchedKeys.map(key => {
    if (key.startsWith('group:')) {
      const grp = groupMap.get(key);
      return {
        key,
        kind: 'group',
        name: String(grp?.name || key.slice(6)),
        avatar: String(grp?.avatar_url || ''),
        thumbUrl: String(grp?.avatar_url || ''),
        exists: groups ? Boolean(grp) : true,
      };
    }
    const rawAvatar = key.slice(5);
    const ch = charMap.get(key);
    const displayName = ch?.name
      ? String(ch.name)
      : rawAvatar.replace(/\.(?:png|webp|jpg|jpeg|gif)$/i, '');
    return {
      key,
      kind: 'char',
      name: displayName,
      avatar: ch?.avatar || rawAvatar,
      thumbUrl: buildThumbForCharAvatar(ch?.avatar || rawAvatar, getThumbnailUrl),
      exists: characters ? Boolean(ch) : true,
    };
  });
}

/**
 * 列出酒馆中全部可用于绑定预设的角色卡与群聊（供预设卡片展开的一对多绑卡面板渲染与搜索）。
 */
export function listBindableEntities(
  ctx,
  { presetStudio = null, query = '', includeGroups = true, pinnedKeys = null } = {},
) {
  const bindings = presetStudio?.charBindings || {};
  const q = String(query || '').trim().toLowerCase();
  const out = [];

  const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
  for (const ch of characters) {
    if (!ch) continue;
    const key = getEntityBindingKey(ch);
    if (!key) continue;
    const name = String(ch.name || ch.avatar || key.slice(5)).trim();
    const avatar = String(ch.avatar || '').trim();
    if (q && !name.toLowerCase().includes(q) && !avatar.toLowerCase().includes(q)) {
      continue;
    }
    out.push({
      key,
      kind: 'char',
      name,
      avatar,
      thumbUrl: buildThumbForCharAvatar(avatar, ctx?.getThumbnailUrl),
      boundPreset: cleanPresetName(bindings[key]),
    });
  }

  if (includeGroups && Array.isArray(ctx?.groups)) {
    for (const grp of ctx.groups) {
      if (!grp || grp.id === undefined || grp.id === null) continue;
      const key = `group:${String(grp.id).trim()}`;
      const name = `${String(grp.name || '群聊').trim()} (群聊)`;
      if (q && !name.toLowerCase().includes(q)) continue;
      out.push({
        key,
        kind: 'group',
        name,
        avatar: String(grp.avatar_url || ''),
        thumbUrl: String(grp.avatar_url || ''),
        boundPreset: cleanPresetName(bindings[key]),
      });
    }
  }

  if (Array.isArray(pinnedKeys) && pinnedKeys.length > 0) {
    const rankMap = new Map();
    pinnedKeys.forEach((k, idx) => {
      if (k && !rankMap.has(k)) rankMap.set(k, idx);
    });
    out.sort((a, b) => {
      const ra = rankMap.has(a.key) ? rankMap.get(a.key) : Number.MAX_SAFE_INTEGER;
      const rb = rankMap.has(b.key) ? rankMap.get(b.key) : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }

  return out;
}

/**
 * 解析当前聊天实体应当生效的目标预设（严格遵循：角色专属绑定 > 全局默认预设 > 保持自由态）。
 * 注意：即使某套预设被收进了 `archivedPresets`（预设仓库），只要它在酒馆预设列表 `availablePresets` 中存在，
 * 绑定了它的角色卡依然会 100% 正常命中并自动切换！
 */
export function resolveTargetPresetForEntity(presetStudio, ctxOrChar, availablePresets = null) {
  const ps = normalizePresetStudio(presetStudio);
  const entityKey = getEntityBindingKey(ctxOrChar);
  const boundPreset = entityKey ? cleanPresetName(ps.charBindings[entityKey]) : '';
  const defaultPreset = cleanPresetName(ps.defaultPreset);

  const hasAvailableConstraint = Array.isArray(availablePresets);
  const availableSet = hasAvailableConstraint
    ? new Set(availablePresets.map(cleanPresetName).filter(Boolean))
    : null;

  let boundMissing = false;
  if (boundPreset) {
    if (!availableSet || availableSet.has(boundPreset)) {
      return {
        entityKey,
        targetPreset: boundPreset,
        source: 'bound',
        boundPreset,
        defaultPreset,
        boundMissing: false,
        defaultMissing: false,
      };
    }
    boundMissing = true;
  }

  let defaultMissing = false;
  if (defaultPreset) {
    if (!availableSet || availableSet.has(defaultPreset)) {
      return {
        entityKey,
        targetPreset: defaultPreset,
        source: 'default',
        boundPreset,
        defaultPreset,
        boundMissing,
        defaultMissing: false,
      };
    }
    defaultMissing = true;
  }

  return {
    entityKey,
    targetPreset: '',
    source: 'none',
    boundPreset,
    defaultPreset,
    boundMissing,
    defaultMissing,
  };
}

/**
 * 将角色卡或预设的导入时间戳格式化为极简、不抢戏的微标文本：
 * - 同年展示 `MM-DD`（如 `11-22`），跨年展示 `YY-MM-DD`（如 `25-12-08`）；
 * - 悬停 `fullTitle` 展示精确到分钟的 `导入于 YYYY-MM-DD HH:mm`；
 * - 无效或 0 时间戳返回空字符串（历史存量无时间戳预设保持留白，不伪造时间）。
 */
export function formatSubtleImportTime(rawTs, { nowMs = Date.now() } = {}) {
  const num = Number(rawTs);
  if (!Number.isFinite(num) || num <= 0) {
    return { shortText: '', fullTitle: '' };
  }
  const ms = num < 1e11 ? Math.round(num * 1000) : Math.round(num);
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) {
    return { shortText: '', fullTitle: '' };
  }
  const nowDt = new Date(Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Number(nowMs) : Date.now());
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  const shortText = yyyy === nowDt.getFullYear() ? `${mm}-${dd}` : `${String(yyyy).slice(-2)}-${mm}-${dd}`;
  return {
    shortText,
    fullTitle: `导入于 ${yyyy}-${mm}-${dd} ${hh}:${mi}`,
  };
}

/**
 * 记录一个或多个新导入/另存预设的导入时间戳（纯函数，返回归一化后的新 `presetStudio`）。
 */
export function recordPresetImportedAt(presetStudio, presetNames, ts = Date.now()) {
  const base = normalizePresetStudio(presetStudio);
  const list = Array.isArray(presetNames) ? presetNames : [presetNames];
  const validTs = Number.isFinite(Number(ts)) && Number(ts) > 0 ? Math.round(Number(ts)) : Date.now();
  const nextImportedAt = { ...base.importedAt };
  let changed = false;

  for (const raw of list) {
    const clean = cleanPresetName(raw);
    if (!clean) continue;
    nextImportedAt[clean] = validTs;
    changed = true;
  }

  if (!changed) return base;
  return normalizePresetStudio({
    ...base,
    importedAt: nextImportedAt,
  });
}

function stampHostPresetImportedAt(ctx, presetNames, ts = Date.now()) {
  const hostStore = ctx?.extensionSettings;
  if (!hostStore || typeof hostStore !== 'object') return;
  const current =
    hostStore[STM_NAMESPACE] && typeof hostStore[STM_NAMESPACE] === 'object'
      ? hostStore[STM_NAMESPACE]
      : (hostStore[STM_NAMESPACE] = {});
  current.presetStudio = recordPresetImportedAt(current.presetStudio, presetNames, ts);
  ctx.saveSettingsDebounced?.();
}

/**
 * 当预设重命名时，同步迁移 `defaultPreset`、`charBindings`、`archivedPresets` 与 `importedAt` 中的预设名引用，绝不断链。
 */
export function renamePresetReferences(presetStudio, oldName, newName) {
  const base = normalizePresetStudio(presetStudio);
  const from = cleanPresetName(oldName);
  const to = cleanPresetName(newName);
  if (!from || !to || from === to) return base;

  const nextDefault = base.defaultPreset === from ? to : base.defaultPreset;
  const nextBindings = {};
  for (const [k, v] of Object.entries(base.charBindings)) {
    nextBindings[k] = v === from ? to : v;
  }
  const nextArchived = base.archivedPresets.map(name => (name === from ? to : name));
  const nextImportedAt = {};
  for (const [name, ts] of Object.entries(base.importedAt || {})) {
    nextImportedAt[name === from ? to : name] = ts;
  }

  return normalizePresetStudio({
    defaultPreset: nextDefault,
    charBindings: nextBindings,
    archivedPresets: nextArchived,
    importedAt: nextImportedAt,
  });
}

/**
 * 当预设被物理删除时，自动清理残留在 `defaultPreset`、`charBindings`、`archivedPresets` 与 `importedAt` 中的死链。
 */
export function cleanupDeletedPresetReferences(presetStudio, deletedName) {
  const base = normalizePresetStudio(presetStudio);
  const target = cleanPresetName(deletedName);
  if (!target) return base;

  const nextDefault = base.defaultPreset === target ? '' : base.defaultPreset;
  const nextBindings = {};
  for (const [k, v] of Object.entries(base.charBindings)) {
    if (v !== target) {
      nextBindings[k] = v;
    }
  }
  const nextArchived = base.archivedPresets.filter(name => name !== target);
  const nextImportedAt = { ...(base.importedAt || {}) };
  delete nextImportedAt[target];

  return normalizePresetStudio({
    defaultPreset: nextDefault,
    charBindings: nextBindings,
    archivedPresets: nextArchived,
    importedAt: nextImportedAt,
  });
}

// ============================================================================
// 二、「常用预设」与「预设仓库（归档收纳）」分流与筛选
// ============================================================================

/**
 * 将某个预设收进「预设仓库」或移回「常用预设」（纯函数）。
 */
export function toggleArchivePreset(presetStudio, presetName, shouldArchive = null) {
  const base = normalizePresetStudio(presetStudio);
  const target = cleanPresetName(presetName);
  if (!target) return base;

  const currentlyArchived = base.archivedPresets.includes(target);
  const nextFlag = typeof shouldArchive === 'boolean' ? shouldArchive : !currentlyArchived;
  const nextArchived = nextFlag
    ? [...base.archivedPresets, target]
    : base.archivedPresets.filter(item => item !== target);

  return normalizePresetStudio({
    ...base,
    archivedPresets: nextArchived,
  });
}

/**
 * 将酒馆当前全部预设分流为「常用预设」与「预设仓库」，并附带激活态、全局默认态与绑卡数量统计。
 */
export function partitionPresetsByArchive(
  allPresetNames = [],
  presetStudio = {},
  { activePresetName = '', query = '' } = {},
) {
  const ps = normalizePresetStudio(presetStudio);
  const archivedSet = new Set(ps.archivedPresets);
  const activeClean = cleanPresetName(activePresetName);
  const q = String(query || '').trim().toLowerCase();

  // 预聚合每个预设绑定的实体键数组
  const boundKeysByPreset = new Map();
  for (const [entityKey, pName] of Object.entries(ps.charBindings)) {
    const clean = cleanPresetName(pName);
    if (!clean) continue;
    const arr = boundKeysByPreset.get(clean) || [];
    arr.push(entityKey);
    boundKeysByPreset.set(clean, arr);
  }

  const seen = new Set();
  const allCommon = [];
  const allArchived = [];

  for (const raw of Array.isArray(allPresetNames) ? allPresetNames : []) {
    const name = cleanPresetName(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const boundKeys = boundKeysByPreset.get(name) || [];
    const item = {
      name,
      isActive: name === activeClean,
      isDefault: name === ps.defaultPreset,
      isArchived: archivedSet.has(name),
      boundCount: boundKeys.length,
      boundKeys,
      importedAt: Number(ps.importedAt?.[name]) || 0,
    };

    if (item.isArchived) {
      allArchived.push(item);
    } else {
      allCommon.push(item);
    }
  }

  const matchFn = item => (!q ? true : item.name.toLowerCase().includes(q));

  return {
    commonPresets: allCommon.filter(matchFn),
    archivedPresets: allArchived.filter(matchFn),
    totalCommonCount: allCommon.length,
    totalArchivedCount: allArchived.length,
    totalCount: allCommon.length + allArchived.length,
  };
}

// ============================================================================
// 三、宿主预设列表读取、无损连接保护切换 & 切卡自动切预设引擎
// ============================================================================

/**
 * 读取酒馆当前 Chat Completion (`openai`) 的全部预设列表与当前生效预设名。
 */
export function getHostPresetState({
  getContext,
  openAiModule = null,
  doc = globalThis.document,
} = {}) {
  const ctx = getContext?.();
  const openAiMod = openAiModule || cachedHostOpenAiMod;

  let pm = null;
  if (typeof ctx?.getPresetManager === 'function') {
    const explicitOaiPm = ctx.getPresetManager('openai');
    if (explicitOaiPm) {
      pm = explicitOaiPm;
    } else {
      const fallbackPm = ctx.getPresetManager();
      if (fallbackPm && (!fallbackPm.apiId || fallbackPm.apiId === 'openai')) {
        pm = fallbackPm;
      }
    }
  }

  const selectEl = doc?.getElementById?.('settings_preset_openai') || null;

  const optionEntries = [];
  const seen = new Set();

  if (selectEl?.options?.length) {
    for (let i = 0; i < selectEl.options.length; i += 1) {
      const opt = selectEl.options[i];
      const val = String(opt?.value ?? '');
      const name = cleanPresetName(String(opt?.textContent ?? opt?.text ?? ''));
      if (!name || val === 'gui' || seen.has(name)) continue;
      seen.add(name);
      optionEntries.push({ name, optionValue: val });
    }
  }

  if (optionEntries.length === 0 && pm) {
    const pmNames = typeof pm.getAllPresets === 'function' ? pm.getAllPresets() : [];
    const listInfo = typeof pm.getPresetList === 'function' ? pm.getPresetList('openai') : null;
    const nameMap = listInfo?.preset_names && typeof listInfo.preset_names === 'object' ? listInfo.preset_names : {};

    for (const raw of Array.isArray(pmNames) ? pmNames : []) {
      const name = cleanPresetName(raw);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const val =
        typeof pm.findPreset === 'function'
          ? pm.findPreset(name)
          : nameMap[name] !== undefined
            ? String(nameMap[name])
            : name;
      optionEntries.push({ name, optionValue: val !== undefined ? String(val) : name });
    }

    if (optionEntries.length === 0 && nameMap && !Array.isArray(nameMap)) {
      for (const [rawKey, idx] of Object.entries(nameMap)) {
        const name = cleanPresetName(rawKey);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        optionEntries.push({ name, optionValue: String(idx) });
      }
    }
  }

  if (
    optionEntries.length === 0 &&
    openAiMod?.openai_setting_names &&
    typeof openAiMod.openai_setting_names === 'object' &&
    !Array.isArray(openAiMod.openai_setting_names)
  ) {
    for (const [rawKey, idx] of Object.entries(openAiMod.openai_setting_names)) {
      const name = cleanPresetName(rawKey);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      optionEntries.push({ name, optionValue: String(idx) });
    }
  }

  let activePreset = '';
  let isGuiPreset = false;

  if (selectEl) {
    let selectedOpt = selectEl.selectedOptions?.[0] || null;
    if (!selectedOpt && typeof selectEl.selectedIndex === 'number' && selectEl.selectedIndex >= 0) {
      selectedOpt = selectEl.options?.[selectEl.selectedIndex] || null;
    }
    if (!selectedOpt && selectEl.value !== undefined && selectEl.options?.length) {
      selectedOpt = Array.from(selectEl.options).find(o => String(o.value) === String(selectEl.value)) || null;
    }
    if (selectedOpt) {
      if (String(selectedOpt.value) === 'gui') {
        isGuiPreset = true;
      }
      activePreset = cleanPresetName(String(selectedOpt.textContent ?? selectedOpt.text ?? ''));
    }
  }

  if (!activePreset && !isGuiPreset && typeof pm?.getSelectedPresetName === 'function') {
    const selVal = typeof pm.getSelectedPreset === 'function' ? pm.getSelectedPreset() : '';
    if (selVal === 'gui') {
      isGuiPreset = true;
    } else {
      activePreset = cleanPresetName(String(pm.getSelectedPresetName() || ''));
    }
  }

  if (!activePreset && !isGuiPreset) {
    const fromOai = ctx?.chatCompletionSettings?.preset_settings_openai;
    if (fromOai === 'gui') isGuiPreset = true;
    else activePreset = cleanPresetName(String(fromOai || ''));
  }

  return {
    presetNames: optionEntries.map(item => item.name),
    optionEntries,
    activePreset,
    isGuiPreset,
    presetManager: pm,
    selectEl,
  };
}

/**
 * 切换酒馆当前生效预设，并强制开启 API 连接保护（`bind_preset_to_connection = false`），
 * 100% 防止切换预设冲掉玩家在第 1 单「API 与模型工作台」配好的中转站地址、密钥与模型！
 */
export async function selectHostPresetByName(presetName, { getContext, doc = globalThis.document } = {}) {
  const target = cleanPresetName(presetName);
  if (!target) {
    return { ok: false, reason: 'empty_name' };
  }

  const ctx = getContext?.();
  const state = getHostPresetState({ getContext, doc });
  if (state.activePreset === target) {
    return { ok: true, skipped: true, presetName: target };
  }

  const hit = state.optionEntries.find(item => item.name === target);
  let optionValue = hit?.optionValue;
  if (optionValue === undefined && typeof state.presetManager?.findPreset === 'function') {
    const found = state.presetManager.findPreset(target);
    if (found !== undefined && found !== null && found !== '') {
      optionValue = String(found);
    }
  }

  if (optionValue === undefined) {
    return { ok: false, reason: 'not_found', presetName: target };
  }

  // 核心保护：在触发预设切换前，强制关闭「将预设绑定至连接」，防止预设内旧连接覆盖当前站子！
  if (ctx?.chatCompletionSettings && typeof ctx.chatCompletionSettings === 'object') {
    ctx.chatCompletionSettings.bind_preset_to_connection = false;
  }
  const bindCheck = doc?.getElementById?.('bind_preset_to_connection');
  if (bindCheck && 'checked' in bindCheck) {
    bindCheck.checked = false;
  }

  if (typeof state.presetManager?.selectPreset === 'function') {
    await state.presetManager.selectPreset(optionValue);
  } else if (state.selectEl) {
    if (Array.isArray(state.selectEl.options) || state.selectEl.options?.length) {
      for (const opt of Array.from(state.selectEl.options)) {
        opt.selected = String(opt.value) === String(optionValue);
      }
    }
    state.selectEl.value = String(optionValue);
    const EventCtor = globalThis.Event || class MockEvent { constructor(type) { this.type = type; } };
    state.selectEl.dispatchEvent?.(new EventCtor('change', { bubbles: true }));
    if (ctx?.chatCompletionSettings && typeof ctx.chatCompletionSettings === 'object') {
      ctx.chatCompletionSettings.preset_settings_openai = target;
    }
  } else if (ctx?.chatCompletionSettings && typeof ctx.chatCompletionSettings === 'object') {
    ctx.chatCompletionSettings.preset_settings_openai = target;
  }

  return { ok: true, skipped: false, presetName: target };
}

/**
 * 切卡自动切换预设协调器（供 `index.js` 在 `CHAT_CHANGED` 与 `APP_READY` 时幂等调用）。
 */
export async function syncPresetForActiveChat({
  getContext,
  store,
  doc = globalThis.document,
  onSwitched = null,
  shouldAbort = null,
} = {}) {
  const settings = store?.get?.();
  if (!settings?.shellEnabled || !settings?.modules?.presets) {
    return { switched: false, reason: 'disabled' };
  }

  if (typeof shouldAbort === 'function' && shouldAbort()) {
    return { switched: false, superseded: true, reason: 'superseded' };
  }

  const ctx = getContext?.();
  if (!hasActiveChatSelection(ctx)) {
    return { switched: false, reason: 'no_active_chat' };
  }

  const mainApiEl = doc?.getElementById?.('main_api');
  const activeApi = String(mainApiEl?.value || ctx?.mainApi || ctx?.main_api || 'openai')
    .trim()
    .toLowerCase();
  if (activeApi && activeApi !== 'openai') {
    return { switched: false, reason: 'non_chat_completion_api' };
  }

  const hostState = getHostPresetState({ getContext, doc });
  if (hostState.presetNames.length === 0) {
    return { switched: false, reason: 'no_presets_loaded' };
  }

  const resolved = resolveTargetPresetForEntity(settings.presetStudio, ctx, hostState.presetNames);
  if (!resolved.targetPreset) {
    return {
      switched: false,
      reason: 'no_target',
      boundMissing: resolved.boundMissing,
      defaultMissing: resolved.defaultMissing,
    };
  }

  if (hostState.activePreset === resolved.targetPreset) {
    return {
      switched: false,
      skipped: true,
      presetName: resolved.targetPreset,
      source: resolved.source,
    };
  }

  if (typeof shouldAbort === 'function' && shouldAbort()) {
    return { switched: false, superseded: true, reason: 'superseded' };
  }

  const res = await selectHostPresetByName(resolved.targetPreset, { getContext, doc });
  if (res.ok && !res.skipped) {
    if (typeof shouldAbort !== 'function' || !shouldAbort()) {
      onSwitched?.({ presetName: resolved.targetPreset, source: resolved.source });
    }
    return {
      switched: true,
      presetName: resolved.targetPreset,
      source: resolved.source,
    };
  }

  return {
    switched: false,
    skipped: Boolean(res.skipped),
    reason: res.reason || 'noop',
  };
}

/**
 * 创建切卡预设同步的「防重入串行 + 最新序号优先」调度器：
 * 确保在玩家极速连点书架切换多张卡（卡1 -> 卡2 -> 卡3）时：
 * 1. 先执行 `beforeSync`（如 flush 切卡前未落盘的预设改动）；
 * 2. 严格等待正在执行中的前序 `selectPreset` 收尾，绝不并发交错污染 `oai_settings`；
 * 3. 自动丢弃被超越的中间卡片序号，100% 精准停留在最后一张卡片的目标预设上！
 */
export function createActiveChatPresetSyncScheduler({
  runSync,
  beforeSync = null,
  isEnabled = () => true,
  setTimer = globalThis.setTimeout?.bind(globalThis) || setTimeout,
  clearTimer = globalThis.clearTimeout?.bind(globalThis) || clearTimeout,
} = {}) {
  let timerId = 0;
  let latestSeq = 0;
  let inFlight = Promise.resolve(null);

  function schedule(delayMs = 30) {
    if (timerId) {
      clearTimer(timerId);
      timerId = 0;
    }
    const seq = ++latestSeq;
    return new Promise(resolve => {
      timerId = setTimer(() => {
        timerId = 0;
        const nextTask = inFlight
          .catch(() => null)
          .then(async () => {
            if (!isEnabled() || seq !== latestSeq) {
              return { switched: false, superseded: true };
            }
            if (typeof beforeSync === 'function') {
              await beforeSync();
            }
            if (!isEnabled() || seq !== latestSeq) {
              return { switched: false, superseded: true };
            }
            const isCurrent = () => isEnabled() && seq === latestSeq;
            return await runSync({ isCurrent, shouldAbort: () => !isCurrent(), seq });
          });
        inFlight = nextTask;
        nextTask.then(resolve, err => {
          console.warn('[ST伴侣] 切卡自动切换预设跳过:', err);
          resolve({ switched: false, reason: 'error' });
        });
      }, delayMs);
    });
  }

  function cancel() {
    latestSeq += 1;
    if (timerId) {
      clearTimer(timerId);
      timerId = 0;
    }
  }

  return {
    schedule,
    cancel,
    getLatestSeq: () => latestSeq,
  };
}

// ============================================================================
// 四、预设导入脱敏 / 导出备份 / 另存副本 / 重命名 / 删除 + 第 3 单快照接口
// ============================================================================

function looksLikeValidChatCompletionPreset(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  // 排除角色卡 V2/V3 与纯世界书文件，防止误导进预设列表
  if (obj.spec === 'chara_card_v2' || obj.spec === 'chara_card_v3') return false;
  if (obj.entries && typeof obj.entries === 'object' && !Array.isArray(obj.prompts) && obj.temperature === undefined) {
    return false;
  }
  return (
    Array.isArray(obj.prompts) ||
    Array.isArray(obj.prompt_order) ||
    typeof obj.temperature === 'number' ||
    typeof obj.temp_openai === 'number' ||
    obj.openai_max_context !== undefined ||
    obj.openai_max_tokens !== undefined ||
    typeof obj.main_prompt === 'string'
  );
}

/**
 * 清洗并脱敏任意预设对象（移除反代地址、反代密码、自定义 URL 与私钥字段）。
 */
export function stripSensitivePresetFields(rawObj = {}) {
  const cloned = structuredClone(rawObj);
  for (const field of PRESET_SENSITIVE_FIELDS) {
    delete cloned[field];
  }
  for (const extra of EXTRA_STRIP_KEYS) {
    delete cloned[extra];
  }
  return cloned;
}

/**
 * 校验并清洗导入的预设 JSON 数据，自动剥离外部预设可能夹带的 `reverse_proxy` / `proxy_password` 等敏感字段。
 */
export function sanitizePresetForImport(rawInput, fallbackFileName = '导入预设') {
  let parsed = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      throw new Error(`「${fallbackFileName}」不是合法的 JSON 格式文件`);
    }
  }

  if (!looksLikeValidChatCompletionPreset(parsed)) {
    throw new Error(`「${fallbackFileName}」不是有效的酒馆对话预设 JSON（请确认未误选角色卡或世界书文件）`);
  }

  const sanitized = stripSensitivePresetFields(parsed);

  // 兼容部分旧预设仅带 temp_openai 未带 temperature 的情况
  if (sanitized.temperature === undefined && typeof sanitized.temp_openai === 'number') {
    sanitized.temperature = sanitized.temp_openai;
  }
  delete sanitized.temp_openai;

  if (!Array.isArray(sanitized.prompts)) {
    sanitized.prompts = [];
  }
  if (!Array.isArray(sanitized.prompt_order)) {
    sanitized.prompt_order = [];
  }

  const derivedName =
    cleanPresetName(fallbackFileName.replace(/[\\/:*?"<>|]/g, '_')) || '导入预设';

  return {
    name: derivedName,
    preset: sanitized,
  };
}

/**
 * 将预设对象清洗为适合导出的纯净数据结构（剥离全部连接层敏感字段）。
 */
export function sanitizePresetForExport(rawPreset = {}) {
  if (!rawPreset || typeof rawPreset !== 'object' || Array.isArray(rawPreset)) {
    return {};
  }
  const clean = stripSensitivePresetFields(rawPreset);
  if (clean.temperature === undefined && typeof clean.temp_openai === 'number') {
    clean.temperature = clean.temp_openai;
  }
  delete clean.temp_openai;
  return clean;
}

/**
 * 生成不与现有预设列表冲突的安全唯一预设名（忽略大小写判重）。
 */
export function resolveUniquePresetName(desiredName, existingNames = [], suffixLabel = '副本') {
  const rawStem = cleanPresetName(String(desiredName || '').replace(/[\\/:*?"<>|]/g, '_')) || '新建预设';
  const lowerExisting = new Set(
    (Array.isArray(existingNames) ? existingNames : [])
      .map(n => cleanPresetName(n).toLowerCase())
      .filter(Boolean),
  );

  if (!lowerExisting.has(rawStem.toLowerCase())) {
    return rawStem;
  }

  const suffix = String(suffixLabel || '副本').trim();
  const cleanStem = rawStem.replace(new RegExp(`\\s*·\\s*${suffix}(?:\\s*\\d+)?$`, 'i'), '').trim() || rawStem;
  let candidate = `${cleanStem} · ${suffix}`;
  let seq = 2;
  while (lowerExisting.has(candidate.toLowerCase())) {
    candidate = `${cleanStem} · ${suffix} ${seq}`;
    seq += 1;
  }
  return candidate;
}

function resolveHostPresetListStorage({ pm = null, openAiMod = cachedHostOpenAiMod } = {}) {
  if (pm && typeof pm.getPresetList === 'function') {
    const info = pm.getPresetList('openai');
    if (info && Array.isArray(info.presets) && info.preset_names && typeof info.preset_names === 'object') {
      return { presets: info.presets, preset_names: info.preset_names };
    }
  }
  if (
    openAiMod &&
    Array.isArray(openAiMod.openai_settings) &&
    openAiMod.openai_setting_names &&
    typeof openAiMod.openai_setting_names === 'object'
  ) {
    return { presets: openAiMod.openai_settings, preset_names: openAiMod.openai_setting_names };
  }
  return { presets: null, preset_names: null };
}

/**
 * 按预设名精准读取宿主内存中存储的预设对象（优先读取 `getPresetList('openai')` / `openai_settings[openai_setting_names[name]]`，避免未命中时触发原生 `console.error`）。
 */
export function readStoredPresetByName(
  presetName,
  { pm = null, openAiMod = cachedHostOpenAiMod } = {},
) {
  const target = cleanPresetName(presetName);
  if (!target) return null;

  const { presets, preset_names } = resolveHostPresetListStorage({ pm, openAiMod });
  if (presets && preset_names) {
    if (Array.isArray(preset_names)) {
      const idx = preset_names.indexOf(target);
      if (idx >= 0 && presets[idx] && typeof presets[idx] === 'object') {
        return presets[idx];
      }
    } else if (preset_names[target] !== undefined) {
      const slot = presets[preset_names[target]];
      if (slot && typeof slot === 'object') {
        return slot;
      }
    }
  }

  if (typeof pm?.getCompletionPresetByName === 'function') {
    const found = pm.getCompletionPresetByName(target);
    if (found && typeof found === 'object') {
      return found;
    }
  }

  return null;
}

function nextUniqueNumericOptionValue(selectEl) {
  let maxVal = -1;
  for (const opt of Array.from(selectEl?.options || [])) {
    const num = Number(opt?.value);
    if (Number.isInteger(num) && num > maxVal) {
      maxVal = num;
    }
  }
  return String(maxVal + 1);
}

function ensureSelectOptionForPreset(selectEl, savedName, optionValue, doc = globalThis.document) {
  if (!selectEl) return;
  const opts = Array.from(selectEl.options || []);
  const existing = opts.find(
    opt =>
      (optionValue !== undefined && optionValue !== '' && String(opt?.value) === String(optionValue)) ||
      cleanPresetName(String(opt?.textContent ?? opt?.text ?? '')) === savedName,
  );
  if (existing) {
    if (optionValue !== undefined && optionValue !== '') {
      existing.value = String(optionValue);
    }
    if (existing.textContent !== undefined) existing.textContent = savedName;
    if ('text' in existing) existing.text = savedName;
    return;
  }
  if (!doc?.createElement) return;
  const opt = doc.createElement('option');
  opt.value =
    optionValue !== undefined && optionValue !== ''
      ? String(optionValue)
      : nextUniqueNumericOptionValue(selectEl);
  opt.textContent = savedName;
  opt.text = savedName;
  opt.selected = false;
  selectEl.appendChild?.(opt);
}

function removeOptionFromSelect(selectEl, targetName, expectedOptionValue = '') {
  if (!selectEl?.options) return;
  const opts = Array.from(selectEl.options);
  const idx = opts.findIndex(opt => {
    if (expectedOptionValue !== '' && String(opt?.value) === String(expectedOptionValue)) {
      return true;
    }
    return cleanPresetName(String(opt?.textContent ?? opt?.text ?? '')) === targetName;
  });
  if (idx < 0) return;
  const beforeLen = selectEl.options.length;
  selectEl.options[idx]?.remove?.();
  if (Array.isArray(selectEl.options) && selectEl.options.length === beforeLen) {
    selectEl.options.splice(idx, 1);
  }
}

/**
 * 从酒馆 `ctx.chatCompletionSettings` 组装与原生 `getChatCompletionPreset` 100% 兼容的预设 JSON 体。
 */
export function buildPresetPayloadFromHost(
  ctx,
  basePreset = null,
  { openAiMod = cachedHostOpenAiMod } = {},
) {
  const oai = ctx?.chatCompletionSettings || {};
  const payload =
    basePreset && typeof basePreset === 'object' && !Array.isArray(basePreset)
      ? structuredClone(basePreset)
      : {};

  if (typeof openAiMod?.getChatCompletionPreset === 'function' && ctx?.chatCompletionSettings) {
    try {
      const fromHostBuilder = openAiMod.getChatCompletionPreset(oai);
      if (fromHostBuilder && typeof fromHostBuilder === 'object') {
        Object.assign(payload, structuredClone(fromHostBuilder));
      }
    } catch {
      // fall back to explicit OAI_PRESET_KEY_PAIRS below
    }
  }

  for (const [presetKey, oaiKey] of OAI_PRESET_KEY_PAIRS) {
    if (oai[oaiKey] !== undefined) {
      payload[presetKey] = structuredClone(oai[oaiKey]);
    }
  }

  if (payload.temperature === undefined && oai.temperature !== undefined) {
    payload.temperature = Number(oai.temperature);
  }

  return sanitizePresetForExport(payload);
}

/**
 * 供「伴侣预设助手」多步悔棋栈及自动保存队列共用：捕获当前生效预设的完整内存快照（携带锁定的目标预设名）。
 */
export function captureCurrentPresetSnapshot({
  getContext,
  openAiModule = null,
  doc = globalThis.document,
} = {}) {
  const ctx = getContext?.();
  const hostState = getHostPresetState({ getContext, doc });
  const openAiMod = openAiModule || cachedHostOpenAiMod;
  const basePreset = hostState.activePreset
    ? readStoredPresetByName(hostState.activePreset, { pm: hostState.presetManager, openAiMod })
    : null;
  const presetPayload = buildPresetPayloadFromHost(ctx, basePreset, { openAiMod });

  return {
    capturedAt: Date.now(),
    presetName: hostState.activePreset,
    isGuiPreset: hostState.isGuiPreset,
    payload: presetPayload,
  };
}

/**
 * 创建绑定「产生修改那一刻的目标预设名 + 内存快照」的防抖自动保存器：
 * - 彻底杜绝「在预设 A 修改条目后 100ms 内切到预设 B，防抖触发时误读预设 B 名字导致把 A 内容串写覆盖进 B」的高危竞态！
 * - 维护串行 `inFlightChain`，`await flush()` 保证在切换预设、重命名、另存或切卡前，旧预设 100% 完成落盘。
 */
export function createPresetAutoSaver({
  debounceMs = 350,
  captureSnapshot,
  persistSnapshot,
  onStateChange = null,
  setTimer = globalThis.setTimeout?.bind(globalThis) || setTimeout,
  clearTimer = globalThis.clearTimeout?.bind(globalThis) || clearTimeout,
} = {}) {
  let timerId = 0;
  let pendingRecord = null;
  let inFlightChain = Promise.resolve(false);
  let activeSavingCount = 0;

  function cancelTimer() {
    if (timerId) {
      clearTimer(timerId);
      timerId = 0;
    }
  }

  function enqueueRecordPersist(record) {
    if (!record?.presetName || !record?.payload) {
      return inFlightChain;
    }
    activeSavingCount += 1;
    onStateChange?.({
      tone: 'warn',
      text: '保存中…',
      saving: true,
      presetName: record.presetName,
    });

    const task = inFlightChain
      .catch(() => false)
      .then(async () => {
        try {
          const res = await persistSnapshot(record.presetName, record.payload);
          const ok = Boolean(res?.ok);
          if (activeSavingCount <= 1 && !pendingRecord) {
            onStateChange?.(
              ok
                ? { tone: 'ok', text: '已保存', saving: false, presetName: record.presetName }
                : { tone: 'idle', text: '自动保存', saving: false, presetName: record.presetName },
            );
          }
          return ok;
        } catch (err) {
          if (activeSavingCount <= 1 && !pendingRecord) {
            onStateChange?.({
              tone: 'err',
              text: '预设保存失败，请检查后端连接',
              saving: false,
              presetName: record.presetName,
              error: err,
            });
          }
          return false;
        } finally {
          activeSavingCount = Math.max(0, activeSavingCount - 1);
        }
      });

    inFlightChain = task;
    return task;
  }

  function schedule(explicitSnapshot = null) {
    const snap = explicitSnapshot || captureSnapshot?.();
    const targetName = cleanPresetName(snap?.presetName);
    if (!snap || snap.isGuiPreset || !targetName || !snap.payload) {
      onStateChange?.({
        tone: 'warn',
        text: '默认预设仅内存生效（点「另存副本」可保存为预设）',
        saving: activeSavingCount > 0,
        presetName: '',
      });
      return false;
    }

    // 若队列里尚有另一套旧预设的未发快照，立即先将旧预设独立落盘，严禁跨预设混写！
    if (pendingRecord && pendingRecord.presetName !== targetName) {
      const previous = pendingRecord;
      pendingRecord = null;
      cancelTimer();
      void enqueueRecordPersist(previous);
    }

    pendingRecord = {
      presetName: targetName,
      payload: structuredClone(snap.payload),
      capturedAt: Date.now(),
    };

    onStateChange?.({
      tone: 'warn',
      text: '待保存…',
      saving: activeSavingCount > 0,
      presetName: targetName,
    });

    cancelTimer();
    timerId = setTimer(() => {
      timerId = 0;
      if (!pendingRecord) return;
      const toSave = pendingRecord;
      pendingRecord = null;
      void enqueueRecordPersist(toSave);
    }, debounceMs);

    return true;
  }

  async function flush() {
    cancelTimer();
    if (pendingRecord) {
      const toSave = pendingRecord;
      pendingRecord = null;
      await enqueueRecordPersist(toSave);
    } else {
      await inFlightChain.catch(() => false);
    }
  }

  function cancel() {
    cancelTimer();
    pendingRecord = null;
  }

  return {
    schedule,
    flush,
    cancel,
    hasPending: () => Boolean(pendingRecord) || activeSavingCount > 0,
    isSaving: () => activeSavingCount > 0,
    getPendingPresetName: () => pendingRecord?.presetName || '',
  };
}

/**
 * 供「伴侣预设助手」一键撤回共用：将捕获的快照无损回写至宿主内存、DOM 与预设磁盘文件。
 */
export async function applyPresetSnapshotToHost(
  snapshot,
  {
    getContext,
    persistToFile = true,
    openAiModule = null,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
  } = {},
) {
  if (!snapshot?.payload || typeof snapshot.payload !== 'object') {
    return { ok: false, reason: 'invalid_snapshot' };
  }
  const ctx = getContext?.();
  const oai = ctx?.chatCompletionSettings;
  if (!oai || typeof oai !== 'object') {
    return { ok: false, reason: 'no_host_settings' };
  }

  const p = snapshot.payload;
  for (const [presetKey, oaiKey] of OAI_PRESET_KEY_PAIRS) {
    if (p[presetKey] !== undefined) {
      oai[oaiKey] = structuredClone(p[presetKey]);
    } else if (presetKey === 'extensions') {
      oai[oaiKey] = {};
    }
  }

  applyGenerationParams(
    {
      maxContext: oai.openai_max_context,
      maxTokens: oai.openai_max_tokens,
      temperature: oai.temp_openai,
    },
    { getContext, doc },
  );

  await syncHostPromptManagerAndSettings({
    getContext,
    openAiModule,
    immediateRender: true,
    structuralChange: true,
    doc,
  });

  if (persistToFile && snapshot.presetName) {
    await saveHostPreset(snapshot.presetName, p, {
      getContext,
      openAiModule,
      fetchImpl,
      updateDropdown: false,
      selectSaved: false,
      doc,
    });
  }

  return { ok: true, presetName: snapshot.presetName || '' };
}

/**
 * 底层保存预设到酒馆 `/api/presets/save` 并精准同步宿主 `openai_settings` / `openai_setting_names` 与 `<select>`：
 * - 静默原位更新或安全追加 `selected = false` 的 `<option>`，避免原生 `pm.updateList()` 无条件触发 `change` 冲掉当前正在使用的预设！
 * - 仅当 `selectSaved: true` 时显式调用 `selectHostPresetByName`（带 API 连接保护）切换至目标预设。
 */
export async function saveHostPreset(
  presetName,
  presetBody,
  {
    getContext,
    openAiModule = null,
    fetchImpl = globalThis.fetch,
    updateDropdown = false,
    selectSaved = false,
    doc = globalThis.document,
  } = {},
) {
  const cleanName = cleanPresetName(presetName);
  if (!cleanName) {
    return { ok: false, reason: 'gui_or_empty' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'no_fetch' };
  }

  const ctx = getContext?.();
  const headers =
    typeof ctx?.getRequestHeaders === 'function'
      ? ctx.getRequestHeaders()
      : { 'Content-Type': 'application/json' };

  const cleanPayload = sanitizePresetForExport(presetBody);
  const res = await fetchImpl(resolveEndpointHref('api/presets/save', doc), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      apiId: 'openai',
      name: cleanName,
      preset: cleanPayload,
    }),
  });

  if (!res?.ok) {
    throw new Error(`预设保存失败 (HTTP ${res?.status || 'ERR'})`);
  }

  const data = await res.json().catch(() => ({}));
  const savedName = cleanPresetName(data?.name || cleanName) || cleanName;

  const openAiMod = openAiModule || cachedHostOpenAiMod || (await primeHostOpenAiModule({ doc }));
  const hostState = getHostPresetState({ getContext, doc });
  const pm = hostState.presetManager;
  const selectEl = hostState.selectEl || pm?.select?.[0] || null;
  const { presets, preset_names } = resolveHostPresetListStorage({ pm, openAiMod });

  if (presets && preset_names && !Array.isArray(preset_names)) {
    const freshCopy = structuredClone(cleanPayload);
    if (preset_names[savedName] !== undefined) {
      const idx = preset_names[savedName];
      if (presets[idx] && typeof presets[idx] === 'object') {
        for (const key of Object.keys(presets[idx])) {
          delete presets[idx][key];
        }
        Object.assign(presets[idx], freshCopy);
      } else {
        presets[idx] = freshCopy;
      }
      if (updateDropdown) {
        ensureSelectOptionForPreset(selectEl, savedName, String(idx), doc);
      }
    } else {
      presets.push(freshCopy);
      const newIdx = presets.length - 1;
      preset_names[savedName] = newIdx;
      if (updateDropdown) {
        ensureSelectOptionForPreset(selectEl, savedName, String(newIdx), doc);
      }
    }
  } else if (updateDropdown && selectEl) {
    ensureSelectOptionForPreset(selectEl, savedName, '', doc);
  } else if (updateDropdown && selectSaved && typeof pm?.updateList === 'function') {
    if (ctx?.chatCompletionSettings) {
      ctx.chatCompletionSettings.bind_preset_to_connection = false;
    }
    pm.updateList(savedName, structuredClone(cleanPayload));
  }

  if (selectSaved) {
    await selectHostPresetByName(savedName, { getContext, doc });
  }

  return { ok: true, name: savedName };
}

/**
 * 将当前 `ctx.chatCompletionSettings` 里的最新参数与提示词条目落盘写回当前选中的预设文件（跳过 `gui`）。
 */
export async function persistCurrentHostPreset({
  getContext,
  openAiModule = null,
  fetchImpl = globalThis.fetch,
  doc = globalThis.document,
} = {}) {
  const ctx = getContext?.();
  const hostState = getHostPresetState({ getContext, doc });
  if (hostState.isGuiPreset || !hostState.activePreset) {
    return { ok: false, skipped: true, reason: 'gui_preset' };
  }

  const openAiMod = openAiModule || cachedHostOpenAiMod || (await primeHostOpenAiModule({ doc }));
  const basePreset = readStoredPresetByName(hostState.activePreset, {
    pm: hostState.presetManager,
    openAiMod,
  });
  const payload = buildPresetPayloadFromHost(ctx, basePreset, { openAiMod });

  return saveHostPreset(hostState.activePreset, payload, {
    getContext,
    openAiModule: openAiMod,
    fetchImpl,
    updateDropdown: false,
    selectSaved: false,
    doc,
  });
}

/**
 * 批量导入预设文件列表（支持 `{ name, content }` 数组或浏览器 `File` 对象数组）。
 */
export async function importPresetItems(
  items = [],
  {
    getContext,
    openAiModule = null,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
    selectFirstImported = false,
  } = {},
) {
  const list = Array.from(items || []);
  const imported = [];
  const failed = [];

  const hostState = getHostPresetState({ getContext, doc });
  const workingNames = [...hostState.presetNames];

  for (const item of list) {
    const fileName = String(item?.name || '导入预设.json');
    try {
      const rawContent =
        typeof item?.text === 'function'
          ? await item.text()
          : item?.content !== undefined
            ? item.content
            : item;
      const { name: baseName, preset } = sanitizePresetForImport(rawContent, fileName);
      const uniqueName = resolveUniquePresetName(baseName, workingNames, '导入');

      const saved = await saveHostPreset(uniqueName, preset, {
        getContext,
        openAiModule,
        fetchImpl,
        updateDropdown: true,
        selectSaved: false,
        doc,
      });

      if (saved.ok) {
        workingNames.push(saved.name);
        imported.push(saved.name);
      }
    } catch (err) {
      failed.push({ fileName, error: err?.message || '解析或保存失败' });
    }
  }

  if (imported.length > 0) {
    stampHostPresetImportedAt(getContext?.(), imported);
  }

  if (selectFirstImported && imported.length > 0) {
    await selectHostPresetByName(imported[0], { getContext, doc });
  }

  return { imported, failed };
}

/**
 * 将指定预设（默认当前活跃预设）序列化为干净的导出 JSON 字符串与推荐下载文件名。
 * - 若指定的是非当前激活预设（如仓库/常用列表里的其他预设），严格从宿主内存列表读取该预设自身数据，绝不误导出当前正在使用的预设！
 */
export function exportPresetToJsonString(
  presetName = '',
  { getContext, openAiModule = null, doc = globalThis.document } = {},
) {
  const ctx = getContext?.();
  const hostState = getHostPresetState({ getContext, doc });
  const explicitName = cleanPresetName(presetName);
  const targetName = explicitName || hostState.activePreset;
  const openAiMod = openAiModule || cachedHostOpenAiMod;
  const pm = hostState.presetManager;

  let dataObj = null;
  const isExportingActive = !explicitName || explicitName === hostState.activePreset;

  if (isExportingActive) {
    const base = targetName ? readStoredPresetByName(targetName, { pm, openAiMod }) : null;
    dataObj = buildPresetPayloadFromHost(ctx, base, { openAiMod });
  } else {
    const stored = readStoredPresetByName(explicitName, { pm, openAiMod });
    if (!stored) {
      return {
        ok: false,
        reason: 'preset_not_found',
        presetName: explicitName,
        fileName: '',
        jsonText: '',
      };
    }
    dataObj = sanitizePresetForExport(stored);
  }

  const safeFileStem = (targetName || '默认预设').replace(/[\\/:*?"<>|]/g, '_');
  return {
    ok: true,
    presetName: targetName || '默认预设',
    fileName: `${safeFileStem}.json`,
    jsonText: JSON.stringify(dataObj, null, 2),
  };
}

/**
 * 将当前预设（或指定预设）一键另存为 `xxx · 副本`。
 */
export async function duplicateHostPreset(
  sourcePresetName = '',
  {
    getContext,
    openAiModule = null,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
    selectDuplicate = true,
  } = {},
) {
  const ctx = getContext?.();
  const openAiMod = openAiModule || cachedHostOpenAiMod || (await primeHostOpenAiModule({ doc }));
  const hostState = getHostPresetState({ getContext, doc });
  const srcName = cleanPresetName(sourcePresetName) || hostState.activePreset;
  const pm = hostState.presetManager;

  let payload = null;
  if (srcName && srcName !== hostState.activePreset) {
    const existing = readStoredPresetByName(srcName, { pm, openAiMod });
    if (existing) payload = sanitizePresetForExport(existing);
  }
  if (!payload) {
    const base = srcName ? readStoredPresetByName(srcName, { pm, openAiMod }) : null;
    payload = buildPresetPayloadFromHost(ctx, base, { openAiMod });
  }

  const copyName = resolveUniquePresetName(srcName || '我的预设', hostState.presetNames, '副本');
  const saved = await saveHostPreset(copyName, payload, {
    getContext,
    openAiModule: openAiMod,
    fetchImpl,
    updateDropdown: true,
    selectSaved: selectDuplicate,
    doc,
  });

  if (
    saved?.ok &&
    saved.name &&
    Array.isArray(payload?.extensions?.regex_scripts) &&
    payload.extensions.regex_scripts.length > 0 &&
    ctx?.extensionSettings &&
    typeof ctx.extensionSettings === 'object'
  ) {
    const apiId = pm?.apiId || 'openai';
    const allowMap =
      ctx.extensionSettings.preset_allowed_regex &&
      typeof ctx.extensionSettings.preset_allowed_regex === 'object'
        ? ctx.extensionSettings.preset_allowed_regex
        : (ctx.extensionSettings.preset_allowed_regex = {});
    const list = Array.isArray(allowMap[apiId]) ? allowMap[apiId] : (allowMap[apiId] = []);
    const srcAllowed = !srcName || list.includes(srcName) || list.includes('gui');
    if (srcAllowed && !list.includes(saved.name)) {
      list.push(saved.name);
      ctx.saveSettingsDebounced?.();
    }
  }

  if (saved?.ok && saved.name) {
    stampHostPresetImportedAt(ctx, [saved.name]);
  }

  return saved;
}

/**
 * 按酒馆 `preset-manager.js` 标准规范删除指定预设（先确认后端删除成功，再清理 `openai_setting_names[name]` 与 `<option>`，
 * 严禁对 `openai_settings` 数组执行 `splice` 防止其余预设 `<option value="idx">` 映射错位！）。
 */
async function deletePresetFromBackendAndSyncMemory({
  target,
  ctx,
  hostState,
  openAiMod,
  fetchImpl,
  doc,
}) {
  const pm = hostState.presetManager;
  const selectEl = hostState.selectEl || pm?.select?.[0] || null;
  const { presets, preset_names } = resolveHostPresetListStorage({ pm, openAiMod });

  if (typeof fetchImpl === 'function') {
    const headers =
      typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };
    const res = await fetchImpl(resolveEndpointHref('api/presets/delete', doc), {
      method: 'POST',
      headers,
      body: JSON.stringify({ apiId: 'openai', name: target }),
    });
    if (!res?.ok) {
      return false;
    }

    let expectedValue = '';
    if (preset_names && !Array.isArray(preset_names) && preset_names[target] !== undefined) {
      const idx = preset_names[target];
      expectedValue = String(idx);
      delete preset_names[target];
      if (Array.isArray(presets) && Number.isInteger(idx) && idx >= 0 && idx < presets.length) {
        presets[idx] = undefined;
      }
    }
    removeOptionFromSelect(selectEl, target, expectedValue);

    const types = ctx?.eventTypes || ctx?.event_types;
    if (types?.PRESET_DELETED && typeof ctx?.eventSource?.emit === 'function') {
      try {
        await ctx.eventSource.emit(types.PRESET_DELETED, { apiId: 'openai', name: target });
      } catch {
        // ignore
      }
    }
    ctx?.saveSettingsDebounced?.();
    return true;
  }

  if (pm && typeof pm.deletePreset === 'function') {
    return Boolean(await pm.deletePreset(target));
  }

  return false;
}

/**
 * 重命名预设，并无损联动更新 `store.presetStudio` 中的 `defaultPreset`、`charBindings` 与 `archivedPresets`。
 */
export async function renameHostPreset({
  oldName,
  newName,
  store,
  getContext,
  openAiModule = null,
  fetchImpl = globalThis.fetch,
  doc = globalThis.document,
} = {}) {
  const fromName = cleanPresetName(oldName);
  const toName = cleanPresetName(String(newName || '').replace(/[\\/:*?"<>|]/g, '_'));
  if (!fromName || !toName) {
    throw new Error('请输入有效的预设名称');
  }
  if (fromName === toName) {
    return { ok: true, skipped: true, name: toName };
  }

  const ctx = getContext?.();
  const openAiMod = openAiModule || cachedHostOpenAiMod || (await primeHostOpenAiModule({ doc }));
  const hostState = getHostPresetState({ getContext, doc });
  const conflict = hostState.presetNames.some(
    n => n !== fromName && n.toLowerCase() === toName.toLowerCase(),
  );
  if (conflict) {
    throw new Error(`已存在同名预设「${toName}」，请换一个名称`);
  }

  const pm = hostState.presetManager;
  const wasActive = hostState.activePreset === fromName;
  const base = readStoredPresetByName(fromName, { pm, openAiMod });
  const payload = wasActive
    ? buildPresetPayloadFromHost(ctx, base, { openAiMod })
    : base
      ? sanitizePresetForExport(base)
      : buildPresetPayloadFromHost(ctx, null, { openAiMod });

  // 1. 先保存新名称预设（若原本处于激活态则平滑切过去）
  const saved = await saveHostPreset(toName, payload, {
    getContext,
    openAiModule: openAiMod,
    fetchImpl,
    updateDropdown: true,
    selectSaved: wasActive,
    doc,
  });

  // 2. 删除旧名称预设并无错位清理 openai_setting_names 与 <option>
  const refreshedState = getHostPresetState({ getContext, doc });
  await deletePresetFromBackendAndSyncMemory({
    target: fromName,
    ctx,
    hostState: refreshedState,
    openAiMod,
    fetchImpl,
    doc,
  });

  // 3. 联动迁移绑定与归档引用
  if (store?.get && store?.update) {
    const nextStudio = renamePresetReferences(store.get().presetStudio, fromName, saved.name);
    store.update({ presetStudio: nextStudio }, { silent: true });
  }

  return { ok: true, oldName: fromName, name: saved.name };
}

/**
 * 安全删除指定预设（内置防误删保护：禁止删除当前正在使用的预设或酒馆仅剩的唯一预设），并清理残留绑定引用。
 */
export async function deleteHostPreset({
  presetName,
  store,
  getContext,
  openAiModule = null,
  fetchImpl = globalThis.fetch,
  doc = globalThis.document,
} = {}) {
  const target = cleanPresetName(presetName);
  if (!target) {
    return { ok: false, reason: 'invalid_name', message: '内置默认预设不可删除' };
  }

  const hostState = getHostPresetState({ getContext, doc });
  if (hostState.presetNames.length <= 1) {
    return { ok: false, reason: 'last_preset', message: '至少保留一套预设，不可删除唯一预设' };
  }
  if (hostState.activePreset === target) {
    return { ok: false, reason: 'active_preset', message: '该预设当前正在使用中，请先切换到其他预设后再删除' };
  }

  const ctx = getContext?.();
  const openAiMod = openAiModule || cachedHostOpenAiMod || (await primeHostOpenAiModule({ doc }));
  const deletedOk = await deletePresetFromBackendAndSyncMemory({
    target,
    ctx,
    hostState,
    openAiMod,
    fetchImpl,
    doc,
  });

  if (deletedOk && store?.get && store?.update) {
    const nextStudio = cleanupDeletedPresetReferences(store.get().presetStudio, target);
    store.update({ presetStudio: nextStudio }, { silent: true });
  }

  return {
    ok: deletedOk,
    reason: deletedOk ? 'deleted' : 'request_failed',
    message: deletedOk ? `已删除预设「${target}」` : `删除预设「${target}」失败`,
  };
}

// ============================================================================
// 五、核心生成参数调节（上下文自动解锁 + 最大回复 + 温度）
// ============================================================================

/**
 * 读取当前生效的 3 个核心生成参数。
 */
export function readGenerationParams(ctx) {
  const oai = ctx?.chatCompletionSettings || {};
  const maxContext = clampInt(oai.openai_max_context, 512, UNLOCKED_MAX_CONTEXT, 32768);
  const maxTokens = clampInt(oai.openai_max_tokens, 16, 131072, 4096);
  const rawTemp = oai.temp_openai !== undefined ? oai.temp_openai : oai.temperature;
  const temperature = Math.round(clampFloat(rawTemp, 0, 2, 1) * 100) / 100;
  const maxContextUnlocked = Boolean(oai.max_context_unlocked);

  return {
    maxContext,
    maxTokens,
    temperature,
    maxContextUnlocked,
  };
}

/**
 * 实时应用生成参数到宿主 `ctx.chatCompletionSettings` 与原生 DOM 控件。
 * 若设置的 `maxContext` 超过原生当前锁定上限，自动开启 `max_context_unlocked = true` 并扩展 `#openai_max_context` 的 `max` 属性，
 * 避免被原生滑杆上限截断，同时避免误触发 `#chat_completion_source` change 冲掉自定义模型列表！
 */
export function applyGenerationParams(patch = {}, { getContext, doc = globalThis.document } = {}) {
  const ctx = getContext?.();
  const oai = ctx?.chatCompletionSettings;
  if (!oai || typeof oai !== 'object') {
    return readGenerationParams(ctx);
  }

  const EventCtor = globalThis.Event || class MockEvent { constructor(type) { this.type = type; } };

  if (patch.maxContext !== undefined) {
    const nextContext = clampInt(patch.maxContext, 512, UNLOCKED_MAX_CONTEXT, oai.openai_max_context || 32768);
    const contextInput = doc?.getElementById?.('openai_max_context');
    const counterInput = doc?.getElementById?.('openai_max_context_counter');
    const unlockCheck = doc?.getElementById?.('oai_max_context_unlocked');

    const currentDomMax = Number(contextInput?.getAttribute?.('max') || contextInput?.max || 0);
    const needsUnlock =
      (!oai.max_context_unlocked && nextContext > 128000) ||
      (currentDomMax > 0 && nextContext > currentDomMax);

    if (needsUnlock) {
      oai.max_context_unlocked = true;
      if (unlockCheck) {
        unlockCheck.checked = true;
      }
      if (contextInput) {
        contextInput.max = String(UNLOCKED_MAX_CONTEXT);
        contextInput.setAttribute?.('max', String(UNLOCKED_MAX_CONTEXT));
      }
      if (counterInput) {
        counterInput.max = String(UNLOCKED_MAX_CONTEXT);
        counterInput.setAttribute?.('max', String(UNLOCKED_MAX_CONTEXT));
      }
    }

    oai.openai_max_context = nextContext;
    if (contextInput) {
      if (Number(contextInput.max || 0) > 0 && Number(contextInput.max) < nextContext) {
        contextInput.max = String(UNLOCKED_MAX_CONTEXT);
        contextInput.setAttribute?.('max', String(UNLOCKED_MAX_CONTEXT));
      }
      contextInput.value = String(nextContext);
      contextInput.dispatchEvent?.(new EventCtor('input', { bubbles: true }));
    }
    if (counterInput) {
      counterInput.value = String(nextContext);
    }
  }

  if (patch.maxTokens !== undefined) {
    const nextTokens = clampInt(patch.maxTokens, 16, 131072, oai.openai_max_tokens || 4096);
    oai.openai_max_tokens = nextTokens;
    const tokensInput = doc?.getElementById?.('openai_max_tokens');
    if (tokensInput) {
      if (Number(tokensInput.max || 0) > 0 && Number(tokensInput.max) < nextTokens) {
        tokensInput.max = String(nextTokens);
        tokensInput.setAttribute?.('max', String(nextTokens));
      }
      tokensInput.value = String(nextTokens);
      tokensInput.dispatchEvent?.(new EventCtor('input', { bubbles: true }));
    }
  }

  if (patch.temperature !== undefined) {
    const nextTemp = Math.round(clampFloat(patch.temperature, 0, 2, oai.temp_openai ?? 1) * 100) / 100;
    oai.temp_openai = nextTemp;
    const tempInput = doc?.getElementById?.('temp_openai');
    const tempCounter = doc?.getElementById?.('temp_counter_openai');
    if (tempInput) {
      if (Number(tempInput.max || 0) > 0 && Number(tempInput.max) < nextTemp) {
        tempInput.max = '2';
        tempInput.setAttribute?.('max', '2');
      }
      tempInput.value = String(nextTemp);
      tempInput.dispatchEvent?.(new EventCtor('input', { bubbles: true }));
    }
    if (tempCounter) {
      tempCounter.value = nextTemp.toFixed(2);
    }
  }

  ctx?.saveSettingsDebounced?.();
  return readGenerationParams(ctx);
}

// ============================================================================
// 六、提示词条目 (`prompts` + `prompt_order`) 读写增删改排引擎
// ============================================================================

/**
 * 解析当前生效的 `prompt_order` 槽位（优先匹配活跃 `promptManager.activeCharacter.id` -> `100001` -> `100000` -> 首项）。
 */
export function resolveActivePromptOrderBucket(
  oaiSettings,
  { promptManager = cachedHostOpenAiMod?.promptManager ?? null, ensureIfMissing = false } = {},
) {
  if (!oaiSettings || typeof oaiSettings !== 'object') return null;

  if (!Array.isArray(oaiSettings.prompts)) {
    oaiSettings.prompts = [];
  }
  if (!Array.isArray(oaiSettings.prompt_order)) {
    oaiSettings.prompt_order = [];
  }

  const list = oaiSettings.prompt_order;
  const pmCharId = promptManager?.activeCharacter?.id;

  let bucket = null;
  if (pmCharId !== undefined && pmCharId !== null) {
    bucket = list.find(item => item && String(item.character_id) === String(pmCharId)) || null;
  }
  if (!bucket) {
    bucket = list.find(item => item && Number(item.character_id) === 100001) || null;
  }
  if (!bucket) {
    bucket = list.find(item => item && Number(item.character_id) === 100000) || null;
  }
  if (!bucket && list.length > 0) {
    bucket = list[0];
  }

  if (!bucket && ensureIfMissing) {
    const defaultCharId = pmCharId !== undefined && pmCharId !== null ? pmCharId : 100001;
    bucket = {
      character_id: defaultCharId,
      order: oaiSettings.prompts
        .filter(p => p && typeof p.identifier === 'string')
        .map(p => ({
          identifier: p.identifier,
          enabled: p.enabled !== undefined ? Boolean(p.enabled) : true,
        })),
    };
    oaiSettings.prompt_order.push(bucket);
  }

  if (bucket && !Array.isArray(bucket.order)) {
    bucket.order = [];
  }

  return bucket;
}

/**
 * 按真实发送顺序读取当前预设的合并提示词条目列表与启用统计。
 */
export function readOrderedPromptEntries(
  oaiSettings,
  { promptManager = cachedHostOpenAiMod?.promptManager ?? null } = {},
) {
  const prompts = Array.isArray(oaiSettings?.prompts) ? oaiSettings.prompts : [];
  const promptById = new Map();
  for (const p of prompts) {
    if (p && typeof p.identifier === 'string') {
      promptById.set(p.identifier, p);
    }
  }

  const bucket = resolveActivePromptOrderBucket(oaiSettings, { promptManager, ensureIfMissing: false });
  const rawOrder =
    bucket && Array.isArray(bucket.order) && bucket.order.length > 0
      ? bucket.order
      : prompts
          .filter(p => p && typeof p.identifier === 'string')
          .map(p => ({ identifier: p.identifier, enabled: p.enabled !== undefined ? Boolean(p.enabled) : true }));

  const entries = [];
  let enabledCount = 0;
  let markerCount = 0;

  for (let i = 0; i < rawOrder.length; i += 1) {
    const ref = rawOrder[i];
    if (!ref || typeof ref.identifier !== 'string') continue;
    const prompt = promptById.get(ref.identifier);
    if (!prompt) continue;

    const identifier = prompt.identifier;
    const isMarker = Boolean(prompt.marker);
    const isSystemPrompt = Boolean(prompt.system_prompt) || SYSTEM_PROTECTED_PROMPT_IDS.has(identifier);
    const enabled = Boolean(ref.enabled);
    const role = ['system', 'user', 'assistant'].includes(prompt.role) ? prompt.role : 'system';
    const roleMeta = PROMPT_ROLE_OPTIONS.find(r => r.id === role) || PROMPT_ROLE_OPTIONS[0];
    const injectionPosition = Number(prompt.injection_position) === 1 ? 1 : 0;
    const injectionDepth = clampInt(prompt.injection_depth, 0, 999, 4);
    const injectionOrder = clampInt(prompt.injection_order, -999, 9999, 100);

    if (enabled) enabledCount += 1;
    if (isMarker) markerCount += 1;

    entries.push({
      index: entries.length,
      identifier,
      name: String(prompt.name || identifier),
      enabled,
      role,
      roleBadge: roleMeta.shortLabel,
      content: typeof prompt.content === 'string' ? prompt.content : '',
      isMarker,
      isSystemPrompt,
      canDelete: !isMarker && !isSystemPrompt,
      canEditContent: !isMarker,
      markerHint: isMarker
        ? MARKER_DESCRIPTIONS[identifier] || '系统动态占位槽：由酒馆在发送请求时自动注入对应上下文模块'
        : '',
      injectionPosition,
      injectionDepth,
      injectionOrder,
    });
  }

  return {
    characterId: bucket?.character_id ?? 100001,
    entries,
    enabledCount,
    totalCount: entries.length,
    markerCount,
  };
}

/**
 * 过滤提示词条目列表（支持名称/正文关键词秒搜 + `all` / `enabled` / `hide_markers` 模式）。
 */
export function filterPromptEntries(entries = [], { query = '', filterMode = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(entries) ? entries : []).filter(entry => {
    if (filterMode === 'enabled' && !entry.enabled) return false;
    if (filterMode === 'hide_markers' && entry.isMarker) return false;
    if (!q) return true;
    return (
      entry.name.toLowerCase().includes(q) ||
      entry.identifier.toLowerCase().includes(q) ||
      entry.content.toLowerCase().includes(q)
    );
  });
}

/**
 * 切换或指定某条提示词条目的启用状态 (`enabled`)。
 */
export function togglePromptEntryEnabled(
  oaiSettings,
  identifier,
  forcedState = null,
  { promptManager = cachedHostOpenAiMod?.promptManager ?? null } = {},
) {
  const bucket = resolveActivePromptOrderBucket(oaiSettings, { promptManager, ensureIfMissing: true });
  if (!bucket) return null;

  const targetRef = bucket.order.find(item => item && item.identifier === identifier);
  if (!targetRef) return null;

  const nextVal = typeof forcedState === 'boolean' ? forcedState : !targetRef.enabled;
  targetRef.enabled = nextVal;

  const prompt = (oaiSettings?.prompts || []).find(p => p && p.identifier === identifier);
  if (prompt && 'enabled' in prompt) {
    prompt.enabled = nextVal;
  }

  return nextVal;
}

/**
 * 调整提示词条目在发送序列中的先后顺序（支持 `'up'`、`'down'` 或目标索引）。
 */
export function movePromptEntryOrder(
  oaiSettings,
  identifier,
  directionOrTargetIndex,
  { promptManager = cachedHostOpenAiMod?.promptManager ?? null } = {},
) {
  const bucket = resolveActivePromptOrderBucket(oaiSettings, { promptManager, ensureIfMissing: true });
  if (!bucket || bucket.order.length <= 1) return false;

  const fromIdx = bucket.order.findIndex(item => item && item.identifier === identifier);
  if (fromIdx < 0) return false;

  let toIdx = fromIdx;
  if (directionOrTargetIndex === 'up') {
    toIdx = fromIdx - 1;
  } else if (directionOrTargetIndex === 'down') {
    toIdx = fromIdx + 1;
  } else if (typeof directionOrTargetIndex === 'number' && Number.isFinite(directionOrTargetIndex)) {
    toIdx = Math.max(0, Math.min(bucket.order.length - 1, Math.round(directionOrTargetIndex)));
  }

  if (toIdx < 0 || toIdx >= bucket.order.length || toIdx === fromIdx) {
    return false;
  }

  const [moved] = bucket.order.splice(fromIdx, 1);
  bucket.order.splice(toIdx, 0, moved);
  return true;
}

/**
 * 更新普通提示词条目的名称、角色、注入方式/深度与正文内容（自动保护 `marker: true` 系统占位槽不被误改坏）。
 */
export function updatePromptEntryFields(oaiSettings, identifier, patch = {}) {
  const prompts = Array.isArray(oaiSettings?.prompts) ? oaiSettings.prompts : [];
  const prompt = prompts.find(p => p && p.identifier === identifier);
  if (!prompt) return { ok: false, reason: 'not_found' };

  if (prompt.marker) {
    return { ok: false, reason: 'marker_protected' };
  }

  if (typeof patch.name === 'string') {
    const trimmedName = patch.name.trim();
    if (trimmedName) {
      prompt.name = trimmedName.slice(0, 160);
    }
  }

  if (patch.role !== undefined && ['system', 'user', 'assistant'].includes(patch.role)) {
    prompt.role = patch.role;
  }

  if (patch.injectionPosition !== undefined || patch.injection_position !== undefined) {
    const rawPos = patch.injectionPosition ?? patch.injection_position;
    prompt.injection_position = Number(rawPos) === 1 ? 1 : 0;
  }

  if (patch.injectionDepth !== undefined || patch.injection_depth !== undefined) {
    const rawDepth = patch.injectionDepth ?? patch.injection_depth;
    prompt.injection_depth = clampInt(rawDepth, 0, 999, 4);
  }

  if (patch.injectionOrder !== undefined || patch.injection_order !== undefined) {
    const rawOrd = patch.injectionOrder ?? patch.injection_order;
    prompt.injection_order = clampInt(rawOrd, -999, 9999, 100);
  }

  if (typeof patch.content === 'string') {
    prompt.content = patch.content;
  }

  return { ok: true, prompt };
}

/**
 * 新增一条用户自定义提示词条目，并挂载到活跃 `prompt_order` 发送序列中。
 */
export function createCustomPromptEntry(
  oaiSettings,
  initial = {},
  { insertIndex = -1, promptManager = cachedHostOpenAiMod?.promptManager ?? null } = {},
) {
  const bucket = resolveActivePromptOrderBucket(oaiSettings, { promptManager, ensureIfMissing: true });
  if (!bucket) return null;

  const usedIds = new Set((oaiSettings.prompts || []).map(p => p?.identifier).filter(Boolean));
  let identifier = typeof initial.identifier === 'string' && initial.identifier.trim() ? initial.identifier.trim() : generateUuid();
  while (usedIds.has(identifier)) {
    identifier = generateUuid();
  }

  const enabled = initial.enabled !== undefined ? Boolean(initial.enabled) : true;
  const role = ['system', 'user', 'assistant'].includes(initial.role) ? initial.role : 'system';

  const newPrompt = {
    identifier,
    name: String(initial.name || '新建提示词条目').trim().slice(0, 160) || '新建提示词条目',
    system_prompt: false,
    marker: false,
    enabled,
    role,
    content: typeof initial.content === 'string' ? initial.content : '',
    injection_position: Number(initial.injection_position ?? initial.injectionPosition) === 1 ? 1 : 0,
    injection_depth: clampInt(initial.injection_depth ?? initial.injectionDepth, 0, 999, 4),
    injection_order: clampInt(initial.injection_order ?? initial.injectionOrder, -999, 9999, 100),
    forbid_overrides: false,
    extension: false,
    injection_trigger: [],
  };

  oaiSettings.prompts.push(newPrompt);

  const orderItem = { identifier, enabled };
  if (typeof insertIndex === 'number' && insertIndex >= 0 && insertIndex <= bucket.order.length) {
    bucket.order.splice(insertIndex, 0, orderItem);
  } else {
    bucket.order.push(orderItem);
  }

  return newPrompt;
}

/**
 * 一键克隆指定提示词条目（系统动态占位槽 `marker: true` 不可复制；内置 `main`/`nsfw` 等可复制为独立自定义条目）：
 * - 自动剥离叠加的 `· 副本` 尾巴并生成唯一名称（`xxx · 副本`、`xxx · 副本 2`）；
 * - 默认置于原条目正下方（`srcOrderIdx + 1`），默认 `enabled: false` 防止玩家尚未编辑完就双倍重复发送。
 */
export function duplicatePromptEntry(
  oaiSettings,
  sourceIdentifier,
  { enabled = false, promptManager = cachedHostOpenAiMod?.promptManager ?? null } = {},
) {
  const prompts = Array.isArray(oaiSettings?.prompts) ? oaiSettings.prompts : [];
  const srcPrompt = prompts.find(p => p && p.identifier === sourceIdentifier);
  if (!srcPrompt) {
    return { ok: false, reason: 'not_found' };
  }
  if (srcPrompt.marker) {
    return { ok: false, reason: 'marker_protected' };
  }

  const bucket = resolveActivePromptOrderBucket(oaiSettings, { promptManager, ensureIfMissing: true });
  if (!bucket) {
    return { ok: false, reason: 'no_bucket' };
  }

  const rawBaseName = String(srcPrompt.name || sourceIdentifier).trim() || '提示词条目';
  const cleanStem = rawBaseName.replace(/(?:\s*·\s*副本(?:\s+\d+)?)+$/u, '').trim() || rawBaseName;
  const existingNamesLower = new Set(
    prompts.map(p => String(p?.name || '').trim().toLowerCase()).filter(Boolean),
  );

  let copyName = `${cleanStem} · 副本`.slice(0, 160);
  let seq = 2;
  while (existingNamesLower.has(copyName.toLowerCase())) {
    const suffix = ` · 副本 ${seq}`;
    copyName = `${cleanStem.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
    seq += 1;
  }

  const srcOrderIdx = bucket.order.findIndex(item => item && item.identifier === sourceIdentifier);
  const insertIndex = srcOrderIdx >= 0 ? srcOrderIdx + 1 : bucket.order.length;

  const created = createCustomPromptEntry(
    oaiSettings,
    {
      name: copyName,
      enabled: Boolean(enabled),
      role: srcPrompt.role,
      content: typeof srcPrompt.content === 'string' ? srcPrompt.content : '',
      injection_position: srcPrompt.injection_position,
      injection_depth: srcPrompt.injection_depth,
      injection_order: srcPrompt.injection_order,
    },
    { insertIndex, promptManager },
  );

  if (!created) {
    return { ok: false, reason: 'create_failed' };
  }

  created.forbid_overrides = Boolean(srcPrompt.forbid_overrides);
  created.injection_trigger = Array.isArray(srcPrompt.injection_trigger)
    ? [...srcPrompt.injection_trigger]
    : [];

  return { ok: true, prompt: created, insertIndex };
}

/**
 * 安全删除用户自建提示词条目（系统内置 `main` / `nsfw` / `jailbreak` / `enhanceDefinitions` 及 `marker` 严禁物理删除）。
 */
export function deleteCustomPromptEntry(oaiSettings, identifier) {
  const prompts = Array.isArray(oaiSettings?.prompts) ? oaiSettings.prompts : [];
  const idx = prompts.findIndex(p => p && p.identifier === identifier);
  if (idx < 0) {
    return { ok: false, reason: 'not_found' };
  }

  const target = prompts[idx];
  if (target.system_prompt || target.marker || SYSTEM_PROTECTED_PROMPT_IDS.has(identifier)) {
    return { ok: false, reason: 'system_protected' };
  }

  prompts.splice(idx, 1);

  if (Array.isArray(oaiSettings?.prompt_order)) {
    for (const bucket of oaiSettings.prompt_order) {
      if (!Array.isArray(bucket?.order)) continue;
      bucket.order = bucket.order.filter(item => item && item.identifier !== identifier);
    }
  }

  return { ok: true, deletedId: identifier };
}

/**
 * 同步宿主原生 `promptManager`（Token 计数缓存清理、原生列表重绘、快捷编辑框 `main`/`nsfw`/`jailbreak`）与 `saveSettingsDebounced`。
 * - `immediateRender: false` 用于高频打字输入，自动合批防抖调用 `pm.render(false)` 避免逐字符重建原生 DOM 与 Sortable。
 */
export async function syncHostPromptManagerAndSettings({
  getContext,
  promptManager = null,
  openAiModule = null,
  changedPromptId = '',
  immediateRender = true,
  structuralChange = false,
  doc = globalThis.document,
} = {}) {
  const ctx = getContext?.();
  const oai = ctx?.chatCompletionSettings;

  let pm = promptManager;
  if (!pm) {
    const mod = openAiModule || cachedHostOpenAiMod || (await primeHostOpenAiModule({ doc }));
    pm = mod?.promptManager || ctx?.promptManager || null;
  }

  // 1. 立即失效被修改条目的 Token 计数缓存，防止原生 #completion_prompt_manager_list 显示旧 Token 数
  if (pm?.tokenHandler) {
    try {
      const counts = pm.tokenHandler.getCounts?.();
      if (changedPromptId && counts && typeof counts === 'object') {
        counts[changedPromptId] = null;
      } else if (!changedPromptId && typeof pm.tokenHandler.resetCounts === 'function') {
        pm.tokenHandler.resetCounts();
      }
    } catch {
      // ignore
    }
  }

  // 2. 若发生条目新增/删除等结构变更，同步清理原生编辑弹窗缓存与孤儿引用
  if (pm && structuralChange) {
    try {
      pm.sanitizeServiceSettings?.();
      pm.hidePopup?.();
      pm.clearEditForm?.();
    } catch {
      // ignore
    }
  }

  // 3. 若修改了内置三大快捷框对应条目，立即同步原生隐藏 textarea 值（防原生 blur 反写旧内容）
  if (oai?.prompts && (!changedPromptId || ['main', 'nsfw', 'jailbreak'].includes(changedPromptId))) {
    for (const quickId of ['main', 'nsfw', 'jailbreak']) {
      if (changedPromptId && changedPromptId !== quickId) continue;
      const p = oai.prompts.find(item => item?.identifier === quickId);
      if (!p) continue;
      if (typeof pm?.updateQuickEdit === 'function') {
        try {
          pm.updateQuickEdit(quickId, p);
        } catch {
          // ignore
        }
      } else {
        const quickEl = doc?.getElementById?.(`${quickId}_prompt_quick_edit_textarea`);
        if (quickEl && typeof p.content === 'string') {
          quickEl.value = p.content;
        }
      }
    }
  }

  // 4. 同步原生 #completion_prompt_manager_list 列表视图
  if (pm && typeof pm.render === 'function') {
    if (immediateRender) {
      if (hostPmRenderTimer) {
        clearTimeout(hostPmRenderTimer);
        hostPmRenderTimer = 0;
      }
      try {
        pm.render(false);
      } catch {
        // ignore
      }
    } else {
      if (hostPmRenderTimer) {
        clearTimeout(hostPmRenderTimer);
      }
      hostPmRenderTimer = setTimeout(() => {
        hostPmRenderTimer = 0;
        try {
          pm.render(false);
        } catch {
          // ignore
        }
      }, 280);
    }
  }

  if (typeof ctx?.saveSettingsDebounced === 'function') {
    ctx.saveSettingsDebounced();
  } else if (typeof pm?.saveServiceSettings === 'function') {
    try {
      pm.saveServiceSettings();
    } catch {
      // ignore
    }
  }
}
