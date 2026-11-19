/**
 * ST伴侣 (st-mate) · 首页净空接管与书架工具栏无损融合控制器
 * - 当玩家处于酒馆首页且书架开启时：自动隐藏顶栏与底栏输入区（stm-home-cloak），让 3:4 画册书架纯净铺满视口；
 * - 在书架首行右侧（原「原版首页」按钮旁）无损并排嵌入极简细线「设置」与「原生酒馆」，
 *   一键即可切回完整原生酒馆，且在原生态下同样保留一键切回「ST伴侣」按钮；
 * - 性能铁律：仅监听 #chat 直接子节点（严禁 subtree:true 监听流式正文），不广播全局 resize 事件。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.7.4';
import { svgMarkup } from '../core/icons.js?v=0.7.4';

export function createHomeCloak({ getContext, store, onOpenSettings, onToggleShell }) {
  let bodyObserver = null;
  let chatObserver = null;
  let observedChatEl = null;
  let rafId = 0;
  let cloaked = false;
  const originalLabels = new WeakMap();

  function isBookshelfMountedOnHome() {
    const doc = globalThis.document;
    if (!doc) return false;
    const ctx = getContext?.();
    if (hasActiveChatSelection(ctx)) return false;
    return Boolean(
      doc.body.classList.contains('jd-bookshelf-home-active') ||
      doc.querySelector('#chat > .jd-bookshelf'),
    );
  }

  function enhanceBookshelfToolbar() {
    const doc = globalThis.document;
    if (!doc) return;

    const shelfToolbar = doc.querySelector('#chat > .jd-bookshelf > .jd-shelf-toolbar');
    if (!shelfToolbar) return;

    const nativeHomeBtn = shelfToolbar.querySelector('.jd-native-home');
    if (!nativeHomeBtn) return;

    if (!originalLabels.has(nativeHomeBtn)) {
      originalLabels.set(nativeHomeBtn, nativeHomeBtn.textContent || '原版首页');
    }

    let actionWrap = shelfToolbar.querySelector('.stm-shelf-actions');
    if (!actionWrap) {
      actionWrap = doc.createElement('div');
      actionWrap.className = 'stm-shelf-actions';
      nativeHomeBtn.before(actionWrap);
      actionWrap.append(nativeHomeBtn);
    }

    let mateBtn = actionWrap.querySelector('.stm-shelf-mate-btn');
    if (!mateBtn) {
      mateBtn = doc.createElement('button');
      mateBtn.type = 'button';
      mateBtn.className = 'jd-tab stm-shelf-mate-btn';
      mateBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (store.get().shellEnabled) {
          onOpenSettings?.();
        } else {
          onToggleShell?.(true);
        }
      });
      actionWrap.prepend(mateBtn);
    }

    if (!nativeHomeBtn.dataset.stmHooked) {
      nativeHomeBtn.dataset.stmHooked = '1';
      nativeHomeBtn.addEventListener(
        'click',
        event => {
          if (!store.get().shellEnabled) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          onToggleShell?.(false);
        },
        true,
      );
    }

    const shellEnabled = Boolean(store.get().shellEnabled);
    const modeTag = shellEnabled ? 'active' : 'native';
    if (mateBtn.dataset.stmMode !== modeTag) {
      mateBtn.dataset.stmMode = modeTag;
      if (shellEnabled) {
        mateBtn.innerHTML = `<span class="stm-shelf-btn-icon" aria-hidden="true">${svgMarkup('settings')}</span><span>设置</span>`;
        mateBtn.title = '打开 ST伴侣设置中心（模块开关 / 页面排版 / API面板）';
        nativeHomeBtn.innerHTML = `<span class="stm-shelf-btn-icon" aria-hidden="true">${svgMarkup('tavern')}</span>`;
        nativeHomeBtn.classList.add('stm-shelf-icon-only');
        nativeHomeBtn.title = '切回原生酒馆首页';
        nativeHomeBtn.setAttribute('aria-label', '切回原生酒馆首页');
      } else {
        mateBtn.innerHTML = `<span class="stm-shelf-btn-icon" aria-hidden="true">${svgMarkup('spark')}</span><span>ST伴侣</span>`;
        mateBtn.title = '重新开启 ST伴侣极简沉浸界面';
        nativeHomeBtn.textContent = originalLabels.get(nativeHomeBtn) || '原版首页';
        nativeHomeBtn.classList.remove('stm-shelf-icon-only');
        nativeHomeBtn.title = '';
        nativeHomeBtn.removeAttribute('aria-label');
      }
    }

    // 精简第二行右侧「刷新 ↻」为纯线性刷新图标（与左侧导入图标对称呼应，减少首页文字噪点）
    const shelfRoot = shelfToolbar.parentElement;
    const refreshBtn = shelfRoot
      ? [...shelfRoot.querySelectorAll(':scope > .jd-shelf-info > .jd-text-button')].find(
          btn => originalLabels.has(btn) || (btn.textContent || '').includes('刷新'),
        )
      : null;

    if (refreshBtn) {
      if (!originalLabels.has(refreshBtn)) {
        originalLabels.set(refreshBtn, refreshBtn.textContent || '刷新 ↻');
      }
      if (refreshBtn.dataset.stmMode !== modeTag) {
        refreshBtn.dataset.stmMode = modeTag;
        if (shellEnabled) {
          refreshBtn.innerHTML = `<span class="stm-shelf-btn-icon" aria-hidden="true">${svgMarkup('refresh')}</span>`;
          refreshBtn.classList.add('stm-shelf-icon-only');
          refreshBtn.title = '刷新角色与存档列表';
          refreshBtn.setAttribute('aria-label', '刷新角色与存档列表');
        } else {
          refreshBtn.textContent = originalLabels.get(refreshBtn) || '刷新 ↻';
          refreshBtn.classList.remove('stm-shelf-icon-only');
          refreshBtn.title = '';
          refreshBtn.removeAttribute('aria-label');
        }
      }
    }
  }

  function syncNativeWelcomeShortcut() {
    const doc = globalThis.document;
    if (!doc) return;

    const existing = doc.getElementById('stm-welcome-return-btn');
    const ctx = getContext?.();
    const onNativeWelcome = !hasActiveChatSelection(ctx) && !store.get().shellEnabled;
    const welcome = doc.querySelector('#chat .welcomePanel');
    const shortcuts =
      welcome?.querySelector('.welcomeShortcuts') ||
      welcome?.querySelector('.welcomeHeader') ||
      welcome;

    if (!onNativeWelcome || !shortcuts) {
      existing?.remove();
      return;
    }

    if (!existing) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.id = 'stm-welcome-return-btn';
      btn.className = 'menu_button menu_button_icon stm-welcome-return-btn';
      btn.title = '一键恢复 ST伴侣沉浸界面与书架';
      btn.innerHTML = `<span class="stm-inline-svg" aria-hidden="true">${svgMarkup('spark')}</span><span>回到 ST伴侣</span>`;
      btn.addEventListener('click', () => {
        void onToggleShell?.(true);
      });
      if (shortcuts === welcome) {
        shortcuts.prepend(btn);
      } else {
        shortcuts.append(btn);
      }
    } else if (existing.parentElement !== shortcuts) {
      if (shortcuts === welcome) {
        shortcuts.prepend(existing);
      } else {
        shortcuts.append(existing);
      }
    }
  }

  function reconcile() {
    const doc = globalThis.document;
    if (!doc) return;

    const settings = store.get();
    const shouldCloak = Boolean(settings.shellEnabled && isBookshelfMountedOnHome());

    if (cloaked !== shouldCloak) {
      cloaked = shouldCloak;
      doc.body.classList.toggle('stm-home-cloak', shouldCloak);
    } else if (doc.body.classList.contains('stm-home-cloak') !== shouldCloak) {
      doc.body.classList.toggle('stm-home-cloak', shouldCloak);
    }

    enhanceBookshelfToolbar();
    syncNativeWelcomeShortcut();
  }

  function schedule() {
    if (rafId) return;
    const req = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16));
    rafId = req(() => {
      rafId = 0;
      reconcile();
    });
  }

  function attachObservers() {
    const doc = globalThis.document;
    if (!doc || typeof globalThis.MutationObserver !== 'function') return;

    if (!bodyObserver) {
      bodyObserver = new globalThis.MutationObserver(schedule);
      bodyObserver.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    }

    const chat = doc.getElementById('chat');
    if (chat && observedChatEl !== chat) {
      chatObserver?.disconnect();
      chatObserver = new globalThis.MutationObserver(schedule);
      // 只监听 #chat 直接子节点（.jd-bookshelf / .welcomePanel 挂载与卸载），不设 subtree:true
      chatObserver.observe(chat, { childList: true });
      observedChatEl = chat;
    }
  }

  function restoreBookshelfDom() {
    const doc = globalThis.document;
    if (!doc) return;
    doc.getElementById('stm-welcome-return-btn')?.remove();

    const actionWrap = doc.querySelector('#chat > .jd-bookshelf .stm-shelf-actions');
    if (actionWrap) {
      const nativeHomeBtn = actionWrap.querySelector('.jd-native-home');
      if (nativeHomeBtn) {
        nativeHomeBtn.textContent = originalLabels.get(nativeHomeBtn) || '原版首页';
        nativeHomeBtn.classList.remove('stm-shelf-icon-only');
        nativeHomeBtn.title = '';
        nativeHomeBtn.removeAttribute('aria-label');
        actionWrap.before(nativeHomeBtn);
      }
      actionWrap.remove();
    }

    for (const btn of doc.querySelectorAll('#chat > .jd-bookshelf > .jd-shelf-info > .jd-text-button')) {
      if (originalLabels.has(btn)) {
        btn.textContent = originalLabels.get(btn) || '刷新 ↻';
        btn.classList.remove('stm-shelf-icon-only');
        btn.title = '';
        btn.removeAttribute('aria-label');
        delete btn.dataset.stmMode;
      }
    }
  }

  function refresh() {
    attachObservers();
    reconcile();
  }

  function destroy() {
    if (rafId) {
      if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(rafId);
      } else {
        clearTimeout(rafId);
      }
      rafId = 0;
    }
    bodyObserver?.disconnect();
    chatObserver?.disconnect();
    bodyObserver = null;
    chatObserver = null;
    observedChatEl = null;
    cloaked = false;
    globalThis.document?.body.classList.remove('stm-home-cloak');
    restoreBookshelfDom();
  }

  return {
    isHomeCloaked: () => cloaked,
    refresh,
    schedule,
    destroy,
  };
}
