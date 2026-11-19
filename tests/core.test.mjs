import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clearTauriSafeAreaGuard,
  createTauriOverlayBackGuard,
  detectPlatform,
  hasActiveChatSelection,
  syncTauriSafeAreaGuard,
} from '../src/core/env.js';
import {
  closeExportFallbackDialog,
  isExportFallbackDialogOpen,
  saveExportBlob,
} from '../src/core/file-saver.js';
import { clarityToBlurPx, createLruMap } from '../src/core/backdrop-cache.js';
import { ICON_NAMES, svgMarkup } from '../src/core/icons.js';
import {
  CHAT_COMPLETION_SOURCE_IDS,
  DEFAULT_SETTINGS,
  STM_SCHEMA_VERSION,
  createSettingsStore,
  normalizeApiStation,
  normalizePresetStudio,
  normalizeSettings,
  sanitizeAssetUrl,
} from '../src/core/schema.js';
import { INTERACTIVE_ANCESTOR_SELECTOR, shouldTogglePureReading } from '../src/core/tap-guard.js';
import { CONTROL_REGISTRY_KEY, MODULE_DESCRIPTORS, createModuleBridge } from '../src/core/registry.js';
import { formatShortPresetName, getSwipeGesturesEnabled, setSwipeGesturesEnabled } from '../src/shell/host-actions.js';
import { buildPageOverrideCss, createAtmosphere } from '../src/shell/atmosphere.js';
import { partitionChatMessages } from '../src/shell/perf-engine.js';
import {
  API_SOURCES,
  MORE_SOURCE_IDS,
  PRIMARY_SOURCE_IDS,
  appendV1Suffix,
  applyStationToHost,
  buildHostProxyPresetName,
  buildProbeGenerateBody,
  duplicateApiStation,
  extractCompletionPayload,
  extractProbeReplyText,
  fetchStationModels,
  filterModelsByQuery,
  formatStationCompactSummary,
  getHostModelForSource,
  guessFriendlyStationName,
  inspectStationSecretStatus,
  isLegacySecretsMap,
  isTemperatureUnsupportedModel,
  mergeImportedStations,
  needsV1Suffix,
  readSecretsMap,
  resolveAuxApiChannel,
  resolveSecretKeyForStation,
  rotateStationSecret,
  setPrimaryDefaultStation,
  syncReverseProxyCredentialToHost,
  testStationChatReply,
  toggleFavoriteModel,
  writeStationSecret,
} from '../src/modules/api-backend.js';
import {
  applyGenerationParams,
  applyPresetSnapshotToHost,
  captureCurrentPresetSnapshot,
  cleanupDeletedPresetReferences,
  createActiveChatPresetSyncScheduler,
  createCustomPromptEntry,
  createPresetAutoSaver,
  deleteCustomPromptEntry,
  deleteHostPreset,
  duplicateHostPreset,
  exportPresetToJsonString,
  filterPromptEntries,
  getBoundPresetForEntity,
  getEntitiesBoundToPreset,
  getEntityBindingKey,
  getHostPresetState,
  importPresetItems,
  listBindableEntities,
  movePromptEntryOrder,
  partitionPresetsByArchive,
  primeHostOpenAiModule,
  readGenerationParams,
  readOrderedPromptEntries,
  renameHostPreset,
  renamePresetReferences,
  resolveTargetPresetForEntity,
  resolveUniquePresetName,
  saveHostPreset,
  sanitizePresetForImport,
  setBoundPresetForEntity,
  setDefaultPresetName,
  setEntitiesBoundToPreset,
  syncHostPromptManagerAndSettings,
  syncPresetForActiveChat,
  toggleArchivePreset,
  togglePromptEntryEnabled,
  updatePromptEntryFields,
} from '../src/modules/preset-backend.js';
import {
  DEFAULT_ASSISTANT_TIMEOUT_MS,
  DEFAULT_MAX_HISTORY_TURNS,
  buildAssistantGenerateBody,
  createAssistantSession,
  extractAssistantPlan,
  isTemperatureForbiddenModel,
  normalizeAssistantMessages,
  removeJsonTrailingCommas,
  requestAssistantCompletion,
  resolveAssistantRuntimeChannel,
  stripThinkingBlocks,
} from '../src/modules/assistant-core.js';
import {
  FOCUSED_ENTRY_MAX_CHARS,
  PRESET_ASSISTANT_QUICK_PROMPTS,
  applySelectedPresetOperations,
  buildPresetAssistantSystemPrompt,
  createPresetUndoStack,
  scorePromptEntryRelevance,
  serializePresetContext,
  truncatePromptContentForContext,
  undoLastPresetOperation,
  validateAndPreviewPresetOperations,
} from '../src/modules/preset-assistant.js';
import {
  WI_DEPTH_ROLE_OPTIONS,
  WI_POSITION_OPTIONS,
  applyGreetingToFirstChatFloor,
  bindCharacterPrimaryWorldBook,
  buildAddAlternateGreetingPatch,
  buildCharacterMergePayload,
  buildDeleteAlternateGreetingPatch,
  buildGreetingEditPatch,
  canReplaceOpeningGreetingInChat,
  countUnicodeChars,
  createCharacterProfileAutoSaver,
  createHostWorldBook,
  createWorldBookAutoSaver,
  createWorldInfoBookEntry,
  cycleWorldInfoEntryTriggerMode,
  deleteWorldInfoBookEntry,
  enablePresetWorldInfoSlots,
  exportActiveCharacterCard,
  filterWorldInfoEntries,
  formatWorldInfoKeywords,
  inspectPresetWorldInfoSlots,
  inspectWorldBookActivation,
  loadHostWorldBook,
  parseWorldInfoKeywords,
  primeHostWorldInfoModule,
  readActiveCharacterProfile,
  readWorldInfoEntries,
  resetCachedHostWorldInfoModule,
  resolveUniqueWorldBookName,
  resolveWorldInfoActivationState,
  sanitizeExportFileStem,
  saveCharacterProfilePatch,
  saveHostWorldBook,
  setGlobalWorldBookEnabled,
  setWorldInfoEntryTriggerMode,
  substituteOpeningGreetingMacros,
  toggleWorldInfoEntryEnabled,
  updateWorldInfoBookEntry,
} from '../src/modules/char-world-backend.js';
import { createApiDock } from '../src/modules/api-dock.js';
import { createPresetDock } from '../src/modules/preset-dock.js';
import { createCharWorldDock } from '../src/modules/char-world-dock.js';
import { createReaderDock } from '../src/shell/reader-dock.js';
import { createTopbar } from '../src/shell/topbar.js';
import { createSettingsDialog } from '../src/shell/settings-dialog.js';

test('schema: 默认设置严格符合产品约定，且顶栏恒定收敛为 rp 态与全局轻触纯享', () => {
  const normalized = normalizeSettings(undefined);
  assert.equal(normalized.shellEnabled, true);
  assert.equal(normalized.topbarMode, 'rp');
  assert.equal(normalized.tapPureReading, true);
  assert.equal(normalized.tapPureReadingScope, 'all');
  assert.equal(normalized.modules.turbo, true, '隐形流畅渲染引擎必须默认开启');
  assert.equal(normalized.modules.reader, true, '阅读排版与角色映幕必须默认开启');
  assert.equal(normalized.modules.bookshelf, true);
  assert.equal(normalized.modules.persona, true);
  assert.equal(normalized.modules.echoes, false, '重Roll平行分支必须默认关闭');
  assert.equal(normalized.modules.memory, false, '叙事记忆必须默认关闭');
  assert.equal(normalized.vibe.fontSizePx, 0, '未调节时默认跟随玩家原有美化字号');
  assert.equal(normalized.vibe.paragraphIndent, 'default', '未调节时默认不强改段落缩进');
  assert.equal(normalized.auxApi.mode, 'follow_main', '伴侣助手默认零配置跟随主对话 API');
  assert.deepEqual(normalized.apiStudio.stations, []);
  assert.equal(STM_SCHEMA_VERSION, 5);
  assert.equal(normalized.schemaVersion, 5);
  assert.deepEqual(normalized.presetStudio, {
    defaultPreset: '',
    charBindings: {},
    archivedPresets: [],
  });
});

test('schema: 旧版 reading 顶栏态与非法字段自动收敛归一化，持久化幂等写入 st_mate 命名空间', () => {
  let savedCount = 0;
  const mockCtx = {
    extensionSettings: {
      other_plugin: { keep: true },
      st_mate: {
        topbarMode: 'reading',
        tapPureReadingScope: 'reading',
        vibe: { backdropBlur: 999, backdropDim: -20, fontScale: 50 },
        modules: { echoes: true },
      },
    },
    saveSettingsDebounced() {
      savedCount += 1;
    },
  };

  const store = createSettingsStore({ getContext: () => mockCtx });
  assert.equal(store.get().topbarMode, 'rp', '旧存档 reading 模式应自动收敛为 rp');
  assert.equal(store.get().tapPureReadingScope, 'all', '旧存档生效范围应恒定收敛为 all');
  assert.equal(store.get().vibe.backdropBlur, 48);
  assert.equal(store.get().vibe.backdropDim, 0);
  assert.equal(store.get().vibe.fontScale, 85);
  assert.equal(store.get().modules.echoes, true);
  assert.deepEqual(mockCtx.extensionSettings.other_plugin, { keep: true });

  // 即使外部尝试再次写入 reading，也恒定收敛为 rp
  store.update({ topbarMode: 'reading', tapPureReadingScope: 'reading', modules: { echoes: false } });
  assert.equal(store.get().topbarMode, 'rp');
  assert.equal(store.get().tapPureReadingScope, 'all');
  assert.equal(store.get().modules.echoes, false);
  assert.equal(savedCount, 1);
});

test('tap-guard: 正文普通区域轻触触发纯享阅读，.stm-api-dock / 划词 / 滚动 / 按钮严格放行', () => {
  assert.ok(
    INTERACTIVE_ANCESTOR_SELECTOR.includes('.stm-api-dock'),
    'API 下拉面板必须纳入交互白名单防止点击面板误触纯享切换',
  );
  assert.ok(
    INTERACTIVE_ANCESTOR_SELECTOR.includes('.stm-preset-dock'),
    '预设馆下拉面板必须纳入交互白名单防止点击面板误触纯享切换',
  );
  assert.ok(
    INTERACTIVE_ANCESTOR_SELECTOR.includes('.stm-char-world-dock'),
    '角色与世界书下拉一体页必须纳入交互白名单防止点击面板误触纯享切换',
  );
  assert.ok(
    INTERACTIVE_ANCESTOR_SELECTOR.includes('.stm-portrait-lightbox'),
    '高清立绘大图预览浮层必须纳入交互白名单',
  );

  function makeMockNode({ interactiveMatch = false, insideChat = true } = {}) {
    const target = {
      closest(selector) {
        return interactiveMatch ? { matched: selector } : null;
      },
    };
    const chatRoot = {
      contains(node) {
        return insideChat && node === target;
      },
    };
    return { target, chatRoot };
  }

  const baseSettings = { ...DEFAULT_SETTINGS, shellEnabled: true, tapPureReading: true };
  const clean = makeMockNode({ interactiveMatch: false, insideChat: true });

  assert.equal(
    shouldTogglePureReading({
      settings: baseSettings,
      target: clean.target,
      chatRoot: clean.chatRoot,
      gesture: { dx: 2, dy: 3, durationMs: 120, button: 0 },
      selectionText: '',
    }),
    true,
  );

  assert.equal(
    shouldTogglePureReading({
      settings: baseSettings,
      target: clean.target,
      chatRoot: clean.chatRoot,
      gesture: { dx: 0, dy: 0, durationMs: 100, button: 0 },
      selectionText: '一段被选中的台词',
    }),
    false,
  );

  assert.equal(
    shouldTogglePureReading({
      settings: baseSettings,
      target: clean.target,
      chatRoot: clean.chatRoot,
      gesture: { dx: 0, dy: 14, durationMs: 180, button: 0 },
      selectionText: '',
    }),
    false,
  );

  const interactive = makeMockNode({ interactiveMatch: true, insideChat: true });
  assert.equal(
    shouldTogglePureReading({
      settings: baseSettings,
      target: interactive.target,
      chatRoot: interactive.chatRoot,
      gesture: { dx: 0, dy: 0, durationMs: 90, button: 0 },
      selectionText: '',
    }),
    false,
  );

  assert.equal(
    shouldTogglePureReading({
      settings: baseSettings,
      isHomeView: true,
      target: clean.target,
      chatRoot: clean.chatRoot,
      gesture: { dx: 0, dy: 0, durationMs: 90, button: 0 },
      selectionText: '',
    }),
    false,
  );
});

test('registry: 自动协调已注册子插件并让旧版界面整理让出顶栏控制权', async () => {
  const mockRoot = {};
  let bookshelfState = true;
  mockRoot[CONTROL_REGISTRY_KEY] = {
    version: 1,
    modules: new Map([
      [
        'yantai-bookshelf',
        {
          id: 'yantai-bookshelf',
          version: '1.4.5',
          inspect: () => ({ health: 'ok' }),
          async setEnabled(val) {
            bookshelfState = val;
          },
        },
      ],
    ]),
  };

  const mockCtx = {
    extensionSettings: {
      yantaiInterface: { enabled: true, hiddenTop: ['ai-config-button', 'WI-SP-button'] },
      yantai_echoes: { enabled: true },
    },
    saveSettingsDebounced() {},
  };

  const store = createSettingsStore({ getContext: () => mockCtx });
  const bridge = createModuleBridge({ root: mockRoot, getContext: () => mockCtx, store });

  await bridge.applyAllFromStore();
  assert.deepEqual(mockCtx.extensionSettings.yantaiInterface.hiddenTop, []);
  assert.equal(mockCtx.extensionSettings.yantai_echoes.enabled, false);
  assert.equal(bookshelfState, true);

  await bridge.syncModuleEnabled('bookshelf', false);
  assert.equal(bookshelfState, false);
});

test('env & host-actions: 平台检测与角色名旁小字预设截断准确', () => {
  const ttEnv = detectPlatform({
    __TAURI_INTERNALS__: {},
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36', maxTouchPoints: 5 },
    innerWidth: 412,
  });
  assert.equal(ttEnv.isTauri, true);
  assert.equal(ttEnv.isAndroid, true);
  assert.equal(ttEnv.isMobile, true);

  assert.equal(hasActiveChatSelection({ characterId: undefined, groupId: null }), false);
  assert.equal(hasActiveChatSelection({ characterId: 0, groupId: null }), true);
  assert.equal(hasActiveChatSelection({ characterId: undefined, groupId: 'group_1' }), true);

  assert.deepEqual(formatShortPresetName('砚台预设_V2.0.json', 7), {
    fullName: '砚台预设_V2.0',
    shortName: '砚台预设_V2…',
  });
  assert.deepEqual(formatShortPresetName('造卡工坊', 7), {
    fullName: '造卡工坊',
    shortName: '造卡工坊',
  });
  assert.deepEqual(formatShortPresetName('gui', 7), {
    fullName: '默认预设',
    shortName: '默认预设',
  });
});

test('registry: 点「原生酒馆」一键挂起全部子模块，回到伴侣时原样恢复勾选组合', async () => {
  const mockRoot = {};
  let bookshelfLive = true;
  let personaLive = true;

  mockRoot[CONTROL_REGISTRY_KEY] = {
    version: 1,
    modules: new Map([
      [
        'yantai-bookshelf',
        {
          id: 'yantai-bookshelf',
          async setEnabled(val) {
            bookshelfLive = val;
          },
        },
      ],
      [
        'yantai-persona-studio',
        {
          id: 'yantai-persona-studio',
          async setEnabled(val) {
            personaLive = val;
          },
        },
      ],
    ]),
  };

  const mockCtx = {
    extensionSettings: {
      st_mate: {
        shellEnabled: true,
        modules: { bookshelf: true, persona: true, echoes: true },
      },
      yantai_echoes: { enabled: true },
    },
    saveSettingsDebounced() {},
  };

  const store = createSettingsStore({ getContext: () => mockCtx });
  const bridge = createModuleBridge({ root: mockRoot, getContext: () => mockCtx, store });

  store.update({ shellEnabled: false });
  await bridge.suspendAllForNative();
  assert.equal(bookshelfLive, false);
  assert.equal(personaLive, false);
  assert.equal(mockCtx.extensionSettings.yantai_echoes.enabled, false);
  assert.equal(store.get().modules.bookshelf, true);
  assert.equal(store.get().modules.echoes, true);

  bookshelfLive = true;
  await bridge.applyAllFromStore();
  assert.equal(bookshelfLive, false);

  store.update({ shellEnabled: true });
  await bridge.applyAllFromStore();
  assert.equal(bookshelfLive, true);
  assert.equal(personaLive, true);
  assert.equal(mockCtx.extensionSettings.yantai_echoes.enabled, true);
});

test('icons & aesthetics: 全量细线图标（含 plug/star/key/search）均为纯小写键名、1.5px 纯色细线 SVG、零 Emoji', () => {
  const requiredNewIcons = [
    'plug',
    'star',
    'plus',
    'trash',
    'search',
    'check',
    'copy',
    'key',
    'eyeoff',
    'download',
    'archive',
    'pin',
    'unlink',
    'arrowup',
    'arrowdown',
    'edit',
    'file',
    'chevron',
    'undo',
    'send',
    'stop',
    'close',
    'globe',
    'idcard',
    'users',
    'alert',
    'maximize',
  ];
  for (const name of requiredNewIcons) {
    assert.ok(ICON_NAMES.includes(name), `图标库必须包含 ${name}`);
  }

  for (const iconKey of ICON_NAMES) {
    assert.match(iconKey, /^[a-z]+$/, `图标键名 ${iconKey} 必须为纯小写英文字母`);
    const svg = svgMarkup(iconKey);
    assert.ok(svg.includes('stroke="currentColor"'), `${iconKey} 必须跟随主题文字色`);
    assert.ok(svg.includes('stroke-width="1.5"'), `${iconKey} 必须统一 1.5px 极简细线`);
    assert.ok(svg.includes('fill="none"'), `${iconKey} 必须为非实心纯线图标`);
  }

  for (const mod of MODULE_DESCRIPTORS) {
    assert.match(mod.icon, /^[a-z]+$/, `模块 ${mod.key} 应使用纯小写线性图标键名`);
  }
});

test('performance & page overrides: 滑块 silent 更新与美化穿透样式、右滑重Roll双向同步', () => {
  let listenerCalls = 0;
  const store = createSettingsStore({ getContext: () => ({ extensionSettings: {} }) });
  store.subscribe(() => {
    listenerCalls += 1;
  });

  store.update({ vibe: { backdropBlur: 24 } }, { silent: true });
  assert.equal(store.get().vibe.backdropBlur, 24);
  assert.equal(listenerCalls, 0);

  assert.equal(sanitizeAssetUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeAssetUrl('/backgrounds/stm-bg-1.webp'), 'backgrounds/stm-bg-1.webp');
  assert.equal(sanitizeAssetUrl('https://img.example.com/a.png'), 'https://img.example.com/a.png');

  const untouchedCss = buildPageOverrideCss(DEFAULT_SETTINGS.vibe, { readerActive: true, backdropLive: false });
  assert.equal(untouchedCss, '');

  store.update({
    vibe: {
      backdropMode: 'character',
      backdropBrightness: 42,
      backdropClarity: 55,
      fontSizePx: 18,
      paddingX: 6,
      lineHeight: 200,
      paragraphIndent: 'indent',
      hideAvatars: true,
      bookPageFlow: true,
      fontChoice: 'kai',
    },
  });

  const activeCss = buildPageOverrideCss(store.get().vibe, {
    readerActive: true,
    backdropLive: true,
    isNotionTheme: true,
  });
  assert.ok(activeCss.includes('#sheld#sheld'));
  assert.ok(activeCss.includes('--nt-body: 18px !important'));
  assert.ok(activeCss.includes('padding-left: 6px !important'));
  assert.ok(activeCss.includes('text-indent: 2em !important'));
  assert.ok(activeCss.includes('html body:not(.stm-home-cloak) #chat#chat:not(.jd-bookshelf-home)'));
  assert.equal(/html body #chat#chat/.test(activeCss), false, '严禁生成未排除首页与书架的裸 #chat#chat 选择器');

  let saved = 0;
  const mockCtx = {
    powerUserSettings: { gestures: true },
    saveSettingsDebounced() {
      saved += 1;
    },
  };
  assert.equal(getSwipeGesturesEnabled(() => mockCtx), true);
  setSwipeGesturesEnabled(false, () => mockCtx);
  assert.equal(mockCtx.powerUserSettings.gestures, false);
  assert.equal(saved, 1);
});

test('turbo engine: 长对话楼层自动分流休眠与 LRU 底图缓存淘汰无泄漏', () => {
  assert.equal(clarityToBlurPx(100), 0);
  const evicted = [];
  const lru = createLruMap(2, (k, v) => evicted.push([k, v]));
  lru.set('a', 'blob:1');
  lru.set('b', 'blob:2');
  assert.equal(lru.get('a'), 'blob:1');
  lru.set('c', 'blob:3');
  assert.deepEqual(evicted, [['b', 'blob:2']]);

  const longChat = Array.from({ length: 100 }, (_, i) => ({ id: i }));
  const split = partitionChatMessages(longChat, 8);
  assert.equal(split.hibernate.length, 92);
  assert.equal(split.awake.length, 8);
});

test('api-backend: 全量 26 个聊天补全来源映射齐备，Vertex 密钥模式与站子归一化零明文泄漏', () => {
  assert.equal(PRIMARY_SOURCE_IDS.length, 5);
  assert.equal(MORE_SOURCE_IDS.length, 21);
  assert.equal(PRIMARY_SOURCE_IDS.length + MORE_SOURCE_IDS.length, CHAT_COMPLETION_SOURCE_IDS.length);

  for (const srcId of CHAT_COMPLETION_SOURCE_IDS) {
    const meta = API_SOURCES[srcId];
    assert.ok(meta, `来源 ${srcId} 元数据必须存在`);
    assert.ok(meta.label && meta.shortLabel, `来源 ${srcId} 必须有人话中文标题`);
    assert.ok(meta.modelField, `来源 ${srcId} 必须映射 oai_settings 模型字段`);
    assert.ok(meta.modelSelectSelector, `来源 ${srcId} 必须映射原生 DOM 模型选择框`);
    assert.ok(meta.secretKey, `来源 ${srcId} 必须映射 secrets 密钥键`);
  }

  assert.equal(resolveSecretKeyForStation({ source: 'vertexai', vertexAuthMode: 'express' }), 'api_key_vertexai');
  assert.equal(
    resolveSecretKeyForStation({ source: 'vertexai', vertexAuthMode: 'full' }),
    'vertexai_service_account_json',
  );
  assert.equal(resolveSecretKeyForStation({ source: 'makersuite' }), 'api_key_makersuite');

  // 站子归一化：绝不落盘任何明文密钥字段，自动去重收藏并清洗危险 URL
  const dirtyStation = normalizeApiStation({
    id: 'my station!@#',
    name: '  反代主力站  ',
    source: 'custom',
    url: 'javascript:alert(1)',
    apiKey: 'sk-plain-danger-123',
    rawKey: 'sk-plain-danger-456',
    secretId: 'sec-uuid-01',
    secretLabel: '主力Key',
    model: ' claude-sonnet-4-6 ',
    favoriteModels: ['claude-sonnet-4-6', ' gemini-2.5-pro ', 'claude-sonnet-4-6', ''],
  });

  assert.equal(dirtyStation.id, 'mystation');
  assert.equal(dirtyStation.name, '反代主力站');
  assert.equal(dirtyStation.url, '');
  assert.equal(dirtyStation.secretId, 'sec-uuid-01');
  assert.equal(dirtyStation.model, 'claude-sonnet-4-6');
  assert.deepEqual(dirtyStation.favoriteModels, ['claude-sonnet-4-6', 'gemini-2.5-pro']);
  assert.equal('apiKey' in dirtyStation, false, '严禁保留明文 apiKey 属性');
  assert.equal('rawKey' in dirtyStation, false, '严禁保留明文 rawKey 属性');
});

test('api-backend: URL /v1 智能检测补全、模型多词模糊搜索与常用模型收藏增删', () => {
  assert.equal(needsV1Suffix('https://api.newapi.pro', 'custom'), true);
  assert.equal(needsV1Suffix('https://api.newapi.pro/', 'custom'), true);
  assert.equal(needsV1Suffix('https://api.newapi.pro/subpath', 'custom'), true);
  assert.equal(needsV1Suffix('https://api.newapi.pro/v1', 'custom'), false);
  assert.equal(needsV1Suffix('https://api.newapi.pro/v1/', 'custom'), false);
  assert.equal(needsV1Suffix('https://api.anthropic.com', 'claude'), false, '非 custom 来源不弹 /v1 补全');
  assert.equal(needsV1Suffix('', 'custom'), false);

  assert.equal(appendV1Suffix('https://api.newapi.pro'), 'https://api.newapi.pro/v1');
  assert.equal(appendV1Suffix('https://api.newapi.pro///'), 'https://api.newapi.pro/v1');
  assert.equal(appendV1Suffix('https://api.newapi.pro/v1/'), 'https://api.newapi.pro/v1');

  const sampleModels = [
    'gpt-4o-mini',
    'anthropic/claude-3.7-sonnet',
    'claude-sonnet-4-6',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ];
  assert.deepEqual(filterModelsByQuery(sampleModels, 'claude sonnet'), [
    'claude-sonnet-4-6',
    'anthropic/claude-3.7-sonnet',
  ]);
  assert.deepEqual(filterModelsByQuery(sampleModels, 'GEMINI 2.5'), ['gemini-2.5-pro', 'gemini-2.5-flash']);

  let favs = toggleFavoriteModel([], 'gemini-2.5-pro');
  assert.deepEqual(favs, ['gemini-2.5-pro']);
  favs = toggleFavoriteModel(favs, 'claude-sonnet-4-6');
  assert.deepEqual(favs, ['gemini-2.5-pro', 'claude-sonnet-4-6']);
  favs = toggleFavoriteModel(favs, 'gemini-2.5-pro');
  assert.deepEqual(favs, ['claude-sonnet-4-6'], '再次点击应取消收藏');
});

test('api-backend: 精准同步宿主 oai_settings 与原生 DOM（自动补 <option> 防吞空，且 100% 零触碰预设！）', () => {
  function createMockSelect(id, initialValue = '', initialOptions = []) {
    const options = initialOptions.map(v => ({ value: v, textContent: v }));
    const events = [];
    return {
      id,
      options,
      _value: initialValue,
      events,
      get value() {
        return this._value;
      },
      set value(next) {
        // 模拟真实 HTMLSelectElement：若没有对应 option，设值会被吞成空字符串！
        if (options.some(o => o.value === next)) {
          this._value = next;
        } else {
          this._value = '';
        }
      },
      appendChild(opt) {
        options.push(opt);
      },
      dispatchEvent(evt) {
        events.push(evt.type);
      },
    };
  }

  function createMockInput(id, initialValue = '') {
    const events = [];
    return {
      id,
      value: initialValue,
      events,
      dispatchEvent(evt) {
        events.push(evt.type);
      },
    };
  }

  const elementsById = {
    main_api: createMockSelect('main_api', 'kobold', ['kobold', 'openai']),
    chat_completion_source: createMockSelect('chat_completion_source', 'openai', ['openai', 'custom', 'vertexai']),
    custom_api_url_text: createMockInput('custom_api_url_text', ''),
    custom_model_id: createMockInput('custom_model_id', ''),
    model_custom_select: createMockSelect('model_custom_select', '', []),
    model_vertexai_select: createMockSelect('model_vertexai_select', '', ['gemini-2.5-flash']),
    vertexai_auth_mode: createMockSelect('vertexai_auth_mode', 'express', ['express', 'full']),
    vertexai_region: createMockInput('vertexai_region', 'us-central1'),
    vertexai_express_project_id: createMockInput('vertexai_express_project_id', ''),
    custom_prompt_post_processing: createMockSelect('custom_prompt_post_processing', '', ['', 'merge', 'strict']),
  };

  const mockDoc = {
    getElementById: id => elementsById[id] || null,
    querySelector: sel => (sel.startsWith('#') ? elementsById[sel.slice(1)] || null : null),
    createElement: tag => ({ tagName: tag.toUpperCase(), value: '', textContent: '' }),
  };

  let saveCalled = 0;
  const mockOai = {
    preset_settings_openai: '砚台预设_珍藏版',
    chat_completion_source: 'openai',
    custom_url: '',
    custom_model: '',
    vertexai_model: '',
    custom_prompt_post_processing: '',
  };

  const mockCtx = {
    chatCompletionSettings: mockOai,
    saveSettingsDebounced() {
      saveCalled += 1;
    },
  };

  const customStation = normalizeApiStation({
    id: 'st_custom_1',
    name: '公益站A',
    source: 'custom',
    url: 'https://relay.example.com/v1',
    model: 'gemini-4-carbon(high)',
    postProcessing: 'merge',
  });

  applyStationToHost(customStation, { getContext: () => mockCtx, doc: mockDoc });

  assert.equal(elementsById.main_api.value, 'openai', '主 API 应自动切至聊天补全 openai');
  assert.equal(mockOai.chat_completion_source, 'custom');
  assert.equal(elementsById.chat_completion_source.value, 'custom');
  assert.equal(mockOai.custom_url, 'https://relay.example.com/v1');
  assert.equal(elementsById.custom_api_url_text.value, 'https://relay.example.com/v1');
  assert.equal(
    elementsById.model_custom_select.value,
    'gemini-4-carbon(high)',
    '原生 <select> 应动态补入新 option 并保留选中值不被吞空',
  );
  assert.equal(elementsById.custom_model_id.value, 'gemini-4-carbon(high)');
  assert.equal(getHostModelForSource(mockOai, 'custom'), 'gemini-4-carbon(high)');
  assert.equal(mockOai.custom_prompt_post_processing, 'merge');
  assert.equal(mockOai.preset_settings_openai, '砚台预设_珍藏版', '切换站子严禁篡改当前对话预设！');
  assert.equal(saveCalled, 1);

  // 再切到 Vertex AI Full 模式站子
  const vertexStation = normalizeApiStation({
    id: 'st_vertex_1',
    name: 'Google云',
    source: 'vertexai',
    model: 'gemini-2.5-pro-exp',
    vertexAuthMode: 'full',
    vertexRegion: 'global',
  });

  applyStationToHost(vertexStation, { getContext: () => mockCtx, doc: mockDoc });
  assert.equal(mockOai.chat_completion_source, 'vertexai');
  assert.equal(mockOai.vertexai_auth_mode, 'full');
  assert.equal(mockOai.vertexai_region, 'global');
  assert.equal(elementsById.model_vertexai_select.value, 'gemini-2.5-pro-exp');
  assert.equal(getHostModelForSource(mockOai, 'vertexai'), 'gemini-2.5-pro-exp');
  assert.equal(mockOai.preset_settings_openai, '砚台预设_珍藏版', '再次切换站子依然零触碰预设！');
});

test('api-backend: 酒馆 secrets 保险箱读写轮换、ConnectionManager 导入、模型拉取与伴侣助手副 API 解析', async () => {
  const calls = [];
  const mockSecretsStore = {
    api_key_custom: [{ id: 'sec-old', label: '老反代密钥', value: '...1111', active: true }],
    api_key_makersuite: [{ id: 'sec-gem', label: 'Gemini号', value: '...9999', active: true }],
  };

  const mockFetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), body });

    if (String(url).endsWith('api/secrets/read')) {
      return { ok: true, json: async () => structuredClone(mockSecretsStore) };
    }
    if (String(url).endsWith('api/secrets/write')) {
      const newId = 'sec-new-uuid';
      mockSecretsStore[body.key] = [
        ...(mockSecretsStore[body.key] || []).map(x => ({ ...x, active: false })),
        { id: newId, label: body.label, value: '...8888', active: true },
      ];
      return { ok: true, json: async () => ({ id: newId }) };
    }
    if (String(url).endsWith('api/secrets/rotate')) {
      for (const item of mockSecretsStore[body.key] || []) {
        item.active = item.id === body.id;
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (String(url).endsWith('api/backends/chat-completions/status')) {
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'claude-sonnet-4-6' }, { id: 'gemini-2.5-flash' }],
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const mockCtx = {
    getRequestHeaders: () => ({ 'X-CSRF-Token': 'mock-token' }),
    chatCompletionSettings: {
      chat_completion_source: 'custom',
      custom_url: 'https://one.example.com/v1',
      custom_model: 'gpt-4.1',
      custom_prompt_post_processing: 'semi',
      proxies: [{ name: '预设反代A', url: 'https://proxy-a.example.com/v1' }],
    },
    extensionSettings: {
      connectionManager: {
        profiles: [
          {
            id: 'p1',
            mode: 'cc',
            name: 'AI Studio 备用档',
            api: 'google', // 酒馆 SlashCommand 别名 -> makersuite
            proxy: '预设反代A',
            model: 'gemini-2.5-pro',
            'secret-id': 'sec-gem',
          },
          {
            id: 'p2_tc',
            mode: 'tc',
            name: 'Kobold 本地档',
            api: 'koboldcpp',
          },
        ],
      },
    },
  };

  const secretsMap = await readSecretsMap({ getContext: () => mockCtx, fetchImpl: mockFetch });
  const merged = mergeImportedStations({ existingStations: [], ctx: mockCtx, secretsMap });
  assert.equal(merged.stations.length, 2, '应导入当前连接 + ConnectionManager 里的 cc 档案（跳过 tc 档案）');
  assert.equal(merged.stations[0].secretId, 'sec-old');
  assert.equal(merged.stations[1].source, 'makersuite', 'google 别名应精准还原为 makersuite');
  assert.equal(merged.stations[1].url, 'https://proxy-a.example.com/v1');
  assert.equal(merged.stations[1].secretId, 'sec-gem');

  // 写入新密钥并校验状态与轮换
  const written = await writeStationSecret({
    key: 'api_key_custom',
    value: 'sk-brand-new-secret',
    label: '二号公益站',
    getContext: () => mockCtx,
    fetchImpl: mockFetch,
    syncNativeMemory: false,
  });
  assert.equal(written.id, 'sec-new-uuid');

  const updatedMap = await readSecretsMap({ getContext: () => mockCtx, fetchImpl: mockFetch });
  const secInfo = inspectStationSecretStatus(
    { source: 'custom', secretId: 'sec-new-uuid', name: '二号公益站' },
    updatedMap,
  );
  assert.equal(secInfo.bound, true);
  assert.equal(secInfo.valid, true);
  assert.equal(secInfo.active, true);
  assert.match(secInfo.statusText, /二号公益站/);

  const rotated = await rotateStationSecret({
    key: 'api_key_custom',
    id: 'sec-old',
    getContext: () => mockCtx,
    fetchImpl: mockFetch,
    syncNativeMemory: false,
  });
  assert.equal(rotated, true);

  // 拉取模型列表
  const pullRes = await fetchStationModels(merged.stations[0], {
    getContext: () => mockCtx,
    fetchImpl: mockFetch,
    doc: null,
  });
  assert.equal(pullRes.ok, true);
  assert.deepEqual(pullRes.models, ['claude-sonnet-4-6', 'gemini-2.5-flash']);

  // Vertex AI 静态模型兜底（不误调 400 /status）
  const vertexRes = await fetchStationModels(
    normalizeApiStation({ source: 'vertexai', name: 'Vertex' }),
    { getContext: () => mockCtx, fetchImpl: mockFetch, doc: null },
  );
  assert.equal(vertexRes.ok, true);
  assert.ok(vertexRes.models.includes('gemini-2.5-pro'));

  // 伴侣助手副 API 解析验证
  const store = createSettingsStore({ getContext: () => ({ extensionSettings: {} }) });
  store.update({
    apiStudio: {
      activeStationId: merged.stations[0].id,
      stations: merged.stations,
    },
    auxApi: {
      mode: 'station',
      stationId: merged.stations[1].id,
      model: 'gemini-2.5-flash',
    },
  });

  const auxResolved = resolveAuxApiChannel(store.get());
  assert.equal(auxResolved.mode, 'station');
  assert.equal(auxResolved.station.id, merged.stations[1].id);
  assert.equal(auxResolved.model, 'gemini-2.5-flash');

  store.update({ auxApi: { mode: 'follow_main' } });
  assert.equal(resolveAuxApiChannel(store.get()).mode, 'follow_main');
});

