/**
 * ST伴侣 (st-mate) · 首页净空接管与书架工具栏无损融合控制器
 * - 当玩家处于酒馆首页且书架开启时：自动隐藏顶栏与底栏输入区（stm-home-cloak），让 3:4 画册书架纯净铺满视口；
 * - 在书架首行右侧（原「原版首页」按钮旁）无损并排嵌入极简细线「设置」与「原生酒馆」，
 *   一键即可切回完整原生酒馆，且在原生态下同样保留一键切回「ST伴侣」按钮；
 * - 性能铁律：仅监听 #chat 直接子节点（严禁 subtree:true 监听流式正文），不广播全局 resize 事件。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.9.17';
import {
  isQuietRoomActive,
  isQuietRoomSidebarOpen,
  toggleQuietRoomSidebar,
} from '../core/compat-bridges.js?v=0.9.17';
import { svgMarkup } from '../core/icons.js?v=0.9.17';

/**
 * 识别酒馆删除角色卡、群聊或最后一份存档后塞入的 `SAFETY_CHAT` 安全占位页
 *（"你删除了一个角色或聊天，出于安全原因返回了这里。选个新角色吧！"），
 * 严格排除用户主动开启的「临时助手对话」（其 `extra.uses_system_ui === true`）。
 */
export function isSafetyPlaceholderChat(ctx) {
  if (!ctx || hasActiveChatSelection(ctx)) return false;
  if (!Array.isArray(ctx.chat) || ctx.chat.length !== 1) return false;
  const m0 = ctx.chat[0];
  if (!m0 || !m0.is_system || m0.is_user || m0.extra?.uses_system_ui) return false;
  return (
    m0.name === 'SillyTavern System' ||
    String(m0.force_avatar || '').includes('five.png')
  );
}

/**
 * 自动跳过酒馆原生删卡/删档后的 `SAFETY_CHAT` 死胡同页面，直接重建 `.welcomePanel` 令书架首页无缝接回，
 * 同时清空宿主遗留的 `name2 = 'Assistant'` 假临时聊天态（防下一次删卡误弹临时聊天警告）。
 */
