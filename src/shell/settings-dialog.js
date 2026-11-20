/**
 * ST伴侣 (st-mate) · 「ST伴侣设置中心」两页签极简控制面板 + 保底原生入口
 * 遵循《砚台全系插件 UI 与交互设计规范》：
 * 1. 精简合并为「功能开关」与「扩展与原生」2 大页签，彻底剔除与顶栏 Aa / API 面板重复的冗余滑杆和重复配置；
 * 2. 所有条目收敛为单行清爽布局「图标 + 名称 + 圆圈 ? + 开关/箭头」，说明文案按需点 ? 展开，手机一屏看全；
 * 3. 全套 1.5px 纯色细线 SVG 图标（零彩色 Emoji），100% 跟随当前酒馆 SmartTheme 主题配色。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.7.9';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.7.9';
import { closeAllNativeDrawers, openNativeDrawer } from './host-actions.js?v=0.7.9';

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
  suiteCoordinator = null,
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
    const badge = el('span', 'stm-dialog-badge', 'v0.7.9');
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

  function makeTopbarStyleRow(current) {
    const doc = globalThis.document;
    const helpKey = 'topbar_style_mode';
    const desc =
      '「伴侣顶栏」提供极简沉浸顶栏与一键退回书架；「原版顶栏」100% 保留当前美化主题的原版胶囊顶栏外观（齿轮仍开原生美化主题），同时将冗余的 T 键升级为 Aa 页面排版、隐去低频原生背景键，并照常使用伴侣各大工作台。';
    const isHelpOpen = expandedHelpKey === helpKey;
    const card = el('div', `stm-switch-card is-compact${isHelpOpen ? ' is-help-open' : ''}`);

    const bar = el('div', 'stm-switch-bar stm-mode-bar');
    const head = el('div', 'stm-switch-head');
    head.append(
      createIconNode(doc, 'layers', 'stm-row-icon'),
      el('strong', 'stm-switch-title', '对话顶栏样式'),
      makeHelpTriggerButton(helpKey, '对话顶栏样式'),
    );

    const seg = el('div', 'stm-mode-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', '对话顶栏样式切换');
    for (const [modeId, label] of [
      ['rp', '伴侣顶栏'],
      ['native', '原版顶栏'],
    ]) {
      const btn = el(
        'button',
        `stm-mode-seg-btn${current.topbarMode === modeId ? ' is-active' : ''}`,
        label,
      );
      btn.type = 'button';
      btn.disabled = !current.shellEnabled;
      btn.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        if (!current.shellEnabled || current.topbarMode === modeId) return;
        updateStoreFromDialog({ topbarMode: modeId });
      });
      seg.append(btn);
    }

    bar.append(head, seg);
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
      makeTopbarStyleRow(current),
    );

    const modulesList = moduleBridge.inspectAll();
    const suiteBusy = Boolean(suiteCoordinator?.isBusy?.());
    for (const mod of modulesList) {
      const compInfo = suiteCoordinator?.getCompanionStatus?.(mod.key) || null;
      let badgeText = '';
      if (!current.shellEnabled && mod.enabled) {
        badgeText = '随原生挂起';
      } else if (compInfo?.status === 'missing') {
        badgeText = suiteBusy ? '正在安装…' : '未安装 · 点开即装';
      } else if (compInfo?.status === 'host_disabled') {
        badgeText = '扩展栏已停用 · 点开恢复';
      } else if (compInfo?.status === 'outdated') {
        badgeText = `${compInfo.version ? `v${compInfo.version} · ` : ''}建议更新`;
      } else if (mod.standaloneConnected && mod.version) {
        badgeText = `v${mod.version}`;
      } else if (compInfo?.version) {
        badgeText = `v${compInfo.version}`;
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
              const latestComp = suiteCoordinator?.getCompanionStatus?.(mod.key) || null;
              if (
                val &&
                suiteCoordinator &&
                latestComp &&
                (latestComp.status === 'missing' || latestComp.status === 'host_disabled')
              ) {
                await suiteCoordinator.installCompanions({
                  moduleKeys: [mod.key],
                  forceReinstall: true,
                });
              } else if (store.get().shellEnabled) {
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

    if (suiteCoordinator) {
      const auditState = suiteCoordinator.getAuditState?.();
      const missingItems = (auditState?.companions || []).filter(c => c.status === 'missing');
      const outdatedItems = (auditState?.companions || []).filter(c => c.status === 'outdated');

      if (suiteBusy) {
        const banner = el('div', 'stm-suite-banner');
        banner.append(
          createIconNode(globalThis.document, 'refresh', 'stm-row-icon'),
          el('span', 'stm-suite-banner-text', suiteCoordinator.getBusyLabel?.() || '正在同步砚台配套组件…'),
        );
        container.append(banner);
      } else if (missingItems.length > 0) {
        const banner = el('div', 'stm-suite-banner');
        banner.append(
          createIconNode(globalThis.document, 'download', 'stm-row-icon'),
          el(
            'span',
            'stm-suite-banner-text',
            `尚有 ${missingItems.length} 项配套组件未安装（${missingItems.map(i => i.displayName.replace(/^砚台\s*·\s*/, '')).join(' / ')}）`,
          ),
        );
        const fixBtn = el('button', 'stm-pill-btn stm-suite-banner-btn', '一键补齐套件');
        fixBtn.type = 'button';
        fixBtn.addEventListener('click', async () => {
          await suiteCoordinator.installCompanions({ forceReinstall: true });
          render();
        });
        banner.append(fixBtn);
        container.append(banner);
      } else if (outdatedItems.length > 0) {
        const banner = el('div', 'stm-suite-banner');
        banner.append(
          createIconNode(globalThis.document, 'refresh', 'stm-row-icon'),
          el(
            'span',
            'stm-suite-banner-text',
            `检测到 ${outdatedItems.length} 项配套组件可升级至兼容新版`,
          ),
        );
        const upBtn = el('button', 'stm-pill-btn stm-suite-banner-btn', '一键更新套件');
        upBtn.type = 'button';
        upBtn.addEventListener('click', async () => {
          await suiteCoordinator.updateOutdatedCompanions();
          render();
        });
        banner.append(upBtn);
        container.append(banner);
      }
    }

    container.append(el('div', 'stm-settings-subhead', '阅读、发图与面板净化'));

    const tidyGroup = el('div', 'stm-settings-group');
    tidyGroup.append(
      makeSwitchRow({
        helpKey: 'chat_image_button',
        icon: 'image',
        title: '底栏快捷发图与表情包（自动识图）',
        desc: '在聊天输入框右下角嵌入低调半透明图片小标（零挤占打字宽度，长文本多行输入时前几排满宽、图标始终停在最后一行最右；支持手机原图自动瘦身防反代 413 报错并自动开启底层识图）。',
        checked: current.chatImageButton,
        onChange: val => {
          updateStoreFromDialog({ chatImageButton: val });
        },
      }),
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
        helpKey: 'tidy_extensions_panel',
        icon: 'grid',
        title: '净化拼图「扩展面板」排序与收纳',
        desc: '打开扩展面板时按「ST伴侣总台 -> 正则 -> 酒馆助手 -> 快速回复 -> 第三方插件」置顶排列，并将二十余项低频原生内置模块收进底部折叠夹。',
        checked: current.tidy.tidyExtensionsPanel,
        onChange: val => {
          updateStoreFromDialog({ tidy: { tidyExtensionsPanel: val } });
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

    if (suiteCoordinator) {
      container.append(el('div', 'stm-settings-subhead', '排障与环境体检'));
      const diagGroup = el('div', 'stm-settings-group stm-shortcut-list');
      const diagHelpKey = 'native_diag_report';
      const isDiagHelpOpen = expandedHelpKey === diagHelpKey;
      const diagWrap = el('div', `stm-shortcut-item is-compact${isDiagHelpOpen ? ' is-help-open' : ''}`);
      const diagBar = el('div', 'stm-shortcut-bar stm-diag-copy-bar');
      const diagHead = el('div', 'stm-switch-head');
      diagHead.append(
        createIconNode(doc, 'copy', 'stm-row-icon'),
        el('strong', 'stm-switch-title', '复制环境排障体检单'),
        makeHelpTriggerButton(diagHelpKey, '复制环境排障体检单'),
      );
      diagBar.append(diagHead, el('span', 'stm-shortcut-arrow', '复制'));
      diagBar.addEventListener('click', evt => {
        const target = evt.target;
        if (target && typeof target.closest === 'function' && target.closest('.stm-help-btn')) {
          return;
        }
        void suiteCoordinator.copyDiagnosticReport();
      });
      diagWrap.append(diagBar);
      if (isDiagHelpOpen) {
        diagWrap.append(
          el(
            'div',
            'stm-switch-help-pop',
            '一键复制当前设备容器、主题、砚台套件版本与已装第三方扩展名单（不含任何 API 密钥与聊天隐私），方便快速定位多插件冲突。若遇极端冲突无法进酒馆，可在网址末尾附加 ?stm_safe=1 以安全模式启动。',
          ),
        );
      }
      diagGroup.append(diagWrap);
      container.append(diagGroup);
    }
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
    void suiteCoordinator?.audit?.();
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

    // 扩展面板顶部的专属大横幅卡片统一由 extensions-tidy.js (#stm-ext-hero-card) 接管，清理旧折叠条防重复
    doc.getElementById('stm-ext-inline-drawer')?.remove();
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
