/**
 * 砚台 · ST伴侣 (st-mate) · 主入口与生命周期协调器
 * 严格遵循单一实例、无损回退、TauriTavern 首帧异步挂载、移动端样式自动破缓存与标准 SillyTavern getContext() 规范。
 */

import { getHostContext, scheduleIdleBoot } from './src/core/env.js?v=0.3.1';
import { createSettingsStore } from './src/core/schema.js?v=0.3.1';
import { CONTROL_REGISTRY_KEY, STM_RUNTIME_KEY, createModuleBridge, ensureControlRegistry } from './src/core/registry.js?v=0.3.1';
import { closeAllNativeDrawers, toastMessage } from './src/shell/host-actions.js?v=0.3.1';
import { createDrawerBridge } from './src/shell/drawer-bridge.js?v=0.3.1';
import { createTopbar } from './src/shell/topbar.js?v=0.3.1';
import { createHomeCloak } from './src/shell/home-cloak.js?v=0.3.1';
import { createTapImmersive } from './src/shell/tap-immersive.js?v=0.3.1';
import { createAtmosphere } from './src/shell/atmosphere.js?v=0.3.1';
import { createPerfEngine } from './src/shell/perf-engine.js?v=0.3.1';
import { createReaderDock } from './src/shell/reader-dock.js?v=0.3.1';
import { createSettingsDialog } from './src/shell/settings-dialog.js?v=0.3.1';

const STM_VERSION = '0.3.1';

/**
 * 移动端浏览器无 Ctrl+F5 强刷能力：启动时自动为 st-mate/style.css 附加当前版本号参数，
 * 确保手机下拉普通刷新也能 100% 加载最新样式表。
 */
function ensureFreshStylesheet() {
  const doc = globalThis.document;
  if (!doc) return;
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href') || '';
    if (href.includes('st-mate/style.css') && !href.includes(`v=${STM_VERSION}`)) {
      const baseHref = href.split('?')[0];
      link.setAttribute('href', `${baseHref}?v=${STM_VERSION}`);
    }
  }
}

