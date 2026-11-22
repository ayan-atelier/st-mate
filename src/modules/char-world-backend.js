/**
 * ST伴侣 (st-mate) · 「角色档案与清爽世界书一体页」纯数据模型与持久化引擎
 * 职责边界：
 * 1. 角色档案读取（单人角色卡 & 群聊态）、V1 顶层 + V2 data.* 自动双写保存（数组全量替换防残尾/空洞，100% 通过 TavernCardValidator）；
 * 2. 开场白汇总预览、增删改备用开场白，以及「开局第 1 楼一键无损切换开场白」与导出前自动 flush 的 PNG/JSON 角色卡导出；
 * 3. 动态桥接官方 `scripts/world-info.js`（`loadWorldInfo` / `saveWorldInfo(name, cloned, true)`），四源聚合生效世界书（角色主书 / 角色附加书 / 当前聊天书 / 全局开启）；
 * 4. 根治假生效护栏：未启用世界书强预警一键绑定、预设 `worldInfoBefore` / `worldInfoAfter` 槽位双关自检一键修复、绿灯空触发词预警；
 * 5. 人话蓝绿灯切换、中英文逗号关键词解析、条目增删改搜与 300ms 锁死 `{ bookName, dataSnapshot }` 防串书自动落盘队列。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.9.0';
import { saveExportBlob } from '../core/file-saver.js?v=0.9.0';
import {
  captureCurrentPresetSnapshot,
  getEntityBindingKey,
  getHostPresetState,
  primeHostOpenAiModule,
  readOrderedPromptEntries,
  saveHostPreset,
  syncHostPromptManagerAndSettings,
  togglePromptEntryEnabled,
} from './preset-backend.js?v=0.9.0';

export const WORLD_INFO_AUTO_SAVE_MS = 300;
export const CHAR_PROFILE_AUTO_SAVE_MS = 350;

export const WI_POSITION_OPTIONS = Object.freeze([
  { value: 0, key: 'before', label: '角色定义之前', shortLabel: '↑角色前' },
  { value: 1, key: 'after', label: '角色定义之后', shortLabel: '↓角色后' },
  { value: 4, key: 'atDepth', label: '聊天记录深度 @D', shortLabel: '@D 深度' },
  { value: 2, key: 'ANTop', label: '作者注释之前', shortLabel: '↑注释前' },
  { value: 3, key: 'ANBottom', label: '作者注释之后', shortLabel: '↓注释后' },
  { value: 5, key: 'EMTop', label: '示例对话之前', shortLabel: '↑示例前' },
  { value: 6, key: 'EMBottom', label: '示例对话之后', shortLabel: '↓示例后' },
  { value: 7, key: 'outlet', label: 'Outlet 插槽', shortLabel: 'Outlet', advancedOnly: true },
]);

export const WI_DEPTH_ROLE_OPTIONS = Object.freeze([
  { value: 0, label: 'System · 系统指令', shortLabel: 'SYS' },
  { value: 1, label: 'User · 用户口吻', shortLabel: 'USER' },
  { value: 2, label: 'Assistant · AI口吻', shortLabel: 'AI' },
]);

export const WI_SOURCE_LABELS = Object.freeze({
  char_primary: '角色主书',
  char_extra: '角色附加书',
  chat: '当前聊天书',
  global: '全局开启',
  group_member: '群成员书',
});

const WI_SOURCE_PRIORITY = Object.freeze([
  'char_primary',
  'char_extra',
  'chat',
  'global',
  'group_member',
]);

/**
 * 与 SillyTavern `public/scripts/world-info.js` `newWorldInfoEntryTemplate` 1:1 对齐的完整默认条目骨架，
 * 确保离线/回退模式下新建的条目字段完备、100% 兼容原生世界书编辑器。
 */
export const DEFAULT_WI_ENTRY_TEMPLATE = Object.freeze({
  key: [],
  keysecondary: [],
  comment: '',
  content: '',
  constant: false,
  vectorized: false,
  selective: true,
  selectiveLogic: 0,
  addMemo: true,
  order: 100,
  position: 0,
  disable: false,
  ignoreBudget: false,
  excludeRecursion: false,
  preventRecursion: false,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  delayUntilRecursion: 0,
  probability: 100,
  useProbability: true,
  depth: 4,
  outletName: '',
  group: '',
  groupOverride: false,
  groupWeight: 100,
  scanDepth: null,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: '',
  role: 0,
  sticky: null,
  cooldown: null,
  delay: null,
  triggers: [],
});

let hostWorldInfoModPromise = null;
let cachedHostWorldInfoMod = null;
let hostCoreModPromise = null;
let cachedHostCoreMod = null;
let hostRegexModPromise = null;
let cachedHostRegexMod = null;

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
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

function resolveRelativeAsset(relPath, doc = globalThis.document) {
  if (!relPath || typeof relPath !== 'string') return '';
  const trimmed = relPath.trim();
  if (!trimmed) return '';
  if (/^(?:https?:|blob:|data:)/i.test(trimmed)) return trimmed;
  const clean = trimmed.replace(/^\/+/, '');
  const base = resolveHostBaseHref(doc);
  if (base) {
    try {
      return new URL(clean, base).href;
    } catch {
      // fall through
    }
  }
  return clean;
}

/**
 * 动态桥接酒馆官方 `scripts/world-info.js` 模块（支持桌面 http(s) 与移动端 Tauri/Capacitor/App 协议，单测可显式注入）。
 */
export async function primeHostWorldInfoModule({
  worldInfoModule = null,
  doc = globalThis.document,
} = {}) {
  if (worldInfoModule !== undefined && worldInfoModule !== null) {
    cachedHostWorldInfoMod = worldInfoModule;
    return cachedHostWorldInfoMod;
  }
  if (cachedHostWorldInfoMod) return cachedHostWorldInfoMod;
  const base = resolveHostBaseHref(doc);
  if (!base) return null;
  hostWorldInfoModPromise ||= import(new URL('scripts/world-info.js', base).href)
    .then(mod => {
      cachedHostWorldInfoMod = mod || null;
      return cachedHostWorldInfoMod;
    })
    .catch(() => {
      hostWorldInfoModPromise = null;
      return null;
    });
  return hostWorldInfoModPromise;
}

export function getCachedHostWorldInfoModule() {
  return cachedHostWorldInfoMod;
}

export function resetCachedHostWorldInfoModule() {
  cachedHostWorldInfoMod = null;
  hostWorldInfoModPromise = null;
  cachedHostCoreMod = null;
  hostCoreModPromise = null;
  cachedHostRegexMod = null;
  hostRegexModPromise = null;
}

/**
 * 按需动态加载酒馆核心 `script.js`（用于第 1 楼替换开场白后原位调用 `updateMessageBlock` 重绘气泡）。
 */
export async function primeHostCoreModule({
  coreModule = null,
  doc = globalThis.document,
} = {}) {
  if (coreModule !== undefined && coreModule !== null) {
    cachedHostCoreMod = coreModule;
    return cachedHostCoreMod;
  }
  if (cachedHostCoreMod) return cachedHostCoreMod;
  const base = resolveHostBaseHref(doc);
  if (!base) return null;
  hostCoreModPromise ||= import(new URL('script.js', base).href)
    .then(mod => {
      cachedHostCoreMod = mod || null;
      return cachedHostCoreMod;
    })
    .catch(() => {
      hostCoreModPromise = null;
      return null;
    });
  return hostCoreModPromise;
}

/**
 * 按需动态加载酒馆官方正则引擎 `scripts/extensions/regex/engine.js`（对齐 `script.js` `getFirstMessage` 存盘前 `AI_OUTPUT` 正则处理）。
 */
export async function primeHostRegexModule({
  regexModule = null,
  doc = globalThis.document,
} = {}) {
  if (regexModule !== undefined && regexModule !== null) {
    cachedHostRegexMod = regexModule;
    return cachedHostRegexMod;
  }
  if (cachedHostRegexMod) return cachedHostRegexMod;
  const base = resolveHostBaseHref(doc);
  if (!base) return null;
  hostRegexModPromise ||= import(new URL('scripts/extensions/regex/engine.js', base).href)
    .then(mod => {
      cachedHostRegexMod = mod || null;
      return cachedHostRegexMod;
    })
    .catch(() => {
      hostRegexModPromise = null;
      return null;
    });
  return hostRegexModPromise;
}

/**
 * 精准对齐酒馆 `script.js:1808` (`messageFormatting` 对 `messageId === 0` 的宏展开契约)：
 * 优先调用宿主官方 `ctx.substituteParams(text, undefined, charName)`；
 * 若离线/测试环境未挂载 `substituteParams`，则安全解析常见 `{{user}}` / `<USER>` 与 `{{char}}` / `<BOT>` 宏，确保第 1 楼绝不裸露未解析占位符。
 */
export function substituteOpeningGreetingMacros(rawText, { ctx = null, charName = '' } = {}) {
  const source = String(rawText ?? '');
  if (!source) return '';

  const effectiveCharName = String(charName || ctx?.name2 || '').trim();
  if (typeof ctx?.substituteParams === 'function') {
    try {
      const replaced = ctx.substituteParams(source, undefined, effectiveCharName || undefined);
      if (typeof replaced === 'string') {
        return replaced;
      }
    } catch {
      // fall through to safe fallback macro expansion
    }
  }

  let out = source;
  const userName = typeof ctx?.name1 === 'string' && ctx.name1.trim() ? ctx.name1.trim() : '';
  if (userName) {
    out = out.replace(/\{\{\s*user\s*\}\}|<USER>/gi, () => userName);
  }
  if (effectiveCharName) {
    out = out.replace(/\{\{\s*char\s*\}\}|<BOT>|<CHAR>/gi, () => effectiveCharName);
  }
  return out;
}

export function countUnicodeChars(text) {
  if (typeof text !== 'string' || !text) return 0;
  return Array.from(text).length;
}

/**
 * 提取角色卡在本机的导入时间戳（毫秒）：
 * - 优先读取酒馆服务端 `charStat.ctimeMs` 映射的 `char.date_added`；
 * - 兼容回退 ISO 日期或酒馆 `YYYY-MM-DD @HHh MMm SSs` 形态的 `create_date`。
 */
export function parseCharacterAddedAt(char) {
  if (!char || typeof char !== 'object') return 0;
  const rawAdded = char.date_added;
  if (rawAdded !== undefined && rawAdded !== null && rawAdded !== '') {
    const num = Number(rawAdded);
    if (Number.isFinite(num) && num > 0) {
      return num < 1e11 ? Math.round(num * 1000) : Math.round(num);
    }
    const parsed = Date.parse(String(rawAdded));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const rawCreate = String(char.create_date || char.data?.create_date || '').trim();
  if (!rawCreate) return 0;
  const direct = Date.parse(rawCreate);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const stMatch = rawCreate.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s*@?\s*(\d{1,2})h\s*(\d{1,2})m(?:\s*(\d{1,2})s)?)?/i,
  );
  if (stMatch) {
    const dt = new Date(
      Number(stMatch[1]),
      Number(stMatch[2]) - 1,
      Number(stMatch[3]),
      Number(stMatch[4] || 0),
      Number(stMatch[5] || 0),
      Number(stMatch[6] || 0),
    );
    const ms = dt.getTime();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return 0;
}

export function cleanWorldBookName(rawName) {
  if (typeof rawName !== 'string') return '';
  const cleaned = rawName
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 180);
  if (!cleaned || /^\.+$/.test(cleaned)) return '';
  return cleaned;
}

