/**
 * SillyTavern 伴侣 (st-mate) · 「设置中心」双页签总控面板
 * 遵循《砚台全系插件 UI 与交互设计规范》：
 * 1. 「扩展功能」页签：双卡可视化「对话顶栏样式」（含伴侣顶栏新手寻路 `?` 指南）+ 三大阅读发图体验开关 + 零版本号噪点的「配套增强」（内置无损「界面整理与低频收纳」二级页、人设馆直达、叙事记忆设置、重Roll回看加强）；
 * 2. 「原生与设置」页签：首屏直达「用户设置与导入美化主题」「扩展程序、正则、酒馆助手」（未装酒馆助手时支持行内一键代装正版）+ 预设/API/角色卡/世界书「左点进入原版 · 右控伴侣接管」四合一 + 沉底「排障与环境体检」与「SillyTavern 伴侣开关」；
 * 3. 全套 1.5px 纯色细线 SVG 图标（零彩色 Emoji），100% 跟随当前酒馆 SmartTheme 主题配色。
 */

import {
  MOON_NOTE_THEME_META,
  MOON_NOTE_THEME_MODES,
  applyMoonNoteTheme,
  findInstalledYantaiPresetName,
  getActiveHostThemeName,
  importOrActivateYantaiPreset,
  isMoonNoteThemeName,
} from '../core/companion-kit.js?v=0.9.8';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.9.8';
import { NATIVE_TOPBAR_DRAWER_ITEMS } from '../core/schema.js?v=0.9.8';
import { createVersionManager } from '../core/version-manager.js?v=0.9.8';
import { getHostPresetState } from '../modules/preset-backend.js?v=0.9.8';
import { discoverWandEntries } from './extensions-tidy.js?v=0.9.8';
import { closeAllNativeDrawers, openNativeDrawer, toastMessage } from './host-actions.js?v=0.9.8';

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
    desc: '开启时使用伴侣「世界书」面板（四源防假生效自检、蓝绿灯一指秒切、批量清理与重导卡内书）；点左侧「进入原版」直达酒馆原生世界书配置高级递归或向量参数，关闭右侧开关则常驻使用原版。',
  },
]);

