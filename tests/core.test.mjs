import test from 'node:test';
import assert from 'node:assert/strict';

import { detectPlatform, hasActiveChatSelection } from '../src/core/env.js';
import { clarityToBlurPx, createLruMap } from '../src/core/backdrop-cache.js';
import { svgMarkup } from '../src/core/icons.js';
import { DEFAULT_SETTINGS, normalizeSettings, createSettingsStore, sanitizeAssetUrl } from '../src/core/schema.js';
import { shouldTogglePureReading } from '../src/core/tap-guard.js';
import { CONTROL_REGISTRY_KEY, MODULE_DESCRIPTORS, createModuleBridge } from '../src/core/registry.js';
import { formatShortPresetName, getSwipeGesturesEnabled, setSwipeGesturesEnabled } from '../src/shell/host-actions.js';
import { buildPageOverrideCss } from '../src/shell/atmosphere.js';
import { partitionChatMessages } from '../src/shell/perf-engine.js';

test('schema: 默认设置严格符合产品约定（流畅渲染引擎与阅读映幕默认开启，重Roll/记忆默认关闭）', () => {
  const normalized = normalizeSettings(undefined);
  assert.equal(normalized.shellEnabled, true);
  assert.equal(normalized.topbarMode, 'rp');
  assert.equal(normalized.tapPureReading, true);
  assert.equal(normalized.modules.turbo, true, '隐形流畅渲染引擎必须默认开启');
  assert.equal(normalized.modules.reader, true, '阅读排版与角色映幕必须默认开启');
  assert.equal(normalized.modules.bookshelf, true);
  assert.equal(normalized.modules.persona, true);
  assert.equal(normalized.modules.echoes, false, '重Roll平行分支必须默认关闭');
  assert.equal(normalized.modules.memory, false, '叙事记忆必须默认关闭');
  assert.equal(normalized.vibe.fontSizePx, 0, '未调节时默认跟随玩家原有美化字号');
  assert.equal(normalized.vibe.paragraphIndent, 'default', '未调节时默认不强改段落缩进');
});

test('schema: 非法字段自动钳制与回退，持久化幂等写入 st_mate 命名空间', () => {
  let savedCount = 0;
  const mockCtx = {
    extensionSettings: {
      other_plugin: { keep: true },
      st_mate: {
        topbarMode: 'invalid-mode',
        vibe: { backdropBlur: 999, backdropDim: -20, fontScale: 50 },
        modules: { echoes: true },
      },
    },
    saveSettingsDebounced() {
      savedCount += 1;
    },
  };

  const store = createSettingsStore({ getContext: () => mockCtx });
  assert.equal(store.get().topbarMode, 'rp');
  assert.equal(store.get().vibe.backdropBlur, 48);
  assert.equal(store.get().vibe.backdropDim, 0);
  assert.equal(store.get().vibe.fontScale, 85);
  assert.equal(store.get().modules.echoes, true);
  assert.deepEqual(mockCtx.extensionSettings.other_plugin, { keep: true });

  store.update({ topbarMode: 'reading', modules: { echoes: false } });
  assert.equal(store.get().topbarMode, 'reading');
  assert.equal(store.get().modules.echoes, false);
  assert.equal(savedCount, 1);
});

test('tap-guard: 正文普通区域轻触触发纯享阅读，划词/滚动/按钮/iframe 严格放行', () => {
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

  const baseSettings = { ...DEFAULT_SETTINGS, shellEnabled: true, tapPureReading: true, tapPureReadingScope: 'all', topbarMode: 'rp' };
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

  // 划词复制中绝不触发
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

  // 手指滑动翻阅（位移 >= 8px）绝不触发
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

  // 点击按钮 / details 折叠框 / iframe 卡片绝不触发
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

  // 书架首页绝不触发
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
  assert.deepEqual(mockCtx.extensionSettings.yantaiInterface.hiddenTop, [], '应自动清空旧版界面整理的顶栏隐藏项以防冲突');
  assert.equal(mockCtx.extensionSettings.yantai_echoes.enabled, false, '应按默认设置将重Roll平行分支同步为关闭');
  assert.equal(bookshelfState, true);

  await bridge.syncModuleEnabled('bookshelf', false);
  assert.equal(bookshelfState, false);
});

test('env: TauriTavern / iOS / 聊天选中状态识别准确', () => {
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
});

