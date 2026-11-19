/**
 * ST伴侣 (st-mate) · 顶栏下拉「预设馆工作台」面板 (.stm-preset-dock)
 * 视觉与交互规范：
 * 1. 桌面端对齐 #sheld 聊天主栏宽度，窄屏 (<=1000px) 100vw 贴边，与 apiDock / readerDock / 原生抽屉 / 设置弹窗完美互斥；
 * 2. 一对一当前角色快捷绑定条 + 预设项一对多角色卡多选绑定面板 + 全局默认预设，切卡无感秒切且保护 API 连接不被覆盖；
 * 3. 「常用预设」与「预设仓库（归档收纳）」双视图分流，支持批量导入脱敏、纯净导出、另存副本、无损重命名与防误删保护；
 * 4. 核心参数调节（上下文快捷档位自动解锁高上限 / 最大回复 / 温度）+ 提示词条目开关、上下微调与内联编辑，350ms 防抖自动落盘。
 */

import { saveExportBlob } from '../core/file-saver.js?v=0.7.4';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.7.4';
import {
  closeAllNativeDrawers,
  getCurrentEntityMeta,
  openNativeDrawer,
  toastMessage,
} from '../shell/host-actions.js?v=0.7.4';
import { createPresetAssistantPanel } from './preset-assistant.js?v=0.7.4';
import {
  CONTEXT_QUICK_TIERS,
  MAX_TOKENS_QUICK_TIERS,
  PROMPT_ROLE_OPTIONS,
  UNLOCKED_MAX_CONTEXT,
  applyGenerationParams,
  captureCurrentPresetSnapshot,
  createCustomPromptEntry,
  createPresetAutoSaver,
  deleteCustomPromptEntry,
  deleteHostPreset,
  duplicateHostPreset,
  exportPresetToJsonString,
  filterPromptEntries,
  getBoundPresetForEntity,
  getEntityBindingKey,
  getHostPresetState,
  importPresetItems,
  listBindableEntities,
  movePromptEntryOrder,
  partitionPresetsByArchive,
  primeHostOpenAiModule,
  readGenerationParams,
  readOrderedPromptEntries,
  renameHostPreset,
  saveHostPreset,
  selectHostPresetByName,
  setBoundPresetForEntity,
  setDefaultPresetName,
  syncHostPromptManagerAndSettings,
  toggleArchivePreset,
  togglePromptEntryEnabled,
  updatePromptEntryFields,
} from './preset-backend.js?v=0.7.4';

const AUTO_SAVE_DEBOUNCE_MS = 350;

