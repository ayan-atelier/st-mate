/**
 * ST伴侣 (st-mate) · 拼图「扩展面板」置顶总台大卡片 & 黄金顺序无损净化器
 * 设计与防崩准则：
 * 1. 在 #rm_extensions_block 顶部铺设全宽「砚台 · ST伴侣」直达横幅大卡片（免展开折叠条，一键打开设置中心或秒切顶栏样式）；
 * 2. 开启扩展面板净化时，按「ST伴侣横幅 -> 正则 -> 酒馆助手 -> 快速回复 -> 其他第三方链接插件 -> 底部折叠低频原生模块」清晰排布；
 * 3. 严禁使用 display:contents 与 subtree:true 深度监听（彻底杜绝 iOS TauriTavern 多插件重排闪退），关闭开关时 100% 归位原始 DOM。
 */

import { createIconNode, svgMarkup } from '../core/icons.js?v=0.9.12';
import { closeAllNativeDrawers } from './host-actions.js?v=0.9.12';

export const LOW_FREQ_BUILTIN_CONTAINER_IDS = Object.freeze([
  'vectors_container',
  'summarize_container',
  'expressions_container',
  'translation_container',
  'tts_container',
  'sd_container',
  'assets_container',
  'caption_container',
  'typing_indicator_container',
  'rvc_container',
  'stt_container',
  'audio_container',
  'silence_container',
  'objective_container',
  'blip_container',
  'live2d_container',
  'vrm_container',
  'timelines_container',
  'webllm_container',
  'rss_container',
  'websearch_container',
  'emulatorjs_container',
  'idle_container',
  'hypebot_container',
  'randomizer_container',
  'chromadb_container',
  'message_limit_container',
  'injects_container',
  'accuweather_container',
  'dice_container',
]);

const LOW_FREQ_SET = new Set(LOW_FREQ_BUILTIN_CONTAINER_IDS);

function readEntryHeaderLabel(node) {
  if (!node) return '';
  if (typeof node.querySelector === 'function') {
    const header =
      node.querySelector('.inline-drawer-header b') ||
      node.querySelector('.inline-drawer-header') ||
      node.querySelector('h4') ||
      node.querySelector('b');
    if (header?.textContent) {
      return String(header.textContent).trim();
    }
  }
  return String(node.textContent || '').trim().slice(0, 80);
}

/**
 * 识别扩展面板顶层子项类别与排序权重（纯函数，支持单测独立验证）。
 */
export function classifyExtensionEntry(node) {
  const tag = String(node?.tagName || '').toUpperCase();
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'TEMPLATE') {
    return { kind: 'ignore', tier: 99 };
  }
  const id = String(node?.id || '').trim();
  if (id === 'stm-ext-hero-card' || id === 'stm-ext-inline-drawer' || id === 'stm-ext-lowfreq-drawer') {
    return { kind: 'internal', tier: 0 };
  }
  if (tag === 'HR' || node?.dataset?.stmDeprecatedExtra === '1') {
    return { kind: 'deprecated_extra', tier: 7 };
  }
  if (id === 'regex_container') {
    return { kind: 'regex', tier: 1 };
  }

  const label = readEntryHeaderLabel(node);
  if (
    /^(?:TH-settings|tavern[-_]helper[-_]settings|js[-_]slash[-_]runner[-_]settings)$/i.test(id) ||
    /^酒馆助手|^Tavern\s*Helper\b|^JS-Slash-Runner\b/i.test(label)
  ) {
    return { kind: 'helper', tier: 2 };
  }

  if (id === 'qr_container') {
    return { kind: 'qr', tier: 3 };
  }

  if (LOW_FREQ_SET.has(id)) {
    return {
      kind: 'low_freq_builtin',
      tier: 6,
      subOrder: LOW_FREQ_BUILTIN_CONTAINER_IDS.indexOf(id),
    };
  }

  return { kind: 'third_party', tier: 4 };
}

