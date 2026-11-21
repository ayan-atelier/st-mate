/**
 * SillyTavern 伴侣 (st-mate) · 「设置中心」双页签总控面板
 * 遵循《砚台全系插件 UI 与交互设计规范》：
 * 1. 「扩展功能」页签：双卡可视化「对话顶栏样式」（含伴侣顶栏新手寻路 `?` 指南）+ 三大阅读发图体验开关 + 零版本号噪点的「配套增强」（内置无损「界面整理与低频收纳」二级页、人设馆直达、叙事记忆设置、重Roll回看加强）；
 * 2. 「原生与设置」页签：首屏直达「用户设置与导入美化主题」「扩展程序、正则、酒馆助手」（未装酒馆助手时支持行内一键代装正版）+ 预设/API/角色卡/世界书「左点进入原版 · 右控伴侣接管」四合一 + 沉底「排障与环境体检」与「SillyTavern 伴侣开关」；
 * 3. 全套 1.5px 纯色细线 SVG 图标（零彩色 Emoji），100% 跟随当前酒馆 SmartTheme 主题配色。
 */

import {
  COMPANION_THEME_DAY_NAME,
  COMPANION_THEME_NIGHT_NAME,
  applyCompanionTheme,
  findInstalledYantaiPresetName,
  getActiveHostThemeName,
  importOrActivateYantaiPreset,
} from '../core/companion-kit.js?v=0.8.3';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.8.3';
import { getHostPresetState } from '../modules/preset-backend.js?v=0.8.3';
import { discoverWandEntries } from './extensions-tidy.js?v=0.8.3';
import { closeAllNativeDrawers, openNativeDrawer, toastMessage } from './host-actions.js?v=0.8.3';

const TABS = Object.freeze([
  { id: 'modules', icon: 'spark', label: '扩展功能' },
  { id: 'native', icon: 'layers', label: '原生与设置' },
]);

const TOPBAR_GUIDE_ITEMS = Object.freeze([
  ['返回书架大厅', '点顶栏最左「‹」一键退回角色书架首页'],
  ['角色卡与世界书', '点左上角「角色头像 + 名字」展开档案与世界书一体页'],
  ['切换与绑定预设', '点角色名旁的「预设名 ▾」秒切预设或呼叫预设助手'],
  ['API 与模型配置', '点右侧「插头」管理多站子密钥、拉取与收藏模型'],
  ['人设与排版背景', '点右侧「小人」进入人设馆，点「Aa」调字号边距与背景'],
  ['美化主题与正则', '切至本窗口上方「原生与设置」页即可一键直达'],
]);

const CORE_TAKEOVER_ROWS = Object.freeze([
  {
    key: 'presets',
    moduleKey: 'presets',
    drawerId: 'ai-config-button',
    icon: 'sliders',
    title: '预设',
    desc: '开启时点顶栏预设打开「伴侣预设馆」（支持角色专属绑定自动秒切与 AI 预设助手）；点左侧「进入原版」可随时调阅原生面板，关闭右侧开关则常驻回退原版。',
  },
  {
    key: 'api',
    moduleKey: 'api',
    drawerId: 'sys-settings-button',
    icon: 'plug',
    title: 'API',
    desc: '开启时点顶栏插头打开「多站子 API 工作台」（加密保存多组反代站与常用模型收藏秒切）；点左侧「进入原版」直达原生插头抽屉，关闭右侧开关则常驻使用原版。',
  },
  {
    key: 'charCard',
    moduleKey: 'charCard',
    drawerId: 'rightNavHolder',
    icon: 'idcard',
    title: '角色卡',
    desc: '开启时点顶栏角色头像打开「伴侣角色档案」（支持 3:4 立绘预览、第 1 楼一键换开场白与导出角色卡）；点左侧「进入原版」直达原生角色与群聊抽屉。',
  },
  {
    key: 'worldBook',
    moduleKey: 'worldBook',
    drawerId: 'WI-SP-button',
    icon: 'globe',
    title: '世界书',
    desc: '开启时使用「清爽世界书」（四源防假生效自检、蓝绿灯一指秒切）；点左侧「进入原版」直达酒馆原生世界书配置高级递归或向量参数，关闭右侧开关则常驻使用原版。',
  },
]);

