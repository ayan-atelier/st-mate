/**
 * ST伴侣 (st-mate) · 角色底图离屏预压缩 + IndexedDB 极速缓存 + 柔焦静态烘焙器
 * 解决痛点：
 * 1. 酒馆角色卡原图（/characters/xxx.png）普遍 3MB~15MB，手机 WebView 每次进页面下载+解码高达十余秒；
 * 2. 全屏大图直接挂实时 CSS filter:blur() 会导致手机滑屏时每帧重算高斯卷积，发烫掉帧。
 * 方案：
 * - 首次读取后在空闲帧压缩为 <= 640px 的轻量 WebP（约 25~45KB，体积缩小 99%），存入 IndexedDB + 内存 LRU；
 * - 停止拖动清晰度滑杆后，若宿主 Canvas 支持原生硬件 filter，进一步预烘焙为静态柔焦纹理，使阅读滚动期间 CSS filter 归零。
 */

const IDB_NAME = 'st_mate_backdrop_cache_v1';
const IDB_STORE = 'covers';
const IDB_MAX_ENTRIES = 60;
const BASE_MAX_EDGE = 640;
const BLUR_BAKE_MAX_EDGE = 380;

export function clarityToBlurPx(clarity) {
  const c = Number.isFinite(Number(clarity)) ? Math.min(100, Math.max(0, Number(clarity))) : 55;
  if (c >= 100) return 0;
  return Math.round((100 - c) * 0.36 * 10) / 10;
}

export function createLruMap(maxEntries = 16, onEvict = null) {
  const limit = Math.max(2, Number(maxEntries) || 16);
  const map = new Map();

  function get(key) {
    if (!map.has(key)) return undefined;
    const val = map.get(key);
    map.delete(key);
    map.set(key, val);
    return val;
  }

  function set(key, val) {
    if (map.has(key)) {
      const prev = map.get(key);
      map.delete(key);
      if (prev !== val) onEvict?.(key, prev);
    } else if (map.size >= limit) {
      const oldestKey = map.keys().next().value;
      const oldestVal = map.get(oldestKey);
      map.delete(oldestKey);
      onEvict?.(oldestKey, oldestVal);
    }
    map.set(key, val);
    return val;
  }

  function remove(key) {
    if (!map.has(key)) return false;
    const prev = map.get(key);
    map.delete(key);
    onEvict?.(key, prev);
    return true;
  }

  function clear() {
    for (const [k, v] of map.entries()) {
      onEvict?.(k, v);
    }
    map.clear();
  }

  return {
    get,
    set,
    has: key => map.has(key),
    delete: remove,
    clear,
    size: () => map.size,
  };
}

