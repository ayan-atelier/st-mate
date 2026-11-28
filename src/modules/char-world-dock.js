/**
 * ST伴侣 (st-mate) · 顶栏下拉「角色档案与清爽世界书一体页」(.stm-char-world-dock)
 * 视觉与交互准则：
 * 1. 点击顶栏左上角 [头像 + 角色名] 展开，桌面端对齐 #sheld 聊天主栏宽度，窄屏 (<=1000px) 100vw 贴边；
 * 2. 与 apiDock / presetDock / readerDock / 原生抽屉 / 设置弹窗完美互斥自动收起；关闭模块开关时无损回退酒馆原生角色/世界书抽屉；
 * 3. Tab 1「角色档案」：高清立绘大图预览、一键导出 PNG/JSON（导出前自动 flush 草稿）、专属预设绑定秒切 + 主世界书绑定、开场白预览增删改与「开局第1楼一键换开场白」、核心设定折叠编辑（V1+V2 双写）；
 * 4. Tab 2「清爽世界书」：四源生效聚合、未启用世界书强预警一键绑定、预设世界书槽位双关自检修复、人话蓝绿灯切换、绿灯空词预警、中英文逗号关键词解析与 300ms 防串书自动落盘。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.9.19';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.9.19';
import {
  closeAllNativeDrawers,
  openNativeDrawer,
  resolveAssetHref,
  returnToHomeScreen,
  toastMessage,
} from '../shell/host-actions.js?v=0.9.19';
import {
  formatSubtleImportTime,
  getBoundPresetForEntity,
  getHostPresetState,
  primeHostOpenAiModule,
  selectHostPresetByName,
  setBoundPresetForEntity,
} from './preset-backend.js?v=0.9.19';
import {
  CHAR_PROFILE_AUTO_SAVE_MS,
  WI_DEPTH_ROLE_OPTIONS,
  WI_POSITION_OPTIONS,
  WORLD_INFO_AUTO_SAVE_MS,
  applyGreetingToFirstChatFloor,
  assignWorldInfoEntryToGroup,
  bindCharacterPrimaryWorldBook,
  bindChatWorldBook,
  buildAddAlternateGreetingPatch,
  buildDeleteAlternateGreetingPatch,
  buildGreetingEditPatch,
  countUnicodeChars,
  createCharacterProfileAutoSaver,
  createHostWorldBook,
  createWorldBookAutoSaver,
  createWorldInfoBookEntry,
  createWorldInfoEntryGroup,
  cycleWorldInfoEntryTriggerMode,
  deleteCharacterGalleryItem,
  deleteHostWorldBooks,
  deleteWorldInfoBookEntry,
  deleteWorldInfoEntryGroup,
  enablePresetWorldInfoSlots,
  ensureCharacterUnshallowed,
  exportActiveCharacterCard,
  filterWorldInfoEntries,
  formatWorldInfoKeywords,
  getCoverCacheRevision,
  inspectEmbeddedCharacterBook,
  inspectPresetWorldInfoSlots,
  inspectWorldBookActivation,
  loadHostWorldBook,
  moveWorldInfoEntryGroupOrder,
  parseCharacterAddedAt,
  primeHostWorldInfoModule,
  readActiveCharacterProfile,
  readCharacterCoverGallery,
  readWorldInfoEntries,
  readWorldInfoEntryGroups,
  refreshHostWorldInfoList,
  reimportEmbeddedCharacterBook,
  renameWorldInfoEntryGroup,
  replacePrimaryCharacterAvatarFile,
  resolveGalleryImageHref,
  resolveWorldInfoActivationState,
  sanitizeHostWorldBookName,
  saveCharacterProfilePatch,
  saveHostWorldBook,
  setAllWorldInfoEntryGroupsCollapsed,
  setGlobalWorldBookEnabled,
  setWorldInfoEntryGroupCollapsed,
  setWorldInfoEntryGroupEnabled,
  toggleWorldInfoEntryEnabled,
  updateWorldInfoBookEntry,
  uploadCharacterGalleryFiles,
  writeCharacterCoverGallery,
} from './char-world-backend.js?v=0.9.19';

const CORE_FIELD_DEFS = Object.freeze([
  {
    id: 'description',
    title: '角色设定描述',
    placeholder: '填写角色外貌、身份、核心过往与人物设定…',
    rows: 11,
    showLiveCharCount: true,
    longDefault: true,
  },
  {
    id: 'personality',
    title: '性格特征',
    placeholder: '简明概括角色的性格底色、说话风格与行为动机…',
    rows: 6,
  },
  {
    id: 'scenario',
    title: '场景与背景',
    placeholder: '当前故事发生的时代、地点与开场处境…',
    rows: 6,
  },
  {
    id: 'creatorNotes',
    title: '作者注释 / 食用指南',
    placeholder: '仅供玩家阅读的食用说明、排雷或推荐玩法（不会发给 AI）…',
    rows: 6,
  },
  {
    id: 'charPrompts',
    title: '角色专属提示词',
    isDualPrompt: true,
  },
  {
    id: 'mesExample',
    title: '对话示例',
    placeholder: '<START>\n{{user}}: 你好。\n{{char}}: 抬眸看了你一眼…',
    rows: 7,
  },
]);

export function createCharWorldDock({
  getContext,
  store,
  onBeforeOpen,
  onOpenStateChange,
  onPresetChanged,
  onCharacterChanged,
}) {
  let dockEl = null;
  let headerEl = null;
  let bodyEl = null;
  let lightboxEl = null;

  let isOpen = false;
  let activeTab = 'char'; // 'char' | 'world'
  let lastOpenedAt = 0;
  let boundsRaf = 0;
  let internalBusy = false;

  // 角色档案局部交互状态
  let lastEntityKey = '';
  let lastChatSessionKey = '';
  let renamingCharName = false;
  let charNameDraft = '';
  let selectedGreetingIndex = 0;
  let greetingSectionOpen = false;
  let editingGreeting = false;
  let confirmDeleteGreeting = false;
  let exportMenuOpen = false;
  let exportingFormat = '';
  let coverStudioOpen = false;
  let uploadingCoverBusy = false;
  const openFieldSections = new Set(); // 核心设定默认全部折叠，保持角色画册感与防剧透
  const expandedEditorIds = new Set(); // 长文本编辑框「展开大框」态记忆
  const charDraftMap = new Map(); // avatar -> unsaved patch overlay

  // 世界书与未进卡角色名录局部交互状态
  let homeDirQuery = '';
  let homeDirScrollTop = 0;
  let openingEntityBusy = false;
  let selectedWorldBook = '';
  let loadedBookName = '';
  let loadedBookData = null;
  let loadingBookName = '';
  let loadSeq = 0;
  let libraryOpen = false;
  let libraryQuery = '';
  let libraryScrollTop = 0;
  let libraryBatchMode = false;
  const librarySelectedBooks = new Set();
  let confirmDeleteBookName = '';
  let confirmBatchDeleteBooks = false;
  let deletingBooksBusy = false;
  let creatingBookOpen = false;
  let newBookNameDraft = '';
  let reimportBookOpen = false;
  let reimportingBookBusy = false;
  let wiSearchQuery = '';
  let wiFilterMode = 'all'; // 'all' | 'constant' | 'keyword' | 'disabled'
  let expandedEntryUid = null;
  let confirmDeleteEntryUid = null;
  let wiGroupManageOpen = false;
  let newWiGroupDraft = '';
  let renamingWiGroupId = '';
  let renameWiGroupDraft = '';
  let confirmDeleteWiGroupId = '';
  let ungroupedWiCollapsed = false;
  const swipeSyncTimers = [];

  let saveBadgeState = { tone: 'idle', text: '自动保存' };

  const liveRefs = {
    saveBadgeEl: null,
    worldCountPillEl: null,
    wiEntryListWrap: null,
    wiFilterBarWrap: null,
  };

  const cleanups = [];

  function el(tag, className = '', text = '') {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function isTabTakeoverEnabled(tabName) {
    const s = store.get();
    if (!s.shellEnabled) return false;
    if (tabName === 'world') return Boolean(s.modules?.worldBook ?? s.modules?.charWorld);
    return Boolean(s.modules?.charCard ?? s.modules?.charWorld);
  }

  function isTakeoverEnabled() {
    const s = store.get();
    return Boolean(s.shellEnabled && (s.modules?.charCard || s.modules?.worldBook || s.modules?.charWorld));
  }

  function syncBoundsToSheldNow() {
    boundsRaf = 0;
    if (!dockEl || dockEl.hidden) return;
    const win = globalThis.window || globalThis;
    const doc = globalThis.document;
    if (!doc) return;

    const isNarrow = typeof win.innerWidth === 'number' && win.innerWidth <= 1000;
    if (isNarrow) {
      dockEl.style.removeProperty('--stm-dock-left');
      dockEl.style.removeProperty('--stm-dock-width');
      return;
    }

    const sheld = doc.getElementById('sheld');
    const rect = sheld?.getBoundingClientRect?.();
    if (rect && rect.width > 0) {
      dockEl.style.setProperty('--stm-dock-left', `${Math.round(rect.left)}px`);
      dockEl.style.setProperty('--stm-dock-width', `${Math.round(rect.width)}px`);
    }
  }

  function scheduleSheldBounds() {
    if (!isOpen || boundsRaf) return;
    const req = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16));
    boundsRaf = req(syncBoundsToSheldNow);
  }

  function setSaveBadge(tone, text) {
    saveBadgeState = { tone, text };
    if (liveRefs.saveBadgeEl) {
      liveRefs.saveBadgeEl.className = `stm-preset-save-badge is-${tone}`;
      liveRefs.saveBadgeEl.textContent = text;
    }
  }

  const charAutoSaver = createCharacterProfileAutoSaver({
    debounceMs: CHAR_PROFILE_AUTO_SAVE_MS,
    persistPatch: async record => {
      internalBusy = true;
      try {
        await saveCharacterProfilePatch(record.patch, {
          getContext,
          chid: record.chid,
          avatar: record.avatar,
        });
        const curDraft = charDraftMap.get(record.avatar);
        if (curDraft) {
          charDraftMap.delete(record.avatar);
        }
        onCharacterChanged?.();
      } finally {
        setTimeout(() => {
          internalBusy = false;
        }, 60);
      }
    },
    onStateChange: st => {
      setSaveBadge(st.tone, st.text);
    },
  });

  const worldAutoSaver = createWorldBookAutoSaver({
    debounceMs: WORLD_INFO_AUTO_SAVE_MS,
    persistBook: async (bookName, snapshot) => {
      internalBusy = true;
      try {
        await saveHostWorldBook(bookName, snapshot, { getContext });
      } finally {
        setTimeout(() => {
          internalBusy = false;
        }, 60);
      }
    },
    onStateChange: st => {
      setSaveBadge(st.tone, st.text);
    },
  });

  async function flushAllPendingSaves() {
    await Promise.all([charAutoSaver.flush(), worldAutoSaver.flush()]);
  }

  function readMergedCharProfile(ctx = getContext?.()) {
    const base = readActiveCharacterProfile(ctx);
    if (base.kind !== 'char' || !base.avatar) return base;
    const draft = charDraftMap.get(base.avatar);
    if (!draft) return base;

    const merged = {
      ...base,
      ...draft,
    };
    merged.descriptionCharCount = countUnicodeChars(merged.description);
    const alts = Array.isArray(merged.alternateGreetings)
      ? merged.alternateGreetings
      : base.alternateGreetings;
    merged.greetings = [
      {
        index: 0,
        isPrimary: true,
        altIndex: -1,
        label: '#1 主开场白',
        shortLabel: '#1 主',
        content: String(merged.firstMes ?? base.firstMes ?? ''),
      },
      ...alts.map((txt, idx) => ({
        index: idx + 1,
        isPrimary: false,
        altIndex: idx,
        label: `#${idx + 2} 备用开场白`,
        shortLabel: `#${idx + 2}`,
        content: String(txt ?? ''),
      })),
    ];
    return merged;
  }

  function queueCharacterDraftPatch(profile, patch) {
    if (!profile || profile.kind !== 'char' || !profile.avatar) return;
    const prev = charDraftMap.get(profile.avatar) || {};
    charDraftMap.set(profile.avatar, { ...prev, ...patch });
    charAutoSaver.schedule({
      chid: profile.chid,
      avatar: profile.avatar,
      patch,
    });
  }

  // ==========================================================================
  // 高清角色立绘大图预览浮层 (.stm-portrait-lightbox)
  // ==========================================================================

  function emitOverlayChange() {
    try {
      if (typeof globalThis.CustomEvent === 'function') {
        globalThis.dispatchEvent?.(new globalThis.CustomEvent('stm:overlay-change'));
      }
    } catch {
      // ignore
    }
  }

  function closePortraitLightbox() {
    let closed = false;
    if (lightboxEl) {
      lightboxEl.remove();
      lightboxEl = null;
      closed = true;
    }
    const residual = globalThis.document?.getElementById?.('stm-portrait-lightbox');
    if (residual) {
      residual.remove?.();
      closed = true;
    }
    if (closed) {
      emitOverlayChange();
    }
    return closed;
  }

  function openPortraitLightbox(imageUrl, titleText = '') {
    const doc = globalThis.document;
    if (!doc || !imageUrl) return;
    closePortraitLightbox();

    const overlay = el('div', 'stm-portrait-lightbox');
    overlay.id = 'stm-portrait-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${titleText || '角色'}高清立绘预览`);

    const frame = el('div', 'stm-portrait-lightbox-frame');
    const img = el('img', 'stm-portrait-lightbox-img');
    img.src = imageUrl;
    img.alt = titleText || '角色立绘';

    const captionBar = el('div', 'stm-portrait-lightbox-bar');
    captionBar.append(el('span', 'stm-portrait-lightbox-title', titleText || '角色立绘'));
    const closeBtn = el('button', 'stm-pill-btn', '关闭预览');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', evt => {
      evt.stopPropagation();
      closePortraitLightbox();
    });
    captionBar.append(closeBtn);

    frame.append(img, captionBar);
    overlay.append(frame);
    overlay.addEventListener('click', evt => {
      if (evt.target === overlay) {
        closePortraitLightbox();
      }
    });

    lightboxEl = overlay;
    doc.body.append(overlay);
    emitOverlayChange();
    closeBtn.focus?.();
  }

  // ==========================================================================
  // 世界书异步按需加载与切换控制
  // ==========================================================================

  function clearSwipeSyncTimers() {
    while (swipeSyncTimers.length > 0) {
      clearTimeout(swipeSyncTimers.pop());
    }
  }

  function isSelfSavingOrEditingWorld() {
    if (internalBusy || worldAutoSaver.hasPending() || worldAutoSaver.isSaving()) {
      return true;
    }
    const activeEl = globalThis.document?.activeElement;
    if (
      activeEl &&
      dockEl?.contains(activeEl) &&
      typeof activeEl.closest === 'function' &&
      activeEl.closest('.stm-wi-entry-editor') &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT')
    ) {
      return true;
    }
    return false;
  }

  async function ensureWorldBookLoaded(
    bookName,
    { forceReload = false, silentLoading = false } = {},
  ) {
    const clean = typeof bookName === 'string' ? bookName.trim() : '';
    if (!clean) {
      loadedBookName = '';
      loadedBookData = null;
      loadingBookName = '';
      return null;
    }
    if (!forceReload && loadedBookName === clean && loadedBookData) {
      return loadedBookData;
    }

    const hasExistingSameBook = loadedBookName === clean && Boolean(loadedBookData);
    const seq = ++loadSeq;
    loadingBookName = clean;
    if (isOpen && activeTab === 'world' && !silentLoading && !hasExistingSameBook) {
      renderBodyPreservingScroll();
    }

    try {
      const data = await loadHostWorldBook(clean, { getContext });
      if (seq !== loadSeq) return null;
      loadedBookName = clean;
      loadedBookData = data && typeof data === 'object' ? data : { entries: {} };
      loadingBookName = '';
      if (isOpen && activeTab === 'world') {
        renderBodyPreservingScroll();
      }
      return loadedBookData;
    } catch (err) {
      if (seq !== loadSeq) return null;
      loadingBookName = '';
      loadedBookName = clean;
      loadedBookData = { entries: {} };
      toastMessage(`读取世界书「${clean}」失败`, 'warning');
      if (isOpen && activeTab === 'world') {
        renderBodyPreservingScroll();
      }
      return null;
    }
  }

  /**
   * 响应外部脚本（如角色卡开场白 AU 自动开关、TavernHelper.updateWorldbookWith、/setentryfield 或原生世界书面板）
   * 触发的 `WORLDINFO_UPDATED`：立即失效或热替换内存副本，杜绝清爽世界书锁死旧快照甚至反覆写磁盘！
   */
  function isSameWorldBookName(a, b) {
    const cleanA = typeof a === 'string' ? a.trim() : '';
    const cleanB = typeof b === 'string' ? b.trim() : '';
    if (!cleanA || !cleanB) return false;
    if (cleanA === cleanB) return true;
    const sanA = sanitizeHostWorldBookName(cleanA);
    const sanB = sanitizeHostWorldBookName(cleanB);
    return Boolean(sanA && sanB && sanA === sanB);
  }

  function handleWorldInfoUpdated(updatedBookName = '', updatedData = null) {
    if (isSelfSavingOrEditingWorld()) {
      return;
    }
    const cleanUpdated = typeof updatedBookName === 'string' ? updatedBookName.trim() : '';
    const affectsCurrent =
      !cleanUpdated ||
      isSameWorldBookName(cleanUpdated, loadedBookName) ||
      isSameWorldBookName(cleanUpdated, selectedWorldBook);

    if (!affectsCurrent) {
      if (isOpen) {
        renderHeader();
        if (activeTab === 'world' && libraryOpen) {
          renderBodyPreservingScroll();
        }
      }
      return;
    }

    if (!isOpen || activeTab !== 'world') {
      if (
        cleanUpdated &&
        isSameWorldBookName(cleanUpdated, loadedBookName) &&
        updatedData &&
        typeof updatedData === 'object' &&
        updatedData.entries &&
        typeof updatedData.entries === 'object'
      ) {
        loadedBookData = structuredClone(updatedData);
      } else {
        loadedBookName = '';
        loadedBookData = null;
        loadingBookName = '';
      }
      if (isOpen) {
        renderHeader();
      }
      return;
    }

    if (
      cleanUpdated &&
      isSameWorldBookName(cleanUpdated, selectedWorldBook) &&
      updatedData &&
      typeof updatedData === 'object' &&
      updatedData.entries &&
      typeof updatedData.entries === 'object'
    ) {
      loadedBookName = selectedWorldBook;
      loadedBookData = structuredClone(updatedData);
      loadingBookName = '';
      renderHeader();
      renderBodyPreservingScroll();
      return;
    }

    renderHeader();
    if (selectedWorldBook) {
      void ensureWorldBookLoaded(selectedWorldBook, {
        forceReload: true,
        silentLoading: true,
      });
    } else {
      renderBodyPreservingScroll();
    }
  }

  /**
   * 响应消息左右切换 / 开场白跳转 (`MESSAGE_SWIPED`)：
   * 部分角色卡脚本通过 `TavernHelper.updateWorldbookWith` 改写 `worldInfoCache` 时采用防抖落盘（`WORLDINFO_UPDATED` 延后约 2 秒触发），
   * 此处立即失效后台旧缓存并在面板开启态分两拍从 `worldInfoCache` 静默重读，实现切开场白即刻同步开关状态。
   */
  function handleExternalSwipeSync() {
    clearSwipeSyncTimers();
    if (isSelfSavingOrEditingWorld()) return;

    if (!isOpen || activeTab !== 'world') {
      loadedBookName = '';
      loadedBookData = null;
      loadingBookName = '';
      return;
    }

    for (const delayMs of [90, 480]) {
      const tid = setTimeout(() => {
        if (!isOpen || activeTab !== 'world' || isSelfSavingOrEditingWorld()) return;
        if (selectedWorldBook) {
          void ensureWorldBookLoaded(selectedWorldBook, {
            forceReload: true,
            silentLoading: true,
          });
        }
      }, delayMs);
      swipeSyncTimers.push(tid);
    }
  }

  async function selectWorldBookAndLoad(nextBookName, { switchToWorldTab = false } = {}) {
    const clean = typeof nextBookName === 'string' ? nextBookName.trim() : '';
    await flushAllPendingSaves();
    if (switchToWorldTab && !isTabTakeoverEnabled('world')) {
      close();
      fallbackOpenNativeDrawer('world', false);
      return;
    }
    selectedWorldBook = clean;
    expandedEntryUid = null;
    confirmDeleteEntryUid = null;
    creatingBookOpen = false;
    if (switchToWorldTab) {
      activeTab = 'world';
    }
    renderHeader();
    renderBody();
    if (clean) {
      await ensureWorldBookLoaded(clean);
    }
  }

  // ==========================================================================
  // 顶部双页签栏 (.stm-cw-header)
  // ==========================================================================

  function renderHeader() {
    if (!headerEl) return;
    const doc = globalThis.document;
    const ctx = getContext?.();
    const profile = readMergedCharProfile(ctx);
    const activation = resolveWorldInfoActivationState({ getContext });

    headerEl.replaceChildren();

    const tabsWrap = el('div', 'stm-cw-tabs');
    tabsWrap.setAttribute('role', 'tablist');

    const charTabBtn = el(
      'button',
      `stm-cw-tab-btn${activeTab === 'char' ? ' is-active' : ''}`,
    );
    charTabBtn.type = 'button';
    charTabBtn.setAttribute('role', 'tab');
    charTabBtn.setAttribute('aria-selected', String(activeTab === 'char'));
    charTabBtn.append(
      createIconNode(doc, profile.kind === 'group' ? 'users' : 'idcard', 'stm-tab-icon'),
      el(
        'span',
        '',
        profile.kind === 'group' ? '群聊档案' : profile.active ? '角色档案' : '角色名录',
      ),
    );
    charTabBtn.addEventListener('click', async () => {
      if (!isTabTakeoverEnabled('char')) {
        await flushAllPendingSaves();
        close();
        fallbackOpenNativeDrawer('char', false);
        return;
      }
      if (activeTab === 'char') return;
      await flushAllPendingSaves();
      activeTab = 'char';
      renderHeader();
      renderBody();
    });

    const worldTabBtn = el(
      'button',
      `stm-cw-tab-btn${activeTab === 'world' ? ' is-active' : ''}`,
    );
    worldTabBtn.type = 'button';
    worldTabBtn.setAttribute('role', 'tab');
    worldTabBtn.setAttribute('aria-selected', String(activeTab === 'world'));
    const activeCount = activation.activeBooks.length;
    const countPill = el(
      'span',
      `stm-cw-tab-pill${activeCount > 0 ? ' is-live' : ''}`,
      activeCount > 0 ? `${activeCount} 本生效` : '未启用',
    );
    liveRefs.worldCountPillEl = countPill;
    worldTabBtn.append(
      createIconNode(doc, 'globe', 'stm-tab-icon'),
      el('span', '', '世界书'),
      countPill,
    );
    worldTabBtn.addEventListener('click', async () => {
      if (!isTabTakeoverEnabled('world')) {
        await flushAllPendingSaves();
        close();
        fallbackOpenNativeDrawer('world', false);
        return;
      }
      if (activeTab === 'world') return;
      await flushAllPendingSaves();
      activeTab = 'world';
      if (!selectedWorldBook && activation.defaultBookName) {
        selectedWorldBook = activation.defaultBookName;
      }
      renderHeader();
      renderBody();
      if (selectedWorldBook) {
        void ensureWorldBookLoaded(selectedWorldBook, {
          forceReload: !worldAutoSaver.hasPending() && !worldAutoSaver.isSaving(),
          silentLoading: true,
        });
      }
    });

    tabsWrap.append(charTabBtn, worldTabBtn);

    const rightWrap = el('div', 'stm-cw-header-right');
    const saveBadge = el(
      'span',
      `stm-preset-save-badge is-${saveBadgeState.tone}`,
      saveBadgeState.text,
    );
    liveRefs.saveBadgeEl = saveBadge;

    const closeBtn = el('button', 'stm-dock-close-btn');
    closeBtn.type = 'button';
    closeBtn.title = '收起面板';
    closeBtn.setAttribute('aria-label', '收起角色与世界书一体页');
    closeBtn.innerHTML = svgMarkup('close');
    closeBtn.addEventListener('click', () => close());

    rightWrap.append(saveBadge);

    if (store.get().topbarMode === 'native' && hasActiveChatSelection(ctx)) {
      const homeBtn = el('button', 'stm-pill-btn stm-cw-home-btn');
      homeBtn.type = 'button';
      homeBtn.title = '关闭当前聊天并退回角色书架首页';
      homeBtn.innerHTML = `<span class="stm-inline-svg" aria-hidden="true">${svgMarkup('shelf')}</span><span>回书架</span>`;
      homeBtn.addEventListener('click', async () => {
        await flushAllPendingSaves();
        close();
        await returnToHomeScreen(getContext);
      });
      rightWrap.append(homeBtn);
    }

    rightWrap.append(closeBtn);
    headerEl.append(tabsWrap, rightWrap);
  }

  // ==========================================================================
  // Tab 1：「角色档案」渲染（单人角色卡 + 群聊模式）
  // ==========================================================================

  function buildEntityPresetBindControl(ctx, profile) {
    const doc = globalThis.document;
    const ps = store.get().presetStudio;
    const hostPresetState = getHostPresetState({ getContext });
    const boundPreset = getBoundPresetForEntity(ps, ctx);
    const defaultPreset = ps.defaultPreset || '';

    const box = el('div', 'stm-cw-bind-box');
    const head = el('div', 'stm-cw-bind-head');
    const leftTitle = el('span', 'stm-cw-bind-label');
    leftTitle.append(
      createIconNode(doc, 'sliders', 'stm-row-icon'),
      el('span', '', profile.kind === 'group' ? '群专属预设绑定' : '专属预设绑定'),
    );
    const statusChip = el(
      'span',
      `stm-cw-mini-badge${boundPreset ? ' is-accent' : ''}`,
      boundPreset ? '已绑专属' : '跟随默认',
    );
    head.append(leftTitle, statusChip);

    const select = el('select', 'stm-cw-select');
    const followOpt = el(
      'option',
      '',
      defaultPreset
        ? `跟随全局默认（${defaultPreset}）`
        : '跟随全局默认（未指定，保持自由切换）',
    );
    followOpt.value = '';
    followOpt.selected = !boundPreset;
    select.append(followOpt);

    const names = [...hostPresetState.presetNames];
    if (boundPreset && !names.includes(boundPreset)) {
      const missingOpt = el('option', '', `${boundPreset}（预设已缺失）`);
      missingOpt.value = boundPreset;
      missingOpt.selected = true;
      select.append(missingOpt);
    }

    for (const pName of names) {
      const opt = el(
        'option',
        '',
        pName === hostPresetState.activePreset ? `${pName}（当前使用）` : pName,
      );
      opt.value = pName;
      opt.selected = boundPreset === pName;
      select.append(opt);
    }

    select.addEventListener('change', async () => {
      const targetPreset = select.value;
      const nextStudio = setBoundPresetForEntity(store.get().presetStudio, ctx, targetPreset);
      store.update({ presetStudio: nextStudio }, { silent: true });

      const toActivate = targetPreset || nextStudio.defaultPreset || '';
      if (toActivate) {
        const res = await selectHostPresetByName(toActivate, { getContext });
        onPresetChanged?.();
        if (res?.ok) {
          toastMessage(
            targetPreset
              ? `已为「${profile.name}」绑定并切换预设：${targetPreset}`
              : `已解除专属预设，回退至全局默认：${toActivate}`,
            'success',
          );
        }
      } else {
        onPresetChanged?.();
        toastMessage(`已解除「${profile.name}」的专属预设绑定`, 'info');
      }
      renderBodyPreservingScroll();
    });

    box.append(head, select);
    return box;
  }

  function buildInlineChatWorldBindRow(ctx, activation, { includeWorldRowClass = false } = {}) {
    const doc = globalThis.document;
    const currentChatBook = String(activation?.chatBook || '').trim();
    const row = el(
      'div',
      `stm-cw-inline-bind-row${includeWorldRowClass ? ' is-world-row' : ''} is-chat-world-row`,
    );
    const label = el('span', 'stm-cw-inline-bind-label');
    label.title = '仅对当前这条聊天存档生效（每条存档可绑定 1 本聊天世界书）';
    label.append(
      createIconNode(doc, 'globe', 'stm-row-icon'),
      el('span', '', '聊天世界书'),
    );

    const right = el('div', 'stm-cw-inline-world-right');
    const chatSelect = el('select', 'stm-cw-select is-clean stm-cw-chat-world-select');
    chatSelect.setAttribute('aria-label', '当前聊天世界书');

    const emptyOpt = el(
      'option',
      '',
      currentChatBook ? '解除绑定聊天世界书' : '未绑定（仅当前存档生效）',
    );
    emptyOpt.value = '';
    emptyOpt.selected = !currentChatBook;
    chatSelect.append(emptyOpt);

    const names = Array.isArray(activation?.worldNames) ? activation.worldNames : [];
    if (currentChatBook && names.length > 0 && !names.includes(currentChatBook)) {
      const missingOpt = el('option', '', `${currentChatBook}（书目缺失）`);
      missingOpt.value = currentChatBook;
      missingOpt.selected = true;
      chatSelect.append(missingOpt);
    }

    const candidates = names.length > 0 ? names : currentChatBook ? [currentChatBook] : [];
    for (const wName of candidates) {
      const opt = el('option', '', wName);
      opt.value = wName;
      opt.selected = currentChatBook === wName;
      chatSelect.append(opt);
    }

    chatSelect.addEventListener('change', async () => {
      const prevBook = currentChatBook;
      const nextBook = chatSelect.value;
      await flushAllPendingSaves();
      try {
        const res = await bindChatWorldBook(nextBook, { getContext });
        if (nextBook) {
          selectedWorldBook = nextBook;
          setSaveBadge('ok', `已绑聊天书：${nextBook}`);
          const memTip = res.memoryCoexistHint
            ? '（已开记忆增强，将与记忆条目共用当前聊天书槽位）'
            : '';
          toastMessage(`已为当前聊天绑定世界书：${nextBook}${memTip}`, 'success');
        } else {
          if (!selectedWorldBook || selectedWorldBook === prevBook) {
            selectedWorldBook =
              resolveWorldInfoActivationState({ getContext }).defaultBookName || '';
          }
          setSaveBadge('ok', '已解除聊天世界书绑定');
          toastMessage('已解除当前聊天的世界书绑定', 'info');
        }
        renderHeader();
        renderBodyPreservingScroll();
      } catch (err) {
        toastMessage(err?.message || '绑定聊天世界书失败', 'error');
      }
    });
    right.append(chatSelect);

    if (currentChatBook) {
      const jumpBtn = el('button', 'stm-cw-inline-link', '查看 ›');
      jumpBtn.type = 'button';
      jumpBtn.addEventListener('click', () => {
        void selectWorldBookAndLoad(currentChatBook, { switchToWorldTab: true });
      });
      right.append(jumpBtn);
    }

    row.append(label, right);
    return row;
  }

  function renderGroupProfileView(container, ctx, profile, activation) {
    const doc = globalThis.document;

    // 1. 群聊顶部卡
    const hero = el('div', 'stm-cw-hero');
    const portraitBtn = el('button', 'stm-cw-portrait-btn');
    portraitBtn.type = 'button';
    portraitBtn.title = '点击放大查看群头像';
    const img = el('img', 'stm-cw-portrait-img');
    img.src = profile.portraitUrl || profile.thumbUrl;
    img.alt = profile.name;
    const zoomHint = el('span', 'stm-cw-portrait-zoom');
    zoomHint.innerHTML = svgMarkup('maximize');
    portraitBtn.append(img, zoomHint);
    portraitBtn.addEventListener('click', () => {
      openPortraitLightbox(profile.portraitUrl || profile.thumbUrl, profile.name);
    });

    const metaCol = el('div', 'stm-cw-hero-meta');
    const titleRow = el('div', 'stm-cw-hero-title-row');
    titleRow.append(
      el('h3', 'stm-cw-char-name', profile.name),
      el('span', 'stm-cw-mini-badge is-accent', `群聊 · ${profile.members.length} 人`),
    );

    const subText = el(
      'p',
      'stm-cw-hero-sub',
      `活跃成员 ${profile.members.filter(m => !m.disabled).length} 人 · 当前生效世界书 ${
        activation.activeBooks.length
      } 本`,
    );

    const actionRow = el('div', 'stm-cw-export-row');
    const jumpWorldBtn = el('button', 'stm-cw-primary-btn');
    jumpWorldBtn.type = 'button';
    jumpWorldBtn.append(
      createIconNode(doc, 'globe', 'stm-row-icon'),
      el('span', '', '管理群聊生效世界书'),
    );
    jumpWorldBtn.addEventListener('click', () => {
      void selectWorldBookAndLoad(selectedWorldBook || activation.defaultBookName, {
        switchToWorldTab: true,
      });
    });

    const nativeGroupBtn = el('button', 'stm-ghost-link', '打开原生群聊面板 ›');
    nativeGroupBtn.type = 'button';
    nativeGroupBtn.addEventListener('click', () => {
      close();
      openNativeDrawer('rightNavHolder', { getContext });
    });

    actionRow.append(jumpWorldBtn, nativeGroupBtn);
    metaCol.append(titleRow, subText, actionRow);
    hero.append(portraitBtn, metaCol);
    container.append(hero);

    // 2. 群专属预设绑定 + 群聊生效世界书速览
    const bindGrid = el('div', 'stm-cw-bind-grid');
    bindGrid.append(buildEntityPresetBindControl(ctx, profile));

    const worldSummaryBox = el('div', 'stm-cw-bind-box');
    const wHead = el('div', 'stm-cw-bind-head');
    const wLabel = el('span', 'stm-cw-bind-label');
    wLabel.append(createIconNode(doc, 'globe', 'stm-row-icon'), el('span', '', '群聊生效世界书'));
    const toWorldLink = el('button', 'stm-cw-inline-link', '去世界书页查看 ›');
    toWorldLink.type = 'button';
    toWorldLink.addEventListener('click', () => {
      void selectWorldBookAndLoad(selectedWorldBook || activation.defaultBookName, {
        switchToWorldTab: true,
      });
    });
    wHead.append(wLabel, toWorldLink);

    const wSummaryBtn = el(
      'button',
      'stm-cw-world-summary-btn',
      activation.activeBooks.length > 0
        ? activation.activeBooks.map(b => `${b.name} (${b.badgeLabel})`).join(' · ')
        : '暂未启用群聊/全局世界书（点击前往启用）',
    );
    wSummaryBtn.type = 'button';
    wSummaryBtn.addEventListener('click', () => {
      void selectWorldBookAndLoad(selectedWorldBook || activation.defaultBookName, {
        switchToWorldTab: true,
      });
    });
    worldSummaryBox.append(
      wHead,
      wSummaryBtn,
      buildInlineChatWorldBindRow(ctx, activation, { includeWorldRowClass: false }),
    );
    bindGrid.append(worldSummaryBox);
    container.append(bindGrid);

    // 3. 群成员速览
    const memberCard = el('div', 'stm-cw-card');
    const mHead = el('div', 'stm-cw-card-head');
    const mTitle = el('span', 'stm-cw-card-title');
    mTitle.append(
      createIconNode(doc, 'users', 'stm-row-icon'),
      el('strong', '', '群聊成员速览'),
    );
    mHead.append(mTitle, el('span', 'stm-cw-muted-note', `共 ${profile.members.length} 位角色`));
    memberCard.append(mHead);

    if (profile.members.length === 0) {
      memberCard.append(el('div', 'stm-cw-empty-inline', '当前群聊尚未添加角色成员'));
    } else {
      const grid = el('div', 'stm-cw-member-grid');
      for (const m of profile.members) {
        const chip = el('div', `stm-cw-member-chip${m.disabled ? ' is-muted' : ''}`);
        const av = el('img', 'stm-cw-member-avatar');
        av.src = m.thumbUrl;
        av.alt = m.name;
        const info = el('div', 'stm-cw-member-info');
        info.append(
          el('span', 'stm-cw-member-name', m.name),
          el(
            'small',
            'stm-cw-member-sub',
            m.disabled
              ? '已静音暂停发言'
              : m.primaryWorld
                ? `角色书：${m.primaryWorld}`
                : '参与发言中',
          ),
        );
        chip.append(av, info);
        grid.append(chip);
      }
      memberCard.append(grid);
    }

    container.append(memberCard);
  }

  function buildInlinePresetBindRow(ctx, profile) {
    const doc = globalThis.document;
    const ps = store.get().presetStudio;
    const hostPresetState = getHostPresetState({ getContext });
    const boundPreset = getBoundPresetForEntity(ps, ctx);
    const defaultPreset = ps.defaultPreset || '';

    const row = el('div', 'stm-cw-inline-bind-row');
    const leftLabel = el('span', 'stm-cw-inline-bind-label');
    leftLabel.append(
      createIconNode(doc, 'sliders', 'stm-row-icon'),
      el('span', '', '绑定预设'),
    );

    const select = el('select', 'stm-cw-select is-clean');
    select.setAttribute('aria-label', '绑定专属预设');
    const followOpt = el(
      'option',
      '',
      defaultPreset ? `跟随默认（${defaultPreset}）` : '跟随默认（自由切换）',
    );
    followOpt.value = '';
    followOpt.selected = !boundPreset;
    select.append(followOpt);

    const names = [...hostPresetState.presetNames];
    if (boundPreset && !names.includes(boundPreset)) {
      const missingOpt = el('option', '', `${boundPreset}（已缺失）`);
      missingOpt.value = boundPreset;
      missingOpt.selected = true;
      select.append(missingOpt);
    }

    for (const pName of names) {
      const opt = el(
        'option',
        '',
        pName === hostPresetState.activePreset ? `${pName}（当前）` : pName,
      );
      opt.value = pName;
      opt.selected = boundPreset === pName;
      select.append(opt);
    }

    select.addEventListener('change', async () => {
      const targetPreset = select.value;
      const nextStudio = setBoundPresetForEntity(store.get().presetStudio, ctx, targetPreset);
      store.update({ presetStudio: nextStudio }, { silent: true });

      const toActivate = targetPreset || nextStudio.defaultPreset || '';
      if (toActivate) {
        const res = await selectHostPresetByName(toActivate, { getContext });
        onPresetChanged?.();
        if (res?.ok) {
          toastMessage(
            targetPreset
              ? `已为「${profile.name}」绑定并切换预设：${targetPreset}`
              : `已解除专属预设，回退至全局默认：${toActivate}`,
            'success',
          );
        }
      } else {
        onPresetChanged?.();
        toastMessage(`已解除「${profile.name}」的专属预设绑定`, 'info');
      }
      renderBodyPreservingScroll();
    });

    row.append(leftLabel, select);
    return row;
  }

  function renderSingleCharProfileView(container, ctx, profile, activation) {
    const doc = globalThis.document;

    if (selectedGreetingIndex >= profile.greetings.length) {
      selectedGreetingIndex = Math.max(0, profile.greetings.length - 1);
    }

    // 1. 无外框画册舞台（手机端：美图 -> 角色名 -> Tag -> 统计 -> 导出/绑定预设/按需世界书；电脑端：左美图右信息）
    const galleryState = readCharacterCoverGallery(ctx, profile.avatar);
    const rev = getCoverCacheRevision();
    const rawPrimaryArt = profile.portraitUrl || profile.thumbUrl || '';
    const primaryArtUrl =
      rawPrimaryArt && rev > 0
        ? `${rawPrimaryArt}${rawPrimaryArt.includes('?') ? '&' : '?'}stm_rev=${rev}`
        : rawPrimaryArt;

    const activeGalleryItem =
      galleryState.selectedId !== 'primary'
        ? galleryState.items.find(it => it.id === galleryState.selectedId) || null
        : null;
    const activeArtUrl = activeGalleryItem
      ? resolveGalleryImageHref(activeGalleryItem.url) || primaryArtUrl
      : primaryArtUrl;
    const activeCrop = activeGalleryItem
      ? { x: activeGalleryItem.x, y: activeGalleryItem.y }
      : galleryState.primaryCrop;

    const hero = el('div', 'stm-cw-hero is-char-showcase');

    const portraitStage = el('div', 'stm-cw-portrait-stage');
    if (activeArtUrl) {
      const ambientBg = el('div', 'stm-cw-portrait-ambient');
      ambientBg.style.setProperty('--stm-char-art', `url(${JSON.stringify(activeArtUrl)})`);
      portraitStage.append(ambientBg);
    }

    const portraitBtn = el('button', 'stm-cw-portrait-btn is-showcase');
    portraitBtn.type = 'button';
    portraitBtn.title = `点击查看高清完整原图${profile.avatar ? ` (${profile.avatar})` : ''}`;
    const portraitImg = el('img', 'stm-cw-portrait-img');
    portraitImg.src = activeArtUrl;
    portraitImg.alt = profile.name;
    portraitImg.style.objectPosition = `${activeCrop.x}% ${activeCrop.y}%`;
    const zoomIcon = el('span', 'stm-cw-portrait-zoom');
    zoomIcon.innerHTML = svgMarkup('maximize');
    portraitBtn.append(portraitImg, zoomIcon);
    portraitBtn.addEventListener('click', () => {
      openPortraitLightbox(activeArtUrl, profile.name);
    });
    portraitStage.append(portraitBtn);

    const metaCol = el('div', 'stm-cw-hero-meta');
    const heroTopBlock = el('div', 'stm-cw-hero-headblock');
    const titleRow = el('div', 'stm-cw-hero-title-row');
    if (renamingCharName) {
      const renameRow = el('div', 'stm-cw-rename-row');
      const nameInput = el('input', 'stm-cw-input stm-cw-name-input');
      nameInput.type = 'text';
      nameInput.value = charNameDraft;
      nameInput.placeholder = '输入角色名称…';
      nameInput.setAttribute('aria-label', '角色名称');

      const finishCharRename = async () => {
        const nextName = nameInput.value.trim();
        if (nextName && nextName !== '.') {
          queueCharacterDraftPatch(profile, { name: nextName });
        }
        await flushAllPendingSaves();
        renamingCharName = false;
        onCharacterChanged?.();
        renderHeader();
        renderBodyPreservingScroll();
      };

      nameInput.addEventListener('input', () => {
        charNameDraft = nameInput.value;
        const trimmed = nameInput.value.trim();
        if (trimmed && trimmed !== '.') {
          queueCharacterDraftPatch(profile, { name: trimmed });
        }
      });

      nameInput.addEventListener('keydown', evt => {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          void finishCharRename();
        } else if (evt.key === 'Escape') {
          evt.stopPropagation();
          renamingCharName = false;
          renderBodyPreservingScroll();
        }
      });

      const okRenameBtn = el('button', 'stm-cw-primary-btn stm-cw-rename-save', '完成');
      okRenameBtn.type = 'button';
      okRenameBtn.addEventListener('click', () => void finishCharRename());

      const cancelRenameBtn = el('button', 'stm-cw-mini-btn', '取消');
      cancelRenameBtn.type = 'button';
      cancelRenameBtn.addEventListener('click', () => {
        renamingCharName = false;
        renderBodyPreservingScroll();
      });

      renameRow.append(nameInput, okRenameBtn, cancelRenameBtn);
      titleRow.append(renameRow);
      setTimeout(() => nameInput.focus?.(), 0);
    } else {
      titleRow.append(el('h3', 'stm-cw-char-name', profile.name));
      const renameBtn = el('button', 'stm-cw-rename-btn');
      renameBtn.type = 'button';
      renameBtn.title = '修改角色名称（自动同步顶栏与角色卡）';
      renameBtn.setAttribute('aria-label', '修改角色名称');
      renameBtn.append(createIconNode(doc, 'edit', 'stm-inline-svg'), el('span', '', '改名'));
      renameBtn.addEventListener('click', () => {
        renamingCharName = true;
        charNameDraft = profile.name;
        renderBodyPreservingScroll();
      });

      const totalCovers = 1 + galleryState.items.length;
      const coverBtn = el(
        'button',
        `stm-cw-rename-btn stm-cw-cover-trigger${coverStudioOpen ? ' is-active' : ''}`,
      );
      coverBtn.type = 'button';
      coverBtn.title = '更换角色图、调整封面焦点或添加多张封面开启书架随机轮换';
      coverBtn.setAttribute('aria-expanded', String(coverStudioOpen));
      coverBtn.append(
        createIconNode(doc, 'image', 'stm-inline-svg'),
        el('span', '', totalCovers > 1 ? `换图 (${totalCovers})` : '换图'),
      );
      coverBtn.addEventListener('click', () => {
        coverStudioOpen = !coverStudioOpen;
        renderBodyPreservingScroll();
      });

      titleRow.append(renameBtn, coverBtn);
    }
    heroTopBlock.append(titleRow);

    // 角色 Tag 标签行（紧随角色名正下方，素雅轻标签）
    if (Array.isArray(profile.tags) && profile.tags.length > 0) {
      const tagsRow = el('div', 'stm-cw-tags-row');
      for (const tagText of profile.tags.slice(0, 8)) {
        tagsRow.append(el('span', 'stm-cw-tag-pill', tagText));
      }
      if (profile.tags.length > 8) {
        tagsRow.append(el('span', 'stm-cw-tag-pill is-more', `+${profile.tags.length - 8}`));
      }
      heroTopBlock.append(tagsRow);
    }

    const totalSettingChars =
      profile.descriptionCharCount +
      countUnicodeChars(profile.personality) +
      countUnicodeChars(profile.scenario) +
      countUnicodeChars(profile.mesExample);
    const addedFmt = formatSubtleImportTime(profile.addedAt);
    const statSub = el(
      'p',
      'stm-cw-hero-sub',
      addedFmt.shortText
        ? `设定 ${totalSettingChars} 字 · 开场白 ${profile.greetings.length} 条 · ${addedFmt.shortText} 导入`
        : `设定 ${totalSettingChars} 字 · 开场白 ${profile.greetings.length} 条`,
    );
    if (addedFmt.fullTitle) {
      statSub.title = addedFmt.fullTitle;
    }
    heroTopBlock.append(statSub);

    // 2. 轻量操作区：二合一「导出 ▾」（点开选 PNG 或 JSON）+ 原生面板入口
    const exportRow = el('div', 'stm-cw-export-row');
    const runCharExport = async fmt => {
      if (exportingFormat) return;
      exportMenuOpen = false;
      exportingFormat = fmt;
      renderBodyPreservingScroll();
      try {
        const res = await exportActiveCharacterCard(fmt, {
          getContext,
          flushPendingSave: () => flushAllPendingSaves(),
        });
        if (!res.cancelled && res.saveMode !== 'tauri-fallback') {
          toastMessage(
            `已导出 ${fmt.toUpperCase()} 角色卡：${res.fileName}`,
            'success',
          );
        }
      } catch (err) {
        toastMessage(err?.message || `导出 ${fmt.toUpperCase()} 失败`, 'error');
      } finally {
        exportingFormat = '';
        if (isOpen) renderBodyPreservingScroll();
      }
    };

    const exportTriggerBtn = el(
      'button',
      `stm-cw-secondary-btn stm-cw-export-trigger${exportMenuOpen ? ' is-open' : ''}`,
    );
    exportTriggerBtn.type = 'button';
    exportTriggerBtn.disabled = Boolean(exportingFormat);
    exportTriggerBtn.setAttribute('aria-expanded', String(exportMenuOpen));
    exportTriggerBtn.append(
      createIconNode(doc, 'download', 'stm-row-icon'),
      el(
        'span',
        '',
        exportingFormat ? '导出中…' : exportMenuOpen ? '收起导出 ▴' : '导出角色卡 ▾',
      ),
    );
    exportTriggerBtn.addEventListener('click', () => {
      if (exportingFormat) return;
      exportMenuOpen = !exportMenuOpen;
      renderBodyPreservingScroll();
    });
    exportRow.append(exportTriggerBtn);

    if (exportMenuOpen && !exportingFormat) {
      const choicesWrap = el('div', 'stm-cw-export-choices');
      const pngChoiceBtn = el('button', 'stm-cw-primary-btn stm-cw-export-choice-btn', 'PNG 角色卡');
      pngChoiceBtn.type = 'button';
      pngChoiceBtn.addEventListener('click', () => void runCharExport('png'));

      const jsonChoiceBtn = el('button', 'stm-cw-secondary-btn stm-cw-export-choice-btn', 'JSON 数据');
      jsonChoiceBtn.type = 'button';
      jsonChoiceBtn.addEventListener('click', () => void runCharExport('json'));

      choicesWrap.append(pngChoiceBtn, jsonChoiceBtn);
      exportRow.append(choicesWrap);
    }

    const nativeCharLink = el('button', 'stm-ghost-link stm-cw-native-fallback', '原生面板 ›');
    nativeCharLink.type = 'button';
    nativeCharLink.title = '打开酒馆原生右侧角色详情抽屉（支持更换角色卡头像与底层杂项）';
    nativeCharLink.addEventListener('click', async () => {
      await flushAllPendingSaves();
      close();
      openNativeDrawer('rightNavHolder', { getContext });
    });
    exportRow.append(nativeCharLink);

    // 3. 清爽无外框单行绑定栏：绑定预设 + 角色世界书（按需显隐）+ 聊天世界书绑定
    const inlineBinds = el('div', 'stm-cw-inline-binds');
    inlineBinds.append(buildInlinePresetBindRow(ctx, profile));

    const hasCharWorld = Boolean(
      profile.primaryWorld ||
        (Array.isArray(activation.extraCharBooks) && activation.extraCharBooks.length > 0),
    );

    if (hasCharWorld) {
      const worldRow = el('div', 'stm-cw-inline-bind-row is-world-row');
      const wLabel = el('span', 'stm-cw-inline-bind-label');
      wLabel.append(
        createIconNode(doc, 'globe', 'stm-row-icon'),
        el('span', '', '角色世界书'),
      );

      const targetJumpBook =
        profile.primaryWorld ||
        activation.extraCharBooks?.[0] ||
        activation.defaultBookName ||
        '';

      const wRight = el('div', 'stm-cw-inline-world-right');
      if (profile.primaryWorld) {
        const worldSelect = el('select', 'stm-cw-select is-clean');
        worldSelect.setAttribute('aria-label', '角色主世界书');
        const noneOpt = el('option', '', '解除绑定主世界书');
        noneOpt.value = '';
        worldSelect.append(noneOpt);

        if (
          activation.worldNames.length > 0 &&
          !activation.worldNames.includes(profile.primaryWorld)
        ) {
          const missingOpt = el('option', '', `${profile.primaryWorld}（书目缺失）`);
          missingOpt.value = profile.primaryWorld;
          missingOpt.selected = true;
          worldSelect.append(missingOpt);
        }

        for (const wName of activation.worldNames.length > 0
          ? activation.worldNames
          : [profile.primaryWorld]) {
          const opt = el('option', '', wName);
          opt.value = wName;
          opt.selected = profile.primaryWorld === wName;
          worldSelect.append(opt);
        }

        worldSelect.addEventListener('change', async () => {
          const prevWorld = profile.primaryWorld;
          const nextWorld = worldSelect.value;
          await flushAllPendingSaves();
          try {
            await bindCharacterPrimaryWorldBook(nextWorld, { getContext, chid: profile.chid });
            if (nextWorld) {
              selectedWorldBook = nextWorld;
              setSaveBadge('ok', `已绑主世界书：${nextWorld}`);
              toastMessage(`已为「${profile.name}」绑定主世界书：${nextWorld}`, 'success');
            } else {
              if (!selectedWorldBook || selectedWorldBook === prevWorld) {
                selectedWorldBook =
                  resolveWorldInfoActivationState({ getContext }).defaultBookName || '';
              }
              setSaveBadge('ok', '已解除主世界书绑定');
              toastMessage(`已解除「${profile.name}」的主世界书绑定`, 'info');
            }
            renderHeader();
            renderBodyPreservingScroll();
          } catch (err) {
            toastMessage(err?.message || '绑定角色主世界书失败', 'error');
          }
        });
        wRight.append(worldSelect);
      } else {
        const bookTagBtn = el('button', 'stm-cw-world-jump-chip', targetJumpBook);
        bookTagBtn.type = 'button';
        bookTagBtn.addEventListener('click', () => {
          void selectWorldBookAndLoad(targetJumpBook, { switchToWorldTab: true });
        });
        wRight.append(bookTagBtn);
      }

      const jumpWorldBtn = el('button', 'stm-cw-inline-link', '查看 ›');
      jumpWorldBtn.type = 'button';
      jumpWorldBtn.addEventListener('click', () => {
        void selectWorldBookAndLoad(targetJumpBook, { switchToWorldTab: true });
      });
      wRight.append(jumpWorldBtn);

      worldRow.append(wLabel, wRight);
      inlineBinds.append(worldRow);
      inlineBinds.append(
        buildInlineChatWorldBindRow(ctx, activation, { includeWorldRowClass: false }),
      );
    } else if (activation.chatBook) {
      // 无角色主书但存在当前聊天/记忆书时，单行直接可切换/解绑且保留 .is-world-row 语义
      inlineBinds.append(
        buildInlineChatWorldBindRow(ctx, activation, { includeWorldRowClass: true }),
      );
    } else {
      inlineBinds.append(
        buildInlineChatWorldBindRow(ctx, activation, { includeWorldRowClass: false }),
      );
    }

    metaCol.append(heroTopBlock, exportRow, inlineBinds);
    hero.append(portraitStage, metaCol);
    container.append(hero);

    if (coverStudioOpen && profile.avatar && profile.avatar !== 'none') {
      const coverPanel = el('div', 'stm-cw-cover-studio');

      const studioHead = el('div', 'stm-cw-cover-head');
      studioHead.append(
        el(
          'strong',
          'stm-cw-cover-title',
          `封面与多图库（共 ${1 + galleryState.items.length} 张）`,
        ),
      );

      const rotWrap = el('label', 'stm-cw-cover-rot-toggle');
      rotWrap.title = '开启后，每次退回角色书架首页都会从下方封面池随机挑一张展示（零动画卡顿）';
      const rotSpan = el('span', 'stm-cw-cover-rot-label', '回首页随机轮换');
      const rotInput = el('input', 'stm-switch-input');
      rotInput.type = 'checkbox';
      rotInput.checked = Boolean(galleryState.randomCover);
      rotInput.disabled = galleryState.items.length === 0;
      rotInput.addEventListener('change', () => {
        writeCharacterCoverGallery(ctx, profile.avatar, { randomCover: rotInput.checked });
        renderBodyPreservingScroll();
      });
      const rotTrack = el('span', 'stm-switch-track');
      rotWrap.append(rotSpan, rotInput, rotTrack);
      studioHead.append(rotWrap);
      coverPanel.append(studioHead);

      const strip = el('div', 'stm-cw-cover-strip');
      const primaryThumbBtn = el(
        'button',
        `stm-cw-cover-thumb${!activeGalleryItem ? ' is-selected' : ''}`,
      );
      primaryThumbBtn.type = 'button';
      primaryThumbBtn.title = '原卡默认主图';
      const pImg = el('img', 'stm-cw-cover-thumb-img');
      pImg.src = primaryArtUrl;
      pImg.alt = '原卡图';
      pImg.style.objectPosition = `${galleryState.primaryCrop.x}% ${galleryState.primaryCrop.y}%`;
      primaryThumbBtn.append(pImg, el('span', 'stm-cw-cover-thumb-tag', '原卡'));
      primaryThumbBtn.addEventListener('click', () => {
        writeCharacterCoverGallery(ctx, profile.avatar, { selectedId: 'primary' });
        renderBodyPreservingScroll();
      });
      strip.append(primaryThumbBtn);

      for (const item of galleryState.items) {
        const thumbWrap = el(
          'div',
          `stm-cw-cover-thumb-wrap${activeGalleryItem?.id === item.id ? ' is-selected' : ''}`,
        );
        const pickBtn = el(
          'button',
          `stm-cw-cover-thumb${activeGalleryItem?.id === item.id ? ' is-selected' : ''}`,
        );
        pickBtn.type = 'button';
        const gImg = el('img', 'stm-cw-cover-thumb-img');
        gImg.src = resolveGalleryImageHref(item.url);
        gImg.alt = '';
        gImg.style.objectPosition = `${item.x}% ${item.y}%`;
        pickBtn.append(gImg);
        pickBtn.addEventListener('click', () => {
          writeCharacterCoverGallery(ctx, profile.avatar, { selectedId: item.id });
          renderBodyPreservingScroll();
        });

        const delBtn = el('button', 'stm-cw-cover-thumb-del', '×');
        delBtn.type = 'button';
        delBtn.title = '移除这张角色图';
        delBtn.addEventListener('click', async evt => {
          evt.preventDefault();
          evt.stopPropagation();
          await deleteCharacterGalleryItem(item.id, { getContext, avatar: profile.avatar });
          renderBodyPreservingScroll();
        });

        thumbWrap.append(pickBtn, delBtn);
        strip.append(thumbWrap);
      }

      const multiFileInput = el('input', '');
      multiFileInput.type = 'file';
      multiFileInput.accept = 'image/*';
      multiFileInput.multiple = true;
      multiFileInput.hidden = true;
      multiFileInput.addEventListener('change', async () => {
        const picked = Array.from(multiFileInput.files || []);
        multiFileInput.value = '';
        if (picked.length === 0 || uploadingCoverBusy) return;
        uploadingCoverBusy = true;
        renderBodyPreservingScroll();
        try {
          const res = await uploadCharacterGalleryFiles(picked, {
            getContext,
            avatar: profile.avatar,
          });
          toastMessage(`已添加 ${res.added.length} 张角色图（已开启书架随机轮换）`, 'success');
        } catch (err) {
          toastMessage(err?.message || '上传角色图失败', 'error');
        } finally {
          uploadingCoverBusy = false;
          if (isOpen) renderBodyPreservingScroll();
        }
      });

      const addThumbBtn = el('button', 'stm-cw-cover-add-btn');
      addThumbBtn.type = 'button';
      addThumbBtn.disabled = uploadingCoverBusy;
      addThumbBtn.append(
        createIconNode(doc, 'plus', 'stm-row-icon'),
        el('span', '', uploadingCoverBusy ? '上传中…' : '添加多图'),
      );
      addThumbBtn.addEventListener('click', () => {
        if (!uploadingCoverBusy) multiFileInput.click();
      });
      strip.append(addThumbBtn, multiFileInput);
      coverPanel.append(strip);

      // 焦点滑杆 + 替换原始卡面底图
      const cropGrid = el('div', 'stm-cw-cover-crop-grid');
      const workingCrop = { x: activeCrop.x, y: activeCrop.y };

      const applyLiveCropPreview = () => {
        portraitImg.style.objectPosition = `${workingCrop.x}% ${workingCrop.y}%`;
      };
      const commitCropChange = () => {
        if (activeGalleryItem) {
          const nextItems = galleryState.items.map(it =>
            it.id === activeGalleryItem.id ? { ...it, x: workingCrop.x, y: workingCrop.y } : it,
          );
          writeCharacterCoverGallery(ctx, profile.avatar, { items: nextItems });
        } else {
          writeCharacterCoverGallery(ctx, profile.avatar, { primaryCrop: { ...workingCrop } });
        }
      };

      for (const [axis, label] of [
        ['x', '左右焦点'],
        ['y', '上下焦点'],
      ]) {
        const cRow = el('label', 'stm-cw-crop-slider-row');
        cRow.append(el('span', 'stm-cw-crop-slider-label', label));
        const rInput = el('input', 'stm-range-input');
        rInput.type = 'range';
        rInput.min = '0';
        rInput.max = '100';
        rInput.value = String(workingCrop[axis]);
        rInput.addEventListener('input', () => {
          workingCrop[axis] = Number(rInput.value);
          applyLiveCropPreview();
        });
        rInput.addEventListener('change', commitCropChange);
        cRow.append(rInput);
        cropGrid.append(cRow);
      }
      coverPanel.append(cropGrid);

      const bottomTools = el('div', 'stm-cw-cover-bottom');
      const replacePrimaryInput = el('input', '');
      replacePrimaryInput.type = 'file';
      replacePrimaryInput.accept = 'image/*';
      replacePrimaryInput.hidden = true;
      replacePrimaryInput.addEventListener('change', async () => {
        const f = replacePrimaryInput.files?.[0];
        replacePrimaryInput.value = '';
        if (!f || uploadingCoverBusy) return;
        uploadingCoverBusy = true;
        renderBodyPreservingScroll();
        try {
          await replacePrimaryCharacterAvatarFile(f, { getContext, avatar: profile.avatar });
          onCharacterChanged?.();
          toastMessage('已替换角色卡原始封面（设定与存档均完整保留）', 'success');
        } catch (err) {
          toastMessage(err?.message || '替换原始封面失败', 'error');
        } finally {
          uploadingCoverBusy = false;
          if (isOpen) renderBodyPreservingScroll();
        }
      });

      const replacePrimaryBtn = el('button', 'stm-cw-secondary-btn stm-cw-replace-avatar-btn', '替换原卡底图');
      replacePrimaryBtn.type = 'button';
      replacePrimaryBtn.disabled = uploadingCoverBusy;
      replacePrimaryBtn.title = '直接覆盖这张角色卡的原始 PNG 头像，设定与聊天存档不受影响';
      replacePrimaryBtn.addEventListener('click', () => replacePrimaryInput.click());

      const closeCoverBtn = el('button', 'stm-text-btn', '收起');
      closeCoverBtn.type = 'button';
      closeCoverBtn.addEventListener('click', () => {
        coverStudioOpen = false;
        renderBodyPreservingScroll();
      });

      bottomTools.append(replacePrimaryBtn, replacePrimaryInput, closeCoverBtn);
      coverPanel.append(bottomTools);
      container.append(coverPanel);
    }

    // 4. 去框化折页清单（从「开场白」开始统一用极细分割线排列，默认全部收起，零方框堆叠压迫感）
    const sheetList = el('div', 'stm-cw-sheet-list');

    // 4.1 第 1 项：开场白（默认收起）
    const greetItem = el(
      'div',
      `stm-cw-sheet-item stm-cw-greetings-item${greetingSectionOpen ? ' is-open' : ''}`,
    );
    const greetHeadBtn = el('button', 'stm-cw-greet-fold-head');
    greetHeadBtn.type = 'button';
    greetHeadBtn.setAttribute('aria-expanded', String(greetingSectionOpen));

    const greetLeft = el('span', 'stm-cw-field-title', '开场白');
    const greetRight = el('span', 'stm-cw-field-meta');
    greetRight.append(
      el('span', 'stm-cw-char-count has-text', `共 ${profile.greetings.length} 条`),
      createIconNode(doc, 'chevron', 'stm-cw-chevron'),
    );
    greetHeadBtn.append(greetLeft, greetRight);
    greetHeadBtn.addEventListener('click', () => {
      greetingSectionOpen = !greetingSectionOpen;
      confirmDeleteGreeting = false;
      renderBodyPreservingScroll();
    });
    greetItem.append(greetHeadBtn);

    if (greetingSectionOpen) {
      const greetBody = el('div', 'stm-cw-field-body stm-cw-greetings-body');
      const pillRowWrap = el('div', 'stm-cw-greeting-bar');
      const pillBar = el('div', 'stm-cw-greeting-pills');
      for (const g of profile.greetings) {
        const isSelected = g.index === selectedGreetingIndex;
        const isLiveFloor1 = profile.canReplaceFirstFloor && profile.activeFirstFloorIndex === g.index;
        const pill = el(
          'button',
          `stm-cw-greeting-pill${isSelected ? ' is-active' : ''}${isLiveFloor1 ? ' is-live-floor' : ''}`,
        );
        pill.type = 'button';
        if (isLiveFloor1) {
          const liveDot = el('span', 'stm-wi-dot is-keyword');
          liveDot.title = '当前聊天第1楼正在展示此开场白';
          pill.append(liveDot);
        }
        pill.append(el('span', '', g.index === 0 ? '#1 主开场白' : `#${g.index + 1}`));
        pill.addEventListener('click', () => {
          if (selectedGreetingIndex === g.index) return;
          selectedGreetingIndex = g.index;
          confirmDeleteGreeting = false;
          renderBodyPreservingScroll();
        });
        pillBar.append(pill);
      }

      const addGreetBtn = el('button', 'stm-cw-mini-btn is-accent');
      addGreetBtn.type = 'button';
      addGreetBtn.append(createIconNode(doc, 'plus', 'stm-inline-svg'), el('span', '', '新增备用'));
      addGreetBtn.addEventListener('click', async () => {
        await flushAllPendingSaves();
        const freshProfile = readMergedCharProfile(getContext?.());
        const { patch, newGreetingIndex } = buildAddAlternateGreetingPatch(freshProfile, '');
        try {
          await saveCharacterProfilePatch(patch, { getContext, chid: freshProfile.chid });
          selectedGreetingIndex = newGreetingIndex;
          greetingSectionOpen = true;
          editingGreeting = true;
          confirmDeleteGreeting = false;
          setSaveBadge('ok', `已新增 #${newGreetingIndex + 1} 备用开场白`);
          renderBodyPreservingScroll();
        } catch (err) {
          toastMessage(err?.message || '新增备用开场白失败', 'error');
        }
      });

      pillRowWrap.append(pillBar, addGreetBtn);
      greetBody.append(pillRowWrap);

      const curGreeting = profile.greetings[selectedGreetingIndex] || profile.greetings[0];

      if (editingGreeting) {
        const greetEditorKey = `greeting:${curGreeting.index}`;
        const greetTall = expandedEditorIds.has(greetEditorKey);
        const greetTextarea = el(
          'textarea',
          `stm-cw-textarea stm-cw-greeting-editor is-long-field${greetTall ? ' is-tall' : ''}`,
        );
        greetTextarea.rows = 10;
        greetTextarea.placeholder = `在此编写 ${curGreeting.label} 正文（自动保存至角色卡）…`;
        greetTextarea.value = curGreeting.content;
        greetTextarea.addEventListener('input', () => {
          const latest = readMergedCharProfile(getContext?.());
          const patch = buildGreetingEditPatch(latest, curGreeting.index, greetTextarea.value);
          queueCharacterDraftPatch(latest, patch);
        });
        const greetToolsRow = el('div', 'stm-cw-editor-head-row');
        greetToolsRow.append(el('span', 'stm-cw-sublabel', `${curGreeting.label} · ${countUnicodeChars(curGreeting.content)} 字`));
        const greetExpandBtn = el(
          'button',
          `stm-cw-expand-editor-btn${greetTall ? ' is-active' : ''}`,
          greetTall ? '还原高度' : '展开大框',
        );
        greetExpandBtn.type = 'button';
        greetExpandBtn.addEventListener('click', () => {
          const nextTall = !expandedEditorIds.has(greetEditorKey);
          if (nextTall) expandedEditorIds.add(greetEditorKey);
          else expandedEditorIds.delete(greetEditorKey);
          greetTextarea.classList.toggle('is-tall', nextTall);
          greetExpandBtn.classList.toggle('is-active', nextTall);
          greetExpandBtn.textContent = nextTall ? '还原高度' : '展开大框';
        });
        greetToolsRow.append(greetExpandBtn);
        greetBody.append(greetToolsRow, greetTextarea);
      } else {
        const previewBox = el(
          'div',
          `stm-cw-greeting-preview${curGreeting.content.trim() ? '' : ' is-empty'}`,
          curGreeting.content.trim()
            ? curGreeting.content
            : '（该条开场白暂无内容，点击下方「编辑开场白」即可填写）',
        );
        greetBody.append(previewBox);
      }

      const gFoot = el('div', 'stm-cw-greeting-foot');
      const applyFloorBtn = el(
        'button',
        `stm-cw-floor-apply-btn${profile.canReplaceFirstFloor ? ' is-ready' : ' is-disabled'}`,
      );
      applyFloorBtn.type = 'button';
      applyFloorBtn.disabled = !profile.canReplaceFirstFloor;
      if (profile.canReplaceFirstFloor) {
        applyFloorBtn.append(
          createIconNode(doc, 'check', 'stm-row-icon'),
          el('span', '', '在当前聊天启用此开场白'),
        );
        applyFloorBtn.addEventListener('click', async () => {
          await flushAllPendingSaves();
          const res = await applyGreetingToFirstChatFloor(curGreeting.index, { getContext });
          if (res.ok) {
            toastMessage(`已在当前聊天第 1 楼启用「${curGreeting.label}」`, 'success');
            renderBodyPreservingScroll();
          } else {
            toastMessage(res.message || '替换开场白失败', 'warning');
          }
        });
      } else {
        applyFloorBtn.textContent = profile.firstFloorHint || '已进入后续对话（仅开局第1楼可直接替换）';
      }

      const gFootRight = el('div', 'stm-cw-inline-actions');
      const toggleEditBtn = el(
        'button',
        `stm-cw-mini-btn${editingGreeting ? ' is-accent' : ''}`,
      );
      toggleEditBtn.type = 'button';
      toggleEditBtn.append(
        createIconNode(doc, editingGreeting ? 'check' : 'edit', 'stm-inline-svg'),
        el('span', '', editingGreeting ? '完成编辑' : '编辑开场白'),
      );
      toggleEditBtn.addEventListener('click', async () => {
        if (editingGreeting) {
          await flushAllPendingSaves();
          editingGreeting = false;
        } else {
          editingGreeting = true;
        }
        renderBodyPreservingScroll();
      });
      gFootRight.append(toggleEditBtn);

      if (!curGreeting.isPrimary) {
        const delGreetBtn = el(
          'button',
          `stm-cw-mini-btn${confirmDeleteGreeting ? ' is-danger' : ''}`,
        );
        delGreetBtn.type = 'button';
        delGreetBtn.append(
          createIconNode(doc, 'trash', 'stm-inline-svg'),
          el('span', '', confirmDeleteGreeting ? '确认删除此条?' : '删除此备用'),
        );
        delGreetBtn.addEventListener('click', async () => {
          if (!confirmDeleteGreeting) {
            confirmDeleteGreeting = true;
            renderBodyPreservingScroll();
            return;
          }
          await flushAllPendingSaves();
          const latest = readMergedCharProfile(getContext?.());
          const delInfo = buildDeleteAlternateGreetingPatch(latest, curGreeting.index);
          if (!delInfo.ok) return;
          try {
            await saveCharacterProfilePatch(delInfo.patch, { getContext, chid: latest.chid });
            selectedGreetingIndex = delInfo.nextGreetingIndex;
            confirmDeleteGreeting = false;
            setSaveBadge('ok', '已删除备用开场白');
            renderBodyPreservingScroll();
          } catch (err) {
            toastMessage(err?.message || '删除备用开场白失败', 'error');
          }
        });
        gFootRight.append(delGreetBtn);
      }

      gFoot.append(applyFloorBtn, gFootRight);
      greetBody.append(gFoot);
      greetItem.append(greetBody);
    }

    sheetList.append(greetItem);

    // 4.2 第 2~7 项：核心设定折叠查看与编辑（自动双写 V1 + V2）
    for (const def of CORE_FIELD_DEFS) {
      const isExpanded = openFieldSections.has(def.id);
      const card = el('div', `stm-cw-sheet-item stm-cw-field-card${isExpanded ? ' is-open' : ''}`);

      let charCount = 0;
      if (def.isDualPrompt) {
        charCount =
          countUnicodeChars(profile.systemPrompt) +
          countUnicodeChars(profile.postHistoryInstructions);
      } else {
        charCount = countUnicodeChars(profile[def.id] || '');
      }

      const headBtn = el('button', 'stm-cw-field-head');
      headBtn.type = 'button';
      headBtn.setAttribute('aria-expanded', String(isExpanded));

      const leftSpan = el('span', 'stm-cw-field-title', def.title);
      const rightMeta = el('span', 'stm-cw-field-meta');
      const countBadge = el(
        'span',
        `stm-cw-char-count${charCount > 0 ? ' has-text' : ''}`,
        def.showLiveCharCount
          ? `共 ${charCount} 字`
          : charCount > 0
            ? `${charCount} 字`
            : '未填写',
      );
      const chevronNode = createIconNode(doc, 'chevron', 'stm-cw-chevron');
      rightMeta.append(countBadge, chevronNode);
      headBtn.append(leftSpan, rightMeta);

      headBtn.addEventListener('click', () => {
        if (openFieldSections.has(def.id)) {
          openFieldSections.delete(def.id);
        } else {
          openFieldSections.add(def.id);
        }
        renderBodyPreservingScroll();
      });
      card.append(headBtn);

      if (isExpanded) {
        const bodyBox = el('div', 'stm-cw-field-body');
        const makeEditorToggle = (editorKey, areaEl) => {
          const isTall = expandedEditorIds.has(editorKey);
          areaEl.classList.toggle('is-tall', isTall);
          const toggleBtn = el(
            'button',
            `stm-cw-expand-editor-btn${isTall ? ' is-active' : ''}`,
            isTall ? '还原高度' : '展开大框',
          );
          toggleBtn.type = 'button';
          toggleBtn.addEventListener('click', () => {
            const nextTall = !expandedEditorIds.has(editorKey);
            if (nextTall) expandedEditorIds.add(editorKey);
            else expandedEditorIds.delete(editorKey);
            areaEl.classList.toggle('is-tall', nextTall);
            toggleBtn.classList.toggle('is-active', nextTall);
            toggleBtn.textContent = nextTall ? '还原高度' : '展开大框';
          });
          return toggleBtn;
        };

        if (def.isDualPrompt) {
          const sysLabel = el('label', 'stm-cw-sublabel', '角色系统提示词');
          const sysArea = el(
            'textarea',
            `stm-cw-textarea${countUnicodeChars(profile.systemPrompt) >= 360 ? ' is-long-field' : ''}`,
          );
          sysArea.rows = 6;
          sysArea.placeholder = '覆盖或补充给当前角色的专属主系统提示词（留空则完全跟随预设）…';
          sysArea.value = profile.systemPrompt;
          const sysHeadRow = el('div', 'stm-cw-editor-head-row');
          sysHeadRow.append(sysLabel, makeEditorToggle('charPrompts:sys', sysArea));

          const postLabel = el(
            'label',
            'stm-cw-sublabel',
            '历史后强调指令',
          );
          const postArea = el(
            'textarea',
            `stm-cw-textarea${countUnicodeChars(profile.postHistoryInstructions) >= 360 ? ' is-long-field' : ''}`,
          );
          postArea.rows = 6;
          postArea.placeholder = '注入在聊天记录末尾的角色专属强调指令（留空则完全跟随预设）…';
          postArea.value = profile.postHistoryInstructions;
          const postHeadRow = el('div', 'stm-cw-editor-head-row');
          postHeadRow.append(postLabel, makeEditorToggle('charPrompts:post', postArea));

          const refreshDualCount = () => {
            const sum = countUnicodeChars(sysArea.value) + countUnicodeChars(postArea.value);
            countBadge.textContent = sum > 0 ? `${sum} 字` : '未填写';
            countBadge.classList.toggle('has-text', sum > 0);
          };

          sysArea.addEventListener('input', () => {
            refreshDualCount();
            queueCharacterDraftPatch(profile, { systemPrompt: sysArea.value });
          });
          postArea.addEventListener('input', () => {
            refreshDualCount();
            queueCharacterDraftPatch(profile, { postHistoryInstructions: postArea.value });
          });

          bodyBox.append(sysHeadRow, sysArea, postHeadRow, postArea);
        } else {
          const initialText = profile[def.id] || '';
          const isLongField = Boolean(def.longDefault) || countUnicodeChars(initialText) >= 360;
          const area = el('textarea', `stm-cw-textarea${isLongField ? ' is-long-field' : ''}`);
          area.rows = def.rows || 6;
          area.placeholder = def.placeholder || '';
          area.value = initialText;
          area.addEventListener('input', () => {
            const len = countUnicodeChars(area.value);
            countBadge.textContent = def.showLiveCharCount
              ? `共 ${len} 字`
              : len > 0
                ? `${len} 字`
                : '未填写';
            countBadge.classList.toggle('has-text', len > 0);
            queueCharacterDraftPatch(profile, { [def.id]: area.value });
          });
          const headRow = el('div', 'stm-cw-editor-head-row is-end');
          headRow.append(makeEditorToggle(`field:${def.id}`, area));
          bodyBox.append(headRow, area);
        }
        card.append(bodyBox);
      }

      sheetList.append(card);
    }

    container.append(sheetList);
  }

  function buildHomeDirectoryItems(ctx, doc) {
    const tagLookup = new Map();
    if (Array.isArray(ctx?.tags)) {
      for (const t of ctx.tags) {
        if (t && t.id !== undefined && t.name) {
          tagLookup.set(String(t.id), String(t.name).trim());
        }
      }
    }
    const tagMap = ctx?.tagMap && typeof ctx.tagMap === 'object' ? ctx.tagMap : {};
    const items = [];

    const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
    for (let idx = 0; idx < characters.length; idx += 1) {
      const ch = characters[idx];
      if (!ch) continue;
      const avatar = String(ch.avatar || '').trim();
      const name = String(ch.name || avatar.replace(/\.[^.]+$/, '') || '未命名角色').trim();
      let thumbUrl = avatar ? resolveAssetHref(`characters/${encodeURIComponent(avatar)}`, doc) : '';
      if (avatar && typeof ctx?.getThumbnailUrl === 'function') {
        try {
          thumbUrl = ctx.getThumbnailUrl('avatar', avatar) || thumbUrl;
        } catch {
          // keep fallback portrait url
        }
      }
      const mappedTagIds = avatar && Array.isArray(tagMap[avatar]) ? tagMap[avatar] : [];
      const resolvedTags = mappedTagIds
        .map(id => tagLookup.get(String(id)) || '')
        .filter(Boolean);
      const cardTags =
        resolvedTags.length > 0
          ? resolvedTags
          : Array.isArray(ch.data?.tags)
            ? ch.data.tags.map(x => String(x || '').trim()).filter(Boolean)
            : [];
      const version = String(ch.data?.character_version || '').trim().slice(0, 18);
      const rawNote = String(ch.creatorcomment || ch.data?.creator_notes || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const note = rawNote.length > 96 ? `${rawNote.slice(0, 96)}…` : rawNote;
      const addedAt = parseCharacterAddedAt(ch);
      const parsedLast =
        Number(ch.date_last_chat) ||
        Date.parse(String(ch.date_last_chat || '')) ||
        addedAt ||
        0;

      items.push({
        kind: 'char',
        chid: idx,
        orderIdx: idx,
        key: `char:${avatar || idx}`,
        name,
        avatar,
        thumbUrl,
        tags: [...new Set(cardTags)],
        version,
        note,
        addedAt,
        lastTs: Number.isFinite(parsedLast) ? parsedLast : 0,
      });
    }

    const groups = Array.isArray(ctx?.groups) ? ctx.groups : [];
    for (let gIdx = 0; gIdx < groups.length; gIdx += 1) {
      const grp = groups[gIdx];
      if (!grp || grp.id === undefined || grp.id === null) continue;
      const name = String(grp.name || '未命名群聊').trim();
      const thumbUrl = grp.avatar_url ? resolveAssetHref(String(grp.avatar_url), doc) : '';
      const memberCount = Array.isArray(grp.members) ? grp.members.length : 0;
      const parsedLast = Number(grp.date_last_chat) || Date.parse(String(grp.date_last_chat || '')) || 0;
      items.push({
        kind: 'group',
        groupId: grp.id,
        orderIdx: 100000 + gIdx,
        key: `group:${String(grp.id)}`,
        name,
        avatar: String(grp.avatar_url || ''),
        thumbUrl,
        tags: ['群聊', memberCount > 0 ? `${memberCount} 位成员` : ''].filter(Boolean),
        version: '',
        note: '',
        lastTs: Number.isFinite(parsedLast) ? parsedLast : 0,
      });
    }

    items.sort((a, b) => {
      if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
      return a.orderIdx - b.orderIdx;
    });
    return items;
  }

  function triggerHostCharacterImport(doc) {
    const smartInput = doc?.getElementById?.('stm-smart-import-input');
    if (smartInput && typeof smartInput.click === 'function') {
      smartInput.click();
      return;
    }
    const nativeBtn = doc?.getElementById?.('character_import_button');
    const nativeInput = doc?.getElementById?.('character_import_file');
    if (nativeBtn && typeof nativeBtn.click === 'function') nativeBtn.click();
    else if (nativeInput && typeof nativeInput.click === 'function') nativeInput.click();
    else toastMessage('未找到酒馆角色卡导入入口', 'warning');
  }

  function renderHomeCharDirectoryView(container, ctx) {
    const doc = globalThis.document;
    const allItems = buildHomeDirectoryItems(ctx, doc);
    const sec = el('section', 'stm-dock-section stm-cw-dir-card');

    const head = el('div', 'stm-cw-dir-head');
    const headLeft = el('div', 'stm-cw-dir-head-left');
    headLeft.append(
      el('strong', 'stm-sec-title', '角色与群聊名录'),
      el('span', 'stm-chip', `${allItems.length}`),
    );

    const headActions = el('div', 'stm-cw-dir-actions');
    const importBtn = el('button', 'stm-pill-btn');
    importBtn.type = 'button';
    importBtn.title = '导入角色卡（支持 PNG / JSON / CHARX 等）';
    importBtn.append(
      createIconNode(doc, 'plus', 'stm-inline-svg'),
      el('span', '', '导入角色卡'),
    );
    importBtn.addEventListener('click', () => triggerHostCharacterImport(doc));

    const nativeLink = el('button', 'stm-ghost-link', '原生面板 ›');
    nativeLink.type = 'button';
    nativeLink.title = '打开酒馆原生角色管理抽屉（创建群聊或批量打标）';
    nativeLink.addEventListener('click', () => {
      close();
      fallbackOpenNativeDrawer('char', false);
    });

    headActions.append(importBtn, nativeLink);
    head.append(headLeft, headActions);
    sec.append(head);

    if (allItems.length === 0) {
      const emptyBox = el('div', 'stm-cw-empty-card');
      emptyBox.append(
        el('strong', 'stm-cw-empty-title', '当前还没有导入任何角色卡'),
        el('p', 'stm-cw-empty-desc', '点击上方「导入角色卡」即可直接添加 PNG / JSON 角色卡，或切换到右侧「世界书」管理全局世界书。'),
      );
      sec.append(emptyBox);
      container.append(sec);
      return;
    }

    const searchRow = el('div', 'stm-cw-dir-search-row');
    const searchInput = el('input', 'stm-api-input stm-compact-input stm-cw-dir-search');
    searchInput.type = 'text';
    searchInput.placeholder = '搜索角色名、标签或作者备注…';
    searchInput.value = homeDirQuery;
    searchRow.append(searchInput);
    sec.append(searchRow);

    const CHUNK_STEP = 60;
    let visibleLimit = CHUNK_STEP;
    let currentFiltered = [];
    let renderedCount = 0;

    const createDirRowNode = item => {
      const rowBtn = el('button', 'stm-cw-dir-row');
      rowBtn.type = 'button';
      rowBtn.dataset.entityKey = item.key;

      const coverBox = el('div', 'stm-cw-dir-cover');
      const firstChar = [...item.name][0] || '角';
      coverBox.append(el('span', 'stm-cw-dir-letter', firstChar));
      if (item.thumbUrl) {
        const img = el('img', 'stm-cw-dir-img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = item.thumbUrl;
        img.addEventListener('error', () => img.remove());
        coverBox.append(img);
      }

      const mainCol = el('div', 'stm-cw-dir-main');
      const titleLine = el('div', 'stm-cw-dir-titleline');
      titleLine.append(el('strong', 'stm-cw-dir-name', item.name));
      if (item.version) {
        titleLine.append(el('span', 'stm-cw-dir-ver', item.version));
      }
      if (item.addedAt > 0) {
        const importFmt = formatSubtleImportTime(item.addedAt);
        if (importFmt.shortText) {
          const timeSpan = el('span', 'stm-subtle-import-time', importFmt.shortText);
          timeSpan.title = importFmt.fullTitle;
          titleLine.append(timeSpan);
        }
      }
      mainCol.append(titleLine);

      if (item.note) {
        mainCol.append(el('div', 'stm-cw-dir-note', item.note));
      }

      if (item.tags.length > 0) {
        const tagsLine = el('div', 'stm-cw-dir-tags');
        for (const tg of item.tags.slice(0, 5)) {
          tagsLine.append(el('span', 'stm-cw-dir-tag', tg));
        }
        if (item.tags.length > 5) {
          tagsLine.append(el('span', 'stm-cw-dir-tag is-more', `+${item.tags.length - 5}`));
        }
        mainCol.append(tagsLine);
      }

      const goSpan = el('span', 'stm-cw-dir-go', '进入 ›');
      rowBtn.append(coverBox, mainCol, goSpan);

      rowBtn.addEventListener('click', async () => {
        if (openingEntityBusy) return;
        openingEntityBusy = true;
        rowBtn.disabled = true;
        try {
          if (item.kind === 'group') {
            const base = doc?.baseURI || globalThis.location?.href;
            const grpMod = base ? await import(new URL('scripts/group-chats.js', base).href) : null;
            if (typeof grpMod?.openGroupById === 'function') {
              await grpMod.openGroupById(item.groupId);
            } else {
              throw new Error('未找到群聊打开接口');
            }
          } else if (typeof ctx?.selectCharacterById === 'function') {
            await ctx.selectCharacterById(item.chid, { switchMenu: false });
          } else {
            throw new Error('当前酒馆未提供角色选择接口');
          }
          close();
        } catch (err) {
          toastMessage(err?.message || '打开角色失败，请稍后重试', 'warning');
          rowBtn.disabled = false;
        } finally {
          openingEntityBusy = false;
        }
      });

      return rowBtn;
    };

    const listWrap = el('div', 'stm-cw-dir-list');
    let moreBtnEl = null;

    const appendNextChunk = () => {
      if (renderedCount >= currentFiltered.length) {
        moreBtnEl?.remove();
        moreBtnEl = null;
        return;
      }
      moreBtnEl?.remove();
      moreBtnEl = null;
      const targetEnd = Math.min(currentFiltered.length, visibleLimit);
      for (let i = renderedCount; i < targetEnd; i += 1) {
        listWrap.append(createDirRowNode(currentFiltered[i]));
      }
      renderedCount = targetEnd;

      if (renderedCount < currentFiltered.length) {
        const moreBtn = el(
          'button',
          'stm-ghost-link stm-cw-dir-more-hint',
          `已加载 ${renderedCount} / ${currentFiltered.length} 项 · 下滑自动续载或点击展开更多`,
        );
        moreBtn.type = 'button';
        moreBtn.addEventListener('click', () => {
          visibleLimit += CHUNK_STEP;
          appendNextChunk();
        });
        moreBtnEl = moreBtn;
        listWrap.append(moreBtn);
      }
    };

    listWrap.addEventListener(
      'scroll',
      () => {
        homeDirScrollTop = listWrap.scrollTop || 0;
        if (
          renderedCount < currentFiltered.length &&
          listWrap.scrollHeight > 0 &&
          listWrap.scrollTop + listWrap.clientHeight >= listWrap.scrollHeight - 240
        ) {
          visibleLimit += CHUNK_STEP;
          appendNextChunk();
        }
      },
      { passive: true },
    );

    const renderDirRows = () => {
      listWrap.replaceChildren();
      moreBtnEl = null;
      renderedCount = 0;
      visibleLimit = CHUNK_STEP;
      const q = homeDirQuery.trim().toLowerCase();
      currentFiltered = q
        ? allItems.filter(
            it =>
              it.name.toLowerCase().includes(q) ||
              it.note.toLowerCase().includes(q) ||
              it.tags.some(t => t.toLowerCase().includes(q)),
          )
        : allItems;

      if (currentFiltered.length === 0) {
        listWrap.append(
          el('div', 'stm-cw-dir-empty', `没有匹配「${homeDirQuery.trim()}」的角色或群聊`),
        );
        return;
      }

      appendNextChunk();
    };

    searchInput.addEventListener('input', () => {
      homeDirQuery = searchInput.value;
      homeDirScrollTop = 0;
      renderDirRows();
    });

    renderDirRows();
    sec.append(listWrap);
    container.append(sec);

    if (homeDirScrollTop > 0) {
      queueMicrotask(() => {
        if (listWrap.isConnected) {
          listWrap.scrollTop = homeDirScrollTop;
        }
      });
    }
  }

  function renderCharTab(container) {
    const ctx = getContext?.();
    const profile = readMergedCharProfile(ctx);
    const activation = resolveWorldInfoActivationState({ getContext });

    if (!profile.active || profile.kind === 'none') {
      renderHomeCharDirectoryView(container, ctx);
      return;
    }

    if (profile.kind === 'group') {
      renderGroupProfileView(container, ctx, profile, activation);
      return;
    }

    renderSingleCharProfileView(container, ctx, profile, activation);
  }

  // ==========================================================================
  // Tab 2：「永不假生效的清爽世界书」渲染
  // ==========================================================================

  function renderWorldEntriesInto(listContainer, filterBarContainer, bookName) {
    const doc = globalThis.document;
    listContainer.replaceChildren();

    if (loadingBookName === bookName && loadedBookName !== bookName) {
      listContainer.append(el('div', 'stm-cw-empty-inline', `正在读取世界书「${bookName}」…`));
      return;
    }

    if (!loadedBookData || loadedBookName !== bookName) {
      listContainer.append(el('div', 'stm-cw-empty-inline', '正在准备世界书数据…'));
      return;
    }

    const stats = readWorldInfoEntries(loadedBookData);
    const wiGroupState = readWorldInfoEntryGroups(loadedBookData);
    const wiHasGroups = wiGroupState.groups.length > 0;

    // 同步筛选胶囊计数 + 轻巧「分组」入口胶囊
    if (filterBarContainer) {
      filterBarContainer.replaceChildren();
      const filters = [
        { id: 'all', label: `全部 (${stats.totalCount})`, dotClass: '' },
        { id: 'constant', label: `一直生效 (${stats.constantCount})`, dotClass: 'is-constant' },
        { id: 'keyword', label: `提到词触发 (${stats.keywordCount})`, dotClass: 'is-keyword' },
        { id: 'disabled', label: `已停用 (${stats.disabledCount})`, dotClass: '' },
      ];
      for (const f of filters) {
        const pill = el(
          'button',
          `stm-cw-filter-pill${wiFilterMode === f.id ? ' is-active' : ''}`,
        );
        pill.type = 'button';
        if (f.dotClass) {
          pill.append(el('span', `stm-wi-dot ${f.dotClass}`));
        }
        pill.append(el('span', '', f.label));
        pill.addEventListener('click', () => {
          if (wiFilterMode === f.id) return;
          wiFilterMode = f.id;
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        });
        filterBarContainer.append(pill);
      }

      const groupTogglePill = el(
        'button',
        `stm-cw-filter-pill stm-wi-group-btn${wiGroupManageOpen ? ' is-active' : ''}`,
        wiHasGroups ? `分组 (${wiGroupState.groups.length})` : '分组',
      );
      groupTogglePill.type = 'button';
      groupTogglePill.title = '新建或整理世界书条目折叠分组（仅视图归类，不触碰原生互斥组）';
      groupTogglePill.addEventListener('click', () => {
        wiGroupManageOpen = !wiGroupManageOpen;
        renamingWiGroupId = '';
        confirmDeleteWiGroupId = '';
        renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
      });
      filterBarContainer.append(groupTogglePill);
    }

    // 轻量世界书条目分组管理条（按需展开）
    if (wiGroupManageOpen) {
      const gBar = el('div', 'stm-entry-group-bar');
      const gInput = el('input', 'stm-cw-input stm-entry-group-input');
      gInput.type = 'text';
      gInput.placeholder = '输入世界书分组名（如：主要人物 / 势力地点）…';
      gInput.value = newWiGroupDraft;
      gInput.addEventListener('input', () => {
        newWiGroupDraft = gInput.value;
      });

      const doCreateWiGroup = () => {
        const clean = String(newWiGroupDraft || gInput.value || '').trim();
        if (!clean) {
          toastMessage('请先输入分组名称', 'warning');
          return;
        }
        const res = createWorldInfoEntryGroup(loadedBookData, clean);
        if (res.ok) {
          newWiGroupDraft = '';
          worldAutoSaver.schedule(bookName, loadedBookData);
          toastMessage(`已新建世界书分组「${res.group.name}」`, 'success');
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        }
      };

      gInput.addEventListener('keydown', evt => {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          doCreateWiGroup();
        }
      });

      const createBtn = el('button', 'stm-cw-mini-btn stm-wi-group-create-btn', '+ 新建分组');
      createBtn.type = 'button';
      createBtn.addEventListener('click', doCreateWiGroup);

      const barActions = el('div', 'stm-entry-group-bar-actions');
      if (wiHasGroups) {
        const expAllBtn = el('button', 'stm-ghost-link', '全部展开');
        expAllBtn.type = 'button';
        expAllBtn.addEventListener('click', () => {
          setAllWorldInfoEntryGroupsCollapsed(loadedBookData, false);
          ungroupedWiCollapsed = false;
          worldAutoSaver.schedule(bookName, loadedBookData);
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        });
        const colAllBtn = el('button', 'stm-ghost-link', '全部收起');
        colAllBtn.type = 'button';
        colAllBtn.addEventListener('click', () => {
          setAllWorldInfoEntryGroupsCollapsed(loadedBookData, true);
          ungroupedWiCollapsed = true;
          worldAutoSaver.schedule(bookName, loadedBookData);
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        });
        barActions.append(expAllBtn, colAllBtn);
      }

      gBar.append(gInput, createBtn, barActions);
      listContainer.append(gBar);
    }

    const visibleEntries = filterWorldInfoEntries(stats.entries, {
      query: wiSearchQuery,
      filterMode: wiFilterMode,
    });

    if (stats.totalCount === 0) {
      const emptyBox = el('div', 'stm-cw-empty-card is-compact');
      emptyBox.append(
        el('strong', 'stm-cw-empty-title', `「${bookName}」目前还没有世界书条目`),
        el(
          'p',
          'stm-cw-empty-desc',
          '点击右上方「+ 新增条目」即可添加设定：蓝灯代表每次对话一直发送，绿灯代表对话提到关键词时自动触发。',
        ),
      );
      listContainer.append(emptyBox);
      return;
    }

    if (visibleEntries.length === 0) {
      listContainer.append(
        el('div', 'stm-cw-empty-inline', '没有匹配的条目，试试清空搜索词或切回「全部」筛选'),
      );
      return;
    }

    const buildWorldEntryCard = item => {
      const isExpanded = String(expandedEntryUid) === String(item.uid);
      const card = el(
        'div',
        `stm-wi-entry-card${isExpanded ? ' is-expanded' : ''}${item.enabled ? '' : ' is-disabled'}`,
      );

      // 行头部：大热区总开关 + 蓝绿灯一键切换胶囊 + 标题/空词预警/触发词预览 + 展开箭头
      const rowHead = el('div', 'stm-wi-entry-head');

      const switchLabel = el('label', 'stm-wi-switch');
      switchLabel.title = item.enabled ? '已开启（点击停用此条目）' : '已停用（点击启用此条目）';
      const switchInput = el('input', 'stm-wi-switch-input');
      switchInput.type = 'checkbox';
      switchInput.checked = item.enabled;
      const switchTrack = el('span', 'stm-wi-switch-track');
      switchLabel.append(switchInput, switchTrack);
      switchLabel.addEventListener('click', evt => evt.stopPropagation());
      switchInput.addEventListener('change', () => {
        toggleWorldInfoEntryEnabled(loadedBookData, item.uid, switchInput.checked);
        worldAutoSaver.schedule(bookName, loadedBookData);
        renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
      });

      const modePill = el('button', `stm-wi-mode-pill is-${item.triggerMode}`);
      modePill.type = 'button';
      modePill.title = '点击在「一直生效（蓝灯）」与「提到词触发（绿灯）」之间切换';
      const dotClass =
        item.triggerMode === 'constant'
          ? 'is-constant'
          : item.triggerMode === 'vectorized'
            ? 'is-vector'
            : 'is-keyword';
      modePill.append(
        el('span', `stm-wi-dot ${dotClass}`),
        el('span', '', item.triggerLabel),
      );
      modePill.addEventListener('click', evt => {
        evt.stopPropagation();
        cycleWorldInfoEntryTriggerMode(loadedBookData, item.uid);
        worldAutoSaver.schedule(bookName, loadedBookData);
        renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
      });

      const mainInfoBtn = el('button', 'stm-wi-entry-main');
      mainInfoBtn.type = 'button';
      const titleLine = el('span', 'stm-wi-title-line');
      const titleTextNode = el('strong', 'stm-wi-entry-title', item.displayTitle);
      const posBadgeNode = el('span', 'stm-wi-pos-badge', item.positionShortLabel);
      titleLine.append(titleTextNode, posBadgeNode);

      const warnBadgeHost = el('span', 'stm-wi-warn-host');
      const syncInlineWarnAndSub = liveEntry => {
        warnBadgeHost.replaceChildren();
        if (liveEntry.hasEmptyKeywordWarning) {
          const warnBadge = el('span', 'stm-wi-empty-warn');
          warnBadge.append(
            el('span', 'stm-wi-dot is-warn'),
            el('span', '', '未填触发词（不会生效）'),
          );
          warnBadgeHost.append(warnBadge);
        }
      };
      syncInlineWarnAndSub(item);
      titleLine.append(warnBadgeHost);

      const subPreviewNode = el('small', 'stm-wi-entry-sub');
      const formatSubPreview = liveEntry => {
        if (liveEntry.triggerMode === 'keyword' && liveEntry.keys.length > 0) {
          return `触发词：${liveEntry.keys.slice(0, 5).join('、')}${
            liveEntry.keys.length > 5 ? ` 等 ${liveEntry.keys.length} 词` : ''
          }`;
        }
        if (liveEntry.content.trim()) {
          return liveEntry.content.trim().replace(/\s+/g, ' ').slice(0, 56);
        }
        return '点击展开填写正文设定…';
      };
      subPreviewNode.textContent = formatSubPreview(item);

      mainInfoBtn.append(titleLine, subPreviewNode);
      mainInfoBtn.addEventListener('click', () => {
        expandedEntryUid = isExpanded ? null : item.uid;
        confirmDeleteEntryUid = null;
        renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
      });

      const expandBtn = el('button', 'stm-wi-expand-btn');
      expandBtn.type = 'button';
      expandBtn.setAttribute('aria-label', isExpanded ? '收起条目编辑' : '展开条目编辑');
      expandBtn.append(createIconNode(doc, 'chevron', 'stm-cw-chevron'));
      expandBtn.addEventListener('click', () => {
        expandedEntryUid = isExpanded ? null : item.uid;
        confirmDeleteEntryUid = null;
        renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
      });

      rowHead.append(switchLabel, modePill, mainInfoBtn, expandBtn);
      card.append(rowHead);

      // 内联编辑面板
      if (isExpanded) {
        const editor = el('div', 'stm-wi-entry-editor');

        // 若本书已建分组，顶部提供轻巧「所属分组」下拉一键归组
        if (wiHasGroups) {
          const curWiGid = wiGroupState.entries[String(item.uid)]?.groupId || '';
          const assignRow = el('div', 'stm-entry-group-assign-row');
          assignRow.append(el('label', 'stm-cw-sublabel', '所属分组'));
          const grpSelect = el('select', 'stm-cw-select stm-wi-group-select');
          const unOpt = el('option', '', '未分组');
          unOpt.value = '';
          unOpt.selected = !curWiGid;
          grpSelect.append(unOpt);
          for (const g of wiGroupState.groups) {
            const opt = el('option', '', g.name);
            opt.value = g.id;
            opt.selected = curWiGid === g.id;
            grpSelect.append(opt);
          }
          grpSelect.addEventListener('change', () => {
            assignWorldInfoEntryToGroup(loadedBookData, item.uid, grpSelect.value);
            if (grpSelect.value) {
              setWorldInfoEntryGroupCollapsed(loadedBookData, grpSelect.value, false);
            }
            worldAutoSaver.schedule(bookName, loadedBookData);
            renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
          });
          assignRow.append(grpSelect);
          editor.append(assignRow);
        }

        // 绿灯空词高亮引导框（输入触发词时实时自动消失！）
        const editorWarnSlot = el('div', 'stm-wi-editor-warn-slot');
        const refreshEditorEmptyKeyAlert = () => {
          const freshStats = readWorldInfoEntries(loadedBookData);
          const freshItem = freshStats.entries.find(e => String(e.uid) === String(item.uid));
          if (!freshItem) return;

          titleTextNode.textContent = freshItem.displayTitle;
          posBadgeNode.textContent = freshItem.positionShortLabel;
          subPreviewNode.textContent = formatSubPreview(freshItem);
          syncInlineWarnAndSub(freshItem);

          editorWarnSlot.replaceChildren();
          if (freshItem.hasEmptyKeywordWarning) {
            const alertBar = el('div', 'stm-cw-alert is-empty-key');
            const alertText = el('div', 'stm-cw-alert-text');
            alertText.append(
              createIconNode(doc, 'alert', 'stm-row-icon'),
              el(
                'span',
                '',
                '当前为「提到词触发」但未填写触发关键词，AI 不会收到此条目！请在下方填入触发词，或切为一直生效：',
              ),
            );
            const quickConstBtn = el('button', 'stm-cw-alert-btn', '切为一直生效（蓝灯）');
            quickConstBtn.type = 'button';
            quickConstBtn.addEventListener('click', () => {
              updateWorldInfoBookEntry(loadedBookData, item.uid, { triggerMode: 'constant' });
              worldAutoSaver.schedule(bookName, loadedBookData);
              renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
            });
            alertBar.append(alertText, quickConstBtn);
            editorWarnSlot.append(alertBar);
          }
        };
        refreshEditorEmptyKeyAlert();
        editor.append(editorWarnSlot);

        // 第一行：条目标题 + 触发模式分段选择
        const row1 = el('div', 'stm-wi-form-grid');
        const titleField = el('div', 'stm-wi-field');
        titleField.append(el('label', 'stm-cw-sublabel', '条目标题 / 备注'));
        const commentInput = el('input', 'stm-cw-input');
        commentInput.type = 'text';
        commentInput.placeholder = '例如：青云宗门规 / 核心地理设定…';
        commentInput.value = item.comment;
        commentInput.addEventListener('input', () => {
          updateWorldInfoBookEntry(loadedBookData, item.uid, { comment: commentInput.value });
          worldAutoSaver.schedule(bookName, loadedBookData);
          refreshEditorEmptyKeyAlert();
        });
        titleField.append(commentInput);

        const modeField = el('div', 'stm-wi-field');
        modeField.append(el('label', 'stm-cw-sublabel', '触发方式'));
        const modeSeg = el('div', 'stm-wi-mode-seg');
        for (const [mId, mDot, mText] of [
          ['constant', 'is-constant', '一直生效'],
          ['keyword', 'is-keyword', '提到词触发'],
        ]) {
          const segBtn = el(
            'button',
            `stm-wi-seg-btn${item.triggerMode === mId ? ' is-active' : ''}`,
          );
          segBtn.type = 'button';
          segBtn.append(el('span', `stm-wi-dot ${mDot}`), el('span', '', mText));
          segBtn.addEventListener('click', () => {
            if (item.triggerMode === mId) return;
            updateWorldInfoBookEntry(loadedBookData, item.uid, { triggerMode: mId });
            worldAutoSaver.schedule(bookName, loadedBookData);
            renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
          });
          modeSeg.append(segBtn);
        }
        modeField.append(modeSeg);
        row1.append(titleField, modeField);
        editor.append(row1);

        // 第二行：触发关键词（中英文逗号友好解析，打字期间不吞末尾逗号，失焦时自动规整格式）
        const keyField = el('div', 'stm-wi-field');
        keyField.append(
          el(
            'label',
            'stm-cw-sublabel',
            item.triggerMode === 'constant' ? '备用触发词（可留空）' : '触发关键词',
          ),
        );
        const keyInput = el(
          'input',
          `stm-cw-input${item.hasEmptyKeywordWarning ? ' is-warn-border' : ''}`,
        );
        keyInput.type = 'text';
        keyInput.placeholder =
          item.triggerMode === 'constant'
            ? '一直生效模式下无需填写触发词；若日后切回绿灯可在此预填…'
            : '例如：青云宗，藏剑阁, 禁地（输入多个词用逗号隔开即可）';
        keyInput.value = item.keysText;
        keyInput.addEventListener('input', () => {
          updateWorldInfoBookEntry(loadedBookData, item.uid, { key: keyInput.value });
          worldAutoSaver.schedule(bookName, loadedBookData);
          const fresh = readWorldInfoEntries(loadedBookData).entries.find(
            e => String(e.uid) === String(item.uid),
          );
          keyInput.classList.toggle('is-warn-border', Boolean(fresh?.hasEmptyKeywordWarning));
          refreshEditorEmptyKeyAlert();
        });
        keyInput.addEventListener('blur', () => {
          const fresh = readWorldInfoEntries(loadedBookData).entries.find(
            e => String(e.uid) === String(item.uid),
          );
          if (fresh) {
            keyInput.value = formatWorldInfoKeywords(fresh.keys);
          }
        });
        keyField.append(keyInput);
        editor.append(keyField);

        // 第三行：人话插入位置 + (@D 深度与角色) + 顺序权重
        const posRow = el('div', 'stm-wi-pos-grid');
        const posField = el('div', 'stm-wi-field');
        posField.append(el('label', 'stm-cw-sublabel', '插入位置'));
        const posSelect = el('select', 'stm-cw-select');
        for (const optMeta of WI_POSITION_OPTIONS) {
          if (optMeta.advancedOnly && item.position !== optMeta.value) continue;
          const opt = el('option', '', optMeta.label);
          opt.value = String(optMeta.value);
          opt.selected = item.position === optMeta.value;
          posSelect.append(opt);
        }
        posSelect.addEventListener('change', () => {
          updateWorldInfoBookEntry(loadedBookData, item.uid, {
            position: Number(posSelect.value),
          });
          worldAutoSaver.schedule(bookName, loadedBookData);
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        });
        posField.append(posSelect);
        posRow.append(posField);

        if (item.position === 4) {
          const depthField = el('div', 'stm-wi-field is-narrow');
          depthField.append(el('label', 'stm-cw-sublabel', '注入深度 @D'));
          const depthInput = el('input', 'stm-cw-input');
          depthInput.type = 'number';
          depthInput.min = '0';
          depthInput.max = '999';
          depthInput.value = String(item.depth);
          depthInput.addEventListener('input', () => {
            updateWorldInfoBookEntry(loadedBookData, item.uid, {
              depth: Number(depthInput.value),
            });
            worldAutoSaver.schedule(bookName, loadedBookData);
            refreshEditorEmptyKeyAlert();
          });
          depthField.append(depthInput);

          const roleField = el('div', 'stm-wi-field');
          roleField.append(el('label', 'stm-cw-sublabel', '注入角色'));
          const roleSelect = el('select', 'stm-cw-select');
          for (const rMeta of WI_DEPTH_ROLE_OPTIONS) {
            const opt = el('option', '', rMeta.label);
            opt.value = String(rMeta.value);
            opt.selected = item.role === rMeta.value;
            roleSelect.append(opt);
          }
          roleSelect.addEventListener('change', () => {
            updateWorldInfoBookEntry(loadedBookData, item.uid, {
              role: Number(roleSelect.value),
            });
            worldAutoSaver.schedule(bookName, loadedBookData);
            refreshEditorEmptyKeyAlert();
          });
          roleField.append(roleSelect);
          posRow.append(depthField, roleField);
        }

        const orderField = el('div', 'stm-wi-field is-narrow');
        orderField.append(el('label', 'stm-cw-sublabel', '顺序权重'));
        const orderInput = el('input', 'stm-cw-input');
        orderInput.type = 'number';
        orderInput.min = '-9999';
        orderInput.max = '99999';
        orderInput.value = String(item.order);
        orderInput.addEventListener('input', () => {
          updateWorldInfoBookEntry(loadedBookData, item.uid, {
            order: Number(orderInput.value),
          });
          worldAutoSaver.schedule(bookName, loadedBookData);
        });
        orderField.append(orderInput);
        posRow.append(orderField);
        editor.append(posRow);

        // 第四行：条目正文
        const contentField = el('div', 'stm-wi-field');
        const contentHead = el('div', 'stm-cw-bind-head');
        contentHead.append(el('label', 'stm-cw-sublabel', '条目正文设定'));
        const contentCountSpan = el(
          'span',
          'stm-cw-muted-note',
          `正文 ${item.contentCharCount} 字`,
        );
        contentHead.append(contentCountSpan);
        const contentArea = el('textarea', 'stm-cw-textarea');
        contentArea.rows = 6;
        contentArea.placeholder = '在此输入要发送给 AI 的世界观、人物关系、地点法则或状态说明…';
        contentArea.value = item.content;
        contentArea.addEventListener('input', () => {
          updateWorldInfoBookEntry(loadedBookData, item.uid, { content: contentArea.value });
          contentCountSpan.textContent = `正文 ${countUnicodeChars(contentArea.value)} 字`;
          worldAutoSaver.schedule(bookName, loadedBookData);
          refreshEditorEmptyKeyAlert();
        });
        contentField.append(contentHead, contentArea);
        editor.append(contentField);

        // 第五行：底部 UID 标记 + 二次确认安全删除
        const footRow = el('div', 'stm-wi-editor-foot');
        footRow.append(el('span', 'stm-cw-muted-note', `条目 UID #${item.uid} · 修改后 0.3 秒自动落盘生效`));

        const isConfirmDel = String(confirmDeleteEntryUid) === String(item.uid);
        const delBtn = el(
          'button',
          `stm-cw-mini-btn${isConfirmDel ? ' is-danger' : ''}`,
        );
        delBtn.type = 'button';
        delBtn.append(
          createIconNode(doc, 'trash', 'stm-inline-svg'),
          el('span', '', isConfirmDel ? '确认删除此条目?' : '删除条目'),
        );
        delBtn.addEventListener('click', () => {
          if (!isConfirmDel) {
            confirmDeleteEntryUid = item.uid;
            renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
            return;
          }
          deleteWorldInfoBookEntry(loadedBookData, item.uid);
          confirmDeleteEntryUid = null;
          expandedEntryUid = null;
          worldAutoSaver.schedule(bookName, loadedBookData);
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        });
        footRow.append(delBtn);
        editor.append(footRow);

        card.append(editor);
      }

      return card;
    };

    if (!wiHasGroups) {
      for (const item of visibleEntries) {
        listContainer.append(buildWorldEntryCard(item));
      }
      return;
    }

    // 有世界书分组时：极简细线折叠节 + 整组总控 + 搜索命中自动临时展开
    const isSearching = Boolean(wiSearchQuery.trim());
    const allByGroup = new Map();
    const visibleByGroup = new Map();
    for (const g of wiGroupState.groups) {
      allByGroup.set(g.id, []);
      visibleByGroup.set(g.id, []);
    }
    const allUngrouped = [];
    const visibleUngrouped = [];

    for (const item of stats.entries) {
      const gid = wiGroupState.entries[String(item.uid)]?.groupId || '';
      if (gid && allByGroup.has(gid)) allByGroup.get(gid).push(item);
      else allUngrouped.push(item);
    }
    for (const item of visibleEntries) {
      const gid = wiGroupState.entries[String(item.uid)]?.groupId || '';
      if (gid && visibleByGroup.has(gid)) visibleByGroup.get(gid).push(item);
      else visibleUngrouped.push(item);
    }

    wiGroupState.groups.forEach((group, gIdx) => {
      const groupAll = allByGroup.get(group.id) || [];
      const groupVisible = visibleByGroup.get(group.id) || [];
      if (isSearching && groupVisible.length === 0) return;
      if (wiFilterMode !== 'all' && groupVisible.length === 0 && groupAll.length > 0) return;

      const enabledInGroup = groupAll.filter(e => e.enabled).length;
      const groupOpen = isSearching ? true : !group.collapsed;
      const sec = el('div', `stm-entry-group-section${groupOpen ? ' is-open' : ''}`);
      sec.dataset.stmWiGroupId = group.id;

      const head = el('div', 'stm-entry-group-head');

      const anyOn = groupAll.length > 0 && enabledInGroup > 0;
      const swLabel = el('label', 'stm-wi-switch');
      swLabel.title = anyOn
        ? `停用「${group.name}」组内全部条目`
        : `启用「${group.name}」组内全部条目`;
      const swInput = el('input', 'stm-wi-switch-input stm-wi-group-master-input');
      swInput.type = 'checkbox';
      swInput.checked = anyOn;
      const swTrack = el('span', 'stm-wi-switch-track');
      swLabel.append(swInput, swTrack);
      swLabel.addEventListener('click', evt => evt.stopPropagation());
      swInput.addEventListener('change', () => {
        setWorldInfoEntryGroupEnabled(loadedBookData, group.id, swInput.checked);
        worldAutoSaver.schedule(bookName, loadedBookData);
        renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
      });
      head.append(swLabel);

      if (renamingWiGroupId === group.id) {
        const rRow = el('div', 'stm-entry-group-rename-row');
        const rInput = el('input', 'stm-cw-input stm-entry-group-rename-input');
        rInput.type = 'text';
        rInput.value = renameWiGroupDraft;
        rInput.addEventListener('input', () => {
          renameWiGroupDraft = rInput.value;
        });
        const commitRename = () => {
          const nextName = String(renameWiGroupDraft || rInput.value || '').trim();
          if (nextName) {
            renameWorldInfoEntryGroup(loadedBookData, group.id, nextName);
            worldAutoSaver.schedule(bookName, loadedBookData);
          }
          renamingWiGroupId = '';
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        };
        rInput.addEventListener('keydown', evt => {
          if (evt.key === 'Enter') {
            evt.preventDefault();
            commitRename();
          } else if (evt.key === 'Escape') {
            renamingWiGroupId = '';
            renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
          }
        });
        const okBtn = el('button', 'stm-cw-mini-btn', '保存');
        okBtn.type = 'button';
        okBtn.addEventListener('click', commitRename);
        const cancelBtn = el('button', 'stm-ghost-link', '取消');
        cancelBtn.type = 'button';
        cancelBtn.addEventListener('click', () => {
          renamingWiGroupId = '';
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        });
        rRow.append(rInput, okBtn, cancelBtn);
        head.append(rRow);
      } else {
        const toggleHeadBtn = el('button', 'stm-entry-group-toggle');
        toggleHeadBtn.type = 'button';
        toggleHeadBtn.setAttribute('aria-expanded', String(groupOpen));
        toggleHeadBtn.append(
          createIconNode(doc, 'chevron', 'stm-entry-group-chevron'),
          el('span', 'stm-entry-group-title', group.name),
          el('span', 'stm-entry-group-count', `${enabledInGroup}/${groupAll.length}`),
        );
        toggleHeadBtn.addEventListener('click', () => {
          setWorldInfoEntryGroupCollapsed(loadedBookData, group.id, !group.collapsed);
          worldAutoSaver.schedule(bookName, loadedBookData);
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        });
        head.append(toggleHeadBtn);

        const gActions = el('div', 'stm-entry-group-actions');
        if (wiGroupState.groups.length > 1) {
          const gUp = el('button', 'stm-prompt-order-btn');
          gUp.type = 'button';
          gUp.disabled = gIdx === 0;
          gUp.title = '分组上移';
          gUp.innerHTML = svgMarkup('arrowup');
          gUp.addEventListener('click', evt => {
            evt.stopPropagation();
            if (moveWorldInfoEntryGroupOrder(loadedBookData, group.id, 'up')) {
              worldAutoSaver.schedule(bookName, loadedBookData);
              renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
            }
          });
          const gDown = el('button', 'stm-prompt-order-btn');
          gDown.type = 'button';
          gDown.disabled = gIdx >= wiGroupState.groups.length - 1;
          gDown.title = '分组下移';
          gDown.innerHTML = svgMarkup('arrowdown');
          gDown.addEventListener('click', evt => {
            evt.stopPropagation();
            if (moveWorldInfoEntryGroupOrder(loadedBookData, group.id, 'down')) {
              worldAutoSaver.schedule(bookName, loadedBookData);
              renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
            }
          });
          gActions.append(gUp, gDown);
        }

        const renBtn = el('button', 'stm-ghost-link', '改名');
        renBtn.type = 'button';
        renBtn.addEventListener('click', evt => {
          evt.stopPropagation();
          confirmDeleteWiGroupId = '';
          renamingWiGroupId = group.id;
          renameWiGroupDraft = group.name;
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        });

        const isConfirmDel = confirmDeleteWiGroupId === group.id;
        const delBtn = el('button', `stm-ghost-link${isConfirmDel ? ' is-danger' : ''}`, isConfirmDel ? '确认解散?' : '解散');
        delBtn.type = 'button';
        delBtn.title = '仅解散分组，条目全部保留并回到未分组';
        delBtn.addEventListener('click', evt => {
          evt.stopPropagation();
          if (!isConfirmDel) {
            confirmDeleteWiGroupId = group.id;
            renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
            return;
          }
          deleteWorldInfoEntryGroup(loadedBookData, group.id);
          confirmDeleteWiGroupId = '';
          worldAutoSaver.schedule(bookName, loadedBookData);
          toastMessage(`已解散分组「${group.name}」，条目已保留`, 'info');
          renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
        });

        gActions.append(renBtn, delBtn);
        head.append(gActions);
      }

      sec.append(head);
      if (groupOpen) {
        const body = el('div', 'stm-entry-group-body');
        if (groupVisible.length === 0) {
          body.append(
            el('div', 'stm-entry-group-empty', '暂无条目，展开任意条目后可在「所属分组」里移入此组'),
          );
        } else {
          for (const item of groupVisible) {
            body.append(buildWorldEntryCard(item));
          }
        }
        sec.append(body);
      }
      listContainer.append(sec);
    });

    if (visibleUngrouped.length > 0) {
      const enabledUngrouped = allUngrouped.filter(e => e.enabled).length;
      const unOpen = isSearching ? true : !ungroupedWiCollapsed;
      const unSec = el('div', `stm-entry-group-section is-ungrouped${unOpen ? ' is-open' : ''}`);
      const unHead = el('div', 'stm-entry-group-head');
      const unToggle = el('button', 'stm-entry-group-toggle');
      unToggle.type = 'button';
      unToggle.setAttribute('aria-expanded', String(unOpen));
      unToggle.append(
        createIconNode(doc, 'chevron', 'stm-entry-group-chevron'),
        el('span', 'stm-entry-group-title', '未分组'),
        el('span', 'stm-entry-group-count', `${enabledUngrouped}/${allUngrouped.length}`),
      );
      unToggle.addEventListener('click', () => {
        ungroupedWiCollapsed = !ungroupedWiCollapsed;
        renderWorldEntriesInto(listContainer, filterBarContainer, bookName);
      });
      unHead.append(unToggle);
      unSec.append(unHead);
      if (unOpen) {
        const unBody = el('div', 'stm-entry-group-body');
        for (const item of visibleUngrouped) {
          unBody.append(buildWorldEntryCard(item));
        }
        unSec.append(unBody);
      }
      listContainer.append(unSec);
    }
  }

  function renderWorldTab(container) {
    const doc = globalThis.document;
    const ctx = getContext?.();
    const profile = readMergedCharProfile(ctx);
    const activation = resolveWorldInfoActivationState({ getContext });

    // 若尚未选中具体世界书，默认选中角色主书或第一本真生效书
    if (!selectedWorldBook && activation.defaultBookName) {
      selectedWorldBook = activation.defaultBookName;
    }
    // 若之前选中的书已被外部彻底删除，回退到默认生效书
    if (
      selectedWorldBook &&
      activation.worldNames.length > 0 &&
      !activation.worldNames.includes(selectedWorldBook)
    ) {
      selectedWorldBook = activation.defaultBookName || '';
    }

    if (selectedWorldBook && loadedBookName !== selectedWorldBook && loadingBookName !== selectedWorldBook) {
      void ensureWorldBookLoaded(selectedWorldBook);
    }

    // 1. 预设世界书占位槽 (`worldInfoBefore` & `worldInfoAfter`) 双双关闭自检护栏
    const slotDiag = inspectPresetWorldInfoSlots({ getContext });
    if (slotDiag.bothDisabled) {
      const slotAlert = el('div', 'stm-cw-alert is-slot-warn');
      const alertLeft = el('div', 'stm-cw-alert-text');
      alertLeft.append(
        createIconNode(doc, 'alert', 'stm-row-icon'),
        el('span', '', slotDiag.warningText),
      );
      const fixSlotBtn = el('button', 'stm-cw-alert-btn', '一键开启预设世界书槽位');
      fixSlotBtn.type = 'button';
      fixSlotBtn.addEventListener('click', async () => {
        const res = await enablePresetWorldInfoSlots({ getContext });
        if (res.ok) {
          toastMessage('已为你开启当前预设的前后置「世界书」占位槽', 'success');
          renderBodyPreservingScroll();
        }
      });
      slotAlert.append(alertLeft, fixSlotBtn);
      container.append(slotAlert);
    }

    // 2. 顶部「当前生效世界书」快捷切换胶囊栏 + 全部书库/全局开关管理 + 新建世界书
    const topCard = el('div', 'stm-cw-card stm-cw-world-top');
    const barHead = el('div', 'stm-cw-world-bar-head');

    const headLeft = el('div', 'stm-cw-card-title');
    headLeft.append(
      createIconNode(doc, 'globe', 'stm-row-icon'),
      el('strong', '', '当前对话生效世界书'),
      el(
        'span',
        `stm-cw-mini-badge${activation.activeBooks.length > 0 ? ' is-live' : ''}`,
        activation.activeBooks.length > 0
          ? `${activation.activeBooks.length} 本生效中`
          : '暂无生效书目',
      ),
    );

    const headRight = el('div', 'stm-cw-inline-actions');
    const embeddedInfo = inspectEmbeddedCharacterBook(ctx);

    const runEmbeddedReimport = async () => {
      if (reimportingBookBusy) return;
      reimportingBookBusy = true;
      try {
        if (
          embeddedInfo.bookName &&
          worldAutoSaver.getPendingBookName() === embeddedInfo.bookName
        ) {
          worldAutoSaver.cancel();
        }
        await flushAllPendingSaves();
        const res = await reimportEmbeddedCharacterBook({ getContext });
        reimportBookOpen = false;
        creatingBookOpen = false;
        selectedWorldBook = res.bookName;
        setSaveBadge('ok', `已覆盖重导：${res.bookName}`);
        toastMessage(
          `已从角色卡强制重导「${res.bookName}」（共 ${res.entryCount} 条设定）并绑为主书`,
          'success',
        );
        renderHeader();
        await ensureWorldBookLoaded(res.bookName, { forceReload: true });
        renderBodyPreservingScroll();
      } catch (err) {
        toastMessage(err?.message || '重导角色卡内嵌世界书失败', 'error');
      } finally {
        reimportingBookBusy = false;
      }
    };

    const runDeleteWorldBooks = async targetNames => {
      const list = (Array.isArray(targetNames) ? targetNames : [targetNames])
        .map(n => String(n || '').trim())
        .filter(Boolean);
      if (list.length === 0 || deletingBooksBusy) return;

      deletingBooksBusy = true;
      try {
        const pendingBook = worldAutoSaver.getPendingBookName();
        if (pendingBook && list.includes(pendingBook)) {
          worldAutoSaver.cancel();
        }
        await flushAllPendingSaves();

        const res = await deleteHostWorldBooks(list, { getContext });
        confirmDeleteBookName = '';
        confirmBatchDeleteBooks = false;
        for (const name of res.deleted) {
          librarySelectedBooks.delete(name);
        }

        if (res.deleted.includes(loadedBookName)) {
          loadedBookName = '';
          loadedBookData = null;
          loadingBookName = '';
        }

        const refreshedAct = resolveWorldInfoActivationState({ getContext });
        if (selectedWorldBook && !refreshedAct.worldNames.includes(selectedWorldBook)) {
          selectedWorldBook = refreshedAct.defaultBookName || '';
          expandedEntryUid = null;
          confirmDeleteEntryUid = null;
        }
        if (refreshedAct.worldNames.length === 0) {
          libraryBatchMode = false;
        }

        if (res.deleted.length === 1) {
          setSaveBadge('ok', `已删除：${res.deleted[0]}`);
          toastMessage(`已从酒馆书库删除世界书「${res.deleted[0]}」`, 'success');
        } else if (res.deleted.length > 1) {
          setSaveBadge('ok', `已删除 ${res.deleted.length} 本世界书`);
          toastMessage(`已批量清理 ${res.deleted.length} 本世界书`, 'success');
        }
        if (res.failed.length > 0) {
          toastMessage(`部分世界书删除失败：${res.failed.join('、')}`, 'warning');
        }

        renderHeader();
        renderBodyPreservingScroll();
        if (selectedWorldBook && loadedBookName !== selectedWorldBook) {
          await ensureWorldBookLoaded(selectedWorldBook, { forceReload: true });
        }
      } catch (err) {
        toastMessage(err?.message || '删除世界书失败', 'error');
      } finally {
        deletingBooksBusy = false;
      }
    };

    const libBtn = el(
      'button',
      `stm-cw-mini-btn${libraryOpen ? ' is-accent' : ''}`,
    );
    libBtn.type = 'button';
    libBtn.append(
      createIconNode(doc, 'layers', 'stm-inline-svg'),
      el('span', '', `全部书库 (${activation.worldNames.length})`),
    );
    libBtn.addEventListener('click', () => {
      libraryOpen = !libraryOpen;
      creatingBookOpen = false;
      reimportBookOpen = false;
      confirmDeleteBookName = '';
      confirmBatchDeleteBooks = false;
      renderBodyPreservingScroll();
    });

    const newBookBtn = el(
      'button',
      `stm-cw-mini-btn${creatingBookOpen ? ' is-accent' : ''}`,
    );
    newBookBtn.type = 'button';
    newBookBtn.append(
      createIconNode(doc, 'plus', 'stm-inline-svg'),
      el('span', '', '新建世界书'),
    );
    newBookBtn.addEventListener('click', () => {
      creatingBookOpen = !creatingBookOpen;
      libraryOpen = false;
      reimportBookOpen = false;
      if (creatingBookOpen && !newBookNameDraft) {
        newBookNameDraft =
          profile.kind === 'char' && profile.name ? `${profile.name}设定集` : '新建世界书';
      }
      renderBodyPreservingScroll();
    });

    headRight.append(libBtn, newBookBtn);

    if (embeddedInfo.hasEmbedded) {
      const reimportBtn = el(
        'button',
        `stm-cw-mini-btn stm-cw-reimport-btn${reimportBookOpen ? ' is-accent' : ''}`,
      );
      reimportBtn.type = 'button';
      reimportBtn.title = `从角色卡内嵌数据强制重导覆盖「${embeddedInfo.bookName}」（解决酒馆同名世界书跳过导入导致新条目丢失）`;
      reimportBtn.append(
        createIconNode(doc, 'refresh', 'stm-inline-svg'),
        el('span', '', '重导卡内书'),
      );
      reimportBtn.addEventListener('click', () => {
        reimportBookOpen = !reimportBookOpen;
        libraryOpen = false;
        creatingBookOpen = false;
        renderBodyPreservingScroll();
      });
      headRight.append(reimportBtn);
    }

    const nativeWiBtn = el('button', 'stm-ghost-link', '原生面板 ›');
    nativeWiBtn.type = 'button';
    nativeWiBtn.title = '打开酒馆原生世界书高级管理面板';
    nativeWiBtn.addEventListener('click', async () => {
      await flushAllPendingSaves();
      close();
      openNativeDrawer('WI-SP-button', { getContext });
    });

    headRight.append(nativeWiBtn);
    barHead.append(headLeft, headRight);
    topCard.append(barHead);

    // 生效世界书胶囊栏 + 快速跳选任意书下拉框
    const capsuleRow = el('div', 'stm-cw-active-books-row');
    if (activation.activeBooks.length > 0) {
      for (const b of activation.activeBooks) {
        const isCurrent = b.name === selectedWorldBook;
        const chip = el('button', `stm-cw-book-chip${isCurrent ? ' is-selected' : ''}`);
        chip.type = 'button';
        chip.append(
          el('span', 'stm-wi-dot is-keyword'),
          el('span', 'stm-cw-book-chip-name', b.name),
          el('span', 'stm-cw-book-chip-badge', b.sourceLabels.join(' · ')),
        );
        chip.addEventListener('click', () => {
          if (selectedWorldBook === b.name) return;
          void selectWorldBookAndLoad(b.name);
        });
        capsuleRow.append(chip);
      }
    }

    if (activation.worldNames.length > 0) {
      const quickJumpSelect = el('select', 'stm-cw-select stm-cw-book-jump-select');
      const placeholderOpt = el(
        'option',
        '',
        selectedWorldBook ? `当前查看：${selectedWorldBook}` : '从全部世界书中选择查看…',
      );
      placeholderOpt.value = selectedWorldBook || '';
      quickJumpSelect.append(placeholderOpt);
      for (const wName of activation.worldNames) {
        if (wName === selectedWorldBook) continue;
        const isAct = activation.activeBookNames.includes(wName);
        const opt = el('option', '', isAct ? `${wName}（生效中）` : `${wName}（未启用）`);
        opt.value = wName;
        quickJumpSelect.append(opt);
      }
      quickJumpSelect.addEventListener('change', () => {
        if (quickJumpSelect.value && quickJumpSelect.value !== selectedWorldBook) {
          void selectWorldBookAndLoad(quickJumpSelect.value);
        }
      });
      capsuleRow.append(quickJumpSelect);
    }

    if (capsuleRow.childNodes.length > 0) {
      topCard.append(capsuleRow);
    }

    // 内联「从角色卡强制重导内嵌世界书」面板（专治同名世界书在酒馆无法覆盖更新的痛点）
    if (reimportBookOpen && embeddedInfo.hasEmbedded) {
      const reimportBar = el('div', 'stm-cw-subdrawer stm-cw-reimport-drawer');
      reimportBar.append(
        el(
          'strong',
          'stm-cw-sublabel',
          `从角色卡「${embeddedInfo.charName}」强制重导内嵌世界书`,
        ),
        el(
          'small',
          'stm-cw-muted-note',
          embeddedInfo.matchesExisting
            ? `检测到该角色卡自带内嵌世界书「${embeddedInfo.bookName}」（共 ${embeddedInfo.entryCount} 条设定），将直接原地覆盖已有书库并绑为主书（不会多出重复副本）：`
            : `检测到该角色卡自带内嵌世界书「${embeddedInfo.bookName}」（共 ${embeddedInfo.entryCount} 条设定）。酒馆导入角色卡遇到同名旧书时默认静默跳过，点击下方按钮即可直接用卡内最新数据写入书库并绑为主书：`,
        ),
      );
      const rActions = el('div', 'stm-cw-inline-actions');
      const confirmReimportBtn = el(
        'button',
        'stm-cw-primary-btn',
        reimportingBookBusy ? '正在覆盖导入…' : `覆盖导入「${embeddedInfo.bookName}」并绑为主书`,
      );
      confirmReimportBtn.type = 'button';
      confirmReimportBtn.disabled = reimportingBookBusy;
      confirmReimportBtn.addEventListener('click', () => {
        void runEmbeddedReimport();
      });

      const cancelReimportBtn = el('button', 'stm-cw-secondary-btn', '取消');
      cancelReimportBtn.type = 'button';
      cancelReimportBtn.addEventListener('click', () => {
        reimportBookOpen = false;
        renderBodyPreservingScroll();
      });
      rActions.append(confirmReimportBtn, cancelReimportBtn);
      reimportBar.append(rActions);
      topCard.append(reimportBar);
    }

    // 内联「新建世界书」面板
    if (creatingBookOpen) {
      const createBar = el('div', 'stm-cw-subdrawer');
      createBar.append(
        el('label', 'stm-cw-sublabel', '新建世界书名称（可一键绑定给当前角色或全局启用，建好即可直接写条目）'),
      );
      const cRow = el('div', 'stm-cw-create-row');
      const nameInput = el('input', 'stm-cw-input');
      nameInput.type = 'text';
      nameInput.placeholder = '输入新世界书名称…';
      nameInput.value = newBookNameDraft;
      nameInput.addEventListener('input', () => {
        newBookNameDraft = nameInput.value;
      });

      const doCreate = async ({ bindChar = false, bindChat = false, enableGlob = false }) => {
        await flushAllPendingSaves();
        try {
          const res = await createHostWorldBook(newBookNameDraft, {
            bindToCurrentChar: bindChar,
            bindToCurrentChat: bindChat,
            enableGlobal: enableGlob,
            createStarterEntry: true,
            getContext,
          });
          creatingBookOpen = false;
          newBookNameDraft = '';
          selectedWorldBook = res.bookName;
          setSaveBadge('ok', `已新建：${res.bookName}`);
          toastMessage(`已创建世界书「${res.bookName}」`, 'success');
          renderHeader();
          await ensureWorldBookLoaded(res.bookName, { forceReload: true });
          renderBodyPreservingScroll();
        } catch (err) {
          toastMessage(err?.message || '新建世界书失败', 'error');
        }
      };

      if (activation.isSingleChar) {
        const bindCreateBtn = el('button', 'stm-cw-primary-btn', '新建并绑为角色主书');
        bindCreateBtn.type = 'button';
        bindCreateBtn.addEventListener('click', () => void doCreate({ bindChar: true }));
        cRow.append(nameInput, bindCreateBtn);
      } else {
        cRow.append(nameInput);
      }

      if (activation.isSingleChar || activation.isGroup) {
        const chatCreateBtn = el('button', 'stm-cw-secondary-btn', '新建并绑为聊天书');
        chatCreateBtn.type = 'button';
        chatCreateBtn.addEventListener('click', () => void doCreate({ bindChat: true }));
        cRow.append(chatCreateBtn);
      }

      const globalCreateBtn = el('button', 'stm-cw-secondary-btn', '新建并全局启用');
      globalCreateBtn.type = 'button';
      globalCreateBtn.addEventListener('click', () => void doCreate({ enableGlob: true }));
      cRow.append(globalCreateBtn);

      createBar.append(cRow);
      topCard.append(createBar);
    }

    // 内联「全部世界书库 / 全局开关 / 单删与批量清理管理」面板
    if (libraryOpen) {
      const libBox = el('div', 'stm-cw-subdrawer');
      const libHead = el('div', 'stm-cw-bind-head');
      libHead.append(
        el(
          'strong',
          'stm-cw-sublabel',
          libraryBatchMode
            ? '批量清理世界书（勾选要移除的旧世界书，可先搜索书名再一键全选当前筛选结果）'
            : '全部世界书库（点书名查看，右侧可开关「全局启用」或删除旧书）',
        ),
      );

      const libHeadActions = el('div', 'stm-cw-lib-head-actions');
      if (activation.worldNames.length > 1 || libraryQuery) {
        const libSearch = el('input', 'stm-cw-input stm-cw-lib-search');
        libSearch.type = 'search';
        libSearch.placeholder = '搜索书名…';
        libSearch.value = libraryQuery;
        libSearch.addEventListener('input', () => {
          libraryQuery = libSearch.value;
          confirmDeleteBookName = '';
          confirmBatchDeleteBooks = false;
          renderLibRows();
        });
        libHeadActions.append(libSearch);
      }

      if (activation.worldNames.length > 0) {
        const batchToggleBtn = el(
          'button',
          `stm-cw-mini-btn stm-cw-lib-batch-toggle${libraryBatchMode ? ' is-accent' : ''}`,
        );
        batchToggleBtn.type = 'button';
        batchToggleBtn.append(
          createIconNode(doc, libraryBatchMode ? 'check' : 'trash', 'stm-inline-svg'),
          el('span', '', libraryBatchMode ? '退出批量' : '批量删除'),
        );
        batchToggleBtn.addEventListener('click', () => {
          libraryBatchMode = !libraryBatchMode;
          confirmDeleteBookName = '';
          confirmBatchDeleteBooks = false;
          if (!libraryBatchMode) {
            librarySelectedBooks.clear();
          }
          renderBodyPreservingScroll();
        });
        libHeadActions.append(batchToggleBtn);
      }

      if (libHeadActions.childNodes.length > 0) {
        libHead.append(libHeadActions);
      }
      libBox.append(libHead);

      if (activation.isSingleChar || activation.isGroup) {
        const libChatBind = el('div', 'stm-cw-lib-chat-bind');
        libChatBind.append(
          buildInlineChatWorldBindRow(ctx, activation, { includeWorldRowClass: false }),
        );
        libBox.append(libChatBind);
      }

      const batchBarSlot = el('div', 'stm-cw-lib-batch-slot');
      const libList = el('div', 'stm-cw-lib-list');
      libList.addEventListener(
        'scroll',
        () => {
          libraryScrollTop = libList.scrollTop || 0;
        },
        { passive: true },
      );

      const renderLibRows = () => {
        const savedScroll = libList.isConnected ? libList.scrollTop : libraryScrollTop;
        batchBarSlot.replaceChildren();
        libList.replaceChildren();
        const freshAct = resolveWorldInfoActivationState({ getContext });

        // 自动剔除已不存在的勾选项
        const validSet = new Set(freshAct.worldNames);
        for (const picked of [...librarySelectedBooks]) {
          if (!validSet.has(picked)) {
            librarySelectedBooks.delete(picked);
          }
        }

        const q = libraryQuery.trim().toLowerCase();
        const filteredNames = freshAct.worldNames.filter(n => !q || n.toLowerCase().includes(q));

        if (libraryBatchMode && freshAct.worldNames.length > 0) {
          const batchBar = el('div', 'stm-cw-lib-batch-bar');
          const batchLeft = el('div', 'stm-cw-inline-actions');

          const allFilteredSelected =
            filteredNames.length > 0 && filteredNames.every(n => librarySelectedBooks.has(n));
          const selectFilteredBtn = el(
            'button',
            'stm-cw-mini-btn',
            allFilteredSelected
              ? `取消全选当前 (${filteredNames.length})`
              : q
                ? `全选筛选结果 (${filteredNames.length})`
                : `全选全部 (${filteredNames.length})`,
          );
          selectFilteredBtn.type = 'button';
          selectFilteredBtn.disabled = filteredNames.length === 0;
          selectFilteredBtn.addEventListener('click', () => {
            confirmBatchDeleteBooks = false;
            if (allFilteredSelected) {
              for (const n of filteredNames) librarySelectedBooks.delete(n);
            } else {
              for (const n of filteredNames) librarySelectedBooks.add(n);
            }
            renderLibRows();
          });
          batchLeft.append(selectFilteredBtn);

          const selCount = librarySelectedBooks.size;
          if (selCount > 0) {
            batchLeft.append(el('span', 'stm-cw-muted-note', `已选 ${selCount} 本`));
            const clearSelBtn = el('button', 'stm-ghost-link', '清空已选');
            clearSelBtn.type = 'button';
            clearSelBtn.addEventListener('click', () => {
              librarySelectedBooks.clear();
              confirmBatchDeleteBooks = false;
              renderLibRows();
            });
            batchLeft.append(clearSelBtn);
          }

          const batchRight = el('div', 'stm-cw-inline-actions');
          if (confirmBatchDeleteBooks && selCount > 0) {
            const confirmBatchBtn = el(
              'button',
              'stm-cw-mini-btn is-danger stm-cw-lib-batch-confirm',
              deletingBooksBusy ? '正在删除…' : `确认永久删除 ${selCount} 本?`,
            );
            confirmBatchBtn.type = 'button';
            confirmBatchBtn.disabled = deletingBooksBusy;
            confirmBatchBtn.addEventListener('click', () => {
              void runDeleteWorldBooks([...librarySelectedBooks]);
            });
            const cancelBatchBtn = el('button', 'stm-cw-mini-btn', '取消');
            cancelBatchBtn.type = 'button';
            cancelBatchBtn.addEventListener('click', () => {
              confirmBatchDeleteBooks = false;
              renderLibRows();
            });
            batchRight.append(confirmBatchBtn, cancelBatchBtn);
          } else {
            const triggerBatchDelBtn = el(
              'button',
              'stm-cw-mini-btn is-danger stm-cw-lib-batch-del',
            );
            triggerBatchDelBtn.type = 'button';
            triggerBatchDelBtn.disabled = selCount === 0 || deletingBooksBusy;
            triggerBatchDelBtn.append(
              createIconNode(doc, 'trash', 'stm-inline-svg'),
              el('span', '', selCount > 0 ? `删除已选 (${selCount})` : '请先勾选书目'),
            );
            triggerBatchDelBtn.addEventListener('click', () => {
              if (librarySelectedBooks.size === 0) return;
              confirmBatchDeleteBooks = true;
              renderLibRows();
            });
            batchRight.append(triggerBatchDelBtn);
          }

          batchBar.append(batchLeft, batchRight);
          batchBarSlot.append(batchBar);
        }

        if (filteredNames.length === 0) {
          libList.append(
            el(
              'div',
              'stm-cw-empty-inline',
              freshAct.worldNames.length === 0 ? '酒馆书库目前没有任何世界书' : '没有匹配的世界书',
            ),
          );
          return;
        }

        const appendBookRow = wName => {
          const isBatchChecked = librarySelectedBooks.has(wName);
          const row = el(
            'div',
            `stm-cw-lib-row${selectedWorldBook === wName ? ' is-current' : ''}${
              libraryBatchMode && isBatchChecked ? ' is-batch-selected' : ''
            }`,
          );
          const activeHit = freshAct.activeBooks.find(b => b.name === wName);

          if (libraryBatchMode) {
            const batchPickLabel = el('label', 'stm-cw-lib-batch-item');
            const checkInput = el('input', 'stm-cw-lib-check');
            checkInput.type = 'checkbox';
            checkInput.checked = isBatchChecked;
            checkInput.addEventListener('change', () => {
              confirmBatchDeleteBooks = false;
              if (checkInput.checked) {
                librarySelectedBooks.add(wName);
              } else {
                librarySelectedBooks.delete(wName);
              }
              renderLibRows();
            });
            batchPickLabel.append(checkInput, el('span', 'stm-cw-lib-name', wName));
            if (activeHit) {
              batchPickLabel.append(
                el('span', 'stm-cw-mini-badge is-live', activeHit.sourceLabels.join(' · ')),
              );
            }
            row.append(batchPickLabel);
            libList.append(row);
            return;
          }

          const pickBtn = el('button', 'stm-cw-lib-pick');
          pickBtn.type = 'button';
          pickBtn.append(el('span', 'stm-cw-lib-name', wName));
          if (activeHit) {
            pickBtn.append(
              el('span', 'stm-cw-mini-badge is-live', activeHit.sourceLabels.join(' · ')),
            );
          }
          pickBtn.addEventListener('click', () => {
            libraryOpen = false;
            confirmDeleteBookName = '';
            void selectWorldBookAndLoad(wName);
          });

          const rowActions = el('div', 'stm-cw-lib-row-actions');
          if (confirmDeleteBookName === wName) {
            const confirmDelBtn = el(
              'button',
              'stm-cw-mini-btn is-danger stm-cw-lib-confirm-del',
              deletingBooksBusy ? '删除中…' : '确认删除?',
            );
            confirmDelBtn.type = 'button';
            confirmDelBtn.disabled = deletingBooksBusy;
            confirmDelBtn.addEventListener('click', evt => {
              evt.stopPropagation();
              void runDeleteWorldBooks([wName]);
            });

            const cancelDelBtn = el('button', 'stm-cw-mini-btn', '取消');
            cancelDelBtn.type = 'button';
            cancelDelBtn.addEventListener('click', evt => {
              evt.stopPropagation();
              confirmDeleteBookName = '';
              renderLibRows();
            });
            rowActions.append(confirmDelBtn, cancelDelBtn);
          } else {
            const isGlobOn = freshAct.globalBooks.includes(wName);
            const globToggle = el('label', 'stm-cw-glob-toggle');
            const globCheck = el('input', 'stm-wi-switch-input');
            globCheck.type = 'checkbox';
            globCheck.checked = isGlobOn;
            const globTrack = el('span', 'stm-wi-switch-track');
            globToggle.append(el('span', 'stm-cw-glob-label', '全局启用'), globCheck, globTrack);
            globCheck.addEventListener('change', () => {
              setGlobalWorldBookEnabled(wName, globCheck.checked, { getContext });
              renderHeader();
              renderBodyPreservingScroll();
            });

            const singleDelBtn = el('button', 'stm-cw-lib-del-btn');
            singleDelBtn.type = 'button';
            singleDelBtn.title = `从酒馆书库删除「${wName}」`;
            singleDelBtn.setAttribute('aria-label', `删除世界书 ${wName}`);
            singleDelBtn.append(createIconNode(doc, 'trash', 'stm-inline-svg'));
            singleDelBtn.addEventListener('click', evt => {
              evt.stopPropagation();
              confirmDeleteBookName = wName;
              renderLibRows();
            });

            rowActions.append(globToggle, singleDelBtn);
          }

          row.append(pickBtn, rowActions);
          libList.append(row);
        };

        const activeNameSet = new Set(freshAct.activeBooks.map(b => b.name));
        const activeFiltered = filteredNames.filter(n => activeNameSet.has(n));
        const inactiveFiltered = filteredNames.filter(n => !activeNameSet.has(n));

        if (!q && activeFiltered.length > 0 && inactiveFiltered.length > 0) {
          libList.append(el('div', 'stm-cw-lib-section-head', `当前生效中 (${activeFiltered.length})`));
          for (const wName of activeFiltered) appendBookRow(wName);
          libList.append(el('div', 'stm-cw-lib-section-head', `其他世界书 (${inactiveFiltered.length})`));
          for (const wName of inactiveFiltered) appendBookRow(wName);
        } else {
          for (const wName of filteredNames) appendBookRow(wName);
        }
        libList.scrollTop = savedScroll;
      };
      renderLibRows();
      libBox.append(batchBarSlot, libList);
      topCard.append(libBox);
      if (libraryScrollTop > 0) {
        queueMicrotask(() => {
          if (libList.isConnected) {
            libList.scrollTop = libraryScrollTop;
          }
        });
      }
    }

    container.append(topCard);

    // 3. 若当前没有任何选中书（即无任何生效世界书且尚未手动点选某本书），展示清爽空态引导
    if (!selectedWorldBook) {
      const emptyGuide = el('div', 'stm-cw-empty-card');
      emptyGuide.append(
        el('strong', 'stm-cw-empty-title', '当前对话暂未启用任何世界书'),
        el(
          'p',
          'stm-cw-empty-desc',
          embeddedInfo.hasEmbedded
            ? `检测到当前角色卡内嵌了世界书「${embeddedInfo.bookName}」（共 ${embeddedInfo.entryCount} 条设定），可直接一键提取并绑为主书，或新建专属世界书：`
            : '世界书只有在「绑为角色主书」或「开启为全局世界书」后才会真正发给 AI。你可以一键新建专属世界书，或从下方已有书库中直接启用：',
        ),
      );

      const ctaRow = el('div', 'stm-cw-inline-actions');
      if (embeddedInfo.hasEmbedded) {
        const quickImportEmbedBtn = el(
          'button',
          'stm-cw-primary-btn',
          reimportingBookBusy
            ? '正在导入…'
            : `从角色卡导入「${embeddedInfo.bookName}」(${embeddedInfo.entryCount} 条)`,
        );
        quickImportEmbedBtn.type = 'button';
        quickImportEmbedBtn.disabled = reimportingBookBusy;
        quickImportEmbedBtn.addEventListener('click', () => {
          void runEmbeddedReimport();
        });
        ctaRow.append(quickImportEmbedBtn);
      }

      const quickNewBtn = el(
        'button',
        embeddedInfo.hasEmbedded ? 'stm-cw-secondary-btn' : 'stm-cw-primary-btn',
        activation.isSingleChar
          ? '+ 为当前角色新建并绑定专属世界书'
          : '+ 新建并全局启用世界书',
      );
      quickNewBtn.type = 'button';
      quickNewBtn.addEventListener('click', async () => {
        const res = await createHostWorldBook('', {
          bindToCurrentChar: activation.isSingleChar,
          enableGlobal: !activation.isSingleChar,
          createStarterEntry: true,
          getContext,
        });
        selectedWorldBook = res.bookName;
        toastMessage(`已创建并启用世界书「${res.bookName}」`, 'success');
        renderHeader();
        await ensureWorldBookLoaded(res.bookName, { forceReload: true });
        renderBodyPreservingScroll();
      });
      ctaRow.append(quickNewBtn);
      emptyGuide.append(ctaRow);

      if (activation.worldNames.length > 0) {
        const quickPickWrap = el('div', 'stm-cw-quick-books');
        quickPickWrap.append(
          el('small', 'stm-cw-muted-note', '或从酒馆已有世界书中一键启用：'),
        );
        const qList = el('div', 'stm-cw-quick-book-chips');
        for (const wName of activation.worldNames.slice(0, 10)) {
          const itemBtn = el('button', 'stm-cw-secondary-btn', wName);
          itemBtn.type = 'button';
          itemBtn.title = activation.isSingleChar
            ? `点击查看「${wName}」，可一键绑为当前角色主书或开启全局`
            : `点击查看「${wName}」`;
          itemBtn.addEventListener('click', () => {
            void selectWorldBookAndLoad(wName);
          });
          qList.append(itemBtn);
        }
        quickPickWrap.append(qList);
        emptyGuide.append(quickPickWrap);
      }

      container.append(emptyGuide);
      return;
    }

    // 4. 【防假生效强提醒护栏】：选中了未启用的世界书时，顶部琥珀色强提醒 + 一键绑定按钮！
    const bookDiag = inspectWorldBookActivation(selectedWorldBook, activation);
    if (bookDiag.needsActivationWarning) {
      const inactiveAlert = el('div', 'stm-cw-alert is-inactive-book');
      const alertCopy = el('div', 'stm-cw-alert-text');
      alertCopy.append(
        createIconNode(doc, 'alert', 'stm-row-icon'),
        el('strong', '', bookDiag.warningText),
      );

      const alertActions = el('div', 'stm-cw-inline-actions');
      if (bookDiag.canBindToChar && profile.kind === 'char') {
        const bindCharBtn = el('button', 'stm-cw-alert-btn is-primary', '绑为当前角色主书');
        bindCharBtn.type = 'button';
        bindCharBtn.addEventListener('click', async () => {
          await flushAllPendingSaves();
          await bindCharacterPrimaryWorldBook(selectedWorldBook, {
            getContext,
            chid: profile.chid,
          });
          toastMessage(`已将「${selectedWorldBook}」绑为当前角色主世界书，立即生效！`, 'success');
          renderHeader();
          renderBodyPreservingScroll();
        });
        alertActions.append(bindCharBtn);
      }

      if (bookDiag.canBindToChat) {
        const bindChatBtn = el('button', 'stm-cw-alert-btn stm-cw-bind-chat-btn', '绑为当前聊天书');
        bindChatBtn.type = 'button';
        bindChatBtn.addEventListener('click', async () => {
          await flushAllPendingSaves();
          try {
            const res = await bindChatWorldBook(selectedWorldBook, { getContext });
            const memTip = res.memoryCoexistHint
              ? '（提示：已开记忆增强，将共用当前聊天书槽位）'
              : '';
            toastMessage(`已将「${selectedWorldBook}」绑为当前聊天世界书，立即生效！${memTip}`, 'success');
            renderHeader();
            renderBodyPreservingScroll();
          } catch (err) {
            toastMessage(err?.message || '绑定当前聊天世界书失败', 'error');
          }
        });
        alertActions.append(bindChatBtn);
      }

      const enableGlobalBtn = el('button', 'stm-cw-alert-btn', '开启为全局世界书');
      enableGlobalBtn.type = 'button';
      enableGlobalBtn.addEventListener('click', () => {
        setGlobalWorldBookEnabled(selectedWorldBook, true, { getContext });
        toastMessage(`已开启全局世界书「${selectedWorldBook}」，立即生效！`, 'success');
        renderHeader();
        renderBodyPreservingScroll();
      });
      alertActions.append(enableGlobalBtn);

      inactiveAlert.append(alertCopy, alertActions);
      container.append(inactiveAlert);
    }

    // 5. 当前世界书条目搜索、筛选与「+ 新增条目」工作区
    const entriesWorkspace = el('div', 'stm-cw-card stm-wi-workspace');
    const wsToolbar = el('div', 'stm-wi-toolbar');

    const searchWrap = el('div', 'stm-wi-search-wrap');
    searchWrap.append(createIconNode(doc, 'search', 'stm-wi-search-icon'));
    const searchInput = el('input', 'stm-cw-input stm-wi-search-input');
    searchInput.type = 'search';
    searchInput.placeholder = `在「${selectedWorldBook}」中搜索标题、触发词或正文…`;
    searchInput.value = wiSearchQuery;
    searchWrap.append(searchInput);

    const addEntryBtn = el('button', 'stm-cw-primary-btn stm-wi-add-btn');
    addEntryBtn.type = 'button';
    addEntryBtn.append(
      createIconNode(doc, 'plus', 'stm-row-icon'),
      el('span', '', '新增条目'),
    );

    wsToolbar.append(searchWrap, addEntryBtn);

    const filterBar = el('div', 'stm-cw-filter-bar');
    const entriesList = el('div', 'stm-wi-entries-list');
    liveRefs.wiFilterBarWrap = filterBar;
    liveRefs.wiEntryListWrap = entriesList;

    searchInput.addEventListener('input', () => {
      wiSearchQuery = searchInput.value;
      renderWorldEntriesInto(entriesList, filterBar, selectedWorldBook);
    });

    addEntryBtn.addEventListener('click', async () => {
      if (!loadedBookData || loadedBookName !== selectedWorldBook) {
        await ensureWorldBookLoaded(selectedWorldBook);
      }
      if (!loadedBookData) return;
      const created = createWorldInfoBookEntry(loadedBookData, {
        comment: '新世界书条目',
        constant: true,
        position: 0,
        content: '',
      });
      if (!created) return;
      wiFilterMode = 'all';
      wiSearchQuery = '';
      searchInput.value = '';
      expandedEntryUid = created.uid;
      confirmDeleteEntryUid = null;
      worldAutoSaver.schedule(selectedWorldBook, loadedBookData);
      renderWorldEntriesInto(entriesList, filterBar, selectedWorldBook);
    });

    entriesWorkspace.append(wsToolbar, filterBar, entriesList);
    container.append(entriesWorkspace);

    renderWorldEntriesInto(entriesList, filterBar, selectedWorldBook);
  }

  // ==========================================================================
  // 面板主体重绘、DOM 挂载与对外生命周期方法
  // ==========================================================================

  function computeChatSessionKey(ctx = getContext?.()) {
    const entityKey = readMergedCharProfile(ctx).entityKey || '';
    const rawChatId =
      typeof ctx?.getCurrentChatId === 'function'
        ? String(ctx.getCurrentChatId() ?? '')
        : String(ctx?.chatId ?? '');
    return `${entityKey}::${rawChatId}`;
  }

  function renderBody() {
    if (!bodyEl) return;
    const ctx = getContext?.();
    const curKey = readMergedCharProfile(ctx).entityKey || '';
    const curSessionKey = computeChatSessionKey(ctx);
    if (curKey !== lastEntityKey || curSessionKey !== lastChatSessionKey) {
      lastEntityKey = curKey;
      lastChatSessionKey = curSessionKey;
      renamingCharName = false;
      selectedGreetingIndex = 0;
      greetingSectionOpen = false;
      editingGreeting = false;
      confirmDeleteGreeting = false;
      exportMenuOpen = false;
      expandedEditorIds.clear();
      const act = resolveWorldInfoActivationState({ getContext });
      selectedWorldBook = act.defaultBookName || '';
      expandedEntryUid = null;
      confirmDeleteEntryUid = null;
    }

    bodyEl.replaceChildren();
    if (activeTab === 'world') {
      renderWorldTab(bodyEl);
    } else {
      renderCharTab(bodyEl);
    }
  }

  function renderBodyPreservingScroll() {
    if (!bodyEl) return;
    const prevTop = bodyEl.scrollTop;
    renderBody();
    bodyEl.scrollTop = prevTop;
  }

  function ensureDom() {
    const doc = globalThis.document;
    if (!doc) return null;
    if (dockEl?.isConnected) return dockEl;

    dockEl = doc.getElementById('stm-char-world-dock') || el('aside', 'stm-char-world-dock');
    dockEl.id = 'stm-char-world-dock';
    dockEl.className = 'stm-char-world-dock';
    dockEl.setAttribute('role', 'dialog');
    dockEl.setAttribute('aria-label', '角色档案与世界书一体页');
    dockEl.hidden = true;
    dockEl.replaceChildren();

    const stopBubble = evt => evt.stopPropagation();
    dockEl.addEventListener('mousedown', stopBubble);
    dockEl.addEventListener('touchstart', stopBubble, { passive: true });

    headerEl = el('div', 'stm-cw-header');
    bodyEl = el('div', 'stm-dock-body stm-cw-dock-body');
    dockEl.append(headerEl, bodyEl);
    doc.body.append(dockEl);

    if (cleanups.length === 0) {
      const onDocPointerDown = evt => {
        if (!isOpen || !dockEl) return;
        if (Date.now() - lastOpenedAt < 120) return;
        const target = evt.target;
        const elTarget =
          target && typeof target.closest === 'function' ? target : target?.parentElement;
        if (!elTarget || typeof elTarget.closest !== 'function') return;
        if (
          dockEl.contains(elTarget) ||
          elTarget.closest(
            '.stm-topbar-identity, #rightNavHolder > .drawer-toggle, #WI-SP-button > .drawer-toggle',
          ) ||
          elTarget.closest('.stm-portrait-lightbox')
        ) {
          return;
        }
        close();
      };

      const onDocKeyDown = evt => {
        if (evt.key !== 'Escape') return;
        if (lightboxEl) {
          evt.stopPropagation();
          closePortraitLightbox();
          return;
        }
        if (!isOpen) return;
        if (renamingCharName || creatingBookOpen || reimportBookOpen || libraryOpen) {
          evt.stopPropagation();
          renamingCharName = false;
          creatingBookOpen = false;
          reimportBookOpen = false;
          libraryOpen = false;
          libraryBatchMode = false;
          librarySelectedBooks.clear();
          confirmDeleteBookName = '';
          confirmBatchDeleteBooks = false;
          renderBodyPreservingScroll();
          return;
        }
        evt.stopPropagation();
        close();
      };

      doc.addEventListener('pointerdown', onDocPointerDown, true);
      doc.addEventListener('keydown', onDocKeyDown, true);
      globalThis.addEventListener?.('resize', scheduleSheldBounds, { passive: true });
      cleanups.push(
        () => doc.removeEventListener('pointerdown', onDocPointerDown, true),
        () => doc.removeEventListener('keydown', onDocKeyDown, true),
        () => globalThis.removeEventListener?.('resize', scheduleSheldBounds),
      );
    }

    return dockEl;
  }

  function fallbackOpenNativeDrawer(requestedTab = 'char', toggleIfOpen = true) {
    const drawerId = requestedTab === 'world' ? 'WI-SP-button' : 'rightNavHolder';
    openNativeDrawer(drawerId, { toggleIfOpen, getContext });
  }

  function open(initialTab = null) {
    const normalizedTab =
      initialTab === 'world' ? 'world' : initialTab === 'char' ? 'char' : null;
    const targetTab =
      normalizedTab || (!hasActiveChatSelection(getContext?.()) ? 'world' : activeTab || 'char');

    if (!isTabTakeoverEnabled(targetTab)) {
      fallbackOpenNativeDrawer(targetTab, false);
      return;
    }

    onBeforeOpen?.();
    closeAllNativeDrawers();
    ensureDom();

    activeTab = targetTab;

    isOpen = true;
    lastOpenedAt = Date.now();
    confirmDeleteGreeting = false;
    confirmDeleteEntryUid = null;

    if (!charAutoSaver.hasPending() && !worldAutoSaver.hasPending()) {
      saveBadgeState = { tone: 'idle', text: '自动保存' };
    }

    const activation = resolveWorldInfoActivationState({ getContext });
    if (
      selectedWorldBook &&
      activation.worldNames.length > 0 &&
      !activation.worldNames.includes(selectedWorldBook)
    ) {
      selectedWorldBook = '';
    }
    if (!selectedWorldBook && activation.defaultBookName) {
      selectedWorldBook = activation.defaultBookName;
    }

    // 异步预热官方模块，并在启用 lazyLoadCharacters 时无感补齐活跃角色完整设定；
    // 若检测到新导入角色卡的主书未出现在滞后的内存 `world_names` 中，自动静默刷新一次酒馆世界书名录。
    const shouldForceFreshWorld = !worldAutoSaver.hasPending() && !worldAutoSaver.isSaving();
    const curCtx = getContext?.();
    const activeCharMaybeShallow = Boolean(curCtx?.characters?.[curCtx?.characterId]?.shallow);
    void Promise.all([
      primeHostWorldInfoModule(),
      primeHostOpenAiModule(),
      activeCharMaybeShallow ? ensureCharacterUnshallowed({ getContext }) : Promise.resolve(null),
    ]).then(async ([, , unshallowed]) => {
      if (!isOpen) return;
      let refreshed = resolveWorldInfoActivationState({ getContext });
      const needsListRefresh =
        Boolean(refreshed.missingPrimaryCharBook) ||
        refreshed.worldNames.length === 0 ||
        (!refreshed.defaultBookName && inspectEmbeddedCharacterBook(getContext?.()).hasEmbedded);
      if (needsListRefresh) {
        const listUpdated = await refreshHostWorldInfoList({ getContext });
        if (!isOpen) return;
        if (listUpdated) {
          refreshed = resolveWorldInfoActivationState({ getContext });
        }
      }

      renderHeader();
      if (unshallowed && activeTab === 'char') {
        renderBodyPreservingScroll();
      }
      if (activeTab === 'world') {
        if (
          selectedWorldBook &&
          refreshed.worldNames.length > 0 &&
          !refreshed.worldNames.includes(selectedWorldBook)
        ) {
          selectedWorldBook = '';
        }
        if (!selectedWorldBook && refreshed.defaultBookName) {
          selectedWorldBook = refreshed.defaultBookName;
        }
        if (!selectedWorldBook && refreshed.missingPrimaryCharBook) {
          const probeName =
            sanitizeHostWorldBookName(refreshed.missingPrimaryCharBook) ||
            refreshed.missingPrimaryCharBook;
          const probed = await loadHostWorldBook(probeName, { getContext }).catch(() => null);
          if (!isOpen) return;
          if (probed && typeof probed === 'object' && Object.keys(probed.entries || {}).length > 0) {
            selectedWorldBook = probeName;
            loadedBookName = probeName;
            loadedBookData = probed;
            loadingBookName = '';
            renderHeader();
            renderBodyPreservingScroll();
            return;
          }
        }
        if (selectedWorldBook) {
          void ensureWorldBookLoaded(selectedWorldBook, {
            forceReload: shouldForceFreshWorld,
            silentLoading: true,
          });
        } else {
          renderBodyPreservingScroll();
        }
      }
    });

    if (dockEl) {
      dockEl.hidden = false;
    }
    syncBoundsToSheldNow();
    renderHeader();
    renderBody();
    if (activeTab === 'world' && selectedWorldBook) {
      void ensureWorldBookLoaded(selectedWorldBook, {
        forceReload: shouldForceFreshWorld,
        silentLoading: true,
      });
    }
    onOpenStateChange?.(true);
  }

  function close() {
    closePortraitLightbox();
    if (!isOpen) return;
    void flushAllPendingSaves();
    isOpen = false;
    renamingCharName = false;
    creatingBookOpen = false;
    reimportBookOpen = false;
    libraryOpen = false;
    libraryBatchMode = false;
    librarySelectedBooks.clear();
    confirmDeleteBookName = '';
    confirmBatchDeleteBooks = false;
    confirmDeleteGreeting = false;
    exportMenuOpen = false;
    coverStudioOpen = false;
    confirmDeleteEntryUid = null;
    if (dockEl) {
      dockEl.hidden = true;
    }
    onOpenStateChange?.(false);
  }

  /**
   * 响应宿主 `CHAT_CHANGED`：
   * 1. 先安全 flush 旧角色与旧世界书锁定的未存修改（绝不串写到新角色）；
   * 2. 若返回了无活跃对话的书架首页，干净关闭面板；
   * 3. 若面板正处于打开状态且切换到了新角色/新聊天分支，平滑刷新为新角色档案与生效世界书。
   */
  async function handleChatChanged() {
    closePortraitLightbox();
    renamingCharName = false;
    creatingBookOpen = false;
    reimportBookOpen = false;
    libraryOpen = false;
    libraryBatchMode = false;
    librarySelectedBooks.clear();
    confirmDeleteBookName = '';
    confirmBatchDeleteBooks = false;
    confirmDeleteGreeting = false;
    exportMenuOpen = false;
    coverStudioOpen = false;
    confirmDeleteEntryUid = null;

    await flushAllPendingSaves();
    selectedWorldBook = '';
    loadedBookName = '';
    loadedBookData = null;
    loadingBookName = '';
    expandedEntryUid = null;

    const ctx = getContext?.();
    if (!hasActiveChatSelection(ctx)) {
      if (isOpen) {
        close();
      }
      return;
    }

    if (!isOpen) return;

    if (ctx?.characters?.[ctx?.characterId]?.shallow) {
      await ensureCharacterUnshallowed({ getContext });
    }

    let act = resolveWorldInfoActivationState({ getContext });
    if (act.missingPrimaryCharBook || act.worldNames.length === 0) {
      const updated = await refreshHostWorldInfoList({ getContext });
      if (updated) {
        act = resolveWorldInfoActivationState({ getContext });
      }
    }
    selectedWorldBook = act.defaultBookName || '';
    expandedEntryUid = null;
    renderHeader();
    renderBody();
    if (activeTab === 'world' && selectedWorldBook) {
      await ensureWorldBookLoaded(selectedWorldBook, { forceReload: true });
    }
  }

  function toggle(initialTab = null) {
    const normalizedTab =
      initialTab === 'world' ? 'world' : initialTab === 'char' ? 'char' : null;
    const targetTab = normalizedTab || (isOpen ? activeTab : hasActiveChatSelection(getContext?.()) ? 'char' : 'world');

    if (!isTabTakeoverEnabled(targetTab)) {
      if (isOpen) close();
      fallbackOpenNativeDrawer(targetTab, true);
      return;
    }

    if (isOpen) {
      if (normalizedTab && normalizedTab !== activeTab) {
        void flushAllPendingSaves().then(() => {
          activeTab = normalizedTab;
          renderHeader();
          renderBody();
          if (activeTab === 'world' && selectedWorldBook) {
            void ensureWorldBookLoaded(selectedWorldBook, {
              forceReload: true,
              silentLoading: true,
            });
          }
        });
        return;
      }
      close();
    } else {
      open(targetTab);
    }
  }

  function refresh() {
    if (!isTakeoverEnabled() || (isOpen && !isTabTakeoverEnabled(activeTab))) {
      close();
      return;
    }
    if (!isOpen) return;
    syncBoundsToSheldNow();

    const doc = globalThis.document;
    const activeEl = doc?.activeElement;
    const ctx = getContext?.();
    const curSessionKey = computeChatSessionKey(ctx);
    const isTypingInside =
      activeEl &&
      dockEl?.contains(activeEl) &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT');

    // 防打断保护：若用户正在输入框内编辑，或自动保存挂起/落盘中，且当前聊天会话未切换，则仅刷新顶栏状态徽章，绝不销毁重建表单吞焦点！
    if (
      (internalBusy ||
        charAutoSaver.hasPending() ||
        charAutoSaver.isSaving() ||
        worldAutoSaver.hasPending() ||
        worldAutoSaver.isSaving() ||
        isTypingInside) &&
      curSessionKey === lastChatSessionKey
    ) {
      renderHeader();
      return;
    }

    renderHeader();
    renderBodyPreservingScroll();
  }

  function destroy() {
    clearSwipeSyncTimers();
    closePortraitLightbox();
    if (charAutoSaver.hasPending() || worldAutoSaver.hasPending()) {
      void flushAllPendingSaves();
    } else {
      charAutoSaver.cancel();
      worldAutoSaver.cancel();
    }
    if (boundsRaf) {
      if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(boundsRaf);
      } else {
        clearTimeout(boundsRaf);
      }
      boundsRaf = 0;
    }
    while (cleanups.length) {
      const off = cleanups.pop();
      off?.();
    }
    isOpen = false;
    dockEl?.remove();
    dockEl = null;
    headerEl = null;
    bodyEl = null;
  }

  return {
    isOpen: () => isOpen,
    isLightboxOpen: () => Boolean(lightboxEl?.isConnected || globalThis.document?.getElementById?.('stm-portrait-lightbox')),
    closeLightbox: closePortraitLightbox,
    getActiveTab: () => activeTab,
    open,
    close,
    toggle,
    refresh,
    handleChatChanged,
    handleWorldInfoUpdated,
    handleExternalSwipeSync,
    flushPendingSave: flushAllPendingSaves,
    destroy,
  };
}
