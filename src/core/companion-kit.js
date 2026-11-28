/**
 * SillyTavern 伴侣 (st-mate) · 官方配套「零算力光学微透玻璃 · 对称居中卡片流」双生主题 & 砚台预设直通模块
 * 设计准则：
 * 1. 版心 100% 居中对称：采用「顶栏单行头像名称 + 下方全宽正文」结构，彻底消除左侧头像列挤占导致的手机偏右与电脑偏左；电脑端自动收束至黄金阅读版心居中对齐；
 * 2. 零烧性能光学玻璃感：不用耗电掉帧的 backdrop-filter 高斯模糊，采用微透渐变层 + 1px 玻璃顶缘内高光 (inset highlight) + 细描边，千元机与电脑均稳跑 60 帧；
 * 3. 克制高级银灰调：告别刺眼亮金，统一采用高级中性钛银灰点睛，百搭冷调/古风/现代任何角色卡；
 * 4. 全屏图标语言统一：将底栏「三横 / 魔法棒 / 发送」、原版顶栏九宫格与楼层「更多 / 编辑」全部重绘为与伴侣顶栏同款的 1.5px 纤细线性图标，并内置「故事还在继续…」输入提示。
 */

import {
  getHostPresetState,
  importPresetItems,
  selectHostPresetByName,
} from '../modules/preset-backend.js?v=0.9.18';

export const COMPANION_THEME_NIGHT_NAME = '伴侣主题 · 静夜';
export const COMPANION_THEME_DAY_NAME = '伴侣主题 · 浅昼';

export const MOON_NOTE_THEME_AUTO_NAME = '观月札记 · 跟随系统 (WWW)';
export const MOON_NOTE_THEME_DAY_NAME = '观月札记 · 浅昼 (WWW)';
export const MOON_NOTE_THEME_NIGHT_NAME = '观月札记 · 静夜 (WWW)';

export const MOON_NOTE_THEME_META = Object.freeze({
  title: '观月札记',
  version: 'V1.1.3',
  author: 'WWW',
  license: 'CC-BY-NC-SA-4.0',
  creditLine: '作者：WWW · 已获授权',
});

export const MOON_NOTE_THEME_MODES = Object.freeze([
  {
    id: 'auto',
    name: MOON_NOTE_THEME_AUTO_NAME,
    shortLabel: '跟随系统',
    sub: '随设备明暗自动切换',
    recommended: false,
  },
  {
    id: 'day',
    name: MOON_NOTE_THEME_DAY_NAME,
    shortLabel: '浅昼 · 日间',
    sub: '暖白纸面 · 日间护眼',
    recommended: false,
  },
  {
    id: 'night',
    name: MOON_NOTE_THEME_NIGHT_NAME,
    shortLabel: '静夜 · 夜间',
    sub: '柔和炭灰 · 夜间沉浸',
    recommended: true,
  },
]);

const MOON_NOTE_LIGHT_BASE_COLORS = Object.freeze({
  main_text_color: 'rgba(55, 53, 47, 1)',
  italics_text_color: 'rgba(104, 103, 98, 1)',
  underline_text_color: 'rgba(135, 88, 94, 1)',
  quote_text_color: 'rgba(82, 108, 120, 1)',
  blur_tint_color: 'rgba(244, 242, 237, 1)',
  chat_tint_color: 'rgba(250, 249, 246, 1)',
  user_mes_blur_tint_color: 'rgba(0, 0, 0, 0)',
  bot_mes_blur_tint_color: 'rgba(0, 0, 0, 0)',
  shadow_color: 'rgba(35, 35, 30, 0.09)',
  border_color: 'rgba(228, 224, 216, 1)',
});

const MOON_NOTE_DARK_BASE_COLORS = Object.freeze({
  main_text_color: 'rgba(230, 228, 223, 1)',
  italics_text_color: 'rgba(178, 175, 168, 1)',
  underline_text_color: 'rgba(208, 161, 168, 1)',
  quote_text_color: 'rgba(165, 183, 191, 1)',
  blur_tint_color: 'rgba(32, 32, 32, 1)',
  chat_tint_color: 'rgba(25, 25, 25, 1)',
  user_mes_blur_tint_color: 'rgba(0, 0, 0, 0)',
  bot_mes_blur_tint_color: 'rgba(0, 0, 0, 0)',
  shadow_color: 'rgba(0, 0, 0, 0.25)',
  border_color: 'rgba(65, 65, 62, 1)',
});

let cachedMoonNoteBaseTheme = null;

export function isMoonNoteThemeName(themeName) {
  const clean = typeof themeName === 'string' ? themeName.trim() : '';
  if (!clean) return false;
  return (
    clean === MOON_NOTE_THEME_AUTO_NAME ||
    clean === MOON_NOTE_THEME_DAY_NAME ||
    clean === MOON_NOTE_THEME_NIGHT_NAME ||
    clean.startsWith('观月札记')
  );
}

/**
 * 基于 WWW 老师正版授权的《观月札记 V1.1.3》底座，按其原生显示模式区块无损生成
 * 「跟随系统 / 浅昼（固定浅色）/ 静夜（固定深色）」三套变体，完整保留原作者版权头与人设馆兼容层。
 */
export function buildMoonNoteThemeVariant(
  baseTheme,
  modeId = 'auto',
  { preferDark = false } = {},
) {
  if (!baseTheme || typeof baseTheme !== 'object') {
    throw new Error('缺少《观月札记》基础主题数据');
  }
  const normalizedMode = modeId === 'day' ? 'day' : modeId === 'night' ? 'night' : 'auto';
  const modeMeta =
    MOON_NOTE_THEME_MODES.find(item => item.id === normalizedMode) || MOON_NOTE_THEME_MODES[0];

  let css = String(baseTheme.custom_css || '');
  const lightBlockRe =
    /(\/\*\s*固定浅色\s*\*\/\s*\r?\n)(?:\/\*\s*\r?\n)?(html:root\s*\{[\s\S]*?--nt-user-background-shade:0;\s*\r?\n\})(?:\s*\r?\n\*\/)?/;
  const darkBlockRe =
    /(\/\*\s*固定深色\s*\*\/\s*\r?\n)(?:\/\*\s*\r?\n)?(html:root\s*\{[\s\S]*?--nt-user-background-shade:var\(--nt-dark-background-shade\);\s*\r?\n\})(?:\s*\r?\n\*\/)?/;

  if (normalizedMode === 'day') {
    css = css.replace(lightBlockRe, '$1$2');
    css = css.replace(darkBlockRe, '$1/*\n$2\n*/');
  } else if (normalizedMode === 'night') {
    css = css.replace(lightBlockRe, '$1/*\n$2\n*/');
    css = css.replace(darkBlockRe, '$1$2');
  } else {
    css = css.replace(lightBlockRe, '$1/*\n$2\n*/');
    css = css.replace(darkBlockRe, '$1/*\n$2\n*/');
  }

  const useDarkPalette =
    normalizedMode === 'night' || (normalizedMode === 'auto' && Boolean(preferDark));
  const baseColors = useDarkPalette ? MOON_NOTE_DARK_BASE_COLORS : MOON_NOTE_LIGHT_BASE_COLORS;

  return {
    ...baseTheme,
    ...baseColors,
    name: modeMeta.name,
    custom_css: css,
  };
}

