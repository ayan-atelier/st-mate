/**
 * ST伴侣 (st-mate) · 书架首页「万能自动识别分流导入」引擎 (smart-importer.js)
 * 核心职责：
 * 1. 无损接管增强角色书架「从文件导入」按钮（切回原生酒馆时 100% 恢复书架原行为）；
 * 2. 支持玩家一次多选混传，按文件头字节与 JSON 结构指纹全自动识别并分流导入 7 类酒馆资产：
 *    - 角色卡 (.png / .charx / .byaf / .yaml / .yml / V1·V2·V3 角色 JSON)
 *    - 对话预设 (Chat Completion 预设 JSON，自动执行外部反代与密钥脱敏)
 *    - 美化主题 (SillyTavern UI Theme JSON，自动落盘注册并即时切换生效)
 *    - 世界书 (SillyTavern / NovelAI / Risu / Agnai 世界书 JSON 及 naidata PNG)
 *    - 正则脚本 (单条或数组包 Regex JSON，智能按同名同规则去重更新)
 *    - 快速回复 (Quick Reply v2 集合 JSON)
 *    - 酒馆助手脚本 (TavernHelper 全局脚本 JSON)
 */

import { applySmartThemeVarsImmediate } from '../core/companion-kit.js?v=0.8.9c';
import { hasActiveChatSelection } from '../core/env.js?v=0.8.9c';
import {
  cleanWorldBookName,
  primeHostCoreModule,
  primeHostRegexModule,
  primeHostWorldInfoModule,
} from './char-world-backend.js?v=0.8.9c';
import { importPresetItems } from './preset-backend.js?v=0.8.9c';
import { toastMessage } from '../shell/host-actions.js?v=0.8.9c';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function generateUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getFileExtension(fileName) {
  const name = String(fileName || '').trim();
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function getFileStem(fileName, fallback = '未命名') {
  const name = String(fileName || '').trim();
  const stem = name.replace(/\.[^.]+$/, '').trim();
  return stem || fallback;
}

function resolveEndpointHref(apiPath, doc = globalThis.document) {
  const clean = String(apiPath || '').replace(/^\/+/, '');
  const candidates = [doc?.baseURI, globalThis.location?.href];
  for (const base of candidates) {
    if (typeof base === 'string' && /^(?:https?|tauri|capacitor|app):\/\//i.test(base)) {
      try {
        return new URL(clean, base).href;
      } catch {
        // continue
      }
    }
  }
  return `/${clean}`;
}

/**
 * 轻量扫描 PNG 文本块关键字（仅读取每个 chunk 头部，零解压大图像素），用于区分普通角色卡 PNG 与罕见 NovelAI naidata 世界书 PNG。
 */
export function extractPngTextKeywords(bytes) {
  const keywords = new Set();
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) return keywords;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return keywords;
  }

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) >>> 0) +
      ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;

    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const maxScan = Math.min(dataEnd, dataStart + 80);
      let nulPos = -1;
      for (let j = dataStart; j < maxScan; j += 1) {
        if (bytes[j] === 0) {
          nulPos = j;
          break;
        }
      }
      if (nulPos > dataStart) {
        let kw = '';
        for (let j = dataStart; j < nulPos; j += 1) {
          kw += String.fromCharCode(bytes[j]);
        }
        keywords.add(kw.toLowerCase());
      }
    }

    if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  return keywords;
}

function isRegexScriptItem(item) {
  return Boolean(
    item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof item.scriptName === 'string' &&
      item.scriptName.trim() !== '' &&
      ('findRegex' in item || 'replaceString' in item),
  );
}

function isCharacterCardObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const spec = String(obj.spec || '').toLowerCase();
  if (spec === 'chara_card_v2' || spec === 'chara_card_v3') return true;
  if (
    obj.data &&
    typeof obj.data === 'object' &&
    !Array.isArray(obj.data) &&
    typeof obj.data.name === 'string' &&
    ('first_mes' in obj.data ||
      'description' in obj.data ||
      'mes_example' in obj.data ||
      'character_book' in obj.data)
  ) {
    return true;
  }
  if (
    typeof obj.name === 'string' &&
    ('first_mes' in obj ||
      ('description' in obj && 'personality' in obj && 'scenario' in obj)) &&
    !Array.isArray(obj.prompts) &&
    !('blur_tint_color' in obj) &&
    !('main_text_color' in obj)
  ) {
    return true;
  }
  return false;
}

function isWorldInfoObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (obj.lorebookVersion !== undefined) return true;
  if (obj.type === 'risu') return true;
  if (obj.kind === 'memory' && Array.isArray(obj.entries)) return true;
  if (obj.entries && typeof obj.entries === 'object') {
    const vals = Array.isArray(obj.entries) ? obj.entries : Object.values(obj.entries);
    if (vals.length === 0) return true;
    const sample = vals.find(v => v && typeof v === 'object');
    if (
      sample &&
      ('key' in sample ||
        'keys' in sample ||
        'content' in sample ||
        'uid' in sample ||
        'comment' in sample ||
        'constant' in sample)
    ) {
      return true;
    }
  }
  return false;
}

function isThemeObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if ('main_text_color' in obj && 'blur_tint_color' in obj) return true;
  if ('chat_tint_color' in obj && 'user_mes_blur_tint_color' in obj) return true;
  if (
    typeof obj.custom_css === 'string' &&
    ('blur_strength' in obj ||
      'main_text_color' in obj ||
      'quote_text_color' in obj ||
      'fast_ui_mode' in obj)
  ) {
    return true;
  }
  return false;
}

function isPresetObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (Array.isArray(obj.prompts) || Array.isArray(obj.prompt_order)) return true;
  if ('temp_openai' in obj || 'openai_max_context' in obj || 'openai_max_tokens' in obj) {
    return true;
  }
  if (
    'temperature' in obj &&
    ('top_p' in obj ||
      'frequency_penalty' in obj ||
      'presence_penalty' in obj ||
      'repetition_penalty' in obj)
  ) {
    return true;
  }
  return false;
}

/**
 * 纯函数分类器：根据文件名、JSON 文本或 PNG 头部字节精确判定酒馆资产类别。
 */
export function classifySmartImportItem({ fileName = '', textContent = null, pngBytes = null } = {}) {
  const ext = getFileExtension(fileName);

  if (ext === 'charx' || ext === 'byaf' || ext === 'yaml' || ext === 'yml') {
    return { kind: 'character' };
  }

  if (ext === 'png') {
    if (pngBytes instanceof Uint8Array) {
      const kws = extractPngTextKeywords(pngBytes);
      if (kws.has('naidata') && !kws.has('chara') && !kws.has('ccv3')) {
        return { kind: 'worldinfo' };
      }
    }
    return { kind: 'character' };
  }

  if (ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif' || ext === 'bmp') {
    return {
      kind: 'invalid',
      error: '普通图片不含角色卡数据（角色卡需为带数据的 .png / .charx / .json）',
    };
  }

  if (typeof textContent === 'string') {
    const cleaned = textContent.replace(/^\uFEFF/, '').trim();
    if (!cleaned) {
      return { kind: 'invalid', error: '文件内容为空' };
    }
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { kind: 'invalid', error: 'JSON 语法损坏，无法解析' };
    }

    // 1. 酒馆助手脚本 (TavernHelper Script)
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      parsed.type === 'script' &&
      typeof parsed.content === 'string' &&
      typeof parsed.name === 'string'
    ) {
      return { kind: 'helper_script', parsed };
    }

    // 2. 快速回复集合 (Quick Reply v2)
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Array.isArray(parsed.qrList) &&
      typeof parsed.name === 'string'
    ) {
      return { kind: 'quickreply', parsed };
    }

    // 3. 正则脚本（单条、数组包或 { regexScripts: [...] }）
    if (isRegexScriptItem(parsed)) {
      return { kind: 'regex', scripts: [parsed] };
    }
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isRegexScriptItem)) {
      return { kind: 'regex', scripts: parsed };
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.regexScripts) &&
      parsed.regexScripts.length > 0 &&
      parsed.regexScripts.every(isRegexScriptItem)
    ) {
      return { kind: 'regex', scripts: parsed.regexScripts };
    }

    // 4. 角色卡 JSON (V1 / V2 / V3)
    if (isCharacterCardObject(parsed)) {
      return { kind: 'character', parsed };
    }

    // 5. 世界书 JSON (ST / NovelAI / Risu / Agnai)
    if (isWorldInfoObject(parsed)) {
      return { kind: 'worldinfo', parsed };
    }

    // 6. 美化主题 JSON (SillyTavern UI Theme)
    if (isThemeObject(parsed)) {
      return { kind: 'theme', parsed };
    }

    // 7. 对话预设 JSON (Chat Completion Preset)
    if (isPresetObject(parsed)) {
      return { kind: 'preset', parsed };
    }

    return { kind: 'unknown', error: '未识别的 JSON 配置类型' };
  }

  return { kind: 'invalid', error: `暂不支持 .${ext || '未知'} 格式直接导入` };
}

