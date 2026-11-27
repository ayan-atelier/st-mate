/**
 * ST伴侣 (st-mate) · 顶栏下拉「API 与模型工作台」面板 (.stm-api-dock)
 * 遵循《砚台全系插件 UI 与交互设计规范》(90/9/1 渐进披露法则)：
 * 1. 日常高频区首屏直达：自动换行站子胶囊（零重复角标、零灰白横向滚动条、支持自主设定默认主站置顶）+ 常用模型收藏胶囊秒切；
 * 2. 低频连接配置默认收束为单行状态摘要（新建或未配站子自动展开），「提示词消息后处理」等极客参数收纳进「高级选项」；
 * 3. 「副 API 通道」独立卡片清晰呈现，选定站子后支持直接下拉搜索该站子模型列表（收藏置顶）或后台静默拉取模型，告别纯手填。
 */

import { createIconNode, svgMarkup } from '../core/icons.js?v=0.9.9';
import { normalizeApiStation, sanitizeEndpointUrl } from '../core/schema.js?v=0.9.9';
import { closeAllNativeDrawers, openNativeDrawer, toastMessage } from '../shell/host-actions.js?v=0.9.9';
import {
  API_SOURCES,
  MORE_SOURCE_IDS,
  POST_PROCESSING_OPTIONS,
  PRIMARY_SOURCE_IDS,
  appendV1Suffix,
  applyStationToHost,
  duplicateApiStation,
  fetchStationModels,
  filterModelsByQuery,
  formatStationCompactSummary,
  generateStationId,
  getSourceMeta,
  inspectStationSecretStatus,
  mergeImportedStations,
  needsV1Suffix,
  readSecretsMap,
  resolveSecretKeyForStation,
  rotateStationSecret,
  setPrimaryDefaultStation,
  syncReverseProxyCredentialToHost,
  testStationChatReply,
  toggleFavoriteModel,
  writeStationSecret,
} from './api-backend.js?v=0.9.9';

