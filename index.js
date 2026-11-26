/**
 * 砚台 · ST伴侣 (st-mate) · 主入口与生命周期协调器
 * 严格遵循单一实例、无损回退、TauriTavern 首帧异步挂载、移动端样式自动破缓存与标准 SillyTavern getContext() 规范。
 */

import {
  clearTauriSafeAreaGuard,
  createTauriOverlayBackGuard,
  detectPlatform,
  getHostContext,
  scheduleIdleBoot,
  syncTauriSafeAreaGuard,
} from './src/core/env.js?v=0.9.6';
import {
  closeExportFallbackDialog,
  isExportFallbackDialogOpen,
} from './src/core/file-saver.js?v=0.9.6';
import { STM_SCHEMA_VERSION, createSettingsStore } from './src/core/schema.js?v=0.9.6';
import { CONTROL_REGISTRY_KEY, STM_RUNTIME_KEY, createModuleBridge, ensureControlRegistry } from './src/core/registry.js?v=0.9.6';
import { createSuiteCoordinator, isSafeModeRequested } from './src/core/suite-guard.js?v=0.9.6';
import { closeAllNativeDrawers, getOpenNativeDrawerIds, toastMessage } from './src/shell/host-actions.js?v=0.9.6';
import { createDrawerBridge } from './src/shell/drawer-bridge.js?v=0.9.6';
import { createExtensionsTidy } from './src/shell/extensions-tidy.js?v=0.9.6';
import { createChatVision } from './src/shell/chat-vision.js?v=0.9.6';
import { createFloorActions } from './src/shell/floor-actions.js?v=0.9.6';
import { createFloatCapsule } from './src/shell/float-capsule.js?v=0.9.6';
import { createTopbar } from './src/shell/topbar.js?v=0.9.6';
import { createHomeCloak } from './src/shell/home-cloak.js?v=0.9.6';
import { createTapImmersive } from './src/shell/tap-immersive.js?v=0.9.6';
import { createAtmosphere } from './src/shell/atmosphere.js?v=0.9.6';
import { createPerfEngine } from './src/shell/perf-engine.js?v=0.9.6';
import { createReaderDock } from './src/shell/reader-dock.js?v=0.9.6';
import { readSecretsMap } from './src/modules/api-backend.js?v=0.9.6';
import {
  requestAssistantCompletion,
  resolveAssistantRuntimeChannel,
} from './src/modules/assistant-core.js?v=0.9.6';
import { createApiDock } from './src/modules/api-dock.js?v=0.9.6';
import {
  createActiveChatPresetSyncScheduler,
  primeHostOpenAiModule,
  syncPresetForActiveChat,
} from './src/modules/preset-backend.js?v=0.9.6';
import { createPresetDock } from './src/modules/preset-dock.js?v=0.9.6';
import {
  primeHostWorldInfoModule,
  refreshHostWorldInfoList,
} from './src/modules/char-world-backend.js?v=0.9.6';
import { createCharWorldDock } from './src/modules/char-world-dock.js?v=0.9.6';
import { createSmartImporterController } from './src/modules/smart-importer.js?v=0.9.6';
import { syncActiveCompanionThemeOnBoot } from './src/core/companion-kit.js?v=0.9.6';
import { createSettingsDialog } from './src/shell/settings-dialog.js?v=0.9.6';
import { createWelcomeGuide } from './src/shell/welcome-guide.js?v=0.9.6';

const STM_VERSION = '0.9.6';
const STM_ASSET_REV = '0.9.6';

/**
 * 移动端浏览器无 Ctrl+F5 强刷能力：启动时自动为 st-mate/style.css 附加当前版本号参数，
 * 确保手机下拉普通刷新也能 100% 加载最新样式表。
 */
function ensureFreshStylesheet() {
  const doc = globalThis.document;
  if (!doc) return;
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href') || '';
    if (
      (href.includes('st-mate/style.css') || href.includes('yantai-bookshelf/style.css')) &&
      !href.includes(`v=${STM_ASSET_REV}`)
    ) {
      const baseHref = href.split('?')[0];
      link.setAttribute('href', `${baseHref}?v=${STM_ASSET_REV}`);
    }
  }
}