function normalizeRegexScriptEntry(raw) {
  const name = String(raw?.scriptName || '').trim().slice(0, 160);
  if (!name) return null;
  return {
    ...raw,
    id: generateUuid(),
    scriptName: name,
    findRegex: typeof raw.findRegex === 'string' ? raw.findRegex : '',
    replaceString: typeof raw.replaceString === 'string' ? raw.replaceString : '',
    trimStrings: Array.isArray(raw.trimStrings) ? raw.trimStrings.map(String) : [],
    placement: Array.isArray(raw.placement) ? raw.placement : [2],
    disabled: Boolean(raw.disabled),
    markdownOnly: Boolean(raw.markdownOnly),
    promptOnly: Boolean(raw.promptOnly),
    runOnEdit: raw.runOnEdit !== undefined ? Boolean(raw.runOnEdit) : true,
    substituteRegex: Number.isFinite(Number(raw.substituteRegex)) ? Number(raw.substituteRegex) : 0,
    minDepth: raw.minDepth ?? null,
    maxDepth: raw.maxDepth ?? null,
  };
}

/**
 * 将解析出的正则脚本数组导入酒馆全局正则列表（同名且同匹配式时原地无损更新，杜绝重复堆积）。
 */
export async function importRegexScriptsToHost(
  rawScripts = [],
  { getContext, regexModule = null, doc = globalThis.document } = {},
) {
  const ctx = getContext?.();
  if (!ctx?.extensionSettings || typeof ctx.extensionSettings !== 'object') {
    throw new Error('酒馆扩展设置尚未就绪');
  }
  if (!Array.isArray(ctx.extensionSettings.regex)) {
    ctx.extensionSettings.regex = [];
  }

  const targetList = ctx.extensionSettings.regex;
  let added = 0;
  let updated = 0;
  const names = [];

  for (const item of Array.isArray(rawScripts) ? rawScripts : []) {
    const normalized = normalizeRegexScriptEntry(item);
    if (!normalized) continue;
    const existingIdx = targetList.findIndex(
      s =>
        s &&
        String(s.scriptName || '').trim() === normalized.scriptName &&
        String(s.findRegex || '') === normalized.findRegex,
    );
    if (existingIdx >= 0) {
      const keepId = targetList[existingIdx].id || normalized.id;
      targetList[existingIdx] = { ...normalized, id: keepId };
      updated += 1;
    } else {
      targetList.push(normalized);
      added += 1;
    }
    names.push(normalized.scriptName);
  }

  const rxMod = regexModule || (await primeHostRegexModule({ doc }));
  try {
    rxMod?.RegexProvider?.instance?.clear?.();
  } catch {
    // ignore
  }

  ctx.saveSettingsDebounced?.();
  if (hasActiveChatSelection(ctx) && typeof ctx.reloadCurrentChat === 'function') {
    try {
      await ctx.reloadCurrentChat();
    } catch {
      // ignore
    }
  }

  return { added, updated, total: added + updated, names };
}

/**
 * 将外部美化主题 JSON 落盘至 `/api/themes/save`、同步 `#themes` 下拉，并在 `activate: true` 时立即套用生效。
 */
