/**
 * ST伴侣 (st-mate) · 全家桶套件自动补齐、旧版防冲突休眠与环境体检协调器
 * 核心职责：
 * 1. 新用户零门槛开箱：闲时串行检测并自动补装缺失的《角色书架》《人设馆》《重Roll助手》《叙事记忆》（装前预写开关状态，默认关闭项零拦截静默待命，且支持页面内随时开关）；
 * 2. 尊重老玩家卸载自由：记录已初始化清单 suiteProvisioned，若玩家后续在酒馆扩展栏手动卸载某子插件，刷新绝不强行重装（直至在伴侣内主动开启开关或点一键补齐）；
 * 3. 同门旧版防打架：自动休眠已被伴侣整合替代的旧版独立《砚台 · 界面整理》（清理其 display:contents 与深度监听防 iOS TT 闪退），并对低于最低兼容水位线的子插件提示一键更新；
 * 4. 养蛊排障逃生舱：支持 ?stm_safe=1 URL 安全模式挂起启动，以及零隐私泄漏的「一键复制环境排障体检单」。
 */

import { detectPlatform } from './env.js?v=0.9.14';

export const TAVERN_HELPER_SPEC = Object.freeze({
  folderName: 'JS-Slash-Runner',
  displayName: '酒馆助手',
  repoUrl: 'https://github.com/N0VI028/JS-Slash-Runner',
  domSelector: '#TH-settings, #tavern-helper-settings, #tavern_helper_settings, #js-slash-runner-settings',
});

export const COMPANION_PLUGINS = Object.freeze([
  {
    moduleKey: 'bookshelf',
    registryId: 'yantai-bookshelf',
    folderName: 'yantai-bookshelf',
    displayName: '砚台 · 角色书架',
    repoUrl: 'https://github.com/ayan-atelier/yantai-bookshelf',
    minVersion: '1.5.5',
    defaultEnabled: true,
    legacyDomSelector: '.jd-bookshelf, #jd-bookshelf-return',
  },
  {
    moduleKey: 'persona',
    registryId: 'yantai-persona-studio',
    folderName: 'yantai-persona-studio',
    displayName: '砚台 · 人设馆',
    repoUrl: 'https://github.com/ayan-atelier/yantai-persona-studio',
    minVersion: '1.1.9',
    defaultEnabled: true,
    legacyDomSelector: '#yt-persona-native-workspace',
  },
  {
    moduleKey: 'echoes',
    registryId: 'yantai-echoes',
    folderName: 'yantai-echoes',
    displayName: '砚台 · 重Roll助手',
    repoUrl: 'https://github.com/ayan-atelier/yantai-echoes',
    minVersion: '1.0.4',
    defaultEnabled: false,
    legacyDomSelector: '#yte-setting-enabled, .yte-bar',
  },
  {
    moduleKey: 'memory',
    registryId: 'yantai-memory',
    folderName: 'yantai-memory',
    displayName: '砚台 · 记忆增强',
    repoUrl: 'https://github.com/ayan-atelier/yantai-memory',
    minVersion: '0.4.3',
    defaultEnabled: false,
    legacyDomSelector: '#yt-memory-dialog, #yt-memory-settings',
  },
]);

const LEGACY_INTERFACE_EXT_ID = 'third-party/yantai-interface';

function parseSemverTuple(raw) {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  };
}

/**
 * 比较两个语义化版本号：a < b 返回 -1，a === b 返回 0，a > b 返回 1；格式非法返回 null。
 */
export function compareSemver(a, b) {
  const pa = parseSemverTuple(a);
  const pb = parseSemverTuple(b);
  if (!pa || !pb) return null;

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;

  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i += 1) {
    const xa = pa.pre[i];
    const xb = pb.pre[i];
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    const na = /^\d+$/.test(xa);
    const nb = /^\d+$/.test(xb);
    if (na && nb && Number(xa) !== Number(xb)) {
      return Number(xa) < Number(xb) ? -1 : 1;
    }
    if (na !== nb) return na ? -1 : 1;
    if (xa !== xb) return xa < xb ? -1 : 1;
  }
  return 0;
}

/**
 * 检测网址是否携带 ?stm_safe=1 或 #stm_safe=1 安全逃生模式参数。
 */