test('api-backend: 站子一键复制自动去重命名且数组隔离，保留加密 secretId 与收藏模型', () => {
  const origin = normalizeApiStation({
    id: 'st_origin',
    name: '主力公益站',
    source: 'custom',
    url: 'https://relay.example.com/v1',
    secretId: 'sec-shared-01',
    secretLabel: '主力令牌',
    model: 'claude-sonnet-4-6',
    favoriteModels: ['claude-sonnet-4-6', 'gemini-2.5-pro'],
    cachedModels: ['claude-sonnet-4-6', 'gemini-2.5-pro', 'gpt-4.1'],
    postProcessing: 'merge',
  });

  const copy1 = duplicateApiStation(origin, [origin]);
  assert.notEqual(copy1.id, origin.id);
  assert.equal(copy1.name, '主力公益站 · 副本');
  assert.equal(copy1.url, origin.url);
  assert.equal(copy1.secretId, 'sec-shared-01');
  assert.deepEqual(copy1.favoriteModels, origin.favoriteModels);
  assert.notEqual(copy1.favoriteModels, origin.favoriteModels, '收藏数组必须深拷贝防串改');

  // 对副本再次复制不会叠出「· 副本 · 副本」，而是递增序号
  const copy2 = duplicateApiStation(copy1, [origin, copy1]);
  assert.equal(copy2.name, '主力公益站 · 副本 2');
});

test('api-backend: 原生 reverse_proxy 反代密码槽位桥接 + 跨来源切换抵御原生清空 .model_custom_select', () => {
  const mockOai = {
    preset_settings_openai: '造卡工坊_V3',
    chat_completion_source: 'makersuite',
    reverse_proxy: '',
    proxy_password: '',
    proxies: [{ name: 'None', url: '', password: '' }],
    custom_url: '',
    custom_model: '',
    claude_model: '',
    google_model: 'gemini-2.5-pro',
  };

  let saveCount = 0;
  const mockCtx = {
    chatCompletionSettings: mockOai,
    saveSettingsDebounced() {
      saveCount += 1;
    },
  };

  const elements = {
    openai_reverse_proxy: { value: '', dispatchEvent() {} },
    openai_proxy_access_key: { value: '', dispatchEvent() {} },
    custom_api_url_text: { value: '', dispatchEvent() {} },
    custom_model_id: { value: '', dispatchEvent() {} },
    model_claude_select: {
      options: [{ value: 'claude-sonnet-4-6', textContent: 'claude-sonnet-4-6' }],
      value: 'claude-sonnet-4-6',
      appendChild(o) {
        this.options.push(o);
      },
      dispatchEvent() {},
    },
    model_custom_select: {
      options: [],
      _val: '',
      get value() {
        return this._val;
      },
      set value(v) {
        this._val = this.options.some(o => o.value === v) ? v : '';
      },
      appendChild(o) {
        this.options.push(o);
      },
      dispatchEvent() {},
    },
  };

  // 模拟酒馆原生 openai.js：当 #chat_completion_source 触发 change 切到 custom 时，
  // getStatusOpen() 会同步执行 $('.model_custom_select').empty() 清空下拉项！
  elements.chat_completion_source = {
    options: [
      { value: 'makersuite', textContent: 'makersuite' },
      { value: 'claude', textContent: 'claude' },
      { value: 'custom', textContent: 'custom' },
    ],
    value: 'makersuite',
    dispatchEvent(evt) {
      if (evt.type === 'change' && this.value === 'custom') {
        elements.model_custom_select.options = [];
        elements.model_custom_select._val = '';
      }
    },
  };

  const mockDoc = {
    getElementById: id => elements[id] || null,
    querySelector: sel => (sel.startsWith('#') ? elements[sel.slice(1)] || null : null),
    createElement: () => ({ value: '', textContent: '' }),
  };

  // 1. Claude 原生格式反代站子：同步反代密码到宿主 proxies（st_mate 卡片自身 0 明文！）
  const claudeProxyStation = normalizeApiStation({
    id: 'st_claude_proxy',
    name: 'Claude原生中转',
    source: 'claude',
    url: 'https://anthropic-relay.example.com',
    model: 'claude-sonnet-4-6',
  });
  assert.equal('password' in claudeProxyStation, false);
  syncReverseProxyCredentialToHost(claudeProxyStation, 'sk-ant-proxy-999', {
    getContext: () => mockCtx,
    doc: mockDoc,
  });
  assert.equal(mockOai.proxy_password, 'sk-ant-proxy-999');
  assert.ok(
    mockOai.proxies.some(
      p => p.name === buildHostProxyPresetName('st_claude_proxy') && p.password === 'sk-ant-proxy-999',
    ),
  );

  // 2. 切换到 AI Studio 官方直连站子（url 为空）：reverse_proxy 必须清空，确保酒馆后端读 secrets.json！
  const geminiDirectStation = normalizeApiStation({
    id: 'st_gem_direct',
    name: 'Gemini直连',
    source: 'makersuite',
    url: '',
    model: 'gemini-2.5-pro',
  });
  applyStationToHost(geminiDirectStation, { getContext: () => mockCtx, doc: mockDoc });
  assert.equal(mockOai.reverse_proxy, '');

  // 3. 再切回 Claude 原生格式反代站子：reverse_proxy 与专属 proxy_password 自动双双恢复！
  mockOai.proxy_password = 'stale-other-password';
  applyStationToHost(claudeProxyStation, { getContext: () => mockCtx, doc: mockDoc });
  assert.equal(mockOai.reverse_proxy, 'https://anthropic-relay.example.com');
  assert.equal(mockOai.proxy_password, 'sk-ant-proxy-999');
  assert.equal(elements.openai_proxy_access_key.value, 'sk-ant-proxy-999');

  // 4. 跨来源切至 Custom 站子（即使原生 #chat_completion_source change 清空了 .model_custom_select，模型与地址依然 100% 保留！）
  const customStation = normalizeApiStation({
    id: 'st_custom_2',
    name: '二号反代',
    source: 'custom',
    url: 'https://two.example.com/v1',
    model: 'deepseek-r1-0528',
  });
  applyStationToHost(customStation, { getContext: () => mockCtx, doc: mockDoc });
  assert.equal(mockOai.chat_completion_source, 'custom');
  assert.equal(mockOai.custom_url, 'https://two.example.com/v1');
  assert.equal(mockOai.custom_model, 'deepseek-r1-0528');
  assert.equal(elements.model_custom_select.value, 'deepseek-r1-0528');
  assert.equal(mockOai.preset_settings_openai, '造卡工坊_V3', '全程零触碰对话预设');
  assert.ok(saveCount > 0);
});

test('api-backend: testStationChatReply 真实请求测活覆盖成功预览、401/404(/v1提示)/429 与采样参数兼容', async () => {
  // 校验特殊模型自动剔除 temperature 参数
  const claude5Body = buildProbeGenerateBody(
    normalizeApiStation({ source: 'custom', url: 'https://x.com/v1', model: 'anthropic/claude-opus-5' }),
  );
  assert.equal('temperature' in claude5Body, false);

  const normalBody = buildProbeGenerateBody(
    normalizeApiStation({ source: 'minimax', model: 'MiniMax-M2.5' }),
  );
  assert.equal(normalBody.temperature, 1);
  assert.equal(normalBody.stream, false);
  assert.equal(normalBody.type, 'quiet');

  // 缺模型名前置拦截
  const missingModelRes = await testStationChatReply(
    normalizeApiStation({ source: 'custom', url: 'https://x.com/v1', model: '' }),
  );
  assert.equal(missingModelRes.ok, false);
  assert.match(missingModelRes.message, /模型名称/);

  // 模拟 200 成功响应
  const okStation = normalizeApiStation({
    source: 'custom',
    url: 'https://api.good.com/v1',
    secretId: 'sec-1',
    model: 'claude-sonnet-4-6',
  });
  const okRes = await testStationChatReply(okStation, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'OK!' } }] }),
    }),
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.replyPreview, 'OK!');
  assert.match(okRes.message, /测活通过/);

  // 模拟 404 且 URL 漏了 /v1：智能提示补全 /v1
  const noV1Station = normalizeApiStation({
    source: 'custom',
    url: 'https://api.missing-v1.com',
    model: 'gpt-4o',
  });
  const res404 = await testStationChatReply(noV1Station, {
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: { message: 'Not Found' } }),
    }),
  });
  assert.equal(res404.ok, false);
  assert.match(res404.message, /补全 \/v1/);

  // 模拟 401 密钥无效与 429 额度受限
  const res401 = await testStationChatReply(okStation, {
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Invalid token' } }),
    }),
  });
  assert.equal(res401.ok, false);
  assert.match(res401.message, /401/);

  const res429 = await testStationChatReply(okStation, {
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: 'Quota exceeded' } }),
    }),
  });
  assert.equal(res429.ok, false);
  assert.match(res429.message, /429/);
});

test('preset-backend: 全局默认预设 + 角色稳定唯一键 (char:<avatar> / group:<id>) 绑定优先级与切卡无感秒切', async () => {
  // 1. 稳定唯一键校验：改角色显示名或同名不同卡均不串台
  const charPeiV1 = { name: '裴敬之', avatar: '裴敬之.png' };
  const charPeiRenamed = { name: '裴大人（黑化线）', avatar: '裴敬之.png' };
  const charDuplicateName = { name: '裴敬之', avatar: '裴敬之_IF线.png' };
  assert.equal(getEntityBindingKey(charPeiV1), 'char:裴敬之.png');
  assert.equal(getEntityBindingKey(charPeiRenamed), 'char:裴敬之.png', '修改显示名不应破坏绑定键');
  assert.equal(getEntityBindingKey(charDuplicateName), 'char:裴敬之_IF线.png', '重名不同卡严格区分');
  assert.equal(
    getEntityBindingKey({ groupId: 'grp_court_01', characterId: 0, characters: [charPeiV1] }),
    'group:grp_court_01',
    '群聊优先使用 group:<groupId>',
  );

  // 2. 归一化过滤非法键与 gui
  const dirtyPs = normalizePresetStudio({
    defaultPreset: '  【11.8大更】砚台预设V2.0.json  ',
    charBindings: {
      'char:造卡工坊.png': '造卡工坊专用预设.json',
      'invalid_key_no_prefix': '某预设',
      'char:empty.png': 'gui',
    },
    archivedPresets: ['造卡工坊专用预设', '旧版测试预设', 'gui', '旧版测试预设'],
  });
  assert.equal(dirtyPs.defaultPreset, '【11.8大更】砚台预设V2.0');
  assert.deepEqual(dirtyPs.charBindings, { 'char:造卡工坊.png': '造卡工坊专用预设' });
  assert.deepEqual(dirtyPs.archivedPresets, ['造卡工坊专用预设', '旧版测试预设']);

  const available = ['【11.8大更】砚台预设V2.0', '造卡工坊专用预设', '清水日常预设'];

  // 3. 即使「造卡工坊专用预设」已被收进预设仓库 (archivedPresets)，进入绑定了它的角色卡依然 100% 优先命中！
  const resWorkshop = resolveTargetPresetForEntity(
    dirtyPs,
    { characterId: 0, characters: [{ name: '砚台造卡工坊', avatar: '造卡工坊.png' }] },
    available,
  );
  assert.equal(resWorkshop.source, 'bound');
  assert.equal(resWorkshop.targetPreset, '造卡工坊专用预设');

  // 4. 未绑专属预设的普通角色卡自动跟随全局默认预设
  const resNormalChar = resolveTargetPresetForEntity(
    dirtyPs,
    { characterId: 0, characters: [charPeiV1] },
    available,
  );
  assert.equal(resNormalChar.source, 'default');
  assert.equal(resNormalChar.targetPreset, '【11.8大更】砚台预设V2.0');

  // 5. 若某角色原绑预设已被删除，标记 boundMissing 并平滑回退至全局默认预设
  const withMissingPs = setBoundPresetForEntity(dirtyPs, charPeiV1, '已被删除的古早预设');
  const resFallback = resolveTargetPresetForEntity(withMissingPs, charPeiV1, available);
  assert.equal(resFallback.boundMissing, true);
  assert.equal(resFallback.source, 'default');
  assert.equal(resFallback.targetPreset, '【11.8大更】砚台预设V2.0');

  // 6. 切卡自动切预设引擎 syncPresetForActiveChat：强制关闭 bind_preset_to_connection 防冲掉 API 连接，且目标已选中时零开销跳过
  let selectedOptionVal = '0';
  let selectCalls = 0;
  const presetMap = {
    '【11.8大更】砚台预设V2.0': '0',
    '造卡工坊专用预设': '1',
  };
  const reverseMap = { '0': '【11.8大更】砚台预设V2.0', '1': '造卡工坊专用预设' };

  const mockOai = {
    bind_preset_to_connection: true, // 酒馆原生默认是危险的 true
    chat_completion_source: 'custom',
    custom_url: 'https://my-station.example.com/v1',
    preset_settings_openai: '【11.8大更】砚台预设V2.0',
  };

  const mockCtx = {
    mainApi: 'openai',
    characterId: 0,
    groupId: null,
    characters: [
      { name: '砚台造卡工坊', avatar: '造卡工坊.png' },
      { name: '裴敬之', avatar: '裴敬之.png' },
    ],
    chatCompletionSettings: mockOai,
    extensionSettings: { st_mate: { presetStudio: dirtyPs } },
    getPresetManager: () => ({
      getAllPresets: () => Object.keys(presetMap),
      findPreset: name => presetMap[name],
      getSelectedPreset: () => selectedOptionVal,
      getSelectedPresetName: () => reverseMap[selectedOptionVal],
      async selectPreset(val) {
        selectCalls += 1;
        selectedOptionVal = String(val);
        mockOai.preset_settings_openai = reverseMap[selectedOptionVal];
      },
    }),
  };

  const store = createSettingsStore({ getContext: () => mockCtx });
  const bindCheckbox = { checked: true };
  const mockDoc = {
    getElementById: id => (id === 'bind_preset_to_connection' ? bindCheckbox : null),
  };

  // 进入第 0 张卡（造卡工坊）-> 自动从默认预设切至「造卡工坊专用预设」
  const sync1 = await syncPresetForActiveChat({ getContext: () => mockCtx, store, doc: mockDoc });
  assert.equal(sync1.switched, true);
  assert.equal(sync1.presetName, '造卡工坊专用预设');
  assert.equal(mockOai.bind_preset_to_connection, false, '切换前必须关闭 bind_preset_to_connection 保护 API 站子连接');
  assert.equal(bindCheckbox.checked, false);
  assert.equal(selectCalls, 1);

  // 重复在同一张卡触发 -> 幂等静默跳过，0 次额外调用
  const sync2 = await syncPresetForActiveChat({ getContext: () => mockCtx, store, doc: mockDoc });
  assert.equal(sync2.switched, false);
  assert.equal(sync2.skipped, true);
  assert.equal(selectCalls, 1);

  // 切到第 1 张卡（裴敬之，未绑专属预设）-> 自动切回全局默认「【11.8大更】砚台预设V2.0」
  mockCtx.characterId = 1;
  const sync3 = await syncPresetForActiveChat({ getContext: () => mockCtx, store, doc: mockDoc });
  assert.equal(sync3.switched, true);
  assert.equal(sync3.source, 'default');
  assert.equal(sync3.presetName, '【11.8大更】砚台预设V2.0');
  assert.equal(selectCalls, 2);
});

test('preset-backend: 一对多角色卡批量转移绑定、常用与仓库分流、重命名不断链与防误删保护', async () => {
  let ps = normalizePresetStudio({
    defaultPreset: '主力文风预设',
    charBindings: {
      'char:A.png': '古风预设',
      'char:B.png': '现代预设',
      'char:C.png': '现代预设',
    },
    archivedPresets: ['备用冷宫预设'],
  });

  // 1. 在「古风预设」的一对多绑卡面板中勾选 A 和 B（B 原本绑在现代预设 -> 自动转移到古风预设；C 保持现代预设不变）
  ps = setEntitiesBoundToPreset(ps, '古风预设', ['char:A.png', 'char:B.png']);
  assert.equal(getBoundPresetForEntity(ps, 'char:A.png'), '古风预设');
  assert.equal(getBoundPresetForEntity(ps, 'char:B.png'), '古风预设', '勾选原绑其他预设的角色应平滑转移');
  assert.equal(getBoundPresetForEntity(ps, 'char:C.png'), '现代预设', '未触碰的其他预设绑定保持不变');

  // 取消勾选 A -> A 自动解除绑定回退全局默认
  ps = setEntitiesBoundToPreset(ps, '古风预设', ['char:B.png']);
  assert.equal(getBoundPresetForEntity(ps, 'char:A.png'), '');

  const boundToAncient = getEntitiesBoundToPreset(ps, '古风预设', {
    characters: [
      { name: '阿甲', avatar: 'A.png' },
      { name: '阿乙', avatar: 'B.png' },
    ],
  });
  assert.equal(boundToAncient.length, 1);
  assert.equal(boundToAncient[0].name, '阿乙');

  // 角色列表搜索过滤
  const bindable = listBindableEntities(
    {
      characters: [
        { name: '沈清秋', avatar: 'sqq.png' },
        { name: '裴敬之', avatar: 'pjz.png' },
      ],
      groups: [{ id: 'g1', name: '群芳宴' }],
    },
    { presetStudio: ps, query: '裴' },
  );
  assert.equal(bindable.length, 1);
  assert.equal(bindable[0].key, 'char:pjz.png');

  // 2. 常用预设与预设仓库分流 + 搜索不丢总计数
  ps = toggleArchivePreset(ps, '现代预设', true);
  const part = partitionPresetsByArchive(
    ['gui', '主力文风预设', '古风预设', '现代预设', '备用冷宫预设'],
    ps,
    { activePresetName: '主力文风预设', query: '古风' },
  );
  assert.equal(part.totalCommonCount, 2, '常用总计应为 主力文风预设 + 古风预设（自动剔除 gui）');
  assert.equal(part.totalArchivedCount, 2, '仓库总计应为 现代预设 + 备用冷宫预设');
  assert.equal(part.commonPresets.length, 1);
  assert.equal(part.commonPresets[0].name, '古风预设');
  assert.equal(part.commonPresets[0].boundCount, 1);

  // 3. 重命名预设引用无损联动（defaultPreset + charBindings + archivedPresets 同步换名）
  ps = setDefaultPresetName(ps, '现代预设');
  const renamedPs = renamePresetReferences(ps, '现代预设', '现代都市预设_V2');
  assert.equal(renamedPs.defaultPreset, '现代都市预设_V2');
  assert.equal(renamedPs.charBindings['char:C.png'], '现代都市预设_V2');
  assert.ok(renamedPs.archivedPresets.includes('现代都市预设_V2'));
  assert.ok(!renamedPs.archivedPresets.includes('现代预设'));

  // 4. 真实调用 renameHostPreset 与 deleteHostPreset（含防误删保护与残留清理）
  const apiCalls = [];
  const selectOptions = [
    { value: '0', textContent: '现代都市预设_V2', selected: true, remove() {} },
    { value: '1', textContent: '备用冷宫预设', selected: false, remove() {} },
  ];
  const mockSelect = {
    value: '0',
    options: selectOptions,
    get selectedOptions() {
      return this.options.filter(o => o.selected);
    },
    appendChild(opt) {
      this.options.push(opt);
    },
    dispatchEvent() {},
  };
  const mockDoc = {
    getElementById: id => (id === 'settings_preset_openai' ? mockSelect : null),
    createElement: () => ({ value: '', textContent: '', selected: false }),
  };
  const mockCtx = {
    chatCompletionSettings: {
      preset_settings_openai: '现代都市预设_V2',
      temp_openai: 0.95,
      openai_max_context: 65536,
      openai_max_tokens: 4096,
      prompts: [],
      prompt_order: [],
    },
    extensionSettings: { st_mate: { presetStudio: renamedPs } },
    saveSettingsDebounced() {},
  };
  const store = createSettingsStore({ getContext: () => mockCtx });

  const mockFetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    apiCalls.push({ url: String(url), body });
    return { ok: true, json: async () => ({ name: body.name }) };
  };

  // 防误删：禁止删除当前正在使用的预设
  const delActiveRes = await deleteHostPreset({
    presetName: '现代都市预设_V2',
    store,
    getContext: () => mockCtx,
    fetchImpl: mockFetch,
    doc: mockDoc,
  });
  assert.equal(delActiveRes.ok, false);
  assert.equal(delActiveRes.reason, 'active_preset');

  // 允许安全删除非活跃的「备用冷宫预设」，并清理 archivedPresets 残留
  const delArchivedRes = await deleteHostPreset({
    presetName: '备用冷宫预设',
    store,
    getContext: () => mockCtx,
    fetchImpl: mockFetch,
    doc: mockDoc,
  });
  assert.equal(delArchivedRes.ok, true);
  assert.equal(store.get().presetStudio.archivedPresets.includes('备用冷宫预设'), false);

  // 现在只剩最后 1 套预设 -> 防误删保护禁止删光唯一预设
  const delLastRes = await deleteHostPreset({
    presetName: '现代都市预设_V2',
    store,
    getContext: () => mockCtx,
    fetchImpl: mockFetch,
    doc: mockDoc,
  });
  assert.equal(delLastRes.ok, false);
  assert.equal(delLastRes.reason, 'last_preset');

  // 重命名当前唯一预设 -> 后端先 save 新名再 delete 旧名，store 绑定引用同步更新
  const renameRes = await renameHostPreset({
    oldName: '现代都市预设_V2',
    newName: '现代都市预设_终极版',
    store,
    getContext: () => mockCtx,
    fetchImpl: mockFetch,
    doc: mockDoc,
  });
  assert.equal(renameRes.ok, true);
  assert.equal(store.get().presetStudio.defaultPreset, '现代都市预设_终极版');
  assert.equal(store.get().presetStudio.charBindings['char:C.png'], '现代都市预设_终极版');
  assert.ok(apiCalls.some(c => c.url.endsWith('api/presets/save') && c.body.name === '现代都市预设_终极版'));
  assert.ok(apiCalls.some(c => c.url.endsWith('api/presets/delete') && c.body.name === '现代都市预设_V2'));

  // 另存副本测试
  const dupRes = await duplicateHostPreset('现代都市预设_终极版', {
    getContext: () => mockCtx,
    fetchImpl: mockFetch,
    doc: mockDoc,
    selectDuplicate: false,
  });
  assert.equal(dupRes.ok, true);
  assert.equal(dupRes.name, '现代都市预设_终极版 · 副本');

  // cleanupDeletedPresetReferences 独立纯函数验证
  const cleaned = cleanupDeletedPresetReferences(store.get().presetStudio, '现代都市预设_终极版');
  assert.equal(cleaned.defaultPreset, '');
  assert.equal('char:C.png' in cleaned.charBindings, false);
});

