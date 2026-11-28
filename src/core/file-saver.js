/**
 * ST伴侣 (st-mate) · 跨端文件导出与 TauriTavern (TT) WebView 安全保底器
 * 环境分流铁律：
 * 1. 普通桌面浏览器与普通手机 Chrome / Safari (`!isTauri`)：
 *    100% 保持原生 `<a href="blob:..." download="filename">` 直接下载，零多余弹窗、零历史打扰；
 * 2. TauriTavern 容器 (`isTauri === true`)：
 *    - 优先通过 `navigator.canShare({ files })` + `navigator.share` 调起手机原生系统文件存储/分享面板（用户关闭面板静默取消）；
 *    - 若当前 TT WebView 不支持文件级 Web Share，则尝试 `data:` URI `<a download>` 触发，并弹出极简 `.stm-dialog` 保底导出框
 *      （PNG 角色卡展示完整原图供长按存相册，JSON 提供只读预览与一键复制全文），确保任何 TT 版本 100% 导得出。
 */

import { detectPlatform } from './env.js?v=0.9.17';
import { createIconNode } from './icons.js?v=0.9.17';
import { toastMessage } from '../shell/host-actions.js?v=0.9.17';

const FALLBACK_DIALOG_ID = 'stm-export-fallback-dialog';

function notifyOverlayChange(root = globalThis) {
  try {
    if (typeof root?.CustomEvent === 'function') {
      root.dispatchEvent?.(new root.CustomEvent('stm:overlay-change'));
    }
  } catch {
    // ignore in minimal test runtimes
  }
}

function resolveExportMimeType(blob, fileName = '') {
  if (blob?.type && typeof blob.type === 'string' && blob.type.trim()) {
    return blob.type.trim();
  }
  if (/\.png$/i.test(fileName)) return 'image/png';
  if (/\.json$/i.test(fileName)) return 'application/json;charset=utf-8';
  return 'application/octet-stream';
}

function triggerAnchorDownload(href, fileName, doc) {
  if (!doc || typeof doc.createElement !== 'function' || !href) return false;
  const link = doc.createElement('a');
  link.href = href;
  link.download = fileName;
  link.rel = 'noopener';
  doc.body?.appendChild?.(link);
  link.click?.();
  link.remove?.();
  return true;
}

function encodeBytesToBase64(bytes, root = globalThis) {
  if (typeof globalThis.Buffer === 'function') {
    return globalThis.Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  const btoaFn = root?.btoa || globalThis.btoa;
  return typeof btoaFn === 'function' ? btoaFn(binary) : '';
}

async function blobToDataUrl(blob, mimeType, root = globalThis) {
  if (!blob) return '';
  if (typeof root?.FileReader === 'function') {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new root.FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error || new Error('FileReader error'));
        reader.readAsDataURL(blob);
      });
      if (dataUrl) return dataUrl;
    } catch {
      // fall through to arrayBuffer encoding
    }
  }
  if (typeof blob.arrayBuffer === 'function') {
    const buf = await blob.arrayBuffer();
    const base64 = encodeBytesToBase64(new Uint8Array(buf), root);
    const cleanMime = String(mimeType || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
    return base64 ? `data:${cleanMime};base64,${base64}` : '';
  }
  return '';
}

async function readBlobText(blob, fallbackText = '') {
  if (typeof fallbackText === 'string' && fallbackText.length > 0) {
    return fallbackText;
  }
  if (blob && typeof blob.text === 'function') {
    try {
      return await blob.text();
    } catch {
      return '';
    }
  }
  return '';
}

