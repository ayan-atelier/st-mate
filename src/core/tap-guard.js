/**
 * ST伴侣 (st-mate) · 轻触正文「全屏纯享阅读」手势与交互节点防误触过滤器
 * 纯函数设计，零全局耦合，支持离线单元测试。
 */

export const INTERACTIVE_ANCESTOR_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'summary',
  'details > summary',
  'iframe',
  'video',
  'audio',
  'canvas',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="slider"]',
  '.mes_buttons',
  '.mes_edit_buttons',
  '.swipe_left',
  '.swipe_right',
  '.swipes-counter',
  '.code-copy',
  '.mes_reasoning_header',
  '.yte-bar',
  '.yte-chip',
  '.jd-bookshelf',
  '.welcomePanel',
  '.stm-topbar',
  '.stm-dialog',
  '.stm-popover',
  '.stm-reader-dock',
  '.stm-api-dock',
  '.stm-preset-dock',
  '.stm-char-world-dock',
  '.stm-portrait-lightbox',
  '.stm-crop-dialog',
  '.stm-pure-aa-pill',
  '.stm-float-capsule',
  '.stm-float-popover',
  '.stm-floor-bar',
  '.stm-floor-edit-bar',
  '.stm-floor-menu',
  '[data-sttts-action]',
  '[data-sttts-tools]',
  '[data-sttts-pic-action]',
  '.sttts-pic',
  '.sttts-pic-zoom',
  '.sttts-context-menu',
  '[data-bbi-slot]',
  '.bbi-slot',
  '.bbi-tag-action',
  '[data-rabbit-mirror-external-shell]',
  '[data-rabbit-mirror-independent-inline-anchor]',
  '[data-rabbit-mirror-follow-external-anchor]',
  '.rabbit-mirror-external-shell',
  '[data-rm-tool-menu]',
  '.st-esg-message-floor-panel',
  '.st-esg-floor-compact',
  '#top-bar',
  '#top-settings-holder',
  '.drawer-content',
  '#form_sheld',
  '#options',
  '#extensionsMenu',
].join(', ');

export const MAX_TAP_MOVE_PX = 8;
export const MAX_TAP_DURATION_MS = 450;

/**
 * 判断一次在聊天区域内的点击是否应当触发「顶栏+底栏同步显隐（纯享阅读）」：
 * 1. 配置必须开启，且当前顶栏模式满足生效范围；
 * 2. 不能有正在选中的文字（避免划词复制被误判）；
 * 3. 手指/鼠标位移必须小于 8px、按压时长不超过 450ms（过滤上下滚动与长按菜单）；
 * 4. 点击目标必须在 #chat 内，且不能命中任何按钮、折叠框、输入框、翻页键或 iframe 美化卡片。
 */
export function shouldTogglePureReading({
  settings,
  isHomeView = false,
  target,
  chatRoot,
  gesture = {},
  selectionText = '',
}) {
  if (!settings?.shellEnabled || !settings?.tapPureReading) return false;
  if (isHomeView) return false;
  if (settings.tapPureReadingScope === 'reading' && settings.topbarMode !== 'reading') {
    return false;
  }

  if (typeof selectionText === 'string' && selectionText.trim().length > 0) {
    return false;
  }

  const button = gesture.button ?? 0;
  if (button !== 0) return false;

  const dx = Number(gesture.dx ?? 0);
  const dy = Number(gesture.dy ?? 0);
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance >= MAX_TAP_MOVE_PX) return false;

  const duration = Number(gesture.durationMs ?? 0);
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_TAP_DURATION_MS) {
    return false;
  }

  if (!chatRoot || !target) return false;
  if (typeof chatRoot.contains === 'function' && !chatRoot.contains(target)) {
    return false;
  }

  const element = typeof target.closest === 'function' ? target : target.parentElement;
  if (!element || typeof element.closest !== 'function') return false;

  if (element.closest(INTERACTIVE_ANCESTOR_SELECTOR)) {
    return false;
  }

  // Shadow DOM 宿主（如柏宝绘楼层卡片等嵌入式微前端）：事件重靶到 light DOM 宿主 div，统一放行防误触全屏
  for (let cur = element; cur && cur !== chatRoot; cur = cur.parentElement) {
    if (cur.shadowRoot) {
      return false;
    }
  }

  return true;
}