test('preset-backend: 导入脱敏防污染、角色卡误导拦截、纯净导出与第 3 单快照捕获/回滚', async () => {
  // 1. 外部预设夹带反代地址与密钥时自动剥离，且 temp_openai 兼容转为标准 temperature
  const dirtyExternalJson = JSON.stringify({
    temp_openai: 1.12,
    openai_max_context: 128000,
    openai_max_tokens: 8192,
    reverse_proxy: 'https://evil-stealer.example.com/v1',
    proxy_password: 'sk-leaked-other-user-key',
    custom_url: 'https://override-my-url.example.com/v1',
    api_key: 'sk-should-strip',
    proxies: [{ name: 'bad', password: '123' }],
    prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'Stay in character.' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  });

  const importedClean = sanitizePresetForImport(dirtyExternalJson, '外部大佬分享预设.json');
  assert.equal(importedClean.name, '外部大佬分享预设');
  assert.equal(importedClean.preset.temperature, 1.12);
  assert.equal('temp_openai' in importedClean.preset, false);
  assert.equal('reverse_proxy' in importedClean.preset, false, '外部反代地址必须彻底剥离防篡改连接');
  assert.equal('proxy_password' in importedClean.preset, false, '外部反代密码必须彻底剥离防污染');
  assert.equal('custom_url' in importedClean.preset, false);
  assert.equal('api_key' in importedClean.preset, false);
  assert.equal('proxies' in importedClean.preset, false);

  // 2. 误传角色卡 JSON 或世界书 JSON 时给出友好中文报错拦截
  assert.throws(
    () => sanitizePresetForImport(JSON.stringify({ spec: 'chara_card_v2', data: { name: '裴敬之' } }), '裴敬之.json'),
    /不是有效的酒馆对话预设/,
  );
  assert.throws(
    () => sanitizePresetForImport(JSON.stringify({ entries: { 0: { comment: '世界书' } } }), '世界书.json'),
    /不是有效的酒馆对话预设/,
  );

  // 3. 重名安全递增与批量导入容错
  assert.equal(resolveUniquePresetName('砚台预设', ['砚台预设'], '导入'), '砚台预设 · 导入');
  assert.equal(
    resolveUniquePresetName('砚台预设', ['砚台预设', '砚台预设 · 导入'], '导入'),
    '砚台预设 · 导入 2',
  );

  const savedBodies = [];
  const mockSelect = {
    value: '0',
    options: [{ value: '0', textContent: '砚台预设', selected: true }],
    appendChild(opt) {
      this.options.push(opt);
    },
    dispatchEvent() {},
  };
  const mockDoc = {
    getElementById: id => (id === 'settings_preset_openai' ? mockSelect : null),
    createElement: () => ({ value: '', textContent: '', selected: false }),
  };
  const mockCtx = {
    chatCompletionSettings: {
      preset_settings_openai: '砚台预设',
      temp_openai: 0.88,
      openai_max_context: 65536,
      openai_max_tokens: 4096,
      reverse_proxy: 'https://my-private-proxy.com/v1',
      proxy_password: 'my-secret-password',
      prompts: [{ identifier: 'main', name: '主提示词', role: 'system', content: '原始正文' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    },
    saveSettingsDebounced() {},
  };
  const mockFetch = async (_url, init) => {
    const parsed = JSON.parse(init.body);
    savedBodies.push(parsed);
    return { ok: true, json: async () => ({ name: parsed.name }) };
  };

  const batchRes = await importPresetItems(
    [
      { name: '砚台预设.json', content: dirtyExternalJson },
      { name: '坏文件.json', content: '{bad json' },
    ],
    { getContext: () => mockCtx, fetchImpl: mockFetch, doc: mockDoc },
  );
  assert.deepEqual(batchRes.imported, ['砚台预设 · 导入']);
  assert.equal(batchRes.failed.length, 1);

  // 4. 导出当前预设：自动剔除本地反代密码与反代地址
  const exported = exportPresetToJsonString('砚台预设', { getContext: () => mockCtx, doc: mockDoc });
  const exportedObj = JSON.parse(exported.jsonText);
  assert.equal(exported.fileName, '砚台预设.json');
  assert.equal(exportedObj.temperature, 0.88);
  assert.equal('reverse_proxy' in exportedObj, false);
  assert.equal('proxy_password' in exportedObj, false);

  // 5. 第 3 单预留接口验证：捕获快照 -> 破坏性修改参数和提示词 -> 一键从快照完整回滚并落盘
  const snap = captureCurrentPresetSnapshot({ getContext: () => mockCtx, doc: mockDoc });
  assert.equal(snap.presetName, '砚台预设');
  assert.equal(snap.payload.temperature, 0.88);

  mockCtx.chatCompletionSettings.temp_openai = 1.95;
  mockCtx.chatCompletionSettings.prompts[0].content = '被助手临时改乱的提示词';

  const restoreRes = await applyPresetSnapshotToHost(snap, {
    getContext: () => mockCtx,
    persistToFile: true,
    fetchImpl: mockFetch,
    doc: mockDoc,
  });
  assert.equal(restoreRes.ok, true);
  assert.equal(mockCtx.chatCompletionSettings.temp_openai, 0.88);
  assert.equal(mockCtx.chatCompletionSettings.prompts[0].content, '原始正文');
  assert.equal(savedBodies.at(-1).preset.prompts[0].content, '原始正文');
});

test('preset-backend: 上下文高上限自动解锁 & 提示词条目 (prompts + prompt_order) 读写/搜索/开关/排序/增删改', () => {
  // 1. 当调高上下文至 1M (1000000) 超过原生锁定上限 (32767) 时，自动解锁 max_context_unlocked 并扩容原生滑杆 max
  const mockContextInput = {
    max: '32767',
    _val: '32767',
    getAttribute(attr) {
      return attr === 'max' ? this.max : null;
    },
    setAttribute(attr, v) {
      if (attr === 'max') this.max = String(v);
    },
    get value() {
      return this._val;
    },
    set value(v) {
      // 模拟真实浏览器 <input type="range">：若未先调大 max，直接设 value 会被截断为 max！
      const clamped = Math.min(Number(this.max), Number(v));
      this._val = String(clamped);
    },
    dispatchEvent() {},
  };
  const mockUnlockCheck = { checked: false };
  const mockDoc = {
    getElementById: id => {
      if (id === 'openai_max_context') return mockContextInput;
      if (id === 'oai_max_context_unlocked') return mockUnlockCheck;
      return null;
    },
  };

  const oai = {
    max_context_unlocked: false,
    openai_max_context: 32767,
    openai_max_tokens: 4096,
    temp_openai: 1.0,
    prompts: [
      { identifier: 'main', name: '主系统设定', role: 'system', system_prompt: true, marker: false, content: '你是文笔细腻的叙事者。' },
      { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
      { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
      { identifier: 'jailbreak', name: 'Post-History', role: 'system', system_prompt: true, marker: false, content: '推进剧情。' },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'jailbreak', enabled: false },
        ],
      },
    ],
  };

  const mockCtx = { chatCompletionSettings: oai, saveSettingsDebounced() {} };
  const afterParams = applyGenerationParams(
    { maxContext: 1000000, maxTokens: 16384, temperature: 0.85 },
    { getContext: () => mockCtx, doc: mockDoc },
  );
  assert.equal(afterParams.maxContext, 1000000);
  assert.equal(oai.max_context_unlocked, true, '超过锁定上限必须自动开启 max_context_unlocked');
  assert.equal(mockUnlockCheck.checked, true);
  assert.equal(mockContextInput.value, '1000000', '必须先扩展原生滑杆 max 再赋值，绝不被截断回 32767');
  assert.equal(readGenerationParams(mockCtx).maxTokens, 16384);
  assert.equal(readGenerationParams(mockCtx).temperature, 0.85);

  // 2. 按 dummyId 100001 读取真实发送顺序与统计
  const initialRead = readOrderedPromptEntries(oai);
  assert.equal(initialRead.totalCount, 4);
  assert.equal(initialRead.enabledCount, 3);
  assert.equal(initialRead.markerCount, 2);
  assert.equal(initialRead.entries[1].isMarker, true);
  assert.match(initialRead.entries[1].markerHint, /角色描述/);
  assert.equal(initialRead.entries[0].canDelete, false, '内置 main 条目禁止物理删除');

  // 3. 新增自定义条目（支持 @D 深度注入）+ 编辑 + 过滤搜索
  const created = createCustomPromptEntry(oai, {
    name: '文风防油腻守则',
    role: 'system',
    content: '严禁霸总语录与扇形统计图。',
    injectionPosition: 1,
    injectionDepth: 2,
  });
  assert.ok(created?.identifier);

  const afterAdd = readOrderedPromptEntries(oai);
  assert.equal(afterAdd.totalCount, 5);
  assert.equal(afterAdd.enabledCount, 4);
  const customEntry = afterAdd.entries.find(e => e.identifier === created.identifier);
  assert.equal(customEntry.canDelete, true, '用户自建条目允许删除');
  assert.equal(customEntry.injectionPosition, 1);
  assert.equal(customEntry.injectionDepth, 2);

  // 搜索正文关键词 + 隐藏系统槽过滤
  assert.equal(filterPromptEntries(afterAdd.entries, { query: '扇形统计图' }).length, 1);
  assert.equal(filterPromptEntries(afterAdd.entries, { filterMode: 'hide_markers' }).length, 3);
  assert.equal(filterPromptEntries(afterAdd.entries, { filterMode: 'enabled' }).length, 4);

  // 4. 开关切换与上下调序
  const toggled = togglePromptEntryEnabled(oai, 'jailbreak');
  assert.equal(toggled, true);
  assert.equal(readOrderedPromptEntries(oai).enabledCount, 5);

  // 将末尾的自建条目上移一位（移到 jailbreak 之前）
  assert.equal(movePromptEntryOrder(oai, created.identifier, 'up'), true);
  const reorderedIds = readOrderedPromptEntries(oai).entries.map(e => e.identifier);
  assert.equal(reorderedIds[3], created.identifier);
  assert.equal(reorderedIds[4], 'jailbreak');

  // 5. 编辑普通条目成功，但尝试修改 marker:true 系统占位槽正文被安全拦截
  const markerEdit = updatePromptEntryFields(oai, 'charDescription', { content: '误改坏系统槽' });
  assert.equal(markerEdit.ok, false);
  assert.equal(markerEdit.reason, 'marker_protected');

  const normalEdit = updatePromptEntryFields(oai, created.identifier, {
    name: '清冷叙事守则',
    role: 'user',
    content: '保持留白与克制。',
  });
  assert.equal(normalEdit.ok, true);
  assert.equal(oai.prompts.find(p => p.identifier === created.identifier).role, 'user');

  // 6. 删除保护：系统核心内置条目 main 严禁删除；用户自建条目可安全删除并自动清理 prompt_order 引用
  const delMain = deleteCustomPromptEntry(oai, 'main');
  assert.equal(delMain.ok, false);
  assert.equal(delMain.reason, 'system_protected');

  const delCustom = deleteCustomPromptEntry(oai, created.identifier);
  assert.equal(delCustom.ok, true);
  assert.equal(readOrderedPromptEntries(oai).totalCount, 4);
  assert.equal(oai.prompt_order[0].order.some(x => x.identifier === created.identifier), false);
});

test('preset-backend race guard: 改完预设 A 后 100ms 内切至预设 B，防抖队列严格落盘预设 A 快照且绝不串写覆盖预设 B', async () => {
  const diskStore = {
    预设A: {
      temperature: 0.8,
      prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: '预设A旧正文' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    },
    预设B: {
      temperature: 1.25,
      prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: '预设B珍贵正文' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    },
  };

  const openaiSettingsArr = [structuredClone(diskStore.预设A), structuredClone(diskStore.预设B)];
  const openaiSettingNames = { 预设A: 0, 预设B: 1 };

  const selectOptions = [
    { value: '0', textContent: '预设A', selected: true },
    { value: '1', textContent: '预设B', selected: false },
  ];
  const mockSelect = {
    value: '0',
    options: selectOptions,
    get selectedOptions() {
      return this.options.filter(o => o.selected);
    },
  };
  const mockDoc = {
    getElementById: id => (id === 'settings_preset_openai' ? mockSelect : null),
  };

  const mockCtx = {
    chatCompletionSettings: {
      preset_settings_openai: '预设A',
      temp_openai: 0.8,
      prompts: structuredClone(diskStore.预设A.prompts),
      prompt_order: structuredClone(diskStore.预设A.prompt_order),
    },
    getPresetManager: () => ({
      apiId: 'openai',
      getPresetList: () => ({ presets: openaiSettingsArr, preset_names: openaiSettingNames }),
    }),
  };

  const persistedCalls = [];
  const autoSaver = createPresetAutoSaver({
    debounceMs: 350,
    captureSnapshot: () => captureCurrentPresetSnapshot({ getContext: () => mockCtx, doc: mockDoc }),
    persistSnapshot: async (presetName, payload) => {
      // 模拟网络延迟 25ms，验证 inFlightChain 串行等待保护
      await new Promise(r => setTimeout(r, 25));
      persistedCalls.push({ presetName, payload: structuredClone(payload) });
      diskStore[presetName] = structuredClone(payload);
      return saveHostPreset(presetName, payload, {
        getContext: () => mockCtx,
        doc: mockDoc,
        fetchImpl: async (_url, init) => {
          const parsed = JSON.parse(init.body);
          return { ok: true, json: async () => ({ name: parsed.name }) };
        },
        updateDropdown: false,
        selectSaved: false,
      });
    },
  });

  // 1. 用户在「预设A」修改了 main 条目正文，触发 350ms 防抖
  mockCtx.chatCompletionSettings.prompts[0].content = '预设A新改好的正文';
  mockCtx.chatCompletionSettings.temp_openai = 0.92;
  autoSaver.schedule();
  assert.equal(autoSaver.getPendingPresetName(), '预设A');
  assert.equal(persistedCalls.length, 0, '350ms 未到时尚未发请求');

  // 2. 仅过 50ms，模拟宿主已被切到「预设B」（即使外部提前把 select 和 oai_settings 换成了预设B，快照也已绑定预设A！）
  await new Promise(r => setTimeout(r, 50));
  selectOptions[0].selected = false;
  selectOptions[1].selected = true;
  mockSelect.value = '1';
  mockCtx.chatCompletionSettings.preset_settings_openai = '预设B';
  mockCtx.chatCompletionSettings.temp_openai = 1.25;
  mockCtx.chatCompletionSettings.prompts = structuredClone(diskStore.预设B.prompts);

  // 3. 执行切预设前的 flush()：必须落盘到「预设A」，且「预设B」丝毫无损！
  await autoSaver.flush();

  assert.equal(persistedCalls.length, 1);
  assert.equal(persistedCalls[0].presetName, '预设A', '落盘目标必须严格锁定修改时刻的预设A');
  assert.equal(diskStore.预设A.prompts[0].content, '预设A新改好的正文');
  assert.equal(diskStore.预设A.temperature, 0.92);
  assert.equal(openaiSettingsArr[0].prompts[0].content, '预设A新改好的正文', '宿主内存槽位 0 同步更新');
  assert.equal(diskStore.预设B.prompts[0].content, '预设B珍贵正文', '预设B绝不被预设A的内容串写覆盖');
  assert.equal(openaiSettingsArr[1].prompts[0].content, '预设B珍贵正文');
});

test('preset-backend host sync: 桥接真实 promptManager 清理 tokenHandler 缓存，且批量导入不误切当前激活预设', async () => {
  const tokenCounts = { main: 128, custom_1: 64 };
  let renderCalls = 0;
  let sanitizeCalls = 0;
  let clearFormCalls = 0;
  const quickEdits = {};

  const mockOpenAiMod = {
    openai_settings: [
      {
        temperature: 0.9,
        prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'Init' }],
        prompt_order: [{ character_id: 777, order: [{ identifier: 'main', enabled: true }] }],
      },
    ],
    openai_setting_names: { 主力预设: 0 },
    promptManager: {
      activeCharacter: { id: 777 },
      tokenHandler: {
        getCounts: () => tokenCounts,
        resetCounts: () => {
          for (const k of Object.keys(tokenCounts)) delete tokenCounts[k];
        },
      },
      updateQuickEdit: (id, prompt) => {
        quickEdits[id] = prompt.content;
      },
      sanitizeServiceSettings: () => {
        sanitizeCalls += 1;
      },
      hidePopup: () => {},
      clearEditForm: () => {
        clearFormCalls += 1;
      },
      render: () => {
        renderCalls += 1;
      },
    },
  };

  await primeHostOpenAiModule({ openAiModule: mockOpenAiMod });

  const oai = {
    preset_settings_openai: '主力预设',
    temp_openai: 0.9,
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', system_prompt: true, content: '新主设定' },
    ],
    prompt_order: [
      { character_id: 100001, order: [{ identifier: 'main', enabled: false }] },
      { character_id: 777, order: [{ identifier: 'main', enabled: true }] },
    ],
  };

  // 1. 未显式传 promptManager 时，自动读取已桥接的宿主 promptManager.activeCharacter (777)
  const ordered = readOrderedPromptEntries(oai);
  assert.equal(ordered.characterId, 777);
  assert.equal(ordered.entries[0].enabled, true);

  let saveDebouncedCount = 0;
  const mockCtx = {
    chatCompletionSettings: oai,
    saveSettingsDebounced: () => {
      saveDebouncedCount += 1;
    },
    getPresetManager: () => ({
      apiId: 'openai',
      getPresetList: () => ({
        presets: mockOpenAiMod.openai_settings,
        preset_names: mockOpenAiMod.openai_setting_names,
      }),
      // 若误调原生 updateList 会强行切换预设，此处埋雷断言绝不被调用！
      updateList: () => {
        throw new Error('批量静默导入严禁调用会强制切走当前预设的原生 pm.updateList！');
      },
    }),
  };

  // 2. 同步修改 main 条目：tokenCounts.main 立即置 null，quickEdit 立即更新，结构变更触发 sanitize
  await syncHostPromptManagerAndSettings({
    getContext: () => mockCtx,
    changedPromptId: 'main',
    immediateRender: true,
    structuralChange: true,
  });
  assert.equal(tokenCounts.main, null, '修改条目后必须清除 tokenHandler 旧 Token 计数缓存');
  assert.equal(tokenCounts.custom_1, 64, '未修改条目的 Token 缓存保持不变');
  assert.equal(quickEdits.main, '新主设定');
  assert.equal(sanitizeCalls, 1);
  assert.equal(clearFormCalls, 1);
  assert.equal(renderCalls, 1);
  assert.equal(saveDebouncedCount, 1);

  // 3. 批量导入 2 套新预设（selectFirstImported: false）：保持「主力预设」激活不变，不触发 pm.updateList
  const selectOpts = [{ value: '0', textContent: '主力预设', selected: true }];
  const mockSelect = {
    value: '0',
    options: selectOpts,
    get selectedOptions() {
      return this.options.filter(o => o.selected);
    },
    appendChild(opt) {
      this.options.push(opt);
    },
  };
  const mockDoc = {
    getElementById: id => (id === 'settings_preset_openai' ? mockSelect : null),
    createElement: () => ({ value: '', textContent: '', text: '', selected: false }),
  };

  const importedRes = await importPresetItems(
    [
      { name: '新预设一.json', content: JSON.stringify({ temperature: 0.7, prompts: [] }) },
      { name: '新预设二.json', content: JSON.stringify({ temperature: 1.1, prompts: [] }) },
    ],
    {
      getContext: () => mockCtx,
      doc: mockDoc,
      selectFirstImported: false,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        return { ok: true, json: async () => ({ name: body.name }) };
      },
    },
  );
  assert.deepEqual(importedRes.imported, ['新预设一', '新预设二']);
  assert.equal(mockSelect.value, '0', '当前选中的主力预设绝不被批量导入冲掉');
  assert.equal(mockOpenAiMod.openai_setting_names['新预设一'], 1);
  assert.equal(mockOpenAiMod.openai_setting_names['新预设二'], 2);
  assert.equal(selectOpts[1].value, '1');
  assert.equal(selectOpts[1].selected, false);
  assert.equal(selectOpts[2].value, '2');
  assert.equal(selectOpts[2].selected, false);

  // 清理全局缓存以免影响后续独立测试
  await primeHostOpenAiModule({ openAiModule: {} });
});

test('preset-backend non-active export & index-safe delete: 非激活预设精准导出自身 JSON，删除中间项绝不错位下标', async () => {
  const presetsArr = [
    { temperature: 0.65, reverse_proxy: 'https://leak0.example.com', prompts: [{ identifier: 'main', content: 'P0' }] },
    { temperature: 1.08, reverse_proxy: 'https://leak1.example.com', prompts: [{ identifier: 'main', content: '仓库非激活P1专属内容' }] },
    { temperature: 0.95, prompts: [{ identifier: 'main', content: '当前激活P2内容' }] },
  ];
  const presetNamesMap = { 预设零: 0, 仓库预设一: 1, 当前预设二: 2 };

  const selectOptions = [
    { value: '0', textContent: '预设零', selected: false },
    { value: '1', textContent: '仓库预设一', selected: false },
    { value: '2', textContent: '当前预设二', selected: true },
  ];
  const mockSelect = {
    value: '2',
    options: selectOptions,
    get selectedOptions() {
      return this.options.filter(o => o.selected);
    },
    appendChild(opt) {
      this.options.push(opt);
    },
  };
  const mockDoc = {
    getElementById: id => (id === 'settings_preset_openai' ? mockSelect : null),
    createElement: () => ({ value: '', textContent: '', text: '', selected: false }),
  };

  let deletedEvents = [];
  const mockCtx = {
    chatCompletionSettings: {
      preset_settings_openai: '当前预设二',
      temp_openai: 0.95,
      prompts: [{ identifier: 'main', content: '当前激活P2内存最新内容' }],
      prompt_order: [],
    },
    eventTypes: { PRESET_DELETED: 'preset_deleted' },
    eventSource: {
      emit: async (evt, payload) => {
        deletedEvents.push({ evt, payload });
      },
    },
    extensionSettings: {
      st_mate: {
        presetStudio: {
          defaultPreset: '',
          charBindings: { 'char:test.png': '仓库预设一' },
          archivedPresets: ['仓库预设一'],
        },
      },
    },
    getPresetManager: () => ({
      apiId: 'openai',
      getPresetList: () => ({ presets: presetsArr, preset_names: presetNamesMap }),
    }),
    saveSettingsDebounced() {},
  };
  const store = createSettingsStore({ getContext: () => mockCtx });

  // 1. 导出非激活预设「仓库预设一」（注意没有 getCompletionPresetByName，仅靠 getPresetList）：必须精准导出 P1，绝不误导当前激活 P2！
  const expInactive = exportPresetToJsonString('仓库预设一', { getContext: () => mockCtx, doc: mockDoc });
  assert.equal(expInactive.ok, true);
  assert.equal(expInactive.fileName, '仓库预设一.json');
  const parsedInactive = JSON.parse(expInactive.jsonText);
  assert.equal(parsedInactive.temperature, 1.08);
  assert.equal(parsedInactive.prompts[0].content, '仓库非激活P1专属内容');
  assert.equal('reverse_proxy' in parsedInactive, false, '非激活预设导出同样剥离敏感反代');

  // 请求导出不存在的预设名时，明确返回 ok: false，绝不拿当前预设冒名顶替
  const expMissing = exportPresetToJsonString('根本不存在的预设', { getContext: () => mockCtx, doc: mockDoc });
  assert.equal(expMissing.ok, false);
  assert.equal(expMissing.reason, 'preset_not_found');

  // 2. 删除数组中间的非激活预设「仓库预设一」(idx = 1)：
  //    严禁 presetsArr.splice(1, 1)，确保「当前预设二」依然稳坐 presetsArr[2] 与 <option value="2">！
  const delRes = await deleteHostPreset({
    presetName: '仓库预设一',
    store,
    getContext: () => mockCtx,
    doc: mockDoc,
    fetchImpl: async () => ({ ok: true }),
  });
  assert.equal(delRes.ok, true);
  assert.equal('仓库预设一' in presetNamesMap, false, 'openai_setting_names 键必须同步删除');
  assert.equal(presetsArr[1], undefined, '被删槽位置空释放内存');
  assert.equal(presetsArr.length, 3, '严禁 splice 改变数组长度导致后续下标错位');
  assert.equal(presetsArr[2].prompts[0].content, '当前激活P2内容', '下标 2 的预设保持原位零错位');
  assert.equal(presetNamesMap['当前预设二'], 2);
  assert.deepEqual(
    selectOptions.map(o => `${o.value}:${o.textContent}`),
    ['0:预设零', '2:当前预设二'],
  );
  assert.equal(deletedEvents.length, 1);
  assert.equal(store.get().presetStudio.charBindings['char:test.png'], undefined);

  // 3. 删除后立即重新导入同名「仓库预设一.json」：正常分配新槽位 idx = 3 并追加 <option value="3">
  const reimportRes = await importPresetItems(
    [{ name: '仓库预设一.json', content: JSON.stringify({ temperature: 0.77, prompts: [] }) }],
    {
      getContext: () => mockCtx,
      doc: mockDoc,
      fetchImpl: async (_u, init) => ({ ok: true, json: async () => ({ name: JSON.parse(init.body).name }) }),
    },
  );
  assert.deepEqual(reimportRes.imported, ['仓库预设一']);
  assert.equal(presetNamesMap['仓库预设一'], 3);
  assert.equal(selectOptions.at(-1).value, '3');
});