export async function recoverHomeFromSafetyChat({
  getContext,
  doc = globalThis.document,
  welcomeModule = null,
  coreModule = null,
} = {}) {
  if (globalThis.__yantaiSafetyRecoverPromise) {
    await globalThis.__yantaiSafetyRecoverPromise.catch(() => {});
    return true;
  }

  const ctx = getContext?.();
  if (!isSafetyPlaceholderChat(ctx)) {
    return false;
  }

  ctx.chat.splice(0, ctx.chat.length);
  const chatEl = doc?.getElementById?.('chat');
  if (chatEl?.children) {
    for (const child of [...chatEl.children]) {
      if (child?.classList?.contains?.('mes')) {
        child.remove?.();
      }
    }
  }

  const resolveHostModule = async relPath => {
    const base = doc?.baseURI || globalThis.location?.href || '';
    if (!base || !/^https?:\/\//i.test(base)) return null;
    try {
      return await import(new URL(relPath, base).href);
    } catch {
      return null;
    }
  };

  const task = (async () => {
    const [coreMod, welMod] = await Promise.all([
      coreModule || resolveHostModule('script.js'),
      welcomeModule || resolveHostModule('scripts/welcome-screen.js'),
    ]);
    coreMod?.setCharacterName?.('');
    if (typeof welMod?.openWelcomeScreen === 'function' && !hasActiveChatSelection(getContext?.())) {
      await welMod.openWelcomeScreen({ force: true });
    }
    return true;
  })();

  globalThis.__yantaiSafetyRecoverPromise = task;
  try {
    return await task;
  } finally {
    if (globalThis.__yantaiSafetyRecoverPromise === task) {
      delete globalThis.__yantaiSafetyRecoverPromise;
    }
  }
}

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

  function findHomeBookshelfRoot(doc) {
    const chatEl = doc?.getElementById?.('chat');
    if (chatEl?.children) {
      const direct = [...chatEl.children].find(c => c?.classList?.contains?.('jd-bookshelf'));
      if (direct) return direct;
    }
    return doc?.querySelector?.('#chat > .jd-bookshelf') || null;
  }

  function enhanceBookshelfToolbar() {
    const doc = globalThis.document;
    if (!doc) return;

    const shelfRoot = findHomeBookshelfRoot(doc);
    if (!shelfRoot) return;

    const shelfKids = shelfRoot.children ? [...shelfRoot.children] : [];
    const shelfToolbar =
      shelfKids.find(c => c?.classList?.contains?.('jd-shelf-toolbar')) ||
      shelfRoot.querySelector?.('.jd-shelf-toolbar');
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
      if (typeof nativeHomeBtn.before === 'function') {
        nativeHomeBtn.before(actionWrap);
      } else {
        nativeHomeBtn.parentNode?.insertBefore?.(actionWrap, nativeHomeBtn);
      }
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

    const curSettings = store.get();
    const shellEnabled = Boolean(curSettings.shellEnabled);
    const showQrHomeSideBtn = Boolean(
      shellEnabled &&
        curSettings.topbarMode !== 'native' &&
        isQuietRoomActive(doc),
    );
    let qrSideBtn = actionWrap.querySelector('.stm-shelf-qr-btn');
    if (showQrHomeSideBtn) {
      if (!qrSideBtn) {
        qrSideBtn = doc.createElement('button');
        qrSideBtn.type = 'button';
        qrSideBtn.className = 'jd-tab stm-shelf-qr-btn stm-shelf-icon-only';
        qrSideBtn.innerHTML = `<span class="stm-shelf-btn-icon" aria-hidden="true">${svgMarkup('heart')}</span>`;
        qrSideBtn.title = '展开 / 收起博客小站侧边栏';
        qrSideBtn.setAttribute('aria-label', '展开 / 收起博客小站侧边栏');
        qrSideBtn.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          toggleQuietRoomSidebar(doc);
          schedule();
        });
        actionWrap.prepend(qrSideBtn);
      }
      const qrOpen = isQuietRoomSidebarOpen(doc);
      qrSideBtn.classList.toggle('is-active', qrOpen);
      qrSideBtn.setAttribute('aria-pressed', String(qrOpen));
    } else if (qrSideBtn) {
      qrSideBtn.remove();
    }

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
    const shelfInfo =
      shelfKids.find(c => c?.classList?.contains?.('jd-shelf-info')) ||
      shelfRoot.querySelector?.('.jd-shelf-info');
    const infoKids = shelfInfo?.children ? [...shelfInfo.children] : [];
    const refreshBtn =
      infoKids.find(
        btn =>
          btn?.classList?.contains?.('jd-text-button') &&
          (originalLabels.has(btn) || (btn.textContent || '').includes('刷新')),
      ) || null;

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

    // 同步升级左侧导入按钮提示文案：开启伴侣时提示支持角色卡/预设/主题/世界书/正则万能混传分流
    const addCharBtn =
      infoKids.find(btn => btn?.classList?.contains?.('jd-add-character')) ||
      shelfInfo?.querySelector?.('.jd-add-character') ||
      null;
    if (addCharBtn) {
      if (!originalLabels.has(addCharBtn)) {
        originalLabels.set(addCharBtn, addCharBtn.title || '从文件导入角色卡');
      }
      if (addCharBtn.dataset.stmMode !== modeTag) {
        addCharBtn.dataset.stmMode = modeTag;
        const nextTip = shellEnabled
          ? '万能导入：支持多选混传角色卡 / 预设 / 美化主题 / 世界书 / 正则脚本（自动识别分流）'
          : originalLabels.get(addCharBtn) || '从文件导入角色卡';
        addCharBtn.title = nextTip;
        addCharBtn.setAttribute('aria-label', nextTip);
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
    const ctx = getContext?.();

    // 当开启伴侣书架时，若酒馆刚因删角色/删档落入 SAFETY_CHAT 死胡同页，立即无感拉回欢迎页挂载书架
    if (
      settings.shellEnabled &&
      settings.modules?.bookshelf !== false &&
      !doc.querySelector('#chat .welcomePanel') &&
      isSafetyPlaceholderChat(ctx)
    ) {
      void recoverHomeFromSafetyChat({ getContext, doc }).then(() => {
        schedule();
      });
    }

    const shouldCloak = Boolean(settings.shellEnabled && isBookshelfMountedOnHome());
    const shouldHideComposer = Boolean(shouldCloak && settings.hideHomeComposer !== false);
    const shouldShowComposer = Boolean(shouldCloak && settings.hideHomeComposer === false);

    if (cloaked !== shouldCloak) {
      cloaked = shouldCloak;
      doc.body.classList.toggle('stm-home-cloak', shouldCloak);
    } else if (doc.body.classList.contains('stm-home-cloak') !== shouldCloak) {
      doc.body.classList.toggle('stm-home-cloak', shouldCloak);
    }
    doc.body.classList.toggle('stm-hide-home-composer', shouldHideComposer);
    doc.body.classList.toggle('stm-show-home-composer', shouldShowComposer);

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

    const shelfRoot = findHomeBookshelfRoot(doc);
    const actionWrap =
      shelfRoot?.querySelector?.('.stm-shelf-actions') ||
      doc.querySelector('#chat > .jd-bookshelf .stm-shelf-actions');
    if (actionWrap) {
      const nativeHomeBtn = actionWrap.querySelector('.jd-native-home');
      if (nativeHomeBtn) {
        nativeHomeBtn.textContent = originalLabels.get(nativeHomeBtn) || '原版首页';
        nativeHomeBtn.classList.remove('stm-shelf-icon-only');
        nativeHomeBtn.title = '';
        nativeHomeBtn.removeAttribute('aria-label');
        if (typeof actionWrap.before === 'function') {
          actionWrap.before(nativeHomeBtn);
        } else {
          actionWrap.parentNode?.insertBefore?.(nativeHomeBtn, actionWrap);
        }
      }
      actionWrap.remove();
    }

    const shelfInfo =
      (shelfRoot?.children ? [...shelfRoot.children] : []).find(c =>
        c?.classList?.contains?.('jd-shelf-info'),
      ) || shelfRoot?.querySelector?.('.jd-shelf-info');
    const infoKids = shelfInfo?.children ? [...shelfInfo.children] : [];

    for (const btn of infoKids.filter(n => n?.classList?.contains?.('jd-text-button'))) {
      if (originalLabels.has(btn)) {
        btn.textContent = originalLabels.get(btn) || '刷新 ↻';
        btn.classList.remove('stm-shelf-icon-only');
        btn.title = '';
        btn.removeAttribute('aria-label');
        delete btn.dataset.stmMode;
      }
    }

    for (const addBtn of infoKids.filter(n => n?.classList?.contains?.('jd-add-character'))) {
      if (originalLabels.has(addBtn)) {
        const origTip = originalLabels.get(addBtn) || '从文件导入角色卡';
        addBtn.title = origTip;
        addBtn.setAttribute('aria-label', origTip);
        delete addBtn.dataset.stmMode;
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
    globalThis.document?.body.classList.remove(
      'stm-home-cloak',
      'stm-hide-home-composer',
      'stm-show-home-composer',
    );
    restoreBookshelfDom();
  }

  return {
    isHomeCloaked: () => cloaked,
    refresh,
    schedule,
    destroy,
  };
}
