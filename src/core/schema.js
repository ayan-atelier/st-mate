/**
 * ST伴侣 (st-mate) · 配置模型与幂等迁移存储层
 * 严格隔离在 extensionSettings.st_mate 命名空间下，绝不污染酒馆全局或其他扩展配置。
 * 安全准则：API 密钥 100% 存入酒馆原生加密保险箱 secrets.json，此处仅记录 secretId 与掩码标签，绝不落盘明文密钥。
 */

export const STM_NAMESPACE = 'st_mate';
export const STM_SCHEMA_VERSION = 6;

export const TOPBAR_MODES = Object.freeze(['rp', 'native']);
export const NATIVE_TOPBAR_DRAWER_ITEMS = Object.freeze([
  { id: 'ai-config-button', label: '预设与参数', icon: 'sliders' },
  { id: 'sys-settings-button', label: 'API 连接', icon: 'plug' },
  { id: 'advanced-formatting-button', label: '排版格式', icon: 'typography' },
  { id: 'WI-SP-button', label: '世界书', icon: 'globe' },
  { id: 'user-settings-button', label: '界面主题', icon: 'settings' },
  { id: 'backgrounds-button', label: '背景图', icon: 'image' },
  { id: 'extensions-settings-button', label: '扩展管理', icon: 'grid' },
  { id: 'persona-management-button', label: '人设管理', icon: 'user' },
  { id: 'rightNavHolder', label: '角色管理', icon: 'idcard' },
]);
const NATIVE_TOPBAR_DRAWER_ID_SET = new Set(NATIVE_TOPBAR_DRAWER_ITEMS.map(item => item.id));
export const TAP_SCOPES = Object.freeze(['all']);
export const HOME_ENTRY_MODES = Object.freeze(['bookshelf-bar', 'floating']);
export const DRAWER_BRIDGE_MODES = Object.freeze(['inline-switch', 'popover']);
export const BACKDROP_MODES = Object.freeze(['theme', 'character', 'custom']);
export const PARAGRAPH_INDENTS = Object.freeze(['default', 'flush', 'indent']);
export const FONT_CHOICES = Object.freeze(['default', 'huiwen', 'serif', 'sans', 'kai', 'custom']);
export const VERTEX_AUTH_MODES = Object.freeze(['express', 'full']);
export const AUX_API_MODES = Object.freeze(['follow_main', 'station']);

export const CHAT_COMPLETION_SOURCE_IDS = Object.freeze([
  'custom',
  'vertexai',
  'makersuite',
  'claude',
  'openrouter',
  'openai',
  'deepseek',
  'siliconflow',
  'xai',
  'moonshot',
  'minimax',
  'zai',
  'groq',
  'nanogpt',
  'chutes',
  'mistralai',
  'cohere',
  'perplexity',
  'fireworks',
  'cometapi',
  'azure_openai',
  'workers_ai',
  'pollinations',
  'ai21',
  'electronhub',
  'aimlapi',
]);

export const POST_PROCESSING_IDS = Object.freeze([
  '',
  'merge',
  'merge_tools',
  'semi',
  'semi_tools',
  'strict',
  'strict_tools',
  'single',
  'claude',
]);

export const SECRET_KEY_BY_SOURCE = Object.freeze({
  custom: 'api_key_custom',
  vertexai: 'api_key_vertexai',
  makersuite: 'api_key_makersuite',
  claude: 'api_key_claude',
  openrouter: 'api_key_openrouter',
  openai: 'api_key_openai',
  deepseek: 'api_key_deepseek',
  siliconflow: 'api_key_siliconflow',
  xai: 'api_key_xai',
  moonshot: 'api_key_moonshot',
  minimax: 'api_key_minimax',
  zai: 'api_key_zai',
  groq: 'api_key_groq',
  nanogpt: 'api_key_nanogpt',
  chutes: 'api_key_chutes',
  mistralai: 'api_key_mistralai',
  cohere: 'api_key_cohere',
  perplexity: 'api_key_perplexity',
  fireworks: 'api_key_fireworks',
  cometapi: 'api_key_cometapi',
  azure_openai: 'api_key_azure_openai',
  workers_ai: 'api_key_workers_ai',
  pollinations: 'api_key_pollinations',
  ai21: 'api_key_ai21',
  electronhub: 'api_key_electronhub',
  aimlapi: 'api_key_aimlapi',
});

