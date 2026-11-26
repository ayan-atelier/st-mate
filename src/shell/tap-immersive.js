/**
 * ST伴侣 (st-mate) · 轻触正文空白处「全屏纯享阅读」控制器
 * - 轻点正文普通文字或留白区域 -> 顶栏与底栏输入区 (#form_sheld) 同步平滑隐身；
 * - 再次轻点任意普通位置（或按 Esc） -> 顶栏与底栏同步恢复；
 * - 性能铁律：100% 走 GPU 合成层 translate3d + opacity，不改动 #sheld/#chat 宽高，不派发全局 resize，
 *   确保切换时文字 0 像素跳动、百楼长聊天与前端美化卡片 60fps 零重排！
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.9.7';
import { shouldTogglePureReading } from '../core/tap-guard.js?v=0.9.7';

export function createTapImmersive({ getContext, store, isHomeCloaked, shouldSuppressTap }) {
  let active = false;
  let pointerState = null;
  let composerObserver = null;
  let observedComposer = null;
  let lastComposerHeight = 0;
  const cleanups = [];

  function dismissFloatingMenus(doc) {
    for (const id of ['options', 'extensionsMenu']) {
      const menu = doc.getElementById(id);
      if (menu && menu.style.display !== 'none') {
        menu.style.display = 'none';
      }
    }
  }

  function syncComposerClearance() {
    const doc = globalThis.document;
    if (!doc) return;
    const sheld = doc.getElementById('sheld');
    const formSheld = doc.getElementById('form_sheld');
    if (!sheld || !formSheld) return;

    if (!store.get().shellEnabled || isHomeCloaked?.()) {
      if (lastComposerHeight !== 0) {
        lastComposerHeight = 0;
        sheld.style.removeProperty('--stm-composer-space');
      }
      return;
    }

    const h = Math.round(formSheld.offsetHeight || 0);
    if (h > 0 && Math.abs(h - lastComposerHeight) >= 2) {
      lastComposerHeight = h;
      sheld.style.setProperty('--stm-composer-space', `${h}px`);
    }
  }

  function observeComposer() {
    const doc = globalThis.document;
    const formSheld = doc?.getElementById('form_sheld');
    if (!formSheld || typeof globalThis.ResizeObserver !== 'function') {
      syncComposerClearance();
      return;
    }

    if (observedComposer !== formSheld) {
      composerObserver?.disconnect();
      composerObserver = new globalThis.ResizeObserver(() => {
        syncComposerClearance();
      });
      composerObserver.observe(formSheld);
      observedComposer = formSheld;
    }
    syncComposerClearance();
  }

  function setPureReading(nextValue) {
    const doc = globalThis.document;
    if (!doc) return;
    const normalized = Boolean(nextValue && store.get().shellEnabled && !isHomeCloaked?.());
    if (active === normalized) {
      if (doc.body.classList.contains('stm-pure-reading') !== normalized) {
        doc.body.classList.toggle('stm-pure-reading', normalized);
      }
      return;
    }
    active = normalized;
    if (active) {
      dismissFloatingMenus(doc);
    }
    doc.body.classList.toggle('stm-pure-reading', active);
  }

  function onPointerDown(event) {
    if (event.isPrimary === false) {
      pointerState = null;
      return;
    }
    pointerState = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
      button: event.button ?? 0,
    };
  }

  function onChatClick(event) {
    if (shouldSuppressTap?.()) {
      pointerState = null;
      return;
    }

    const doc = globalThis.document;
    const chatRoot = doc?.getElementById('chat');
    if (!chatRoot) return;

    const ctx = getContext?.();
    if (!hasActiveChatSelection(ctx)) return;

    const now = Date.now();
    const gesture = pointerState
      ? {
          dx: event.clientX - pointerState.x,
          dy: event.clientY - pointerState.y,
          durationMs: Math.max(0, now - pointerState.time),
          button: event.button ?? pointerState.button ?? 0,
        }
      : {
          dx: 0,
          dy: 0,
          durationMs: 80,
          button: event.button ?? 0,
        };
    pointerState = null;

    let selectionText = '';
    try {
      selectionText = String(globalThis.getSelection?.()?.toString?.() || '');
    } catch {
      selectionText = '';
    }

    const ok = shouldTogglePureReading({
      settings: store.get(),
      isHomeView: Boolean(isHomeCloaked?.()),
      target: event.target,
      chatRoot,
      gesture,
      selectionText,
    });

    if (ok) {
      setPureReading(!active);
    }
  }

  function onKeyDown(event) {
    if (active && event.key === 'Escape') {
      setPureReading(false);
    }
  }

  function mount() {
    const doc = globalThis.document;
    if (!doc || cleanups.length > 0) return;

    doc.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    doc.addEventListener('click', onChatClick, false);
    doc.addEventListener('keydown', onKeyDown, false);

    cleanups.push(
      () => doc.removeEventListener('pointerdown', onPointerDown, { capture: true }),
      () => doc.removeEventListener('click', onChatClick, false),
      () => doc.removeEventListener('keydown', onKeyDown, false),
    );
  }

  function refresh() {
    mount();
    observeComposer();
    const current = store.get();
    if (!current.shellEnabled || !current.tapPureReading || isHomeCloaked?.()) {
      setPureReading(false);
    } else if (current.tapPureReadingScope === 'reading' && current.topbarMode !== 'reading') {
      setPureReading(false);
    }
  }

  function destroy() {
    composerObserver?.disconnect();
    composerObserver = null;
    observedComposer = null;
    lastComposerHeight = 0;
    globalThis.document?.getElementById('sheld')?.style.removeProperty('--stm-composer-space');

    while (cleanups.length) {
      const off = cleanups.pop();
      off?.();
    }
    setPureReading(false);
  }

  return {
    isActive: () => active,
    exit: () => setPureReading(false),
    refresh,
    destroy,
  };
}
