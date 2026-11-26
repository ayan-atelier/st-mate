/**
 * ST伴侣 (st-mate) · 「流畅渲染引擎 2.0」动态楼层窗口与后台静默加速控制器
 * 1. 动态楼层渲染窗口（默认仅在屏幕保留最近 20 楼 DOM，不改动聊天存档与世界书记忆；一键回顶直达当前窗口首楼，点击顶部横条或上翻按步长每次平滑展开 20 楼，回到底部继续对话时自动回收旧楼层与旧 iframe）；
 * 2. 第 0 楼美化全局 <style> 驻留守护（即使第 0 楼开场白被收起卸载，卡片内置全局美化 CSS 依然常驻生效不崩）；
 * 3. 长对话离屏楼层休眠与图片异步解码（底部最新 8 楼实时活跃，上方离屏楼层开启 content-visibility:auto、暂停离屏动画、图片自动补齐 decoding="async"）；
 * 4. 闭合原生抽屉（含数百张角色头像墙与世界书列表）渲染隔离，未点开时不占布局与解码；
 * 5. 移动端窄屏智能卸除酒馆 20+ 处高耗电多层高斯毛玻璃 + 软键盘弹出视口稳定锁。
 */

import { detectPlatform } from '../core/env.js?v=0.9.7';

const AWAKE_TAIL_COUNT = 8;
const HIBERNATE_MIN_TOTAL = 12;
const FLOOR0_STYLE_ANCHOR_ID = 'stm-floor0-style-anchor';
const IFRAME_HIBERNATE_STYLE_ID = 'stm-iframe-hibernate-style';

export const AUTO_KEEP_FLOORS_MOBILE = 24;
export const AUTO_KEEP_FLOORS_DESKTOP = 60;
export const MOBILE_STREAMING_FPS_CAP = 15;

export function resolveEffectiveKeepFloors(rawKeepFloors, isMobile = false) {
  const num = Math.round(Number(rawKeepFloors));
  if (Number.isFinite(num) && num >= 8) {
    return Math.min(200, num);
  }
  return isMobile ? AUTO_KEEP_FLOORS_MOBILE : AUTO_KEEP_FLOORS_DESKTOP;
}

export function partitionChatMessages(messages, awakeTail = AWAKE_TAIL_COUNT) {
  const list = Array.from(messages || []);
  if (list.length < HIBERNATE_MIN_TOTAL) {
    return { hibernate: [], awake: list };
  }
  const splitIdx = Math.max(0, list.length - Math.max(1, awakeTail));
  return {
    hibernate: list.slice(0, splitIdx),
    awake: list.slice(splitIdx),
  };
}

/**
 * 从 HTML 或消息原文中安全提取 <style>...</style> 纯 CSS 内容（剥除任何闭合逃逸标记）。
 */
export function extractSafeStyleCss(rawText = '') {
  const src = String(rawText || '');
  if (!src || !/<style\b/i.test(src)) return '';
  const blocks = [];
  const regex = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let match;
  while ((match = regex.exec(src)) !== null) {
    const css = String(match[1] || '')
      .replace(/<\/style/gi, '')
      .trim();
    if (css) blocks.push(css);
  }
  return blocks.join('\n\n');
}

/**
 * 生成顶部「展开更早楼层」横条文案。
 */
export function formatShowMoreLabel(hiddenFloorCount, loadStepFloors = 20) {
  const remain = Math.max(0, Math.floor(Number(hiddenFloorCount) || 0));
  const step = Math.max(1, Math.floor(Number(loadStepFloors) || 20));
  if (remain <= 0) return '';
  if (remain <= step) {
    return `↑ 展开上方剩余 ${remain} 楼历史对话`;
  }
  return `↑ 展开前 ${step} 楼（上方还有 ${remain} 楼已收起防卡顿）`;
}

function getDirectMesNodes(chatEl) {
  if (!chatEl) return [];
  if (chatEl.children && typeof chatEl.children.length === 'number') {
    const out = [];
    for (let i = 0; i < chatEl.children.length; i += 1) {
      const child = chatEl.children[i];
      if (child?.classList?.contains?.('mes')) {
        out.push(child);
      }
    }
    return out;
  }
  return typeof chatEl.querySelectorAll === 'function'
    ? Array.from(chatEl.querySelectorAll(':scope > .mes'))
    : [];
}

