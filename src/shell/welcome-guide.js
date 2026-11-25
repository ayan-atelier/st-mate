/**
 * SillyTavern 伴侣 (st-mate) · 首次使用与进阶玩法双页签导览卡片 (#stm-welcome-guide)
 * 设计理念：
 * 1. 新用户首次装好刷新后仅轻柔弹出一次，点右上角 ×、遮罩、ESC 或「知道了，开始用」立即永久关闭，绝不反复打扰；
 * 2. 「快速上手」默认呈现最常用也最容易错过的 4 个核心入口（T/Aa 排版背景与重点字、万能混传、原版顶栏升级、底栏发图）；
 * 3. 「进阶玩法」由用户按需点击翻看，讲清酒馆深度玩法入口（酒馆助手提示词查看器、魔法棒收纳瘦身、副 API 与 AI 改预设、多封面随机与无损换开场白、授权主题与安全模式）；
 * 4. 任何时候都可在「伴侣设置中心」右上角点击「上手导览」或输入 /stmate guide 重新打开。
 */

import { createIconNode } from '../core/icons.js?v=0.9.4';

const GUIDE_TABS = Object.freeze([
  { id: 'quick', label: '快速上手', icon: 'zap' },
  { id: 'advanced', label: '进阶玩法', icon: 'spark' },
]);

const GUIDE_SECTIONS = Object.freeze({
  quick: {
    leadIcon: 'zap',
    leadText:
      '已为你保留原版顶栏美化，底层防卡防烫引擎已在后台静默开启。所有模块随时可单独开关、一键退回原版。',
    items: [
      {
        icon: 'typography',
        title: '点顶栏「T」（伴侣顶栏「Aa」），随手调排版、背景与重点字',
        desc: '实时调字号、边距、首行缩进、行距与无框书页；一键把当前角色立绘设为背景并调亮度清晰度；还能给对话和内心换配色、加荧光笔或虚线重点，内置多套「经典搭配」直接套用。',
      },
      {
        icon: 'upload',
        title: '书架页「万能混传」一键导入',
        desc: '点角色书架右上角导入图标（或输入 /stmate import），把角色卡、预设、世界书、正则、主题全选一起拖进去，自动识别分流归位。',
      },
      {
        icon: 'sliders',
        title: '点你熟悉的原版顶栏，核心面板已全部升级',
        desc: '预设与 API 彻底解绑（常用模型可加星收藏、支持角色⇄预设双向绑定）；世界书用蓝绿灯标清真生效状态；人设馆自带 4 张新手体验头像，上手零门槛。',
      },
      {
        icon: 'image',
        title: '输入框右下角直接发图与表情包',
        desc: '聊天输入框右下角已放好低调图片图标，选图或贴表情包自动开启识图并智能压缩，防手机大图触发反代报错。',
      },
    ],
  },
  advanced: {
    leadIcon: 'spark',
    leadText:
      '玩熟日常对话后，这些藏在酒馆与伴侣里的实用入口，能让排查问题、学写预设和长线 RP 更顺手。',
    items: [
      {
        icon: 'search',
        title: '想看清 AI 这轮到底收到了什么？用「提示词查看器」',
        desc: '点顶栏拼图（扩展）→「酒馆助手」即可开启「提示词查看器」（也可在单条消息菜单里点开），按真实发送顺序逐条查看预设、世界书触发情况与 Token 占用——查世界书生没生效、自己学改预设都很直观。',
      },
      {
        icon: 'fold',
        title: '顶栏、魔法棒与扩展页清爽瘦身',
        desc: '打开「伴侣设置 → 界面整理与低频收纳」，把平时不点但需后台运行的扩展从魔法棒、顶栏或扩展列表里折叠藏起（仅藏入口，绝不停用插件功能）。',
      },
      {
        icon: 'edit',
        title: '副 API 通道 ＋ AI 伴侣助手帮你改预设',
        desc: '在 API 工作台可单独指定轻量小模型作为副通道（不碰主模型与聊天）；点预设馆「伴侣助手」，直接说话就能改词条、排冲突，或生成随预设携带的小剧场美化正则（改前改后对比勾选 ＋ 10 步撤销）。',
      },
      {
        icon: 'idcard',
        title: '单卡多封面随机轮换 ＋ 第 1 楼无损切开场白',
        desc: '在角色档案点封面可上传多张角色美图并开启「回首页随机轮换」；多开场白长卡在第 1 楼直接点档案里的开场白胶囊，免删档一键切换。',
      },
      {
        icon: 'palette',
        title: '内置授权美化《观月札记》、长线记忆与安全模式',
        desc: '在「伴侣设置 → 原生与设置」可一键启用 WWW 老师正版授权的《观月札记》日/夜双模美化；想开启「伴侣顶栏 / 叙事记忆 / 重Roll助手」也在设置中心自由开关；遇冲突时网址加 ?stm_safe=1 即可安全进场。',
      },
    ],
  },
});