export function sanitizeExportFileStem(rawName, fallback = 'character') {
  const cleaned = String(rawName ?? '')
    .trim()
    .replace(/\.(?:png|webp|jpg|jpeg|json|charx)$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 140);
  if (!cleaned || /^\.+$/.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

// ============================================================================
// 一、角色档案读取、V1+V2 一致性双写保存、开场白管理与第 1 楼无损替换、PNG/JSON 导出
// ============================================================================

/**
 * 判断当前对话是否满足「开局第 1 楼直接替换开场白」的安全条件：
 * 仅单人角色对话且 `ctx.chat.length === 1 && !ctx.chat[0]?.is_user` 时返回 `allowed: true`。
 */
export function canReplaceOpeningGreetingInChat(ctx) {
  if (!ctx || !hasActiveChatSelection(ctx)) {
    return { allowed: false, reason: 'no_active_chat', hint: '当前未打开对话' };
  }
  if (ctx.groupId !== undefined && ctx.groupId !== null && String(ctx.groupId).trim() !== '') {
    return { allowed: false, reason: 'group_chat', hint: '群聊模式不支持单卡第1楼替换' };
  }
  if (!Array.isArray(ctx.chat) || ctx.chat.length === 0) {
    return { allowed: false, reason: 'empty_chat', hint: '当前对话尚无开局第1楼消息' };
  }
  if (ctx.chat.length > 1) {
    return {
      allowed: false,
      reason: 'beyond_first_floor',
      hint: '已进入后续对话（仅开局第1楼可直接替换）',
    };
  }
  if (ctx.chat[0]?.is_user) {
    return {
      allowed: false,
      reason: 'user_first_floor',
      hint: '第1楼为用户消息（仅角色开场楼层可替换）',
    };
  }
  return {
    allowed: true,
    reason: 'ok',
    hint: '当前处于开局第1楼，可一键无损切换开场白',
  };
}

function buildCharPortraitUrls(avatarFile, ctx, doc = globalThis.document) {
  const cleanAvatar = typeof avatarFile === 'string' ? avatarFile.trim() : '';
  if (!cleanAvatar) {
    const fallback = resolveRelativeAsset('img/ai4.png', doc);
    return { thumbUrl: fallback, portraitUrl: fallback };
  }
  const encoded = `characters/${encodeURIComponent(cleanAvatar)}`;
  const portraitUrl = resolveRelativeAsset(encoded, doc);
  let thumbUrl = portraitUrl;
  if (typeof ctx?.getThumbnailUrl === 'function') {
    try {
      thumbUrl = ctx.getThumbnailUrl('avatar', cleanAvatar) || portraitUrl;
    } catch {
      thumbUrl = portraitUrl;
    }
  }
  return { thumbUrl, portraitUrl };
}

/**
 * 读取当前活跃聊天实体的完整档案（支持单人角色卡详情与群聊成员速览）。
 */
export function readActiveCharacterProfile(ctx, { doc = globalThis.document } = {}) {
  if (!hasActiveChatSelection(ctx)) {
    return {
      active: false,
      kind: 'none',
      entityKey: '',
      name: '',
      thumbUrl: '',
      portraitUrl: '',
    };
  }

  const entityKey = getEntityBindingKey(ctx);

  // 1. 群聊模式：返回群头像、群名称、群专属绑定键与成员速览
  if (ctx.groupId !== undefined && ctx.groupId !== null && String(ctx.groupId).trim() !== '') {
    const groupId = String(ctx.groupId).trim();
    const group = (Array.isArray(ctx.groups) ? ctx.groups : []).find(
      g => g && String(g.id) === groupId,
    );
    const avatarUrl = group?.avatar_url
      ? resolveRelativeAsset(String(group.avatar_url), doc)
      : resolveRelativeAsset('img/five.png', doc);
    const rawMembers = Array.isArray(group?.members) ? group.members : [];
    const disabledSet = new Set(Array.isArray(group?.disabled_members) ? group.disabled_members : []);
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];

    const members = rawMembers.map(avatar => {
      const ch = characters.find(item => item && item.avatar === avatar) || null;
      const urls = buildCharPortraitUrls(avatar, ctx, doc);
      return {
        avatar: String(avatar || ''),
        name: String(ch?.name || String(avatar || '').replace(/\.[^/.]+$/, '') || '成员'),
        thumbUrl: urls.thumbUrl,
        primaryWorld: String(ch?.data?.extensions?.world || '').trim(),
        disabled: disabledSet.has(avatar),
      };
    });

    return {
      active: true,
      kind: 'group',
      groupId,
      entityKey,
      name: String(group?.name || '群聊'),
      thumbUrl: avatarUrl,
      portraitUrl: avatarUrl,
      members,
      canExport: false,
      canReplaceFirstFloor: false,
      firstFloorHint: '群聊模式不支持单卡第1楼替换',
    };
  }

  // 2. 单人角色卡模式
  const chid = ctx.characterId;
  const char = ctx.characters?.[chid];
  if (!char || typeof char !== 'object') {
    return {
      active: false,
      kind: 'none',
      entityKey: '',
      name: '',
      thumbUrl: '',
      portraitUrl: '',
    };
  }

  const avatar = typeof char.avatar === 'string' ? char.avatar.trim() : '';
  const { thumbUrl, portraitUrl } = buildCharPortraitUrls(avatar, ctx, doc);
  const data = char.data && typeof char.data === 'object' ? char.data : {};

  const name = String(char.name ?? data.name ?? ctx.name2 ?? '角色');
  const description = String(char.description ?? data.description ?? '');
  const personality = String(char.personality ?? data.personality ?? '');
  const scenario = String(char.scenario ?? data.scenario ?? '');
  const firstMes = String(char.first_mes ?? data.first_mes ?? '');
  const mesExample = String(char.mes_example ?? data.mes_example ?? '');
  const creatorNotes = String(data.creator_notes ?? char.creatorcomment ?? '');
  const systemPrompt = String(data.system_prompt ?? '');
  const postHistoryInstructions = String(data.post_history_instructions ?? '');
  const alternateGreetings = Array.isArray(data.alternate_greetings)
    ? data.alternate_greetings.map(item => String(item ?? ''))
    : [];
  const primaryWorld = String(data.extensions?.world ?? '').trim();

  // 读取角色卡标签：优先走酒馆标签管理库 (ctx.tags / ctx.tagMap)，离线或最小测试环境回退卡片内嵌 tags
  const rawTagList = Array.isArray(ctx?.tags)
    ? ctx.tags
    : Array.isArray(ctx?.powerUserSettings?.tags)
      ? ctx.powerUserSettings.tags
      : [];
  const rawTagMap =
    ctx?.tagMap && typeof ctx.tagMap === 'object'
      ? ctx.tagMap
      : ctx?.powerUserSettings?.tag_map && typeof ctx.powerUserSettings.tag_map === 'object'
        ? ctx.powerUserSettings.tag_map
        : null;
  let resolvedTags = [];
  if (rawTagMap && avatar && Array.isArray(rawTagMap[avatar])) {
    const tagById = new Map(rawTagList.map(t => [String(t?.id ?? ''), String(t?.name ?? '').trim()]));
    resolvedTags = rawTagMap[avatar].map(id => tagById.get(String(id)) || '').filter(Boolean);
  } else if (!rawTagMap) {
    const fallbackTags = Array.isArray(char.tags)
      ? char.tags
      : Array.isArray(data.tags)
        ? data.tags
        : [];
    resolvedTags = fallbackTags.map(t => String(t ?? '').trim()).filter(Boolean);
  }
  const tags = [...new Set(resolvedTags)];

  const greetings = [
    {
      index: 0,
      isPrimary: true,
      altIndex: -1,
      label: '#1 主开场白',
      shortLabel: '#1 主',
      content: firstMes,
    },
    ...alternateGreetings.map((txt, idx) => ({
      index: idx + 1,
      isPrimary: false,
      altIndex: idx,
      label: `#${idx + 2} 备用开场白`,
      shortLabel: `#${idx + 2}`,
      content: txt,
    })),
  ];

  const firstFloorCheck = canReplaceOpeningGreetingInChat(ctx);
  let activeFirstFloorIndex = -1;
  if (firstFloorCheck.allowed) {
    const msg0 = ctx.chat[0] || {};
    const currentMes = String(msg0.mes ?? '');
    const persistRegexFn =
      typeof ctx?.getRegexedString === 'function'
        ? ctx.getRegexedString.bind(ctx)
        : typeof cachedHostRegexMod?.getRegexedString === 'function'
          ? cachedHostRegexMod.getRegexedString.bind(cachedHostRegexMod)
          : null;
    const aiPlacement = Number.isInteger(cachedHostRegexMod?.regex_placement?.AI_OUTPUT)
      ? cachedHostRegexMod.regex_placement.AI_OUTPUT
      : 2;
    const toFloorMesCandidate = rawGreeting => {
      let step = String(rawGreeting ?? '');
      if (persistRegexFn) {
        try {
          step = String(persistRegexFn(step, aiPlacement) ?? step);
        } catch {
          // ignore regex error
        }
      }
      return substituteOpeningGreetingMacros(step, {
        ctx,
        charName: msg0.name || name,
      });
    };

    const matchedIndices = [];
    for (const g of greetings) {
      if (g.content === currentMes || toFloorMesCandidate(g.content) === currentMes) {
        matchedIndices.push(g.index);
      }
    }

    const rawSwipeId = Number(msg0.swipe_id);
    const hasShiftedEmptyFirst = greetings.length > 1 && !String(greetings[0]?.content ?? '').trim();
    const mappedIndexFromSwipe = Number.isInteger(rawSwipeId) && rawSwipeId >= 0
      ? hasShiftedEmptyFirst
        ? rawSwipeId + 1
        : rawSwipeId
      : -1;

    if (matchedIndices.length === 1) {
      activeFirstFloorIndex = matchedIndices[0];
    } else if (matchedIndices.length > 1 && matchedIndices.includes(mappedIndexFromSwipe)) {
      activeFirstFloorIndex = mappedIndexFromSwipe;
    } else if (matchedIndices.length > 0) {
      activeFirstFloorIndex = matchedIndices[0];
    } else if (
      mappedIndexFromSwipe >= 0 &&
      mappedIndexFromSwipe < greetings.length &&
      Array.isArray(msg0.swipes) &&
      msg0.swipes.length > 0
    ) {
      activeFirstFloorIndex = mappedIndexFromSwipe;
    }
  }

  return {
    active: true,
    kind: 'char',
    chid,
    avatar,
    entityKey,
    name,
    thumbUrl,
    portraitUrl,
    description,
    descriptionCharCount: countUnicodeChars(description),
    personality,
    scenario,
    firstMes,
    mesExample,
    creatorNotes,
    systemPrompt,
    postHistoryInstructions,
    alternateGreetings,
    greetings,
    primaryWorld,
    tags,
    addedAt: parseCharacterAddedAt(char),
    canExport: Boolean(avatar),
    canReplaceFirstFloor: firstFloorCheck.allowed,
    firstFloorReason: firstFloorCheck.reason,
    firstFloorHint: firstFloorCheck.hint,
    activeFirstFloorIndex,
  };
}

/**
 * 构造发往 `POST /api/characters/merge-attributes` 的 V1 + V2 一致性合并请求体（纯函数）。
 * 核对结论（对应 `D:\ST\SillyTavern\src\util.js:504` 与 `src/endpoints/characters.js:1292`）：
 * - 酒馆 `deepMerge` 中 `isObject(item)` 对 `Array` 返回 `false`，因此传入 `alternate_greetings: [...]` 会对原数组执行原子全量覆盖，
 *   缩短或清空备用开场白时不会残留旧末尾元素，也不会像数组下标 `__@@UNSET@@__` 那样产生稀疏 `null` 破坏 `TavernCardValidator` 校验！
 * - `data.extensions` 为纯对象，`deepMerge` 会保留该角色原有的 `depth_prompt`、`talkativeness` 等其余扩展字段，仅精准更新 `world`。
 */
export function buildCharacterMergePayload(char, patch = {}) {
  const srcChar = char && typeof char === 'object' ? char : {};
  const srcData = srcChar.data && typeof srcChar.data === 'object' ? srcChar.data : {};
  const avatar = String(patch.avatar ?? srcChar.avatar ?? '').trim();
  if (!avatar) {
    throw new Error('缺少角色卡文件名 (avatar)，无法保存角色属性');
  }

  const fallbackName = String(srcChar.name ?? srcData.name ?? 'Character').trim() || 'Character';
  let name = fallbackName;
  if (patch.name !== undefined) {
    const candidate = String(patch.name).trim();
    name = candidate && candidate !== '.' ? candidate : fallbackName;
  }

  const pickStr = (patchCamel, patchSnake, curV1, curV2 = '') => {
    if (patch[patchCamel] !== undefined) return String(patch[patchCamel] ?? '');
    if (patchSnake && patch[patchSnake] !== undefined) return String(patch[patchSnake] ?? '');
    if (curV1 !== undefined && curV1 !== null) return String(curV1);
    return String(curV2 ?? '');
  };

  const description = pickStr('description', null, srcChar.description, srcData.description);
  const personality = pickStr('personality', null, srcChar.personality, srcData.personality);
  const scenario = pickStr('scenario', null, srcChar.scenario, srcData.scenario);
  const first_mes = pickStr('firstMes', 'first_mes', srcChar.first_mes, srcData.first_mes);
  const mes_example = pickStr('mesExample', 'mes_example', srcChar.mes_example, srcData.mes_example);
  const creator_notes = pickStr(
    'creatorNotes',
    'creator_notes',
    srcData.creator_notes,
    srcChar.creatorcomment,
  );
  const system_prompt = pickStr('systemPrompt', 'system_prompt', srcData.system_prompt, '');
  const post_history_instructions = pickStr(
    'postHistoryInstructions',
    'post_history_instructions',
    srcData.post_history_instructions,
    '',
  );

  const rawAlt =
    patch.alternateGreetings !== undefined
      ? patch.alternateGreetings
      : patch.alternate_greetings !== undefined
        ? patch.alternate_greetings
        : srcData.alternate_greetings;
  const alternate_greetings = Array.isArray(rawAlt) ? rawAlt.map(item => String(item ?? '')) : [];

  const world =
    patch.world !== undefined
      ? String(patch.world || '').trim()
      : patch.primaryWorld !== undefined
        ? String(patch.primaryWorld || '').trim()
        : String(srcData.extensions?.world ?? '').trim();

  return {
    avatar,
    name,
    description,
    personality,
    scenario,
    first_mes,
    mes_example,
    creatorcomment: creator_notes,
    data: {
      name,
      description,
      personality,
      scenario,
      first_mes,
      mes_example,
      creator_notes,
      system_prompt,
      post_history_instructions,
      alternate_greetings,
      extensions: {
        world,
      },
    },
  };
}

function syncNativeCharacterFormDom(payload, doc = globalThis.document) {
  if (!doc || typeof doc.getElementById !== 'function') return;
  const avatarPole = doc.getElementById('avatar_url_pole');
  if (avatarPole && avatarPole.value && avatarPole.value !== payload.avatar) {
    return;
  }

  const fieldPairs = [
    ['character_name_pole', payload.name],
    ['description_textarea', payload.description],
    ['personality_textarea', payload.personality],
    ['scenario_pole', payload.scenario],
    ['firstmessage_textarea', payload.first_mes],
    ['mes_example_textarea', payload.mes_example],
    ['creator_notes_textarea', payload.data.creator_notes],
    ['system_prompt_textarea', payload.data.system_prompt],
    ['post_history_instructions_textarea', payload.data.post_history_instructions],
    ['character_world', payload.data.extensions.world],
  ];

  for (const [elId, val] of fieldPairs) {
    const input = doc.getElementById(elId);
    if (input && input.value !== val) {
      input.value = val;
    }
  }

  const headerH3 = doc.getElementById('character_popup-button-h3');
  if (headerH3 && headerH3.textContent !== payload.name) {
    headerH3.textContent = payload.name;
  }
}

/**
 * 将角色属性补丁提交至 `/api/characters/merge-attributes` 落盘，并同步更新宿主内存 `ctx.characters[chid]`、原生表单与 `CHARACTER_EDITED` 事件。
 */
export async function saveCharacterProfilePatch(
  patch = {},
  {
    getContext,
    chid = null,
    avatar = '',
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
  } = {},
) {
  const ctx = getContext?.();
  const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
  let targetChid = chid !== null && chid !== undefined ? chid : ctx?.characterId;
  let char = targetChid !== undefined && targetChid !== null ? characters[targetChid] : null;

  if ((!char || (avatar && char.avatar !== avatar)) && avatar) {
    const foundIdx = characters.findIndex(item => item && item.avatar === avatar);
    if (foundIdx >= 0) {
      targetChid = foundIdx;
      char = characters[foundIdx];
    }
  }

  if (!char || typeof char !== 'object') {
    throw new Error('未找到目标角色卡数据，无法保存修改');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前环境缺少 fetch 接口，无法保存角色修改');
  }

  const payload = buildCharacterMergePayload(char, patch);
  const headers =
    typeof ctx?.getRequestHeaders === 'function'
      ? ctx.getRequestHeaders()
      : { 'Content-Type': 'application/json' };

  const res = await fetchImpl(resolveEndpointHref('api/characters/merge-attributes', doc), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res?.ok) {
    let errDetail = '';
    try {
      const errJson = await res.json();
      errDetail = errJson?.error || errJson?.message || '';
    } catch {
      // ignore
    }
    throw new Error(
      `角色保存失败${errDetail ? `：${errDetail}` : ` (HTTP ${res?.status || 'ERR'})`}`,
    );
  }

  // 同步宿主内存角色对象（同时对齐 V1 顶层与 V2 data.*，保留 data.extensions 其余键）
  char.name = payload.name;
  char.description = payload.description;
  char.personality = payload.personality;
  char.scenario = payload.scenario;
  char.first_mes = payload.first_mes;
  char.mes_example = payload.mes_example;
  char.creatorcomment = payload.creatorcomment;
  if (!char.data || typeof char.data !== 'object') {
    char.data = {};
  }
  char.data.name = payload.data.name;
  char.data.description = payload.data.description;
  char.data.personality = payload.data.personality;
  char.data.scenario = payload.data.scenario;
  char.data.first_mes = payload.data.first_mes;
  char.data.mes_example = payload.data.mes_example;
  char.data.creator_notes = payload.data.creator_notes;
  char.data.system_prompt = payload.data.system_prompt;
  char.data.post_history_instructions = payload.data.post_history_instructions;
  char.data.alternate_greetings = [...payload.data.alternate_greetings];
  char.data.extensions = {
    ...(char.data.extensions && typeof char.data.extensions === 'object' ? char.data.extensions : {}),
    world: payload.data.extensions.world,
  };

  if (String(ctx?.characterId) === String(targetChid)) {
    try {
      ctx.name2 = payload.name;
    } catch {
      // ctx.name2 may be getter-only on host context
    }
    syncNativeCharacterFormDom(payload, doc);
  }

  const types = ctx?.eventTypes || ctx?.event_types;
  if (types?.CHARACTER_EDITED && typeof ctx?.eventSource?.emit === 'function') {
    try {
      await ctx.eventSource.emit(types.CHARACTER_EDITED, { id: targetChid, character: char });
    } catch {
      // ignore listener errors
    }
  }

  ctx?.saveSettingsDebounced?.();

  return {
    ok: true,
    chid: targetChid,
    avatar: payload.avatar,
    payload,
    character: char,
  };
}

/**
 * 角色档案编辑防串卡防抖保存器：
 * - 锁死修改时刻的 `{ chid, avatar }` 与累计 `patch`；
 * - 若切卡或导出前调用 `await flush()`，100% 保证草稿先落盘到对应角色 PNG，绝不串写或漏存！
 */
export function createCharacterProfileAutoSaver({
  debounceMs = CHAR_PROFILE_AUTO_SAVE_MS,
  persistPatch,
  onStateChange = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
} = {}) {
  let timerId = 0;
  let pendingRecord = null;
  let inFlightChain = Promise.resolve(true);
  let activeSavingCount = 0;

  function cancelTimer() {
    if (timerId) {
      clearTimer(timerId);
      timerId = 0;
    }
  }

  function enqueuePersist(record) {
    if (!record?.avatar || !record.patch) return inFlightChain;

    activeSavingCount += 1;
    onStateChange?.({
      tone: 'saving',
      text: '保存中…',
      saving: true,
      avatar: record.avatar,
    });

    const task = inFlightChain
      .catch(() => {})
      .then(async () => {
        try {
          await persistPatch(record);
          if (!pendingRecord && activeSavingCount <= 1) {
            onStateChange?.({
              tone: 'ok',
              text: '已保存',
              saving: false,
              avatar: record.avatar,
            });
          }
          return true;
        } catch (err) {
          onStateChange?.({
            tone: 'err',
            text: err?.message || '角色档案保存失败',
            saving: false,
            avatar: record.avatar,
            error: err,
          });
          return false;
        } finally {
          activeSavingCount = Math.max(0, activeSavingCount - 1);
        }
      });

    inFlightChain = task;
    return task;
  }

  function schedule({ chid = null, avatar = '', patch = {} } = {}) {
    const cleanAvatar = String(avatar || '').trim();
    if (!cleanAvatar || !patch || typeof patch !== 'object') {
      return false;
    }

    if (pendingRecord && pendingRecord.avatar !== cleanAvatar) {
      const previous = pendingRecord;
      pendingRecord = null;
      cancelTimer();
      void enqueuePersist(previous);
    }

    const mergedPatch = {
      ...(pendingRecord?.patch || {}),
      ...structuredClone(patch),
    };

    pendingRecord = {
      chid,
      avatar: cleanAvatar,
      patch: mergedPatch,
    };

    onStateChange?.({
      tone: 'warn',
      text: '待自动保存…',
      saving: activeSavingCount > 0,
      avatar: cleanAvatar,
    });

    cancelTimer();
    timerId = setTimer(() => {
      timerId = 0;
      if (!pendingRecord) return;
      const toSave = pendingRecord;
      pendingRecord = null;
      void enqueuePersist(toSave);
    }, debounceMs);

    return true;
  }

  async function flush() {
    cancelTimer();
    if (pendingRecord) {
      const toSave = pendingRecord;
      pendingRecord = null;
      await enqueuePersist(toSave);
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
    getPendingAvatar: () => pendingRecord?.avatar || '',
  };
}

/**
 * 纯函数：生成修改某条开场白（`#1 主开场白` 或 `#2..#N 备用开场白`）后的角色属性补丁。
 */
export function buildGreetingEditPatch(profileOrChar, greetingIndex, nextText) {
  const text = String(nextText ?? '');
  const idx = Number(greetingIndex);
  const curAlts = Array.isArray(profileOrChar?.alternateGreetings)
    ? [...profileOrChar.alternateGreetings]
    : Array.isArray(profileOrChar?.data?.alternate_greetings)
      ? profileOrChar.data.alternate_greetings.map(x => String(x ?? ''))
      : [];

  if (!Number.isInteger(idx) || idx <= 0) {
    return { firstMes: text };
  }

  const altIdx = idx - 1;
  while (curAlts.length <= altIdx) {
    curAlts.push('');
  }
  curAlts[altIdx] = text;
  return { alternateGreetings: curAlts };
}

/**
 * 纯函数：新增一条备用开场白，返回补丁与新开场白序号 (`greetingIndex`)。
 */
export function buildAddAlternateGreetingPatch(profileOrChar, initialText = '') {
  const curAlts = Array.isArray(profileOrChar?.alternateGreetings)
    ? [...profileOrChar.alternateGreetings]
    : Array.isArray(profileOrChar?.data?.alternate_greetings)
      ? profileOrChar.data.alternate_greetings.map(x => String(x ?? ''))
      : [];
  const nextAlts = [...curAlts, String(initialText ?? '')];
  return {
    patch: { alternateGreetings: nextAlts },
    newGreetingIndex: nextAlts.length, // 0 为主开场白，备用最后一个对应 nextAlts.length
  };
}

/**
 * 纯函数：删除指定序号的备用开场白（禁止删除 `index === 0` 的主开场白）。
 */
export function buildDeleteAlternateGreetingPatch(profileOrChar, greetingIndex) {
  const idx = Number(greetingIndex);
  if (!Number.isInteger(idx) || idx <= 0) {
    return { ok: false, reason: 'primary_protected' };
  }
  const curAlts = Array.isArray(profileOrChar?.alternateGreetings)
    ? [...profileOrChar.alternateGreetings]
    : Array.isArray(profileOrChar?.data?.alternate_greetings)
      ? profileOrChar.data.alternate_greetings.map(x => String(x ?? ''))
      : [];
  const altIdx = idx - 1;
  if (altIdx < 0 || altIdx >= curAlts.length) {
    return { ok: false, reason: 'out_of_range' };
  }
  const nextAlts = curAlts.filter((_, i) => i !== altIdx);
  const nextGreetingIndex = Math.min(idx, nextAlts.length);
  return {
    ok: true,
    patch: { alternateGreetings: nextAlts },
    nextGreetingIndex,
  };
}

/**
 * 【开局一键换开场白】：在单人对话开局第 1 楼（`chat.length === 1 && !chat[0].is_user`）安全替换 `chat[0]` 的正文与 `swipes`，
 * 严格对齐酒馆 `public/script.js` 的 `getFirstMessage`（持久化级 `AI_OUTPUT` 正则，保护 `isMarkdown: true` 美化脚本）
 * 与 `messageFormatting`（第 0 楼 `substituteParams` 展开 `{{user}}` / `{{char}}` 并回写 `chat[0].mes`），无需删档重开聊天！
 */
export async function applyGreetingToFirstChatFloor(
  greetingIndex,
  {
    getContext,
    greetingTextOverride = null,
    coreModule = null,
    regexModule = null,
    doc = globalThis.document,
  } = {},
) {
  const ctx = getContext?.();
  const check = canReplaceOpeningGreetingInChat(ctx);
  if (!check.allowed) {
    return { ok: false, reason: check.reason, message: check.hint };
  }

  const profile = readActiveCharacterProfile(ctx, { doc });
  if (profile.kind !== 'char') {
    return { ok: false, reason: 'not_single_char', message: '仅单人角色对话支持替换开场白' };
  }

  const allGreetings = profile.greetings.map(g => g.content);
  const idx = clampInt(greetingIndex, 0, Math.max(0, allGreetings.length - 1), 0);
  const rawChosen =
    greetingTextOverride !== null && greetingTextOverride !== undefined
      ? String(greetingTextOverride)
      : String(allGreetings[idx] ?? '');

  // 对齐 script.js:7719 getFirstMessage()：优先加载官方 regex/engine.js（或 ctx 注入）执行持久化级 AI_OUTPUT 正则，
  // 注意此处不传 isMarkdown:true，以完整保护「仅格式显示 (markdownOnly)」的前端正则美化卡片留到 messageFormatting 阶段渲染！
  const loadedRegexMod =
    regexModule ||
    cachedHostRegexMod ||
    (typeof ctx?.getRegexedString !== 'function' && resolveHostBaseHref(doc)
      ? await primeHostRegexModule({ doc })
      : null);
  const persistRegexFn =
    typeof ctx?.getRegexedString === 'function'
      ? ctx.getRegexedString.bind(ctx)
      : typeof loadedRegexMod?.getRegexedString === 'function'
        ? loadedRegexMod.getRegexedString.bind(loadedRegexMod)
        : null;
  const aiPlacement = Number.isInteger(loadedRegexMod?.regex_placement?.AI_OUTPUT)
    ? loadedRegexMod.regex_placement.AI_OUTPUT
    : 2;

  const applyPersistAiRegex = text => {
    const str = String(text ?? '');
    if (persistRegexFn) {
      try {
        const res = persistRegexFn(str, aiPlacement);
        return typeof res === 'string' ? res : str;
      } catch {
        return str;
      }
    }
    return str;
  };

  const formattedGreetings = allGreetings.map((txt, i) =>
    applyPersistAiRegex(i === idx ? rawChosen : txt),
  );
  const chosenPreMacroText = formattedGreetings[idx] ?? applyPersistAiRegex(rawChosen);

  const msg0 = ctx.chat[0];
  const effectiveCharName = String(msg0.name || profile.name || ctx?.name2 || '').trim();
  const stamp = msg0.send_date || new Date().toISOString();

  // 同步 swipes 与 swipe_id（swipes 保留与 getFirstMessage 一致的模板，供日后左右切换时动态解析宏）
  let swipes = [];
  let targetSwipeId = 0;

  if (formattedGreetings.length > 1) {
    if (!formattedGreetings[0] && idx > 0) {
      swipes = formattedGreetings.slice(1);
      targetSwipeId = idx - 1;
    } else {
      swipes = formattedGreetings;
      targetSwipeId = idx;
    }
  } else {
    swipes = [chosenPreMacroText];
    targetSwipeId = 0;
  }

  // 先将 chosenPreMacroText 写入 msg0.mes（对齐 script.js:1806-1811 messageFormatting 对 messageId===0 的回写契约）
  msg0.mes = chosenPreMacroText;
  msg0.swipes = swipes;
  msg0.swipe_id = targetSwipeId;
  msg0.swipe_info = swipes.map((_, sIdx) => {
    const prevInfo = Array.isArray(msg0.swipe_info) ? msg0.swipe_info[sIdx] : null;
    return prevInfo && typeof prevInfo === 'object'
      ? { ...prevInfo }
      : { send_date: stamp, extra: {} };
  });
  if (msg0.extra && typeof msg0.extra === 'object' && 'display_text' in msg0.extra) {
    delete msg0.extra.display_text;
  }

  // 1. 优先调用酒馆宿主 updateMessageBlock(0, msg0, { rerenderMessage: true })
  //    宿主内部会自动调用 messageFormatting(..., 0) 完成 substituteParams 回写 msg0.mes + isMarkdown:true 正则美化与 HTML 净化
  let renderedViaHost = false;
  const hostCore = coreModule || cachedHostCoreMod;
  const updateFn =
    typeof ctx?.updateMessageBlock === 'function'
      ? ctx.updateMessageBlock.bind(ctx)
      : typeof hostCore?.updateMessageBlock === 'function'
        ? hostCore.updateMessageBlock.bind(hostCore)
        : null;

  if (updateFn) {
    try {
      updateFn(0, msg0, { rerenderMessage: true });
      renderedViaHost = true;
    } catch {
      renderedViaHost = false;
    }
  } else if (resolveHostBaseHref(doc)) {
    const loadedCore = await primeHostCoreModule({ doc });
    if (typeof loadedCore?.updateMessageBlock === 'function') {
      try {
        loadedCore.updateMessageBlock(0, msg0, { rerenderMessage: true });
        renderedViaHost = true;
      } catch {
        renderedViaHost = false;
      }
    }
  }

  // 2. 宏解析双保险：若宿主未执行 updateMessageBlock 或未完成第 0 楼宏回写，显式执行 substituteOpeningGreetingMacros，
  //    确保 chat[0].mes 与当前选中 swipe 100% 消除未解析的 {{user}} / {{char}}！
  if (msg0.mes === chosenPreMacroText) {
    msg0.mes = substituteOpeningGreetingMacros(chosenPreMacroText, {
      ctx,
      charName: effectiveCharName,
    });
  }
  if (Array.isArray(msg0.swipes) && targetSwipeId >= 0 && targetSwipeId < msg0.swipes.length) {
    msg0.swipes[targetSwipeId] = msg0.mes;
  }

  // 3. 回退 DOM 渲染与原生翻页计数器同步
  const mesNode = doc?.querySelector?.('#chat .mes[mesid="0"]') || null;
  if (mesNode) {
    if (!renderedViaHost) {
      const textEl = mesNode.querySelector?.('.mes_text');
      if (textEl) {
        if (typeof ctx?.messageFormatting === 'function') {
          const formattedHtml = ctx.messageFormatting(
            chosenPreMacroText,
            effectiveCharName,
            Boolean(msg0.is_system),
            Boolean(msg0.is_user),
            0,
          );
          textEl.innerHTML = formattedHtml;
          if (msg0.mes === chosenPreMacroText) {
            msg0.mes = substituteOpeningGreetingMacros(chosenPreMacroText, {
              ctx,
              charName: effectiveCharName,
            });
          }
        } else {
          textEl.textContent = msg0.mes;
        }
      }
    }
    const counterEl = mesNode.querySelector?.('.swipes-counter');
    if (counterEl && swipes.length > 1) {
      counterEl.textContent = `${targetSwipeId + 1}/${swipes.length}`;
    }
  }

  if (typeof ctx?.swipe?.refresh === 'function') {
    try {
      ctx.swipe.refresh();
    } catch {
      // ignore
    }
  }

  const types = ctx?.eventTypes || ctx?.event_types;
  if (types?.MESSAGE_SWIPED && typeof ctx?.eventSource?.emit === 'function') {
    try {
      await ctx.eventSource.emit(types.MESSAGE_SWIPED, 0);
    } catch {
      // ignore
    }
  } else if (types?.MESSAGE_UPDATED && typeof ctx?.eventSource?.emit === 'function') {
    try {
      await ctx.eventSource.emit(types.MESSAGE_UPDATED, 0);
    } catch {
      // ignore
    }
  }

  if (typeof ctx?.saveChatConditional === 'function') {
    await ctx.saveChatConditional();
  } else if (typeof ctx?.saveChat === 'function') {
    await ctx.saveChat();
  }

  return {
    ok: true,
    greetingIndex: idx,
    swipeId: targetSwipeId,
    text: msg0.mes,
  };
}

/**
 * 导出当前角色卡为 PNG 或 JSON 文件：
 * - 若有尚未落盘的角色字段编辑草稿，先自动 `await flushPendingSave()` 确保导出的文件包含最新内容；
 * - 调用酒馆标准 `POST /api/characters/export` 获取脱敏后的文件流并触发安全下载（TauriTavern 自动走系统分享或保底框）。
 */
export async function exportActiveCharacterCard(
  format = 'png',
  {
    getContext,
    flushPendingSave = null,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
    root = globalThis,
    triggerDownload = null,
  } = {},
) {
  const fmt = String(format || 'png').trim().toLowerCase() === 'json' ? 'json' : 'png';

  if (typeof flushPendingSave === 'function') {
    await flushPendingSave();
  }

  const ctx = getContext?.();
  const profile = readActiveCharacterProfile(ctx, { doc });
  if (profile.kind !== 'char' || !profile.avatar) {
    throw new Error('当前未选中可导出的单人角色卡');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前环境缺少 fetch 接口，无法导出角色卡');
  }

  const headers =
    typeof ctx?.getRequestHeaders === 'function'
      ? ctx.getRequestHeaders()
      : { 'Content-Type': 'application/json' };

  const res = await fetchImpl(resolveEndpointHref('api/characters/export', doc), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      format: fmt,
      avatar_url: profile.avatar,
    }),
  });

  if (!res?.ok) {
    throw new Error(`导出角色卡失败 (HTTP ${res?.status || 'ERR'})`);
  }

  const blob = await res.blob();
  const stem = sanitizeExportFileStem(profile.name || profile.avatar, 'character');
  const fileName = `${stem}.${fmt}`;

  let saveRes = null;
  if (typeof triggerDownload === 'function') {
    await triggerDownload(blob, fileName);
  } else {
    saveRes = await saveExportBlob(blob, fileName, { doc, root });
  }

  return {
    ok: true,
    cancelled: Boolean(saveRes?.cancelled),
    saveMode: saveRes?.mode || 'custom',
    format: fmt,
    fileName,
    avatar: profile.avatar,
    size: Number(blob?.size || 0),
  };
}

