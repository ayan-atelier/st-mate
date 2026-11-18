/**
 * ST伴侣 (st-mate) · 对话页双态极简顶栏控制器
 * - RP态：左侧 ‹ + [头像 + 角色名] + 浅色小字当前预设名 ▾；右侧 4 个 1.5px 纯色细线图标
 * - 阅读态：隐去头像、角色名与预设小字，仅保留 ‹ 与右侧 4 个细线图标，大面积呼吸留白
 * - 严守原生保活铁律：绝不对 #top-settings-holder 设 display:none，保障全部 9 个原生抽屉正常弹出；
 * - 性能铁律：窄屏（<= 1000px）跳过 #sheld 几何观察器，桌面宽屏采用 rAF 合批读取，杜绝强制同步回流。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.3.3';
import { svgMarkup } from '../core/icons.js?v=0.3.3';
import {
  closeAllNativeDrawers,
  getCurrentEntityMeta,
  getCurrentPresetMeta,
  getOpenNativeDrawerIds,
  openNativeDrawer,
  returnToHomeScreen,
} from './host-actions.js?v=0.3.3';

const PRESET_WATCH_IDS = new Set([
  'main_api',
  'settings_preset_openai',
  'settings_preset_textgenerationwebui',
  'settings_preset_novel',
  'settings_preset',
]);

export function createTopbar({
  getContext,
  store,
  moduleBridge,
  onOpenSettings,
  onToggleReaderDock,
  isReaderDockOpen,
  onNativeDrawerOpened,
  onExitPureReading,
}) {
  let rootEl = null;
  let backBtn = null;
  let identityBtn = null;
  let avatarImg = null;
  let nameSpan = null;
  let presetBtn = null;
  let presetTextSpan = null;
  let btnApi = null;
  let btnPersona = null;
  let btnReader = null;
  let btnSettings = null;
  let btnCharWorld = null;
  let drawerObserver = null;
  let presetSelectObserver = null;
  let sheldResizeObserver = null;
  let sheldAttrObserver = null;
  let boundsRaf = 0;
  let desktopBoundsActive = false;
  let boundHolder = null;
  let lastCharDrawerId = 'rightNavHolder';

  function applySheldBoundsNow() {
    boundsRaf = 0;
    if (!rootEl || rootEl.hidden) return;
    const win = globalThis.window || globalThis;
    const doc = globalThis.document;
    if (!doc) return;

    const isNarrow = typeof win.innerWidth === 'number' && win.innerWidth <= 1000;
    if (isNarrow) {
      if (desktopBoundsActive) {
        desktopBoundsActive = false;
        sheldResizeObserver?.disconnect();
        sheldAttrObserver?.disconnect();
        sheldResizeObserver = null;
        sheldAttrObserver = null;
        rootEl.style.removeProperty('--stm-sheld-left');
        rootEl.style.removeProperty('--stm-sheld-right');
        rootEl.style.removeProperty('--stm-sheld-width');
        rootEl.style.removeProperty('--stm-sheld-margin');
      }
      return;
    }

    ensureDesktopSheldObservers(doc);
    const sheld = doc.getElementById('sheld');
    if (!sheld || typeof sheld.getBoundingClientRect !== 'function') return;
    const rect = sheld.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;

    rootEl.style.setProperty('--stm-sheld-left', `${Math.round(rect.left)}px`);
    rootEl.style.setProperty('--stm-sheld-right', 'auto');
    rootEl.style.setProperty('--stm-sheld-width', `${Math.round(rect.width)}px`);
    rootEl.style.setProperty('--stm-sheld-margin', '0');
  }

  function scheduleSheldBounds() {
    if (boundsRaf) return;
    const req = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16));
    boundsRaf = req(applySheldBoundsNow);
  }

  function ensureDesktopSheldObservers(doc) {
    if (desktopBoundsActive) return;
    const sheld = doc?.getElementById('sheld');
    if (!sheld) return;
    desktopBoundsActive = true;

    if (typeof globalThis.ResizeObserver === 'function') {
      sheldResizeObserver = new globalThis.ResizeObserver(scheduleSheldBounds);
      sheldResizeObserver.observe(sheld);
    }
    if (typeof globalThis.MutationObserver === 'function') {
      sheldAttrObserver = new globalThis.MutationObserver(scheduleSheldBounds);
      sheldAttrObserver.observe(sheld, { attributes: true, attributeFilter: ['style', 'class'] });
    }
  }

  function makeIconBtn(iconName, label, onClick) {
    const doc = globalThis.document;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'stm-topbar-btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = svgMarkup(iconName);
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onExitPureReading?.();
      onClick(event);
    });
    return btn;
  }

  function handlePresetClick() {
    const openIds = getOpenNativeDrawerIds();
    if (openIds.includes('ai-config-button')) {
      closeAllNativeDrawers();
      return;
    }
    openNativeDrawer('ai-config-button', { toggleIfOpen: false, getContext });
  }

  function handleApiClick() {
    const openIds = getOpenNativeDrawerIds();
    const isReadingMode = store.get().topbarMode === 'reading';
    if (openIds.includes('sys-settings-button') || (isReadingMode && openIds.includes('ai-config-button'))) {
      closeAllNativeDrawers();
      return;
    }
    openNativeDrawer('sys-settings-button', { toggleIfOpen: false, getContext });
  }

  function handlePersonaClick() {
    const openIds = getOpenNativeDrawerIds();
    if (openIds.includes('persona-management-button')) {
      closeAllNativeDrawers();
      return;
    }

    const opened = openNativeDrawer('persona-management-button', { toggleIfOpen: false, getContext });
    const settings = store.get();
    if (opened && settings.modules.persona) {
      const handle = moduleBridge.getRegisteredHandle('yantai-persona-studio');
      if (handle && typeof handle.open === 'function') {
        void Promise.resolve(handle.open({ ensureNative: false, tab: 'current' })).catch(err => {
          console.warn('[ST伴侣] 唤醒人设馆工作区异常:', err);
        });
      }
    }
  }

  function handleCharWorldClick() {
    const openIds = getOpenNativeDrawerIds();
    if (openIds.includes('rightNavHolder') || openIds.includes('WI-SP-button')) {
      closeAllNativeDrawers();
      return;
    }
    openNativeDrawer(lastCharDrawerId, { toggleIfOpen: false, getContext });
  }

  function syncPresetBadge(ctx = getContext?.()) {
    if (!presetBtn || !presetTextSpan) return;
    const presetMeta = getCurrentPresetMeta(ctx);
    if (presetTextSpan.textContent !== presetMeta.shortName) {
      presetTextSpan.textContent = presetMeta.shortName;
    }
    const tip = `当前对话预设：${presetMeta.fullName}（点击切换预设）`;
    if (presetBtn.title !== tip) {
      presetBtn.title = tip;
      presetBtn.setAttribute('aria-label', tip);
    }
  }

  function onHolderChange(event) {
    const target = event?.target;
    if (target && PRESET_WATCH_IDS.has(target.id)) {
      syncPresetBadge();
    }
  }

  function mountDom() {
    const doc = globalThis.document;
    if (!doc || rootEl?.isConnected) return;

    rootEl = doc.getElementById('stm-topbar');
    if (!rootEl || rootEl.tagName !== 'DIV') {
      rootEl?.remove();
      rootEl = doc.createElement('div');
    }
    rootEl.id = 'stm-topbar';
    rootEl.className = 'stm-topbar';
    rootEl.setAttribute('role', 'navigation');
    rootEl.setAttribute('aria-label', 'ST伴侣顶栏');
    rootEl.replaceChildren();

    const stopEarlyDrawerAutoClose = event => {
      event.stopPropagation();
    };
    rootEl.addEventListener('mousedown', stopEarlyDrawerAutoClose);
    rootEl.addEventListener('touchstart', stopEarlyDrawerAutoClose, { passive: true });

    const inner = doc.createElement('div');
    inner.className = 'stm-topbar-inner';

    const left = doc.createElement('div');
    left.className = 'stm-topbar-left';

    backBtn = makeIconBtn('back', '返回书架首页', () => {
      void returnToHomeScreen(getContext);
    });
    backBtn.classList.add('stm-topbar-back');

    identityBtn = doc.createElement('button');
    identityBtn.type = 'button';
    identityBtn.className = 'stm-topbar-identity';
    identityBtn.title = '查看当前角色档案与世界书';
    identityBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onExitPureReading?.();
      handleCharWorldClick();
    });

    avatarImg = doc.createElement('img');
    avatarImg.className = 'stm-topbar-avatar';
    avatarImg.alt = '';
    avatarImg.decoding = 'async';

    nameSpan = doc.createElement('span');
    nameSpan.className = 'stm-topbar-name';

    identityBtn.append(avatarImg, nameSpan);

    presetBtn = doc.createElement('button');
    presetBtn.type = 'button';
    presetBtn.className = 'stm-topbar-preset';
    presetTextSpan = doc.createElement('span');
    presetTextSpan.className = 'stm-topbar-preset-text';
    const presetCaret = doc.createElement('span');
    presetCaret.className = 'stm-topbar-preset-caret';
    presetCaret.setAttribute('aria-hidden', 'true');
    presetCaret.textContent = '▾';
    presetBtn.append(presetTextSpan, presetCaret);
    presetBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onExitPureReading?.();
      handlePresetClick();
    });

    left.append(backBtn, identityBtn, presetBtn);

    const right = doc.createElement('div');
    right.className = 'stm-topbar-right';

    btnApi = makeIconBtn('bolt', 'API连接与模型配置', handleApiClick);
    btnPersona = makeIconBtn('user', '人设馆与用户设定', handlePersonaClick);
    btnReader = makeIconBtn('typography', '页面排版与背景', () => {
      closeAllNativeDrawers();
      onToggleReaderDock?.();
    });
    btnReader.classList.add('stm-topbar-reader-btn');
    btnSettings = makeIconBtn('settings', 'ST伴侣设置中心', () => {
      closeAllNativeDrawers();
      onOpenSettings?.();
    });
    btnCharWorld = makeIconBtn('book', '角色档案与世界书', handleCharWorldClick);

    right.append(btnApi, btnPersona, btnReader, btnSettings, btnCharWorld);
    inner.append(left, right);
    rootEl.append(inner);

    const anchor = doc.getElementById('top-settings-holder') || doc.body.firstChild;
    if (anchor?.parentNode) {
      anchor.parentNode.insertBefore(rootEl, anchor);
    } else {
      doc.body.prepend(rootEl);
    }

    observeNativeDrawersAndPresets();
  }

  function observeNativeDrawersAndPresets() {
    drawerObserver?.disconnect();
    presetSelectObserver?.disconnect();
    sheldResizeObserver?.disconnect();
    sheldAttrObserver?.disconnect();
    desktopBoundsActive = false;
    globalThis.removeEventListener?.('resize', scheduleSheldBounds);
    if (boundHolder) {
      boundHolder.removeEventListener('change', onHolderChange);
      boundHolder = null;
    }

    const doc = globalThis.document;
    globalThis.addEventListener?.('resize', scheduleSheldBounds, { passive: true });

    const holder = doc?.getElementById('top-settings-holder');
    if (!holder) return;

    holder.addEventListener('change', onHolderChange);
    boundHolder = holder;

    if (typeof globalThis.MutationObserver !== 'function') return;

    drawerObserver = new globalThis.MutationObserver(() => {
      syncActiveDrawerHighlights();
    });

    for (const content of holder.querySelectorAll(':scope > .drawer > .drawer-content')) {
      drawerObserver.observe(content, { attributes: true, attributeFilter: ['class'] });
    }

    presetSelectObserver = new globalThis.MutationObserver(() => {
      syncPresetBadge();
    });
    for (const id of PRESET_WATCH_IDS) {
      const selectEl = doc.getElementById(id);
      if (selectEl) {
        presetSelectObserver.observe(selectEl, { childList: true, attributes: true });
      }
    }
  }

  function syncActiveDrawerHighlights() {
    if (!rootEl) return;
    const openIds = getOpenNativeDrawerIds();
    if (openIds.includes('rightNavHolder')) lastCharDrawerId = 'rightNavHolder';
    if (openIds.includes('WI-SP-button')) lastCharDrawerId = 'WI-SP-button';

    if (openIds.length > 0) {
      onExitPureReading?.();
      onNativeDrawerOpened?.();
    }

    const isReadingMode = store.get().topbarMode === 'reading';
    presetBtn?.classList.toggle('is-active', openIds.includes('ai-config-button'));
    btnApi?.classList.toggle(
      'is-active',
      openIds.includes('sys-settings-button') || (isReadingMode && openIds.includes('ai-config-button')),
    );
    btnPersona?.classList.toggle('is-active', openIds.includes('persona-management-button'));
    btnReader?.classList.toggle('is-active', Boolean(isReaderDockOpen?.()));
    btnCharWorld?.classList.toggle(
      'is-active',
      openIds.includes('rightNavHolder') || openIds.includes('WI-SP-button'),
    );
  }

  function refresh() {
    const doc = globalThis.document;
    if (!doc) return;

    const current = store.get();
    doc.body.classList.toggle('stm-shell-active', Boolean(current.shellEnabled));

    if (!current.shellEnabled) {
      if (rootEl) rootEl.hidden = true;
      return;
    }

    mountDom();
    rootEl.hidden = false;
    rootEl.dataset.mode = current.topbarMode;

    const ctx = getContext?.();
    const hasChat = hasActiveChatSelection(ctx);
    backBtn.hidden = !hasChat;
    if (btnReader) {
      btnReader.hidden = !(hasChat && current.modules.reader);
    }

    const meta = getCurrentEntityMeta(ctx);
    const showIdentity = hasChat && current.topbarMode === 'rp' && meta.active;
    identityBtn.hidden = !showIdentity;
    presetBtn.hidden = !showIdentity;
    if (showIdentity) {
      if (avatarImg.getAttribute('src') !== meta.thumbUrl) {
        avatarImg.src = meta.thumbUrl;
      }
      if (nameSpan.textContent !== meta.name) {
        nameSpan.textContent = meta.name;
      }
      const nextTitle = `${meta.name} · 点击查看角色档案与世界书`;
      if (identityBtn.title !== nextTitle) {
        identityBtn.title = nextTitle;
      }
      syncPresetBadge(ctx);
    }

    applySheldBoundsNow();
    syncActiveDrawerHighlights();
  }

  function destroy() {
    if (boundsRaf && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(boundsRaf);
    }
    boundsRaf = 0;
    desktopBoundsActive = false;
    drawerObserver?.disconnect();
    presetSelectObserver?.disconnect();
    sheldResizeObserver?.disconnect();
    sheldAttrObserver?.disconnect();
    drawerObserver = null;
    presetSelectObserver = null;
    sheldResizeObserver = null;
    sheldAttrObserver = null;
    globalThis.removeEventListener?.('resize', scheduleSheldBounds);
    if (boundHolder) {
      boundHolder.removeEventListener('change', onHolderChange);
      boundHolder = null;
    }
    globalThis.document?.body.classList.remove('stm-shell-active');
    rootEl?.remove();
    rootEl = null;
  }

  return {
    refresh,
    destroy,
  };
}