test('preset-backend active chat sync & rapid switch scheduler: 非 openai 主 API 安全跳过，快速连切多卡严格停在最终卡预设', async () => {
  const store = createSettingsStore({
    getContext: () => ({
      extensionSettings: {
        st_mate: {
          shellEnabled: true,
          modules: { presets: true },
          presetStudio: {
            defaultPreset: '全局默认预设',
            charBindings: {
              'char:card1.png': '卡1专属预设',
              'char:card2.png': '卡2专属预设',
              'char:card3.png': '卡3专属预设',
            },
          },
        },
      },
    }),
  });

  // 1. 当主 API 为 textgenerationwebui（如玩家切回原生酒馆试 Text Completion）时，安全跳过且不误触非 openai 的 presetManager
  const nonOaiCtx = {
    main_api: 'textgenerationwebui',
    characterId: 0,
    characters: [{ name: '卡1', avatar: 'card1.png' }],
    getPresetManager: apiId =>
      apiId === 'openai'
        ? null
        : {
            apiId: 'textgenerationwebui',
            selectPreset() {
              throw new Error('严禁误调 textgenerationwebui 的 presetManager');
            },
          },
  };
  const skipRes = await syncPresetForActiveChat({ getContext: () => nonOaiCtx, store, doc: null });
  assert.equal(skipRes.switched, false);
  assert.equal(skipRes.reason, 'non_chat_completion_api');
  assert.equal(getHostPresetState({ getContext: () => nonOaiCtx, doc: null }).presetManager, null);

  // 2. 模拟极速连续点书架切换三张卡：卡1（慢切换耗时 45ms）进行途中，用户连点卡2 -> 卡3
  let activeCharIdx = 0;
  let activePresetVal = '0';
  const nameToVal = { 全局默认预设: '0', 卡1专属预设: '1', 卡2专属预设: '2', 卡3专属预设: '3' };
  const valToName = { '0': '全局默认预设', '1': '卡1专属预设', '2': '卡2专属预设', '3': '卡3专属预设' };
  const appliedHistory = [];
  let concurrentCount = 0;
  let maxConcurrent = 0;
  let flushCount = 0;

  const fastSwitchCtx = {
    mainApi: 'openai',
    get characterId() {
      return activeCharIdx;
    },
    characters: [
      { name: '角色1', avatar: 'card1.png' },
      { name: '角色2', avatar: 'card2.png' },
      { name: '角色3', avatar: 'card3.png' },
    ],
    chatCompletionSettings: { bind_preset_to_connection: true, preset_settings_openai: '全局默认预设' },
    getPresetManager: () => ({
      apiId: 'openai',
      getAllPresets: () => Object.keys(nameToVal),
      findPreset: name => nameToVal[name],
      getSelectedPreset: () => activePresetVal,
      getSelectedPresetName: () => valToName[activePresetVal],
      async selectPreset(val) {
        concurrentCount += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(r => setTimeout(r, val === '1' ? 45 : 10));
        activePresetVal = String(val);
        fastSwitchCtx.chatCompletionSettings.preset_settings_openai = valToName[activePresetVal];
        appliedHistory.push(valToName[activePresetVal]);
        concurrentCount -= 1;
      },
    }),
  };

  const uiRefreshedFor = [];
  const scheduler = createActiveChatPresetSyncScheduler({
    beforeSync: async () => {
      flushCount += 1;
    },
    runSync: ({ isCurrent, shouldAbort }) =>
      syncPresetForActiveChat({
        getContext: () => fastSwitchCtx,
        store,
        doc: null,
        shouldAbort,
        onSwitched: info => {
          if (isCurrent()) uiRefreshedFor.push(info.presetName);
        },
      }),
  });

  // t=0ms 切到卡 1（delay 5ms，将在 t=5ms~50ms 之间异步执行 selectPreset('1')）
  activeCharIdx = 0;
  const p1 = scheduler.schedule(5);

  // 等 15ms 确保卡 1 的 selectPreset 正在飞行途中，此时极速连点卡 2 再点卡 3！
  await new Promise(r => setTimeout(r, 15));
  activeCharIdx = 1;
  const p2 = scheduler.schedule(5);
  await new Promise(r => setTimeout(r, 10)); // 卡 2 定时器已进入队列等待卡 1 结束，紧接着用户又点到卡 3！
  activeCharIdx = 2;
  const p3 = scheduler.schedule(5);

  const [, res2, res3] = await Promise.all([p1, p2, p3]);
  assert.equal(maxConcurrent, 1, '绝不允许两个 selectPreset 并发重入篡改 oai_settings');
  assert.equal(res2.superseded, true, '被卡3超越的中间卡2必须自动跳过不白跑');
  assert.equal(res3.switched, true);
  assert.equal(res3.presetName, '卡3专属预设');
  assert.equal(valToName[activePresetVal], '卡3专属预设', '最终必须精准停留在最后点击的卡3预设');
  assert.deepEqual(appliedHistory, ['卡1专属预设', '卡3专属预设'], '中间过期的卡2预设零多余切换');
  assert.deepEqual(uiRefreshedFor, ['卡3专属预设'], '过期的卡1回调绝不污染 UI 刷新');
  assert.ok(flushCount >= 2);
});

test('assistant-core: 主/副通道零干扰请求构造、reverse_proxy 独立密码匹配、采样兼容与 Abort/HTTP 报错', async () => {
  assert.equal(DEFAULT_ASSISTANT_TIMEOUT_MS, 90000);
  assert.equal(DEFAULT_MAX_HISTORY_TURNS, 8);

  const mainChatHistory = [{ name: '角色A', mes: '主对话现有台词' }];
  const hostOaiSettings = {
    preset_settings_openai: '主力文风预设',
    chat_completion_source: 'custom',
    custom_url: 'https://main-station.example.com/v1',
    custom_model: 'gemini-4-carbon(high)',
    reverse_proxy: 'https://main-claude-proxy.example.com',
    proxy_password: 'pwd-main-keep-untouched',
    proxies: [
      { name: 'None', url: '', password: '' },
      {
        name: buildHostProxyPresetName('st_aux_claude'),
        url: 'https://aux-claude-relay.example.com',
        password: 'pwd-aux-claude-secret',
      },
    ],
  };
  const originalOaiSnapshot = structuredClone(hostOaiSettings);

  const mockCtx = {
    chat: mainChatHistory,
    chatCompletionSettings: hostOaiSettings,
    getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF': 'tok' }),
    extensionSettings: {
      st_mate: {
        apiStudio: {
          activeStationId: 'st_main',
          stations: [
            {
              id: 'st_main',
              name: '一号主站',
              source: 'custom',
              url: 'https://main-station.example.com/v1',
              secretId: 'sec-main-001',
              model: 'old-cached-model',
            },
            {
              id: 'st_aux_claude',
              name: '二号Claude反代副站',
              source: 'claude',
              url: 'https://aux-claude-relay.example.com',
              secretId: 'sec-aux-002',
              model: 'claude-3-5-haiku-20241022',
            },
          ],
        },
        auxApi: {
          mode: 'follow_main',
          stationId: '',
          model: '',
        },
      },
    },
    saveSettingsDebounced() {},
  };
  const store = createSettingsStore({ getContext: () => mockCtx });

  // 1. 默认零配置 follow_main：自动取 activeStationId 并对齐宿主实时模型 gemini-4-carbon(high)
  const mainChan = resolveAssistantRuntimeChannel({ store, getContext: () => mockCtx });
  assert.equal(mainChan.channelType, 'main');
  assert.equal(mainChan.model, 'gemini-4-carbon(high)');
  assert.equal(mainChan.station.secretId, 'sec-main-001');
  assert.equal(mainChan.badgeLabel, '主通道 · gemini-4-carbon(high)');

  // 1.1 若尚未初始化任何站子卡片，自动从当前宿主 buildStationFromCurrentHost 构造主连接
  const uninitChan = resolveAssistantRuntimeChannel({
    settings: normalizeSettings({}),
    getContext: () => mockCtx,
    secretsMap: { api_key_custom: [{ id: 'sec-host-live', active: true }] },
  });
  assert.equal(uninitChan.channelType, 'main');
  assert.equal(uninitChan.model, 'gemini-4-carbon(high)');
  assert.equal(uninitChan.station.secretId, 'sec-host-live');

  // 2. 切换至副站子通道（覆盖模型名 + 自动匹配 [ST伴侣] st_aux_claude 专属反代密码），全程零篡改主站 oai_settings！
  store.update(
    {
      auxApi: {
        mode: 'station',
        enabled: true,
        stationId: 'st_aux_claude',
        model: 'claude-haiku-override',
      },
    },
    { silent: true },
  );

  const capturedBodies = [];
  const resAux = await requestAssistantCompletion({
    messages: [{ role: 'user', content: '测试副通道静默请求' }],
    store,
    getContext: () => mockCtx,
    doc: null,
    fetchImpl: async (_url, init) => {
      capturedBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '<think>先检查一遍条目结构</think>{"reply": "检查完毕", "operations": []}',
                },
              },
            ],
          }),
      };
    },
  });

  assert.equal(resAux.ok, true);
  assert.equal(resAux.thinkingText, '先检查一遍条目结构');
  assert.equal(resAux.cleanText, '{"reply": "检查完毕", "operations": []}');
  assert.equal(resAux.channel.badgeLabel, '副通道 · claude-haiku-override');
  assert.equal(capturedBodies.length, 1);
  assert.equal(capturedBodies[0].type, 'quiet');
  assert.equal(capturedBodies[0].stream, false);
  assert.equal(capturedBodies[0].chat_completion_source, 'claude');
  assert.equal(capturedBodies[0].model, 'claude-haiku-override');
  assert.equal(capturedBodies[0].secret_id, 'sec-aux-002');
  assert.equal(capturedBodies[0].reverse_proxy, 'https://aux-claude-relay.example.com');
  assert.equal(capturedBodies[0].proxy_password, 'pwd-aux-claude-secret');

  // 铁律断言：主站子的 oai_settings 与聊天记录 100% 纹丝不动！
  assert.deepEqual(hostOaiSettings, originalOaiSnapshot, '发送副通道请求严禁篡改主站 oai_settings 任何字段');
  assert.equal(mainChatHistory.length, 1);

  // 3. 采样温度与特殊模型兼容（o1 / claude-opus-5 禁 temperature，MiniMax 禁 0）
  assert.equal(isTemperatureForbiddenModel('o1-preview'), true);
  assert.equal(isTemperatureForbiddenModel('claude-opus-5-20260501'), true);
  assert.equal(isTemperatureForbiddenModel('deepseek-chat'), false);

  const o1Body = buildAssistantGenerateBody(
    { station: { source: 'openai', model: 'o1-mini' }, model: 'o1-mini' },
    [{ role: 'user', content: 'hi' }],
    { temperature: 0.4 },
  );
  assert.equal('temperature' in o1Body, false, 'o1 系列必须剥离 temperature 参数');

  const minimaxBody = buildAssistantGenerateBody(
    { station: { source: 'minimax', model: 'MiniMax-M2.5' }, model: 'MiniMax-M2.5' },
    [{ role: 'user', content: 'hi' }],
    { temperature: 0 },
  );
  assert.ok(minimaxBody.temperature > 0, 'MiniMax 传入 0 温度时必须自动抬升保底，兼容禁 0 约束');

  // 4. HTTP 429 清晰人话报错 + AbortController 主动取消
  const rateLimitRes = await requestAssistantCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    store,
    getContext: () => mockCtx,
    doc: null,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: 'Quota exceeded' } }),
    }),
  });
  assert.equal(rateLimitRes.ok, false);
  assert.match(rateLimitRes.message, /HTTP 429/);
  assert.match(rateLimitRes.message, /额度不足或请求过快/);

  const abortCtrl = new AbortController();
  const abortPromise = requestAssistantCompletion({
    messages: [{ role: 'user', content: 'slow query' }],
    store,
    getContext: () => mockCtx,
    signal: abortCtrl.signal,
    doc: null,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }),
  });
  setTimeout(() => abortCtrl.abort(), 15);
  const abortedRes = await abortPromise;
  assert.equal(abortedRes.ok, false);
  assert.equal(abortedRes.aborted, true);
  assert.equal(abortedRes.message, '已停止本次生成');
});

test('assistant-core: <think> 剥离、尾随逗号修复与鲁棒 JSON 方案提取器 (extractAssistantPlan)', () => {
  // 1. 字符串内含 `, }` 字面量绝不误删，仅清理真实 JSON 尾随逗号
  const rawDirtyJson = `{
    "reply": "已处理包含 \\", }\\" 符号的规则",
    "operations": [
      {
        "type": "add_entry",
        "name": "防抢话",
        "content": "不要替 {{user}} 写台词, }",
      },
    ],
  }`;
  const cleanedJson = removeJsonTrailingCommas(rawDirtyJson);
  const parsedClean = JSON.parse(cleanedJson);
  assert.equal(parsedClean.operations[0].content, '不要替 {{user}} 写台词, }');

  // 2. <think> + 代码块包裹 + 代码块外前置诊断文本合并
  const fencedOutput = [
    '<think>分析预设中的冲突项...</think>',
    '我检查了你的预设，发现「旧防抢话」与主提示词冲突，建议停用旧条目并补充一条精准深度约束：',
    '```json',
    '{',
    '  "reply": "请确认下方两项改动：",',
    '  "operations": [',
    '    { "type": "toggle_entry", "identifier": "old_anti", "enabled": false, },',
    '    { "type": "add_entry", "name": "防抢话守则", "content": "严禁替 {{user}} 发言。", },',
    '  ],',
    '}',
    '```',
  ].join('\n');

  const planFenced = extractAssistantPlan(fencedOutput);
  assert.equal(planFenced.hasStructuredPlan, true);
  assert.equal(planFenced.operations.length, 2);
  assert.match(planFenced.reply, /我检查了你的预设/);
  assert.match(planFenced.reply, /请确认下方两项改动/);

  // 3. 自然语言分析后直接附带裸 JSON 对象（无 markdown 反引号）
  const bareJsonOutput =
    '当前温度偏高容易导致角色胡言乱语，建议下调温度：\n{"reply": "已生成调温建议", "operations": [{"type": "update_params", "temperature": 0.85}]}';
  const planBare = extractAssistantPlan(bareJsonOutput);
  assert.equal(planBare.hasStructuredPlan, true);
  assert.equal(planBare.operations.length, 1);
  assert.equal(planBare.operations[0].type, 'update_params');

  // 4. 纯文本诊断回复（包含 {{user}} / {{char}} 宏，无任何 JSON 对象）：安全展示为纯文本，绝不报错！
  const pureChatText =
    '<thinking>无需修改预设</thinking>当前预设结构很健康，`{{char}}` 的人设槽位于 `{{user}}` 之前，未发现重复或冲突条目。';
  const planPure = extractAssistantPlan(pureChatText);
  assert.equal(planPure.hasStructuredPlan, false);
  assert.deepEqual(planPure.operations, []);
  assert.equal(
    planPure.reply,
    '当前预设结构很健康，`{{char}}` 的人设槽位于 `{{user}}` 之前，未发现重复或冲突条目。',
  );
});

test('assistant-core: 多轮会话控制器最近 8 轮滑动裁剪，剥离历史巨型 JSON 防 Token 爆炸', async () => {
  const mockCtx = {
    chatCompletionSettings: {
      chat_completion_source: 'custom',
      custom_url: 'https://relay.example.com/v1',
      custom_model: 'deepseek-chat',
    },
  };

  let currentRound = 0;
  const giantPromptBody = '长篇文风约束正文_'.repeat(300); // > 2400 字符

  const session = createAssistantSession({
    domainId: 'preset',
    maxHistoryTurns: 8,
    systemPromptBuilder: () => 'SYSTEM_PROMPT_BASE',
    contextBuilder: () => ({ roundSnapshot: currentRound }),
    getContext: () => mockCtx,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: `第 ${currentRound} 轮诊断完成`,
                  operations: [
                    {
                      type: 'add_entry',
                      name: `条目_${currentRound}`,
                      content: giantPromptBody,
                    },
                  ],
                }),
              },
            },
          ],
        }),
    }),
  });

  // 连续跑 10 轮问答
  for (let i = 1; i <= 10; i += 1) {
    currentRound = i;
    const res = await session.send(`用户第 ${i} 轮诉求`, { doc: null });
    assert.equal(res.ok, true);
    assert.equal(res.operations.length, 1);
  }

  assert.equal(session.getTurnCount(), 8, '有效发送历史严格保持最多 8 轮');

  // 构造第 11 轮请求体并检查发包上下文
  currentRound = 11;
  const reqMessages = session.buildRequestMessages('第 11 轮追问：再精简一点');

  // 1 条 system + 8 轮 * 2 (user + assistant) + 1 条最新 user = 18 条
  assert.equal(reqMessages.length, 18);
  assert.equal(reqMessages[0].role, 'system');
  assert.equal(reqMessages[1].content, '用户第 3 轮诉求', '前 2 轮自动滑出窗口，从第 3 轮开始保留');

  // 历史 assistant 消息只保留摘要，绝不携带 2400 字的 giantPromptBody 或旧快照 JSON
  const historyAssistantMsgs = reqMessages.slice(1, -1).filter(m => m.role === 'assistant');
  assert.equal(historyAssistantMsgs.length, 8);
  for (const msg of historyAssistantMsgs) {
    assert.equal(msg.content.includes(giantPromptBody), false, '历史轮次严禁重复塞入巨型 JSON 正文');
    assert.match(msg.content, /add_entry\(条目_/);
  }

  // 最新一轮 user 消息携带最新第 11 轮实时快照
  assert.match(reqMessages.at(-1).content, /"roundSnapshot":11/);
  assert.match(reqMessages.at(-1).content, /第 11 轮追问/);

  session.clearHistory();
  assert.equal(session.getTurnCount(), 0);
});

test('preset-assistant: 超长正文智能截断序列化 + 6 类安全原子操作校验与系统槽防误删降级', () => {
  assert.equal(PRESET_ASSISTANT_QUICK_PROMPTS.length, 4);
  assert.ok(buildPresetAssistantSystemPrompt().includes('operations'));

  // 1. 验证 >1800 字单条正文智能截取前 1200 字 + 后 400 字并注明总字数
  const longText = `${'前段内容A'.repeat(300)}${'中段省略B'.repeat(200)}${'尾段内容C'.repeat(120)}`;
  assert.ok(longText.length > 1800);
  const trunc = truncatePromptContentForContext(longText);
  assert.equal(trunc.truncated, true);
  assert.equal(trunc.totalLength, longText.length);
  assert.ok(trunc.text.startsWith(longText.slice(0, 1200)));
  assert.ok(trunc.text.endsWith(longText.slice(-400)));
  assert.match(trunc.text, new RegExp(`本条全文共 ${longText.length} 字`));

  const oai = {
    openai_max_context: 32768,
    openai_max_tokens: 2048,
    temp_openai: 1.0,
    prompts: [
      { identifier: 'main', name: 'Main Prompt', role: 'system', system_prompt: true, marker: false, content: '基础设定' },
      { identifier: 'charDescription', name: 'Char Description', role: 'system', system_prompt: true, marker: true, content: '' },
      { identifier: 'style_long', name: '超长文风卷轴', role: 'system', system_prompt: false, marker: false, content: longText },
      { identifier: 'dup_anti', name: '旧版冗余防抢话', role: 'system', system_prompt: false, marker: false, content: '旧防抢话内容' },
      { identifier: 'chatHistory', name: 'Chat History', role: 'system', system_prompt: true, marker: true, content: '' },
      { identifier: 'jailbreak', name: 'Post-History Instructions', role: 'system', system_prompt: true, marker: false, content: '原始JB' },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'style_long', enabled: true },
          { identifier: 'dup_anti', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'jailbreak', enabled: true },
        ],
      },
    ],
  };

  const serialized = serializePresetContext({ oaiSettings: oai, presetName: '清冷古风预设' });
  assert.equal(serialized.preset_name, '清冷古风预设');
  assert.equal(serialized.params.openai_max_context, 32768);
  assert.equal(serialized.entries.length, 6);
  const styleSerialized = serialized.entries.find(e => e.identifier === 'style_long');
  assert.equal(styleSerialized.truncated, true);
  assert.equal(styleSerialized.content_length, longText.length);

  // 2. 校验 6 类合法操作 + 系统槽拦截与内置项降级保护
  const preview = validateAndPreviewPresetOperations(
    [
      // (1) 新增防抢话条目（置于 chatHistory 之后）
      {
        type: 'add_entry',
        name: '严禁抢话守则',
        role: 'system',
        afterIdentifier: 'chatHistory',
        content: '绝对禁止替 {{user}} 描写语言、动作与心理活动。',
        reason: '放在历史记录后权重更高',
      },
      // (2) 按唯一精确名称匹配修改条目
      {
        type: 'update_entry',
        name: 'Main Prompt',
        content: '升级后的主系统设定。',
      },
      // (3) 开关条目
      {
        type: 'toggle_entry',
        identifier: 'style_long',
        enabled: false,
      },
      // (4) 移动条目顺序
      {
        type: 'move_entry',
        identifier: 'style_long',
        position: 'top',
      },
      // (5) 删除用户自定义冗余条目（合法）
      {
        type: 'delete_entry',
        identifier: 'dup_anti',
      },
      // (6) 修改核心生成参数
      {
        type: 'update_params',
        openai_max_context: 65536,
        openai_max_tokens: 4096,
        temperature: 0.88,
      },
      // [非法 A] 试图改写 marker:true 系统占位槽正文 -> 必须拦截进 rejected！
      {
        type: 'update_entry',
        identifier: 'charDescription',
        content: '篡改系统槽',
      },
      // [非法 B] 试图物理删除 marker:true 对话历史槽 -> 必须拦截进 rejected！
      {
        type: 'delete_entry',
        identifier: 'chatHistory',
      },
      // [保护降级 C] 试图物理删除 system_prompt:true 内置项 jailbreak -> 自动安全降级为 toggle_entry(enabled: false)！
      {
        type: 'delete_entry',
        identifier: 'jailbreak',
      },
      // [防呆拦截 D] 试图把带 `...(中略` 截断标记的残缺文本写回超长条目 -> 必须拦截保护原长文！
      {
        type: 'update_entry',
        identifier: 'style_long',
        content: styleSerialized.content,
      },
    ],
    oai,
  );

  // 6 项标准操作 + 1 项 jailbreak 自动降级停用 = 7 项有效可勾选预览；3 项非法被拦截进 rejected
  assert.equal(preview.items.length, 7);
  assert.equal(preview.rejected.length, 3);

  assert.equal(preview.items[0].type, 'add_entry');
  assert.equal(preview.items[0].canViewDiff, true);
  assert.match(preview.items[0].summary, /Chat History/);

  assert.equal(preview.items[1].type, 'update_entry');
  assert.equal(preview.items[1].beforeContent, '基础设定');
  assert.equal(preview.items[1].afterContent, '升级后的主系统设定。');

  const downgradedJb = preview.items[6];
  assert.equal(downgradedJb.type, 'toggle_entry', '删除开启中的内置条目应自动降级为停用');
  assert.equal(downgradedJb.targetName, 'Post-History Instructions');
  assert.match(downgradedJb.downgradedNote, /自动安全转为「停用」/);
});

test('preset-assistant: 自由部分勾选应用 + 多步快照栈 (undoStack) + 跨预设自动切回一键无损悔棋', async () => {
  const diskPresets = {
    主力预设A: {
      openai_max_context: 32768,
      openai_max_tokens: 2048,
      temperature: 1.0,
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', system_prompt: true, marker: false, content: '初始Main正文' },
        { identifier: 'chatHistory', name: 'Chat History', role: 'system', system_prompt: true, marker: true, content: '' },
        { identifier: 'custom_old', name: '旧测试条目', role: 'system', system_prompt: false, marker: false, content: '待观察旧条目' },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory', enabled: true },
            { identifier: 'custom_old', enabled: true },
          ],
        },
      ],
    },
    备用预设B: {
      openai_max_context: 16384,
      openai_max_tokens: 1024,
      temperature: 0.7,
      prompts: [{ identifier: 'main', name: 'Main', role: 'system', system_prompt: true, content: '预设B的正文' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    },
  };

  const hostPresetsArr = [structuredClone(diskPresets.主力预设A), structuredClone(diskPresets.备用预设B)];
  const hostPresetNames = { 主力预设A: 0, 备用预设B: 1 };
  let selectedIdx = '0';

  const mockOai = {
    bind_preset_to_connection: true,
    preset_settings_openai: '主力预设A',
    openai_max_context: 32768,
    openai_max_tokens: 2048,
    temp_openai: 1.0,
    prompts: structuredClone(diskPresets.主力预设A.prompts),
    prompt_order: structuredClone(diskPresets.主力预设A.prompt_order),
  };

  const mockCtx = {
    chatCompletionSettings: mockOai,
    getPresetManager: () => ({
      apiId: 'openai',
      getAllPresets: () => ['主力预设A', '备用预设B'],
      getPresetList: () => ({ presets: hostPresetsArr, preset_names: hostPresetNames }),
      findPreset: name => (hostPresetNames[name] !== undefined ? String(hostPresetNames[name]) : undefined),
      getSelectedPreset: () => selectedIdx,
      getSelectedPresetName: () => (selectedIdx === '0' ? '主力预设A' : '备用预设B'),
      async selectPreset(val) {
        selectedIdx = String(val);
        const name = selectedIdx === '0' ? '主力预设A' : '备用预设B';
        const src = hostPresetsArr[Number(selectedIdx)];
        mockOai.preset_settings_openai = name;
        mockOai.openai_max_context = src.openai_max_context;
        mockOai.openai_max_tokens = src.openai_max_tokens;
        mockOai.temp_openai = src.temperature;
        mockOai.prompts = structuredClone(src.prompts);
        mockOai.prompt_order = structuredClone(src.prompt_order);
      },
    }),
    saveSettingsDebounced() {},
  };

  const savedCalls = [];
  const mockSaveFetch = async (_url, init) => {
    const parsed = JSON.parse(init.body);
    savedCalls.push({ name: parsed.name, preset: structuredClone(parsed.preset) });
    diskPresets[parsed.name] = structuredClone(parsed.preset);
    return { ok: true, json: async () => ({ name: parsed.name }) };
  };

  const undoStack = createPresetUndoStack({ maxSteps: 10 });

  // 第一步：助手给出 3 项修改建议，玩家取消勾选第 2 项（不删除 custom_old），仅勾选第 1 项（新增防抢话）和第 3 项（改温度为 0.85）
  const plan1 = validateAndPreviewPresetOperations(
    [
      {
        type: 'add_entry',
        name: '防抢话新规',
        role: 'system',
        afterIdentifier: 'chatHistory',
        content: '严禁替 {{user}} 说话。',
      },
      {
        type: 'delete_entry',
        identifier: 'custom_old',
      },
      {
        type: 'update_params',
        temperature: 0.85,
      },
    ],
    mockOai,
  );
  assert.equal(plan1.items.length, 3);

  const partialSelected = new Set([plan1.items[0].opId, plan1.items[2].opId]); // 故意不选 items[1] (delete_entry)
  const applyRes1 = await applySelectedPresetOperations({
    previewItems: plan1.items,
    selectedOpIds: partialSelected,
    undoStack,
    getContext: () => mockCtx,
    persistImmediately: true,
    fetchImpl: mockSaveFetch,
    doc: null,
  });

  assert.equal(applyRes1.ok, true);
  assert.equal(applyRes1.appliedCount, 2);
  assert.equal(undoStack.size(), 1);
  assert.equal(mockOai.temp_openai, 0.85);

  const entriesAfterStep1 = readOrderedPromptEntries(mockOai).entries;
  assert.equal(entriesAfterStep1.length, 4, '新增了 1 条且未勾选的删除项完好保留');
  assert.equal(entriesAfterStep1[2].name, '防抢话新规', '精准插入在 chatHistory (下标1) 之后');
  assert.equal(entriesAfterStep1[3].identifier, 'custom_old', '未勾选删除的条目完好无损');

  // 第二步：再执行一次修改（把防抢话移到顶部 + 改写 Main 正文 + 上下文拉到 1000000）
  const plan2 = validateAndPreviewPresetOperations(
    [
      { type: 'move_entry', name: '防抢话新规', position: 'top' },
      { type: 'update_entry', identifier: 'main', content: '第二步改写后的Main' },
      { type: 'update_params', openai_max_context: 1000000 },
    ],
    mockOai,
  );
  const applyRes2 = await applySelectedPresetOperations({
    previewItems: plan2.items,
    undoStack,
    getContext: () => mockCtx,
    persistImmediately: true,
    fetchImpl: mockSaveFetch,
    doc: null,
  });
  assert.equal(applyRes2.ok, true);
  assert.equal(undoStack.size(), 2);
  assert.equal(readOrderedPromptEntries(mockOai).entries[0].name, '防抢话新规');
  assert.equal(mockOai.openai_max_context, 1000000);

  // 模拟玩家此时切去了「备用预设B」，然后点击「撤回上一步」！
  await mockCtx.getPresetManager().selectPreset('1');
  assert.equal(mockOai.preset_settings_openai, '备用预设B');

  const undoRes1 = await undoLastPresetOperation({
    undoStack,
    getContext: () => mockCtx,
    fetchImpl: mockSaveFetch,
    doc: null,
  });
  assert.equal(undoRes1.ok, true);
  assert.equal(undoRes1.switchedPreset, true, '必须自动贴心切回快照所属的主力预设A');
  assert.equal(mockOai.bind_preset_to_connection, false, '切回预设时开启 API 连接保护');
  assert.equal(mockOai.preset_settings_openai, '主力预设A');
  assert.equal(undoRes1.remainingSteps, 1);

  // 验证已精准回到第一步结束时的状态（防抢话仍在下标 2，Main 为初始正文，上下文回到 32768，温度仍为 0.85）
  const afterUndo1Entries = readOrderedPromptEntries(mockOai).entries;
  assert.equal(afterUndo1Entries.length, 4);
  assert.equal(afterUndo1Entries[0].content, '初始Main正文');
  assert.equal(afterUndo1Entries[2].name, '防抢话新规');
  assert.equal(mockOai.openai_max_context, 32768);
  assert.equal(mockOai.temp_openai, 0.85);

  // 再次点击「撤回上一步」：彻底回到一字未改的最初状态！
  const undoRes2 = await undoLastPresetOperation({
    undoStack,
    getContext: () => mockCtx,
    fetchImpl: mockSaveFetch,
    doc: null,
  });
  assert.equal(undoRes2.ok, true);
  assert.equal(undoRes2.remainingSteps, 0);
  const afterUndo2Entries = readOrderedPromptEntries(mockOai).entries;
  assert.equal(afterUndo2Entries.length, 3);
  assert.equal(afterUndo2Entries.some(e => e.name === '防抢话新规'), false);
  assert.equal(mockOai.temp_openai, 1.0);
  assert.equal(diskPresets.主力预设A.temperature, 1.0, '撤回后的快照已同步落盘写回预设文件');
});