function createStMateRuntime() {
  let enabled = false;
  let cancelBoot = null;
  let bootPollTimer = 0;
  let autoProvisionTimer = 0;
  let safeModeNotified = false;
  let unsubscribeStore = null;
  const eventCleanups = [];
  let controlHandle = null;

  const getContext = () => getHostContext(globalThis);
  const store = createSettingsStore({ getContext });
  const moduleBridge = createModuleBridge({ root: globalThis, getContext, store });

  let suiteCoordinator = null;
  let settingsDialog = null;
  let welcomeGuide = null;
  let homeCloak = null;
  let smartImporter = null;
  let tapImmersive = null;
  let drawerBridge = null;
  let extensionsTidy = null;
  let chatVision = null;
  let floorActions = null;
  let floatCapsule = null;
  let topbar = null;
  let atmosphere = null;
  let perfEngine = null;
  let readerDock = null;
  let apiDock = null;
  let presetDock = null;
  let charWorldDock = null;
  let ttOverlayBackGuard = null;
  let lastDockDismissedAt = 0;

  const presetSyncScheduler = createActiveChatPresetSyncScheduler({
    isEnabled: () => enabled,
    beforeSync: () => presetDock?.flushPendingSave?.(),
    runSync: async ({ isCurrent, shouldAbort }) => {
      const res = await syncPresetForActiveChat({
        getContext,
        store,
        shouldAbort,
        onSwitched: () => {
          if (isCurrent()) {
            topbar?.refresh();
            presetDock?.refresh();
            charWorldDock?.refresh();
          }
        },
      });
      if (res?.switched && isCurrent()) {
        topbar?.refresh();
        presetDock?.refresh();
        charWorldDock?.refresh();
      }
      return res;
    },
  });

  /**
   * 在酒馆原生 CHAT_CHANGED autoSelectPreset 执行后的短微延迟内，串行且按最新序号幂等同步当前角色/群聊绑定的预设。
   */
  function scheduleActiveChatPresetSync(delayMs = 30) {
    void presetSyncScheduler.schedule(delayMs);
  }

  function scheduleSuiteAutoProvision(delayMs = 1800) {
    if (autoProvisionTimer) {
      globalThis.clearTimeout(autoProvisionTimer);
    }
    autoProvisionTimer = globalThis.setTimeout(() => {
      autoProvisionTimer = 0;
      if (!enabled || !suiteCoordinator) return;
      void suiteCoordinator.autoProvisionIfNeeded();
    }, delayMs);
  }

  async function toggleShell(nextEnabled) {
    const normalized = Boolean(nextEnabled);
    if (normalized) {
      store.update({ shellEnabled: true });
      await moduleBridge.applyAllFromStore();
      scheduleSuiteAutoProvision(600);
    } else {
      apiDock?.flushPendingSave?.();
      await Promise.allSettled([
        presetDock?.flushPendingSave?.(),
        charWorldDock?.flushPendingSave?.(),
      ]);
      readerDock?.close();
      apiDock?.close();
      presetDock?.close();
      charWorldDock?.close();
      floorActions?.closeMenu();
      floatCapsule?.close();
      globalThis.document?.getElementById?.('stm-portrait-lightbox')?.remove?.();
      tapImmersive?.exit();
      closeAllNativeDrawers();
      store.update({ shellEnabled: false });
      await moduleBridge.suspendAllForNative();
    }
    refreshAll();
    toastMessage(
      normalized
        ? '已恢复 ST伴侣界面与个人模块配置'
        : '已切回纯原生酒馆（点首页或底栏魔法棒「ST伴侣设置」可一键恢复）',
    );
  }

  function refreshAll({ shouldHydrate = false, skipExtensionReorder = false } = {}) {
    if (!enabled) return;
    if (shouldHydrate) {
      store.hydrate();
    }
    perfEngine?.refresh();
    homeCloak?.refresh();
    tapImmersive?.refresh();
    topbar?.refresh();
    drawerBridge?.sync();
    if (skipExtensionReorder) {
      extensionsTidy?.refreshHeroStatus?.();
    } else {
      extensionsTidy?.sync();
    }
    chatVision?.refresh();
    floorActions?.refresh();
    floatCapsule?.refresh();
    atmosphere?.refresh();
    readerDock?.refresh();
    apiDock?.refresh();
    presetDock?.refresh();
    charWorldDock?.refresh();
    settingsDialog?.installFallbackEntries();
    settingsDialog?.renderIfOpen();
  }

  function registerSelfInControlRegistry() {
    const registry = ensureControlRegistry(globalThis);
    controlHandle = {
      id: 'st-mate',
      label: 'SillyTavern 伴侣总台',
      version: STM_VERSION,
      schemaVersion: STM_SCHEMA_VERSION,
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
      inspectAuxChannel() {
        const ch = resolveAssistantRuntimeChannel({ store, getContext });
        return {
          available: true,
          channelType: ch.channelType,
          mode: ch.mode,
          model: ch.model || '',
          badgeLabel: ch.badgeLabel,
          detailLabel: ch.detailLabel,
        };
      },
      async requestAuxCompletion({
        messages = [],
        temperature = 0.25,
        maxTokens = 8192,
        signal = null,
        timeoutMs = 180000,
      } = {}) {
        const preview = resolveAssistantRuntimeChannel({ store, getContext });
        const secretsMap = preview.station?.secretId ? {} : await readSecretsMap({ getContext });
        return requestAssistantCompletion({
          messages,
          store,
          getContext,
          secretsMap,
          signal,
          timeoutMs,
          maxTokens,
          temperature,
        });
      },
      open(tabId) {
        if (tabId === 'reader-dock') {
          apiDock?.close();
          presetDock?.close();
          charWorldDock?.close();
          readerDock?.open();
        } else if (tabId === 'api-dock') {
          readerDock?.close();
          presetDock?.close();
          charWorldDock?.close();
          apiDock?.open();
        } else if (tabId === 'preset-dock') {
          readerDock?.close();
          apiDock?.close();
          charWorldDock?.close();
          presetDock?.open();
        } else if (tabId === 'preset-assistant' || tabId === 'assistant') {
          readerDock?.close();
          apiDock?.close();
          charWorldDock?.close();
          presetDock?.openAssistant();
        } else if (tabId === 'char-world-dock' || tabId === 'char') {
          readerDock?.close();
          apiDock?.close();
          presetDock?.close();
          charWorldDock?.open('char');
        } else if (tabId === 'world-dock' || tabId === 'world') {
          readerDock?.close();
          apiDock?.close();
          presetDock?.close();
          charWorldDock?.open('world');
        } else {
          readerDock?.close();
          apiDock?.close();
          presetDock?.close();
          charWorldDock?.close();
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
          helpString:
            '打开 ST伴侣设置中心（传入 guide 查看快速上手导览，import 呼出万能自动分流导入，char 打开角色档案，world 打开世界书，assistant 打开预设伴侣助手，preset 打开预设馆，api 打开API工作台，reader 打开页面排版面板，topbar 切换伴侣/原版顶栏，diag 复制环境排障体检单，toggle 切换原生酒馆/伴侣界面）',
          callback: (_args, value) => {
            const cmd = String(value || '').trim().toLowerCase();
            if (cmd === 'toggle') {
              void toggleShell(!store.get().shellEnabled);
            } else if (cmd === 'guide' || cmd === 'help') {
              readerDock?.close();
              apiDock?.close();
              presetDock?.close();
              charWorldDock?.close();
              settingsDialog?.close();
              welcomeGuide?.open();
            } else if (cmd === 'import') {
              smartImporter?.openPicker();
            } else if (cmd === 'topbar' || cmd === 'bar') {
              const nextMode = store.get().topbarMode === 'native' ? 'rp' : 'native';
              store.update({ topbarMode: nextMode });
              toastMessage(
                nextMode === 'native' ? '已切换为酒馆原版顶栏模式' : '已切换为 ST伴侣极简顶栏模式',
                'info',
              );
            } else if (cmd === 'diag' || cmd === 'doctor') {
              void suiteCoordinator?.copyDiagnosticReport?.();
            } else if (cmd === 'char' || cmd === 'character') {
              readerDock?.close();
              apiDock?.close();
              presetDock?.close();
              charWorldDock?.open('char');
            } else if (cmd === 'world' || cmd === 'wi' || cmd === 'lorebook') {
              readerDock?.close();
              apiDock?.close();
              presetDock?.close();
              charWorldDock?.open('world');
            } else if (cmd === 'assistant' || cmd === 'ai' || cmd === 'preset-assistant') {
              readerDock?.close();
              apiDock?.close();
              charWorldDock?.close();
              presetDock?.openAssistant();
            } else if (cmd === 'preset' || cmd === 'presets') {
              readerDock?.close();
              apiDock?.close();
              charWorldDock?.close();
              presetDock?.toggle();
            } else if (cmd === 'api') {
              readerDock?.close();
              presetDock?.close();
              charWorldDock?.close();
              apiDock?.toggle();
            } else if (cmd === 'reader' || cmd === 'aa') {
              apiDock?.close();
              presetDock?.close();
              charWorldDock?.close();
              readerDock?.toggle();
            } else {
              readerDock?.close();
              apiDock?.close();
              presetDock?.close();
              charWorldDock?.close();
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
      syncActiveCompanionThemeOnBoot({ getContext, doc: globalThis.document });
      void primeHostOpenAiModule();
      void primeHostWorldInfoModule();
      void moduleBridge.applyAllFromStore();
      refreshAll({ shouldHydrate: true });
      scheduleActiveChatPresetSync(40);
      scheduleSuiteAutoProvision(1200);
      welcomeGuide?.maybeOpenOnFirstBoot(900);
    });

    subscribe(types.CHAT_CHANGED, () => {
      apiDock?.flushPendingSave?.();
      void presetDock?.flushPendingSave?.();
      presetDock?.close();
      apiDock?.close();
      readerDock?.close();
      floorActions?.closeMenu();
      void charWorldDock?.handleChatChanged?.();
      chatVision?.handleChatChanged?.();
      perfEngine?.handleChatChanged?.();
      tapImmersive?.exit();
      refreshAll();
      scheduleActiveChatPresetSync(30);
    });

    subscribe(types.GENERATION_ENDED, () => {
      perfEngine?.handleGenerationEnded?.();
    });

    subscribe(types.SETTINGS_UPDATED, () => {
      refreshAll({ shouldHydrate: true, skipExtensionReorder: true });
    });

    subscribe(types.CHARACTER_EDITED, () => {
      atmosphere?.invalidateCurrentEntityBackdrop();
      refreshAll();
    });

    subscribe(types.WORLDINFO_UPDATED, (bookName, bookData) => {
      charWorldDock?.handleWorldInfoUpdated?.(bookName, bookData);
      refreshAll();
    });

    subscribe(types.MESSAGE_SWIPED, () => {
      charWorldDock?.handleExternalSwipeSync?.();
    });

    subscribe(types.CHARACTERS_IMPORTED, () => {
      void refreshHostWorldInfoList({ getContext, doc: globalThis.document }).then(() => {
        refreshAll();
      });
    });

    for (const evt of [
      types.PRESET_CHANGED,
      types.MAIN_API_CHANGED,
      types.CHARACTER_DELETED,
      types.GROUP_UPDATED,
      types.WORLDINFO_SETTINGS_UPDATED,
    ]) {
      subscribe(evt, () => refreshAll());
    }

    const onControlUpdated = () => {
      const current = store.get();
      if (current.shellEnabled) {
        for (const key of ['bookshelf', 'persona', 'echoes', 'memory']) {
          const desired = Boolean(current.modules?.[key]);
          const registryId =
            key === 'bookshelf'
              ? 'yantai-bookshelf'
              : key === 'persona'
                ? 'yantai-persona-studio'
                : key === 'echoes'
                  ? 'yantai-echoes'
                  : 'yantai-memory';
          const handle = moduleBridge.getRegisteredHandle(registryId);
          if (handle && typeof handle.inspect === 'function' && typeof handle.setEnabled === 'function') {
            try {
              if (handle.inspect()?.enabled !== desired) {
                void moduleBridge.syncModuleEnabled(key, desired);
              }
            } catch {
              // ignore transient inspect errors
            }
          }
        }
      }
      settingsDialog?.renderIfOpen();
      homeCloak?.schedule();
    };
    globalThis.addEventListener?.('yantai:control:updated', onControlUpdated);
    eventCleanups.push(() => globalThis.removeEventListener?.('yantai:control:updated', onControlUpdated));

    registerSlashCommand(ctx);
    return true;
  }

  function initSubsystems() {
    suiteCoordinator = createSuiteCoordinator({
      root: globalThis,
      getContext,
      store,
      moduleBridge,
      stmVersion: STM_VERSION,
      notify: toastMessage,
      onStateChange: () => {
        if (!enabled) return;
        settingsDialog?.renderIfOpen();
        homeCloak?.schedule();
      },
    });

    perfEngine = createPerfEngine({
      store,
      getContext,
      root: globalThis,
    });

    homeCloak = createHomeCloak({
      getContext,
      store,
      onOpenSettings: () => settingsDialog?.open(),
      onToggleShell: toggleShell,
    });

    smartImporter = createSmartImporterController({
      getContext,
      store,
      onAfterImport: () => refreshAll(),
    });

    tapImmersive = createTapImmersive({
      getContext,
      store,
      isHomeCloaked: () => homeCloak.isHomeCloaked(),
      shouldSuppressTap: () =>
        Boolean(charWorldDock?.isOpen()) ||
        Boolean(presetDock?.isOpen()) ||
        Boolean(apiDock?.isOpen()) ||
        Boolean(readerDock?.isOpen()) ||
        Boolean(floatCapsule?.isOpen()) ||
        getOpenNativeDrawerIds().length > 0 ||
        Date.now() - lastDockDismissedAt < 320,
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
      onOpenStateChange: opened => {
        if (opened) {
          apiDock?.close();
          presetDock?.close();
          charWorldDock?.close();
          floatCapsule?.close();
        } else {
          lastDockDismissedAt = Date.now();
        }
        ttOverlayBackGuard?.sync();
        topbar?.refresh();
      },
    });

    apiDock = createApiDock({
      getContext,
      store,
      onBeforeOpen: () => {
        readerDock?.close();
        presetDock?.close();
        charWorldDock?.close();
        floatCapsule?.close();
      },
      onOpenStateChange: opened => {
        if (!opened) {
          lastDockDismissedAt = Date.now();
        }
        ttOverlayBackGuard?.sync();
        topbar?.refresh();
      },
    });

    presetDock = createPresetDock({
      getContext,
      store,
      onBeforeOpen: () => {
        readerDock?.close();
        apiDock?.close();
        charWorldDock?.close();
        floatCapsule?.close();
      },
      onOpenStateChange: opened => {
        if (!opened) {
          lastDockDismissedAt = Date.now();
        }
        ttOverlayBackGuard?.sync();
        topbar?.refresh();
      },
      onPresetChanged: () => {
        topbar?.refresh();
        charWorldDock?.refresh();
      },
      onOpenApiDock: () => {
        readerDock?.close();
        charWorldDock?.close();
        apiDock?.open();
      },
    });

    charWorldDock = createCharWorldDock({
      getContext,
      store,
      onBeforeOpen: () => {
        readerDock?.close();
        apiDock?.close();
        presetDock?.close();
        floatCapsule?.close();
      },
      onOpenStateChange: opened => {
        if (!opened) {
          lastDockDismissedAt = Date.now();
        }
        ttOverlayBackGuard?.sync();
        topbar?.refresh();
      },
      onPresetChanged: () => {
        topbar?.refresh();
        presetDock?.refresh();
      },
      onCharacterChanged: () => {
        atmosphere?.invalidateCurrentEntityBackdrop();
        topbar?.refresh();
        presetDock?.refresh();
      },
    });

    welcomeGuide = createWelcomeGuide({
      store,
      isSafeMode: () => isSafeModeRequested(globalThis),
      hasBlockingModal: () => Boolean(settingsDialog?.isOpen?.()),
      onOpenSettings: () => {
        readerDock?.close();
        apiDock?.close();
        presetDock?.close();
        charWorldDock?.close();
        settingsDialog?.open();
      },
      onOpenStateChange: () => {
        ttOverlayBackGuard?.sync();
      },
    });

    settingsDialog = createSettingsDialog({
      getContext,
      store,
      moduleBridge,
      suiteCoordinator,
      stmVersion: STM_VERSION,
      onToggleShell: toggleShell,
      onForcePruneTurbo: () => perfEngine?.refresh?.({ forcePrune: true }),
      onOpenWelcomeGuide: () => welcomeGuide?.open(),
      onPreviewAtmosphere: () => atmosphere?.refresh(),
      onOpenStateChange: () => {
        ttOverlayBackGuard?.sync();
      },
      onAfterOpenNativeDrawer: () => {
        topbar?.refresh();
        ttOverlayBackGuard?.sync();
      },
      onOpenPersonaStudio: () => {
        readerDock?.close();
        apiDock?.close();
        presetDock?.close();
        charWorldDock?.close();
        topbar?.openPersona?.();
        topbar?.refresh();
        ttOverlayBackGuard?.sync();
      },
      onOpenReaderDock: () => {
        apiDock?.close();
        presetDock?.close();
        charWorldDock?.close();
        readerDock?.open();
      },
      onOpenApiDock: () => {
        readerDock?.close();
        presetDock?.close();
        charWorldDock?.close();
        apiDock?.open();
      },
      onOpenPresetDock: () => {
        readerDock?.close();
        apiDock?.close();
        charWorldDock?.close();
        presetDock?.open();
      },
      onOpenPresetAssistant: () => {
        readerDock?.close();
        apiDock?.close();
        charWorldDock?.close();
        presetDock?.openAssistant();
      },
      onOpenCharWorldDock: tab => {
        readerDock?.close();
        apiDock?.close();
        presetDock?.close();
        charWorldDock?.open(tab);
      },
    });

    drawerBridge = createDrawerBridge();

    extensionsTidy = createExtensionsTidy({
      root: globalThis,
      store,
      stmVersion: STM_VERSION,
      onOpenSettings: () => {
        readerDock?.close();
        apiDock?.close();
        presetDock?.close();
        charWorldDock?.close();
        settingsDialog?.open();
      },
      onToggleShell: toggleShell,
      onSwitchTopbarMode: nextMode => {
        store.update({ topbarMode: nextMode });
        toastMessage(
          nextMode === 'native' ? '已切换为酒馆原版顶栏模式' : '已切换为 ST伴侣极简顶栏模式',
          'info',
        );
      },
    });

    chatVision = createChatVision({
      root: globalThis,
      getContext,
      store,
      notify: toastMessage,
    });

    floorActions = createFloorActions({
      root: globalThis,
      getContext,
      store,
      onOpenStateChange: () => {
        ttOverlayBackGuard?.sync();
      },
    });

    floatCapsule = createFloatCapsule({
      root: globalThis,
      getContext,
      store,
      isHomeCloaked: () => homeCloak.isHomeCloaked(),
      onOpenStateChange: opened => {
        if (!opened) {
          lastDockDismissedAt = Date.now();
        }
        ttOverlayBackGuard?.sync();
      },
    });

    topbar = createTopbar({
      getContext,
      store,
      moduleBridge,
      onOpenSettings: () => {
        readerDock?.close();
        apiDock?.close();
        presetDock?.close();
        charWorldDock?.close();
        settingsDialog.open();
      },
      onToggleCharWorldDock: () => charWorldDock?.toggle(),
      onOpenCharWorldTab: tab => {
        readerDock?.close();
        apiDock?.close();
        presetDock?.close();
        charWorldDock?.open(tab);
      },
      onCloseCharWorldDock: () => charWorldDock?.close(),
      getCharWorldActiveTab: () => charWorldDock?.getActiveTab?.() || 'char',
      isCharWorldDockOpen: () => Boolean(charWorldDock?.isOpen()),
      onTogglePresetDock: () => presetDock?.toggle(),
      isPresetDockOpen: () => Boolean(presetDock?.isOpen()),
      onToggleApiDock: () => apiDock?.toggle(),
      isApiDockOpen: () => Boolean(apiDock?.isOpen()),
      onToggleReaderDock: () => {
        apiDock?.close();
        presetDock?.close();
        charWorldDock?.close();
        readerDock?.toggle();
      },
      isReaderDockOpen: () => Boolean(readerDock?.isOpen()),
      onNativeDrawerOpened: () => {
        readerDock?.close();
        apiDock?.close();
        presetDock?.close();
        charWorldDock?.close();
        floatCapsule?.close();
      },
      onNativeDrawerStateChange: opened => {
        if (!opened) {
          lastDockDismissedAt = Date.now();
        }
        ttOverlayBackGuard?.sync();
      },
      onExitPureReading: () => tapImmersive.exit(),
    });

    unsubscribeStore = store.subscribe(() => {
      refreshAll();
    });

    // 仅在 isTauri 下挂载安卓 TT 侧滑返回手势守卫（普通浏览器 100% 零监听、零调用 history.pushState）
    if (detectPlatform(globalThis).isTauri) {
      ttOverlayBackGuard = createTauriOverlayBackGuard({
        root: globalThis,
        hasAnyOverlayOpen: () =>
          isExportFallbackDialogOpen(globalThis.document) ||
          Boolean(charWorldDock?.isLightboxOpen?.()) ||
          Boolean(welcomeGuide?.isOpen?.()) ||
          Boolean(settingsDialog?.isOpen?.()) ||
          Boolean(readerDock?.isOpen?.()) ||
          Boolean(apiDock?.isOpen?.()) ||
          Boolean(presetDock?.isOpen?.()) ||
          Boolean(charWorldDock?.isOpen?.()) ||
          Boolean(floorActions?.isMenuOpen?.()) ||
          Boolean(floatCapsule?.isOpen?.()) ||
          Boolean(store.get().shellEnabled && getOpenNativeDrawerIds().length > 0),
        closeTopmostOverlay: () => {
          if (isExportFallbackDialogOpen(globalThis.document)) {
            closeExportFallbackDialog(globalThis.document, globalThis);
            return true;
          }
          if (charWorldDock?.isLightboxOpen?.()) {
            charWorldDock.closeLightbox();
            return true;
          }
          if (welcomeGuide?.isOpen?.()) {
            welcomeGuide.close({ persistDismiss: true });
            return true;
          }
          if (settingsDialog?.isOpen?.()) {
            settingsDialog.close();
            return true;
          }
          if (readerDock?.isOpen?.()) {
            readerDock.close();
            return true;
          }
          if (apiDock?.isOpen?.()) {
            apiDock.close();
            return true;
          }
          if (presetDock?.isOpen?.()) {
            presetDock.close();
            return true;
          }
          if (charWorldDock?.isOpen?.()) {
            charWorldDock.close();
            return true;
          }
          if (floorActions?.isMenuOpen?.()) {
            floorActions.closeMenu();
            return true;
          }
          if (floatCapsule?.isOpen?.()) {
            floatCapsule.close();
            return true;
          }
          if (store.get().shellEnabled && getOpenNativeDrawerIds().length > 0) {
            closeAllNativeDrawers();
            topbar?.refresh();
            return true;
          }
          return false;
        },
      });

      const onViewportSafeAreaCheck = () => {
        syncTauriSafeAreaGuard(globalThis);
      };
      globalThis.addEventListener?.('resize', onViewportSafeAreaCheck, { passive: true });
      eventCleanups.push(() => globalThis.removeEventListener?.('resize', onViewportSafeAreaCheck));
    }
  }

  function enable() {
    if (enabled) return;
    enabled = true;

    ensureFreshStylesheet();
    syncTauriSafeAreaGuard(globalThis);
    initSubsystems();
    registerSelfInControlRegistry();

    cancelBoot = scheduleIdleBoot(() => {
      const boot = () => {
        if (!enabled) return true;
        ensureFreshStylesheet();
        syncTauriSafeAreaGuard(globalThis);
        const ctx = getContext();
        if (!ctx?.extensionSettings) return false;

        store.hydrate();
        syncActiveCompanionThemeOnBoot({ getContext, doc: globalThis.document });
        if (!safeModeNotified && isSafeModeRequested(globalThis)) {
          safeModeNotified = true;
          if (store.get().shellEnabled) {
            store.update({ shellEnabled: false }, { silent: true });
          }
          toastMessage('已通过 ?stm_safe=1 安全模式挂起 ST伴侣界面接管，方便排查冲突', 'info');
        }
        const bound = bindHostEvents();
        void moduleBridge.applyAllFromStore();
        refreshAll();
        scheduleActiveChatPresetSync(40);
        scheduleSuiteAutoProvision(1800);
        welcomeGuide?.maybeOpenOnFirstBoot(1100);
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
    if (autoProvisionTimer) {
      globalThis.clearTimeout(autoProvisionTimer);
      autoProvisionTimer = 0;
    }
    presetSyncScheduler.cancel();

    unsubscribeStore?.();
    unsubscribeStore = null;

    ttOverlayBackGuard?.destroy();
    ttOverlayBackGuard = null;
    closeExportFallbackDialog(globalThis.document, globalThis);
    clearTauriSafeAreaGuard(globalThis);

    while (eventCleanups.length) {
      const off = eventCleanups.pop();
      try {
        off?.();
      } catch {
        // ignore cleanup error
      }
    }

    unregisterSelfFromControlRegistry();

    charWorldDock?.destroy();
    presetDock?.destroy();
    apiDock?.destroy();
    readerDock?.destroy();
    atmosphere?.destroy();
    perfEngine?.destroy();
    topbar?.destroy();
    floorActions?.destroy();
    floatCapsule?.destroy();
    chatVision?.destroy();
    extensionsTidy?.destroy();
    drawerBridge?.destroy();
    tapImmersive?.destroy();
    smartImporter?.destroy();
    homeCloak?.destroy();
    welcomeGuide?.destroy();
    settingsDialog?.destroy();

    charWorldDock = null;
    presetDock = null;
    apiDock = null;
    readerDock = null;
    atmosphere = null;
    perfEngine = null;
    topbar = null;
    floorActions = null;
    floatCapsule = null;
    chatVision = null;
    extensionsTidy = null;
    drawerBridge = null;
    tapImmersive = null;
    smartImporter = null;
    homeCloak = null;
    welcomeGuide = null;
    settingsDialog = null;
    suiteCoordinator = null;
  }

  return {
    enable,
    disable,
    refresh: refreshAll,
    openSettings: tab => settingsDialog?.open(tab),
    openWelcomeGuide: () => welcomeGuide?.open(),
    openReaderDock: () => readerDock?.open(),
    openApiDock: () => apiDock?.open(),
    openPresetDock: () => presetDock?.open(),
    openPresetAssistant: () => presetDock?.openAssistant(),
    openCharWorldDock: tab => charWorldDock?.open(tab),
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
  if (typeof document !== 'undefined') {
    document.removeEventListener('DOMContentLoaded', onEnable);
  }
  runtime.disable();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onEnable, { once: true });
  } else {
    onEnable();
  }
}
