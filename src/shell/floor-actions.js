/**
 * SillyTavern 伴侣 (st-mate) · 楼层底部操作与人话菜单模块 (floor-actions.js)
 * 设计理念：
 * 1. 长段 RP 阅读到底部无需滚回楼顶：每条普通消息底部挂载极简克制的「··· / 复制 / 编辑」3 颗细线图标；
 * 2. 编辑长段时「删除 / 取消 / 保存」直接跟在编辑框下方，顺手收起极低频的「加思考块 / 换楼顺序」按钮（仍留 `···` 折叠兜底）；
 * 3. 点开「···」弹出全局唯一复用的轻量人话中文浮层（开新分支、保存此楼、对 AI 隐藏、删除、自动透传提示词查看器与第三方插件按钮，原版低频的附文件/翻译/生图/朗读收进底部折叠行）；
 * 4. 100% 代理触发酒馆原生按钮事件与官方 `deleteMessage`，零 DOM 破坏、关闭开关即瞬间无损退回原版布局。
 */

import { createIconNode } from '../core/icons.js?v=0.9.8';
import { primeHostCoreModule } from '../modules/char-world-backend.js?v=0.9.8';

const BODY_ACTIVE_CLASS = 'stm-floor-actions-bottom';

const KNOWN_EXTRA_CLASSES = Object.freeze([
  'mes_translate',
  'sd_message_gen',
  'mes_narrate',
  'mes_prompt',
  'mes_hide',
  'mes_unhide',
  'mes_media_gallery',
  'mes_media_list',
  'mes_embed',
  'mes_swipe_picker',
  'mes_create_bookmark',
  'mes_create_branch',
  'mes_copy',
]);

const LOW_FREQ_NATIVE_DEFS = Object.freeze([
  { selector: '.mes_embed', label: '附文件', icon: 'file', eventType: 'click' },
  { selector: '.mes_translate', label: '翻译', icon: 'globe', eventType: 'click' },
  { selector: '.sd_message_gen', label: '生图', icon: 'image', eventType: 'click' },
  { selector: '.mes_narrate', label: '朗读', icon: 'spark', eventType: 'click' },
]);

function isNodeEffectivelyVisible(el, win) {
  if (!el) return false;
  if (el.hidden) return false;
  const inlineDisplay = String(el.style?.display || '').trim().toLowerCase();
  if (inlineDisplay === 'none') return false;
  if (typeof win?.getComputedStyle === 'function') {
    try {
      const cs = win.getComputedStyle(el);
      if (cs?.display === 'none' || cs?.visibility === 'hidden') return false;
    } catch {
      // ignore mock DOM
    }
  }
  return true;
}

function isMessageHiddenFromAi(mesEl) {
  return String(mesEl?.getAttribute?.('is_system') || '').trim().toLowerCase() === 'true';
}

function isSystemNoticeFloor(mesEl) {
  if (!mesEl) return true;
  if (mesEl.classList?.contains('smallSysMes')) return true;
  const chName = String(mesEl.getAttribute?.('ch_name') || '').trim();
  if (chName === 'SillyTavern System') return true;
  return false;
}

function isMessageEditing(mesEl, win) {
  if (!mesEl) return false;
  if (mesEl.querySelector?.('.edit_textarea')) return true;
  const editBtns = mesEl.querySelector?.('.mes_edit_buttons');
  if (editBtns && String(editBtns.style?.display || '').trim().toLowerCase() === 'flex') {
    return true;
  }
  if (editBtns && String(editBtns.style?.display || '').trim().toLowerCase() === 'block') {
    return true;
  }
  if (editBtns && isNodeEffectivelyVisible(editBtns, win)) {
    const inlineDisplay = String(editBtns.style?.display || '').trim().toLowerCase();
    // 只有当宿主真正展开编辑栏（或样式未设为 none 且存在编辑态 class）时才判定为编辑中
    if (inlineDisplay && inlineDisplay !== 'none') return true;
  }
  return false;
}

/**
 * 按酒馆原生绑定方式精准触发原生楼层按钮：
 * `.mes_copy` / `.mes_prompt` 在酒馆中监听 `pointerup`，其余监听 `click`。
 */