function isAnimatedUrl(url) {
  return /\.(?:gif|apng|webp\?.*anim)(?:$|[?#])/i.test(String(url || ''));
}

export function createBackdropCache({ root = globalThis } = {}) {
  let dbPromise = null;
  let canvasFilterSupported = null;
  const inflightBase = new Map();

  const revokeUrl = url => {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      try {
        root?.URL?.revokeObjectURL?.(url);
      } catch {
        // ignore
      }
    }
  };

  const baseLru = createLruMap(18, (_key, entry) => {
    revokeUrl(entry?.objectUrl);
  });

  const bakedBlurLru = createLruMap(14, (_key, objectUrl) => {
    revokeUrl(objectUrl);
  });

  function canUseCanvas() {
    return Boolean(
      root?.document?.createElement &&
      typeof root?.Image === 'function' &&
      typeof root?.URL?.createObjectURL === 'function',
    );
  }

  function supportsCanvasFilter() {
    if (canvasFilterSupported !== null) return canvasFilterSupported;
    if (!canUseCanvas()) {
      canvasFilterSupported = false;
      return false;
    }
    try {
      const c = root.document.createElement('canvas');
      c.width = 2;
      c.height = 2;
      const ctx = c.getContext('2d');
      if (!ctx || !('filter' in ctx)) {
        canvasFilterSupported = false;
        return false;
      }
      ctx.filter = 'blur(2px)';
      canvasFilterSupported = ctx.filter === 'blur(2px)';
    } catch {
      canvasFilterSupported = false;
    }
    return canvasFilterSupported;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    const idb = root?.indexedDB;
    if (!idb || typeof idb.open !== 'function') {
      return Promise.resolve(null);
    }

    dbPromise = new Promise(resolve => {
      try {
        const req = idb.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            const store = db.createObjectStore(IDB_STORE, { keyPath: 'key' });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function readFromIdb(key) {
    const db = await openDb();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function writeToIdb(record) {
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(record);

      const countReq = store.count();
      countReq.onsuccess = () => {
        const extra = Number(countReq.result || 0) - IDB_MAX_ENTRIES;
        if (extra <= 0) return;
        const idx = store.index('updatedAt');
        let removed = 0;
        idx.openCursor().onsuccess = evt => {
          const cursor = evt.target?.result;
          if (cursor && removed < extra) {
            cursor.delete();
            removed += 1;
            cursor.continue();
          }
        };
      };
    } catch {
      // ignore quota or private-mode errors
    }
  }

  async function deleteFromIdb(key) {
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
    } catch {
      // ignore
    }
  }

  function loadImageElement(src, { sameOriginOnly = false } = {}) {
    return new Promise((resolve, reject) => {
      const img = new root.Image();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        img.onload = img.onerror = null;
        reject(new Error('Image load timeout'));
      }, 15000);

      if (!sameOriginOnly) {
        try {
          const pageOrigin = root.location?.origin;
          const parsed = new URL(src, pageOrigin || 'http://localhost/');
          if (pageOrigin && parsed.origin !== pageOrigin && !src.startsWith('blob:') && !src.startsWith('data:')) {
            img.crossOrigin = 'anonymous';
          }
        } catch {
          // ignore
        }
      }

      img.decoding = 'async';
      img.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Image decode failed'));
      };
      img.src = src;
    });
  }

  function canvasToBlob(canvas, type = 'image/webp', quality = 0.84) {
    return new Promise(resolve => {
      if (typeof canvas.toBlob !== 'function') {
        resolve(null);
        return;
      }
      try {
        canvas.toBlob(
          blob => {
            if (blob) {
              resolve(blob);
            } else if (type !== 'image/jpeg') {
              canvas.toBlob(fallbackBlob => resolve(fallbackBlob || null), 'image/jpeg', 0.85);
            } else {
              resolve(null);
            }
          },
          type,
          quality,
        );
      } catch {
        resolve(null);
      }
    });
  }

  function peekCompressedBase(rawUrl) {
    if (!rawUrl) return null;
    return baseLru.get(rawUrl) || null;
  }

  async function warmDecodeUrl(url) {
    if (!url || typeof root?.Image !== 'function') return;
    try {
      const pre = new root.Image();
      pre.decoding = 'async';
      pre.src = url;
      if (typeof pre.decode === 'function') {
        await pre.decode();
      }
    } catch {
      // ignore decode warning
    }
  }

  async function resolveCompressedBase(rawUrl) {
    if (!rawUrl || !canUseCanvas() || isAnimatedUrl(rawUrl)) {
      return null;
    }

    const memHit = baseLru.get(rawUrl);
    if (memHit?.objectUrl) return memHit;

    if (inflightBase.has(rawUrl)) {
      return inflightBase.get(rawUrl);
    }

    const job = (async () => {
      const idbHit = await readFromIdb(rawUrl);
      if (idbHit?.blob) {
        const objectUrl = root.URL.createObjectURL(idbHit.blob);
        await warmDecodeUrl(objectUrl);
        return baseLru.set(rawUrl, {
          objectUrl,
          blob: idbHit.blob,
          width: idbHit.width || BASE_MAX_EDGE,
          height: idbHit.height || BASE_MAX_EDGE,
        });
      }

      try {
        const img = await loadImageElement(rawUrl);
        const nw = Number(img.naturalWidth || img.width || 0);
        const nh = Number(img.naturalHeight || img.height || 0);
        if (!nw || !nh) return null;

        const scale = Math.min(1, BASE_MAX_EDGE / Math.max(nw, nh));
        const tw = Math.max(1, Math.round(nw * scale));
        const th = Math.max(1, Math.round(nh * scale));

        const canvas = root.document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return null;

        ctx.drawImage(img, 0, 0, tw, th);
        const blob = await canvasToBlob(canvas, 'image/webp', 0.85);
        if (!blob) return null;

        void writeToIdb({
          key: rawUrl,
          blob,
          width: tw,
          height: th,
          updatedAt: Date.now(),
        });

        const objectUrl = root.URL.createObjectURL(blob);
        await warmDecodeUrl(objectUrl);
        return baseLru.set(rawUrl, { objectUrl, blob, width: tw, height: th });
      } catch {
        return null;
      }
    })().finally(() => {
      inflightBase.delete(rawUrl);
    });

    inflightBase.set(rawUrl, job);
    return job;
  }

  async function bakeBlurredUrl(rawUrl, clarity) {
    const blurPx = clarityToBlurPx(clarity);
    if (blurPx < 0.8 || !supportsCanvasFilter()) return null;

    const cacheKey = `${rawUrl}|b:${blurPx.toFixed(1)}`;
    const hit = bakedBlurLru.get(cacheKey);
    if (hit) return hit;

    const baseEntry = await resolveCompressedBase(rawUrl);
    if (!baseEntry?.objectUrl) return null;

    try {
      const img = await loadImageElement(baseEntry.objectUrl, { sameOriginOnly: true });
      const nw = Number(img.naturalWidth || baseEntry.width || 0);
      const nh = Number(img.naturalHeight || baseEntry.height || 0);
      if (!nw || !nh) return null;

      const scale = Math.min(1, BLUR_BAKE_MAX_EDGE / Math.max(nw, nh));
      const tw = Math.max(1, Math.round(nw * scale));
      const th = Math.max(1, Math.round(nh * scale));
      // 按画布与典型视口比例换算等效高斯半径，确保静态烘焙前后视觉柔化度一致
      const scaledRadius = Math.max(0.6, Math.round(blurPx * (Math.max(tw, th) / 780) * 10) / 10);
      const pad = Math.ceil(scaledRadius * 2.2);

      const canvas = root.document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return null;

      ctx.filter = `blur(${scaledRadius}px)`;
      // 外扩绘制消除边缘黑框渗色
      ctx.drawImage(img, -pad, -pad, tw + pad * 2, th + pad * 2);

      const blob = await canvasToBlob(canvas, 'image/webp', 0.82);
      if (!blob) return null;

      const bakedUrl = root.URL.createObjectURL(blob);
      return bakedBlurLru.set(cacheKey, bakedUrl);
    } catch {
      return null;
    }
  }

  function invalidate(rawUrl) {
    if (!rawUrl) return;
    baseLru.delete(rawUrl);
    void deleteFromIdb(rawUrl);
  }

  function destroy() {
    inflightBase.clear();
    bakedBlurLru.clear();
    baseLru.clear();
  }

  return {
    peekCompressedBase,
    resolveCompressedBase,
    bakeBlurredUrl,
    invalidate,
    destroy,
  };
}
