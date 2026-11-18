/**
 * ST伴侣 (st-mate) · 配置模型与幂等迁移存储层
 * 严格隔离在 extensionSettings.st_mate 命名空间下，绝不污染酒馆全局或其他扩展配置。
 */

export const STM_NAMESPACE = 'st_mate';
export const STM_SCHEMA_VERSION = 3;

export const TOPBAR_MODES = Object.freeze(['rp', 'reading']);
export const TAP_SCOPES = Object.freeze(['all', 'reading']);
export const HOME_ENTRY_MODES = Object.freeze(['bookshelf-bar', 'floating']);
export const DRAWER_BRIDGE_MODES = Object.freeze(['inline-switch', 'popover']);
export const BACKDROP_MODES = Object.freeze(['theme', 'character', 'custom']);
export const PARAGRAPH_INDENTS = Object.freeze(['default', 'flush', 'indent']);
export const FONT_CHOICES = Object.freeze(['default', 'serif', 'sans', 'kai', 'custom']);

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: STM_SCHEMA_VERSION,
  shellEnabled: true,
  topbarMode: 'rp',
  tapPureReading: true,
  tapPureReadingScope: 'all',
  homeEntryMode: 'bookshelf-bar',
  drawerBridgeMode: 'inline-switch',
  modules: Object.freeze({
    turbo: true, // 默认静默开启：底图离屏缓存、屏幕外历史楼层休眠、移动端毛玻璃与软键盘减负
    reader: true, // 默认开启：页面排版与背景调整抽屉（顶栏 Aa 键）
    bookshelf: true,
    presets: true,
    persona: true,
    charWorld: true,
    echoes: false, // 默认关闭，玩家需要查看楼上重Roll或平行分支时按需开启
    memory: false, // 默认关闭，完全不注册拦截器，避免与其他记忆插件冲突
  }),
  vibe: Object.freeze({
    backdropMode: 'theme', // theme (原版) | character (角色图) | custom (自定义)
    backdropBrightness: 42,
    backdropClarity: 55,
    backdropBlur: 18,
    backdropDim: 55,
    customBackdropUrl: '',
    customBackdropName: '',
    fontScale: 100,
    fontSizePx: 0, // 0 表示跟随原美化字号；13~26 表示精确字号
    paddingX: 0, // 0 表示跟随原美化边距；4~64px 表示自定义左右边距
    lineHeight: 0, // 0 表示跟随原美化行距；140~240 表示 1.40~2.40 倍行高
    paragraphIndent: 'default', // default (跟随原版) | flush (顶格) | indent (缩进两格)
    hideAvatars: false,
    bookPageFlow: false,
    fontChoice: 'default', // default | serif | sans | kai | custom
    customFontUrl: '',
  }),
  tidy: Object.freeze({
    foldOptionsMenu: true,
    pinnedExtensions: Object.freeze([]),
  }),
  auxApi: Object.freeze({
    enabled: false,
    endpoint: '',
    model: '',
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

export function normalizeSettings(raw = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawModules = src.modules && typeof src.modules === 'object' ? src.modules : {};
  const rawVibe = src.vibe && typeof src.vibe === 'object' ? src.vibe : {};
  const rawTidy = src.tidy && typeof src.tidy === 'object' ? src.tidy : {};
  const rawAux = src.auxApi && typeof src.auxApi === 'object' ? src.auxApi : {};

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

  return {
    schemaVersion: STM_SCHEMA_VERSION,
    shellEnabled: pickBool(src.shellEnabled, DEFAULT_SETTINGS.shellEnabled),
    topbarMode: pickEnum(src.topbarMode, TOPBAR_MODES, DEFAULT_SETTINGS.topbarMode),
    tapPureReading: pickBool(src.tapPureReading, DEFAULT_SETTINGS.tapPureReading),
    tapPureReadingScope: pickEnum(src.tapPureReadingScope, TAP_SCOPES, DEFAULT_SETTINGS.tapPureReadingScope),
    homeEntryMode: pickEnum(src.homeEntryMode, HOME_ENTRY_MODES, DEFAULT_SETTINGS.homeEntryMode),
    drawerBridgeMode: pickEnum(src.drawerBridgeMode, DRAWER_BRIDGE_MODES, DEFAULT_SETTINGS.drawerBridgeMode),
    modules: {
      turbo: pickBool(rawModules.turbo, DEFAULT_SETTINGS.modules.turbo),
      reader: pickBool(rawModules.reader, DEFAULT_SETTINGS.modules.reader),
      bookshelf: pickBool(rawModules.bookshelf, DEFAULT_SETTINGS.modules.bookshelf),
      presets: pickBool(rawModules.presets, DEFAULT_SETTINGS.modules.presets),
      persona: pickBool(rawModules.persona, DEFAULT_SETTINGS.modules.persona),
      charWorld: pickBool(rawModules.charWorld, DEFAULT_SETTINGS.modules.charWorld),
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
      lineHeight:
        rawVibe.lineHeight === 0 || rawVibe.lineHeight === undefined || rawVibe.lineHeight === null
          ? 0
          : clampInt(rawVibe.lineHeight, 135, 240, 0),
      paragraphIndent: normalizedIndent,
      hideAvatars: pickBool(rawVibe.hideAvatars, DEFAULT_SETTINGS.vibe.hideAvatars),
      bookPageFlow: pickBool(rawVibe.bookPageFlow, DEFAULT_SETTINGS.vibe.bookPageFlow),
      fontChoice: pickEnum(rawVibe.fontChoice, FONT_CHOICES, DEFAULT_SETTINGS.vibe.fontChoice),
      customFontUrl: sanitizeAssetUrl(rawVibe.customFontUrl),
    },
    tidy: {
      foldOptionsMenu: pickBool(rawTidy.foldOptionsMenu, DEFAULT_SETTINGS.tidy.foldOptionsMenu),
      pinnedExtensions,
    },
    auxApi: {
      enabled: pickBool(rawAux.enabled, DEFAULT_SETTINGS.auxApi.enabled),
      endpoint: typeof rawAux.endpoint === 'string' ? rawAux.endpoint.trim().slice(0, 500) : '',
      model: typeof rawAux.model === 'string' ? rawAux.model.trim().slice(0, 200) : '',
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
    const nextRaw = {
      ...cache,
      ...patch,
      modules: { ...cache.modules, ...(patch?.modules || {}) },
      vibe: { ...cache.vibe, ...(patch?.vibe || {}) },
      tidy: { ...cache.tidy, ...(patch?.tidy || {}) },
      auxApi: { ...cache.auxApi, ...(patch?.auxApi || {}) },
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