test('assistant-core & api-backend: 多渠道真实响应格式对账（Claude Extended Thinking 空 choices 陷阱 / Gemini thought parts / Cohere V2 / Mistral 数组）', async () => {
  // 1. 复现酒馆后端 chat-completions.js sendClaudeRequest 在 Extended Thinking 下的真实返回：
  //    choices[0].message.content 被置为空串 ""，真实回复在顶层 content 数组的第 2 块 type: 'text'！
  const stClaudeThinkingPayload = {
    choices: [{ message: { content: '' } }],
    content: [
      { type: 'thinking', thinking: '先核对各条目注入位置...' },
      { type: 'redacted_thinking', data: 'enc_xyz' },
      { type: 'text', text: '{"reply": "Claude思考后给出的方案", "operations": []}' },
    ],
  };
  const claudeExtracted = extractCompletionPayload(stClaudeThinkingPayload);
  assert.equal(claudeExtracted.text, '{"reply": "Claude思考后给出的方案", "operations": []}');
  assert.equal(claudeExtracted.reasoningText, '先核对各条目注入位置...');
  assert.equal(extractProbeReplyText(stClaudeThinkingPayload), '{"reply": "Claude思考后给出的方案", ');

  const mockClaudeCtx = {
    chatCompletionSettings: {
      chat_completion_source: 'claude',
      claude_model: 'claude-sonnet-4-6',
    },
  };
  const claudeComp = await requestAssistantCompletion({
    messages: [{ role: 'user', content: '诊断预设' }],
    getContext: () => mockClaudeCtx,
    doc: null,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(stClaudeThinkingPayload),
    }),
  });
  assert.equal(claudeComp.ok, true, '绝不能被 choices[0].message.content === "" 误判为空内容');
  assert.equal(claudeComp.cleanText, '{"reply": "Claude思考后给出的方案", "operations": []}');
  assert.equal(claudeComp.thinkingText, '先核对各条目注入位置...');

  // 2. Gemini 原生反代 candidates[0].content.parts（首个 part 为 thought: true 思考块，第二个 part 才是正文）
  const geminiThoughtPayload = {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            { thought: true, text: 'The user wants to check prompt order...' },
            { text: '{"reply": "Gemini过滤思考块后的正文", "operations": []}' },
          ],
        },
      },
    ],
  };
  const geminiExtracted = extractCompletionPayload(geminiThoughtPayload);
  assert.equal(geminiExtracted.text, '{"reply": "Gemini过滤思考块后的正文", "operations": []}');
  assert.equal(geminiExtracted.reasoningText, 'The user wants to check prompt order...');
  assert.equal(
    extractProbeReplyText({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'Internal thinking should never leak into probe preview' },
              { text: '<think>inline tag</think>OK.' },
            ],
          },
        },
      ],
    }),
    'OK.',
    'API 工作台快速测活预览必须过滤 Gemini thought 块与 <think> 标签',
  );

  // 3. Cohere V2 message.content 数组 & OpenAI/Mistral 分段数组
  const cohereV2Payload = {
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Cohere step 1' },
        { type: 'text', text: '{"reply": "Cohere V2 回复", "operations": []}' },
      ],
    },
  };
  assert.equal(
    extractCompletionPayload(cohereV2Payload).text,
    '{"reply": "Cohere V2 回复", "operations": []}',
  );

  const mistralArrayPayload = {
    choices: [
      {
        message: {
          content: [
            { type: 'thinking', thinking: [{ type: 'text', text: 'Magistral reasoning' }] },
            { type: 'text', text: '{"reply": "Mistral分段正文", "operations": []}' },
          ],
        },
      },
    ],
  };
  const mistralExt = extractCompletionPayload(mistralArrayPayload);
  assert.equal(mistralExt.text, '{"reply": "Mistral分段正文", "operations": []}');
  assert.equal(mistralExt.reasoningText, 'Magistral reasoning');

  // 4. 扩展禁采样温度模型校验（含反代商前缀与 Claude Opus 4.7/4.8、Gemini 3.6/3.7 Flash）
  assert.equal(isTemperatureUnsupportedModel('openai/o3-mini'), true);
  assert.equal(isTemperatureForbiddenModel('anthropic/claude-opus-4-7'), true);
  assert.equal(isTemperatureForbiddenModel('gemini-3.6-flash'), true);
  const probeOpus47 = buildProbeGenerateBody({ source: 'custom', url: 'https://x.com/v1', model: 'anthropic/claude-opus-4-7' });
  assert.equal('temperature' in probeOpus47, false);
});

test('assistant-core: normalizeAssistantMessages 严格保证 user/assistant 角色交替且杜绝非法首尾角色', () => {
  const messyMessages = [
    { role: 'system', content: '系统指令一' },
    { role: 'system', content: '系统指令二' },
    { role: 'assistant', content: '异常前置的助手欢迎语' },
    { role: 'user', content: '用户第一句' },
    { role: 'system', content: '中途插播的系统补充说明' },
    { role: 'user', content: '用户连续追问第二句' },
    { role: 'assistant', content: '   ' }, // 空白消息应被安全忽略并合并前后 user
    { role: 'user', content: '用户第三句' },
    { role: 'assistant', content: '助手回复A' },
    { role: 'assistant', content: '助手连续回复B' },
  ];

  const normalized = normalizeAssistantMessages(messyMessages);
  assert.equal(normalized[0].role, 'system');
  assert.equal(normalized[0].content, '系统指令一\n\n系统指令二');

  const dialogue = normalized.slice(1);
  assert.ok(dialogue.length >= 3);
  assert.equal(dialogue[0].role, 'user', '非 system 首条消息必须为 user');
  assert.equal(dialogue.at(-1).role, 'user', '末条消息必须为 user，杜绝 Claude Thinking / Gemini 3 报 prefill 错误');

  for (let i = 1; i < dialogue.length; i += 1) {
    assert.notEqual(
      dialogue[i].role,
      dialogue[i - 1].role,
      `下标 ${i - 1} 与 ${i} 严禁出现连续相同角色 (${dialogue[i].role})`,
    );
    assert.ok(dialogue[i].content.trim().length > 0, '任何消息正文不得为空串');
  }

  // 验证合并内容无丢失
  const allText = normalized.map(m => m.content).join('\n');
  assert.match(allText, /中途插播的系统补充说明/);
  assert.match(allText, /用户连续追问第二句/);
  assert.match(allText, /助手连续回复B/);
});

test('preset-assistant: 点名长条目 8000 字免截断提权 + update_entry 增量 appendContent / findText+replaceText ($1/$$ 字面量安全)', async () => {
  assert.equal(FOCUSED_ENTRY_MAX_CHARS, 8000);

  const style2600 = `${'清冷克制叙事基准，注重光影与动作细节描写。'.repeat(120)}\n允许适度使用景物映射心境。`; // ~2540 字 (> 1800, < 8000)
  const world3200 = '宏大架空编年史与地理设定_'.repeat(250); // 3250 字 (> 1800)
  assert.ok(style2600.length > 2400 && style2600.length < 8000);
  assert.ok(world3200.length > 3000);

  const mockOai = {
    preset_settings_openai: '砚台测试预设',
    openai_max_context: 65536,
    openai_max_tokens: 4096,
    temp_openai: 0.95,
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', system_prompt: true, content: '主设定' },
      { identifier: 'world_bg', name: '世界观宏大背景', role: 'system', system_prompt: false, content: world3200 },
      { identifier: 'style_ctrl', name: '【03】文风控制与节奏', role: 'system', system_prompt: false, content: style2600 },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'world_bg', enabled: true },
          { identifier: 'style_ctrl', enabled: true },
        ],
      },
    ],
  };

  const userQuestion = '帮我改一下『文风控制』那条，把映射心境那句改掉，并在末尾加一句不要用比喻句';
  assert.ok(scorePromptEntryRelevance({ identifier: 'style_ctrl', name: '【03】文风控制与节奏' }, userQuestion) >= 90);
  assert.equal(scorePromptEntryRelevance({ identifier: 'world_bg', name: '世界观宏大背景' }, userQuestion), 0);

  // 1. 验证序列化：被用户点名的「【03】文风控制与节奏」(2540字) 完整保留不截断；未提及的「世界观宏大背景」(3250字) 保持 1800 字摘要省 Token
  const ctxWithPrompt = serializePresetContext({
    oaiSettings: mockOai,
    presetName: '砚台测试预设',
    userPrompt: userQuestion,
  });
  const styleCtxEntry = ctxWithPrompt.entries.find(e => e.identifier === 'style_ctrl');
  const worldCtxEntry = ctxWithPrompt.entries.find(e => e.identifier === 'world_bg');
  assert.equal(styleCtxEntry.focused, true);
  assert.equal(Boolean(styleCtxEntry.truncated), false, '点名的 2540 字条目必须免截断完整发送');
  assert.equal(styleCtxEntry.content, style2600);
  assert.equal(worldCtxEntry.truncated, true, '未点名的 3250 字背景条目继续保持截断省 Token');

  // 2. 验证 createAssistantSession 自动将当轮 userText 传给 contextBuilder
  let capturedBuilderArg = null;
  const session = createAssistantSession({
    domainId: 'preset',
    systemPromptBuilder: buildPresetAssistantSystemPrompt,
    contextBuilder: arg => {
      capturedBuilderArg = arg;
      return serializePresetContext({ oaiSettings: mockOai, userPrompt: arg?.userText });
    },
    getContext: () => ({
      chatCompletionSettings: {
        chat_completion_source: 'custom',
        custom_url: 'https://relay.example.com/v1',
        custom_model: 'claude-sonnet-4-6',
      },
    }),
  });
  const builtMsgs = session.buildRequestMessages(userQuestion);
  assert.equal(capturedBuilderArg?.userText, userQuestion);
  assert.equal(builtMsgs.at(-1).content.includes(JSON.stringify(style2600)), true);

  // 3. 验证 update_entry 增量修改：findText + replaceText（含 $1 / $$ 特殊美元符号防吃字）+ appendContent 组合手术
  const preview = validateAndPreviewPresetOperations(
    [
      {
        type: 'update_entry',
        identifier: 'style_ctrl',
        findText: '允许适度使用景物映射心境。',
        replaceText: '保持客观白描（正则变量 $1 与金额 $$100 原样保留）。',
        appendContent: '严禁使用明喻、暗喻等比喻修辞。',
        reason: '局部替换并追加禁比喻规则',
      },
      // 多处重复片段未开 replaceAll -> 必须安全拦截防误伤！
      {
        type: 'update_entry',
        identifier: 'world_bg',
        findText: '宏大架空编年史',
        replaceText: '短词',
      },
      // 找不到原片段 -> 必须安全拦截！
      {
        type: 'update_entry',
        identifier: 'main',
        findText: '根本不存在的原句',
        replaceText: '新句',
      },
    ],
    mockOai,
  );

  assert.equal(preview.items.length, 1);
  assert.equal(preview.rejected.length, 2);
  assert.match(preview.rejected[0].reason, /多处相同|处相同的/);
  assert.match(preview.rejected[1].reason, /未找到原片段/);

  const validUpdate = preview.items[0];
  assert.ok(
    validUpdate.afterContent.includes('保持客观白描（正则变量 $1 与金额 $$100 原样保留）。'),
    '$1 与 $$ 必须原样保留，绝不能被正则替换语法吃字',
  );
  assert.ok(validUpdate.afterContent.endsWith('\n严禁使用明喻、暗喻等比喻修辞。'));
  assert.ok(validUpdate.afterContent.startsWith('清冷克制叙事基准'));

  // 应用增量修改并验证落到 oai.prompts 中一字不差
  const applyRes = await applySelectedPresetOperations({
    previewItems: preview.items,
    getContext: () => ({ chatCompletionSettings: mockOai, saveSettingsDebounced() {} }),
    doc: null,
  });
  assert.equal(applyRes.ok, true);
  const updatedPrompt = mockOai.prompts.find(p => p.identifier === 'style_ctrl');
  assert.equal(updatedPrompt.content, validUpdate.afterContent);
});

test('preset-assistant: 跨预设撤回先 flush 保住预设 B 未存改动 + gui 默认临时预设防误覆写保护', async () => {
  const disk = {
    预设A: {
      openai_max_context: 32768,
      openai_max_tokens: 2048,
      temperature: 0.9,
      prompts: [{ identifier: 'main', name: 'Main', role: 'system', system_prompt: true, content: 'A初始正文' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    },
    预设B: {
      openai_max_context: 16384,
      openai_max_tokens: 1024,
      temperature: 0.75,
      prompts: [{ identifier: 'main', name: 'Main', role: 'system', system_prompt: true, content: 'B初始正文' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    },
  };

  const hostArr = [structuredClone(disk.预设A), structuredClone(disk.预设B)];
  const hostNames = { 预设A: 0, 预设B: 1 };
  let activeVal = '0';

  const oai = {
    preset_settings_openai: '预设A',
    openai_max_context: 32768,
    openai_max_tokens: 2048,
    temp_openai: 0.9,
    prompts: structuredClone(disk.预设A.prompts),
    prompt_order: structuredClone(disk.预设A.prompt_order),
  };

  const ctx = {
    chatCompletionSettings: oai,
    getPresetManager: () => ({
      apiId: 'openai',
      getAllPresets: () => ['预设A', '预设B'],
      getPresetList: () => ({ presets: hostArr, preset_names: hostNames }),
      findPreset: n => (hostNames[n] !== undefined ? String(hostNames[n]) : undefined),
      getSelectedPreset: () => activeVal,
      getSelectedPresetName: () => (activeVal === '0' ? '预设A' : activeVal === '1' ? '预设B' : 'gui'),
      async selectPreset(v) {
        activeVal = String(v);
        const name = activeVal === '0' ? '预设A' : '预设B';
        const src = hostArr[Number(activeVal)];
        oai.preset_settings_openai = name;
        oai.openai_max_context = src.openai_max_context;
        oai.openai_max_tokens = src.openai_max_tokens;
        oai.temp_openai = src.temperature;
        oai.prompts = structuredClone(src.prompts);
        oai.prompt_order = structuredClone(src.prompt_order);
      },
    }),
    saveSettingsDebounced() {},
  };

  const mockSaveFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    disk[body.name] = structuredClone(body.preset);
    return { ok: true, json: async () => ({ name: body.name }) };
  };

  const autoSaver = createPresetAutoSaver({
    debounceMs: 5000, // 超长防抖，模拟未到期挂起态
    captureSnapshot: () => captureCurrentPresetSnapshot({ getContext: () => ctx, doc: null }),
    persistSnapshot: (targetName, payload) =>
      saveHostPreset(targetName, payload, {
        getContext: () => ctx,
        fetchImpl: mockSaveFetch,
        doc: null,
      }),
  });

  const undoStack = createPresetUndoStack();

  // 1. 在「预设A」让助手修改正文并应用，随后 flush 落盘预设A
  const planA = validateAndPreviewPresetOperations(
    [{ type: 'update_entry', identifier: 'main', content: 'A被助手改后正文' }],
    oai,
  );
  await applySelectedPresetOperations({
    previewItems: planA.items,
    undoStack,
    getContext: () => ctx,
    autoSaver,
    doc: null,
  });
  await autoSaver.flush();
  assert.equal(disk.预设A.prompts[0].content, 'A被助手改后正文');

  // 2. 玩家切到「预设B」，手工修改了预设B的温度与正文，此时挂在 autoSaver 防抖队列中尚未到期落盘！
  await ctx.getPresetManager().selectPreset('1');
  oai.temp_openai = 1.18;
  oai.prompts[0].content = 'B玩家手改未落盘正文';
  autoSaver.schedule();
  assert.equal(autoSaver.getPendingPresetName(), '预设B');
  assert.equal(disk.预设B.prompts[0].content, 'B初始正文', '防抖未触发前磁盘尚为旧值');

  // 3. 玩家立即点击「撤回修改」（撤回预设A的改动）：必须先自动 flush 保住预设B，再切回还原并落盘预设A！
  const undoRes = await undoLastPresetOperation({
    undoStack,
    getContext: () => ctx,
    autoSaver,
    fetchImpl: mockSaveFetch,
    doc: null,
  });
  assert.equal(undoRes.ok, true);
  assert.equal(undoRes.switchedPreset, true);
  assert.equal(disk.预设B.prompts[0].content, 'B玩家手改未落盘正文', '跨预设撤回前必须先落盘保住预设B的未存改动');
  assert.equal(disk.预设B.temperature, 1.18);
  assert.equal(oai.preset_settings_openai, '预设A');
  assert.equal(oai.prompts[0].content, 'A初始正文');
  assert.equal(disk.预设A.prompts[0].content, 'A初始正文');

  // 4. 验证 'gui' 默认临时预设应用与跨预设防误覆写保护
  activeVal = 'gui';
  oai.preset_settings_openai = 'gui';
  const guiPlan = validateAndPreviewPresetOperations(
    [{ type: 'update_params', temperature: 0.66 }],
    oai,
  );
  const guiApply = await applySelectedPresetOperations({
    previewItems: guiPlan.items,
    targetIsGuiPreset: true,
    undoStack,
    getContext: () => ctx,
    autoSaver,
    doc: null,
  });
  assert.equal(guiApply.ok, true);
  assert.equal(guiApply.isGuiPreset, true);
  assert.match(guiApply.message, /默认预设|内存/);

  // 切回正式「预设B」后点撤回：严禁把刚才 gui 临时预设的快照覆盖进正式「预设B」！
  await ctx.getPresetManager().selectPreset('1');
  const guiUndoOnB = await undoLastPresetOperation({
    undoStack,
    getContext: () => ctx,
    autoSaver,
    fetchImpl: mockSaveFetch,
    doc: null,
  });
  assert.equal(guiUndoOnB.ok, false);
  assert.equal(guiUndoOnB.reason, 'gui_preset_left');
  assert.equal(oai.prompts[0].content, 'B玩家手改未落盘正文', '预设B丝毫不受临时 gui 快照污染');
});

test('char-world-backend: 单人角色与群聊档案读取、V1+V2 双写保存及数组缩短零残尾校验', async () => {
  // 复刻酒馆后端 src/util.js 的 deepMerge 实现，验证合并后无残留、无稀疏 null
  const isPlainObj = x => Boolean(x && typeof x === 'object' && !Array.isArray(x));
  const stDeepMerge = (target, source) => {
    const out = Object.assign({}, target);
    if (isPlainObj(target) && isPlainObj(source)) {
      for (const k of Object.keys(source)) {
        if (isPlainObj(source[k])) {
          out[k] = k in target ? stDeepMerge(target[k], source[k]) : source[k];
        } else {
          out[k] = source[k];
        }
      }
    }
    return out;
  };

  let diskCard = {
    name: '裴敬之',
    description: '旧描述',
    personality: '克制内敛',
    scenario: '长安雨夜',
    first_mes: '主开场白原文',
    mes_example: '<START>\n示例',
    creatorcomment: '旧注释',
    data: {
      name: '裴敬之',
      description: '旧描述',
      personality: '克制内敛',
      scenario: '长安雨夜',
      first_mes: '主开场白原文',
      mes_example: '<START>\n示例',
      creator_notes: '旧注释',
      system_prompt: '旧角色Sys',
      post_history_instructions: '旧角色JB',
      alternate_greetings: ['备用二', '备用三', '备用四'],
      extensions: {
        world: '大唐风物志',
        depth_prompt: { prompt: '保留原有的深度提示', depth: 4, role: 'system' },
        talkativeness: '0.7',
      },
    },
  };

  const domInputs = {
    avatar_url_pole: { value: '裴敬之.png' },
    description_textarea: { value: '旧描述' },
    creator_notes_textarea: { value: '旧注释' },
    system_prompt_textarea: { value: '旧角色Sys' },
    character_world: { value: '大唐风物志' },
  };
  const mockDoc = {
    getElementById: id => domInputs[id] || null,
  };

  let editedEvents = 0;
  const mockCtx = {
    characterId: 0,
    groupId: null,
    characters: [
      {
        avatar: '裴敬之.png',
        ...structuredClone(diskCard),
      },
    ],
    chat: [{ name: '裴敬之', is_user: false, mes: '备用二' }],
    eventTypes: { CHARACTER_EDITED: 'character_edited' },
    eventSource: {
      async emit(evt) {
        if (evt === 'character_edited') editedEvents += 1;
      },
    },
    saveSettingsDebounced() {},
  };

  const profile = readActiveCharacterProfile(mockCtx, { doc: mockDoc });
  assert.equal(profile.kind, 'char');
  assert.equal(profile.entityKey, 'char:裴敬之.png');
  assert.equal(profile.greetings.length, 4);
  assert.equal(profile.activeFirstFloorIndex, 1, '应精准匹配当前第1楼正在展示的 #2 备用开场白');
  assert.equal(profile.descriptionCharCount, countUnicodeChars('旧描述'));

  // 删除 #3 备用开场白（原数组长度 3 -> 缩短为 2），并修改设定与作者注释
  const delGreeting = buildDeleteAlternateGreetingPatch(profile, 2);
  assert.equal(delGreeting.ok, true);
  assert.deepEqual(delGreeting.patch.alternateGreetings, ['备用二', '备用四']);
  assert.equal(
    buildDeleteAlternateGreetingPatch(profile, 0).ok,
    false,
    '主开场白 #1 必须受保护不可删除',
  );

  const mergeBodies = [];
  const mockFetch = async (url, init) => {
    assert.ok(String(url).endsWith('api/characters/merge-attributes'));
    const body = JSON.parse(init.body);
    mergeBodies.push(body);
    diskCard = stDeepMerge(diskCard, body);
    return { ok: true, status: 200 };
  };

  await saveCharacterProfilePatch(
    {
      description: '全新人物设定描述',
      creatorNotes: '新版食用指南',
      systemPrompt: '新版角色专属系统指令',
      alternateGreetings: delGreeting.patch.alternateGreetings,
      world: '长安暗桩录',
    },
    { getContext: () => mockCtx, fetchImpl: mockFetch, doc: mockDoc },
  );

  assert.equal(mergeBodies.length, 1);
  // 校验磁盘模拟合并后的 V1 + V2 完全一致、备用开场白缩短无残尾无 null、原有 extensions 字段完好保留
  assert.equal(diskCard.description, '全新人物设定描述');
  assert.equal(diskCard.data.description, '全新人物设定描述');
  assert.equal(diskCard.creatorcomment, '新版食用指南');
  assert.equal(diskCard.data.creator_notes, '新版食用指南');
  assert.equal(diskCard.data.system_prompt, '新版角色专属系统指令');
  assert.deepEqual(diskCard.data.alternate_greetings, ['备用二', '备用四']);
  assert.ok(
    diskCard.data.alternate_greetings.every(item => typeof item === 'string'),
    '缩短后的 alternate_greetings 必须全为合法字符串，零 null 零残尾',
  );
  assert.equal(diskCard.data.extensions.world, '长安暗桩录');
  assert.deepEqual(diskCard.data.extensions.depth_prompt, {
    prompt: '保留原有的深度提示',
    depth: 4,
    role: 'system',
  });

  // 校验宿主内存与原生表单同步
  assert.equal(mockCtx.characters[0].description, '全新人物设定描述');
  assert.equal(mockCtx.characters[0].data.extensions.world, '长安暗桩录');
  assert.equal(domInputs.description_textarea.value, '全新人物设定描述');
  assert.equal(domInputs.character_world.value, '长安暗桩录');
  assert.equal(editedEvents, 1);

  // 验证群聊模式档案读取
  const groupCtx = {
    characterId: undefined,
    groupId: 'grp_99',
    characters: mockCtx.characters,
    groups: [
      {
        id: 'grp_99',
        name: '长安夜宴群',
        avatar_url: 'img/five.png',
        members: ['裴敬之.png'],
        disabled_members: [],
      },
    ],
  };
  const groupProfile = readActiveCharacterProfile(groupCtx, { doc: mockDoc });
  assert.equal(groupProfile.kind, 'group');
  assert.equal(groupProfile.entityKey, 'group:grp_99');
  assert.equal(groupProfile.members.length, 1);
  assert.equal(groupProfile.members[0].name, '裴敬之');
  assert.equal(groupProfile.members[0].primaryWorld, '长安暗桩录');
});

test('char-world-backend: 开场白新增/编辑与「开局第1楼一键无损换开场白」边界防护', async () => {
  let chatSavedCount = 0;
  const mesTextNode = { textContent: '初始主开场白', innerHTML: '初始主开场白' };
  const swipeCounterNode = { textContent: '1/3' };
  const mockDoc = {
    querySelector(sel) {
      if (sel === '#chat .mes[mesid="0"]') {
        return {
          querySelector(sub) {
            if (sub === '.mes_text') return mesTextNode;
            if (sub === '.swipes-counter') return swipeCounterNode;
            return null;
          },
        };
      }
      return null;
    },
  };

  const ctx = {
    characterId: 0,
    groupId: null,
    characters: [
      {
        avatar: 'shen.png',
        name: '沈清晏',
        first_mes: '初始主开场白',
        data: {
          first_mes: '初始主开场白',
          alternate_greetings: ['雨夜相逢开场白', '朝堂对峙开场白'],
        },
      },
    ],
    chat: [
      {
        name: '沈清晏',
        is_user: false,
        is_system: false,
        send_date: '2026-11-18T10:00:00Z',
        mes: '初始主开场白',
        extra: { display_text: '旧缓存文本' },
      },
    ],
    async saveChatConditional() {
      chatSavedCount += 1;
    },
  };

  const addInfo = buildAddAlternateGreetingPatch(ctx.characters[0], '第三条新备用');
  assert.equal(addInfo.newGreetingIndex, 3);
  assert.equal(addInfo.patch.alternateGreetings.length, 3);

  const editMain = buildGreetingEditPatch(ctx.characters[0], 0, '改写后的主开场白');
  assert.deepEqual(editMain, { firstMes: '改写后的主开场白' });

  // 开局第 1 楼允许直接替换开场白
  assert.equal(canReplaceOpeningGreetingInChat(ctx).allowed, true);
  const res = await applyGreetingToFirstChatFloor(2, { getContext: () => ctx, doc: mockDoc });
  assert.equal(res.ok, true);
  assert.equal(ctx.chat[0].mes, '朝堂对峙开场白');
  assert.equal(ctx.chat[0].swipe_id, 2);
  assert.deepEqual(ctx.chat[0].swipes, ['初始主开场白', '雨夜相逢开场白', '朝堂对峙开场白']);
  assert.equal('display_text' in ctx.chat[0].extra, false, '应自动清理旧 display_text 防止重绘残留旧字');
  assert.equal(mesTextNode.textContent, '朝堂对峙开场白');
  assert.equal(swipeCounterNode.textContent, '3/3');
  assert.equal(chatSavedCount, 1);

  // 一旦进入第 2 楼后续对话，严格拒绝替换第 1 楼
  ctx.chat.push({ name: '你', is_user: true, mes: '你好' });
  const checkAfterReply = canReplaceOpeningGreetingInChat(ctx);
  assert.equal(checkAfterReply.allowed, false);
  assert.equal(checkAfterReply.reason, 'beyond_first_floor');
  const blockedRes = await applyGreetingToFirstChatFloor(1, { getContext: () => ctx, doc: mockDoc });
  assert.equal(blockedRes.ok, false);
  assert.equal(ctx.chat[0].mes, '朝堂对峙开场白', '超过1楼时绝不篡改已有聊天记录');
});

test('char-world-backend: 导出 PNG/JSON 角色卡前强制先 flush 未落盘草稿，文件名安全清洗', async () => {
  assert.equal(sanitizeExportFileStem('  裴敬之:典藏版?.png '), '裴敬之_典藏版_');
  assert.equal(sanitizeExportFileStem('...', 'character'), 'character');

  const callOrder = [];
  const ctx = {
    characterId: 0,
    groupId: null,
    characters: [
      {
        avatar: 'pei_v2.png',
        name: '裴敬之/夜雪',
        description: '旧设定',
        data: { name: '裴敬之/夜雪', description: '旧设定', alternate_greetings: [] },
      },
    ],
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    saveSettingsDebounced() {},
  };

  const mockFetch = async (url, init) => {
    const u = String(url);
    const body = JSON.parse(init.body);
    if (u.endsWith('api/characters/merge-attributes')) {
      callOrder.push(`merge:${body.description}`);
      return { ok: true, status: 200 };
    }
    if (u.endsWith('api/characters/export')) {
      callOrder.push(`export:${body.format}:${body.avatar_url}`);
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob([`mock-${body.format}-binary`], { type: 'application/octet-stream' }),
      };
    }
    return { ok: false, status: 404 };
  };

  const charSaver = createCharacterProfileAutoSaver({
    debounceMs: 10000, // 超长防抖模拟尚未到期的草稿
    persistPatch: record =>
      saveCharacterProfilePatch(record.patch, {
        getContext: () => ctx,
        chid: record.chid,
        avatar: record.avatar,
        fetchImpl: mockFetch,
        doc: null,
      }),
  });

  charSaver.schedule({
    chid: 0,
    avatar: 'pei_v2.png',
    patch: { description: '刚改完还没到350ms的新设定' },
  });
  assert.equal(callOrder.length, 0, '防抖期内尚未请求后端');

  const downloads = [];
  const pngRes = await exportActiveCharacterCard('png', {
    getContext: () => ctx,
    flushPendingSave: () => charSaver.flush(),
    fetchImpl: mockFetch,
    doc: null,
    triggerDownload: (blob, fileName) => downloads.push({ fileName, size: blob.size }),
  });

  assert.equal(pngRes.ok, true);
  assert.equal(pngRes.fileName, '裴敬之_夜雪.png');
  assert.deepEqual(
    callOrder,
    ['merge:刚改完还没到350ms的新设定', 'export:png:pei_v2.png'],
    '导出前必须先完成草稿 merge-attributes 落盘，再调用 export 读取最新角色卡',
  );

  const jsonRes = await exportActiveCharacterCard('json', {
    getContext: () => ctx,
    flushPendingSave: () => charSaver.flush(),
    fetchImpl: mockFetch,
    doc: null,
    triggerDownload: (blob, fileName) => downloads.push({ fileName, size: blob.size }),
  });
  assert.equal(jsonRes.fileName, '裴敬之_夜雪.json');
  assert.equal(downloads.length, 2);
});

test('char-world-backend: 生效世界书四源聚合、未启用防假生效诊断、一键绑卡/全局开关与预设槽位修复', async () => {
  resetCachedHostWorldInfoModule();

  const worldSelectOptions = [
    { value: '', textContent: '--- 选择世界书 ---', selected: false },
    { value: '0', textContent: '主线世界观', selected: false },
    { value: '1', textContent: '门派附加志', selected: false },
    { value: '2', textContent: '当前支线书', selected: false },
    { value: '3', textContent: '通用常识库', selected: true },
    { value: '4', textContent: '吃灰未启用设定集', selected: false },
  ];
  let worldSelectChangeEvents = 0;
  const mockWorldSelect = {
    options: worldSelectOptions,
    appendChild(opt) {
      worldSelectOptions.push(opt);
    },
    dispatchEvent(evt) {
      if (evt.type === 'change') worldSelectChangeEvents += 1;
    },
  };
  const mockDoc = {
    getElementById: id => (id === 'world_info' ? mockWorldSelect : null),
    createElement: () => ({ value: '', textContent: '', selected: false }),
  };

  const mockWiMod = {
    world_names: ['主线世界观', '门派附加志', '当前支线书', '通用常识库', '吃灰未启用设定集'],
    selected_world_info: ['通用常识库'],
    world_info: {
      charLore: [{ name: '裴敬之', extraBooks: ['门派附加志'] }],
    },
  };
  await primeHostWorldInfoModule({ worldInfoModule: mockWiMod });

  const mockOai = {
    preset_settings_openai: '测试预设',
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', system_prompt: true, content: 'sys' },
      { identifier: 'worldInfoBefore', name: 'WI Before', marker: true },
      { identifier: 'worldInfoAfter', name: 'WI After', marker: true },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'worldInfoBefore', enabled: false },
          { identifier: 'worldInfoAfter', enabled: false },
        ],
      },
    ],
  };

  const ctx = {
    mainApi: 'openai',
    characterId: 0,
    groupId: null,
    characters: [
      {
        avatar: '裴敬之.png',
        name: '裴敬之',
        data: { extensions: { world: '主线世界观' } },
      },
    ],
    chatMetadata: { world_info: '当前支线书' },
    chatCompletionSettings: mockOai,
    saveSettingsDebounced() {},
  };

  // 1. 四源聚合与默认选中书目验证
  const state = resolveWorldInfoActivationState({ getContext: () => ctx, doc: mockDoc });
  assert.equal(state.defaultBookName, '主线世界观', '有角色主书时打开世界书必须默认选中角色主书');
  assert.deepEqual(state.activeBookNames, ['主线世界观', '门派附加志', '当前支线书', '通用常识库']);
  assert.equal(state.activeBooks[0].badgeLabel, '角色主书');
  assert.equal(state.activeBooks[1].badgeLabel, '角色附加书');
  assert.equal(state.activeBooks[2].badgeLabel, '当前聊天书');
  assert.equal(state.activeBooks[3].badgeLabel, '全局开启');

  // 2. 查看「吃灰未启用设定集」时必须立刻产出防假生效强预警
  const inactiveDiag = inspectWorldBookActivation('吃灰未启用设定集', state);
  assert.equal(inactiveDiag.isActive, false);
  assert.equal(inactiveDiag.needsActivationWarning, true);
  assert.equal(inactiveDiag.warningText, '该世界书当前未启用，修改内容不会发给 AI！');
  assert.equal(inactiveDiag.canBindToChar, true);
  assert.equal(inactiveDiag.canEnableGlobal, true);

  // 3. 点「开启为全局世界书」-> 同步原生 #world_info option.selected + change 事件 + selected_world_info！
  setGlobalWorldBookEnabled('吃灰未启用设定集', true, { getContext: () => ctx, doc: mockDoc });
  assert.equal(worldSelectOptions[5].selected, true);
  assert.equal(worldSelectChangeEvents, 1);
  assert.ok(mockWiMod.selected_world_info.includes('吃灰未启用设定集'));

  const stateAfterGlobal = resolveWorldInfoActivationState({ getContext: () => ctx, doc: mockDoc });
  assert.equal(
    inspectWorldBookActivation('吃灰未启用设定集', stateAfterGlobal).needsActivationWarning,
    false,
    '开启全局后防假生效警告应立即消除',
  );

  // 4. 一键新建专属世界书并绑为角色主书
  const mockSaveFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  let savedBooks = {};
  mockWiMod.saveWorldInfo = async (name, data) => {
    savedBooks[name] = structuredClone(data);
  };
  const createdBook = await createHostWorldBook('裴敬之设定集', {
    bindToCurrentChar: true,
    createStarterEntry: true,
    getContext: () => ctx,
    fetchImpl: mockSaveFetch,
    doc: mockDoc,
  });
  assert.equal(createdBook.ok, true);
  assert.equal(createdBook.bookName, '裴敬之设定集');
  assert.equal(ctx.characters[0].data.extensions.world, '裴敬之设定集');
  assert.ok(savedBooks['裴敬之设定集']);
  assert.equal(resolveUniqueWorldBookName('裴敬之设定集', mockWiMod.world_names), '裴敬之设定集 (2)');

  // 5. 预设世界书槽位双双关闭自检与一键修复
  const slotBefore = inspectPresetWorldInfoSlots({ getContext: () => ctx });
  assert.equal(slotBefore.bothDisabled, true);
  assert.match(slotBefore.warningText, /关闭了「世界书」占位槽/);

  const fixRes = await enablePresetWorldInfoSlots({
    getContext: () => ctx,
    fetchImpl: mockSaveFetch,
    doc: null,
  });
  assert.equal(fixRes.ok, true);
  assert.deepEqual(fixRes.toggledIds, ['worldInfoBefore', 'worldInfoAfter']);
  assert.equal(inspectPresetWorldInfoSlots({ getContext: () => ctx }).bothDisabled, false);

  resetCachedHostWorldInfoModule();
});

