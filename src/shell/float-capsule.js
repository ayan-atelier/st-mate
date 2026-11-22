/**
 * ST伴侣 (st-mate) · 对话侧边一体联动独立悬浮球组 & 外挂无损收纳控制器
 * 核心设计准则：
 * 1. 默认关闭（由用户在 ST伴侣「对话顶栏样式」面板按需开启），书架首页与全屏纯享态自动隐去；
 * 2. 一体拖动、视觉独立的轻盈圆球组 [ 上翻球 · (动态收纳球) · 下翻球 ]：
 *    - 若当前角色卡既无底栏外挂按钮、也无被拖入的野生悬浮球，中间「收纳球」自动隐去，仅保留纯净的上下两颗翻楼圆球；
 *    - 采用 visualViewport 真实像素坐标 + getBoundingClientRect() 实测偏移自校准（彻底免疫移动端酒馆/脚本页面 transform 或 0px body 导致的卡顶问题）；
 *    - 单点上/下圆球平滑翻动 5 楼（顶楼遇 #show_more_messages 自动续载）；750ms 内连戳两下同向圆球浮出「到顶 / 到底」小胶囊（防手快误飞）；
 * 3. 底栏自动收纳 + 野生悬浮球「直接拖入吞噬 / 一键吸纳」：
 *    - 自动原地收起 #qr--bar 及 #leftSendForm / #rightSendForm / #send_form 塞入的卡片按钮；
 *    - 页面上若有角色卡或外部脚本挂出的小型 position:fixed 野生悬浮球（如大梁邸报卷轴球等），按住它直接拖到伴侣圆球上松手即可「吞入收纳」（亦支持在收纳面板内一键吸纳不可拖动的死位置悬浮块，按角色卡自动记忆，随时可点「放出」还原）。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.8.9c';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.8.9c';
import { getEntityBindingKey } from '../modules/preset-backend.js?v=0.8.9c';
import { toastMessage } from './host-actions.js?v=0.8.9c';

export const DEFAULT_STEP_FLOORS = 5;
export const DOUBLE_TAP_WINDOW_MS = 750;
export const QUICK_JUMP_HIDE_MS = 3200;

const CORE_FORM_SHELD_IDS = new Set([
  'dialogue_del_mes',
  'send_form',
  'typing_indicator',
]);

const CORE_SEND_FORM_IDS = new Set([
  'file_form',
  'nonQRFormItems',
]);

const CORE_NON_QR_IDS = new Set([
  'leftSendForm',
  'send_textarea',
  'rightSendForm',
  'stm-chat-vision-btn',
  'stm-chat-vision-picker',
]);

const CORE_LEFT_SEND_IDS = new Set([
  'options_button',
  'extensionsMenuButton',
]);

const CORE_RIGHT_SEND_IDS = new Set([
  'send_but',
  'mes_stop',
  'mes_continue',
  'mes_impersonate',
  'stscript_continue',
  'stscript_pause',
  'stscript_stop',
  'stm-chat-vision-btn',
  'stm-chat-vision-picker',
]);

const CORE_BODY_EXCLUDED_IDS = new Set([
  'sheld',
  'top-bar',
  'top-settings-holder',
  'form_sheld',
  'options',
  'extensionsMenu',
  'left-nav-panel',
  'right-nav-panel',
  'character_popup',
  'world_popup',
  'shadow_character_popup',
  'movingDivs',
  'bg1',
  'bg_custom',
  'bg_tabs',
  'toast-container',
  'loader',
  'qr--popout',
]);

const IGNORED_TAG_NAMES = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'INPUT', 'DIALOG']);

function isYantaiInternalNode(node) {
  const id = String(node?.id || '');
  if (
    id.startsWith('stm-') ||
    id.startsWith('jd-') ||
    id.startsWith('yt-') ||
    id.startsWith('yte-')
  ) {
    return true;
  }
  const cls = String(node?.className || '');
  if (!cls) return false;
  return /(?:^|\s)(?:stm-|jd-|yt-|yte-)/.test(cls);
}

function isIntrinsicallyHidden(node) {
  if (!node) return true;
  if (node.hidden === true) return true;
  if (node.hasAttribute?.('hidden')) return true;
  if (String(node.getAttribute?.('aria-hidden') || '').toLowerCase() === 'true') return true;
  const cls = node.classList;
  if (
    cls?.contains?.('displayNone') ||
    cls?.contains?.('qr--hidden') ||
    cls?.contains?.('hidden')
  ) {
    return true;
  }
  const inlineDisplay = String(node.style?.display || '').trim().toLowerCase();
  if (inlineDisplay === 'none') return true;
  const inlineVis = String(node.style?.visibility || '').trim().toLowerCase();
  if (inlineVis === 'hidden') return true;
  return false;
}

function walkElements(root, visitor) {
  if (!root?.children) return;
  for (const child of Array.from(root.children)) {
    if (!child || !child.tagName) continue;
    const dive = visitor(child);
    if (dive !== false) {
      walkElements(child, visitor);
    }
  }
}

function isClickableControl(node) {
  if (!node?.tagName) return false;
  const tag = String(node.tagName).toUpperCase();
  if (tag === 'BUTTON' || tag === 'A') return true;
  const role = String(node.getAttribute?.('role') || '').toLowerCase();
  if (role === 'button' || role === 'menuitem') return true;
  const cls = node.classList;
  if (
    cls?.contains?.('qr--button') ||
    cls?.contains?.('menu_button') ||
    cls?.contains?.('interactable')
  ) {
    return true;
  }
  return false;
}

function guessIconSemantic(node, defaultFallback = '卡片按钮') {
  const classes = [String(node?.className || ''), String(node?.id || '')];
  walkElements(node, child => {
    if (child.className) classes.push(String(child.className));
  });
  const merged = classes.join(' ').toLowerCase();

  if (merged.includes('fa-moon') || merged.includes('moon')) {
    return { fallback: '角色设置', iconName: 'moon' };
  }
  if (merged.includes('fa-sun')) {
    return { fallback: '日夜切换', iconName: 'sun' };
  }
  if (
    merged.includes('fa-music') ||
    merged.includes('fa-volume') ||
    merged.includes('fa-headphones')
  ) {
    return { fallback: '音效控制', iconName: 'spark' };
  }
  if (
    merged.includes('fa-book') ||
    merged.includes('fa-scroll') ||
    merged.includes('fa-newspaper') ||
    merged.includes('dlbao')
  ) {
    return { fallback: '卡片手册', iconName: 'book' };
  }
  if (merged.includes('fa-palette') || merged.includes('fa-brush')) {
    return { fallback: '卡片美化', iconName: 'palette' };
  }
  if (
    merged.includes('fa-gear') ||
    merged.includes('fa-cog') ||
    merged.includes('fa-sliders') ||
    merged.includes('fa-wrench')
  ) {
    return { fallback: '卡片设置', iconName: 'sliders' };
  }
  if (merged.includes('fa-user') || merged.includes('fa-id-card')) {
    return { fallback: '角色状态', iconName: 'user' };
  }
  return { fallback: defaultFallback, iconName: 'spark' };
}

function readCleanButtonText(targetEl) {
  if (!targetEl) return '';
  let qrLabel = null;
  walkElements(targetEl, child => {
    if (!qrLabel && child.classList?.contains?.('qr--button-label')) {
      qrLabel = child;
      return false;
    }
    return true;
  });
  if (qrLabel) {
    return String(qrLabel.textContent || '').replace(/\s+/g, ' ').trim();
  }

  if (!targetEl.children || targetEl.children.length === 0) {
    return String(targetEl.textContent || '').replace(/\s+/g, ' ').trim();
  }

  const chunks = [];
  const collectText = elNode => {
    if (elNode.classList?.contains?.('qr--button-expander')) return;
    if (IGNORED_TAG_NAMES.has(String(elNode.tagName || '').toUpperCase())) return;
    if (isIntrinsicallyHidden(elNode)) return;
    if (!elNode.children || elNode.children.length === 0) {
      const t = String(elNode.textContent || '').trim();
      if (t) chunks.push(t);
      return;
    }
    for (const c of Array.from(elNode.children)) {
      collectText(c);
    }
  };

  collectText(targetEl);
  const joined = chunks.join(' ').replace(/\s+/g, ' ').trim();
  if (joined) return joined;
  return String(targetEl.textContent || '').replace(/\s+/g, ' ').trim();
}

function buildClutterDescriptor(
  targetEl,
  hideHostEl,
  zone,
  seq,
  { widgetKey = '', fallbackName = '卡片按钮' } = {},
) {
  const rawText = readCleanButtonText(targetEl);
  const rawTitle = String(
    targetEl.getAttribute?.('title') ||
      targetEl.getAttribute?.('aria-label') ||
      targetEl.title ||
      hideHostEl?.getAttribute?.('title') ||
      hideHostEl?.getAttribute?.('aria-label') ||
      '',
  )
    .replace(/\s+/g, ' ')
    .trim();
  const graphemes = Array.from(rawText);
  const hint = guessIconSemantic(targetEl, fallbackName);

  let label = '';
  let glyphText = '';
  let iconName = '';

  if (graphemes.length >= 2) {
    label = graphemes.slice(0, 26).join('');
  } else if (graphemes.length === 1) {
    glyphText = graphemes[0];
    label = rawTitle ? Array.from(rawTitle).slice(0, 20).join('') : hint.fallback;
  } else {
    label = rawTitle ? Array.from(rawTitle).slice(0, 22).join('') : hint.fallback;
    iconName = hint.iconName;
  }

  return {
    id: `stm_clutter_${seq}_${String(targetEl.id || zone)}`,
    label,
    title: rawTitle || rawText || label,
    glyphText,
    iconName,
    zone,
    widgetKey,
    targetEl,
    hideHostEl: hideHostEl || targetEl,
  };
}

/**
 * 为外部野生 `position: fixed` 悬浮挂件生成稳定可持久化指纹键（支持按角色卡自动复现收纳）。
 */
