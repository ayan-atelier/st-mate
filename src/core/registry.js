/**
 * ST伴侣 (st-mate) · 模块控制注册表与独立子插件无损协同桥
 * 统一对接 Symbol.for('yantai.control.registry.v1')，自动发现已安装的独立砚台插件，
 * 杜绝双份 DOM 挂载、重复事件监听与顶栏控制权打架。
 */

import { retireRedundantLegacyPlugins } from './suite-guard.js?v=0.9.5';

export const CONTROL_REGISTRY_KEY = Symbol.for('yantai.control.registry.v1');
export const STM_RUNTIME_KEY = Symbol.for('yantai.st_mate.runtime.v1');

export const MODULE_DESCRIPTORS = Object.freeze([
  {
    key: 'turbo',
    registryId: 'st-mate:turbo',
    settingsNamespace: 'st_mate',
    builtin: true,
    label: '流畅渲染引擎（隐形加速）',
    icon: 'zap',
    summary: '默认静默开启：后台压缩缓存高清角色底图、自动休眠屏幕外长对话历史楼层，并在手机端卸除高耗电毛玻璃与弹键盘抖动。',
  },
  {
    key: 'reader',
    registryId: 'st-mate:reader',
    settingsNamespace: 'st_mate',
    builtin: true,
    label: '页面排版与背景',
    icon: 'typography',
    summary: '点顶栏 Aa 展开与酒馆等宽的页面调整抽屉：支持字号、边距、首行顶格/缩进、行距，角色图/自定义裁切底图，以及字体、隐去头像与防误触右滑重Roll开关。',
  },
  {
    key: 'bookshelf',
    registryId: 'yantai-bookshelf',
    settingsNamespace: 'jingdu_bookshelf',
    label: '角色书架首页',
    icon: 'shelf',
    summary: '首页展示 3:4 竖版角色卡画册、分类文件夹与多存档管理；关闭后恢复酒馆原版欢迎页。',
  },
  {
    key: 'presets',
    registryId: 'yantai-presets',
    settingsNamespace: 'st_mate_presets',
    label: '预设馆系统',
    icon: 'sliders',
    summary: '点顶栏预设胶囊展开预设馆：支持全局默认预设、角色专属绑定自动秒切、预设仓库收纳，以及参数与提示词条目开关编辑（关闭后回退酒馆原生预设面板）。',
  },
  {
    key: 'persona',
    registryId: 'yantai-persona-studio',
    settingsNamespace: 'yantai-persona-studio',
    label: '人设馆系统',
    icon: 'user',
    summary: '高清人设图库、多档绑定与 AI 人设搭档；关闭后点顶栏人设键直接打开酒馆原生人设面板。',
  },
  {
    key: 'charWorld',
    registryId: 'yantai-char-world',
    settingsNamespace: 'st_mate_char_world',
    label: '角色与世界书页',
    icon: 'book',
    summary: '点顶栏左侧角色头像与名称展开一体页：支持角色名录速进、导出 PNG/JSON 角色卡、开局第1楼一键换开场白、专属预设与世界书绑定，以及防假生效的蓝绿灯世界书管理（关闭后回退原生角色/世界书面板）。',
  },
  {
    key: 'echoes',
    registryId: 'yantai-echoes',
    settingsNamespace: 'yantai_echoes',
    label: '重Roll回看加强',
    icon: 'branch',
    summary: '默认关闭保持楼层极简；开启后可在楼层底部回看历史重Roll、加星收藏或分叉新支线。',
  },
  {
    key: 'memory',
    registryId: 'yantai-memory',
    settingsNamespace: 'yantai_memory_v2',
    label: '叙事记忆系统',
    icon: 'memory',
    summary: '默认关闭且零生成拦截，方便你混用表格记忆等外部插件；开启后启用砚台因果记忆台。',
  },
]);

export function ensureControlRegistry(root = globalThis) {
  const existing = root[CONTROL_REGISTRY_KEY];
  if (existing && typeof existing === 'object' && existing.modules instanceof Map) {
    return existing;
  }
  const registry = {
    version: 1,
    modules: existing?.modules instanceof Map ? existing.modules : new Map(),
  };
  root[CONTROL_REGISTRY_KEY] = registry;
  return registry;
}