export async function importThemeObjectToHost(
  rawTheme,
  fallbackName = '导入主题',
  {
    getContext,
    fetchImpl = globalThis.fetch,
    doc = globalThis.document,
    powerUserModule = null,
    activate = true,
  } = {},
) {
  if (!rawTheme || typeof rawTheme !== 'object') {
    throw new Error('无效的主题数据');
  }
  const cleanName = String(rawTheme.name || fallbackName)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 120);
  if (!cleanName) {
    throw new Error('主题缺少有效名称');
  }

  const payload = { ...rawTheme, name: cleanName };
  const ctx = getContext?.();

  if (typeof fetchImpl === 'function') {
    const headers = {
      'Content-Type': 'application/json',
      ...(typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {}),
    };
    const res = await fetchImpl(resolveEndpointHref('api/themes/save', doc), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res?.ok) {
      throw new Error(`保存美化主题失败 (HTTP ${res?.status || 0})`);
    }
  }

  const themeSelect = doc?.getElementById?.('themes');
  if (themeSelect) {
    const opts = themeSelect.options ? [...themeSelect.options] : [...(themeSelect.children || [])];
    let opt = opts.find(o => o.value === cleanName);
    if (!opt && typeof doc?.createElement === 'function') {
      opt = doc.createElement('option');
      opt.value = cleanName;
      opt.textContent = cleanName;
      themeSelect.appendChild?.(opt) || themeSelect.append?.(opt);
    }
    if (activate) {
      if (opt) opt.selected = true;
      themeSelect.value = cleanName;
    }
  }

  if (activate) {
    if (ctx?.powerUserSettings && typeof ctx.powerUserSettings === 'object') {
      const { name, ...restFields } = payload;
      Object.assign(ctx.powerUserSettings, restFields, { theme: name });
    }
    try {
      const base = doc?.baseURI || globalThis.location?.href || '';
      const puMod =
        powerUserModule ||
        (base && /^https?:\/\//i.test(base)
          ? await import(new URL('scripts/power-user.js', base).href)
          : null);
      if (puMod?.power_user && typeof puMod.power_user === 'object') {
        const { name, ...restFields } = payload;
        Object.assign(puMod.power_user, restFields, { theme: name });
      }
      if (typeof puMod?.applyPowerUserSettings === 'function') {
        puMod.applyPowerUserSettings();
      }
    } catch {
      // ignore offline/unit-test import
    }
    applySmartThemeVarsImmediate(doc, payload);
    if (typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent?.(new globalThis.CustomEvent('resize'));
    }
  }

  ctx?.saveSettingsDebounced?.();
  return { ok: true, name: cleanName, activated: Boolean(activate) };
}

async function importWorldBookFileToHost(
  file,
  { getContext, fetchImpl = globalThis.fetch, doc = globalThis.document, worldInfoModule = null } = {},
) {
  const wiMod = worldInfoModule || (await primeHostWorldInfoModule({ doc }));
  if (typeof wiMod?.importWorldInfo === 'function') {
    const res = await wiMod.importWorldInfo(file);
    if (res === false) {
      return { ok: false, skipped: true, name: cleanWorldBookName(file?.name) };
    }
    return { ok: true, name: cleanWorldBookName(file?.name) || '世界书' };
  }

  const ctx = getContext?.();
  const FormDataCtor = globalThis.FormData;
  if (typeof fetchImpl !== 'function' || typeof FormDataCtor !== 'function') {
    throw new Error('当前环境不支持世界书表单上传');
  }

  const form = new FormDataCtor();
  form.append('avatar', file);
  const headers =
    typeof ctx?.getRequestHeaders === 'function'
      ? ctx.getRequestHeaders({ omitContentType: true })
      : {};
  const res = await fetchImpl(resolveEndpointHref('api/worldinfo/import', doc), {
    method: 'POST',
    headers,
    body: form,
    cache: 'no-cache',
  });
  if (!res?.ok) {
    throw new Error(`导入世界书失败 (HTTP ${res?.status || 0})`);
  }
  const data = (await res.json?.().catch(() => null)) || {};
  const finalName = cleanWorldBookName(data.name || getFileStem(file?.name, '世界书'));

  if (finalName && Array.isArray(wiMod?.world_names) && !wiMod.world_names.includes(finalName)) {
    wiMod.world_names.push(finalName);
    wiMod.world_names.sort((a, b) => a.localeCompare(b));
  }
  const syncSelect = selectId => {
    const sel = doc?.getElementById?.(selectId);
    if (!sel || !finalName) return;
    const opts = sel.options ? [...sel.options] : [...(sel.children || [])];
    if (opts.some(o => (o.textContent || o.text || '').trim() === finalName)) return;
    const opt = doc.createElement('option');
    const idx = Array.isArray(wiMod?.world_names)
      ? wiMod.world_names.indexOf(finalName)
      : opts.length;
    opt.value = String(idx >= 0 ? idx : opts.length);
    opt.textContent = finalName;
    sel.appendChild?.(opt) || sel.append?.(opt);
  };
  syncSelect('world_info');
  syncSelect('world_editor_select');

  return { ok: true, name: finalName };
}