export function createSettingsDialog({
  getContext,
  store,
  moduleBridge,
  suiteCoordinator = null,
  stmVersion = '0.8.3',
  onToggleShell,
  onOpenPersonaStudio,
  onOpenStateChange,
  onAfterOpenNativeDrawer,
}) {
  let dialogEl = null;
  let tabBarEl = null;
  let bodyEl = null;
  let statusBadgeEl = null;
  let activeTab = 'modules';
  let activeSubView = ''; // '' | 'tidy'
  let expandedHelpKey = '';
  let themePickerOpen = false;
  let applyingThemeBusy = false;
  let importingPresetBusy = false;
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
    activeSubView = '';
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
    const title = el('h2', 'stm-dialog-title', 'SillyTavern 伴侣');
    const badge = el('span', 'stm-dialog-badge', `v${stmVersion}`);
    statusBadgeEl = el('span', 'stm-chip stm-dialog-paused-chip', '原生模式中');
    statusBadgeEl.hidden = true;
    titleWrap.append(title, badge, statusBadgeEl);

    const headerRight = el('div', 'stm-dialog-header-actions');
    const closeBtn = el('button', 'stm-dialog-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = '关闭';
    closeBtn.setAttribute('aria-label', '关闭设置窗口');
    closeBtn.addEventListener('click', close);

    headerRight.append(closeBtn);
    header.append(titleWrap, headerRight);

    tabBarEl = el('nav', 'stm-tabs is-two-tabs');
    tabBarEl.setAttribute('role', 'tablist');
    dialogEl._tabButtons = new Map();

    for (const tab of TABS) {
      const btn = el('button', 'stm-tab-btn');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.append(createIconNode(doc, tab.icon, 'stm-tab-icon'), el('span', '', tab.label));
      btn.addEventListener('click', () => {
        if (activeTab === tab.id && !activeSubView) return;
        activeTab = tab.id;
        activeSubView = '';
        expandedHelpKey = '';
        render();
      });
      dialogEl._tabButtons.set(tab.id, btn);
      tabBarEl.append(btn);
    }

    bodyEl = el('div', 'stm-dialog-body');
    dialogEl.append(header, tabBarEl, bodyEl);
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

  function makeInlineActionBtn(label, onClick, extraClass = '') {
    const btn = el('button', `stm-row-inline-btn${extraClass ? ` ${extraClass}` : ''}`, label);
    btn.type = 'button';
    btn.addEventListener('click', evt => {
      evt.preventDefault();
      evt.stopPropagation();
      onClick(evt);
    });
    return btn;
  }

  function makeSwitchRow({
    helpKey,
    icon = '',
    title,
    desc = '',
    badgeText = '',
    actionLabel = '',
    onAction = null,
    checked,
    onChange,
  }) {
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
    if (actionLabel && typeof onAction === 'function') {
      head.append(makeInlineActionBtn(actionLabel, onAction));
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

    // 点击标题空白区（非 ? 与内联操作钮）也可顺手切换开关
    head.addEventListener('click', evt => {
      const target = evt.target;
      if (
        target &&
        typeof target.closest === 'function' &&
        target.closest('.stm-help-btn, .stm-row-inline-btn')
      ) {
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

  function buildTopbarWireframe(doc, modeId) {
    const box = el('div', `stm-topbar-wireframe is-${modeId}`);
    box.setAttribute('aria-hidden', 'true');

    if (modeId === 'rp') {
      const left = el('div', 'stm-wf-rp-left');
      left.append(
        el('span', 'stm-wf-chevron', '‹'),
        el('span', 'stm-wf-avatar'),
        el('span', 'stm-wf-char', 'Char'),
        el('span', 'stm-wf-preset', '预设▾'),
      );
      const right = el('div', 'stm-wf-rp-right');
      right.append(el('span', 'stm-wf-dot'), el('span', 'stm-wf-dot'), el('span', 'stm-wf-aa', 'Aa'));
      box.append(left, right);
    } else {
      const strip = el('div', 'stm-wf-native-strip');
      for (let i = 0; i < 5; i += 1) {
        strip.append(el('span', 'stm-wf-native-slot'));
      }
      box.append(strip);
    }
    return box;
  }

  function makeTopbarVisualSelector(current) {
    const doc = globalThis.document;
    const helpKey = 'topbar_rp_guide';
    const isGuideOpen = expandedHelpKey === helpKey;

    const card = el(
      'div',
      `stm-switch-card stm-topbar-style-card${isGuideOpen ? ' is-help-open' : ''}`,
    );

    const titleRow = el('div', 'stm-topbar-card-head');
    titleRow.append(
      createIconNode(doc, 'layers', 'stm-row-icon'),
      el('strong', 'stm-switch-title', '对话顶栏样式'),
    );
    card.append(titleRow);

    const choiceGrid = el('div', 'stm-topbar-choice-grid');
    choiceGrid.setAttribute('role', 'radiogroup');
    choiceGrid.setAttribute('aria-label', '对话顶栏样式选择');

    const options = [
      {
        modeId: 'rp',
        label: '伴侣顶栏',
        caption: '简洁明了，快捷进出',
        withGuideBtn: true,
      },
      {
        modeId: 'native',
        label: '原版顶栏',
        caption: '原汁原味，酒馆原版顶栏',
        withGuideBtn: false,
      },
    ];

    for (const opt of options) {
      const selected = current.topbarMode === opt.modeId;
      const item = el(
        'div',
        `stm-topbar-choice-card${selected ? ' is-active' : ''}${!current.shellEnabled ? ' is-disabled' : ''}`,
      );
      item.tabIndex = current.shellEnabled ? 0 : -1;
      item.setAttribute('role', 'radio');
      item.setAttribute('aria-checked', String(selected));

      if (opt.withGuideBtn) {
        const cornerWrap = el('div', 'stm-topbar-choice-help');
        cornerWrap.append(makeHelpTriggerButton(helpKey, '伴侣顶栏入口指南'));
        item.append(cornerWrap);
      }

      item.append(buildTopbarWireframe(doc, opt.modeId));

      const radioRow = el('div', 'stm-topbar-choice-radio-row');
      radioRow.append(
        el('span', `stm-radio-dot${selected ? ' is-checked' : ''}`),
        el('strong', 'stm-topbar-choice-title', opt.label),
      );
      item.append(radioRow, el('span', 'stm-topbar-choice-caption', opt.caption));

      const selectMode = evt => {
        const target = evt?.target;
        if (target && typeof target.closest === 'function' && target.closest('.stm-help-btn')) {
          return;
        }
        evt?.preventDefault?.();
        if (!current.shellEnabled || current.topbarMode === opt.modeId) return;
        updateStoreFromDialog({ topbarMode: opt.modeId });
      };

      item.addEventListener('click', selectMode);
      item.addEventListener('keydown', evt => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          selectMode(evt);
        }
      });

      choiceGrid.append(item);
    }

    card.append(choiceGrid);

    if (isGuideOpen) {
      const guideBox = el('div', 'stm-switch-help-pop is-guide');
      const guideTitle = el('div', 'stm-guide-title', '伴侣顶栏 · 常用功能入口速查');
      const guideList = el('div', 'stm-guide-list');
      for (const [k, v] of TOPBAR_GUIDE_ITEMS) {
        const line = el('div', 'stm-guide-row');
        line.append(el('strong', 'stm-guide-key', `${k}：`), el('span', 'stm-guide-val', v));
        guideList.append(line);
      }
      guideBox.append(guideTitle, guideList);
      card.append(guideBox);
    }

    return card;
  }

  function resolveCompanionBadge(moduleKey, current, suiteBusy) {
    const compInfo = suiteCoordinator?.getCompanionStatus?.(moduleKey) || null;
    if (!current.shellEnabled && current.modules?.[moduleKey]) {
      return '随原生挂起';
    }
    if (compInfo?.status === 'missing') {
      return suiteBusy ? '正在安装…' : '未安装 · 点开即装';
    }
    if (compInfo?.status === 'host_disabled') {
      return '扩展栏已停用 · 点开恢复';
    }
    return '';
  }

  async function toggleCompanionModule(moduleKey, val) {
    internalUpdating = true;
    try {
      store.update({ modules: { [moduleKey]: val } });
      const latestComp = suiteCoordinator?.getCompanionStatus?.(moduleKey) || null;
      if (
        val &&
        suiteCoordinator &&
        latestComp &&
        (latestComp.status === 'missing' || latestComp.status === 'host_disabled')
      ) {
        await suiteCoordinator.installCompanions({
          moduleKeys: [moduleKey],
          forceReinstall: true,
        });
      } else if (store.get().shellEnabled) {
        await moduleBridge.syncModuleEnabled(moduleKey, val);
      }
    } finally {
      internalUpdating = false;
    }
    render();
  }

  function handleOpenPersonaFromSettings() {
    close();
    if (typeof onOpenPersonaStudio === 'function') {
      onOpenPersonaStudio();
      return;
    }
    openNativeDrawer('persona-management-button', { getContext });
    const handle = moduleBridge?.getRegisteredHandle?.('yantai-persona-studio');
    if (handle && typeof handle.open === 'function' && store.get().modules.persona) {
      void Promise.resolve(handle.open({ ensureNative: false, tab: 'current' })).catch(() => {});
    }
    onAfterOpenNativeDrawer?.();
  }

  async function handleOpenMemorySettings() {
    let handle = moduleBridge?.getRegisteredHandle?.('yantai-memory');
    if (!handle && suiteCoordinator) {
      const compInfo = suiteCoordinator.getCompanionStatus?.('memory');
      if (compInfo?.status === 'missing' || compInfo?.status === 'host_disabled') {
        store.update({ modules: { memory: true } });
        await suiteCoordinator.installCompanions({
          moduleKeys: ['memory'],
          forceReinstall: true,
        });
        handle = moduleBridge?.getRegisteredHandle?.('yantai-memory');
      }
    }
    if (handle && typeof handle.open === 'function') {
      close();
      handle.open();
      return;
    }
    toastMessage('请先打开右侧开关以启用叙事记忆系统', 'info');
  }

  function renderTidySubView(container, current) {
    const doc = globalThis.document;
    const tidyState = current.tidy || {};
    const tidyEnabled = tidyState.enabled !== false;

    const navRow = el('div', 'stm-subview-bar');
    const backBtn = el('button', 'stm-subview-back-btn');
    backBtn.type = 'button';
    backBtn.append(createIconNode(doc, 'back', 'stm-row-icon'), el('span', '', '返回扩展功能'));
    backBtn.addEventListener('click', () => {
      activeSubView = '';
      expandedHelpKey = '';
      render();
    });
    navRow.append(backBtn, el('strong', 'stm-subview-title', '界面整理与低频收纳'));
    container.append(navRow);

    const masterGroup = el('div', 'stm-settings-group');
    masterGroup.append(
      makeSwitchRow({
        helpKey: 'tidy_sub_master',
        icon: 'fold',
        title: '启用界面整理与低频收纳',
        desc: '仅整理面板顺序与隐藏不常用菜单入口，所有后台插件仍正常运作；关闭后立即 100% 恢复原位置。',
        checked: tidyEnabled,
        onChange: val => {
          updateStoreFromDialog({ tidy: { enabled: val } });
        },
      }),
    );
    container.append(masterGroup);

    container.append(el('div', 'stm-settings-subhead', '面板与菜单自动净化'));
    const autoGroup = el('div', 'stm-settings-group');
    autoGroup.append(
      makeSwitchRow({
        helpKey: 'tidy_sub_optimize_options',
        icon: 'sliders',
        title: '优化底栏「☰ 三横」排序与命名',
        desc: '将最高频的「重新生成」「续写」置顶，分割线下方依次排列「开启新对话 · 保存 · 存档管理 · 批量删除 · 退出」，告别机翻术语。',
        checked: tidyState.optimizeOptionsMenu !== false,
        onChange: val => {
          updateStoreFromDialog({ tidy: { optimizeOptionsMenu: val } });
        },
      }),
      makeSwitchRow({
        helpKey: 'tidy_sub_options',
        icon: 'fold',
        title: '收纳底栏「☰ 三横」低频原生项',
        desc: '保留常用对话操作，仅将作者注释、CFG、Token 概率等低频原生项收进底部「更多原生工具」。',
        checked: Boolean(tidyState.foldOptionsMenu),
        onChange: val => {
          updateStoreFromDialog({ tidy: { foldOptionsMenu: val } });
        },
      }),
      makeSwitchRow({
        helpKey: 'tidy_sub_extensions',
        icon: 'grid',
        title: '净化拼图「扩展面板」排序与收纳',
        desc: '按「伴侣总台 -> 正则 -> 酒馆助手 -> 快速回复 -> 第三方插件」置顶排列，并将二十余项低频内置模块收进底部折叠夹。',
        checked: Boolean(tidyState.tidyExtensionsPanel),
        onChange: val => {
          updateStoreFromDialog({ tidy: { tidyExtensionsPanel: val } });
        },
      }),
    );
    container.append(autoGroup);

    const wandEntries = discoverWandEntries(doc);
    const hiddenSet = new Set(Array.isArray(tidyState.hiddenWandEntries) ? tidyState.hiddenWandEntries : []);

    const wandHeadRow = el('div', 'stm-settings-subhead-row');
    wandHeadRow.append(el('span', 'stm-settings-subhead is-inline', '底栏「魔法棒」入口显示（开=显示 · 关=隐藏）'));
    if (hiddenSet.size > 0) {
      const showAllBtn = el('button', 'stm-text-btn', '全部显示');
      showAllBtn.type = 'button';
      showAllBtn.addEventListener('click', () => {
        updateStoreFromDialog({ tidy: { hiddenWandEntries: [] } });
      });
      wandHeadRow.append(showAllBtn);
    }
    container.append(wandHeadRow);

    const wandGroup = el('div', 'stm-settings-group');
    if (wandEntries.length === 0) {
      wandGroup.append(
        el(
          'div',
          'stm-empty-hint-row',
          '当前魔法棒菜单内暂无其他插件入口（后续安装带魔法棒按钮的扩展后将自动出现在此列表）。',
        ),
      );
    } else {
      for (const entry of wandEntries) {
        const isVisible = !hiddenSet.has(entry.key);
        wandGroup.append(
          makeSwitchRow({
            helpKey: '',
            icon: '',
            title: entry.label,
            checked: isVisible,
            onChange: show => {
              const next = new Set(store.get().tidy?.hiddenWandEntries || []);
              if (show) next.delete(entry.key);
              else next.add(entry.key);
              updateStoreFromDialog({ tidy: { hiddenWandEntries: [...next] } });
            },
          }),
        );
      }
    }
    container.append(wandGroup);
  }

  function renderModulesTab(container, current) {
    const doc = globalThis.document;
    const suiteBusy = Boolean(suiteCoordinator?.isBusy?.());

    const expGroup = el('div', 'stm-settings-group');
    expGroup.append(
      makeTopbarVisualSelector(current),
      makeSwitchRow({
        helpKey: 'chat_image_button',
        icon: 'image',
        title: '底栏快捷发图与表情包',
        desc: '在聊天输入框右下角嵌入低调半透明图片图标（零挤占打字宽度；支持手机大图自动瘦身防 413 报错，并自动开启底层识图）。',
        checked: current.chatImageButton,
        onChange: val => {
          updateStoreFromDialog({ chatImageButton: val });
        },
      }),
      makeSwitchRow({
        helpKey: 'tap_pure_reading',
        icon: 'spark',
        title: '轻触正文全屏',
        desc: '阅读时轻点正文空白或普通文字，顶栏与底栏输入区丝滑隐去进入纯享全屏；再点一下立即恢复（默认关闭防误触，自动避开划词、滚动与按钮）。',
        checked: current.tapPureReading,
        onChange: val => {
          updateStoreFromDialog({ tapPureReading: val });
        },
      }),
      makeSwitchRow({
        helpKey: 'mod_turbo',
        icon: 'zap',
        title: '流畅渲染引擎（隐形加速）',
        desc: '后台压缩缓存高清角色底图、自动休眠屏幕外长对话历史楼层，并在手机端卸除高耗电毛玻璃与弹键盘抖动。',
        checked: Boolean(current.modules.turbo),
        onChange: val => {
          updateStoreFromDialog({ modules: { turbo: val } });
        },
      }),
    );
    container.append(expGroup);

    container.append(el('div', 'stm-settings-subhead', '配套增强'));

    const auxGroup = el('div', 'stm-settings-group');
    auxGroup.append(
      makeSwitchRow({
        helpKey: 'aux_tidy',
        icon: 'fold',
        title: '界面整理与低频收纳',
        desc: '自动净化扩展面板与三横菜单低频项，点「设置」可按需勾选隐藏底栏魔法棒里的冗余插件入口。',
        actionLabel: '设置',
        onAction: () => {
          activeSubView = 'tidy';
          expandedHelpKey = '';
          render();
        },
        checked: current.tidy?.enabled !== false,
        onChange: val => {
          updateStoreFromDialog({ tidy: { enabled: val } });
        },
      }),
      makeSwitchRow({
        helpKey: 'mod_persona',
        icon: 'user',
        title: '人设馆系统',
        desc: '高清人设画册、角色专属人设绑定与 AI 人设搭档；关闭后点顶栏人设键直接打开酒馆原版人设抽屉。',
        actionLabel: current.shellEnabled && current.modules.persona ? '进入' : '',
        onAction: handleOpenPersonaFromSettings,
        badgeText: resolveCompanionBadge('persona', current, suiteBusy),
        checked: Boolean(current.modules.persona),
        onChange: val => {
          void toggleCompanionModule('persona', val);
        },
      }),
      makeSwitchRow({
        helpKey: 'mod_memory',
        icon: 'memory',
        title: '叙事记忆系统',
        desc: '默认关闭且零生成拦截，方便混用表格记忆等外部插件；开启后启用砚台因果记忆控制台。',
        actionLabel: '设置',
        onAction: () => {
          void handleOpenMemorySettings();
        },
        badgeText: resolveCompanionBadge('memory', current, suiteBusy),
        checked: Boolean(current.modules.memory),
        onChange: val => {
          void toggleCompanionModule('memory', val);
        },
      }),
      makeSwitchRow({
        helpKey: 'mod_echoes',
        icon: 'branch',
        title: '重Roll回看加强',
        desc: '默认关闭保持楼层极简；开启后可在消息楼层底部随时回看历史重Roll、加星收藏或分叉新对话支线。',
        badgeText: resolveCompanionBadge('echoes', current, suiteBusy),
        checked: Boolean(current.modules.echoes),
        onChange: val => {
          void toggleCompanionModule('echoes', val);
        },
      }),
    );
    container.append(auxGroup);

    if (suiteCoordinator) {
      const auditState = suiteCoordinator.getAuditState?.();
      const missingItems = (auditState?.companions || []).filter(c => c.status === 'missing');

      if (suiteBusy) {
        const banner = el('div', 'stm-suite-banner');
        banner.append(
          createIconNode(doc, 'refresh', 'stm-row-icon'),
          el('span', 'stm-suite-banner-text', suiteCoordinator.getBusyLabel?.() || '正在同步砚台配套组件…'),
        );
        container.append(banner);
      } else if (missingItems.length > 0) {
        const banner = el('div', 'stm-suite-banner');
        banner.append(
          createIconNode(doc, 'download', 'stm-row-icon'),
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
      }
    }
  }

  function makeNativeShortcutRow(
    doc,
    { key, drawerId, icon, title, desc, trailingActionNode = null, extraDrawerNode = null },
  ) {
    const helpKey = `native_${key}`;
    const isHelpOpen = expandedHelpKey === helpKey;
    const wrap = el('div', `stm-shortcut-item is-compact${isHelpOpen ? ' is-help-open' : ''}`);

    const mainBar = el('div', 'stm-shortcut-bar');
    const head = el('div', 'stm-switch-head');
    head.append(
      createIconNode(doc, icon, 'stm-row-icon'),
      el('strong', 'stm-switch-title', title),
      makeHelpTriggerButton(helpKey, title),
    );
    if (trailingActionNode) {
      head.append(trailingActionNode);
    }
    mainBar.append(head, el('span', 'stm-shortcut-arrow', '›'));
    mainBar.addEventListener('click', evt => {
      const target = evt.target;
      if (
        target &&
        typeof target.closest === 'function' &&
        target.closest('.stm-help-btn, .stm-helper-install-btn, .stm-companion-theme-btn')
      ) {
        return;
      }
      close();
      openNativeDrawer(drawerId, { getContext });
      onAfterOpenNativeDrawer?.();
    });

    wrap.append(mainBar);
    if (extraDrawerNode) {
      wrap.append(extraDrawerNode);
    }
    if (isHelpOpen) {
      wrap.append(el('div', 'stm-switch-help-pop', desc));
    }
    return wrap;
  }

  function makeTakeoverNativeRow(doc, current, item, { extraActionBtn = null } = {}) {
    const helpKey = `takeover_${item.key}`;
    const isHelpOpen = expandedHelpKey === helpKey;
    const checked = Boolean(current.modules?.[item.moduleKey]);
    const card = el(
      'div',
      `stm-switch-card is-compact stm-takeover-row${isHelpOpen ? ' is-help-open' : ''}`,
    );

    const bar = el('div', 'stm-switch-bar');
    const jumpZone = el('div', 'stm-switch-head stm-native-jump-zone');
    jumpZone.title = `点击进入酒馆原版「${item.title}」抽屉`;
    jumpZone.append(
      createIconNode(doc, item.icon, 'stm-row-icon'),
      el('strong', 'stm-switch-title', item.title),
      makeHelpTriggerButton(helpKey, item.title),
      el('span', 'stm-native-enter-hint', '进入原版 ›'),
    );
    if (extraActionBtn) {
      jumpZone.append(extraActionBtn);
    }

    jumpZone.addEventListener('click', evt => {
      const target = evt.target;
      if (
        target &&
        typeof target.closest === 'function' &&
        target.closest('.stm-help-btn, .stm-preset-kit-btn')
      ) {
        return;
      }
      close();
      openNativeDrawer(item.drawerId, { getContext });
      onAfterOpenNativeDrawer?.();
    });

    const toggleLabel = el('label', 'stm-switch-toggle-wrap');
    toggleLabel.title = checked ? `当前默认打开伴侣版${item.title}（点击切换为原版）` : `当前默认打开原版${item.title}（点击开启伴侣版）`;
    const input = el('input', 'stm-switch-input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => {
      updateStoreFromDialog({ modules: { [item.moduleKey]: input.checked } });
    });
    const slider = el('span', 'stm-switch-track');
    toggleLabel.append(input, slider);

    bar.append(jumpZone, toggleLabel);
    card.append(bar);

    if (isHelpOpen) {
      card.append(el('div', 'stm-switch-help-pop', item.desc));
    }
    return card;
  }

  function renderNativeTab(container, current) {
    const doc = globalThis.document;
    const thStatus = suiteCoordinator?.getTavernHelperStatus?.() || { status: 'unknown' };
    const suiteBusy = Boolean(suiteCoordinator?.isBusy?.());

    // 1. 伴侣官方配套主题（Apple 原生轻薄卡片流 · 静夜 / 浅昼）触发钮与展开栏
    const activeThemeName = getActiveHostThemeName({ getContext, doc });
    const isUsingCompanionTheme =
      activeThemeName === COMPANION_THEME_NIGHT_NAME ||
      activeThemeName === COMPANION_THEME_DAY_NAME;

    const companionThemeBtn = el(
      'button',
      'stm-row-inline-btn stm-companion-theme-btn',
      applyingThemeBusy
        ? '应用中…'
        : isUsingCompanionTheme
          ? '切换伴侣主题'
          : '启用伴侣主题',
    );
    companionThemeBtn.type = 'button';
    companionThemeBtn.disabled = applyingThemeBusy;
    companionThemeBtn.addEventListener('click', evt => {
      evt.preventDefault();
      evt.stopPropagation();
      themePickerOpen = !themePickerOpen;
      render();
    });

    let themePickerNode = null;
    if (themePickerOpen) {
      themePickerNode = el('div', 'stm-theme-picker-pop');
      for (const [modeId, label, sub] of [
        ['night', COMPANION_THEME_NIGHT_NAME, '深色护眼轻薄卡片'],
        ['day', COMPANION_THEME_DAY_NAME, '浅色纸白轻薄卡片'],
      ]) {
        const isCur = activeThemeName === label;
        const optBtn = el(
          'button',
          `stm-theme-option-btn${isCur ? ' is-active' : ''}`,
        );
        optBtn.type = 'button';
        optBtn.disabled = applyingThemeBusy;
        optBtn.append(
          el('strong', 'stm-theme-opt-title', label),
          el('span', 'stm-theme-opt-sub', isCur ? `${sub} · 当前使用中` : sub),
        );
        optBtn.addEventListener('click', async evt => {
          evt.preventDefault();
          evt.stopPropagation();
          if (applyingThemeBusy) return;
          applyingThemeBusy = true;
          render();
          try {
            const res = await applyCompanionTheme(modeId, { getContext, doc });
            themePickerOpen = false;
            toastMessage(`已启用「${res.name}」`, 'success');
          } catch (err) {
            toastMessage(err?.message || '启用伴侣主题失败', 'error');
          } finally {
            applyingThemeBusy = false;
            render();
          }
        });
        themePickerNode.append(optBtn);
      }
    }

    let helperActionBtn = null;
    if (thStatus.status === 'missing' || thStatus.status === 'host_disabled') {
      const btnText = suiteBusy
        ? '正在处理…'
        : thStatus.status === 'host_disabled'
          ? '酒馆助手已停用 · 一键开启'
          : '未装酒馆助手 · 一键安装';
      helperActionBtn = el('button', 'stm-pill-btn stm-helper-install-btn', btnText);
      helperActionBtn.type = 'button';
      helperActionBtn.disabled = suiteBusy;
      helperActionBtn.addEventListener('click', async evt => {
        evt.preventDefault();
        evt.stopPropagation();
        await suiteCoordinator?.installOrEnableTavernHelper?.();
        render();
      });
    }

    const topShortcutGroup = el('div', 'stm-settings-group stm-shortcut-list');
    topShortcutGroup.append(
      makeNativeShortcutRow(doc, {
        key: 'theme',
        drawerId: 'user-settings-button',
        icon: 'palette',
        title: '用户设置与导入美化主题',
        desc: '导入与切换酒馆 UI 美化主题、自定义 CSS、对话气泡样式与流式输出速度；也可直接点右侧「启用伴侣主题」换上官方 Apple 轻薄卡片流日/夜主题。',
        trailingActionNode: companionThemeBtn,
        extraDrawerNode: themePickerNode,
      }),
      makeNativeShortcutRow(doc, {
        key: 'ext',
        drawerId: 'extensions-settings-button',
        icon: 'grid',
        title: '扩展程序、正则、酒馆助手',
        desc: '打开酒馆扩展管理抽屉（已按「正则 -> 酒馆助手 -> 快速回复 -> 第三方插件」置顶排好）。若玩前端美化角色卡，请确保已安装《酒馆助手》。',
        trailingActionNode: helperActionBtn,
      }),
    );
    container.append(topShortcutGroup);

    // 2. 预设行内置《砚台预设 V2.1》导入/启用按钮
    const installedYantaiPreset = findInstalledYantaiPresetName({ getContext, doc });
    const currentActivePreset = getHostPresetState({ getContext, doc }).activePreset || '';
    const isYantaiPresetActive =
      Boolean(installedYantaiPreset) && currentActivePreset === installedYantaiPreset;

    let presetKitBtn = null;
    if (!isYantaiPresetActive) {
      presetKitBtn = el(
        'button',
        'stm-row-inline-btn stm-preset-kit-btn',
        importingPresetBusy
          ? '导入中…'
          : installedYantaiPreset
            ? '启用砚台预设'
            : '导入砚台预设',
      );
      presetKitBtn.type = 'button';
      presetKitBtn.disabled = importingPresetBusy;
      presetKitBtn.title = '一键导入并启用官方内置《砚台预设 V2.1》';
      presetKitBtn.addEventListener('click', async evt => {
        evt.preventDefault();
        evt.stopPropagation();
        if (importingPresetBusy) return;
        importingPresetBusy = true;
        render();
        try {
          const res = await importOrActivateYantaiPreset({ getContext, doc });
          toastMessage(
            res.action === 'activated'
              ? `已切换至「${res.name}」`
              : `已导入并启用「${res.name}」`,
            'success',
          );
        } catch (err) {
          toastMessage(err?.message || '导入砚台预设失败', 'error');
        } finally {
          importingPresetBusy = false;
          render();
        }
      });
    }

    container.append(el('div', 'stm-settings-subhead', '核心面板（点左进原版 · 右侧开关伴侣版）'));
    const takeoverGroup = el('div', 'stm-settings-group');
    for (const item of CORE_TAKEOVER_ROWS) {
      takeoverGroup.append(
        makeTakeoverNativeRow(doc, current, item, {
          extraActionBtn: item.key === 'presets' ? presetKitBtn : null,
        }),
      );
    }
    container.append(takeoverGroup);

    container.append(el('div', 'stm-settings-subhead', '系统排障与总开关'));
    const footerGroup = el('div', 'stm-settings-group');

    const diagHelpKey = 'native_diag_report';
    const isDiagHelpOpen = expandedHelpKey === diagHelpKey;
    const diagWrap = el('div', `stm-shortcut-item is-compact${isDiagHelpOpen ? ' is-help-open' : ''}`);
    const diagBar = el('div', 'stm-shortcut-bar stm-diag-copy-bar');
    const diagHead = el('div', 'stm-switch-head');
    diagHead.append(
      createIconNode(doc, 'copy', 'stm-row-icon'),
      el('strong', 'stm-switch-title', '排障与环境体检'),
      makeHelpTriggerButton(diagHelpKey, '排障与环境体检'),
    );
    diagBar.append(diagHead, el('span', 'stm-shortcut-arrow is-text-action', '复制'));
    diagBar.addEventListener('click', evt => {
      const target = evt.target;
      if (target && typeof target.closest === 'function' && target.closest('.stm-help-btn')) {
        return;
      }
      if (suiteCoordinator?.copyDiagnosticReport) {
        void suiteCoordinator.copyDiagnosticReport();
      } else {
        toastMessage('环境体检模块准备中，请稍后再试', 'info');
      }
    });
    diagWrap.append(diagBar);
    if (isDiagHelpOpen) {
      diagWrap.append(
        el(
          'div',
          'stm-switch-help-pop',
          '一键复制当前设备容器、主题、砚台套件状态与已装第三方扩展名单（不含任何 API 密钥与聊天隐私），方便快速定位多插件冲突。极端冲突无法进入页面时可在网址末尾加 ?stm_safe=1 安全启动。',
        ),
      );
    }

    const masterSwitchRow = makeSwitchRow({
      helpKey: 'shell_master',
      icon: 'home',
      title: 'SillyTavern 伴侣开关',
      desc: '关闭后一键挂起全部伴侣接管回到纯原生酒馆（你的个人配置完整保留）；重新开启即可原样恢复全部功能。',
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
    });

    footerGroup.append(diagWrap, masterSwitchRow);
    container.append(footerGroup);
  }

  function render() {
    const dlg = ensureDialog();
    if (!dlg || !bodyEl) return;

    const current = store.get();
    if (statusBadgeEl) {
      statusBadgeEl.hidden = Boolean(current.shellEnabled);
    }
    if (tabBarEl) {
      tabBarEl.hidden = Boolean(activeSubView);
    }

    for (const [id, btn] of dlg._tabButtons.entries()) {
      const selected = id === activeTab && !activeSubView;
      btn.classList.toggle('is-active', selected);
      btn.setAttribute('aria-selected', String(selected));
    }

    bodyEl.replaceChildren();
    if (activeSubView === 'tidy') {
      renderTidySubView(bodyEl, current);
    } else if (activeTab === 'modules') {
      renderModulesTab(bodyEl, current);
    } else {
      renderNativeTab(bodyEl, current);
    }
  }

  function open(tabId = null) {
    activeSubView = '';
    if (tabId === 'tidy') {
      activeTab = 'modules';
      activeSubView = 'tidy';
    } else if (tabId === 'reading') {
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
      item.innerHTML = `<span class="stm-inline-svg" aria-hidden="true">${svgMarkup('settings')}</span><span>SillyTavern 伴侣设置</span>`;
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
    tabBarEl = null;
    bodyEl = null;
    statusBadgeEl = null;
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
