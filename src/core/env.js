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
 * 解析 CSS 颜色字符串为 { r, g, b, a }（支持 transparent / rgb / rgba / CSS4 空格语法 / #hex）。
 */
export function parseCssColorRgba(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hexMatch = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const h = hexMatch[1];
    if (h.length === 3 || h.length === 4) {
      const r = Number.parseInt(h[0] + h[0], 16);
      const g = Number.parseInt(h[1] + h[1], 16);
      const b = Number.parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? Number.parseInt(h[3] + h[3], 16) / 255 : 1;
      return { r, g, b, a };
    }
    const r = Number.parseInt(h.slice(0, 2), 16);
    const g = Number.parseInt(h.slice(2, 4), 16);
    const b = Number.parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const rgbMatch = s.match(
    /^rgba?\(\s*([\d.]+%?)\s*[\s,]\s*([\d.]+%?)\s*[\s,]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/,
  );
  if (rgbMatch) {
    const parseCh = token => {
      if (token.endsWith('%')) {
        return Math.min(255, Math.max(0, Math.round((Number.parseFloat(token) / 100) * 255)));
      }
      return Math.min(255, Math.max(0, Math.round(Number.parseFloat(token))));
    };
    const r = parseCh(rgbMatch[1]);
    const g = parseCh(rgbMatch[2]);
    const b = parseCh(rgbMatch[3]);
    let a = 1;
    if (rgbMatch[4] !== undefined) {
      a = rgbMatch[4].endsWith('%')
        ? Number.parseFloat(rgbMatch[4]) / 100
        : Number.parseFloat(rgbMatch[4]);
      if (!Number.isFinite(a)) a = 1;
      a = Math.min(1, Math.max(0, a));
    }
    if ([r, g, b].every(Number.isFinite)) {
      return { r, g, b, a };
    }
  }
  return null;
}

function probeResolvedCssColor(root, doc, cssValue, cssVarName = '') {
  let raw = '';
  if (doc?.body && typeof doc.createElement === 'function') {
    const probe = doc.createElement('div');
    probe.setAttribute?.('aria-hidden', 'true');
    if (probe.style) {
      probe.style.cssText = `position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;z-index:-1;background-color:${cssValue};`;
    }
    doc.body.appendChild?.(probe);
    try {
      raw = String(root?.getComputedStyle?.(probe)?.backgroundColor || '').trim();
    } finally {
      probe.remove?.();
    }
  }
  if (!raw && cssVarName && doc?.documentElement) {
    raw = String(root?.getComputedStyle?.(doc.documentElement)?.getPropertyValue?.(cssVarName) || '').trim();
  }
  return parseCssColorRgba(raw);
}

/**
 * 伴侣面板防全透明保底护栏：
 * 部分酒馆美化主题把 `--SmartThemeBlurTintColor` 设成全透明或极低透明度（只给原生抽屉单写实色），
 * 导致伴侣的预设馆、Aa 排版抽屉与悬浮菜单透出底下聊天正文难以阅读。
 * 当检测到 `--SmartThemeBlurTintColor` 透明度 < 0.84 时，按「原生已着色抽屉 -> ChatTintColor -> 原色提实 -> 文字明暗实底」
 * 依次采样同色系实底写入 `--stm-surface-override`；主题本身已不透明 (>= 0.84) 时零干预。
 */
export function syncSurfaceOpacityGuard(root = globalThis) {
  const doc = root?.document;
  const docEl = doc?.documentElement;
  if (!doc?.body || !docEl) {
    return { applied: false, alpha: 1, resolved: '' };
  }

  const blurColor = probeResolvedCssColor(
    root,
    doc,
    'var(--SmartThemeBlurTintColor, rgba(24, 24, 28, 0.92))',
    '--SmartThemeBlurTintColor',
  );

  if (!blurColor || blurColor.a >= 0.84) {
    if (docEl.dataset?.stmSurfaceGuarded === '1') {
      docEl.style?.removeProperty?.('--stm-surface-override');
      delete docEl.dataset.stmSurfaceGuarded;
    }
    return { applied: false, alpha: blurColor?.a ?? 1, resolved: '' };
  }

  let picked = null;
  for (const drawerId of ['rm_extensions_block', 'user-settings-block', 'left-nav-panel', 'WorldInfo']) {
    const node = doc.getElementById?.(drawerId);
    if (!node) continue;
    const bgStr = String(root?.getComputedStyle?.(node)?.backgroundColor || '').trim();
    const parsed = parseCssColorRgba(bgStr);
    if (parsed && parsed.a >= 0.72) {
      picked = { r: parsed.r, g: parsed.g, b: parsed.b, a: Math.max(parsed.a, 0.95) };
      break;
    }
  }

  if (!picked) {
    const chatTint = probeResolvedCssColor(
      root,
      doc,
      'var(--SmartThemeChatTintColor, transparent)',
      '--SmartThemeChatTintColor',
    );
    if (chatTint && chatTint.a >= 0.55) {
      picked = { r: chatTint.r, g: chatTint.g, b: chatTint.b, a: 0.95 };
    }
  }

  if (!picked && (blurColor.a >= 0.05 || blurColor.r + blurColor.g + blurColor.b > 0)) {
    picked = { r: blurColor.r, g: blurColor.g, b: blurColor.b, a: 0.95 };
  }

  if (!picked) {
    const bodyText = probeResolvedCssColor(
      root,
      doc,
      'var(--SmartThemeBodyColor, #ebedf2)',
      '--SmartThemeBodyColor',
    );
    const lum = bodyText
      ? (0.299 * bodyText.r + 0.587 * bodyText.g + 0.114 * bodyText.b) / 255
      : 0.9;
    picked = lum > 0.52 ? { r: 24, g: 26, b: 34, a: 0.95 } : { r: 248, g: 247, b: 244, a: 0.96 };
  }

  const resolved = `rgba(${picked.r}, ${picked.g}, ${picked.b}, ${Number(picked.a.toFixed(2))})`;
  docEl.style?.setProperty?.('--stm-surface-override', resolved);
  if (docEl.dataset) {
    docEl.dataset.stmSurfaceGuarded = '1';
  }
  return { applied: true, alpha: blurColor.a, resolved };
}

/**
 * 清理 `syncSurfaceOpacityGuard` 写入的内联面板底色覆盖变量。
 */
export function clearSurfaceOpacityGuard(root = globalThis) {
  const docEl = root?.document?.documentElement;
  if (!docEl) return;
  docEl.style?.removeProperty?.('--stm-surface-override');
  if (docEl.dataset) {
    delete docEl.dataset.stmSurfaceGuarded;
  }
}

/**
 * TauriTavern / 安卓 WebView 刘海屏双层安全区去重护栏：
 * 普通桌面浏览器零开销直接跳过；在 TauriTavern、安卓或 iOS 全屏壳下，若实测顶部安全区 > 0 且满足以下任一实证，
 * 则覆写 `--stm-safe-top: 0px` 消除伴侣顶栏在系统黑底状态栏下方多垫一层空白的问题：
 * 1. 外层容器已下移视口顶边（screenTop / visualViewport.offsetTop / documentElement.top > 16px）；
 * 2. TauriTavern 窗口壁纸 `#bg1.tt-window-background` 已设负 top（< -12px）说明 WebView 顶边本身已在状态栏之下；
 * 3. TauriTavern `--tt-window-height` 高于当前视口 `innerHeight` 至少一个安全区高度（且非软键盘弹起）；
 * 4. 安卓/TT 实测 `screen.height - innerHeight >= safeTop + safeBottom - 8`（排除软键盘态），证实系统状态栏已占位而非沉浸叠层。
 */
export function syncTauriSafeAreaGuard(root = globalThis) {
  const platform = detectPlatform(root);
  const isStandaloneShell = Boolean(platform.isIOS && root?.navigator?.standalone === true);
  const doc = root?.document;
  const docEl = doc?.documentElement;
  if (!doc?.body || !docEl) {
    return { applied: false, safeTop: 0, hostOffsetTop: 0 };
  }

  const rootStyle = root?.getComputedStyle?.(docEl);
  const rawTtInsetVar = String(rootStyle?.getPropertyValue?.('--tt-inset-top') || '').trim();
  const bg1El = doc.getElementById?.('bg1');
  const hasTtWindowBg = Boolean(bg1El?.classList?.contains?.('tt-window-background'));
  const hasTtShellHints = Boolean(
    hasTtWindowBg || (rawTtInsetVar && Number.parseFloat(rawTtInsetVar) > 0),
  );

  if (!platform.isTauri && !isStandaloneShell && !platform.isAndroid && !hasTtShellHints) {
    return { applied: false, safeTop: 0, hostOffsetTop: 0 };
  }

  const probe = doc.createElement('div');
  probe.className = 'stm-safe-area-probe';
  probe.setAttribute('aria-hidden', 'true');
  if (probe.style) {
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;padding-top:max(env(safe-area-inset-top, 0px), var(--tt-inset-top, 0px));padding-bottom:max(env(safe-area-inset-bottom, 0px), var(--tt-inset-bottom, 0px));height:var(--tt-window-height, 0px);visibility:hidden;pointer-events:none;z-index:-1;';
  }
  doc.body.appendChild(probe);

  let safeTop = 0;
  let safeBottom = 0;
  let ttWindowHeight = 0;
  try {
    const computed = root?.getComputedStyle?.(probe);
    safeTop = Number.parseFloat(computed?.paddingTop || '0') || 0;
    safeBottom = Number.parseFloat(computed?.paddingBottom || '0') || 0;
    ttWindowHeight = Number.parseFloat(computed?.height || '0') || 0;
  } finally {
    probe.remove?.();
  }

  const screenTopVal = Number(root?.screenTop ?? root?.screenY ?? 0) || 0;
  const vvOffsetTop = Number(root?.visualViewport?.offsetTop ?? 0) || 0;
  const docRectTop = Number(docEl.getBoundingClientRect?.()?.top ?? 0) || 0;
  const hostOffsetTop = Math.max(screenTopVal, vvOffsetTop, docRectTop);

  let reason = '';
  if (safeTop > 0) {
    if (hostOffsetTop > 16) {
      reason = 'host-offset';
    }

    if (!reason && hasTtWindowBg && bg1El) {
      const bgTop = Number.parseFloat(root?.getComputedStyle?.(bg1El)?.top || '0') || 0;
      if (bgTop < -12) {
        reason = 'tt-window-bg-pullup';
      }
    }

    const innerH = Number(root?.innerHeight || 0);
    const maxNonKeyboardDeficit = Math.max(180, safeTop + safeBottom + 60);

    if (!reason && ttWindowHeight > 0 && innerH > 0) {
      const ttDeficit = ttWindowHeight - innerH;
      if (
        innerH >= ttWindowHeight * 0.72 &&
        ttDeficit >= safeTop - 4 &&
        ttDeficit <= maxNonKeyboardDeficit
      ) {
        reason = 'tt-window-height-deficit';
      }
    }

    if (!reason && (platform.isAndroid || platform.isTauri || hasTtShellHints) && innerH > 0) {
      const rawScreenH = Number(root?.screen?.height || 0);
      const dpr = Number(root?.devicePixelRatio || 1);
      if (rawScreenH > 0) {
        const screenH =
          rawScreenH > innerH * 1.45 && dpr > 1.2 ? Math.round(rawScreenH / dpr) : rawScreenH;
        const deficit = screenH - innerH;
        const minExpectedInset = Math.max(safeTop - 4, safeTop + safeBottom - 8);
        if (
          innerH >= screenH * 0.72 &&
          deficit >= minExpectedInset &&
          deficit <= maxNonKeyboardDeficit
        ) {
          reason = 'android-screen-deficit';
        }
      }
    }
  }

  if (reason) {
    docEl.style?.setProperty?.('--stm-safe-top', '0px');
    if (docEl.dataset) {
      docEl.dataset.stmSafeTopGuarded = '1';
    }
    return { applied: true, safeTop, hostOffsetTop, reason };
  }

  if (docEl.dataset?.stmSafeTopGuarded === '1') {
    docEl.style?.removeProperty?.('--stm-safe-top');
    delete docEl.dataset.stmSafeTopGuarded;
  }
  return { applied: false, safeTop, hostOffsetTop, reason: '' };
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
