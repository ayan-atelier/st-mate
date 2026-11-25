/**
 * SillyTavern 伴侣 (st-mate) · 首次使用轻导览卡片 (#stm-welcome-guide)
 * 设计理念：
 * 1. 新用户首次装好刷新后仅轻柔弹出一次，点右上角 ×、遮罩、ESC 或「知道了，开始用」立即永久关闭，绝不反复打扰；
 * 2. 一屏讲清最容易错过的 4 个核心入口（万能混传、原版顶栏已升级、底栏发图、伴侣设置自由探索），不搞多步强制教学；
 * 3. 任何时候都可在「伴侣设置中心」右上角点击「上手导览」或输入 /stmate guide 重新打开。
 */

import { createIconNode } from '../core/icons.js?v=0.9.3';

const GUIDE_ITEMS = Object.freeze([
  {
    icon: 'upload',
    title: '书架页「万能混传」一键导入',
    desc: '点角色书架右上角导入图标（或输入 /stmate import），把角色卡、预设、世界书、正则、主题全选一起拖进去，自动识别分流归位。',
  },
  {
    icon: 'sliders',
    title: '点你熟悉的原版顶栏，核心面板已全部升级',
    desc: '预设 ＆ API 彻底解绑（支持常用模型收藏、角色⇄预设双向绑定、AI 伴侣帮你改预设）；世界书蓝绿灯防假生效；角色卡支持多张封面随机轮换，人设馆自带新手体验头像。',
  },
  {
    icon: 'image',
    title: '输入框右下角直接发图与表情包',
    desc: '聊天输入框右下角已悄悄放好低调图片图标，选图或贴表情包自动开启识图并智能压缩，防手机大图触发反代报错。',
  },
  {
    icon: 'spark',
    title: '更多顺手玩法，留给你按需开启',
    desc: '想试试更极简的「伴侣顶栏」、轻触正文全屏看文，或开启「叙事记忆 / 重Roll助手」？随时点左下角进入伴侣设置自由开关。',
  },
]);

export function createWelcomeGuide({
  store,
  isSafeMode = () => false,
  hasBlockingModal = () => false,
  onOpenSettings = null,
  onOpenStateChange = null,
} = {}) {
  let dialogEl = null;
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
      el('span', 'stm-dialog-badge', '快速上手'),
    );

    const closeBtn = el('button', 'stm-dialog-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = '关闭导览（不再弹出）';
    closeBtn.setAttribute('aria-label', '关闭快速上手导览');
    closeBtn.addEventListener('click', () => close({ persistDismiss: true }));

    header.append(titleWrap, closeBtn);

    const body = el('div', 'stm-dialog-body stm-guide-body');

    const lead = el('div', 'stm-guide-lead');
    lead.append(
      createIconNode(doc, 'zap', 'stm-guide-lead-icon'),
      el(
        'p',
        'stm-guide-lead-text',
        '已为你保留原版顶栏美化，底层防卡防烫引擎已在后台静默开启。所有模块随时可单独开关、一键退回原版。',
      ),
    );
    body.append(lead);

    const list = el('div', 'stm-guide-list');
    for (const item of GUIDE_ITEMS) {
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
    body.append(list);

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
    dialogEl.append(header, body, footer);

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

  function open() {
    const dlg = ensureDialog();
    if (!dlg) return;
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
      open();
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
  }

  return {
    isOpen,
    open,
    close,
    maybeOpenOnFirstBoot,
    destroy,
  };
}