function svgMask(inner, strokeWidth = 1.55) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='${strokeWidth}' stroke-linecap='round' stroke-linejoin='round'>${inner}</svg>`;
  const encoded = svg
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/"/g, "'");
  return `url("data:image/svg+xml,${encoded}")`;
}

const ICON_MASKS = Object.freeze({
  bars: svgMask("<line x1='4' y1='7' x2='20' y2='7'/><line x1='4' y1='12' x2='15.5' y2='12'/><line x1='4' y1='17' x2='20' y2='17'/>"),
  spark: svgMask("<path d='M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2-5.2-1.8 5.2-1.8L12 3.5z'/><path d='M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z'/>"),
  send: svgMask("<line x1='20.5' y1='3.5' x2='10' y2='14'/><polygon points='20.5 3.5 14.2 20.5 10 14 3.5 9.8 20.5 3.5'/>"),
  stop: svgMask("<rect x='6.5' y='6.5' width='11' height='11' rx='2.2'/>"),
  cont: svgMask("<line x1='5' y1='12' x2='19' y2='12'/><polyline points='13 6 19 12 13 18'/>"),
  sliders: svgMask("<line x1='4' y1='6' x2='13' y2='6'/><line x1='17' y1='6' x2='20' y2='6'/><circle cx='15' cy='6' r='2'/><line x1='4' y1='12' x2='7' y2='12'/><line x1='11' y1='12' x2='20' y2='12'/><circle cx='9' cy='12' r='2'/><line x1='4' y1='18' x2='14' y2='18'/><line x1='18' y1='18' x2='20' y2='18'/><circle cx='16' cy='18' r='2'/>"),
  plug: svgMask("<line x1='9' y1='3' x2='9' y2='7.5'/><line x1='15' y1='3' x2='15' y2='7.5'/><path d='M6.5 7.5h11v3.8a5.5 5.5 0 0 1-11 0V7.5z'/><line x1='12' y1='16.8' x2='12' y2='21'/>"),
  typography: svgMask("<path d='M3.8 18.5L8 6l4.2 12.5'/><line x1='5.3' y1='14.2' x2='10.7' y2='14.2'/><path d='M15 11.6a2.6 2.6 0 0 1 4.8 1.4v5.5'/><path d='M19.8 14.9h-2.7a2 2 0 0 0 0 3.6h2.7'/>"),
  globe: svgMask("<circle cx='12' cy='12' r='8.8'/><line x1='3.2' y1='12' x2='20.8' y2='12'/><path d='M12 3.2a14.2 14.2 0 0 1 0 17.6 14.2 14.2 0 0 1 0-17.6z'/>"),
  settings: svgMask("<line x1='4' y1='8' x2='10' y2='8'/><line x1='14' y1='8' x2='20' y2='8'/><circle cx='12' cy='8' r='2'/><line x1='4' y1='16' x2='8' y2='16'/><line x1='12' y1='16' x2='20' y2='16'/><circle cx='10' cy='16' r='2'/>"),
  image: svgMask("<rect x='3.5' y='4.5' width='17' height='15' rx='2'/><circle cx='8.8' cy='9.5' r='1.4'/><path d='M20.5 16l-4.8-4.5L7 19.5'/>"),
  grid: svgMask("<rect x='3.5' y='3.5' width='7' height='7' rx='1.5'/><rect x='13.5' y='3.5' width='7' height='7' rx='1.5'/><rect x='3.5' y='13.5' width='7' height='7' rx='1.5'/><rect x='13.5' y='13.5' width='7' height='7' rx='1.5'/>"),
  user: svgMask("<circle cx='12' cy='8' r='3.6'/><path d='M5.2 19.8c1.5-3.1 4-4.6 6.8-4.6s5.3 1.5 6.8 4.6'/>"),
  idcard: svgMask("<rect x='3' y='5' width='18' height='14' rx='2'/><circle cx='8.5' cy='10.8' r='2.1'/><path d='M5.8 16.2c.7-1.4 1.7-2 2.7-2s2 .6 2.7 2'/><line x1='13.5' y1='9.5' x2='18' y2='9.5'/><line x1='13.5' y1='13.5' x2='17' y2='13.5'/>"),
  dots: svgMask("<circle cx='6' cy='12' r='1.25' fill='black' stroke='none'/><circle cx='12' cy='12' r='1.25' fill='black' stroke='none'/><circle cx='18' cy='12' r='1.25' fill='black' stroke='none'/>"),
  edit: svgMask("<path d='M15.8 4.2a2.1 2.1 0 0 1 3 3L8 18l-4.2 1.2L5 15l10.8-10.8z'/>"),
});

function buildAppleOpticalGlassCss(p) {
  return `/*
 * ${p.name} · SillyTavern 伴侣官方配套主题
 * 对称居中版心 · 零算力光学微透玻璃 · 克制钛银灰层级 · 全屏 1.5px 线性图标统一
 */
:root {
  color-scheme: ${p.scheme};
  --yt-input-hint: "故事还在继续…";

  /* 同步锁死酒馆底层 SmartTheme 变量，跨手机/电脑双端切换绝不发白串色 */
  --SmartThemeBodyColor: ${p.smartBody} !important;
  --SmartThemeEmColor: ${p.smartEm} !important;
  --SmartThemeUnderlineColor: ${p.smartUnderline} !important;
  --SmartThemeQuoteColor: ${p.smartQuote} !important;
  --SmartThemeBlurTintColor: ${p.smartBlurTint} !important;
  --SmartThemeChatTintColor: ${p.smartChatTint} !important;
  --SmartThemeUserMesBlurTintColor: ${p.smartUserTint} !important;
  --SmartThemeBotMesBlurTintColor: ${p.smartBotTint} !important;
  --SmartThemeBorderColor: ${p.smartBorder} !important;

  --yt-canvas: ${p.canvas};
  --yt-glass-bar: ${p.glassBar};
  --yt-glass-drawer: ${p.glassDrawer};
  --yt-glass-card-bot: ${p.glassCardBot};
  --yt-glass-card-user: ${p.glassCardUser};
  --yt-glass-Rim: ${p.glassRim};
  --yt-elevated: ${p.elevated};
  --yt-inset: ${p.inset};
  --yt-ink: ${p.ink};
  --yt-muted: ${p.muted};
  --yt-faint: ${p.faint};
  --yt-em: ${p.em};
  --yt-quote: ${p.quote};
  --yt-line: ${p.line};
  --yt-line-strong: ${p.lineStrong};
  --yt-accent: ${p.accent};
  --yt-accent-soft: ${p.accentSoft};
  --yt-card-shadow: ${p.cardShadow};
  --yt-pop-shadow: ${p.popShadow};
  --yt-ui-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --yt-mono-font: "SF Mono", "Cascadia Code", Consolas, monospace;
  --yt-radius-card: 13px;
  --yt-radius-ctrl: 8px;
  --yt-avatar: 28px;
  --topBarBlockSize: 44px;
}

html, body {
  color: var(--yt-ink);
  font-family: var(--yt-ui-font);
  -webkit-font-smoothing: antialiased;
}
body {
  background: var(--yt-canvas);
}
body, #chat, #sheld, #form_sheld {
  background-image: none;
}

