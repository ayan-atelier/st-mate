/**
 * ST伴侣 (st-mate) · 「ST伴侣设置中心」四页签极简控制面板 + 保底原生入口
 * 视觉准则：全套采用 1.5px 纯色细线 SVG 图标（零彩色 Emoji），100% 跟随当前酒馆美化主题配色；
 * 性能准则：滑块实时拖动采用 rAF 局部预览，不销毁重建当前滑块 DOM，松手后再防抖落盘。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.3.1';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.3.1';
import { openNativeDrawer, toastMessage } from './host-actions.js?v=0.3.1';

const TABS = Object.freeze([
  { id: 'modules', icon: 'grid', label: '模块开关' },
  { id: 'reading', icon: 'eye', label: '阅读与界面' },
  { id: 'api', icon: 'bolt', label: 'API与模型' },
  { id: 'native', icon: 'layers', label: '扩展与原生' },
]);

const NATIVE_SHORTCUTS = Object.freeze([
  {
    drawerId: 'extensions-settings-button',
    icon: 'grid',
    title: '第三方扩展设置',
    desc: '集中打开酒馆助手、TTS语音、文生图、正则等所有外部插件的设置面板',
  },
  {
    drawerId: 'user-settings-button',
    icon: 'palette',
    title: '酒馆界面与美化主题',
    desc: '调整你原本安装的酒馆 UI 主题、气泡样式、流式速度与用户偏好',
  },
  {
    drawerId: 'backgrounds-button',
    icon: 'image',
    title: '酒馆原生背景图库',
    desc: '更换或上传酒馆自带全局背景图片',
  },
  {
    drawerId: 'advanced-formatting-button',
    icon: 'code',
    title: '高级回复格式',
    desc: '查看提示词模板、上下文格式与推理标签解析设置',
  },
]);

export function createSettingsDialog({
  getContext,
  store,
  moduleBridge,
  onToggleShell,
  onPreviewAtmosphere,
  onOpenReaderDock,
}) {
  let dialogEl = null;
  let bodyEl = null;
  let activeTab = 'modules';
  let internalUpdating = false;
  let previewRaf = 0;

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

  function previewVibePatch(vibePatch) {
    store.update({ vibe: vibePatch }, { silent: true });
    if (previewRaf) return;
    const req = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16));
    previewRaf = req(() => {
      previewRaf = 0;
      onPreviewAtmosphere?.();
    });
  }

  function close() {
    if (dialogEl?.open) {
      dialogEl.close();
    } else if (dialogEl) {
      dialogEl.removeAttribute('open');
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
    const badge = el('span', 'stm-dialog-badge', 'Phase 1 · v0.3.1');
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

    const tabBar = el('nav', 'stm-tabs');
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

  function makeSwitchRow({ icon = '', title, desc, badgeText = '', checked, onChange }) {
    const doc = globalThis.document;
    const row = el('label', 'stm-switch-card');
    const copy = el('div', 'stm-switch-copy');
    const head = el('div', 'stm-switch-head');
    if (icon) {
      head.append(createIconNode(doc, icon, 'stm-row-icon'));
    }
    head.append(el('strong', 'stm-switch-title', title));
    if (badgeText) {
      head.append(el('span', 'stm-chip', badgeText));
    }
    copy.append(head);
    if (desc) {
      copy.append(el('small', 'stm-switch-desc', desc));
    }

    const input = el('input', 'stm-switch-input');
    input.type = 'checkbox';
    input.checked = Boolean(checked);
    input.addEventListener('change', () => onChange(input.checked));

    const slider = el('span', 'stm-switch-track');
    row.append(copy, input, slider);
    return row;
  }

  function renderModulesTab(container, current) {
    container.append(
      el('p', 'stm-section-intro', '所有功能均可独立开关：不想要哪块随时关掉，自动退回酒馆原版或让你混用其他同类插件。'),
    );

    container.append(
      makeSwitchRow({
        icon: 'home',
        title: 'ST伴侣全套模式（一键总开关）',
        desc: '开启时启用沉浸顶栏与下方你勾选的模块；关闭（或点首页「原生酒馆」）会一键挂起书架、人设馆等全部接管，直达纯原生酒馆，再次开启时原样恢复你的勾选组合。',
        badgeText: current.shellEnabled ? '伴侣运行中' : '纯原生酒馆态',
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
      if (!current.shellEnabled && mod.enabled) badgeText = '随原生模式挂起';
      else if (mod.key === 'turbo') badgeText = mod.enabled ? '静默守护中' : '已关闭';
      else if (mod.key === 'reader') badgeText = mod.enabled ? '顶栏 Aa 即时调校' : '已关闭';
      else if (mod.key === 'presets') badgeText = 'Phase 1 原生桥接';
      else if (mod.key === 'charWorld') badgeText = 'Phase 1 原生桥接';
      else if (mod.key === 'memory') badgeText = 'Phase 4 接入';
      else if (mod.standaloneConnected) badgeText = `已联动 v${mod.version || '独立版'}`;
      else if (!mod.enabled) badgeText = '按需开启';

      container.append(
        makeSwitchRow({
          icon: mod.icon,
          title: mod.label,
          desc: mod.summary,
          badgeText,
          checked: mod.enabled,
          onChange: async val => {
            updateStoreFromDialog({ modules: { [mod.key]: val } }, { reRender: false });
            if (store.get().shellEnabled) {
              await moduleBridge.syncModuleEnabled(mod.key, val);
            }
            render();
          },
        }),
      );
    }
  }

  function makeRangeControl({ label, unit, min, max, step = 1, value, formatValue, onInput }) {
    const wrap = el('div', 'stm-range-row');
    const top = el('div', 'stm-range-head');
    const title = el('span', 'stm-range-label', label);
    const valSpan = el('span', 'stm-range-value', formatValue ? formatValue(value) : `${value}${unit}`);
    top.append(title, valSpan);

    const range = el('input', 'stm-range-input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    range.addEventListener('input', () => {
      const num = Number(range.value);
      valSpan.textContent = formatValue ? formatValue(num) : `${num}${unit}`;
      onInput(num);
    });

    wrap.append(top, range);
    return wrap;
  }

  function renderReadingTab(container, current) {
    const doc = globalThis.document;
    const modeCard = el('div', 'stm-card-block');
    modeCard.append(el('strong', 'stm-block-title', '对话顶栏形态'));
    const seg = el('div', 'stm-segmented');

    for (const [modeId, modeIcon, modeLabel, modeHint] of [
      ['rp', 'chat', 'RP态', '左侧显示角色头像、名字与预设'],
      ['reading', 'book', '阅读态', '隐去头像名字，纯细线图标留白'],
    ]) {
      const btn = el('button', `stm-seg-btn${current.topbarMode === modeId ? ' is-active' : ''}`);
      btn.type = 'button';
      const headLine = el('span', 'stm-seg-head');
      headLine.append(createIconNode(doc, modeIcon, 'stm-row-icon'), el('strong', '', modeLabel));
      btn.append(headLine, el('small', '', modeHint));
      btn.addEventListener('click', () => {
        if (current.topbarMode === modeId) return;
        updateStoreFromDialog({ topbarMode: modeId });
      });
      seg.append(btn);
    }
    modeCard.append(seg);
    container.append(modeCard);

    container.append(
      makeSwitchRow({
        icon: 'spark',
        title: '轻触正文「全屏纯享阅读」',
        desc: '阅读时轻点正文空白或普通文字，顶栏与底栏输入区零重排丝滑收起；再点一下立即恢复（自动避开划词、滚动与按钮）。',
        badgeText: current.tapPureReading ? '已开启' : '已关闭',
        checked: current.tapPureReading,
        onChange: val => {
          updateStoreFromDialog({ tapPureReading: val });
        },
      }),
    );

    if (current.tapPureReading) {
      const scopeRow = el('div', 'stm-inline-choice');
      scopeRow.append(el('span', 'stm-inline-label', '生效范围：'));
      for (const [scopeId, scopeName] of [
        ['all', 'RP态与阅读态均支持'],
        ['reading', '仅在阅读态下支持'],
      ]) {
        const pill = el('button', `stm-mini-pill${current.tapPureReadingScope === scopeId ? ' is-active' : ''}`, scopeName);
        pill.type = 'button';
        pill.addEventListener('click', () => {
          if (current.tapPureReadingScope === scopeId) return;
          updateStoreFromDialog({ tapPureReadingScope: scopeId });
        });
        scopeRow.append(pill);
      }
      container.append(scopeRow);
    }

    const vibeCard = el('div', 'stm-card-block');
    const vibeHeader = el('div', 'stm-block-header');
    vibeHeader.append(el('strong', 'stm-block-title', '页面排版与背景（顶栏 Aa 键）'));
    const resetBtn = el('button', 'stm-text-btn', '恢复默认');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => {
      updateStoreFromDialog({
        vibe: {
          backdropMode: 'theme',
          backdropBrightness: 42,
          backdropClarity: 55,
          fontSizePx: 0,
          fontScale: 100,
          paddingX: 0,
          lineHeight: 0,
          paragraphIndent: 'default',
          hideAvatars: false,
          bookPageFlow: false,
          fontChoice: 'default',
        },
      });
    });
    vibeHeader.append(resetBtn);
    vibeCard.append(vibeHeader);

    const openDockBtn = el('button', 'stm-primary-btn');
    openDockBtn.type = 'button';
    openDockBtn.append(
      createIconNode(doc, 'typography', 'stm-row-icon'),
      el('span', '', '展开页面排版与背景抽屉（边看正文边调）'),
    );
    openDockBtn.addEventListener('click', () => {
      if (!hasActiveChatSelection(getContext?.())) {
        toastMessage('请先打开任意角色对话，再点顶栏 Aa 键展开调整面板', 'info');
        return;
      }
      if (!store.get().modules.reader) {
        updateStoreFromDialog({ modules: { reader: true } }, { reRender: false });
      }
      close();
      onOpenReaderDock?.();
    });
    vibeCard.append(openDockBtn);

    const bgSeg = el('div', 'stm-inline-choice');
    bgSeg.append(el('span', 'stm-inline-label', '背景图：'));
    for (const [bgMode, bgName] of [
      ['character', '角色图'],
      ['custom', '自定义'],
      ['theme', '原版'],
    ]) {
      const pill = el('button', `stm-mini-pill${current.vibe.backdropMode === bgMode ? ' is-active' : ''}`, bgName);
      pill.type = 'button';
      pill.addEventListener('click', () => {
        if (current.vibe.backdropMode === bgMode) return;
        updateStoreFromDialog({ vibe: { backdropMode: bgMode } });
      });
      bgSeg.append(pill);
    }
    vibeCard.append(bgSeg);

    if (current.vibe.backdropMode !== 'theme') {
      vibeCard.append(
        makeRangeControl({
          label: '亮度',
          unit: '%',
          min: 8,
          max: 95,
          value: current.vibe.backdropBrightness,
          onInput: val => previewVibePatch({ backdropBrightness: val }),
        }),
        makeRangeControl({
          label: '清晰度',
          unit: '%',
          min: 0,
          max: 100,
          value: current.vibe.backdropClarity,
          onInput: val => previewVibePatch({ backdropClarity: val }),
        }),
      );
    }

    vibeCard.append(
      makeRangeControl({
        label: '字号',
        unit: 'px',
        min: 12,
        max: 26,
        step: 1,
        value: current.vibe.fontSizePx > 0 ? current.vibe.fontSizePx : 12,
        formatValue: v => (v <= 12 ? '跟随原美化' : `${v}px`),
        onInput: val => previewVibePatch({ fontSizePx: val <= 12 ? 0 : val }),
      }),
      makeRangeControl({
        label: '边距',
        unit: 'px',
        min: 0,
        max: 60,
        step: 2,
        value: current.vibe.paddingX,
        formatValue: v => (v === 0 ? '跟随原版' : `${v}px`),
        onInput: val => previewVibePatch({ paddingX: val }),
      }),
      makeRangeControl({
        label: '行距',
        unit: '',
        min: 135,
        max: 240,
        step: 5,
        value: current.vibe.lineHeight > 0 ? current.vibe.lineHeight : 135,
        formatValue: v => (v <= 135 ? '跟随原美化' : `${(v / 100).toFixed(2)} 倍`),
        onInput: val => previewVibePatch({ lineHeight: val <= 135 ? 0 : val }),
      }),
    );
    container.append(vibeCard);

    container.append(
      makeSwitchRow({
        icon: 'fold',
        title: '收纳底栏「☰ 三横」低频原生项',
        desc: '保留全部第三方插件入口不动，仅把作者注释、Token概率、CFG等低频项收进「更多原生工具」。',
        checked: current.tidy.foldOptionsMenu,
        onChange: val => {
          updateStoreFromDialog({ tidy: { foldOptionsMenu: val } });
        },
      }),
    );
  }

  function renderApiTab(container, current) {
    const doc = globalThis.document;
    const quickCard = el('div', 'stm-card-block');
    quickCard.append(
      el('strong', 'stm-block-title', '主对话连接与预设快捷入口'),
      el('small', 'stm-switch-desc', 'Phase 2 将在此上线「多中转站卡片一键秒切 + 预设冷宫仓库 + 角色自动绑定预设」。当前可直接一键呼出面板：'),
    );

    const btnRow = el('div', 'stm-action-grid');
    const openApiBtn = el('button', 'stm-action-card');
    openApiBtn.type = 'button';
    openApiBtn.append(createIconNode(doc, 'bolt', 'stm-row-icon'), el('span', '', '打开 API 连接与模型配置'));
    openApiBtn.addEventListener('click', () => {
      close();
      openNativeDrawer('sys-settings-button', { getContext });
    });

    const openPresetBtn = el('button', 'stm-action-card');
    openPresetBtn.type = 'button';
    openPresetBtn.append(createIconNode(doc, 'sliders', 'stm-row-icon'), el('span', '', '打开对话预设与提示词面板'));
    openPresetBtn.addEventListener('click', () => {
      close();
      openNativeDrawer('ai-config-button', { getContext });
    });

    btnRow.append(openApiBtn, openPresetBtn);
    quickCard.append(btnRow);
    container.append(quickCard);

    const auxCard = el('div', 'stm-card-block');
    const auxHead = el('div', 'stm-switch-head');
    auxHead.append(createIconNode(doc, 'spark', 'stm-row-icon'), el('strong', 'stm-block-title', '小助手专用省钱副 API（Phase 4 预留配置）'));
    auxCard.append(
      auxHead,
      el('small', 'stm-switch-desc', '后续开启记忆总结、人设 AI 或 AI 缝预设时，可单独走便宜高速的副模型通道，不消耗昂贵主对话额度。'),
    );

    const endpointInput = el('input', 'stm-input');
    endpointInput.type = 'url';
    endpointInput.placeholder = '副 API 地址（例如 https://api.deepseek.com/v1，选填预留）';
    endpointInput.value = current.auxApi.endpoint;
    endpointInput.addEventListener('change', () => {
      updateStoreFromDialog({ auxApi: { endpoint: endpointInput.value } }, { reRender: false });
    });

    const modelInput = el('input', 'stm-input');
    modelInput.type = 'text';
    modelInput.placeholder = '副模型名称（例如 gemini-2.5-flash / deepseek-chat）';
    modelInput.value = current.auxApi.model;
    modelInput.addEventListener('change', () => {
      updateStoreFromDialog({ auxApi: { model: modelInput.value } }, { reRender: false });
    });

    auxCard.append(endpointInput, modelInput);
    container.append(auxCard);
  }

  function renderNativeTab(container, current) {
    const doc = globalThis.document;
    container.append(
      el('p', 'stm-section-intro', '不用切回原生顶栏，也能在这里一键打开平时收起来的第三方插件设置（如 TTS、文生图、酒馆助手）或底层酒馆选项：'),
    );

    const list = el('div', 'stm-shortcut-list');
    for (const item of NATIVE_SHORTCUTS) {
      const btn = el('button', 'stm-shortcut-item');
      btn.type = 'button';
      const copy = el('div', 'stm-switch-copy');
      const head = el('div', 'stm-switch-head');
      head.append(createIconNode(doc, item.icon, 'stm-row-icon'), el('strong', 'stm-switch-title', item.title));
      copy.append(head, el('small', 'stm-switch-desc', item.desc));
      btn.append(copy, el('span', 'stm-shortcut-arrow', '›'));
      btn.addEventListener('click', () => {
        close();
        openNativeDrawer(item.drawerId, { getContext });
      });
      list.append(btn);
    }
    container.append(list);

    const fallbackCard = el('div', 'stm-card-block stm-highlight-card');
    const fbHead = el('div', 'stm-switch-head');
    fbHead.append(createIconNode(doc, 'refresh', 'stm-row-icon'), el('strong', 'stm-block-title', '随时自由进出原生酒馆'));
    fallbackCard.append(
      fbHead,
      el('small', 'stm-switch-desc', '需要核对原生全部顶栏按钮？点下方即可无损切回；想回来时点书架右上角或底栏「魔法棒 → ST伴侣设置」即可。'),
    );
    const toggleBtn = el(
      'button',
      'stm-primary-btn',
      current.shellEnabled ? '暂时切回原生酒馆界面' : '立即恢复 ST伴侣沉浸界面',
    );
    toggleBtn.type = 'button';
    toggleBtn.addEventListener('click', () => {
      const next = !store.get().shellEnabled;
      onToggleShell?.(next);
      close();
    });
    fallbackCard.append(toggleBtn);
    container.append(fallbackCard);
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
    else if (activeTab === 'reading') renderReadingTab(bodyEl, current);
    else if (activeTab === 'api') renderApiTab(bodyEl, current);
    else renderNativeTab(bodyEl, current);
  }

  function open(tabId = null) {
    if (tabId && TABS.some(t => t.id === tabId)) {
      activeTab = tabId;
    }
    const dlg = ensureDialog();
    if (!dlg) return;
    render();
    if (!dlg.open) {
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute('open', '');
      }
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
    if (extHost && !doc.getElementById('stm-ext-inline-drawer')) {
      const wrap = el('div');
      wrap.id = 'stm-ext-inline-drawer';
      const drawer = el('div', 'inline-drawer');
      const header = el('div', 'inline-drawer-toggle inline-drawer-header');
      const icon = el('div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down');
      header.append(el('b', '', '砚台 · ST伴侣'), icon);

      const content = el('div', 'inline-drawer-content');
      const desc = el('small', 'stm-ext-note', '可逆夺舍外壳 · 双态顶栏 · 全屏纯享阅读 · 模块独立开关');
      const openBtn = el('button', 'menu_button', '打开 ST伴侣设置中心');
      openBtn.type = 'button';
      openBtn.addEventListener('click', () => open());

      const quickRestore = el('button', 'menu_button', '切换：伴侣界面 / 原生酒馆');
      quickRestore.type = 'button';
      quickRestore.addEventListener('click', () => {
        const next = !store.get().shellEnabled;
        void onToggleShell?.(next);
      });

      content.append(desc, openBtn, quickRestore);
      drawer.append(header, content);
      wrap.append(drawer);
      extHost.prepend(wrap);
    }
  }

  function destroy() {
    if (previewRaf && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(previewRaf);
    }
    previewRaf = 0;
    close();
    dialogEl?.remove();
    dialogEl = null;
    bodyEl = null;
    const doc = globalThis.document;
    doc?.getElementById('stm-wand-entry')?.remove();
    doc?.getElementById('stm-ext-inline-drawer')?.remove();
  }

  return {
    open,
    close,
    renderIfOpen: () => {
      if (dialogEl?.open && !internalUpdating) render();
    },
    installFallbackEntries,
    destroy,
  };
}
