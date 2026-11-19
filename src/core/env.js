/**
 * ST伴侣 (st-mate) · 宿主环境与多端能力探测层
 * 兼容范围：SillyTavern 1.12 ~ 1.19+ · 桌面浏览器 · 手机局域网浏览器 · TauriTavern (TT) · iOS Safari
 */

export function getHostContext(root = globalThis) {
  try {
    const ctx = root?.SillyTavern?.getContext?.();
    return ctx && typeof ctx === 'object' ? ctx : null;
  } catch {
    return null;
  }
}

export function detectPlatform(root = globalThis) {
  const nav = root?.navigator || {};
  const ua = String(nav.userAgent || '');
  const platform = String(nav.platform || '');
  const maxTouchPoints = Number(nav.maxTouchPoints || 0);

  const isTauri = Boolean(
    root?.__TAURI__ ||
    root?.__TAURI_INTERNALS__ ||
    root?.__TAURI_IPC__ ||
    /Tauri/i.test(ua),
  );

  const isIOS = Boolean(
    /iPad|iPhone|iPod/i.test(ua) ||
    (platform === 'MacIntel' && maxTouchPoints > 1) ||
    root?.CSS?.supports?.('-webkit-touch-callout', 'none'),
  );

  const isAndroid = /Android/i.test(ua);
  const width = Number(root?.innerWidth || 1024);
  const isNarrowViewport = width > 0 && width <= 768;

  return {
    isTauri,
    isIOS,
    isAndroid,
    isMobile: isIOS || isAndroid || isNarrowViewport,
    isNarrowViewport,
    userAgent: ua,
  };
}

export function hasActiveChatSelection(ctx) {
  if (!ctx || typeof ctx !== 'object') return false;
  const hasChar = ctx.characterId !== undefined && ctx.characterId !== null && ctx.characterId !== '';
  const hasGroup = ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '';
  return hasChar || hasGroup;
}

/**
 * TauriTavern / 移动端 WebView 首帧保护调度器：
 * 让出主线程首屏绘制帧后再执行重挂载，避免开机白屏或卡顿。
 */
export function scheduleIdleBoot(task, root = globalThis) {
  let cancelled = false;
  let rafId = 0;
  let timerId = 0;

  const run = () => {
    if (cancelled) return;
    task();
  };

  if (typeof root?.requestAnimationFrame === 'function') {
    rafId = root.requestAnimationFrame(() => {
      timerId = root.setTimeout(run, 0);
    });
  } else {
    timerId = setTimeout(run, 0);
  }

  return () => {
    cancelled = true;
    if (rafId && typeof root?.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(rafId);
    }
    if (timerId) {
      clearTimeout(timerId);
    }
  };
}

/**
 * TauriTavern 刘海屏双层安全区去重护栏：
 * 仅在 `isTauri`（或 iOS 全屏壳 standalone）下执行探测，普通浏览器零开销直接跳过。
 * 若实测 WebView 内 `env(safe-area-inset-top)` > 0 且外层原生容器已将视口顶边下移 (> 16px)，
 * 则在 `documentElement` 覆写 `--stm-safe-top: 0px` 消除双层状态栏黑边。
 */