export function resolveDefaultSecretKey(source, vertexAuthMode = 'express') {
  if (source === 'vertexai') {
    return vertexAuthMode === 'full' ? 'vertexai_service_account_json' : 'api_key_vertexai';
  }
  return SECRET_KEY_BY_SOURCE[source] || 'api_key_custom';
}

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: STM_SCHEMA_VERSION,
  shellEnabled: true,
  topbarMode: 'rp',
  nativeTopbarHiddenIcons: Object.freeze([]), // 默认全部显示（含原生背景图图标），玩家可在原版顶栏下方按需勾选隐藏
  chatImageButton: true,
  tapPureReading: false, // 新用户默认关闭防误触，已存储的老用户状态原样保留
  tapPureReadingScope: 'all',
  homeEntryMode: 'bookshelf-bar',
  drawerBridgeMode: 'inline-switch',
  modules: Object.freeze({
    turbo: true, // 默认静默开启：底图离屏缓存、屏幕外历史楼层休眠、移动端毛玻璃与软键盘减负
    reader: true, // 默认开启：页面排版与背景调整抽屉（顶栏 Aa 键）
    bookshelf: true,
    presets: true,
    api: true,
    persona: true,
    charCard: true,
    worldBook: true,
    charWorld: true, // 兼容聚合态：charCard || worldBook
    echoes: false, // 默认关闭，玩家需要查看楼上重Roll或平行分支时按需开启
    memory: false, // 默认关闭，完全不注册拦截器，避免与其他记忆插件冲突
  }),
  vibe: Object.freeze({
    backdropMode: 'theme', // theme (原版) | character (角色图) | custom (自定义)
    backdropBrightness: 42,
    backdropClarity: 100, // 默认 100% 满清晰度原画质感，需柔焦虚化时再往左拉
    backdropBlur: 18,
    backdropDim: 55,
    customBackdropUrl: '',
    customBackdropName: '',
    fontScale: 100,
    fontSizePx: 0, // 0 表示跟随原美化字号；13~26 表示精确字号
    paddingX: 0, // 手机端左右边距（0=跟随原美化；4~48px）
    desktopPaddingX: 0, // 电脑端左右边距（0=跟随原美化；8~96px，与手机端独立记忆互不干扰）
    lineHeight: 0, // 0 表示跟随原美化行距；140~240 表示 1.40~2.40 倍行高
    paragraphIndent: 'default', // default (跟随原版) | flush (顶格) | indent (缩进两格)
    hideAvatars: false,
    bookPageFlow: false,
    fontChoice: 'default', // default | serif | sans | kai | custom
    customFontUrl: '',
    bodyColor: '', // '' 跟随原美化主题，或 '#rrggbb' 覆盖叙述正文颜色
    quoteColor: '', // '' 跟随原美化主题，或 '#rrggbb' 覆盖引号对话颜色
    emColor: '', // '' 跟随原美化主题，或 '#rrggbb' 覆盖内心独白/斜体颜色
  }),
  tidy: Object.freeze({
    enabled: true,
    optimizeOptionsMenu: true,
    foldOptionsMenu: true,
    tidyExtensionsPanel: true,
    hiddenWandEntries: Object.freeze([]),
    pinnedExtensions: Object.freeze([]),
  }),
  apiStudio: Object.freeze({
    activeStationId: '',
    defaultStationId: '',
    stations: Object.freeze([]),
  }),
  auxApi: Object.freeze({
    mode: 'follow_main', // follow_main (跟随主对话 API) | station (指定已保存站子卡片)
    enabled: false,
    stationId: '',
    model: '',
    endpoint: '',
  }),
  presetStudio: Object.freeze({
    defaultPreset: '',
    charBindings: Object.freeze({}),
    archivedPresets: Object.freeze([]),
    importedAt: Object.freeze({}),
  }),
  suiteProvisioned: Object.freeze([]),
  suiteSync: Object.freeze({
    lastCheckedVersion: '',
    lastCheckedAt: 0,
  }),
});

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function pickBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function cleanStringList(rawList, maxItems = 60, maxLen = 200) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const seen = new Set();
  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, maxLen);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function sanitizeEndpointUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim().slice(0, 500);
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return '';
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return trimmed;
    }
  } catch {
    return '';
  }
  return '';
}