test('host-actions: 角色名旁小字预设名自动去后缀并优雅截断', () => {
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

test('registry: 点「原生酒馆」一键挂起全部子模块（告别套娃），回到伴侣时原样恢复勾选组合', async () => {
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

  // 切到纯原生酒馆：一键挂起全部子模块，但不擦除玩家保存的勾选组合
  store.update({ shellEnabled: false });
  await bridge.suspendAllForNative();
  assert.equal(bookshelfLive, false);
  assert.equal(personaLive, false);
  assert.equal(mockCtx.extensionSettings.yantai_echoes.enabled, false);
  assert.equal(store.get().modules.bookshelf, true, '个人书架勾选偏好应保留');
  assert.equal(store.get().modules.echoes, true, '个人重Roll勾选偏好应保留');

  // 刷新网页时若仍处于原生酒馆模式，保持纯原生态不反弹
  bookshelfLive = true;
  await bridge.applyAllFromStore();
  assert.equal(bookshelfLive, false);

  // 一键回到 ST伴侣：瞬间按保存的偏好恢复书架、人设馆与重Roll
  store.update({ shellEnabled: true });
  await bridge.applyAllFromStore();
  assert.equal(bookshelfLive, true);
  assert.equal(personaLive, true);
  assert.equal(mockCtx.extensionSettings.yantai_echoes.enabled, true);
});

test('icons & aesthetics: 全模块图标均为 1.5px 纯色细线 SVG，零彩色 Emoji 字符', () => {
  for (const mod of MODULE_DESCRIPTORS) {
    assert.match(mod.icon, /^[a-z]+$/, `模块 ${mod.key} 应使用线性图标键名而非 Emoji`);
    const svg = svgMarkup(mod.icon);
    assert.ok(svg.includes('stroke="currentColor"'), '必须跟随主题文字色');
    assert.ok(svg.includes('stroke-width="1.5"'), '必须统一 1.5px 极简细线');
    assert.ok(svg.includes('fill="none"'), '必须为纯线性非实心块图标');
  }
});

test('performance: 滑块 silent 更新不触发全弹窗重绘订阅，书架支持单角色增量缓存失效', async () => {
  let listenerCalls = 0;
  const store = createSettingsStore({ getContext: () => ({ extensionSettings: {} }) });
  store.subscribe(() => {
    listenerCalls += 1;
  });

  store.update({ vibe: { backdropBlur: 24 } }, { silent: true });
  assert.equal(store.get().vibe.backdropBlur, 24);
  assert.equal(listenerCalls, 0, 'silent 实时预览不应触发全局重绘回调');
});

test('page overrides & gestures: 高权重美化穿透样式生成、顶格/缩进切换与右滑重Roll双向同步', () => {
  assert.equal(sanitizeAssetUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeAssetUrl('/backgrounds/stm-bg-1.webp'), 'backgrounds/stm-bg-1.webp');
  assert.equal(sanitizeAssetUrl('https://img.example.com/a.png'), 'https://img.example.com/a.png');

  // 默认未调项时，0 样式注入，100% 尊重玩家原有美化主题
  const untouchedCss = buildPageOverrideCss(DEFAULT_SETTINGS.vibe, { readerActive: true, backdropLive: false });
  assert.equal(untouchedCss, '');

  const store = createSettingsStore({ getContext: () => ({ extensionSettings: {} }) });
  // 旧版 ambiance 自动无损回退至 theme，spaced 自动归并为 flush（顶格）
  store.update({
    vibe: {
      backdropMode: 'ambiance',
      paragraphIndent: 'spaced',
    },
  });
  assert.equal(store.get().vibe.backdropMode, 'theme');
  assert.equal(store.get().vibe.paragraphIndent, 'flush');

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

  const activeCss = buildPageOverrideCss(store.get().vibe, { readerActive: true, backdropLive: true });
  assert.ok(activeCss.includes('#sheld#sheld'), '开启底图时必须同步透明化 #sheld 防止观月札记等主题纸底遮挡');
  assert.ok(activeCss.includes('--nt-body: 18px !important'), '必须穿透观月札记 --nt-body 字号变量');
  assert.ok(activeCss.includes('padding-left: 6px !important'), '边距必须精准生效');
  assert.ok(activeCss.includes('text-indent: 2em !important'), '首行缩进必须生效');
  assert.ok(activeCss.includes('--nt-serif:'), '字体切换必须覆盖观月札记等主题字体变量');
  assert.ok(activeCss.includes('.mesAvatarWrapper'), '隐去头像必须生效');

  // 右滑重Roll开关双向直连 powerUserSettings.gestures
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
  assert.equal(getSwipeGesturesEnabled(() => mockCtx), false);
  assert.equal(saved, 1);
});

test('turbo engine: 长对话楼层自动分流休眠与 LRU 底图缓存淘汰无泄漏', () => {
  assert.equal(clarityToBlurPx(100), 0);
  assert.ok(clarityToBlurPx(50) > 15 && clarityToBlurPx(50) < 20);

  const evicted = [];
  const lru = createLruMap(2, (k, v) => evicted.push([k, v]));
  lru.set('a', 'blob:1');
  lru.set('b', 'blob:2');
  assert.equal(lru.get('a'), 'blob:1'); // 刷新 a 的活跃度，使 b 成为最旧项
  lru.set('c', 'blob:3');
  assert.deepEqual(evicted, [['b', 'blob:2']]);

  // 少于 12 楼时全部保持唤醒，避免短对话无谓切换
  const shortChat = Array.from({ length: 9 }, (_, i) => ({ id: i }));
  assert.equal(partitionChatMessages(shortChat, 8).hibernate.length, 0);
  assert.equal(partitionChatMessages(shortChat, 8).awake.length, 9);

  // 百楼长对话时仅保持底部最新 8 楼实时唤醒，上方 92 楼全部进入离屏渲染休眠
  const longChat = Array.from({ length: 100 }, (_, i) => ({ id: i }));
  const split = partitionChatMessages(longChat, 8);
  assert.equal(split.hibernate.length, 92);
  assert.equal(split.awake.length, 8);
  assert.equal(split.awake[0].id, 92);
});
