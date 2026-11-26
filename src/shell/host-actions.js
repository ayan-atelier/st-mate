/**
 * ST伴侣 (st-mate) · 酒馆原生动作安全适配层
 * 封装返回首页、打开/关闭原生抽屉、读取当前角色/群聊头像与名称等标准动作。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.9.5';

let coreModulePromise = null;
let groupModulePromise = null;

function resolveAppAsset(relativePath) {
  const base = globalThis.document?.baseURI || globalThis.location?.origin || 'http://localhost/';
  return new URL(relativePath, base).href;
}

function loadCoreModule() {
  coreModulePromise ||= import(resolveAppAsset('script.js')).catch(err => {
    coreModulePromise = null;
    throw err;
  });
  return coreModulePromise;
}

function loadGroupModule() {
  groupModulePromise ||= import(resolveAppAsset('scripts/group-chats.js')).catch(err => {
    groupModulePromise = null;
    throw err;
  });
  return groupModulePromise;
}

export function resolveAssetHref(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  const cleanRel = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  return resolveAppAsset(cleanRel);
}

/**
 * 上传本地背景图到酒馆原生 backgrounds 目录，返回可跨局域网共用的相对路径 `backgrounds/<filename>`。
 */
export async function uploadBackgroundAsset(file, getContext) {
  if (!file || typeof file !== 'object') {
    throw new Error('请选择有效的图片文件');
  }
  const mime = String(file.type || '').toLowerCase();
  const extMap = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const ext = extMap[mime];
  if (!ext) {
    throw new Error('仅支持 PNG、JPG、WebP 或 GIF 格式图片');
  }
  if (Number(file.size) > 20 * 1024 * 1024) {
    throw new Error('图片体积不能超过 20 MB');
  }

  const ctx = getContext?.();
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const formData = new globalThis.FormData();
  formData.append('avatar', file, `stm-bg-${stamp}.${ext}`);

  const rawHeaders =
    typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders({ omitContentType: true }) : {};
  const headers = new globalThis.Headers(rawHeaders || {});
  headers.delete('Content-Type');

  const response = await globalThis.fetch(resolveAppAsset('api/backgrounds/upload'), {
    method: 'POST',
    headers,
    body: formData,
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error(`上传背景失败（HTTP ${response.status}）`);
  }

  const filename = String(await response.text()).trim();
  if (!filename || /[\\/<>]/.test(filename)) {
    throw new Error('酒馆返回了无效的背景文件名');
  }

  return `backgrounds/${encodeURIComponent(filename)}`;
}

export function toastMessage(message, type = 'info') {
  const toastr = globalThis.toastr;
  if (toastr && typeof toastr[type] === 'function') {
    toastr[type](message, 'ST伴侣', { timeOut: 2400 });
  } else {
    console.info('[ST伴侣]', message);
  }
}

/**
 * 安全关闭当前角色/群聊并返回酒馆首页（书架页）。
 * 若正在生成或保存，给出温和中文提示，绝不强行截断存档写入。
 */
export async function returnToHomeScreen(getContext) {
  const ctx = getContext?.();
  if (!hasActiveChatSelection(ctx)) {
    closeAllNativeDrawers();
    return true;
  }

  try {
    const [core, groups] = await Promise.all([
      loadCoreModule(),
      loadGroupModule().catch(() => ({})),
    ]);

    if (core?.is_send_press || groups?.is_group_generating) {
      toastMessage('酒馆正在生成回复，请先停止生成后再返回首页。', 'warning');
      return false;
    }
    if (core?.isChatSaving) {
      toastMessage('正在保存当前存档，请稍候一秒再试。', 'info');
      return false;
    }

    closeAllNativeDrawers();
    if (typeof core?.closeCurrentChat === 'function') {
      return Boolean(await core.closeCurrentChat());
    }
  } catch (err) {
    console.warn('[ST伴侣] 调用原生 closeCurrentChat 失败，尝试回退指令:', err);
  }

  // 跨版本兜底：通过官方 Slash Command /closechat 关闭当前聊天
  try {
    if (typeof ctx?.executeSlashCommandsWithOptions === 'function') {
      closeAllNativeDrawers();
      await ctx.executeSlashCommandsWithOptions('/closechat', { handleParserErrors: false });
      return true;
    }
  } catch (err) {
    console.warn('[ST伴侣] /closechat 兜底失败:', err);
  }

  toastMessage('当前酒馆版本暂不支持自动关闭聊天，请稍后重试。', 'error');
  return false;
}

export function isNativeDrawerOpen(drawerId) {
  const holder = globalThis.document?.getElementById(drawerId);
  const content = holder?.querySelector(':scope > .drawer-content');
  return Boolean(content?.classList.contains('openDrawer'));
}

export function getOpenNativeDrawerIds() {
  const doc = globalThis.document;
  if (!doc) return [];
  return [...doc.querySelectorAll('#top-settings-holder > .drawer')]
    .filter(drawer => {
      const content = drawer.querySelector(':scope > .drawer-content.openDrawer');
      return Boolean(content && !content.classList.contains('pinnedOpen'));
    })
    .map(drawer => drawer.id)
    .filter(Boolean);
}

export function closeAllNativeDrawers() {
  const doc = globalThis.document;
  if (!doc) return;
  const openDrawers = doc.querySelectorAll('#top-settings-holder > .drawer');
  const prevBypass = globalThis.__stmBypassNativeCapture;
  globalThis.__stmBypassNativeCapture = true;
  try {
    for (const drawer of openDrawers) {
      const content = drawer.querySelector(':scope > .drawer-content');
      if (!content || !content.classList.contains('openDrawer') || content.classList.contains('pinnedOpen')) {
        continue;
      }
      const toggle = drawer.querySelector(':scope > .drawer-toggle');
      toggle?.click();
    }
  } finally {
    globalThis.__stmBypassNativeCapture = prevBypass;
  }
}

/**
 * 打开或切换指定的原生抽屉（如 ai-config-button, sys-settings-button, rightNavHolder, WI-SP-button）。
 */
export function openNativeDrawer(drawerId, { toggleIfOpen = false, getContext = null } = {}) {
  const doc = globalThis.document;
  const drawer = doc?.getElementById(drawerId);
  if (!drawer) {
    toastMessage('未找到对应的酒馆面板，可能被其他插件移除。', 'warning');
    return false;
  }

  const content = drawer.querySelector(':scope > .drawer-content');
  const toggle = drawer.querySelector(':scope > .drawer-toggle');
  if (!content || !toggle) return false;

  const prevBypass = globalThis.__stmBypassNativeCapture;
  globalThis.__stmBypassNativeCapture = true;
  try {
    const alreadyOpen = content.classList.contains('openDrawer');
    if (alreadyOpen) {
      if (toggleIfOpen) {
        toggle.click();
        return false;
      }
      return true;
    }

    toggle.click();
  } finally {
    globalThis.__stmBypassNativeCapture = prevBypass;
  }

  // 打开右侧角色抽屉时，若当前正在单人角色卡对话中，自动切到「当前角色详情」页签，省去二次点击
  if (drawerId === 'rightNavHolder') {
    const ctx = getContext?.();
    if (ctx && ctx.groupId == null && ctx.characterId !== undefined && ctx.characterId !== null && ctx.characterId !== '') {
      setTimeout(() => {
        const selectedBtn = doc.getElementById('rm_button_selected_ch');
        const detailBlock = doc.getElementById('rm_ch_create_block');
        if (selectedBtn && detailBlock && globalThis.getComputedStyle(detailBlock).display === 'none') {
          selectedBtn.click();
        }
      }, 30);
    }
  }

  return true;
}

/**
 * 读取当前聊天对象（单人角色或群聊）的名称、缩略头像与高清立绘地址。
 */
export function getCurrentEntityMeta(ctx) {
  if (!hasActiveChatSelection(ctx)) {
    return { active: false, kind: 'none', avatarKey: '', name: '', thumbUrl: '', portraitUrl: '' };
  }

  if (ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '') {
    const group = (ctx.groups || []).find(item => String(item.id) === String(ctx.groupId));
    const avatarUrl = group?.avatar_url || resolveAppAsset('img/five.png');
    return {
      active: true,
      kind: 'group',
      avatarKey: `group:${ctx.groupId}`,
      name: String(group?.name || '群聊'),
      thumbUrl: avatarUrl,
      portraitUrl: avatarUrl,
    };
  }

  const char = ctx.characters?.[ctx.characterId];
  const name = String(char?.name || ctx.name2 || '角色');
  const avatarFile = typeof char?.avatar === 'string' && char.avatar.trim() ? char.avatar.trim() : '';

  if (!avatarFile) {
    const fallback = resolveAppAsset('img/ai4.png');
    return { active: true, kind: 'char', avatarKey: `char:${name}`, name, thumbUrl: fallback, portraitUrl: '' };
  }

  const thumbUrl = typeof ctx.getThumbnailUrl === 'function'
    ? ctx.getThumbnailUrl('avatar', avatarFile)
    : resolveAppAsset(`characters/${encodeURIComponent(avatarFile)}`);
  const portraitUrl = resolveAppAsset(`characters/${encodeURIComponent(avatarFile)}`);

  return {
    active: true,
    kind: 'char',
    avatarKey: `char:${avatarFile}`,
    name,
    thumbUrl,
    portraitUrl,
  };
}

const PRESET_SELECT_BY_API = Object.freeze({
  openai: 'settings_preset_openai',
  textgenerationwebui: 'settings_preset_textgenerationwebui',
  novel: 'settings_preset_novel',
  kobold: 'settings_preset',
  koboldhorde: 'settings_preset',
});

/**
 * 将原始预设文件名裁剪为适合角色名右侧展示的轻盈短名（纯函数，便于单元测试）。
 */
export function formatShortPresetName(rawName, maxChars = 7) {
  const cleaned = String(rawName ?? '')
    .trim()
    .replace(/\.(?:json|settings|preset)$/i, '')
    .trim();

  if (!cleaned || /^gui(?:\s+koboldai\s+settings)?$/i.test(cleaned)) {
    return { fullName: '默认预设', shortName: '默认预设' };
  }

  const chars = Array.from(cleaned);
  const limit = Math.max(3, Number(maxChars) || 7);
  const shortName = chars.length > limit ? `${chars.slice(0, limit).join('')}…` : cleaned;
  return { fullName: cleaned, shortName };
}

/**
 * 读取酒馆当前主 API 正在生效的对话预设名称（支持 Chat Completion / Text Completion / NovelAI / Kobold）。
 */
export function getCurrentPresetMeta(ctx) {
  const doc = globalThis.document;
  const mainApiSelect = doc?.getElementById('main_api');
  const apiId = String(mainApiSelect?.value || ctx?.mainApi || 'openai').trim().toLowerCase();

  let rawLabel = '';
  const selectId = PRESET_SELECT_BY_API[apiId] || 'settings_preset_openai';
  const presetSelect = doc?.getElementById(selectId);

  if (presetSelect && presetSelect.selectedOptions?.length > 0) {
    const opt = presetSelect.selectedOptions[0];
    rawLabel = String(opt?.textContent || opt?.value || '').trim();
  } else if (presetSelect && typeof presetSelect.selectedIndex === 'number' && presetSelect.selectedIndex >= 0) {
    const opt = presetSelect.options?.[presetSelect.selectedIndex];
    rawLabel = String(opt?.textContent || opt?.value || '').trim();
  }

  if (!rawLabel && typeof ctx?.getPresetManager === 'function') {
    try {
      const pm = ctx.getPresetManager();
      rawLabel = String(pm?.getSelectedPresetName?.() || '').trim();
    } catch {
      rawLabel = '';
    }
  }

  return {
    apiId,
    ...formatShortPresetName(rawLabel, 7),
  };
}

/**
 * 读取酒馆原生「左/右滑动消息切换与重Roll手势」(power_user.gestures) 当前状态。
 * 酒馆原生默认为 true（手机端极易滑屏误触导致重Roll）。
 */
export function getSwipeGesturesEnabled(getContext) {
  const ctx = getContext?.();
  if (typeof ctx?.powerUserSettings?.gestures === 'boolean') {
    return ctx.powerUserSettings.gestures;
  }
  const checkbox = globalThis.document?.getElementById('gestures-checkbox');
  if (checkbox && typeof checkbox.checked === 'boolean') {
    return checkbox.checked;
  }
  return true;
}

/**
 * 双向同步设置酒馆原生「滑动手势切换/重Roll」(power_user.gestures + #gestures-checkbox)。
 */
export function setSwipeGesturesEnabled(enabled, getContext) {
  const target = Boolean(enabled);
  const ctx = getContext?.();
  if (ctx?.powerUserSettings && typeof ctx.powerUserSettings === 'object') {
    ctx.powerUserSettings.gestures = target;
  }

  const doc = globalThis.document;
  const checkbox = doc?.getElementById('gestures-checkbox');
  if (checkbox) {
    checkbox.checked = target;
    checkbox.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
  } else {
    ctx?.saveSettingsDebounced?.();
  }
  return target;
}