function normalizeCharacterFileMime(file) {
  if (!file || typeof file !== 'object') return file;
  if (file.type && String(file.type).trim()) return file;
  const ext = getFileExtension(file.name);
  const inferred =
    ext === 'png'
      ? 'image/png'
      : ext === 'json'
        ? 'application/json'
        : ext === 'yaml' || ext === 'yml'
          ? 'application/yaml'
          : '';
  if (!inferred || typeof globalThis.File !== 'function') return file;
  try {
    return new globalThis.File([file], file.name, { type: inferred });
  } catch {
    return file;
  }
}

async function importCharacterFilesToHost(
  files,
  { getContext, fetchImpl = globalThis.fetch, doc = globalThis.document, coreModule = null } = {},
) {
  const normalized = files.map(normalizeCharacterFileMime);
  const hostCore = coreModule || (await primeHostCoreModule({ doc }));

  if (typeof hostCore?.processDroppedFiles === 'function') {
    await hostCore.processDroppedFiles(normalized);
    return { count: normalized.length };
  }

  const ctx = getContext?.();
  const FormDataCtor = globalThis.FormData;
  if (typeof fetchImpl !== 'function' || typeof FormDataCtor !== 'function') {
    throw new Error('当前环境缺少角色卡导入接口');
  }

  let imported = 0;
  for (const file of normalized) {
    const ext = getFileExtension(file?.name) || 'png';
    const form = new FormDataCtor();
    form.append('avatar', file);
    form.append('file_type', ext);
    if (ctx?.name1) form.append('user_name', String(ctx.name1));
    const headers =
      typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders({ omitContentType: true })
        : {};
    const res = await fetchImpl(resolveEndpointHref('api/characters/import', doc), {
      method: 'POST',
      headers,
      body: form,
      cache: 'no-cache',
    });
    if (!res?.ok) {
      throw new Error(`角色卡「${file?.name || ''}」导入失败 (HTTP ${res?.status || 0})`);
    }
    imported += 1;
  }

  if (imported > 0 && typeof hostCore?.getCharacters === 'function') {
    await hostCore.getCharacters();
  }
  return { count: imported };
}

function importTavernHelperScriptToHost(parsed, { tavernHelperApi = globalThis.TavernHelper } = {}) {
  if (!tavernHelperApi?.updateScriptTreesWith) {
    throw new Error('检测到酒馆助手脚本，请先在「设置 -> 原生与设置」一键安装并启用酒馆助手');
  }
  const scriptId =
    typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : generateUuid();
  const normalizedScript = {
    ...parsed,
    type: 'script',
    id: scriptId,
    name: String(parsed.name || '导入助手脚本').trim(),
    enabled: parsed.enabled !== undefined ? Boolean(parsed.enabled) : true,
  };

  tavernHelperApi.updateScriptTreesWith(
    trees => {
      const list = Array.isArray(trees) ? [...trees] : [];
      let replaced = false;
      const next = list.map(node => {
        if (node?.type === 'folder' && Array.isArray(node.scripts)) {
          return {
            ...node,
            scripts: node.scripts.map(sc => {
              if (sc?.id === scriptId || sc?.name === normalizedScript.name) {
                replaced = true;
                return { ...sc, ...normalizedScript, id: sc.id || scriptId };
              }
              return sc;
            }),
          };
        }
        if (node?.id === scriptId || node?.name === normalizedScript.name) {
          replaced = true;
          return { ...node, ...normalizedScript, id: node.id || scriptId };
        }
        return node;
      });
      if (!replaced) {
        next.push(normalizedScript);
      }
      return next;
    },
    { type: 'global' },
  );

  return { name: normalizedScript.name };
}