async function copyPlainText(text, textareaEl, doc, root = globalThis) {
  const nav = root?.navigator;
  if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to execCommand fallback
    }
  }
  if (textareaEl) {
    try {
      textareaEl.focus?.();
      textareaEl.select?.();
      textareaEl.setSelectionRange?.(0, text.length);
      if (typeof doc?.execCommand === 'function' && doc.execCommand('copy')) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

export function isExportFallbackDialogOpen(doc = globalThis.document) {
  const dlg = doc?.getElementById?.(FALLBACK_DIALOG_ID);
  if (!dlg) return false;
  return Boolean(dlg.open || dlg.hasAttribute?.('open') || dlg.isConnected);
}

export function closeExportFallbackDialog(doc = globalThis.document, root = globalThis) {
  const dlg = doc?.getElementById?.(FALLBACK_DIALOG_ID);
  if (!dlg) return false;
  try {
    if (dlg.open && typeof dlg.close === 'function') {
      dlg.close();
    }
  } catch {
    // ignore
  }
  dlg.remove?.();
  notifyOverlayChange(root);
  return true;
}

function openTauriFallbackExportDialog({
  doc,
  root = globalThis,
  fileName,
  isPng,
  dataUrl,
  jsonText,
}) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  closeExportFallbackDialog(doc, root);

  const el = (tag, cls = '', text = '') => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };

  const dlg = el('dialog', 'stm-dialog stm-export-fallback-dialog');
  dlg.id = FALLBACK_DIALOG_ID;

  const header = el('header', 'stm-dialog-header');
  const titleWrap = el('div', 'stm-dialog-title-wrap');
  titleWrap.append(
    el('h2', 'stm-dialog-title', isPng ? '保存 PNG 角色卡' : '导出 JSON 文件'),
    el('span', 'stm-dialog-badge', 'TT 保底导出'),
  );

  const headerRight = el('div', 'stm-dialog-header-actions');
  const closeBtn = el('button', 'stm-dialog-close', '×');
  closeBtn.type = 'button';
  closeBtn.title = '关闭';
  closeBtn.setAttribute('aria-label', '关闭导出窗口');
  closeBtn.addEventListener('click', () => closeExportFallbackDialog(doc, root));
  headerRight.append(closeBtn);
  header.append(titleWrap, headerRight);

  const body = el('div', 'stm-dialog-body stm-export-fallback-body');
  const fileMeta = el('div', 'stm-export-fallback-meta', fileName);
  body.append(fileMeta);

  if (isPng) {
    const previewWrap = el('div', 'stm-export-png-wrap');
    const img = el('img', 'stm-export-png-preview');
    img.src = dataUrl;
    img.alt = fileName;
    previewWrap.append(img);
    body.append(
      previewWrap,
      el('p', 'stm-export-fallback-hint', '长按上方卡面即可保存原图到相册（原图完整内嵌角色卡全部设定数据，可直接导入酒馆）'),
    );
  } else {
    const previewArea = el('textarea', 'stm-input stm-export-json-preview');
    previewArea.readOnly = true;
    previewArea.rows = 7;
    previewArea.value = jsonText || '';

    const actions = el('div', 'stm-export-fallback-actions');
    const copyBtn = el('button', 'stm-primary-action stm-export-copy-btn');
    copyBtn.type = 'button';
    const labelSpan = el('span', '', '一键复制 JSON 全文');
    copyBtn.append(createIconNode(doc, 'copy', 'stm-row-icon'), labelSpan);
    copyBtn.addEventListener('click', async () => {
      const copied = await copyPlainText(jsonText || '', previewArea, doc, root);
      if (copied) {
        labelSpan.textContent = '已复制 JSON 全文';
        toastMessage(`已复制「${fileName}」全文到剪贴板`, 'success');
      } else {
        previewArea.focus?.();
        previewArea.select?.();
        toastMessage('已全选 JSON 内容，请长按输入框复制', 'info');
      }
    });
    actions.append(copyBtn);

    body.append(
      el('p', 'stm-export-fallback-hint', '若当前容器未自动弹出文件保存，可一键复制下方完整 JSON 文本保存备份：'),
      previewArea,
      actions,
    );
  }

  dlg.append(header, body);
  dlg.addEventListener('click', evt => {
    if (evt.target === dlg) {
      closeExportFallbackDialog(doc, root);
    }
  });

  doc.body?.appendChild?.(dlg);
  try {
    if (typeof dlg.showModal === 'function') {
      dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
  } catch {
    dlg.setAttribute('open', '');
  }
  notifyOverlayChange(root);
  return dlg;
}

/**
 * 统一安全文件导出入口：
 * - 普通浏览器 (`!isTauri`)：100% 走 `<a href="blob:..." download>` 原生直下；
 * - TauriTavern (`isTauri`)：优先走系统原生 `navigator.share({ files })`，不支持时降级为 `data:` URI + 极简保底导出框。
 */
export async function saveExportBlob(
  blob,
  fileName,
  {
    doc = globalThis.document,
    root = globalThis,
    textContent = '',
  } = {},
) {
  const safeName = String(fileName || 'export.dat').trim() || 'export.dat';
  const mimeType = resolveExportMimeType(blob, safeName);
  const env = detectPlatform(root);

  // 1. 普通电脑浏览器与普通手机浏览器：100% 原生 blob 下载，零弹窗打扰
  if (!env.isTauri) {
    const urlApi = root?.URL || globalThis.URL;
    if (!doc || typeof urlApi?.createObjectURL !== 'function') {
      return { ok: false, cancelled: false, mode: 'unsupported', fileName: safeName };
    }
    const objectUrl = urlApi.createObjectURL(blob);
    triggerAnchorDownload(objectUrl, safeName, doc);
    setTimeout(() => {
      try {
        urlApi.revokeObjectURL?.(objectUrl);
      } catch {
        // ignore
      }
    }, 1500);
    return { ok: true, cancelled: false, mode: 'anchor-blob', fileName: safeName };
  }

  // 2. TauriTavern 容器：优先尝试系统级文件分享/存储面板
  const nav = root?.navigator;
  const FileCtor = root?.File || globalThis.File;
  if (typeof nav?.share === 'function' && typeof nav?.canShare === 'function' && typeof FileCtor === 'function') {
    let shareFile = null;
    try {
      shareFile = new FileCtor([blob], safeName, { type: mimeType });
    } catch {
      shareFile = null;
    }

    let canShareFiles = false;
    if (shareFile) {
      try {
        canShareFiles = Boolean(nav.canShare({ files: [shareFile] }));
      } catch {
        canShareFiles = false;
      }
    }

    if (shareFile && canShareFiles) {
      try {
        await nav.share({ files: [shareFile], title: safeName });
        return { ok: true, cancelled: false, mode: 'web-share', fileName: safeName };
      } catch (err) {
        if (err?.name === 'AbortError' || /abort|cancel/i.test(String(err?.message || ''))) {
          return { ok: true, cancelled: true, mode: 'web-share-cancelled', fileName: safeName };
        }
        // 其他非取消类 WebView 权限异常自动顺滑降级到下方保底框
      }
    }
  }

  // 3. TauriTavern 保底通道：尝试 data: URI 下载 + 弹出极简保底导出框
  const isPng = /image\/png/i.test(mimeType) || /\.png$/i.test(safeName);
  const dataUrl = await blobToDataUrl(blob, mimeType, root);
  if (dataUrl) {
    triggerAnchorDownload(dataUrl, safeName, doc);
  }
  const jsonText = isPng ? '' : await readBlobText(blob, textContent);
  openTauriFallbackExportDialog({
    doc,
    root,
    fileName: safeName,
    isPng,
    dataUrl,
    jsonText,
  });

  return { ok: true, cancelled: false, mode: 'tauri-fallback', fileName: safeName };
}