export function isSafeModeRequested(root = globalThis) {
  const search = String(root?.location?.search || '');
  const hash = String(root?.location?.hash || '');
  const checkPart = raw => {
    if (!raw) return false;
    const qIdx = raw.indexOf('?');
    const queryStr = raw.startsWith('?')
      ? raw.slice(1)
      : qIdx >= 0
        ? raw.slice(qIdx + 1)
        : raw.startsWith('#')
          ? raw.slice(1)
          : raw;
    try {
      const params = new URLSearchParams(queryStr);
      const val = String(params.get('stm_safe') || '').trim().toLowerCase();
      return val === '1' || val === 'true' || val === 'yes';
    } catch {
      return /(?:^|[?&#])stm_safe=(?:1|true|yes)(?:$|[&#])/i.test(raw);
    }
  };
  return checkPart(search) || checkPart(hash);
}

function resolveAppUrl(relativePath, root = globalThis) {
  const base = root?.document?.baseURI || root?.location?.origin || 'http://localhost/';
  return new URL(relativePath, base).href;
}

async function fetchWithTimeout(fetcher, url, init = {}, timeoutMs = 15000) {
  const AbortCtrl = globalThis.AbortController;
  const controller = typeof AbortCtrl === 'function' ? new AbortCtrl() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : 0;
  try {
    return await fetcher(url, controller ? { ...init, signal: controller.signal } : init);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 在新装子插件首次挂载前，将伴侣 store 中的开关状态预先写入宿主 extensionSettings，
 * 确保默认关闭的《重Roll助手》与《叙事记忆》安装完成即处于纯净待命态，零生成拦截、零界面打扰。
 */
export function preSeedCompanionSettings({ getContext, store, forceSyncKeys = null }) {
  const ctx = getContext?.();
  const extSettings = ctx?.extensionSettings;
  if (!extSettings || typeof extSettings !== 'object') return;

  const mods = store?.get?.()?.modules || {};
  const forceSet = forceSyncKeys ? new Set(forceSyncKeys) : null;
  let dirty = false;

  const syncField = (nsKey, propKey, moduleKey) => {
    if (!extSettings[nsKey] || typeof extSettings[nsKey] !== 'object') {
      extSettings[nsKey] = {};
      dirty = true;
    }
    const desired = Boolean(mods[moduleKey]);
    if (typeof extSettings[nsKey][propKey] !== 'boolean' || forceSet?.has(moduleKey)) {
      if (extSettings[nsKey][propKey] !== desired) {
        extSettings[nsKey][propKey] = desired;
        dirty = true;
      }
    }
  };

  syncField('jingdu_bookshelf', 'enabled', 'bookshelf');
  syncField('yantai-persona-studio', 'enabled', 'persona');
  syncField('yantai_echoes', 'enabled', 'echoes');
  syncField('yantai', 'controlEnabled', 'memory');

  if (dirty) {
    ctx?.saveSettingsDebounced?.();
  }
}

/**
 * 自动识别并无损休眠已被 ST伴侣完整替代的旧版独立《砚台 · 界面整理》(yantai-interface)：
 * - 立即清除其注入的 #yt-interface-active-style 与 #extensions_settings 上的 display:contents 行内重排（根治 iOS TT 多插件闪退）；
 * - 将被其挪入 #yt-interface-more-panel 的三横菜单项安全归位；
 * - 将 yantaiInterface.enabled 置为 false，并在确认已安装该扩展目录时加入 disabledExtensions 防止下次开机双跑。
 */
export function retireRedundantLegacyPlugins({ root = globalThis, getContext, discovered = [] } = {}) {
  const doc = root?.document;
  const ctx = getContext?.();
  const extSettings = ctx?.extensionSettings;

  let retiredInterface = false;
  let dirtySettings = false;

  const yf = extSettings?.yantaiInterface;
  const hasInterfaceStyle = Boolean(doc?.getElementById?.('yt-interface-active-style'));
  const hasInterfaceDom = Boolean(
    hasInterfaceStyle ||
      doc?.getElementById?.('yt-interface-more') ||
      doc?.getElementById?.('yt-if-more-extensions') ||
      doc?.getElementById?.('yt-interface-settings'),
  );
  const discoveredInterface = Array.isArray(discovered)
    ? discovered.some(item => item?.name === LEGACY_INTERFACE_EXT_ID)
    : false;

  if (yf && typeof yf === 'object') {
    if (yf.enabled !== false) {
      yf.enabled = false;
      retiredInterface = true;
      dirtySettings = true;
    }
    if (Array.isArray(yf.hiddenTop) && yf.hiddenTop.length > 0) {
      yf.hiddenTop = [];
      dirtySettings = true;
    }
  }

  if (discoveredInterface && extSettings && Array.isArray(extSettings.disabledExtensions)) {
    if (!extSettings.disabledExtensions.includes(LEGACY_INTERFACE_EXT_ID)) {
      extSettings.disabledExtensions.push(LEGACY_INTERFACE_EXT_ID);
      retiredInterface = true;
      dirtySettings = true;
    }
  }

  if (doc && (hasInterfaceDom || retiredInterface)) {
    // 1. 归位被旧版界面整理塞进 #yt-interface-more-panel 的原生三横菜单项
    const moreWrap = doc.getElementById?.('yt-interface-more');
    const morePanel = doc.getElementById?.('yt-interface-more-panel');
    const parentContainer =
      moreWrap?.parentNode ||
      moreWrap?.parentElement ||
      doc.querySelector?.('#options .options-content') ||
      doc.getElementById?.('options');
    if (morePanel && parentContainer) {
      const rawKids = morePanel.children || morePanel.childNodes;
      const items = rawKids ? [...rawKids] : [];
      for (const item of items) {
        if (typeof moreWrap?.before === 'function') {
          moreWrap.before(item);
        } else if (typeof parentContainer.insertBefore === 'function' && moreWrap) {
          parentContainer.insertBefore(item, moreWrap);
        } else {
          parentContainer.appendChild?.(item);
        }
      }
    }
    moreWrap?.remove?.();
    doc.getElementById?.('options')?.classList?.remove?.('yt-if-menu');

    // 2. 移除 #yt-if-more-extensions 以及扩展面板上的 display:contents / order 行内覆盖
    doc.getElementById?.('yt-if-more-extensions')?.remove?.();
    doc.getElementById?.('yt-interface-active-style')?.remove?.();

    for (const hostId of ['rm_extensions_block', 'extensions_settings', 'extensions_settings2']) {
      const el = doc.getElementById?.(hostId);
      if (!el) continue;
      el.classList?.remove?.('yt-if-extension-layout', 'yt-if-extension-column');
      el.style?.removeProperty?.('display');
      el.style?.removeProperty?.('flex-direction');
      el.style?.removeProperty?.('align-items');
      const children = el.children ? [...el.children] : [];
      for (const child of children) {
        child.classList?.remove?.(
          'yt-if-extension-row',
          'yt-if-extension-folded',
          'yt-if-extension-hidden',
          'yt-if-extension-vacant',
          'yt-if-extras-row',
          'yt-if-extension-prefix',
          'yt-if-extension-suffix',
        );
        child.style?.removeProperty?.('order');
        child.style?.removeProperty?.('display');
        child.style?.removeProperty?.('flex');
        child.style?.removeProperty?.('width');
        child.style?.removeProperty?.('max-width');
        child.style?.removeProperty?.('min-width');
        child.style?.removeProperty?.('margin-inline');
      }
    }

    // 3. 清理残留隐藏类名与旧折叠头
    if (typeof doc.querySelectorAll === 'function') {
      for (const btn of doc.querySelectorAll('.yt-if-fold-button')) {
        btn.remove?.();
      }
      for (const hiddenEl of doc.querySelectorAll(
        '.yt-if-toggle-hidden, .yt-if-fold-hidden, .yt-if-menu-hidden, .yt-if-wand-empty, .yt-if-drawer-empty, .yt-if-toolbar-empty',
      )) {
        hiddenEl.classList?.remove?.(
          'yt-if-toggle-hidden',
          'yt-if-fold-hidden',
          'yt-if-menu-hidden',
          'yt-if-wand-empty',
          'yt-if-drawer-empty',
          'yt-if-toolbar-empty',
        );
      }
    }
  }

  if (dirtySettings) {
    ctx?.saveSettingsDebounced?.();
  }

  const hasAncientMonolith = Boolean(doc?.getElementById?.('yantai-dialog'));
  return {
    retiredInterface: Boolean(retiredInterface || hasInterfaceStyle),
    discoveredInterface,
    hasAncientMonolith,
  };
}

/**
 * 构建零密钥、零聊天隐私的环境排障体检文本。
 */
export function buildEnvironmentDiagnosticReport({
  root = globalThis,
  getContext,
  store,
  auditState = null,
  stmVersion = '0.8.4',
} = {}) {
  const ctx = getContext?.();
  const s = store?.get?.() || {};
  const platform = detectPlatform(root);
  const doc = root?.document;
  const win = root?.window || root;

  const vw = Number(win?.innerWidth || 0);
  const vh = Number(win?.innerHeight || 0);
  const osTag = platform.isIOS ? 'iOS' : platform.isAndroid ? 'Android' : 'Desktop';
  const containerTag = platform.isTauri ? 'TauriTavern (TT)' : 'Browser';

  const pu = ctx?.powerUserSettings || {};
  const themeSelect = doc?.getElementById?.('themes');
  const activeTheme =
    String(
      pu.theme ||
        themeSelect?.selectedOptions?.[0]?.textContent ||
        themeSelect?.value ||
        '默认主题',
    ).trim() || '默认主题';

  const lines = [
    `[砚台 · SillyTavern 伴侣 环境体检单 v${stmVersion}]`,
    `- 运行容器: ${osTag} · ${containerTag} (${vw}x${vh})`,
    `- 伴侣状态: 总开关=${s.shellEnabled ? '开启' : '挂起'} | 安全模式=${isSafeModeRequested(root) ? '是' : '否'} | 加速引擎=${s.modules?.turbo ? '开启' : '关闭'}`,
    `- 酒馆界面: 主题="${activeTheme}" | MovingUI=${Boolean(pu.movingUI || doc?.body?.classList?.contains?.('movingUI'))} | 模糊=${pu.blur_strength ?? '默认'}`,
  ];

  if (auditState?.tavernHelper?.status && auditState.tavernHelper.status !== 'unknown') {
    lines.push(`- 酒馆助手状态: ${auditState.tavernHelper.status}`);
  }

  const companions = auditState?.companions || [];
  if (companions.length > 0) {
    lines.push('- 砚台配套组件:');
    for (const item of companions) {
      const sw = s.modules?.[item.moduleKey] ? '开' : '关';
      const ver = item.version ? `v${item.version}` : '未知版本';
      const scope = item.scope || '未装';
      lines.push(`  · ${item.displayName}: 状态=${item.status} | 版本=${ver} (推荐>=${item.minVersion}) | 位置=${scope} | 开关=${sw}`);
    }
  }

  if (auditState?.legacy?.discoveredInterface || auditState?.legacy?.retiredInterface) {
    lines.push('- 历史插件提示: 检测到独立版《砚台 · 界面整理》（伴侣已自动将其停用，建议在扩展管理卸载）');
  }
  if (auditState?.legacy?.hasAncientMonolith) {
    lines.push('- 历史插件告警: 检测到远古单文件《砚台合集》(#yantai-dialog)，请卸载避免冲突');
  }
  if (doc?.getElementById?.('extensionTopBar')) {
    lines.push('- 顶栏混装提示: 检测到外部顶栏插件 (#extensionTopBar)');
  }

  const enabledThirdParty = auditState?.enabledThirdParty || [];
  const disabledThirdParty = auditState?.disabledThirdParty || [];
  lines.push(
    `- 第三方扩展 (${enabledThirdParty.length} 启用 / ${disabledThirdParty.length} 停用): ${
      enabledThirdParty.length > 0 ? enabledThirdParty.join(', ') : '未读取或仅内置扩展'
    }`,
  );
  if (disabledThirdParty.length > 0) {
    lines.push(`- 已停用扩展: ${disabledThirdParty.join(', ')}`);
  }

  return lines.join('\n');
}

export async function copyTextSafely(text, root = globalThis) {
  const content = String(text || '');
  if (!content) return false;

  try {
    if (root?.navigator?.clipboard?.writeText) {
      await root.navigator.clipboard.writeText(content);
      return true;
    }
  } catch {
    // fallback below
  }

  const doc = root?.document;
  if (!doc?.createElement || !doc?.body) return false;
  const area = doc.createElement('textarea');
  area.value = content;
  if (area.style) {
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    area.style.opacity = '0';
  }
  doc.body.appendChild(area);
  try {
    area.focus?.();
    area.select?.();
    return Boolean(doc.execCommand?.('copy'));
  } catch {
    return false;
  } finally {
    area.remove?.();
  }
}

export function createSuiteCoordinator({
  root = globalThis,
  getContext,
  store,
  moduleBridge,
  stmVersion = '0.8.4',
  fetcher = (...args) => globalThis.fetch?.(...args),
  reloadHostExtensions = null,
  onStateChange = null,
  notify = null,
} = {}) {
  const manifestVersionCache = new Map();
  let busy = false;
  let busyLabel = '';
  let retiredNoticeShown = false;
  let lastAudit = {
    checkedAt: 0,
    companions: COMPANION_PLUGINS.map(c => ({
      ...c,
      status: 'unknown',
      version: null,
      scope: null,
    })),
    tavernHelper: { status: 'unknown', extName: `third-party/${TAVERN_HELPER_SPEC.folderName}` },
    legacy: { retiredInterface: false, discoveredInterface: false, hasAncientMonolith: false },
    enabledThirdParty: [],
    disabledThirdParty: [],
  };

  function emitChange() {
    onStateChange?.(lastAudit);
  }

  async function defaultReloadHostExtensions() {
    if (typeof reloadHostExtensions === 'function') {
      return reloadHostExtensions();
    }
    try {
      const extMod = await import(resolveAppUrl('scripts/extensions.js', root));
      if (typeof extMod?.loadExtensionSettings === 'function') {
        await extMod.loadExtensionSettings({}, false, false);
        return true;
      }
    } catch (err) {
      console.warn('[ST伴侣] 动态激活新装扩展失败，刷新网页后即可生效:', err);
    }
    return false;
  }

  async function fetchDiscoveredExtensions() {
    if (typeof fetcher !== 'function') return null;
    try {
      const ctx = getContext?.();
      const headers = typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {};
      const res = await fetchWithTimeout(
        fetcher,
        resolveAppUrl('api/extensions/discover', root),
        { method: 'GET', headers, cache: 'no-store' },
        10000,
      );
      if (!res?.ok) return null;
      const list = await res.json();
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  }

  async function readDiskManifestVersion(folderName, force = false) {
    if (!force && manifestVersionCache.has(folderName)) {
      return manifestVersionCache.get(folderName);
    }
    if (typeof fetcher !== 'function') return null;
    try {
      const res = await fetchWithTimeout(
        fetcher,
        resolveAppUrl(`scripts/extensions/third-party/${encodeURIComponent(folderName)}/manifest.json`, root),
        { method: 'GET', cache: 'no-store' },
        8000,
      );
      if (!res?.ok) return null;
      const manifest = await res.json();
      const ver = typeof manifest?.version === 'string' ? manifest.version.trim() : null;
      if (ver) manifestVersionCache.set(folderName, ver);
      return ver;
    } catch {
      return null;
    }
  }

  function markProvisionedFolders(folderNames) {
    if (!Array.isArray(folderNames) || folderNames.length === 0) return;
    const current = store.get();
    const prev = Array.isArray(current.suiteProvisioned) ? current.suiteProvisioned : [];
    const merged = [...new Set([...prev, ...folderNames])];
    if (merged.length !== prev.length) {
      store.update({ suiteProvisioned: merged }, { silent: true });
    }
  }

  async function audit({ forceManifestCheck = false } = {}) {
    const ctx = getContext?.();
    const doc = root?.document;
    const discovered = await fetchDiscoveredExtensions();
    const disabledSet = new Set(
      Array.isArray(ctx?.extensionSettings?.disabledExtensions)
        ? ctx.extensionSettings.disabledExtensions
        : [],
    );

    const legacy = store.get().shellEnabled
      ? retireRedundantLegacyPlugins({ root, getContext, discovered: discovered || [] })
      : {
          retiredInterface: false,
          discoveredInterface: Boolean(
            discovered?.some(item => item?.name === LEGACY_INTERFACE_EXT_ID),
          ),
          hasAncientMonolith: Boolean(doc?.getElementById?.('yantai-dialog')),
        };

    if (legacy.retiredInterface && !retiredNoticeShown) {
      retiredNoticeShown = true;
      notify?.(
        '已自动停用旧版独立《界面整理》（功能已整合进 ST伴侣，可在扩展管理卸载以省内存）',
        'info',
      );
    }

    const foundOnDiskFolders = [];
    const companionResults = [];

    for (const comp of COMPANION_PLUGINS) {
      const extName = `third-party/${comp.folderName}`;
      const discEntry = Array.isArray(discovered)
        ? discovered.find(item => item?.name === extName)
        : null;
      const handle = moduleBridge?.getRegisteredHandle?.(comp.registryId) || null;
      const hasLegacyDom = Boolean(
        comp.legacyDomSelector && doc?.querySelector?.(comp.legacyDomSelector),
      );
      const isHostDisabled = disabledSet.has(extName);

      let version = handle?.version || null;
      if (!version && discEntry) {
        version = await readDiskManifestVersion(comp.folderName, forceManifestCheck);
      }

      if (discEntry || handle || hasLegacyDom) {
        foundOnDiskFolders.push(comp.folderName);
      }

      let status = 'missing';
      if (isHostDisabled && discEntry) {
        status = 'host_disabled';
      } else if (discEntry || handle || hasLegacyDom) {
        const cmp = version ? compareSemver(version, comp.minVersion) : null;
        const missingExpectedRegistry =
          !handle &&
          hasLegacyDom &&
          (comp.moduleKey === 'bookshelf' || comp.moduleKey === 'persona');
        if ((cmp !== null && cmp < 0) || missingExpectedRegistry) {
          status = 'outdated';
        } else {
          status = 'ready';
        }
      } else if (discovered === null) {
        // 离线或单测未挂载 /api/extensions/discover 时不虚报缺失
        status = 'unknown';
      }

      companionResults.push({
        ...comp,
        status,
        version,
        scope: discEntry?.type || (handle ? 'runtime' : null),
      });
    }

    // 已经装在磁盘上的配套插件同步记入 suiteProvisioned，未来若用户主动卸载则尊重其决定
    markProvisionedFolders(foundOnDiskFolders);

    const enabledThirdParty = [];
    const disabledThirdParty = [];
    if (Array.isArray(discovered)) {
      for (const item of discovered) {
        const name = String(item?.name || '');
        if (!name.startsWith('third-party/')) continue;
        const shortName = name.slice('third-party/'.length);
        if (disabledSet.has(name)) disabledThirdParty.push(shortName);
        else enabledThirdParty.push(shortName);
      }
    }

    // 检测《酒馆助手》(JS-Slash-Runner / TavernHelper) 安装与启用状态
    const helperDiscEntry = Array.isArray(discovered)
      ? discovered.find(item => {
          const nm = String(item?.name || '').toLowerCase();
          return (
            nm === 'third-party/js-slash-runner' ||
            nm === 'third-party/tavernhelper' ||
            nm === 'third-party/tavern-helper'
          );
        })
      : null;
    const hasHelperRuntime = Boolean(
      root?.TavernHelper ||
        (TAVERN_HELPER_SPEC.domSelector && doc?.querySelector?.(TAVERN_HELPER_SPEC.domSelector)),
    );
    let helperStatus = 'missing';
    const helperExtName = helperDiscEntry?.name || `third-party/${TAVERN_HELPER_SPEC.folderName}`;
    if (helperDiscEntry && disabledSet.has(helperExtName)) {
      helperStatus = 'host_disabled';
    } else if (helperDiscEntry || hasHelperRuntime) {
      helperStatus = 'ready';
    } else if (discovered === null) {
      helperStatus = 'unknown';
    }

    lastAudit = {
      checkedAt: Date.now(),
      companions: companionResults,
      tavernHelper: {
        status: helperStatus,
        extName: helperExtName,
        scope: helperDiscEntry?.type || null,
      },
      legacy,
      enabledThirdParty,
      disabledThirdParty,
    };
    emitChange();
    return lastAudit;
  }

  async function installSingleCompanion(comp) {
    const ctx = getContext?.();
    const headers = {
      'Content-Type': 'application/json',
      ...(typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {}),
    };
    const res = await fetchWithTimeout(
      fetcher,
      resolveAppUrl('api/extensions/install', root),
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: comp.repoUrl,
          global: false,
          branch: 'main',
        }),
      },
      45000,
    );
    if (res?.status === 409) {
      // 目录已存在视为已就位
      return { ok: true, alreadyExists: true };
    }
    if (!res?.ok) {
      const detail = typeof res?.text === 'function' ? await res.text().catch(() => '') : '';
      return { ok: false, status: res?.status || 0, detail };
    }
    return { ok: true };
  }

  async function installCompanions({ moduleKeys = null, forceReinstall = false } = {}) {
    if (busy) return { installed: [], reEnabled: [], failed: [] };
    busy = true;
    busyLabel = '正在检查并安装配套组件…';
    emitChange();

    const installed = [];
    const reEnabled = [];
    const failed = [];

    try {
      const state = await audit();
      const provisionedSet = new Set(store.get().suiteProvisioned || []);
      const wantedKeys = Array.isArray(moduleKeys) ? new Set(moduleKeys) : null;
      const ctx = getContext?.();

      preSeedCompanionSettings({ getContext, store, forceSyncKeys: wantedKeys });

      const touchedKeys = [];
      for (const item of state.companions) {
        if (wantedKeys && !wantedKeys.has(item.moduleKey)) continue;

        if (item.status === 'host_disabled' && forceReinstall) {
          const extList = ctx?.extensionSettings?.disabledExtensions;
          const extId = `third-party/${item.folderName}`;
          if (Array.isArray(extList)) {
            const idx = extList.indexOf(extId);
            if (idx >= 0) {
              extList.splice(idx, 1);
              ctx?.saveSettingsDebounced?.();
              reEnabled.push(item.displayName);
              touchedKeys.push(item.moduleKey);
            }
          }
          continue;
        }

        if (item.status !== 'missing') continue;
        if (!forceReinstall && provisionedSet.has(item.folderName)) continue;

        busyLabel = `正在安装「${item.displayName}」…`;
        emitChange();

        const res = await installSingleCompanion(item);
        if (res.ok) {
          installed.push(item.displayName);
          touchedKeys.push(item.moduleKey);
          markProvisionedFolders([item.folderName]);
          manifestVersionCache.delete(item.folderName);
        } else {
          failed.push(item.displayName);
        }
      }

      if (installed.length > 0 || reEnabled.length > 0) {
        preSeedCompanionSettings({ getContext, store, forceSyncKeys: touchedKeys });
        busyLabel = '正在挂载新组件…';
        emitChange();
        await defaultReloadHostExtensions();
        await moduleBridge?.applyAllFromStore?.();
        await audit({ forceManifestCheck: true });
      }
    } finally {
      busy = false;
      busyLabel = '';
      emitChange();
    }

    if (installed.length > 0) {
      notify?.(`已自动配齐：${installed.join('、')}（可随时在设置中心按需开关）`, 'success');
    } else if (reEnabled.length > 0) {
      notify?.(`已重新启用：${reEnabled.join('、')}`, 'success');
    }
    if (failed.length > 0) {
      notify?.(
        `部分组件暂未下载成功（${failed.join('、')}），请确认酒馆网络/代理连通后在伴侣设置点击「一键补齐套件」`,
        'warning',
      );
    }

    return { installed, reEnabled, failed };
  }

  /**
   * 伴侣自身版本升级后（或每满 24 小时），在后台静默检查所有已装配套组件是否为远端最高版本，
   * 若落后于远端 origin 或低于最低水位线，自动静默拉取更新（零弹窗打扰、面板无需展示子模块版本号）。
   */
  async function syncCompanionsToLatestIfNeeded({ skipDisplayNames = [] } = {}) {
    if (busy || typeof fetcher !== 'function') return { updated: [] };
    const syncMeta = store.get()?.suiteSync || { lastCheckedVersion: '', lastCheckedAt: 0 };
    const now = Date.now();
    const versionChanged = syncMeta.lastCheckedVersion !== stmVersion;
    const intervalElapsed = now - Number(syncMeta.lastCheckedAt || 0) >= 24 * 60 * 60 * 1000;
    const hasKnownOutdated = lastAudit.companions.some(
      c => c.status === 'outdated' && ['local', 'global'].includes(c.scope),
    );

    if (!versionChanged && !intervalElapsed && !hasKnownOutdated) {
      return { updated: [] };
    }

    store.update(
      { suiteSync: { lastCheckedVersion: stmVersion, lastCheckedAt: now } },
      { silent: true },
    );

    const skipSet = new Set(skipDisplayNames);
    const ctx = getContext?.();
    const headers = {
      'Content-Type': 'application/json',
      ...(typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {}),
    };

    const updated = [];
    for (const item of lastAudit.companions) {
      if (skipSet.has(item.displayName)) continue;
      if (!['local', 'global'].includes(item.scope)) continue;
      if (item.status !== 'ready' && item.status !== 'outdated') continue;

      const isGlobal = item.scope === 'global';
      let needsPull = item.status === 'outdated';

      if (!needsPull) {
        try {
          const verRes = await fetchWithTimeout(
            fetcher,
            resolveAppUrl('api/extensions/version', root),
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ extensionName: item.folderName, global: isGlobal }),
            },
            20000,
          );
          if (verRes?.ok && typeof verRes.json === 'function') {
            const verData = await verRes.json().catch(() => null);
            if (verData && verData.isUpToDate === false) {
              needsPull = true;
            }
          }
        } catch {
          // 离线或无版本接口时静默跳过
        }
      }

      if (!needsPull) continue;

      try {
        const upRes = await fetchWithTimeout(
          fetcher,
          resolveAppUrl('api/extensions/update', root),
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ extensionName: item.folderName, global: isGlobal }),
          },
          60000,
        );
        if (upRes?.ok) {
          updated.push(item.displayName);
          manifestVersionCache.delete(item.folderName);
        }
      } catch {
        // 静默忽略后台拉取异常
      }
    }

    if (updated.length > 0) {
      await audit({ forceManifestCheck: true });
    }
    return { updated };
  }

  async function autoProvisionIfNeeded() {
    if (isSafeModeRequested(root) || !store.get().shellEnabled) {
      await audit();
      return { installed: [], reEnabled: [], failed: [], updated: [] };
    }
    const provisionRes = await installCompanions({ moduleKeys: null, forceReinstall: false });
    const upgradeRes = await syncCompanionsToLatestIfNeeded({
      skipDisplayNames: provisionRes.installed,
    });
    return { ...provisionRes, updated: upgradeRes.updated };
  }

  /**
   * 检测未安装或被禁用的官方《酒馆助手》(N0VI028/JS-Slash-Runner) 时，一键代装或恢复启用。
   */
  async function installOrEnableTavernHelper() {
    if (busy) return { ok: false, action: 'busy' };
    busy = true;
    busyLabel = '正在检查并准备《酒馆助手》…';
    emitChange();

    let ok = false;
    let action = 'none';

    try {
      const state = await audit();
      const th = state.tavernHelper || { status: 'missing', extName: `third-party/${TAVERN_HELPER_SPEC.folderName}` };
      const ctx = getContext?.();

      if (th.status === 'host_disabled') {
        const extList = ctx?.extensionSettings?.disabledExtensions;
        if (Array.isArray(extList)) {
          const idx = extList.indexOf(th.extName);
          if (idx >= 0) {
            extList.splice(idx, 1);
            ctx?.saveSettingsDebounced?.();
          }
        }
        busyLabel = '正在重新挂载《酒馆助手》…';
        emitChange();
        await defaultReloadHostExtensions();
        await audit({ forceManifestCheck: true });
        ok = true;
        action = 're_enabled';
      } else if (th.status === 'ready') {
        ok = true;
        action = 'already_ready';
      } else {
        busyLabel = '正在安装《酒馆助手》…';
        emitChange();
        const res = await installSingleCompanion({
          repoUrl: TAVERN_HELPER_SPEC.repoUrl,
        });
        if (res.ok) {
          busyLabel = '正在挂载《酒馆助手》…';
          emitChange();
          await defaultReloadHostExtensions();
          await audit({ forceManifestCheck: true });
          ok = true;
          action = 'installed';
        }
      }
    } finally {
      busy = false;
      busyLabel = '';
      emitChange();
    }

    if (ok && action === 'installed') {
      notify?.('已安装并启用《酒馆助手》（建议刷新一次页面以确保角色卡脚本完全就绪）', 'success');
    } else if (ok && action === 're_enabled') {
      notify?.('已重新启用《酒馆助手》', 'success');
    } else if (!ok) {
      notify?.('《酒馆助手》下载未完成，请确认酒馆网络/代理可访问 GitHub 后重试', 'warning');
    }
    return { ok, action };
  }

  async function updateOutdatedCompanions() {
    if (busy) return { updated: [], failed: [] };
    busy = true;
    busyLabel = '正在更新配套组件…';
    emitChange();

    const updated = [];
    const failed = [];

    try {
      const state = await audit({ forceManifestCheck: true });
      const ctx = getContext?.();
      const headers = {
        'Content-Type': 'application/json',
        ...(typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {}),
      };

      for (const item of state.companions) {
        if (item.status !== 'outdated' || !['local', 'global'].includes(item.scope)) continue;
        busyLabel = `正在更新「${item.displayName}」…`;
        emitChange();
        try {
          const res = await fetchWithTimeout(
            fetcher,
            resolveAppUrl('api/extensions/update', root),
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                extensionName: item.folderName,
                global: item.scope === 'global',
              }),
            },
            60000,
          );
          if (res?.ok) {
            updated.push(item.displayName);
            manifestVersionCache.delete(item.folderName);
          } else {
            failed.push(item.displayName);
          }
        } catch {
          failed.push(item.displayName);
        }
      }

      await audit({ forceManifestCheck: true });
    } finally {
      busy = false;
      busyLabel = '';
      emitChange();
    }

    if (updated.length > 0) {
      notify?.(`已更新：${updated.join('、')}，请刷新网页使新版本生效`, 'success');
    }
    if (failed.length > 0) {
      notify?.(`更新未完成（${failed.join('、')}），请检查网络代理或在酒馆扩展管理内更新`, 'warning');
    }

    return { updated, failed };
  }

  function buildDiagnosticReport() {
    return buildEnvironmentDiagnosticReport({
      root,
      getContext,
      store,
      auditState: lastAudit,
      stmVersion,
    });
  }

  async function copyDiagnosticReport() {
    await audit();
    const report = buildDiagnosticReport();
    const ok = await copyTextSafely(report, root);
    if (ok) {
      notify?.('已复制环境体检单（不含任何密钥与聊天隐私），可直接粘贴反馈', 'success');
    } else {
      notify?.('剪贴板受限，请在控制台查看环境体检信息', 'warning');
      console.info(report);
    }
    return { ok, report };
  }

  return {
    isBusy: () => busy,
    getBusyLabel: () => busyLabel,
    getAuditState: () => lastAudit,
    getCompanionStatus(moduleKey) {
      return lastAudit.companions.find(c => c.moduleKey === moduleKey) || null;
    },
    getTavernHelperStatus() {
      return lastAudit.tavernHelper || { status: 'unknown' };
    },
    audit,
    autoProvisionIfNeeded,
    syncCompanionsToLatestIfNeeded,
    installCompanions,
    installOrEnableTavernHelper,
    updateOutdatedCompanions,
    buildDiagnosticReport,
    copyDiagnosticReport,
  };
}
