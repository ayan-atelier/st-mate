/**
 * ST伴侣 (st-mate) · 与酒馆主栏等宽的顶栏下拉「页面排版与背景」抽屉 (.stm-reader-dock)
 * 严格遵循用户手绘三段式结构（零多余标题栏、少即是多）：
 * 1. 文字排版：字号 (A- 16 +A) · 边距 (小 - 6 + 大) · 首行 (顶格 / 缩进) · 行距 (紧 - 2.0 + 松)
 * 2. 背景图：角色图 · 自定义（支持本地图库自由框选裁切 + 图床直链）· 原版 + 亮度 / 清晰度双滑杆
 * 3. 其它：字体切换 · 隐去头像 · 无框书页 · 右滑重Roll开关（直连酒馆底层 power_user.gestures）
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.3.3';
import { svgMarkup } from '../core/icons.js?v=0.3.3';
import { sanitizeAssetUrl } from '../core/schema.js?v=0.3.3';
import {
  closeAllNativeDrawers,
  getSwipeGesturesEnabled,
  setSwipeGesturesEnabled,
  toastMessage,
  uploadBackgroundAsset,
} from './host-actions.js?v=0.3.3';
import { openImageCropDialog } from './image-cropper.js?v=0.3.3';

const FONT_OPTIONS = Object.freeze([
  { id: 'default', shortLabel: '默认', label: '跟随原美化' },
  { id: 'serif', shortLabel: '宋体', label: '书卷宋体' },
  { id: 'sans', shortLabel: '黑体', label: '清爽黑体' },
  { id: 'kai', shortLabel: '楷体', label: '温润楷体' },
  { id: 'custom', shortLabel: '自定义', label: '自定义字体链接' },
]);

export function createReaderDock({ getContext, store, onPreviewAtmosphere, onOpenStateChange }) {
  let dockEl = null;
  let bodyEl = null;
  let purePillBtn = null;
  let isOpen = false;
  let lastOpenedAt = 0;
  let fontDrawerOpen = false;
  let showUrlInput = false;
  let busyUploading = false;
  let previewRaf = 0;
  let boundsRaf = 0;
  const cleanups = [];

  function el(tag, className = '', text = '') {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function scheduleLiveVibe(vibePatch) {
    store.update({ vibe: vibePatch }, { silent: true });
    if (!previewRaf) {
      const req = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16));
      previewRaf = req(() => {
        previewRaf = 0;
        onPreviewAtmosphere?.();
      });
    }
  }

  function commitVibe(vibePatch, { reRender = true } = {}) {
    store.update({ vibe: vibePatch });
    if (reRender && isOpen) {
      renderBody();
    }
  }

  /**
   * 与酒馆聊天主栏 (#sheld) 严格等宽居中对齐（与人设馆/原生抽屉视觉秩序完全一致；窄屏 <=1000px 自动铺满 100vw）。
   */
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

  /**
   * 手绘稿同款步进滑轨控件：左步进键 (A- / 小- / 紧-) + 中间带实时数值的胶囊滑轨 + 右步进键 (+A / +大 / +松)
   */
  function makeStepPillControl({
    title,
    leftLabel,
    rightLabel,
    min,
    max,
    step,
    value,
    formatBadge,
    onStepLeft,
    onStepRight,
    onInput,
  }) {
    const cell = el('div', 'stm-type-cell');
    const head = el('div', 'stm-cell-head');
    head.append(el('span', 'stm-cell-label', title));
    cell.append(head);

    const pill = el('div', 'stm-wr-pill');

    const leftBtn = el('button', 'stm-wr-step', leftLabel);
    leftBtn.type = 'button';
    leftBtn.addEventListener('click', onStepLeft);

    const trackWrap = el('div', 'stm-wr-track-wrap');
    const range = el('input', 'stm-wr-range');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    range.setAttribute('aria-label', title);

    const badge = el('span', 'stm-wr-thumb-badge');
    const syncVisual = num => {
      const pct = max > min ? ((num - min) / (max - min)) * 100 : 0;
      trackWrap.style.setProperty('--stm-wr-pct', `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`);
      badge.textContent = formatBadge(num);
    };
    syncVisual(value);

    range.addEventListener('input', () => {
      const num = Number(range.value);
      syncVisual(num);
      onInput(num);
    });

    trackWrap.append(range, badge);

    const rightBtn = el('button', 'stm-wr-step', rightLabel);
    rightBtn.type = 'button';
    rightBtn.addEventListener('click', onStepRight);

    pill.append(leftBtn, trackWrap, rightBtn);
    cell.append(pill);
    return cell;
  }

  function makePercentSlider({ label, min, max, value, onInput }) {
    const row = el('div', 'stm-mufy-slider');
    const head = el('div', 'stm-mufy-head');
    head.append(el('span', 'stm-mufy-label', label));
    const valSpan = el('span', 'stm-mufy-val', `${value}%`);
    head.append(valSpan);

    const input = el('input', 'stm-mufy-range');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);

    const syncFill = num => {
      const pct = max > min ? ((num - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--stm-fill', `${pct.toFixed(1)}%`);
      valSpan.textContent = `${num}%`;
    };
    syncFill(value);

    input.addEventListener('input', () => {
      const num = Number(input.value);
      syncFill(num);
      onInput(num);
    });

    row.append(head, input);
    return row;
  }

  async function handleCustomPickAndCrop(rawFile) {
    if (!rawFile || busyUploading) return;
    const doc = globalThis.document;
    const sheld = doc?.getElementById('sheld');
    const sRect = sheld?.getBoundingClientRect?.();
    const currentAspect =
      sRect && sRect.width > 0 && sRect.height > 0 ? sRect.width / sRect.height : 0.62;

    const isGif = String(rawFile.type || '').toLowerCase() === 'image/gif';
    const chosenFile = isGif
      ? rawFile
      : await openImageCropDialog({ file: rawFile, aspectRatio: currentAspect });

    if (!chosenFile) return;

    busyUploading = true;
    if (isOpen) renderBody();
    try {
      const relUrl = await uploadBackgroundAsset(chosenFile, getContext);
      const shortName = String(rawFile.name || '自定义背景').slice(0, 60);
      const curClarity = store.get().vibe.backdropClarity;
      commitVibe({
        backdropMode: 'custom',
        customBackdropUrl: relUrl,
        customBackdropName: shortName,
        // 若仍停留在旧版初始 55% 柔焦值，上传自定义新图时自动拉满 100% 原画清晰度
        ...(curClarity === 55 ? { backdropClarity: 100 } : {}),
      });
      toastMessage('自定义高清底图已生效', 'success');
    } catch (err) {
      toastMessage(err?.message || '底图上传失败', 'error');
    } finally {
      busyUploading = false;
      if (isOpen) renderBody();
    }
  }

  function makeInlineUrlRow({ initialValue = '', placeholder, buttonText = '确定', onApply }) {
    const row = el('div', 'stm-dock-url-row');
    const input = el('input', 'stm-dock-url-input');
    input.type = 'url';
    input.value = initialValue;
    input.placeholder = placeholder;
    const btn = el('button', 'stm-dock-url-btn', buttonText);
    btn.type = 'button';
    btn.addEventListener('click', () => onApply(input.value));
    input.addEventListener('keydown', evt => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        onApply(input.value);
      }
    });
    row.append(input, btn);
    return row;
  }

  function renderBody() {
    const doc = globalThis.document;
    if (!doc || !bodyEl) return;
    bodyEl.replaceChildren();

    const current = store.get();
    const vibe = current.vibe;

    // =========================================================================
    // 1. 文字排版（字号 · 边距 · 首行 · 行距）
    // =========================================================================
    const secType = el('section', 'stm-dock-section');
    const secTypeHead = el('div', 'stm-sec-head');
    secTypeHead.append(el('span', 'stm-sec-title', '文字排版'));

    const resetBtn = el('button', 'stm-reset-link', '重置');
    resetBtn.type = 'button';
    resetBtn.title = '将页面排版与背景全部恢复默认';
    resetBtn.addEventListener('click', () => {
      showUrlInput = false;
      fontDrawerOpen = false;
      commitVibe({
        backdropMode: 'theme',
        backdropBrightness: 42,
        backdropClarity: 100,
        fontSizePx: 0,
        fontScale: 100,
        paddingX: 0,
        desktopPaddingX: 0,
        lineHeight: 0,
        paragraphIndent: 'default',
        hideAvatars: false,
        bookPageFlow: false,
        fontChoice: 'default',
      });
    });
    secTypeHead.append(resetBtn);
    secType.append(secTypeHead);

    const typeGrid = el('div', 'stm-type-grid');

    // 1-1 字号：A- 16 +A
    typeGrid.append(
      makeStepPillControl({
        title: '字号',
        leftLabel: 'A−',
        rightLabel: '+A',
        min: 12,
        max: 26,
        step: 1,
        value: vibe.fontSizePx > 0 ? vibe.fontSizePx : 12,
        formatBadge: n => (n <= 12 ? '默认' : `${n}`),
        onStepLeft: () => {
          const cur = store.get().vibe.fontSizePx;
          const next = cur <= 0 ? 15 : cur <= 13 ? 0 : cur - 1;
          commitVibe({ fontSizePx: next });
        },
        onStepRight: () => {
          const cur = store.get().vibe.fontSizePx;
          const next = cur <= 0 ? 17 : Math.min(26, cur + 1);
          commitVibe({ fontSizePx: next });
        },
        onInput: n => scheduleLiveVibe({ fontSizePx: n <= 12 ? 0 : n }),
      }),
    );

    // 1-2 边距：小 - 6 + 大（手机窄屏与电脑宽屏自动独立读写，互不串扰）
    const isMobileWidth = Number(globalThis.innerWidth || 1024) <= 768;
    const padKey = isMobileWidth ? 'paddingX' : 'desktopPaddingX';
    const padMax = isMobileWidth ? 48 : 96;
    const padStep = isMobileWidth ? 2 : 4;
    const curPadVal = vibe[padKey] || 0;

    typeGrid.append(
      makeStepPillControl({
        title: '边距',
        leftLabel: '小−',
        rightLabel: '+大',
        min: 0,
        max: padMax,
        step: padStep,
        value: curPadVal,
        formatBadge: n => (n <= 0 ? '默认' : `${n}`),
        onStepLeft: () => {
          const cur = store.get().vibe[padKey] || 0;
          commitVibe({ [padKey]: Math.max(0, cur - padStep * 2) });
        },
        onStepRight: () => {
          const cur = store.get().vibe[padKey] || 0;
          commitVibe({ [padKey]: Math.min(padMax, cur === 0 ? padStep * 4 : cur + padStep * 2) });
        },
        onInput: n => scheduleLiveVibe({ [padKey]: n }),
      }),
    );

    // 1-3 首行：[顶格] [缩进]（再次点击已激活项可退回原版默认）
    const indentCell = el('div', 'stm-type-cell');
    const indentHead = el('div', 'stm-cell-head');
    indentHead.append(el('span', 'stm-cell-label', '首行'));
    indentCell.append(indentHead);

    const indentPair = el('div', 'stm-dual-toggle');
    for (const [modeId, modeText] of [
      ['flush', '顶格'],
      ['indent', '缩进'],
    ]) {
      const btn = el(
        'button',
        `stm-toggle-pill${vibe.paragraphIndent === modeId ? ' is-active' : ''}`,
        modeText,
      );
      btn.type = 'button';
      btn.addEventListener('click', () => {
        const next = vibe.paragraphIndent === modeId ? 'default' : modeId;
        commitVibe({ paragraphIndent: next });
      });
      indentPair.append(btn);
    }
    indentCell.append(indentPair);
    typeGrid.append(indentCell);

    // 1-4 行距：紧 - 2.0 + 松
    typeGrid.append(
      makeStepPillControl({
        title: '行距',
        leftLabel: '紧−',
        rightLabel: '+松',
        min: 135,
        max: 240,
        step: 5,
        value: vibe.lineHeight > 0 ? vibe.lineHeight : 135,
        formatBadge: n => (n <= 135 ? '默认' : (n / 100).toFixed(2).replace(/0$/, '')),
        onStepLeft: () => {
          const cur = store.get().vibe.lineHeight;
          const next = cur <= 0 ? 170 : cur <= 140 ? 0 : cur - 5;
          commitVibe({ lineHeight: next });
        },
        onStepRight: () => {
          const cur = store.get().vibe.lineHeight;
          const next = cur <= 0 ? 185 : Math.min(240, cur + 5);
          commitVibe({ lineHeight: next });
        },
        onInput: n => scheduleLiveVibe({ lineHeight: n <= 135 ? 0 : n }),
      }),
    );

    secType.append(typeGrid);
    bodyEl.append(secType);

    // =========================================================================
    // 2. 背景图（角色图 · 自定义 · 原版 + 亮度 / 清晰度）
    // =========================================================================
    const secBg = el('section', 'stm-dock-section');
    const secBgHead = el('div', 'stm-sec-head');
    secBgHead.append(el('span', 'stm-sec-title', '背景图'));
    secBg.append(secBgHead);

    const bgTabs = el('div', 'stm-dock-mode-tabs is-three');
    for (const [modeId, modeLabel] of [
      ['character', '角色图'],
      ['custom', '自定义'],
      ['theme', '原版'],
    ]) {
      const btn = el(
        'button',
        `stm-dock-mode-btn${vibe.backdropMode === modeId ? ' is-active' : ''}`,
        modeLabel,
      );
      btn.type = 'button';
      btn.addEventListener('click', () => {
        showUrlInput = false;
        commitVibe({ backdropMode: modeId });
      });
      bgTabs.append(btn);
    }
    secBg.append(bgTabs);

    if (vibe.backdropMode === 'custom') {
      const customBar = el('div', 'stm-dock-subbar');
      const fileInput = el('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
      fileInput.hidden = true;
      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        fileInput.value = '';
        if (f) void handleCustomPickAndCrop(f);
      });

      const subActs = el('div', 'stm-dock-subactions');
      const pickBtn = el(
        'button',
        'stm-dock-chip-btn',
        busyUploading ? '处理中…' : '从图库选图裁切',
      );
      pickBtn.type = 'button';
      pickBtn.disabled = busyUploading;
      pickBtn.addEventListener('click', () => fileInput.click());

      const linkBtn = el(
        'button',
        `stm-dock-chip-btn${showUrlInput ? ' is-active' : ''}`,
        '粘贴图床直链',
      );
      linkBtn.type = 'button';
      linkBtn.addEventListener('click', () => {
        showUrlInput = !showUrlInput;
        renderBody();
      });

      subActs.append(fileInput, pickBtn, linkBtn);
      customBar.append(subActs);

      if (vibe.customBackdropUrl) {
        customBar.append(
          el('span', 'stm-dock-subhint', vibe.customBackdropName || '已设自定义图'),
        );
      }
      secBg.append(customBar);

      if (showUrlInput) {
        secBg.append(
          makeInlineUrlRow({
            initialValue: vibe.customBackdropUrl.startsWith('http') ? vibe.customBackdropUrl : '',
            placeholder: '粘贴 https:// 图床图片直链…',
            onApply: raw => {
              const safe = sanitizeAssetUrl(raw);
              if (!safe) {
                toastMessage('请粘贴有效的 http(s) 图片直链', 'warning');
                return;
              }
              showUrlInput = false;
              commitVibe({ customBackdropUrl: safe, customBackdropName: '图床直链' });
            },
          }),
        );
      }
    }

    if (vibe.backdropMode !== 'theme') {
      const slidersRow = el('div', 'stm-mufy-grid');
      slidersRow.append(
        makePercentSlider({
          label: '亮度',
          min: 8,
          max: 95,
          value: vibe.backdropBrightness,
          onInput: val => scheduleLiveVibe({ backdropBrightness: val }),
        }),
        makePercentSlider({
          label: '清晰度',
          min: 0,
          max: 100,
          value: vibe.backdropClarity,
          onInput: val => scheduleLiveVibe({ backdropClarity: val }),
        }),
      );
      secBg.append(slidersRow);
    }

    bodyEl.append(secBg);

    // =========================================================================
    // 3. 其它（字体 · 隐去头像 · 无框书页 · 右滑重Roll）
    // =========================================================================
    const secOther = el('section', 'stm-dock-section');
    const secOtherHead = el('div', 'stm-sec-head');
    secOtherHead.append(el('span', 'stm-sec-title', '其它'));
    secOther.append(secOtherHead);

    const capsGrid = el('div', 'stm-wr-capsules');

    const activeFont = FONT_OPTIONS.find(f => f.id === vibe.fontChoice) || FONT_OPTIONS[0];
    const fontBtn = el(
      'button',
      `stm-wr-cap${vibe.fontChoice !== 'default' || fontDrawerOpen ? ' is-active' : ''}`,
      `字体·${activeFont.shortLabel} ▾`,
    );
    fontBtn.type = 'button';
    fontBtn.addEventListener('click', () => {
      fontDrawerOpen = !fontDrawerOpen;
      renderBody();
    });

    const hideAvatarBtn = el(
      'button',
      `stm-wr-cap${vibe.hideAvatars ? ' is-active' : ''}`,
      '隐去头像',
    );
    hideAvatarBtn.type = 'button';
    hideAvatarBtn.addEventListener('click', () => {
      commitVibe({ hideAvatars: !vibe.hideAvatars });
    });

    const bookFlowBtn = el(
      'button',
      `stm-wr-cap${vibe.bookPageFlow ? ' is-active' : ''}`,
      '无框书页',
    );
    bookFlowBtn.type = 'button';
    bookFlowBtn.addEventListener('click', () => {
      commitVibe({ bookPageFlow: !vibe.bookPageFlow });
    });

    const gesturesOn = getSwipeGesturesEnabled(getContext);
    const gestureBtn = el(
      'button',
      `stm-wr-cap${gesturesOn ? ' is-active' : ''}`,
      `右滑重Roll·${gesturesOn ? '开启' : '关闭'}`,
    );
    gestureBtn.type = 'button';
    gestureBtn.title = '开关酒馆原生的左右滑动切换消息/重Roll手势（建议手机端关闭防误触）';
    gestureBtn.addEventListener('click', () => {
      const next = setSwipeGesturesEnabled(!gesturesOn, getContext);
      toastMessage(
        next ? '已开启左右滑动消息重Roll手势' : '已关闭左右滑动重Roll手势（防滑屏误触）',
        'info',
      );
      renderBody();
    });

    capsGrid.append(fontBtn, hideAvatarBtn, bookFlowBtn, gestureBtn);
    secOther.append(capsGrid);

    if (fontDrawerOpen) {
      const fontBox = el('div', 'stm-font-drawer');
      const fontPills = el('div', 'stm-font-pills');
      for (const opt of FONT_OPTIONS) {
        const p = el(
          'button',
          `stm-dock-chip-btn${vibe.fontChoice === opt.id ? ' is-active' : ''}`,
          opt.label,
        );
        p.type = 'button';
        p.addEventListener('click', () => {
          commitVibe({ fontChoice: opt.id });
        });
        fontPills.append(p);
      }
      fontBox.append(fontPills);

      if (vibe.fontChoice === 'custom') {
        fontBox.append(
          makeInlineUrlRow({
            initialValue: vibe.customFontUrl || '',
            placeholder: '粘贴 woff2/ttf 直链或 ZeoSeven 字体 result.css 链接…',
            buttonText: '应用字体',
            onApply: raw => {
              const safe = sanitizeAssetUrl(raw);
              if (!safe) {
                toastMessage('请粘贴有效的 https:// 字体文件或 CSS 链接', 'warning');
                return;
              }
              commitVibe({ fontChoice: 'custom', customFontUrl: safe });
              toastMessage('已加载自定义字体', 'success');
            },
          }),
        );
      }
      secOther.append(fontBox);
    }

    bodyEl.append(secOther);
  }

  function ensureDom() {
    const doc = globalThis.document;
    if (!doc) return null;
    if (dockEl?.isConnected && purePillBtn?.isConnected) return dockEl;

    dockEl = doc.getElementById('stm-reader-dock') || el('aside', 'stm-reader-dock');
    dockEl.id = 'stm-reader-dock';
    dockEl.setAttribute('role', 'region');
    dockEl.setAttribute('aria-label', '页面排版与背景调整');
    dockEl.hidden = !isOpen;
    dockEl.replaceChildren();

    const stopBubble = evt => evt.stopPropagation();
    dockEl.addEventListener('mousedown', stopBubble);
    dockEl.addEventListener('touchstart', stopBubble, { passive: true });

    bodyEl = el('div', 'stm-dock-body');
    dockEl.append(bodyEl);
    doc.body.append(dockEl);

    purePillBtn = doc.getElementById('stm-pure-aa-pill') || el('button', 'stm-pure-aa-pill');
    purePillBtn.id = 'stm-pure-aa-pill';
    purePillBtn.type = 'button';
    purePillBtn.title = '页面排版与背景';
    purePillBtn.setAttribute('aria-label', '页面排版与背景');
    purePillBtn.innerHTML = svgMarkup('typography');
    purePillBtn.addEventListener('click', evt => {
      evt.preventDefault();
      evt.stopPropagation();
      toggle();
    });
    doc.body.append(purePillBtn);

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
          elTarget.closest('#stm-pure-aa-pill, .stm-topbar-reader-btn, .stm-crop-dialog')
        ) {
          return;
        }
        close();
      };
      const onDocKeyDown = evt => {
        if (isOpen && evt.key === 'Escape' && !doc.querySelector('.stm-crop-dialog[open]')) {
          evt.stopPropagation();
          close();
        }
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

  function open() {
    const s = store.get();
    if (!s.shellEnabled || !s.modules.reader) return;
    closeAllNativeDrawers();
    ensureDom();
    isOpen = true;
    lastOpenedAt = Date.now();
    if (dockEl) {
      dockEl.hidden = false;
    }
    syncBoundsToSheldNow();
    renderBody();
    onOpenStateChange?.(true);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    showUrlInput = false;
    if (dockEl) dockEl.hidden = true;
    onOpenStateChange?.(false);
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function refresh() {
    const s = store.get();
    const ctx = getContext?.();
    const hasChat = hasActiveChatSelection(ctx);
    const readerEnabled = Boolean(s.shellEnabled && s.modules.reader && hasChat);

    if (!readerEnabled) {
      close();
      if (purePillBtn) purePillBtn.hidden = true;
      return;
    }

    ensureDom();
    if (purePillBtn) {
      purePillBtn.hidden = false;
    }
    if (isOpen) {
      syncBoundsToSheldNow();
      renderBody();
    }
  }

  function destroy() {
    if (previewRaf) {
      if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(previewRaf);
      } else {
        clearTimeout(previewRaf);
      }
      previewRaf = 0;
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
    purePillBtn?.remove();
    dockEl = null;
    bodyEl = null;
    purePillBtn = null;
  }

  return {
    isOpen: () => isOpen,
    open,
    close,
    toggle,
    refresh,
    destroy,
  };
}