export function createApiDock({ getContext, store, onOpenStateChange, onBeforeOpen }) {
  let dockEl = null;
  let bodyEl = null;
  let isOpen = false;
  let lastOpenedAt = 0;
  let boundsRaf = 0;

  let secretsCache = {};
  let bootstrappedOnce = false;
  let opSeq = 0;
  let switchingStationId = '';
  let busyConnecting = false;
  let busyTesting = false;
  let busyImporting = false;
  let busyPullingAux = false;
  let showPlainSecret = false;

  // 按站子隔离暂存尚未点「保存并连接」的密钥草稿（纯内存态，绝不落盘，destroy 时清空）
  const pendingSecretsByStation = new Map();
  let confirmDeleteId = '';

  // 渐进披露状态：站子下拉栏按需展开；已就绪站子默认收起低频连接表单；新建/复制/未配置站子自动展开
  let stationPickerOpen = false;
  let stationFilterText = '';
  let configExpanded = false;
  let forceExpandStationId = '';
  let advancedExpanded = false;

  // 主通道模型下拉与搜索状态
  let modelDropdownOpen = false;
  let modelFilterText = '';
  let modelFilterTouched = false;

  // 副通道模型下拉与搜索状态
  let auxModelDropdownOpen = false;
  let auxModelFilterText = '';
  let auxModelFilterTouched = false;

  // 连接状态反馈：{ tone: 'idle' | 'ok' | 'warn' | 'err', text: string }
  let connectionBanner = { tone: 'idle', text: '' };

  // 局部更新与未提交草稿句柄（防止打字时重绘整棵 DOM 丢失焦点或吞掉搜狗拼音）
  let liveRefs = {
    stationId: '',
    activeTriggerNameEl: null,
    activePillNameEl: null,
    stationDropdownWrap: null,
    stationListWrap: null,
    nameInput: null,
    urlInput: null,
    regionInput: null,
    projectIdInput: null,
    secretBadgeEl: null,
    modelDropdownWrap: null,
    modelInput: null,
    favStarBtn: null,
    v1Btn: null,
    auxModelInput: null,
    auxModelDropdownWrap: null,
  };

  const cleanups = [];

  function el(tag, className = '', text = '') {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function getStudioState() {
    return store.get().apiStudio;
  }

  function getActiveStation() {
    const { activeStationId, stations } = getStudioState();
    return stations.find(s => s.id === activeStationId) || stations[0] || null;
  }

  function isStationUnconfigured(station, secStatus) {
    if (!station) return false;
    if (forceExpandStationId && forceExpandStationId === station.id) return true;
    if (station.source === 'custom' && !sanitizeEndpointUrl(station.url)) return true;
    if (bootstrappedOnce && !secStatus?.valid && station.source !== 'pollinations') return true;
    return false;
  }

  function updateStationById(stationId, patch, { silent = false } = {}) {
    const studio = getStudioState();
    const nextStations = studio.stations.map((st, idx) =>
      st.id === stationId ? normalizeApiStation({ ...st, ...patch, id: st.id }, idx) : st,
    );
    store.update(
      {
        apiStudio: {
          activeStationId: studio.activeStationId || stationId,
          defaultStationId: studio.defaultStationId || '',
          stations: nextStations,
        },
      },
      { silent },
    );
    return nextStations.find(st => st.id === stationId) || null;
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

  async function refreshSecretsAndBootstrap({ forceImport = false } = {}) {
    secretsCache = await readSecretsMap({ getContext });
    const studio = getStudioState();

    if (studio.stations.length === 0 || forceImport) {
      const { stations, addedCount, currentHostStation } = mergeImportedStations({
        existingStations: studio.stations,
        ctx: getContext?.(),
        secretsMap: secretsCache,
      });

      if (stations.length > 0 && (studio.stations.length === 0 || addedCount > 0)) {
        const nextActive = studio.activeStationId || currentHostStation?.id || stations[0].id;
        store.update(
          {
            apiStudio: {
              activeStationId: nextActive,
              defaultStationId: studio.defaultStationId || '',
              stations,
            },
          },
          { silent: true },
        );
      }
      bootstrappedOnce = true;
      return addedCount;
    }

    bootstrappedOnce = true;
    return 0;
  }

  function getPendingSecret(stationId) {
    if (!stationId) return '';
    return pendingSecretsByStation.get(stationId) || '';
  }

  function setPendingSecret(stationId, rawValue) {
    if (!stationId) return;
    if (rawValue) {
      pendingSecretsByStation.set(stationId, rawValue);
    } else {
      pendingSecretsByStation.delete(stationId);
    }
  }

  /**
   * 在切换站子、折叠配置、连接测活或关闭面板前，将输入框中尚未触发 change 的合法修改安全存入，
   * 杜绝「改了地址/名称/模型还没失焦就切卡片或关面板」导致的数据丢失。
   */
  function flushPendingFormInputs({ syncHostIfActive = true, commitTypedModelWhenNoList = true } = {}) {
    if (auxModelFilterTouched && liveRefs.auxModelInput) {
      const curAux = store.get().auxApi;
      const nextAuxModel = liveRefs.auxModelInput.value.trim();
      if (nextAuxModel !== curAux.model) {
        store.update(
          {
            auxApi: {
              ...curAux,
              model: nextAuxModel,
            },
          },
          { silent: true },
        );
      }
      auxModelFilterText = nextAuxModel;
      auxModelFilterTouched = false;
    }

    const cur = getActiveStation();
    if (!cur || liveRefs.stationId !== cur.id) return cur;

    const patch = {};
    let hasPatch = false;

    if (liveRefs.nameInput) {
      const nextName = liveRefs.nameInput.value.trim();
      if (nextName && nextName !== cur.name) {
        patch.name = nextName;
        hasPatch = true;
      }
    }

    if (liveRefs.urlInput) {
      const nextUrl = liveRefs.urlInput.value.trim();
      if (nextUrl !== cur.url && (!nextUrl || sanitizeEndpointUrl(nextUrl))) {
        patch.url = nextUrl;
        hasPatch = true;
      }
    }

    if (liveRefs.regionInput) {
      const nextRegion = liveRefs.regionInput.value.trim() || 'global';
      if (nextRegion !== cur.vertexRegion) {
        patch.vertexRegion = nextRegion;
        hasPatch = true;
      }
    }

    if (liveRefs.projectIdInput) {
      const nextProj = liveRefs.projectIdInput.value.trim();
      if (nextProj !== cur.vertexProjectId) {
        patch.vertexProjectId = nextProj;
        hasPatch = true;
      }
    }

    if (
      commitTypedModelWhenNoList &&
      modelFilterTouched &&
      liveRefs.modelInput &&
      (cur.cachedModels?.length || 0) === 0
    ) {
      const typedModel = liveRefs.modelInput.value.trim();
      if (typedModel && typedModel !== cur.model) {
        patch.model = typedModel;
        modelFilterText = typedModel;
        modelFilterTouched = false;
        hasPatch = true;
      }
    }

    if (!hasPatch) return cur;
    const updated = updateStationById(cur.id, patch, { silent: true }) || cur;
    if (syncHostIfActive) {
      applyStationToHost(updated, { getContext });
    }
    return updated;
  }

  async function handleSwitchStation(stationId) {
    const prevActive = flushPendingFormInputs({ syncHostIfActive: false });
    if (prevActive && prevActive.id !== stationId && getPendingSecret(prevActive.id).trim()) {
      toastMessage(`「${prevActive.name}」新填入的密钥尚未保存，切回点「保存并连接」即可生效`, 'info');
    }

    const studio = getStudioState();
    const target = studio.stations.find(s => s.id === stationId);
    if (!target) return;

    const seq = ++opSeq;
    busyConnecting = false;
    busyTesting = false;
    confirmDeleteId = '';
    forceExpandStationId = '';
    stationPickerOpen = false;
    stationFilterText = '';
    configExpanded = false;
    advancedExpanded = false;
    modelDropdownOpen = false;
    modelFilterTouched = false;
    modelFilterText = target.model || '';
    auxModelDropdownOpen = false;

    store.update(
      {
        apiStudio: {
          ...studio,
          activeStationId: target.id,
        },
      },
      { silent: true },
    );

    if (target.secretId) {
      switchingStationId = target.id;
      connectionBanner = {
        tone: 'warn',
        text: `正在切换至「${target.name}」并同步密钥…`,
      };
      if (isOpen) renderBody();

      const secretKey = resolveSecretKeyForStation(target);
      await rotateStationSecret({ key: secretKey, id: target.secretId, getContext });
      if (seq !== opSeq) return;
      const nextMap = await readSecretsMap({ getContext });
      if (seq !== opSeq) return;
      secretsCache = nextMap;
    }

    switchingStationId = '';
    const latestTarget = getStudioState().stations.find(s => s.id === target.id) || target;
    applyStationToHost(latestTarget, { getContext });
    const secStatus = inspectStationSecretStatus(latestTarget, secretsCache);
    connectionBanner = {
      tone: secStatus.valid ? 'ok' : 'warn',
      text: `已切换至「${latestTarget.name}」${latestTarget.model ? ` · ${latestTarget.model}` : ''}`,
    };

    if (isOpen) renderBody();
  }

  function handleCreateStation() {
    flushPendingFormInputs({ syncHostIfActive: true });
    const studio = getStudioState();
    const current = getActiveStation();
    const baseSource = current?.source || 'custom';
    const newStation = normalizeApiStation(
      {
        id: generateStationId(),
        name: `新站子 ${studio.stations.length + 1}`,
        source: baseSource,
        url: '',
        secretId: '',
        secretLabel: '',
        model: '',
        favoriteModels: [],
        cachedModels: [],
        postProcessing: '',
      },
      studio.stations.length,
    );

    opSeq += 1;
    switchingStationId = '';
    busyConnecting = false;
    busyTesting = false;
    confirmDeleteId = '';
    forceExpandStationId = newStation.id;
    stationPickerOpen = false;
    stationFilterText = '';
    configExpanded = true;
    advancedExpanded = false;
    modelDropdownOpen = false;
    modelFilterTouched = false;
    modelFilterText = '';
    auxModelDropdownOpen = false;
    connectionBanner = { tone: 'idle', text: '请填写站子名称、地址与密钥后点「保存并连接」' };

    store.update(
      {
        apiStudio: {
          ...studio,
          activeStationId: newStation.id,
          stations: [...studio.stations, newStation],
        },
      },
      { silent: true },
    );
    if (isOpen) renderBody();
  }

  function handleDuplicateStation() {
    const current = flushPendingFormInputs({ syncHostIfActive: true });
    if (!current) return;
    const studio = getStudioState();
    const cloned = duplicateApiStation(current, studio.stations);

    opSeq += 1;
    switchingStationId = '';
    busyConnecting = false;
    busyTesting = false;
    confirmDeleteId = '';
    forceExpandStationId = cloned.id;
    stationPickerOpen = false;
    stationFilterText = '';
    configExpanded = true;
    advancedExpanded = false;
    modelDropdownOpen = false;
    modelFilterTouched = false;
    modelFilterText = cloned.model || '';
    auxModelDropdownOpen = false;
    connectionBanner = {
      tone: 'ok',
      text: `已复制「${cloned.name}」（共用原密钥，可改名或填新 Key 独立绑定）`,
    };

    store.update(
      {
        apiStudio: {
          ...studio,
          activeStationId: cloned.id,
          stations: [...studio.stations, cloned],
        },
      },
      { silent: true },
    );
    applyStationToHost(cloned, { getContext });
    toastMessage(`已复制站子：${cloned.name}`, 'success');
    if (isOpen) renderBody();
  }

  function handleSetPrimaryDefault(station) {
    const flushed = flushPendingFormInputs({ syncHostIfActive: true }) || station;
    if (!flushed) return;
    const studio = getStudioState();
    const { defaultStationId, stations } = setPrimaryDefaultStation(studio.stations, flushed.id);
    store.update(
      {
        apiStudio: {
          activeStationId: flushed.id,
          defaultStationId,
          stations,
        },
      },
      { silent: true },
    );
    toastMessage(`已将「${flushed.name}」设为默认主站并置顶`, 'success');
    if (isOpen) renderBody();
  }

  function handleDeleteActiveStation(station) {
    const studio = getStudioState();
    if (studio.stations.length <= 1) {
      toastMessage('至少保留一张站子卡片', 'info');
      return;
    }
    if (confirmDeleteId !== station.id) {
      confirmDeleteId = station.id;
      if (isOpen) renderBody();
      return;
    }
    confirmDeleteId = '';
    if (forceExpandStationId === station.id) {
      forceExpandStationId = '';
    }
    pendingSecretsByStation.delete(station.id);
    const remaining = studio.stations.filter(s => s.id !== station.id);
    const nextActive = remaining[0];
    const nextDefaultId = studio.defaultStationId === station.id ? '' : studio.defaultStationId;
    const curAux = store.get().auxApi;
    const nextAux =
      curAux.stationId === station.id
        ? { ...curAux, mode: 'follow_main', enabled: false, stationId: '' }
        : curAux;

    store.update(
      {
        apiStudio: {
          activeStationId: nextActive.id,
          defaultStationId: nextDefaultId,
          stations: remaining,
        },
        auxApi: nextAux,
      },
      { silent: true },
    );
    void handleSwitchStation(nextActive.id);
  }

  /**
   * 内部共用步骤：将指定站子的新密钥写入酒馆加密保险箱（或轮换激活已有 secretId），再同步宿主设置。
   */
  async function persistAndActivateStationCredentials(initialStation, seq) {
    let latestStation = initialStation;
    const targetId = initialStation.id;
    const secretKey = resolveSecretKeyForStation(latestStation);
    const rawKey = getPendingSecret(targetId).trim();

    if (rawKey) {
      const written = await writeStationSecret({
        key: secretKey,
        value: rawKey,
        label: latestStation.name || 'ST伴侣站子',
        getContext,
      });
      setPendingSecret(targetId, '');
      syncReverseProxyCredentialToHost(latestStation, rawKey, { getContext });
      if (written?.id) {
        latestStation =
          updateStationById(
            targetId,
            {
              secretKeyType: secretKey,
              secretId: written.id,
              secretLabel: written.label,
            },
            { silent: true },
          ) || latestStation;
      }
    } else if (latestStation.secretId) {
      await rotateStationSecret({
        key: secretKey,
        id: latestStation.secretId,
        getContext,
      });
    }

    if (seq !== opSeq) return null;

    const nextMap = await readSecretsMap({ getContext });
    if (seq !== opSeq) return null;
    secretsCache = nextMap;

    if (!latestStation.secretId) {
      const secStatus = inspectStationSecretStatus(latestStation, secretsCache);
      if (secStatus.inherited && secStatus.secretId) {
        latestStation =
          updateStationById(
            targetId,
            {
              secretKeyType: secretKey,
              secretId: secStatus.secretId,
              secretLabel: secStatus.label || '',
            },
            { silent: true },
          ) || latestStation;
      }
    }

    applyStationToHost(latestStation, { getContext });
    return latestStation;
  }

  async function handleSaveAndConnect({ pullModelsOnly = false } = {}) {
    const station = flushPendingFormInputs({
      syncHostIfActive: true,
      commitTypedModelWhenNoList: !pullModelsOnly,
    });
    if (!station || busyConnecting || busyTesting) return;

    const seq = ++opSeq;
    const targetId = station.id;
    switchingStationId = '';
    busyConnecting = true;
    connectionBanner = {
      tone: 'warn',
      text: pullModelsOnly ? '正在拉取可用模型列表…' : '正在保存密钥并检测连接…',
    };
    if (isOpen) renderBody();

    try {
      let latestStation = await persistAndActivateStationCredentials(station, seq);
      if (!latestStation || seq !== opSeq) return;

      const result = await fetchStationModels(latestStation, {
        getContext,
        secretsMap: secretsCache,
      });
      if (seq !== opSeq) return;

      if (result.ok && forceExpandStationId === targetId) {
        forceExpandStationId = '';
      }

      if (result.models.length > 0) {
        const nextModel = latestStation.model || result.models[0];
        latestStation =
          updateStationById(
            targetId,
            {
              cachedModels: result.models,
              model: nextModel,
            },
            { silent: true },
          ) || latestStation;
        modelFilterText = nextModel;
        modelFilterTouched = false;
        applyStationToHost(latestStation, { getContext });
        modelDropdownOpen = true;
      }

      connectionBanner = {
        tone: result.ok ? 'ok' : 'err',
        text: result.message,
      };
      toastMessage(result.message, result.ok ? 'success' : 'warning');
    } catch (err) {
      if (seq !== opSeq) return;
      connectionBanner = {
        tone: 'err',
        text: err?.message || '保存或连接失败，请检查配置',
      };
      toastMessage(connectionBanner.text, 'error');
    } finally {
      if (seq === opSeq) {
        busyConnecting = false;
        if (isOpen) renderBody();
      }
    }
  }

  async function handleTestStationReply() {
    const station = flushPendingFormInputs({ syncHostIfActive: true, commitTypedModelWhenNoList: true });
    if (!station || busyConnecting || busyTesting) return;

    if (!String(station.model || '').trim()) {
      connectionBanner = {
        tone: 'warn',
        text: '请先选择或输入模型名称，再点「测活」',
      };
      toastMessage('请先选择或手输一个模型名称再测活', 'info');
      if (isOpen) renderBody();
      return;
    }

    const seq = ++opSeq;
    switchingStationId = '';
    busyTesting = true;
    connectionBanner = {
      tone: 'warn',
      text: `正在向「${station.model}」发送测试请求…`,
    };
    if (isOpen) renderBody();

    try {
      const latestStation = await persistAndActivateStationCredentials(station, seq);
      if (!latestStation || seq !== opSeq) return;

      const probe = await testStationChatReply(latestStation, { getContext });
      if (seq !== opSeq) return;

      connectionBanner = {
        tone: probe.ok ? 'ok' : 'err',
        text: probe.message,
      };
      toastMessage(probe.message, probe.ok ? 'success' : 'warning');
    } catch (err) {
      if (seq !== opSeq) return;
      connectionBanner = {
        tone: 'err',
        text: err?.message || '测活请求失败，请检查密钥或网络',
      };
      toastMessage(connectionBanner.text, 'error');
    } finally {
      if (seq === opSeq) {
        busyTesting = false;
        if (isOpen) renderBody();
      }
    }
  }

  /**
   * 后台静默拉取「副 API 通道」所选站子的模型列表（100% 零切主对话站子、零篡改主通道状态）。
   */
  async function handlePullAuxStationModels(auxStation) {
    if (!auxStation || busyPullingAux) return;
    flushPendingFormInputs({ syncHostIfActive: true });
    busyPullingAux = true;
    if (isOpen) renderBody();

    try {
      if (!bootstrappedOnce || Object.keys(secretsCache).length === 0) {
        secretsCache = await readSecretsMap({ getContext });
      }
      const result = await fetchStationModels(auxStation, {
        getContext,
        syncHostSelect: false,
        secretsMap: secretsCache,
      });

      if (result.models.length > 0) {
        updateStationById(auxStation.id, { cachedModels: result.models }, { silent: true });
        auxModelDropdownOpen = true;
        auxModelFilterTouched = false;
        toastMessage(`已获取「${auxStation.name}」${result.models.length} 个可用模型`, 'success');
      } else {
        toastMessage(result.message || '该站子未返回模型列表，可直接手输模型名', result.ok ? 'info' : 'warning');
      }
    } catch (err) {
      toastMessage(err?.message || '拉取副通道模型列表失败', 'error');
    } finally {
      busyPullingAux = false;
      if (isOpen) renderBody();
    }
  }

  function applyModelSelection(station, nextModel, { closeDropdown = false, reRenderAll = true } = {}) {
    const cleaned = String(nextModel || '').trim();
    const updated = updateStationById(station.id, { model: cleaned }, { silent: true });
    if (updated) {
      applyStationToHost(updated, { getContext });
    }
    modelFilterText = cleaned;
    modelFilterTouched = false;
    if (closeDropdown) {
      modelDropdownOpen = false;
    }
    if (reRenderAll && isOpen) {
      renderBody();
    } else {
      syncStarButtonVisual(updated || station);
      renderModelDropdownOnly();
    }
  }

  function applyAuxModelSelection(nextModel, { closeDropdown = true, reRenderAll = true } = {}) {
    const cleaned = String(nextModel || '').trim();
    const curAux = store.get().auxApi;
    store.update(
      {
        auxApi: {
          ...curAux,
          model: cleaned,
        },
      },
      { silent: true },
    );
    auxModelFilterText = cleaned;
    auxModelFilterTouched = false;
    if (closeDropdown) {
      auxModelDropdownOpen = false;
    }
    if (reRenderAll && isOpen) {
      renderBody();
    } else {
      renderAuxModelDropdownOnly();
    }
  }

  function syncStarButtonVisual(station) {
    const btn = liveRefs.favStarBtn;
    if (!btn || !station) return;
    const curModel = String(liveRefs.modelInput?.value || station.model || '').trim();
    const isFav = Boolean(curModel && station.favoriteModels.includes(curModel));
    btn.classList.toggle('is-active', isFav);
    btn.title = isFav ? '取消收藏当前模型' : '将当前模型加入常用收藏胶囊';
  }

  function renderModelDropdownOnly() {
    const wrap = liveRefs.modelDropdownWrap;
    const doc = globalThis.document;
    if (!wrap || !doc) return;
    wrap.replaceChildren();

    const station = getActiveStation();
    if (!station || !modelDropdownOpen) {
      wrap.hidden = true;
      return;
    }

    const baseModels = station.cachedModels || [];
    const effectiveQuery = modelFilterTouched ? modelFilterText : '';
    const filtered = filterModelsByQuery(baseModels, effectiveQuery);
    const typedTrimmed = String(modelFilterText || '').trim();

    wrap.hidden = false;

    const dropHead = el('div', 'stm-model-drop-head');
    const countText =
      baseModels.length === 0
        ? '暂未拉取模型表（可手输模型名回车，或点右侧「拉取」）'
        : effectiveQuery
          ? `匹配 ${filtered.length} / ${baseModels.length} 个模型`
          : `共 ${baseModels.length} 个可用模型 · 点名称切换，点星标收藏`;
    dropHead.append(el('span', 'stm-model-drop-hint', countText));

    const foldBtn = el('button', 'stm-reset-link', '收起 ▴');
    foldBtn.type = 'button';
    foldBtn.addEventListener('click', () => {
      modelDropdownOpen = false;
      wrap.hidden = true;
    });
    dropHead.append(foldBtn);
    wrap.append(dropHead);

    const listEl = el('div', 'stm-model-list');

    if (typedTrimmed && !filtered.includes(typedTrimmed)) {
      const customRow = el('div', 'stm-model-item is-custom-entry');
      const useBtn = el('button', 'stm-model-pick-btn');
      useBtn.type = 'button';
      useBtn.append(
        createIconNode(doc, 'check', 'stm-row-icon'),
        el('span', 'stm-model-id-text', `直接使用手输模型：${typedTrimmed}`),
      );
      useBtn.addEventListener('click', () => {
        applyModelSelection(station, typedTrimmed, { closeDropdown: true, reRenderAll: true });
      });
      customRow.append(useBtn);
      listEl.append(customRow);
    }

    const displaySlice = filtered.slice(0, 200);
    for (const modelId of displaySlice) {
      const isSelected = station.model === modelId;
      const isFav = station.favoriteModels.includes(modelId);

      const row = el('div', `stm-model-item${isSelected ? ' is-selected' : ''}`);
      const pickBtn = el('button', 'stm-model-pick-btn');
      pickBtn.type = 'button';
      if (isSelected) {
        pickBtn.append(createIconNode(doc, 'check', 'stm-row-icon'));
      }
      pickBtn.append(el('span', 'stm-model-id-text', modelId));
      pickBtn.addEventListener('click', () => {
        applyModelSelection(station, modelId, { closeDropdown: true, reRenderAll: true });
      });

      const starBtn = el('button', `stm-model-star-btn${isFav ? ' is-active' : ''}`);
      starBtn.type = 'button';
      starBtn.title = isFav ? '从常用收藏移除' : '加入常用模型胶囊';
      starBtn.setAttribute('aria-label', starBtn.title);
      starBtn.innerHTML = svgMarkup('star');
      starBtn.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        const cur = getActiveStation();
        if (!cur) return;
        const nextFavs = toggleFavoriteModel(cur.favoriteModels, modelId);
        updateStationById(cur.id, { favoriteModels: nextFavs }, { silent: true });
        renderBody();
      });

      row.append(pickBtn, starBtn);
      listEl.append(row);
    }

    if (filtered.length > 200) {
      listEl.append(
        el(
          'div',
          'stm-model-more-note',
          `仅展示前 200 项，请在上方输入关键词缩小范围（共 ${filtered.length} 项）`,
        ),
      );
    }

    if (listEl.childNodes.length > 0) {
      wrap.append(listEl);
    }
  }

  function renderAuxModelDropdownOnly() {
    const wrap = liveRefs.auxModelDropdownWrap;
    const doc = globalThis.document;
    if (!wrap || !doc) return;
    wrap.replaceChildren();

    const curAux = store.get().auxApi;
    const studio = getStudioState();
    const activeMain = getActiveStation();
    const auxStation =
      curAux.mode === 'station'
        ? studio.stations.find(s => s.id === (curAux.stationId || activeMain?.id)) || null
        : null;

    if (!auxStation || !auxModelDropdownOpen) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;

    const favSet = new Set(auxStation.favoriteModels || []);
    const mergedCandidates = [
      ...(auxStation.favoriteModels || []),
      ...(auxStation.cachedModels || []).filter(m => !favSet.has(m)),
    ];
    const effectiveQuery = auxModelFilterTouched ? auxModelFilterText : '';
    const filtered = filterModelsByQuery(mergedCandidates, effectiveQuery);
    const typedTrimmed = String(auxModelFilterText || '').trim();

    const dropHead = el('div', 'stm-model-drop-head');
    const headHint =
      mergedCandidates.length === 0
        ? `「${auxStation.name}」暂未缓存模型列表`
        : effectiveQuery
          ? `匹配 ${filtered.length} / ${mergedCandidates.length} 个模型`
          : `「${auxStation.name}」可选模型 (${mergedCandidates.length})`;
    dropHead.append(el('span', 'stm-model-drop-hint', headHint));

    const foldBtn = el('button', 'stm-reset-link', '收起 ▴');
    foldBtn.type = 'button';
    foldBtn.addEventListener('click', () => {
      auxModelDropdownOpen = false;
      wrap.hidden = true;
    });
    dropHead.append(foldBtn);
    wrap.append(dropHead);

    const listEl = el('div', 'stm-model-list');

    // 首行始终提供「跟随该站子默认模型」一键回退
    if (!effectiveQuery) {
      const followDefaultSelected = !curAux.model;
      const defaultRow = el('div', `stm-model-item${followDefaultSelected ? ' is-selected' : ''}`);
      const defaultBtn = el('button', 'stm-model-pick-btn');
      defaultBtn.type = 'button';
      if (followDefaultSelected) {
        defaultBtn.append(createIconNode(doc, 'check', 'stm-row-icon'));
      }
      defaultBtn.append(
        el(
          'span',
          'stm-model-id-text',
          auxStation.model
            ? `跟随该站子当前模型 (${auxStation.model})`
            : '跟随该站子默认模型',
        ),
      );
      defaultBtn.addEventListener('click', () => {
        applyAuxModelSelection('', { closeDropdown: true, reRenderAll: true });
      });
      defaultRow.append(defaultBtn);
      listEl.append(defaultRow);
    }

    if (typedTrimmed && !filtered.includes(typedTrimmed)) {
      const customRow = el('div', 'stm-model-item is-custom-entry');
      const useBtn = el('button', 'stm-model-pick-btn');
      useBtn.type = 'button';
      useBtn.append(
        createIconNode(doc, 'check', 'stm-row-icon'),
        el('span', 'stm-model-id-text', `直接使用手输副模型：${typedTrimmed}`),
      );
      useBtn.addEventListener('click', () => {
        applyAuxModelSelection(typedTrimmed, { closeDropdown: true, reRenderAll: true });
      });
      customRow.append(useBtn);
      listEl.append(customRow);
    }

    if (mergedCandidates.length === 0) {
      const pullRow = el('div', 'stm-model-item');
      const pullNowBtn = el('button', 'stm-model-pick-btn stm-aux-pull-inline');
      pullNowBtn.type = 'button';
      pullNowBtn.disabled = busyPullingAux;
      pullNowBtn.append(
        createIconNode(doc, 'refresh', 'stm-row-icon'),
        el(
          'span',
          'stm-model-id-text',
          busyPullingAux ? '正在拉取模型列表…' : `点此拉取「${auxStation.name}」的可用模型列表`,
        ),
      );
      pullNowBtn.addEventListener('click', () => {
        void handlePullAuxStationModels(auxStation);
      });
      pullRow.append(pullNowBtn);
      listEl.append(pullRow);
    } else {
      for (const modelId of filtered.slice(0, 150)) {
        const isSelected = curAux.model === modelId;
        const isFav = favSet.has(modelId);
        const row = el('div', `stm-model-item${isSelected ? ' is-selected' : ''}`);
        const pickBtn = el('button', 'stm-model-pick-btn');
        pickBtn.type = 'button';
        if (isSelected) {
          pickBtn.append(createIconNode(doc, 'check', 'stm-row-icon'));
        } else if (isFav) {
          pickBtn.append(createIconNode(doc, 'star', 'stm-row-icon stm-aux-fav-mark'));
        }
        pickBtn.append(el('span', 'stm-model-id-text', modelId));
        pickBtn.addEventListener('click', () => {
          applyAuxModelSelection(modelId, { closeDropdown: true, reRenderAll: true });
        });
        row.append(pickBtn);
        listEl.append(row);
      }
    }

    wrap.append(listEl);
  }

  function renderStationListOnly() {
    const listWrap = liveRefs.stationListWrap;
    const doc = globalThis.document;
    if (!listWrap || !doc) return;
    listWrap.replaceChildren();

    const studio = getStudioState();
    const activeStation = getActiveStation();
    const q = String(stationFilterText || '').trim().toLowerCase();
    const visibleStations = q
      ? studio.stations.filter(s => {
          const hay = `${s.name} ${s.url || ''} ${getSourceMeta(s.source).shortLabel} ${s.model || ''}`.toLowerCase();
          return hay.includes(q);
        })
      : studio.stations;

    if (visibleStations.length === 0) {
      listWrap.append(el('div', 'stm-model-more-note', `未找到匹配「${stationFilterText}」的站子`));
      return;
    }

    for (const item of visibleStations) {
      const active = activeStation && item.id === activeStation.id;
      const isUserDefault = Boolean(studio.defaultStationId && studio.defaultStationId === item.id);
      const isSwitchingThis = switchingStationId === item.id;
      const itemMeta = getSourceMeta(item.source);

      const cardBtn = el(
        'button',
        `stm-station-pill stm-station-option${active ? ' is-active' : ''}${isSwitchingThis ? ' is-switching' : ''}`,
      );
      cardBtn.type = 'button';
      cardBtn.title = `${item.name}（${itemMeta.shortLabel}${item.model ? ` · ${item.model}` : ''}）`;

      const leftMain = el('span', 'stm-station-opt-main');
      if (active) {
        leftMain.append(createIconNode(doc, 'check', 'stm-row-icon'));
      }
      const pillNameSpan = el('span', 'stm-station-pill-name', item.name);
      if (active) {
        liveRefs.activePillNameEl = pillNameSpan;
      }
      leftMain.append(pillNameSpan);

      if (isUserDefault) {
        leftMain.append(el('span', 'stm-station-pill-sub is-default-mark', '默认'));
      }

      const rightMeta = el(
        'span',
        'stm-station-opt-meta',
        item.model ? item.model : itemMeta.shortLabel,
      );

      cardBtn.append(leftMain, rightMeta);
      cardBtn.addEventListener('click', () => {
        stationPickerOpen = false;
        stationFilterText = '';
        if (activeStation && item.id === activeStation.id && !switchingStationId) {
          if (liveRefs.stationDropdownWrap) liveRefs.stationDropdownWrap.hidden = true;
          renderBody();
          return;
        }
        void handleSwitchStation(item.id);
      });
      listWrap.append(cardBtn);
    }
  }

  function renderBody() {
    const doc = globalThis.document;
    if (!doc || !bodyEl) return;
    bodyEl.replaceChildren();
    liveRefs = {
      stationId: '',
      activeTriggerNameEl: null,
      activePillNameEl: null,
      stationDropdownWrap: null,
      stationListWrap: null,
      nameInput: null,
      urlInput: null,
      regionInput: null,
      projectIdInput: null,
      secretBadgeEl: null,
      modelDropdownWrap: null,
      modelInput: null,
      favStarBtn: null,
      v1Btn: null,
      auxModelInput: null,
      auxModelDropdownWrap: null,
    };

    const studio = getStudioState();
    const station = getActiveStation();
    if (!station) {
      bodyEl.append(el('div', 'stm-api-empty', '正在读取当前酒馆 API 连接配置…'));
      return;
    }

    liveRefs.stationId = station.id;
    const meta = getSourceMeta(station.source);
    const secStatus = inspectStationSecretStatus(station, secretsCache);
    const curPendingSecret = getPendingSecret(station.id);
    const showConfigForm = configExpanded || isStationUnconfigured(station, secStatus);

    // =========================================================================
    // 1. 站子快切区：紧凑标题行 + 下拉选择栏（绿灯状态内嵌右端，站子再多也只占一行）+ 明面管理栏
    // =========================================================================
    const secStations = el('section', 'stm-dock-section');
    const topHead = el('div', 'stm-api-tophead');

    const headLeft = el('div', 'stm-prompt-head-left');
    headLeft.append(
      el('span', 'stm-sec-title', '连接站子'),
      el('span', 'stm-preset-badge is-subtle', `共 ${studio.stations.length} 个`),
    );

    const headRight = el('div', 'stm-api-head-links');
    const importBtn = el('button', 'stm-ghost-link');
    importBtn.type = 'button';
    importBtn.disabled = busyImporting;
    importBtn.title = '从酒馆当前配置与原生 Connection Manager 增量导入连接（保留加密密钥绑定）';
    importBtn.append(
      createIconNode(doc, 'download', 'stm-inline-svg'),
      el('span', '', busyImporting ? '导入中…' : '导入已有'),
    );
    importBtn.addEventListener('click', async () => {
      busyImporting = true;
      renderBody();
      try {
        const added = await refreshSecretsAndBootstrap({ forceImport: true });
        toastMessage(
          added > 0 ? `已增量导入 ${added} 个酒馆连接配置` : '当前配置已在列表中，无新增项',
          added > 0 ? 'success' : 'info',
        );
      } finally {
        busyImporting = false;
        if (isOpen) renderBody();
      }
    });

    const nativeLinkBtn = el('button', 'stm-ghost-link', '原生面板 ›');
    nativeLinkBtn.type = 'button';
    nativeLinkBtn.title = '切换到酒馆原生 API 抽屉（供非聊天补全或极端底层参数使用）';
    nativeLinkBtn.addEventListener('click', () => {
      close();
      openNativeDrawer('sys-settings-button', { getContext });
    });

    headRight.append(importBtn, nativeLinkBtn);
    topHead.append(headLeft, headRight);
    secStations.append(topHead);

    // 当前站子下拉触发栏（左侧站子名，右侧融合绿灯就绪态与下拉箭头）+ 右侧 [+ 新建]
    const effectiveTone =
      connectionBanner.tone !== 'idle'
        ? connectionBanner.tone
        : secStatus.valid
          ? 'ok'
          : 'warn';
    const shortReadyLabel = switchingStationId
      ? '切换中…'
      : effectiveTone === 'err'
        ? '连接异常'
        : secStatus.valid
          ? '已就绪'
          : '待配密钥';

    const pickerRow = el('div', 'stm-station-picker-row');
    const pickerBtn = el(
      'button',
      `stm-station-picker-btn${stationPickerOpen ? ' is-open' : ''}`,
    );
    pickerBtn.type = 'button';
    pickerBtn.setAttribute('aria-expanded', String(stationPickerOpen));
    pickerBtn.title = '点击展开切换其他 API 站子';

    const pickerLeft = el('span', 'stm-station-picker-left');
    const triggerNameSpan = el('strong', 'stm-station-picker-name', station.name);
    liveRefs.activeTriggerNameEl = triggerNameSpan;
    pickerLeft.append(triggerNameSpan);
    if (studio.defaultStationId && studio.defaultStationId === station.id) {
      pickerLeft.append(el('span', 'stm-station-trigger-default', '默认'));
    }

    const pickerRight = el('span', 'stm-station-picker-right');
    pickerRight.append(
      el('span', `stm-status-dot is-${effectiveTone}`),
      el('span', 'stm-station-ready-text', shortReadyLabel),
      createIconNode(doc, 'chevron', 'stm-station-picker-chevron'),
    );

    pickerBtn.append(pickerLeft, pickerRight);
    pickerBtn.addEventListener('click', () => {
      stationPickerOpen = !stationPickerOpen;
      if (!stationPickerOpen) {
        stationFilterText = '';
      }
      renderBody();
    });

    const addStationBtn = el('button', 'stm-station-add-btn');
    addStationBtn.type = 'button';
    addStationBtn.title = '新增一张站子卡片';
    addStationBtn.append(createIconNode(doc, 'plus', 'stm-inline-svg'), el('span', '', '新建'));
    addStationBtn.addEventListener('click', handleCreateStation);

    pickerRow.append(pickerBtn, addStationBtn);
    secStations.append(pickerRow);

    // 按需展开的站子下拉面板（站子多时支持关键词秒搜）
    const stationDropWrap = el('div', 'stm-model-dropdown stm-station-dropdown');
    stationDropWrap.hidden = !stationPickerOpen;
    liveRefs.stationDropdownWrap = stationDropWrap;

    if (studio.stations.length >= 4) {
      const stSearchWrap = el('div', 'stm-station-search-row');
      const stSearchBox = el('div', 'stm-model-search-box');
      stSearchBox.append(createIconNode(doc, 'search', 'stm-model-search-icon'));
      const stSearchInput = el('input', 'stm-api-input stm-model-combo-input stm-compact-input');
      stSearchInput.type = 'text';
      stSearchInput.placeholder = `搜索 ${studio.stations.length} 个站子名称或地址…`;
      stSearchInput.value = stationFilterText;
      stSearchInput.addEventListener('input', () => {
        stationFilterText = stSearchInput.value;
        renderStationListOnly();
      });
      stSearchBox.append(stSearchInput);
      stSearchWrap.append(stSearchBox);
      stationDropWrap.append(stSearchWrap);
    }

    const stationListWrap = el('div', 'stm-model-list stm-station-list');
    liveRefs.stationListWrap = stationListWrap;
    stationDropWrap.append(stationListWrap);
    renderStationListOnly();
    secStations.append(stationDropWrap);

    // 当前站子紧凑连接摘要 + 明面管理操作栏（测活 / 配置连接 / 设为默认 / 复制 / 删除）
    const summaryBar = el('div', 'stm-station-summary-bar');
    const summaryText = el(
      'div',
      'stm-station-summary-text',
      formatStationCompactSummary(station, secStatus),
    );
    summaryText.title = `${meta.label}${station.url ? ` · ${station.url}` : ''} · ${secStatus.statusText}`;
    summaryBar.append(summaryText);

    if (
      connectionBanner.text &&
      !connectionBanner.text.startsWith('已切换至')
    ) {
      summaryBar.append(
        el(
          'div',
          `stm-station-banner-note is-${connectionBanner.tone || 'info'}`,
          connectionBanner.text,
        ),
      );
    }

    const summaryActions = el('div', 'stm-station-summary-actions');
    const leftQuickBtns = el('div', 'stm-station-ops-left');

    const probeQuickBtn = el('button', 'stm-mini-action-btn');
    probeQuickBtn.type = 'button';
    probeQuickBtn.disabled = busyConnecting || busyTesting;
    probeQuickBtn.title = '发送一条真实轻量测试请求，验证密钥、地址与当前模型是否可用（不污染聊天记录）';
    probeQuickBtn.append(
      createIconNode(doc, 'bolt', 'stm-inline-svg'),
      el('span', '', busyTesting ? '测活中…' : '测活'),
    );
    probeQuickBtn.addEventListener('click', () => {
      void handleTestStationReply();
    });

    const toggleCfgBtn = el('button', `stm-mini-action-btn stm-cfg-toggle-btn${showConfigForm ? ' is-active' : ''}`);
    toggleCfgBtn.type = 'button';
    toggleCfgBtn.append(
      createIconNode(doc, 'sliders', 'stm-inline-svg'),
      el('span', '', showConfigForm ? '收起配置 ▴' : '配置连接 ▾'),
    );
    toggleCfgBtn.addEventListener('click', () => {
      if (showConfigForm) {
        flushPendingFormInputs({ syncHostIfActive: true });
        forceExpandStationId = '';
        configExpanded = false;
      } else {
        configExpanded = true;
      }
      confirmDeleteId = '';
      renderBody();
    });

    leftQuickBtns.append(probeQuickBtn, toggleCfgBtn);

    const rightQuickOps = el('div', 'stm-station-ops-right');
    const isAlreadyPrimary =
      studio.defaultStationId === station.id && studio.stations[0]?.id === station.id;

    if (!isAlreadyPrimary) {
      const setDefBtn = el('button', 'stm-ghost-link stm-set-default-btn');
      setDefBtn.type = 'button';
      setDefBtn.title = '将此站子设为你的默认主站并置顶到第 1 位';
      setDefBtn.append(createIconNode(doc, 'pin', 'stm-inline-svg'), el('span', '', '设为默认'));
      setDefBtn.addEventListener('click', () => handleSetPrimaryDefault(station));
      rightQuickOps.append(setDefBtn);
    }

    const dupBtn = el('button', 'stm-ghost-link');
    dupBtn.type = 'button';
    dupBtn.title = '复制当前站子的地址、密钥绑定与收藏模型';
    dupBtn.append(createIconNode(doc, 'copy', 'stm-inline-svg'), el('span', '', '复制'));
    dupBtn.addEventListener('click', handleDuplicateStation);
    rightQuickOps.append(dupBtn);

    if (studio.stations.length > 1) {
      const delBtn = el(
        'button',
        `stm-danger-link stm-station-del-btn${confirmDeleteId === station.id ? ' is-confirm' : ''}`,
      );
      delBtn.type = 'button';
      delBtn.title = '删除当前站子卡片（点击后需再次确认，防止误删）';
      delBtn.append(
        createIconNode(doc, 'trash', 'stm-inline-svg'),
        el('span', '', confirmDeleteId === station.id ? '确认删除?' : '删除'),
      );
      delBtn.addEventListener('click', () => handleDeleteActiveStation(station));
      rightQuickOps.append(delBtn);
    }

    summaryActions.append(leftQuickBtns, rightQuickOps);
    summaryBar.append(summaryActions);
    secStations.append(summaryBar);

    // =========================================================================
    // 1-B. 按需展开的连接配置表单（日常切卡切模型时隐藏，零文字压迫感）
    // =========================================================================
    if (showConfigForm) {
      const cfgPanel = el('div', 'stm-station-config-panel');
      const formGrid = el('div', 'stm-api-form-grid');

      // 第一行：站子名称 + 接口类型（下拉归并全部 26 个来源，告别满屏胶囊墙）
      const nameSourceRow = el('div', 'stm-api-two-col');

      const nameField = el('div', 'stm-api-field');
      nameField.append(el('label', 'stm-cell-label', '站子名称'));
      const nameInput = el('input', 'stm-api-input');
      nameInput.type = 'text';
      nameInput.value = station.name;
      nameInput.placeholder = '例如：主力站 / DeepSeek直连';
      liveRefs.nameInput = nameInput;
      nameInput.addEventListener('input', () => {
        const trimmed = nameInput.value.trim();
        if (!trimmed) return;
        updateStationById(station.id, { name: trimmed }, { silent: true });
        if (liveRefs.activeTriggerNameEl) {
          liveRefs.activeTriggerNameEl.textContent = trimmed;
        }
        if (liveRefs.activePillNameEl) {
          liveRefs.activePillNameEl.textContent = trimmed;
        }
      });
      nameInput.addEventListener('change', () => {
        const trimmed = nameInput.value.trim();
        if (!trimmed) {
          const latest = getActiveStation();
          nameInput.value = latest?.name || station.name;
          return;
        }
        updateStationById(station.id, { name: trimmed }, { silent: true });
        if (liveRefs.activeTriggerNameEl) {
          liveRefs.activeTriggerNameEl.textContent = trimmed;
        }
        if (liveRefs.activePillNameEl) {
          liveRefs.activePillNameEl.textContent = trimmed;
        }
      });
      nameInput.addEventListener('keydown', evt => {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          nameInput.blur?.();
        }
      });
      nameField.append(nameInput);

      const srcField = el('div', 'stm-api-field');
      srcField.append(el('label', 'stm-cell-label', '接口类型'));
      const sourceSelect = el('select', 'stm-api-select stm-more-source-select');
      sourceSelect.setAttribute('aria-label', '接口类型');

      const primaryGroup = doc.createElement('optgroup');
      primaryGroup.label = '常用接口';
      for (const srcId of PRIMARY_SOURCE_IDS) {
        const opt = el('option', '', API_SOURCES[srcId].label);
        opt.value = srcId;
        opt.selected = station.source === srcId;
        primaryGroup.append(opt);
      }

      const moreGroup = doc.createElement('optgroup');
      moreGroup.label = '更多官方与聚合平台';
      for (const srcId of MORE_SOURCE_IDS) {
        const opt = el('option', '', API_SOURCES[srcId].label);
        opt.value = srcId;
        opt.selected = station.source === srcId;
        moreGroup.append(opt);
      }

      sourceSelect.append(primaryGroup, moreGroup);
      sourceSelect.value = station.source;
      sourceSelect.addEventListener('change', () => {
        const chosen = sourceSelect.value;
        if (!chosen || chosen === station.source) return;
        const flushed = flushPendingFormInputs({ syncHostIfActive: false }) || station;
        const nextSecretType = resolveSecretKeyForStation({ ...flushed, source: chosen });
        const updated = updateStationById(
          station.id,
          {
            source: chosen,
            secretKeyType: nextSecretType,
            secretId: '',
            secretLabel: '',
            cachedModels: [],
          },
          { silent: true },
        );
        if (updated) applyStationToHost(updated, { getContext });
        connectionBanner = { tone: 'idle', text: '' };
        configExpanded = true;
        renderBody();
      });
      srcField.append(sourceSelect);

      nameSourceRow.append(nameField, srcField);
      formGrid.append(nameSourceRow);

      // 第二行：接口地址（支持 URL 的来源显示）
      if (meta.urlMode !== 'none') {
        const urlField = el('div', 'stm-api-field');
        urlField.append(
          el(
            'label',
            'stm-cell-label',
            station.source === 'custom'
              ? '接口地址 (Base URL)'
              : station.source === 'azure_openai'
                ? 'Azure 资源端点 (Base URL)'
                : '反向代理地址（官方直连留空）',
          ),
        );

        const urlInputWrap = el('div', 'stm-api-inline-row');
        const urlInput = el('input', 'stm-api-input');
        urlInput.type = 'url';
        urlInput.value = station.url;
        urlInput.placeholder = meta.urlPlaceholder || 'https://...';
        liveRefs.urlInput = urlInput;

        const v1Btn = el('button', 'stm-v1-chip-btn', '补全 /v1');
        v1Btn.type = 'button';
        v1Btn.title = '一键在地址末尾补上 /v1';
        v1Btn.hidden = !needsV1Suffix(station.url, station.source);
        liveRefs.v1Btn = v1Btn;

        const commitUrl = rawVal => {
          const trimmed = rawVal.trim();
          if (trimmed && !sanitizeEndpointUrl(trimmed)) {
            toastMessage('请输入以 http:// 或 https:// 开头的有效地址', 'warning');
            return false;
          }
          const updated = updateStationById(station.id, { url: trimmed }, { silent: true });
          if (updated) applyStationToHost(updated, { getContext });
          v1Btn.hidden = !needsV1Suffix(trimmed, station.source);
          return true;
        };

        urlInput.addEventListener('input', () => {
          v1Btn.hidden = !needsV1Suffix(urlInput.value, station.source);
        });
        urlInput.addEventListener('change', () => {
          commitUrl(urlInput.value);
        });
        urlInput.addEventListener('keydown', evt => {
          if (evt.key === 'Enter') {
            evt.preventDefault();
            if (commitUrl(urlInput.value)) {
              void handleSaveAndConnect({ pullModelsOnly: false });
            }
          }
        });

        v1Btn.addEventListener('click', () => {
          const nextUrl = appendV1Suffix(urlInput.value || station.url);
          urlInput.value = nextUrl;
          commitUrl(nextUrl);
        });

        urlInputWrap.append(urlInput, v1Btn);
        urlField.append(urlInputWrap);
        formGrid.append(urlField);
      }

      // Vertex AI 核心鉴权与区域
      if (station.source === 'vertexai') {
        const vertexBox = el('div', 'stm-vertex-subbox');
        const authCol = el('div', 'stm-api-field');
        authCol.append(el('label', 'stm-cell-label', 'Vertex 鉴权模式'));
        const authToggle = el('div', 'stm-dual-toggle');
        for (const [mId, mLabel] of [
          ['express', 'Express (API Key)'],
          ['full', 'Full (服务账号 JSON)'],
        ]) {
          const b = el(
            'button',
            `stm-toggle-pill${station.vertexAuthMode === mId ? ' is-active' : ''}`,
            mLabel,
          );
          b.type = 'button';
          b.addEventListener('click', () => {
            if (station.vertexAuthMode === mId) return;
            const flushed = flushPendingFormInputs({ syncHostIfActive: false }) || station;
            const nextKeyType = resolveSecretKeyForStation({ ...flushed, vertexAuthMode: mId });
            const updated = updateStationById(
              station.id,
              {
                vertexAuthMode: mId,
                secretKeyType: nextKeyType,
                secretId: '',
                secretLabel: '',
              },
              { silent: true },
            );
            if (updated) applyStationToHost(updated, { getContext });
            renderBody();
          });
          authToggle.append(b);
        }
        authCol.append(authToggle);

        const regionCol = el('div', 'stm-api-field');
        regionCol.append(el('label', 'stm-cell-label', '区域 Region'));
        const regionInput = el('input', 'stm-api-input');
        regionInput.type = 'text';
        regionInput.value = station.vertexRegion || 'global';
        regionInput.placeholder = 'global / us-central1';
        liveRefs.regionInput = regionInput;
        regionInput.addEventListener('change', () => {
          const updated = updateStationById(
            station.id,
            { vertexRegion: regionInput.value.trim() || 'global' },
            { silent: true },
          );
          if (updated) applyStationToHost(updated, { getContext });
        });
        regionCol.append(regionInput);

        vertexBox.append(authCol, regionCol);
        formGrid.append(vertexBox);
      }

      // 第三行：专属密钥保险箱 + [保存并连接]
      const secretField = el('div', 'stm-api-field');
      const secretHead = el('div', 'stm-cell-head');
      const hasPendingKey = Boolean(curPendingSecret.trim());
      const secretBadge = el(
        'span',
        `stm-secret-status${hasPendingKey ? ' is-pending' : secStatus.valid ? ' is-valid' : ''}`,
      );
      const secretBadgeText = el(
        'span',
        '',
        hasPendingKey
          ? '已填新密钥（点右侧「保存并连接」生效）'
          : secStatus.statusText,
      );
      secretBadge.append(createIconNode(doc, 'key', 'stm-inline-svg'), secretBadgeText);
      liveRefs.secretBadgeEl = secretBadge;
      secretHead.append(secretBadge);

      if (!hasPendingKey && secStatus.inherited && secStatus.secretId) {
        const bindBtn = el('button', 'stm-ghost-link', '固定绑定此密钥');
        bindBtn.type = 'button';
        bindBtn.addEventListener('click', () => {
          updateStationById(
            station.id,
            {
              secretKeyType: secStatus.secretKeyType,
              secretId: secStatus.secretId,
              secretLabel: secStatus.label || '',
            },
            { silent: true },
          );
          toastMessage('已将该密钥强绑定至当前站子卡片', 'success');
          renderBody();
        });
        secretHead.append(bindBtn);
      }
      secretField.append(secretHead);

      const secretRow = el('div', 'stm-api-inline-row');
      const keyWrap = el('div', 'stm-secret-input-wrap');
      const keyInput = el('input', 'stm-api-input stm-secret-input');
      keyInput.type = showPlainSecret ? 'text' : 'password';
      keyInput.autocomplete = 'off';
      keyInput.spellcheck = false;
      keyInput.value = curPendingSecret;
      keyInput.placeholder =
        station.source === 'vertexai' && station.vertexAuthMode === 'full'
          ? secStatus.bound
            ? '已加密保存 JSON 凭据（留空保持不变）'
            : '粘贴 Google 服务账号 JSON…'
          : secStatus.bound
            ? '已存入保险箱（留空保持原密钥，填新 Key 更新）'
            : '输入 API Key（加密存入酒馆保险箱）';
      keyInput.addEventListener('input', () => {
        setPendingSecret(station.id, keyInput.value);
        const dirty = Boolean(keyInput.value.trim());
        secretBadge.classList.toggle('is-pending', dirty);
        secretBadge.classList.toggle('is-valid', !dirty && secStatus.valid);
        secretBadgeText.textContent = dirty
          ? '已填新密钥（点右侧「保存并连接」生效）'
          : secStatus.statusText;
      });
      keyInput.addEventListener('keydown', evt => {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          void handleSaveAndConnect({ pullModelsOnly: false });
        }
      });

      const eyeBtn = el('button', 'stm-secret-eye-btn');
      eyeBtn.type = 'button';
      eyeBtn.title = showPlainSecret ? '隐藏输入内容' : '显示输入内容';
      eyeBtn.setAttribute('aria-label', eyeBtn.title);
      eyeBtn.innerHTML = svgMarkup(showPlainSecret ? 'eyeoff' : 'eye');
      eyeBtn.addEventListener('click', () => {
        showPlainSecret = !showPlainSecret;
        keyInput.type = showPlainSecret ? 'text' : 'password';
        eyeBtn.title = showPlainSecret ? '隐藏输入内容' : '显示输入内容';
        eyeBtn.setAttribute('aria-label', eyeBtn.title);
        eyeBtn.innerHTML = svgMarkup(showPlainSecret ? 'eyeoff' : 'eye');
      });
      keyWrap.append(keyInput, eyeBtn);

      const connectBtn = el('button', 'stm-connect-btn');
      connectBtn.type = 'button';
      connectBtn.disabled = busyConnecting || busyTesting;
      connectBtn.append(
        createIconNode(doc, 'plug', 'stm-inline-svg'),
        el('span', '', busyConnecting ? '连接中…' : '保存并连接'),
      );
      connectBtn.addEventListener('click', () => {
        void handleSaveAndConnect({ pullModelsOnly: false });
      });

      secretRow.append(keyWrap, connectBtn);
      secretField.append(secretRow);
      formGrid.append(secretField);

      // 第四行：底部低频高级选项（折叠「提示词消息后处理」；设为默认 / 复制 / 删除已提至上方明面摘要栏，零重复）
      const footBar = el('div', 'stm-config-footbar');
      const hasNonDefaultAdv = Boolean(
        station.postProcessing ||
          (station.source === 'vertexai' && station.vertexAuthMode === 'express' && station.vertexProjectId),
      );
      const advToggleBtn = el(
        'button',
        'stm-ghost-link stm-adv-toggle-btn',
        advancedExpanded
          ? '收起高级选项 ▴'
          : `高级选项${hasNonDefaultAdv ? ' (已设)' : ''} ▾`,
      );
      advToggleBtn.type = 'button';
      advToggleBtn.addEventListener('click', () => {
        flushPendingFormInputs({ syncHostIfActive: true });
        advancedExpanded = !advancedExpanded;
        renderBody();
      });

      footBar.append(advToggleBtn);
      formGrid.append(footBar);

      // 极低频高级选项（默认隐藏，绝大多数玩家无需看到「提示词消息后处理」）
      if (advancedExpanded) {
        const advBox = el('div', 'stm-advanced-subbox');
        const ppField = el('div', 'stm-api-field');
        ppField.append(el('label', 'stm-cell-label', '提示词消息后处理（常规保持默认无后处理即可）'));
        const ppSelect = el('select', 'stm-api-select');
        for (const item of POST_PROCESSING_OPTIONS) {
          const opt = el('option', '', item.label);
          opt.value = item.id;
          opt.selected = station.postProcessing === item.id;
          ppSelect.append(opt);
        }
        ppSelect.addEventListener('change', () => {
          const updated = updateStationById(
            station.id,
            { postProcessing: ppSelect.value },
            { silent: true },
          );
          if (updated) applyStationToHost(updated, { getContext });
        });
        ppField.append(ppSelect);
        advBox.append(ppField);

        if (station.source === 'vertexai' && station.vertexAuthMode === 'express') {
          const projCol = el('div', 'stm-api-field');
          projCol.append(el('label', 'stm-cell-label', 'Vertex Express Project ID（可选）'));
          const projInput = el('input', 'stm-api-input');
          projInput.type = 'text';
          projInput.value = station.vertexProjectId || '';
          projInput.placeholder = '留空走标准端点，有指定 GCP 项目 ID 时填写';
          liveRefs.projectIdInput = projInput;
          projInput.addEventListener('change', () => {
            const updated = updateStationById(
              station.id,
              { vertexProjectId: projInput.value.trim() },
              { silent: true },
            );
            if (updated) applyStationToHost(updated, { getContext });
          });
          projCol.append(projInput);
          advBox.append(projCol);
        }

        formGrid.append(advBox);
      }

      cfgPanel.append(formGrid);
      secStations.append(cfgPanel);
    }

    bodyEl.append(secStations);

    // =========================================================================
    // 2. 主对话模型区（C位高频：常用收藏胶囊 + 搜索/手输二合一框 + 拉取列表）
    // =========================================================================
    const secModels = el('section', 'stm-dock-section');
    const modelHead = el('div', 'stm-sec-head');
    modelHead.append(el('span', 'stm-sec-title', '主对话模型'));
    if (station.cachedModels.length > 0) {
      const toggleListBtn = el(
        'button',
        'stm-ghost-link',
        modelDropdownOpen ? '收起模型表 ▴' : `展开模型表 (${station.cachedModels.length}) ▾`,
      );
      toggleListBtn.type = 'button';
      toggleListBtn.addEventListener('click', () => {
        modelDropdownOpen = !modelDropdownOpen;
        modelFilterTouched = false;
        renderModelDropdownOnly();
        toggleListBtn.textContent = modelDropdownOpen
          ? '收起模型表 ▴'
          : `展开模型表 (${station.cachedModels.length}) ▾`;
      });
      modelHead.append(toggleListBtn);
    }
    secModels.append(modelHead);

    if (station.favoriteModels.length > 0) {
      const favBar = el('div', 'stm-fav-models-bar');
      for (const favModel of station.favoriteModels) {
        const isCur = station.model === favModel;
        const chip = el('div', `stm-fav-chip${isCur ? ' is-active' : ''}`);

        const selectFavBtn = el('button', 'stm-fav-chip-main', favModel);
        selectFavBtn.type = 'button';
        selectFavBtn.title = `切换至模型：${favModel}`;
        selectFavBtn.addEventListener('click', () => {
          applyModelSelection(station, favModel, { closeDropdown: false, reRenderAll: true });
          toastMessage(`已切换模型：${favModel}`, 'info');
        });

        const removeFavBtn = el('button', 'stm-fav-chip-del', '×');
        removeFavBtn.type = 'button';
        removeFavBtn.title = '取消收藏';
        removeFavBtn.setAttribute('aria-label', `取消收藏 ${favModel}`);
        removeFavBtn.addEventListener('click', evt => {
          evt.preventDefault();
          evt.stopPropagation();
          const nextFavs = toggleFavoriteModel(station.favoriteModels, favModel);
          updateStationById(station.id, { favoriteModels: nextFavs }, { silent: true });
          renderBody();
        });

        chip.append(selectFavBtn, removeFavBtn);
        favBar.append(chip);
      }
      secModels.append(favBar);
    } else if (!station.model) {
      secModels.append(el('div', 'stm-api-micro-hint', '点右侧星标可将常用模型固定成快捷胶囊'));
    }

    const comboRow = el('div', 'stm-model-combo-row');
    const searchBox = el('div', 'stm-model-search-box');
    searchBox.append(createIconNode(doc, 'search', 'stm-model-search-icon'));

    const modelInput = el('input', 'stm-api-input stm-model-combo-input');
    modelInput.type = 'text';
    modelInput.spellcheck = false;
    modelInput.value = modelFilterTouched ? modelFilterText : station.model;
    modelInput.placeholder =
      station.cachedModels.length > 0
        ? `搜索 ${station.cachedModels.length} 个模型，或直接手输回车…`
        : '手输模型名，或点右侧「拉取模型」…';
    liveRefs.modelInput = modelInput;

    modelInput.addEventListener('focus', () => {
      if (station.cachedModels.length > 0 && !modelDropdownOpen) {
        modelDropdownOpen = true;
        renderModelDropdownOnly();
      }
    });

    modelInput.addEventListener('input', () => {
      modelFilterText = modelInput.value;
      modelFilterTouched = true;
      if (station.cachedModels.length > 0 || modelFilterText.trim()) {
        modelDropdownOpen = true;
      }
      syncStarButtonVisual(station);
      renderModelDropdownOnly();
    });

    modelInput.addEventListener('keydown', evt => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        applyModelSelection(station, modelInput.value, { closeDropdown: true, reRenderAll: true });
        if (modelInput.value.trim()) {
          toastMessage(`当前模型已设为：${modelInput.value.trim()}`, 'info');
        }
      }
    });

    modelInput.addEventListener('change', () => {
      const val = modelInput.value.trim();
      if (val && val !== station.model) {
        applyModelSelection(station, val, { closeDropdown: false, reRenderAll: false });
      }
    });

    searchBox.append(modelInput);

    const favStarBtn = el('button', 'stm-icon-action-btn');
    favStarBtn.type = 'button';
    favStarBtn.innerHTML = svgMarkup('star');
    liveRefs.favStarBtn = favStarBtn;
    syncStarButtonVisual(station);
    favStarBtn.addEventListener('click', () => {
      const targetModel = String(modelInput.value || station.model || '').trim();
      if (!targetModel) {
        toastMessage('请先选择或输入一个模型名称再收藏', 'info');
        return;
      }
      const nextFavs = toggleFavoriteModel(station.favoriteModels, targetModel);
      const updated = updateStationById(
        station.id,
        { model: targetModel, favoriteModels: nextFavs },
        { silent: true },
      );
      if (updated) applyStationToHost(updated, { getContext });
      renderBody();
    });

    const pullBtn = el('button', 'stm-pull-models-btn');
    pullBtn.type = 'button';
    pullBtn.disabled = busyConnecting || busyTesting;
    pullBtn.title = '请求接口拉取可用模型列表';
    pullBtn.append(
      createIconNode(doc, 'refresh', 'stm-inline-svg'),
      el('span', '', '拉取模型'),
    );
    pullBtn.addEventListener('click', () => {
      void handleSaveAndConnect({ pullModelsOnly: true });
    });

    comboRow.append(searchBox, favStarBtn, pullBtn);
    secModels.append(comboRow);

    const dropdownWrap = el('div', 'stm-model-dropdown');
    liveRefs.modelDropdownWrap = dropdownWrap;
    secModels.append(dropdownWrap);
    renderModelDropdownOnly();

    bodyEl.append(secModels);

    // =========================================================================
    // 3. 副 API 通道卡片（清晰存在感 + 独立站子下拉搜索选模型 + 零干扰拉取列表）
    // =========================================================================
    const secAux = el('section', 'stm-dock-section stm-aux-section');
    const auxCard = el('div', 'stm-aux-card');
    const curAux = store.get().auxApi;
    const effectiveAuxStationId = curAux.stationId || station.id;
    const boundAuxStation =
      curAux.mode === 'station'
        ? studio.stations.find(s => s.id === effectiveAuxStationId) || studio.stations[0] || null
        : null;

    const auxHead = el('div', 'stm-aux-head');
    const auxTitleWrap = el('div', 'stm-aux-title-wrap');
    auxTitleWrap.append(
      createIconNode(doc, 'spark', 'stm-inline-svg stm-aux-spark'),
      el('span', 'stm-aux-title', '副 API 通道'),
      el('span', 'stm-aux-subtag', '预设助手 / 人设 / 记忆共用'),
    );

    const auxSwitch = el('div', 'stm-aux-mode-switch');
    for (const [mId, mText] of [
      ['follow_main', '跟随主通道'],
      ['station', '独立指定'],
    ]) {
      const b = el(
        'button',
        `stm-aux-mode-pill${curAux.mode === mId ? ' is-active' : ''}`,
        mText,
      );
      b.type = 'button';
      b.addEventListener('click', () => {
        if (curAux.mode === mId) return;
        flushPendingFormInputs({ syncHostIfActive: true });
        const fallbackStationId = curAux.stationId || station.id;
        auxModelDropdownOpen = false;
        auxModelFilterTouched = false;
        auxModelFilterText = curAux.model || '';
        store.update(
          {
            auxApi: {
              ...curAux,
              mode: mId,
              enabled: mId === 'station',
              stationId: mId === 'station' ? fallbackStationId : curAux.stationId,
            },
          },
          { silent: true },
        );
        renderBody();
      });
      auxSwitch.append(b);
    }

    auxHead.append(auxTitleWrap, auxSwitch);
    auxCard.append(auxHead);

    if (curAux.mode === 'station' && boundAuxStation) {
      const auxBody = el('div', 'stm-aux-body');
      const auxFields = el('div', 'stm-api-two-col');

      const stCol = el('div', 'stm-api-field');
      stCol.append(el('label', 'stm-cell-label', '副通道站子'));
      const stSelect = el('select', 'stm-api-select stm-aux-station-select');
      for (const s of studio.stations) {
        const label =
          s.source === 'custom'
            ? s.name
            : `${s.name} · ${getSourceMeta(s.source).shortLabel}`;
        const opt = el('option', '', label);
        opt.value = s.id;
        opt.selected = boundAuxStation.id === s.id;
        stSelect.append(opt);
      }
      stSelect.addEventListener('change', () => {
        const nextSt = studio.stations.find(s => s.id === stSelect.value);
        auxModelDropdownOpen = Boolean(
          nextSt && ((nextSt.cachedModels?.length || 0) > 0 || (nextSt.favoriteModels?.length || 0) > 0),
        );
        auxModelFilterTouched = false;
        auxModelFilterText = store.get().auxApi.model || '';
        store.update(
          {
            auxApi: {
              ...store.get().auxApi,
              mode: 'station',
              enabled: true,
              stationId: stSelect.value,
            },
          },
          { silent: true },
        );
        renderBody();
      });
      stCol.append(stSelect);

      const mCol = el('div', 'stm-api-field');
      const auxCandidateCount = new Set([
        ...(boundAuxStation.favoriteModels || []),
        ...(boundAuxStation.cachedModels || []),
      ]).size;
      const mHead = el('div', 'stm-cell-head');
      mHead.append(el('label', 'stm-cell-label', '副通道模型（可下拉搜索或手输）'));
      if (auxCandidateCount > 0) {
        const auxDropToggle = el(
          'button',
          'stm-ghost-link',
          auxModelDropdownOpen ? '收起 ▴' : `可选 (${auxCandidateCount}) ▾`,
        );
        auxDropToggle.type = 'button';
        auxDropToggle.addEventListener('click', () => {
          auxModelDropdownOpen = !auxModelDropdownOpen;
          auxModelFilterTouched = false;
          renderAuxModelDropdownOnly();
          auxDropToggle.textContent = auxModelDropdownOpen
            ? '收起 ▴'
            : `可选 (${auxCandidateCount}) ▾`;
        });
        mHead.append(auxDropToggle);
      }
      mCol.append(mHead);

      const auxComboRow = el('div', 'stm-model-combo-row');
      const auxInputWrap = el('div', 'stm-model-search-box');
      auxInputWrap.append(createIconNode(doc, 'search', 'stm-model-search-icon'));

      const auxModelInput = el('input', 'stm-api-input stm-model-combo-input stm-aux-model-input');
      auxModelInput.type = 'text';
      auxModelInput.spellcheck = false;
      auxModelInput.value = auxModelFilterTouched ? auxModelFilterText : curAux.model || '';
      auxModelInput.placeholder = boundAuxStation.model
        ? `默认跟随 ${boundAuxStation.model}（点此切换）`
        : auxCandidateCount > 0
          ? `点此从 ${auxCandidateCount} 个模型中选择…`
          : '点右侧拉取列表，或直接手输…';
      liveRefs.auxModelInput = auxModelInput;

      auxModelInput.addEventListener('focus', () => {
        if (!auxModelDropdownOpen) {
          auxModelDropdownOpen = true;
          renderAuxModelDropdownOnly();
        }
      });

      auxModelInput.addEventListener('input', () => {
        auxModelFilterText = auxModelInput.value;
        auxModelFilterTouched = true;
        auxModelDropdownOpen = true;
        renderAuxModelDropdownOnly();
      });

      auxModelInput.addEventListener('keydown', evt => {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          applyAuxModelSelection(auxModelInput.value, { closeDropdown: true, reRenderAll: true });
          const cleanVal = auxModelInput.value.trim();
          toastMessage(
            cleanVal ? `副通道模型已设为：${cleanVal}` : '副通道已恢复跟随该站子默认模型',
            'info',
          );
        }
      });

      auxModelInput.addEventListener('change', () => {
        const cleanVal = auxModelInput.value.trim();
        if (cleanVal !== (store.get().auxApi.model || '')) {
          applyAuxModelSelection(cleanVal, { closeDropdown: false, reRenderAll: false });
        }
      });

      auxInputWrap.append(auxModelInput);

      const pullAuxBtn = el('button', 'stm-icon-action-btn stm-aux-pull-btn');
      pullAuxBtn.type = 'button';
      pullAuxBtn.disabled = busyPullingAux;
      pullAuxBtn.title = `拉取「${boundAuxStation.name}」的可用模型列表（不影响当前主对话连接）`;
      pullAuxBtn.setAttribute('aria-label', pullAuxBtn.title);
      pullAuxBtn.innerHTML = svgMarkup('refresh');
      pullAuxBtn.addEventListener('click', () => {
        void handlePullAuxStationModels(boundAuxStation);
      });

      auxComboRow.append(auxInputWrap, pullAuxBtn);
      mCol.append(auxComboRow);
      auxFields.append(stCol, mCol);
      auxBody.append(auxFields);

      const auxDropWrap = el('div', 'stm-model-dropdown stm-aux-model-dropdown');
      liveRefs.auxModelDropdownWrap = auxDropWrap;
      auxBody.append(auxDropWrap);
      renderAuxModelDropdownOnly();

      auxCard.append(auxBody);
    }

    secAux.append(auxCard);
    bodyEl.append(secAux);
  }

  function ensureDom() {
    const doc = globalThis.document;
    if (!doc) return null;
    if (dockEl?.isConnected) return dockEl;

    dockEl = doc.getElementById('stm-api-dock') || el('aside', 'stm-api-dock');
    dockEl.id = 'stm-api-dock';
    dockEl.setAttribute('role', 'region');
    dockEl.setAttribute('aria-label', 'API与模型工作台');
    dockEl.hidden = !isOpen;
    dockEl.replaceChildren();

    const stopBubble = evt => evt.stopPropagation();
    dockEl.addEventListener('mousedown', stopBubble);
    dockEl.addEventListener('touchstart', stopBubble, { passive: true });

    bodyEl = el('div', 'stm-dock-body stm-api-dock-body');
    dockEl.append(bodyEl);
    doc.body.append(dockEl);

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
          elTarget.closest('.stm-topbar-api-btn, #sys-settings-button > .drawer-toggle')
        ) {
          return;
        }
        close();
      };
      const onDocKeyDown = evt => {
        if (isOpen && evt.key === 'Escape') {
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

  function isApiTakeoverEnabled() {
    const s = store.get();
    return Boolean(s.shellEnabled && s.modules?.api !== false);
  }

  function open() {
    if (!isApiTakeoverEnabled()) {
      openNativeDrawer('sys-settings-button', { toggleIfOpen: false, getContext });
      return;
    }

    onBeforeOpen?.();
    closeAllNativeDrawers();
    ensureDom();
    isOpen = true;
    lastOpenedAt = Date.now();
    confirmDeleteId = '';
    modelFilterTouched = false;
    auxModelFilterTouched = false;
    const active = getActiveStation();
    modelFilterText = active?.model || '';
    auxModelFilterText = store.get().auxApi?.model || '';

    if (dockEl) {
      dockEl.hidden = false;
    }
    syncBoundsToSheldNow();

    if (getStudioState().stations.length === 0) {
      const { stations, currentHostStation } = mergeImportedStations({
        existingStations: [],
        ctx: getContext?.(),
        secretsMap: secretsCache,
      });
      if (stations.length > 0) {
        store.update(
          {
            apiStudio: {
              activeStationId: currentHostStation?.id || stations[0].id,
              defaultStationId: '',
              stations,
            },
          },
          { silent: true },
        );
      }
    }

    renderBody();
    onOpenStateChange?.(true);

    void refreshSecretsAndBootstrap({ forceImport: !bootstrappedOnce })
      .then(() => {
        if (!isOpen) return;
        const doc = globalThis.document;
        const activeEl = doc?.activeElement;
        const isTypingInside =
          activeEl &&
          dockEl?.contains(activeEl) &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT');
        if (!isTypingInside) {
          renderBody();
        }
      })
      .catch(err => {
        console.warn('[ST伴侣] 读取密钥状态跳过:', err);
      });
  }

  function close() {
    if (!isOpen) return;
    flushPendingFormInputs({ syncHostIfActive: true });
    isOpen = false;
    confirmDeleteId = '';
    stationPickerOpen = false;
    stationFilterText = '';
    modelDropdownOpen = false;
    auxModelDropdownOpen = false;
    if (dockEl) dockEl.hidden = true;
    onOpenStateChange?.(false);
  }

  function toggle() {
    if (!isApiTakeoverEnabled()) {
      openNativeDrawer('sys-settings-button', { toggleIfOpen: true, getContext });
      return;
    }
    if (isOpen) close();
    else open();
  }

  function refresh() {
    if (!isApiTakeoverEnabled()) {
      close();
      return;
    }
    if (!isOpen) return;
    syncBoundsToSheldNow();

    const doc = globalThis.document;
    const activeEl = doc?.activeElement;
    const isTypingInside =
      activeEl &&
      dockEl?.contains(activeEl) &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT');

    if (
      isTypingInside ||
      busyConnecting ||
      busyTesting ||
      busyPullingAux ||
      Boolean(switchingStationId)
    ) {
      return;
    }

    renderBody();
  }

  function destroy() {
    opSeq += 1;
    switchingStationId = '';
    busyConnecting = false;
    busyTesting = false;
    busyPullingAux = false;
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
    pendingSecretsByStation.clear();
    dockEl?.remove();
    dockEl = null;
    bodyEl = null;
  }

  return {
    isOpen: () => isOpen,
    open,
    close,
    toggle,
    refresh,
    flushPendingSave: () => {
      flushPendingFormInputs({ syncHostIfActive: true });
    },
    destroy,
  };
}