// ============================================================================
// 二、世界书生效四源聚合、防假生效诊断、全局/角色绑定切换与预设槽位自检
// ============================================================================

function readWorldSelectStateFromDom(doc = globalThis.document) {
  const worldSelect = doc?.getElementById?.('world_info') || null;
  const editorSelect = doc?.getElementById?.('world_editor_select') || null;
  const names = [];
  const selectedGlobal = [];
  const seen = new Set();

  if (worldSelect?.options?.length) {
    for (let i = 0; i < worldSelect.options.length; i += 1) {
      const opt = worldSelect.options[i];
      const val = String(opt?.value ?? '');
      const text = String(opt?.textContent ?? opt?.text ?? '').trim();
      if (val === '' || !text) continue;
      if (!seen.has(text)) {
        seen.add(text);
        names.push(text);
      }
      if (opt.selected && !selectedGlobal.includes(text)) {
        selectedGlobal.push(text);
      }
    }
  } else if (editorSelect?.options?.length) {
    for (let i = 0; i < editorSelect.options.length; i += 1) {
      const opt = editorSelect.options[i];
      const val = String(opt?.value ?? '');
      const text = String(opt?.textContent ?? opt?.text ?? '').trim();
      if (val === '' || !text || seen.has(text)) continue;
      seen.add(text);
      names.push(text);
    }
  }

  return { worldSelect, editorSelect, names, selectedGlobal };
}

