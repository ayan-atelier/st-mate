/**
 * ST伴侣 (st-mate) · 页面排版与背景渲染器 + 底栏低频项收纳
 * 核心机制：
 * 1. 底图直接挂载于 #sheld 阅读主栏内部最底层（z-index:0），几何尺寸恒定锁死（零二次缩放、零解码闪烁）；
 * 2. 手机端与电脑端左右边距独立记忆，自动校准《观月札记》电脑端 42px 左偏移与中文段落两端对齐（版心正中不偏）；
 * 3. 动态高优先级覆盖表 (#stm-page-overrides) 驻留于 document.head 末尾，未调项零覆盖，已调项破除主题锁定即刻生效。
 */

import { clarityToBlurPx, createBackdropCache } from '../core/backdrop-cache.js?v=0.7.9';
import { getCurrentEntityMeta, resolveAssetHref } from './host-actions.js?v=0.7.9';

const LOW_FREQ_OPTION_IDS = Object.freeze([
  'option_toggle_AN',
  'option_toggle_CFG',
  'option_toggle_logprobs',
  'option_convert_to_group',
  'option_impersonate',
]);

export const FONT_STACKS = Object.freeze({
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif',
  sans: 'system-ui, -apple-system, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif',
  kai: '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif',
  custom: '"StmReaderCustomFont", "Noto Serif SC", serif',
});

const CHAT_OVERRIDE_SCOPE = 'html body:not(.stm-home-cloak) #chat#chat:not(.jd-bookshelf-home)';