export function sanitizeHexColor(rawColor) {
  if (typeof rawColor !== 'string') return '';
  const trimmed = rawColor.trim();
  if (!trimmed) return '';
  const shortMatch = trimmed.match(/^#([0-9a-f]{3})$/i);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].toLowerCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return '';
}

export function sanitizeAssetUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim().slice(0, 600);
  if (!trimmed) return '';
  // 允许酒馆相对背景目录（兼容桌面 localhost 与手机局域网 / TauriTavern）
  if (/^\/?backgrounds\/[^/?#<>"'\\]+(?:\?[^#<>"']*)?$/i.test(trimmed)) {
    return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return '';
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * 归一化单张 API 站子卡片数据（严禁保留任何 apiKey / rawKey 明文字段）。
 */
export function normalizeApiStation(raw = {}, fallbackIndex = 0) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const source = pickEnum(src.source, CHAT_COMPLETION_SOURCE_IDS, 'custom');
  const vertexAuthMode = pickEnum(src.vertexAuthMode, VERTEX_AUTH_MODES, 'express');
  const derivedSecretType = resolveDefaultSecretKey(source, vertexAuthMode);
  const rawSecretKeyType = typeof src.secretKeyType === 'string' ? src.secretKeyType.trim().slice(0, 80) : '';
  const secretKeyType =
    source === 'vertexai'
      ? derivedSecretType
      : rawSecretKeyType && Object.values(SECRET_KEY_BY_SOURCE).includes(rawSecretKeyType)
        ? rawSecretKeyType
        : derivedSecretType;

  const rawId = typeof src.id === 'string' ? src.id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) : '';
  const id = rawId || `stm_station_${fallbackIndex + 1}`;
  const rawName = typeof src.name === 'string' ? src.name.trim() : '';
  const migratedName = rawName
    .replace(/^默认\s*·\s*自定义反代$/i, '通用接口')
    .replace(
      /^默认\s*·\s*(Vertex AI|通用接口|AI Studio|Claude|OpenRouter|OpenAI|DeepSeek|硅基流动|xAI Grok|Kimi|MiniMax|智谱 Z\.AI|Groq|NanoGPT|Chutes|Mistral|Cohere|Perplexity|Fireworks|CometAPI|Azure|Workers AI|Pollinations|AI21|ElectronHub|AI\/ML API)$/i,
      '$1',
    );
  const name = migratedName ? migratedName.slice(0, 60) : `站子 ${fallbackIndex + 1}`;

  return {
    id,
    name,
    source,
    url: sanitizeEndpointUrl(src.url),
    secretKeyType,
    secretId: typeof src.secretId === 'string' ? src.secretId.trim().slice(0, 120) : '',
    secretLabel: typeof src.secretLabel === 'string' ? src.secretLabel.trim().slice(0, 120) : '',
    model: typeof src.model === 'string' ? src.model.trim().slice(0, 200) : '',
    favoriteModels: cleanStringList(src.favoriteModels, 60, 200),
    cachedModels: cleanStringList(src.cachedModels, 800, 200),
    postProcessing: pickEnum(src.postProcessing, POST_PROCESSING_IDS, ''),
    vertexAuthMode,
    vertexRegion:
      typeof src.vertexRegion === 'string' && src.vertexRegion.trim()
        ? src.vertexRegion.trim().slice(0, 60)
        : 'global',
    vertexProjectId: typeof src.vertexProjectId === 'string' ? src.vertexProjectId.trim().slice(0, 120) : '',
  };
}

function sanitizeStoredPresetName(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw
    .trim()
    .replace(/\.(?:json|settings|preset)$/i, '')
    .trim()
    .slice(0, 200);
  if (!trimmed || /^gui(?:\s+koboldai\s+settings)?$/i.test(trimmed)) return '';
  return trimmed;
}

/**
 * 归一化预设馆配置（全局默认预设 + 角色/群聊唯一键绑定映射 + 预设仓库归档列表）。
 */
export function normalizePresetStudio(raw = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const defaultPreset = sanitizeStoredPresetName(src.defaultPreset);

  const charBindings = {};
  if (src.charBindings && typeof src.charBindings === 'object' && !Array.isArray(src.charBindings)) {
    const entries = Object.entries(src.charBindings);
    let count = 0;
    for (const [rawKey, rawVal] of entries) {
      if (count >= 2000) break;
      const key = typeof rawKey === 'string' ? rawKey.trim().slice(0, 260) : '';
      if (!/^(?:char|group):.+/.test(key)) continue;
      const val = sanitizeStoredPresetName(rawVal);
      if (!val) continue;
      charBindings[key] = val;
      count += 1;
    }
  }

  const archivedPresets = [];
  const seenArchived = new Set();
  if (Array.isArray(src.archivedPresets)) {
    for (const item of src.archivedPresets) {
      const cleaned = sanitizeStoredPresetName(item);
      if (!cleaned || seenArchived.has(cleaned)) continue;
      seenArchived.add(cleaned);
      archivedPresets.push(cleaned);
      if (archivedPresets.length >= 500) break;
    }
  }

  const importedAt = {};
  if (src.importedAt && typeof src.importedAt === 'object' && !Array.isArray(src.importedAt)) {
    let tsCount = 0;
    for (const [rawName, rawTs] of Object.entries(src.importedAt)) {
      if (tsCount >= 1000) break;
      const cleaned = sanitizeStoredPresetName(rawName);
      if (!cleaned) continue;
      const num = Number(rawTs);
      if (!Number.isFinite(num) || num <= 0) continue;
      importedAt[cleaned] = Math.round(num);
      tsCount += 1;
    }
  }

  return {
    defaultPreset,
    charBindings,
    archivedPresets,
    importedAt,
  };
}

export function normalizeSettings(raw = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawModules = src.modules && typeof src.modules === 'object' ? src.modules : {};
  const rawVibe = src.vibe && typeof src.vibe === 'object' ? src.vibe : {};
  const rawTidy = src.tidy && typeof src.tidy === 'object' ? src.tidy : {};
  const rawStudio = src.apiStudio && typeof src.apiStudio === 'object' ? src.apiStudio : {};
  const rawAux = src.auxApi && typeof src.auxApi === 'object' ? src.auxApi : {};
  const rawPresetStudio = src.presetStudio && typeof src.presetStudio === 'object' ? src.presetStudio : {};
  const rawSuiteSync = src.suiteSync && typeof src.suiteSync === 'object' ? src.suiteSync : {};

  const hiddenWandEntries = cleanStringList(rawTidy.hiddenWandEntries, 80, 120);
  const pinnedExtensions = Array.isArray(rawTidy.pinnedExtensions)
    ? [
        ...new Set(
          rawTidy.pinnedExtensions
            .filter(x => typeof x === 'string' && x.trim().length > 0 && x.length < 120)
            .map(x => x.trim()),
        ),
      ].slice(0, 12)
    : [];

  const backdropBlur = clampInt(rawVibe.backdropBlur, 0, 48, DEFAULT_SETTINGS.vibe.backdropBlur);
  const backdropDim = clampInt(rawVibe.backdropDim, 0, 88, DEFAULT_SETTINGS.vibe.backdropDim);

  const derivedBrightness =
    rawVibe.backdropBrightness !== undefined
      ? clampInt(rawVibe.backdropBrightness, 8, 95, DEFAULT_SETTINGS.vibe.backdropBrightness)
      : rawVibe.backdropDim !== undefined
        ? clampInt(100 - backdropDim, 8, 95, DEFAULT_SETTINGS.vibe.backdropBrightness)
        : DEFAULT_SETTINGS.vibe.backdropBrightness;

  const derivedClarity =
    rawVibe.backdropClarity !== undefined
      ? clampInt(rawVibe.backdropClarity, 0, 100, DEFAULT_SETTINGS.vibe.backdropClarity)
      : rawVibe.backdropBlur !== undefined
        ? clampInt(Math.round(100 - backdropBlur * 2.1), 0, 100, DEFAULT_SETTINGS.vibe.backdropClarity)
        : DEFAULT_SETTINGS.vibe.backdropClarity;

  const fontScale = clampInt(rawVibe.fontScale, 85, 140, DEFAULT_SETTINGS.vibe.fontScale);
  const fontSizePx =
    rawVibe.fontSizePx === 0 || rawVibe.fontSizePx === undefined || rawVibe.fontSizePx === null
      ? rawVibe.fontScale !== undefined && fontScale !== 100
        ? clampInt(Math.round((16 * fontScale) / 100), 13, 26, 0)
        : 0
      : clampInt(rawVibe.fontSizePx, 13, 26, 0);

  // 兼容旧版 spaced 枚举自动归并至 flush（顶格）
  const normalizedIndent =
    rawVibe.paragraphIndent === 'spaced'
      ? 'flush'
      : pickEnum(rawVibe.paragraphIndent, PARAGRAPH_INDENTS, DEFAULT_SETTINGS.vibe.paragraphIndent);

  // 归一化 API 站子卡片列表（确保 ID 唯一、最多保留 50 张）
  const stations = [];
  const usedIds = new Set();
  if (Array.isArray(rawStudio.stations)) {
    for (let i = 0; i < rawStudio.stations.length && stations.length < 50; i += 1) {
      const st = normalizeApiStation(rawStudio.stations[i], i);
      let uniqueId = st.id;
      let suffix = 2;
      while (usedIds.has(uniqueId)) {
        uniqueId = `${st.id}_${suffix}`;
        suffix += 1;
      }
      usedIds.add(uniqueId);
      stations.push(uniqueId === st.id ? st : { ...st, id: uniqueId });
    }
  }

  const requestedActiveId = typeof rawStudio.activeStationId === 'string' ? rawStudio.activeStationId.trim() : '';
  const activeStationId =
    stations.length === 0
      ? ''
      : stations.some(st => st.id === requestedActiveId)
        ? requestedActiveId
        : stations[0].id;

  const requestedDefaultId =
    typeof rawStudio.defaultStationId === 'string' ? rawStudio.defaultStationId.trim() : '';
  const defaultStationId = stations.some(st => st.id === requestedDefaultId) ? requestedDefaultId : '';

  // 伴侣助手副 API 归一化（兼容旧版 enabled 布尔开关与新版 mode 枚举）
  let auxMode = 'follow_main';
  if (AUX_API_MODES.includes(rawAux.mode)) {
    auxMode = rawAux.mode;
  } else if (rawAux.enabled === true) {
    auxMode = 'station';
  }
  const rawAuxStationId = typeof rawAux.stationId === 'string' ? rawAux.stationId.trim().slice(0, 80) : '';

  const fallbackCharWorld = pickBool(rawModules.charWorld, DEFAULT_SETTINGS.modules.charWorld);
  const resolvedCharCard = pickBool(rawModules.charCard, fallbackCharWorld);
  const resolvedWorldBook = pickBool(rawModules.worldBook, fallbackCharWorld);

  const rawSyncAt = Number(rawSuiteSync.lastCheckedAt);
  const normalizedSyncAt =
    Number.isFinite(rawSyncAt) && rawSyncAt >= 0 ? Math.round(rawSyncAt) : 0;

  const nativeTopbarHiddenIcons = Array.isArray(src.nativeTopbarHiddenIcons)
    ? [
        ...new Set(
          src.nativeTopbarHiddenIcons
            .filter(id => typeof id === 'string' && NATIVE_TOPBAR_DRAWER_ID_SET.has(id.trim()))
            .map(id => id.trim()),
        ),
      ]
    : [];

  return {
    schemaVersion: STM_SCHEMA_VERSION,
    shellEnabled: pickBool(src.shellEnabled, DEFAULT_SETTINGS.shellEnabled),
    topbarMode: pickEnum(src.topbarMode, TOPBAR_MODES, DEFAULT_SETTINGS.topbarMode),
    nativeTopbarHiddenIcons,
    chatImageButton: pickBool(src.chatImageButton, DEFAULT_SETTINGS.chatImageButton),
    tapPureReading: pickBool(src.tapPureReading, DEFAULT_SETTINGS.tapPureReading),
    tapPureReadingScope: 'all',
    homeEntryMode: pickEnum(src.homeEntryMode, HOME_ENTRY_MODES, DEFAULT_SETTINGS.homeEntryMode),
    drawerBridgeMode: pickEnum(src.drawerBridgeMode, DRAWER_BRIDGE_MODES, DEFAULT_SETTINGS.drawerBridgeMode),
    modules: {
      turbo: pickBool(rawModules.turbo, DEFAULT_SETTINGS.modules.turbo),
      reader: pickBool(rawModules.reader, DEFAULT_SETTINGS.modules.reader),
      bookshelf: pickBool(rawModules.bookshelf, DEFAULT_SETTINGS.modules.bookshelf),
      presets: pickBool(rawModules.presets, DEFAULT_SETTINGS.modules.presets),
      api: pickBool(rawModules.api, DEFAULT_SETTINGS.modules.api),
      persona: pickBool(rawModules.persona, DEFAULT_SETTINGS.modules.persona),
      charCard: resolvedCharCard,
      worldBook: resolvedWorldBook,
      charWorld: Boolean(resolvedCharCard || resolvedWorldBook),
      echoes: pickBool(rawModules.echoes, DEFAULT_SETTINGS.modules.echoes),
      memory: pickBool(rawModules.memory, DEFAULT_SETTINGS.modules.memory),
    },
    vibe: {
      backdropMode: pickEnum(rawVibe.backdropMode, BACKDROP_MODES, DEFAULT_SETTINGS.vibe.backdropMode),
      backdropBrightness: derivedBrightness,
      backdropClarity: derivedClarity,
      backdropBlur,
      backdropDim,
      customBackdropUrl: sanitizeAssetUrl(rawVibe.customBackdropUrl),
      customBackdropName: typeof rawVibe.customBackdropName === 'string' ? rawVibe.customBackdropName.trim().slice(0, 80) : '',
      fontScale,
      fontSizePx,
      paddingX: clampInt(rawVibe.paddingX, 0, 64, DEFAULT_SETTINGS.vibe.paddingX),
      desktopPaddingX: clampInt(rawVibe.desktopPaddingX, 0, 120, DEFAULT_SETTINGS.vibe.desktopPaddingX),
      lineHeight:
        rawVibe.lineHeight === 0 || rawVibe.lineHeight === undefined || rawVibe.lineHeight === null
          ? 0
          : clampInt(rawVibe.lineHeight, 135, 240, 0),
      paragraphIndent: normalizedIndent,
      hideAvatars: pickBool(rawVibe.hideAvatars, DEFAULT_SETTINGS.vibe.hideAvatars),
      bookPageFlow: pickBool(rawVibe.bookPageFlow, DEFAULT_SETTINGS.vibe.bookPageFlow),
      fontChoice: pickEnum(rawVibe.fontChoice, FONT_CHOICES, DEFAULT_SETTINGS.vibe.fontChoice),
      customFontUrl: sanitizeAssetUrl(rawVibe.customFontUrl),
      bodyColor: sanitizeHexColor(rawVibe.bodyColor),
      quoteColor: sanitizeHexColor(rawVibe.quoteColor),
      emColor: sanitizeHexColor(rawVibe.emColor),
    },
    tidy: {
      enabled: pickBool(rawTidy.enabled, DEFAULT_SETTINGS.tidy.enabled),
      optimizeOptionsMenu: pickBool(rawTidy.optimizeOptionsMenu, DEFAULT_SETTINGS.tidy.optimizeOptionsMenu),
      foldOptionsMenu: pickBool(rawTidy.foldOptionsMenu, DEFAULT_SETTINGS.tidy.foldOptionsMenu),
      tidyExtensionsPanel: pickBool(rawTidy.tidyExtensionsPanel, DEFAULT_SETTINGS.tidy.tidyExtensionsPanel),
      hiddenWandEntries,
      pinnedExtensions,
    },
    apiStudio: {
      activeStationId,
      defaultStationId,
      stations,
    },
    auxApi: {
      mode: auxMode,
      enabled: auxMode === 'station',
      stationId: rawAuxStationId,
      model: typeof rawAux.model === 'string' ? rawAux.model.trim().slice(0, 200) : '',
      endpoint: typeof rawAux.endpoint === 'string' ? rawAux.endpoint.trim().slice(0, 500) : '',
    },
    presetStudio: normalizePresetStudio(rawPresetStudio),
    suiteProvisioned: Array.isArray(src.suiteProvisioned)
      ? [
          ...new Set(
            src.suiteProvisioned
              .filter(item => typeof item === 'string' && /^[a-z0-9_-]{1,64}$/i.test(item.trim()))
              .map(item => item.trim())
              .slice(0, 20),
          ),
        ]
      : [],
    suiteSync: {
      lastCheckedVersion:
        typeof rawSuiteSync.lastCheckedVersion === 'string'
          ? rawSuiteSync.lastCheckedVersion.trim().slice(0, 40)
          : '',
      lastCheckedAt: normalizedSyncAt,
    },
  };
}

export function createSettingsStore({ getContext }) {
  const subscribers = new Set();
  let cache = normalizeSettings({});

  function hydrate() {
    const ctx = getContext?.();
    const hostStore = ctx?.extensionSettings;
    if (hostStore && typeof hostStore === 'object') {
      cache = normalizeSettings(hostStore[STM_NAMESPACE]);
      hostStore[STM_NAMESPACE] = cache;
    }
    return cache;
  }

  function get() {
    return cache;
  }

  function update(patch = {}, { silent = false } = {}) {
    const modPatch = patch?.modules && typeof patch.modules === 'object' ? { ...patch.modules } : {};
    if (
      typeof modPatch.charWorld === 'boolean' &&
      modPatch.charCard === undefined &&
      modPatch.worldBook === undefined
    ) {
      modPatch.charCard = modPatch.charWorld;
      modPatch.worldBook = modPatch.charWorld;
    }
    const nextRaw = {
      ...cache,
      ...patch,
      modules: { ...cache.modules, ...modPatch },
      vibe: { ...cache.vibe, ...(patch?.vibe || {}) },
      tidy: { ...cache.tidy, ...(patch?.tidy || {}) },
      apiStudio: patch?.apiStudio ? { ...cache.apiStudio, ...patch.apiStudio } : cache.apiStudio,
      auxApi: { ...cache.auxApi, ...(patch?.auxApi || {}) },
      presetStudio: patch?.presetStudio ? { ...cache.presetStudio, ...patch.presetStudio } : cache.presetStudio,
      suiteSync: patch?.suiteSync ? { ...cache.suiteSync, ...patch.suiteSync } : cache.suiteSync,
    };
    cache = normalizeSettings(nextRaw);

    const ctx = getContext?.();
    if (ctx?.extensionSettings && typeof ctx.extensionSettings === 'object') {
      ctx.extensionSettings[STM_NAMESPACE] = cache;
      ctx.saveSettingsDebounced?.();
    }

    if (!silent) {
      for (const listener of subscribers) {
        try {
          listener(cache);
        } catch (err) {
          console.warn('[ST伴侣] 设置监听回调异常:', err);
        }
      }
    }
    return cache;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  hydrate();
  return { hydrate, get, update, subscribe };
}