/**
 * 四源智能聚合当前对话正在生效的全部世界书，并计算打开「世界书」页签时的默认选中书目。
 * 四大核心来源：
 * 1. `角色主书` (`char.data.extensions.world`)
 * 2. `角色附加书` (`world_info.charLore` 对应角色 `extraBooks`)
 * 3. `当前聊天书` (`ctx.chatMetadata.world_info`)
 * 4. `全局开启` (`selected_world_info` / `#world_info` 已勾选书目)
 * （群聊模式下额外识别未禁用群成员绑定的 `群成员书`）
 */
export function resolveWorldInfoActivationState({
  getContext,
  worldInfoModule = null,
  doc = globalThis.document,
} = {}) {
  const ctx = getContext?.();
  const wiMod = worldInfoModule || cachedHostWorldInfoMod;
  const domState = readWorldSelectStateFromDom(doc);

  // 1. 汇总全部可用世界书名称库
  const worldNames = [];
  const seenNames = new Set();
  const pushWorldName = raw => {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || seenNames.has(name)) return;
    seenNames.add(name);
    worldNames.push(name);
  };

  if (Array.isArray(wiMod?.world_names)) {
    for (const n of wiMod.world_names) pushWorldName(n);
  }
  if (typeof ctx?.getWorldInfoNames === 'function') {
    try {
      const hostNames = ctx.getWorldInfoNames();
      if (Array.isArray(hostNames)) {
        for (const n of hostNames) pushWorldName(n);
      }
    } catch {
      // ignore
    }
  }
  for (const n of domState.names) pushWorldName(n);
  if (Array.isArray(ctx?.worldNames)) {
    for (const n of ctx.worldNames) pushWorldName(n);
  }

  // 2. 汇总全局已开启世界书
  const globalBooks = [];
  const pushGlobal = raw => {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || globalBooks.includes(name)) return;
    globalBooks.push(name);
  };

  if (Array.isArray(wiMod?.selected_world_info)) {
    for (const n of wiMod.selected_world_info) pushGlobal(n);
  } else if (domState.selectedGlobal.length > 0) {
    for (const n of domState.selectedGlobal) pushGlobal(n);
  } else if (Array.isArray(ctx?.worldInfo?.globalSelect)) {
    for (const n of ctx.worldInfo.globalSelect) pushGlobal(n);
  }

  // 3. 角色主书 / 角色附加书 / 当前聊天书 / 群成员书
  const isGroup =
    ctx?.groupId !== undefined && ctx?.groupId !== null && String(ctx.groupId).trim() !== '';
  const isSingleChar = !isGroup && hasActiveChatSelection(ctx);

  let primaryCharBook = '';
  const extraCharBooks = [];
  const groupMemberBooks = [];

  const rawCharLore =
    (Array.isArray(wiMod?.world_info?.charLore) && wiMod.world_info.charLore) ||
    (Array.isArray(ctx?.worldInfo?.charLore) && ctx.worldInfo.charLore) ||
    [];

  if (isSingleChar) {
    const char = ctx?.characters?.[ctx?.characterId];
    primaryCharBook = String(char?.data?.extensions?.world || '').trim();
    const rawAvatar = String(char?.avatar || '').trim();
    const avatarStem = rawAvatar.replace(/\.[^/.]+$/, '');

    for (const entry of rawCharLore) {
      if (!entry || typeof entry.name !== 'string') continue;
      if (entry.name === avatarStem || (rawAvatar && entry.name === rawAvatar)) {
        for (const extra of Array.isArray(entry.extraBooks) ? entry.extraBooks : []) {
          const clean = typeof extra === 'string' ? extra.trim() : '';
          if (clean && !extraCharBooks.includes(clean)) {
            extraCharBooks.push(clean);
          }
        }
      }
    }
  } else if (isGroup) {
    const group = (Array.isArray(ctx?.groups) ? ctx.groups : []).find(
      g => g && String(g.id) === String(ctx.groupId),
    );
    const disabledSet = new Set(Array.isArray(group?.disabled_members) ? group.disabled_members : []);
    const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
    for (const avatar of Array.isArray(group?.members) ? group.members : []) {
      if (disabledSet.has(avatar)) continue;
      const ch = characters.find(item => item && item.avatar === avatar);
      const memberPrimary = String(ch?.data?.extensions?.world || '').trim();
      if (memberPrimary && !groupMemberBooks.includes(memberPrimary)) {
        groupMemberBooks.push(memberPrimary);
      }
      const stem = String(avatar || '').replace(/\.[^/.]+$/, '');
      const lore = rawCharLore.find(item => item && (item.name === stem || item.name === avatar));
      for (const extra of Array.isArray(lore?.extraBooks) ? lore.extraBooks : []) {
        const clean = typeof extra === 'string' ? extra.trim() : '';
        if (clean && !groupMemberBooks.includes(clean)) {
          groupMemberBooks.push(clean);
        }
      }
    }
  }

  const chatBook = String(ctx?.chatMetadata?.world_info || '').trim();

  // 4. 聚合生效世界书映射表（保留多来源徽章与最高优先级主标签）
  const activeMap = new Map();
  const hasKnownLibrary = seenNames.size > 0;

  const recordActive = (bookName, sourceKey) => {
    const clean = typeof bookName === 'string' ? bookName.trim() : '';
    if (!clean) return;
    // 若世界书名录已加载且磁盘上根本不存在该书，不计入真生效列表（避免死链误导）
    if (hasKnownLibrary && !seenNames.has(clean)) return;

    let item = activeMap.get(clean);
    if (!item) {
      item = {
        name: clean,
        sources: [],
      };
      activeMap.set(clean, item);
    }
    if (!item.sources.includes(sourceKey)) {
      item.sources.push(sourceKey);
    }
  };

  if (primaryCharBook) recordActive(primaryCharBook, 'char_primary');
  for (const b of extraCharBooks) recordActive(b, 'char_extra');
  if (chatBook) recordActive(chatBook, 'chat');
  for (const b of globalBooks) recordActive(b, 'global');
  for (const b of groupMemberBooks) recordActive(b, 'group_member');

  const activeBooks = Array.from(activeMap.values()).map(item => {
    const sortedSources = [...item.sources].sort(
      (a, b) => WI_SOURCE_PRIORITY.indexOf(a) - WI_SOURCE_PRIORITY.indexOf(b),
    );
    const primarySource = sortedSources[0] || 'global';
    const sourceLabels = sortedSources.map(src => WI_SOURCE_LABELS[src] || src);
    return {
      name: item.name,
      sources: sortedSources,
      primarySource,
      sourceLabels,
      badgeLabel: sourceLabels[0] || '生效中',
      isPrimaryCharBook: sortedSources.includes('char_primary'),
      isGlobal: sortedSources.includes('global'),
    };
  });

  // 默认选中策略：角色主书（且存在于书库）> 第一本正在生效的世界书 > 空
  let defaultBookName = '';
  if (primaryCharBook && (!hasKnownLibrary || seenNames.has(primaryCharBook))) {
    defaultBookName = primaryCharBook;
  } else if (activeBooks.length > 0) {
    defaultBookName = activeBooks[0].name;
  }

  const missingPrimaryCharBook =
    Boolean(primaryCharBook) && hasKnownLibrary && !seenNames.has(primaryCharBook)
      ? primaryCharBook
      : '';

  return {
    isSingleChar,
    isGroup,
    worldNames,
    globalBooks,
    primaryCharBook,
    missingPrimaryCharBook,
    extraCharBooks,
    chatBook,
    groupMemberBooks,
    activeBooks,
    activeBookNames: activeBooks.map(b => b.name),
    defaultBookName,
  };
}

/**
 * 诊断某本被选中查看的世界书当前是否真生效：
 * 若未绑定角色/聊天且未全局开启，立即产出防假生效琥珀色预警与一键启用动作建议。
 */
export function inspectWorldBookActivation(bookName, activationState) {
  const clean = typeof bookName === 'string' ? bookName.trim() : '';
  if (!clean) {
    return {
      bookName: '',
      isActive: false,
      needsActivationWarning: false,
      warningText: '',
      sources: [],
      sourceLabels: [],
      badgeLabel: '',
      canBindToChar: Boolean(activationState?.isSingleChar),
      canEnableGlobal: false,
    };
  }

  const hit = (activationState?.activeBooks || []).find(item => item.name === clean) || null;
  if (hit) {
    return {
      bookName: clean,
      isActive: true,
      needsActivationWarning: false,
      warningText: '',
      sources: hit.sources,
      sourceLabels: hit.sourceLabels,
      badgeLabel: hit.badgeLabel,
      canBindToChar: Boolean(activationState?.isSingleChar) && !hit.isPrimaryCharBook,
      canEnableGlobal: !hit.isGlobal,
    };
  }

  return {
    bookName: clean,
    isActive: false,
    needsActivationWarning: true,
    warningText: '该世界书当前未启用，修改内容不会发给 AI！',
    sources: [],
    sourceLabels: [],
    badgeLabel: '未启用',
    canBindToChar: Boolean(activationState?.isSingleChar),
    canEnableGlobal: true,
  };
}

/**
 * 自检当前 OpenAI 对话预设的 `prompt_order` 中 `worldInfoBefore` 与 `worldInfoAfter` 占位槽是否双双被关闭。
 */
export function inspectPresetWorldInfoSlots({
  getContext,
  openAiModule = null,
} = {}) {
  const ctx = getContext?.();
  const mainApi = String(ctx?.mainApi || 'openai').trim().toLowerCase();
  const oai = ctx?.chatCompletionSettings;
  if (mainApi !== 'openai' || !oai || !Array.isArray(oai.prompts) || oai.prompts.length === 0) {
    return {
      applicable: false,
      beforeEnabled: true,
      afterEnabled: true,
      bothDisabled: false,
      warningText: '',
    };
  }

  const ordered = readOrderedPromptEntries(oai, {
    promptManager: openAiModule?.promptManager ?? undefined,
  });
  const beforeItem = ordered.entries.find(item => item.identifier === 'worldInfoBefore') || null;
  const afterItem = ordered.entries.find(item => item.identifier === 'worldInfoAfter') || null;

  if (!beforeItem && !afterItem) {
    return {
      applicable: false,
      beforeEnabled: true,
      afterEnabled: true,
      bothDisabled: false,
      warningText: '',
    };
  }

  const beforeEnabled = Boolean(beforeItem?.enabled);
  const afterEnabled = Boolean(afterItem?.enabled);
  const bothDisabled = !beforeEnabled && !afterEnabled;

  return {
    applicable: true,
    beforeExists: Boolean(beforeItem),
    afterExists: Boolean(afterItem),
    beforeEnabled,
    afterEnabled,
    bothDisabled,
    warningText: bothDisabled
      ? '当前预设关闭了「世界书」占位槽，前后置条目无法生效'
      : '',
  };
}

/**
 * 一键修复开启当前预设的 `worldInfoBefore` 与 `worldInfoAfter` 占位槽，并同步宿主 `promptManager` 与预设文件。
 */
export async function enablePresetWorldInfoSlots({
  getContext,
  openAiModule = null,
  fetchImpl = globalThis.fetch,
  doc = globalThis.document,
} = {}) {
  const ctx = getContext?.();
  const oai = ctx?.chatCompletionSettings;
  if (!oai || typeof oai !== 'object') {
    return { ok: false, reason: 'no_oai_settings' };
  }

  const mod = openAiModule || (await primeHostOpenAiModule({ doc }));
  const pm = mod?.promptManager || null;

  const toggledIds = [];
  for (const slotId of ['worldInfoBefore', 'worldInfoAfter']) {
    const exists = (oai.prompts || []).some(p => p && p.identifier === slotId);
    if (exists) {
      const res = togglePromptEntryEnabled(oai, slotId, true, { promptManager: pm });
      if (res === true) {
        toggledIds.push(slotId);
      }
    }
  }

  await syncHostPromptManagerAndSettings({
    getContext,
    promptManager: pm,
    openAiModule: mod,
    immediateRender: true,
    doc,
  });

  // 若当前处于正式命名预设，顺手落盘保存，避免切预设后又掉回关闭态
  const hostState = getHostPresetState({ getContext, openAiModule: mod, doc });
  if (!hostState.isGuiPreset && hostState.activePreset && typeof fetchImpl === 'function') {
    const snap = captureCurrentPresetSnapshot({ getContext, openAiModule: mod, doc });
    if (snap?.payload) {
      try {
        await saveHostPreset(hostState.activePreset, snap.payload, {
          getContext,
          openAiModule: mod,
          fetchImpl,
          updateDropdown: false,
          selectSaved: false,
          doc,
        });
      } catch {
        // 内存态已实时生效，忽略离线环境无后端时的落盘异常
      }
    }
  }

  return {
    ok: true,
    toggledIds,
  };
}

/**
 * 确保新创建或引用的世界书已在内存 `world_names` 与原生 `#world_info` / `#world_editor_select` 下拉框中建立一致下标，
 * 对齐 `D:\ST\SillyTavern\public\scripts\world-info.js` 中 `world_names.includes(name)` 与 `onWorldInfoChange` 下标查表契约。
 */