function importQuickReplyFileToHost(file, { doc = globalThis.document } = {}) {
  const qrInput = doc?.getElementById?.('qr--set-importFile');
  if (!qrInput || typeof globalThis.DataTransfer !== 'function') {
    throw new Error('未找到快速回复扩展导入入口，请确认已在扩展中开启「快速回复 (Quick Reply)」');
  }
  const dt = new globalThis.DataTransfer();
  dt.items.add(file);
  qrInput.files = dt.files;
  const EventCtor = globalThis.Event || class MockEvent { constructor(t) { this.type = t; } };
  qrInput.dispatchEvent(new EventCtor('change', { bubbles: true }));
  return { ok: true };
}

async function readFileTextSafe(file) {
  if (typeof file?.text === 'function') {
    return file.text();
  }
  if (typeof file?.content === 'string') {
    return file.content;
  }
  return new Promise((resolve, reject) => {
    if (typeof globalThis.FileReader !== 'function') {
      reject(new Error('无法读取文本文件'));
      return;
    }
    const reader = new globalThis.FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file, 'utf-8');
  });
}

async function readFileHeaderBytesSafe(file, maxBytes = 4096) {
  try {
    const slice = typeof file?.slice === 'function' ? file.slice(0, maxBytes) : file;
    if (typeof slice?.arrayBuffer === 'function') {
      return new Uint8Array(await slice.arrayBuffer());
    }
  } catch {
    // ignore
  }
  return null;
}

export function formatSmartImportSummary(counts, details = {}) {
  const parts = [];
  if (counts.character > 0) parts.push(`${counts.character} 张角色卡`);
  if (counts.preset > 0) {
    parts.push(
      counts.preset === 1 && details.lastPresetName
        ? `预设「${details.lastPresetName}」`
        : `${counts.preset} 套预设`,
    );
  }
  if (counts.theme > 0) {
    parts.push(
      counts.theme === 1 && details.lastThemeName
        ? `美化主题「${details.lastThemeName}」（已启用）`
        : `${counts.theme} 套美化主题`,
    );
  }
  if (counts.worldinfo > 0) {
    parts.push(
      counts.worldinfo === 1 && details.lastWorldName
        ? `世界书「${details.lastWorldName}」`
        : `${counts.worldinfo} 本世界书`,
    );
  }
  if (counts.regex > 0) parts.push(`${counts.regex} 条正则脚本`);
  if (counts.quickreply > 0) parts.push(`${counts.quickreply} 组快速回复`);
  if (counts.helper_script > 0) parts.push(`${counts.helper_script} 个酒馆助手脚本`);

  if (parts.length === 0) return '';
  return `已自动识别导入：${parts.join(' · ')}`;
}

/**
 * 批量分流导入任意组合文件列表（角色卡 / 预设 / 美化主题 / 世界书 / 正则 / 快速回复 / 助手脚本）。
 */