/**
 * 扫描底栏「魔法棒」(#extensionsMenu) 中的可管理入口（始终保护 #stm-wand-entry 不被隐藏）。
 */
export function discoverWandEntries(doc) {
  const menu = doc?.getElementById?.('extensionsMenu');
  if (!menu?.children) return [];

  const results = [];
  const seenKeys = new Set();
  const skipTags = new Set(['SCRIPT', 'STYLE', 'HR', 'INPUT', 'TEXTAREA', 'SELECT', 'TEMPLATE']);

  for (const outer of [...menu.children]) {
    if (!outer) continue;
    const outerTag = String(outer.tagName || '').toUpperCase();
    if (skipTags.has(outerTag) || outer.id === 'stm-wand-entry') continue;

    const isContainer = Boolean(outer.classList?.contains?.('extension_container') && outer.children?.length);
    const items = isContainer ? [...outer.children] : [outer];

    for (const item of items) {
      if (!item || item.id === 'stm-wand-entry') continue;
      const itemTag = String(item.tagName || '').toUpperCase();
      if (skipTags.has(itemTag)) continue;

      let rawLabel = '';
      const childSpans =
        typeof item.querySelectorAll === 'function'
          ? [...item.querySelectorAll('span')]
          : item.children
            ? [...item.children].filter(c => String(c?.tagName || '').toUpperCase() === 'SPAN')
            : [];
      for (const sp of childSpans) {
        if (
          sp.classList?.contains?.('fa-solid') ||
          sp.classList?.contains?.('fa-regular') ||
          sp.classList?.contains?.('stm-inline-svg')
        ) {
          continue;
        }
        const t = String(sp.textContent || '').trim();
        if (t) {
          rawLabel = t;
          break;
        }
      }
      if (!rawLabel) {
        rawLabel = String(item.textContent || item.title || '').replace(/\s+/g, ' ').trim();
      }
      if (!rawLabel) continue;

      const label = rawLabel.slice(0, 80);
      const rawKey = item.id
        ? `id:${item.id}`
        : isContainer && outer.id
          ? `wrap:${outer.id}:${label}`
          : `label:${label}`;
      const key = rawKey.slice(0, 120);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      results.push({
        key,
        label,
        element: item,
        wrapper: isContainer ? outer : null,
      });
    }
  }

  return results;
}