function ensureWorldBookRegisteredInMemoryAndDom(
  bookName,
  { ctx = null, wiMod = null, doc = globalThis.document } = {},
) {
  const target = typeof bookName === 'string' ? bookName.trim() : '';
  if (!target) return -1;

  if (Array.isArray(wiMod?.world_names) && !wiMod.world_names.includes(target)) {
    wiMod.world_names.push(target);
  }
  if (Array.isArray(ctx?.worldNames) && !ctx.worldNames.includes(target)) {
    ctx.worldNames.push(target);
  }

  let worldIdx = -1;
  if (Array.isArray(wiMod?.world_names)) {
    worldIdx = wiMod.world_names.indexOf(target);
  } else if (typeof ctx?.getWorldInfoNames === 'function') {
    try {
      const hostNames = ctx.getWorldInfoNames();
      if (Array.isArray(hostNames)) {
        worldIdx = hostNames.indexOf(target);
      }
    } catch {
      worldIdx = -1;
    }
  }

  if (!doc || typeof doc.getElementById !== 'function' || typeof doc.createElement !== 'function') {
    return worldIdx;
  }

  for (const selectId of ['world_info', 'world_editor_select']) {
    const selectEl = doc.getElementById(selectId);
    if (!selectEl?.options) continue;
    let matchedOpt = null;
    let nonEmptyCount = 0;
    for (let i = 0; i < selectEl.options.length; i += 1) {
      const opt = selectEl.options[i];
      const val = String(opt?.value ?? '');
      const text = String(opt?.textContent ?? opt?.text ?? '').trim();
      if (val !== '') nonEmptyCount += 1;
      if (text === target) {
        matchedOpt = opt;
        break;
      }
    }
    const resolvedVal = String(worldIdx >= 0 ? worldIdx : nonEmptyCount);
    if (!matchedOpt) {
      const opt = doc.createElement('option');
      opt.value = resolvedVal;
      opt.textContent = target;
      opt.selected = false;
      selectEl.appendChild?.(opt);
    } else if (worldIdx >= 0 && String(matchedOpt.value) !== String(worldIdx)) {
      matchedOpt.value = String(worldIdx);
    }
  }

  return worldIdx;
}

/**
 * 一键勾选或取消某本世界书的「全局启用」状态：
 * 精准同步原生 `#world_info` `<select multiple>` 的 `<option selected>` 并触发 `change` 事件，使酒馆 `selected_world_info` 100% 实时更新！
 */
export function setGlobalWorldBookEnabled(
  bookName,
  enabled,
  {
    getContext,
    worldInfoModule = null,
    doc = globalThis.document,
  } = {},
) {
  const target = typeof bookName === 'string' ? bookName.trim() : '';
  if (!target) return { ok: false, reason: 'empty_name' };

  const nextFlag = Boolean(enabled);
  const ctx = getContext?.();
  const wiMod = worldInfoModule || cachedHostWorldInfoMod;
  const selectEl = doc?.getElementById?.('world_info') || null;
  const EventCtor =
    globalThis.Event ||
    class MockEvent {
      constructor(type) {
        this.type = type;
      }
    };

  if (nextFlag) {
    ensureWorldBookRegisteredInMemoryAndDom(target, { ctx, wiMod, doc });
  }

  let matchedOption = null;
  if (selectEl?.options) {
    for (let i = 0; i < selectEl.options.length; i += 1) {
      const opt = selectEl.options[i];
      const text = String(opt?.textContent ?? opt?.text ?? '').trim();
      if (text === target) {
        matchedOption = opt;
        opt.selected = nextFlag;
        break;
      }
    }
  }

  let handledByJQuery = false;
  if (selectEl && typeof globalThis.$ === 'function') {
    try {
      globalThis.$(selectEl).trigger('change');
      handledByJQuery = true;
    } catch {
      handledByJQuery = false;
    }
  }

  if (selectEl && !handledByJQuery) {
    selectEl.dispatchEvent?.(new EventCtor('change', { bubbles: true }));
  }

  // 无 jQuery / 离线单测兜底：同步维护 wiMod.selected_world_info 与 ctx.worldInfo.globalSelect
  if (!handledByJQuery) {
    if (Array.isArray(wiMod?.selected_world_info)) {
      const idx = wiMod.selected_world_info.indexOf(target);
      if (nextFlag && idx === -1) {
        wiMod.selected_world_info.push(target);
      } else if (!nextFlag && idx !== -1) {
        wiMod.selected_world_info.splice(idx, 1);
      }
    }
    if (Array.isArray(ctx?.worldInfo?.globalSelect)) {
      const idx = ctx.worldInfo.globalSelect.indexOf(target);
      if (nextFlag && idx === -1) {
        ctx.worldInfo.globalSelect.push(target);
      } else if (!nextFlag && idx !== -1) {
        ctx.worldInfo.globalSelect.splice(idx, 1);
      }
    }
    ctx?.saveSettingsDebounced?.();
  }

  return {
    ok: true,
    bookName: target,
    enabled: nextFlag,
  };
}

/**
 * 为当前单人角色绑定或解绑「角色主世界书」（`bookName = ''` 表示解绑），实时落盘并同步原生表单与高亮状态。
 */
export async function bindCharacterPrimaryWorldBook(
  bookName,
  {
    getContext,
    chid = null,
    worldInfoModule = null,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
  } = {},
) {
  const targetWorld = String(bookName || '').trim();
  const ctx = getContext?.();
  const wiMod = worldInfoModule || cachedHostWorldInfoMod;
  if (targetWorld) {
    ensureWorldBookRegisteredInMemoryAndDom(targetWorld, { ctx, wiMod, doc });
  }

  const saveRes = await saveCharacterProfilePatch(
    { world: targetWorld },
    { getContext, chid, fetchImpl, doc },
  );

  if (typeof wiMod?.setWorldInfoButtonClass === 'function') {
    try {
      wiMod.setWorldInfoButtonClass(saveRes.chid, Boolean(targetWorld));
    } catch {
      // ignore
    }
  }

  return {
    ok: true,
    world: targetWorld,
    chid: saveRes.chid,
    avatar: saveRes.avatar,
  };
}

// ============================================================================
// 三、世界书读写落盘、新建世界书、蓝绿灯条目 CRUD 与防串书自动持久化队列
// ============================================================================

/**
 * 读取指定世界书数据（优先走官方 `loadWorldInfo(bookName)` 并深拷贝隔离工作副本，离线回退 `/api/worldinfo/get`）。
 */
export async function loadHostWorldBook(
  bookName,
  {
    getContext,
    worldInfoModule = null,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
  } = {},
) {
  const target = typeof bookName === 'string' ? bookName.trim() : '';
  if (!target) return null;

  const ctx = getContext?.();
  const wiMod =
    worldInfoModule || cachedHostWorldInfoMod || (await primeHostWorldInfoModule({ doc }));

  const hostLoadFn =
    typeof wiMod?.loadWorldInfo === 'function'
      ? wiMod.loadWorldInfo.bind(wiMod)
      : typeof ctx?.loadWorldInfo === 'function'
        ? ctx.loadWorldInfo.bind(ctx)
        : null;

  if (hostLoadFn) {
    const loaded = await hostLoadFn(target);
    if (loaded && typeof loaded === 'object') {
      const cloned = structuredClone(loaded);
      if (!cloned.entries || typeof cloned.entries !== 'object') {
        cloned.entries = {};
      }
      return cloned;
    }
  }

  if (typeof fetchImpl !== 'function') {
    return null;
  }

  const headers =
    typeof ctx?.getRequestHeaders === 'function'
      ? ctx.getRequestHeaders()
      : { 'Content-Type': 'application/json' };

  const res = await fetchImpl(resolveEndpointHref('api/worldinfo/get', doc), {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: target }),
  });

  if (!res?.ok) {
    return null;
  }

  const data = await res.json();
  if (!data || typeof data !== 'object') return null;
  if (!data.entries || typeof data.entries !== 'object') {
    data.entries = {};
  }
  wiMod?.worldInfoCache?.set?.(target, structuredClone(data));
  return structuredClone(data);
}

/**
 * 立即持久化保存指定世界书：
 * - 优先调用官方 `saveWorldInfo(bookName, clonedData, true)` 立即落盘并刷新宿主 `worldInfoCache`；
 * - 注意：按 `world-info.js` 官方契约，`saveWorldInfo` 内部 `worldInfoCache.set` 不做深拷贝，因此此处强制传入独立 `structuredClone` 副本！
 */
export async function saveHostWorldBook(
  bookName,
  bookData,
  {
    getContext,
    worldInfoModule = null,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
  } = {},
) {
  const target = typeof bookName === 'string' ? bookName.trim() : '';
  if (!target || !bookData || typeof bookData !== 'object') {
    throw new Error('无效的世界书名称或数据，无法保存');
  }

  const clonedPayload = structuredClone(bookData);
  if (!clonedPayload.entries || typeof clonedPayload.entries !== 'object') {
    clonedPayload.entries = {};
  }

  const ctx = getContext?.();
  const wiMod =
    worldInfoModule || cachedHostWorldInfoMod || (await primeHostWorldInfoModule({ doc }));

  const hostSaveFn =
    typeof wiMod?.saveWorldInfo === 'function'
      ? wiMod.saveWorldInfo.bind(wiMod)
      : typeof ctx?.saveWorldInfo === 'function'
        ? ctx.saveWorldInfo.bind(ctx)
        : null;

  if (hostSaveFn) {
    await hostSaveFn(target, clonedPayload, true);
    return { ok: true, bookName: target };
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('当前环境无法连接世界书保存接口');
  }

  const headers =
    typeof ctx?.getRequestHeaders === 'function'
      ? ctx.getRequestHeaders()
      : { 'Content-Type': 'application/json' };

  const res = await fetchImpl(resolveEndpointHref('api/worldinfo/edit', doc), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: target,
      data: clonedPayload,
    }),
  });

  if (!res?.ok) {
    throw new Error(`保存世界书失败 (HTTP ${res?.status || 'ERR'})`);
  }

  wiMod?.worldInfoCache?.set?.(target, clonedPayload);
  const types = ctx?.eventTypes || ctx?.event_types;
  if (types?.WORLDINFO_UPDATED && typeof ctx?.eventSource?.emit === 'function') {
    try {
      await ctx.eventSource.emit(types.WORLDINFO_UPDATED, target, clonedPayload);
    } catch {
      // ignore
    }
  }

  return { ok: true, bookName: target };
}

export function resolveUniqueWorldBookName(baseName, existingNames = []) {
  const stem = cleanWorldBookName(baseName) || '新建世界书';
  const lowerSet = new Set(
    (Array.isArray(existingNames) ? existingNames : []).map(n => String(n || '').trim().toLowerCase()),
  );
  if (!lowerSet.has(stem.toLowerCase())) {
    return stem;
  }
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${stem} (${i})`;
    if (!lowerSet.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${stem}_${Date.now().toString(36)}`;
}

/**
 * 新建一本世界书，优先调用官方 `createNewWorldInfo` / `updateWorldInfoList` 将书名正式注册进宿主内存 `world_names`
 * 及原生 `#world_info` / `#world_editor_select` 下拉框，确保无需刷新网页即可当场绑卡或开启全局被 `checkWorldInfo` 扫描生效！
 */
export async function createHostWorldBook(
  rawBookName = '',
  {
    bindToCurrentChar = false,
    enableGlobal = false,
    createStarterEntry = false,
    getContext,
    worldInfoModule = null,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
  } = {},
) {
  const ctx = getContext?.();
  const wiMod =
    worldInfoModule || cachedHostWorldInfoMod || (await primeHostWorldInfoModule({ doc }));
  const state = resolveWorldInfoActivationState({ getContext, worldInfoModule: wiMod, doc });
  const prevKnownSet = new Set(state.worldNames);

  const profile = readActiveCharacterProfile(ctx, { doc });
  const fallbackStem =
    profile.kind === 'char' && profile.name ? `${profile.name}设定集` : '新建世界书';
  let finalName = resolveUniqueWorldBookName(rawBookName || fallbackStem, state.worldNames);

  // 1. 优先走官方 createNewWorldInfo（内部自动执行 saveWorldInfo + updateWorldInfoList 写入模块级 world_names）
  let createdViaHost = false;
  if (typeof wiMod?.createNewWorldInfo === 'function') {
    try {
      createdViaHost = Boolean(await wiMod.createNewWorldInfo(finalName, { interactive: false }));
    } catch {
      createdViaHost = false;
    }
  }

  // 对齐后端可能发生的 getSanitizedFilename 规范化后真实注册书名
  const readLatestHostNames = () => {
    if (Array.isArray(wiMod?.world_names)) return wiMod.world_names;
    if (typeof ctx?.getWorldInfoNames === 'function') {
      try {
        const list = ctx.getWorldInfoNames();
        if (Array.isArray(list)) return list;
      } catch {
        // ignore
      }
    }
    return [];
  };

  if (createdViaHost) {
    const afterHostNames = readLatestHostNames();
    if (afterHostNames.length > 0 && !afterHostNames.includes(finalName)) {
      const newlyAdded = afterHostNames.find(n => n && !prevKnownSet.has(n));
      if (newlyAdded) {
        finalName = newlyAdded;
      }
    }
  }

  // 2. 准备初始条目并持久化（若尚未通过 createNewWorldInfo 注册，主动调用 updateWorldInfoList 刷新宿主 world_names）
  const initialData = { entries: {} };
  if (createStarterEntry) {
    createWorldInfoBookEntry(
      initialData,
      {
        comment: '核心世界观设定',
        constant: true,
        position: 0,
        content: '',
      },
      { worldInfoModule: wiMod },
    );
  }

  if (!createdViaHost || createStarterEntry) {
    await saveHostWorldBook(finalName, initialData, {
      getContext,
      worldInfoModule: wiMod,
      fetchImpl,
      doc,
    });

    if (!createdViaHost) {
      const updateListFn =
        typeof wiMod?.updateWorldInfoList === 'function'
          ? wiMod.updateWorldInfoList.bind(wiMod)
          : typeof ctx?.updateWorldInfoList === 'function'
            ? ctx.updateWorldInfoList.bind(ctx)
            : null;
      if (updateListFn) {
        try {
          await updateListFn();
          const refreshedNames = readLatestHostNames();
          if (refreshedNames.length > 0 && !refreshedNames.includes(finalName)) {
            const newlyAdded = refreshedNames.find(n => n && !prevKnownSet.has(n));
            if (newlyAdded) {
              finalName = newlyAdded;
            }
          }
        } catch {
          // ignore
        }
      }
    } else if (createStarterEntry && typeof ctx?.reloadWorldInfoEditor === 'function') {
      try {
        await ctx.reloadWorldInfoEditor(finalName, true);
      } catch {
        // ignore
      }
    }
  }

  // 3. 兜底确保内存 world_names 与原生 #world_info / #world_editor_select 下拉框 100% 同步注册
  ensureWorldBookRegisteredInMemoryAndDom(finalName, { ctx, wiMod, doc });

  if (bindToCurrentChar && profile.kind === 'char') {
    await bindCharacterPrimaryWorldBook(finalName, {
      getContext,
      chid: profile.chid,
      worldInfoModule: wiMod,
      fetchImpl,
      doc,
    });
  }

  if (enableGlobal) {
    setGlobalWorldBookEnabled(finalName, true, {
      getContext,
      worldInfoModule: wiMod,
      doc,
    });
  }

  return {
    ok: true,
    bookName: finalName,
    boundToChar: Boolean(bindToCurrentChar && profile.kind === 'char'),
    enabledGlobal: Boolean(enableGlobal),
  };
}