export function buildPageOverrideCss(
  vibe,
  { readerActive = false, backdropLive = false, isNotionTheme = false } = {},
) {
  if (!readerActive) return '';
  const rules = [];

  if (backdropLive) {
    rules.push(`
html body.stm-shell-active.stm-backdrop-live:not(.stm-home-cloak) #sheld#sheld {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}
html body.stm-shell-active.stm-backdrop-live:not(.stm-home-cloak) #chat#chat:not(.jd-bookshelf-home),
html body.stm-shell-active.stm-backdrop-live:not(.stm-home-cloak) #form_sheld#form_sheld {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}`);
  }

  // 校准《观月札记》电脑端 .mes_block 左侧硬编码 42px 偏移导致的整栏版心偏右问题（仅让标题行避让左上角圆头像）
  if (isNotionTheme && !vibe.hideAvatars) {
    rules.push(`
@media screen and (min-width: 601px) {
  ${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) > .mes_block {
    margin-left: 0 !important;
    width: 100% !important;
  }
  html body:not(.stm-home-cloak):not(.hideChatAvatars):not(.documentstyle) #chat#chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) .ch_name > .flex-container {
    margin-left: 38px !important;
    max-width: calc(100% - 38px) !important;
  }
  ${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) > .mesAvatarWrapper {
    margin-left: 0 !important;
  }
}`);
  }

  if (vibe.fontSizePx > 0) {
    rules.push(`
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) {
  --nt-body: ${vibe.fontSizePx}px !important;
}
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text,
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text :is(p, li, q, blockquote) {
  font-size: ${vibe.fontSizePx}px !important;
}`);
  } else if (vibe.fontScale !== 100) {
    const scale = (vibe.fontScale / 100).toFixed(2);
    rules.push(`
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text {
  font-size: calc(var(--mainFontSize, 1rem) * ${scale}) !important;
}`);
  }

  // 手机窄屏与电脑宽屏各自独立套用边距，严格排除首页净空态与角色书架容器
  if (vibe.paddingX > 0) {
    rules.push(`
@media screen and (max-width: 768px) {
  ${CHAT_OVERRIDE_SCOPE} {
    --nt-inset: 0px !important;
    --nt-mobile-inset: 0px !important;
    padding-left: ${vibe.paddingX}px !important;
    padding-right: ${vibe.paddingX}px !important;
    box-sizing: border-box !important;
  }
}`);
  }

  if ((vibe.desktopPaddingX || 0) > 0) {
    rules.push(`
@media screen and (min-width: 769px) {
  ${CHAT_OVERRIDE_SCOPE} {
    --nt-inset: 0px !important;
    padding-left: ${vibe.desktopPaddingX}px !important;
    padding-right: ${vibe.desktopPaddingX}px !important;
    box-sizing: border-box !important;
  }
}`);
  }

  if (vibe.lineHeight > 0) {
    const lh = (vibe.lineHeight / 100).toFixed(2);
    rules.push(`
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) {
  --nt-body-line-height: ${lh} !important;
  --jd-leading: ${lh} !important;
}
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text,
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text p {
  line-height: ${lh} !important;
}`);
  }

  if (vibe.paragraphIndent === 'indent') {
    rules.push(`
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text p:not(:is(blockquote p, details p, li p, td p, th p)) {
  text-indent: 2em !important;
}`);
  } else if (vibe.paragraphIndent === 'flush') {
    rules.push(`
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text p {
  text-indent: 0 !important;
}`);
  }

  // 开启任意文字排版项时同步启用微信读书级中文两端对齐，消除右侧换行余白导致的视觉偏左
  const hasTypographyAdjustment =
    vibe.fontSizePx > 0 ||
    vibe.paddingX > 0 ||
    (vibe.desktopPaddingX || 0) > 0 ||
    vibe.lineHeight > 0 ||
    vibe.paragraphIndent !== 'default';
  if (hasTypographyAdjustment) {
    rules.push(`
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text p:not([align]):not([style*="text-align"]):not(:is(blockquote p, details p, td p, th p)) {
  text-align: justify !important;
  text-justify: inter-ideograph;
}`);
  }

  if (backdropLive || hasTypographyAdjustment) {
    rules.push(`
@media screen and (max-width: 1000px), (pointer: coarse) {
  html, html body:not(.stm-home-cloak), html body:not(.stm-home-cloak) #sheld#sheld {
    overflow: hidden !important;
    scrollbar-width: none !important;
  }
  ${CHAT_OVERRIDE_SCOPE} {
    scrollbar-width: none !important;
    scrollbar-gutter: auto !important;
  }
  html::-webkit-scrollbar,
  html body:not(.stm-home-cloak)::-webkit-scrollbar,
  html body:not(.stm-home-cloak) #sheld#sheld::-webkit-scrollbar,
  ${CHAT_OVERRIDE_SCOPE}::-webkit-scrollbar,
  ${CHAT_OVERRIDE_SCOPE}:hover::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
}`);
  }

  const useFont =
    vibe.fontChoice !== 'default' &&
    FONT_STACKS[vibe.fontChoice] &&
    (vibe.fontChoice !== 'custom' || vibe.customFontUrl);
  if (useFont) {
    const stack = FONT_STACKS[vibe.fontChoice];
    rules.push(`
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) {
  --mainFontFamily: ${stack} !important;
  --nt-serif: ${stack} !important;
  --jd-font: ${stack} !important;
}
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text,
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text :not(:is(pre, code, kbd, samp, .fa, .fas, .far, .fab, .fa-solid, .fa-regular, .fa-brands, i[class*="fa-"])) {
  font-family: ${stack} !important;
}`);
  }

  if (vibe.hideAvatars) {
    rules.push(`
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) > .mesAvatarWrapper {
  display: none !important;
}
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) > .mes_block {
  margin-left: 0 !important;
  padding-left: 0 !important;
  padding-top: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
}
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .ch_name > .flex-container {
  margin-left: 0 !important;
  max-width: 100% !important;
}
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes)::before,
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes)::after {
  display: none !important;
  content: none !important;
}`);
  }

  if (vibe.bookPageFlow) {
    rules.push(`
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes),
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) > .mes_block,
${CHAT_OVERRIDE_SCOPE} > .mes:not(.smallSysMes) .mes_text {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border: 0 !important;
  border-color: transparent !important;
  box-shadow: none !important;
}`);
  }

  return rules.join('\n');
}