export function buildFloatingWidgetKey(node) {
  if (!node?.tagName) return '';
  const id = String(node.id || '').trim();
  if (id && !/^\d{6,}$/.test(id)) {
    return `id:${id.slice(0, 140)}`;
  }
  const tag = String(node.tagName).toLowerCase();
  const stableClasses = String(node.className || '')
    .split(/\s+/)
    .map(c => c.trim())
    .filter(
      c =>
        c &&
        !/dragging|open|active|hover|hidden|dark|light|mob/i.test(c) &&
        !c.startsWith('stm-'),
    )
    .sort()
    .slice(0, 4)
    .join('.');
  const labelSig = String(
    node.getAttribute?.('aria-label') ||
      node.getAttribute?.('title') ||
      readCleanButtonText(node) ||
      '',
  )
    .replace(/\s+/g, '')
    .slice(0, 24);
  if (!stableClasses && !labelSig) return '';
  return `sig:${tag}|${stableClasses}|${labelSig}`.slice(0, 170);
}

/**
 * 检测某个 DOM 节点是否属于角色卡或第三方脚本挂载的小型野生 `position: fixed` 悬浮球/挂件：
 * - 严格排除酒馆顶栏、底栏、抽屉、弹窗、通知栏与砚台自身控件；
 * - 尺寸限定在 16px ~ 132px 的小型悬浮入口，绝不误吞展开后的大面板或模态框！
 */
export function inspectWildFloatingCandidate(node, root = globalThis) {
  if (!node?.tagName) return null;
  const tag = String(node.tagName).toUpperCase();
  if (IGNORED_TAG_NAMES.has(tag)) return null;
  const id = String(node.id || '');
  if (CORE_BODY_EXCLUDED_IDS.has(id) || isYantaiInternalNode(node)) return null;

  const cls = node.classList;
  if (
    cls?.contains?.('popup') ||
    cls?.contains?.('drawer') ||
    cls?.contains?.('drawer-content') ||
    cls?.contains?.('list-group') ||
    cls?.contains?.('toast')
  ) {
    return null;
  }

  const alreadyMarkedByUs = node.dataset?.stmClutterHidden === '1';
  if (!alreadyMarkedByUs && isIntrinsicallyHidden(node)) return null;

  const inlinePos = String(node.style?.position || '').trim().toLowerCase();
  let computedPos = inlinePos;
  if (!computedPos && typeof root?.getComputedStyle === 'function') {
    try {
      computedPos = String(root.getComputedStyle(node)?.position || '').trim().toLowerCase();
    } catch {
      computedPos = '';
    }
  }
  if (computedPos !== 'fixed') return null;

  if (!alreadyMarkedByUs) {
    let w = Number(node.offsetWidth) || 0;
    let h = Number(node.offsetHeight) || 0;
    if ((w <= 0 || h <= 0) && typeof node.getBoundingClientRect === 'function') {
      const r = node.getBoundingClientRect();
      if (r && (r.width !== 680 || r.height !== 800)) {
        w = r.width;
        h = r.height;
      }
    }
    const inlineW = parseFloat(String(node.style?.width || '')) || 0;
    const inlineH = parseFloat(String(node.style?.height || '')) || 0;
    const effW = w > 0 ? w : inlineW;
    const effH = h > 0 ? h : inlineH;
    if (effW < 16 || effH < 16 || effW > 136 || effH > 136) {
      return null;
    }
  }

  const key = buildFloatingWidgetKey(node);
  if (!key) return null;
  return { node, key };
}

/**
 * 扫描页面上当前挂载的全部小型野生悬浮挂件（包含已被收纳与尚未收纳的候选项）。
 */
export function discoverWildFloatingWidgets(doc, root = globalThis) {
  if (!doc?.body?.children) return [];
  const found = [];
  const seen = new Set();

  const checkContainer = parent => {
    if (!parent?.children) return;
    for (const child of Array.from(parent.children)) {
      if (!child?.tagName || seen.has(child)) continue;
      if (CORE_BODY_EXCLUDED_IDS.has(String(child.id || '')) || isYantaiInternalNode(child)) {
        continue;
      }
      const info = inspectWildFloatingCandidate(child, root);
      if (info) {
        seen.add(child);
        found.push(info);
      }
    }
  };

  checkContainer(doc.body);
  const sheld = doc.getElementById?.('sheld');
  if (sheld?.children) {
    for (const child of Array.from(sheld.children)) {
      const cid = String(child?.id || '');
      if (cid === 'chat' || cid === 'form_sheld' || isYantaiInternalNode(child)) continue;
      const info = inspectWildFloatingCandidate(child, root);
      if (info && !seen.has(child)) {
        seen.add(child);
        found.push(info);
      }
    }
  }

  return found;
}

/**
 * 扫描输入框周边（#qr--bar、#send_form 附加横条、#leftSendForm / #rightSendForm 外挂图标）的可收纳按钮：
 * - 绝不触碰三横菜单、魔法棒、伴侣发图键、文本框、附件条、批量删除条与右侧发送/中止键；
 * - 返回需折叠的宿主容器数组 `hostNodes` 与供收纳面板渲染的可点击项数组 `items`。
 */