export function triggerNativeFloorButton(targetEl, eventType = 'click', win = globalThis) {
  if (!targetEl) return false;
  const normalizedType = eventType === 'pointerup' ? 'pointerup' : 'click';
  if (normalizedType === 'pointerup') {
    if (typeof win?.$ === 'function') {
      try {
        win.$(targetEl).trigger('pointerup');
        return true;
      } catch {
        // fallback below
      }
    }
    const EvtCtor = win?.PointerEvent || win?.MouseEvent || win?.Event;
    if (typeof EvtCtor === 'function') {
      targetEl.dispatchEvent(new EvtCtor('pointerup', { bubbles: true, cancelable: true }));
      return true;
    }
    targetEl.click?.();
    return true;
  }
  if (typeof targetEl.click === 'function') {
    targetEl.click();
    return true;
  }
  const EvtCtor = win?.MouseEvent || win?.Event;
  if (typeof EvtCtor === 'function') {
    targetEl.dispatchEvent(new EvtCtor('click', { bubbles: true, cancelable: true }));
    return true;
  }
  return false;
}

/**
 * 探测当前楼层 `.extraMesButtons` 中由第三方扩展注入的自定义按钮（排除已知原生 13 项，绝不吞掉外部扩展入口）。
 */
export function discoverThirdPartyFloorButtons(mesEl, win = globalThis) {
  const extraBox = mesEl?.querySelector?.('.extraMesButtons');
  if (!extraBox) return [];
  const out = [];
  const children = extraBox.children ? [...extraBox.children] : [];
  for (const child of children) {
    if (!child || !child.classList) continue;
    const isKnownNative = KNOWN_EXTRA_CLASSES.some(cls => child.classList.contains(cls));
    if (isKnownNative) continue;
    if (!isNodeEffectivelyVisible(child, win)) continue;
    let cleanLabel = String(
      child.getAttribute?.('title') ||
        child.getAttribute?.('aria-label') ||
        child.dataset?.tooltip ||
        child.textContent ||
        '',
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanLabel.length > 14) {
      const stripped = cleanLabel.replace(/[（(][^）)]*[）)]\s*$/, '').trim();
      if (stripped.length >= 2) cleanLabel = stripped;
    }
    const label = cleanLabel ? cleanLabel.slice(0, 18) : '扩展操作';
    out.push({ el: child, label });
  }
  return out;
}