function findDirectShowMoreEl(chatEl) {
  if (!chatEl) return null;
  if (chatEl.children && typeof chatEl.children.length === 'number') {
    for (let i = 0; i < chatEl.children.length; i += 1) {
      const child = chatEl.children[i];
      if (String(child?.id || '') === 'show_more_messages') {
        return child;
      }
    }
    return null;
  }
  return chatEl.querySelector?.('#show_more_messages') || null;
}

function isNearChatBottom(chatEl, threshold = 260) {
  if (!chatEl) return true;
  const scrollH = Number(chatEl.scrollHeight) || 0;
  const clientH = Number(chatEl.clientHeight) || 0;
  const scrollTop = Number(chatEl.scrollTop) || 0;
  if (scrollH <= 0 || clientH <= 0 || scrollH <= clientH + 4) return true;
  return scrollH - scrollTop - clientH <= threshold;
}

function isMesProtectedFromPrune(mesNode) {
  if (!mesNode) return false;
  if (mesNode.classList?.contains?.('selected') || mesNode.classList?.contains?.('last_mes')) {
    return true;
  }
  if (typeof mesNode.querySelector === 'function' && mesNode.querySelector('textarea')) {
    return true;
  }
  return false;
}

export function createPerfEngine({
  store,
  getContext = null,
  root = globalThis,
  loadMoreFloors = null,
}) {
  let active = false;
  let chatChildObserver = null;
  let observedChatEl = null;
  let intersectionObserver = null;
  let syncRaf = 0;
  let scrollSettleTimer = 0;
  let stableViewportHeight = 0;
  let mutatingInternal = false;
  let expandingBusy = false;
  let userExpandedHistory = false;
  let savedHostTruncation = null;
  let savedHostStreamingFps = null;
  let cachedZeroChatKey = '';
  let cachedZeroCss = '';
  let hostScriptBridgePromise = null;
  let cachedShowMoreFn = typeof loadMoreFloors === 'function' ? loadMoreFloors : null;

  const trackedOffscreenNodes = new WeakSet();
  const decodedImgDoneNodes = new WeakSet();
  const cleanups = [];
  let chatBoundCleanup = null;

  const resolveCtx = () => {
    if (typeof getContext === 'function') return getContext();
    return root?.SillyTavern?.getContext?.() || null;
  };

  function currentChatIdentity() {
    const ctx = resolveCtx();
    if (!ctx) return '';
    const chatId = ctx.chatId ?? ctx.getCurrentChatId?.() ?? '';
    const entity = ctx.groupId || ctx.characterId || '';
    return `${entity}::${chatId}`;
  }

  async function warmHostShowMoreFn() {
    if (typeof cachedShowMoreFn === 'function') return cachedShowMoreFn;
    try {
      hostScriptBridgePromise ||= import('/script.js');
      const mod = await hostScriptBridgePromise;
      if (typeof mod?.showMoreMessages === 'function') {
        cachedShowMoreFn = mod.showMoreMessages;
        return cachedShowMoreFn;
      }
    } catch {
      // ignore dynamic import fallback in isolated test runtimes
    }
    return null;
  }

  function getTurboWindowSettings() {
    const s = store.get();
    const tc = s?.turboConfig || {};
    const enabled = Boolean(active && s?.shellEnabled && s?.modules?.turbo && tc.floorWindowEnabled !== false);
    const isMobile = Boolean(detectPlatform(root).isMobile);
    const keepFloors = resolveEffectiveKeepFloors(tc.keepFloors, isMobile);
    const loadStepFloors = Math.max(5, Math.min(100, Math.round(Number(tc.loadStepFloors) || 20)));
    return { enabled, keepFloors, loadStepFloors, isMobile, isAutoKeep: !(Number(tc.keepFloors) >= 8) };
  }

  function syncHostPerfSettings() {
    const ctx = resolveCtx();
    const pu = ctx?.powerUserSettings;
    if (!pu || typeof pu !== 'object') return;

    const { enabled, keepFloors } = getTurboWindowSettings();
    if (enabled) {
      if (savedHostTruncation === null) {
        savedHostTruncation = pu.chat_truncation;
      }
      if (pu.chat_truncation !== keepFloors) {
        pu.chat_truncation = keepFloors;
      }
    } else if (savedHostTruncation !== null) {
      pu.chat_truncation = savedHostTruncation;
      savedHostTruncation = null;
    }

    // 仅在手机端温和节流过高流式重排帧率（30fps -> 15fps），电脑端 100% 零改动！
    const isMobile = Boolean(detectPlatform(root).isMobile);
    if (active && isMobile) {
      const curFps = Number(pu.streaming_fps);
      if (Number.isFinite(curFps) && curFps > MOBILE_STREAMING_FPS_CAP) {
        if (savedHostStreamingFps === null) {
          savedHostStreamingFps = curFps;
        }
        pu.streaming_fps = MOBILE_STREAMING_FPS_CAP;
      }
    } else if (savedHostStreamingFps !== null) {
      pu.streaming_fps = savedHostStreamingFps;
      savedHostStreamingFps = null;
    }
  }

  function removeFloorZeroStyleAnchor() {
    const doc = root?.document;
    doc?.getElementById?.(FLOOR0_STYLE_ANCHOR_ID)?.remove?.();
  }

  function captureRenderedFloorZeroStyle(mesZeroNode) {
    if (!mesZeroNode || typeof mesZeroNode.querySelectorAll !== 'function') return '';
    const styleEls = mesZeroNode.querySelectorAll('style');
    if (!styleEls || !styleEls.length) return '';
    const parts = [];
    for (const st of styleEls) {
      const css = String(st.textContent || '')
        .replace(/<\/style/gi, '')
        .trim();
      if (css) parts.push(css);
    }
    return parts.join('\n\n');
  }

  function syncFloorZeroStyleAnchor(chatEl) {
    const doc = root?.document;
    if (!doc || !active) {
      removeFloorZeroStyleAnchor();
      return;
    }

    const chatKey = currentChatIdentity();
    if (chatKey !== cachedZeroChatKey) {
      cachedZeroChatKey = chatKey;
      cachedZeroCss = '';
    }

    const mesNodes = getDirectMesNodes(chatEl);
    const mesZero = mesNodes.find(n => String(n?.getAttribute?.('mesid') ?? '') === '0') || null;
    if (mesZero) {
      const renderedCss = captureRenderedFloorZeroStyle(mesZero);
      if (renderedCss) {
        cachedZeroCss = renderedCss;
      }
      // 第 0 楼本身已在 DOM 内，移除驻留副本避免重复叠加
      removeFloorZeroStyleAnchor();
      return;
    }

    if (!mesNodes.length) {
      removeFloorZeroStyleAnchor();
      return;
    }

    let cssToPin = cachedZeroCss;
    if (!cssToPin) {
      const rawZeroMes = resolveCtx()?.chat?.[0]?.mes;
      if (typeof rawZeroMes === 'string' && rawZeroMes) {
        cssToPin = extractSafeStyleCss(rawZeroMes);
        if (cssToPin) cachedZeroCss = cssToPin;
      }
    }

    if (!cssToPin) {
      removeFloorZeroStyleAnchor();
      return;
    }

    let anchor = doc.getElementById?.(FLOOR0_STYLE_ANCHOR_ID);
    if (!anchor) {
      anchor = doc.createElement('style');
      anchor.id = FLOOR0_STYLE_ANCHOR_ID;
      anchor.setAttribute('data-stm-floor0-guard', '1');
      (doc.head || doc.documentElement || doc.body)?.append?.(anchor);
    }
    if (anchor.textContent !== cssToPin) {
      anchor.textContent = cssToPin;
    }
  }

  function syncShowMoreBanner(chatEl) {
    if (!chatEl) return;
    const { enabled, loadStepFloors } = getTurboWindowSettings();
    const mesNodes = getDirectMesNodes(chatEl);
    const showMoreEl = findDirectShowMoreEl(chatEl);

    if (!mesNodes.length) return;
    const firstMesId = Number(mesNodes[0]?.getAttribute?.('mesid'));
    if (!Number.isFinite(firstMesId) || firstMesId <= 0) {
      if (showMoreEl && enabled) {
        mutatingInternal = true;
        try {
          showMoreEl.remove?.();
        } finally {
          mutatingInternal = false;
        }
      }
      return;
    }

    if (!enabled) {
      if (showMoreEl && showMoreEl.dataset?.stmManagedBanner === '1') {
        delete showMoreEl.dataset.stmManagedBanner;
        showMoreEl.textContent = 'Show more messages';
      }
      return;
    }

    const label = formatShowMoreLabel(firstMesId, loadStepFloors);
    let banner = showMoreEl;
    mutatingInternal = true;
    try {
      if (!banner) {
        const doc = root?.document;
        if (!doc) return;
        banner = doc.createElement('div');
        banner.id = 'show_more_messages';
        if (typeof chatEl.prepend === 'function') {
          chatEl.prepend(banner);
        } else if (typeof chatEl.insertBefore === 'function') {
          chatEl.insertBefore(banner, chatEl.firstChild || null);
        }
      }
      if (banner.dataset) {
        banner.dataset.stmManagedBanner = '1';
      }
      if (banner.textContent !== label) {
        banner.textContent = label;
      }
    } finally {
      mutatingInternal = false;
    }
  }

  function pruneOverflowFloorsNow({ force = false } = {}) {
    const doc = root?.document;
    const chatEl = doc?.getElementById?.('chat');
    if (!chatEl || !active) return 0;

    const { enabled, keepFloors } = getTurboWindowSettings();
    if (!enabled) {
      syncShowMoreBanner(chatEl);
      syncFloorZeroStyleAnchor(chatEl);
      return 0;
    }

    // 用户刚点过向上展开历史，或当前滚动条正在上方回看旧文时，绝不抽走正在阅读的楼层！
    if (!force && (expandingBusy || userExpandedHistory || !isNearChatBottom(chatEl, 260))) {
      syncShowMoreBanner(chatEl);
      syncFloorZeroStyleAnchor(chatEl);
      return 0;
    }

    const mesNodes = getDirectMesNodes(chatEl);
    if (mesNodes.length <= keepFloors) {
      syncShowMoreBanner(chatEl);
      syncFloorZeroStyleAnchor(chatEl);
      return 0;
    }

    const wantRemove = mesNodes.length - keepFloors;
    let safeRemoveCount = 0;
    for (let i = 0; i < wantRemove; i += 1) {
      if (isMesProtectedFromPrune(mesNodes[i])) break;
      safeRemoveCount += 1;
    }

    if (safeRemoveCount <= 0) {
      syncShowMoreBanner(chatEl);
      syncFloorZeroStyleAnchor(chatEl);
      return 0;
    }

    const prevScrollH = Number(chatEl.scrollHeight) || 0;
    const prevTop = Number(chatEl.scrollTop) || 0;
    const wasAtVeryBottom = isNearChatBottom(chatEl, 48);

    mutatingInternal = true;
    try {
      for (let i = 0; i < safeRemoveCount; i += 1) {
        const node = mesNodes[i];
        if (String(node?.getAttribute?.('mesid') ?? '') === '0') {
          const renderedZeroCss = captureRenderedFloorZeroStyle(node);
          if (renderedZeroCss) cachedZeroCss = renderedZeroCss;
        }
        if (intersectionObserver && trackedOffscreenNodes.has(node)) {
          intersectionObserver.unobserve(node);
        }
        node?.remove?.();
      }
    } finally {
      mutatingInternal = false;
    }

    syncShowMoreBanner(chatEl);
    syncFloorZeroStyleAnchor(chatEl);

    // 滚动高度无感补偿，确保底栏阅读视线 0 像素跳动
    const nextScrollH = Number(chatEl.scrollHeight) || 0;
    if (wasAtVeryBottom && nextScrollH > 0) {
      chatEl.scrollTop = Math.max(0, nextScrollH - (Number(chatEl.clientHeight) || 0));
    } else if (prevScrollH > nextScrollH && prevTop > 0) {
      chatEl.scrollTop = Math.max(0, prevTop - (prevScrollH - nextScrollH));
    }

    return safeRemoveCount;
  }

  function optimizeOffscreenImages(mesNode) {
    if (!mesNode || decodedImgDoneNodes.has(mesNode) || typeof mesNode.querySelectorAll !== 'function') {
      return;
    }
    decodedImgDoneNodes.add(mesNode);
    const imgs = mesNode.querySelectorAll('img');
    for (const img of imgs) {
      if (!img.getAttribute?.('decoding')) {
        img.setAttribute?.('decoding', 'async');
      }
    }
  }

  function isTypingElement(el) {
    if (!el || typeof el.matches !== 'function') return false;
    return el.matches('input, textarea, [contenteditable="true"], [role="textbox"]');
  }

  function syncStableViewportHeight() {
    const doc = root?.document;
    if (!doc || !active) return;

    const vv = root?.visualViewport;
    const rawHeight = Math.round(
      Number(root?.innerHeight || doc.documentElement?.clientHeight || vv?.height || 0),
    );
    if (rawHeight <= 0) return;

    const platform = detectPlatform(root);
    const typing = isTypingElement(doc.activeElement);

    // 移动端弹起软键盘时保持唤醒前的完整屏幕高度，防止底图与原生 #bg1 被压扁闪烁
    if (!platform.isMobile || !typing || rawHeight > stableViewportHeight || stableViewportHeight === 0) {
      if (Math.abs(rawHeight - stableViewportHeight) >= 2) {
        stableViewportHeight = rawHeight;
        doc.documentElement.style.setProperty('--stm-stable-vh', `${stableViewportHeight}px`);
      }
    }
  }

  function syncMobileTurboClass() {
    const doc = root?.document;
    if (!doc) return;
    if (!active) {
      doc.body.classList.remove('stm-turbo-active', 'stm-turbo-mobile');
      return;
    }
    const platform = detectPlatform(root);
    doc.body.classList.add('stm-turbo-active');
    doc.body.classList.toggle('stm-turbo-mobile', Boolean(platform.isMobile));
  }

  function setMesIframesPaused(mesNode, paused) {
    if (!mesNode || typeof mesNode.querySelectorAll !== 'function') return;
    const iframes = mesNode.querySelectorAll('iframe');
    if (!iframes || !iframes.length) return;
    for (const frame of iframes) {
      try {
        const idoc = frame?.contentDocument;
        const rootEl = idoc?.documentElement;
        if (!idoc || !rootEl) continue;
        if (paused) {
          if (!idoc.getElementById?.(IFRAME_HIBERNATE_STYLE_ID)) {
            const st = idoc.createElement('style');
            st.id = IFRAME_HIBERNATE_STYLE_ID;
            st.textContent =
              'html[data-stm-iframe-paused="1"] *, html[data-stm-iframe-paused="1"] *::before, html[data-stm-iframe-paused="1"] *::after { animation-play-state: paused !important; transition: none !important; }';
            (idoc.head || rootEl)?.append?.(st);
          }
          if (rootEl.dataset) rootEl.dataset.stmIframePaused = '1';
          else rootEl.setAttribute?.('data-stm-iframe-paused', '1');
        } else if (rootEl.dataset && 'stmIframePaused' in rootEl.dataset) {
          delete rootEl.dataset.stmIframePaused;
        } else {
          rootEl.removeAttribute?.('data-stm-iframe-paused');
        }
      } catch {
        // 跨域 iframe 静默跳过，零报错
      }
    }
  }

  function ensureIntersectionObserver(chatEl) {
    if (typeof root?.IntersectionObserver !== 'function' || !chatEl) return null;
    if (intersectionObserver) return intersectionObserver;

    intersectionObserver = new root.IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const node = entry.target;
          if (!node?.dataset) continue;
          if (entry.isIntersecting) {
            delete node.dataset.stmOffscreen;
            setMesIframesPaused(node, false);
          } else {
            node.dataset.stmOffscreen = '1';
            setMesIframesPaused(node, true);
          }
        }
      },
      {
        root: chatEl,
        rootMargin: '960px 0px 960px 0px',
        threshold: 0,
      },
    );
    return intersectionObserver;
  }

  function applyChatHibernationNow() {
    syncRaf = 0;
    const doc = root?.document;
    const chatEl = doc?.getElementById?.('chat');
    if (!chatEl || !active) return;

    pruneOverflowFloorsNow();

    const allMes = getDirectMesNodes(chatEl);
    const { hibernate, awake } = partitionChatMessages(allMes, AWAKE_TAIL_COUNT);
    const io = hibernate.length > 0 ? ensureIntersectionObserver(chatEl) : null;

    for (const mes of hibernate) {
      if (!mes.classList.contains('stm-mes-hibernate')) {
        mes.classList.add('stm-mes-hibernate');
      }
      optimizeOffscreenImages(mes);
      if (io && !trackedOffscreenNodes.has(mes)) {
        trackedOffscreenNodes.add(mes);
        io.observe(mes);
      }
    }

    for (const mes of awake) {
      if (mes.classList.contains('stm-mes-hibernate')) {
        mes.classList.remove('stm-mes-hibernate');
      }
      if (mes.dataset?.stmOffscreen) {
        delete mes.dataset.stmOffscreen;
      }
      setMesIframesPaused(mes, false);
      if (intersectionObserver && trackedOffscreenNodes.has(mes)) {
        intersectionObserver.unobserve(mes);
      }
    }
  }

  function scheduleChatHibernation() {
    if (!active || syncRaf) return;
    const req = root?.requestAnimationFrame || (fn => setTimeout(fn, 16));
    syncRaf = req(applyChatHibernationNow);
  }

  function bindChatListeners(chatEl) {
    chatBoundCleanup?.();
    chatBoundCleanup = null;
    if (!chatEl || typeof chatEl.addEventListener !== 'function') return;

    const onChatClickCapture = evt => {
      if (!active) return;
      const { enabled, loadStepFloors } = getTurboWindowSettings();
      if (!enabled) return;

      const target = evt?.target;
      const hitBanner =
        String(target?.id || '') === 'show_more_messages' ||
        (typeof target?.closest === 'function' && target.closest('#show_more_messages'));
      if (!hitBanner) return;

      // 标记用户正在主动展开回看历史，防止展开出的旧楼层被立即收回
      userExpandedHistory = true;

      if (typeof cachedShowMoreFn !== 'function') {
        void warmHostShowMoreFn();
        return;
      }

      // 必须在捕获阶段同步阻断冒泡，防止酒馆原生无参监听重复加载整百楼
      evt.preventDefault?.();
      evt.stopPropagation?.();
      evt.stopImmediatePropagation?.();
      if (expandingBusy) return;

      expandingBusy = true;
      void Promise.resolve(cachedShowMoreFn(loadStepFloors)).finally(() => {
        expandingBusy = false;
        syncShowMoreBanner(chatEl);
        syncFloorZeroStyleAnchor(chatEl);
        scheduleChatHibernation();
      });
    };

    const onChatScroll = () => {
      if (!active || !userExpandedHistory) return;
      if (scrollSettleTimer) {
        clearTimeout(scrollSettleTimer);
      }
      scrollSettleTimer = setTimeout(() => {
        scrollSettleTimer = 0;
        if (!active || !userExpandedHistory) return;
        if (isNearChatBottom(chatEl, 56)) {
          userExpandedHistory = false;
          pruneOverflowFloorsNow();
        }
      }, 420);
    };

    chatEl.addEventListener('click', onChatClickCapture, true);
    chatEl.addEventListener('scroll', onChatScroll, { passive: true });
    chatBoundCleanup = () => {
      chatEl.removeEventListener?.('click', onChatClickCapture, true);
      chatEl.removeEventListener?.('scroll', onChatScroll);
    };
  }

  function bindChatObserver() {
    const doc = root?.document;
    const chatEl = doc?.getElementById?.('chat');
    if (!chatEl) return;

    if (observedChatEl === chatEl && chatChildObserver) {
      scheduleChatHibernation();
      return;
    }

    chatChildObserver?.disconnect();
    intersectionObserver?.disconnect();
    intersectionObserver = null;
    observedChatEl = chatEl;

    bindChatListeners(chatEl);

    if (typeof root?.MutationObserver === 'function') {
      // 严格仅监听 #chat 直接子楼层增删，绝不开 subtree:true，流式逐字输出零回调开销！
      chatChildObserver = new root.MutationObserver(() => {
        if (mutatingInternal) return;
        scheduleChatHibernation();
      });
      chatChildObserver.observe(chatEl, { childList: true, subtree: false });
    }
    scheduleChatHibernation();
  }

  function clearHibernationMarks() {
    const doc = root?.document;
    if (!doc) return;
    const chatEl = doc.getElementById?.('chat');
    for (const mes of getDirectMesNodes(chatEl)) {
      mes.classList?.remove?.('stm-mes-hibernate');
      if (mes.dataset?.stmOffscreen) {
        delete mes.dataset.stmOffscreen;
      }
      setMesIframesPaused(mes, false);
    }
    const banner = findDirectShowMoreEl(chatEl);
    if (banner?.dataset?.stmManagedBanner === '1') {
      delete banner.dataset.stmManagedBanner;
      banner.textContent = 'Show more messages';
    }
    removeFloorZeroStyleAnchor();
  }

  function startEngine() {
    void warmHostShowMoreFn();
    if (active) {
      syncHostPerfSettings();
      syncMobileTurboClass();
      syncStableViewportHeight();
      bindChatObserver();
      return;
    }
    active = true;
    syncHostPerfSettings();
    syncMobileTurboClass();
    syncStableViewportHeight();
    bindChatObserver();

    const onResize = () => {
      syncHostPerfSettings();
      syncMobileTurboClass();
      syncStableViewportHeight();
    };
    root?.addEventListener?.('resize', onResize, { passive: true });
    cleanups.push(() => root?.removeEventListener?.('resize', onResize));

    if (root?.visualViewport) {
      root.visualViewport.addEventListener('resize', syncStableViewportHeight, { passive: true });
      cleanups.push(() => root.visualViewport.removeEventListener('resize', syncStableViewportHeight));
    }
  }

  function stopEngine() {
    if (!active) {
      syncHostPerfSettings();
      return;
    }
    active = false;
    userExpandedHistory = false;
    expandingBusy = false;

    if (syncRaf) {
      if (typeof root?.cancelAnimationFrame === 'function') {
        root.cancelAnimationFrame(syncRaf);
      } else {
        clearTimeout(syncRaf);
      }
      syncRaf = 0;
    }
    if (scrollSettleTimer) {
      clearTimeout(scrollSettleTimer);
      scrollSettleTimer = 0;
    }

    chatBoundCleanup?.();
    chatBoundCleanup = null;

    chatChildObserver?.disconnect();
    chatChildObserver = null;
    observedChatEl = null;

    intersectionObserver?.disconnect();
    intersectionObserver = null;

    while (cleanups.length) {
      const off = cleanups.pop();
      off?.();
    }

    syncHostPerfSettings();
    clearHibernationMarks();
    const doc = root?.document;
    if (doc) {
      doc.body.classList.remove('stm-turbo-active', 'stm-turbo-mobile');
      doc.documentElement.style.removeProperty('--stm-stable-vh');
    }
    stableViewportHeight = 0;
  }

  function handleChatChanged() {
    userExpandedHistory = false;
    cachedZeroChatKey = '';
    cachedZeroCss = '';
    if (!active) return;
    syncHostPerfSettings();
    pruneOverflowFloorsNow({ force: true });
    scheduleChatHibernation();
  }

  function handleGenerationEnded() {
    if (!active) return;
    const doc = root?.document;
    const chatEl = doc?.getElementById?.('chat');
    if (chatEl && isNearChatBottom(chatEl, 260)) {
      userExpandedHistory = false;
    }
    pruneOverflowFloorsNow();
    scheduleChatHibernation();
  }

  function refresh({ forcePrune = false } = {}) {
    const s = store.get();
    const shouldRun = Boolean(s.shellEnabled && s.modules.turbo);
    if (shouldRun) {
      startEngine();
      if (forcePrune) {
        userExpandedHistory = false;
        pruneOverflowFloorsNow({ force: true });
      }
    } else {
      stopEngine();
    }
  }

  function destroy() {
    stopEngine();
  }

  return {
    isActive: () => active,
    pruneNow: opts => pruneOverflowFloorsNow(opts),
    handleChatChanged,
    handleGenerationEnded,
    refresh,
    destroy,
  };
}
