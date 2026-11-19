/**
 * ST伴侣 (st-mate) · 顶栏下拉「角色档案与清爽世界书一体页」(.stm-char-world-dock)
 * 视觉与交互准则：
 * 1. 点击顶栏左上角 [头像 + 角色名] 展开，桌面端对齐 #sheld 聊天主栏宽度，窄屏 (<=1000px) 100vw 贴边；
 * 2. 与 apiDock / presetDock / readerDock / 原生抽屉 / 设置弹窗完美互斥自动收起；关闭模块开关时无损回退酒馆原生角色/世界书抽屉；
 * 3. Tab 1「角色档案」：高清立绘大图预览、一键导出 PNG/JSON（导出前自动 flush 草稿）、专属预设绑定秒切 + 主世界书绑定、开场白预览增删改与「开局第1楼一键换开场白」、核心设定折叠编辑（V1+V2 双写）；
 * 4. Tab 2「清爽世界书」：四源生效聚合、未启用世界书强预警一键绑定、预设世界书槽位双关自检修复、人话蓝绿灯切换、绿灯空词预警、中英文逗号关键词解析与 300ms 防串书自动落盘。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.7.5';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.7.5';
import {
  closeAllNativeDrawers,
  openNativeDrawer,
  toastMessage,
} from '../shell/host-actions.js?v=0.7.5';
import {
  getBoundPresetForEntity,
  getHostPresetState,
  primeHostOpenAiModule,
  selectHostPresetByName,
  setBoundPresetForEntity,
} from './preset-backend.js?v=0.7.5';
import {
  CHAR_PROFILE_AUTO_SAVE_MS,
  WI_DEPTH_ROLE_OPTIONS,
  WI_POSITION_OPTIONS,
  WORLD_INFO_AUTO_SAVE_MS,
  applyGreetingToFirstChatFloor,
  bindCharacterPrimaryWorldBook,
  buildAddAlternateGreetingPatch,
  buildDeleteAlternateGreetingPatch,
  buildGreetingEditPatch,
  countUnicodeChars,
  createCharacterProfileAutoSaver,
  createHostWorldBook,
  createWorldBookAutoSaver,
  createWorldInfoBookEntry,
  cycleWorldInfoEntryTriggerMode,
  deleteWorldInfoBookEntry,
  enablePresetWorldInfoSlots,
  exportActiveCharacterCard,
  filterWorldInfoEntries,
  formatWorldInfoKeywords,
  inspectPresetWorldInfoSlots,
  inspectWorldBookActivation,
  loadHostWorldBook,
  primeHostWorldInfoModule,
  readActiveCharacterProfile,
  readWorldInfoEntries,
  resolveWorldInfoActivationState,
  saveCharacterProfilePatch,
  saveHostWorldBook,
  setGlobalWorldBookEnabled,
  toggleWorldInfoEntryEnabled,
  updateWorldInfoBookEntry,
} from './char-world-backend.js?v=0.7.5';

const CORE_FIELD_DEFS = Object.freeze([
  {
    id: 'description',
    title: '角色设定描述',
    placeholder: '填写角色外貌、身份、核心过往与人物设定…',
    rows: 6,
    showLiveCharCount: true,
  },
  {
    id: 'personality',
    title: '性格特征',
    placeholder: '简明概括角色的性格底色、说话风格与行为动机…',
    rows: 4,
  },
  {
    id: 'scenario',
    title: '场景与背景',
    placeholder: '当前故事发生的时代、地点与开场处境…',
    rows: 4,
  },
  {
    id: 'creatorNotes',
    title: '作者注释 / 食用指南',
    placeholder: '仅供玩家阅读的食用说明、排雷或推荐玩法（不会发给 AI）…',
    rows: 4,
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
    rows: 5,
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
  const openFieldSections = new Set(); // 核心设定默认全部折叠，保持角色画册感与防剧透
  const charDraftMap = new Map(); // avatar -> unsaved patch overlay

  // 清爽世界书局部交互状态
  let selectedWorldBook = '';
  let loadedBookName = '';
  let loadedBookData = null;
  let loadingBookName = '';
  let loadSeq = 0;
  let libraryOpen = false;
  let libraryQuery = '';
  let creatingBookOpen = false;
  let newBookNameDraft = '';
  let wiSearchQuery = '';
  let wiFilterMode = 'all'; // 'all' | 'constant' | 'keyword' | 'disabled'
  let expandedEntryUid = null;
  let confirmDeleteEntryUid = null;

  let saveBadgeState = { tone: 'idle', text: '改动自动存盘' };

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

  function isTakeoverEnabled() {
    const s = store.get();
    return Boolean(s.shellEnabled && s.modules.charWorld);
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

  async function ensureWorldBookLoaded(bookName, { forceReload = false } = {}) {
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

    const seq = ++loadSeq;
    loadingBookName = clean;
    if (isOpen && activeTab === 'world') {
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

  async function selectWorldBookAndLoad(nextBookName, { switchToWorldTab = false } = {}) {
    const clean = typeof nextBookName === 'string' ? nextBookName.trim() : '';
    await flushAllPendingSaves();
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
      el('span', '', profile.kind === 'group' ? '群聊档案' : '角色档案'),
    );
    charTabBtn.addEventListener('click', async () => {
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
      el('span', '', '清爽世界书'),
      countPill,
    );
    worldTabBtn.addEventListener('click', async () => {
      if (activeTab === 'world') return;
      await flushAllPendingSaves();
      activeTab = 'world';
      if (!selectedWorldBook && activation.defaultBookName) {
        selectedWorldBook = activation.defaultBookName;
      }
      renderHeader();
      renderBody();
      if (selectedWorldBook) {
        void ensureWorldBookLoaded(selectedWorldBook);
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

    rightWrap.append(saveBadge, closeBtn);
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
    worldSummaryBox.append(wHead, wSummaryBtn);
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
    const artUrl = profile.portraitUrl || profile.thumbUrl;
    const hero = el('div', 'stm-cw-hero is-char-showcase');

    const portraitStage = el('div', 'stm-cw-portrait-stage');
    if (artUrl) {
      const ambientBg = el('div', 'stm-cw-portrait-ambient');
      ambientBg.style.setProperty('--stm-char-art', `url(${JSON.stringify(artUrl)})`);
      portraitStage.append(ambientBg);
    }

    const portraitBtn = el('button', 'stm-cw-portrait-btn is-showcase');
    portraitBtn.type = 'button';
    portraitBtn.title = `点击查看高清完整原图${profile.avatar ? ` (${profile.avatar})` : ''}`;
    const portraitImg = el('img', 'stm-cw-portrait-img');
    portraitImg.src = artUrl;
    portraitImg.alt = profile.name;
    const zoomIcon = el('span', 'stm-cw-portrait-zoom');
    zoomIcon.innerHTML = svgMarkup('maximize');
    portraitBtn.append(portraitImg, zoomIcon);
    portraitBtn.addEventListener('click', () => {
      openPortraitLightbox(artUrl, profile.name);
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
      titleRow.append(renameBtn);
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
    const statSub = el(
      'p',
      'stm-cw-hero-sub',
      `设定 ${totalSettingChars} 字 · 开场白 ${profile.greetings.length} 条`,
    );
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

    // 3. 清爽无外框单行绑定栏：绑定预设 + 按需显示世界书（无角色书且无记忆聊天书时自动隐去，不占空间）
    const inlineBinds = el('div', 'stm-cw-inline-binds');
    inlineBinds.append(buildInlinePresetBindRow(ctx, profile));

    const hasCharOrChatWorld = Boolean(
      profile.primaryWorld ||
        activation.chatBook ||
        (Array.isArray(activation.extraCharBooks) && activation.extraCharBooks.length > 0),
    );

    if (hasCharOrChatWorld) {
      const worldRow = el('div', 'stm-cw-inline-bind-row is-world-row');
      const wLabel = el('span', 'stm-cw-inline-bind-label');
      const isMemoryOrChatOnly = !profile.primaryWorld && Boolean(activation.chatBook);
      wLabel.append(
        createIconNode(doc, 'globe', 'stm-row-icon'),
        el('span', '', isMemoryOrChatOnly ? '聊天/记忆书' : '角色世界书'),
      );

      const targetJumpBook =
        profile.primaryWorld ||
        activation.chatBook ||
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
    }

    metaCol.append(heroTopBlock, exportRow, inlineBinds);
    hero.append(portraitStage, metaCol);
    container.append(hero);

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
        const greetTextarea = el('textarea', 'stm-cw-textarea stm-cw-greeting-editor');
        greetTextarea.rows = 7;
        greetTextarea.placeholder = `在此编写 ${curGreeting.label} 正文（自动保存至角色卡）…`;
        greetTextarea.value = curGreeting.content;
        greetTextarea.addEventListener('input', () => {
          const latest = readMergedCharProfile(getContext?.());
          const patch = buildGreetingEditPatch(latest, curGreeting.index, greetTextarea.value);
          queueCharacterDraftPatch(latest, patch);
        });
        greetBody.append(greetTextarea);
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
        if (def.isDualPrompt) {
          const sysLabel = el('label', 'stm-cw-sublabel', '角色系统提示词');
          const sysArea = el('textarea', 'stm-cw-textarea');
          sysArea.rows = 4;
          sysArea.placeholder = '覆盖或补充给当前角色的专属主系统提示词（留空则完全跟随预设）…';
          sysArea.value = profile.systemPrompt;

          const postLabel = el(
            'label',
            'stm-cw-sublabel',
            '历史后强调指令',
          );
          const postArea = el('textarea', 'stm-cw-textarea');
          postArea.rows = 4;
          postArea.placeholder = '注入在聊天记录末尾的角色专属强调指令（留空则完全跟随预设）…';
          postArea.value = profile.postHistoryInstructions;

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

          bodyBox.append(sysLabel, sysArea, postLabel, postArea);
        } else {
          const area = el('textarea', 'stm-cw-textarea');
          area.rows = def.rows || 5;
          area.placeholder = def.placeholder || '';
          area.value = profile[def.id] || '';
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
          bodyBox.append(area);
        }
        card.append(bodyBox);
      }

      sheetList.append(card);
    }

    container.append(sheetList);
  }

  function renderCharTab(container) {
    const ctx = getContext?.();
    const profile = readMergedCharProfile(ctx);
    const activation = resolveWorldInfoActivationState({ getContext });

    if (!profile.active || profile.kind === 'none') {
      const emptyCard = el('div', 'stm-cw-empty-card');
      emptyCard.append(
        el('strong', 'stm-cw-empty-title', '当前尚未进入角色对话'),
        el('p', 'stm-cw-empty-desc', '请先从书架打开任意角色卡或群聊，即可查看角色设定、导出角色卡或一键切换开场白；也可直接切到右侧「清爽世界书」管理全局世界书。'),
      );
      const goWorldBtn = el('button', 'stm-cw-primary-btn', '切换到清爽世界书 ›');
      goWorldBtn.type = 'button';
      goWorldBtn.addEventListener('click', () => {
        activeTab = 'world';
        renderHeader();
        renderBody();
      });
      emptyCard.append(goWorldBtn);
      container.append(emptyCard);
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

    // 同步筛选胶囊计数
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

    for (const item of visibleEntries) {
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

      listContainer.append(card);
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
      if (creatingBookOpen && !newBookNameDraft) {
        newBookNameDraft =
          profile.kind === 'char' && profile.name ? `${profile.name}设定集` : '新建世界书';
      }
      renderBodyPreservingScroll();
    });

    const nativeWiBtn = el('button', 'stm-ghost-link', '原生面板 ›');
    nativeWiBtn.type = 'button';
    nativeWiBtn.title = '打开酒馆原生世界书高级管理面板';
    nativeWiBtn.addEventListener('click', async () => {
      await flushAllPendingSaves();
      close();
      openNativeDrawer('WI-SP-button', { getContext });
    });

    headRight.append(libBtn, newBookBtn, nativeWiBtn);
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

      const doCreate = async ({ bindChar = false, enableGlob = false }) => {
        await flushAllPendingSaves();
        try {
          const res = await createHostWorldBook(newBookNameDraft, {
            bindToCurrentChar: bindChar,
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

      const globalCreateBtn = el('button', 'stm-cw-secondary-btn', '新建并全局启用');
      globalCreateBtn.type = 'button';
      globalCreateBtn.addEventListener('click', () => void doCreate({ enableGlob: true }));
      cRow.append(globalCreateBtn);

      createBar.append(cRow);
      topCard.append(createBar);
    }

    // 内联「全部世界书库 / 全局开关管理」面板
    if (libraryOpen) {
      const libBox = el('div', 'stm-cw-subdrawer');
      const libHead = el('div', 'stm-cw-bind-head');
      libHead.append(
        el('strong', 'stm-cw-sublabel', '全部世界书库（点书名切换查看，右侧勾选「全局开启」对所有聊天生效）'),
      );
      if (activation.worldNames.length > 5) {
        const libSearch = el('input', 'stm-cw-input stm-cw-lib-search');
        libSearch.type = 'search';
        libSearch.placeholder = '搜索书名…';
        libSearch.value = libraryQuery;
        libSearch.addEventListener('input', () => {
          libraryQuery = libSearch.value;
          renderLibRows();
        });
        libHead.append(libSearch);
      }
      libBox.append(libHead);

      const libList = el('div', 'stm-cw-lib-list');
      const renderLibRows = () => {
        libList.replaceChildren();
        const freshAct = resolveWorldInfoActivationState({ getContext });
        const q = libraryQuery.trim().toLowerCase();
        const filteredNames = freshAct.worldNames.filter(n => !q || n.toLowerCase().includes(q));
        if (filteredNames.length === 0) {
          libList.append(el('div', 'stm-cw-empty-inline', '没有匹配的世界书'));
          return;
        }
        for (const wName of filteredNames) {
          const row = el(
            'div',
            `stm-cw-lib-row${selectedWorldBook === wName ? ' is-current' : ''}`,
          );
          const pickBtn = el('button', 'stm-cw-lib-pick');
          pickBtn.type = 'button';
          pickBtn.append(el('span', 'stm-cw-lib-name', wName));
          const activeHit = freshAct.activeBooks.find(b => b.name === wName);
          if (activeHit) {
            pickBtn.append(
              el('span', 'stm-cw-mini-badge is-live', activeHit.sourceLabels.join(' · ')),
            );
          }
          pickBtn.addEventListener('click', () => {
            libraryOpen = false;
            void selectWorldBookAndLoad(wName);
          });

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

          row.append(pickBtn, globToggle);
          libList.append(row);
        }
      };
      renderLibRows();
      libBox.append(libList);
      topCard.append(libBox);
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
          '世界书只有在「绑为角色主书」或「开启为全局世界书」后才会真正发给 AI。你可以一键新建专属世界书，或从下方已有书库中直接启用：',
        ),
      );

      const ctaRow = el('div', 'stm-cw-inline-actions');
      const quickNewBtn = el(
        'button',
        'stm-cw-primary-btn',
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
    dockEl.setAttribute('aria-label', '角色档案与清爽世界书一体页');
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
          elTarget.closest('.stm-topbar-identity') ||
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
        if (renamingCharName || creatingBookOpen || libraryOpen) {
          evt.stopPropagation();
          renamingCharName = false;
          creatingBookOpen = false;
          libraryOpen = false;
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

    if (!isTakeoverEnabled()) {
      fallbackOpenNativeDrawer(normalizedTab || activeTab, false);
      return;
    }

    onBeforeOpen?.();
    closeAllNativeDrawers();
    ensureDom();

    if (normalizedTab) {
      activeTab = normalizedTab;
    } else if (!hasActiveChatSelection(getContext?.())) {
      activeTab = 'world';
    }

    isOpen = true;
    lastOpenedAt = Date.now();
    confirmDeleteGreeting = false;
    confirmDeleteEntryUid = null;

    if (!charAutoSaver.hasPending() && !worldAutoSaver.hasPending()) {
      saveBadgeState = { tone: 'idle', text: '改动自动存盘' };
    }

    const activation = resolveWorldInfoActivationState({ getContext });
    if (!selectedWorldBook && activation.defaultBookName) {
      selectedWorldBook = activation.defaultBookName;
    }

    // 异步预热官方模块（读取完整缓存或补齐槽位状态）
    void Promise.all([primeHostWorldInfoModule(), primeHostOpenAiModule()]).then(() => {
      if (!isOpen) return;
      renderHeader();
      if (activeTab === 'world') {
        const refreshed = resolveWorldInfoActivationState({ getContext });
        if (!selectedWorldBook && refreshed.defaultBookName) {
          selectedWorldBook = refreshed.defaultBookName;
        }
        if (selectedWorldBook) {
          void ensureWorldBookLoaded(selectedWorldBook);
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
      void ensureWorldBookLoaded(selectedWorldBook);
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
    libraryOpen = false;
    confirmDeleteGreeting = false;
    exportMenuOpen = false;
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
    libraryOpen = false;
    confirmDeleteGreeting = false;
    exportMenuOpen = false;
    confirmDeleteEntryUid = null;

    await flushAllPendingSaves();

    const ctx = getContext?.();
    if (!hasActiveChatSelection(ctx)) {
      if (isOpen) {
        close();
      }
      return;
    }

    if (!isOpen) return;

    const act = resolveWorldInfoActivationState({ getContext });
    selectedWorldBook = act.defaultBookName || '';
    expandedEntryUid = null;
    renderHeader();
    renderBody();
    if (activeTab === 'world' && selectedWorldBook) {
      await ensureWorldBookLoaded(selectedWorldBook);
    }
  }

  function toggle(initialTab = null) {
    const normalizedTab =
      initialTab === 'world' ? 'world' : initialTab === 'char' ? 'char' : null;

    if (!isTakeoverEnabled()) {
      fallbackOpenNativeDrawer(normalizedTab || 'char', true);
      return;
    }

    if (isOpen) {
      if (normalizedTab && normalizedTab !== activeTab) {
        void flushAllPendingSaves().then(() => {
          activeTab = normalizedTab;
          renderHeader();
          renderBody();
          if (activeTab === 'world' && selectedWorldBook) {
            void ensureWorldBookLoaded(selectedWorldBook);
          }
        });
        return;
      }
      close();
    } else {
      open(normalizedTab);
    }
  }

  function refresh() {
    if (!isTakeoverEnabled()) {
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
    flushPendingSave: flushAllPendingSaves,
    destroy,
  };
}
