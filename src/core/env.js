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