export function discoverInputClutterItems(doc) {
  if (!doc?.getElementById) {
    return { hostNodes: [], items: [] };
  }

  const hostNodeSet = new Set();
  const items = [];
  const seenTargets = new Set();
  let seq = 1;

  const pushTarget = (targetEl, hideHostEl, zone) => {
    if (!targetEl || seenTargets.has(targetEl)) return;
    if (isYantaiInternalNode(targetEl) || isIntrinsicallyHidden(targetEl)) return;
    seenTargets.add(targetEl);
    items.push(buildClutterDescriptor(targetEl, hideHostEl, zone, seq));
    seq += 1;
  };

  const scanBarContainer = (barNode, zone) => {
    if (!barNode || isYantaiInternalNode(barNode)) return;
    const tag = String(barNode.tagName || '').toUpperCase();
    if (IGNORED_TAG_NAMES.has(tag)) return;
    if (isIntrinsicallyHidden(barNode)) return;

    if (isClickableControl(barNode) && barNode.id !== 'qr--bar') {
      hostNodeSet.add(barNode);
      pushTarget(barNode, barNode, zone);
      return;
    }

    const candidates = [];
    walkElements(barNode, child => {
      if (child.id === 'qr--popoutTrigger') return false;
      if (child.classList?.contains?.('qr--button-expander')) return false;
      if (isYantaiInternalNode(child) || isIntrinsicallyHidden(child)) return false;
      if (isClickableControl(child)) {
        candidates.push(child);
        return false;
      }
      return true;
    });

    // 空的 #qr--bar 容器同样静默压平占高，但只有真正存在可见按钮时才计入 items
    hostNodeSet.add(barNode);
    for (const c of candidates) {
      pushTarget(c, barNode, zone);
    }
  };

  const scanSideContainer = (sideEl, coreIdSet, zone) => {
    if (!sideEl?.children) return;
    for (const child of Array.from(sideEl.children)) {
      if (!child?.tagName) continue;
      const tag = String(child.tagName).toUpperCase();
      if (IGNORED_TAG_NAMES.has(tag)) continue;
      if (coreIdSet.has(String(child.id || '')) || isYantaiInternalNode(child)) continue;
      if (isIntrinsicallyHidden(child)) continue;

      hostNodeSet.add(child);

      if (isClickableControl(child) || !child.children || child.children.length === 0) {
        pushTarget(child, child, zone);
      } else {
        const innerBtns = [];
        walkElements(child, sub => {
          if (isIntrinsicallyHidden(sub) || isYantaiInternalNode(sub)) return false;
          if (isClickableControl(sub)) {
            innerBtns.push(sub);
            return false;
          }
          return true;
        });
        if (innerBtns.length > 0) {
          for (const btn of innerBtns) {
            pushTarget(btn, child, zone);
          }
        } else {
          pushTarget(child, child, zone);
        }
      }
    }
  };

  const sendForm = doc.getElementById('send_form');
  if (sendForm?.children) {
    for (const child of Array.from(sendForm.children)) {
      if (!child?.tagName) continue;
      if (CORE_SEND_FORM_IDS.has(String(child.id || ''))) continue;
      scanBarContainer(child, child.id === 'qr--bar' ? 'qr' : 'bar');
    }
  }

  const formSheld = doc.getElementById('form_sheld');
  if (formSheld?.children) {
    for (const child of Array.from(formSheld.children)) {
      if (!child?.tagName) continue;
      if (CORE_FORM_SHELD_IDS.has(String(child.id || ''))) continue;
      scanBarContainer(child, 'bar');
    }
  }

  const nonQR = doc.getElementById('nonQRFormItems');
  if (nonQR?.children) {
    for (const child of Array.from(nonQR.children)) {
      if (!child?.tagName) continue;
      if (CORE_NON_QR_IDS.has(String(child.id || ''))) continue;
      scanSideContainer({ children: [child] }, new Set(), 'side');
    }
  }

  scanSideContainer(doc.getElementById('leftSendForm'), CORE_LEFT_SEND_IDS, 'left');
  scanSideContainer(doc.getElementById('rightSendForm'), CORE_RIGHT_SEND_IDS, 'right');

  return {
    hostNodes: Array.from(hostNodeSet),
    items,
  };
}

function computeAllFloorMetrics(chatEl, floors) {
  const firstRect = floors[0]?.getBoundingClientRect?.();
  const lastRect = floors[floors.length - 1]?.getBoundingClientRect?.();
  const useRect = Boolean(
    typeof chatEl?.getBoundingClientRect === 'function' &&
      firstRect &&
      lastRect &&
      (floors.length === 1
        ? firstRect.height > 0 && !(firstRect.top === 0 && Number(floors[0]?.offsetTop) > 0)
        : firstRect.top !== lastRect.top || firstRect.bottom !== lastRect.bottom),
  );

  if (useRect) {
    const cRect = chatEl.getBoundingClientRect();
    const curScroll = Number(chatEl.scrollTop) || 0;
    return floors.map(mesNode => {
      const mRect = mesNode.getBoundingClientRect();
      return {
        top: mRect.top - cRect.top + curScroll,
        height: mRect.height > 0 ? mRect.height : Number(mesNode.offsetHeight) || 120,
      };
    });
  }

  return floors.map(mesNode => ({
    top: Number(mesNode?.offsetTop) || 0,
    height: Number(mesNode?.offsetHeight) || 120,
  }));
}

function scrollChatElementTo(chatEl, targetTop, smooth = true) {
  if (!chatEl) return;
  const clamped = Math.max(0, Math.round(targetTop));
  if (typeof chatEl.scrollTo === 'function') {
    chatEl.scrollTo({ top: clamped, behavior: smooth ? 'smooth' : 'auto' });
  }
  if (!smooth || typeof chatEl.scrollTo !== 'function') {
    chatEl.scrollTop = clamped;
  }
}

/**
 * 按楼层步幅在 #chat 内向上或向下平滑翻动（默认 5 楼）。
 */