/**
 * 从内存 `world_names` / `selected_world_info` / `worldInfoCache`、原生 `#world_info` / `#world_editor_select`
 * 下拉框，以及受影响的角色主书绑定与 `AlertWI_` 导入锁中彻底清理已删除的世界书。
 */
function removeWorldBookFromMemoryAndDom(
  bookName,
  { ctx = null, wiMod = null, doc = globalThis.document } = {},
) {
  const target = typeof bookName === 'string' ? bookName.trim() : '';
  if (!target) return;

  wiMod?.worldInfoCache?.delete?.(target);

  if (Array.isArray(wiMod?.world_names)) {
    const idx = wiMod.world_names.indexOf(target);
    if (idx !== -1) wiMod.world_names.splice(idx, 1);
  }
  if (Array.isArray(ctx?.worldNames) && ctx.worldNames !== wiMod?.world_names) {
    const idx = ctx.worldNames.indexOf(target);
    if (idx !== -1) ctx.worldNames.splice(idx, 1);
  }
  if (Array.isArray(wiMod?.selected_world_info)) {
    const idx = wiMod.selected_world_info.indexOf(target);
    if (idx !== -1) wiMod.selected_world_info.splice(idx, 1);
  }
  if (Array.isArray(ctx?.worldInfo?.globalSelect) && ctx.worldInfo.globalSelect !== wiMod?.selected_world_info) {
    const idx = ctx.worldInfo.globalSelect.indexOf(target);
    if (idx !== -1) ctx.worldInfo.globalSelect.splice(idx, 1);
  }

  // 同步清理原生 #world_info / #world_editor_select 的 <option>，并对齐最新 world_names 下标
  if (doc && typeof doc.getElementById === 'function') {
    for (const selectId of ['world_info', 'world_editor_select']) {
      const selectEl = doc.getElementById(selectId);
      if (!selectEl?.options) continue;
      for (let i = selectEl.options.length - 1; i >= 0; i -= 1) {
        const opt = selectEl.options[i];
        const text = String(opt?.textContent ?? opt?.text ?? '').trim();
        if (text === target) {
          if (typeof opt.remove === 'function') {
            opt.remove();
          } else if (typeof selectEl.remove === 'function') {
            selectEl.remove(i);
          } else if (Array.isArray(selectEl.options)) {
            selectEl.options.splice(i, 1);
          }
        }
      }
      const latestNames = Array.isArray(wiMod?.world_names)
        ? wiMod.world_names
        : Array.isArray(ctx?.worldNames)
          ? ctx.worldNames
          : null;
      if (latestNames) {
        for (let i = 0; i < selectEl.options.length; i += 1) {
          const opt = selectEl.options[i];
          const text = String(opt?.textContent ?? opt?.text ?? '').trim();
          if (!text || String(opt?.value ?? '') === '') continue;
          const newIdx = latestNames.indexOf(text);
          if (newIdx >= 0) {
            opt.value = String(newIdx);
          }
        }
      }
    }

    const charWorldInput = doc.getElementById('character_world');
    if (charWorldInput && String(charWorldInput.value || '').trim() === target) {
      charWorldInput.value = '';
    }
  }

  // 若当前打开的角色在内存里仍挂着这本已删主书，立即清空内存字段，防重绘残影
  const activeChar =
    ctx?.characterId !== undefined && ctx?.characterId !== null
      ? ctx?.characters?.[ctx.characterId]
      : null;
  if (activeChar && String(activeChar?.data?.extensions?.world || '').trim() === target) {
    if (activeChar.data?.extensions) {
      activeChar.data.extensions.world = '';
    }
    if ('world' in activeChar) {
      activeChar.world = '';
    }
  }

  // 清理关联角色卡的 AlertWI_<avatar> 首次弹窗锁，确保用户后续重导角色卡时酒馆原生弹窗不再装聋作哑
  const clearAlertKeyForAvatar = avatar => {
    const cleanAvatar = typeof avatar === 'string' ? avatar.trim() : '';
    if (!cleanAvatar) return;
    const key = `AlertWI_${cleanAvatar}`;
    try {
      ctx?.accountStorage?.removeItem?.(key);
    } catch {
      // ignore
    }
    try {
      globalThis.localStorage?.removeItem?.(key);
    } catch {
      // ignore
    }
  };

  if (activeChar?.avatar) {
    clearAlertKeyForAvatar(activeChar.avatar);
  }
  if (Array.isArray(ctx?.characters)) {
    for (const ch of ctx.characters) {
      if (!ch?.avatar) continue;
      const linkedWorld = String(ch?.data?.extensions?.world || '').trim();
      const embeddedName = String(ch?.data?.character_book?.name || '').trim();
      if (linkedWorld === target || embeddedName === target) {
        clearAlertKeyForAvatar(ch.avatar);
      }
    }
  }
}

/**
 * 批量或单本从酒馆世界书库彻底删除世界书（优先走官方 `deleteWorldInfo`，离线回退 `/api/worldinfo/delete`），
 * 并自动解绑受影响的全局启用/当前角色主书内存态与 `AlertWI_` 导入锁。
 */
export async function deleteHostWorldBooks(
  bookNames,
  {
    getContext,
    worldInfoModule = null,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
  } = {},
) {
  const rawList = Array.isArray(bookNames) ? bookNames : [bookNames];
  const targets = [];
  const seen = new Set();
  for (const item of rawList) {
    const clean = typeof item === 'string' ? item.trim() : '';
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    targets.push(clean);
  }

  if (targets.length === 0) {
    return { ok: false, deleted: [], failed: [] };
  }

  const ctx = getContext?.();
  const wiMod =
    worldInfoModule || cachedHostWorldInfoMod || (await primeHostWorldInfoModule({ doc }));

  const hostDeleteFn =
    typeof wiMod?.deleteWorldInfo === 'function'
      ? wiMod.deleteWorldInfo.bind(wiMod)
      : typeof ctx?.deleteWorldInfo === 'function'
        ? ctx.deleteWorldInfo.bind(ctx)
        : null;

  const deleted = [];
  const failed = [];

  for (const target of targets) {
    const activeCharBefore =
      ctx?.characterId !== undefined && ctx?.characterId !== null
        ? ctx?.characters?.[ctx.characterId]
        : null;
    const wasPrimaryOnActiveChar =
      Boolean(activeCharBefore) &&
      String(activeCharBefore?.data?.extensions?.world || '').trim() === target;

    let ok = false;
    let handledByHostFn = false;

    if (hostDeleteFn) {
      try {
        ok = Boolean(await hostDeleteFn(target));
        handledByHostFn = ok;
      } catch {
        ok = false;
      }
    }

    if (!ok && typeof fetchImpl === 'function') {
      try {
        const headers =
          typeof ctx?.getRequestHeaders === 'function'
            ? ctx.getRequestHeaders()
            : { 'Content-Type': 'application/json' };
        const res = await fetchImpl(resolveEndpointHref('api/worldinfo/delete', doc), {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: target }),
        });
        ok = Boolean(res?.ok);
      } catch {
        ok = false;
      }
    }

    if (ok) {
      removeWorldBookFromMemoryAndDom(target, { ctx, wiMod, doc });
      // 若走的是纯后端回退路径且刚删掉当前角色主书，顺手持久化清空该角色 world 死链并存盘设置
      if (!handledByHostFn) {
        if (wasPrimaryOnActiveChar && typeof fetchImpl === 'function') {
          try {
            await saveCharacterProfilePatch(
              { world: '' },
              { getContext, chid: ctx.characterId, fetchImpl, doc },
            );
          } catch {
            // 内存已清空，忽略离线环境保存异常
          }
        }
        ctx?.saveSettingsDebounced?.();
      }
      deleted.push(target);
    } else {
      failed.push(target);
    }
  }

  return {
    ok: deleted.length > 0 && failed.length === 0,
    deleted,
    failed,
  };
}

export async function deleteHostWorldBook(bookName, options = {}) {
  const res = await deleteHostWorldBooks([bookName], options);
  return {
    ok: res.deleted.length === 1,
    bookName: res.deleted[0] || String(bookName || '').trim(),
    deleted: res.deleted,
    failed: res.failed,
  };
}

/**
 * 检测当前打开的单人角色卡 PNG/JSON 是否带有内嵌世界书 (`data.character_book`)。
 * 供 UI 提供「强制从角色卡内嵌数据重导覆盖」能力（根治酒馆遇到同名世界书静默跳过更新导致新条目打不开的痛点）。
 */
export function inspectEmbeddedCharacterBook(ctx) {
  const isGroup =
    ctx?.groupId !== undefined && ctx?.groupId !== null && String(ctx.groupId).trim() !== '';
  if (isGroup || !hasActiveChatSelection(ctx)) {
    return {
      hasEmbedded: false,
      bookName: '',
      charName: '',
      entryCount: 0,
    };
  }

  const char = ctx?.characters?.[ctx?.characterId];
  const rawBook = char?.data?.character_book;
  if (!rawBook || typeof rawBook !== 'object') {
    return {
      hasEmbedded: false,
      bookName: '',
      charName: String(char?.name || '').trim(),
      entryCount: 0,
    };
  }

  const rawEntries = Array.isArray(rawBook.entries)
    ? rawBook.entries
    : rawBook.entries && typeof rawBook.entries === 'object'
      ? Object.values(rawBook.entries)
      : [];

  if (rawEntries.length === 0) {
    return {
      hasEmbedded: false,
      bookName: '',
      charName: String(char?.name || '').trim(),
      entryCount: 0,
    };
  }

  const charName = String(char?.data?.name || char?.name || '角色').trim() || '角色';
  const fallbackName =
    String(char?.data?.extensions?.world || '').trim() || `${charName}'s Lorebook`;
  const bookName = cleanWorldBookName(rawBook.name || fallbackName) || `${charName}设定集`;

  return {
    hasEmbedded: true,
    bookName,
    charName,
    entryCount: rawEntries.length,
  };
}

/**
 * 将角色卡内嵌的 V2 `character_book` 转换为酒馆磁盘世界书结构（优先复用官方 `convertCharacterBook`，离线 1:1 兜底）。
 */
export function convertEmbeddedCharacterBookToWorldInfo(
  characterBook,
  { worldInfoModule = null } = {},
) {
  if (!characterBook || typeof characterBook !== 'object') {
    return { entries: {} };
  }

  const wiMod = worldInfoModule || cachedHostWorldInfoMod;
  if (typeof wiMod?.convertCharacterBook === 'function' && Array.isArray(characterBook.entries)) {
    try {
      const converted = wiMod.convertCharacterBook(structuredClone(characterBook));
      if (converted && typeof converted === 'object' && converted.entries) {
        return converted;
      }
    } catch {
      // 回退纯函数转换
    }
  }

  const rawList = Array.isArray(characterBook.entries)
    ? characterBook.entries
    : characterBook.entries && typeof characterBook.entries === 'object'
      ? Object.values(characterBook.entries)
      : [];

  const result = {
    entries: {},
    originalData: structuredClone(characterBook),
  };

  rawList.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const rawId = entry.id ?? entry.uid ?? index;
    const uid = Number.isInteger(Number(rawId)) ? Number(rawId) : index;
    const ext = entry.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};

    const keys = Array.isArray(entry.keys)
      ? [...entry.keys]
      : Array.isArray(entry.key)
        ? [...entry.key]
        : parseWorldInfoKeywords(entry.keys ?? entry.key ?? '');
    const secondaryKeys = Array.isArray(entry.secondary_keys)
      ? [...entry.secondary_keys]
      : Array.isArray(entry.keysecondary)
        ? [...entry.keysecondary]
        : parseWorldInfoKeywords(entry.secondary_keys ?? entry.keysecondary ?? '');

    const resolvedPos =
      ext.position !== undefined
        ? clampInt(ext.position, 0, 7, 0)
        : typeof entry.position === 'number'
          ? clampInt(entry.position, 0, 7, 0)
          : entry.position === 'before_char'
            ? 0
            : 1;

    const isDisabled =
      entry.disable !== undefined
        ? Boolean(entry.disable)
        : entry.enabled !== undefined
          ? !Boolean(entry.enabled)
          : false;

    result.entries[uid] = {
      ...structuredClone(DEFAULT_WI_ENTRY_TEMPLATE),
      uid,
      key: keys,
      keysecondary: secondaryKeys,
      comment: String(entry.comment ?? ''),
      content: String(entry.content ?? ''),
      constant: Boolean(entry.constant),
      selective: entry.selective !== undefined ? Boolean(entry.selective) : true,
      order: clampInt(entry.insertion_order ?? entry.order, -9999, 99999, 100),
      position: resolvedPos,
      excludeRecursion: Boolean(ext.exclude_recursion ?? entry.excludeRecursion ?? false),
      preventRecursion: Boolean(ext.prevent_recursion ?? entry.preventRecursion ?? false),
      delayUntilRecursion: ext.delay_until_recursion ?? entry.delayUntilRecursion ?? false,
      disable: isDisabled,
      addMemo: Boolean(entry.comment),
      displayIndex: Number.isFinite(Number(ext.display_index ?? entry.displayIndex))
        ? Number(ext.display_index ?? entry.displayIndex)
        : index,
      probability: clampInt(ext.probability ?? entry.probability, 0, 100, 100),
      useProbability: Boolean(ext.useProbability ?? entry.useProbability ?? true),
      depth: clampInt(ext.depth ?? entry.depth, 0, 999, 4),
      selectiveLogic: clampInt(ext.selectiveLogic ?? entry.selectiveLogic, 0, 3, 0),
      outletName: String(ext.outlet_name ?? entry.outletName ?? ''),
      group: String(ext.group ?? entry.group ?? ''),
      groupOverride: Boolean(ext.group_override ?? entry.groupOverride ?? false),
      groupWeight: clampInt(ext.group_weight ?? entry.groupWeight, 0, 10000, 100),
      scanDepth: ext.scan_depth ?? entry.scanDepth ?? null,
      caseSensitive: ext.case_sensitive ?? entry.caseSensitive ?? null,
      matchWholeWords: ext.match_whole_words ?? entry.matchWholeWords ?? null,
      useGroupScoring: ext.use_group_scoring ?? entry.useGroupScoring ?? null,
      automationId: String(ext.automation_id ?? entry.automationId ?? ''),
      role: clampInt(ext.role ?? entry.role, 0, 2, 0),
      vectorized: Boolean(ext.vectorized ?? entry.vectorized ?? false),
      sticky: ext.sticky ?? entry.sticky ?? null,
      cooldown: ext.cooldown ?? entry.cooldown ?? null,
      delay: ext.delay ?? entry.delay ?? null,
      matchPersonaDescription: Boolean(ext.match_persona_description ?? entry.matchPersonaDescription ?? false),
      matchCharacterDescription: Boolean(ext.match_character_description ?? entry.matchCharacterDescription ?? false),
      matchCharacterPersonality: Boolean(ext.match_character_personality ?? entry.matchCharacterPersonality ?? false),
      matchCharacterDepthPrompt: Boolean(ext.match_character_depth_prompt ?? entry.matchCharacterDepthPrompt ?? false),
      matchScenario: Boolean(ext.match_scenario ?? entry.matchScenario ?? false),
      matchCreatorNotes: Boolean(ext.match_creator_notes ?? entry.matchCreatorNotes ?? false),
      extensions: structuredClone(ext),
      triggers: Array.isArray(ext.triggers)
        ? [...ext.triggers]
        : Array.isArray(entry.triggers)
          ? [...entry.triggers]
          : [],
      ignoreBudget: Boolean(ext.ignore_budget ?? entry.ignoreBudget ?? false),
    };
  });

  return result;
}

