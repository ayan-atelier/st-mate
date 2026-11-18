/**
 * ST伴侣 (st-mate) · 零依赖图库导入框选裁切弹窗 (.stm-crop-dialog)
 * 支持手指/鼠标自由拖拽构图、滑杆/滚轮缩放，一键导出高清 WebP 上传酒馆背景库，或跳过裁切直接传原图。
 */

export function openImageCropDialog({ file, aspectRatio = 0.62 }) {
  const doc = globalThis.document;
  if (!doc || !file || typeof globalThis.URL?.createObjectURL !== 'function') {
    return Promise.resolve(file || null);
  }

  return new Promise(resolve => {
    const objectUrl = globalThis.URL.createObjectURL(file);
    const img = new globalThis.Image();
    let settled = false;

    const finish = resultFile => {
      if (settled) return;
      settled = true;
      try {
        globalThis.URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
      dialog?.remove();
      resolve(resultFile);
    };

    const dialog = doc.createElement('dialog');
    dialog.className = 'stm-crop-dialog';

    img.onload = () => {
      const nw = Number(img.naturalWidth || img.width || 0);
      const nh = Number(img.naturalHeight || img.height || 0);
      if (!nw || !nh) {
        finish(file);
        return;
      }

      const safeAspect = Math.min(1.6, Math.max(0.42, Number(aspectRatio) || 0.62));
      let zoom = 1;
      let panX = 0; // -1 ~ 1 归一化偏移
      let panY = -0.35; // 默认偏上露出人物面部

      const stageWrap = doc.createElement('div');
      stageWrap.className = 'stm-crop-stage-wrap';

      const viewport = doc.createElement('div');
      viewport.className = 'stm-crop-viewport';
      viewport.style.setProperty('--stm-crop-aspect', String(safeAspect));

      const previewCanvas = doc.createElement('canvas');
      previewCanvas.className = 'stm-crop-canvas';
      const gridOverlay = doc.createElement('div');
      gridOverlay.className = 'stm-crop-grid';
      viewport.append(previewCanvas, gridOverlay);
      stageWrap.append(viewport);

      const hint = doc.createElement('p');
      hint.className = 'stm-crop-hint';
      hint.textContent = '按住画面拖动取景位置，滑动下方滑杆缩放';

      const zoomRow = doc.createElement('div');
      zoomRow.className = 'stm-crop-zoom-row';
      const zoomLabel = doc.createElement('span');
      zoomLabel.textContent = '缩放';
      const zoomInput = doc.createElement('input');
      zoomInput.type = 'range';
      zoomInput.className = 'stm-mufy-range';
      zoomInput.min = '100';
      zoomInput.max = '280';
      zoomInput.step = '1';
      zoomInput.value = '100';
      const zoomVal = doc.createElement('span');
      zoomVal.className = 'stm-mufy-val';
      zoomVal.textContent = '100%';
      zoomRow.append(zoomLabel, zoomInput, zoomVal);

      const footer = doc.createElement('div');
      footer.className = 'stm-crop-actions';

      const cancelBtn = doc.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'stm-pill-btn';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', () => finish(null));

      const rawBtn = doc.createElement('button');
      rawBtn.type = 'button';
      rawBtn.className = 'stm-pill-btn';
      rawBtn.textContent = '直接用原图';
      rawBtn.addEventListener('click', () => finish(file));

      const applyBtn = doc.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'stm-crop-confirm-btn';
      applyBtn.textContent = '裁切并使用';

      footer.append(cancelBtn, rawBtn, applyBtn);
      dialog.append(stageWrap, hint, zoomRow, footer);
      doc.body.append(dialog);
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }

      function computeSourceRect() {
        const imgAspect = nw / nh;
        let baseSw;
        let baseSh;
        if (imgAspect > safeAspect) {
          baseSh = nh;
          baseSw = nh * safeAspect;
        } else {
          baseSw = nw;
          baseSh = nw / safeAspect;
        }
        const sw = baseSw / zoom;
        const sh = baseSh / zoom;
        const maxDx = Math.max(0, (nw - sw) / 2);
        const maxDy = Math.max(0, (nh - sh) / 2);
        const cx = nw / 2 + panX * maxDx;
        const cy = nh / 2 + panY * maxDy;
        return {
          sx: Math.max(0, Math.min(nw - sw, cx - sw / 2)),
          sy: Math.max(0, Math.min(nh - sh, cy - sh / 2)),
          sw,
          sh,
          maxDx,
          maxDy,
        };
      }

      function drawPreview() {
        const rect = viewport.getBoundingClientRect();
        const dpr = Math.min(2, Number(globalThis.devicePixelRatio || 1));
        const cw = Math.max(180, Math.round((rect.width || 260) * dpr));
        const ch = Math.max(220, Math.round((rect.height || cw / safeAspect) * dpr));
        if (previewCanvas.width !== cw || previewCanvas.height !== ch) {
          previewCanvas.width = cw;
          previewCanvas.height = ch;
        }
        const ctx = previewCanvas.getContext('2d');
        if (!ctx) return;
        const { sx, sy, sw, sh } = computeSourceRect();
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
      }

      const syncZoomUi = () => {
        const pct = ((zoom * 100 - 100) / 180) * 100;
        zoomInput.value = String(Math.round(zoom * 100));
        zoomInput.style.setProperty('--stm-fill', `${pct.toFixed(1)}%`);
        zoomVal.textContent = `${Math.round(zoom * 100)}%`;
      };
      syncZoomUi();
      requestAnimationFrame(drawPreview);

      zoomInput.addEventListener('input', () => {
        zoom = Math.min(2.8, Math.max(1, Number(zoomInput.value) / 100));
        syncZoomUi();
        drawPreview();
      });

      let dragState = null;
      viewport.addEventListener('pointerdown', evt => {
        evt.preventDefault();
        viewport.setPointerCapture?.(evt.pointerId);
        dragState = {
          id: evt.pointerId,
          startX: evt.clientX,
          startY: evt.clientY,
          originPanX: panX,
          originPanY: panY,
        };
      });

      viewport.addEventListener('pointermove', evt => {
        if (!dragState || evt.pointerId !== dragState.id) return;
        const vRect = viewport.getBoundingClientRect();
        if (!vRect.width || !vRect.height) return;
        const { sw, sh, maxDx, maxDy } = computeSourceRect();
        const dxImg = -((evt.clientX - dragState.startX) / vRect.width) * sw;
        const dyImg = -((evt.clientY - dragState.startY) / vRect.height) * sh;
        panX = maxDx > 0.5 ? Math.max(-1, Math.min(1, dragState.originPanX + dxImg / maxDx)) : 0;
        panY = maxDy > 0.5 ? Math.max(-1, Math.min(1, dragState.originPanY + dyImg / maxDy)) : 0;
        drawPreview();
      });

      const endDrag = evt => {
        if (dragState && evt.pointerId === dragState.id) {
          dragState = null;
        }
      };
      viewport.addEventListener('pointerup', endDrag);
      viewport.addEventListener('pointercancel', endDrag);

      viewport.addEventListener(
        'wheel',
        evt => {
          evt.preventDefault();
          const delta = evt.deltaY < 0 ? 0.08 : -0.08;
          zoom = Math.min(2.8, Math.max(1, zoom + delta));
          syncZoomUi();
          drawPreview();
        },
        { passive: false },
      );

      dialog.addEventListener('cancel', evt => {
        evt.preventDefault();
        finish(null);
      });

      applyBtn.addEventListener('click', () => {
        const { sx, sy, sw, sh } = computeSourceRect();
        const maxOutH = 1440;
        const outH = Math.min(maxOutH, Math.max(360, Math.round(sh)));
        const outW = Math.max(240, Math.round(outH * safeAspect));

        const outCanvas = doc.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const ctx = outCanvas.getContext('2d', { alpha: false });
        if (!ctx) {
          finish(file);
          return;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        outCanvas.toBlob(
          blob => {
            if (!blob) {
              finish(file);
              return;
            }
            const baseStem = String(file.name || 'custom').replace(/\.[^.]+$/, '');
            const croppedFile = new globalThis.File([blob], `${baseStem}-crop.webp`, {
              type: 'image/webp',
            });
            finish(croppedFile);
          },
          'image/webp',
          0.9,
        );
      });
    };

    img.onerror = () => finish(file);
    img.src = objectUrl;
  });
}