export function createExtensionsTidy({
  root = globalThis,
  store,
  stmVersion = '0.8.4',
  onOpenSettings,
  onToggleShell,
  onSwitchTopbarMode,
} = {}) {
  let heroCardEl = null;
  let lowFreqDrawerEl = null;
  let lowFreqBodyEl = null;
  let lowFreqCountSpan = null;
  let lowFreqToggleBtn = null;
  let lowFreqExpanded = false;

  let drawerClassObserver = null;
  let hostChildObserver = null;
  let wandChildObserver = null;
  let observedDrawerEl = null;
  let observedCol1 = null;
  let observedCol2 = null;
  let observedWandEl = null;
  let syncRaf = 0;
  let isMutating = false;
  let layoutIsTidied = false;

  const recordedNodes = new WeakSet();
  const originalRecords = [];

  function el(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function rememberOrigin(node) {
    if (!node || !node.parentNode || recordedNodes.has(node)) return;
    const siblings = node.parentNode.children ? [...node.parentNode.children] : [];
    recordedNodes.add(node);
    originalRecords.push({
      node,
      parent: node.parentNode,
      initialOrder: originalRecords.length,
      initialIndex: Math.max(0, siblings.indexOf(node)),
    });
  }

  function appendOrderedChildren(container, desiredNodes) {
    if (!container) return;
    const isIgnoredTag = n => {
      const t = String(n?.tagName || '').toUpperCase();
      return t === 'SCRIPT' || t === 'STYLE' || t === 'LINK' || t === 'TEMPLATE';
    };
    const currentKids = (container.children ? [...container.children] : []).filter(
      n => n !== heroCardEl && n !== lowFreqDrawerEl && !isIgnoredTag(n),
    );
    let needsMove = currentKids.length !== desiredNodes.length;
    if (!needsMove) {
      for (let i = 0; i < desiredNodes.length; i += 1) {
        if (currentKids[i] !== desiredNodes[i]) {
          needsMove = true;
          break;
        }
      }
    }
    if (!needsMove) return;

    // 从后往前采用最小位移 insertBefore，绝不重复拔插已就位的 #regex_container / 酒馆助手节点（防止打断内部滚动或触发外部观察器刷新）
    let nextRef = null;
    for (let i = desiredNodes.length - 1; i >= 0; i -= 1) {
      const target = desiredNodes[i];
      if (!target) continue;
      const kids = container.children ? [...container.children] : [];
      const targetIdx = kids.indexOf(target);
      const refIdx = nextRef ? kids.indexOf(nextRef) : kids.length;
      if (target.parentNode !== container || targetIdx !== refIdx - 1) {
        if (typeof container.insertBefore === 'function') {
          container.insertBefore(target, nextRef);
        } else {
          container.appendChild(target);
        }
      }
      nextRef = target;
    }
  }

  function updateHeroCardCopy() {
    if (!heroCardEl) return;
    const s = store.get();
    const chipEl = heroCardEl._statusChip || heroCardEl.querySelector?.('.stm-ext-hero-chip');
    const modeBtn = heroCardEl._subActionBtn || heroCardEl.querySelector?.('.stm-ext-hero-mode-btn');
    if (chipEl) {
      const modeText = !s.shellEnabled
        ? '已挂起（原生态）'
        : s.topbarMode === 'native'
          ? '原版顶栏运行中'
          : '伴侣顶栏运行中';
      if (chipEl.textContent !== `v${stmVersion} · ${modeText}`) {
        chipEl.textContent = `v${stmVersion} · ${modeText}`;
      }
    }
    if (modeBtn) {
      let nextText = '切原版顶栏';
      let nextTitle = '保留酒馆美化主题的原版胶囊顶栏，同时继续使用伴侣各大工作台';
      if (!s.shellEnabled) {
        nextText = '恢复伴侣界面';
        nextTitle = '一键恢复 ST伴侣全部勾选模块';
      } else if (s.topbarMode === 'native') {
        nextText = '切伴侣顶栏';
        nextTitle = '切换为 ST伴侣极简沉浸顶栏';
      }
      if (modeBtn.textContent !== nextText) modeBtn.textContent = nextText;
      if (modeBtn.title !== nextTitle) modeBtn.title = nextTitle;
    }
  }

  function ensureHeroCard(doc, extBlock, col1) {
    // 清理旧版本折叠式卡片，统一升级为免展开直达横幅大卡片
    doc.getElementById?.('stm-ext-inline-drawer')?.remove?.();

    if (!heroCardEl || !heroCardEl.isConnected) {
      heroCardEl = doc.getElementById?.('stm-ext-hero-card') || el(doc, 'div', 'stm-ext-hero-card wide100p');
      heroCardEl.id = 'stm-ext-hero-card';
      heroCardEl.className = 'stm-ext-hero-card wide100p';
      heroCardEl.replaceChildren();

      const mainWrap = el(doc, 'div', 'stm-ext-hero-main');
      mainWrap.append(createIconNode(doc, 'spark', 'stm-ext-hero-icon'));

      const copyWrap = el(doc, 'div', 'stm-ext-hero-copy');
      const titleRow = el(doc, 'div', 'stm-ext-hero-title-row');
      const titleNode = el(doc, 'strong', 'stm-ext-hero-title', '砚台 · SillyTavern 伴侣');
      const statusChip = el(doc, 'span', 'stm-chip stm-ext-hero-chip', '');
      titleRow.append(titleNode, statusChip);

      const subNode = el(
        doc,
        'span',
        'stm-ext-hero-sub',
        '预设馆 · API多站子 · 角色与世界书 · 页面排版 · 书架与人设馆',
      );
      copyWrap.append(titleRow, subNode);
      mainWrap.append(copyWrap);

      const actionsWrap = el(doc, 'div', 'stm-ext-hero-actions');
      const subActionBtn = el(doc, 'button', 'stm-pill-btn stm-ext-hero-mode-btn', '');
      subActionBtn.type = 'button';
      subActionBtn.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        const s = store.get();
        if (!s.shellEnabled) {
          void onToggleShell?.(true);
        } else {
          const nextMode = s.topbarMode === 'native' ? 'rp' : 'native';
          if (typeof onSwitchTopbarMode === 'function') {
            onSwitchTopbarMode(nextMode);
          } else {
            store.update({ topbarMode: nextMode });
          }
        }
      });

      const openBtn = el(doc, 'button', 'stm-ext-hero-open-btn', '');
      openBtn.type = 'button';
      openBtn.innerHTML = `<span class="stm-inline-svg" aria-hidden="true">${svgMarkup('settings')}</span><span>打开设置中心</span>`;
      openBtn.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        closeAllNativeDrawers();
        onOpenSettings?.();
      });

      actionsWrap.append(subActionBtn, openBtn);
      heroCardEl.append(mainWrap, actionsWrap);
      heroCardEl._statusChip = statusChip;
      heroCardEl._subActionBtn = subActionBtn;
    }

    if (extBlock && col1 && col1.parentNode === extBlock) {
      const extKids = extBlock.children ? [...extBlock.children] : [];
      const heroIdx = extKids.indexOf(heroCardEl);
      const col1Idx = extKids.indexOf(col1);
      if (heroCardEl.parentNode !== extBlock || heroIdx !== col1Idx - 1) {
        if (typeof col1.before === 'function') {
          col1.before(heroCardEl);
        } else if (typeof extBlock.insertBefore === 'function') {
          extBlock.insertBefore(heroCardEl, col1);
        } else {
          extBlock.prepend?.(heroCardEl);
        }
      }
    } else if (col1 && heroCardEl.parentNode !== col1) {
      col1.prepend?.(heroCardEl);
    }

    updateHeroCardCopy();
  }

  function ensureLowFreqDrawer(doc, extBlock) {
    if (!lowFreqDrawerEl || !lowFreqDrawerEl.isConnected) {
      lowFreqDrawerEl =
        doc.getElementById?.('stm-ext-lowfreq-drawer') ||
        el(doc, 'div', 'stm-ext-lowfreq-drawer wide100p');
      lowFreqDrawerEl.id = 'stm-ext-lowfreq-drawer';
      lowFreqDrawerEl.className = 'stm-ext-lowfreq-drawer wide100p';
      lowFreqDrawerEl.replaceChildren();

      lowFreqToggleBtn = el(doc, 'button', 'stm-ext-lowfreq-toggle');
      lowFreqToggleBtn.type = 'button';
      lowFreqToggleBtn.setAttribute('aria-expanded', String(lowFreqExpanded));

      const leftSpan = el(doc, 'span', 'stm-ext-lowfreq-label');
      leftSpan.append(createIconNode(doc, 'fold', 'stm-row-icon'));
      lowFreqCountSpan = el(doc, 'span', '', '更多酒馆内置低频模块');
      leftSpan.append(lowFreqCountSpan);

      const caretSpan = createIconNode(doc, 'chevron', 'stm-ext-lowfreq-caret');
      lowFreqToggleBtn.append(leftSpan, caretSpan);

      lowFreqBodyEl = el(doc, 'div', 'stm-ext-lowfreq-body');
      lowFreqBodyEl.hidden = !lowFreqExpanded;

      lowFreqToggleBtn.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        lowFreqExpanded = !lowFreqExpanded;
        lowFreqDrawerEl.classList.toggle('is-open', lowFreqExpanded);
        lowFreqToggleBtn.setAttribute('aria-expanded', String(lowFreqExpanded));
        lowFreqBodyEl.hidden = !lowFreqExpanded;
      });

      lowFreqDrawerEl.classList.toggle('is-open', lowFreqExpanded);
      lowFreqDrawerEl.append(lowFreqToggleBtn, lowFreqBodyEl);
    }

    if (extBlock && lowFreqDrawerEl.parentNode !== extBlock) {
      extBlock.appendChild(lowFreqDrawerEl);
    }
    return lowFreqDrawerEl;
  }

  function restoreTidiedLayout(doc, extBlockHint = null) {
    const extBlock =
      extBlockHint || doc?.querySelector?.('#rm_extensions_block .extensions_block') || null;
    const hasTidiedClass = Boolean(extBlock?.classList?.contains?.('stm-ext-tidied'));
    if (!layoutIsTidied && !hasTidiedClass && !lowFreqDrawerEl) {
      return;
    }

    extBlock?.classList?.remove?.('stm-ext-tidied');

    if (originalRecords.length > 0) {
      const byParent = new Map();
      for (const rec of originalRecords) {
        if (!rec.parent || !rec.node) continue;
        if (rec.node === heroCardEl || rec.node === lowFreqDrawerEl) continue;
        if (!byParent.has(rec.parent)) byParent.set(rec.parent, []);
        byParent.get(rec.parent).push(rec);
      }
      for (const [parent, list] of byParent.entries()) {
        const sorted = list
          .slice()
          .sort((a, b) => a.initialIndex - b.initialIndex || a.initialOrder - b.initialOrder);
        for (const rec of sorted) {
          if (rec.node?.dataset) {
            delete rec.node.dataset.stmDeprecatedExtra;
          }
        }
        // 使用最小位移校验归位，绝不对已在原位的扩展面板重复 appendChild 导致点击失效与 MutationObserver 死循环
        const desired = sorted.map(rec => rec.node);
        const existingExtras = (parent.children ? [...parent.children] : []).filter(
          n => n && n !== heroCardEl && n !== lowFreqDrawerEl && !desired.includes(n),
        );
        appendOrderedChildren(parent, [...desired, ...existingExtras]);
      }
    }

    lowFreqDrawerEl?.remove?.();
    lowFreqDrawerEl = null;
    lowFreqBodyEl = null;
    lowFreqCountSpan = null;
    lowFreqToggleBtn = null;
    layoutIsTidied = false;
  }

  function applyWandMenuTidy(doc, settings) {
    const wandMenu = doc?.getElementById?.('extensionsMenu') || null;
    if (!wandMenu) return;

    const shouldApply = Boolean(
      settings?.shellEnabled &&
        settings?.tidy?.enabled !== false &&
        Array.isArray(settings?.tidy?.hiddenWandEntries) &&
        settings.tidy.hiddenWandEntries.length > 0,
    );

    const entries = discoverWandEntries(doc);
    const hiddenSet = shouldApply ? new Set(settings.tidy.hiddenWandEntries) : new Set();
    const wrappers = new Set();

    for (const entry of entries) {
      const hideThis = shouldApply && hiddenSet.has(entry.key);
      entry.element?.classList?.toggle?.('stm-wand-hidden', hideThis);
      if (entry.wrapper) wrappers.add(entry.wrapper);
    }

    for (const wrap of wrappers) {
      const kids = wrap.children ? [...wrap.children] : [];
      const anyVisible = kids.some(k => !k.classList?.contains?.('stm-wand-hidden'));
      wrap.classList?.toggle?.('stm-wand-wrap-empty', shouldApply && !anyVisible);
    }

    if (!shouldApply && typeof wandMenu.querySelectorAll === 'function') {
      for (const node of wandMenu.querySelectorAll('.stm-wand-hidden, .stm-wand-wrap-empty')) {
        node.classList?.remove?.('stm-wand-hidden', 'stm-wand-wrap-empty');
      }
    }
  }

  function syncNow() {
    syncRaf = 0;
    const doc = root?.document;
    if (!doc || isMutating) return;

    const s = store.get();
    const wandMenu = doc.getElementById?.('extensionsMenu') || null;
    if (wandMenu) {
      attachWandObserver(wandMenu);
      applyWandMenuTidy(doc, s);
    }

    const col1 = doc.getElementById?.('extensions_settings') || null;
    const col2 = doc.getElementById?.('extensions_settings2') || null;
    if (!col1 && !col2) return;

    const primaryCol = col1 || col2;
    const extBlock =
      (primaryCol?.parentNode?.classList?.contains?.('extensions_block')
        ? primaryCol.parentNode
        : doc.querySelector?.('#rm_extensions_block .extensions_block')) || null;

    attachObservers(doc, col1, col2);

    isMutating = true;
    try {
      ensureHeroCard(doc, extBlock, primaryCol);

      const shouldTidy = Boolean(
        s.shellEnabled && s.tidy?.enabled !== false && s.tidy?.tidyExtensionsPanel,
      );
      if (!shouldTidy) {
        restoreTidiedLayout(doc, extBlock);
        // 重新确保 heroCard 仍在顶部
        ensureHeroCard(doc, extBlock, primaryCol);
        return;
      }

      const candidatePool = [];
      const seen = new Set();
      const collectFrom = container => {
        if (!container?.children) return;
        for (const child of [...container.children]) {
          if (!child || seen.has(child)) continue;
          if (child === heroCardEl || child === lowFreqDrawerEl) continue;
          seen.add(child);
          rememberOrigin(child);
          candidatePool.push(child);
        }
      };

      collectFrom(col1);
      collectFrom(col2);
      if (lowFreqBodyEl) {
        collectFrom(lowFreqBodyEl);
      }

      // 收集 .extensions_block 底部的 (DEPRECATED) Extras API 分割线与面板一并归入低频收纳夹，并打上持久标记杜绝二次同步误迁回明面
      const deprecatedExtrasFromRoot = [];
      if (extBlock?.children) {
        let afterCols = false;
        for (const child of [...extBlock.children]) {
          if (child === col1 || child === col2) {
            afterCols = true;
            continue;
          }
          if (!afterCols || child === heroCardEl || child === lowFreqDrawerEl) continue;
          rememberOrigin(child);
          if (child?.dataset) {
            child.dataset.stmDeprecatedExtra = '1';
          }
          deprecatedExtrasFromRoot.push(child);
        }
      }

      const mainItems = [];
      const lowFreqItems = [];
      const deprecatedExtraItems = [];
      candidatePool.forEach((node, idx) => {
        const info = classifyExtensionEntry(node);
        if (info.kind === 'internal' || info.kind === 'ignore') return;
        if (info.kind === 'deprecated_extra') {
          deprecatedExtraItems.push(node);
        } else if (info.kind === 'low_freq_builtin') {
          lowFreqItems.push({ node, info, idx });
        } else {
          mainItems.push({ node, info, idx });
        }
      });
      for (const extraNode of deprecatedExtrasFromRoot) {
        if (!deprecatedExtraItems.includes(extraNode)) {
          deprecatedExtraItems.push(extraNode);
        }
      }

      mainItems.sort((a, b) => a.info.tier - b.info.tier || a.idx - b.idx);
      lowFreqItems.sort((a, b) => (a.info.subOrder ?? 999) - (b.info.subOrder ?? 999) || a.idx - b.idx);

      // 注意：应先把低频项移入底部收纳夹，再对 primaryCol 做最小位移校验，这样已在原位的主力项（如 #regex_container）全程 0 移动！
      const totalLowFreqCount = lowFreqItems.length;
      if (totalLowFreqCount > 0 || deprecatedExtraItems.length > 0) {
        const hostForDrawer = extBlock || primaryCol;
        ensureLowFreqDrawer(doc, hostForDrawer);
        if (lowFreqCountSpan) {
          lowFreqCountSpan.textContent = `更多酒馆内置低频模块（${totalLowFreqCount} 项 · 向量 / 总结 / 表情 / 语音等）`;
        }
        appendOrderedChildren(lowFreqBodyEl, [
          ...lowFreqItems.map(entry => entry.node),
          ...deprecatedExtraItems,
        ]);
        if (extBlock && lowFreqDrawerEl.parentNode === extBlock && extBlock.lastElementChild !== lowFreqDrawerEl) {
          extBlock.appendChild(lowFreqDrawerEl);
        }
      } else if (lowFreqDrawerEl) {
        lowFreqDrawerEl.remove?.();
        lowFreqDrawerEl = null;
        lowFreqBodyEl = null;
      }

      extBlock?.classList?.add?.('stm-ext-tidied');
      layoutIsTidied = true;
      appendOrderedChildren(
        primaryCol,
        mainItems.map(entry => entry.node),
      );
    } finally {
      // 清空本次同步自身产生的 DOM 变更队列，彻底杜绝 MutationObserver 微任务自我唤醒死循环
      hostChildObserver?.takeRecords?.();
      drawerClassObserver?.takeRecords?.();
      wandChildObserver?.takeRecords?.();
      isMutating = false;
    }
  }

  function scheduleSync() {
    if (syncRaf || isMutating) return;
    const req = root?.requestAnimationFrame || (fn => setTimeout(fn, 16));
    syncRaf = req(syncNow);
  }

  function attachWandObserver(wandMenu) {
    if (typeof root?.MutationObserver !== 'function' || !wandMenu) return;
    if (wandMenu === observedWandEl) return;
    wandChildObserver?.disconnect();
    wandChildObserver = new root.MutationObserver(() => {
      if (!isMutating) scheduleSync();
    });
    wandChildObserver.observe(wandMenu, { childList: true, subtree: false });
    observedWandEl = wandMenu;
  }

  function attachObservers(doc, col1, col2) {
    if (typeof root?.MutationObserver !== 'function') return;

    const rmDrawer = doc?.getElementById?.('rm_extensions_block') || null;
    if (rmDrawer && observedDrawerEl !== rmDrawer) {
      drawerClassObserver?.disconnect();
      drawerClassObserver = new root.MutationObserver(() => {
        if (rmDrawer.classList?.contains?.('openDrawer')) {
          scheduleSync();
        }
      });
      drawerClassObserver.observe(rmDrawer, { attributes: true, attributeFilter: ['class'] });
      observedDrawerEl = rmDrawer;
    }

    if (col1 !== observedCol1 || col2 !== observedCol2) {
      hostChildObserver?.disconnect();
      hostChildObserver = new root.MutationObserver(() => {
        if (!isMutating) scheduleSync();
      });
      // 严守 childList:true + subtree:false 铁律，绝不监听子插件内部渲染
      if (col1) hostChildObserver.observe(col1, { childList: true, subtree: false });
      if (col2) hostChildObserver.observe(col2, { childList: true, subtree: false });
      observedCol1 = col1;
      observedCol2 = col2;
    }
  }

  function destroy() {
    if (syncRaf) {
      if (typeof root?.cancelAnimationFrame === 'function') {
        root.cancelAnimationFrame(syncRaf);
      } else {
        clearTimeout(syncRaf);
      }
      syncRaf = 0;
    }
    drawerClassObserver?.disconnect();
    hostChildObserver?.disconnect();
    wandChildObserver?.disconnect();
    drawerClassObserver = null;
    hostChildObserver = null;
    wandChildObserver = null;
    observedDrawerEl = null;
    observedCol1 = null;
    observedCol2 = null;
    observedWandEl = null;

    const doc = root?.document;
    isMutating = true;
    try {
      applyWandMenuTidy(doc, { shellEnabled: false });
      restoreTidiedLayout(doc);
      heroCardEl?.remove?.();
      doc?.getElementById?.('stm-ext-hero-card')?.remove?.();
      heroCardEl = null;
    } finally {
      isMutating = false;
    }
  }

  return {
    sync: syncNow,
    refreshHeroStatus: updateHeroCardCopy,
    schedule: scheduleSync,
    destroy,
  };
}