* {
  scrollbar-width: thin;
  scrollbar-color: var(--yt-line-strong) transparent;
}
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--yt-line-strong); border-radius: 999px; }
::selection { color: var(--yt-ink); background: var(--yt-accent-soft); }
hr { height: 1px; margin: 12px 0; border: 0; background: var(--yt-line); }

/* ==========================================================================
   1. 顶栏与角色书架首页零算力光学微透玻璃光泽
   ========================================================================== */
#stm-topbar .stm-topbar-inner {
  background: var(--yt-glass-bar) !important;
  border-bottom: 1px solid var(--yt-line) !important;
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim), 0 4px 18px rgba(0, 0, 0, 0.16) !important;
}

.jd-bookshelf .jd-input,
.jd-shelf-dialog .jd-input {
  background: var(--yt-glass-bar);
  border-color: var(--yt-line-strong);
  border-radius: 10px;
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim);
}
.jd-bookshelf .jd-story-card {
  background: var(--yt-glass-card-bot);
  border-color: var(--yt-line);
  border-radius: 10px;
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim), var(--yt-card-shadow) !important;
}
.jd-bookshelf .jd-save-count {
  background: var(--yt-glass-bar);
  border-color: var(--yt-line-strong);
  border-radius: 6px;
}
.jd-shelf-dialog {
  background: var(--yt-glass-drawer);
  border-color: var(--yt-line-strong);
  border-radius: 13px;
}

/* ==========================================================================
   2. 原版顶栏精修（切回「原版顶栏」或「原生酒馆」时同样呈极简 1.5px 线性美学）
   ========================================================================== */
#top-settings-holder {
  min-height: 44px;
  padding-inline: 8px;
  align-items: center;
  background: var(--yt-glass-bar);
  border: 0;
  border-bottom: 1px solid var(--yt-line);
  border-radius: 0;
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim), 0 4px 16px rgba(0, 0, 0, 0.14);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
#top-bar {
  height: var(--topBarBlockSize);
  background: transparent;
  border: 0;
  box-shadow: none;
}
@media screen and (min-width: 1001px) {
  body:not(.stm-shell-active) #top-settings-holder,
  body.stm-native-topbar #top-settings-holder {
    justify-content: center;
    gap: 10px;
  }
}
#top-settings-holder > .drawer > .drawer-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 34px;
  border-radius: 8px;
  transition: background-color 0.15s ease;
}
#top-settings-holder > .drawer > .drawer-toggle:hover {
  background: var(--yt-inset);
}
#top-settings-holder > :is(
  #ai-config-button,
  #sys-settings-button,
  #advanced-formatting-button,
  #WI-SP-button,
  #user-settings-button,
  #backgrounds-button,
  #extensions-settings-button,
  #persona-management-button,
  #rightNavHolder
) > .drawer-toggle > .drawer-icon {
  position: relative;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  width: 22px !important;
  height: 22px !important;
  font-size: 0 !important;
  color: var(--yt-muted);
  opacity: 0.92;
  filter: none !important;
  text-shadow: none !important;
  transition: color 0.15s ease, opacity 0.15s ease;
}
#top-settings-holder > :is(
  #ai-config-button,
  #sys-settings-button,
  #advanced-formatting-button,
  #WI-SP-button,
  #user-settings-button,
  #backgrounds-button,
  #extensions-settings-button,
  #persona-management-button,
  #rightNavHolder
) > .drawer-toggle > .drawer-icon::before {
  content: "" !important;
  display: block;
  width: 19px;
  height: 19px;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
#top-settings-holder > .drawer > .drawer-toggle:hover > .drawer-icon,
#top-settings-holder > .drawer > .drawer-toggle.stm-native-icon-active > .drawer-icon,
#top-settings-holder > .drawer > .drawer-toggle > .drawer-icon.openIcon {
  color: var(--yt-ink);
  opacity: 1;
}
#top-settings-holder > #ai-config-button > .drawer-toggle > .drawer-icon::before { -webkit-mask-image: ${ICON_MASKS.sliders}; mask-image: ${ICON_MASKS.sliders}; }
#top-settings-holder > #sys-settings-button > .drawer-toggle > .drawer-icon::before { -webkit-mask-image: ${ICON_MASKS.plug}; mask-image: ${ICON_MASKS.plug}; }
#top-settings-holder > #advanced-formatting-button > .drawer-toggle > .drawer-icon::before { -webkit-mask-image: ${ICON_MASKS.typography}; mask-image: ${ICON_MASKS.typography}; }
#top-settings-holder > #WI-SP-button > .drawer-toggle > .drawer-icon::before { -webkit-mask-image: ${ICON_MASKS.globe}; mask-image: ${ICON_MASKS.globe}; }
#top-settings-holder > #user-settings-button > .drawer-toggle > .drawer-icon::before { -webkit-mask-image: ${ICON_MASKS.settings}; mask-image: ${ICON_MASKS.settings}; }
#top-settings-holder > #backgrounds-button > .drawer-toggle > .drawer-icon::before { -webkit-mask-image: ${ICON_MASKS.image}; mask-image: ${ICON_MASKS.image}; }
#top-settings-holder > #extensions-settings-button > .drawer-toggle > .drawer-icon::before { -webkit-mask-image: ${ICON_MASKS.grid}; mask-image: ${ICON_MASKS.grid}; }
#top-settings-holder > #persona-management-button > .drawer-toggle > .drawer-icon::before { -webkit-mask-image: ${ICON_MASKS.user}; mask-image: ${ICON_MASKS.user}; }
#top-settings-holder > #rightNavHolder > .drawer-toggle > .drawer-icon::before { -webkit-mask-image: ${ICON_MASKS.idcard}; mask-image: ${ICON_MASKS.idcard}; }

/* ==========================================================================
   3. 光学微透玻璃抽屉、弹出菜单与原生控件
   ========================================================================== */
.drawer-content,
.options-content,
#extensionsMenu,
.popup,
.popup-content,
.modal-content {
  color: var(--yt-ink);
  background: var(--yt-glass-drawer);
  border: 1px solid var(--yt-line-strong);
  border-radius: var(--yt-radius-card);
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim), var(--yt-pop-shadow);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.options-content a,
#extensionsMenu .list-group-item {
  border-radius: 8px;
  color: var(--yt-ink);
  transition: background-color 0.14s ease;
}
.options-content a:hover,
#extensionsMenu .list-group-item:hover {
  background: var(--yt-inset);
}
.inline-drawer {
  margin-bottom: 7px;
  border: 1px solid var(--yt-line);
  border-radius: 10px;
  background: var(--yt-inset);
  overflow: hidden;
}
#character_popup > .inline-drawer {
  flex: 0 0 auto;
}
.inline-drawer-header,
.inline-drawer > .inline-drawer-toggle,
summary.inline-drawer-toggle {
  min-height: 36px;
  padding: 7px 12px;
  color: var(--yt-ink);
  background: transparent;
  border: 0;
  box-shadow: none;
  font-size: 13px;
  font-weight: 600;
}
.inline-drawer-content {
  padding: 12px;
  color: var(--yt-ink);
  background: rgba(0, 0, 0, 0.08);
  border-top: 1px solid var(--yt-line);
}