function createStMateRuntime() {
  let enabled = false;
  let cancelBoot = null;
  let bootPollTimer = 0;
  let unsubscribeStore = null;
  const eventCleanups = [];
  let controlHandle = null;

  const getContext = () => getHostContext(globalThis);
  const store = createSettingsStore({ getContext });
  const moduleBridge = createModuleBridge({ root: globalThis, getContext, store });

  let settingsDialog = null;
  let homeCloak = null;
  let tapImmersive = null;
  let drawerBridge = null;
  let topbar = null;
  let atmosphere = null;
  let perfEngine = null;
  let readerDock = null;

  async function toggleShell(nextEnabled) {
    const normalized = Boolean(nextEnabled);
    store.update({ shellEnabled: normalized });
    if (normalized) {
      await moduleBridge.applyAllFromStore();
    } else {
      readerDock?.close();
      tapImmersive?.exit();
      closeAllNativeDrawers();
      await moduleBridge.suspendAllForNative();
    }
    refreshAll();
    toastMessage(
      normalized
        ? '已恢复 ST伴侣界面与个人模块配置'
        : '已切回纯原生酒馆（点首页或底栏魔法棒「ST伴侣设置」可一键恢复）',
    );
  }

  function refreshAll({ shouldHydrate = false } = {}) {
    if (!enabled) return;
    if (shouldHydrate) {
      store.hydrate();
    }
    perfEngine?.refresh();
    homeCloak?.refresh();
    tapImmersive?.refresh();
    topbar?.refresh();
    drawerBridge?.sync();
    atmosphere?.refresh();
    readerDock?.refresh();
    settingsDialog?.installFallbackEntries();
    settingsDialog?.renderIfOpen();
  }

  function registerSelfInControlRegistry() {
    const registry = ensureControlRegistry(globalThis);
    controlHandle = {
      id: 'st-mate',
      label: 'ST伴侣总台',
      version: STM_VERSION,
      schemaVersion: 3,
      namespace: 'st_mate',
      inspect() {
        const s = store.get();
        return {
          installed: true,
          enabled: Boolean(s.shellEnabled),
          health: 'ok',
          topbarMode: s.topbarMode,
          modules: { ...s.modules },
        };
      },
      open(tabId) {
        if (tabId === 'reader-dock') {
          readerDock?.open();
        } else {
          settingsDialog?.open(tabId);
        }
      },
      async setEnabled(val) {
        await toggleShell(Boolean(val));
        return Boolean(val);
      },
    };
    registry.modules.set('st-mate', controlHandle);
    globalThis.dispatchEvent?.(new CustomEvent('yantai:control:updated'));
  }

  function unregisterSelfFromControlRegistry() {
    const registry = globalThis[CONTROL_REGISTRY_KEY];
    if (registry?.modules instanceof Map && registry.modules.get('st-mate') === controlHandle) {
      registry.modules.delete('st-mate');
      globalThis.dispatchEvent?.(new CustomEvent('yantai:control:updated'));
    }
    controlHandle = null;
  }

  function registerSlashCommand(ctx) {
    try {
      const parser = ctx?.SlashCommandParser;
      const SlashCommand = ctx?.SlashCommand;
      if (!parser?.addCommandObject || !SlashCommand?.fromProps) return;
      if (parser.commands && parser.commands['stmate']) return;

      parser.addCommandObject(
        SlashCommand.fromProps({
          name: 'stmate',
          helpString: '打开 ST伴侣设置中心（传入 reader 打开页面排版与背景面板，传入 toggle 切换原生酒馆/伴侣界面）',
          callback: (_args, value) => {
            const cmd = String(value || '').trim().toLowerCase();
            if (cmd === 'toggle') {
              void toggleShell(!store.get().shellEnabled);
            } else if (cmd === 'reader' || cmd === 'aa') {
              readerDock?.toggle();
            } else {
              settingsDialog?.open();
            }
            return '';
          },
        }),
      );
    } catch (err) {
      console.warn('[ST伴侣] Slash Command 注册跳过:', err);
    }
  }

  function bindHostEvents() {
    const ctx = getContext();
    const eventSource = ctx?.eventSource;
    const types = ctx?.eventTypes || ctx?.event_types;
    if (!eventSource || !types) return false;

    const subscribe = (evtName, handler) => {
      if (!evtName || typeof eventSource.on !== 'function') return;
      eventSource.on(evtName, handler);
      eventCleanups.push(() => {
        if (typeof eventSource.removeListener === 'function') {
          eventSource.removeListener(evtName, handler);
        } else if (typeof eventSource.off === 'function') {
          eventSource.off(evtName, handler);
        }
      });
    };

    subscribe(types.APP_READY, () => {
      void moduleBridge.applyAllFromStore();
      refreshAll({ shouldHydrate: true });
    });

    subscribe(types.CHAT_CHANGED, () => {
      tapImmersive?.exit();
      refreshAll();
    });

    subscribe(types.SETTINGS_UPDATED, () => {
      refreshAll({ shouldHydrate: true });
    });

    subscribe(types.CHARACTER_EDITED, () => {
      atmosphere?.invalidateCurrentEntityBackdrop();
      refreshAll();
    });

    for (const evt of [
      types.PRESET_CHANGED,
      types.MAIN_API_CHANGED,
      types.CHARACTER_DELETED,
      types.CHARACTERS_IMPORTED,
      types.GROUP_UPDATED,
    ]) {
      subscribe(evt, () => refreshAll());
    }

    const onControlUpdated = () => {
      settingsDialog?.renderIfOpen();
      homeCloak?.schedule();
    };
    globalThis.addEventListener?.('yantai:control:updated', onControlUpdated);
    eventCleanups.push(() => globalThis.removeEventListener?.('yantai:control:updated', onControlUpdated));

    registerSlashCommand(ctx);
    return true;
  }

  function initSubsystems() {
    perfEngine = createPerfEngine({
      store,
      root: globalThis,
    });

    homeCloak = createHomeCloak({
      getContext,
      store,
      onOpenSettings: () => settingsDialog?.open(),
      onToggleShell: toggleShell,
    });

    tapImmersive = createTapImmersive({
      getContext,
      store,
      isHomeCloaked: () => homeCloak.isHomeCloaked(),
    });

    atmosphere = createAtmosphere({
      getContext,
      store,
      isHomeCloaked: () => homeCloak.isHomeCloaked(),
    });

    readerDock = createReaderDock({
      getContext,
      store,
      onPreviewAtmosphere: () => atmosphere?.refresh(),
      onOpenStateChange: () => topbar?.refresh(),
    });

    settingsDialog = createSettingsDialog({
      getContext,
      store,
      moduleBridge,
      onToggleShell: toggleShell,
      onPreviewAtmosphere: () => atmosphere?.refresh(),
      onOpenReaderDock: () => readerDock?.open(),
    });

    drawerBridge = createDrawerBridge({
      getContext,
      store,
      onOpenSettings: () => settingsDialog.open(),
    });

    topbar = createTopbar({
      getContext,
      store,
      moduleBridge,
      onOpenSettings: () => {
        readerDock?.close();
        settingsDialog.open();
      },
      onToggleReaderDock: () => readerDock?.toggle(),
      isReaderDockOpen: () => Boolean(readerDock?.isOpen()),
      onNativeDrawerOpened: () => readerDock?.close(),
      onExitPureReading: () => tapImmersive.exit(),
    });

    unsubscribeStore = store.subscribe(() => {
      refreshAll();
    });
  }

  function enable() {
    if (enabled) return;
    enabled = true;

    ensureFreshStylesheet();
    initSubsystems();
    registerSelfInControlRegistry();

    cancelBoot = scheduleIdleBoot(() => {
      const boot = () => {
        if (!enabled) return true;
        ensureFreshStylesheet();
        const ctx = getContext();
        if (!ctx?.extensionSettings) return false;

        store.hydrate();
        const bound = bindHostEvents();
        void moduleBridge.applyAllFromStore();
        refreshAll();
        return bound;
      };

      if (!boot()) {
        let attempts = 0;
        bootPollTimer = globalThis.setInterval(() => {
          attempts += 1;
          if (boot() || attempts >= 40) {
            globalThis.clearInterval(bootPollTimer);
            bootPollTimer = 0;
          }
        }, 250);
      }
    }, globalThis);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;

    cancelBoot?.();
    cancelBoot = null;
    if (bootPollTimer) {
      globalThis.clearInterval(bootPollTimer);
      bootPollTimer = 0;
    }

    unsubscribeStore?.();
    unsubscribeStore = null;

    while (eventCleanups.length) {
      const off = eventCleanups.pop();
      try {
        off?.();
      } catch {
        // ignore cleanup error
      }
    }

    unregisterSelfFromControlRegistry();

    readerDock?.destroy();
    atmosphere?.destroy();
    perfEngine?.destroy();
    topbar?.destroy();
    drawerBridge?.destroy();
    tapImmersive?.destroy();
    homeCloak?.destroy();
    settingsDialog?.destroy();

    readerDock = null;
    atmosphere = null;
    perfEngine = null;
    topbar = null;
    drawerBridge = null;
    tapImmersive = null;
    homeCloak = null;
    settingsDialog = null;
  }

  return {
    enable,
    disable,
    refresh: refreshAll,
    openSettings: tab => settingsDialog?.open(tab),
    openReaderDock: () => readerDock?.open(),
  };
}

const existingRuntime = globalThis[STM_RUNTIME_KEY];
if (existingRuntime && typeof existingRuntime.disable === 'function') {
  try {
    existingRuntime.disable();
  } catch (err) {
    console.warn('[ST伴侣] 清理旧实例异常:', err);
  }
}

const runtime = createStMateRuntime();
globalThis[STM_RUNTIME_KEY] = runtime;

export function onEnable() {
  runtime.enable();
}

export function onDisable() {
  runtime.disable();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onEnable, { once: true });
  } else {
    onEnable();
  }
}