export function createWelcomeGuide({
  store,
  isSafeMode = () => false,
  hasBlockingModal = () => false,
  onOpenSettings = null,
  onOpenStateChange = null,
} = {}) {
  let dialogEl = null;
  let bodyEl = null;
  let tabBarEl = null;
  let activeTab = 'quick';
  let autoTimer = 0;
  let scheduled = false;

  function el(tag, className = '', text = '') {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function isOpen() {
    return Boolean(dialogEl && (dialogEl.open || dialogEl.hasAttribute?.('open')));
  }

  function markDismissed() {
    const current = store?.get?.();
    if (current && !current.welcomeGuideDismissed) {
      store.update({ welcomeGuideDismissed: true }, { silent: true });
    }
  }

  function close({ persistDismiss = true } = {}) {
    if (persistDismiss) {
      markDismissed();
    }
    const wasOpen = isOpen();
    if (dialogEl?.open) {
      try {
        dialogEl.close();
      } catch {
        dialogEl.removeAttribute('open');
      }
    } else if (dialogEl) {
      dialogEl.removeAttribute('open');
    }
    if (wasOpen) {
      onOpenStateChange?.(false);
    }
  }

  function renderTabsAndBody() {
    const doc = globalThis.document;
    if (!doc || !tabBarEl || !bodyEl) return;

    tabBarEl.replaceChildren();
    for (const tab of GUIDE_TABS) {
      const isCur = activeTab === tab.id;
      const btn = el('button', `stm-guide-tab-btn${isCur ? ' is-active' : ''}`);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', isCur ? 'true' : 'false');
      btn.dataset.guideTab = tab.id;
      btn.append(
        createIconNode(doc, tab.icon, 'stm-guide-tab-svg'),
        el('span', '', tab.label),
      );
      btn.addEventListener('click', () => {
        if (activeTab === tab.id) return;
        activeTab = tab.id;
        renderTabsAndBody();
        if (bodyEl) bodyEl.scrollTop = 0;
      });
      tabBarEl.append(btn);
    }

    const section = GUIDE_SECTIONS[activeTab] || GUIDE_SECTIONS.quick;
    bodyEl.replaceChildren();

    const lead = el('div', 'stm-guide-lead');
    lead.append(
      createIconNode(doc, section.leadIcon, 'stm-guide-lead-icon'),
      el('p', 'stm-guide-lead-text', section.leadText),
    );
    bodyEl.append(lead);

    const list = el('div', 'stm-guide-list');
    for (const item of section.items) {
      const card = el('div', 'stm-guide-item');
      const iconBox = el('div', 'stm-guide-item-icon');
      iconBox.append(createIconNode(doc, item.icon, 'stm-guide-svg'));
      const copy = el('div', 'stm-guide-item-copy');
      copy.append(
        el('strong', 'stm-guide-item-title', item.title),
        el('p', 'stm-guide-item-desc', item.desc),
      );
      card.append(iconBox, copy);
      list.append(card);
    }
    bodyEl.append(list);
  }

  function ensureDialog() {
    const doc = globalThis.document;
    if (!doc) return null;
    if (dialogEl?.isConnected) return dialogEl;

    dialogEl = doc.getElementById('stm-welcome-guide') || el('dialog', 'stm-dialog stm-guide-dialog');
    dialogEl.id = 'stm-welcome-guide';
    dialogEl.replaceChildren();

    const header = el('header', 'stm-dialog-header stm-guide-header');
    const titleWrap = el('div', 'stm-dialog-title-wrap');
    titleWrap.append(
      el('h2', 'stm-dialog-title', '欢迎使用 SillyTavern 伴侣'),
      el('span', 'stm-dialog-badge', '使用导览'),
    );

    const closeBtn = el('button', 'stm-dialog-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = '关闭导览（不再弹出）';
    closeBtn.setAttribute('aria-label', '关闭使用导览');
    closeBtn.addEventListener('click', () => close({ persistDismiss: true }));

    header.append(titleWrap, closeBtn);

    tabBarEl = el('div', 'stm-guide-tabs');
    tabBarEl.setAttribute('role', 'tablist');

    bodyEl = el('div', 'stm-dialog-body stm-guide-body');

    const footer = el('footer', 'stm-guide-footer');
    const settingsBtn = el('button', 'stm-pill-btn stm-guide-secondary-btn', '去伴侣设置看看');
    settingsBtn.type = 'button';
    settingsBtn.addEventListener('click', () => {
      close({ persistDismiss: true });
      onOpenSettings?.();
    });

    const startBtn = el('button', 'stm-guide-primary-btn', '知道了，开始用');
    startBtn.type = 'button';
    startBtn.addEventListener('click', () => close({ persistDismiss: true }));

    footer.append(settingsBtn, startBtn);
    dialogEl.append(header, tabBarEl, bodyEl, footer);

    renderTabsAndBody();

    dialogEl.addEventListener('click', event => {
      if (event.target === dialogEl) {
        close({ persistDismiss: true });
      }
    });
    dialogEl.addEventListener('cancel', () => {
      markDismissed();
      onOpenStateChange?.(false);
    });

    doc.body.append(dialogEl);
    return dialogEl;
  }

  function open(initialTab = 'quick') {
    activeTab = initialTab === 'advanced' ? 'advanced' : 'quick';
    const dlg = ensureDialog();
    if (!dlg) return;
    renderTabsAndBody();
    if (bodyEl) bodyEl.scrollTop = 0;
    if (!isOpen()) {
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute('open', '');
      }
      onOpenStateChange?.(true);
    }
  }

  function maybeOpenOnFirstBoot(delayMs = 950) {
    if (scheduled || isOpen()) return;
    const current = store?.get?.();
    if (!current || !current.shellEnabled || current.welcomeGuideDismissed) return;
    if (isSafeMode?.()) return;
    scheduled = true;
    autoTimer = globalThis.setTimeout(() => {
      autoTimer = 0;
      const latest = store?.get?.();
      if (!latest || !latest.shellEnabled || latest.welcomeGuideDismissed) return;
      if (isSafeMode?.() || hasBlockingModal?.()) return;
      open('quick');
    }, delayMs);
  }

  function destroy() {
    if (autoTimer) {
      globalThis.clearTimeout(autoTimer);
      autoTimer = 0;
    }
    scheduled = false;
    close({ persistDismiss: false });
    dialogEl?.remove();
    dialogEl = null;
    bodyEl = null;
    tabBarEl = null;
  }

  return {
    isOpen,
    open,
    close,
    maybeOpenOnFirstBoot,
    destroy,
  };
}
