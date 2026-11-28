/**
 * ST伴侣 (st-mate) · 与酒馆主栏等宽的顶栏下拉「页面排版与背景」抽屉 (.stm-reader-dock)
 * 严格遵循用户四段式清爽结构（零多余标题栏、少即是多）：
 * 1. 文字排版：字号 (A- 16 +A) · 边距 (小 - 6 + 大) · 首行 (顶格 / 缩进) · 行距 (紧 - 2.0 + 松)
 * 2. 背景图：角色图 · 自定义（支持本地图库自由框选裁切 + 图床直链）· 原版 + 无框扁平亮度 / 清晰度双滑杆
 * 3. 文字样式：经典搭配按需展开（深底/浅底成套美学配方，绝不篡改背景）+ 正文 · 对话 · 内心内联低饱和调色、荧光笔/虚线装饰款式与底纹自选色
 * 4. 其它：字体切换 · 隐去头像 · 无框书页 · 右滑重Roll开关（直连酒馆底层 power_user.gestures）
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.9.11';
import { svgMarkup } from '../core/icons.js?v=0.9.11';
import { hexLuminance, sanitizeAssetUrl, sanitizeHexColor } from '../core/schema.js?v=0.9.11';
import {
  closeAllNativeDrawers,
  getSwipeGesturesEnabled,
  setSwipeGesturesEnabled,
  toastMessage,
  uploadBackgroundAsset,
} from './host-actions.js?v=0.9.11';
import { openImageCropDialog } from './image-cropper.js?v=0.9.11';

const FONT_OPTIONS = Object.freeze([
  { id: 'default', shortLabel: '默认', label: '跟随原美化' },
  { id: 'huiwen', shortLabel: '汇文', label: '汇文明朝' },
  { id: 'serif', shortLabel: '宋体', label: '书卷宋体' },
  { id: 'sans', shortLabel: '黑体', label: '清爽黑体' },
  { id: 'kai', shortLabel: '楷体', label: '温润楷体' },
  { id: 'custom', shortLabel: '自定义', label: '自定义字体链接' },
]);

export const TEXT_COLOR_SLOTS = Object.freeze([
  {
    id: 'body',
    key: 'bodyColor',
    label: '正文',
    cssVar: '--SmartThemeBodyColor',
    fallbackHex: '#ece8df',
    supportsDeco: false,
    hint: '点击展开叙述正文低饱和色板',
  },
  {
    id: 'quote',
    key: 'quoteColor',
    styleKey: 'quoteStyle',
    markKey: 'quoteMarkColor',
    label: '对话',
    cssVar: '--SmartThemeQuoteColor',
    fallbackHex: '#d4b98c',
    supportsDeco: true,
    hint: '点击展开引号对话（“…”）调色、荧光笔与下划线款式',
  },
  {
    id: 'em',
    key: 'emColor',
    styleKey: 'emStyle',
    markKey: 'emMarkColor',
    italicKey: 'emItalic',
    label: '内心',
    cssVar: '--SmartThemeEmColor',
    fallbackHex: '#a6a095',
    supportsDeco: true,
    hint: '点击展开内心独白（*…*）调色、装饰款式与正斜体切换',
  },
]);

export const TEXT_PALETTE_GROUPS = Object.freeze({
  dark: Object.freeze([
    { hex: '#ece8df', name: '柔霜白' },
    { hex: '#e2caa5', name: '暖杏金' },
    { hex: '#9db4c4', name: '雾霭蓝' },
    { hex: '#a5bda8', name: '鼠尾草' },
    { hex: '#cfa5a5', name: '干枯玫瑰' },
    { hex: '#b8aac9', name: '浅檀紫' },
    { hex: '#c8b89d', name: '燕麦米' },
    { hex: '#9da3ae', name: '月影灰' },
  ]),
  light: Object.freeze([
    { hex: '#262422', name: '浓墨黑' },
    { hex: '#3d6082', name: '晴空雾蓝' },
    { hex: '#5d6b54', name: '草木灰绿' },
    { hex: '#7a4b3a', name: '檀木褐' },
    { hex: '#845659', name: '豆沙胭脂' },
    { hex: '#635975', name: '暮山紫' },
    { hex: '#6b655e', name: '松烟灰' },
    { hex: '#4b6b66', name: '青瓷绿' },
  ]),
});

export const TEXT_DECO_OPTIONS = Object.freeze([
  { id: 'none', shortLabel: '', label: '纯色' },
  { id: 'marker', shortLabel: '荧光', label: '半截荧光笔' },
  { id: 'dashed', shortLabel: '虚线', label: '细虚线' },
  { id: 'solid', shortLabel: '实线', label: '微距实线' },
  { id: 'wavy', shortLabel: '波浪', label: '柔和波浪' },
  { id: 'mist', shortLabel: '柔雾', label: '柔雾底框' },
]);

export const TEXT_MARKER_SWATCHES = Object.freeze([
  { hex: '', name: '同字色' },
  { hex: '#ffffff', name: '凝脂白' },
  { hex: '#dcebf7', name: '冰透蓝' },
  { hex: '#f7dfe6', name: '樱雾粉' },
  { hex: '#f5ebd1', name: '奶油杏' },
  { hex: '#dfece2', name: '薄荷雾' },
  { hex: '#e6dff2', name: '烟熏紫' },
]);

export const TEXT_STYLE_RECIPES = Object.freeze([
  {
    id: 'night_gold',
    tone: 'dark',
    label: '静夜暖金',
    title: '深底经典：柔霜白正文 · 暖杏金对话 · 月影灰内心',
    bodyColor: '#ece8df',
    quoteColor: '#e2caa5',
    quoteStyle: 'none',
    quoteMarkColor: '',
    emColor: '#9da3ae',
    emStyle: 'none',
    emMarkColor: '',
    emItalic: 'default',
  },
  {
    id: 'night_glow',
    tone: 'dark',
    label: '暗夜流萤',
    title: '深底清冷：柔霜白正文 · 雾霭蓝荧光对话 · 浅檀紫虚线内心',
    bodyColor: '#ece8df',
    quoteColor: '#9db4c4',
    quoteStyle: 'marker',
    quoteMarkColor: '',
    emColor: '#b8aac9',
    emStyle: 'dashed',
    emMarkColor: '',
    emItalic: 'normal',
  },
  {
    id: 'night_rose',
    tone: 'dark',
    label: '晚樱微醺',
    title: '深底温柔：柔霜白正文 · 干枯玫瑰细虚线对话 · 月影灰正体内心',
    bodyColor: '#ece8df',
    quoteColor: '#cfa5a5',
    quoteStyle: 'dashed',
    quoteMarkColor: '',
    emColor: '#9da3ae',
    emStyle: 'none',
    emMarkColor: '',
    emItalic: 'normal',
  },
  {
    id: 'night_sage',
    tone: 'dark',
    label: '竹影清霜',
    title: '深底护眼：柔霜白正文 · 鼠尾草荧光对话 · 燕麦米正体内心',
    bodyColor: '#ece8df',
    quoteColor: '#a5bda8',
    quoteStyle: 'marker',
    quoteMarkColor: '',
    emColor: '#c8b89d',
    emStyle: 'none',
    emMarkColor: '',
    emItalic: 'normal',
  },
  {
    id: 'dream_sky',
    tone: 'light',
    label: '晴空梦幻',
    title: '浅雾底图绝配：浓墨正文 · 晴空雾蓝字配凝脂白荧光笔 · 松烟灰正体内心',
    bodyColor: '#262422',
    quoteColor: '#3d6082',
    quoteStyle: 'marker',
    quoteMarkColor: '#ffffff',
    emColor: '#6b655e',
    emStyle: 'none',
    emMarkColor: '',
    emItalic: 'normal',
  },
  {
    id: 'summer_sage',
    tone: 'light',
    label: '草木盛夏',
    title: '清新书页：浓墨正文 · 草木灰绿半截荧光对话 · 松烟灰正体内心',
    bodyColor: '#262422',
    quoteColor: '#5d6b54',
    quoteStyle: 'marker',
    quoteMarkColor: '',
    emColor: '#6b655e',
    emStyle: 'none',
    emMarkColor: '',
    emItalic: 'normal',
  },
  {
    id: 'rain_book',
    tone: 'light',
    label: '雨夜书卷',
    title: '文艺纸书：浓墨正文 · 晴空雾蓝细虚线对话 · 松烟灰正体内心',
    bodyColor: '#262422',
    quoteColor: '#3d6082',
    quoteStyle: 'dashed',
    quoteMarkColor: '',
    emColor: '#6b655e',
    emStyle: 'none',
    emMarkColor: '',
    emItalic: 'normal',
  },
  {
    id: 'sakura_note',
    tone: 'light',
    label: '樱雾手账',
    title: '温柔手账：浓墨正文 · 豆沙胭脂字配樱雾粉荧光笔 · 暮山紫细虚线内心',
    bodyColor: '#262422',
    quoteColor: '#845659',
    quoteStyle: 'marker',
    quoteMarkColor: '#f7dfe6',
    emColor: '#635975',
    emStyle: 'dashed',
    emMarkColor: '',
    emItalic: 'normal',
  },
]);

export const TEXT_COLOR_PRESETS = TEXT_STYLE_RECIPES;

function cssColorToHex(raw, fallbackHex = '#ece8df') {
  const direct = sanitizeHexColor(raw);
  if (direct) return direct;
  if (typeof raw === 'string') {
    const m = raw.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    if (m) {
      const toHex = n =>
        Math.min(255, Math.max(0, Math.round(Number(n) || 0)))
          .toString(16)
          .padStart(2, '0');
      return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
    }
  }
  return fallbackHex;
}

function resolveThemeColorHex(doc, cssVar, fallbackHex) {
  try {
    const rootVal = globalThis.getComputedStyle?.(doc.documentElement)?.getPropertyValue?.(cssVar)?.trim();
    if (rootVal) return cssColorToHex(rootVal, fallbackHex);
    const bodyVal = globalThis.getComputedStyle?.(doc.body)?.getPropertyValue?.(cssVar)?.trim();
    if (bodyVal) return cssColorToHex(bodyVal, fallbackHex);
  } catch {
    // ignore
  }
  return fallbackHex;
}

function detectDocLightInk(doc) {
  try {
    const sample = doc?.getElementById?.('chat') || doc?.body;
    const color = globalThis.getComputedStyle?.(sample)?.color || '';
    const m = color.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    if (!m) return false;
    const lum = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
    return lum < 0.42;
  } catch {
    return false;
  }
}

export function inferSmartPaletteTone(doc, vibe) {
  const isLightTheme = detectDocLightInk(doc);
  if (vibe.backdropMode !== 'theme') {
    if (Number(vibe.backdropBrightness) >= 68) return 'light';
    if (!isLightTheme && Number(vibe.backdropBrightness) <= 58) return 'dark';
  }
  const bodyLum = hexLuminance(vibe.bodyColor);
  if (bodyLum >= 0) {
    return bodyLum < 0.45 ? 'light' : 'dark';
  }
  return isLightTheme ? 'light' : 'dark';
}

function matchActiveStyleRecipe(vibe) {
  return (
    TEXT_STYLE_RECIPES.find(
      r =>
        vibe.bodyColor === r.bodyColor &&
        vibe.quoteColor === r.quoteColor &&
        (vibe.quoteStyle || 'none') === r.quoteStyle &&
        (vibe.quoteMarkColor || '') === r.quoteMarkColor &&
        vibe.emColor === r.emColor &&
        (vibe.emStyle || 'none') === r.emStyle &&
        (vibe.emMarkColor || '') === r.emMarkColor &&
        (vibe.emItalic || 'default') === r.emItalic,
    ) || null
  );
}

function isDefaultTextStyle(vibe) {
  return (
    !vibe.bodyColor &&
    !vibe.quoteColor &&
    (!vibe.quoteStyle || vibe.quoteStyle === 'none') &&
    !vibe.quoteMarkColor &&
    !vibe.emColor &&
    (!vibe.emStyle || vibe.emStyle === 'none') &&
    !vibe.emMarkColor &&
    (!vibe.emItalic || vibe.emItalic === 'default')
  );
}

export function createReaderDock({ getContext, store, onPreviewAtmosphere, onOpenStateChange }) {
  let dockEl = null;
  let bodyEl = null;
  let purePillBtn = null;
  let isOpen = false;
  let lastOpenedAt = 0;
  let fontDrawerOpen = false;
  let styleTrayMode = 'none'; // 'none' | 'recipes' | 'body' | 'quote' | 'em'
  let manualPaletteTone = ''; // '' 跟随上方背景与主题智能联动 | 'dark' | 'light'
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

  function makePercentSlider({ label, min, max, value, onInput, onChange }) {
    const row = el('div', 'stm-flat-slider');
    const lblSpan = el('span', 'stm-mufy-label stm-flat-label', label);
    const valSpan = el('span', 'stm-mufy-val stm-flat-val', `${value}%`);

    const input = el('input', 'stm-mufy-range stm-flat-range');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    input.setAttribute('aria-label', label);

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

    if (typeof onChange === 'function') {
      input.addEventListener('change', () => {
        onChange(Number(input.value));
      });
    }

    row.append(lblSpan, input, valSpan);
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
      styleTrayMode = 'none';
      manualPaletteTone = '';
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
        bodyColor: '',
        quoteColor: '',
        quoteStyle: 'none',
        quoteMarkColor: '',
        emColor: '',
        emStyle: 'none',
        emMarkColor: '',
        emItalic: 'default',
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
          onInput: val => {
            manualPaletteTone = '';
            scheduleLiveVibe({ backdropBrightness: val });
          },
          onChange: val => {
            manualPaletteTone = '';
            commitVibe({ backdropBrightness: val }, { reRender: styleTrayMode !== 'none' });
          },
        }),
        makePercentSlider({
          label: '清晰度',
          min: 0,
          max: 100,
          value: vibe.backdropClarity,
          onInput: val => scheduleLiveVibe({ backdropClarity: val }),
          onChange: val => commitVibe({ backdropClarity: val }, { reRender: false }),
        }),
      );
      secBg.append(slidersRow);
    }

    bodyEl.append(secBg);

    // =========================================================================
    // 3. 文字样式（经典搭配按需展开 + 正文 · 对话 · 内心内联低饱和调色与荧光笔/虚线装饰）
    // =========================================================================
    const secColor = el('section', 'stm-dock-section');
    const secColorHead = el('div', 'stm-sec-head');
    secColorHead.append(el('span', 'stm-sec-title', '文字样式'));

    const colorPresetsBar = el('div', 'stm-color-presets');
    const matchedRecipe = matchActiveStyleRecipe(vibe);
    const recipesOpen = styleTrayMode === 'recipes';
    const recipesBtn = el(
      'button',
      `stm-color-preset-btn stm-recipes-toggle${matchedRecipe ? ' is-active' : ''}${recipesOpen ? ' is-open' : ''}`,
      matchedRecipe
        ? `搭配·${matchedRecipe.label} ${recipesOpen ? '▴' : '▾'}`
        : `经典搭配 ${recipesOpen ? '▴' : '▾'}`,
    );
    recipesBtn.type = 'button';
    recipesBtn.title = '展开深色底/浅色底精选成套文字搭配（只改文字样式，绝不改动背景图与亮度）';
    recipesBtn.addEventListener('click', () => {
      styleTrayMode = recipesOpen ? 'none' : 'recipes';
      renderBody();
    });
    colorPresetsBar.append(recipesBtn);

    const isDefaultStyles = isDefaultTextStyle(vibe);
    const defaultColorBtn = el(
      'button',
      `stm-color-preset-btn${isDefaultStyles ? ' is-active' : ''}`,
      '默认',
    );
    defaultColorBtn.type = 'button';
    defaultColorBtn.title = '恢复原美化主题的默认文字颜色与装饰样式';
    defaultColorBtn.addEventListener('click', () => {
      if (isDefaultStyles && styleTrayMode === 'none') return;
      styleTrayMode = 'none';
      manualPaletteTone = '';
      commitVibe({
        bodyColor: '',
        quoteColor: '',
        quoteStyle: 'none',
        quoteMarkColor: '',
        emColor: '',
        emStyle: 'none',
        emMarkColor: '',
        emItalic: 'default',
      });
    });
    colorPresetsBar.append(defaultColorBtn);

    secColorHead.append(colorPresetsBar);
    secColor.append(secColorHead);

    const colorGrid = el('div', 'stm-color-grid');
    for (const slot of TEXT_COLOR_SLOTS) {
      const customHex = sanitizeHexColor(vibe[slot.key]);
      const effectiveHex = customHex || resolveThemeColorHex(doc, slot.cssVar, slot.fallbackHex);
      const curStyle = slot.styleKey ? vibe[slot.styleKey] || 'none' : 'none';
      const curMark = slot.markKey ? sanitizeHexColor(vibe[slot.markKey]) : '';
      const curItalic = slot.italicKey ? vibe[slot.italicKey] || 'default' : 'default';
      const hasCustom = Boolean(
        customHex || curStyle !== 'none' || curMark || curItalic !== 'default',
      );
      const slotOpen = styleTrayMode === slot.id;

      let stateText = '默认';
      if (hasCustom) {
        const decoOpt = TEXT_DECO_OPTIONS.find(d => d.id === curStyle);
        if (decoOpt?.shortLabel) {
          stateText = decoOpt.shortLabel;
        } else if (slot.italicKey && curItalic !== 'default') {
          stateText = curItalic === 'normal' ? '正体' : '斜体';
        } else {
          stateText = '';
        }
      }

      const pill = el(
        'div',
        `stm-color-pill${hasCustom ? ' is-active' : ''}${slotOpen ? ' is-open' : ''}`,
      );
      const trigger = el('button', 'stm-color-trigger');
      trigger.type = 'button';
      trigger.title = slot.hint;
      trigger.setAttribute('aria-expanded', slotOpen ? 'true' : 'false');

      const swatch = el('span', 'stm-color-swatch');
      swatch.style.setProperty('--stm-swatch', effectiveHex);

      const nameSpan = el('span', 'stm-color-label', slot.label);
      const stateSpan = el('span', 'stm-color-state', stateText);

      trigger.addEventListener('click', () => {
        styleTrayMode = slotOpen ? 'none' : slot.id;
        renderBody();
      });

      trigger.append(swatch, nameSpan, stateSpan);
      pill.append(trigger);

      if (hasCustom) {
        const clearBtn = el('button', 'stm-color-reset');
        clearBtn.type = 'button';
        clearBtn.title = `恢复${slot.label}默认样式`;
        clearBtn.setAttribute('aria-label', `恢复${slot.label}默认样式`);
        clearBtn.innerHTML = svgMarkup('close');
        clearBtn.addEventListener('click', evt => {
          evt.preventDefault();
          evt.stopPropagation();
          const patch = { [slot.key]: '' };
          if (slot.styleKey) patch[slot.styleKey] = 'none';
          if (slot.markKey) patch[slot.markKey] = '';
          if (slot.italicKey) patch[slot.italicKey] = 'default';
          commitVibe(patch);
        });
        pill.append(clearBtn);
      }

      colorGrid.append(pill);
    }
    secColor.append(colorGrid);

    // 互斥展开内联托盘：经典搭配面板 或 单项调色/装饰/底纹面板
    if (styleTrayMode === 'recipes') {
      const tray = el('div', 'stm-style-tray is-recipes');
      const smartTone = inferSmartPaletteTone(doc, vibe);
      const groups = [
        { tone: 'dark', title: '深底推荐' },
        { tone: 'light', title: '浅底推荐' },
      ];
      for (const grp of groups) {
        const grpRow = el(
          'div',
          `stm-recipe-group${smartTone === grp.tone ? ' is-recommended' : ''}`,
        );
        const grpLabel = el('span', 'stm-tray-sublabel', grp.title);
        if (smartTone === grp.tone) {
          grpLabel.title = '根据当前底图亮度或主题明暗自动匹配的适读方向';
        }
        grpRow.append(grpLabel);

        const chipsWrap = el('div', 'stm-recipe-chips');
        for (const recipe of TEXT_STYLE_RECIPES.filter(r => r.tone === grp.tone)) {
          const isMatched = matchedRecipe?.id === recipe.id;
          const chip = el(
            'button',
            `stm-recipe-chip${isMatched ? ' is-active' : ''}`,
          );
          chip.type = 'button';
          chip.dataset.recipe = recipe.id;
          chip.title = recipe.title;

          const dot = el('span', 'stm-recipe-dot');
          dot.style.setProperty('--stm-dot-color', recipe.quoteColor);
          if (recipe.quoteMarkColor) {
            dot.style.setProperty('--stm-dot-ring', recipe.quoteMarkColor);
            dot.classList.add('has-mark');
          }
          chip.append(dot, el('span', 'stm-recipe-name', recipe.label));

          chip.addEventListener('click', () => {
            manualPaletteTone = '';
            commitVibe({
              bodyColor: recipe.bodyColor,
              quoteColor: recipe.quoteColor,
              quoteStyle: recipe.quoteStyle,
              quoteMarkColor: recipe.quoteMarkColor,
              emColor: recipe.emColor,
              emStyle: recipe.emStyle,
              emMarkColor: recipe.emMarkColor,
              emItalic: recipe.emItalic,
            });
          });
          chipsWrap.append(chip);
        }
        grpRow.append(chipsWrap);
        tray.append(grpRow);
      }
      secColor.append(tray);
    } else if (styleTrayMode !== 'none') {
      const activeSlot = TEXT_COLOR_SLOTS.find(s => s.id === styleTrayMode);
      if (activeSlot) {
        const tray = el('div', 'stm-style-tray');
        const smartTone = inferSmartPaletteTone(doc, vibe);
        const effectiveTone = manualPaletteTone || smartTone;
        const curCustomHex = sanitizeHexColor(vibe[activeSlot.key]);
        const curEffectiveHex =
          curCustomHex || resolveThemeColorHex(doc, activeSlot.cssVar, activeSlot.fallbackHex);

        // 第一行：深/浅底低饱和精选色点 + 末尾自定义取色兜底
        const colorRow = el('div', 'stm-tray-row');
        const toneBtn = el(
          'button',
          'stm-palette-tone-btn',
          effectiveTone === 'light' ? '浅底色 ⇄' : '深底色 ⇄',
        );
        toneBtn.type = 'button';
        toneBtn.title = '切换深色背景适读 / 浅色背景适读低饱和色盘';
        toneBtn.addEventListener('click', () => {
          manualPaletteTone = effectiveTone === 'light' ? 'dark' : 'light';
          renderBody();
        });
        colorRow.append(toneBtn);

        const swatchList = el('div', 'stm-swatch-list');
        const paletteItems = TEXT_PALETTE_GROUPS[effectiveTone] || TEXT_PALETTE_GROUPS.dark;
        for (const item of paletteItems) {
          const selected = curCustomHex.toLowerCase() === item.hex.toLowerCase();
          const dotBtn = el('button', `stm-swatch-dot${selected ? ' is-selected' : ''}`);
          dotBtn.type = 'button';
          dotBtn.title = item.name;
          dotBtn.setAttribute('aria-label', `${activeSlot.label}·${item.name}`);
          dotBtn.style.setProperty('--stm-swatch', item.hex);
          dotBtn.addEventListener('click', () => {
            commitVibe({ [activeSlot.key]: item.hex });
          });
          swatchList.append(dotBtn);
        }

        const isCustomNonPreset = Boolean(
          curCustomHex &&
            ![...TEXT_PALETTE_GROUPS.dark, ...TEXT_PALETTE_GROUPS.light].some(
              p => p.hex.toLowerCase() === curCustomHex.toLowerCase(),
            ),
        );
        const customWrap = el(
          'label',
          `stm-swatch-custom${isCustomNonPreset ? ' is-selected' : ''}`,
        );
        customWrap.title = `自由取色（${activeSlot.label}）`;
        if (isCustomNonPreset) {
          customWrap.style.setProperty('--stm-swatch', curCustomHex);
        }
        const plusSpan = el('span', 'stm-swatch-plus', '+');
        const customInput = el('input', 'stm-tray-color-input');
        customInput.type = 'color';
        customInput.value = curEffectiveHex;
        customInput.setAttribute('aria-label', `自由选择${activeSlot.label}颜色`);
        customInput.addEventListener('input', () => {
          const picked = sanitizeHexColor(customInput.value);
          if (!picked) return;
          customWrap.classList.add('is-selected');
          customWrap.style.setProperty('--stm-swatch', picked);
          scheduleLiveVibe({ [activeSlot.key]: picked });
        });
        customInput.addEventListener('change', () => {
          const picked = sanitizeHexColor(customInput.value);
          if (!picked) return;
          commitVibe({ [activeSlot.key]: picked });
        });
        customWrap.append(plusSpan, customInput);
        swatchList.append(customWrap);
        colorRow.append(swatchList);
        tray.append(colorRow);

        // 第二行（对话 & 内心）：经典装饰款式 + 内心正/斜体切换
        if (activeSlot.supportsDeco && activeSlot.styleKey) {
          const curStyle = vibe[activeSlot.styleKey] || 'none';
          const decoRow = el('div', 'stm-tray-row is-bordered');
          const decoList = el('div', 'stm-deco-list');
          for (const opt of TEXT_DECO_OPTIONS) {
            const dBtn = el(
              'button',
              `stm-deco-chip${curStyle === opt.id ? ' is-active' : ''}`,
              opt.label,
            );
            dBtn.type = 'button';
            dBtn.addEventListener('click', () => {
              commitVibe({ [activeSlot.styleKey]: opt.id });
            });
            decoList.append(dBtn);
          }
          decoRow.append(decoList);

          if (activeSlot.italicKey) {
            const curItalic = vibe[activeSlot.italicKey] || 'default';
            const italicPair = el('div', 'stm-italic-pair');
            for (const [modeId, modeLabel] of [
              ['normal', '正体'],
              ['italic', '斜体'],
            ]) {
              const iBtn = el(
                'button',
                `stm-deco-chip is-compact${curItalic === modeId ? ' is-active' : ''}`,
                modeLabel,
              );
              iBtn.type = 'button';
              iBtn.title =
                modeId === 'normal'
                  ? '将内心独白强制设为端正正体（解决中文斜体发虚歪斜；再次点击恢复默认）'
                  : '将内心独白强制设为斜体（再次点击恢复默认）';
              iBtn.addEventListener('click', () => {
                const next = curItalic === modeId ? 'default' : modeId;
                commitVibe({ [activeSlot.italicKey]: next });
              });
              italicPair.append(iBtn);
            }
            decoRow.append(italicPair);
          }
          tray.append(decoRow);

          // 第三行（仅选中「半截荧光笔」或「柔雾底框」时浮现）：底纹自选色（如蓝字配凝脂白梦幻底纹）
          if (activeSlot.markKey && (curStyle === 'marker' || curStyle === 'mist')) {
            const curMark = sanitizeHexColor(vibe[activeSlot.markKey]);
            const markRow = el('div', 'stm-tray-row is-bordered');
            markRow.append(el('span', 'stm-tray-sublabel', '底纹'));

            const markList = el('div', 'stm-swatch-list');
            for (const mItem of TEXT_MARKER_SWATCHES) {
              if (!mItem.hex) {
                const autoChip = el(
                  'button',
                  `stm-deco-chip is-compact${!curMark ? ' is-active' : ''}`,
                  mItem.name,
                );
                autoChip.type = 'button';
                autoChip.title = '自动跟随当前文字颜色做半透明柔化底纹';
                autoChip.addEventListener('click', () => {
                  commitVibe({ [activeSlot.markKey]: '' });
                });
                markList.append(autoChip);
              } else {
                const selected = curMark.toLowerCase() === mItem.hex.toLowerCase();
                const mDot = el(
                  'button',
                  `stm-swatch-dot is-marker-dot${selected ? ' is-selected' : ''}`,
                );
                mDot.type = 'button';
                mDot.title = `底纹·${mItem.name}`;
                mDot.setAttribute('aria-label', `${activeSlot.label}底纹·${mItem.name}`);
                mDot.style.setProperty('--stm-swatch', mItem.hex);
                mDot.addEventListener('click', () => {
                  commitVibe({ [activeSlot.markKey]: mItem.hex });
                });
                markList.append(mDot);
              }
            }

            const isCustomMark = Boolean(
              curMark &&
                !TEXT_MARKER_SWATCHES.some(
                  m => m.hex && m.hex.toLowerCase() === curMark.toLowerCase(),
                ),
            );
            const customMarkWrap = el(
              'label',
              `stm-swatch-custom${isCustomMark ? ' is-selected' : ''}`,
            );
            customMarkWrap.title = `自选任意${activeSlot.label}底纹颜色`;
            if (isCustomMark) {
              customMarkWrap.style.setProperty('--stm-swatch', curMark);
            }
            const mPlus = el('span', 'stm-swatch-plus', '+');
            const mInput = el('input', 'stm-tray-color-input');
            mInput.type = 'color';
            mInput.value = curMark || '#ffffff';
            mInput.setAttribute('aria-label', `自由选择${activeSlot.label}底纹颜色`);
            mInput.addEventListener('input', () => {
              const picked = sanitizeHexColor(mInput.value);
              if (!picked) return;
              customMarkWrap.classList.add('is-selected');
              customMarkWrap.style.setProperty('--stm-swatch', picked);
              scheduleLiveVibe({ [activeSlot.markKey]: picked });
            });
            mInput.addEventListener('change', () => {
              const picked = sanitizeHexColor(mInput.value);
              if (!picked) return;
              commitVibe({ [activeSlot.markKey]: picked });
            });
            customMarkWrap.append(mPlus, mInput);
            markList.append(customMarkWrap);

            markRow.append(markList);
            tray.append(markRow);
          }
        }

        secColor.append(tray);
      }
    }

    bodyEl.append(secColor);

    // =========================================================================
    // 4. 其它（字体 · 隐去头像 · 无框书页 · 右滑重Roll）
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
          elTarget.closest(
            '#stm-pure-aa-pill, .stm-topbar-reader-btn, #advanced-formatting-button > .drawer-toggle, .stm-crop-dialog',
          )
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
    styleTrayMode = 'none';
    manualPaletteTone = '';
    fontDrawerOpen = false;
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
      const doc = globalThis.document;
      const activeEl = doc?.activeElement;
      const isTypingInside =
        activeEl &&
        dockEl?.contains(activeEl) &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT');
      if (!isTypingInside && !busyUploading) {
        renderBody();
      }
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
