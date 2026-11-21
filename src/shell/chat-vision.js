/**
 * ST伴侣 (st-mate) · 底栏聊天窗「一键发图 / 表情包识图」控制器
 * 核心能力：
 * 1. 在 #nonQRFormItems 内锚定于 #send_textarea 右下角的克制半透明 1.5px 细线「图片」图标（零挤占左右栏宽度，多行输入时前几排满宽显示文字、始终贴合最后一行最右；纯文字 RP 玩家可一键关闭隐藏）；
 * 2. 选图或粘贴截图时，自动检测并帮玩家开启宿主隐藏的 `media_inlining`（发送内联媒体），让 Claude / Gemini / GPT / Grok 当场看懂图片与表情包；
 * 3. 手机原图智能无感瘦身（超 380KB 或长边超阈值时离屏压缩，动图 GIF 原样保留，画布用完即刻归零释放 iOS 显存），彻底告别反代站 413 报错；
 * 4. 在输入框上方附件条实时展示小缩略图预览，支持纯发表情包免打字直接发送。
 */

import { detectPlatform, hasActiveChatSelection } from '../core/env.js?v=0.8.7';
import { svgMarkup } from '../core/icons.js?v=0.8.7';

export const IMAGE_COMPRESS_THRESHOLD_BYTES = 380 * 1024;
export const DESKTOP_IMAGE_MAX_EDGE = 1440;
export const IOS_IMAGE_MAX_EDGE = 1280;
export const ANIMATED_GIF_SAFE_LIMIT_BYTES = 4 * 1024 * 1024;

export function formatByteSize(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function shouldCompressImageFile(file, { maxBytes = IMAGE_COMPRESS_THRESHOLD_BYTES } = {}) {
  if (!file || typeof file !== 'object') return false;
  const mime = String(file.type || '').toLowerCase();
  if (!mime.startsWith('image/')) return false;
  // 保留 GIF 动图表情包与矢量 SVG 不走静态画布重编码
  if (mime === 'image/gif' || mime === 'image/svg+xml') return false;
  return Number(file.size || 0) > maxBytes;
}

function loadBitmapOrImage(file, root = globalThis) {
  if (typeof root?.createImageBitmap === 'function') {
    return root.createImageBitmap(file).then(bmp => ({
      source: bmp,
      width: bmp.width,
      height: bmp.height,
      cleanup: () => bmp.close?.(),
    }));
  }
  return new Promise((resolve, reject) => {
    const ImgCtor = root?.Image;
    const UrlApi = root?.URL;
    if (typeof ImgCtor !== 'function' || typeof UrlApi?.createObjectURL !== 'function') {
      reject(new Error('Image decoder unavailable'));
      return;
    }
    const objUrl = UrlApi.createObjectURL(file);
    const img = new ImgCtor();
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        cleanup: () => UrlApi.revokeObjectURL?.(objUrl),
      });
    };
    img.onerror = err => {
      UrlApi.revokeObjectURL?.(objUrl);
      reject(err);
    };
    img.src = objUrl;
  });
}