test('char-world-backend: 人话蓝绿灯切换、绿灯空词预警、中英文逗号关键词解析及 300ms 防串书自动落盘', async () => {
  // 1. 中英文全角半角逗号 + 换行 + 正则键保护解析
  assert.deepEqual(parseWorldInfoKeywords(' 青云宗，藏剑阁, 禁地\n掌门 ，青云宗 '), [
    '青云宗',
    '藏剑阁',
    '禁地',
    '掌门',
  ]);
  assert.deepEqual(parseWorldInfoKeywords('/剑意|剑心,无痕/i，昆仑'), [
    '/剑意|剑心,无痕/i',
    '昆仑',
  ]);
  assert.equal(formatWorldInfoKeywords(['青云宗', '藏剑阁']), '青云宗, 藏剑阁');

  // 2. 蓝绿灯状态、绿灯空词智能预警与条目增删改搜
  const bookA = {
    entries: {
      0: {
        uid: 0,
        comment: '世界底层法则',
        constant: true,
        disable: false,
        key: [],
        position: 0,
        order: 80,
        content: '灵气复苏纪元。',
      },
      1: {
        uid: 1,
        comment: '空词绿灯陷阱条目',
        constant: false,
        disable: false,
        key: ['   '],
        position: 1,
        order: 100,
        content: '这段因为没写触发词原本永远不会生效！',
      },
    },
  };

  let stats = readWorldInfoEntries(bookA);
  assert.equal(stats.totalCount, 2);
  assert.equal(stats.constantCount, 1);
  assert.equal(stats.keywordCount, 1);
  assert.equal(stats.emptyKeyWarnCount, 1);
  assert.equal(stats.entries[0].triggerLabel, '一直生效');
  assert.equal(stats.entries[0].hasEmptyKeywordWarning, false, '蓝灯一直生效无需触发词不报警');
  assert.equal(stats.entries[1].triggerLabel, '提到词触发');
  assert.equal(stats.entries[1].hasEmptyKeywordWarning, true, '开启态绿灯且关键词为空必须触发空词预警');

  // 填入中文逗号关键词后，绿灯空词预警立即自动解除
  updateWorldInfoBookEntry(bookA, 1, {
    key: '锁妖塔，玄铁重剑',
    position: 4,
    depth: 2,
    role: 1,
  });
  stats = readWorldInfoEntries(bookA);
  assert.equal(stats.entries[1].hasEmptyKeywordWarning, false);
  assert.deepEqual(stats.entries[1].keys, ['锁妖塔', '玄铁重剑']);
  assert.equal(stats.entries[1].positionShortLabel, '@D2 USER');
  assert.equal(WI_POSITION_OPTIONS.length >= 7, true);
  assert.equal(WI_DEPTH_ROLE_OPTIONS.length, 3);

  // 蓝绿灯胶囊一键来回切换 + 总开关停用 + 新增/搜索/删除
  assert.equal(cycleWorldInfoEntryTriggerMode(bookA, 0), 'keyword');
  assert.equal(readWorldInfoEntries(bookA).entries[0].hasEmptyKeywordWarning, true);
  assert.equal(setWorldInfoEntryTriggerMode(bookA, 0, 'constant'), 'constant');
  assert.equal(toggleWorldInfoEntryEnabled(bookA, 0), false);

  const newEntry = createWorldInfoBookEntry(bookA, {
    comment: '太医院档案',
    key: '太医院, 脉案',
    constant: false,
    content: '宫廷秘药记录',
  });
  assert.equal(newEntry.uid, 2);
  assert.equal(newEntry.constant, false);

  const allNow = readWorldInfoEntries(bookA).entries;
  assert.equal(filterWorldInfoEntries(allNow, { filterMode: 'disabled' }).length, 1);
  assert.equal(filterWorldInfoEntries(allNow, { query: '脉案' }).length, 1);
  assert.equal(deleteWorldInfoBookEntry(bookA, 2).ok, true);
  assert.equal(readWorldInfoEntries(bookA).totalCount, 2);

  // 3. 验证 loadHostWorldBook / saveHostWorldBook 与 300ms 防串书自动落盘队列
  const savedDisk = {
    书目甲: structuredClone(bookA),
    书目乙: {
      entries: {
        0: { uid: 0, comment: '乙书原条目', constant: true, disable: false, key: [], content: '乙初始' },
      },
    },
  };
  const immediateFlags = [];
  const mockWiMod = {
    async loadWorldInfo(name) {
      return savedDisk[name] ? structuredClone(savedDisk[name]) : null;
    },
    async saveWorldInfo(name, data, immediately) {
      immediateFlags.push({ name, immediately });
      savedDisk[name] = structuredClone(data);
    },
  };

  const loadedA = await loadHostWorldBook('书目甲', { worldInfoModule: mockWiMod });
  const loadedB = await loadHostWorldBook('书目乙', { worldInfoModule: mockWiMod });

  const saver = createWorldBookAutoSaver({
    debounceMs: 5000, // 模拟 300ms 尚未到期的挂起窗口
    persistBook: (bookName, snapshot) =>
      saveHostWorldBook(bookName, snapshot, { worldInfoModule: mockWiMod }),
  });

  // 先改「书目甲」挂进防抖队列，随即立刻切到「书目乙」修改
  updateWorldInfoBookEntry(loadedA, 0, { content: '甲书修改后正文' });
  saver.schedule('书目甲', loadedA);
  assert.equal(saver.getPendingBookName(), '书目甲');

  updateWorldInfoBookEntry(loadedB, 0, { content: '乙书修改后正文' });
  saver.schedule('书目乙', loadedB);
  assert.equal(saver.getPendingBookName(), '书目乙');

  await saver.flush();

  assert.equal(savedDisk.书目甲.entries[0].content, '甲书修改后正文', '切书时书目甲改动必须独立落盘不丢失');
  assert.equal(savedDisk.书目乙.entries[0].content, '乙书修改后正文', '书目乙改动必须精准写入书目乙绝不串书');
  assert.deepEqual(immediateFlags, [
    { name: '书目甲', immediately: true },
    { name: '书目乙', immediately: true },
  ]);
});

test('char-world-backend: 开局第1楼换开场白精准解析 {{user}}/{{char}} 宏、保护显示级美化正则并支持已展开宏序号反查', async () => {
  resetCachedHostWorldInfoModule();

  assert.equal(
    substituteOpeningGreetingMacros('你好，{{user}}！我是{{char}}。', {
      ctx: { name1: '清砚' },
      charName: '沈清晏',
    }),
    '你好，清砚！我是沈清晏。',
  );

  // 场景 A：对齐酒馆真实 script.js (getFirstMessage 持久化级 AI_OUTPUT 正则 + updateMessageBlock/messageFormatting 渲染级美化正则)
  const mesTextNodeA = { textContent: '', innerHTML: '' };
  const swipeCounterNodeA = { textContent: '1/2' };
  let swipeRefreshCount = 0;
  const mockDocA = {
    querySelector(sel) {
      if (sel === '#chat .mes[mesid="0"]') {
        return {
          querySelector(sub) {
            if (sub === '.mes_text') return mesTextNodeA;
            if (sub === '.swipes-counter') return swipeCounterNodeA;
            return null;
          },
        };
      }
      return null;
    },
  };

  // 模拟 regex/engine.js：不带 isMarkdown 时仅执行持久化替换；带 isMarkdown:true 时执行 HTML 美化卡片包裹
  const mockRegexEngine = {
    regex_placement: { AI_OUTPUT: 2 },
    getRegexedString(str, placement, options = {}) {
      if (placement !== 2) return str;
      if (options?.isMarkdown) {
        return `<div class="pretty-card">${str}</div>`;
      }
      return str.replace(/\[RAW_TAG\]/g, '[CLEAN_TAG]');
    },
  };

  const ctxA = {
    name1: '清砚',
    name2: '沈清晏',
    characterId: 0,
    groupId: null,
    characters: [
      {
        avatar: 'shen.png',
        name: '沈清晏',
        first_mes: '初见，{{user}}。',
        data: {
          first_mes: '初见，{{user}}。',
          alternate_greetings: ['[RAW_TAG] 久违了，{{user}}，{{char}}在此候你多时。'],
        },
      },
    ],
    chat: [
      {
        name: '沈清晏',
        is_user: false,
        is_system: false,
        mes: '初见，清砚。', // 酒馆首帧渲染后已将 {{user}} 替换为「清砚」
        swipes: ['初见，清砚。', '[CLEAN_TAG] 久违了，{{user}}，{{char}}在此候你多时。'],
        swipe_id: 0,
        extra: {},
      },
    ],
    substituteParams(text, _name1Override, chName) {
      return String(text)
        .replace(/\{\{user\}\}/gi, '清砚')
        .replace(/\{\{char\}\}/gi, chName || '沈清晏');
    },
    updateMessageBlock(mesId, message) {
      // 模拟酒馆 script.js:2033 updateMessageBlock -> messageFormatting(..., 0)
      const before = message.mes;
      const expanded = ctxA.substituteParams(before, undefined, message.name);
      if (message.mes === before) {
        message.mes = expanded;
      }
      mesTextNodeA.innerHTML = mockRegexEngine.getRegexedString(expanded, 2, { isMarkdown: true });
    },
    swipe: {
      refresh() {
        swipeRefreshCount += 1;
      },
    },
    async saveChatConditional() {},
  };

  // 即使 chat[0].mes 中的 {{user}} 已被酒馆替换为「清砚」，readActiveCharacterProfile 仍必须精准识别第 0 条生效中！
  const initialProfile = readActiveCharacterProfile(ctxA, { doc: mockDocA });
  assert.equal(initialProfile.activeFirstFloorIndex, 0, '应穿透 {{user}} 宏替换准确识别当前第1楼对应的主开场白');

  const resA = await applyGreetingToFirstChatFloor(1, {
    getContext: () => ctxA,
    regexModule: mockRegexEngine,
    doc: mockDocA,
  });
  assert.equal(resA.ok, true);
  assert.equal(
    ctxA.chat[0].mes,
    '[CLEAN_TAG] 久违了，清砚，沈清晏在此候你多时。',
    'chat[0].mes 必须完成持久化正则与 {{user}}/{{char}} 宏解析，且绝不混入 HTML 美化包裹',
  );
  assert.equal(
    mesTextNodeA.innerHTML,
    '<div class="pretty-card">[CLEAN_TAG] 久违了，清砚，沈清晏在此候你多时。</div>',
    'DOM .mes_text 必须保留显示级正则美化脚本效果',
  );
  assert.equal(swipeRefreshCount, 1);

  const afterProfile = readActiveCharacterProfile(ctxA, { doc: mockDocA });
  assert.equal(afterProfile.activeFirstFloorIndex, 1, '切换至 #2 备用开场白后应准确亮起 #2 生效标记');

  // 场景 B：最小回退环境（无 updateMessageBlock / 无 messageFormatting）也不得裸露 {{user}} / {{char}}
  const mesTextNodeB = { textContent: '' };
  const mockDocB = {
    querySelector: sel =>
      sel === '#chat .mes[mesid="0"]'
        ? { querySelector: sub => (sub === '.mes_text' ? mesTextNodeB : null) }
        : null,
  };
  const ctxB = {
    name1: '阿砚',
    name2: '裴敬之',
    characterId: 0,
    groupId: null,
    characters: [
      {
        avatar: 'pei.png',
        name: '裴敬之',
        first_mes: '你好 {{user}}，我是 {{char}}',
        data: { first_mes: '你好 {{user}}，我是 {{char}}', alternate_greetings: [] },
      },
    ],
    chat: [{ name: '裴敬之', is_user: false, is_system: false, mes: '旧文本', extra: {} }],
    async saveChatConditional() {},
  };
  const resB = await applyGreetingToFirstChatFloor(0, { getContext: () => ctxB, doc: mockDocB });
  assert.equal(resB.ok, true);
  assert.equal(ctxB.chat[0].mes, '你好 阿砚，我是 裴敬之');
  assert.equal(mesTextNodeB.textContent, '你好 阿砚，我是 裴敬之');
});

test('char-world-backend: 新建世界书与 world_names / #world_info / #world_editor_select 内存下标对账，零刷新当场生效', async () => {
  resetCachedHostWorldInfoModule();

  const worldSelectOpts = [
    { value: '', textContent: '--- Pick ---', selected: false },
    { value: '0', textContent: '基础世界书', selected: false },
  ];
  const editorSelectOpts = [
    { value: '', textContent: '--- Edit ---', selected: false },
    { value: '0', textContent: '基础世界书', selected: false },
  ];

  const mockWiMod = {
    world_names: ['基础世界书'],
    selected_world_info: [],
    savedBooks: {},
    async saveWorldInfo(name, data) {
      this.savedBooks[name] = structuredClone(data);
    },
    async createNewWorldInfo(rawName) {
      // 模拟酒馆后端 getSanitizedFilename 清洗掉尾部空格/点号后写入磁盘，并通过 updateWorldInfoList 更新 world_names
      const sanitized = String(rawName).replace(/[.\s]+$/, '');
      this.savedBooks[sanitized] = { entries: {} };
      this.world_names.push(sanitized);
      worldSelectOpts.push({
        value: String(this.world_names.length - 1),
        textContent: sanitized,
        selected: false,
      });
      editorSelectOpts.push({
        value: String(this.world_names.length - 1),
        textContent: sanitized,
        selected: true,
      });
      return true;
    },
  };

  // 模拟酒馆 world-info.js:5824 onWorldInfoChange('__notSlashCommand__')：严格按 option.value 数字下标查当前模块 world_names[idx]！
  let activeHostWiMod = mockWiMod;
  const mockWorldSelect = {
    options: worldSelectOpts,
    appendChild(opt) {
      worldSelectOpts.push(opt);
    },
    dispatchEvent(evt) {
      if (evt.type === 'change') {
        const picked = [];
        for (const opt of worldSelectOpts) {
          if (opt.value !== '' && opt.selected) {
            const idx = Number(opt.value);
            const hitName = activeHostWiMod.world_names[idx];
            assert.ok(hitName, `onWorldInfoChange 按下标 ${idx} 查 world_names 绝不能为 undefined`);
            picked.push(hitName);
          }
        }
        activeHostWiMod.selected_world_info = picked;
      }
    },
  };
  const mockEditorSelect = {
    options: editorSelectOpts,
    appendChild(opt) {
      editorSelectOpts.push(opt);
    },
  };
  const mockDoc = {
    getElementById(id) {
      if (id === 'world_info') return mockWorldSelect;
      if (id === 'world_editor_select') return mockEditorSelect;
      return null;
    },
    createElement: () => ({ value: '', textContent: '', selected: false }),
  };

  let reloadedEditorBook = '';
  const ctx = {
    characterId: 0,
    groupId: null,
    characters: [{ avatar: 'lin.png', name: '林疏影', data: { extensions: { world: '' } } }],
    getWorldInfoNames: () => [...mockWiMod.world_names],
    async reloadWorldInfoEditor(bookName) {
      reloadedEditorBook = bookName;
    },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    saveSettingsDebounced() {},
  };

  // 1. 走官方 createNewWorldInfo + enableGlobal 立即激活，验证 world_names 与 #world_info 下标严格对齐
  const created1 = await createHostWorldBook('九州风物志', {
    enableGlobal: true,
    createStarterEntry: true,
    getContext: () => ctx,
    worldInfoModule: mockWiMod,
    doc: mockDoc,
  });
  assert.equal(created1.ok, true);
  assert.equal(created1.bookName, '九州风物志');
  assert.ok(mockWiMod.world_names.includes('九州风物志'), '新世界书必须立即注册进 world_names');
  assert.ok(
    mockWiMod.selected_world_info.includes('九州风物志'),
    '触发 #world_info change 后必须通过下标反查成功进入 selected_world_info',
  );
  assert.equal(reloadedEditorBook, '九州风物志', '附带初始条目时应通知原生编辑器重载最新条目');
  assert.equal(
    Object.keys(mockWiMod.savedBooks['九州风物志'].entries).length,
    1,
    '新建书目应包含初始条目',
  );

  // 2. 走离线/回退路径（无 createNewWorldInfo，仅 ctx.saveWorldInfo + DOM 兜底注入），验证 #world_info 与 #world_editor_select 双下拉同步
  const fallbackWiMod = {
    world_names: ['基础世界书', '九州风物志'],
    selected_world_info: ['九州风物志'],
  };
  activeHostWiMod = fallbackWiMod;
  const created2 = await createHostWorldBook('角色专属秘卷', {
    bindToCurrentChar: true,
    enableGlobal: true,
    getContext: () => ({
      ...ctx,
      saveWorldInfo: async (n, d) => {
        mockWiMod.savedBooks[n] = d;
      },
    }),
    worldInfoModule: fallbackWiMod,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    doc: mockDoc,
  });
  assert.equal(created2.bookName, '角色专属秘卷');
  assert.ok(fallbackWiMod.world_names.includes('角色专属秘卷'));
  assert.equal(ctx.characters[0].data.extensions.world, '角色专属秘卷');
  assert.ok(
    editorSelectOpts.some(o => o.textContent === '角色专属秘卷' && o.value === '2'),
    '#world_editor_select 也必须同步注入精确索引 option',
  );

  const actState = resolveWorldInfoActivationState({
    getContext: () => ctx,
    worldInfoModule: fallbackWiMod,
    doc: mockDoc,
  });
  assert.ok(actState.activeBookNames.includes('九州风物志'));
  assert.ok(actState.activeBookNames.includes('角色专属秘卷'));

  resetCachedHostWorldInfoModule();
});

