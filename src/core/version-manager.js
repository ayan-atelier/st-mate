/**
 * SillyTavern 伴侣 (st-mate) · 手动触发的版本检查、更新到最新版与历史稳定版回退控制器
 * 遵循安全底线：
 * 1. 零开机联网轮询、零静默替换——仅在用户点击「检查更新 / 更新 / 回退」时发起请求；
 * 2. 更新优先切回并拉取 origin/main 主线；回退基于酒馆原生 /api/extensions/branches + /switch 切换至对应发布分支（origin/vX.Y.Z）；
 * 3. 切换前自动把当前伴侣配置快照备份到 extensionSettings.st_mate_version_backup（独立于 schema 清洗域，绝不丢失），角色卡与聊天存档零改动。
 */

export const STM_EXTENSION_ID = 'st-mate';
export const STM_VERSION_SETTINGS_SCHEMA = 1;
export const DEFAULT_STM_REPOSITORY = 'https://github.com/ayan-atelier/st-mate';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function parseVersionParts(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    throw new Error('版本号格式无效。');
  }
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] ? match[4].split('.') : [],
  ];
}

export function compareVersions(a, b) {
  const x = parseVersionParts(a);
  const y = parseVersionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  const [xp, yp] = [x[3], y[3]];
  if (!xp.length || !yp.length) {
    return xp.length === yp.length ? 0 : xp.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(xp.length, yp.length); i += 1) {
    if (xp[i] === undefined) return -1;
    if (yp[i] === undefined) return 1;
    const xn = /^\d+$/.test(xp[i]);
    const yn = /^\d+$/.test(yp[i]);
    if (xn && yn && Number(xp[i]) !== Number(yp[i])) {
      return Number(xp[i]) < Number(yp[i]) ? -1 : 1;
    }
    if (xn !== yn) return xn ? -1 : 1;
    if (xp[i] !== yp[i]) return xp[i] < yp[i] ? -1 : 1;
  }
  return 0;
}

export function normalizeRepositoryURL(value) {
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new Error('请填写完整的 GitHub 仓库网址。');
  }
  const match = parsed.pathname.match(/^\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9_.-]+)\/?$/);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !match
  ) {
    throw new Error('仅支持标准的 https://github.com/作者/仓库名 仓库地址。');
  }
  const repo = match[2].replace(/\.git$/, '');
  if (!repo || repo === '.' || repo === '..') {
    throw new Error('仓库名称无效。');
  }
  return `https://github.com/${match[1]}/${repo}`;
}

export function parseReleaseCatalog(value) {
  if (
    !value ||
    value.schema !== 1 ||
    value.extension !== STM_EXTENSION_ID ||
    !Array.isArray(value.releases) ||
    value.releases.length === 0 ||
    value.releases.length > 200
  ) {
    throw new Error('仓库中没有可识别的 SillyTavern 伴侣版本清单。');
  }
  const seen = new Set();
  const releases = value.releases
    .map(release => {
      const branch = release?.branch ? String(release.branch).trim() : `release-${release?.version || ''}`;
      const validBranch =
        branch === 'main' ||
        branch === `v${release?.version}` ||
        branch === `release-${release?.version}`;
      if (
        !release ||
        !VERSION_PATTERN.test(release.version) ||
        seen.has(release.version) ||
        !validBranch ||
        !Number.isSafeInteger(release.settings_schema) ||
        !VERSION_PATTERN.test(release.minimum_client_version)
      ) {
        throw new Error('版本清单不完整或包含重复版本，请稍后再试。');
      }
      seen.add(release.version);
      return {
        version: release.version,
        branch,
        settings_schema: release.settings_schema,
        minimum_client_version: release.minimum_client_version,
        notes: String(release.notes || '').slice(0, 4000),
      };
    })
    .sort((a, b) => compareVersions(b.version, a.version));

  if (!releases.some(r => r.version === value.latest)) {
    throw new Error('版本清单缺少最新版标记。');
  }
  return { latest: value.latest, releases };
}

export function createSettingsBackupSnapshot(settings, version) {
  let cloned = {};
  try {
    cloned = JSON.parse(JSON.stringify(settings || {}));
  } catch {
    cloned = {};
  }
  delete cloned.versionBackup;
  delete cloned.updateState;
  return {
    version: String(version || ''),
    savedAt: new Date().toISOString(),
    settings: cloned,
  };
}