export function createAtmosphere({ getContext, store, isHomeCloaked }) {
  const backdropCache = createBackdropCache({ root: globalThis });

  let backdropEl = null;
  let artEl = null;
  let shadeEl = null;
  let pageOverrideStyleEl = null;

  let activeRawUrl = '';
  let activeDisplayUrl = '';
  let imageReqId = 0;

  let fontStyleEl = null;
  let loadedCustomFontUrl = '';
  let customFontAbort = null;

  let menuExpanded = false;
  let menuExtraWrap = null;
  let menuToggleBtn = null;
  let menuExtraPanel = null;
  const movedMenuNodes = new Map();

  function cssSafeUrl(url) {
    return `url("${String(url || '').replace(/["\\]/g, '\\$&')}")`;
  }

  function detectLightInkTheme(doc) {
    try {
      const sample = doc.getElementById('chat') || doc.body;
      const color = globalThis.getComputedStyle?.(sample)?.color || '';
      const m = color.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
      if (!m) return false;
      const lum = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
      return lum < 0.42;
    } catch {
      return false;
    }
  }

  function detectNotionTheme(doc) {
    try {
      return Boolean(
        globalThis.getComputedStyle?.(doc.documentElement)?.getPropertyValue?.('--nt-serif')?.trim(),
      );
    } catch {
      return false;
    }
  }

  function ensureBackdropEl() {
    const doc = globalThis.document;
    if (!doc) return null;

    const sheld = doc.getElementById('sheld');
    const hostParent = sheld || doc.body;

    if (!backdropEl || !artEl || !shadeEl) {
      backdropEl = doc.getElementById('stm-vibe-backdrop') || doc.createElement('div');
      backdropEl.id = 'stm-vibe-backdrop';
      backdropEl.className = 'stm-vibe-backdrop';
      backdropEl.setAttribute('aria-hidden', 'true');
      backdropEl.replaceChildren();

      artEl = doc.createElement('div');
      artEl.className = 'stm-vibe-art';
      shadeEl = doc.createElement('div');
      shadeEl.className = 'stm-vibe-shade';
      backdropEl.append(artEl, shadeEl);
    }

    if (backdropEl.parentElement !== hostParent || hostParent.firstElementChild !== backdropEl) {
      hostParent.prepend(backdropEl);
    }
    backdropEl.dataset.host = sheld ? 'sheld' : 'body';
    return backdropEl;
  }

  function syncOverrideStyleSheet(doc, cssText) {
    if (!cssText) {
      pageOverrideStyleEl?.remove();
      pageOverrideStyleEl = null;
      return;
    }
    if (!pageOverrideStyleEl || !pageOverrideStyleEl.isConnected) {
      pageOverrideStyleEl = doc.getElementById('stm-page-overrides') || doc.createElement('style');
      pageOverrideStyleEl.id = 'stm-page-overrides';
    }
    if (doc.head.lastElementChild !== pageOverrideStyleEl) {
      doc.head.append(pageOverrideStyleEl);
    }
    if (pageOverrideStyleEl.textContent !== cssText) {
      pageOverrideStyleEl.textContent = cssText;
    }
  }

  function hideBackdrop(doc) {
    imageReqId += 1;
    activeRawUrl = '';
    activeDisplayUrl = '';
    if (backdropEl) {
      backdropEl.hidden = true;
    }
    doc?.body?.classList.remove('stm-backdrop-live');
  }

  function applyImageBackdrop(doc, el, { rawUrl, brightness, clarity, turboEnabled }) {
    const blurPx = clarityToBlurPx(clarity);
    const dimAlpha = ((100 - brightness) / 100).toFixed(2);
    const isLightTheme = detectLightInkTheme(doc);

    el.dataset.tone = isLightTheme ? 'light' : 'dark';
    el.dataset.sharp = blurPx <= 0.05 ? '1' : '0';
    el.style.setProperty('--stm-backdrop-dim', dimAlpha);
    el.style.setProperty('--stm-backdrop-blur', `${blurPx}px`);

    // 同一角色内调节亮度/清晰度时绝不重设 background-image，零闪烁
    if (rawUrl === activeRawUrl && activeDisplayUrl) {
      el.hidden = false;
      return;
    }

    activeRawUrl = rawUrl;
    const reqId = ++imageReqId;

    // 若内存 LRU 已命中压缩版，第 0 帧直接同步挂入，彻底消灭二次切图闪烁
    const memEntry = turboEnabled ? backdropCache.peekCompressedBase(rawUrl) : null;
    const initialUrl = memEntry?.objectUrl || rawUrl;
    activeDisplayUrl = initialUrl;
    el.style.setProperty('--stm-backdrop-image', cssSafeUrl(initialUrl));
    el.hidden = false;

    if (!turboEnabled || memEntry?.objectUrl) return;

    void backdropCache.resolveCompressedBase(rawUrl).then(entry => {
      if (reqId !== imageReqId || activeRawUrl !== rawUrl || !backdropEl || backdropEl.hidden) return;
      if (entry?.objectUrl && entry.objectUrl !== activeDisplayUrl) {
        activeDisplayUrl = entry.objectUrl;
        backdropEl.style.setProperty('--stm-backdrop-image', cssSafeUrl(entry.objectUrl));
      }
    });
  }

  async function syncCustomFontFace(doc, readerActive, vibe) {
    const wantCustom = Boolean(readerActive && vibe.fontChoice === 'custom' && vibe.customFontUrl);
    if (!wantCustom) {
      customFontAbort?.abort?.();
      customFontAbort = null;
      loadedCustomFontUrl = '';
      fontStyleEl?.remove();
      fontStyleEl = null;
      return;
    }

    const url = resolveAssetHref(vibe.customFontUrl);
    if (!url || url === loadedCustomFontUrl) return;
    loadedCustomFontUrl = url;

    customFontAbort?.abort?.();
    customFontAbort = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;

    if (!fontStyleEl || !fontStyleEl.isConnected) {
      fontStyleEl = doc.getElementById('stm-reader-fontface') || doc.createElement('style');
      fontStyleEl.id = 'stm-reader-fontface';
      doc.head.append(fontStyleEl);
    }

    const isCssSheet = /\.css(?:$|[?#])/i.test(url) || /\/css2?(?:$|[?#])/i.test(url);
    if (!isCssSheet) {
      const safe = url.replace(/["\\]/g, '\\$&');
      fontStyleEl.textContent = `@font-face{font-family:"StmReaderCustomFont";src:url("${safe}");font-weight:100 900;font-display:swap;}`;
      return;
    }

    try {
      const res = await globalThis.fetch(url, {
        signal: customFontAbort?.signal,
        credentials: 'omit',
      });
      if (!res.ok) return;
      const cssText = await res.text();
      if (loadedCustomFontUrl !== url || !fontStyleEl) return;

      const familyMatch = cssText.match(/font-family\s*:\s*(['"]?)([^;'"\}]+)\1/i);
      if (familyMatch?.[2]) {
        const escapedOrig = familyMatch[2].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rewritten = cssText.replace(
          new RegExp(`font-family\\s*:\\s*(['"]?)${escapedOrig}\\1`, 'gi'),
          'font-family:"StmReaderCustomFont"',
        );
        fontStyleEl.textContent = rewritten;
      }
    } catch {
      // 网络离线或被取消时静默回退
    }
  }

  function applyBackdropAndTypography() {
    const doc = globalThis.document;
    if (!doc) return;

    const current = store.get();
    const readerActive = Boolean(current.shellEnabled && current.modules.reader);
    const vibe = current.vibe;
    const ctx = getContext?.();
    const meta = getCurrentEntityMeta(ctx);
    const inChat = Boolean(meta.active && !isHomeCloaked?.());

    doc.body.classList.toggle('stm-reader-justify', Boolean(readerActive && inChat));

    let backdropLive = false;

    if (!readerActive || !inChat || vibe.backdropMode === 'theme') {
      hideBackdrop(doc);
    } else {
      const rawUrl =
        vibe.backdropMode === 'character'
          ? meta.portraitUrl || meta.thumbUrl
          : vibe.customBackdropUrl
            ? resolveAssetHref(vibe.customBackdropUrl)
            : '';

      if (!rawUrl) {
        hideBackdrop(doc);
      } else {
        const el = ensureBackdropEl();
        if (el) {
          backdropLive = true;
          doc.body.classList.add('stm-backdrop-live');
          applyImageBackdrop(doc, el, {
            rawUrl,
            brightness: vibe.backdropBrightness,
            clarity: vibe.backdropClarity,
            turboEnabled: Boolean(current.modules.turbo),
          });
        }
      }
    }

    const inChatReaderActive = Boolean(readerActive && inChat);
    void syncCustomFontFace(doc, inChatReaderActive, vibe);
    const isNotionTheme = inChatReaderActive ? detectNotionTheme(doc) : false;
    const overrideCss = buildPageOverrideCss(vibe, {
      readerActive: inChatReaderActive,
      backdropLive,
      isNotionTheme,
    });
    syncOverrideStyleSheet(doc, overrideCss);
  }

  function restoreOptionsMenu() {
    for (const [node, placeholder] of movedMenuNodes) {
      if (placeholder.isConnected) {
        placeholder.replaceWith(node);
      } else if (menuExtraWrap?.isConnected) {
        menuExtraWrap.before(node);
      }
    }
    movedMenuNodes.clear();
    menuExtraWrap?.remove();
    menuExtraWrap = null;
    menuToggleBtn = null;
    menuExtraPanel = null;
  }

  function syncMenuFoldState() {
    if (!menuExtraPanel || !menuToggleBtn) return;
    menuExtraPanel.hidden = !menuExpanded;
    menuToggleBtn.setAttribute('aria-expanded', String(menuExpanded));
    menuToggleBtn.innerHTML = `<i class="fa-lg fa-solid fa-ellipsis" aria-hidden="true"></i><span>${
      menuExpanded ? '收起低频工具 ▴' : '更多原生工具 ▾'
    }</span>`;
  }

  function applyOptionsMenuFold() {
    const doc = globalThis.document;
    if (!doc) return;

    const current = store.get();
    if (!current.shellEnabled || !current.tidy.foldOptionsMenu || doc.getElementById('yt-interface-more')) {
      restoreOptionsMenu();
      return;
    }

    if (menuExtraWrap?.isConnected) {
      syncMenuFoldState();
      return;
    }

    const container = doc.querySelector('#options .options-content');
    if (!container) return;

    const targets = LOW_FREQ_OPTION_IDS.map(id => doc.getElementById(id)).filter(el => el && container.contains(el));
    if (!targets.length) return;

    menuExtraWrap = doc.createElement('div');
    menuExtraWrap.className = 'stm-options-more';

    menuToggleBtn = doc.createElement('a');
    menuToggleBtn.className = 'stm-options-more-toggle interactable';
    menuToggleBtn.tabIndex = 0;
    menuToggleBtn.setAttribute('role', 'button');
    menuToggleBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      menuExpanded = !menuExpanded;
      syncMenuFoldState();
    });
    menuToggleBtn.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        menuToggleBtn.click();
      }
    });

    menuExtraPanel = doc.createElement('div');
    menuExtraPanel.className = 'stm-options-more-panel';

    menuExtraWrap.append(menuToggleBtn, menuExtraPanel);
    container.append(menuExtraWrap);

    for (const item of targets) {
      const marker = doc.createComment('stm-original-option');
      item.before(marker);
      movedMenuNodes.set(item, marker);
      menuExtraPanel.append(item);
    }

    syncMenuFoldState();
  }

  function invalidateCurrentEntityBackdrop() {
    const meta = getCurrentEntityMeta(getContext?.());
    if (meta.portraitUrl) backdropCache.invalidate(meta.portraitUrl);
    if (meta.thumbUrl) backdropCache.invalidate(meta.thumbUrl);
    activeRawUrl = '';
    activeDisplayUrl = '';
  }

  function refresh() {
    applyBackdropAndTypography();
    applyOptionsMenuFold();
  }

  function destroy() {
    customFontAbort?.abort?.();
    customFontAbort = null;
    fontStyleEl?.remove();
    fontStyleEl = null;
    pageOverrideStyleEl?.remove();
    pageOverrideStyleEl = null;
    loadedCustomFontUrl = '';

    restoreOptionsMenu();
    backdropCache.destroy();
    backdropEl?.remove();
    backdropEl = null;
    artEl = null;
    shadeEl = null;
    activeRawUrl = '';
    activeDisplayUrl = '';

    globalThis.document?.body?.classList.remove('stm-backdrop-live', 'stm-reader-justify');
  }

  return {
    refresh,
    invalidateCurrentEntityBackdrop,
    destroy,
  };
}