export async function importSmartFiles(
  rawFiles,
  {
    getContext,
    doc = globalThis.document,
    fetchImpl = globalThis.fetch,
    coreModule = null,
    worldInfoModule = null,
    openAiModule = null,
    regexModule = null,
    powerUserModule = null,
    tavernHelperApi = globalThis.TavernHelper,
    onAfterImport = null,
  } = {},
) {
  const files = Array.from(rawFiles || []).filter(Boolean);
  const counts = {
    character: 0,
    preset: 0,
    theme: 0,
    worldinfo: 0,
    regex: 0,
    quickreply: 0,
    helper_script: 0,
  };
  const details = {
    lastPresetName: '',
    lastThemeName: '',
    lastWorldName: '',
  };
  const errors = [];

  if (files.length === 0) {
    return { counts, details, errors, summaryText: '' };
  }

  const charBucket = [];
  const presetBucket = [];
  const themeBucket = [];
  const worldBucket = [];
  const regexBucket = [];
  const qrBucket = [];
  const helperBucket = [];

  for (const file of files) {
    const fileName = String(file.name || '未命名');
    const ext = getFileExtension(fileName);
    try {
      if (ext === 'png') {
        const headerBytes = await readFileHeaderBytesSafe(file, 4096);
        const cls = classifySmartImportItem({ fileName, pngBytes: headerBytes });
        if (cls.kind === 'worldinfo') worldBucket.push(file);
        else charBucket.push(file);
      } else if (ext === 'charx' || ext === 'byaf' || ext === 'yaml' || ext === 'yml') {
        charBucket.push(file);
      } else if (ext === 'json' || String(file.type || '').includes('json')) {
        const textContent = await readFileTextSafe(file);
        const cls = classifySmartImportItem({ fileName, textContent });
        if (cls.kind === 'character') {
          charBucket.push(file);
        } else if (cls.kind === 'preset') {
          presetBucket.push({ name: fileName, content: textContent });
        } else if (cls.kind === 'theme') {
          themeBucket.push({ fileName, parsed: cls.parsed });
        } else if (cls.kind === 'worldinfo') {
          worldBucket.push(file);
        } else if (cls.kind === 'regex') {
          regexBucket.push(...cls.scripts);
        } else if (cls.kind === 'quickreply') {
          qrBucket.push(file);
        } else if (cls.kind === 'helper_script') {
          helperBucket.push({ fileName, parsed: cls.parsed });
        } else {
          errors.push(`${fileName}（${cls.error || '未识别的格式'}）`);
        }
      } else {
        const cls = classifySmartImportItem({ fileName });
        errors.push(`${fileName}（${cls.error || '不支持的文件类型'}）`);
      }
    } catch (err) {
      errors.push(`${fileName}（${err?.message || '读取失败'}）`);
    }
  }

  // 1. 先导入配套世界书、正则、预设、主题、快速回复、助手脚本，最后导入角色卡（确保角色卡关联的全局资源已先落位）
  for (const wFile of worldBucket) {
    try {
      const res = await importWorldBookFileToHost(wFile, {
        getContext,
        fetchImpl,
        doc,
        worldInfoModule,
      });
      if (res.ok) {
        counts.worldinfo += 1;
        details.lastWorldName = res.name || '';
      }
    } catch (err) {
      errors.push(`${wFile.name}（${err?.message || '世界书导入失败'}）`);
    }
  }

  if (regexBucket.length > 0) {
    try {
      const res = await importRegexScriptsToHost(regexBucket, {
        getContext,
        regexModule,
        doc,
      });
      counts.regex += res.total;
    } catch (err) {
      errors.push(`正则脚本（${err?.message || '导入失败'}）`);
    }
  }

  if (presetBucket.length > 0) {
    try {
      const res = await importPresetItems(presetBucket, {
        getContext,
        openAiModule,
        fetchImpl,
        doc,
        selectFirstImported: true,
      });
      counts.preset += res.imported.length;
      if (res.imported.length > 0) {
        details.lastPresetName = res.imported[0];
      }
      for (const fail of res.failed) {
        errors.push(`${fail.fileName}（${fail.error}）`);
      }
    } catch (err) {
      errors.push(`对话预设（${err?.message || '导入失败'}）`);
    }
  }

  for (let i = 0; i < themeBucket.length; i += 1) {
    const item = themeBucket[i];
    const isLastTheme = i === themeBucket.length - 1;
    try {
      const res = await importThemeObjectToHost(
        item.parsed,
        getFileStem(item.fileName, '导入主题'),
        {
          getContext,
          fetchImpl,
          doc,
          powerUserModule,
          activate: isLastTheme,
        },
      );
      if (res.ok) {
        counts.theme += 1;
        details.lastThemeName = res.name;
      }
    } catch (err) {
      errors.push(`${item.fileName}（${err?.message || '主题导入失败'}）`);
    }
  }

  for (const qrFile of qrBucket) {
    try {
      importQuickReplyFileToHost(qrFile, { doc });
      counts.quickreply += 1;
    } catch (err) {
      errors.push(`${qrFile.name}（${err?.message || '快速回复导入失败'}）`);
    }
  }

  for (const hItem of helperBucket) {
    try {
      importTavernHelperScriptToHost(hItem.parsed, { tavernHelperApi });
      counts.helper_script += 1;
    } catch (err) {
      errors.push(`${hItem.fileName}（${err?.message || '助手脚本导入失败'}）`);
    }
  }

  if (charBucket.length > 0) {
    try {
      const res = await importCharacterFilesToHost(charBucket, {
        getContext,
        fetchImpl,
        doc,
        coreModule,
      });
      counts.character += res.count;
      if (typeof globalThis.CustomEvent === 'function') {
        globalThis.dispatchEvent?.(
          new globalThis.CustomEvent('yantai:bookshelf:gallery-updated', {
            detail: { bumpAvatars: true },
          }),
        );
      }
    } catch (err) {
      errors.push(`角色卡（${err?.message || '导入失败'}）`);
    }
  }

  onAfterImport?.({ counts, details, errors });
  const summaryText = formatSmartImportSummary(counts, details);
  return { counts, details, errors, summaryText };
}

