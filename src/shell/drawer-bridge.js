/**
 * ST伴侣 (st-mate) · Phase 1 原生抽屉顶部互切胶囊桥 (Drawer Bridge)
 * 在重构版「预设馆 (Phase 2)」与「角色/清爽世界书 (Phase 3)」上线前（或用户关闭对应重构模块时），
 * 在酒馆原生抽屉顶部注入极简导航条：
 *   - 左侧：「‹ 返回对话」一键收起抽屉（解决手机全屏抽屉难退出的痛点）
 *   - 右侧：成对抽屉秒切胶囊（[对话预设 ⇄ API连接] · [角色档案 ⇄ 世界书]）
 */

import { closeAllNativeDrawers, openNativeDrawer } from './host-actions.js?v=0.3.1';

const DRAWER_GROUPS = Object.freeze([
  {
    groupId: 'model-presets',
    tabs: [
      { drawerId: 'ai-config-button', label: '对话预设' },
      { drawerId: 'sys-settings-button', label: 'API与模型' },
    ],
  },
  {
    groupId: 'char-world',
    tabs: [
      { drawerId: 'rightNavHolder', label: '角色档案' },
      { drawerId: 'WI-SP-button', label: '世界书' },
    ],
  },
]);

const SOLO_DRAWERS = Object.freeze([
  { drawerId: 'persona-management-button', title: '人设管理' },
  { drawerId: 'extensions-settings-button', title: '第三方扩展设置' },
  { drawerId: 'backgrounds-button', title: '背景图管理' },
  { drawerId: 'user-settings-button', title: '酒馆界面与用户设置' },
  { drawerId: 'advanced-formatting-button', title: '高级回复格式' },
]);

export function createDrawerBridge({ getContext, store, onOpenSettings }) {
  const mountedBars = new Set();

  function buildBridgeBar({ activeDrawerId, tabs = null, soloTitle = '' }) {
    const doc = globalThis.document;
    const bar = doc.createElement('div');
    bar.className = 'stm-drawer-bridge';
    bar.dataset.stmDrawer = activeDrawerId;

    const backBtn = doc.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'stm-bridge-back';
    backBtn.innerHTML = '<span class="stm-bridge-chevron" aria-hidden="true">‹</span><span>返回</span>';
    backBtn.title = '收起当前面板，返回对话界面';
    backBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeAllNativeDrawers();
    });
    bar.append(backBtn);

    if (Array.isArray(tabs) && tabs.length > 0) {
      const seg = doc.createElement('div');
      seg.className = 'stm-bridge-tabs';
      seg.setAttribute('role', 'tablist');

      for (const tab of tabs) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        const isActive = tab.drawerId === activeDrawerId;
        btn.className = `stm-bridge-tab${isActive ? ' is-active' : ''}`;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(isActive));
        btn.textContent = tab.label;
        btn.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          if (tab.drawerId !== activeDrawerId) {
            openNativeDrawer(tab.drawerId, { toggleIfOpen: false, getContext });
          }
        });
        seg.append(btn);
      }
      bar.append(seg);
    } else if (soloTitle) {
      const title = doc.createElement('span');
      title.className = 'stm-bridge-title';
      title.textContent = soloTitle;
      bar.append(title);
    }

    const gearBtn = doc.createElement('button');
    gearBtn.type = 'button';
    gearBtn.className = 'stm-bridge-gear';
    gearBtn.title = '打开 ST伴侣设置中心';
    gearBtn.setAttribute('aria-label', '打开 ST伴侣设置中心');
    gearBtn.textContent = '伴侣设置';
    gearBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeAllNativeDrawers();
      onOpenSettings?.();
    });
    bar.append(gearBtn);

    return bar;
  }

  function ensureMounted() {
    const doc = globalThis.document;
    if (!doc) return;

    const enabled = store.get().shellEnabled;
    if (!enabled) {
      cleanupBars();
      return;
    }

    for (const group of DRAWER_GROUPS) {
      for (const tab of group.tabs) {
        mountIntoDrawer(tab.drawerId, { tabs: group.tabs });
      }
    }
    for (const solo of SOLO_DRAWERS) {
      mountIntoDrawer(solo.drawerId, { soloTitle: solo.title });
    }
  }

  function mountIntoDrawer(drawerId, config) {
    const doc = globalThis.document;
    const holder = doc?.getElementById(drawerId);
    const content = holder?.querySelector(':scope > .drawer-content');
    if (!content) return;

    let existing = content.querySelector(':scope > .stm-drawer-bridge');
    if (!existing) {
      existing = buildBridgeBar({ activeDrawerId: drawerId, ...config });
      content.prepend(existing);
      mountedBars.add(existing);
    }
  }

  function cleanupBars() {
    for (const bar of mountedBars) {
      bar.remove();
    }
    mountedBars.clear();
    globalThis.document?.querySelectorAll('.stm-drawer-bridge').forEach(el => el.remove());
  }

  return {
    sync: ensureMounted,
    destroy: cleanupBars,
  };
}