/**
 * 强制从当前单人角色卡内嵌的 `data.character_book` 重新提取世界书并覆盖保存到酒馆书库，同时自动绑定为角色主世界书。
 */
export async function reimportEmbeddedCharacterBook({
  getContext,
  worldInfoModule = null,
  fetchImpl = globalThis.fetch,
  doc = globalThis.document,
} = {}) {
  const ctx = getContext?.();
  const info = inspectEmbeddedCharacterBook(ctx);
  if (!info.hasEmbedded) {
    throw new Error('当前角色卡内未检测到内嵌世界书数据');
  }

  const wiMod =
    worldInfoModule || cachedHostWorldInfoMod || (await primeHostWorldInfoModule({ doc }));
  const char = ctx?.characters?.[ctx?.characterId];
  const converted = convertEmbeddedCharacterBookToWorldInfo(char.data.character_book, {
    worldInfoModule: wiMod,
  });

  await saveHostWorldBook(info.bookName, converted, {
    getContext,
    worldInfoModule: wiMod,
    fetchImpl,
    doc,
  });

  const updateListFn =
    typeof wiMod?.updateWorldInfoList === 'function'
      ? wiMod.updateWorldInfoList.bind(wiMod)
      : typeof ctx?.updateWorldInfoList === 'function'
        ? ctx.updateWorldInfoList.bind(ctx)
        : null;
  if (updateListFn) {
    try {
      await updateListFn();
    } catch {
      // ignore offline
    }
  }

  ensureWorldBookRegisteredInMemoryAndDom(info.bookName, { ctx, wiMod, doc });

  await bindCharacterPrimaryWorldBook(info.bookName, {
    getContext,
    chid: ctx.characterId,
    worldInfoModule: wiMod,
    fetchImpl,
    doc,
  });

  if (typeof ctx?.reloadWorldInfoEditor === 'function') {
    try {
      await ctx.reloadWorldInfoEditor(info.bookName, true);
    } catch {
      // ignore
    }
  }

  return {
    ok: true,
    bookName: info.bookName,
    entryCount: info.entryCount,
  };
}

/**
 * 友好解析世界书触发关键词输入（同时支持英文逗号 `,`、中文全角逗号 `，` 与换行分隔，保留 `/regex/i` 正则键完整性）。
 */
export function parseWorldInfoKeywords(rawInput) {
  if (Array.isArray(rawInput)) {
    const out = [];
    const seen = new Set();
    for (const item of rawInput) {
      const trimmed = String(item ?? '').trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  }

  if (typeof rawInput !== 'string') return [];
  const text = rawInput.trim();
  if (!text) return [];

  // 保护形如 `/pattern/flags` 中可能包含的逗号不被误切碎
  const tokens = [];
  let buf = '';
  let inRegex = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      buf += ch;
      escaped = true;
      continue;
    }
    if (ch === '/' && !inRegex && buf.trim() === '') {
      inRegex = true;
      buf += ch;
      continue;
    }
    if (ch === '/' && inRegex) {
      inRegex = false;
      buf += ch;
      continue;
    }
    if (!inRegex && (ch === ',' || ch === '，' || ch === '\n' || ch === '\r')) {
      tokens.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf) {
    tokens.push(buf);
  }

  const result = [];
  const seen = new Set();
  for (const raw of tokens) {
    const cleaned = raw.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

export function formatWorldInfoKeywords(keys = []) {
  return parseWorldInfoKeywords(keys).join(', ');
}

export function getWorldInfoPositionMeta(positionValue) {
  const num = clampInt(positionValue, 0, 7, 0);
  return WI_POSITION_OPTIONS.find(opt => opt.value === num) || WI_POSITION_OPTIONS[0];
}

/**
 * 读取并归一化世界书中的全部条目，附带人话蓝绿灯状态与「绿灯空触发词（不会生效）」智能诊断。
 */
export function readWorldInfoEntries(bookData) {
  const rawEntries = bookData?.entries && typeof bookData.entries === 'object' ? bookData.entries : {};
  const list = [];

  for (const [dictKey, raw] of Object.entries(rawEntries)) {
    if (!raw || typeof raw !== 'object') continue;
    const parsedKeyNum = Number(raw.uid ?? dictKey);
    const uid = Number.isInteger(parsedKeyNum) ? parsedKeyNum : dictKey;
    const enabled = !Boolean(raw.disable);
    const constant = Boolean(raw.constant);
    const vectorized = !constant && Boolean(raw.vectorized);
    const keys = parseWorldInfoKeywords(raw.key);
    const secondaryKeys = parseWorldInfoKeywords(raw.keysecondary);
    const comment = String(raw.comment ?? '').trim();
    const content = String(raw.content ?? '');
    const position = clampInt(raw.position, 0, 7, 0);
    const posMeta = getWorldInfoPositionMeta(position);
    const depth = clampInt(raw.depth, 0, 999, 4);
    const role = clampInt(raw.role, 0, 2, 0);
    const roleMeta = WI_DEPTH_ROLE_OPTIONS.find(r => r.value === role) || WI_DEPTH_ROLE_OPTIONS[0];
    const order = clampInt(raw.order, -9999, 99999, 100);
    const displayIndex = Number.isFinite(Number(raw.displayIndex)) ? Number(raw.displayIndex) : null;

    const triggerMode = constant ? 'constant' : vectorized ? 'vectorized' : 'keyword';
    const triggerLabel = constant
      ? '一直生效'
      : vectorized
        ? '向量触发'
        : '提到词触发';

    // 绿灯空词预警：条目处于开启状态且为「提到词触发」，但主触发关键词为空 -> 永远不会被触发！
    const hasEmptyKeywordWarning = enabled && triggerMode === 'keyword' && keys.length === 0;

    const displayTitle =
      comment ||
      (keys.length > 0 ? keys.slice(0, 3).join(' / ') : '') ||
      (content.trim() ? content.trim().slice(0, 24) : `未命名条目 #${uid}`);

    list.push({
      uid,
      dictKey: String(dictKey),
      displayIndex,
      enabled,
      constant,
      vectorized,
      triggerMode,
      triggerLabel,
      hasEmptyKeywordWarning,
      comment: String(raw.comment ?? ''),
      displayTitle,
      keys,
      keysText: keys.join(', '),
      secondaryKeys,
      content,
      contentCharCount: countUnicodeChars(content),
      position,
      positionLabel: posMeta.label,
      positionShortLabel:
        position === 4 ? `@D${depth} ${roleMeta.shortLabel}` : posMeta.shortLabel,
      depth,
      role,
      roleBadge: roleMeta.shortLabel,
      order,
    });
  }

  // 稳定排序：若有 displayIndex 优先按 displayIndex，否则按 uid 升序，防止用户改 order 或开关时条目在鼠标下乱跳
  list.sort((a, b) => {
    if (a.displayIndex !== null && b.displayIndex !== null && a.displayIndex !== b.displayIndex) {
      return a.displayIndex - b.displayIndex;
    }
    const na = Number(a.uid);
    const nb = Number(b.uid);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a.uid).localeCompare(String(b.uid));
  });

  let enabledCount = 0;
  let constantCount = 0;
  let keywordCount = 0;
  let emptyKeyWarnCount = 0;

  for (const item of list) {
    if (item.enabled) {
      enabledCount += 1;
      if (item.constant) constantCount += 1;
      else keywordCount += 1;
    }
    if (item.hasEmptyKeywordWarning) {
      emptyKeyWarnCount += 1;
    }
  }

  return {
    entries: list,
    totalCount: list.length,
    enabledCount,
    constantCount,
    keywordCount,
    disabledCount: list.length - enabledCount,
    emptyKeyWarnCount,
  };
}

/**
 * 搜索与筛选世界书条目（支持 `all` / `constant` / `keyword` / `disabled` 四种模式及标题/关键词/正文实时检索）。
 */
export function filterWorldInfoEntries(
  entries = [],
  { query = '', filterMode = 'all' } = {},
) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(entries) ? entries : []).filter(item => {
    if (filterMode === 'constant' && !(item.enabled && item.constant)) return false;
    if (filterMode === 'keyword' && !(item.enabled && !item.constant)) return false;
    if (filterMode === 'disabled' && item.enabled) return false;
    if (!q) return true;
    return (
      item.comment.toLowerCase().includes(q) ||
      item.displayTitle.toLowerCase().includes(q) ||
      item.keysText.toLowerCase().includes(q) ||
      item.secondaryKeys.join(', ').toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q)
    );
  });
}

function findRawEntryByUid(bookData, uid) {
  const entries = bookData?.entries;
  if (!entries || typeof entries !== 'object') return null;
  if (entries[uid] && typeof entries[uid] === 'object') {
    return { key: String(uid), entry: entries[uid] };
  }
  for (const [k, v] of Object.entries(entries)) {
    if (v && typeof v === 'object' && String(v.uid ?? k) === String(uid)) {
      return { key: k, entry: v };
    }
  }
  return null;
}

/**
 * 切换或设定单条世界书条目的总启用开关（`!entry.disable`）。
 */
export function toggleWorldInfoEntryEnabled(bookData, uid, forcedEnabled = null) {
  const hit = findRawEntryByUid(bookData, uid);
  if (!hit) return null;
  const curEnabled = !Boolean(hit.entry.disable);
  const nextEnabled = typeof forcedEnabled === 'boolean' ? forcedEnabled : !curEnabled;
  hit.entry.disable = !nextEnabled;
  return nextEnabled;
}

/**
 * 设定世界书条目的触发方式（`'constant'` 蓝灯一直生效 | `'keyword'` 绿灯提到词触发 | `'vectorized'` 向量触发）。
 */
export function setWorldInfoEntryTriggerMode(bookData, uid, mode) {
  const hit = findRawEntryByUid(bookData, uid);
  if (!hit) return null;
  if (mode === 'constant') {
    hit.entry.constant = true;
    hit.entry.vectorized = false;
    return 'constant';
  }
  if (mode === 'vectorized') {
    hit.entry.constant = false;
    hit.entry.vectorized = true;
    return 'vectorized';
  }
  hit.entry.constant = false;
  hit.entry.vectorized = false;
  if (hit.entry.selective === undefined) {
    hit.entry.selective = true;
  }
  return 'keyword';
}

/**
 * 点击行内蓝绿灯胶囊时，在「一直生效（蓝灯）」与「提到词触发（绿灯）」之间一键切换。
 */
export function cycleWorldInfoEntryTriggerMode(bookData, uid) {
  const hit = findRawEntryByUid(bookData, uid);
  if (!hit) return null;
  const nextMode = hit.entry.constant ? 'keyword' : 'constant';
  return setWorldInfoEntryTriggerMode(bookData, uid, nextMode);
}

function allocateFreeWorldEntryUid(bookData) {
  const entries = bookData?.entries && typeof bookData.entries === 'object' ? bookData.entries : {};
  for (let id = 0; id < 1000000; id += 1) {
    if (!(id in entries) && !(String(id) in entries)) {
      return id;
    }
  }
  return Date.now();
}

/**
 * 在世界书数据中新建一条标准世界书条目（优先复用官方 `createWorldInfoEntry`，离线回退完整模板）。
 */
export function createWorldInfoBookEntry(
  bookData,
  initial = {},
  { worldInfoModule = null } = {},
) {
  if (!bookData || typeof bookData !== 'object') return null;
  if (!bookData.entries || typeof bookData.entries !== 'object') {
    bookData.entries = {};
  }

  const wiMod = worldInfoModule || cachedHostWorldInfoMod;
  let created = null;

  if (typeof wiMod?.createWorldInfoEntry === 'function') {
    try {
      created = wiMod.createWorldInfoEntry('', bookData);
    } catch {
      created = null;
    }
  }

  if (!created) {
    const newUid = allocateFreeWorldEntryUid(bookData);
    created = {
      uid: newUid,
      ...structuredClone(DEFAULT_WI_ENTRY_TEMPLATE),
    };
    bookData.entries[newUid] = created;
  }

  // 默认采用最不易踩坑的清晰初始值：若传入了关键词则默认「提到词触发」，未传关键词可通过 initial.constant 指定（UI 默认提供清晰选择）
  const parsedKeys =
    initial.key !== undefined
      ? parseWorldInfoKeywords(initial.key)
      : initial.keys !== undefined
        ? parseWorldInfoKeywords(initial.keys)
        : [];

  created.comment = String(initial.comment ?? '新世界书条目').slice(0, 240);
  created.key = parsedKeys;
  created.constant =
    initial.constant !== undefined ? Boolean(initial.constant) : parsedKeys.length === 0;
  created.vectorized = false;
  created.disable = initial.disable !== undefined ? Boolean(initial.disable) : false;
  created.position = clampInt(initial.position, 0, 7, 0);
  created.depth = clampInt(initial.depth, 0, 999, 4);
  created.role = clampInt(initial.role, 0, 2, 0);
  created.order = clampInt(initial.order, -9999, 99999, 100);
  created.content = String(initial.content ?? '');

  return created;
}

/**
 * 更新指定世界书条目的字段（标题、触发方式、中英文逗号触发词、插入位置、@D 深度与角色、权重顺序、正文）。
 */
export function updateWorldInfoBookEntry(bookData, uid, patch = {}) {
  const hit = findRawEntryByUid(bookData, uid);
  if (!hit) return { ok: false, reason: 'not_found' };
  const entry = hit.entry;

  if (patch.comment !== undefined) {
    entry.comment = String(patch.comment ?? '').slice(0, 300);
  }
  if (patch.triggerMode !== undefined) {
    setWorldInfoEntryTriggerMode(bookData, uid, patch.triggerMode);
  } else if (patch.constant !== undefined) {
    setWorldInfoEntryTriggerMode(bookData, uid, patch.constant ? 'constant' : 'keyword');
  }
  if (patch.key !== undefined || patch.keys !== undefined) {
    entry.key = parseWorldInfoKeywords(patch.key ?? patch.keys);
  }
  if (patch.position !== undefined) {
    entry.position = clampInt(patch.position, 0, 7, entry.position ?? 0);
  }
  if (patch.depth !== undefined) {
    entry.depth = clampInt(patch.depth, 0, 999, entry.depth ?? 4);
  }
  if (patch.role !== undefined) {
    entry.role = clampInt(patch.role, 0, 2, entry.role ?? 0);
  }
  if (patch.order !== undefined) {
    entry.order = clampInt(patch.order, -9999, 99999, entry.order ?? 100);
  }
  if (patch.content !== undefined) {
    entry.content = String(patch.content ?? '');
  }
  if (patch.disable !== undefined) {
    entry.disable = Boolean(patch.disable);
  }

  return { ok: true, entry };
}

/**
 * 删除指定世界书条目。
 */
export function deleteWorldInfoBookEntry(bookData, uid) {
  const hit = findRawEntryByUid(bookData, uid);
  if (!hit) return { ok: false, reason: 'not_found' };
  delete bookData.entries[hit.key];
  return { ok: true, deletedUid: uid };
}

