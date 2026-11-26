/**
 * ST伴侣 (st-mate) · 对话页极简顶栏控制器
 * - 活跃对话中左侧常驻：‹ 返回键 + [头像 + 角色名（点击打开角色档案与世界书）] + [预设名 ▾]
 * - 右侧常驻 4 个清爽 1.5px 纯色细线图标：插头 (API连接) · 用户 (人设馆) · Aa (页面排版) · 设置 (伴侣设置)
 * - 严守原生保活铁律：绝不对 #top-settings-holder 设 display:none，保障全部原生抽屉正常弹出；
 * - 性能铁律：窄屏（<= 1000px）跳过 #sheld 几何观察器，桌面宽屏采用 rAF 合批读取，杜绝强制同步回流。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.9.6';
import {
  isQuietRoomActive,
  isQuietRoomSidebarOpen,
  toggleQuietRoomSidebar,
} from '../core/compat-bridges.js?v=0.9.6';
import { svgMarkup } from '../core/icons.js?v=0.9.6';
import { NATIVE_TOPBAR_DRAWER_ITEMS } from '../core/schema.js?v=0.9.6';
import {
  closeAllNativeDrawers,
  getCurrentEntityMeta,
  getCurrentPresetMeta,
  getOpenNativeDrawerIds,
  openNativeDrawer,
  returnToHomeScreen,
  toastMessage,
} from './host-actions.js?v=0.9.6';

const PRESET_WATCH_IDS = new Set([
  'main_api',
  'settings_preset_openai',
  'settings_preset_textgenerationwebui',
  'settings_preset_novel',
  'settings_preset',
]);

const SETTINGS_LAUNCHED_DRAWER_IDS = new Set([
  'user-settings-button',
  'extensions-settings-button',
  'backgrounds-button',
  'advanced-formatting-button',
]);

export function createTopbar({
  getContext,
  store,
  moduleBridge,
  onOpenSettings,
  onToggleCharWorldDock,
  onOpenCharWorldTab,
  onCloseCharWorldDock,
  getCharWorldActiveTab,
  isCharWorldDockOpen,
  onTogglePresetDock,
  isPresetDockOpen,
  onToggleApiDock,
  isApiDockOpen,
  onToggleReaderDock,
  isReaderDockOpen,
  onNativeDrawerOpened,
  onNativeDrawerStateChange,
  onExitPureReading,
}) {
  let rootEl = null;
  let backBtn = null;
  let identityBtn = null;
  let avatarImg = null;
  let nameSpan = null;
  let presetBtn = null;
  let presetTextSpan = null;
  let btnQuietSide = null;
  let btnApi = null;
  let btnPersona = null;
  let btnReader = null;
  let btnSettings = null;
  let drawerObserver = null;
  let presetSelectObserver = null;
  let bodyCompatObserver = null;
  let topBarResizeObserver = null;
  let sheldResizeObserver = null;
  let sheldAttrObserver = null;
  let boundsRaf = 0;
  let desktopBoundsActive = false;
  let boundHolder = null;
  let lastCharDrawerId = 'rightNavHolder';
  let lastHadOpenNativeDrawer = false;

  function applySheldBoundsNow() {
    boundsRaf = 0;
    const doc = globalThis.document;
    if (!doc) return;

    const current = store.get();
    if (current.shellEnabled && current.topbarMode === 'native') {
      syncNativeBarOffsetNow(doc);
    }

    if (!rootEl || rootEl.hidden) return;
    const win = globalThis.window || globalThis;

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
    const current = store.get();
    if (typeof onTogglePresetDock === 'function' && current.shellEnabled && current.modules.presets) {
      closeAllNativeDrawers();
      onTogglePresetDock();
      return;
    }
    onNativeDrawerOpened?.();
    const openIds = getOpenNativeDrawerIds();
    if (openIds.includes('ai-config-button')) {
      closeAllNativeDrawers();
      return;
    }
    openNativeDrawer('ai-config-button', { toggleIfOpen: false, getContext });
  }

  function handleApiClick() {
    const current = store.get();
    if (typeof onToggleApiDock === 'function' && current.shellEnabled && current.modules.api !== false) {
      closeAllNativeDrawers();
      onToggleApiDock();
      return;
    }
    onNativeDrawerOpened?.();
    const openIds = getOpenNativeDrawerIds();
    if (openIds.includes('sys-settings-button')) {
      closeAllNativeDrawers();
      return;
    }
    openNativeDrawer('sys-settings-button', { toggleIfOpen: false, getContext });
  }

  function setInlineImportant(node, prop, keyVal, keyPrio, value) {
    if (!node?.style) return;
    if (node.dataset && !Object.prototype.hasOwnProperty.call(node.dataset, keyVal)) {
      node.dataset[keyVal] = node.style.getPropertyValue?.(prop) || '';
      node.dataset[keyPrio] = node.style.getPropertyPriority?.(prop) || '';
    }
    if (typeof node.style.setProperty === 'function') {
      node.style.setProperty(prop, value, 'important');
    } else {
      node.style[prop] = value;
    }
  }

  function restoreInlineProp(node, prop, keyVal, keyPrio) {
    if (!node?.style || !node.dataset || !Object.prototype.hasOwnProperty.call(node.dataset, keyVal)) {
      return;
    }
    const origVal = node.dataset[keyVal] || '';
    const origPrio = node.dataset[keyPrio] || '';
    if (typeof node.style.removeProperty === 'function') {
      node.style.removeProperty(prop);
      if (origVal) {
        node.style.setProperty(prop, origVal, origPrio || undefined);
      }
    } else {
      node.style[prop] = origVal;
    }
    delete node.dataset[keyVal];
    delete node.dataset[keyPrio];
  }

  function syncOpenDrawerGeometry(doc, shouldLock) {
    const holder = doc?.getElementById?.('top-settings-holder');
    if (!holder || typeof holder.querySelectorAll !== 'function') return;

    const win = globalThis.window || globalThis;
    const isNarrow = typeof win.innerWidth === 'number' && win.innerWidth <= 1000;
    const movingDesktop = Boolean(!isNarrow && doc.body?.classList?.contains?.('movingUI'));
    const personaBlockTakeover = Boolean(
      doc.getElementById?.('persona-management-block')?.classList?.contains?.('ytps-takeover'),
    );

    for (const content of holder.querySelectorAll(':scope > .drawer > .drawer-content')) {
      if (!content?.style) continue;
      const isPersonaTakeover =
        content.id === 'PersonaManagement' &&
        (Boolean(content.classList?.contains?.('ytps-drawer-takeover')) || personaBlockTakeover);
      const isOpen = Boolean(
        content.classList?.contains?.('openDrawer') && !content.classList?.contains?.('pinnedOpen'),
      );
      const manuallyDraggedOnDesktop = Boolean(
        movingDesktop && content.getAttribute?.('data-dragged') === 'true',
      );
      const lockThis = Boolean(
        shouldLock &&
          (isOpen || isPersonaTakeover) &&
          (!movingDesktop || (isPersonaTakeover && !manuallyDraggedOnDesktop)),
      );

      if (lockThis) {
        setInlineImportant(content, 'top', 'stmOrigTop', 'stmOrigTopPrio', 'var(--stm-drawer-top)');
        setInlineImportant(content, 'margin-top', 'stmOrigMarginTop', 'stmOrigMarginTopPrio', '0px');
        setInlineImportant(content, 'transform', 'stmOrigTransform', 'stmOrigTransformPrio', 'none');
      } else {
        restoreInlineProp(content, 'top', 'stmOrigTop', 'stmOrigTopPrio');
        restoreInlineProp(content, 'margin-top', 'stmOrigMarginTop', 'stmOrigMarginTopPrio');
        restoreInlineProp(content, 'transform', 'stmOrigTransform', 'stmOrigTransformPrio');
      }
    }
  }

  function syncPersonaTakeoverChrome(doc, shouldSuppress) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    const ws = doc.getElementById?.('yt-persona-native-workspace');
    const wsActive = Boolean(
      shouldSuppress &&
        ws &&
        !ws.hidden &&
        !ws.hasAttribute?.('hidden') &&
        doc.getElementById?.('persona-management-block')?.classList?.contains?.('ytps-takeover'),
    );
    const targets = doc.querySelectorAll(
      '#PersonaManagement .user_stats_button, #PersonaManagement #personas_backup, #PersonaManagement #personas_restore, #PersonaManagement > .flex-container:first-child > .flex-container:first-child',
    );
    for (const node of targets) {
      if (!node?.style) continue;
      if (wsActive) {
        if (node.dataset && !Object.prototype.hasOwnProperty.call(node.dataset, 'stmOrigDisplay')) {
          node.dataset.stmOrigDisplay = node.style.getPropertyValue?.('display') || node.style.display || '';
        }
        if (typeof node.style.setProperty === 'function') {
          node.style.setProperty('display', 'none', 'important');
        } else {
          node.style.display = 'none';
        }
      } else if (node.dataset && Object.prototype.hasOwnProperty.call(node.dataset, 'stmOrigDisplay')) {
        const orig = node.dataset.stmOrigDisplay || '';
        if (typeof node.style.removeProperty === 'function') {
          node.style.removeProperty('display');
          if (orig) node.style.display = orig;
        } else {
          node.style.display = orig;
        }
        delete node.dataset.stmOrigDisplay;
      }
    }
    syncOpenDrawerGeometry(doc, Boolean(shouldSuppress));
  }

  function openPersonaStudio({ toggleIfAlreadyOpen = true } = {}) {
    onNativeDrawerOpened?.();
    const openIds = getOpenNativeDrawerIds();
    if (openIds.includes('persona-management-button')) {
      if (toggleIfAlreadyOpen) {
        closeAllNativeDrawers();
        return;
      }
    }

    const opened =
      openIds.includes('persona-management-button') ||
      openNativeDrawer('persona-management-button', { toggleIfOpen: false, getContext });
    const settings = store.get();
    if (opened && settings.modules.persona) {
      const handle = moduleBridge.getRegisteredHandle('yantai-persona-studio');
      if (handle && typeof handle.open === 'function') {
        void Promise.resolve(handle.open({ ensureNative: false, tab: 'current' }))
          .then(() => {
            syncPersonaTakeoverChrome(globalThis.document, true);
          })
          .catch(err => {
            console.warn('[ST伴侣] 唤醒人设馆工作区异常:', err);
          });
      }
      setTimeout(() => {
        syncPersonaTakeoverChrome(globalThis.document, Boolean(store.get().shellEnabled && store.get().modules.persona));
      }, 20);
    }
  }

  function handlePersonaClick() {
    openPersonaStudio({ toggleIfAlreadyOpen: true });
  }

  function handleCharWorldClick() {
    const current = store.get();
    const charEnabled = Boolean(current.modules.charCard ?? current.modules.charWorld);
    if (
      typeof onToggleCharWorldDock === 'function' &&
      current.shellEnabled &&
      charEnabled
    ) {
      closeAllNativeDrawers();
      onToggleCharWorldDock();
      return;
    }
    onNativeDrawerOpened?.();
    const openIds = getOpenNativeDrawerIds();
    if (openIds.includes('rightNavHolder') || openIds.includes('WI-SP-button')) {
      closeAllNativeDrawers();
      return;
    }
    openNativeDrawer(charEnabled ? lastCharDrawerId : 'rightNavHolder', { toggleIfOpen: false, getContext });
  }

  function syncPresetBadge(ctx = getContext?.()) {
    if (!presetBtn || !presetTextSpan) return;
    const presetMeta = getCurrentPresetMeta(ctx);
    if (presetTextSpan.textContent !== presetMeta.shortName) {
      presetTextSpan.textContent = presetMeta.shortName;
    }
    const actionHint = store.get().modules.presets ? '点击展开预设馆' : '点击切换预设';
    const tip = `当前对话预设：${presetMeta.fullName}（${actionHint}）`;
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

  function isBarElementPaintingBox(win, node) {
    if (!node || typeof win?.getComputedStyle !== 'function') return false;
    try {
      const cs = win.getComputedStyle(node);
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
        return false;
      }
      const bg = String(cs.backgroundColor || '')
        .replace(/\s+/g, '')
        .toLowerCase();
      const hasBgColor =
        Boolean(bg) &&
        bg !== 'transparent' &&
        bg !== 'rgba(0,0,0,0)' &&
        !bg.endsWith(',0)');
      const hasBgImg = Boolean(cs.backgroundImage && cs.backgroundImage !== 'none');
      const hasBorderBottom = parseFloat(cs.borderBottomWidth || '0') > 0;
      return hasBgColor || hasBgImg || hasBorderBottom;
    } catch {
      return false;
    }
  }

  function syncNativeBarOffsetNow(doc) {
    if (!doc?.documentElement?.style) return;
    const win = globalThis.window || globalThis;
    const holder = doc.getElementById?.('top-settings-holder');
    const topBar = doc.getElementById?.('top-bar');
    const holderBottom =
      typeof holder?.getBoundingClientRect === 'function'
        ? Number(holder.getBoundingClientRect()?.bottom || 0)
        : 0;
    const barBottom =
      typeof topBar?.getBoundingClientRect === 'function'
        ? Number(topBar.getBoundingClientRect()?.bottom || 0)
        : 0;
    const clearancePx = Math.round(Math.max(holderBottom, barBottom));
    const topBarPaints = isBarElementPaintingBox(win, topBar);
    const visibleBarBottom = topBarPaints
      ? Math.max(holderBottom, barBottom)
      : holderBottom > 0
        ? holderBottom
        : barBottom;
    const drawerTopPx = Math.round(visibleBarBottom);

    if (clearancePx >= 28 && clearancePx <= 180) {
      doc.documentElement.style.setProperty('--stm-native-bar-offset', `${clearancePx}px`);
    }
    if (drawerTopPx >= 28 && drawerTopPx <= 180) {
      doc.documentElement.style.setProperty('--stm-native-drawer-top', `${drawerTopPx}px`);
    }
  }

  function clearNativeBarOffset(doc) {
    doc?.documentElement?.style?.removeProperty?.('--stm-native-bar-offset');
    doc?.documentElement?.style?.removeProperty?.('--stm-native-drawer-top');
  }

  function syncNativeTopbarHiddenDrawers(doc, current) {
    if (!doc) return;
    const isNativeBar = Boolean(current?.shellEnabled && current?.topbarMode === 'native');
    const hiddenSet = new Set(
      isNativeBar && Array.isArray(current?.nativeTopbarHiddenIcons)
        ? current.nativeTopbarHiddenIcons
        : [],
    );
    for (const item of NATIVE_TOPBAR_DRAWER_ITEMS) {
      const drawerEl = doc.getElementById?.(item.id);
      if (!drawerEl) continue;
      if (hiddenSet.has(item.id)) {
        if (drawerEl.dataset) drawerEl.dataset.stmNativeHidden = '1';
        drawerEl.setAttribute?.('data-stm-native-hidden', '1');
      } else {
        if (drawerEl.dataset) delete drawerEl.dataset.stmNativeHidden;
        drawerEl.removeAttribute?.('data-stm-native-hidden');
      }
    }
  }

  function syncNativeFormatIconTitle(doc, useReaderTitle) {
    const icon = doc?.getElementById?.('advanced-formatting-button')?.querySelector?.('.drawer-icon');
    if (!icon) return;
    if (useReaderTitle) {
      if (icon.dataset && !Object.prototype.hasOwnProperty.call(icon.dataset, 'stmOrigTitle')) {
        icon.dataset.stmOrigTitle = icon.getAttribute?.('title') || icon.title || '';
      }
      icon.title = '页面排版与背景 (Aa)';
      icon.setAttribute?.('title', '页面排版与背景 (Aa)');
    } else if (icon.dataset && Object.prototype.hasOwnProperty.call(icon.dataset, 'stmOrigTitle')) {
      const orig = icon.dataset.stmOrigTitle || '';
      icon.title = orig;
      if (orig) icon.setAttribute?.('title', orig);
      else icon.removeAttribute?.('title');
      delete icon.dataset.stmOrigTitle;
    }
  }

  function syncNativeTopbarIconHighlights(doc, current) {
    const holder = doc?.getElementById?.('top-settings-holder');
    if (!holder) return;
    const activeNativeMode = Boolean(current.shellEnabled && current.topbarMode === 'native');

    const charEnabled = Boolean(current.modules?.charCard ?? current.modules?.charWorld);
    const worldEnabled = Boolean(current.modules?.worldBook ?? current.modules?.charWorld);
    const apiEnabled = Boolean(current.modules?.api !== false);

    const map = [
      ['ai-config-button', activeNativeMode && Boolean(current.modules?.presets && isPresetDockOpen?.())],
      ['sys-settings-button', activeNativeMode && Boolean(apiEnabled && isApiDockOpen?.())],
      ['advanced-formatting-button', activeNativeMode && Boolean(current.modules?.reader && isReaderDockOpen?.())],
      [
        'WI-SP-button',
        activeNativeMode &&
          Boolean(
            worldEnabled &&
              isCharWorldDockOpen?.() &&
              (getCharWorldActiveTab?.() || 'char') === 'world',
          ),
      ],
      [
        'rightNavHolder',
        activeNativeMode &&
          Boolean(
            charEnabled &&
              isCharWorldDockOpen?.() &&
              (getCharWorldActiveTab?.() || 'char') === 'char',
          ),
      ],
    ];

    for (const [drawerId, highlighted] of map) {
      const toggle = doc.getElementById?.(drawerId)?.querySelector?.('.drawer-toggle');
      toggle?.classList?.toggle?.('stm-native-icon-active', highlighted);
    }
  }

  function resolveClickedNativeToggle(target, holder) {
    if (!target || !holder) return null;
    if (typeof target.closest === 'function') {
      const viaClosest = target.closest('#top-settings-holder > .drawer > .drawer-toggle');
      if (viaClosest) return viaClosest;
    }
    let cur = target;
    while (cur && cur !== holder) {
      if (cur.classList?.contains?.('drawer-toggle') && cur.parentNode?.parentNode === holder) {
        return cur;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function onNativeHolderClickCapture(event) {
    if (globalThis.__stmBypassNativeCapture) return;
    const current = store.get();
    if (!current.shellEnabled || current.topbarMode !== 'native') return;
    if (!boundHolder) return;

    const toggleEl = resolveClickedNativeToggle(event.target, boundHolder);
    const drawerId = toggleEl?.parentNode?.id || '';
    if (!drawerId) return;

    const consume = () => {
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      onExitPureReading?.();
    };

    if (drawerId === 'ai-config-button' && current.modules.presets && typeof onTogglePresetDock === 'function') {
      consume();
      closeAllNativeDrawers();
      onTogglePresetDock();
      syncActiveDrawerHighlights();
      return;
    }

    if (drawerId === 'sys-settings-button' && current.modules.api !== false && typeof onToggleApiDock === 'function') {
      consume();
      closeAllNativeDrawers();
      onToggleApiDock();
      syncActiveDrawerHighlights();
      return;
    }

    if (drawerId === 'advanced-formatting-button' && current.modules.reader && typeof onToggleReaderDock === 'function') {
      consume();
      closeAllNativeDrawers();
      if (hasActiveChatSelection(getContext?.())) {
        onToggleReaderDock();
      } else {
        toastMessage('请先进入任意角色对话后再调整页面排版与背景', 'info');
      }
      syncActiveDrawerHighlights();
      return;
    }

    const worldEnabled = Boolean(current.modules.worldBook ?? current.modules.charWorld);
    if (drawerId === 'WI-SP-button' && worldEnabled) {
      consume();
      closeAllNativeDrawers();
      const alreadyWorld =
        Boolean(isCharWorldDockOpen?.()) && (getCharWorldActiveTab?.() || 'char') === 'world';
      if (alreadyWorld) {
        if (typeof onCloseCharWorldDock === 'function') onCloseCharWorldDock();
        else onToggleCharWorldDock?.();
      } else if (typeof onOpenCharWorldTab === 'function') {
        onOpenCharWorldTab('world');
      } else {
        onToggleCharWorldDock?.();
      }
      syncActiveDrawerHighlights();
      return;
    }

    const charEnabled = Boolean(current.modules.charCard ?? current.modules.charWorld);
    if (drawerId === 'rightNavHolder' && charEnabled) {
      consume();
      closeAllNativeDrawers();
      const alreadyChar =
        Boolean(isCharWorldDockOpen?.()) && (getCharWorldActiveTab?.() || 'char') === 'char';
      if (alreadyChar) {
        if (typeof onCloseCharWorldDock === 'function') onCloseCharWorldDock();
        else onToggleCharWorldDock?.();
      } else if (typeof onOpenCharWorldTab === 'function') {
        onOpenCharWorldTab('char');
      } else {
        onToggleCharWorldDock?.();
      }
      syncActiveDrawerHighlights();
      return;
    }

    // 其余原生图标（齿轮美化主题、背景图、拼图扩展、人设馆）：先收起伴侣下拉面板，再放行原生抽屉开合
    onExitPureReading?.();
    onNativeDrawerOpened?.();
    if (drawerId === 'persona-management-button' && current.modules.persona) {
      setTimeout(() => {
        const openIds = getOpenNativeDrawerIds();
        if (openIds.includes('persona-management-button')) {
          const handle = moduleBridge.getRegisteredHandle('yantai-persona-studio');
          if (handle && typeof handle.open === 'function') {
            void Promise.resolve(handle.open({ ensureNative: false, tab: 'current' }))
              .then(() => syncPersonaTakeoverChrome(globalThis.document, true))
              .catch(() => {});
          }
          syncPersonaTakeoverChrome(globalThis.document, true);
        }
      }, 20);
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
      if (getOpenNativeDrawerIds().length > 0) {
        closeAllNativeDrawers();
        syncActiveDrawerHighlights();
        return;
      }
      onNativeDrawerOpened?.();
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

    btnQuietSide = makeIconBtn('heart', '展开 / 收起博客小站侧边栏', () => {
      closeAllNativeDrawers();
      toggleQuietRoomSidebar(globalThis.document);
      syncQuietRoomTopbarBtn(globalThis.document);
    });
    btnQuietSide.classList.add('stm-topbar-qr-side');
    btnQuietSide.hidden = true;

    btnApi = makeIconBtn('plug', 'API连接与模型配置', handleApiClick);
    btnApi.classList.add('stm-topbar-api-btn');
    btnPersona = makeIconBtn('user', '人设馆与用户设定', handlePersonaClick);
    btnReader = makeIconBtn('typography', '页面排版与背景', () => {
      closeAllNativeDrawers();
      onToggleReaderDock?.();
    });
    btnReader.classList.add('stm-topbar-reader-btn');
    btnSettings = makeIconBtn('settings', 'ST伴侣设置中心', () => {
      const openIds = getOpenNativeDrawerIds();
      if (openIds.some(id => SETTINGS_LAUNCHED_DRAWER_IDS.has(id))) {
        closeAllNativeDrawers();
        syncActiveDrawerHighlights();
        return;
      }
      closeAllNativeDrawers();
      onOpenSettings?.();
    });
    btnSettings.classList.add('stm-topbar-settings-btn');

    right.append(btnQuietSide, btnApi, btnPersona, btnReader, btnSettings);
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

  function syncQuietRoomTopbarBtn(doc = globalThis.document) {
    if (!btnQuietSide || !doc) return;
    const current = store.get();
    const show = Boolean(
      current?.shellEnabled &&
        current?.topbarMode !== 'native' &&
        isQuietRoomActive(doc),
    );
    btnQuietSide.hidden = !show;
    if (show) {
      const sideOpen = isQuietRoomSidebarOpen(doc);
      btnQuietSide.classList.toggle('is-active', sideOpen);
      btnQuietSide.setAttribute('aria-pressed', String(sideOpen));
    } else {
      btnQuietSide.classList.remove('is-active');
      btnQuietSide.removeAttribute('aria-pressed');
    }
  }

  function observeNativeDrawersAndPresets() {
    drawerObserver?.disconnect();
    presetSelectObserver?.disconnect();
    bodyCompatObserver?.disconnect();
    topBarResizeObserver?.disconnect();
    sheldResizeObserver?.disconnect();
    sheldAttrObserver?.disconnect();
    bodyCompatObserver = null;
    topBarResizeObserver = null;
    desktopBoundsActive = false;
    globalThis.removeEventListener?.('resize', scheduleSheldBounds);
    if (boundHolder) {
      boundHolder.removeEventListener('change', onHolderChange);
      boundHolder.removeEventListener('click', onNativeHolderClickCapture, true);
      boundHolder = null;
    }

    const doc = globalThis.document;
    globalThis.addEventListener?.('resize', scheduleSheldBounds, { passive: true });

    const topBarEl = doc?.getElementById?.('top-bar');
    if (topBarEl && typeof globalThis.ResizeObserver === 'function') {
      topBarResizeObserver = new globalThis.ResizeObserver(() => {
        const cur = store.get();
        if (cur?.shellEnabled && cur?.topbarMode === 'native') {
          syncNativeBarOffsetNow(doc);
        }
      });
      topBarResizeObserver.observe(topBarEl);
    }

    if (doc?.body && typeof globalThis.MutationObserver === 'function') {
      bodyCompatObserver = new globalThis.MutationObserver(() => {
        syncQuietRoomTopbarBtn(doc);
        const cur = store.get();
        if (cur?.shellEnabled && cur?.topbarMode === 'native') {
          syncNativeBarOffsetNow(doc);
        }
      });
      bodyCompatObserver.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    }

    const holder = doc?.getElementById('top-settings-holder');
    if (!holder) return;

    holder.addEventListener('change', onHolderChange);
    holder.addEventListener('click', onNativeHolderClickCapture, true);
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
    const doc = globalThis.document;
    const shellActive = Boolean(store.get().shellEnabled);
    const openIds = getOpenNativeDrawerIds();
    const hasOpenDrawer = Boolean(shellActive && openIds.length > 0);

    doc?.body?.classList?.toggle?.('stm-native-drawer-open', hasOpenDrawer);
    syncOpenDrawerGeometry(doc, shellActive);

    if (openIds.includes('rightNavHolder')) lastCharDrawerId = 'rightNavHolder';
    if (openIds.includes('WI-SP-button')) lastCharDrawerId = 'WI-SP-button';

    if (hasOpenDrawer) {
      onExitPureReading?.();
      onNativeDrawerOpened?.();
    }

    if (backBtn) {
      const hasChat = hasActiveChatSelection(getContext?.());
      backBtn.hidden = !(hasChat || hasOpenDrawer);
      const backLabel = hasOpenDrawer ? '收起当前面板' : '返回书架首页';
      if (backBtn.title !== backLabel) {
        backBtn.title = backLabel;
        backBtn.setAttribute('aria-label', backLabel);
      }
    }

    identityBtn?.classList.toggle(
      'is-active',
      Boolean(isCharWorldDockOpen?.()) ||
        openIds.includes('rightNavHolder') ||
        openIds.includes('WI-SP-button'),
    );
    presetBtn?.classList.toggle(
      'is-active',
      Boolean(isPresetDockOpen?.()) || openIds.includes('ai-config-button'),
    );
    btnApi?.classList.toggle(
      'is-active',
      Boolean(isApiDockOpen?.()) || openIds.includes('sys-settings-button'),
    );
    btnPersona?.classList.toggle('is-active', openIds.includes('persona-management-button'));
    btnReader?.classList.toggle('is-active', Boolean(isReaderDockOpen?.()));
    btnSettings?.classList.toggle(
      'is-active',
      openIds.some(id => SETTINGS_LAUNCHED_DRAWER_IDS.has(id)),
    );
    syncNativeTopbarIconHighlights(doc, store.get());

    if (hasOpenDrawer !== lastHadOpenNativeDrawer) {
      lastHadOpenNativeDrawer = hasOpenDrawer;
      onNativeDrawerStateChange?.(hasOpenDrawer, openIds);
    } else if (hasOpenDrawer) {
      onNativeDrawerStateChange?.(true, openIds);
    }
  }

  function refresh() {
    const doc = globalThis.document;
    if (!doc) return;

    const current = store.get();
    const isNativeBar = Boolean(current.shellEnabled && current.topbarMode === 'native');
    doc.body.classList.toggle('stm-shell-active', Boolean(current.shellEnabled));
    doc.body.classList.toggle('stm-native-topbar', isNativeBar);

    if (!current.shellEnabled) {
      doc.body.classList.remove('stm-native-drawer-open', 'stm-native-topbar');
      clearNativeBarOffset(doc);
      syncNativeTopbarHiddenDrawers(doc, current);
      syncNativeFormatIconTitle(doc, false);
      syncNativeTopbarIconHighlights(doc, current);
      syncPersonaTakeoverChrome(doc, false);
      syncOpenDrawerGeometry(doc, false);
      if (lastHadOpenNativeDrawer) {
        lastHadOpenNativeDrawer = false;
        onNativeDrawerStateChange?.(false, []);
      }
      if (rootEl) rootEl.hidden = true;
      return;
    }

    syncPersonaTakeoverChrome(doc, Boolean(current.modules.persona));
    syncNativeTopbarHiddenDrawers(doc, current);
    syncNativeFormatIconTitle(doc, Boolean(isNativeBar && current.modules.reader));

    mountDom();
    if (isNativeBar) {
      rootEl.hidden = true;
      rootEl.dataset.mode = 'native';
      syncNativeBarOffsetNow(doc);
      syncActiveDrawerHighlights();
      return;
    }

    clearNativeBarOffset(doc);
    rootEl.hidden = false;
    rootEl.dataset.mode = 'rp';

    const ctx = getContext?.();
    const hasChat = hasActiveChatSelection(ctx);
    backBtn.hidden = !hasChat;
    if (btnReader) {
      btnReader.hidden = !(hasChat && current.modules.reader);
    }

    const meta = getCurrentEntityMeta(ctx);
    const showIdentity = hasChat && meta.active;
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

    syncQuietRoomTopbarBtn(doc);
    applySheldBoundsNow();
    syncActiveDrawerHighlights();
  }

  function destroy() {
    if (boundsRaf) {
      if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(boundsRaf);
      } else {
        clearTimeout(boundsRaf);
      }
      boundsRaf = 0;
    }
    desktopBoundsActive = false;
    lastHadOpenNativeDrawer = false;
    drawerObserver?.disconnect();
    presetSelectObserver?.disconnect();
    bodyCompatObserver?.disconnect();
    topBarResizeObserver?.disconnect();
    sheldResizeObserver?.disconnect();
    sheldAttrObserver?.disconnect();
    drawerObserver = null;
    presetSelectObserver = null;
    bodyCompatObserver = null;
    topBarResizeObserver = null;
    sheldResizeObserver = null;
    sheldAttrObserver = null;
    globalThis.removeEventListener?.('resize', scheduleSheldBounds);
    if (boundHolder) {
      boundHolder.removeEventListener('change', onHolderChange);
      boundHolder.removeEventListener('click', onNativeHolderClickCapture, true);
      boundHolder = null;
    }
    const doc = globalThis.document;
    clearNativeBarOffset(doc);
    syncNativeTopbarHiddenDrawers(doc, { shellEnabled: false });
    syncNativeFormatIconTitle(doc, false);
    syncNativeTopbarIconHighlights(doc, { shellEnabled: false });
    syncPersonaTakeoverChrome(doc, false);
    syncOpenDrawerGeometry(doc, false);
    doc?.body.classList.remove('stm-shell-active', 'stm-native-drawer-open', 'stm-native-topbar');
    rootEl?.remove();
    rootEl = null;
  }

  return {
    openPersona: () => openPersonaStudio({ toggleIfAlreadyOpen: false }),
    refresh,
    destroy,
  };
}