input[type="text"],
input[type="number"],
input[type="password"],
input[type="search"],
input[type="url"],
textarea:not(#send_textarea),
select {
  color: var(--yt-ink);
  background: var(--yt-elevated);
  border: 1px solid var(--yt-line-strong);
  border-radius: var(--yt-radius-ctrl);
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim);
  font-family: var(--yt-ui-font);
  outline: none;
}
input[type="text"]:focus,
input[type="number"]:focus,
input[type="password"]:focus,
input[type="search"]:focus,
input[type="url"]:focus,
textarea:not(#send_textarea):focus,
select:focus {
  border-color: var(--yt-accent);
  box-shadow: 0 0 0 2px var(--yt-accent-soft);
}
.menu_button:not([id="send_but"]):not([id="mes_stop"]):not(.fa-solid):not(.fa-regular):not(.fa-brands) {
  color: var(--yt-ink);
  background: var(--yt-elevated);
  border: 1px solid var(--yt-line-strong);
  border-radius: 8px;
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim);
  font-family: var(--yt-ui-font);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.menu_button:not([id="send_but"]):not([id="mes_stop"]):not(.fa-solid):not(.fa-regular):not(.fa-brands):hover {
  border-color: var(--yt-accent);
  background: var(--yt-inset);
}
input:checked + .slider { background: var(--yt-accent); }
input[type="range"] { accent-color: var(--yt-accent); }

/* 保护原生抽屉内普通 Font Awesome 按钮不乱码 */
button.fa-solid, button.fa-solid::before,
.menu_button.fa-solid, .menu_button.fa-solid::before {
  font-family: "Font Awesome 6 Free" !important;
  font-style: normal !important;
  font-weight: 900 !important;
}
button.fa-regular, button.fa-regular::before,
.menu_button.fa-regular, .menu_button.fa-regular::before {
  font-family: "Font Awesome 6 Free" !important;
  font-style: normal !important;
  font-weight: 400 !important;
}
button.fa-brands, button.fa-brands::before,
.menu_button.fa-brands, .menu_button.fa-brands::before {
  font-family: "Font Awesome 6 Brands" !important;
  font-style: normal !important;
  font-weight: 400 !important;
}

/* ==========================================================================
   4. 对话主画布 · 100% 正中对称光学微透卡片流（消除左侧头像列挤占偏移）
   ========================================================================== */
#chat:not(.jd-bookshelf-home) {
  padding: 14px clamp(10px, 2.2vw, 22px) 28px;
  background: var(--yt-canvas);
  box-sizing: border-box;
}

#chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: min(100%, 900px) !important;
  max-width: 900px !important;
  margin: 0 auto 12px !important;
  padding: 13px 16px 14px !important;
  box-sizing: border-box;
  color: var(--yt-ink);
  background: var(--yt-glass-card-bot);
  border: 1px solid var(--yt-line);
  border-radius: var(--yt-radius-card);
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim), var(--yt-card-shadow);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

#chat:not(.jd-bookshelf-home) > .mes[is_user="true"]:not(.smallSysMes) {
  background: var(--yt-glass-card-user);
  border-color: var(--yt-line-strong);
}

/* 头像精确锚定卡片左上角与角色名同行；统计数字归于卡片右下角，正文中轴线 100% 零偏移！ */
#chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) > .mesAvatarWrapper {
  position: static !important;
  order: 99;
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
  margin: 6px 0 0 !important;
  padding: 0 !important;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  background: transparent;
}
#chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) > .mesAvatarWrapper > .avatar {
  position: absolute !important;
  top: 12px;
  left: 16px;
  width: var(--yt-avatar) !important;
  min-width: var(--yt-avatar) !important;
  height: var(--yt-avatar) !important;
  margin: 0 !important;
  z-index: 2;
}
#chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) > .mesAvatarWrapper > .avatar img {
  width: var(--yt-avatar) !important;
  height: var(--yt-avatar) !important;
  object-fit: cover;
  border-radius: 50% !important;
  border: 1px solid var(--yt-line-strong);
  box-shadow: none;
}
body.hideChatAvatars #chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) > .mesAvatarWrapper > .avatar {
  display: none !important;
}

#chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) > .mes_block {
  order: 1;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
}
#chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) > .mes_block > .ch_name {
  min-height: var(--yt-avatar);
  padding-left: calc(var(--yt-avatar) + 10px);
  margin: 0 0 8px !important;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
body.hideChatAvatars #chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) > .mes_block > .ch_name {
  padding-left: 0;
}

.mes .ch_name,
.mes .name_text,
.mes .mes_name {
  color: var(--yt-ink);
  font-family: var(--yt-ui-font);
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-align: left !important;
}
.mes .mesIDDisplay,
.mes .mes_timer,
.mes .tokenCounterDisplay,
.mes .timestamp {
  position: static;
  display: inline-block;
  width: auto !important;
  margin: 0 !important;
  padding: 0;
  color: var(--yt-faint);
  background: transparent;
  border: 0;
  font-family: var(--yt-ui-font);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  white-space: nowrap;
}
.mes .mesIDDisplay:empty,
.mes .mes_timer:empty,
.mes .tokenCounterDisplay:empty,
.mes .timestamp:empty {
  display: none !important;
}

/* 正文全宽对称阅读区 */
.mes .mes_text {
  width: 100% !important;
  max-width: 100% !important;
  padding: 2px 0 0 !important;
  margin: 0 !important;
  color: var(--yt-ink);
  font-size: calc(var(--mainFontSize) * 1.03);
  line-height: 1.82;
  letter-spacing: 0.012em;
  text-align: left;
  overflow-wrap: anywhere;
  box-sizing: border-box;
}
.mes .mes_text p { margin: 0.56em 0; }
.mes .mes_text p:first-child { margin-top: 0; }
.mes .mes_text p:last-child { margin-bottom: 0; }
.mes_text strong { color: var(--yt-ink); font-weight: 650; }
.mes_text em { color: var(--yt-em); font-style: italic; }
.mes_text q { color: var(--yt-quote); background: transparent; font-style: normal; }
.mes_text blockquote {
  margin: 0.7em 0;
  padding: 0.48em 0.88em;
  color: var(--yt-muted);
  background: var(--yt-inset);
  border: 0;
  border-left: 2px solid var(--yt-accent);
  border-radius: 0 8px 8px 0;
}
.mes_text blockquote::before { display: none; }
.mes_text :not(pre) > code {
  padding: 1px 5px;
  color: var(--yt-ink);
  background: var(--yt-accent-soft);
  border: 1px solid var(--yt-line);
  border-radius: 4px;
  font-family: var(--yt-mono-font);
  font-size: 0.88em;
}
.mes_text pre {
  margin: 0.75em 0;
  padding: 11px 13px;
  color: var(--yt-ink);
  background: var(--yt-inset);
  border: 1px solid var(--yt-line);
  border-radius: 8px;
  overflow-x: auto;
}
.mes_text pre code {
  color: inherit;
  background: transparent;
  border: 0;
  font-family: var(--yt-mono-font);
  font-size: 0.86em;
}