export function createPresetDock({
  getContext,
  store,
  onOpenStateChange,
  onBeforeOpen,
  onPresetChanged,
  onOpenApiDock,
}) {
  let dockEl = null;
  let bodyEl = null;
  let fileInputEl = null;
  let isOpen = false;
  let assistantOpen = false;
  let lastOpenedAt = 0;
  let boundsRaf = 0;

  // 预设馆视图与交互局部状态
  let activeVaultTab = 'common'; // 'common' | 'archived'
  let presetSearchQuery = '';
  let expandedManagePreset = ''; // 非激活预设按需点「管理」展开动作栏
  let bindingDrawerPreset = ''; // 当前展开一对多绑卡面板的预设名
  let bindingCharQuery = '';
  let bindingPinnedKeys = []; // 展开绑卡面板时锁定的置顶角色顺序（防连续勾选时行乱跳）
  let renamingPresetName = '';
  let renameDraft = '';
  let confirmDeletePresetName = '';
  let paramsExpanded = false; // 核心生成参数默认收起为单行摘要

  // 提示词条目列表与内联编辑状态
  let promptSearchQuery = '';
  let promptFilterMode = 'all'; // 'all' | 'enabled' | 'hide_markers'
  let expandedPromptId = '';
  let confirmDeletePromptId = '';

  // 防白改 & 防跨预设串写自动持久化状态机（绑定修改时刻的目标预设名与快照）
  let saveState = { tone: 'idle', text: '改动自动存盘' };
  let lastRenderedActivePreset = '';
  let internalBusy = false;

  // 局部刷新 DOM 引用（杜绝打字或拖滑杆时销毁重建焦点节点）
  let liveRefs = {
    saveBadgeEl: null,
    paramSummaryEl: null,
    presetListWrap: null,
    bindCharListWrap: null,
    promptCountSpan: null,
    promptListWrap: null,
  };

  function formatContextShort(tokens) {
    const n = Number(tokens) || 0;
    if (n >= 1000000) return `${Number((n / 1000000).toFixed(1))}M`;
    if (n >= 10240 && n % 1024 === 0) return `${Math.round(n / 1024)}K`;
    if (n >= 10000 && n % 1000 === 0) return `${Math.round(n / 1000)}K`;
    return String(n);
  }

  function formatGenParamsSummary(gp) {
    const tempStr = Number(gp.temperature || 0)
      .toFixed(2)
      .replace(/\.00$/, '.0');
    return `上下文 ${formatContextShort(gp.maxContext)} · 回复 ${gp.maxTokens} · 温度 ${tempStr}`;
  }

  const cleanups = [];

  function el(tag, className = '', text = '') {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
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

  function updateSaveBadgeVisual() {
    const badge = liveRefs.saveBadgeEl;
    if (!badge) return;
    badge.className = `stm-preset-save-badge is-${saveState.tone}`;
    badge.textContent = saveState.text;
  }

  function setSaveState(tone, text) {
    saveState = { tone, text };
    updateSaveBadgeVisual();
  }

  const autoSaver = createPresetAutoSaver({
    debounceMs: AUTO_SAVE_DEBOUNCE_MS,
    captureSnapshot: () => captureCurrentPresetSnapshot({ getContext }),
    persistSnapshot: async (targetPresetName, snapshotPayload) => {
      internalBusy = true;
      try {
        return await saveHostPreset(targetPresetName, snapshotPayload, {
          getContext,
          updateDropdown: false,
          selectSaved: false,
        });
      } catch (err) {
        console.warn('[ST伴侣] 自动落盘预设异常:', err);
        throw err;
      } finally {
        setTimeout(() => {
          internalBusy = false;
        }, 60);
      }
    },
    onStateChange: next => {
      setSaveState(next.tone, next.text);
    },
  });

  function scheduleAutoPersist() {
    autoSaver.schedule();
  }

  async function flushPendingPersistIfAny() {
    await autoSaver.flush();
  }

  const assistantPanel = createPresetAssistantPanel({
    getContext,
    store,
    autoSaver,
    onAppliedOrUndone: ({ result }) => {
      if (result?.isGuiPreset) {
        setSaveState('warn', '已内存生效 · 默认预设点「另存副本」防刷新丢失');
      } else if (result?.message) {
        setSaveState('ok', result.message);
      }
      onPresetChanged?.();
      if (isOpen) {
        renderBodyPreservingVaultScroll();
      }
    },
    onRequestCollapse: () => {
      assistantOpen = false;
      if (isOpen) {
        renderBodyPreservingVaultScroll();
      }
    },
    onOpenApiDock: () => {
      close();
      onOpenApiDock?.();
    },
  });

  function computePinnedKeysForBindingDrawer(targetPresetName) {
    const pinned = [];
    const activeKey = getEntityBindingKey(getContext?.());
    if (activeKey) pinned.push(activeKey);
    const bindings = store.get().presetStudio?.charBindings || {};
    for (const [k, v] of Object.entries(bindings)) {
      if (v === targetPresetName && !pinned.includes(k)) {
        pinned.push(k);
      }
    }
    return pinned;
  }

  async function triggerJsonDownload(fileName, jsonText) {
    const BlobCtor = globalThis.Blob || Blob;
    const blob = new BlobCtor([jsonText], { type: 'application/json;charset=utf-8' });
    return saveExportBlob(blob, fileName, {
      doc: globalThis.document,
      root: globalThis,
      textContent: jsonText,
    });
  }

  async function handleSelectPreset(targetName) {
    if (!targetName) return;
    await flushPendingPersistIfAny();

    internalBusy = true;
    try {
      const res = await selectHostPresetByName(targetName, { getContext });
      if (!res.ok) {
        toastMessage(`切换预设「${targetName}」失败`, 'warning');
        return;
      }
      renamingPresetName = '';
      expandedManagePreset = '';
      confirmDeletePresetName = '';
      confirmDeletePromptId = '';
      expandedPromptId = '';
      setSaveState('ok', `已启用预设：${targetName}`);
      onPresetChanged?.();
      if (isOpen) renderBody();
    } finally {
      setTimeout(() => {
        internalBusy = false;
      }, 80);
    }
  }

  function updatePresetStudioInStore(nextPresetStudio, { silent = true } = {}) {
    store.update({ presetStudio: nextPresetStudio }, { silent });
  }

  function renderBodyPreservingVaultScroll() {
    const bodyScroll = bodyEl ? bodyEl.scrollTop : 0;
    const presetScroll = liveRefs.presetListWrap ? liveRefs.presetListWrap.scrollTop : 0;
    const bindScroll = liveRefs.bindCharListWrap ? liveRefs.bindCharListWrap.scrollTop : 0;
    const promptScroll = liveRefs.promptListWrap ? liveRefs.promptListWrap.scrollTop : 0;
    const astLogScroll = assistantOpen ? assistantPanel.getScrollTop() : 0;
    renderBody();
    if (bodyEl) bodyEl.scrollTop = bodyScroll;
    if (liveRefs.presetListWrap) liveRefs.presetListWrap.scrollTop = presetScroll;
    if (liveRefs.bindCharListWrap) liveRefs.bindCharListWrap.scrollTop = bindScroll;
    if (liveRefs.promptListWrap) liveRefs.promptListWrap.scrollTop = promptScroll;
    if (assistantOpen) assistantPanel.setScrollTop(astLogScroll);
  }

  // ===========================================================================
  // 局部渲染 1：角色卡一对多多选绑定列表（搜索 & 连续勾选均不丢焦点与滚动位置）
  // ===========================================================================
  function renderBindCharacterListOnly(targetPresetName) {
    const wrap = liveRefs.bindCharListWrap;
    const doc = globalThis.document;
    if (!wrap || !doc) return;
    const prevScroll = wrap.scrollTop;
    wrap.replaceChildren();

    const ctx = getContext?.();
    const ps = store.get().presetStudio;
    const entities = listBindableEntities(ctx, {
      presetStudio: ps,
      query: bindingCharQuery,
      includeGroups: true,
      pinnedKeys: bindingPinnedKeys,
    });

    if (entities.length === 0) {
      wrap.append(
        el(
          'div',
          'stm-preset-empty-note',
          bindingCharQuery ? '未找到匹配的角色卡或群聊' : '当前酒馆暂无可绑定的角色卡',
        ),
      );
      return;
    }

    for (const ent of entities) {
      const isBoundHere = ent.boundPreset === targetPresetName;
      const isBoundOther = Boolean(ent.boundPreset && ent.boundPreset !== targetPresetName);

      const row = el('button', `stm-bind-char-row${isBoundHere ? ' is-checked' : ''}`);
      row.type = 'button';

      const checkBox = el('span', `stm-bind-checkbox${isBoundHere ? ' is-checked' : ''}`);
      if (isBoundHere) {
        checkBox.innerHTML = svgMarkup('check');
      }

      if (ent.thumbUrl) {
        const avatar = el('img', 'stm-bind-char-avatar');
        avatar.src = ent.thumbUrl;
        avatar.alt = '';
        avatar.loading = 'lazy';
        avatar.decoding = 'async';
        row.append(checkBox, avatar);
      } else {
        row.append(checkBox, createIconNode(doc, 'user', 'stm-row-icon'));
      }

      const nameWrap = el('span', 'stm-bind-char-main');
      nameWrap.append(el('span', 'stm-bind-char-name', ent.name));
      if (isBoundHere) {
        nameWrap.append(el('span', 'stm-bind-char-tag is-current', '已绑此预设'));
      } else if (isBoundOther) {
        nameWrap.append(el('span', 'stm-bind-char-tag is-transfer', `原绑：${ent.boundPreset}（点选转移）`));
      }
      row.append(nameWrap);

      row.addEventListener('click', () => {
        const latestPs = store.get().presetStudio;
        const curBound = getBoundPresetForEntity(latestPs, ent.key);
        const nextPs = setBoundPresetForEntity(
          latestPs,
          ent.key,
          curBound === targetPresetName ? '' : targetPresetName,
        );
        updatePresetStudioInStore(nextPs, { silent: true });

        // 若正处于该角色对话且刚为其绑上此预设，立即同步生效！
        const activeKey = getEntityBindingKey(getContext?.());
        if (activeKey && activeKey === ent.key && curBound !== targetPresetName) {
          void handleSelectPreset(targetPresetName);
          return;
        }
        onPresetChanged?.();
        renderBodyPreservingVaultScroll();
      });

      wrap.append(row);
    }

    if (prevScroll > 0) {
      wrap.scrollTop = prevScroll;
    }
  }

  // ===========================================================================
  // 局部渲染 2：「常用预设」与「预设仓库」列表区（搜索时不丢输入框焦点）
  // ===========================================================================
  function renderPresetListOnly() {
    const wrap = liveRefs.presetListWrap;
    const doc = globalThis.document;
    if (!wrap || !doc) return;
    const prevListScroll = wrap.scrollTop;
    wrap.replaceChildren();

    const hostState = getHostPresetState({ getContext, doc });
    const ps = store.get().presetStudio;
    const part = partitionPresetsByArchive(hostState.presetNames, ps, {
      activePresetName: hostState.activePreset,
      query: presetSearchQuery,
    });

    const list = activeVaultTab === 'archived' ? part.archivedPresets : part.commonPresets;

    if (list.length === 0) {
      const emptyMsg = presetSearchQuery
        ? `在${activeVaultTab === 'archived' ? '预设仓库' : '常用预设'}中未找到匹配「${presetSearchQuery}」的预设`
        : activeVaultTab === 'archived'
          ? '预设仓库目前为空 · 可将平时低频使用的备用预设「收进仓库」，保持常用列表清爽'
          : part.totalArchivedCount > 0
            ? '所有预设均已收进「预设仓库」，可切到右侧仓库页签启用或移回常用'
            : '暂未读取到预设，可点击上方「导入预设」载入本地 .json 预设文件';
      wrap.append(el('div', 'stm-preset-empty-note', emptyMsg));
      return;
    }

    for (const item of list) {
      const isBindOpen = bindingDrawerPreset === item.name;
      const isRenamingThis = renamingPresetName === item.name;
      const showManageBar =
        item.isActive || expandedManagePreset === item.name || isBindOpen || isRenamingThis;
      const card = el('div', `stm-preset-item-wrap${item.isActive ? ' is-active' : ''}`);
      const mainRow = el('div', 'stm-preset-item-row');

      // 左侧点击切换预设主体（严格单行对齐：圆点永不掉行）
      const pickBtn = el('button', 'stm-preset-pick-btn');
      pickBtn.type = 'button';
      pickBtn.title = item.isActive ? `当前正在使用：${item.name}` : `点击切换至预设：${item.name}`;

      const indicator = el('span', `stm-preset-radio${item.isActive ? ' is-active' : ''}`);
      if (item.isActive) {
        indicator.innerHTML = svgMarkup('check');
      }
      pickBtn.append(indicator, el('span', 'stm-preset-item-name', item.name));

      pickBtn.addEventListener('click', () => {
        if (item.isActive) return;
        void handleSelectPreset(item.name);
      });

      const rightMeta = el('div', 'stm-preset-row-meta');
      if (item.isDefault) {
        rightMeta.append(el('span', 'stm-preset-badge is-default', '默认'));
      }
      if (item.boundCount > 0) {
        rightMeta.append(el('span', 'stm-preset-badge is-bound', `绑${item.boundCount}卡`));
      }

      if (!item.isActive) {
        const manageToggleBtn = el(
          'button',
          `stm-preset-manage-toggle${showManageBar ? ' is-open' : ''}`,
          showManageBar ? '收起 ▴' : '管理 ▾',
        );
        manageToggleBtn.type = 'button';
        manageToggleBtn.addEventListener('click', evt => {
          evt.stopPropagation();
          confirmDeletePresetName = '';
          if (showManageBar) {
            expandedManagePreset = '';
            if (bindingDrawerPreset === item.name) {
              bindingDrawerPreset = '';
              bindingPinnedKeys = [];
            }
          } else {
            expandedManagePreset = item.name;
          }
          renderPresetListOnly();
        });
        rightMeta.append(manageToggleBtn);
      }

      mainRow.append(pickBtn, rightMeta);
      card.append(mainRow);

      // 仅「当前使用中」或手动点「管理」时展开 5 项低频操作栏，保持列表清爽高密度
      if (showManageBar) {
        const actions = el('div', 'stm-preset-item-actions');

        // 1) 一对多绑卡按钮
        const bindBtn = el(
          'button',
          `stm-preset-mini-btn${isBindOpen || item.boundCount > 0 ? ' is-highlight' : ''}`,
        );
        bindBtn.type = 'button';
        bindBtn.title = '选择要绑定到此预设的一张或多张角色卡';
        bindBtn.append(
          createIconNode(doc, 'link', 'stm-inline-svg'),
          el('span', '', item.boundCount > 0 ? `绑卡(${item.boundCount})` : '绑卡'),
        );
        bindBtn.addEventListener('click', () => {
          if (bindingDrawerPreset === item.name) {
            bindingDrawerPreset = '';
            bindingPinnedKeys = [];
          } else {
            bindingDrawerPreset = item.name;
            bindingCharQuery = '';
            bindingPinnedKeys = computePinnedKeysForBindingDrawer(item.name);
          }
          renderPresetListOnly();
        });
        actions.append(bindBtn);

        // 2) 设为默认 / 取消默认按钮
        const defBtn = el('button', `stm-preset-mini-btn${item.isDefault ? ' is-active' : ''}`);
        defBtn.type = 'button';
        defBtn.title = item.isDefault
          ? '取消全局默认预设（恢复酒馆自由状态）'
          : '设为全局默认预设（所有未单独绑卡的角色进入时自动使用此预设）';
        defBtn.append(
          createIconNode(doc, 'pin', 'stm-inline-svg'),
          el('span', '', item.isDefault ? '取消默认' : '设为默认'),
        );
        defBtn.addEventListener('click', () => {
          const nextPs = setDefaultPresetName(
            store.get().presetStudio,
            item.isDefault ? '' : item.name,
          );
          updatePresetStudioInStore(nextPs, { silent: true });
          onPresetChanged?.();
          toastMessage(
            item.isDefault ? '已取消全局默认预设' : `已将「${item.name}」设为全局默认预设`,
            'info',
          );
          renderBodyPreservingVaultScroll();
        });
        actions.append(defBtn);

        // 3) 改名（就地展开输入框，自动同步全部角色卡绑定）
        if (!hostState.isGuiPreset) {
          const renBtn = el(
            'button',
            `stm-preset-mini-btn stm-preset-rename-btn${isRenamingThis ? ' is-active' : ''}`,
          );
          renBtn.type = 'button';
          renBtn.title = `重命名「${item.name}」（自动同步更新全部角色卡绑定）`;
          renBtn.append(
            createIconNode(doc, 'edit', 'stm-inline-svg'),
            el('span', '', isRenamingThis ? '取消改名' : '改名'),
          );
          renBtn.addEventListener('click', () => {
            if (renamingPresetName === item.name) {
              renamingPresetName = '';
            } else {
              renamingPresetName = item.name;
              renameDraft = item.name;
            }
            renderPresetListOnly();
          });
          actions.append(renBtn);
        }

        // 4) 收进仓库 / 移回常用
        const archBtn = el('button', 'stm-preset-mini-btn');
        archBtn.type = 'button';
        archBtn.title = item.isArchived
          ? '移回「常用预设」列表'
          : '收进「预设仓库」（文件完好保留，绑了此预设的角色卡依然自动切，只是平时不占常用列表）';
        archBtn.append(
          createIconNode(doc, 'archive', 'stm-inline-svg'),
          el('span', '', item.isArchived ? '移回常用' : '收进仓库'),
        );
        archBtn.addEventListener('click', () => {
          const nextPs = toggleArchivePreset(store.get().presetStudio, item.name, !item.isArchived);
          updatePresetStudioInStore(nextPs, { silent: true });
          if (bindingDrawerPreset === item.name) {
            bindingDrawerPreset = '';
            bindingPinnedKeys = [];
          }
          if (expandedManagePreset === item.name) {
            expandedManagePreset = '';
          }
          if (renamingPresetName === item.name) {
            renamingPresetName = '';
          }
          toastMessage(
            item.isArchived
              ? `已将「${item.name}」移回常用预设`
              : `已将「${item.name}」收进预设仓库`,
            'info',
          );
          renderBodyPreservingVaultScroll();
        });
        actions.append(archBtn);

        // 5) 导出备份
        const expBtn = el('button', 'stm-preset-mini-btn');
        expBtn.type = 'button';
        expBtn.title = `导出「${item.name}」为纯净 .json 备份文件（自动剥离连接敏感信息）`;
        expBtn.append(createIconNode(doc, 'upload', 'stm-inline-svg'), el('span', '', '导出'));
        expBtn.addEventListener('click', async () => {
          const exported = exportPresetToJsonString(item.name, { getContext });
          if (exported.ok === false) {
            toastMessage(`无法读取预设「${item.name}」的数据，请刷新后重试`, 'warning');
            return;
          }
          const saveRes = await triggerJsonDownload(exported.fileName, exported.jsonText);
          if (!saveRes?.cancelled && saveRes?.mode !== 'tauri-fallback') {
            toastMessage(`已导出预设：${exported.fileName}`, 'success');
          }
        });
        actions.append(expBtn);

        // 6) 防误删二次确认删除（仅非当前使用预设显示删除按钮，省去当前预设上的灰色无效按钮）
        if (!item.isActive && part.totalCount > 1) {
          const isConfirmingDel = confirmDeletePresetName === item.name;
          const delBtn = el(
            'button',
            `stm-preset-mini-btn is-danger${isConfirmingDel ? ' is-confirm' : ''}`,
          );
          delBtn.type = 'button';
          delBtn.title = '从酒馆永久删除此预设（建议删除前先点导出备份）';
          delBtn.append(
            createIconNode(doc, 'trash', 'stm-inline-svg'),
            el('span', '', isConfirmingDel ? '确认删除?' : '删除'),
          );
          delBtn.addEventListener('click', async () => {
            if (confirmDeletePresetName !== item.name) {
              confirmDeletePresetName = item.name;
              renderPresetListOnly();
              return;
            }
            confirmDeletePresetName = '';
            await flushPendingPersistIfAny();
            const res = await deleteHostPreset({ presetName: item.name, store, getContext });
            toastMessage(res.message, res.ok ? 'success' : 'warning');
            if (bindingDrawerPreset === item.name) {
              bindingDrawerPreset = '';
              bindingPinnedKeys = [];
            }
            if (expandedManagePreset === item.name) {
              expandedManagePreset = '';
            }
            if (renamingPresetName === item.name) {
              renamingPresetName = '';
            }
            onPresetChanged?.();
            if (isOpen) renderBodyPreservingVaultScroll();
          });
          actions.append(delBtn);
        }

        card.append(actions);
      }

      // 若点击了该预设的「改名」，就地在预设行内展开改名框
      if (isRenamingThis) {
        const renameBar = el('div', 'stm-preset-rename-bar');
        const rInput = el('input', 'stm-api-input stm-compact-input');
        rInput.type = 'text';
        rInput.value = renameDraft;
        rInput.placeholder = '输入新的预设名称…';

        const submitRename = async () => {
          const nextName = rInput.value.trim();
          if (!nextName || nextName === item.name) {
            renamingPresetName = '';
            renderPresetListOnly();
            return;
          }
          try {
            await flushPendingPersistIfAny();
            const res = await renameHostPreset({
              oldName: item.name,
              newName: nextName,
              store,
              getContext,
            });
            renamingPresetName = '';
            if (expandedManagePreset === item.name) {
              expandedManagePreset = res.name || '';
            }
            if (res.ok) {
              toastMessage(`已重命名为「${res.name}」（角色绑定已自动同步）`, 'success');
              setSaveState('ok', '重命名已生效');
              onPresetChanged?.();
            }
            renderBodyPreservingVaultScroll();
          } catch (err) {
            toastMessage(err?.message || '重命名失败', 'warning');
          }
        };

        rInput.addEventListener('input', () => {
          renameDraft = rInput.value;
        });
        rInput.addEventListener('keydown', evt => {
          if (evt.key === 'Enter') {
            evt.preventDefault();
            void submitRename();
          } else if (evt.key === 'Escape') {
            evt.stopPropagation();
            renamingPresetName = '';
            renderPresetListOnly();
          }
        });

        const okBtn = el('button', 'stm-connect-btn stm-compact-btn', '确认');
        okBtn.type = 'button';
        okBtn.addEventListener('click', () => void submitRename());

        const cancelBtn = el('button', 'stm-probe-btn stm-compact-btn', '取消');
        cancelBtn.type = 'button';
        cancelBtn.addEventListener('click', () => {
          renamingPresetName = '';
          renderPresetListOnly();
        });

        renameBar.append(rInput, okBtn, cancelBtn);
        card.append(renameBar);
        setTimeout(() => rInput.focus?.(), 10);
      }

      // 若点击了该预设的「绑卡」，在下方原地展开角色卡多选面板
      if (isBindOpen) {
        const drawer = el('div', 'stm-bind-drawer');
        const dHead = el('div', 'stm-bind-drawer-head');
        dHead.append(
          el(
            'span',
            'stm-bind-drawer-title',
            `勾选要专属使用「${item.name}」的角色卡（进卡自动秒切，取消勾选改回全局默认）`,
          ),
        );

        const dHeadRight = el('div', 'stm-bind-drawer-actions');
        if (item.boundCount > 0) {
          const clearAllBtn = el('button', 'stm-danger-link', '清空此预设绑卡');
          clearAllBtn.type = 'button';
          clearAllBtn.addEventListener('click', () => {
            const curPs = store.get().presetStudio;
            let nextPs = curPs;
            for (const k of item.boundKeys) {
              nextPs = setBoundPresetForEntity(nextPs, k, '');
            }
            updatePresetStudioInStore(nextPs, { silent: true });
            renderBodyPreservingVaultScroll();
          });
          dHeadRight.append(clearAllBtn);
        }

        const closeBindBtn = el('button', 'stm-reset-link', '收起 ▴');
        closeBindBtn.type = 'button';
        closeBindBtn.addEventListener('click', () => {
          bindingDrawerPreset = '';
          bindingPinnedKeys = [];
          renderPresetListOnly();
        });
        dHeadRight.append(closeBindBtn);
        dHead.append(dHeadRight);

        const searchWrap = el('div', 'stm-model-search-box');
        searchWrap.append(createIconNode(doc, 'search', 'stm-model-search-icon'));
        const charSearchInput = el('input', 'stm-api-input stm-model-combo-input stm-compact-input');
        charSearchInput.type = 'text';
        charSearchInput.placeholder = '搜索角色卡名称…';
        charSearchInput.value = bindingCharQuery;
        charSearchInput.addEventListener('input', () => {
          bindingCharQuery = charSearchInput.value;
          renderBindCharacterListOnly(item.name);
        });
        searchWrap.append(charSearchInput);

        const charListWrap = el('div', 'stm-bind-char-grid');
        liveRefs.bindCharListWrap = charListWrap;

        drawer.append(dHead, searchWrap, charListWrap);
        card.append(drawer);
        renderBindCharacterListOnly(item.name);
      }

      wrap.append(card);
    }

    if (prevListScroll > 0) {
      wrap.scrollTop = prevListScroll;
    }
  }

  // ===========================================================================
  // 局部渲染 3：提示词条目列表与内联编辑器（搜索/过滤/编辑均保持流畅焦点）
  // ===========================================================================
  function refreshPromptCounterHeader() {
    if (!liveRefs.promptCountSpan) return;
    const oai = getContext?.()?.chatCompletionSettings || {};
    const stats = readOrderedPromptEntries(oai);
    liveRefs.promptCountSpan.textContent = `已启用 ${stats.enabledCount} / 共 ${stats.totalCount} 条`;
  }

  function renderPromptListOnly() {
    const wrap = liveRefs.promptListWrap;
    const doc = globalThis.document;
    if (!wrap || !doc) return;
    wrap.replaceChildren();

    const ctx = getContext?.();
    const oai = ctx?.chatCompletionSettings;
    if (!oai || typeof oai !== 'object') {
      wrap.append(el('div', 'stm-preset-empty-note', '当前尚未加载聊天补全预设数据'));
      return;
    }

    const { entries, enabledCount, totalCount } = readOrderedPromptEntries(oai);
    if (liveRefs.promptCountSpan) {
      liveRefs.promptCountSpan.textContent = `已启用 ${enabledCount} / 共 ${totalCount} 条`;
    }

    const visibleEntries = filterPromptEntries(entries, {
      query: promptSearchQuery,
      filterMode: promptFilterMode,
    });

    if (visibleEntries.length === 0) {
      const msg =
        totalCount === 0
          ? '当前预设暂无提示词条目，可点击右上角「+ 新增条目」创建'
          : '没有符合当前筛选或搜索词的提示词条目';
      wrap.append(el('div', 'stm-preset-empty-note', msg));
      return;
    }

    const canReorderDirectly = !promptSearchQuery.trim() && promptFilterMode === 'all';

    for (const entry of visibleEntries) {
      const isExpanded = expandedPromptId === entry.identifier;
      const itemBox = el(
        'div',
        `stm-prompt-card${entry.enabled ? '' : ' is-disabled'}${isExpanded ? ' is-expanded' : ''}`,
      );

      const bar = el('div', 'stm-prompt-bar');

      // 1) 左侧大触控热区开关
      const toggleBtn = el('button', `stm-prompt-toggle${entry.enabled ? ' is-on' : ''}`);
      toggleBtn.type = 'button';
      toggleBtn.setAttribute('role', 'switch');
      toggleBtn.setAttribute('aria-checked', String(entry.enabled));
      toggleBtn.title = entry.enabled ? '点击停用此条目' : '点击启用此条目';
      toggleBtn.append(el('span', 'stm-prompt-toggle-knob'));
      toggleBtn.addEventListener('click', evt => {
        evt.stopPropagation();
        togglePromptEntryEnabled(oai, entry.identifier);
        void syncHostPromptManagerAndSettings({ getContext, changedPromptId: entry.identifier });
        scheduleAutoPersist();
        if (promptFilterMode === 'enabled') {
          renderPromptListOnly();
        } else {
          const nowEnabled = !entry.enabled;
          entry.enabled = nowEnabled;
          itemBox.classList.toggle('is-disabled', !nowEnabled);
          toggleBtn.classList.toggle('is-on', nowEnabled);
          toggleBtn.setAttribute('aria-checked', String(nowEnabled));
          refreshPromptCounterHeader();
        }
      });

      // 2) 中间条目名 + 轻巧角色/槽位徽章（点击展开内联编辑）
      const mainBtn = el('button', 'stm-prompt-main-btn');
      mainBtn.type = 'button';
      const titleSpan = el('span', 'stm-prompt-name', entry.name);
      mainBtn.append(titleSpan);

      const metaBadges = el('span', 'stm-prompt-badges');
      if (entry.isMarker) {
        metaBadges.append(el('span', 'stm-prompt-tag is-marker', '系统槽'));
      } else {
        metaBadges.append(el('span', `stm-prompt-tag is-role-${entry.role}`, entry.roleBadge));
        if (entry.injectionPosition === 1) {
          metaBadges.append(el('span', 'stm-prompt-tag is-depth', `@D${entry.injectionDepth}`));
        }
        if (entry.isSystemPrompt) {
          metaBadges.append(el('span', 'stm-prompt-tag is-sys', '内置'));
        }
      }
      mainBtn.append(metaBadges);

      mainBtn.addEventListener('click', () => {
        confirmDeletePromptId = '';
        expandedPromptId = isExpanded ? '' : entry.identifier;
        renderPromptListOnly();
      });

      // 3) 右侧上下移动微调按钮 + 展开箭头
      const rightCtrl = el('div', 'stm-prompt-right-ctrl');

      const upBtn = el('button', 'stm-prompt-order-btn');
      upBtn.type = 'button';
      upBtn.disabled = !canReorderDirectly || entry.index === 0;
      upBtn.title = canReorderDirectly ? '上移一位' : '请先切回「全部」且清空搜索框再调整发送顺序';
      upBtn.innerHTML = svgMarkup('arrowup');
      upBtn.addEventListener('click', evt => {
        evt.stopPropagation();
        if (movePromptEntryOrder(oai, entry.identifier, 'up')) {
          void syncHostPromptManagerAndSettings({ getContext });
          scheduleAutoPersist();
          renderPromptListOnly();
        }
      });

      const downBtn = el('button', 'stm-prompt-order-btn');
      downBtn.type = 'button';
      downBtn.disabled = !canReorderDirectly || entry.index >= totalCount - 1;
      downBtn.title = canReorderDirectly ? '下移一位' : '请先切回「全部」且清空搜索框再调整发送顺序';
      downBtn.innerHTML = svgMarkup('arrowdown');
      downBtn.addEventListener('click', evt => {
        evt.stopPropagation();
        if (movePromptEntryOrder(oai, entry.identifier, 'down')) {
          void syncHostPromptManagerAndSettings({ getContext });
          scheduleAutoPersist();
          renderPromptListOnly();
        }
      });

      const expandBtn = el('button', `stm-prompt-expand-btn${isExpanded ? ' is-open' : ''}`);
      expandBtn.type = 'button';
      expandBtn.title = isExpanded ? '收起编辑' : '展开查看或编辑';
      expandBtn.innerHTML = svgMarkup('chevron');
      expandBtn.addEventListener('click', evt => {
        evt.stopPropagation();
        confirmDeletePromptId = '';
        expandedPromptId = isExpanded ? '' : entry.identifier;
        renderPromptListOnly();
      });

      rightCtrl.append(upBtn, downBtn, expandBtn);
      bar.append(toggleBtn, mainBtn, rightCtrl);
      itemBox.append(bar);

      // 4) 内联编辑面板
      if (isExpanded) {
        const editor = el('div', 'stm-prompt-editor');

        if (entry.isMarker) {
          editor.append(
            el(
              'div',
              'stm-marker-explain',
              `${entry.markerHint}。此槽位由酒馆在每次对话时动态填充，无需手写正文；你可以通过左侧开关控制是否发送该模块，或用右侧上下箭头调整它在上下文中的先后顺序。`,
            ),
          );
        } else {
          // 第一行：条目名称 + 发送角色
          const row1 = el('div', 'stm-api-two-col');

          const nameField = el('div', 'stm-api-field');
          nameField.append(el('span', 'stm-cell-label', '条目名称'));
          const nameInput = el('input', 'stm-api-input stm-compact-input');
          nameInput.type = 'text';
          nameInput.value = entry.name;
          nameInput.placeholder = '输入条目名称';
          nameInput.addEventListener('input', () => {
            const val = nameInput.value.trim();
            if (val) {
              updatePromptEntryFields(oai, entry.identifier, { name: val });
              titleSpan.textContent = val;
              void syncHostPromptManagerAndSettings({
                getContext,
                changedPromptId: entry.identifier,
                immediateRender: false,
              });
              scheduleAutoPersist();
            }
          });
          nameField.append(nameInput);

          const roleField = el('div', 'stm-api-field');
          roleField.append(el('span', 'stm-cell-label', '发送角色'));
          const roleSelect = el('select', 'stm-api-select stm-compact-input');
          for (const rOpt of PROMPT_ROLE_OPTIONS) {
            const opt = el('option', '', rOpt.label);
            opt.value = rOpt.id;
            opt.selected = entry.role === rOpt.id;
            roleSelect.append(opt);
          }
          roleSelect.addEventListener('change', () => {
            updatePromptEntryFields(oai, entry.identifier, { role: roleSelect.value });
            void syncHostPromptManagerAndSettings({ getContext, changedPromptId: entry.identifier });
            scheduleAutoPersist();
            renderPromptListOnly();
          });
          roleField.append(roleSelect);
          row1.append(nameField, roleField);
          editor.append(row1);

          // 第二行：注入位置（相对顺序 vs 聊天记录内深度 @D）
          const posRow = el('div', 'stm-prompt-pos-row');
          const posField = el('div', 'stm-api-field stm-flex-grow');
          posField.append(el('span', 'stm-cell-label', '注入位置'));
          const posSelect = el('select', 'stm-api-select stm-compact-input');
          for (const [val, label] of [
            ['0', '按列表相对顺序发送'],
            ['1', '插入聊天记录指定深度 (@D)'],
          ]) {
            const opt = el('option', '', label);
            opt.value = val;
            opt.selected = String(entry.injectionPosition) === val;
            posSelect.append(opt);
          }
          posSelect.addEventListener('change', () => {
            updatePromptEntryFields(oai, entry.identifier, {
              injectionPosition: Number(posSelect.value),
            });
            void syncHostPromptManagerAndSettings({ getContext, changedPromptId: entry.identifier });
            scheduleAutoPersist();
            renderPromptListOnly();
          });
          posField.append(posSelect);
          posRow.append(posField);

          if (entry.injectionPosition === 1) {
            const depthField = el('div', 'stm-api-field stm-depth-num-field');
            depthField.append(el('span', 'stm-cell-label', '深度 (@D)'));
            const depthInput = el('input', 'stm-api-input stm-compact-input');
            depthInput.type = 'number';
            depthInput.min = '0';
            depthInput.max = '999';
            depthInput.value = String(entry.injectionDepth);
            depthInput.title = '0 表示紧贴最新消息之后，4 表示倒数第 4 条聊天消息之前';
            depthInput.addEventListener('input', () => {
              updatePromptEntryFields(oai, entry.identifier, {
                injectionDepth: Number(depthInput.value),
              });
              const depthBadge = metaBadges.querySelector('.is-depth');
              if (depthBadge) {
                depthBadge.textContent = `@D${Math.max(0, Math.min(999, Math.round(Number(depthInput.value) || 0)))}`;
              }
              void syncHostPromptManagerAndSettings({
                getContext,
                changedPromptId: entry.identifier,
                immediateRender: false,
              });
              scheduleAutoPersist();
            });
            depthField.append(depthInput);

            const ordField = el('div', 'stm-api-field stm-depth-num-field');
            ordField.append(el('span', 'stm-cell-label', '同深顺序'));
            const ordInput = el('input', 'stm-api-input stm-compact-input');
            ordInput.type = 'number';
            ordInput.min = '-999';
            ordInput.max = '9999';
            ordInput.value = String(entry.injectionOrder);
            ordInput.addEventListener('input', () => {
              updatePromptEntryFields(oai, entry.identifier, {
                injectionOrder: Number(ordInput.value),
              });
              void syncHostPromptManagerAndSettings({
                getContext,
                changedPromptId: entry.identifier,
                immediateRender: false,
              });
              scheduleAutoPersist();
            });
            ordField.append(ordInput);

            posRow.append(depthField, ordField);
          }
          editor.append(posRow);

          // 第三行：多行自适应提示词正文
          const contentField = el('div', 'stm-api-field');
          const contentHead = el('div', 'stm-cell-head');
          contentHead.append(el('span', 'stm-cell-label', '提示词正文 (支持 {{char}} / {{user}} 等酒馆宏)'));
          const charLenSpan = el('span', 'stm-cell-label', `${entry.content.length} 字符`);
          contentHead.append(charLenSpan);

          const textarea = el('textarea', 'stm-prompt-textarea');
          textarea.rows = Math.min(12, Math.max(5, entry.content.split('\n').length + 1));
          textarea.placeholder = '在此输入提示词内容…';
          textarea.value = entry.content;
          textarea.addEventListener('input', () => {
            const nextContent = textarea.value;
            entry.content = nextContent;
            charLenSpan.textContent = `${nextContent.length} 字符`;
            updatePromptEntryFields(oai, entry.identifier, { content: nextContent });
            void syncHostPromptManagerAndSettings({
              getContext,
              changedPromptId: entry.identifier,
              immediateRender: false,
            });
            scheduleAutoPersist();
          });

          contentField.append(contentHead, textarea);
          editor.append(contentField);

          // 底部：收起 + 删除/内置保护提示
          const footRow = el('div', 'stm-prompt-editor-foot');
          const foldEditBtn = el('button', 'stm-reset-link', '收起编辑 ▴');
          foldEditBtn.type = 'button';
          foldEditBtn.addEventListener('click', () => {
            expandedPromptId = '';
            confirmDeletePromptId = '';
            renderPromptListOnly();
          });
          footRow.append(foldEditBtn);

          if (entry.canDelete) {
            const isConfirmDel = confirmDeletePromptId === entry.identifier;
            const delEntryBtn = el('button', `stm-danger-link${isConfirmDel ? ' is-confirm' : ''}`);
            delEntryBtn.type = 'button';
            delEntryBtn.append(
              createIconNode(doc, 'trash', 'stm-inline-svg'),
              el('span', '', isConfirmDel ? '再次点击确认删除此条目' : '删除此条目'),
            );
            delEntryBtn.addEventListener('click', () => {
              if (confirmDeletePromptId !== entry.identifier) {
                confirmDeletePromptId = entry.identifier;
                renderPromptListOnly();
                return;
              }
              const res = deleteCustomPromptEntry(oai, entry.identifier);
              if (res.ok) {
                expandedPromptId = '';
                confirmDeletePromptId = '';
                void syncHostPromptManagerAndSettings({
                  getContext,
                  immediateRender: true,
                  structuralChange: true,
                });
                scheduleAutoPersist();
                toastMessage(`已删除条目：${entry.name}`, 'info');
                renderPromptListOnly();
              }
            });
            footRow.append(delEntryBtn);
          } else {
            footRow.append(
              el('span', 'stm-sys-protect-note', '酒馆核心内置槽位（可自由修改内容或关闭开关，不可物理删除）'),
            );
          }

          editor.append(footRow);
        }

        itemBox.append(editor);
      }

      wrap.append(itemBox);
    }
  }

  // ===========================================================================
  // 完整主视图渲染
  // ===========================================================================
  function renderBody() {
    const doc = globalThis.document;
    if (!doc || !bodyEl) return;
    bodyEl.replaceChildren();

    liveRefs = {
      saveBadgeEl: null,
      paramSummaryEl: null,
      presetListWrap: null,
      bindCharListWrap: null,
      promptCountSpan: null,
      promptListWrap: null,
    };

    const ctx = getContext?.();
    const hostState = getHostPresetState({ getContext, doc });
    const ps = store.get().presetStudio;
    const activePreset = hostState.activePreset;
    lastRenderedActivePreset = activePreset;

    const part = partitionPresetsByArchive(hostState.presetNames, ps, {
      activePresetName: activePreset,
      query: presetSearchQuery,
    });

    // =========================================================================
    // 上半区（综合预设库）：单行工具栏（自动存盘移至右端）+ 角色绑定轻提示 + 预设列表
    // =========================================================================
    const secVault = el('section', 'stm-dock-section stm-preset-vault-zone');

    const topHead = el('div', 'stm-preset-topbar-compact');
    const fileActions = el('div', 'stm-api-head-links');

    const undoCount = assistantPanel.getUndoCount();
    const astToggleBtn = el(
      'button',
      `stm-assistant-toggle-btn${assistantOpen ? ' is-active' : ''}`,
    );
    astToggleBtn.type = 'button';
    astToggleBtn.setAttribute('aria-expanded', String(assistantOpen));
    astToggleBtn.title = assistantOpen
      ? '收起伴侣预设助手'
      : '展开伴侣预设助手（防抢话、冲突排查、文风润色、一键预览与多步撤回）';
    astToggleBtn.append(
      createIconNode(doc, 'spark', 'stm-inline-svg'),
      el('span', '', !assistantOpen && undoCount > 0 ? `伴侣助手 (${undoCount})` : '伴侣助手'),
    );
    astToggleBtn.addEventListener('click', () => {
      assistantOpen = !assistantOpen;
      renderBodyPreservingVaultScroll();
      if (assistantOpen) {
        assistantPanel.focusInput();
      }
    });

    const importBtn = el('button', 'stm-ghost-link');
    importBtn.type = 'button';
    importBtn.title = '支持单选或多选批量导入 .json 对话预设（自动剥离外部反代与密码防污染）';
    importBtn.append(createIconNode(doc, 'download', 'stm-inline-svg'), el('span', '', '导入'));
    importBtn.addEventListener('click', () => {
      if (fileInputEl) {
        fileInputEl.value = '';
        fileInputEl.click();
      }
    });

    const exportBtn = el('button', 'stm-ghost-link');
    exportBtn.type = 'button';
    exportBtn.title = '将当前预设导出为纯净 .json 文件备份';
    exportBtn.append(createIconNode(doc, 'upload', 'stm-inline-svg'), el('span', '', '导出'));
    exportBtn.addEventListener('click', async () => {
      const exported = exportPresetToJsonString(activePreset, { getContext });
      if (exported.ok === false) {
        toastMessage(`导出预设失败：未找到「${activePreset}」数据`, 'warning');
        return;
      }
      const saveRes = await triggerJsonDownload(exported.fileName, exported.jsonText);
      if (!saveRes?.cancelled && saveRes?.mode !== 'tauri-fallback') {
        toastMessage(`已导出纯净预设：${exported.fileName}`, 'success');
      }
    });

    const dupBtn = el('button', 'stm-ghost-link');
    dupBtn.type = 'button';
    dupBtn.title = '将当前预设一键克隆为「· 副本」备份';
    dupBtn.append(createIconNode(doc, 'copy', 'stm-inline-svg'), el('span', '', '另存副本'));
    dupBtn.addEventListener('click', async () => {
      await flushPendingPersistIfAny();
      try {
        const saved = await duplicateHostPreset(activePreset, { getContext, selectDuplicate: true });
        if (saved.ok) {
          setSaveState('ok', `已另存并切至：${saved.name}`);
          toastMessage(`已创建预设副本：${saved.name}`, 'success');
          onPresetChanged?.();
          renderBody();
        }
      } catch (err) {
        toastMessage(err?.message || '另存副本失败', 'error');
      }
    });

    fileActions.append(astToggleBtn, importBtn, exportBtn, dupBtn);

    const rightSaveStatus = el('div', 'stm-preset-save-inline');
    rightSaveStatus.append(
      el('span', `stm-status-dot ${hostState.isGuiPreset ? 'is-warn' : 'is-ok'}`),
    );
    const saveBadge = el('span', `stm-preset-save-badge is-${saveState.tone}`, saveState.text);
    liveRefs.saveBadgeEl = saveBadge;
    rightSaveStatus.append(saveBadge);

    topHead.append(fileActions, rightSaveStatus);
    secVault.append(topHead);

    // 当前角色/群聊快捷绑定轻提示条（无厚外框）
    const entityMeta = getCurrentEntityMeta(ctx);
    const entityKey = getEntityBindingKey(ctx);
    if (entityMeta.active && entityKey) {
      const boundPreset = getBoundPresetForEntity(ps, entityKey);
      const boundExists = boundPreset ? hostState.presetNames.includes(boundPreset) : false;

      const charBar = el('div', 'stm-char-bind-banner is-clean-strip');
      const charInfo = el('div', 'stm-char-bind-left');

      if (entityMeta.thumbUrl) {
        const av = el('img', 'stm-char-bind-avatar');
        av.src = entityMeta.thumbUrl;
        av.alt = '';
        av.decoding = 'async';
        charInfo.append(av);
      }

      const textCol = el('div', 'stm-char-bind-copy');
      textCol.append(el('strong', 'stm-char-bind-name', entityMeta.name));

      let strategyDesc = '';
      if (boundPreset) {
        strategyDesc = boundExists
          ? `专属：${boundPreset}`
          : `原绑「${boundPreset}」已缺失`;
      } else if (ps.defaultPreset) {
        strategyDesc = `跟随默认（${ps.defaultPreset}）`;
      } else {
        strategyDesc = '未绑专属预设';
      }
      textCol.append(el('span', 'stm-char-bind-desc', strategyDesc));
      charInfo.append(textCol);

      const charBtns = el('div', 'stm-char-bind-actions');
      if (boundPreset) {
        if (activePreset && activePreset !== boundPreset) {
          const rebindBtn = el('button', 'stm-preset-bind-cta');
          rebindBtn.type = 'button';
          rebindBtn.append(
            createIconNode(doc, 'link', 'stm-inline-svg'),
            el('span', '', '改绑当前'),
          );
          rebindBtn.addEventListener('click', () => {
            const nextPs = setBoundPresetForEntity(store.get().presetStudio, entityKey, activePreset);
            updatePresetStudioInStore(nextPs, { silent: true });
            onPresetChanged?.();
            toastMessage(`已将「${activePreset}」绑定给 ${entityMeta.name}`, 'success');
            renderBody();
          });
          charBtns.append(rebindBtn);
        }

        const unbindBtn = el('button', 'stm-preset-mini-btn');
        unbindBtn.type = 'button';
        unbindBtn.append(
          createIconNode(doc, 'unlink', 'stm-inline-svg'),
          el('span', '', '解绑'),
        );
        unbindBtn.addEventListener('click', () => {
          const nextPs = setBoundPresetForEntity(store.get().presetStudio, entityKey, '');
          updatePresetStudioInStore(nextPs, { silent: true });
          const fallbackDefault = nextPs.defaultPreset;
          if (fallbackDefault && hostState.presetNames.includes(fallbackDefault) && fallbackDefault !== activePreset) {
            toastMessage(`已解除专属绑定，自动切回全局默认「${fallbackDefault}」`, 'info');
            void handleSelectPreset(fallbackDefault);
            return;
          }
          onPresetChanged?.();
          toastMessage(`已解除 ${entityMeta.name} 的专属预设绑定`, 'info');
          renderBody();
        });
        charBtns.append(unbindBtn);
      } else if (activePreset) {
        const bindCurBtn = el('button', 'stm-preset-bind-cta');
        bindCurBtn.type = 'button';
        bindCurBtn.title = `将当前预设「${activePreset}」设为 ${entityMeta.name} 的专属预设，今后进此卡自动秒切`;
        bindCurBtn.append(
          createIconNode(doc, 'link', 'stm-inline-svg'),
          el('span', '', '绑当前预设'),
        );
        bindCurBtn.addEventListener('click', () => {
          const nextPs = setBoundPresetForEntity(store.get().presetStudio, entityKey, activePreset);
          updatePresetStudioInStore(nextPs, { silent: true });
          onPresetChanged?.();
          toastMessage(`已将「${activePreset}」绑给 ${entityMeta.name}，今后进卡将自动切换`, 'success');
          renderBody();
        });
        charBtns.append(bindCurBtn);
      }

      charBar.append(charInfo, charBtns);
      secVault.append(charBar);
    }

    // 内嵌「伴侣预设助手」工作面板（挂载持久化 DOM 节点，重绘列表不丢对话与滚动态）
    if (assistantOpen) {
      const astEl = assistantPanel.getElement();
      if (astEl) {
        assistantPanel.syncStatus();
        secVault.append(astEl);
      }
    }

    const vaultToolbar = el('div', 'stm-preset-vault-bar');

    const tabsGroup = el('div', 'stm-preset-vault-tabs');
    for (const [tabKey, iconName, labelText] of [
      ['common', 'sliders', `常用预设 (${part.totalCommonCount})`],
      ['archived', 'archive', `预设仓库 (${part.totalArchivedCount})`],
    ]) {
      const tabBtn = el(
        'button',
        `stm-vault-tab${activeVaultTab === tabKey ? ' is-active' : ''}`,
      );
      tabBtn.type = 'button';
      tabBtn.append(createIconNode(doc, iconName, 'stm-inline-svg'), el('span', '', labelText));
      tabBtn.addEventListener('click', () => {
        if (activeVaultTab === tabKey) return;
        activeVaultTab = tabKey;
        expandedManagePreset = '';
        confirmDeletePresetName = '';
        renamingPresetName = '';
        renderBody();
      });
      tabsGroup.append(tabBtn);
    }

    const presetSearchBox = el('div', 'stm-model-search-box stm-preset-search-box');
    presetSearchBox.append(createIconNode(doc, 'search', 'stm-model-search-icon'));
    const presetSearchInput = el('input', 'stm-api-input stm-model-combo-input stm-compact-input');
    presetSearchInput.type = 'text';
    presetSearchInput.placeholder = '搜索预设名称…';
    presetSearchInput.value = presetSearchQuery;
    presetSearchInput.addEventListener('input', () => {
      presetSearchQuery = presetSearchInput.value;
      renderPresetListOnly();
    });
    presetSearchBox.append(presetSearchInput);

    vaultToolbar.append(tabsGroup, presetSearchBox);
    secVault.append(vaultToolbar);

    const presetListWrap = el('div', 'stm-preset-list');
    liveRefs.presetListWrap = presetListWrap;
    secVault.append(presetListWrap);
    renderPresetListOnly();

    bodyEl.append(secVault);

    // =========================================================================
    // 下半区（当前预设内部内容）：明确分区承接 + 弱化单行生成参数 + 提示词条目列表
    // =========================================================================
    const secPrompts = el('section', 'stm-dock-section stm-preset-detail-zone');

    const promptHead = el('div', 'stm-sec-head stm-preset-detail-head');
    const promptHeadLeft = el('div', 'stm-prompt-head-left');
    promptHeadLeft.append(el('span', 'stm-sec-title stm-preset-detail-title', '当前预设内容 · 提示词条目'));
    const countBadge = el('span', 'stm-preset-badge is-subtle', '');
    liveRefs.promptCountSpan = countBadge;
    promptHeadLeft.append(countBadge);

    const addPromptBtn = el('button', 'stm-station-add-btn stm-prompt-add-btn');
    addPromptBtn.type = 'button';
    addPromptBtn.append(createIconNode(doc, 'plus', 'stm-inline-svg'), el('span', '', '新增条目'));
    addPromptBtn.addEventListener('click', () => {
      const oai = getContext?.()?.chatCompletionSettings;
      if (!oai) return;
      const created = createCustomPromptEntry(oai, {
        name: '自定义提示词',
        role: 'system',
        enabled: true,
        content: '',
      });
      if (created) {
        promptFilterMode = 'all';
        promptSearchQuery = '';
        expandedPromptId = created.identifier;
        void syncHostPromptManagerAndSettings({
          getContext,
          changedPromptId: created.identifier,
          immediateRender: true,
          structuralChange: true,
        });
        scheduleAutoPersist();
        renderBody();
      }
    });

    promptHead.append(promptHeadLeft, addPromptBtn);
    secPrompts.append(promptHead);

    // 融合在「当前预设内容」标题正下方的无外框淡色单行生成参数（不抢戏，点「微调 ▾」按需展开滑杆）
    const genParams = readGenerationParams(ctx);
    const paramToggleBar = el(
      'button',
      `stm-param-summary-bar is-inline-subtle${paramsExpanded ? ' is-open' : ''}`,
    );
    paramToggleBar.type = 'button';
    paramToggleBar.setAttribute('aria-expanded', String(paramsExpanded));

    const paramLeft = el('span', 'stm-param-summary-left');
    paramLeft.append(el('span', 'stm-param-inline-prefix', '生成参数：'));
    const paramSummarySpan = el(
      'span',
      'stm-param-summary-text',
      formatGenParamsSummary(genParams),
    );
    liveRefs.paramSummaryEl = paramSummarySpan;
    paramLeft.append(paramSummarySpan);

    paramToggleBar.append(
      paramLeft,
      el('span', 'stm-param-summary-cta', paramsExpanded ? '收起 ▴' : '微调 ▾'),
    );
    paramToggleBar.addEventListener('click', () => {
      paramsExpanded = !paramsExpanded;
      renderBodyPreservingVaultScroll();
    });
    secPrompts.append(paramToggleBar);

    if (paramsExpanded) {
      const paramCard = el('div', 'stm-preset-param-card');

      // 3.1 上下文长度（滑杆 + 快捷档位胶囊 + 精确数字框）
      const ctxBlock = el('div', 'stm-param-row-block');
      const ctxHead = el('div', 'stm-param-head-line');
      const ctxLabelLeft = el('div', 'stm-param-title-group');
      ctxLabelLeft.append(el('span', 'stm-cell-label', '上下文长度'));
      const unlockBadge = el(
        'span',
        'stm-preset-badge is-subtle',
        genParams.maxContextUnlocked ? '高上限已解锁' : '标准上限',
      );
      ctxLabelLeft.append(unlockBadge);

      const ctxNumInput = el('input', 'stm-param-num-input');
      ctxNumInput.type = 'number';
      ctxNumInput.min = '512';
      ctxNumInput.max = String(UNLOCKED_MAX_CONTEXT);
      ctxNumInput.step = '512';
      ctxNumInput.value = String(genParams.maxContext);

      ctxHead.append(ctxLabelLeft, ctxNumInput);

      const ctxTiersRow = el('div', 'stm-tier-pills');
      const ctxRange = el('input', 'stm-range-input');
      ctxRange.type = 'range';
      ctxRange.min = '4096';
      ctxRange.max = String(UNLOCKED_MAX_CONTEXT);
      ctxRange.step = '1024';
      ctxRange.value = String(Math.min(UNLOCKED_MAX_CONTEXT, Math.max(4096, genParams.maxContext)));

      const tierButtons = [];
      const syncContextTierHighlights = val => {
        for (const { btn, tier } of tierButtons) {
          const matched = val >= tier.minMatch && val <= tier.maxMatch;
          btn.classList.toggle('is-active', matched);
        }
      };

      const commitMaxContext = nextVal => {
        const updated = applyGenerationParams({ maxContext: nextVal }, { getContext, doc });
        ctxNumInput.value = String(updated.maxContext);
        ctxRange.value = String(Math.min(UNLOCKED_MAX_CONTEXT, Math.max(4096, updated.maxContext)));
        unlockBadge.textContent = updated.maxContextUnlocked ? '高上限已解锁' : '标准上限';
        if (liveRefs.paramSummaryEl) {
          liveRefs.paramSummaryEl.textContent = formatGenParamsSummary(updated);
        }
        syncContextTierHighlights(updated.maxContext);
        scheduleAutoPersist();
      };

      for (const tier of CONTEXT_QUICK_TIERS) {
        const tBtn = el('button', 'stm-tier-pill', tier.label);
        tBtn.type = 'button';
        tBtn.addEventListener('click', () => commitMaxContext(tier.value));
        tierButtons.push({ btn: tBtn, tier });
        ctxTiersRow.append(tBtn);
      }
      syncContextTierHighlights(genParams.maxContext);

      ctxRange.addEventListener('input', () => {
        commitMaxContext(Number(ctxRange.value));
      });
      ctxNumInput.addEventListener('change', () => {
        commitMaxContext(Number(ctxNumInput.value));
      });

      ctxBlock.append(ctxHead, ctxTiersRow, ctxRange);
      paramCard.append(ctxBlock);

      // 3.2 双列并排：最大回复长度 + 回复温度
      const dualParams = el('div', 'stm-api-two-col');

      const tokBlock = el('div', 'stm-param-row-block');
      const tokHead = el('div', 'stm-param-head-line');
      tokHead.append(el('span', 'stm-cell-label', '最大回复长度'));
      const tokNumInput = el('input', 'stm-param-num-input');
      tokNumInput.type = 'number';
      tokNumInput.min = '16';
      tokNumInput.max = '131072';
      tokNumInput.step = '256';
      tokNumInput.value = String(genParams.maxTokens);
      tokHead.append(tokNumInput);

      const tokTiersRow = el('div', 'stm-tier-pills');
      const tokRange = el('input', 'stm-range-input');
      tokRange.type = 'range';
      tokRange.min = '256';
      tokRange.max = '65535';
      tokRange.step = '256';
      tokRange.value = String(Math.min(65535, Math.max(256, genParams.maxTokens)));

      const tokTierBtns = [];
      const syncTokTierHighlights = val => {
        for (const { btn, value } of tokTierBtns) {
          btn.classList.toggle('is-active', Math.abs(val - value) <= 64);
        }
      };

      const commitMaxTokens = nextVal => {
        const updated = applyGenerationParams({ maxTokens: nextVal }, { getContext, doc });
        tokNumInput.value = String(updated.maxTokens);
        tokRange.value = String(Math.min(65535, Math.max(256, updated.maxTokens)));
        if (liveRefs.paramSummaryEl) {
          liveRefs.paramSummaryEl.textContent = formatGenParamsSummary(updated);
        }
        syncTokTierHighlights(updated.maxTokens);
        scheduleAutoPersist();
      };

      for (const tier of MAX_TOKENS_QUICK_TIERS) {
        const b = el('button', 'stm-tier-pill', tier.label);
        b.type = 'button';
        b.addEventListener('click', () => commitMaxTokens(tier.value));
        tokTierBtns.push({ btn: b, value: tier.value });
        tokTiersRow.append(b);
      }
      syncTokTierHighlights(genParams.maxTokens);

      tokRange.addEventListener('input', () => commitMaxTokens(Number(tokRange.value)));
      tokNumInput.addEventListener('change', () => commitMaxTokens(Number(tokNumInput.value)));

      tokBlock.append(tokHead, tokTiersRow, tokRange);

      const tempBlock = el('div', 'stm-param-row-block');
      const tempHead = el('div', 'stm-param-head-line');
      tempHead.append(el('span', 'stm-cell-label', '回复温度'));
      const tempNumInput = el('input', 'stm-param-num-input stm-temp-num');
      tempNumInput.type = 'number';
      tempNumInput.min = '0';
      tempNumInput.max = '2';
      tempNumInput.step = '0.01';
      tempNumInput.value = genParams.temperature.toFixed(2);
      tempHead.append(tempNumInput);

      const tempQuickRow = el('div', 'stm-tier-pills');
      const tempRange = el('input', 'stm-range-input');
      tempRange.type = 'range';
      tempRange.min = '0';
      tempRange.max = '2';
      tempRange.step = '0.05';
      tempRange.value = String(genParams.temperature);

      const tempTierBtns = [];
      const syncTempHighlights = val => {
        for (const { btn, value } of tempTierBtns) {
          btn.classList.toggle('is-active', Math.abs(val - value) < 0.015);
        }
      };

      const commitTemperature = nextVal => {
        const updated = applyGenerationParams({ temperature: nextVal }, { getContext, doc });
        tempNumInput.value = updated.temperature.toFixed(2);
        tempRange.value = String(updated.temperature);
        if (liveRefs.paramSummaryEl) {
          liveRefs.paramSummaryEl.textContent = formatGenParamsSummary(updated);
        }
        syncTempHighlights(updated.temperature);
        scheduleAutoPersist();
      };

      for (const tVal of [0.7, 0.85, 1.0, 1.15, 1.3]) {
        const b = el('button', 'stm-tier-pill', tVal.toFixed(2).replace(/\.00$/, '.0'));
        b.type = 'button';
        b.addEventListener('click', () => commitTemperature(tVal));
        tempTierBtns.push({ btn: b, value: tVal });
        tempQuickRow.append(b);
      }
      syncTempHighlights(genParams.temperature);

      tempRange.addEventListener('input', () => commitTemperature(Number(tempRange.value)));
      tempNumInput.addEventListener('change', () => commitTemperature(Number(tempNumInput.value)));

      tempBlock.append(tempHead, tempQuickRow, tempRange);

      dualParams.append(tokBlock, tempBlock);
      paramCard.append(dualParams);
      secPrompts.append(paramCard);
    }

    // 搜索框 + 全部/仅看已开/隐藏系统槽过滤胶囊
    const promptFilterBar = el('div', 'stm-preset-vault-bar');

    const pSearchBox = el('div', 'stm-model-search-box stm-flex-grow');
    pSearchBox.append(createIconNode(doc, 'search', 'stm-model-search-icon'));
    const pSearchInput = el('input', 'stm-api-input stm-model-combo-input stm-compact-input');
    pSearchInput.type = 'text';
    pSearchInput.placeholder = '搜索条目名称或正文关键词…';
    pSearchInput.value = promptSearchQuery;
    pSearchInput.addEventListener('input', () => {
      promptSearchQuery = pSearchInput.value;
      renderPromptListOnly();
    });
    pSearchBox.append(pSearchInput);

    const filterPills = el('div', 'stm-preset-filter-pills');
    for (const [modeId, label] of [
      ['all', '全部'],
      ['enabled', '仅看已开'],
      ['hide_markers', '隐藏系统槽'],
    ]) {
      const fBtn = el('button', `stm-mini-pill${promptFilterMode === modeId ? ' is-active' : ''}`, label);
      fBtn.type = 'button';
      fBtn.addEventListener('click', () => {
        if (promptFilterMode === modeId) return;
        promptFilterMode = modeId;
        renderBody();
      });
      filterPills.append(fBtn);
    }

    promptFilterBar.append(pSearchBox, filterPills);
    secPrompts.append(promptFilterBar);

    const promptListWrap = el('div', 'stm-prompt-list');
    liveRefs.promptListWrap = promptListWrap;
    secPrompts.append(promptListWrap);
    renderPromptListOnly();

    // 底部原生高级预设面板兜底入口
    const footerBar = el('div', 'stm-preset-native-footer');
    const nativeBtn = el('button', 'stm-ghost-link');
    nativeBtn.type = 'button';
    nativeBtn.append(
      createIconNode(doc, 'sliders', 'stm-inline-svg'),
      el('span', '', '原生高级采样面板 ›'),
    );
    nativeBtn.addEventListener('click', async () => {
      await flushPendingPersistIfAny();
      close();
      openNativeDrawer('ai-config-button', { getContext });
    });
    footerBar.append(nativeBtn);
    secPrompts.append(footerBar);

    bodyEl.append(secPrompts);
  }

  function ensureDom() {
    const doc = globalThis.document;
    if (!doc) return null;
    if (dockEl?.isConnected) return dockEl;

    dockEl = doc.getElementById('stm-preset-dock') || el('aside', 'stm-preset-dock');
    dockEl.id = 'stm-preset-dock';
    dockEl.setAttribute('role', 'region');
    dockEl.setAttribute('aria-label', '预设馆工作台');
    dockEl.hidden = !isOpen;
    dockEl.replaceChildren();

    const stopBubble = evt => evt.stopPropagation();
    dockEl.addEventListener('mousedown', stopBubble);
    dockEl.addEventListener('touchstart', stopBubble, { passive: true });

    // 隐藏多选预设文件导入器
    fileInputEl = el('input');
    fileInputEl.type = 'file';
    fileInputEl.accept = '.json,application/json';
    fileInputEl.multiple = true;
    fileInputEl.hidden = true;
    fileInputEl.addEventListener('change', async () => {
      const files = Array.from(fileInputEl.files || []);
      if (files.length === 0) return;

      await flushPendingPersistIfAny();
      const { imported, failed } = await importPresetItems(files, {
        getContext,
        selectFirstImported: files.length === 1,
      });

      if (imported.length > 0) {
        activeVaultTab = 'common';
        presetSearchQuery = '';
        toastMessage(
          files.length === 1
            ? `已导入并启用预设：${imported[0]}`
            : `已成功批量导入 ${imported.length} 套预设`,
          'success',
        );
        onPresetChanged?.();
      }
      if (failed.length > 0) {
        toastMessage(failed[0].error, 'warning');
      }
      if (isOpen) renderBody();
    });

    bodyEl = el('div', 'stm-dock-body stm-preset-dock-body');
    dockEl.append(fileInputEl, bodyEl);
    doc.body.append(dockEl);

    if (cleanups.length === 0) {
      const onDocPointerDown = evt => {
        if (!isOpen || !dockEl) return;
        if (Date.now() - lastOpenedAt < 120) return;
        const target = evt.target;
        const elTarget =
          target && typeof target.closest === 'function' ? target : target?.parentElement;
        if (!elTarget || typeof elTarget.closest !== 'function') return;
        if (dockEl.contains(elTarget) || elTarget.closest('.stm-topbar-preset')) {
          return;
        }
        close();
      };
      const onDocKeyDown = evt => {
        if (isOpen && evt.key === 'Escape') {
          if (renamingPresetName) {
            renamingPresetName = '';
            renderPresetListOnly();
            return;
          }
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

  function isPresetTakeoverEnabled() {
    const s = store.get();
    return Boolean(s.shellEnabled && s.modules.presets);
  }

  function open() {
    if (!isPresetTakeoverEnabled()) {
      openNativeDrawer('ai-config-button', { toggleIfOpen: true, getContext });
      return;
    }

    onBeforeOpen?.();
    closeAllNativeDrawers();
    ensureDom();
    isOpen = true;
    lastOpenedAt = Date.now();
    confirmDeletePresetName = '';
    confirmDeletePromptId = '';
    renamingPresetName = '';

    void primeHostOpenAiModule().then(mod => {
      if (mod && isOpen) {
        refreshPromptCounterHeader();
      }
    });

    const hostState = getHostPresetState({ getContext });
    if (!autoSaver.hasPending()) {
      saveState = hostState.isGuiPreset
        ? { tone: 'warn', text: '默认预设仅内存生效（点「另存副本」建档）' }
        : { tone: 'idle', text: '改动自动存盘' };
    }

    if (dockEl) {
      dockEl.hidden = false;
    }
    syncBoundsToSheldNow();
    renderBody();
    onOpenStateChange?.(true);
  }

  function close() {
    if (!isOpen) return;
    if (assistantPanel.isBusy()) {
      assistantPanel.abort();
    }
    void flushPendingPersistIfAny();
    isOpen = false;
    renamingPresetName = '';
    confirmDeletePresetName = '';
    confirmDeletePromptId = '';
    if (dockEl) dockEl.hidden = true;
    onOpenStateChange?.(false);
  }

  function toggle() {
    if (!isPresetTakeoverEnabled()) {
      openNativeDrawer('ai-config-button', { toggleIfOpen: true, getContext });
      return;
    }
    if (isOpen) close();
    else open();
  }

  function openAssistant() {
    if (!isPresetTakeoverEnabled()) {
      openNativeDrawer('ai-config-button', { toggleIfOpen: false, getContext });
      return;
    }
    assistantOpen = true;
    if (!isOpen) {
      open();
    } else {
      renderBody();
    }
    if (bodyEl) {
      bodyEl.scrollTop = 0;
    }
    assistantPanel.focusInput();
  }

  function refresh() {
    if (!isPresetTakeoverEnabled()) {
      close();
      return;
    }
    if (!isOpen) return;
    syncBoundsToSheldNow();

    if (assistantOpen) {
      assistantPanel.syncStatus();
    }

    // 防打断保护：若用户正在面板内部的输入控件（INPUT / TEXTAREA / SELECT）编辑、自动保存挂起/落盘或助手正在请求中，且外部预设名未切换，跳过全量重建！
    const doc = globalThis.document;
    const activeEl = doc?.activeElement;
    const currentPreset = getHostPresetState({ getContext, doc }).activePreset;
    const isTypingInside =
      activeEl &&
      dockEl?.contains(activeEl) &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT');

    if (
      (internalBusy ||
        autoSaver.hasPending() ||
        autoSaver.isSaving() ||
        assistantPanel.isBusy() ||
        isTypingInside) &&
      currentPreset === lastRenderedActivePreset
    ) {
      return;
    }

    renderBody();
  }

  function destroy() {
    assistantPanel.destroy();
    if (autoSaver.hasPending()) {
      void autoSaver.flush();
    } else {
      autoSaver.cancel();
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
    assistantOpen = false;
    dockEl?.remove();
    dockEl = null;
    bodyEl = null;
    fileInputEl = null;
  }

  return {
    isOpen: () => isOpen,
    open,
    openAssistant,
    close,
    toggle,
    refresh,
    flushPendingSave: flushPendingPersistIfAny,
    destroy,
  };
}
