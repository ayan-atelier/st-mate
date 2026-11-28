/**
 * SillyTavern 伴侣 (st-mate) · 首次使用与进阶玩法双页签导览卡片 (#stm-welcome-guide)
 * 设计理念：
 * 1. 新用户首次装好刷新后仅轻柔弹出一次，点右上角 ×、遮罩、ESC 或「知道了，开始用」立即永久关闭，绝不反复打扰；
 * 2. 「快速上手」首行双卡并排交代最关键的交互坐标（左下角「☰」三横菜单、段落右下角「···」操作栏），随后依次展示排版与对话样式、书架万能混传与底栏发表情包/图片；
 * 3. 「进阶玩法」按从日常顺手到深度排查的顺序梳理五大玩法：低频按钮隐藏（不关停）、独立副 API 全套共用、记忆增强系统、角色卡多封面轮换、魔法棒提示词查看器；
 * 4. 任何时候都可在「伴侣设置中心」右上角点击「上手导览」或输入 /stmate guide 重新打开。
 */

import { createIconNode } from '../core/icons.js?v=0.9.20';

const GUIDE_TABS = Object.freeze([
  { id: 'quick', label: '快速上手', icon: 'zap' },
  { id: 'advanced', label: '进阶玩法', icon: 'spark' },
]);

const GUIDE_SECTIONS = Object.freeze({
  quick: {
    leadIcon: 'zap',
    leadText:
      '底层加速与防卡防烫引擎已静默开启，并完整保留原版顶栏美化。所有模块随时可单独开关，或一键无损退回原版。',
    pair: [
      {
        icon: 'bars',
        title: '左下角「☰」三横菜单',
        desc: '退出回书架、保存、存档管理、重写与续写都在输入框左侧三横里。',
      },
      {
        icon: 'more',
        title: '段落右下角操作栏',
        desc: '每段对话右下角可编辑、复制；点「···」可开新分支、保存或隐藏。',
      },
    ],
    items: [
      {
        icon: 'typography',
        title: '点顶栏「T」（简化顶栏「Aa」），随手调排版、背景与对话样式',
        desc: '实时调字号、页宽、首行缩进、行距与无框书页；一键把当前角色立绘设为背景并调亮度清晰度；还能给对话和内心换配色、加荧光笔或虚线重点，内置多套「经典搭配」直接套用。',
      },
      {
        icon: 'upload',
        title: '书架首页点导入图标，整套资源万能混传',
        desc: '点角色书架顶部导入图标（或输入 /stmate import），把角色卡、预设、世界书、正则、美化主题全选一起拖进去，自动识别分流归位。',
      },
      {
        icon: 'image',
        title: '输入框右下角直接给角色发表情包与图片',
        desc: '点聊天输入框右下角低调图片图标（或直接粘贴表情包），自动开启识图并智能压图，防手机大图触发反代报错。',
      },
    ],
  },
  advanced: {
    leadIcon: 'spark',
    leadText:
      '玩熟日常对话后，这些伴侣与酒馆进阶功能，能让界面收纳、副模型省钱提速、长线记忆与排查问题都更顺手。',
    pair: null,
    items: [
      {
        icon: 'fold',
        title: '顶栏、三横与魔法棒低频按钮隐藏（隐藏但不关停）',
        desc: '打开「伴侣设置 → 界面整理与低频收纳」，把低频插件入口折叠藏起，需要时点击展开查看；仅隐藏入口，绝不关停插件后台功能。',
      },
      {
        icon: 'plug',
        title: '独立「副 API」一处配好、全套共用',
        desc: '在 API 工作台可单独指定轻量高速副 API（绝不碰主线模型与聊天）；改预设、写人设、整理剧情记忆都能共用这一条副通道，省钱又省心。',
      },
      {
        icon: 'memory',
        title: '记忆增强系统（平时无感 · 每 3 轮自动归档）',
        desc: '默认关闭零打扰，在伴侣设置开启后平时后台无感运行；每 3 轮自动总结剧情并生成独立世界书，长对话不忘设定，随时可点开查看与微调。',
      },
      {
        icon: 'idcard',
        title: '角色卡多封面图库与随机轮换',
        desc: '在角色档案点封面上传多张心仪立绘，开启「回首页随机轮换」，每次回到书架都能解锁不同的角色封面。',
      },
      {
        icon: 'search',
        title: '查看每轮发给 AI 的完整内容（魔法棒 → 提示词查看器）',
        desc: '点输入框左侧魔法棒打开「提示词查看器」（也可在扩展「酒馆助手」或单条消息菜单里打开），每轮发给 AI 的预设、世界书触发与 Token 占用一目了然。',
      },
    ],
  },
});

export function createWelcomeGuide({
  store,
  isSafeMode = () => false,
  hasBlockingModal = () => false,
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

  function buildItemCard(doc, item, { compact = false } = {}) {
    const card = el('div', compact ? 'stm-guide-item is-compact-pair' : 'stm-guide-item');
    if (compact) {
      const head = el('div', 'stm-guide-pair-head');
      const iconBox = el('div', 'stm-guide-item-icon is-mini');
      iconBox.append(createIconNode(doc, item.icon, 'stm-guide-svg'));
      head.append(iconBox, el('strong', 'stm-guide-item-title', item.title));
      card.append(head, el('p', 'stm-guide-item-desc', item.desc));
      return card;
    }
    const iconBox = el('div', 'stm-guide-item-icon');
    iconBox.append(createIconNode(doc, item.icon, 'stm-guide-svg'));
    const copy = el('div', 'stm-guide-item-copy');
    copy.append(
      el('strong', 'stm-guide-item-title', item.title),
      el('p', 'stm-guide-item-desc', item.desc),
    );
    card.append(iconBox, copy);
    return card;
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

    if (Array.isArray(section.pair) && section.pair.length > 0) {
      const pairGrid = el('div', 'stm-guide-pair');
      for (const pairItem of section.pair) {
        pairGrid.append(buildItemCard(doc, pairItem, { compact: true }));
      }
      bodyEl.append(pairGrid);
    }

    const list = el('div', 'stm-guide-list');
    for (const item of section.items) {
      list.append(buildItemCard(doc, item));
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
    const startBtn = el('button', 'stm-guide-primary-btn', '知道了，开始用');
    startBtn.type = 'button';
    startBtn.addEventListener('click', () => close({ persistDismiss: true }));

    footer.append(startBtn);
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