/* 楼层右上角「更多 · 编辑」统一为 1.5px 细线图标 */
.mes_buttons {
  align-items: center;
  gap: 3px;
}
.mes_buttons > .mes_button {
  min-width: 26px;
  min-height: 26px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--yt-faint);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  box-shadow: none;
  filter: none;
  text-shadow: none;
  opacity: 0.85;
  transition: color 0.14s ease, background-color 0.14s ease;
}
.mes_buttons > .mes_button:hover {
  color: var(--yt-ink);
  background: var(--yt-inset);
  border-color: var(--yt-line);
  opacity: 1;
}
.mes_buttons > .mes_button.extraMesButtonsHint,
.mes_buttons > .mes_button.mes_edit {
  font-size: 0 !important;
  width: 26px;
  height: 26px;
  padding: 0;
}
.mes_buttons > .mes_button.extraMesButtonsHint::before,
.mes_buttons > .mes_button.mes_edit::before {
  content: "" !important;
  display: block;
  width: 15px;
  height: 15px;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
.mes_buttons > .mes_button.extraMesButtonsHint::before { -webkit-mask-image: ${ICON_MASKS.dots}; mask-image: ${ICON_MASKS.dots}; }
.mes_buttons > .mes_button.mes_edit::before { -webkit-mask-image: ${ICON_MASKS.edit}; mask-image: ${ICON_MASKS.edit}; }

.extraMesButtons {
  background: var(--yt-glass-drawer);
  border: 1px solid var(--yt-line-strong);
  border-radius: 10px;
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim), var(--yt-pop-shadow);
}

/* 思考过程 (<think>) · 极净微透胶囊卡 */
.mes_reasoning_details {
  width: 100%;
  margin: 4px 0 8px;
  overflow: hidden;
  color: var(--yt-muted);
  background: var(--yt-inset);
  border: 1px solid var(--yt-line);
  border-radius: 9px;
  box-shadow: none;
  box-sizing: border-box;
}
.mes_reasoning_details .mes_reasoning_summary {
  min-height: 34px;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: stretch;
  color: var(--yt-muted);
  background: transparent;
  border: 0;
  list-style: none;
}
.mes_reasoning_details[open] .mes_reasoning_summary {
  border-bottom: 1px solid var(--yt-line);
}
.mes_reasoning_summary::-webkit-details-marker { display: none; }
.mes_reasoning_header {
  width: 100%;
  min-height: 34px;
  margin: 0;
  padding: 7px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: inherit;
  background: transparent;
  border: 0;
  box-shadow: none;
  cursor: pointer;
}
.mes_reasoning_summary:hover { color: var(--yt-ink); }
.mes_reasoning {
  margin: 0;
  padding: 11px 14px 12px;
  color: var(--yt-muted);
  background: transparent;
  border: 0;
  box-shadow: none;
  font-size: calc(var(--mainFontSize) * 0.9);
  line-height: 1.72;
}

/* ==========================================================================
   5. 底部输入胶囊栏：光学玻璃 + 1.5px 线性三图标 + 「故事还在继续…」
   ========================================================================== */
#form_sheld {
  padding-inline: clamp(8px, 2vw, 18px);
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  box-sizing: border-box;
}
#send_form {
  width: min(100%, 900px) !important;
  max-width: 900px !important;
  margin: 0 auto 6px !important;
  padding: 5px 8px !important;
  background: var(--yt-glass-bar) !important;
  border: 1px solid var(--yt-line-strong) !important;
  border-radius: 14px !important;
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim), 0 -4px 22px rgba(0, 0, 0, 0.18) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-sizing: border-box;
  transition: border-color 0.16s ease;
}
#send_form:focus-within {
  border-color: var(--yt-accent) !important;
}

#nonQRFormItems {
  position: relative;
  display: flex !important;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  width: 100%;
}
#leftSendForm {
  display: inline-flex !important;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
  margin: 0 !important;
  padding: 0 !important;
}
#rightSendForm {
  display: inline-flex !important;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
  margin: 0 !important;
  padding: 0 !important;
}
#send_textarea {
  flex: 1 1 auto;
  min-width: 0;
  width: 100% !important;
  min-height: 34px;
  padding: 6px 8px;
  margin: 0 !important;
  color: var(--yt-ink);
  background: transparent !important;
  border: 0 !important;
  border-radius: 0;
  box-shadow: none !important;
  font-family: var(--yt-ui-font);
  font-size: var(--mainFontSize);
  line-height: 1.56;
  outline: none;
}

/* 「故事还在继续…」优雅全屏中轴线居中空白提示（点击输入时自动隐退零遮挡，未连 API 时保留原生断连提醒） */
#send_textarea:not(:disabled):not([placeholder*="Not connected"]):not([placeholder*="未连接"])::placeholder {
  color: transparent !important;
}
#nonQRFormItems:has(#send_textarea:placeholder-shown:not(:focus):not(:disabled):not([placeholder*="Not connected"]):not([placeholder*="未连接"]))::after {
  content: var(--yt-input-hint);
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  max-width: calc(100% - 160px);
  padding: 0 4px;
  color: var(--yt-faint);
  font-family: var(--yt-ui-font);
  font-size: 13.5px;
  font-weight: 400;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 1;
}
#send_textarea::placeholder {
  color: var(--yt-faint);
  opacity: 1;
}

/* 底栏左二（三横 + 魔法棒）与右侧（发送 / 续写 / 停止）统一升级为 1.5px 纤细线性图标 */
#options_button,
#extensionsMenuButton,
#send_but,
#mes_continue {
  position: relative;
  width: 34px !important;
  min-width: 34px !important;
  height: 34px !important;
  min-height: 34px !important;
  margin: 0 !important;
  padding: 0 !important;
  align-items: center;
  justify-content: center;
  font-size: 0 !important;
  color: var(--yt-muted) !important;
  background: transparent !important;
  border: 0 !important;
  border-radius: 9px;
  box-shadow: none !important;
  text-shadow: none !important;
  filter: none !important;
  opacity: 0.9;
  transition: color 0.15s ease, background-color 0.15s ease, opacity 0.15s ease;
}
#options_button:not(.displayNone),
#send_but:not(.displayNone),
#mes_continue:not(.displayNone) {
  display: inline-flex !important;
}
#options_button:hover,
#extensionsMenuButton:hover,
#mes_continue:hover {
  color: var(--yt-ink) !important;
  background: var(--yt-inset) !important;
  opacity: 1;
}
#send_but {
  color: var(--yt-accent) !important;
  background: var(--yt-inset) !important;
  border-radius: 50%;
}
#send_but:hover {
  color: var(--yt-ink) !important;
  background: var(--yt-accent-soft) !important;
  opacity: 1;
}
#options_button::before,
#extensionsMenuButton::before,
#send_but::before,
#mes_continue::before {
  content: "" !important;
  display: block;
  width: 18px;
  height: 18px;
  margin: auto;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
#options_button::before { -webkit-mask-image: ${ICON_MASKS.bars}; mask-image: ${ICON_MASKS.bars}; }
#extensionsMenuButton::before { -webkit-mask-image: ${ICON_MASKS.spark}; mask-image: ${ICON_MASKS.spark}; }
#send_but::before { width: 17px; height: 17px; -webkit-mask-image: ${ICON_MASKS.send}; mask-image: ${ICON_MASKS.send}; }
#mes_continue::before { -webkit-mask-image: ${ICON_MASKS.cont}; mask-image: ${ICON_MASKS.cont}; }