export function createVersionManager({
  getContext,
  store,
  moduleURL = import.meta.url,
  apiRoot = globalThis.location?.href || 'http://127.0.0.1:8000/',
  currentVersion = '0.9.17',
  beforeChange = async () => {},
  fetcher = (...args) => globalThis.fetch(...args),
} = {}) {
  let busy = false;
  let disposed = false;
  let reloadNeeded = false;
  let clientVersion = '';
  const readControllers = new Set();

  function checkAlive() {
    if (disposed) {
      throw new Error('版本面板已关闭，请重新打开。');
    }
  }

  async function requestText(address, options = {}, mutating = false) {
    checkAlive();
    const controller = new AbortController();
    if (!mutating) readControllers.add(controller);
    const timer = globalThis.setTimeout(
      () => controller.abort(),
      mutating ? 90000 : 25000,
    );
    try {
      const response = await fetcher(address, { ...options, signal: controller.signal });
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('当前账号没有修改全局扩展的权限（云酒馆常见限制），请联系管理员或在个人扩展目录安装。');
        }
        throw new Error(`请求失败（HTTP ${response.status}），请检查网络或仓库访问状态。`);
      }
      return await response.text();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(
          mutating
            ? '版本切换尚未确认完成，请先刷新酒馆查看当前版本号，避免连续重复点击。'
            : '检查超时或已取消，请稍后重试。',
        );
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timer);
      readControllers.delete(controller);
    }
  }

  async function requestJson(address, options = {}, mutating = false) {
    const text = await requestText(address, options, mutating);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('服务端返回内容无法解析，请稍后重试。');
    }
  }

  function getHeaders() {
    const ctx = getContext?.();
    const base = typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {};
    return { 'Content-Type': 'application/json', ...base };
  }

  async function callExtensionApi(route, install, extra = {}, mutating = false) {
    return requestJson(
      new URL(`api/extensions/${route}`, apiRoot).href,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          extensionName: install.extensionName,
          global: install.global,
          ...extra,
        }),
      },
      mutating,
    );
  }

  async function fetchRemoteCatalog(repoUrl) {
    const slug = repoUrl.slice('https://github.com/'.length);
    const url = `https://raw.githubusercontent.com/${slug}/main/versions.json`;
    const raw = await requestText(url, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    try {
      return parseReleaseCatalog(JSON.parse(raw));
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error('仓库中的 versions.json 不是有效 JSON。');
      }
      throw err;
    }
  }

  function resolveExtensionFolderName() {
    const parsed = new URL(moduleURL, apiRoot);
    const match = parsed.pathname.match(/\/scripts\/extensions\/third-party\/([^/]+)\//);
    if (!match) {
      throw new Error('未能识别伴侣扩展的安装目录。请通过酒馆「安装扩展」使用 GitHub 仓库网址安装。');
    }
    return decodeURIComponent(match[1]);
  }

  function resolveManifestHref() {
    const folder = resolveExtensionFolderName();
    return new URL(`scripts/extensions/third-party/${encodeURIComponent(folder)}/manifest.json`, apiRoot).href;
  }

  async function resolveInstall() {
    const extensionName = resolveExtensionFolderName();
    const discovered = await requestJson(new URL('api/extensions/discover', apiRoot).href, {
      headers: getHeaders(),
    });
    const found =
      Array.isArray(discovered) &&
      discovered.find(
        item => item.name === `third-party/${extensionName}` && ['local', 'global'].includes(item.type),
      );
    if (!found) {
      throw new Error('找不到当前伴侣扩展的安装位置，请刷新酒馆后重试。');
    }
    const install = {
      extensionName,
      global: found.type === 'global',
    };
    const versionInfo = await callExtensionApi('version', install);
    if (!versionInfo?.remoteUrl || !versionInfo.currentCommitHash) {
      throw new Error(
        '这份伴侣是通过解压压缩包或非 Git 方式安装的；如需在插件内一键更新与回退，请通过酒馆「安装扩展」填 GitHub 仓库网址安装（原有配置会保留）。',
      );
    }
    return {
      ...install,
      ...versionInfo,
      repository: normalizeRepositoryURL(versionInfo.remoteUrl),
    };
  }

  function isCompatible(release) {
    if (!release || release.settings_schema !== STM_VERSION_SETTINGS_SCHEMA) return false;
    if (!clientVersion || !VERSION_PATTERN.test(clientVersion)) return true;
    return compareVersions(clientVersion, release.minimum_client_version) >= 0;
  }

  function backupSettingsBeforeChange() {
    const ctx = getContext?.();
    const currentSettings = store?.get?.() || ctx?.extensionSettings?.st_mate || {};
    if (ctx?.extensionSettings && typeof ctx.extensionSettings === 'object') {
      ctx.extensionSettings.st_mate_version_backup = createSettingsBackupSnapshot(
        currentSettings,
        currentVersion,
      );
      ctx.saveSettingsDebounced?.();
    }
  }

  return {
    get busy() {
      return busy;
    },
    get reloadNeeded() {
      return reloadNeeded;
    },
    get currentVersion() {
      return currentVersion;
    },
    get repository() {
      return DEFAULT_STM_REPOSITORY;
    },

    async check() {
      if (busy) throw new Error('正在检查或切换版本，请稍候。');
      if (reloadNeeded) throw new Error('版本已切换完成，请先刷新酒馆生效。');
      busy = true;
      try {
        const install = await resolveInstall();
        try {
          const client = await requestJson(new URL('version', apiRoot).href, { cache: 'no-store' });
          clientVersion =
            String(client?.pkgVersion || '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] || '';
        } catch {
          clientVersion = '';
        }

        const catalog = await fetchRemoteCatalog(install.repository);

        let branches = [];
        try {
          const branchRes = await callExtensionApi('branches', install);
          if (Array.isArray(branchRes)) {
            branches = branchRes;
          }
        } catch {
          branches = [];
        }
        checkAlive();

        const currentBranchName = install.currentBranchName || 'main';
        const latestEntry = catalog.releases.find(r => r.version === catalog.latest) || null;
        const latestCompatible = latestEntry ? isCompatible(latestEntry) : false;
        const needsMainSwitch = Boolean(currentBranchName && currentBranchName !== 'main');
        const newerVersion = Boolean(
          latestEntry && compareVersions(latestEntry.version, currentVersion) > 0,
        );
        const remoteAhead = currentBranchName === 'main' && install.isUpToDate === false;
        const canUpdate = Boolean(
          latestEntry && latestCompatible && (needsMainSwitch || newerVersion || remoteAhead),
        );

        const rollbackList = catalog.releases.filter(release => {
          if (!isCompatible(release)) return false;
          if (compareVersions(release.version, currentVersion) >= 0) return false;
          if (release.branch === 'main') return false;
          return branches.some(b => b?.name === `origin/${release.branch}`);
        });

        return {
          install: { ...install, branches },
          catalog,
          currentVersion,
          currentBranchName,
          needsMainSwitch,
          latest: canUpdate
            ? {
                ...latestEntry,
                action: 'update',
                targetBranch: 'main',
              }
            : null,
          latestInfo: latestEntry,
          rollbackList,
          previous: rollbackList[0] || null,
          unavailableLatest: Boolean(latestEntry && !latestCompatible && newerVersion),
          checkedAt: Date.now(),
        };
      } finally {
        busy = false;
      }
    },

    async apply(checked, target) {
      if (busy) throw new Error('正在处理版本切换，请稍候。');
      if (reloadNeeded) throw new Error('版本已切换完成，请先刷新酒馆生效。');
      checkAlive();
      const allowedTargets = [checked?.latest, ...(checked?.rollbackList || [])].filter(Boolean);
      if (
        !checked ||
        Date.now() - checked.checkedAt > 10 * 60 * 1000 ||
        !target ||
        !allowedTargets.includes(target) ||
        !isCompatible(target)
      ) {
        throw new Error('版本信息已过期或不可用，请重新点击「检查更新」。');
      }

      busy = true;
      let mutationStarted = false;
      try {
        const install = await resolveInstall();
        if (install.repository !== checked.install.repository) {
          throw new Error('扩展来源仓库发生变化，请重新检查更新。');
        }

        await beforeChange?.();
        backupSettingsBeforeChange();
        checkAlive();

        mutationStarted = true;
        if (target.action === 'update') {
          if (install.currentBranchName && install.currentBranchName !== 'main') {
            await callExtensionApi('branches', install).catch(() => {});
            await callExtensionApi('switch', install, { branch: 'origin/main' }, true);
          }
          await callExtensionApi('update', install, {}, true);
        } else {
          await callExtensionApi('switch', install, { branch: `origin/${target.branch}` }, true);
        }

        const [manifest, actual] = await Promise.all([
          requestJson(resolveManifestHref(), { cache: 'no-store' }).catch(() => null),
          callExtensionApi('version', install).catch(() => null),
        ]);

        if (target.action === 'update') {
          if (actual?.currentBranchName && actual.currentBranchName !== 'main') {
            throw new Error('未能切回 main 主线分支，请在酒馆「管理扩展」手动将分支切回 main。');
          }
        } else if (
          (manifest?.version && manifest.version !== target.version) ||
          (actual?.currentBranchName && actual.currentBranchName !== target.branch)
        ) {
          throw new Error('回退后的版本未能通过核对，请刷新酒馆检查扩展当前版本。');
        }

        const finalVersion = manifest?.version || target.version;
        reloadNeeded = true;
        return {
          version: finalVersion,
          branch: actual?.currentBranchName || target.targetBranch || target.branch || 'main',
          action: target.action === 'update' ? 'update' : 'rollback',
        };
      } catch (error) {
        if (mutationStarted) {
          reloadNeeded = true;
          throw new Error(`${error.message} 请刷新酒馆确认当前版本；伴侣设置备份已保存。`);
        }
        throw error;
      } finally {
        busy = false;
      }
    },

    dispose() {
      disposed = true;
      for (const controller of readControllers) {
        controller.abort();
      }
      readControllers.clear();
    },
  };
}
