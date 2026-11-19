/**
 * ST伴侣 (st-mate) · 「流畅渲染引擎」后台静默加速控制器
 * 默认随 ST伴侣静默运行（亦可在「模块开关」独立关闭），无复杂前台参数：
 * 1. 长对话离屏历史楼层自动休眠（保持底部最新 8 楼实时活跃，上方旧楼层开启 content-visibility:auto 与离屏动画暂停）；
 * 2. 闭合原生抽屉（含数百张角色头像墙与世界书列表）渲染隔离，未点开时不占布局与解码；
 * 3. 移动端窄屏智能卸除酒馆 20+ 处高耗电多层高斯毛玻璃，保留原主题底色；
 * 4. 移动端软键盘弹出视口稳定锁，杜绝打字时整屏背景被压缩跳动与重绘。
 */

import { detectPlatform } from '../core/env.js?v=0.7.3';

const AWAKE_TAIL_COUNT = 8;
const HIBERNATE_MIN_TOTAL = 12;

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

export function createPerfEngine({ store, root = globalThis }) {
  let active = false;
  let chatChildObserver = null;
  let observedChatEl = null;
  let intersectionObserver = null;
  let syncRaf = 0;
  let stableViewportHeight = 0;
  const trackedOffscreenNodes = new WeakSet();
  const cleanups = [];

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
          } else {
            node.dataset.stmOffscreen = '1';
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
    const chatEl = doc?.getElementById('chat');
    if (!chatEl || !active) return;

    const allMes = chatEl.querySelectorAll(':scope > .mes');
    const { hibernate, awake } = partitionChatMessages(allMes, AWAKE_TAIL_COUNT);
    const io = hibernate.length > 0 ? ensureIntersectionObserver(chatEl) : null;

    for (const mes of hibernate) {
      if (!mes.classList.contains('stm-mes-hibernate')) {
        mes.classList.add('stm-mes-hibernate');
      }
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

  function bindChatObserver() {
    const doc = root?.document;
    const chatEl = doc?.getElementById('chat');
    if (!chatEl || typeof root?.MutationObserver !== 'function') return;

    if (observedChatEl === chatEl && chatChildObserver) {
      scheduleChatHibernation();
      return;
    }

    chatChildObserver?.disconnect();
    intersectionObserver?.disconnect();
    intersectionObserver = null;
    observedChatEl = chatEl;

    // 严格仅监听 #chat 直接子楼层增删，绝不开 subtree:true，流式逐字输出零回调开销！
    chatChildObserver = new root.MutationObserver(() => {
      scheduleChatHibernation();
    });
    chatChildObserver.observe(chatEl, { childList: true, subtree: false });
    scheduleChatHibernation();
  }

  function clearHibernationMarks() {
    const doc = root?.document;
    if (!doc) return;
    for (const mes of doc.querySelectorAll('#chat > .mes.stm-mes-hibernate, #chat > .mes[data-stm-offscreen]')) {
      mes.classList.remove('stm-mes-hibernate');
      if (mes.dataset?.stmOffscreen) {
        delete mes.dataset.stmOffscreen;
      }
    }
  }

  function startEngine() {
    if (active) {
      syncMobileTurboClass();
      syncStableViewportHeight();
      bindChatObserver();
      return;
    }
    active = true;
    syncMobileTurboClass();
    syncStableViewportHeight();
    bindChatObserver();

    const onResize = () => {
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
    if (!active) return;
    active = false;

    if (syncRaf) {
      if (typeof root?.cancelAnimationFrame === 'function') {
        root.cancelAnimationFrame(syncRaf);
      } else {
        clearTimeout(syncRaf);
      }
      syncRaf = 0;
    }

    chatChildObserver?.disconnect();
    chatChildObserver = null;
    observedChatEl = null;

    intersectionObserver?.disconnect();
    intersectionObserver = null;

    while (cleanups.length) {
      const off = cleanups.pop();
      off?.();
    }

    clearHibernationMarks();
    const doc = root?.document;
    if (doc) {
      doc.body.classList.remove('stm-turbo-active', 'stm-turbo-mobile');
      doc.documentElement.style.removeProperty('--stm-stable-vh');
    }
    stableViewportHeight = 0;
  }

  function refresh() {
    const s = store.get();
    const shouldRun = Boolean(s.shellEnabled && s.modules.turbo);
    if (shouldRun) {
      startEngine();
    } else {
      stopEngine();
    }
  }

  function destroy() {
    stopEngine();
  }

  return {
    isActive: () => active,
    refresh,
    destroy,
  };
}