#mes_stop {
  width: 34px !important;
  min-width: 34px !important;
  height: 34px !important;
  margin: 0 !important;
  padding: 0 !important;
  border-radius: 50%;
  color: var(--yt-ink) !important;
  background: var(--yt-inset) !important;
  border: 1px solid var(--yt-line-strong) !important;
  align-items: center;
  justify-content: center;
}
#mes_stop i {
  font-size: 0 !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
#mes_stop i::before {
  content: "" !important;
  display: block;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask: ${ICON_MASKS.stop} no-repeat center / contain;
  mask: ${ICON_MASKS.stop} no-repeat center / contain;
}

/* 原生列表条目与加载更多胶囊 */
.world_entry,
.lorebook-entry,
.character_select,
.completion_prompt_manager_prompt,
.regex-script-label.flex-container,
.flex-container .script-item {
  color: var(--yt-ink);
  background: var(--yt-elevated);
  border: 1px solid var(--yt-line);
  border-radius: 9px;
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim);
}
#show_more_messages {
  display: block;
  width: fit-content;
  margin: 12px auto;
  padding: 5px 14px;
  color: var(--yt-muted);
  background: var(--yt-glass-bar);
  border: 1px solid var(--yt-line-strong);
  border-radius: 999px;
  box-shadow: inset 0 1px 0 var(--yt-glass-Rim);
  font-size: 12px;
}
#show_more_messages:hover {
  color: var(--yt-ink);
  border-color: var(--yt-accent);
}

/* 手机窄屏精细调优 */
@media screen and (max-width: 768px) {
  :root { --yt-avatar: 26px; }
  #chat:not(.jd-bookshelf-home) { padding-left: 8px; padding-right: 8px; }
  #chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) {
    padding: 11px 12px 12px !important;
    margin-bottom: 10px !important;
    border-radius: 12px;
  }
  #chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) > .mesAvatarWrapper > .avatar {
    top: 10px;
    left: 12px;
  }
  #chat:not(.jd-bookshelf-home) > .mes:not(.smallSysMes) > .mes_block > .ch_name {
    padding-left: calc(var(--yt-avatar) + 8px);
    margin-bottom: 6px !important;
  }
  .mes .mes_text { font-size: var(--mainFontSize); line-height: 1.78; }
  #top-settings-holder { padding-inline: 4px; }
  #top-settings-holder > .drawer { flex: 1 1 0; min-width: 0; }
  #top-settings-holder > .drawer > .drawer-toggle { width: 100%; min-width: 0; }
  #form_sheld { padding-inline: 6px; }
  #send_form { margin-bottom: 4px !important; border-radius: 13px !important; padding: 4px 6px !important; }
}