export function createFloorActions({
  root = globalThis,
  getContext = () => null,
  store,
  onOpenStateChange = null,
} = {}) {
  let active = false;
  let observer = null;
  let syncRaf = 0;
  let menuEl = null;
  let menuMesEl = null;
  let menuAnchorEl = null;
  let menuExtraOpen = false;
  let copyFlashTimers = new WeakMap();
  let docClickHandler = null;
  let keydownHandler = null;
  let scrollCloseHandler = null;
  let resizeCloseHandler = null;

  function getDoc() {
    return root?.document || globalThis.document;
  }

  function el(tag, className = '', text = '') {
    const node = getDoc().createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function isMenuOpen() {
    return Boolean(menuEl && !menuEl.hidden && menuEl.isConnected);
  }

  function closeMenu() {
    const wasOpen = isMenuOpen();
    menuMesEl = null;
    menuAnchorEl = null;
    menuExtraOpen = false;
    if (menuEl) {
      menuEl.hidden = true;
      menuEl.replaceChildren();
    }
    if (wasOpen) {
      onOpenStateChange?.(false);
    }
  }

  async function triggerFloorDelete(mesEl) {
    if (!mesEl) return;
    const mesIdAttr = mesEl.getAttribute?.('mesid');
    const mesId = Number(mesIdAttr);
    const ctx = getContext?.();
    const doc = getDoc();

    // 优先走酒馆官方 script.js 导出的 deleteMessage（带官方确认弹窗，不闪烁编辑框）
    if (Number.isInteger(mesId) && mesId >= 0) {
      try {
        const coreMod = await primeHostCoreModule({ doc });
        if (typeof coreMod?.deleteMessage === 'function') {
          const chatArr = Array.isArray(ctx?.chat) ? ctx.chat : [];
          const message = chatArr[mesId];
          const swipesArray = Array.isArray(message?.swipes) ? message.swipes : [];
          const selectedSwipe = message?.swipe_id ?? undefined;
          const confirmEnabled = ctx?.powerUserSettings?.confirm_message_delete !== false;
          const canDeleteSwipe =
            confirmEnabled &&
            message &&
            !message.is_user &&
            swipesArray.length > 1 &&
            mesId === chatArr.length - 1 &&
            selectedSwipe !== undefined;
          await coreMod.deleteMessage(
            mesId,
            canDeleteSwipe ? selectedSwipe : undefined,
            confirmEnabled,
          );
          return;
        }
      } catch {
        // 回退点击原生按钮
      }
    }

    // 兜底：若当前已在编辑态直接点 .mes_edit_delete，否则轻点 .mes_edit 后再触发 .mes_edit_delete
    const directDel = mesEl.querySelector?.('.mes_edit_delete');
    if (isMessageEditing(mesEl, root)) {
      triggerNativeFloorButton(directDel, 'click', root);
      return;
    }
    const editBtn = mesEl.querySelector?.('.mes_edit');
    if (editBtn) {
      triggerNativeFloorButton(editBtn, 'click', root);
      setTimeout(() => {
        const delAfter = mesEl.querySelector?.('.mes_edit_delete');
        triggerNativeFloorButton(delAfter, 'click', root);
      }, 24);
    }
  }

  function positionMenu() {
    if (!menuEl || menuEl.hidden || !menuAnchorEl) return;
    const vw = root?.innerWidth || 390;
    const vh = root?.innerHeight || 780;
    const pad = 10;

    const anchorRect =
      typeof menuAnchorEl.getBoundingClientRect === 'function'
        ? menuAnchorEl.getBoundingClientRect()
        : { left: 100, right: 130, top: 200, bottom: 230 };
    const menuRect =
      typeof menuEl.getBoundingClientRect === 'function'
        ? menuEl.getBoundingClientRect()
        : { width: 230, height: 240 };

    const mw = menuRect.width || 232;
    const mh = menuRect.height || 240;

    // 优先贴按钮右缘左对齐（防止顶出右侧屏幕）
    let left = anchorRect.right - mw;
    if (left < pad) left = Math.max(pad, anchorRect.left);
    if (left + mw > vw - pad) left = Math.max(pad, vw - mw - pad);

    // 优先向下展开，下方空间不足时优雅向上翻转
    const spaceBelow = vh - anchorRect.bottom - pad;
    const spaceAbove = anchorRect.top - pad;
    let top = anchorRect.bottom + 6;
    if (spaceBelow < mh && spaceAbove > spaceBelow) {
      top = Math.max(pad, anchorRect.top - mh - 6);
    } else if (top + mh > vh - pad) {
      top = Math.max(pad, vh - mh - pad);
    }

    menuEl.style.left = `${Math.round(left)}px`;
    menuEl.style.top = `${Math.round(top)}px`;
  }

  function renderMenuContents() {
    if (!menuEl || !menuMesEl) return;
    const doc = getDoc();
    const mesEl = menuMesEl;
    menuEl.replaceChildren();

    const hiddenFromAi = isMessageHiddenFromAi(mesEl);
    const nativeBranch = mesEl.querySelector?.('.mes_create_branch');
    const nativeBookmarkCreate = mesEl.querySelector?.('.mes_create_bookmark');
    const nativeBookmarkOpen = mesEl.querySelector?.('.mes_bookmark');
    const hasBookmark = Boolean(
      nativeBookmarkOpen && isNodeEffectivelyVisible(nativeBookmarkOpen, root),
    );
    const nativeHide = mesEl.querySelector?.('.mes_hide');
    const nativeUnhide = mesEl.querySelector?.('.mes_unhide');
    const nativePrompt = mesEl.querySelector?.('.mes_prompt');
    const hasPrompt = Boolean(nativePrompt && isNodeEffectivelyVisible(nativePrompt, root));
    const nativeSwipePicker = mesEl.querySelector?.('.mes_swipe_picker');
    const hasSwipePicker = Boolean(
      nativeSwipePicker && isNodeEffectivelyVisible(nativeSwipePicker, root),
    );

    const makeMenuItem = ({
      icon,
      label,
      sub = '',
      danger = false,
      actionKey = '',
      onClick,
    }) => {
      const btn = el(
        'button',
        `stm-floor-menu-item${danger ? ' is-danger' : ''}${sub ? ' has-sub' : ''}`,
      );
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      if (actionKey) btn.dataset.floorAction = actionKey;
      btn.append(createIconNode(doc, icon, 'stm-floor-menu-icon'));
      const copyWrap = el('span', 'stm-floor-menu-copy');
      copyWrap.append(el('span', 'stm-floor-menu-label', label));
      if (sub) {
        copyWrap.append(el('span', 'stm-floor-menu-sub', sub));
      }
      btn.append(copyWrap);
      btn.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        const targetMes = mesEl;
        closeMenu();
        onClick?.(targetMes);
      });
      return btn;
    };

    const primaryList = el('div', 'stm-floor-menu-group');

    if (nativeBranch) {
      primaryList.append(
        makeMenuItem({
          icon: 'branch',
          label: '开新分支',
          sub: '将此楼及之前内容另建新存档',
          actionKey: 'branch',
          onClick: () => triggerNativeFloorButton(nativeBranch, 'click', root),
        }),
      );
    }

    if (hasBookmark && nativeBookmarkOpen) {
      primaryList.append(
        makeMenuItem({
          icon: 'flag',
          label: '打开已存快照',
          sub: '跳转到此楼之前保存的检查点',
          actionKey: 'open_bookmark',
          onClick: () => triggerNativeFloorButton(nativeBookmarkOpen, 'click', root),
        }),
      );
    } else if (nativeBookmarkCreate) {
      primaryList.append(
        makeMenuItem({
          icon: 'flag',
          label: '保存此楼',
          sub: '原地留个检查点，不离开当前对话',
          actionKey: 'bookmark',
          onClick: () => triggerNativeFloorButton(nativeBookmarkCreate, 'click', root),
        }),
      );
    }

    if (hiddenFromAi ? nativeUnhide : nativeHide) {
      primaryList.append(
        makeMenuItem({
          icon: hiddenFromAi ? 'eye' : 'eyeoff',
          label: hiddenFromAi ? '恢复对 AI 可见' : '对 AI 隐藏',
          actionKey: hiddenFromAi ? 'unhide' : 'hide',
          onClick: () =>
            triggerNativeFloorButton(hiddenFromAi ? nativeUnhide : nativeHide, 'click', root),
        }),
      );
    }

    if (hasPrompt) {
      primaryList.append(
        makeMenuItem({
          icon: 'search',
          label: '查看提示词',
          actionKey: 'prompt',
          onClick: () => triggerNativeFloorButton(nativePrompt, 'pointerup', root),
        }),
      );
    }

    if (hasSwipePicker) {
      primaryList.append(
        makeMenuItem({
          icon: 'layers',
          label: '重Roll列表',
          actionKey: 'swipe_picker',
          onClick: () => triggerNativeFloorButton(nativeSwipePicker, 'click', root),
        }),
      );
    }

    // 透传外部第三方扩展往 .extraMesButtons 注入的自定义按钮
    const thirdPartyButtons = discoverThirdPartyFloorButtons(mesEl, root);
    for (const extItem of thirdPartyButtons) {
      primaryList.append(
        makeMenuItem({
          icon: 'spark',
          label: extItem.label,
          actionKey: 'third_party',
          onClick: () => triggerNativeFloorButton(extItem.el, 'click', root),
        }),
      );
    }

    menuEl.append(primaryList);

    // 危险操作独立分隔区：删除
    menuEl.append(el('div', 'stm-floor-menu-divider'));
    const dangerGroup = el('div', 'stm-floor-menu-group');
    dangerGroup.append(
      makeMenuItem({
        icon: 'trash',
        label: '删除',
        danger: true,
        actionKey: 'delete',
        onClick: targetMes => {
          void triggerFloorDelete(targetMes);
        },
      }),
    );
    menuEl.append(dangerGroup);

    // 原生低频老功能（附文件 / 翻译 / 生图 / 朗读）默认收起，点一下展开照常用
    const availableLowFreq = LOW_FREQ_NATIVE_DEFS.map(def => ({
      ...def,
      node: mesEl.querySelector?.(def.selector) || null,
    })).filter(item => item.node && isNodeEffectivelyVisible(item.node, root));

    if (availableLowFreq.length > 0) {
      menuEl.append(el('div', 'stm-floor-menu-divider'));
      const moreToggle = el(
        'button',
        `stm-floor-menu-more-toggle${menuExtraOpen ? ' is-open' : ''}`,
      );
      moreToggle.type = 'button';
      moreToggle.append(
        el('span', '', '更多原版'),
        createIconNode(doc, menuExtraOpen ? 'chevronup' : 'chevron', 'stm-floor-menu-chevron'),
      );
      moreToggle.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        menuExtraOpen = !menuExtraOpen;
        renderMenuContents();
        positionMenu();
      });
      menuEl.append(moreToggle);

      if (menuExtraOpen) {
        const chipRow = el('div', 'stm-floor-menu-lowfreq-row');
        for (const item of availableLowFreq) {
          const chip = el('button', 'stm-floor-menu-chip');
          chip.type = 'button';
          chip.dataset.floorLowfreq = item.label;
          chip.append(
            createIconNode(doc, item.icon, 'stm-floor-chip-icon'),
            el('span', '', item.label),
          );
          chip.addEventListener('click', evt => {
            evt.preventDefault();
            evt.stopPropagation();
            closeMenu();
            triggerNativeFloorButton(item.node, item.eventType, root);
          });
          chipRow.append(chip);
        }
        menuEl.append(chipRow);
      }
    }
  }

  function openMenuForFloor(mesEl, anchorBtn) {
    const doc = getDoc();
    if (!doc || !mesEl || !anchorBtn) return;

    // 再点同一颗「···」即收起
    if (isMenuOpen() && menuMesEl === mesEl && menuAnchorEl === anchorBtn) {
      closeMenu();
      return;
    }

    if (!menuEl || !menuEl.isConnected) {
      menuEl = doc.getElementById('stm-floor-menu') || el('div', 'stm-floor-menu');
      menuEl.id = 'stm-floor-menu';
      menuEl.setAttribute('role', 'menu');
      doc.body.append(menuEl);
    }

    menuMesEl = mesEl;
    menuAnchorEl = anchorBtn;
    menuExtraOpen = false;
    renderMenuContents();
    menuEl.hidden = false;
    positionMenu();
    onOpenStateChange?.(true);
  }

  function findDirectChildByClass(parent, cls) {
    if (!parent?.children) return null;
    for (const child of parent.children) {
      if (child?.classList?.contains(cls)) return child;
    }
    return null;
  }

  function ensureFloorBarsOnMessage(mesEl) {
    if (!mesEl || isSystemNoticeFloor(mesEl)) return;
    const mesBlock =
      findDirectChildByClass(mesEl, 'mes_block') || mesEl.querySelector?.('.mes_block');
    if (!mesBlock) return;
    const doc = getDoc();

    const editing = isMessageEditing(mesEl, root);
    const hiddenFromAi = isMessageHiddenFromAi(mesEl);
    const nativeBookmarkOpen = mesEl.querySelector?.('.mes_bookmark');
    const hasBookmark = Boolean(
      nativeBookmarkOpen && isNodeEffectivelyVisible(nativeBookmarkOpen, root),
    );

    // 1. 常态底部极简 3 键条（··· / 复制 / 编辑）
    let bar = findDirectChildByClass(mesBlock, 'stm-floor-bar');
    if (!bar) {
      bar = el('div', 'stm-floor-bar');

      const statusWrap = el('div', 'stm-floor-status');
      const actionsWrap = el('div', 'stm-floor-btns');

      const moreBtn = el('button', 'stm-floor-btn stm-floor-more-btn');
      moreBtn.type = 'button';
      moreBtn.title = '更多操作';
      moreBtn.setAttribute('aria-label', '更多操作');
      moreBtn.append(createIconNode(doc, 'more', 'stm-floor-svg'));
      moreBtn.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        openMenuForFloor(mesEl, moreBtn);
      });

      const copyBtn = el('button', 'stm-floor-btn stm-floor-copy-btn');
      copyBtn.type = 'button';
      copyBtn.title = '复制';
      copyBtn.setAttribute('aria-label', '复制正文');
      copyBtn.append(createIconNode(doc, 'copy', 'stm-floor-svg'));
      copyBtn.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        closeMenu();
        const nativeCopy = mesEl.querySelector?.('.mes_copy');
        if (nativeCopy) {
          triggerNativeFloorButton(nativeCopy, 'pointerup', root);
        }
        // 给一个克制的 1 秒勾选反馈
        const prevTimer = copyFlashTimers.get(copyBtn);
        if (prevTimer) clearTimeout(prevTimer);
        copyBtn.classList.add('is-copied');
        copyBtn.replaceChildren(createIconNode(doc, 'check', 'stm-floor-svg'));
        const tid = setTimeout(() => {
          copyBtn.classList.remove('is-copied');
          copyBtn.replaceChildren(createIconNode(doc, 'copy', 'stm-floor-svg'));
          copyFlashTimers.delete(copyBtn);
        }, 1100);
        copyFlashTimers.set(copyBtn, tid);
      });

      const editBtn = el('button', 'stm-floor-btn stm-floor-edit-btn');
      editBtn.type = 'button';
      editBtn.title = '编辑';
      editBtn.setAttribute('aria-label', '编辑正文');
      editBtn.append(createIconNode(doc, 'edit', 'stm-floor-svg'));
      editBtn.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        closeMenu();
        const nativeEdit = mesEl.querySelector?.('.mes_edit');
        triggerNativeFloorButton(nativeEdit, 'click', root);
        scheduleSync();
      });

      actionsWrap.append(moreBtn, copyBtn, editBtn);
      bar.append(statusWrap, actionsWrap);
      mesBlock.append(bar);
    }

    // 同步轻状态小徽标（仅当该楼已隐藏或已有检查点快照时显示）
    const statusWrap = bar.querySelector?.('.stm-floor-status');
    if (statusWrap) {
      const nextSig = `${hiddenFromAi ? 'H' : ''}|${hasBookmark ? 'B' : ''}`;
      if (statusWrap.dataset.sig !== nextSig) {
        statusWrap.dataset.sig = nextSig;
        statusWrap.replaceChildren();
        if (hiddenFromAi) {
          const hideTag = el('button', 'stm-floor-pill', '已对 AI 隐藏');
          hideTag.type = 'button';
          hideTag.title = '点击恢复对 AI 可见';
          hideTag.addEventListener('click', evt => {
            evt.preventDefault();
            evt.stopPropagation();
            triggerNativeFloorButton(mesEl.querySelector?.('.mes_unhide'), 'click', root);
          });
          statusWrap.append(hideTag);
        }
        if (hasBookmark) {
          const bmTag = el('button', 'stm-floor-pill is-flag');
          bmTag.type = 'button';
          bmTag.title = '点击打开已保存的检查点快照';
          bmTag.append(
            createIconNode(doc, 'flag', 'stm-floor-pill-svg'),
            el('span', '', '已保存'),
          );
          bmTag.addEventListener('click', evt => {
            evt.preventDefault();
            evt.stopPropagation();
            triggerNativeFloorButton(mesEl.querySelector?.('.mes_bookmark'), 'click', root);
          });
          statusWrap.append(bmTag);
        }
      }
    }

    bar.hidden = editing;

    // 2. 编辑态底部顺手操作栏（删除 ··· | 取消 [✓ 保存]），彻底免去长段滚回楼顶点勾勾的麻烦
    let editBar = findDirectChildByClass(mesBlock, 'stm-floor-edit-bar');
    if (editing) {
      if (!editBar) {
        editBar = el('div', 'stm-floor-edit-bar');
        let rareOpen = false;

        const leftGroup = el('div', 'stm-floor-edit-left');
        const delBtn = el('button', 'stm-floor-edit-btn-item is-danger');
        delBtn.type = 'button';
        delBtn.append(
          createIconNode(doc, 'trash', 'stm-floor-edit-svg'),
          el('span', '', '删除'),
        );
        delBtn.addEventListener('click', evt => {
          evt.preventDefault();
          evt.stopPropagation();
          triggerNativeFloorButton(mesEl.querySelector?.('.mes_edit_delete'), 'click', root);
        });

        const rareToggleBtn = el('button', 'stm-floor-edit-btn-item stm-floor-edit-rare-toggle');
        rareToggleBtn.type = 'button';
        rareToggleBtn.title = '更多原版编辑项（加思考块 / 移动楼层）';
        rareToggleBtn.setAttribute('aria-label', '更多原版编辑项');
        rareToggleBtn.append(createIconNode(doc, 'more', 'stm-floor-edit-svg'));

        const rareStrip = el('div', 'stm-floor-edit-rare-strip');
        rareStrip.hidden = true;
        for (const [sel, label, iconName] of [
          ['.mes_edit_add_reasoning', '加思考块', 'spark'],
          ['.mes_edit_up', '上移', 'arrowup'],
          ['.mes_edit_down', '下移', 'arrowdown'],
        ]) {
          const rBtn = el('button', 'stm-floor-edit-rare-chip');
          rBtn.type = 'button';
          rBtn.append(
            createIconNode(doc, iconName, 'stm-floor-chip-icon'),
            el('span', '', label),
          );
          rBtn.addEventListener('click', evt => {
            evt.preventDefault();
            evt.stopPropagation();
            triggerNativeFloorButton(mesEl.querySelector?.(sel), 'click', root);
          });
          rareStrip.append(rBtn);
        }

        rareToggleBtn.addEventListener('click', evt => {
          evt.preventDefault();
          evt.stopPropagation();
          rareOpen = !rareOpen;
          rareStrip.hidden = !rareOpen;
          rareToggleBtn.classList.toggle('is-active', rareOpen);
        });

        leftGroup.append(delBtn, rareToggleBtn);

        const rightGroup = el('div', 'stm-floor-edit-right');
        const cancelBtn = el('button', 'stm-floor-edit-btn-item stm-floor-edit-cancel', '取消');
        cancelBtn.type = 'button';
        cancelBtn.addEventListener('click', evt => {
          evt.preventDefault();
          evt.stopPropagation();
          triggerNativeFloorButton(mesEl.querySelector?.('.mes_edit_cancel'), 'click', root);
          scheduleSync();
        });

        const saveBtn = el('button', 'stm-floor-edit-btn-item stm-floor-edit-save');
        saveBtn.type = 'button';
        saveBtn.append(
          createIconNode(doc, 'check', 'stm-floor-edit-svg'),
          el('span', '', '保存'),
        );
        saveBtn.addEventListener('click', evt => {
          evt.preventDefault();
          evt.stopPropagation();
          triggerNativeFloorButton(mesEl.querySelector?.('.mes_edit_done'), 'click', root);
          scheduleSync();
        });

        rightGroup.append(cancelBtn, saveBtn);

        const mainRow = el('div', 'stm-floor-edit-main');
        mainRow.append(leftGroup, rightGroup);
        editBar.append(mainRow, rareStrip);
        mesBlock.append(editBar);
      }
      editBar.hidden = false;
      // 确保编辑栏始终处于 .mes_block 最底部（紧贴 textarea 下方）
      if (mesBlock.lastElementChild !== editBar) {
        mesBlock.append(editBar);
      }
    } else if (editBar) {
      editBar.hidden = true;
    }
  }

  function syncAllFloorsNow() {
    syncRaf = 0;
    const doc = getDoc();
    if (!doc) return;
    const current = store?.get?.();
    const shouldEnable = Boolean(
      current?.shellEnabled && current?.floorActionsBottom !== false,
    );

    if (!shouldEnable) {
      teardownActiveDom();
      return;
    }

    if (!active) {
      active = true;
      doc.body?.classList?.add(BODY_ACTIVE_CLASS);
      ensureListenersAndObserver();
    }

    const chatEl = doc.getElementById('chat');
    if (!chatEl) return;

    const floors = chatEl.children
      ? [...chatEl.children].filter(node => node?.classList?.contains('mes'))
      : chatEl.querySelectorAll?.('.mes') || [];
    for (const mesEl of floors) {
      ensureFloorBarsOnMessage(mesEl);
    }

    if (isMenuOpen() && menuMesEl && !menuMesEl.isConnected) {
      closeMenu();
    }
  }

  function scheduleSync() {
    if (syncRaf) return;
    if (typeof root?.requestAnimationFrame === 'function') {
      syncRaf = root.requestAnimationFrame(syncAllFloorsNow);
    } else {
      syncRaf = setTimeout(syncAllFloorsNow, 16);
    }
  }

  function ensureListenersAndObserver() {
    const doc = getDoc();
    if (!doc) return;

    if (!docClickHandler) {
      docClickHandler = evt => {
        if (!isMenuOpen()) return;
        const t = evt.target;
        if (menuEl?.contains(t) || menuAnchorEl?.contains(t)) return;
        closeMenu();
      };
      doc.addEventListener('click', docClickHandler, true);
    }

    if (!keydownHandler) {
      keydownHandler = evt => {
        if (evt.key === 'Escape' && isMenuOpen()) {
          closeMenu();
        }
      };
      doc.addEventListener('keydown', keydownHandler, true);
    }

    if (!scrollCloseHandler) {
      scrollCloseHandler = evt => {
        if (!isMenuOpen()) return;
        if (menuEl?.contains(evt.target)) return;
        closeMenu();
      };
      const chatEl = doc.getElementById('chat');
      chatEl?.addEventListener('scroll', scrollCloseHandler, { passive: true });
    }

    if (!resizeCloseHandler && typeof root?.addEventListener === 'function') {
      resizeCloseHandler = () => {
        if (isMenuOpen()) positionMenu();
      };
      root.addEventListener('resize', resizeCloseHandler, { passive: true });
    }

    const chatEl = doc.getElementById('chat');
    if (chatEl && !observer && typeof root?.MutationObserver === 'function') {
      observer = new root.MutationObserver(mutations => {
        for (const m of mutations) {
          const target = m.target;
          if (
            target &&
            typeof target.closest === 'function' &&
            target.closest('.stm-floor-bar, .stm-floor-edit-bar, .stm-floor-menu')
          ) {
            continue;
          }
          scheduleSync();
          return;
        }
      });
      observer.observe(chatEl, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'is_system', 'class'],
      });
    }
  }

  function detachListenersAndObserver() {
    const doc = getDoc();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (docClickHandler && doc) {
      doc.removeEventListener('click', docClickHandler, true);
      docClickHandler = null;
    }
    if (keydownHandler && doc) {
      doc.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }
    if (scrollCloseHandler && doc) {
      doc.getElementById('chat')?.removeEventListener('scroll', scrollCloseHandler);
      scrollCloseHandler = null;
    }
    if (resizeCloseHandler && typeof root?.removeEventListener === 'function') {
      root.removeEventListener('resize', resizeCloseHandler);
      resizeCloseHandler = null;
    }
  }

  function teardownActiveDom() {
    closeMenu();
    detachListenersAndObserver();
    if (syncRaf) {
      if (typeof root?.cancelAnimationFrame === 'function') {
        root.cancelAnimationFrame(syncRaf);
      } else {
        clearTimeout(syncRaf);
      }
      syncRaf = 0;
    }
    const doc = getDoc();
    if (doc) {
      doc.body?.classList?.remove(BODY_ACTIVE_CLASS);
      for (const cls of ['.stm-floor-bar', '.stm-floor-edit-bar']) {
        for (const node of [...(doc.querySelectorAll?.(cls) || [])]) {
          node.remove();
        }
      }
      menuEl?.remove();
      menuEl = null;
    }
    active = false;
  }

  function refresh() {
    syncAllFloorsNow();
  }

  function destroy() {
    teardownActiveDom();
  }

  return {
    refresh,
    closeMenu,
    isMenuOpen,
    destroy,
  };
}