function canvasToBlobAsync(canvas, mimeType, quality) {
  return new Promise(resolve => {
    if (typeof canvas?.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob(blob => resolve(blob || null), mimeType, quality);
  });
}

function replaceFileExtension(name, ext) {
  const base = String(name || 'image').replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${ext}`;
}

/**
 * 对超大照片/截图执行前端无感瘦身，小体积透明表情包与 GIF 动图原样放行。
 */
export async function compressChatImageIfNeeded(
  file,
  { root = globalThis, maxEdge = null, maxBytes = IMAGE_COMPRESS_THRESHOLD_BYTES, quality = 0.84 } = {},
) {
  if (!file || typeof file !== 'object') return file;
  const mime = String(file.type || '').toLowerCase();
  if (!mime.startsWith('image/') || mime === 'image/gif' || mime === 'image/svg+xml') {
    return file;
  }

  const doc = root?.document;
  const FileCtor = root?.File || globalThis.File;
  if (!doc?.createElement || typeof FileCtor !== 'function') {
    return file;
  }

  const platform = detectPlatform(root);
  const limitEdge = maxEdge || (platform.isIOS ? IOS_IMAGE_MAX_EDGE : DESKTOP_IMAGE_MAX_EDGE);

  let decoded = null;
  try {
    decoded = await loadBitmapOrImage(file, root);
    const { source, width, height } = decoded;
    if (!width || !height) return file;

    const longest = Math.max(width, height);
    if (longest <= limitEdge && Number(file.size || 0) <= maxBytes) {
      return file;
    }

    const scale = longest > limitEdge ? limitEdge / longest : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = doc.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx2d = canvas.getContext?.('2d');
    if (!ctx2d) {
      canvas.width = 0;
      canvas.height = 0;
      return file;
    }

    // PNG 透明贴纸优先尝试 WebP 保留透明通道；普通相机照片走高兼容 JPEG
    const preferWebp = mime === 'image/png' || mime === 'image/webp';
    const outMime = preferWebp ? 'image/webp' : 'image/jpeg';

    if (outMime === 'image/jpeg') {
      ctx2d.fillStyle = '#ffffff';
      ctx2d.fillRect(0, 0, targetW, targetH);
    }
    ctx2d.drawImage(source, 0, 0, targetW, targetH);

    let blob = await canvasToBlobAsync(canvas, outMime, quality);
    if ((!blob || blob.type !== outMime) && outMime === 'image/webp') {
      ctx2d.fillStyle = '#ffffff';
      ctx2d.globalCompositeOperation = 'destination-over';
      ctx2d.fillRect(0, 0, targetW, targetH);
      ctx2d.globalCompositeOperation = 'source-over';
      blob = await canvasToBlobAsync(canvas, 'image/jpeg', quality);
    }

    // 立即归零画布释放移动端 WebKit 纹理内存
    canvas.width = 0;
    canvas.height = 0;

    if (!blob || (blob.size >= file.size && longest <= limitEdge)) {
      return file;
    }

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new FileCtor([blob], replaceFileExtension(file.name, ext), {
      type: blob.type || 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    decoded?.cleanup?.();
  }
}

/**
 * 自动检查并开启酒馆底层的 `media_inlining`（Send inline media），确保模型能真正收到图片数据。
 */
export function ensureHostMediaInliningEnabled({ root = globalThis, getContext } = {}) {
  const ctx = getContext?.();
  const doc = root?.document;
  const oaiSettings = ctx?.chatCompletionSettings;
  const checkbox = doc?.getElementById?.('openai_media_inlining') || null;

  let changed = false;

  if (oaiSettings && typeof oaiSettings === 'object' && oaiSettings.media_inlining !== true) {
    oaiSettings.media_inlining = true;
    changed = true;
  }

  if (checkbox && !checkbox.checked) {
    checkbox.checked = true;
    changed = true;
    const EvtCtor = root?.Event || globalThis.Event;
    if (typeof EvtCtor === 'function' && typeof checkbox.dispatchEvent === 'function') {
      checkbox.dispatchEvent(new EvtCtor('input', { bubbles: true }));
      checkbox.dispatchEvent(new EvtCtor('change', { bubbles: true }));
    } else if (typeof checkbox.dispatchEvent === 'function') {
      checkbox.dispatchEvent({ type: 'input' });
      checkbox.dispatchEvent({ type: 'change' });
    }
  }

  if (changed) {
    ctx?.saveSettingsDebounced?.();
  }

  return { changed };
}

function isSameFileEntry(a, b) {
  return (
    Boolean(a && b) &&
    a.name === b.name &&
    Number(a.size) === Number(b.size) &&
    Number(a.lastModified || 0) === Number(b.lastModified || 0)
  );
}

/**
 * 将处理后的图片写入酒馆原生 #file_form_input 并点亮 #file_form 预览栏。
 */
export function attachFilesToHostInput(files, { root = globalThis } = {}) {
  const doc = root?.document;
  const incoming = Array.from(files || []).filter(Boolean);
  if (!doc || incoming.length === 0) return [];

  const fileInput = doc.getElementById?.('file_form_input');
  const fileForm = doc.getElementById?.('file_form');
  if (!fileInput) return [];

  const existing = fileInput.files ? Array.from(fileInput.files) : [];
  const merged = [...existing];
  for (const item of incoming) {
    if (!merged.some(prev => isSameFileEntry(prev, item))) {
      merged.push(item);
    }
  }

  const DataTransferCtor = root?.DataTransfer || globalThis.DataTransfer;
  if (typeof DataTransferCtor === 'function') {
    const dt = new DataTransferCtor();
    for (const f of merged) {
      dt.items.add(f);
    }
    fileInput.files = dt.files;
  } else {
    fileInput.files = merged;
  }

  if (fileForm) {
    fileForm.classList?.remove?.('displayNone');
    const nameEl = fileForm.querySelector?.('.file_name');
    const sizeEl = fileForm.querySelector?.('.file_size');
    const totalBytes = merged.reduce((sum, f) => sum + Number(f.size || 0), 0);
    const summaryName = merged.length === 1 ? merged[0].name : `已附加 ${merged.length} 张图片`;
    const fullTitle = merged.map(f => f.name).join('\n');
    if (nameEl) {
      nameEl.textContent = summaryName;
      nameEl.title = fullTitle;
    }
    if (sizeEl) {
      const sizeText = formatByteSize(totalBytes);
      sizeEl.textContent = sizeText;
      sizeEl.title = String(totalBytes);
    }
  }

  return merged;
}

export function createChatVision({
  root = globalThis,
  getContext,
  store,
  notify = null,
} = {}) {
  let btnEl = null;
  let pickerEl = null;
  let thumbWrapEl = null;
  let boundFileForm = null;
  let boundTextarea = null;
  let rightFormObserver = null;
  let observedRightForm = null;
  let resizeBound = false;
  let inliningNoticeShown = false;
  let busy = false;
  const activePreviewUrls = new Set();

  function revokePreviewUrls() {
    const UrlApi = root?.URL || globalThis.URL;
    for (const url of activePreviewUrls) {
      try {
        UrlApi?.revokeObjectURL?.(url);
      } catch {
        // ignore
      }
    }
    activePreviewUrls.clear();
  }

  function clearThumbnailStrip() {
    revokePreviewUrls();
    thumbWrapEl?.remove?.();
    thumbWrapEl = null;
    btnEl?.classList?.remove?.('has-attachment');
  }

  function renderThumbnailStrip(files) {
    const doc = root?.document;
    const UrlApi = root?.URL || globalThis.URL;
    clearThumbnailStrip();
    if (!doc || typeof UrlApi?.createObjectURL !== 'function') return;

    const imageFiles = Array.from(files || []).filter(f =>
      String(f?.type || '').toLowerCase().startsWith('image/'),
    );
    if (imageFiles.length === 0) return;

    const attachedRow = doc.querySelector?.('#file_form .file_attached');
    if (!attachedRow) return;

    thumbWrapEl = doc.createElement('span');
    thumbWrapEl.className = 'stm-attached-thumbs';

    for (const imgFile of imageFiles.slice(0, 4)) {
      try {
        const previewUrl = UrlApi.createObjectURL(imgFile);
        activePreviewUrls.add(previewUrl);
        const img = doc.createElement('img');
        img.className = 'stm-attached-thumb';
        img.src = previewUrl;
        img.alt = imgFile.name || '';
        img.decoding = 'async';
        thumbWrapEl.appendChild(img);
      } catch {
        // ignore preview failure in restricted env
      }
    }

    if (thumbWrapEl.children?.length > 0) {
      attachedRow.prepend?.(thumbWrapEl);
    } else {
      thumbWrapEl = null;
    }
  }

  async function processAndAttachImages(rawFiles) {
    const imageList = Array.from(rawFiles || []).filter(f =>
      String(f?.type || '').toLowerCase().startsWith('image/'),
    );
    if (imageList.length === 0 || busy) return [];

    busy = true;
    btnEl?.classList?.add?.('is-busy');
    try {
      const processed = [];
      for (const file of imageList) {
        if (
          String(file.type || '').toLowerCase() === 'image/gif' &&
          Number(file.size || 0) > ANIMATED_GIF_SAFE_LIMIT_BYTES
        ) {
          notify?.('动图体积较大，若反代站报错可改发静态表情包或截图', 'info');
        }
        const nextFile = await compressChatImageIfNeeded(file, { root });
        processed.push(nextFile);
      }

      const inliningRes = ensureHostMediaInliningEnabled({ root, getContext });
      if (inliningRes.changed && !inliningNoticeShown) {
        inliningNoticeShown = true;
        notify?.('已自动开启模型识图（发送内联媒体），可直接点发送键把图片或表情包发给角色', 'info');
      }

      const merged = attachFilesToHostInput(processed, { root });
      renderThumbnailStrip(merged);
      btnEl?.classList?.toggle?.('has-attachment', merged.length > 0);
      return merged;
    } finally {
      busy = false;
      btnEl?.classList?.remove?.('is-busy');
    }
  }

  function onFileFormReset() {
    clearThumbnailStrip();
  }

  function onTextareaPaste(event) {
    const s = store.get();
    if (!s.shellEnabled || !s.chatImageButton) return;
    const clipFiles = event?.clipboardData?.files;
    if (!clipFiles || clipFiles.length === 0) return;

    const allFiles = Array.from(clipFiles);
    const allAreImages = allFiles.every(f => String(f?.type || '').toLowerCase().startsWith('image/'));
    if (!allAreImages) return;

    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    void processAndAttachImages(allFiles);
  }

  function syncButtonOffset(doc = root?.document) {
    if (!btnEl || btnEl.hidden || !doc) return;
    const nonQR = doc.getElementById?.('nonQRFormItems');
    const textarea = doc.getElementById?.('send_textarea');
    if (
      !nonQR ||
      !textarea ||
      btnEl.parentNode !== nonQR ||
      typeof nonQR.getBoundingClientRect !== 'function' ||
      typeof textarea.getBoundingClientRect !== 'function'
    ) {
      return;
    }

    const wrapRect = nonQR.getBoundingClientRect();
    const taRect = textarea.getBoundingClientRect();
    if (!wrapRect || !taRect || wrapRect.width <= 0 || taRect.width <= 0) return;

    // 精准悬浮于 #send_textarea 右下角内侧（紧贴右下斜纹左侧，输入框多行撑高时前几排满宽、图标始终停在最后一行最右）
    const rightInset = Math.max(8, Math.round(wrapRect.right - taRect.right + 10));
    const bottomInset = Math.max(4, Math.round(wrapRect.bottom - taRect.bottom + 6));
    btnEl.style.setProperty('--stm-img-btn-right', `${rightInset}px`);
    btnEl.style.setProperty('--stm-img-btn-bottom', `${bottomInset}px`);
  }

  function onViewportResize() {
    syncButtonOffset();
  }

  function bindHostFormListeners(doc) {
    const fileForm = doc?.getElementById?.('file_form') || null;
    if (fileForm !== boundFileForm) {
      boundFileForm?.removeEventListener?.('reset', onFileFormReset);
      if (fileForm) {
        fileForm.addEventListener?.('reset', onFileFormReset);
      }
      boundFileForm = fileForm;
    }

    const textarea = doc?.getElementById?.('send_textarea') || null;
    if (textarea !== boundTextarea) {
      boundTextarea?.removeEventListener?.('paste', onTextareaPaste, true);
      if (textarea) {
        textarea.addEventListener?.('paste', onTextareaPaste, true);
      }
      boundTextarea = textarea;
    }

    const rightSend = doc?.getElementById?.('rightSendForm') || null;
    if (rightSend !== observedRightForm) {
      rightFormObserver?.disconnect?.();
      rightFormObserver = null;
      if (rightSend && typeof root?.ResizeObserver === 'function') {
        rightFormObserver = new root.ResizeObserver(() => syncButtonOffset(doc));
        rightFormObserver.observe(rightSend);
      }
      observedRightForm = rightSend;
    }

    if (!resizeBound && typeof root?.addEventListener === 'function') {
      root.addEventListener('resize', onViewportResize, { passive: true });
      resizeBound = true;
    }
  }

  function ensureButtonMounted(doc) {
    const hostWrap =
      doc?.getElementById?.('nonQRFormItems') ||
      doc?.getElementById?.('send_form') ||
      doc?.getElementById?.('leftSendForm');
    if (!hostWrap) return;

    if (!btnEl || !btnEl.isConnected) {
      btnEl = doc.getElementById?.('stm-send-image-btn') || doc.createElement('button');
      btnEl.id = 'stm-send-image-btn';
      btnEl.type = 'button';
      btnEl.className = 'stm-send-image-btn interactable';
      btnEl.title = '附加图片 / 表情包（自动开启模型识图）';
      btnEl.setAttribute('aria-label', '附加图片或表情包');
      btnEl.innerHTML = svgMarkup('image');
      btnEl.addEventListener('click', evt => {
        evt.preventDefault();
        evt.stopPropagation();
        if (busy) return;
        pickerEl?.click?.();
      });
    }

    if (!pickerEl || !pickerEl.isConnected) {
      pickerEl = doc.getElementById?.('stm-chat-image-picker') || doc.createElement('input');
      pickerEl.id = 'stm-chat-image-picker';
      pickerEl.type = 'file';
      pickerEl.accept = 'image/*';
      pickerEl.multiple = true;
      pickerEl.hidden = true;
      pickerEl.addEventListener('change', () => {
        const picked = pickerEl.files ? Array.from(pickerEl.files) : [];
        pickerEl.value = '';
        if (picked.length > 0) {
          void processAndAttachImages(picked);
        }
      });
    }

    if (btnEl.parentNode !== hostWrap) {
      hostWrap.appendChild(btnEl);
    }
    if (pickerEl.parentNode !== hostWrap) {
      hostWrap.appendChild(pickerEl);
    }
  }

  function refresh() {
    const doc = root?.document;
    if (!doc) return;

    bindHostFormListeners(doc);

    const s = store.get();
    const shouldShow = Boolean(
      s.shellEnabled && s.chatImageButton && hasActiveChatSelection(getContext?.()),
    );

    if (!shouldShow) {
      if (btnEl) {
        btnEl.hidden = true;
      }
      if (!s.shellEnabled || !s.chatImageButton) {
        btnEl?.remove?.();
        pickerEl?.remove?.();
        btnEl = null;
        pickerEl = null;
        clearThumbnailStrip();
      }
      return;
    }

    ensureButtonMounted(doc);
    if (btnEl) {
      btnEl.hidden = false;
      syncButtonOffset(doc);
    }
  }

  function handleChatChanged() {
    clearThumbnailStrip();
    refresh();
  }

  function destroy() {
    clearThumbnailStrip();
    rightFormObserver?.disconnect?.();
    rightFormObserver = null;
    observedRightForm = null;
    if (resizeBound && typeof root?.removeEventListener === 'function') {
      root.removeEventListener('resize', onViewportResize);
      resizeBound = false;
    }
    boundFileForm?.removeEventListener?.('reset', onFileFormReset);
    boundTextarea?.removeEventListener?.('paste', onTextareaPaste, true);
    boundFileForm = null;
    boundTextarea = null;
    btnEl?.remove?.();
    pickerEl?.remove?.();
    const doc = root?.document;
    doc?.getElementById?.('stm-send-image-btn')?.remove?.();
    doc?.getElementById?.('stm-chat-image-picker')?.remove?.();
    btnEl = null;
    pickerEl = null;
  }

  return {
    refresh,
    handleChatChanged,
    processAndAttachImages,
    destroy,
  };
}
