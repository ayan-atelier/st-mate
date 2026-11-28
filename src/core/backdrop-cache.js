/**
 * ST伴侣 (st-mate) · 底图 2K 视网膜级离屏缓存器 (IndexedDB v2 + 内存 LRU)
 * 兼顾「零等待秒开」与「2K OLED 手机屏 100% 纤毫毕现锐度」：
 * - 将酒馆 5MB~15MB 的无损 PNG 角色卡原图（含庞大内嵌世界书 JSON 块）提取为最高 2160px 物理像素、0.93 高画质 WebP；
 * - 体积缩小约 95%（仅 ~200KB），IndexedDB 毫秒级秒读，同时在 3x 视网膜手机屏与桌面 2K 屏上保持原画级发丝与眼神光锐度；
 * - 对玩家已上传至 /backgrounds/ 的自定义裁切底图直接原画直通，绝不二次压缩。
 */

import { detectPlatform } from './env.js?v=0.9.21';

const IDB_NAME = 'st_mate_backdrop_cache_v2';
const IDB_STORE = 'covers';
const IDB_MAX_ENTRIES = 45;
const BASE_MAX_EDGE = 2160;
const IOS_SAFE_MAX_EDGE = 1440;

export function clarityToBlurPx(clarity) {
  const c = Number.isFinite(Number(clarity)) ? Math.min(100, Math.max(0, Number(clarity))) : 100;
  if (c >= 100) return 0;
  // 非线性柔和曲线：高清晰度区间 (85%~99%) 仅做极轻微柔化，往左拉再平滑进入奶油散景
  const ratio = (100 - c) / 100;
  return Math.round(Math.pow(ratio, 1.3) * 34 * 10) / 10;
}

export function createLruMap(maxEntries = 14, onEvict = null) {
  const limit = Math.max(2, Number(maxEntries) || 14);
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

function isAnimatedOrPrecompressedBg(url) {
  const s = String(url || '');
  if (/\.(?:gif|apng|webp\?.*anim)(?:$|[?#])/i.test(s)) return true;
  // 用户通过图库裁切上传到 /backgrounds/ 的底图已经是高清优化文件，原画直出不再二次重编码
  if (/\/backgrounds\/[^/?#]+/i.test(s)) return true;
  return false;
}

export function createBackdropCache({ root = globalThis } = {}) {
  let dbPromise = null;
  const inflightBase = new Map();
  const platform = detectPlatform(root);
  // iOS WKWebView (尤其 TauriTavern 多插件环境) 存在严格 Jetsam 显存红线：缩减内存位图池与最大边长防闪退
  const lruLimit = platform.isIOS ? 3 : platform.isMobile ? 6 : 14;
  const targetMaxEdge = platform.isIOS ? IOS_SAFE_MAX_EDGE : BASE_MAX_EDGE;

  const revokeUrl = url => {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      try {
        root?.URL?.revokeObjectURL?.(url);
      } catch {
        // ignore
      }
    }
  };

  const baseLru = createLruMap(lruLimit, (_key, entry) => {
    revokeUrl(entry?.objectUrl);
  });

  function canUseCanvas() {
    return Boolean(
      root?.document?.createElement &&
      typeof root?.Image === 'function' &&
      typeof root?.URL?.createObjectURL === 'function',
    );
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    const idb = root?.indexedDB;
    if (!idb || typeof idb.open !== 'function') {
      return Promise.resolve(null);
    }

    dbPromise = new Promise(resolve => {
      try {
        // 顺手异步清理旧版 v1 低清 640px 缓存库，释放空间
        try {
          idb.deleteDatabase?.('st_mate_backdrop_cache_v1');
        } catch {
          // ignore
        }

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

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const img = new root.Image();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        img.onload = img.onerror = null;
        reject(new Error('Image load timeout'));
      }, 15000);

      try {
        const pageOrigin = root.location?.origin;
        const parsed = new URL(src, pageOrigin || 'http://localhost/');
        if (pageOrigin && parsed.origin !== pageOrigin && !src.startsWith('blob:') && !src.startsWith('data:')) {
          img.crossOrigin = 'anonymous';
        }
      } catch {
        // ignore
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

  function canvasToBlob(canvas, type = 'image/webp', quality = 0.93) {
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
              canvas.toBlob(fallbackBlob => resolve(fallbackBlob || null), 'image/jpeg', 0.93);
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
      // ignore
    }
  }

  async function resolveCompressedBase(rawUrl) {
    if (!rawUrl || !canUseCanvas() || isAnimatedOrPrecompressedBg(rawUrl)) {
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

        const scale = Math.min(1, targetMaxEdge / Math.max(nw, nh));
        const tw = Math.max(1, Math.round(nw * scale));
        const th = Math.max(1, Math.round(nh * scale));

        const canvas = root.document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return null;

        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) {
          ctx.imageSmoothingQuality = 'high';
        }
        ctx.drawImage(img, 0, 0, tw, th);

        const blob = await canvasToBlob(canvas, 'image/webp', 0.93);
        // 立即释放 iOS WebKit IOSurface 离屏画布显存，不等 GC
        canvas.width = 0;
        canvas.height = 0;
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

  function invalidate(rawUrl) {
    if (!rawUrl) return;
    baseLru.delete(rawUrl);
    void deleteFromIdb(rawUrl);
  }

  function destroy() {
    inflightBase.clear();
    baseLru.clear();
  }

  return {
    peekCompressedBase,
    resolveCompressedBase,
    invalidate,
    destroy,
  };
}