function createMiniDomHarness() {
  const idMap = new Map();

  class MiniElement {
    constructor(tagName, ownerDoc) {
      this.tagName = String(tagName || 'DIV').toUpperCase();
      this.ownerDocument = ownerDoc;
      this.children = [];
      this.parentNode = null;
      this._id = '';
      this.className = '';
      this.textContent = '';
      this._innerHTML = '';
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.selected = false;
      this.value = '';
      this.type = '';
      this.title = '';
      this.placeholder = '';
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      const self = this;
      this.style = {
        _props: new Map(),
        setProperty(k, v) {
          this._props.set(k, String(v));
        },
        removeProperty(k) {
          this._props.delete(k);
        },
        getPropertyValue(k) {
          return this._props.get(k) || '';
        },
      };
      this.classList = {
        _set() {
          return new Set(String(self.className || '').split(/\s+/).filter(Boolean));
        },
        add(...tokens) {
          const s = this._set();
          for (const t of tokens) if (t) s.add(t);
          self.className = [...s].join(' ');
        },
        remove(...tokens) {
          const s = this._set();
          for (const t of tokens) s.delete(t);
          self.className = [...s].join(' ');
        },
        toggle(token, force) {
          const s = this._set();
          const next = force === undefined ? !s.has(token) : Boolean(force);
          if (next) s.add(token);
          else s.delete(token);
          self.className = [...s].join(' ');
          return next;
        },
        contains(token) {
          return this._set().has(token);
        },
      };
    }

    get id() {
      return this._id;
    }

    set id(val) {
      if (this._id && idMap.get(this._id) === this) {
        idMap.delete(this._id);
      }
      this._id = String(val || '');
      if (this._id) {
        idMap.set(this._id, this);
      }
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(val) {
      this._innerHTML = String(val || '');
    }

    get childNodes() {
      return this.children;
    }

    get firstChild() {
      return this.children[0] || null;
    }

    get firstElementChild() {
      return this.children[0] || null;
    }

    get lastElementChild() {
      return this.children[this.children.length - 1] || null;
    }

    get parentElement() {
      return this.parentNode;
    }

    get isConnected() {
      let cur = this;
      while (cur) {
        if (
          cur === this.ownerDocument.body ||
          cur === this.ownerDocument.head ||
          cur === this.ownerDocument.documentElement
        ) {
          return true;
        }
        cur = cur.parentNode;
      }
      return false;
    }

    get options() {
      if (this.tagName !== 'SELECT') return undefined;
      return this.children.filter(c => c.tagName === 'OPTION');
    }

    get selectedOptions() {
      if (this.tagName !== 'SELECT') return undefined;
      return this.options.filter(o => o.selected || o.value === this.value);
    }

    setAttribute(k, v) {
      const str = String(v);
      this.attributes.set(k, str);
      if (k === 'id') this.id = str;
      if (k === 'class') this.className = str;
    }

    getAttribute(k) {
      if (k === 'id') return this._id || null;
      if (k === 'src') return this.src || this.attributes.get('src') || null;
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }

    removeAttribute(k) {
      this.attributes.delete(k);
    }

    hasAttribute(k) {
      if (k === 'id') return Boolean(this._id);
      return this.attributes.has(k);
    }

    appendChild(child) {
      if (!child) return child;
      if (child.parentNode) {
        child.remove();
      }
      child.parentNode = this;
      this.children.push(child);
      if (this.tagName === 'SELECT' && child.tagName === 'OPTION' && (child.selected || !this.value)) {
        if (child.selected) this.value = child.value;
      }
      return child;
    }

    append(...nodes) {
      for (const n of nodes) {
        if (n == null) continue;
        if (typeof n === 'string') {
          const span = new MiniElement('SPAN', this.ownerDocument);
          span.textContent = n;
          this.appendChild(span);
        } else {
          this.appendChild(n);
        }
      }
    }

    prepend(...nodes) {
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const n = nodes[i];
        if (!n) continue;
        if (n.parentNode) n.remove();
        n.parentNode = this;
        this.children.unshift(n);
      }
    }

    insertBefore(newNode, refNode) {
      if (!newNode) return newNode;
      if (newNode.parentNode) newNode.remove();
      newNode.parentNode = this;
      const idx = this.children.indexOf(refNode);
      if (idx === -1) this.children.push(newNode);
      else this.children.splice(idx, 0, newNode);
      return newNode;
    }

    replaceChildren(...nodes) {
      for (const c of this.children) {
        c.parentNode = null;
      }
      this.children = [];
      this.append(...nodes);
    }

    remove() {
      if (this._id && idMap.get(this._id) === this) {
        idMap.delete(this._id);
      }
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) this.parentNode.children.splice(idx, 1);
        this.parentNode = null;
      }
    }

    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }

    matchesSimple(sel) {
      const s = sel.trim();
      if (!s) return false;
      if (s.startsWith('#')) return this._id === s.slice(1);
      if (s.startsWith('.')) {
        const classes = s.slice(1).split('.');
        return classes.every(c => this.classList.contains(c));
      }
      return this.tagName === s.toUpperCase();
    }

    closest(selectorList) {
      const parts = String(selectorList || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);
      let cur = this;
      while (cur) {
        if (parts.some(p => cur.matchesSimple?.(p))) return cur;
        cur = cur.parentNode;
      }
      return null;
    }

    findAll(predicate, out = []) {
      for (const c of this.children) {
        if (predicate(c)) out.push(c);
        c.findAll(predicate, out);
      }
      return out;
    }

    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }

    querySelectorAll(sel) {
      const s = String(sel || '').trim();
      if (s === ':scope > .drawer') {
        return this.children.filter(c => c.classList.contains('drawer'));
      }
      if (s === ':scope > .drawer-content') {
        return this.children.filter(c => c.classList.contains('drawer-content'));
      }
      if (s === ':scope > .drawer-content.openDrawer') {
        return this.children.filter(
          c => c.classList.contains('drawer-content') && c.classList.contains('openDrawer'),
        );
      }
      if (s === ':scope > .drawer-toggle') {
        return this.children.filter(c => c.classList.contains('drawer-toggle'));
      }
      if (s === ':scope > .drawer > .drawer-content') {
        const res = [];
        for (const d of this.children.filter(c => c.classList.contains('drawer'))) {
          for (const dc of d.children.filter(c => c.classList.contains('drawer-content'))) {
            res.push(dc);
          }
        }
        return res;
      }
      if (s === '#top-settings-holder > .drawer') {
        const holder = idMap.get('top-settings-holder');
        return holder ? holder.children.filter(c => c.classList.contains('drawer')) : [];
      }
      return this.findAll(node => node.matchesSimple(s));
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }

    removeEventListener(type, fn) {
      const arr = this.listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }

    dispatchEvent(evt) {
      const e = evt || { type: 'unknown' };
      e.target ||= this;
      e.preventDefault ||= () => {};
      e.stopPropagation ||= () => {};
      const arr = [...(this.listeners.get(e.type) || [])];
      for (const fn of arr) {
        fn(e);
      }
      return true;
    }

    click() {
      this.dispatchEvent({ type: 'click', target: this });
    }

    focus() {
      this.ownerDocument.activeElement = this;
    }

    getBoundingClientRect() {
      return { left: 120, top: 0, width: 760, height: 640 };
    }
  }

  const doc = {
    baseURI: '',
    activeElement: null,
    body: null,
    listeners: new Map(),
    createElement(tag) {
      return new MiniElement(tag, doc);
    },
    createElementNS(_ns, tag) {
      return new MiniElement(tag, doc);
    },
    getElementById(id) {
      return idMap.get(id) || null;
    },
    querySelector(sel) {
      return doc.body.querySelector(sel);
    },
    querySelectorAll(sel) {
      return doc.body.querySelectorAll(sel);
    },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = this.listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
  };
  doc.documentElement = new MiniElement('HTML', doc);
  doc.head = new MiniElement('HEAD', doc);
  doc.body = new MiniElement('BODY', doc);
  doc.documentElement.append(doc.head, doc.body);

  const topHolder = doc.createElement('div');
  topHolder.id = 'top-settings-holder';
  const sheld = doc.createElement('div');
  sheld.id = 'sheld';
  const presetSelect = doc.createElement('select');
  presetSelect.id = 'settings_preset_openai';
  const opt1 = doc.createElement('option');
  opt1.value = '0';
  opt1.textContent = '破限主力预设';
  opt1.selected = true;
  const opt2 = doc.createElement('option');
  opt2.value = '1';
  opt2.textContent = '古风慢热预设';
  presetSelect.append(opt1, opt2);
  presetSelect.value = '0';

  const extMenu = doc.createElement('div');
  extMenu.id = 'extensionsMenu';
  const extSettings = doc.createElement('div');
  extSettings.id = 'extensions_settings2';

  doc.body.append(topHolder, sheld, presetSelect, extMenu, extSettings);
  return { doc, MiniElement };
}

test('dock focus & cross-module integration: 四大 Dock 防吞焦点、lastDockDismissedAt、内联改名同频顶栏与切卡安全 flush', async () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevFetch = globalThis.fetch;

  const { doc } = createMiniDomHarness();
  globalThis.document = doc;
  globalThis.window = { innerWidth: 1280, innerHeight: 820 };

  const mergeRequests = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api/secrets/read')) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (u.includes('api/characters/merge-attributes')) {
      mergeRequests.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const extSettings = {};
    const ctx = {
      extensionSettings: extSettings,
      mainApi: 'openai',
      characterId: 0,
      groupId: null,
      chatId: 'chat_shen_1',
      name1: '清砚',
      name2: '沈清晏',
      characters: [
        {
          avatar: 'shen.png',
          name: '沈清晏',
          description: '镇抚司指挥使。',
          first_mes: '你好，{{user}}。',
          data: {
            name: '沈清晏',
            description: '镇抚司指挥使。',
            first_mes: '你好，{{user}}。',
            alternate_greetings: [],
            extensions: { world: '锦衣夜行录' },
          },
        },
        {
          avatar: 'lin.png',
          name: '林疏影',
          description: '江南琴师。',
          first_mes: '公子请坐。',
          data: {
            name: '林疏影',
            description: '江南琴师。',
            first_mes: '公子请坐。',
            alternate_greetings: [],
            extensions: { world: '江南烟雨志' },
          },
        },
      ],
      chat: [{ name: '沈清晏', is_user: false, is_system: false, mes: '你好，清砚。' }],
      chatCompletionSettings: {
        chat_completion_source: 'custom',
        custom_url: 'https://api.example.com/v1',
        custom_model: 'claude-sonnet-4-6',
        preset_settings_openai: '破限主力预设',
        openai_max_context: 65536,
        openai_max_tokens: 4096,
        temp_openai: 1.0,
        prompts: [
          { identifier: 'main', name: '主提示词', role: 'system', system_prompt: true, content: '写实文风' },
        ],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      },
      getPresetManager: () => ({
        getSelectedPresetName: () => ctx.chatCompletionSettings.preset_settings_openai,
        getPresetList: () => ({
          preset_names: ['破限主力预设', '古风慢热预设'],
          presets: [{}, {}],
        }),
      }),
      loadWorldInfo: async name => ({
        entries: {
          0: { uid: 0, comment: `${name}核心规则`, constant: true, disable: false, key: [], content: '初始内容' },
        },
      }),
      saveWorldInfo: async () => {},
      getWorldInfoNames: () => ['锦衣夜行录', '江南烟雨志'],
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      saveSettingsDebounced() {},
    };

    const store = createSettingsStore({ getContext: () => ctx });
    store.hydrate();
    const moduleBridge = createModuleBridge({ root: globalThis, getContext: () => ctx, store });

    let lastDockDismissedAt = 0;
    let topbar = null;
    let apiDock = null;
    let presetDock = null;
    let charWorldDock = null;
    let readerDock = null;

    readerDock = createReaderDock({
      getContext: () => ctx,
      store,
      onOpenStateChange: opened => {
        if (!opened) lastDockDismissedAt = Date.now();
        topbar?.refresh();
      },
    });

    apiDock = createApiDock({
      getContext: () => ctx,
      store,
      onBeforeOpen: () => {
        readerDock.close();
        presetDock?.close();
        charWorldDock?.close();
      },
      onOpenStateChange: opened => {
        if (!opened) lastDockDismissedAt = Date.now();
        topbar?.refresh();
      },
    });

    presetDock = createPresetDock({
      getContext: () => ctx,
      store,
      onBeforeOpen: () => {
        readerDock.close();
        apiDock.close();
        charWorldDock?.close();
      },
      onOpenStateChange: opened => {
        if (!opened) lastDockDismissedAt = Date.now();
        topbar?.refresh();
      },
      onPresetChanged: () => {
        topbar?.refresh();
        charWorldDock?.refresh();
      },
    });

    charWorldDock = createCharWorldDock({
      getContext: () => ctx,
      store,
      onBeforeOpen: () => {
        readerDock.close();
        apiDock.close();
        presetDock.close();
      },
      onOpenStateChange: opened => {
        if (!opened) lastDockDismissedAt = Date.now();
        topbar?.refresh();
      },
      onPresetChanged: () => {
        topbar?.refresh();
        presetDock.refresh();
      },
      onCharacterChanged: () => {
        topbar?.refresh();
        presetDock.refresh();
      },
    });

    topbar = createTopbar({
      getContext: () => ctx,
      store,
      moduleBridge,
      onToggleCharWorldDock: () => charWorldDock.toggle(),
      isCharWorldDockOpen: () => charWorldDock.isOpen(),
      onTogglePresetDock: () => presetDock.toggle(),
      isPresetDockOpen: () => presetDock.isOpen(),
      onToggleApiDock: () => apiDock.toggle(),
      isApiDockOpen: () => apiDock.isOpen(),
      onToggleReaderDock: () => readerDock.toggle(),
      isReaderDockOpen: () => readerDock.isOpen(),
    });
    topbar.refresh();

    const settingsDialog = createSettingsDialog({
      getContext: () => ctx,
      store,
      moduleBridge,
      onOpenReaderDock: () => readerDock.open(),
      onOpenApiDock: () => apiDock.open(),
      onOpenPresetDock: () => presetDock.open(),
      onOpenPresetAssistant: () => presetDock.openAssistant(),
      onOpenCharWorldDock: tab => charWorldDock.open(tab),
    });
    settingsDialog.installFallbackEntries();
    settingsDialog.open('api');
    const dialogActionTexts = doc
      .getElementById('stm-settings-dialog')
      .findAll(n => n.classList.contains('stm-action-card'))
      .map(n => n.children.map(c => c.textContent).join(''));
    assert.equal(dialogActionTexts.length, 4, '设置中心 API 页签应完整呈现 4 大核心工作台快捷入口');
    settingsDialog.close();

    // 1. 验证 apiDock 在输入框聚焦打字期间遇到外部 refresh() 绝不销毁重建焦点节点！
    apiDock.open();
    assert.equal(apiDock.isOpen(), true);
    const apiInputs = doc.getElementById('stm-api-dock').findAll(n => n.tagName === 'INPUT');
    const stationNameInput = apiInputs[0];
    stationNameInput.focus();
    stationNameInput.value = '正在输入拼音zhong...';
    apiDock.refresh();
    assert.equal(stationNameInput.isConnected, true, 'apiDock.refresh() 严禁销毁活跃焦点输入框吞掉拼音');
    assert.equal(doc.activeElement, stationNameInput);

    // 2. 打开 presetDock 互斥自动收起 apiDock 并更新 lastDockDismissedAt，且聚焦输入框/下拉框时 refresh() 零重绘！
    lastDockDismissedAt = 0;
    presetDock.open();
    assert.equal(apiDock.isOpen(), false, '打开 presetDock 应自动互斥收起 apiDock');
    assert.ok(lastDockDismissedAt > 0, '收起 Dock 必须更新 lastDockDismissedAt 防误触纯享阅读');

    const presetSearchInput = doc.getElementById('stm-preset-dock').findAll(n => n.tagName === 'INPUT')[0];
    presetSearchInput.focus();
    presetSearchInput.value = '古风pin';
    presetDock.refresh();
    assert.equal(presetSearchInput.isConnected, true, 'presetDock.refresh() 严禁销毁活跃焦点输入框');

    // 3. 打开 charWorldDock 互斥收起 presetDock，验证核心设定默认折叠，展开后测试聚焦防重绘 + 内联修改角色名实时同步顶栏！
    lastDockDismissedAt = 0;
    charWorldDock.open('char');
    assert.equal(presetDock.isOpen(), false, '打开 charWorldDock 应自动互斥收起 presetDock');
    assert.ok(lastDockDismissedAt > 0, 'presetDock 关闭必须更新 lastDockDismissedAt');
    assert.equal(
      doc.getElementById('stm-char-world-dock').findAll(n => n.tagName === 'TEXTAREA').length,
      0,
      '角色档案核心设定默认全部折叠，保持画册美感与防误看剧透',
    );
    doc.getElementById('stm-char-world-dock').querySelector('.stm-cw-field-head').click();

    const descTextarea = doc.getElementById('stm-char-world-dock').findAll(n => n.tagName === 'TEXTAREA')[0];
    descTextarea.focus();
    descTextarea.value = '镇抚司指挥使，正在输入长篇设定……';
    descTextarea.dispatchEvent({ type: 'input' });
    // 模拟防抖期间外部 SETTINGS_UPDATED / CHARACTER_EDITED 触发 refresh()
    charWorldDock.refresh();
    assert.equal(descTextarea.isConnected, true, 'charWorldDock.refresh() 在编辑与挂起期间严禁销毁活跃 textarea');
    assert.equal(doc.activeElement, descTextarea);

    // 点击角色名旁「改名」按钮，内联修改角色名为「沈清晏·飞鱼服」并回车提交，验证顶栏名字当场刷新！
    doc.activeElement = null;
    const renameBtn = doc.getElementById('stm-char-world-dock').querySelector('.stm-cw-rename-btn');
    assert.ok(renameBtn, '单人角色档案头卡应提供角色改名按钮');
    renameBtn.click();
    const charNameInput = doc.getElementById('stm-char-world-dock').querySelector('.stm-cw-name-input');
    assert.ok(charNameInput, '点击改名后应展开内联角色名输入框');
    charNameInput.focus();
    charNameInput.value = '沈清晏·飞鱼服';
    charNameInput.dispatchEvent({ type: 'input' });
    // 打字期间外部触发 refresh 同样不得销毁改名框
    charWorldDock.refresh();
    assert.equal(charNameInput.isConnected, true, '角色改名框连续打字期间绝不丢焦点');
    charNameInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    await charWorldDock.flushPendingSave();

    const topbarNameNode = doc.getElementById('stm-topbar').querySelector('.stm-topbar-name');
    assert.equal(topbarNameNode.textContent, '沈清晏·飞鱼服', '角色改名后顶栏 .stm-topbar-name 必须当场实时刷新');

    // 4. 验证 CHAT_CHANGED 时：先安全将沈清晏未落盘草稿写入 shen.png（零串卡！），再平滑刷新为新角色「林疏影」！
    const freshDescArea = doc.getElementById('stm-char-world-dock').findAll(n => n.tagName === 'TEXTAREA')[0];
    freshDescArea.value = '沈清晏切卡前最后一刻修改的设定';
    freshDescArea.dispatchEvent({ type: 'input' });
    mergeRequests.length = 0;

    // 宿主切换到角色 1（林疏影）并触发 handleChatChanged
    ctx.characterId = 1;
    ctx.chatId = 'chat_lin_1';
    ctx.name2 = '林疏影';
    ctx.chat = [{ name: '林疏影', is_user: false, is_system: false, mes: '公子请坐。' }];

    await charWorldDock.handleChatChanged();

    assert.equal(mergeRequests.length, 1, '切卡时必须先将旧角色的挂起草稿 flush 落盘');
    assert.equal(mergeRequests[0].avatar, 'shen.png', '旧角色草稿必须精准写入 shen.png 严禁串写至新角色 lin.png');
    assert.equal(mergeRequests[0].description, '沈清晏切卡前最后一刻修改的设定');
    assert.equal(ctx.characters[1].description, '江南琴师。', '新角色林疏影数据毫发无损');
    assert.equal(charWorldDock.isOpen(), true, '切换到新活跃对话时保持打开并平滑刷新为新角色档案');
    const newHeroTitle = doc.getElementById('stm-char-world-dock').querySelector('.stm-cw-char-name');
    assert.equal(newHeroTitle.textContent, '林疏影', '面板已平滑切换展示新角色林疏影');

    // 5. 退回书架首页（无活跃角色）触发 handleChatChanged 时自动干净收起，并更新 lastDockDismissedAt
    lastDockDismissedAt = 0;
    ctx.characterId = undefined;
    ctx.chatId = undefined;
    await charWorldDock.handleChatChanged();
    assert.equal(charWorldDock.isOpen(), false, '退回书架首页时应自动关闭 charWorldDock');
    assert.ok(lastDockDismissedAt > 0, 'charWorldDock 关闭必须更新 lastDockDismissedAt');

    charWorldDock.destroy();
    presetDock.destroy();
    apiDock.destroy();
    readerDock.destroy();
    topbar.destroy();
    settingsDialog.destroy();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.fetch = prevFetch;
  }
});

test('codebase guard: 全仓源码/样式/清单 0 彩色 Emoji，且 style.css 100% 严守 .stm- 作用域隔离', () => {
  const suiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const emojiRegex = /\p{Extended_Pictographic}/u;

  function collectFiles(dir) {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'tests' || ent.name === 'node_modules') continue;
        out.push(...collectFiles(full));
      } else if (/\.(js|mjs|css|json|md)$/.test(ent.name)) {
        out.push(full);
      }
    }
    return out;
  }

  for (const file of collectFiles(suiteRoot)) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(suiteRoot, file);
    assert.equal(emojiRegex.test(content), false, `文件 ${rel} 严禁包含彩色 Emoji 字符`);
  }

  const cssRaw = fs.readFileSync(path.join(suiteRoot, 'style.css'), 'utf8');
  const cssNoComments = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [idx, line] of cssNoComments.split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('@') || trimmed === '}') continue;
    if (trimmed.endsWith('{')) {
      assert.ok(
        trimmed === ':root {' || trimmed.includes('stm-'),
        `style.css 第 ${idx + 1} 行选择器必须带 stm- 前缀防污染宿主: ${trimmed}`,
      );
    }
  }

  // 移动端窄屏 iOS Safari 防强制放大守卫：全部可聚焦输入类必须在窄屏断点声明 font-size: 16px
  for (const inputCls of [
    '.stm-input',
    '.stm-api-input',
    '.stm-api-select',
    '.stm-more-source-select',
    '.stm-compact-input',
    '.stm-param-num-input',
    '.stm-prompt-textarea',
    '.stm-ast-input',
    '.stm-cw-input',
    '.stm-cw-select',
    '.stm-cw-textarea',
    '.stm-dock-url-input',
  ]) {
    assert.ok(cssNoComments.includes(inputCls), `style.css 应包含输入控件选择器 ${inputCls}`);
  }
  const sixteenPxMatches = cssNoComments.match(/font-size:\s*16px\s*;/g) || [];
  assert.ok(
    sixteenPxMatches.length >= 6,
    '全部弹窗与四大 Dock 的移动端窄屏输入控件均须配备 font-size: 16px 防 iOS 放大',
  );

  // 验证首页防变瘦 CSS 护栏、9 大原生抽屉双 ID 高权重锁死与 iOS @supports 修正
  assert.ok(
    cssNoComments.includes('html body.stm-shell-active.stm-home-cloak #chat#chat') &&
      cssNoComments.includes('padding-left: 0 !important;') &&
      cssNoComments.includes('padding-right: 0 !important;'),
    'style.css 必须显式清零首页净空态 #chat#chat 左右内边距',
  );
  assert.ok(
    cssNoComments.includes('html body.stm-shell-active.stm-home-cloak:not(.movingUI) #sheld#sheld'),
    'style.css 窄屏必须加固首页 #sheld#sheld 100% 满宽防主题挤压',
  );
  for (const drawerId of [
    '#left-nav-panel',
    '#rm_api_block',
    '#AdvancedFormatting',
    '#WorldInfo',
    '#user-settings-block',
    '#Backgrounds',
    '#rm_extensions_block',
    '#PersonaManagement',
    '#right-nav-panel',
  ]) {
    assert.ok(cssNoComments.includes(drawerId), `style.css 必须锁死原生抽屉 ${drawerId} 顶边`);
  }
  const iosSupportsMatch = cssNoComments.match(/@supports\s*\(-webkit-touch-callout:\s*none\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(iosSupportsMatch, 'style.css 应包含 iOS @supports (-webkit-touch-callout: none) 适配规则');
  assert.equal(
    iosSupportsMatch[1].includes('#world_popup'),
    false,
    'iOS @supports 抽屉定位规则不得对内部子容器 #world_popup 叠加偏移',
  );
  assert.ok(
    iosSupportsMatch[1].includes('top: var(--stm-drawer-top) !important;') &&
      iosSupportsMatch[1].includes('margin-top: 0 !important;'),
    'iOS @supports 抽屉定位规则必须使用 top + margin-top: 0 消除双倍空隙',
  );

  // 确保全仓源码与清单已彻底升级至 v0.7.4，零残留 0.7.0 / 0.7.1 / 0.7.2 / 0.7.3
  for (const file of collectFiles(suiteRoot)) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(suiteRoot, file);
    assert.equal(content.includes('0.7.0'), false, `文件 ${rel} 不得残留旧版 0.7.0 字符串`);
    assert.equal(content.includes('0.7.1'), false, `文件 ${rel} 不得残留旧版 0.7.1 字符串`);
    assert.equal(content.includes('0.7.2'), false, `文件 ${rel} 不得残留旧版 0.7.2 字符串`);
    assert.equal(content.includes('0.7.3'), false, `文件 ${rel} 不得残留旧版 0.7.3 字符串`);
  }
});

test('home bookshelf anti-shrink guard: 首页书架净空态下 atmosphere 100% 清空 #stm-page-overrides 且选择器严格排除首页与书架容器', () => {
  const prevDoc = globalThis.document;
  const { doc } = createMiniDomHarness();
  globalThis.document = doc;

  try {
    let inHomeCloak = false;
    const ctx = {
      extensionSettings: {},
      characterId: 0,
      groupId: null,
      characters: [{ avatar: 'shen.png', name: '沈清晏' }],
      saveSettingsDebounced() {},
    };

    const store = createSettingsStore({ getContext: () => ctx });
    store.hydrate();
    store.update({
      shellEnabled: true,
      modules: { reader: true },
      vibe: {
        paddingX: 24,
        desktopPaddingX: 32,
        fontSizePx: 17,
      },
    });

    const atmosphere = createAtmosphere({
      getContext: () => ctx,
      store,
      isHomeCloaked: () => inHomeCloak,
    });

    // 1) 在对话内：生成 #stm-page-overrides，且所有 #chat#chat 选择器均带首页与书架排除护栏
    atmosphere.refresh();
    const inChatStyle = doc.getElementById('stm-page-overrides');
    assert.ok(inChatStyle?.isConnected, '对话态应挂载 #stm-page-overrides');
    assert.ok(
      inChatStyle.textContent.includes('html body:not(.stm-home-cloak) #chat#chat:not(.jd-bookshelf-home)'),
      '对话态边距规则必须排除 .stm-home-cloak 与 .jd-bookshelf-home',
    );
    assert.ok(inChatStyle.textContent.includes('padding-left: 24px !important;'));
    assert.equal(
      /(?:^|[^\w-])#chat#chat(?!:not\(\.jd-bookshelf-home\))/.test(inChatStyle.textContent),
      false,
      '严禁存在任何未排除 .jd-bookshelf-home 的 #chat#chat 选择器',
    );

    // 2) 退回首页净空态（即使 characterId 尚未清空但 isHomeCloaked 为 true）：#stm-page-overrides 必须彻底移除！
    inHomeCloak = true;
    atmosphere.refresh();
    assert.equal(
      doc.getElementById('stm-page-overrides'),
      null,
      '退回首页书架净空态时必须立即清空移除 #stm-page-overrides，绝不挤压书架宽度',
    );
    assert.equal(doc.body.classList.contains('stm-reader-justify'), false);

    // 3) 退出角色返回欢迎页（characterId = undefined）：同样保持零 #stm-page-overrides
    inHomeCloak = false;
    ctx.characterId = undefined;
    atmosphere.refresh();
    assert.equal(doc.getElementById('stm-page-overrides'), null);

    atmosphere.destroy();
  } finally {
    globalThis.document = prevDoc;
  }
});

test('file-saver environment split: 普通浏览器 100% 直走 <a download> 零弹窗，isTauri 优先系统分享并保底导出 PNG/JSON', async () => {
  const { doc } = createMiniDomHarness();
  const clickedAnchors = [];
  const origCreateEl = doc.createElement.bind(doc);
  doc.createElement = tag => {
    const node = origCreateEl(tag);
    if (String(tag).toLowerCase() === 'a') {
      node.click = () => {
        clickedAnchors.push({ href: node.href, download: node.download });
      };
    }
    return node;
  };

  // 1) 普通浏览器（桌面 / 手机 Chrome，!isTauri）：100% 走 <a href="blob:..." download>，零分享框、零保底弹窗
  let shareCalledInBrowser = false;
  const browserRoot = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128.0 Mobile Safari/537.36',
      canShare: () => true,
      share: async () => {
        shareCalledInBrowser = true;
      },
    },
    URL: {
      createObjectURL: () => 'blob:https://st.example.com/mock-card',
      revokeObjectURL: () => {},
    },
  };

  const pngBlob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
  const browserRes = await saveExportBlob(pngBlob, '沈清晏.png', { doc, root: browserRoot });
  assert.equal(browserRes.ok, true);
  assert.equal(browserRes.mode, 'anchor-blob');
  assert.equal(shareCalledInBrowser, false, '普通手机 Chrome 严禁弹系统分享框');
  assert.equal(isExportFallbackDialogOpen(doc), false, '普通浏览器严禁弹保底导出框');
  assert.equal(clickedAnchors.length, 1);
  assert.equal(clickedAnchors[0].href, 'blob:https://st.example.com/mock-card');
  assert.equal(clickedAnchors[0].download, '沈清晏.png');

  // 2) TauriTavern (isTauri === true) 支持 navigator.canShare({ files })：优先走系统原生分享
  const sharedPayloads = [];
  class MockFile extends Blob {
    constructor(parts, name, opts) {
      super(parts, opts);
      this.name = name;
    }
  }
  const tauriShareRoot = {
    __TAURI_INTERNALS__: {},
    File: MockFile,
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Tauri/2.0)',
      canShare: ({ files }) => Array.isArray(files) && files.length === 1,
      share: async payload => {
        sharedPayloads.push(payload);
      },
    },
  };
  const ttShareRes = await saveExportBlob(pngBlob, '沈清晏.png', { doc, root: tauriShareRoot });
  assert.equal(ttShareRes.ok, true);
  assert.equal(ttShareRes.mode, 'web-share');
  assert.equal(sharedPayloads.length, 1);
  assert.equal(sharedPayloads[0].files[0].name, '沈清晏.png');
  assert.equal(isExportFallbackDialogOpen(doc), false);

  // 2b) 用户在系统分享面板主动关闭抛出 AbortError：静默视为取消，不报错、不弹保底框
  const tauriAbortRoot = {
    __TAURI__: {},
    File: MockFile,
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
      canShare: () => true,
      share: async () => {
        const err = new Error('Share canceled');
        err.name = 'AbortError';
        throw err;
      },
    },
  };
  const abortRes = await saveExportBlob(pngBlob, '沈清晏.png', { doc, root: tauriAbortRoot });
  assert.equal(abortRes.ok, true);
  assert.equal(abortRes.cancelled, true);
  assert.equal(abortRes.mode, 'web-share-cancelled');
  assert.equal(isExportFallbackDialogOpen(doc), false);

  // 3) TauriTavern WebView 不支持 canShare({ files })：触发 data: URI 下载 + 弹出 PNG / JSON 极简保底框
  let copiedClipboard = '';
  const tauriFallbackRoot = {
    __TAURI_IPC__: {},
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; wv)',
      clipboard: {
        writeText: async txt => {
          copiedClipboard = txt;
        },
      },
    },
  };

  clickedAnchors.length = 0;
  const fallbackPngRes = await saveExportBlob(pngBlob, '林疏影.png', { doc, root: tauriFallbackRoot });
  assert.equal(fallbackPngRes.mode, 'tauri-fallback');
  assert.equal(isExportFallbackDialogOpen(doc), true, '不支持 Web Share 的 TT 应打开保底导出弹窗');
  assert.ok(clickedAnchors[0]?.href.startsWith('data:image/png;base64,'), '应先尝试 data: URI 下载触发');
  const pngDlg = doc.getElementById('stm-export-fallback-dialog');
  assert.ok(pngDlg.querySelector('.stm-export-png-preview'), 'PNG 保底框应渲染卡面预览图');
  assert.match(pngDlg.textContent || pngDlg.findAll(() => true).map(n => n.textContent).join(' '), /长按上方卡面即可保存原图到相册/);
  closeExportFallbackDialog(doc, tauriFallbackRoot);
  assert.equal(isExportFallbackDialogOpen(doc), false);

  const jsonPayload = JSON.stringify({ name: '古风慢热预设', temperature: 0.95 }, null, 2);
  const jsonBlob = new Blob([jsonPayload], { type: 'application/json' });
  const fallbackJsonRes = await saveExportBlob(jsonBlob, '古风慢热预设.json', {
    doc,
    root: tauriFallbackRoot,
    textContent: jsonPayload,
  });
  assert.equal(fallbackJsonRes.mode, 'tauri-fallback');
  const jsonDlg = doc.getElementById('stm-export-fallback-dialog');
  const copyBtn = jsonDlg.querySelector('.stm-export-copy-btn');
  assert.ok(copyBtn, 'JSON 保底框应提供一键复制按钮');
  copyBtn.click();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(copiedClipboard, jsonPayload, '点击一键复制应写入完整 JSON 全文');
  closeExportFallbackDialog(doc, tauriFallbackRoot);
});