/**
 * 书架「万能导入」按钮接管控制器：开启伴侣时自动将 `.jd-add-character` 升级为多格式自动分流导入，关闭伴侣时零残留复原。
 */
export function createSmartImporterController({
  getContext,
  store,
  doc = globalThis.document,
  onAfterImport = null,
} = {}) {
  let fileInputEl = null;
  let busy = false;
  let attached = false;

  function ensureInput() {
    if (!doc) return null;
    if (fileInputEl?.isConnected) return fileInputEl;
    fileInputEl = doc.getElementById?.('stm-universal-import-input') || doc.createElement('input');
    fileInputEl.id = 'stm-universal-import-input';
    fileInputEl.type = 'file';
    fileInputEl.multiple = true;
    fileInputEl.accept =
      '.png,.json,.charx,.byaf,.yaml,.yml,image/png,application/json,application/yaml,text/yaml';
    fileInputEl.hidden = true;

    fileInputEl.addEventListener('change', async () => {
      const selected = fileInputEl?.files ? Array.from(fileInputEl.files) : [];
      if (fileInputEl) fileInputEl.value = '';
      if (selected.length === 0 || busy) return;

      busy = true;
      try {
        const result = await importSmartFiles(selected, {
          getContext,
          doc,
          onAfterImport,
        });
        if (result.counts.preset > 0) {
          store?.hydrate?.();
        }

        const nonCharImported =
          result.counts.preset +
          result.counts.theme +
          result.counts.worldinfo +
          result.counts.regex +
          result.counts.quickreply +
          result.counts.helper_script;

        // 单纯导 1 张角色卡时酒馆原生已弹创建提示；混合导入、非角色卡导入或多卡导入时弹出清晰中文总览
        if (result.summaryText && (nonCharImported > 0 || result.counts.character > 1)) {
          toastMessage(result.summaryText, 'success');
        }
        if (result.errors.length > 0) {
          toastMessage(`部分文件未导入：${result.errors.join('；')}`, 'warning');
        }
      } catch (err) {
        toastMessage(err?.message || '万能分流导入执行异常', 'error');
      } finally {
        busy = false;
      }
    });

    doc.body?.append?.(fileInputEl);
    return fileInputEl;
  }

  function openPicker() {
    if (busy) {
      toastMessage('正在处理上一批导入文件，请稍候…', 'info');
      return;
    }
    const input = ensureInput();
    if (!input) return;
    input.value = '';
    input.click();
  }

  function onDocClickCapture(event) {
    if (!store?.get?.()?.shellEnabled) return;
    const rawTarget = event?.target;
    const elTarget =
      rawTarget && typeof rawTarget.closest === 'function' ? rawTarget : rawTarget?.parentElement;
    const importBtn = elTarget?.closest?.('.jd-add-character');
    if (!importBtn) return;

    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    openPicker();
  }

  function attach() {
    if (attached || !doc?.addEventListener) return;
    doc.addEventListener('click', onDocClickCapture, true);
    attached = true;
  }

  function destroy() {
    if (attached && doc?.removeEventListener) {
      doc.removeEventListener('click', onDocClickCapture, true);
      attached = false;
    }
    fileInputEl?.remove?.();
    fileInputEl = null;
    busy = false;
  }

  attach();
  return {
    openPicker,
    isBusy: () => busy,
    destroy,
  };
}