/* 尊重角色卡/正则内联状态栏预格式文本 */
.mes_text pre[style*="color:"]:not([style*="background"]) {
  padding: 0 !important;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  overflow: visible;
}
`;
}

export const COMPANION_THEMES = Object.freeze({
  night: Object.freeze({
    id: 'night',
    shortLabel: '静夜（深色微透玻璃）',
    theme: Object.freeze({
      name: COMPANION_THEME_NIGHT_NAME,
      blur_strength: 0,
      main_text_color: 'rgba(235, 237, 242, 1)',
      italics_text_color: 'rgba(176, 182, 194, 1)',
      underline_text_color: 'rgba(196, 201, 212, 0.92)',
      quote_text_color: 'rgba(218, 222, 230, 1)',
      blur_tint_color: 'rgba(22, 23, 28, 0.96)',
      chat_tint_color: 'rgba(15, 16, 19, 0.92)',
      user_mes_blur_tint_color: 'rgba(34, 36, 43, 0.86)',
      bot_mes_blur_tint_color: 'rgba(24, 25, 30, 0.82)',
      shadow_color: 'rgba(0, 0, 0, 0.28)',
      shadow_width: 0,
      border_color: 'rgba(255, 255, 255, 0.10)',
      font_scale: 1,
      fast_ui_mode: true,
      waifuMode: false,
      avatar_style: 0,
      chat_display: 0,
      toastr_position: 'toast-top-center',
      noShadows: true,
      chat_width: 100,
      timer_enabled: true,
      timestamps_enabled: false,
      timestamp_model_icon: false,
      mesIDDisplay_enabled: true,
      hideChatAvatars_enabled: false,
      message_token_count_enabled: true,
      expand_message_actions: false,
      enableZenSliders: false,
      enableLabMode: true,
      hotswap_enabled: false,
      bogus_folders: true,
      zoomed_avatar_magnification: '',
      reduced_motion: false,
      compact_input_area: true,
      show_swipe_num_all_messages: true,
      click_to_edit: false,
      media_display: 'list',
      custom_css: buildAppleOpticalGlassCss({
        name: COMPANION_THEME_NIGHT_NAME,
        scheme: 'dark',
        smartBody: 'rgba(235, 237, 242, 1)',
        smartEm: 'rgba(176, 182, 194, 1)',
        smartUnderline: 'rgba(196, 201, 212, 0.92)',
        smartQuote: 'rgba(218, 222, 230, 1)',
        smartBlurTint: 'rgba(22, 23, 28, 0.96)',
        smartChatTint: 'rgba(15, 16, 19, 0.92)',
        smartUserTint: 'rgba(34, 36, 43, 0.86)',
        smartBotTint: 'rgba(24, 25, 30, 0.82)',
        smartBorder: 'rgba(255, 255, 255, 0.10)',
        canvas: '#0f1013',
        glassBar: 'linear-gradient(180deg, rgba(28, 30, 36, 0.85) 0%, rgba(19, 20, 25, 0.90) 100%)',
        glassDrawer: 'linear-gradient(180deg, rgba(27, 29, 35, 0.95) 0%, rgba(19, 20, 25, 0.97) 100%)',
        glassCardBot: 'linear-gradient(180deg, rgba(26, 28, 34, 0.74) 0%, rgba(19, 20, 25, 0.80) 100%)',
        glassCardUser: 'linear-gradient(180deg, rgba(36, 39, 47, 0.78) 0%, rgba(27, 29, 36, 0.84) 100%)',
        glassRim: 'rgba(255, 255, 255, 0.08)',
        elevated: 'rgba(34, 36, 43, 0.9)',
        inset: 'rgba(255, 255, 255, 0.05)',
        ink: '#ebedf2',
        muted: '#989ca8',
        faint: '#6f7380',
        em: '#b0b6c2',
        quote: '#dadce4',
        line: 'rgba(255, 255, 255, 0.08)',
        lineStrong: 'rgba(255, 255, 255, 0.13)',
        accent: '#c4c9d4',
        accentSoft: 'rgba(196, 201, 212, 0.15)',
        cardShadow: '0 6px 22px rgba(0, 0, 0, 0.22)',
        popShadow: '0 16px 40px rgba(0, 0, 0, 0.42)',
      }),
    }),
  }),
  day: Object.freeze({
    id: 'day',
    shortLabel: '浅昼（浅色微透玻璃）',
    theme: Object.freeze({
      name: COMPANION_THEME_DAY_NAME,
      blur_strength: 0,
      main_text_color: 'rgba(28, 29, 32, 1)',
      italics_text_color: 'rgba(98, 102, 112, 1)',
      underline_text_color: 'rgba(84, 88, 98, 0.92)',
      quote_text_color: 'rgba(54, 58, 66, 1)',
      blur_tint_color: 'rgba(252, 252, 253, 0.96)',
      chat_tint_color: 'rgba(243, 244, 246, 0.95)',
      user_mes_blur_tint_color: 'rgba(246, 247, 249, 0.92)',
      bot_mes_blur_tint_color: 'rgba(255, 255, 255, 0.90)',
      shadow_color: 'rgba(0, 0, 0, 0.06)',
      shadow_width: 0,
      border_color: 'rgba(24, 25, 30, 0.10)',
      font_scale: 1,
      fast_ui_mode: true,
      waifuMode: false,
      avatar_style: 0,
      chat_display: 0,
      toastr_position: 'toast-top-center',
      noShadows: true,
      chat_width: 100,
      timer_enabled: true,
      timestamps_enabled: false,
      timestamp_model_icon: false,
      mesIDDisplay_enabled: true,
      hideChatAvatars_enabled: false,
      message_token_count_enabled: true,
      expand_message_actions: false,
      enableZenSliders: false,
      enableLabMode: true,
      hotswap_enabled: false,
      bogus_folders: true,
      zoomed_avatar_magnification: '',
      reduced_motion: false,
      compact_input_area: true,
      show_swipe_num_all_messages: true,
      click_to_edit: false,
      media_display: 'list',
      custom_css: buildAppleOpticalGlassCss({
        name: COMPANION_THEME_DAY_NAME,
        scheme: 'light',
        smartBody: 'rgba(28, 29, 32, 1)',
        smartEm: 'rgba(98, 102, 112, 1)',
        smartUnderline: 'rgba(84, 88, 98, 0.92)',
        smartQuote: 'rgba(54, 58, 66, 1)',
        smartBlurTint: 'rgba(252, 252, 253, 0.96)',
        smartChatTint: 'rgba(243, 244, 246, 0.95)',
        smartUserTint: 'rgba(246, 247, 249, 0.92)',
        smartBotTint: 'rgba(255, 255, 255, 0.90)',
        smartBorder: 'rgba(24, 25, 30, 0.10)',
        canvas: '#f2f3f6',
        glassBar: 'linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(248, 249, 251, 0.95) 100%)',
        glassDrawer: 'linear-gradient(180deg, rgba(255, 255, 255, 0.97) 0%, rgba(248, 249, 251, 0.98) 100%)',
        glassCardBot: 'linear-gradient(180deg, rgba(255, 255, 255, 0.88) 0%, rgba(252, 252, 254, 0.92) 100%)',
        glassCardUser: 'linear-gradient(180deg, rgba(244, 245, 248, 0.90) 0%, rgba(239, 241, 245, 0.94) 100%)',
        glassRim: 'rgba(255, 255, 255, 0.95)',
        elevated: 'rgba(255, 255, 255, 0.94)',
        inset: 'rgba(24, 25, 30, 0.045)',
        ink: '#1c1d20',
        muted: '#686c76',
        faint: '#8c909a',
        em: '#5d626e',
        quote: '#343842',
        line: 'rgba(24, 25, 30, 0.08)',
        lineStrong: 'rgba(24, 25, 30, 0.13)',
        accent: '#545862',
        accentSoft: 'rgba(84, 88, 98, 0.12)',
        cardShadow: '0 3px 14px rgba(15, 18, 24, 0.045)',
        popShadow: '0 14px 36px rgba(15, 18, 24, 0.12)',
      }),
    }),
  }),
});

export function getActiveHostThemeName({ getContext, doc = globalThis.document } = {}) {
  const ctx = getContext?.();
  const fromPu = String(ctx?.powerUserSettings?.theme || '').trim();
  if (fromPu) return fromPu;
  const sel = doc?.getElementById?.('themes');
  return String(sel?.value || '').trim();
}

export function applySmartThemeVarsImmediate(doc, themeObj) {
  const rootStyle = doc?.documentElement?.style;
  if (rootStyle) {
    const pairs = [
      ['--SmartThemeBodyColor', themeObj.main_text_color],
      ['--SmartThemeEmColor', themeObj.italics_text_color],
      ['--SmartThemeUnderlineColor', themeObj.underline_text_color],
      ['--SmartThemeQuoteColor', themeObj.quote_text_color],
      ['--SmartThemeBlurTintColor', themeObj.blur_tint_color],
      ['--SmartThemeChatTintColor', themeObj.chat_tint_color],
      ['--SmartThemeUserMesBlurTintColor', themeObj.user_mes_blur_tint_color],
      ['--SmartThemeBotMesBlurTintColor', themeObj.bot_mes_blur_tint_color],
      ['--SmartThemeShadowColor', themeObj.shadow_color],
      ['--SmartThemeBorderColor', themeObj.border_color],
      ['--sheldWidth', `${themeObj.chat_width || 100}vw`],
    ];
    for (const [cssVar, val] of pairs) {
      if (val) rootStyle.setProperty?.(cssVar, String(val));
    }
  }

  if (doc) {
    let customStyleEl = doc.getElementById?.('custom-style');
    if (!customStyleEl && doc.head && typeof doc.createElement === 'function') {
      customStyleEl = doc.createElement('style');
      customStyleEl.id = 'custom-style';
      doc.head.appendChild?.(customStyleEl);
    }
    if (customStyleEl) {
      customStyleEl.textContent = themeObj.custom_css || '';
    }
    const customCssBox = doc.getElementById?.('customCSS');
    if (customCssBox && 'value' in customCssBox) {
      customCssBox.value = themeObj.custom_css || '';
    }
  }
}

async function persistAndActivateHostTheme(
  themePayload,
  {
    getContext,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
    powerUserModule = null,
  } = {},
) {
  const ctx = getContext?.();

  if (typeof fetchImpl === 'function') {
    const base = doc?.baseURI || globalThis.location?.origin || 'http://localhost/';
    const headers = {
      'Content-Type': 'application/json',
      ...(typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {}),
    };
    const res = await fetchImpl(new URL('api/themes/save', base).href, {
      method: 'POST',
      headers,
      body: JSON.stringify(themePayload),
    });
    if (!res?.ok) {
      throw new Error(`保存主题失败 (HTTP ${res?.status || 0})`);
    }
  }

  const themeSelect = doc?.getElementById?.('themes');
  let existedInSelect = false;
  if (themeSelect) {
    const opts = themeSelect.options ? [...themeSelect.options] : [...(themeSelect.children || [])];
    let opt = opts.find(o => o.value === themePayload.name);
    if (opt) {
      existedInSelect = true;
    } else if (doc?.createElement) {
      opt = doc.createElement('option');
      opt.value = themePayload.name;
      opt.textContent = themePayload.name;
      themeSelect.appendChild?.(opt) || themeSelect.append?.(opt);
    }
    if (opt) opt.selected = true;
    themeSelect.value = themePayload.name;
  }

  if (!existedInSelect && typeof globalThis.File === 'function' && typeof globalThis.DataTransfer === 'function') {
    const importInput = doc?.getElementById?.('ui_preset_import_file');
    if (importInput && 'files' in importInput) {
      try {
        const dt = new globalThis.DataTransfer();
        dt.items.add(
          new globalThis.File([JSON.stringify(themePayload)], `${themePayload.name}.json`, {
            type: 'application/json',
          }),
        );
        importInput.files = dt.files;
        importInput.dispatchEvent?.(new globalThis.Event('change', { bubbles: true }));
      } catch {
        // ignore
      }
    }
  }

  if (ctx?.powerUserSettings && typeof ctx.powerUserSettings === 'object') {
    const { name, ...restFields } = themePayload;
    Object.assign(ctx.powerUserSettings, restFields, { theme: name });
  }

  try {
    const base = doc?.baseURI || globalThis.location?.origin || '';
    const puMod =
      powerUserModule ||
      (base ? await import(new URL('scripts/power-user.js', base).href) : null);
    if (puMod?.power_user && typeof puMod.power_user === 'object') {
      const { name, ...restFields } = themePayload;
      Object.assign(puMod.power_user, restFields, { theme: name });
    }
    if (typeof puMod?.applyPowerUserSettings === 'function') {
      puMod.applyPowerUserSettings();
    }
  } catch {
    // 忽略单测或离线导入异常
  }

  // 关键修复：power-user.js 的 applyPowerUserSettings() 调用无参 applyThemeColor() 不会覆盖 SmartTheme 变量，
  // 因此此处无条件强制同步全部 SmartTheme 变量、#custom-style 与窗口几何测量！
  applySmartThemeVarsImmediate(doc, themePayload);
  if (typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent?.(new globalThis.CustomEvent('resize'));
  }

  ctx?.saveSettingsDebounced?.();
  return themePayload.name;
}

/**
 * 将正版授权的《观月札记 V1.1.3》（作者：WWW · CC-BY-NC-SA-4.0）写入酒馆主题库并立即生效。
 * 支持 `auto`（跟随系统）/ `day`（浅昼日间）/ `night`（静夜夜间）三模式无缝秒切。
 */
export async function applyMoonNoteTheme(
  modeId = 'auto',
  {
    getContext,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
    powerUserModule = null,
    rawThemeData = null,
  } = {},
) {
  let baseTheme = rawThemeData || cachedMoonNoteBaseTheme;
  if (!baseTheme) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('当前环境无法读取内置《观月札记》主题资源');
    }
    const assetUrl = new URL('../../assets/themes/观月札记V1.1.3.json', import.meta.url).href;
    const res = await fetchImpl(assetUrl, { method: 'GET', cache: 'no-store' });
    if (!res?.ok) {
      throw new Error(`读取内置《观月札记》资源失败 (HTTP ${res?.status || 0})`);
    }
    baseTheme = await res.json();
    cachedMoonNoteBaseTheme = baseTheme;
  }

  const preferDark = Boolean(
    globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches,
  );
  const normalizedMode = modeId === 'day' ? 'day' : modeId === 'night' ? 'night' : 'auto';
  const themePayload = buildMoonNoteThemeVariant(baseTheme, normalizedMode, { preferDark });

  const appliedName = await persistAndActivateHostTheme(themePayload, {
    getContext,
    fetchImpl,
    doc,
    powerUserModule,
  });

  return {
    ok: true,
    name: appliedName,
    modeId: normalizedMode,
    author: MOON_NOTE_THEME_META.author,
    license: MOON_NOTE_THEME_META.license,
  };
}

/**
 * 将配套主题写入酒馆服务端 `api/themes/save` 并立即在当前会话全量生效（绝不遗留旧浅色变量）。
 */
export async function applyCompanionTheme(
  modeId = 'night',
  {
    getContext,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
    powerUserModule = null,
  } = {},
) {
  const entry = COMPANION_THEMES[modeId] || COMPANION_THEMES.night;
  const themePayload = { ...entry.theme };
  const appliedName = await persistAndActivateHostTheme(themePayload, {
    getContext,
    fetchImpl,
    doc,
    powerUserModule,
  });
  return { ok: true, name: appliedName, modeId: entry.id };
}

/**
 * 启动时若用户当前正启用伴侣主题（静夜/浅昼），静默热同步至当前版本最新样式表并校准 SmartTheme 变量。
 */
export function syncActiveCompanionThemeOnBoot({ getContext, doc = globalThis.document } = {}) {
  const activeName = getActiveHostThemeName({ getContext, doc });
  const matched =
    activeName === COMPANION_THEME_NIGHT_NAME
      ? COMPANION_THEMES.night
      : activeName === COMPANION_THEME_DAY_NAME
        ? COMPANION_THEMES.day
        : null;
  if (!matched) return false;
  applySmartThemeVarsImmediate(doc, matched.theme);
  const ctx = getContext?.();
  if (ctx?.powerUserSettings && typeof ctx.powerUserSettings === 'object') {
    const outdated = ctx.powerUserSettings.custom_css !== matched.theme.custom_css;
    if (outdated) {
      const { name, ...restFields } = matched.theme;
      Object.assign(ctx.powerUserSettings, restFields, { theme: name });
      ctx.saveSettingsDebounced?.();
    }
  }
  return true;
}

/**
 * 检查用户是否已拥有《砚台预设》（匹配“砚台预设”或“砚台V2”等）。
 */
export function findInstalledYantaiPresetName({ getContext, doc = globalThis.document } = {}) {
  const hostState = getHostPresetState({ getContext, doc });
  const names = hostState.presetNames || [];
  const exactV21 = names.find(n => /^砚台(?:预设)?[\s_·-]*v?2\.1$/i.test(String(n).trim()));
  if (exactV21) return exactV21;
  return names.find(n => /^砚台预设/i.test(String(n).trim())) || '';
}

/**
 * 导入或一键切换至内置《砚台预设 V2.1》（若已安装 v2.1 则直接切换不重复建副本）。
 */
export async function importOrActivateYantaiPreset({
  getContext,
  fetchImpl = globalThis.fetch,
  doc = globalThis.document,
  openAiModule = null,
  rawPresetContent = null,
} = {}) {
  const hostState = getHostPresetState({ getContext, doc });
  const existingV21 = (hostState.presetNames || []).find(n =>
    /^砚台(?:预设)?[\s_·-]*v?2\.1$/i.test(String(n).trim()),
  );
  if (existingV21) {
    await selectHostPresetByName(existingV21, { getContext, doc });
    return { ok: true, action: 'activated', name: existingV21 };
  }

  let content = rawPresetContent;
  if (!content) {
    const presetUrl = new URL('../../assets/presets/砚台预设_V2.1.json', import.meta.url).href;
    const res = await fetchImpl(presetUrl, { method: 'GET', cache: 'no-store' });
    if (!res?.ok) {
      throw new Error(`读取内置《砚台预设 V2.1》资源失败 (HTTP ${res?.status || 0})`);
    }
    content = await res.text();
  }

  const importedRes = await importPresetItems(
    [{ name: '砚台预设 V2.1.json', content }],
    {
      getContext,
      openAiModule,
      fetchImpl,
      doc,
      selectFirstImported: true,
    },
  );

  if (importedRes.imported.length === 0) {
    const reason = importedRes.failed[0]?.error || '预设写入未成功';
    throw new Error(reason);
  }

  return { ok: true, action: 'imported', name: importedRes.imported[0] };
}