export function syncTauriSafeAreaGuard(root = globalThis) {
  const platform = detectPlatform(root);
  const isStandaloneShell = Boolean(platform.isIOS && root?.navigator?.standalone === true);
  if (!platform.isTauri && !isStandaloneShell) {
    return { applied: false, safeTop: 0, hostOffsetTop: 0 };
  }

  const doc = root?.document;
  const docEl = doc?.documentElement;
  if (!doc?.body || !docEl) {
    return { applied: false, safeTop: 0, hostOffsetTop: 0 };
  }

  const probe = doc.createElement('div');
  probe.className = 'stm-safe-area-probe';
  probe.setAttribute('aria-hidden', 'true');
  if (probe.style) {
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top, 0px);visibility:hidden;pointer-events:none;z-index:-1;';
  }
  doc.body.appendChild(probe);

  let safeTop = 0;
  try {
    const computed = root?.getComputedStyle?.(probe);
    safeTop = Number.parseFloat(computed?.paddingTop || '0') || 0;
  } finally {
    probe.remove?.();
  }

  const screenTopVal = Number(root?.screenTop ?? root?.screenY ?? 0) || 0;
  const vvOffsetTop = Number(root?.visualViewport?.offsetTop ?? 0) || 0;
  const docRectTop = Number(docEl.getBoundingClientRect?.()?.top ?? 0) || 0;
  const hostOffsetTop = Math.max(screenTopVal, vvOffsetTop, docRectTop);

  if (safeTop > 0 && hostOffsetTop > 16) {
    docEl.style?.setProperty?.('--stm-safe-top', '0px');
    if (docEl.dataset) {
      docEl.dataset.stmSafeTopGuarded = '1';
    }
    return { applied: true, safeTop, hostOffsetTop };
  }

  if (docEl.dataset?.stmSafeTopGuarded === '1') {
    docEl.style?.removeProperty?.('--stm-safe-top');
    delete docEl.dataset.stmSafeTopGuarded;
  }
  return { applied: false, safeTop, hostOffsetTop };
}

/**
 * 清理 `syncTauriSafeAreaGuard` 写入的内联安全区变量。
 */
export function clearTauriSafeAreaGuard(root = globalThis) {
  const docEl = root?.document?.documentElement;
  if (!docEl) return;
  docEl.style?.removeProperty?.('--stm-safe-top');
  if (docEl.dataset) {
    delete docEl.dataset.stmSafeTopGuarded;
  }
}

/**
 * 仅在 `isTauri` 环境下启用的安卓/移动端侧滑返回手势收起浮层守卫：
 * - 普通桌面浏览器与普通手机浏览器 (`!isTauri`) 100% 零监听、零调用 `history.pushState`；
 * - TT 环境下维护单一布尔锁 `ttOverlayHistoryPushed`，当浮层打开时压入唯一一条守卫历史，
 *   侧滑触发 `popstate` 时优先收起最上层伴侣浮层并消费此次返回，防止误退 TT App。
 */
export function createTauriOverlayBackGuard({
  root = globalThis,
  hasAnyOverlayOpen,
  closeTopmostOverlay,
} = {}) {
  if (!detectPlatform(root).isTauri) {
    return {
      active: false,
      isHistoryPushed: () => false,
      sync() {},
      destroy() {},
    };
  }

  let ttOverlayHistoryPushed = false;
  let destroyed = false;

  function pushGuardStateIfNeeded() {
    if (destroyed || ttOverlayHistoryPushed) return;
    if (typeof hasAnyOverlayOpen === 'function' && hasAnyOverlayOpen()) {
      try {
        root?.history?.pushState?.({ stmOverlayGuard: true }, '');
        ttOverlayHistoryPushed = true;
      } catch {
        // 部分受限沙箱环境静默忽略
      }
    }
  }

  function onPopState() {
    if (destroyed) return;
    ttOverlayHistoryPushed = false;
    const closed = typeof closeTopmostOverlay === 'function' ? Boolean(closeTopmostOverlay()) : false;
    if (closed) {
      pushGuardStateIfNeeded();
    }
  }

  function onOverlayChange() {
    pushGuardStateIfNeeded();
  }

  root?.addEventListener?.('popstate', onPopState);
  root?.addEventListener?.('stm:overlay-change', onOverlayChange);

  return {
    active: true,
    isHistoryPushed: () => ttOverlayHistoryPushed,
    sync: pushGuardStateIfNeeded,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ttOverlayHistoryPushed = false;
      root?.removeEventListener?.('popstate', onPopState);
      root?.removeEventListener?.('stm:overlay-change', onOverlayChange);
    },
  };
}