export function createModuleBridge({ root = globalThis, getContext, store }) {
  const registry = ensureControlRegistry(root);

  function getRegisteredHandle(registryId) {
    return registry.modules.get(registryId) || null;
  }

  /**
   * 同步子模块开关状态：
   * 1. 若子插件已注册标准 controlModule.setEnabled(bool)，优先调用官方接口实时卸载/挂载；
   * 2. 若是尚未注册 controlModule 的旧版独立《重Roll助手》，同步写入其 extensionSettings.yantai_echoes.enabled
   *    并即时清理/刷新页面上的 .yte-bar 节点。
   */
  async function syncModuleEnabled(moduleKey, enabled) {
    const desc = MODULE_DESCRIPTORS.find(item => item.key === moduleKey);
    if (!desc) return false;

    const targetState = Boolean(enabled);
    const handle = getRegisteredHandle(desc.registryId);
    if (handle && typeof handle.setEnabled === 'function') {
      let alreadyAligned = false;
      if (typeof handle.inspect === 'function') {
        try {
          alreadyAligned = handle.inspect()?.enabled === targetState;
        } catch {
          alreadyAligned = false;
        }
      }
      if (!alreadyAligned) {
        await handle.setEnabled(targetState);
      }
      return true;
    }

    const ctx = getContext?.();
    const extSettings = ctx?.extensionSettings;
    if (moduleKey === 'bookshelf' && extSettings && typeof extSettings === 'object') {
      if (!extSettings.jingdu_bookshelf || typeof extSettings.jingdu_bookshelf !== 'object') {
        extSettings.jingdu_bookshelf = {};
      }
      if (extSettings.jingdu_bookshelf.enabled !== targetState) {
        extSettings.jingdu_bookshelf.enabled = targetState;
        ctx.saveSettingsDebounced?.();
      }
      return true;
    }
    if (moduleKey === 'persona' && extSettings && typeof extSettings === 'object') {
      if (!extSettings['yantai-persona-studio'] || typeof extSettings['yantai-persona-studio'] !== 'object') {
        extSettings['yantai-persona-studio'] = {};
      }
      if (extSettings['yantai-persona-studio'].enabled !== targetState) {
        extSettings['yantai-persona-studio'].enabled = targetState;
        ctx.saveSettingsDebounced?.();
      }
      return true;
    }
    if (moduleKey === 'memory' && extSettings && typeof extSettings === 'object') {
      if (!extSettings.yantai || typeof extSettings.yantai !== 'object') {
        extSettings.yantai = {};
      }
      if (extSettings.yantai.controlEnabled !== targetState) {
        extSettings.yantai.controlEnabled = targetState;
        ctx.saveSettingsDebounced?.();
      }
      return true;
    }
    if (moduleKey === 'echoes' && extSettings && typeof extSettings === 'object') {
      if (!extSettings.yantai_echoes || typeof extSettings.yantai_echoes !== 'object') {
        extSettings.yantai_echoes = {};
      }
      extSettings.yantai_echoes.enabled = targetState;
      ctx.saveSettingsDebounced?.();

      const doc = root?.document;
      if (doc) {
        const check = doc.getElementById('yte-setting-enabled');
        if (check && check.checked !== targetState) {
          check.checked = targetState;
          check.dispatchEvent(new root.Event('change', { bubbles: true }));
        } else if (!targetState) {
          doc.querySelectorAll('.yte-bar, .yte-panel').forEach(node => node.remove());
        }
      }
      return true;
    }

    return false;
  }

  /**
   * 当 ST伴侣开启顶栏接管时，若检测到旧版独立《砚台 · 界面整理》仍在运行，
   * 自动将其无损停用并清理其 display:contents / hiddenTop 与三横菜单包裹，杜绝双跑与 iOS TT 闪退。
   */
  function yieldLegacyInterfaceTopbar() {
    if (!store.get().shellEnabled) return false;
    const res = retireRedundantLegacyPlugins({ root, getContext });
    return Boolean(res.retiredInterface);
  }

  function inspectAll() {
    const current = store.get();
    return MODULE_DESCRIPTORS.map(desc => {
      const handle = getRegisteredHandle(desc.registryId);
      let externalReport = null;
      if (handle && typeof handle.inspect === 'function') {
        try {
          externalReport = handle.inspect();
        } catch {
          externalReport = null;
        }
      }
      return {
        ...desc,
        enabled: Boolean(current.modules?.[desc.key]),
        standaloneConnected: Boolean(handle),
        version: handle?.version || null,
        health: externalReport?.health || (handle ? 'ok' : 'standby'),
      };
    });
  }

  /**
   * 一键全量挂起回纯原生酒馆：
   * 不擦除 store.get().modules 里保存的玩家个人偏好，只将所有受控子插件临时卸载回原生状态；
   * 等玩家点「回到 ST伴侣」时，applyAllFromStore() 会按原样瞬间恢复！
   */
  async function suspendAllForNative() {
    for (const key of ['bookshelf', 'persona', 'echoes', 'memory']) {
      await syncModuleEnabled(key, false);
    }
  }

  async function applyAllFromStore() {
    const current = store.get();
    if (!current.shellEnabled) {
      await suspendAllForNative();
      return;
    }
    yieldLegacyInterfaceTopbar();
    for (const key of ['bookshelf', 'persona', 'echoes', 'memory']) {
      await syncModuleEnabled(key, current.modules[key]);
    }
  }

  return {
    registry,
    getRegisteredHandle,
    syncModuleEnabled,
    suspendAllForNative,
    yieldLegacyInterfaceTopbar,
    inspectAll,
    applyAllFromStore,
  };
}
