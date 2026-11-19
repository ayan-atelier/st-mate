/**
 * ST伴侣 (st-mate) · 「ST伴侣设置中心」两页签极简控制面板 + 保底原生入口
 * 遵循《砚台全系插件 UI 与交互设计规范》：
 * 1. 精简合并为「功能开关」与「扩展与原生」2 大页签，彻底剔除与顶栏 Aa / API 面板重复的冗余滑杆和重复配置；
 * 2. 所有条目收敛为单行清爽布局「图标 + 名称 + 圆圈 ? + 开关/箭头」，说明文案按需点 ? 展开，手机一屏看全；
 * 3. 全套 1.5px 纯色细线 SVG 图标（零彩色 Emoji），100% 跟随当前酒馆 SmartTheme 主题配色。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.7.6';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.7.6';
import { closeAllNativeDrawers, openNativeDrawer } from './host-actions.js?v=0.7.6';

const TABS = Object.freeze([
  { id: 'modules', icon: 'grid', label: '功能开关' },
  { id: 'native', icon: 'layers', label: '扩展与原生' },
]);

const PRIMARY_NATIVE_SHORTCUTS = Object.freeze([
  {
    key: 'theme',
    drawerId: 'user-settings-button',
    icon: 'palette',
    title: '酒馆界面与美化主题',
    desc: '调整酒馆 UI 主题配色、自定义美化 CSS、气泡样式与流式速度。',
  },
  {
    key: 'ext',
    drawerId: 'extensions-settings-button',
    icon: 'grid',
    title: '第三方扩展设置',
    desc: '集中打开酒馆助手、TTS语音、文生图、正则等外部插件的设置面板。',
  },
]);

const MORE_NATIVE_SHORTCUTS = Object.freeze([
  {
    key: 'char',
    drawerId: 'rightNavHolder',
    icon: 'idcard',
    title: '酒馆原生角色与群聊抽屉',
    desc: '更换角色卡原图文件、编辑群聊自动发言策略或原生标签管理。',
  },
  {
    key: 'wi',
    drawerId: 'WI-SP-button',
    icon: 'globe',
    title: '酒馆原生世界书面板',
    desc: '配置高级递归预算、批量组打分或词条向量参数时直达原生面板。',
  },
  {
    key: 'bg',
    drawerId: 'backgrounds-button',
    icon: 'image',
    title: '酒馆原生背景图库',
    desc: '更换或管理酒馆自带的全局背景图片库。',
  },
  {
    key: 'fmt',
    drawerId: 'advanced-formatting-button',
    icon: 'code',
    title: '高级回复格式',
    desc: '查看底层提示词模板、上下文格式与推理标签解析设置。',
  },
]);

export function createSettingsDialog({
  getContext,
  store,
  moduleBridge,
  onToggleShell,
  onOpenReaderDock,
  onOpenApiDock,
  onOpenPresetDock,
  onOpenPresetAssistant,
  onOpenCharWorldDock,
  onOpenStateChange,
  onAfterOpenNativeDrawer,
}) {
  let dialogEl = null;
  let bodyEl = null;
  let activeTab = 'modules';
  let expandedHelpKey = '';
  let internalUpdating = false;

  function el(tag, className = '', text = '') {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function updateStoreFromDialog(patch, { reRender = true } = {}) {
    internalUpdating = true;
    try {
      store.update(patch);
    } finally {
      internalUpdating = false;
    }
    if (reRender) {
      render();
    }
  }

  function isDialogOpen() {
    return Boolean(dialogEl && (dialogEl.open || dialogEl.hasAttribute?.('open')));
  }

  function close() {
    const wasOpen = isDialogOpen();
    if (dialogEl?.open) {
      dialogEl.close();
    } else if (dialogEl) {
      dialogEl.removeAttribute('open');
    }
    if (wasOpen) {
      onOpenStateChange?.(false);
    }
  }

  function ensureDialog() {
    const doc = globalThis.document;
    if (!doc) return null;
    if (dialogEl?.isConnected) return dialogEl;

    dialogEl = doc.getElementById('stm-settings-dialog') || el('dialog', 'stm-dialog');
    dialogEl.id = 'stm-settings-dialog';
    dialogEl.replaceChildren();

    const header = el('header', 'stm-dialog-header');
    const titleWrap = el('div', 'stm-dialog-title-wrap');
    const title = el('h2', 'stm-dialog-title', 'ST伴侣');
    const badge = el('span', 'stm-dialog-badge', 'v0.7.6');
    titleWrap.append(title, badge);

    const headerRight = el('div', 'stm-dialog-header-actions');
    const quickNativeBtn = el('button', 'stm-pill-btn', '');
    quickNativeBtn.type = 'button';
    quickNativeBtn.addEventListener('click', async () => {
      const next = !store.get().shellEnabled;
      internalUpdating = true;
      try {
        await onToggleShell?.(next);
      } finally {
        internalUpdating = false;
      }
      render();
    });
    dialogEl._quickNativeBtn = quickNativeBtn;

    const closeBtn = el('button', 'stm-dialog-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = '关闭';
    closeBtn.setAttribute('aria-label', '关闭设置窗口');
    closeBtn.addEventListener('click', close);

    headerRight.append(quickNativeBtn, closeBtn);
    header.append(titleWrap, headerRight);

    const tabBar = el('nav', 'stm-tabs is-two-tabs');
    tabBar.setAttribute('role', 'tablist');
    dialogEl._tabButtons = new Map();

    for (const tab of TABS) {
      const btn = el('button', 'stm-tab-btn');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.append(createIconNode(doc, tab.icon, 'stm-tab-icon'), el('span', '', tab.label));
      btn.addEventListener('click', () => {
        if (activeTab === tab.id) return;
        activeTab = tab.id;
        expandedHelpKey = '';
        render();
      });
      dialogEl._tabButtons.set(tab.id, btn);
      tabBar.append(btn);
    }

    bodyEl = el('div', 'stm-dialog-body');
    dialogEl.append(header, tabBar, bodyEl);
    dialogEl.addEventListener('click', event => {
      if (event.target === dialogEl) close();
    });

    doc.body.append(dialogEl);
    return dialogEl;
  }

  function makeHelpTriggerButton(helpKey, title) {
    const doc = globalThis.document;
    const isOpen = expandedHelpKey === helpKey;
    const btn = el('button', `stm-help-btn${isOpen ? ' is-active' : ''}`);
    btn.type = 'button';
    btn.title = isOpen ? '收起说明' : `查看「${title}」说明`;
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-expanded', String(isOpen));
    btn.append(createIconNode(doc, 'help', 'stm-help-svg'));
    btn.addEventListener('click', evt => {
      evt.preventDefault();
      evt.stopPropagation();
      expandedHelpKey = expandedHelpKey === helpKey ? '' : helpKey;
      render();
    });
    return btn;
  }

  function makeSwitchRow({ helpKey, icon = '', title, desc = '', badgeText = '', checked, onChange }) {
    const doc = globalThis.document;
    const isHelpOpen = Boolean(desc && expandedHelpKey === helpKey);
    const card = el('div', `stm-switch-card is-compact${isHelpOpen ? ' is-help-open' : ''}`);

    const bar = el('div', 'stm-switch-bar');
    const head = el('div', 'stm-switch-head');
    if (icon) {
      head.append(createIconNode(doc, icon, 'stm-row-icon'));
    }
    head.append(el('strong', 'stm-switch-title', title));
    if (desc) {
      head.append(makeHelpTriggerButton(helpKey, title));
    }
    if (badgeText) {
      head.append(el('span', 'stm-chip', badgeText));
    }

    const toggleLabel = el('label', 'stm-switch-toggle-wrap');
    const input = el('input', 'stm-switch-input');
    input.type = 'checkbox';
    input.checked = Boolean(checked);
    input.addEventListener('change', () => onChange(input.checked));
    const slider = el('span', 'stm-switch-track');
    toggleLabel.append(input, slider);

    // 点击标题区（非 ? 按钮）也可顺手切换开关，兼顾手机单手触控
    head.addEventListener('click', evt => {
      const target = evt.target;
      if (target && typeof target.closest === 'function' && target.closest('.stm-help-btn')) {
        return;
      }
      input.checked = !input.checked;
      onChange(input.checked);
    });

    bar.append(head, toggleLabel);
    card.append(bar);

    if (isHelpOpen) {
      card.append(el('div', 'stm-switch-help-pop', desc));
    }

    return card;
  }

  function renderModulesTab(container, current) {
    const coreGroup = el('div', 'stm-settings-group');
    coreGroup.append(
      makeSwitchRow({
        helpKey: 'shell_master',
        icon: 'home',
        title: 'ST伴侣全套模式（总开关）',
        desc: '开启时启用沉浸顶栏与已勾选模块；关闭后一键挂起全部接管直达原生酒馆，重新开启时原样恢复你的勾选组合。',
        badgeText: current.shellEnabled ? '' : '原生模式中',
        checked: current.shellEnabled,
        onChange: async val => {
          internalUpdating = true;
          try {
            await onToggleShell?.(val);
          } finally {
            internalUpdating = false;
          }
          render();
        },
      }),
    );

    const modulesList = moduleBridge.inspectAll();
    for (const mod of modulesList) {
      let badgeText = '';
      if (!current.shellEnabled && mod.enabled) {
        badgeText = '随原生挂起';
      } else if (mod.standaloneConnected && mod.version) {
        badgeText = `v${mod.version}`;
      }

      coreGroup.append(
        makeSwitchRow({
          helpKey: `mod_${mod.key}`,
          icon: mod.icon,
          title: mod.label,
          desc: mod.summary,
          badgeText,
          checked: mod.enabled,
          onChange: async val => {
            internalUpdating = true;
            try {
              store.update({ modules: { [mod.key]: val } });
              if (store.get().shellEnabled) {
                await moduleBridge.syncModuleEnabled(mod.key, val);
              }
            } finally {
              internalUpdating = false;
            }
            render();
          },
        }),
      );
    }
    container.append(coreGroup);

    container.append(el('div', 'stm-settings-subhead', '阅读手势与菜单精简'));

    const tidyGroup = el('div', 'stm-settings-group');
    tidyGroup.append(
      makeSwitchRow({
        helpKey: 'tap_pure_reading',
        icon: 'spark',
        title: '轻触正文「全屏纯享阅读」',
        desc: '阅读时轻点正文空白或普通文字，顶栏与底栏输入区零重排丝滑隐去；再点一下立即恢复（自动避开划词、滚动与按钮）。',
        checked: current.tapPureReading,
        onChange: val => {
          updateStoreFromDialog({ tapPureReading: val });
        },
      }),
      makeSwitchRow({
        helpKey: 'fold_options_menu',
        icon: 'fold',
        title: '收纳底栏「☰ 三横」低频原生项',
        desc: '保留全部第三方插件入口不动，仅把作者注释、Token 概率、CFG 等低频原生项收进「更多原生工具」。',
        checked: current.tidy.foldOptionsMenu,
        onChange: val => {
          updateStoreFromDialog({ tidy: { foldOptionsMenu: val } });
        },
      }),
    );
    container.append(tidyGroup);
  }

  function buildShortcutGroup(doc, items) {
    const group = el('div', 'stm-settings-group stm-shortcut-list');
    for (const item of items) {
      const helpKey = `native_${item.key}`;
      const isHelpOpen = expandedHelpKey === helpKey;
      const wrap = el('div', `stm-shortcut-item is-compact${isHelpOpen ? ' is-help-open' : ''}`);

      const mainBar = el('div', 'stm-shortcut-bar');
      const head = el('div', 'stm-switch-head');
      head.append(
        createIconNode(doc, item.icon, 'stm-row-icon'),
        el('strong', 'stm-switch-title', item.title),
        makeHelpTriggerButton(helpKey, item.title),
      );
      mainBar.append(head, el('span', 'stm-shortcut-arrow', '›'));
      mainBar.addEventListener('click', evt => {
        const target = evt.target;
        if (target && typeof target.closest === 'function' && target.closest('.stm-help-btn')) {
          return;
        }
        close();
        openNativeDrawer(item.drawerId, { getContext });
        onAfterOpenNativeDrawer?.();
      });

      wrap.append(mainBar);
      if (isHelpOpen) {
        wrap.append(el('div', 'stm-switch-help-pop', item.desc));
      }
      group.append(wrap);
    }
    return group;
  }

  function renderNativeTab(container, current) {
    const doc = globalThis.document;

    // 首屏第 1、2 行直接固定最高频的「酒馆界面与美化主题」与「第三方扩展设置」
    container.append(buildShortcutGroup(doc, PRIMARY_NATIVE_SHORTCUTS));

    container.append(el('div', 'stm-settings-subhead', '更多酒馆原生面板'));
    container.append(buildShortcutGroup(doc, MORE_NATIVE_SHORTCUTS));

    container.append(el('div', 'stm-settings-subhead', '伴侣工作台直达'));

    const btnRow = el('div', 'stm-action-grid');
    const openApiBtn = el('button', 'stm-action-card');
    openApiBtn.type = 'button';
    openApiBtn.append(createIconNode(doc, 'plug', 'stm-row-icon'), el('span', '', 'API 与模型工作台'));
    openApiBtn.addEventListener('click', () => {
      close();
      if (current.shellEnabled && typeof onOpenApiDock === 'function') {
        onOpenApiDock();
      } else {
        openNativeDrawer('sys-settings-button', { getContext });
        onAfterOpenNativeDrawer?.();
      }
    });

    const openPresetBtn = el('button', 'stm-action-card');
    openPresetBtn.type = 'button';
    openPresetBtn.append(createIconNode(doc, 'sliders', 'stm-row-icon'), el('span', '', '预设馆工作台'));
    openPresetBtn.addEventListener('click', () => {
      close();
      if (current.shellEnabled && current.modules.presets && typeof onOpenPresetDock === 'function') {
        onOpenPresetDock();
      } else {
        openNativeDrawer('ai-config-button', { getContext });
        onAfterOpenNativeDrawer?.();
      }
    });

    const openAssistantBtn = el('button', 'stm-action-card');
    openAssistantBtn.type = 'button';
    openAssistantBtn.append(createIconNode(doc, 'spark', 'stm-row-icon'), el('span', '', '伴侣预设助手'));
    openAssistantBtn.addEventListener('click', () => {
      close();
      if (current.shellEnabled && current.modules.presets && typeof onOpenPresetAssistant === 'function') {
        onOpenPresetAssistant();
      } else if (current.shellEnabled && current.modules.presets && typeof onOpenPresetDock === 'function') {
        onOpenPresetDock();
      } else {
        openNativeDrawer('ai-config-button', { getContext });
        onAfterOpenNativeDrawer?.();
      }
    });

    const openCharWorldBtn = el('button', 'stm-action-card');
    openCharWorldBtn.type = 'button';
    openCharWorldBtn.append(createIconNode(doc, 'book', 'stm-row-icon'), el('span', '', '角色与清爽世界书'));
    openCharWorldBtn.addEventListener('click', () => {
      close();
      if (current.shellEnabled && current.modules.charWorld && typeof onOpenCharWorldDock === 'function') {
        onOpenCharWorldDock(hasActiveChatSelection(getContext?.()) ? 'char' : 'world');
      } else {
        openNativeDrawer(hasActiveChatSelection(getContext?.()) ? 'rightNavHolder' : 'WI-SP-button', { getContext });
        onAfterOpenNativeDrawer?.();
      }
    });

    btnRow.append(openApiBtn, openPresetBtn, openAssistantBtn, openCharWorldBtn);
    container.append(btnRow);
  }

  function render() {
    const dlg = ensureDialog();
    if (!dlg || !bodyEl) return;

    const current = store.get();
    dlg._quickNativeBtn.textContent = current.shellEnabled ? '切回原生酒馆' : '恢复伴侣界面';

    for (const [id, btn] of dlg._tabButtons.entries()) {
      const selected = id === activeTab;
      btn.classList.toggle('is-active', selected);
      btn.setAttribute('aria-selected', String(selected));
    }

    bodyEl.replaceChildren();
    if (activeTab === 'modules') renderModulesTab(bodyEl, current);
    else renderNativeTab(bodyEl, current);
  }

  function open(tabId = null) {
    if (tabId === 'reading') {
      activeTab = 'modules';
    } else if (tabId === 'api') {
      activeTab = 'native';
    } else if (tabId && TABS.some(t => t.id === tabId)) {
      activeTab = tabId;
    }
    const dlg = ensureDialog();
    if (!dlg) return;
    render();
    if (!isDialogOpen()) {
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute('open', '');
      }
      onOpenStateChange?.(true);
    }
  }

  function installFallbackEntries() {
    const doc = globalThis.document;
    if (!doc) return;

    const wandMenu = doc.getElementById('extensionsMenu');
    if (wandMenu && !doc.getElementById('stm-wand-entry')) {
      const item = el('div', 'list-group-item flex-container flexGap5 interactable');
      item.id = 'stm-wand-entry';
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.innerHTML = `<span class="stm-inline-svg" aria-hidden="true">${svgMarkup('settings')}</span><span>ST伴侣设置</span>`;
      item.addEventListener('click', () => open());
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      wandMenu.prepend(item);
    }

    const extHost = doc.getElementById('extensions_settings2') || doc.getElementById('extensions_settings');
    if (extHost) {
      let wrap = doc.getElementById('stm-ext-inline-drawer');
      if (!wrap) {
        wrap = el('div');
        wrap.id = 'stm-ext-inline-drawer';
        const drawer = el('div', 'inline-drawer');
        const header = el('div', 'inline-drawer-toggle inline-drawer-header');
        const icon = el('div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down');
        icon.setAttribute('aria-hidden', 'true');
        header.append(el('b', '', '砚台 · ST伴侣'), icon);

        const content = el('div', 'inline-drawer-content stm-ext-drawer-body');
        const status = el('small', 'stm-ext-status', '');
        const desc = el(
          'p',
          'stm-ext-help',
          '集成沉浸顶栏、角色档案与清爽世界书、预设馆与伴侣助手、API多站子工作台、页面排版及流畅渲染引擎。所有模块均可独立开关，随时一键无损切回原生酒馆。',
        );

        const checkLabel = el('label', 'checkbox_label stm-ext-check');
        const checkInput = el('input');
        checkInput.type = 'checkbox';
        checkInput.addEventListener('change', () => {
          void Promise.resolve(onToggleShell?.(checkInput.checked)).then(() => {
            installFallbackEntries();
          });
        });
        checkLabel.append(checkInput, el('span', '', '启用 ST伴侣界面接管'));

        const actions = el('div', 'stm-ext-actions');
        const openBtn = el('button', 'menu_button', '打开设置中心');
        openBtn.type = 'button';
        openBtn.addEventListener('click', () => open());

        const apiBtn = el('button', 'menu_button', 'API与模型工作台');
        apiBtn.type = 'button';
        apiBtn.addEventListener('click', () => {
          closeAllNativeDrawers();
          onOpenApiDock?.();
        });

        const presetBtn = el('button', 'menu_button', '预设馆面板');
        presetBtn.type = 'button';
        presetBtn.addEventListener('click', () => {
          closeAllNativeDrawers();
          if (store.get().shellEnabled && store.get().modules.presets && typeof onOpenPresetDock === 'function') {
            onOpenPresetDock();
          } else {
            openNativeDrawer('ai-config-button', { getContext });
          }
        });

        const readerBtn = el('button', 'menu_button', '页面排版与背景');
        readerBtn.type = 'button';
        readerBtn.addEventListener('click', () => {
          if (!hasActiveChatSelection(getContext?.())) {
            open('modules');
            return;
          }
          closeAllNativeDrawers();
          onOpenReaderDock?.();
        });

        const charWorldBtn = el('button', 'menu_button', '角色与清爽世界书');
        charWorldBtn.type = 'button';
        charWorldBtn.addEventListener('click', () => {
          closeAllNativeDrawers();
          if (store.get().shellEnabled && store.get().modules.charWorld && typeof onOpenCharWorldDock === 'function') {
            onOpenCharWorldDock(hasActiveChatSelection(getContext?.()) ? 'char' : 'world');
          } else {
            openNativeDrawer('rightNavHolder', { getContext });
          }
        });

        const assistantBtn = el('button', 'menu_button', '伴侣预设助手');
        assistantBtn.type = 'button';
        assistantBtn.addEventListener('click', () => {
          closeAllNativeDrawers();
          if (store.get().shellEnabled && store.get().modules.presets && typeof onOpenPresetAssistant === 'function') {
            onOpenPresetAssistant();
          } else {
            openNativeDrawer('ai-config-button', { getContext });
          }
        });

        actions.append(openBtn, apiBtn, presetBtn, assistantBtn, charWorldBtn, readerBtn);
        content.append(status, desc, checkLabel, actions);
        drawer.append(header, content);
        wrap.append(drawer);
        extHost.prepend(wrap);
      }

      const s = store.get();
      const statusNode = wrap.querySelector('.stm-ext-status');
      if (statusNode) {
        statusNode.textContent = `${s.shellEnabled ? '已启用' : '已挂起（原生酒馆态）'} · v0.7.6 · ${
          s.modules.turbo ? '流畅渲染加速运行中' : '流畅渲染加速已关闭'
        }`;
      }
      const checkNode = wrap.querySelector('.stm-ext-check input[type="checkbox"]');
      if (checkNode && checkNode.checked !== Boolean(s.shellEnabled)) {
        checkNode.checked = Boolean(s.shellEnabled);
      }
    }
  }

  function destroy() {
    close();
    dialogEl?.remove();
    dialogEl = null;
    bodyEl = null;
    const doc = globalThis.document;
    doc?.getElementById('stm-wand-entry')?.remove();
    doc?.getElementById('stm-ext-inline-drawer')?.remove();
  }

  return {
    isOpen: isDialogOpen,
    open,
    close,
    renderIfOpen: () => {
      if (isDialogOpen() && !internalUpdating) render();
    },
    installFallbackEntries,
    destroy,
  };
}