test('legacy secrets (< 1.13.1): 布尔型 secretsMap 单密钥识别、200 纯文本写入与 404 rotate 温和兼容', async () => {
  const legacyMap = {
    api_key_custom: true,
    api_key_openai: false,
  };
  assert.equal(isLegacySecretsMap(legacyMap), true);
  assert.equal(isLegacySecretsMap({ api_key_custom: [{ id: 'sec-1', active: true }] }), false);
  assert.equal(isLegacySecretsMap({}), false);

  const savedStatus = inspectStationSecretStatus(
    { source: 'custom', secretId: 'migrated-id', name: '主力反代' },
    legacyMap,
  );
  assert.equal(savedStatus.valid, true, '旧版布尔 true 必须识别为有效已存密钥');
  assert.equal(savedStatus.legacySingleKey, true);
  assert.equal(savedStatus.secretId, '', '旧版单密钥态不暴露多密钥 UUID');
  assert.match(savedStatus.statusText, /低于 1\.13\.1/);

  const emptyStatus = inspectStationSecretStatus(
    { source: 'openai', secretId: 'old-uuid', name: 'OpenAI' },
    legacyMap,
  );
  assert.equal(emptyStatus.valid, false);
  assert.equal(emptyStatus.missing, false, '旧版布尔 false 不应误报“原绑定密钥已移除”');
  assert.equal(emptyStatus.statusText, '未绑定密钥');

  // 旧版 /api/secrets/write 返回 200 "OK" 纯文本（非 JSON）
  const legacyWriteRes = await writeStationSecret({
    key: 'api_key_custom',
    value: 'sk-legacy-112',
    label: '旧版酒馆站子',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token O in JSON at position 0');
      },
    }),
    syncNativeMemory: false,
  });
  assert.deepEqual(legacyWriteRes, {
    id: '',
    label: '旧版酒馆站子',
    legacySingleKey: true,
  });

  // 旧版无 /api/secrets/rotate 返回 404 时静默返回 false（保持布尔类型兼容）
  const rotate404 = await rotateStationSecret({
    key: 'api_key_custom',
    id: 'any-id',
    fetchImpl: async () => ({ ok: false, status: 404 }),
    syncNativeMemory: false,
  });
  assert.equal(rotate404, false);
});

test('tauri safe-area & overlay back guard: 普通浏览器 100% 零开销零 pushState，TT 下双层安全区去重与侧滑返回收起浮层', () => {
  const { doc } = createMiniDomHarness();

  // 1) 普通浏览器：零安全区 DOM 探测，零 popstate 注册，零 history.pushState
  let pushCountBrowser = 0;
  const browserListeners = new Map();
  const normalBrowserRoot = {
    document: doc,
    screenTop: 48,
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0' },
    history: {
      pushState() {
        pushCountBrowser += 1;
      },
    },
    addEventListener(type, fn) {
      browserListeners.set(type, fn);
    },
    removeEventListener(type) {
      browserListeners.delete(type);
    },
  };

  const browserSafeRes = syncTauriSafeAreaGuard(normalBrowserRoot);
  assert.equal(browserSafeRes.applied, false);
  assert.equal(doc.documentElement.style.getPropertyValue('--stm-safe-top'), '');

  let overlayOpen = true;
  const browserGuard = createTauriOverlayBackGuard({
    root: normalBrowserRoot,
    hasAnyOverlayOpen: () => overlayOpen,
    closeTopmostOverlay: () => {
      overlayOpen = false;
      return true;
    },
  });
  browserGuard.sync();
  assert.equal(browserGuard.active, false);
  assert.equal(pushCountBrowser, 0, '普通浏览器严禁调用 history.pushState');
  assert.equal(browserListeners.has('popstate'), false, '普通浏览器严禁挂载 popstate');

  // 2) TauriTavern：刘海屏双层偏移去重检测与 disable 清理
  const tauriListeners = new Map();
  const pushedStates = [];
  const tauriRoot = {
    __TAURI__: {},
    document: doc,
    screenTop: 32,
    visualViewport: { offsetTop: 0 },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Tauri)' },
    getComputedStyle: () => ({ paddingTop: '28px' }),
    history: {
      pushState(state) {
        pushedStates.push(state);
      },
    },
    addEventListener(type, fn) {
      tauriListeners.set(type, fn);
    },
    removeEventListener(type) {
      tauriListeners.delete(type);
    },
  };

  const ttSafeRes = syncTauriSafeAreaGuard(tauriRoot);
  assert.equal(ttSafeRes.applied, true);
  assert.equal(doc.documentElement.style.getPropertyValue('--stm-safe-top'), '0px');
  clearTauriSafeAreaGuard(tauriRoot);
  assert.equal(doc.documentElement.style.getPropertyValue('--stm-safe-top'), '');

  // 3) TauriTavern：侧滑返回手势单一布尔锁与多浮层逐级收起
  const openStack = [];
  const ttGuard = createTauriOverlayBackGuard({
    root: tauriRoot,
    hasAnyOverlayOpen: () => openStack.length > 0,
    closeTopmostOverlay: () => {
      if (!openStack.length) return false;
      openStack.pop();
      return true;
    },
  });
  assert.equal(ttGuard.active, true);
  assert.equal(pushedStates.length, 0);

  // 打开 charWorldDock + 立绘灯箱，连续多次 sync 只压入唯一一条守卫历史！
  openStack.push('charWorldDock');
  ttGuard.sync();
  openStack.push('lightbox');
  ttGuard.sync();
  assert.equal(pushedStates.length, 1, '单一布尔锁确保多次打开浮层只 pushState 一次');
  assert.deepEqual(pushedStates[0], { stmOverlayGuard: true });

  // 第一次侧滑返回：收起顶层 lightbox，且因底下 charWorldDock 仍打开，自动补压一条守卫历史保护底层 Dock
  tauriListeners.get('popstate')?.({ type: 'popstate' });
  assert.deepEqual(openStack, ['charWorldDock']);
  assert.equal(pushedStates.length, 2);

  // 第二次侧滑返回：收起 charWorldDock，此时全部浮层已关，不再补压历史
  tauriListeners.get('popstate')?.({ type: 'popstate' });
  assert.deepEqual(openStack, []);
  assert.equal(ttGuard.isHistoryPushed(), false);
  assert.equal(pushedStates.length, 2);

  ttGuard.destroy();
  assert.equal(tauriListeners.has('popstate'), false, 'destroy 时必须移除 popstate 监听');
});

test('api-dock 90/9/1 progressive UI & aux model dropdown: 去重角标、清理假默认、渐进折叠与副通道下拉拉取', async () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevFetch = globalThis.fetch;

  const { doc, win } = createMiniDomHarness();
  globalThis.document = doc;
  globalThis.window = win;

  // 1. 验证术语去反代化、旧版「默认 · Vertex AI」自动净化与自主默认主站置顶
  assert.equal(API_SOURCES.custom.shortLabel, '通用接口', '不再对所有兼容 OpenAI 站子贴自定义反代标签');
  assert.equal(guessFriendlyStationName('vertexai', '', ''), 'Vertex AI', '自动导入不再强冠默认前缀');
  assert.equal(guessFriendlyStationName('custom', 'http://127.0.0.1:7861/v1', ''), '127.0.0.1:7861');
  assert.equal(normalizeApiStation({ name: '默认 · Vertex AI', source: 'vertexai' }).name, 'Vertex AI');
  assert.equal(normalizeApiStation({ name: '默认 · 自定义反代', source: 'custom' }).name, '通用接口');
  assert.equal(normalizeApiStation({ name: '橘子汽水', source: 'custom' }).name, '橘子汽水');

  const sampleSummary = formatStationCompactSummary(
    normalizeApiStation({
      name: '反代自己',
      source: 'custom',
      url: 'http://127.0.0.1:7861/v1',
      postProcessing: 'semi',
    }),
    { valid: true, maskedValue: '***3Ss' },
  );
  assert.match(sampleSummary, /通用接口 · 127\.0\.0\.1:7861 · 密钥 \*\*\*3Ss · 后处理:/);

  const fetchLog = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts?.body ? JSON.parse(opts.body) : null;
    fetchLog.push({ url: u, body });

    if (u.includes('api/secrets/read')) {
      return {
        ok: true,
        json: async () => ({
          api_key_custom: [
            { id: 'sec-self', label: '本地密钥', value: '***3Ss', active: true },
            { id: 'sec-orange', label: '橘子密钥', value: '***9Ab', active: false },
          ],
          api_key_vertexai: [{ id: 'sec-vtx', label: 'VertexKey', value: '***vtx', active: true }],
        }),
      };
    }
    if (u.includes('api/backends/chat-completions/status')) {
      if (body?.secret_id === 'sec-orange') {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'gemini-2.5-flash' }, { id: 'deepseek-chat' }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'gemini-4-neon(high)' }, { id: 'gemini-4-argon(high)' }],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  try {
    const ctx = {
      extensionSettings: {},
      chatCompletionSettings: {
        chat_completion_source: 'custom',
        custom_url: 'http://127.0.0.1:7861/v1',
        custom_model: 'gemini-4-neon(high)',
      },
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      saveSettingsDebounced() {},
    };

    const store = createSettingsStore({ getContext: () => ctx });
    store.hydrate();
    store.update({
      shellEnabled: true,
      apiStudio: {
        activeStationId: 'st_self',
        stations: [
          normalizeApiStation({
            id: 'st_vtx',
            name: '默认 · Vertex AI',
            source: 'vertexai',
            secretId: 'sec-vtx',
            model: 'gemini-2.5-pro',
          }),
          normalizeApiStation({
            id: 'st_self',
            name: '反代自己',
            source: 'custom',
            url: 'http://127.0.0.1:7861/v1',
            secretId: 'sec-self',
            model: 'gemini-4-neon(high)',
            favoriteModels: ['gemini-4-argon(high)', 'gemini-4-neon(high)'],
            cachedModels: ['gemini-4-argon(high)', 'gemini-4-neon(high)', 'claude-sonnet-4-6'],
          }),
          normalizeApiStation({
            id: 'st_orange',
            name: '橘子汽水',
            source: 'custom',
            url: 'https://orange.example.com/v1',
            secretId: 'sec-orange',
            model: 'claude-opus-4-6',
            favoriteModels: ['claude-haiku-4-5'],
            cachedModels: [],
          }),
        ],
      },
    });

    const apiDock = createApiDock({
      getContext: () => ctx,
      store,
    });

    apiDock.open();
    await new Promise(r => setTimeout(r, 15));

    const dockRoot = doc.getElementById('stm-api-dock');
    // 1. 站子选择栏默认折叠收纳（站子再多也只占一行），右端内嵌绿灯就绪态，点击可展开站子下拉列表
    assert.equal(dockRoot.querySelector('.stm-api-status-line'), null, '已去除顶部复读站子名与模型名的冗余状态行');
    const pickerBtn = dockRoot.querySelector('.stm-station-picker-btn');
    assert.ok(pickerBtn, '配备当前站子下拉选择栏');
    assert.equal(pickerBtn.querySelector('.stm-station-picker-name').textContent, '反代自己');
    assert.equal(pickerBtn.querySelector('.stm-station-ready-text').textContent, '已就绪');
    assert.equal(dockRoot.querySelector('.stm-station-dropdown').hidden, true, '站子下拉列表默认收起');
    pickerBtn.click();
    assert.equal(dockRoot.querySelector('.stm-station-dropdown').hidden, false, '点击选择栏展开全部站子下拉列表');

    const pills = dockRoot.findAll(n => n.classList.contains('stm-station-pill'));
    assert.equal(pills.length, 3);
    assert.equal(
      pills[0].querySelector('.stm-station-pill-name').textContent,
      'Vertex AI',
      '旧版自动冠名的「默认 · Vertex AI」已自动剥离误导前缀',
    );
    assert.equal(
      dockRoot.findAll(n => n.classList.contains('stm-station-pill-sub')).length,
      0,
      '站子选项不再重复渲染「自定义反代」等冗余角标',
    );

    // 2. 日常态默认收起连接配置与后处理，但「设为默认 / 复制 / 删除」直接在明面摘要栏可见易找！
    assert.equal(
      dockRoot.querySelector('.stm-station-config-panel'),
      null,
      '已配置站子打开时默认折叠低频连接表单，仅展示单行摘要',
    );
    assert.ok(dockRoot.querySelector('.stm-station-summary-bar'), '展示单行紧凑状态摘要');
    assert.ok(dockRoot.querySelector('.stm-set-default-btn'), '无需展开底层表单即可直接看到「设为默认」');
    assert.ok(dockRoot.querySelector('.stm-station-del-btn'), '无需展开底层表单即可直接看到「删除」按钮');

    // 点击「设为默认」将「反代自己」置顶到第 1 位并打上用户专属「默认」微标
    dockRoot.querySelector('.stm-set-default-btn').click();
    assert.equal(store.get().apiStudio.defaultStationId, 'st_self');
    assert.equal(store.get().apiStudio.stations[0].id, 'st_self', '用户设定的默认主站排至第 1 位');
    const updatedPills = dockRoot.findAll(n => n.classList.contains('stm-station-pill'));
    assert.equal(updatedPills[0].querySelector('.stm-station-pill-name').textContent, '反代自己');
    assert.equal(updatedPills[0].querySelector('.stm-station-pill-sub')?.textContent, '默认');
    assert.equal(
      dockRoot.findAll(n => n.classList.contains('stm-station-pill-sub')).length,
      1,
      '全栏仅用户主动指定的默认主站带「默认」标识',
    );

    // 点击「配置连接」展开表单，此时「提示词消息后处理」仍折叠在「高级选项」内
    dockRoot.querySelector('.stm-cfg-toggle-btn').click();
    assert.ok(dockRoot.querySelector('.stm-station-config-panel'), '点配置按钮后展开连接表单');
    assert.equal(
      dockRoot.querySelector('.stm-advanced-subbox'),
      null,
      '提示词消息后处理默认收纳在高级选项内不平铺占屏',
    );

    dockRoot.querySelector('.stm-adv-toggle-btn').click();
    assert.ok(dockRoot.querySelector('.stm-advanced-subbox'), '点高级选项后按需显示消息后处理');

    // 3. 验证「副 API 通道」：切至独立指定 -> 选定「橘子汽水」 -> 一键后台拉取模型且零切主站 -> 下拉点选模型
    const auxModePills = dockRoot.findAll(n => n.classList.contains('stm-aux-mode-pill'));
    assert.equal(auxModePills.length, 2);
    auxModePills[1].click(); // 独立指定
    assert.equal(store.get().auxApi.mode, 'station');

    const auxSelect = dockRoot.querySelector('.stm-aux-station-select');
    assert.ok(auxSelect, '独立指定模式下直接展示副通道站子选择器');
    auxSelect.value = 'st_orange';
    auxSelect.dispatchEvent({ type: 'change' });

    fetchLog.length = 0;
    const auxPullBtn = dockRoot.querySelector('.stm-aux-pull-btn');
    assert.ok(auxPullBtn, '提供副通道独立拉取模型按钮');
    auxPullBtn.click();
    await new Promise(r => setTimeout(r, 15));

    assert.equal(
      store.get().apiStudio.activeStationId,
      'st_self',
      '拉取副站子模型绝不篡改当前活跃主对话站子',
    );
    assert.equal(
      fetchLog.some(item => item.url.includes('api/secrets/rotate')),
      false,
      '后台拉取副站子模型直传 secret_id，绝不轮换污染主通道密钥',
    );
    const orangeAfterPull = store.get().apiStudio.stations.find(s => s.id === 'st_orange');
    assert.deepEqual(orangeAfterPull.cachedModels, ['gemini-2.5-flash', 'deepseek-chat']);

    const auxDrop = dockRoot.querySelector('.stm-aux-model-dropdown');
    assert.equal(auxDrop.hidden, false, '拉取完成后自动展开副通道模型下拉框');
    const auxPickBtns = auxDrop.findAll(n => n.classList.contains('stm-model-pick-btn'));
    const flashBtn = auxPickBtns.find(b =>
      b.children.some(c => c.textContent === 'gemini-2.5-flash'),
    );
    assert.ok(flashBtn, '副通道下拉框应包含刚拉取到的 gemini-2.5-flash');
    flashBtn.click();

    assert.equal(store.get().auxApi.stationId, 'st_orange');
    assert.equal(store.get().auxApi.model, 'gemini-2.5-flash', '点击下拉项即可直接选定副模型免手填');

    // 4. 新建站子时自动展开连接配置面板
    dockRoot.querySelector('.stm-station-add-btn').click();
    assert.ok(
      dockRoot.querySelector('.stm-station-config-panel'),
      '新建空白站子时自动展开连接表单供填写地址与密钥',
    );

    apiDock.destroy();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.fetch = prevFetch;
  }
});

test('suite UI declutter v0.7.4: 设置微透分组与常用置顶、预设馆上下主次分区、角色画册去框Tag与按需世界书', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const { doc, win } = createMiniDomHarness();
  globalThis.document = doc;
  globalThis.window = win;

  try {
    const ctx = {
      extensionSettings: {},
      characterId: 0,
      groupId: null,
      name2: '裴敬之',
      chatId: 'chat_pei_1',
      tags: [
        { id: 't1', name: '民国洋场' },
        { id: 't2', name: '兄妹骨科' },
        { id: 't3', name: '恶人主控' },
      ],
      tagMap: {
        '裴敬之1.png': ['t1', 't2', 't3'],
      },
      characters: [
        {
          name: '裴敬之',
          avatar: '裴敬之1.png',
          description: '江南百年清流巨族现任家主。',
          first_mes: '【开场白模块】',
          data: {
            name: '裴敬之',
            description: '江南百年清流巨族现任家主。',
            first_mes: '【开场白模块】',
            alternate_greetings: ['备用开场2', '备用开场3'],
            extensions: { world: '裴敬之设定集' },
          },
        },
      ],
      chat: [{ name: '裴敬之', is_user: false, is_system: false, mes: '【开场白模块】' }],
      chatCompletionSettings: {
        preset_settings_openai: '砚台预设V2.0',
        openai_max_context: 2000000,
        openai_max_tokens: 65535,
        temp_openai: 1,
        prompts: [{ identifier: 'main', name: '主系统提示', role: 'system', content: 'sys' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      },
      openai_settings: [{ name: '砚台预设V2.0' }, { name: '备用慢热预设' }],
      preset_names: { '砚台预设V2.0': 0, '备用慢热预设': 1 },
      world_names: ['裴敬之设定集'],
      saveSettingsDebounced() {},
    };

    const store = createSettingsStore({ getContext: () => ctx });
    store.hydrate();
    const moduleBridge = createModuleBridge({ root: globalThis, getContext: () => ctx, store });

    // 1. 设置中心：微透分组列表 + 单行「名称 ? 开关」+ 「扩展与原生」首两行固定美化主题与第三方扩展
    const settingsDialog = createSettingsDialog({
      getContext: () => ctx,
      store,
      moduleBridge,
    });
    settingsDialog.open('modules');
    const dlg = doc.getElementById('stm-settings-dialog');
    const tabBtns = dlg.findAll(n => n.classList.contains('stm-tab-btn'));
    assert.equal(tabBtns.length, 2, '设置中心已精简合并为「功能开关」与「扩展与原生」2 页签');
    assert.equal(
      dlg.findAll(n => n.classList.contains('stm-settings-group')).length,
      2,
      '功能开关聚合成 2 张清爽分组列表卡片，告别 11 个生硬独立方框',
    );
    assert.equal(
      dlg.findAll(n => n.classList.contains('stm-range-input')).length,
      0,
      '已彻底移除与顶栏 Aa 重复的阅读滑杆',
    );
    assert.equal(
      dlg.findAll(n => n.classList.contains('stm-switch-help-pop')).length,
      0,
      '默认不平铺长段说明文字，保持单行清爽',
    );

    const helpBtns = dlg.findAll(n => n.classList.contains('stm-help-btn'));
    assert.ok(helpBtns.length >= 8, '每项功能均配备圆圈 ? 说明按钮');
    const prevTurbo = store.get().modules.turbo;
    helpBtns[1].click();
    assert.equal(store.get().modules.turbo, prevTurbo, '点击圆圈 ? 仅展开说明绝不误触右侧开关');
    assert.equal(dlg.findAll(n => n.classList.contains('stm-switch-help-pop')).length, 1);

    // 点另一项 ? 自动互斥切换，再点同一项收起
    helpBtns[2].click();
    assert.equal(dlg.findAll(n => n.classList.contains('stm-switch-help-pop')).length, 1);
    dlg.findAll(n => n.classList.contains('stm-help-btn'))[2].click();
    assert.equal(dlg.findAll(n => n.classList.contains('stm-switch-help-pop')).length, 0);

    // 切到「扩展与原生」页签：验证第 1 行为「酒馆界面与美化主题」，第 2 行为「第三方扩展设置」
    tabBtns[1].click();
    const shortcutTitles = dlg
      .findAll(n => n.classList.contains('stm-shortcut-item'))
      .map(n => n.querySelector('.stm-switch-title')?.textContent);
    assert.equal(shortcutTitles[0], '酒馆界面与美化主题');
    assert.equal(shortcutTitles[1], '第三方扩展设置');
    settingsDialog.close();

    // 2. 预设馆：单行紧凑顶栏 + 改名归入预设行操作栏 + 上下主次分区 + 无外框弱化生成参数行
    const sel = doc.createElement('select');
    sel.id = 'settings_preset_openai';
    for (const [val, text] of [
      ['0', '砚台预设V2.0'],
      ['1', '备用慢热预设'],
    ]) {
      const o = doc.createElement('option');
      o.value = val;
      o.textContent = text;
      sel.appendChild(o);
    }
    sel.value = '0';
    doc.body.appendChild(sel);

    const presetDock = createPresetDock({ getContext: () => ctx, store });
    presetDock.open();
    const pDock = doc.getElementById('stm-preset-dock');
    assert.ok(pDock.querySelector('.stm-preset-topbar-compact'), '顶栏工具与自动存盘合并为单行省空间');
    assert.ok(pDock.querySelector('.stm-preset-detail-zone'), '下半区明确划分为「当前预设内容」工作区');
    assert.equal(
      pDock.findAll(n => n.classList.contains('stm-vault-tab')).length,
      2,
      '常用预设与预设仓库采用专属深色高对比胶囊 .stm-vault-tab',
    );
    assert.equal(
      pDock.findAll(n => n.classList.contains('stm-preset-item-actions')).length,
      1,
      '列表共 2 套预设，默认仅当前使用中那 1 套展开操作栏，其余行单行清爽',
    );
    assert.ok(
      pDock.querySelector('.stm-preset-rename-btn'),
      '「改名」已归入当前激活预设的操作栏内',
    );
    const manageToggle = pDock.querySelector('.stm-preset-manage-toggle');
    assert.ok(manageToggle, '非激活预设右侧提供轻量「管理」展开钮');
    manageToggle.click();
    assert.equal(pDock.findAll(n => n.classList.contains('stm-preset-item-actions')).length, 2);

    assert.equal(
      pDock.querySelector('.stm-preset-param-card'),
      null,
      '核心生成参数默认折叠为单行摘要不占屏',
    );
    const paramBar = pDock.querySelector('.stm-param-summary-bar');
    assert.ok(paramBar && paramBar.classList.contains('is-inline-subtle'), '生成参数融合于下半区标题下方，做无外框淡色单行展示');
    assert.match(
      paramBar.querySelector('.stm-param-summary-text').textContent,
      /上下文 2M · 回复 65535 · 温度 1\.0/,
    );
    paramBar.click();
    assert.ok(pDock.querySelector('.stm-preset-param-card'), '点击参数摘要条后展开微调滑杆');
    presetDock.close();

    // 3. 角色档案无外框画册舞台：3:4 大幅立绘 + 角色名下 Tag 行 + 二合一导出 + 按需世界书 + 开场白默认收起
    const charWorldDock = createCharWorldDock({ getContext: () => ctx, store });
    charWorldDock.open('char');
    const cwRoot = doc.getElementById('stm-char-world-dock');
    assert.ok(cwRoot.querySelector('.stm-cw-hero.is-char-showcase'), '启用画册海报式角色主卡');
    assert.ok(cwRoot.querySelector('.stm-cw-portrait-ambient'), '配备手机竖屏同图虚化氛围底');
    assert.ok(cwRoot.querySelector('.stm-cw-portrait-btn.is-showcase'), '配备 3:4 大幅立绘按钮');

    // 验证角色名正下方展示角色 Tag 标签
    const tagPills = cwRoot.findAll(n => n.classList.contains('stm-cw-tag-pill'));
    assert.deepEqual(
      tagPills.map(n => n.textContent),
      ['民国洋场', '兄妹骨科', '恶人主控'],
      '角色名正下方展示酒馆角色标签',
    );

    // 验证二合一导出按钮：默认只显示 1 颗「导出角色卡 ▾」，点击后展开 PNG / JSON 二选一
    assert.equal(cwRoot.querySelector('.stm-cw-export-choices'), null);
    cwRoot.querySelector('.stm-cw-export-trigger').click();
    assert.equal(
      cwRoot.findAll(n => n.classList.contains('stm-cw-export-choice-btn')).length,
      2,
      '点击导出后展开 PNG 与 JSON 两个选项',
    );

    // 验证开场白与设定统一归入无外框折页清单 .stm-cw-sheet-list，且开场白默认收起
    assert.ok(cwRoot.querySelector('.stm-cw-sheet-list'), '下方统一采用无外框细线折页清单');
    assert.equal(
      cwRoot.querySelector('.stm-cw-greetings-body'),
      null,
      '开场白模块默认收起，减少首屏方框压迫感',
    );
    cwRoot.querySelector('.stm-cw-greet-fold-head').click();
    assert.ok(cwRoot.querySelector('.stm-cw-greetings-body'), '点击开场白行后按需展开切换与预览');

    // 验证世界书按需智能显隐：有角色主书时显示；当角色既无主书也无聊天/记忆书时自动隐藏该行
    assert.ok(cwRoot.querySelector('.stm-cw-inline-bind-row.is-world-row'), '有角色世界书时显示世界书行');
    ctx.characters[0].data.extensions.world = '';
    ctx.chatMetadata = {};
    charWorldDock.refresh();
    assert.equal(
      cwRoot.querySelector('.stm-cw-inline-bind-row.is-world-row'),
      null,
      '既无角色主书也无聊天记忆世界书时自动隐去世界书行，保持最简净度',
    );
    // 若记忆插件写入了当前聊天世界书 (chatMetadata.world_info)，则自动显现入口！
    ctx.chatMetadata = { world_info: '裴敬之_叙事记忆书' };
    charWorldDock.refresh();
    assert.ok(
      cwRoot.querySelector('.stm-cw-inline-bind-row.is-world-row'),
      '启用叙事记忆聊天世界书时自动展示关联世界书快捷入口',
    );

    charWorldDock.destroy();
    presetDock.destroy();
    settingsDialog.destroy();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
});
