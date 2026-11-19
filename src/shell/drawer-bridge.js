/**
 * ST伴侣 (st-mate) · 原生抽屉残留节点清理器
 * v0.4.0 顶栏与工作台重构后，不再向任何原生 .drawer-content 顶部注入 .stm-drawer-bridge；
 * 此模块仅作为幂等安全清理层，移除任何旧版本热更新遗留的 .stm-drawer-bridge 节点。
 */

export function createDrawerBridge() {
  function cleanupBars() {
    globalThis.document?.querySelectorAll?.('.stm-drawer-bridge').forEach(el => el.remove());
  }

  return {
    sync: cleanupBars,
    destroy: cleanupBars,
  };
}
