/**
 * ST伴侣 (st-mate) · 页面排版与背景渲染器 + 底栏低频项收纳
 * 核心突破：
 * 1. 底图直接挂载于 #sheld 阅读主栏内部最底层（z-index:0），并动态透明化 #sheld/#chat/#form_sheld，
 *    确保在《观月札记》《静读》等任何第三方美化下都精准替换「文字正下方的酒馆底图」，电脑宽屏亦不拉扯变形；
 * 2. 动态高优先级覆盖表 (#stm-page-overrides) 始终驻留于 document.head 末尾（排在 #custom-style 之后），
 *    未改动项 0 规则注入，改动项（字号/边距/首行顶格与缩进/行距/字体/隐去头像/无框书页）100% 破除主题锁定即刻见效！
 */

import { clarityToBlurPx, createBackdropCache } from '../core/backdrop-cache.js?v=0.3.0';
import { getCurrentEntityMeta, resolveAssetHref } from './host-actions.js?v=0.3.0';

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

export function buildPageOverrideCss(vibe, { readerActive = false, backdropLive = false } = {}) {
  if (!readerActive) return '';
  const rules = [];

  if (backdropLive) {
    rules.push(`
html body.stm-shell-active.stm-backdrop-live #sheld#sheld {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}
html body.stm-shell-active.stm-backdrop-live #chat#chat,
html body.stm-shell-active.stm-backdrop-live #form_sheld#form_sheld {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}`);
  }

  if (vibe.fontSizePx > 0) {
    rules.push(`
html body #chat#chat > .mes:not(.smallSysMes) {
  --nt-body: ${vibe.fontSizePx}px !important;
}
html body #chat#chat > .mes:not(.smallSysMes) .mes_text,
html body #chat#chat > .mes:not(.smallSysMes) .mes_text :is(p, li, q, blockquote) {
  font-size: ${vibe.fontSizePx}px !important;
}`);
  } else if (vibe.fontScale !== 100) {
    const scale = (vibe.fontScale / 100).toFixed(2);
    rules.push(`
html body #chat#chat > .mes:not(.smallSysMes) .mes_text {
  font-size: calc(var(--mainFontSize, 1rem) * ${scale}) !important;
}`);
  }

  if (vibe.paddingX > 0) {
    rules.push(`
html body #chat#chat {
  --nt-inset: 0px !important;
  --nt-mobile-inset: 0px !important;
  padding-left: ${vibe.paddingX}px !important;
  padding-right: ${vibe.paddingX}px !important;
  box-sizing: border-box !important;
}`);
  }

  if (vibe.lineHeight > 0) {
    const lh = (vibe.lineHeight / 100).toFixed(2);
    rules.push(`
html body #chat#chat > .mes:not(.smallSysMes) {
  --nt-body-line-height: ${lh} !important;
  --jd-leading: ${lh} !important;
}
html body #chat#chat > .mes:not(.smallSysMes) .mes_text,
html body #chat#chat > .mes:not(.smallSysMes) .mes_text p {
  line-height: ${lh} !important;
}`);
  }

  if (vibe.paragraphIndent === 'indent') {
    rules.push(`
html body #chat#chat > .mes:not(.smallSysMes) .mes_text p:not(:is(blockquote p, details p, li p, td p, th p)) {
  text-indent: 2em !important;
}`);
  } else if (vibe.paragraphIndent === 'flush') {
    rules.push(`
html body #chat#chat > .mes:not(.smallSysMes) .mes_text p {
  text-indent: 0 !important;
}`);
  }

  const useFont =
    vibe.fontChoice !== 'default' &&
    FONT_STACKS[vibe.fontChoice] &&
    (vibe.fontChoice !== 'custom' || vibe.customFontUrl);
  if (useFont) {
    const stack = FONT_STACKS[vibe.fontChoice];
    rules.push(`
html body #chat#chat > .mes:not(.smallSysMes) {
  --mainFontFamily: ${stack} !important;
  --nt-serif: ${stack} !important;
  --jd-font: ${stack} !important;
}
html body #chat#chat > .mes:not(.smallSysMes) .mes_text,
html body #chat#chat > .mes:not(.smallSysMes) .mes_text :not(:is(pre, code, kbd, samp, .fa, .fas, .far, .fab, .fa-solid, .fa-regular, .fa-brands, i[class*="fa-"])) {
  font-family: ${stack} !important;
}`);
  }

  if (vibe.hideAvatars) {
    rules.push(`
html body #chat#chat > .mes:not(.smallSysMes) > .mesAvatarWrapper {
  display: none !important;
}
html body #chat#chat > .mes:not(.smallSysMes) > .mes_block {
  margin-left: 0 !important;
  padding-left: 0 !important;
  padding-top: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
}
html body #chat#chat > .mes:not(.smallSysMes)::before,
html body #chat#chat > .mes:not(.smallSysMes)::after {
  display: none !important;
  content: none !important;
}`);
  }

  if (vibe.bookPageFlow) {
    rules.push(`
html body #chat#chat > .mes:not(.smallSysMes),
html body #chat#chat > .mes:not(.smallSysMes) > .mes_block,
html body #chat#chat > .mes:not(.smallSysMes) .mes_text {
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
  let activeBaseDisplayUrl = '';
  let imageReqId = 0;
  let bakeTimer = 0;

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
      // 文字明度低于 0.42 说明当前是白底深字浅色主题，自动改用柔白雾遮罩保证黑字清晰
      return lum < 0.42;
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
    // 始终保持在 head 最末尾（晚于酒馆 #custom-style），确保任何美化主题下调字号/字体/边距都立即生效
    if (doc.head.lastElementChild !== pageOverrideStyleEl) {
      doc.head.append(pageOverrideStyleEl);
    }
    if (pageOverrideStyleEl.textContent !== cssText) {
      pageOverrideStyleEl.textContent = cssText;
    }
  }

  function clearBakeTimer() {
    if (bakeTimer) {
      clearTimeout(bakeTimer);
      bakeTimer = 0;
    }
  }

  function hideBackdrop(doc) {
    clearBakeTimer();
    imageReqId += 1;
    activeRawUrl = '';
    activeBaseDisplayUrl = '';
    if (backdropEl) {
      backdropEl.hidden = true;
      delete backdropEl.dataset.preblurred;
    }
    doc?.body?.classList.remove('stm-backdrop-live');
  }

  function scheduleStaticBlurBake(rawUrl, clarity, turboEnabled) {
    clearBakeTimer();
    const blurPx = clarityToBlurPx(clarity);
    if (!turboEnabled || !rawUrl || blurPx < 0.8) return;

    const expectedReq = imageReqId;
    bakeTimer = setTimeout(async () => {
      bakeTimer = 0;
      const s = store.get();
      if (!s.shellEnabled || !s.modules.reader || !s.modules.turbo) return;
      if (expectedReq !== imageReqId || activeRawUrl !== rawUrl) return;
      if (s.vibe.backdropClarity !== clarity) return;

      const bakedUrl = await backdropCache.bakeBlurredUrl(rawUrl, clarity);
      if (!bakedUrl || expectedReq !== imageReqId || activeRawUrl !== rawUrl) return;
      if (store.get().vibe.backdropClarity !== clarity || !backdropEl || backdropEl.hidden) return;

      backdropEl.style.setProperty('--stm-backdrop-image', cssSafeUrl(bakedUrl));
      backdropEl.style.setProperty('--stm-backdrop-blur', '0px');
      backdropEl.dataset.preblurred = '1';
    }, 200);
  }

  function applyImageBackdrop(doc, el, { rawUrl, brightness, clarity, turboEnabled }) {
    const blurPx = clarityToBlurPx(clarity);
    const dimAlpha = ((100 - brightness) / 100).toFixed(2);
    const isLightTheme = detectLightInkTheme(doc);

    el.dataset.tone = isLightTheme ? 'light' : 'dark';
    el.style.setProperty('--stm-backdrop-dim', dimAlpha);

    if (rawUrl === activeRawUrl && activeBaseDisplayUrl) {
      delete el.dataset.preblurred;
      el.style.setProperty('--stm-backdrop-image', cssSafeUrl(activeBaseDisplayUrl));
      el.style.setProperty('--stm-backdrop-blur', `${blurPx}px`);
      el.hidden = false;
      scheduleStaticBlurBake(rawUrl, clarity, turboEnabled);
      return;
    }

    activeRawUrl = rawUrl;
    activeBaseDisplayUrl = rawUrl;
    const reqId = ++imageReqId;

    delete el.dataset.preblurred;
    el.style.setProperty('--stm-backdrop-image', cssSafeUrl(rawUrl));
    el.style.setProperty('--stm-backdrop-blur', `${blurPx}px`);
    el.hidden = false;

    if (!turboEnabled) return;

    void backdropCache.resolveCompressedBase(rawUrl).then(entry => {
      if (reqId !== imageReqId || activeRawUrl !== rawUrl || !backdropEl || backdropEl.hidden) return;
      if (entry?.objectUrl) {
        activeBaseDisplayUrl = entry.objectUrl;
        delete backdropEl.dataset.preblurred;
        backdropEl.style.setProperty('--stm-backdrop-image', cssSafeUrl(entry.objectUrl));
      }
      scheduleStaticBlurBake(rawUrl, store.get().vibe.backdropClarity, Boolean(store.get().modules.turbo));
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

    void syncCustomFontFace(doc, readerActive, vibe);
    const overrideCss = buildPageOverrideCss(vibe, { readerActive, backdropLive });
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
    activeBaseDisplayUrl = '';
  }

  function refresh() {
    applyBackdropAndTypography();
    applyOptionsMenuFold();
  }

  function destroy() {
    clearBakeTimer();
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
    activeBaseDisplayUrl = '';

    globalThis.document?.body?.classList.remove('stm-backdrop-live');
  }

  return {
    refresh,
    invalidateCurrentEntityBackdrop,
    destroy,
  };
}