/**
 * 【防串书自动落盘队列】（与 `createPresetAutoSaver` 同等级锁死快照设计）：
 * - 每次 `schedule(bookName, bookData)` 当场深拷贝锁死 `{ bookName, dataSnapshot }`；
 * - 若 300ms 防抖期内用户迅速切换到另一本世界书并产生修改，队列会先将上一本书的挂起快照独立落盘，绝不跨书覆写；
 * - 切书或关闭面板前调用 `await flush()` 即可确保 100% 落盘生效。
 */
export function createWorldBookAutoSaver({
  debounceMs = WORLD_INFO_AUTO_SAVE_MS,
  persistBook,
  onStateChange = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
} = {}) {
  let timerId = 0;
  let pendingRecord = null;
  let inFlightChain = Promise.resolve(true);
  let activeSavingCount = 0;

  function cancelTimer() {
    if (timerId) {
      clearTimer(timerId);
      timerId = 0;
    }
  }

  function enqueueRecordPersist(record) {
    if (!record?.bookName || !record.dataSnapshot) return inFlightChain;

    activeSavingCount += 1;
    onStateChange?.({
      tone: 'saving',
      text: '保存中…',
      saving: true,
      bookName: record.bookName,
    });

    const task = inFlightChain
      .catch(() => {})
      .then(async () => {
        try {
          await persistBook(record.bookName, record.dataSnapshot);
          if (!pendingRecord && activeSavingCount <= 1) {
            onStateChange?.({
              tone: 'ok',
              text: '已保存',
              saving: false,
              bookName: record.bookName,
            });
          }
          return true;
        } catch (err) {
          onStateChange?.({
            tone: 'err',
            text: err?.message || '世界书保存失败',
            saving: false,
            bookName: record.bookName,
            error: err,
          });
          return false;
        } finally {
          activeSavingCount = Math.max(0, activeSavingCount - 1);
        }
      });

    inFlightChain = task;
    return task;
  }

  function schedule(bookName, bookData) {
    const targetName = typeof bookName === 'string' ? bookName.trim() : '';
    if (!targetName || !bookData || typeof bookData !== 'object') {
      return false;
    }

    // 若防抖队列里尚有另一本世界书的未落盘快照，立即先将其独立落盘，严禁跨书串写！
    if (pendingRecord && pendingRecord.bookName !== targetName) {
      const previous = pendingRecord;
      pendingRecord = null;
      cancelTimer();
      void enqueueRecordPersist(previous);
    }

    pendingRecord = {
      bookName: targetName,
      dataSnapshot: structuredClone(bookData),
      capturedAt: Date.now(),
    };

    onStateChange?.({
      tone: 'warn',
      text: '待保存…',
      saving: activeSavingCount > 0,
      bookName: targetName,
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
    getPendingBookName: () => pendingRecord?.bookName || '',
  };
}

// ============================================================================
// 四、角色封面焦点、原始立绘替换与多图随机轮换图库（与《砚台 · 角色书架》无损共享）
// ============================================================================

const BOOKSHELF_SETTINGS_NS = 'jingdu_bookshelf';
let coverCacheRevision = 0;

export function getCoverCacheRevision() {
  return coverCacheRevision;
}

function clampPct(val, fallback) {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(100, Math.max(0, Math.round(num)));
}

function ensureBookshelfHostStore(ctx) {
  if (!ctx?.extensionSettings || typeof ctx.extensionSettings !== 'object') {
    return null;
  }
  if (
    !ctx.extensionSettings[BOOKSHELF_SETTINGS_NS] ||
    typeof ctx.extensionSettings[BOOKSHELF_SETTINGS_NS] !== 'object' ||
    Array.isArray(ctx.extensionSettings[BOOKSHELF_SETTINGS_NS])
  ) {
    ctx.extensionSettings[BOOKSHELF_SETTINGS_NS] = {};
  }
  const s = ctx.extensionSettings[BOOKSHELF_SETTINGS_NS];
  if (!s.crops || typeof s.crops !== 'object' || Array.isArray(s.crops)) {
    s.crops = {};
  }
  if (!s.galleries || typeof s.galleries !== 'object' || Array.isArray(s.galleries)) {
    s.galleries = {};
  }
  return s;
}

export function resolveGalleryImageHref(rawUrl, root = globalThis) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  const trimmed = rawUrl.trim();
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return '';
  try {
    const base = root?.document?.baseURI || root?.location?.origin || 'http://localhost/';
    const rel = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    const parsed = new URL(rel, base);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    return '';
  }
  return '';
}

export function readCharacterCoverGallery(ctx, avatar) {
  const cleanAvatar = typeof avatar === 'string' ? avatar.trim() : '';
  if (!cleanAvatar) {
    return {
      entityKey: '',
      primaryCrop: { x: 50, y: 25 },
      randomCover: false,
      selectedId: 'primary',
      items: [],
    };
  }
  const entityKey = `char:${cleanAvatar}`;
  const shelf = ctx?.extensionSettings?.[BOOKSHELF_SETTINGS_NS];
  const rawCrop = shelf?.crops?.[entityKey] || {};
  const rawGal = shelf?.galleries?.[entityKey] || {};
  const rawItems = Array.isArray(rawGal.items) ? rawGal.items : [];

  const items = [];
  const seenIds = new Set();
  for (let i = 0; i < rawItems.length && items.length < 24; i += 1) {
    const it = rawItems[i];
    if (!it || typeof it !== 'object' || typeof it.url !== 'string' || !it.url.trim()) continue;
    const id = String(it.id || `cov_${i + 1}`).trim().slice(0, 64);
    if (!id || id === 'primary' || seenIds.has(id)) continue;
    seenIds.add(id);
    items.push({
      id,
      url: it.url.trim().slice(0, 500),
      x: clampPct(it.x, 50),
      y: clampPct(it.y, 25),
    });
  }

  const rawSelected = typeof rawGal.selectedId === 'string' ? rawGal.selectedId.trim() : 'primary';
  const selectedId =
    rawSelected !== 'primary' && items.some(it => it.id === rawSelected) ? rawSelected : 'primary';

  return {
    entityKey,
    primaryCrop: {
      x: clampPct(rawCrop.x, 50),
      y: clampPct(rawCrop.y, 25),
    },
    randomCover: Boolean(rawGal.randomCover),
    selectedId,
    items,
  };
}

export function writeCharacterCoverGallery(
  ctx,
  avatar,
  patch = {},
  { bumpAvatars = false, silentEvent = false } = {},
) {
  const cleanAvatar = typeof avatar === 'string' ? avatar.trim() : '';
  const shelf = ensureBookshelfHostStore(ctx);
  if (!cleanAvatar || !shelf) return null;

  const prev = readCharacterCoverGallery(ctx, cleanAvatar);
  const nextPrimaryCrop = patch.primaryCrop
    ? {
        x: clampPct(patch.primaryCrop.x, prev.primaryCrop.x),
        y: clampPct(patch.primaryCrop.y, prev.primaryCrop.y),
      }
    : prev.primaryCrop;

  const nextItems = Array.isArray(patch.items)
    ? patch.items
        .filter(it => it && typeof it === 'object' && typeof it.url === 'string' && it.url.trim())
        .slice(0, 24)
        .map((it, idx) => ({
          id: String(it.id || `cov_${Date.now()}_${idx}`).trim().slice(0, 64),
          url: it.url.trim().slice(0, 500),
          x: clampPct(it.x, 50),
          y: clampPct(it.y, 25),
        }))
    : prev.items;

  const requestedSel =
    typeof patch.selectedId === 'string' ? patch.selectedId.trim() : prev.selectedId;
  const nextSelectedId =
    requestedSel !== 'primary' && nextItems.some(it => it.id === requestedSel)
      ? requestedSel
      : 'primary';

  const nextRandom =
    typeof patch.randomCover === 'boolean' ? patch.randomCover : prev.randomCover;

  shelf.crops[prev.entityKey] = nextPrimaryCrop;
  shelf.galleries[prev.entityKey] = {
    randomCover: nextRandom,
    selectedId: nextSelectedId,
    items: nextItems,
  };

  if (bumpAvatars) {
    coverCacheRevision += 1;
  }

  ctx?.saveSettingsDebounced?.();
  if (!silentEvent) {
    globalThis.dispatchEvent?.(
      new CustomEvent('yantai:bookshelf:gallery-updated', {
        detail: { entityKey: prev.entityKey, bumpAvatars },
      }),
    );
  }

  return readCharacterCoverGallery(ctx, cleanAvatar);
}

async function fileToCompressedGalleryPayload(file) {
  const mime = String(file?.type || '').toLowerCase();
  const isGif = mime === 'image/gif' || /\.gif$/i.test(String(file?.name || ''));

  // 在支持 Canvas 的浏览器环境下，将超大图压缩为高清轻量 WebP（最长边 1440px），确保手机滑书架零卡顿
  if (
    !isGif &&
    typeof globalThis.createImageBitmap === 'function' &&
    typeof globalThis.document?.createElement === 'function'
  ) {
    try {
      const bitmap = await globalThis.createImageBitmap(file);
      const maxSide = 1440;
      const ratio = Math.min(1, maxSide / Math.max(bitmap.width || 1, bitmap.height || 1));
      const w = Math.max(1, Math.round(bitmap.width * ratio));
      const h = Math.max(1, Math.round(bitmap.height * ratio));
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx2d = canvas.getContext?.('2d');
      if (ctx2d) {
        ctx2d.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const dataUrl = canvas.toDataURL('image/webp', 0.88);
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/webp;base64,')) {
          return {
            base64: dataUrl.slice('data:image/webp;base64,'.length),
            format: 'webp',
          };
        }
      } else {
        bitmap.close?.();
      }
    } catch {
      // 回退原字节流编码
    }
  }

  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 =
    typeof globalThis.btoa === 'function'
      ? globalThis.btoa(binary)
      : Buffer.from(bytes).toString('base64');
  const extMatch = String(file?.name || '').match(/\.([a-z0-9]+)$/i);
  const rawExt = extMatch ? extMatch[1].toLowerCase() : '';
  const format = ['webp', 'png', 'jpg', 'jpeg', 'gif'].includes(rawExt)
    ? rawExt === 'jpeg'
      ? 'jpg'
      : rawExt
    : mime.includes('png')
      ? 'png'
      : mime.includes('gif')
        ? 'gif'
        : mime.includes('webp')
          ? 'webp'
          : 'jpg';
  return { base64, format };
}

/**
 * 替换酒馆原始角色卡图片（角色设定与历史聊天存档 100% 保留）。
 */
export async function replacePrimaryCharacterAvatarFile(
  file,
  { getContext, avatar = '', fetchImpl = globalThis.fetch } = {},
) {
  if (!file) throw new Error('请选择要替换的角色图片文件');
  const ctx = getContext?.();
  const targetAvatar =
    (typeof avatar === 'string' && avatar.trim()) ||
    readActiveCharacterProfile(ctx)?.avatar ||
    '';
  if (!targetAvatar || targetAvatar === 'none') {
    throw new Error('当前角色无原始角色图片文件');
  }

  const form = new FormData();
  form.append('avatar', file, file.name || 'avatar.png');
  form.append('avatar_url', targetAvatar);

  const headers =
    ctx?.getRequestHeaders?.({ omitContentType: true }) || {};
  delete headers['Content-Type'];
  delete headers['content-type'];

  const base = globalThis.document?.baseURI || globalThis.location?.origin || 'http://localhost/';
  const endpoint = new URL('api/characters/edit-avatar', base).href;
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: form,
    cache: 'no-store',
  });
  if (!res?.ok) {
    throw new Error(`更换原始角色封面失败 (HTTP ${res?.status || 0})`);
  }

  writeCharacterCoverGallery(ctx, targetAvatar, {}, { bumpAvatars: true });
  return { ok: true, avatar: targetAvatar };
}

/**
 * 上传一张或多张备用角色立绘到酒馆服务端图库 (`api/images/upload`)，并挂载至角色封面池。
 */
export async function uploadCharacterGalleryFiles(
  files,
  { getContext, avatar = '', fetchImpl = globalThis.fetch } = {},
) {
  const fileList = Array.from(files || []).filter(Boolean);
  if (fileList.length === 0) return { added: [], gallery: null };

  const ctx = getContext?.();
  const targetAvatar =
    (typeof avatar === 'string' && avatar.trim()) ||
    readActiveCharacterProfile(ctx)?.avatar ||
    '';
  if (!targetAvatar || targetAvatar === 'none') {
    throw new Error('请先进入单人角色卡再上传多图封面');
  }

  const base = globalThis.document?.baseURI || globalThis.location?.origin || 'http://localhost/';
  const endpoint = new URL('api/images/upload', base).href;
  const headers = {
    'Content-Type': 'application/json',
    ...(typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {}),
  };

  const stem = targetAvatar.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 32) || 'char';
  const current = readCharacterCoverGallery(ctx, targetAvatar);
  const nextItems = [...current.items];
  const added = [];

  for (let i = 0; i < fileList.length && nextItems.length < 24; i += 1) {
    const file = fileList[i];
    const { base64, format } = await fileToCompressedGalleryPayload(file);
    const stamp = `${Date.now()}_${i + 1}`;
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image: base64,
        format,
        ch_name: '_yantai_covers',
        filename: `${stem}_${stamp}`,
      }),
    });
    if (!res?.ok) {
      throw new Error(`上传角色图失败 (HTTP ${res?.status || 0})`);
    }
    const payload = await res.json();
    const relPath = typeof payload?.path === 'string' ? payload.path.trim() : '';
    if (!relPath) {
      throw new Error('服务端未返回有效图片路径');
    }
    const entry = {
      id: `cov_${stamp}`,
      url: relPath,
      x: 50,
      y: 25,
    };
    nextItems.push(entry);
    added.push(entry);
  }

  const autoEnableRandom = current.items.length === 0 && added.length > 0 ? true : current.randomCover;
  const nextSelectedId =
    !autoEnableRandom && added.length > 0 ? added[added.length - 1].id : current.selectedId;

  const updated = writeCharacterCoverGallery(ctx, targetAvatar, {
    items: nextItems,
    randomCover: autoEnableRandom,
    selectedId: nextSelectedId,
  });

  return { added, gallery: updated };
}

/**
 * 从角色封面池移除一张备用图，并尽力通知酒馆清理对应磁盘图片文件。
 */
export async function deleteCharacterGalleryItem(
  itemId,
  { getContext, avatar = '', fetchImpl = globalThis.fetch } = {},
) {
  const ctx = getContext?.();
  const targetAvatar =
    (typeof avatar === 'string' && avatar.trim()) ||
    readActiveCharacterProfile(ctx)?.avatar ||
    '';
  if (!targetAvatar) return null;

  const current = readCharacterCoverGallery(ctx, targetAvatar);
  const target = current.items.find(it => it.id === itemId);
  const remaining = current.items.filter(it => it.id !== itemId);

  if (target?.url && typeof fetchImpl === 'function') {
    try {
      const base = globalThis.document?.baseURI || globalThis.location?.origin || 'http://localhost/';
      const headers = {
        'Content-Type': 'application/json',
        ...(typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {}),
      };
      await fetchImpl(new URL('api/images/delete', base).href, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: target.url }),
      });
    } catch {
      // 忽略清理失败
    }
  }

  return writeCharacterCoverGallery(ctx, targetAvatar, {
    items: remaining,
    randomCover: remaining.length > 0 ? current.randomCover : false,
    selectedId: current.selectedId === itemId ? 'primary' : current.selectedId,
  });
}