export function createSettingsDialog({
  getContext,
  store,
  moduleBridge,
  suiteCoordinator = null,
  versionManager = null,
  stmVersion = '0.9.8',
  onToggleShell,
  onForcePruneTurbo = null,
  onOpenWelcomeGuide = null,
  onBeforeVersionChange = null,
  onOpenPersonaStudio,
  onOpenStateChange,
  onAfterOpenNativeDrawer,
}) {
  let dialogEl = null;
  let tabBarEl = null;
  let bodyEl = null;
  let statusBadgeEl = null;
  let activeTab = 'modules';
  let activeSubView = ''; // '' | 'tidy' | 'version'
  let expandedHelpKey = '';
  let nativeBarFoldOpen = false;
  let turboFoldOpen = false;
  let themePickerOpen = false;
  let applyingThemeBusy = false;
  let importingPresetBusy = false;
  let internalUpdating = false;
  let ownedVersionManager = null;
  const versionUi = {
    checked: null,
    notice: '',
    error: '',
    pendingTarget: null,
    appliedInfo: null,
  };

  function getVersionManager() {
    if (versionManager) return versionManager;
    if (!ownedVersionManager) {
      ownedVersionManager = createVersionManager({
        getContext,
        store,
        currentVersion: stmVersion,
        beforeChange: async () => {
          await onBeforeVersionChange?.();
        },
      });
    }
    return ownedVersionManager;
  }

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
    if (typeof onOpenWelcomeGuide === 'function') {
      const guideBtn = el('button', 'stm-pill-btn stm-dialog-guide-btn', '上手导览');
      guideBtn.type = 'button';
      guideBtn.title = '查看 SillyTavern 伴侣快速上手导览';
      guideBtn.addEventListener('click', () => {
        close();
        onOpenWelcomeGuide();
      });
      headerRight.append(guideBtn);
    }
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
        modeId: 'native',
        label: '原版顶栏',
        caption: '保留原版美化，图标已升级',
        withGuideBtn: false,
      },
      {
        modeId: 'rp',
        label: '伴侣顶栏',
        caption: '极简沉浸，快捷进出',
        withGuideBtn: true,
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

    if (current.topbarMode === 'native') {
      const hiddenSet = new Set(
        Array.isArray(current.nativeTopbarHiddenIcons) ? current.nativeTopbarHiddenIcons : [],
      );
      const totalIcons = NATIVE_TOPBAR_DRAWER_ITEMS.length;
      const shownCount = Math.max(0, totalIcons - hiddenSet.size);

      const foldWrap = el(
        'div',
        `stm-native-bar-fold${nativeBarFoldOpen ? ' is-open' : ''}${!current.shellEnabled ? ' is-disabled' : ''}`,
      );

      const foldHead = el('div', 'stm-native-bar-fold-head');
      const foldToggle = el('button', 'stm-native-bar-fold-btn');
      foldToggle.type = 'button';
      foldToggle.disabled = !current.shellEnabled;
      foldToggle.setAttribute('aria-expanded', String(nativeBarFoldOpen));
      foldToggle.append(
        el('span', 'stm-native-bar-fold-title', `原版顶栏图标显示设置（已显示 ${shownCount}/${totalIcons}）`),
        el('span', 'stm-native-bar-fold-caret', nativeBarFoldOpen ? '▴' : '▾'),
      );
      foldToggle.addEventListener('click', () => {
        if (!current.shellEnabled) return;
        nativeBarFoldOpen = !nativeBarFoldOpen;
        render();
      });
      foldHead.append(foldToggle);

      if (hiddenSet.size > 0 && current.shellEnabled) {
        const showAllBtn = el('button', 'stm-reset-link', '全部显示');
        showAllBtn.type = 'button';
        showAllBtn.addEventListener('click', () => {
          updateStoreFromDialog({ nativeTopbarHiddenIcons: [] });
        });
        foldHead.append(showAllBtn);
      }
      foldWrap.append(foldHead);

      if (nativeBarFoldOpen) {
        const foldBody = el('div', 'stm-native-bar-fold-body');
        foldBody.append(
          el(
            'div',
            'stm-native-bar-fold-hint',
            '默认保留全部原生顶栏图标（含「背景图」），取消勾选即可在原版顶栏中收起不常用的入口。',
          ),
        );
        const iconGrid = el('div', 'stm-native-icon-grid');
        for (const itemSpec of NATIVE_TOPBAR_DRAWER_ITEMS) {
          const isVisible = !hiddenSet.has(itemSpec.id);
          const pillBtn = el(
            'button',
            `stm-native-icon-pill${isVisible ? ' is-on' : ' is-off'}`,
          );
          pillBtn.type = 'button';
          pillBtn.disabled = !current.shellEnabled;
          pillBtn.setAttribute('aria-pressed', String(isVisible));
          pillBtn.dataset.drawerId = itemSpec.id;

          const checkBox = el('span', `stm-bind-checkbox${isVisible ? ' is-checked' : ''}`);
          if (isVisible) {
            checkBox.innerHTML = svgMarkup('check');
          }
          pillBtn.append(
            checkBox,
            createIconNode(doc, itemSpec.icon, 'stm-inline-svg'),
            el('span', 'stm-native-icon-pill-label', itemSpec.label),
          );
          pillBtn.addEventListener('click', () => {
            if (!current.shellEnabled) return;
            const nextHidden = new Set(
              Array.isArray(store.get().nativeTopbarHiddenIcons)
                ? store.get().nativeTopbarHiddenIcons
                : [],
            );
            if (nextHidden.has(itemSpec.id)) {
              nextHidden.delete(itemSpec.id);
            } else {
              nextHidden.add(itemSpec.id);
            }
            updateStoreFromDialog({ nativeTopbarHiddenIcons: [...nextHidden] });
          });
          iconGrid.append(pillBtn);
        }
        foldBody.append(iconGrid);
        foldWrap.append(foldBody);
      }

      card.append(foldWrap);
    }

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

  function makeTurboEngineCard(current) {
    const doc = globalThis.document;
    const helpKey = 'mod_turbo';
    const isHelpOpen = expandedHelpKey === helpKey;
    const turboOn = Boolean(current.modules?.turbo);
    const tc = current.turboConfig || {};
    const windowOn = tc.floorWindowEnabled !== false;
    const rawKeep = Number(tc.keepFloors);
    const isAutoKeep = !Number.isFinite(rawKeep) || rawKeep < 8;
    const keepFloors = isAutoKeep ? 0 : Math.min(200, Math.round(rawKeep));
    const loadStepFloors = Math.max(5, Math.min(100, Number(tc.loadStepFloors) || 20));

    const card = el(
      'div',
      `stm-switch-card is-compact stm-turbo-card${isHelpOpen ? ' is-help-open' : ''}${turboFoldOpen ? ' is-fold-open' : ''}`,
    );

    const bar = el('div', 'stm-switch-bar');
    const head = el('div', 'stm-switch-head');
    head.append(
      createIconNode(doc, 'zap', 'stm-row-icon'),
      el('strong', 'stm-switch-title', '流畅渲染引擎（隐形加速）'),
      makeHelpTriggerButton(
        helpKey,
        '流畅渲染引擎（隐形加速）',
      ),
    );

    const foldBtnLabel = !windowOn
      ? `楼层设置 ${turboFoldOpen ? '▴' : '▾'}`
      : isAutoKeep
        ? `智能楼层 ${turboFoldOpen ? '▴' : '▾'}`
        : `保留 ${keepFloors} 楼 ${turboFoldOpen ? '▴' : '▾'}`;
    const foldTriggerBtn = makeInlineActionBtn(
      foldBtnLabel,
      () => {
        turboFoldOpen = !turboFoldOpen;
        render();
      },
      'stm-turbo-fold-trigger',
    );
    head.append(foldTriggerBtn);

    const toggleLabel = el('label', 'stm-switch-toggle-wrap');
    const input = el('input', 'stm-switch-input');
    input.type = 'checkbox';
    input.checked = turboOn;
    input.addEventListener('change', () => {
      updateStoreFromDialog({ modules: { turbo: input.checked } });
      if (input.checked) onForcePruneTurbo?.();
    });
    const slider = el('span', 'stm-switch-track');
    toggleLabel.append(input, slider);

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
      updateStoreFromDialog({ modules: { turbo: input.checked } });
      if (input.checked) onForcePruneTurbo?.();
    });

    bar.append(head, toggleLabel);
    card.append(bar);

    if (isHelpOpen) {
      card.append(
        el(
          'div',
          'stm-switch-help-pop',
          '分端无感加速：电脑端宽裕保留 60 楼且不限帧率，零限制感；手机端自动守护 24 楼（释放旧 DOM 与前端卡旧 iframe 内存防闪退）、温和平衡流式重排帧率、穿透休眠离屏前端卡动画、异步解码插图并卸除高耗电多层毛玻璃。',
        ),
      );
    }

    if (turboFoldOpen) {
      const foldBox = el(
        'div',
        `stm-native-bar-fold stm-turbo-fold${!current.shellEnabled || !turboOn ? ' is-disabled' : ''}`,
      );

      const subToggleRow = el('div', 'stm-turbo-subrow');
      const subLabel = el(
        'span',
        'stm-turbo-sublabel',
        '动态收起更早旧楼层（物理减负，不改存档与记忆）',
      );
      const subSwitchWrap = el('label', 'stm-switch-toggle-wrap');
      const subInput = el('input', 'stm-switch-input');
      subInput.type = 'checkbox';
      subInput.checked = windowOn;
      subInput.disabled = !current.shellEnabled || !turboOn;
      subInput.addEventListener('change', () => {
        updateStoreFromDialog({ turboConfig: { floorWindowEnabled: subInput.checked } });
        if (subInput.checked) onForcePruneTurbo?.();
      });
      subSwitchWrap.append(subInput, el('span', 'stm-switch-track'));
      subToggleRow.append(subLabel, subSwitchWrap);
      foldBox.append(subToggleRow);

      if (windowOn) {
        const buildFloorPresetRow = ({
          label,
          presets,
          currentVal,
          minVal,
          maxVal,
          allowAuto = false,
          inputClass,
          onApply,
        }) => {
          const row = el('div', 'stm-turbo-Config-row');
          row.append(el('span', 'stm-turbo-row-title', label));

          const ctrlBar = el('div', 'stm-turbo-ctrl-bar');
          const pillWrap = el('div', 'stm-turbo-pills');
          if (allowAuto) {
            const autoPill = el(
              'button',
              `stm-turbo-pill${currentVal === 0 ? ' is-active' : ''}`,
              '自动',
            );
            autoPill.type = 'button';
            autoPill.title = '手机端自动保留 24 楼防发烫闪退，电脑端保留 60 楼不打断滚轮阅读';
            autoPill.disabled = !current.shellEnabled || !turboOn;
            autoPill.addEventListener('click', () => {
              onApply(0);
            });
            pillWrap.append(autoPill);
          }
          for (const num of presets) {
            const pill = el(
              'button',
              `stm-turbo-pill${currentVal === num ? ' is-active' : ''}`,
              `${num}楼`,
            );
            pill.type = 'button';
            pill.disabled = !current.shellEnabled || !turboOn;
            pill.addEventListener('click', () => {
              onApply(num);
            });
            pillWrap.append(pill);
          }

          const customWrap = el('label', 'stm-turbo-num-wrap');
          const numInput = el('input', `stm-turbo-num-input ${inputClass}`);
          numInput.type = 'number';
          numInput.min = String(minVal);
          numInput.max = String(maxVal);
          numInput.step = '1';
          numInput.placeholder = allowAuto ? '自动' : '';
          numInput.value = currentVal === 0 && allowAuto ? '' : String(currentVal);
          numInput.disabled = !current.shellEnabled || !turboOn;
          const commitNum = () => {
            const rawStr = String(numInput.value || '').trim();
            if (!rawStr && allowAuto) {
              onApply(0);
              return;
            }
            const parsed = Math.round(Number(rawStr));
            if (!Number.isFinite(parsed)) {
              numInput.value = currentVal === 0 && allowAuto ? '' : String(currentVal);
              return;
            }
            if (allowAuto && parsed <= 0) {
              onApply(0);
              return;
            }
            const clamped = Math.max(minVal, Math.min(maxVal, parsed));
            onApply(clamped);
          };
          numInput.addEventListener('change', commitNum);
          numInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitNum();
            }
          });
          customWrap.append(numInput, el('span', 'stm-turbo-num-unit', '楼'));

          ctrlBar.append(pillWrap, customWrap);
          row.append(ctrlBar);
          return row;
        };

        const hintDesc = isAutoKeep
          ? `当前为智能自动模式（手机端保留 24 楼防卡闪退，电脑端保留 60 楼零限制感）。点「到顶」秒回当前窗口首楼，再点顶部横条或上翻球即可每次向前展开 ${loadStepFloors} 楼；回到底部继续对话时自动收起（第 0 楼美化样式始终常驻保留）。`
          : `示例：保留 ${keepFloors} 楼时，玩到 88 楼点「到顶」将秒回第 ${Math.max(1, 88 - keepFloors)} 楼；点击顶部横条（或在顶部再点上翻球）可向前再展开 ${loadStepFloors} 楼，回到底部继续对话时自动收起（第 0 楼美化样式始终常驻保留）。`;

        foldBox.append(
          buildFloorPresetRow({
            label: '平时屏幕保留最近',
            presets: [20, 30, 50],
            currentVal: keepFloors,
            minVal: 8,
            maxVal: 200,
            allowAuto: true,
            inputClass: 'stm-turbo-keep-input',
            onApply: nextVal => {
              updateStoreFromDialog({ turboConfig: { keepFloors: nextVal } });
              onForcePruneTurbo?.();
            },
          }),
          buildFloorPresetRow({
            label: '回顶每次向前展开',
            presets: [15, 20, 30, 50],
            currentVal: loadStepFloors,
            minVal: 5,
            maxVal: 100,
            allowAuto: false,
            inputClass: 'stm-turbo-step-input',
            onApply: nextVal => {
              updateStoreFromDialog({ turboConfig: { loadStepFloors: nextVal } });
            },
          }),
          el('div', 'stm-native-bar-fold-hint', hintDesc),
        );
      }

      card.append(foldBox);
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
    toastMessage('请先打开右侧开关以启用记忆增强系统', 'info');
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
        helpKey: 'floor_actions_bottom',
        icon: 'more',
        title: '楼层底部操作与人话菜单',
        desc: '将每条消息顶部的「··· / 编辑」与长段编辑保存栏挪至楼层底部，点开「···」以清晰中文菜单展示（开新分支、保存此楼、隐藏、删除）并自动收起原生低频图标；关闭即刻退回原版。',
        checked: current.floorActionsBottom !== false,
        onChange: val => {
          updateStoreFromDialog({ floorActionsBottom: val });
        },
      }),
      makeSwitchRow({
        helpKey: 'hide_home_composer',
        icon: 'eyeoff',
        title: '首页隐藏底部输入栏',
        desc: '默认开启，在角色书架首页隐藏酒馆原生底部输入栏，画面更清爽；若习惯在书架首页点击底部魔法棒菜单或输入指令，关闭即可恢复显示（注：若所用第三方美化主题自身隐藏了首页输入栏，仍以美化样式为准）。',
        checked: current.hideHomeComposer !== false,
        onChange: val => {
          updateStoreFromDialog({ hideHomeComposer: val });
        },
      }),
      makeSwitchRow({
        helpKey: 'float_capsule',
        icon: 'capsule',
        title: '悬浮快捷栏与底栏收纳',
        desc: '默认关闭；开启后在侧边展示一体拖动、视觉独立的轻盈小圆球（上翻 5 楼 · 动态收纳球 · 下翻 5 楼；无外挂按钮时自动隐去收纳球，连戳两下浮出「到顶 / 到底」），自动收起底栏外挂按钮，还支持把角色卡自带的野生悬浮球直接拖进来收纳！',
        checked: Boolean(current.floatCapsuleEnabled),
        onChange: val => {
          updateStoreFromDialog({ floatCapsuleEnabled: val });
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
      makeTurboEngineCard(current),
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
        title: '记忆增强系统',
        desc: '平时无感、默认关闭且零拦截；开启后每 3 轮自动总结剧情生成独立世界书，长对话不忘设定且随时可查。',
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

    // 1. 正版授权内置美化《观月札记 V1.1.3》（原作者：WWW · 日间/夜间/跟随系统）触发钮与展开栏
    const activeThemeName = getActiveHostThemeName({ getContext, doc });
    const isUsingMoonNote = isMoonNoteThemeName(activeThemeName);

    const companionThemeBtn = el(
      'button',
      'stm-row-inline-btn stm-companion-theme-btn',
      applyingThemeBusy
        ? '应用中…'
        : isUsingMoonNote
          ? '切换观月札记'
          : '启用观月札记',
    );
    companionThemeBtn.type = 'button';
    companionThemeBtn.title = `一键启用 ${MOON_NOTE_THEME_META.author} 老师正版授权的《${MOON_NOTE_THEME_META.title}》日/夜双模美化`;
    companionThemeBtn.disabled = applyingThemeBusy;
    companionThemeBtn.addEventListener('click', evt => {
      evt.preventDefault();
      evt.stopPropagation();
      themePickerOpen = !themePickerOpen;
      render();
    });

    let themePickerNode = null;
    if (themePickerOpen) {
      themePickerNode = el('div', 'stm-theme-picker-pop is-moon-note');

      const creditBar = el('div', 'stm-theme-credit-bar');
      const creditHead = el('div', 'stm-theme-credit-head');
      creditHead.append(
        el('strong', 'stm-theme-credit-title', MOON_NOTE_THEME_META.title),
        el('span', 'stm-theme-credit-badge', MOON_NOTE_THEME_META.creditLine),
      );
      creditBar.append(
        creditHead,
        el(
          'span',
          'stm-theme-credit-note',
          '自带日/夜双模与人设馆兼容层，点击下方模式即写入酒馆主题库并立即生效：',
        ),
      );
      themePickerNode.append(creditBar);

      const modeGrid = el('div', 'stm-theme-mode-grid');
      for (const mode of MOON_NOTE_THEME_MODES) {
        const isCur = activeThemeName === mode.name;
        const optBtn = el(
          'button',
          `stm-theme-option-btn${isCur ? ' is-active' : ''}${mode.id === 'auto' ? ' is-span-full' : ''}`,
        );
        optBtn.type = 'button';
        optBtn.disabled = applyingThemeBusy;
        optBtn.dataset.themeMode = mode.id;

        const optHead = el('div', 'stm-theme-opt-head');
        optHead.append(el('strong', 'stm-theme-opt-title', mode.shortLabel));
        if (mode.recommended) {
          optHead.append(el('span', 'stm-theme-rec-badge', '推荐'));
        }
        if (isCur) {
          optHead.append(el('span', 'stm-theme-cur-badge', '使用中'));
        }
        optBtn.append(optHead, el('span', 'stm-theme-opt-sub', mode.sub));
        optBtn.addEventListener('click', async evt => {
          evt.preventDefault();
          evt.stopPropagation();
          if (applyingThemeBusy) return;
          applyingThemeBusy = true;
          render();
          try {
            const res = await applyMoonNoteTheme(mode.id, { getContext, doc });
            themePickerOpen = false;
            toastMessage(`已启用「${res.name}」（作者：${res.author}）`, 'success');
          } catch (err) {
            toastMessage(err?.message || '启用观月札记主题失败', 'error');
          } finally {
            applyingThemeBusy = false;
            render();
          }
        });
        modeGrid.append(optBtn);
      }
      themePickerNode.append(modeGrid);
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
        desc: '导入与切换酒馆 UI 美化主题、自定义 CSS、对话气泡样式与流式输出速度；也可直接点右侧「启用观月札记」一键应用 WWW 老师授权的《观月札记》日/夜主题。',
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

    const versionHelpKey = 'native_version_mgr';
    const isVersionHelpOpen = expandedHelpKey === versionHelpKey;
    const versionWrap = el(
      'div',
      `stm-shortcut-item is-compact${isVersionHelpOpen ? ' is-help-open' : ''}`,
    );
    const versionBar = el('div', 'stm-shortcut-bar stm-version-entry-bar');
    const versionHead = el('div', 'stm-switch-head');
    versionHead.append(
      createIconNode(doc, 'refresh', 'stm-row-icon'),
      el('strong', 'stm-switch-title', '版本与更新'),
      el('span', 'stm-ver-pill', `v${stmVersion}`),
      makeHelpTriggerButton(versionHelpKey, '版本与更新'),
    );
    versionBar.append(versionHead, el('span', 'stm-shortcut-arrow', '›'));
    versionBar.addEventListener('click', evt => {
      const target = evt.target;
      if (target && typeof target.closest === 'function' && target.closest('.stm-help-btn')) {
        return;
      }
      activeSubView = 'version';
      expandedHelpKey = '';
      versionUi.pendingTarget = null;
      render();
    });
    versionWrap.append(versionBar);
    if (isVersionHelpOpen) {
      versionWrap.append(
        el(
          'div',
          'stm-switch-help-pop',
          '手动检查 SillyTavern 伴侣最新版、一键更新或回退至历史稳定版本。切换前会自动备份全部伴侣设置，角色卡与聊天存档完全不受影响。',
        ),
      );
    }

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
          '一键复制当前设备容器、主题、砚台套件状态与已装第三方扩展名单（不含任何 API 密钥与聊天隐私）。遇到使用疑问、插件或美化不兼容时，复制体检单联系作者即可逐个帮你调好适配；极端冲突无法进页可在网址末尾加 ?stm_safe=1 安全启动。',
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

    footerGroup.append(versionWrap, diagWrap, masterSwitchRow);
    container.append(footerGroup);
  }

  function renderVersionSubView(container) {
    const doc = globalThis.document;
    const vm = getVersionManager();
    const checked = versionUi.checked;
    const busy = Boolean(vm.busy);
    const reloadNeeded = Boolean(vm.reloadNeeded);

    const navRow = el('div', 'stm-subview-bar');
    const backBtn = el('button', 'stm-subview-back-btn');
    backBtn.type = 'button';
    backBtn.append(createIconNode(doc, 'back', 'stm-row-icon'), el('span', '', '返回原生与设置'));
    backBtn.addEventListener('click', () => {
      activeSubView = '';
      expandedHelpKey = '';
      versionUi.pendingTarget = null;
      render();
    });
    navRow.append(backBtn, el('strong', 'stm-subview-title', '版本与更新'));
    container.append(navRow);

    const hero = el('div', 'stm-ver-hero');
    const heroTop = el('div', 'stm-ver-hero-top');
    heroTop.append(
      el('strong', 'stm-ver-hero-title', `SillyTavern 伴侣 v${stmVersion}`),
      el(
        'span',
        'stm-ver-pill',
        checked?.currentBranchName ? `分支：${checked.currentBranchName}` : '手动检查模式',
      ),
    );
    hero.append(
      heroTop,
      el(
        'p',
        'stm-ver-hero-note',
        '只在你点击时检查更新或切换版本，绝不后台静默改动；切换前会自动备份全部伴侣设置，角色卡与聊天存档保持原样。',
      ),
    );

    const actions = el('div', 'stm-ver-actions');
    const checkBtn = el('button', 'stm-ver-btn', busy ? '正在处理…' : '检查更新');
    checkBtn.type = 'button';
    checkBtn.dataset.versionAction = 'check';
    checkBtn.disabled = busy || reloadNeeded;
    checkBtn.addEventListener('click', async () => {
      versionUi.error = '';
      versionUi.pendingTarget = null;
      versionUi.notice = '正在连接仓库核对最新版本与可回退分支…';
      render();
      try {
        const res = await vm.check();
        versionUi.checked = res;
        if (res.latest) {
          versionUi.notice = res.needsMainSwitch
            ? `当前停留在历史分支 ${res.currentBranchName}，可一键回到最新版 v${res.latest.version}。`
            : `发现新版 v${res.latest.version}，可点击下方按钮更新。`;
        } else if (res.unavailableLatest) {
          versionUi.notice = '仓库已有更新版本，但需要较新版酒馆客户端支持。';
        } else {
          versionUi.notice = `当前 v${stmVersion} 已是最新稳定版本。`;
        }
      } catch (err) {
        versionUi.error = err?.message || '检查更新失败，请稍后重试。';
        versionUi.notice = '';
      } finally {
        render();
      }
    });

    const updateBtn = el(
      'button',
      'stm-ver-btn is-primary',
      checked?.latest ? `更新到 v${checked.latest.version}` : '更新到最新版',
    );
    updateBtn.type = 'button';
    updateBtn.dataset.versionAction = 'update';
    updateBtn.disabled = busy || reloadNeeded || !checked?.latest;
    updateBtn.addEventListener('click', () => {
      if (!checked?.latest || vm.busy || vm.reloadNeeded) return;
      versionUi.pendingTarget = checked.latest;
      versionUi.error = '';
      render();
    });

    actions.append(checkBtn, updateBtn);

    if (reloadNeeded) {
      const reloadBtn = el('button', 'stm-ver-btn is-primary', '立即刷新酒馆生效');
      reloadBtn.type = 'button';
      reloadBtn.dataset.versionAction = 'reload';
      reloadBtn.addEventListener('click', () => {
        globalThis.location?.reload?.();
      });
      actions.append(reloadBtn);
    }

    hero.append(actions);
    container.append(hero);

    if (versionUi.error) {
      container.append(el('div', 'stm-ver-banner is-error', versionUi.error));
    } else if (versionUi.notice) {
      container.append(el('div', 'stm-ver-banner', versionUi.notice));
    }

    if (versionUi.pendingTarget && checked && !reloadNeeded) {
      const target = versionUi.pendingTarget;
      const isUpgrade = target.action === 'update';
      const confirmCard = el('div', 'stm-ver-confirm');
      confirmCard.append(
        el(
          'strong',
          'stm-ver-confirm-title',
          isUpgrade ? `确认更新到最新版 v${target.version}？` : `确认回退到历史版本 v${target.version}？`,
        ),
        el(
          'p',
          'stm-ver-confirm-desc',
          target.notes ||
            '切换前会自动保存当前伴侣设置快照；角色卡、世界书与聊天存档保持原样，完成后点击刷新即可生效。',
        ),
      );
      const confirmActions = el('div', 'stm-ver-actions');
      const cancelBtn = el('button', 'stm-ver-btn', '取消');
      cancelBtn.type = 'button';
      cancelBtn.disabled = busy;
      cancelBtn.addEventListener('click', () => {
        versionUi.pendingTarget = null;
        render();
      });
      const okBtn = el('button', 'stm-ver-btn is-primary', isUpgrade ? '确认更新' : '确认回退');
      okBtn.type = 'button';
      okBtn.dataset.versionAction = 'confirm';
      okBtn.disabled = busy;
      okBtn.addEventListener('click', async () => {
        versionUi.error = '';
        versionUi.notice = isUpgrade
          ? `正在更新到 v${target.version}，请勿关闭页面…`
          : `正在回退到 v${target.version}，请勿关闭页面…`;
        render();
        try {
          const applied = await vm.apply(checked, target);
          versionUi.appliedInfo = applied;
          versionUi.pendingTarget = null;
          versionUi.notice = `已切换至 v${applied.version}（分支：${applied.branch}），请点击上方「立即刷新酒馆生效」。`;
          toastMessage(`伴侣已切换至 v${applied.version}，请刷新酒馆生效`, 'success');
        } catch (err) {
          versionUi.error = err?.message || '版本切换失败，请刷新确认当前版本。';
          versionUi.notice = '';
        } finally {
          render();
        }
      });
      confirmActions.append(cancelBtn, okBtn);
      confirmCard.append(confirmActions);
      container.append(confirmCard);
    }

    if (checked?.latestInfo) {
      container.append(el('div', 'stm-settings-subhead', '最新版本说明'));
      const latestCard = el('div', 'stm-ver-release-card');
      const latestHead = el('div', 'stm-ver-release-head');
      latestHead.append(
        el('strong', 'stm-ver-release-ver', `v${checked.latestInfo.version}`),
        el(
          'span',
          'stm-ver-pill',
          checked.latestInfo.version === stmVersion ? '当前版本' : '最新稳定版',
        ),
      );
      latestCard.append(
        latestHead,
        el('p', 'stm-ver-release-notes', checked.latestInfo.notes || '常规稳定性与体验优化。'),
      );
      container.append(latestCard);
    }

    if (checked) {
      container.append(el('div', 'stm-settings-subhead', '历史稳定版本（一键回退）'));
      const list = el('div', 'stm-ver-list');
      if (Array.isArray(checked.rollbackList) && checked.rollbackList.length > 0) {
        for (const rel of checked.rollbackList) {
          const card = el('div', 'stm-ver-release-card');
          const head = el('div', 'stm-ver-release-head');
          head.append(el('strong', 'stm-ver-release-ver', `v${rel.version}`));
          const rbBtn = el('button', 'stm-ver-btn', '回退此版本');
          rbBtn.type = 'button';
          rbBtn.dataset.rollbackVersion = rel.version;
          rbBtn.disabled = busy || reloadNeeded;
          rbBtn.addEventListener('click', () => {
            if (vm.busy || vm.reloadNeeded) return;
            versionUi.pendingTarget = rel;
            versionUi.error = '';
            render();
          });
          head.append(rbBtn);
          card.append(
            head,
            el('p', 'stm-ver-release-notes', rel.notes || '历史稳定版本。'),
          );
          list.append(card);
        }
      } else {
        list.append(
          el(
            'p',
            'stm-ver-foot-hint',
            '当前仓库暂无更早的兼容发布分支可供回退；后续每个稳定版本发布后都会自动出现在这里。',
          ),
        );
      }
      container.append(list);
    }

    container.append(
      el(
        'p',
        'stm-ver-foot-hint',
        '提示：在云酒馆或解压包安装环境下若提示无写权限，可直接在酒馆「管理扩展」更新；遇到新旧版本或第三方插件不兼容，随时联系作者协助适配。',
      ),
    );
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
    } else if (activeSubView === 'version') {
      renderVersionSubView(bodyEl);
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
    } else if (tabId === 'version') {
      activeTab = 'native';
      activeSubView = 'version';
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
    ownedVersionManager?.dispose?.();
    ownedVersionManager = null;
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