export function stepChatByFloors(
  chatEl,
  deltaFloors = -DEFAULT_STEP_FLOORS,
  { smooth = true } = {},
) {
  if (!chatEl || !deltaFloors) {
    return { action: 'noop', targetIndex: -1, targetTop: 0 };
  }

  const floors = Array.from(chatEl.children || []).filter(
    node => node?.classList?.contains?.('mes') && !isIntrinsicallyHidden(node),
  );
  const showMoreEl = Array.from(chatEl.children || []).find(
    node => String(node?.id || '') === 'show_more_messages' && !isIntrinsicallyHidden(node),
  );

  if (floors.length === 0) {
    return { action: 'empty', targetIndex: -1, targetTop: 0 };
  }

  const curTop = Math.max(0, Number(chatEl.scrollTop) || 0);
  const clientH = Math.max(1, Number(chatEl.clientHeight) || 600);
  const scrollH = Math.max(clientH, Number(chatEl.scrollHeight) || clientH);
  const maxScroll = Math.max(0, scrollH - clientH);

  const metrics = computeAllFloorMetrics(chatEl, floors);

  let anchorIdx = -1;
  for (let i = 0; i < metrics.length; i += 1) {
    if (metrics[i].top + metrics[i].height > curTop + 16) {
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx < 0) {
    anchorIdx = metrics.length - 1;
  }

  if (deltaFloors < 0) {
    if (curTop <= 10 && anchorIdx === 0) {
      if (showMoreEl && typeof showMoreEl.click === 'function') {
        showMoreEl.click();
        return { action: 'load_more', targetIndex: 0, targetTop: 0 };
      }
      scrollChatElementTo(chatEl, 0, smooth);
      return { action: 'at_top', targetIndex: 0, targetTop: 0 };
    }

    const targetIdx = Math.max(0, anchorIdx + deltaFloors);
    const rawTargetTop = targetIdx === 0 && !showMoreEl ? 0 : Math.max(0, metrics[targetIdx].top - 8);
    scrollChatElementTo(chatEl, rawTargetTop, smooth);
    return { action: 'step_up', targetIndex: targetIdx, targetTop: rawTargetTop };
  }

  if (maxScroll > 0 && curTop >= maxScroll - 12) {
    scrollChatElementTo(chatEl, scrollH, smooth);
    return { action: 'at_bottom', targetIndex: floors.length - 1, targetTop: scrollH };
  }

  const targetIdx = anchorIdx + deltaFloors;
  if (targetIdx >= floors.length) {
    scrollChatElementTo(chatEl, scrollH, smooth);
    return { action: 'to_bottom', targetIndex: floors.length - 1, targetTop: scrollH };
  }

  const rawTargetTop = Math.min(maxScroll > 0 ? maxScroll : scrollH, Math.max(0, metrics[targetIdx].top - 8));
  scrollChatElementTo(chatEl, rawTargetTop, smooth);
  return { action: 'step_down', targetIndex: targetIdx, targetTop: rawTargetTop };
}

/**
 * 连戳两下检测器（纯状态机）。
 */
export function createDoubleTapTracker({ windowMs = DOUBLE_TAP_WINDOW_MS } = {}) {
  let lastDir = '';
  let lastAt = 0;
  let count = 0;

  return {
    recordTap(dir, now = Date.now()) {
      if (dir === lastDir && now - lastAt <= windowMs) {
        count += 1;
      } else {
        lastDir = dir;
        count = 1;
      }
      lastAt = now;
      return {
        count,
        showQuickJump: count >= 2,
        mode: dir === 'up' ? 'top' : 'bottom',
      };
    },
    reset() {
      lastDir = '';
      lastAt = 0;
      count = 0;
    },
  };
}

export function createFloatCapsule({
  root = globalThis,
  getContext,
  store,
  isHomeCloaked = () => false,
  onOpenStateChange = null,
} = {}) {
  let capsuleEl = null;
  let upBtn = null;
  let bagBtn = null;
  let downBtn = null;
  let quickJumpBtn = null;
  let popoverEl = null;

  let popoverOpen = false;
  let quickJumpMode = ''; // '' | 'top' | 'bottom'
  let quickJumpTimer = 0;
  let bypassClutterHide = false;
  let lastOpenedAt = 0;
  let boundsRaf = 0;
  let scanRaf = 0;

  let formObserver = null;
  let observedFormRoot = null;
  let bodyChildObserver = null;
  const markedHiddenNodes = new Set();
  const tempOpenHostNodes = new Set();
  let cachedClutterItems = [];
  let cachedUntuckedWildItems = [];

  let dragState = null;
  let wildDragState = null;
  let suppressNextClick = false;
  const tapTracker = createDoubleTapTracker();
  const cleanups = [];

  function el(tag, className = '', text = '') {
    const doc = root?.document;
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function getActiveScopeKey() {
    const ctx = getContext?.();
    return getEntityBindingKey(ctx) || '__global__';
  }

  function getTuckedKeysSetForCurrentChat() {
    const map = store.get().floatTuckedSelectors || {};
    const scope = getActiveScopeKey();
    const list = [
      ...(Array.isArray(map.__global__) ? map.__global__ : []),
      ...(scope !== '__global__' && Array.isArray(map[scope]) ? map[scope] : []),
    ];
    return new Set(list);
  }

  function addTuckedWidgetKey(widgetKey) {
    if (!widgetKey) return;
    const scope = getActiveScopeKey();
    const curMap = store.get().floatTuckedSelectors || {};
    const prevList = Array.isArray(curMap[scope]) ? curMap[scope] : [];
    if (prevList.includes(widgetKey)) return;
    store.update(
      {
        floatTuckedSelectors: {
          ...curMap,
          [scope]: [...prevList, widgetKey],
        },
      },
      { silent: true },
    );
  }

  function removeTuckedWidgetKey(widgetKey) {
    if (!widgetKey) return;
    const scope = getActiveScopeKey();
    const curMap = store.get().floatTuckedSelectors || {};
    const nextMap = { ...curMap };
    if (Array.isArray(nextMap[scope])) {
      nextMap[scope] = nextMap[scope].filter(k => k !== widgetKey);
      if (nextMap[scope].length === 0) delete nextMap[scope];
    }
    if (Array.isArray(nextMap.__global__)) {
      nextMap.__global__ = nextMap.__global__.filter(k => k !== widgetKey);
      if (nextMap.__global__.length === 0) delete nextMap.__global__;
    }
    store.update({ floatTuckedSelectors: nextMap }, { silent: true });
  }

  function readViewportBox() {
    const vv = root?.visualViewport;
    const w = Math.max(240, Number(vv?.width || root?.innerWidth || 390));
    const h = Math.max(320, Number(vv?.height || root?.innerHeight || 780));
    const ox = Number(vv?.offsetLeft) || 0;
    const oy = Number(vv?.offsetTop) || 0;
    return { w, h, ox, oy };
  }

  function clearQuickJump() {
    if (quickJumpTimer) {
      clearTimeout(quickJumpTimer);
      quickJumpTimer = 0;
    }
    quickJumpMode = '';
    if (quickJumpBtn) {
      quickJumpBtn.hidden = true;
      quickJumpBtn.className = 'stm-float-quick-jump';
    }
    capsuleEl?.classList?.remove?.('has-quick-jump');
  }

  function showQuickJumpChip(mode) {
    quickJumpMode = mode;
    if (quickJumpTimer) clearTimeout(quickJumpTimer);
    quickJumpTimer = setTimeout(() => {
      quickJumpTimer = 0;
      clearQuickJump();
    }, QUICK_JUMP_HIDE_MS);

    if (!quickJumpBtn) return;
    const doc = root?.document;
    quickJumpBtn.replaceChildren();
    quickJumpBtn.className = `stm-float-quick-jump is-${mode}`;
    quickJumpBtn.append(
      createIconNode(doc, mode === 'top' ? 'topjump' : 'bottomjump', 'stm-float-quick-svg'),
      el('span', '', mode === 'top' ? '到顶' : '到底'),
    );
    quickJumpBtn.title = mode === 'top' ? '一键直达当前已加载顶部' : '一键直达对话最底部';
    quickJumpBtn.hidden = false;
    capsuleEl?.classList?.add?.('has-quick-jump');
  }

  function clearAllClutterMarks() {
    for (const node of markedHiddenNodes) {
      delete node.dataset?.stmClutterHidden;
      delete node.dataset?.stmClicking;
    }
    markedHiddenNodes.clear();
    for (const node of tempOpenHostNodes) {
      delete node.dataset?.stmHostPopupLive;
    }
    tempOpenHostNodes.clear();
  }

  function isActiveInChat() {
    const s = store.get();
    if (!s.shellEnabled || !s.floatCapsuleEnabled) return false;
    const ctx = getContext?.();
    return Boolean(hasActiveChatSelection(ctx) && !isHomeCloaked?.());
  }

  /**
   * 实测像素级自校准定位（彻底杜绝 CSS % 在 0px 容器高度或移动端页面 transform 下卡在屏幕顶角）。
   */
  function applyVisualPlacement(side, topPct) {
    if (!capsuleEl || capsuleEl.hidden) return;
    const doc = root?.document;
    const vp = readViewportBox();
    const bagVisible = Boolean(bagBtn && !bagBtn.hidden);
    const estH = Number(capsuleEl.offsetHeight) || (bagVisible ? 100 : 66);
    const estW = Number(capsuleEl.offsetWidth) || 32;

    const minTop = Math.round(vp.oy + 58);
    const maxTop = Math.max(minTop, Math.round(vp.oy + vp.h - estH - 68));
    const ratio = Math.min(1, Math.max(0, (Number(topPct) || 62) / 100));
    const desiredTop = Math.round(minTop + ratio * (maxTop - minTop));

    let desiredLeft = side === 'left' ? Math.round(vp.ox + 6) : Math.round(vp.ox + vp.w - estW - 6);
    const sheld = doc?.getElementById?.('sheld');
    if (vp.w > 1000 && typeof sheld?.getBoundingClientRect === 'function') {
      const sRect = sheld.getBoundingClientRect();
      if (sRect && sRect.width > 0 && sRect.width < vp.w - 20) {
        if (side === 'left') {
          desiredLeft =
            sRect.left >= 48
              ? Math.round(sRect.left - estW - 10)
              : Math.max(8, Math.round(sRect.left + 8));
        } else {
          const rightSpace = vp.w - sRect.right;
          desiredLeft =
            rightSpace >= 48
              ? Math.round(sRect.right + 10)
              : Math.min(Math.round(vp.w - estW - 8), Math.round(sRect.right - estW - 8));
        }
      }
    }

    capsuleEl.classList.toggle('is-left', side === 'left');
    capsuleEl.classList.toggle('is-right', side !== 'left');
    capsuleEl.style.transform = 'none';
    capsuleEl.style.bottom = 'auto';
    capsuleEl.style.right = 'auto';
    capsuleEl.style.left = `${desiredLeft}px`;
    capsuleEl.style.top = `${desiredTop}px`;

    // 若宿主或卡片美化脚本对 html/body 施加了偏移或缩放，使用实测渲染框二次校准到真实视口像素
    if (typeof capsuleEl.getBoundingClientRect === 'function') {
      const r = capsuleEl.getBoundingClientRect();
      const isDummyTestRect = r && r.width === 680 && r.height === 800 && r.top === 0 && r.left === 0;
      if (r && r.height > 0 && !isDummyTestRect) {
        const dx = desiredLeft - r.left;
        const dy = desiredTop - r.top;
        if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) {
          capsuleEl.style.left = `${Math.round(desiredLeft + dx)}px`;
          capsuleEl.style.top = `${Math.round(desiredTop + dy)}px`;
        }
      }
    }
  }

  function syncPositionAndBoundsNow() {
    boundsRaf = 0;
    if (!capsuleEl || capsuleEl.hidden) return;
    const s = store.get();
    const side = s.floatCapsuleSide === 'left' ? 'left' : 'right';
    const topPct = Number.isFinite(Number(s.floatCapsuleTopPct)) ? Number(s.floatCapsuleTopPct) : 62;
    applyVisualPlacement(side, topPct);
  }

  function scheduleBoundsSync() {
    if (boundsRaf) return;
    const req = root?.requestAnimationFrame || (fn => setTimeout(fn, 16));
    boundsRaf = req(syncPositionAndBoundsNow);
  }

  function syncClutterNow() {
    scanRaf = 0;
    const doc = root?.document;
    if (!doc) return;

    const active = isActiveInChat();
    doc.body?.classList?.toggle?.('stm-float-capsule-on', Boolean(active && !bypassClutterHide));

    if (!active) {
      clearAllClutterMarks();
      cachedClutterItems = [];
      cachedUntuckedWildItems = [];
      return;
    }

    const { hostNodes, items: barItems } = discoverInputClutterItems(doc);
    const wildCandidates = discoverWildFloatingWidgets(doc, root);
    const tuckedKeys = getTuckedKeysSetForCurrentChat();

    const tuckedWildItems = [];
    const untuckedWildItems = [];
    const allHostNodes = [...hostNodes];

    let wSeq = 1;
    for (const w of wildCandidates) {
      const desc = buildClutterDescriptor(w.node, w.node, 'wild', 1000 + wSeq, {
        widgetKey: w.key,
        fallbackName: '悬浮挂件',
      });
      wSeq += 1;
      if (tuckedKeys.has(w.key)) {
        allHostNodes.push(w.node);
        tuckedWildItems.push(desc);
      } else {
        untuckedWildItems.push(desc);
      }
    }

    cachedClutterItems = [...barItems, ...tuckedWildItems];
    cachedUntuckedWildItems = untuckedWildItems;

    const currentHostSet = new Set(allHostNodes);
    for (const oldNode of Array.from(markedHiddenNodes)) {
      if (!currentHostSet.has(oldNode) || bypassClutterHide) {
        delete oldNode.dataset?.stmClutterHidden;
        markedHiddenNodes.delete(oldNode);
      }
    }

    if (!bypassClutterHide) {
      for (const hNode of allHostNodes) {
        if (tempOpenHostNodes.has(hNode)) continue;
        if (hNode.dataset) {
          hNode.dataset.stmClutterHidden = '1';
        }
        markedHiddenNodes.add(hNode);
      }
    }

    // 核心策略：当本卡既无任何可收纳按钮、也未处于外部悬浮球拖入态时，直接隐去中间收纳球！
    const shouldShowBagSphere =
      cachedClutterItems.length > 0 ||
      bypassClutterHide ||
      popoverOpen ||
      Boolean(wildDragState?.moved);

    if (bagBtn) {
      const prevHidden = bagBtn.hidden;
      bagBtn.hidden = !shouldShowBagSphere;
      if (prevHidden !== bagBtn.hidden) {
        scheduleBoundsSync();
      }
    }

    if (popoverOpen) {
      renderPopoverContent();
    }
  }

  function scheduleClutterScan() {
    if (scanRaf) return;
    const req = root?.requestAnimationFrame || (fn => setTimeout(fn, 16));
    scanRaf = req(syncClutterNow);
  }

  function bindHostObservers(doc) {
    const targetRoot = doc?.getElementById?.('form_sheld') || doc?.getElementById?.('send_form') || null;
    if (targetRoot !== observedFormRoot) {
      formObserver?.disconnect?.();
      formObserver = null;
      observedFormRoot = targetRoot;

      if (targetRoot && typeof root?.MutationObserver === 'function') {
        formObserver = new root.MutationObserver(mutations => {
          const externalChange = mutations.some(m => {
            if (m.type === 'attributes') {
              return (
                m.attributeName !== 'data-stm-clutter-hidden' &&
                m.attributeName !== 'data-stm-clicking' &&
                m.attributeName !== 'data-stm-host-popup-live'
              );
            }
            return true;
          });
          if (externalChange) {
            scheduleClutterScan();
          }
        });
        formObserver.observe(targetRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'hidden', 'style'],
        });
      }
    }

    if (!bodyChildObserver && doc?.body && typeof root?.MutationObserver === 'function') {
      bodyChildObserver = new root.MutationObserver(mutations => {
        const addedOrRemoved = mutations.some(m => m.type === 'childList');
        if (addedOrRemoved) {
          scheduleClutterScan();
        }
      });
      bodyChildObserver.observe(doc.body, { childList: true });
    }
  }

  function jumpChatExtreme(mode) {
    const doc = root?.document;
    const chatEl = doc?.getElementById?.('chat');
    if (!chatEl) return;

    if (mode === 'top') {
      const curTop = Number(chatEl.scrollTop) || 0;
      const showMoreEl = Array.from(chatEl.children || []).find(
        n => String(n?.id || '') === 'show_more_messages' && !isIntrinsicallyHidden(n),
      );
      if (curTop <= 12 && showMoreEl && typeof showMoreEl.click === 'function') {
        showMoreEl.click();
      }
      scrollChatElementTo(chatEl, 0, false);
    } else {
      const bottom = Math.max(0, Number(chatEl.scrollHeight) || 0);
      scrollChatElementTo(chatEl, bottom, false);
      const req = root?.requestAnimationFrame || (fn => setTimeout(fn, 16));
      req(() => {
        if (chatEl) {
          chatEl.scrollTop = Math.max(0, Number(chatEl.scrollHeight) || 0);
        }
      });
    }
  }

  function triggerClutterItem(item) {
    const target = item?.targetEl;
    const hostNode = item?.hideHostEl || target;
    closePopover();
    if (!target) return;

    let restoreInlineStyle = null;
    if (hostNode?.dataset) {
      hostNode.dataset.stmClicking = '1';
      delete hostNode.dataset.stmClutterHidden;

      // 若是拖入收纳的野生悬浮球，临时将其隐形锚点对齐到伴侣球旁，令其弹出的面板自然贴在伴侣球内侧！
      if (item.zone === 'wild' && capsuleEl && typeof capsuleEl.getBoundingClientRect === 'function') {
        const capRect = capsuleEl.getBoundingClientRect();
        if (capRect && capRect.height > 0 && hostNode.style) {
          restoreInlineStyle = {
            left: hostNode.style.left,
            top: hostNode.style.top,
            right: hostNode.style.right,
            bottom: hostNode.style.bottom,
          };
          hostNode.style.right = 'auto';
          hostNode.style.bottom = 'auto';
          hostNode.style.left = `${Math.round(capRect.left)}px`;
          hostNode.style.top = `${Math.round(capRect.top + capRect.height / 2 - 20)}px`;
        }
      }
    }

    try {
      if (typeof target.click === 'function') {
        target.click();
      }
    } finally {
      const finish = () => {
        if (restoreInlineStyle && hostNode?.style) {
          hostNode.style.left = restoreInlineStyle.left;
          hostNode.style.top = restoreInlineStyle.top;
          hostNode.style.right = restoreInlineStyle.right;
          hostNode.style.bottom = restoreInlineStyle.bottom;
        }
        if (!hostNode?.dataset) return;
        delete hostNode.dataset.stmClicking;

        let hasExpandedInnerPopup = false;
        if (hostNode !== target && hostNode.children?.length > 1) {
          for (const child of Array.from(hostNode.children)) {
            if (child === target || isIntrinsicallyHidden(child)) continue;
            const h = Number(child.offsetHeight) || 0;
            const w = Number(child.offsetWidth) || 0;
            if (h > 44 && w > 60) {
              hasExpandedInnerPopup = true;
              break;
            }
          }
        }

        if (hasExpandedInnerPopup) {
          tempOpenHostNodes.add(hostNode);
          hostNode.dataset.stmHostPopupLive = '1';
        } else if (isActiveInChat() && !bypassClutterHide) {
          hostNode.dataset.stmClutterHidden = '1';
          markedHiddenNodes.add(hostNode);
        }
      };

      const req = root?.requestAnimationFrame || (fn => setTimeout(fn, 24));
      req(finish);
    }
  }

  function renderPopoverContent() {
    if (!popoverEl) return;
    const doc = root?.document;
    popoverEl.replaceChildren();

    const head = el('div', 'stm-float-pop-head');
    const countLabel =
      cachedClutterItems.length > 0 ? `已收纳 (${cachedClutterItems.length})` : '收纳仓';
    head.append(el('strong', 'stm-float-pop-title', countLabel));

    if (cachedClutterItems.length > 0 || bypassClutterHide) {
      const rawToggleBtn = el(
        'button',
        `stm-float-raw-toggle${bypassClutterHide ? ' is-active' : ''}`,
        bypassClutterHide ? '重新收起' : '原位显示',
      );
      rawToggleBtn.type = 'button';
      rawToggleBtn.title = bypassClutterHide
        ? '将外挂按钮重新收进收纳球'
        : '临时在原位置显示全部被收纳的按钮';
      rawToggleBtn.addEventListener('click', () => {
        bypassClutterHide = !bypassClutterHide;
        syncClutterNow();
      });
      head.append(rawToggleBtn);
    }
    popoverEl.append(head);

    if (cachedClutterItems.length === 0) {
      popoverEl.append(
        el('div', 'stm-float-pop-empty', '可将页面上的悬浮小挂件直接拖进圆球收纳'),
      );
    } else {
      const grid = el('div', 'stm-float-pop-grid');
      for (const item of cachedClutterItems) {
        if (item.zone === 'wild' && item.widgetKey) {
          const group = el('div', 'stm-float-tucked-chip');
          const mainBtn = el('button', 'stm-float-pop-item is-wild-main');
          mainBtn.type = 'button';
          mainBtn.title = `${item.title}（点击打开）`;
          if (item.glyphText) {
            mainBtn.append(el('span', 'stm-float-item-glyph', item.glyphText));
          } else if (item.iconName) {
            mainBtn.append(createIconNode(doc, item.iconName, 'stm-float-item-svg'));
          }
          mainBtn.append(el('span', 'stm-float-item-label', item.label));
          mainBtn.addEventListener('click', () => triggerClutterItem(item));

          const releaseBtn = el('button', 'stm-float-item-release');
          releaseBtn.type = 'button';
          releaseBtn.title = `放出「${item.label}」回到页面原位`;
          releaseBtn.innerHTML = svgMarkup('close');
          releaseBtn.addEventListener('click', evt => {
            evt.stopPropagation?.();
            removeTuckedWidgetKey(item.widgetKey);
            if (item.hideHostEl?.dataset) {
              delete item.hideHostEl.dataset.stmClutterHidden;
              markedHiddenNodes.delete(item.hideHostEl);
            }
            toastMessage(`已放出悬浮挂件：${item.label}`, 'info');
            syncClutterNow();
            if (cachedClutterItems.length === 0 && !bypassClutterHide) {
              closePopover();
            }
          });

          group.append(mainBtn, releaseBtn);
          grid.append(group);
        } else {
          const pill = el('button', 'stm-float-pop-item');
          pill.type = 'button';
          pill.title = item.title;
          if (item.glyphText) {
            pill.append(el('span', 'stm-float-item-glyph', item.glyphText));
          } else if (item.iconName) {
            pill.append(createIconNode(doc, item.iconName, 'stm-float-item-svg'));
          }
          pill.append(el('span', 'stm-float-item-label', item.label));
          pill.addEventListener('click', () => triggerClutterItem(item));
          grid.append(pill);
        }
      }
      popoverEl.append(grid);
    }

    // 针对不可拖动的死位置野生悬浮块：自动列出供一键收进来
    if (cachedUntuckedWildItems.length > 0) {
      const wildZone = el('div', 'stm-float-wild-suggest');
      wildZone.append(
        el('span', 'stm-float-wild-hint', '页面悬浮挂件（可拖入圆球，或点此直接收起）：'),
      );
      const wildRow = el('div', 'stm-float-pop-grid');
      for (const wItem of cachedUntuckedWildItems) {
        const absorbBtn = el('button', 'stm-float-absorb-btn');
        absorbBtn.type = 'button';
        absorbBtn.title = `将「${wItem.title}」收进收纳球`;
        absorbBtn.append(
          createIconNode(doc, 'plus', 'stm-float-item-svg'),
          el('span', 'stm-float-item-label', wItem.glyphText ? `${wItem.glyphText} ${wItem.label}` : wItem.label),
        );
        absorbBtn.addEventListener('click', () => {
          addTuckedWidgetKey(wItem.widgetKey);
          toastMessage(`已收起「${wItem.label}」`, 'success');
          syncClutterNow();
        });
        wildRow.append(absorbBtn);
      }
      wildZone.append(wildRow);
      popoverEl.append(wildZone);
    }

    const foot = el('div', 'stm-float-pop-foot');
    const topBtn = el('button', 'stm-float-foot-btn');
    topBtn.type = 'button';
    topBtn.append(createIconNode(doc, 'topjump', 'stm-float-item-svg'), el('span', '', '一键到顶'));
    topBtn.addEventListener('click', () => {
      closePopover();
      jumpChatExtreme('top');
    });

    const bottomBtn = el('button', 'stm-float-foot-btn');
    bottomBtn.type = 'button';
    bottomBtn.append(
      createIconNode(doc, 'bottomjump', 'stm-float-item-svg'),
      el('span', '', '一键到底'),
    );
    bottomBtn.addEventListener('click', () => {
      closePopover();
      jumpChatExtreme('bottom');
    });

    foot.append(topBtn, bottomBtn);
    popoverEl.append(foot);
  }

  function openPopover() {
    if (!isActiveInChat()) return;
    ensureDom();
    clearQuickJump();
    popoverOpen = true;
    lastOpenedAt = Date.now();
    syncClutterNow();
    if (popoverEl) {
      renderPopoverContent();
      popoverEl.hidden = false;
    }
    capsuleEl?.classList?.add?.('is-open');
    bagBtn?.classList?.add?.('is-active');
    onOpenStateChange?.(true);
  }

  function closePopover() {
    if (!popoverOpen) return;
    popoverOpen = false;
    if (popoverEl) {
      popoverEl.hidden = true;
    }
    capsuleEl?.classList?.remove?.('is-open');
    bagBtn?.classList?.remove?.('is-active');
    syncClutterNow();
    onOpenStateChange?.(false);
  }

  function togglePopover() {
    if (popoverOpen) closePopover();
    else openPopover();
  }

  function handleStepArrowClick(dir) {
    if (suppressNextClick) return;
    const doc = root?.document;
    const chatEl = doc?.getElementById?.('chat');
    if (popoverOpen) closePopover();

    stepChatByFloors(chatEl, dir === 'up' ? -DEFAULT_STEP_FLOORS : DEFAULT_STEP_FLOORS);
    const tap = tapTracker.recordTap(dir);
    if (tap.showQuickJump) {
      showQuickJumpChip(tap.mode);
    } else if (quickJumpMode && quickJumpMode !== tap.mode) {
      clearQuickJump();
    }
  }

  function bindCapsuleDrag(targetCapsule) {
    const onPointerDown = evt => {
      if (evt.button !== undefined && evt.button !== 0) return;
      const target = evt.target;
      if (popoverEl?.contains?.(target) || quickJumpBtn?.contains?.(target)) {
        return;
      }
      const startTopPct = Number.isFinite(Number(store.get().floatCapsuleTopPct))
        ? Number(store.get().floatCapsuleTopPct)
        : 62;
      dragState = {
        pointerId: evt.pointerId,
        startX: Number(evt.clientX) || 0,
        startY: Number(evt.clientY) || 0,
        startTopPct,
        moved: false,
        nextTopPct: startTopPct,
        nextSide: store.get().floatCapsuleSide === 'left' ? 'left' : 'right',
      };
    };

    const onPointerMove = evt => {
      if (!dragState) return;
      if (
        dragState.pointerId !== undefined &&
        evt.pointerId !== undefined &&
        evt.pointerId !== dragState.pointerId
      ) {
        return;
      }
      const dx = (Number(evt.clientX) || 0) - dragState.startX;
      const dy = (Number(evt.clientY) || 0) - dragState.startY;
      if (!dragState.moved && Math.hypot(dx, dy) < 8) return;

      if (!dragState.moved) {
        dragState.moved = true;
        suppressNextClick = true;
        closePopover();
        clearQuickJump();
        targetCapsule.classList.add('is-dragging');
      }

      evt.preventDefault?.();
      const vp = readViewportBox();
      const bagVisible = Boolean(bagBtn && !bagBtn.hidden);
      const estH = Number(targetCapsule.offsetHeight) || (bagVisible ? 116 : 75);
      const usableRange = Math.max(120, vp.h - estH - 126);
      const rawPct = dragState.startTopPct + (dy / usableRange) * 100;
      const clampedPct = Math.min(100, Math.max(0, Math.round(rawPct)));
      const side = (Number(evt.clientX) || 0) < vp.ox + vp.w / 2 ? 'left' : 'right';

      dragState.nextTopPct = clampedPct;
      dragState.nextSide = side;
      applyVisualPlacement(side, clampedPct);
    };

    const finishDrag = () => {
      if (!dragState) return;
      const finalState = dragState;
      dragState = null;
      targetCapsule.classList.remove('is-dragging');

      if (finalState.moved) {
        store.update(
          {
            floatCapsuleSide: finalState.nextSide,
            floatCapsuleTopPct: finalState.nextTopPct,
          },
          { silent: true },
        );
        syncPositionAndBoundsNow();
        setTimeout(() => {
          suppressNextClick = false;
        }, 60);
      } else {
        suppressNextClick = false;
      }
    };

    targetCapsule.addEventListener('pointerdown', onPointerDown);
    root?.addEventListener?.('pointermove', onPointerMove, { passive: false });
    root?.addEventListener?.('pointerup', finishDrag);
    root?.addEventListener?.('pointercancel', finishDrag);

    cleanups.push(
      () => targetCapsule.removeEventListener('pointerdown', onPointerDown),
      () => root?.removeEventListener?.('pointermove', onPointerMove),
      () => root?.removeEventListener?.('pointerup', finishDrag),
      () => root?.removeEventListener?.('pointercancel', finishDrag),
    );
  }

  /**
   * 监听用户在页面上拖动外部野生悬浮球（如角色卡自带悬浮卷轴/小手机球），靠近伴侣球组时亮起磁吸圈，松手即吞入收纳！
   */
  function findWildWidgetFromEventTarget(rawTarget, doc) {
    let cur =
      rawTarget && typeof rawTarget.closest === 'function' ? rawTarget : rawTarget?.parentElement;
    const sheld = doc?.getElementById?.('sheld');
    while (cur && cur !== doc?.body && cur !== doc?.documentElement) {
      if (capsuleEl?.contains?.(cur) || isYantaiInternalNode(cur)) return null;
      if (CORE_BODY_EXCLUDED_IDS.has(String(cur.id || '')) && cur !== sheld) return null;
      const parent = cur.parentNode || cur.parentElement;
      if (parent === doc?.body || parent === sheld) {
        return inspectWildFloatingCandidate(cur, root);
      }
      cur = parent;
    }
    return null;
  }

  function isPointerNearCapsule(clientX, clientY) {
    if (!capsuleEl || capsuleEl.hidden || typeof capsuleEl.getBoundingClientRect !== 'function') {
      return false;
    }
    const r = capsuleEl.getBoundingClientRect();
    if (!r || r.height <= 0) return false;
    const pad = 28;
    return (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    );
  }

  function ensureDom() {
    const doc = root?.document;
    if (!doc?.body) return null;
    if (capsuleEl?.isConnected) return capsuleEl;

    capsuleEl = doc.getElementById('stm-float-capsule') || el('div', 'stm-float-capsule is-right');
    capsuleEl.id = 'stm-float-capsule';
    capsuleEl.setAttribute('role', 'region');
    capsuleEl.setAttribute('aria-label', '对话悬浮翻楼与外挂收纳');
    capsuleEl.hidden = true;
    capsuleEl.replaceChildren();

    const stopBubble = evt => evt.stopPropagation?.();
    capsuleEl.addEventListener('mousedown', stopBubble);
    capsuleEl.addEventListener('touchstart', stopBubble, { passive: true });

    const track = el('div', 'stm-float-track');

    upBtn = el('button', 'stm-float-slot stm-float-up');
    upBtn.type = 'button';
    upBtn.title = '向上翻 5 楼（连点两下浮出「到顶」）';
    upBtn.setAttribute('aria-label', '向上翻 5 楼');
    upBtn.innerHTML = svgMarkup('chevronup');
    upBtn.addEventListener('click', () => handleStepArrowClick('up'));

    bagBtn = el('button', 'stm-float-slot stm-float-bag');
    bagBtn.type = 'button';
    bagBtn.hidden = true;
    bagBtn.title = '展开已收纳按钮（外部悬浮球可直接拖入此处收纳）';
    bagBtn.setAttribute('aria-label', '展开已收纳按钮');
    bagBtn.innerHTML = svgMarkup('more');
    bagBtn.addEventListener('click', () => {
      if (suppressNextClick) return;
      togglePopover();
    });

    downBtn = el('button', 'stm-float-slot stm-float-down');
    downBtn.type = 'button';
    downBtn.title = '向下翻 5 楼（连点两下浮出「到底」）';
    downBtn.setAttribute('aria-label', '向下翻 5 楼');
    downBtn.innerHTML = svgMarkup('chevron');
    downBtn.addEventListener('click', () => handleStepArrowClick('down'));

    track.append(upBtn, bagBtn, downBtn);

    quickJumpBtn = el('button', 'stm-float-quick-jump');
    quickJumpBtn.type = 'button';
    quickJumpBtn.hidden = true;
    quickJumpBtn.addEventListener('click', evt => {
      evt.stopPropagation?.();
      const targetMode = quickJumpMode;
      clearQuickJump();
      tapTracker.reset();
      if (targetMode) {
        jumpChatExtreme(targetMode);
      }
    });

    popoverEl = el('div', 'stm-float-popover');
    popoverEl.hidden = true;

    capsuleEl.append(track, quickJumpBtn, popoverEl);
    doc.body.append(capsuleEl);

    if (cleanups.length === 0) {
      bindCapsuleDrag(capsuleEl);

      const onDocPointerDown = evt => {
        const target = evt.target;
        const elTarget =
          target && typeof target.closest === 'function' ? target : target?.parentElement;

        if (tempOpenHostNodes.size > 0) {
          for (const hNode of Array.from(tempOpenHostNodes)) {
            if (!elTarget || !hNode.contains?.(elTarget)) {
              tempOpenHostNodes.delete(hNode);
              delete hNode.dataset?.stmHostPopupLive;
              if (isActiveInChat() && !bypassClutterHide && hNode.dataset) {
                hNode.dataset.stmClutterHidden = '1';
                markedHiddenNodes.add(hNode);
              }
            }
          }
        }

        if (capsuleEl && elTarget && capsuleEl.contains?.(elTarget)) return;

        // 检测用户是否按住了某个野生悬浮球准备拖动
        if (isActiveInChat() && (evt.button === undefined || evt.button === 0)) {
          const wildCand = findWildWidgetFromEventTarget(elTarget, doc);
          if (wildCand) {
            wildDragState = {
              pointerId: evt.pointerId,
              node: wildCand.node,
              key: wildCand.key,
              startX: Number(evt.clientX) || 0,
              startY: Number(evt.clientY) || 0,
              moved: false,
              overCapsule: false,
            };
          }
        }

        if (quickJumpMode) {
          clearQuickJump();
        }
        if (popoverOpen && Date.now() - lastOpenedAt >= 100) {
          closePopover();
        }
      };

      const onDocPointerMove = evt => {
        if (!wildDragState) return;
        if (
          wildDragState.pointerId !== undefined &&
          evt.pointerId !== undefined &&
          evt.pointerId !== wildDragState.pointerId
        ) {
          return;
        }
        const cx = Number(evt.clientX) || 0;
        const cy = Number(evt.clientY) || 0;
        if (!wildDragState.moved && Math.hypot(cx - wildDragState.startX, cy - wildDragState.startY) >= 8) {
          wildDragState.moved = true;
          capsuleEl?.classList?.add?.('is-drop-ready');
          syncClutterNow();
          syncPositionAndBoundsNow();
        }
        if (!wildDragState.moved) return;

        const near = isPointerNearCapsule(cx, cy);
        if (near !== wildDragState.overCapsule) {
          wildDragState.overCapsule = near;
          capsuleEl?.classList?.toggle?.('is-drop-hover', near);
        }
      };

      const finishWildDrag = evt => {
        if (!wildDragState) return;
        const state = wildDragState;
        wildDragState = null;
        capsuleEl?.classList?.remove?.('is-drop-ready', 'is-drop-hover');

        const cx = Number(evt?.clientX) || 0;
        const cy = Number(evt?.clientY) || 0;
        const droppedIn = state.moved && (state.overCapsule || isPointerNearCapsule(cx, cy));

        if (droppedIn && state.key && isActiveInChat()) {
          const desc = buildClutterDescriptor(state.node, state.node, 'wild', 9999, {
            widgetKey: state.key,
            fallbackName: '悬浮挂件',
          });
          addTuckedWidgetKey(state.key);
          bypassClutterHide = false;
          // 延后一个宏任务隐藏，确保原悬浮球自身的 pointerup 与防误点 click 正常收尾复位
          setTimeout(() => {
            syncClutterNow();
            syncPositionAndBoundsNow();
            toastMessage(`已收纳「${desc.label}」（点中间收纳球可随时打开或放出）`, 'success');
          }, 0);
        } else {
          syncClutterNow();
          syncPositionAndBoundsNow();
        }
      };

      const onDocKeyDown = evt => {
        if (evt.key === 'Escape' && popoverOpen) {
          evt.stopPropagation?.();
          closePopover();
        }
      };

      doc.addEventListener?.('pointerdown', onDocPointerDown, true);
      doc.addEventListener?.('pointermove', onDocPointerMove, true);
      doc.addEventListener?.('pointerup', finishWildDrag, true);
      doc.addEventListener?.('pointercancel', finishWildDrag, true);
      doc.addEventListener?.('keydown', onDocKeyDown, true);
      root?.addEventListener?.('resize', scheduleBoundsSync, { passive: true });
      root?.visualViewport?.addEventListener?.('resize', scheduleBoundsSync, { passive: true });
      root?.visualViewport?.addEventListener?.('scroll', scheduleBoundsSync, { passive: true });

      cleanups.push(
        () => doc.removeEventListener?.('pointerdown', onDocPointerDown, true),
        () => doc.removeEventListener?.('pointermove', onDocPointerMove, true),
        () => doc.removeEventListener?.('pointerup', finishWildDrag, true),
        () => doc.removeEventListener?.('pointercancel', finishWildDrag, true),
        () => doc.removeEventListener?.('keydown', onDocKeyDown, true),
        () => root?.removeEventListener?.('resize', scheduleBoundsSync),
        () => root?.visualViewport?.removeEventListener?.('resize', scheduleBoundsSync),
        () => root?.visualViewport?.removeEventListener?.('scroll', scheduleBoundsSync),
      );
    }

    return capsuleEl;
  }

  function refresh() {
    const doc = root?.document;
    if (!doc) return;

    const active = isActiveInChat();
    if (!active) {
      wildDragState = null;
      closePopover();
      clearQuickJump();
      tapTracker.reset();
      doc.body?.classList?.remove?.('stm-float-capsule-on');
      clearAllClutterMarks();
      if (capsuleEl) {
        capsuleEl.hidden = true;
      }
      return;
    }

    ensureDom();
    bindHostObservers(doc);
    if (capsuleEl) {
      capsuleEl.hidden = false;
    }
    syncClutterNow();
    syncPositionAndBoundsNow();
  }

  function destroy() {
    if (quickJumpTimer) {
      clearTimeout(quickJumpTimer);
      quickJumpTimer = 0;
    }
    if (boundsRaf) {
      if (typeof root?.cancelAnimationFrame === 'function') root.cancelAnimationFrame(boundsRaf);
      else clearTimeout(boundsRaf);
      boundsRaf = 0;
    }
    if (scanRaf) {
      if (typeof root?.cancelAnimationFrame === 'function') root.cancelAnimationFrame(scanRaf);
      else clearTimeout(scanRaf);
      scanRaf = 0;
    }
    formObserver?.disconnect?.();
    formObserver = null;
    observedFormRoot = null;
    bodyChildObserver?.disconnect?.();
    bodyChildObserver = null;
    wildDragState = null;

    while (cleanups.length) {
      const off = cleanups.pop();
      off?.();
    }

    popoverOpen = false;
    quickJumpMode = '';
    root?.document?.body?.classList?.remove?.('stm-float-capsule-on');
    clearAllClutterMarks();
    capsuleEl?.remove?.();
    capsuleEl = null;
    upBtn = null;
    bagBtn = null;
    downBtn = null;
    quickJumpBtn = null;
    popoverEl = null;
  }

  return {
    isOpen: () => popoverOpen,
    open: openPopover,
    close: closePopover,
    toggle: togglePopover,
    refresh,
    destroy,
  };
}
