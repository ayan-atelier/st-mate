/**
 * ST伴侣 (st-mate) · 现象级第三方生态无感兼容桥接表（三层兼容架构 · 第三层轻量适配层）
 * 设计准则：
 * 1. 绝不搬移、删除或篡改外部插件/美化脚本的原生 DOM 节点（如 QuietRoom 的 mountIntact() 父子契约）；
 * 2. 仅通过只读特征指纹检测与委托点击实现开箱即用联动；未安装对应作品时零 UI 痕迹、零性能开销。
 */

/**
 * 检测「QuietRoom.org（博客小站）」主题及配套脚本是否已激活。
 */
export function isQuietRoomActive(doc = globalThis.document) {
  if (!doc) return false;
  if (doc.body?.classList?.contains?.('hp-js')) return true;
  if (doc.getElementById?.('hp-side') || doc.getElementById?.('hp-addr')) return true;
  return false;
}

/**
 * 检测「QuietRoom.org（博客小站）」移动端/抽屉态左栏是否处于展开状态。
 */
export function isQuietRoomSidebarOpen(doc = globalThis.document) {
  return Boolean(doc?.body?.classList?.contains?.('hp-side-open'));
}

/**
 * 无损切换「QuietRoom.org（博客小站）」左侧个人小站栏（优先复用原脚本 .hp-side-btn 触发逻辑以同步滚动锁与遮罩）。
 */
export function toggleQuietRoomSidebar(doc = globalThis.document) {
  if (!doc?.body) return false;
  const addrEl = doc.getElementById?.('hp-addr');
  const nativeBtn = addrEl?.querySelector?.('.hp-side-btn') || doc.querySelector?.('.hp-side-btn');
  if (nativeBtn && typeof nativeBtn.click === 'function') {
    nativeBtn.click();
    return isQuietRoomSidebarOpen(doc);
  }
  return Boolean(doc.body.classList?.toggle?.('hp-side-open'));
}

/**
 * 检测「QR助手（小火箭 qr-assistant / uhhhh15）」是否处于启用接管态。
 */
export function isQrAssistantActive(doc = globalThis.document) {
  return Boolean(doc?.body?.classList?.contains?.('qra-enabled'));
}

/**
 * 检测「ST-QuickBar（快捷工具栏 / Sanjs333）」是否已挂载。
 */
export function isQuickBarActive(doc = globalThis.document) {
  if (!doc) return false;
  return Boolean(
    doc.getElementById?.('input_helper_toolbar') ||
      doc.querySelector?.('.ih-floating-ball, .ih-floating-panel'),
  );
}
