/**
 * ST伴侣 (st-mate) · 「预设馆伴侣助手」领域适配器、原子操作校验预览、多步快照撤回与内嵌交互面板
 * 职责边界：
 * 1. 当前预设上下文紧凑序列化（单条正文 >1800 字智能截取前 1200 + 后 400 字并标注总字数，兼顾全局视野与响应速度）；
 * 2. 6 类安全原子操作校验与前后 Diff 预览计算（自动保护 marker 系统槽与内置核心条目，拦截非法物理删除或截断覆盖）；
 * 3. 选择性勾选应用 + 自动完整快照入栈 (`undoStack`，最多 10 步) + 跨预设感知一键悔棋还原；
 * 4. 零 Emoji、1.5px 纯色细线图标内嵌助手 UI（支持窄屏独立顺滑滚动、16px 输入框防缩放、Enter 发送与流中随时停止）。
 */

import { hasActiveChatSelection } from '../core/env.js?v=0.9.20';
import { createIconNode, svgMarkup } from '../core/icons.js?v=0.9.20';
import { toastMessage } from '../shell/host-actions.js?v=0.9.20';
import {
  createAssistantSession,
  resolveAssistantRuntimeChannel,
} from './assistant-core.js?v=0.9.20';
import {
  PROMPT_ROLE_OPTIONS,
  UNLOCKED_MAX_CONTEXT,
  applyGenerationParams,
  applyPresetSnapshotToHost,
  captureCurrentPresetSnapshot,
  cleanPresetName,
  createCustomPromptEntry,
  deleteCustomPromptEntry,
  duplicateHostPreset,
  getHostPresetState,
  movePromptEntryOrder,
  readGenerationParams,
  readOrderedPromptEntries,
  resolveActivePromptOrderBucket,
  saveHostPreset,
  selectHostPresetByName,
  syncHostPromptManagerAndSettings,
  togglePromptEntryEnabled,
  updatePromptEntryFields,
} from './preset-backend.js?v=0.9.20';

export const MAX_UNDO_STEPS = 10;
export const MAX_PERSISTED_ASSISTANT_ROUNDS = 6;
export const PRESET_ASSISTANT_STORAGE_KEY = 'stm_preset_assistant_cache_v1';
export const DEFAULT_ENTRY_MAX_CHARS = 1800;
export const FOCUSED_ENTRY_MAX_CHARS = 8000;
export const MAX_FOCUSED_LONG_ENTRIES = 6;

export const PRESET_ASSISTANT_QUICK_PROMPTS = Object.freeze([
  '加一条防抢话规则（禁替 {{user}} 说话与心理描写）',
  '加一个带折叠美化框的小剧场（自动配齐正则）',
  '排查当前预设是否有冲突或重复条目',
  '新增或润色文风控制条目',
  '按功能帮我理顺当前开启的条目与权重位置',
]);

const OPERATION_TYPE_LABELS = Object.freeze({
  add_entry: '新增条目',
  update_entry: '修改条目',
  toggle_entry: '开启/停用',
  move_entry: '调整顺序',
  delete_entry: '删除条目',
  update_params: '调整参数',
  upsert_regex: '配套正则',
});

const TRUNCATE_MARKER_TOKEN = '...(中略 ';

const GENERIC_ENTRY_STOPWORDS = new Set([
  '条目',
  '预设',
  '规则',
  '提示',
  '提示词',
  '模块',
  '设置',
  '系统',
  '控制',
  '指南',
  '要求',
  '说明',
  '内容',
  '部分',
  '超长',
  '核心',
  '基础',
  '全局',
  '通用',
  '补充',
  '附加',
  '自定义',
  '旧版',
  '新版',
  '开启',
  '关闭',
  '停用',
  '调整',
  '修改',
  '新增',
  '删除',
  '卷轴',
  '守则',
  '设定',
  'system',
  'prompt',
  'prompts',
  'entry',
  'instructions',
  'instruction',
  'custom',
  'default',
]);

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function clampFloat(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function formatRoleShort(role) {
  const hit = PROMPT_ROLE_OPTIONS.find(r => r.id === role);
  return hit ? hit.shortLabel : 'SYS';
}

function compactSnippet(raw = '', maxLen = 20) {
  const clean = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen)}…`;
}

// ============================================================================
// 一、当前预设上下文紧凑序列化（支持用户点名长条目自动提权免截断） + 领域 System Prompt
// ============================================================================

/**
 * 评估某条非 marker 提示词条目在用户本轮提问 `userPrompt` 中的相关性得分：
 * 凡被用户点名提及（含引号书名号包裹、完整/去装饰条目名、Identifier 或核心领域词块）的重点长条目，
 * 自动放宽至 `8000` 字免截断，避免长文风/破限条目因被缩略而无法精准修改。
 */
export function scorePromptEntryRelevance(entry, userPrompt = '') {
  if (!entry || entry.isMarker || typeof userPrompt !== 'string') return 0;
  const promptLower = userPrompt.trim().toLowerCase();
  if (!promptLower) return 0;

  const idLower = String(entry.identifier || '').trim().toLowerCase();
  const nameLower = String(entry.name || '').trim().toLowerCase();
  if (!idLower && !nameLower) return 0;

  const coreName = nameLower
    .replace(/^[\s#0-9.、·•—═─_*【】\[\]()（）「」『』<>《》|｜:：-]+/, '')
    .replace(/[\s—═─_*【】\[\]()（）「」『』<>《》|｜:：-]+$/, '')
    .trim();

  // 1. 提取用户提问中用书名号/引号/括号显式点名的短语
  const quoteRegex = /[「『【《“"'`]([^」』】》”"'`\n]{2,60})[」』】》”"'`]/g;
  let qMatch = quoteRegex.exec(promptLower);
  while (qMatch !== null) {
    const q = qMatch[1].trim();
    if (q.length >= 2 && !GENERIC_ENTRY_STOPWORDS.has(q)) {
      if (q === nameLower || q === idLower || (coreName.length >= 2 && q === coreName)) {
        return 100;
      }
      if (
        (nameLower.length >= 2 && (nameLower.includes(q) || q.includes(nameLower))) ||
        (coreName.length >= 2 && (coreName.includes(q) || q.includes(coreName))) ||
        (idLower.length >= 3 && idLower.includes(q))
      ) {
        return 92;
      }
    }
    qMatch = quoteRegex.exec(promptLower);
  }

  // 2. 完整条目名或 Identifier 直接出现
  if (nameLower.length >= 2 && !GENERIC_ENTRY_STOPWORDS.has(nameLower) && promptLower.includes(nameLower)) {
    return 95;
  }
  if (idLower.length >= 3 && !GENERIC_ENTRY_STOPWORDS.has(idLower) && promptLower.includes(idLower)) {
    return 86;
  }
  if (coreName.length >= 2 && !GENERIC_ENTRY_STOPWORDS.has(coreName) && promptLower.includes(coreName)) {
    return 82;
  }

  // 3. 按常见装饰分隔符拆出的高辨识度词块命中
  const tokens = nameLower
    .split(/[\s【】\[\]()（）「」『』<>《》/\\|｜·•—═─_*+:：,，、-]+/)
    .map(t => t.replace(/^[0-9.]+/, '').trim())
    .filter(Boolean);
  for (const tok of tokens) {
    if (GENERIC_ENTRY_STOPWORDS.has(tok)) continue;
    const isAscii = /^[a-z0-9_]+$/.test(tok);
    if ((isAscii && tok.length >= 4) || (!isAscii && tok.length >= 2)) {
      if (promptLower.includes(tok)) {
        return 74;
      }
    }
  }

  // 4. 中文复合条目名的核心语义词根滑动匹配（如「【03】超长文风卷轴」命中用户提问中的「文风控制」）
  const cjkRuns = (coreName || nameLower).match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const run of cjkRuns) {
    const maxN = Math.min(4, run.length);
    for (let n = maxN; n >= 2; n -= 1) {
      for (let i = 0; i <= run.length - n; i += 1) {
        const gram = run.slice(i, i + n);
        if (GENERIC_ENTRY_STOPWORDS.has(gram)) continue;
        if (promptLower.includes(gram)) {
          return n >= 3 ? 68 : 56;
        }
      }
    }
  }

  return 0;
}

/**
 * 智能截断超长单条提示词正文：默认超过 1800 字时保留前 1200 字 + 后 400 字并标明总字数；
 * 对用户本轮点名的重点条目可放宽至 8000 字（超 8000 字时保留前 5600 + 后 2000 字）。
 */
export function truncatePromptContentForContext(
  rawContent = '',
  { maxChars = DEFAULT_ENTRY_MAX_CHARS, headChars = 1200, tailChars = 400 } = {},
) {
  const text = typeof rawContent === 'string' ? rawContent : '';
  if (text.length <= maxChars) {
    return {
      text,
      truncated: false,
      totalLength: text.length,
    };
  }

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const omitted = Math.max(1, text.length - headChars - tailChars);
  return {
    text: `${head}\n${TRUNCATE_MARKER_TOKEN}${omitted} 字，本条全文共 ${text.length} 字)...\n${tail}`,
    truncated: true,
    totalLength: text.length,
  };
}

/**
 * 序列化当前生效预设的核心参数与有序条目列表（供伴侣助手精准感知全局结构，并对 `userPrompt` 点名条目自动免截断提权）。
 */
export function serializePresetContext({
  getContext = null,
  oaiSettings = null,
  presetName = '',
  promptManager = null,
  userPrompt = '',
  doc = globalThis.document,
} = {}) {
  const ctx = getContext?.();
  const effectiveOai = oaiSettings || ctx?.chatCompletionSettings || {};
  const hostState = getContext ? getHostPresetState({ getContext, doc }) : { activePreset: '' };
  const activeName =
    cleanPresetName(presetName) || hostState.activePreset || '默认预设';

  const genParams = readGenerationParams({ chatCompletionSettings: effectiveOai });
  const ordered = readOrderedPromptEntries(effectiveOai, { promptManager });

  // 计算用户提问中重点提及的条目集合（按相关度降序最多放宽前 6 条长条目至 8000 字）
  const focusedIds = new Set();
  if (typeof userPrompt === 'string' && userPrompt.trim()) {
    const scored = [];
    for (const entry of ordered.entries) {
      if (entry.isMarker) continue;
      const score = scorePromptEntryRelevance(entry, userPrompt);
      if (score > 0) {
        scored.push({ identifier: entry.identifier, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    for (const hit of scored.slice(0, MAX_FOCUSED_LONG_ENTRIES)) {
      focusedIds.add(hit.identifier);
    }
  }

  const serializedEntries = ordered.entries.map((entry, idx) => {
    const base = {
      order: idx,
      identifier: entry.identifier,
      name: entry.name,
      enabled: entry.enabled,
      marker: entry.isMarker,
      system_prompt: entry.isSystemPrompt,
      role: entry.role,
      injection_position: entry.injectionPosition,
    };

    if (entry.injectionPosition === 1) {
      base.injection_depth = entry.injectionDepth;
      base.injection_order = entry.injectionOrder;
    }

    if (entry.isMarker) {
      base.content = `[系统动态占位槽: ${entry.markerHint}]`;
    } else {
      const isFocused = focusedIds.has(entry.identifier);
      const trunc = isFocused
        ? truncatePromptContentForContext(entry.content, {
            maxChars: FOCUSED_ENTRY_MAX_CHARS,
            headChars: 5600,
            tailChars: 2000,
          })
        : truncatePromptContentForContext(entry.content);
      base.content = trunc.text;
      if (isFocused) {
        base.focused = true;
      }
      if (trunc.truncated) {
        base.content_length = trunc.totalLength;
        base.truncated = true;
      }
    }

    return base;
  });

  const presetRegexRaw = Array.isArray(effectiveOai?.extensions?.regex_scripts)
    ? effectiveOai.extensions.regex_scripts
    : [];
  const globalRegexRaw = Array.isArray(ctx?.extensionSettings?.regex)
    ? ctx.extensionSettings.regex
    : [];

  const summarizeRegex = (item, includeSample = false) => {
    const base = {
      scriptName: String(item?.scriptName || '').trim().slice(0, 80),
      disabled: Boolean(item?.disabled),
      markdownOnly: Boolean(item?.markdownOnly),
      promptOnly: Boolean(item?.promptOnly),
      findRegex: compactSnippet(item?.findRegex || '', 110),
    };
    if (item?.minDepth !== null && item?.minDepth !== undefined) {
      base.minDepth = item.minDepth;
    }
    if (includeSample && item?.markdownOnly && typeof item?.replaceString === 'string' && item.replaceString.trim()) {
      base.styleSample = compactSnippet(item.replaceString, 180);
    }
    return base;
  };

  const serializedPresetRegex = presetRegexRaw
    .filter(item => item && typeof item === 'object')
    .slice(0, 24)
    .map(item => summarizeRegex(item, true));
  const serializedGlobalRegex = globalRegexRaw
    .filter(item => item && typeof item === 'object' && !item.disabled)
    .slice(0, 16)
    .map(item => summarizeRegex(item, false));

  return {
    preset_name: activeName,
    params: {
      openai_max_context: genParams.maxContext,
      openai_max_tokens: genParams.maxTokens,
      temperature: genParams.temperature,
    },
    counts: {
      total: ordered.totalCount,
      enabled: ordered.enabledCount,
      markers: ordered.markerCount,
      preset_regex: presetRegexRaw.length,
    },
    preset_regex_scripts: serializedPresetRegex,
    global_regex_scripts: serializedGlobalRegex,
    entries: serializedEntries,
  };
}

/**
 * 构建预设馆专属 System Prompt。
 */
export function buildPresetAssistantSystemPrompt() {
  return [
    '你是「砚台 · ST伴侣」内置的 SillyTavern（酒馆）对话预设架构师与调优助手。',
    '请始终使用自然、清晰、克制的简体中文回答，严禁输出任何彩色 Emoji 表情符号。',
    '',
    '【酒馆预设核心机制】',
    '1. 条目按 `entries` 数组从上到下组装发送；越靠近底部的条目，以及使用 `injection_position: 1` 且 `injection_depth` 越小（如 @D0 ~ @D2）的条目，对模型当轮回复的约束力越强（防抢话、输出格式、近期文风适合放在 `chatHistory` 之后或 `@D1`~`@D2`）。',
    '2. `marker: true`（如 `charDescription`, `personaDescription`, `worldInfoBefore`, `worldInfoAfter`, `chatHistory` 等）是酒馆动态填充的系统占位槽：只允许 `toggle_entry`（开关）或 `move_entry`（调序），严禁修改正文或删除。',
    '3. `system_prompt: true`（如 `main`, `nsfw`, `jailbreak`, `enhanceDefinitions`）是内置核心槽位：允许修改正文、开关或调序，但不可物理删除（若无需使用请用 `toggle_entry` 设为 `enabled: false`）。',
    '4. 对已有长条目做局部增补或词句微调时，请优先使用 `update_entry` 的安全增量模式（`appendContent` 末尾追加、`prependContent` 开头前置、或 `findText` + `replaceText` 局部精准替换片段），既快又 100% 零误伤原文！严禁将含有 `...(中略` 截断占位符的文本作为全量 `content` 写回。',
    '5. 编写提示词正文时，善用酒馆标准宏 `{{user}}`（代表玩家）与 `{{char}}`（代表角色）。',
    '',
    '【输出格式硬性规范】',
    '请直接输出一个合法的 JSON 对象（不要包含尾随逗号），结构如下：',
    '{',
    '  "reply": "向玩家简明扼要说明你的排查结论或修改思路（纯文本分段，不用 Emoji）",',
    '  "operations": [',
    '    // 若仅做纯诊断解答无需修改预设，传空数组 []；若需修改，按执行顺序列出以下 7 类原子操作：',
    '  ]',
    '}',
    '',
    '【支持的 7 类原子操作定义】',
    '1. 新增条目: { "type": "add_entry", "name": "条目名称", "role": "system|user|assistant", "enabled": true, "injection_position": 0, "injection_depth": 4, "position": "bottom|top", "afterIdentifier": "可选锚点identifier", "beforeIdentifier": "可选锚点identifier", "content": "完整提示词正文", "reason": "简短说明" }',
    '2. 修改条目（支持增量微调与全量重写）:',
    '   - 末尾追加（推荐用于长条目增补规则）: { "type": "update_entry", "identifier": "目标identifier", "appendContent": "要追加到末尾的新段落", "reason": "简短说明" }',
    '   - 局部替换（推荐用于精准改句/删句）: { "type": "update_entry", "identifier": "目标identifier", "findText": "原文中的精确片段", "replaceText": "替换后的新片段（传空串可精准移除原片段）", "reason": "简短说明" }',
    '   - 全量重写或改属性: { "type": "update_entry", "identifier": "目标identifier", "name": "可选新名称", "role": "可选system|user|assistant", "injection_position": 0, "injection_depth": 4, "content": "仅在完整重写整条时填写完整正文", "reason": "简短说明" }',
    '3. 开启/停用: { "type": "toggle_entry", "identifier": "目标identifier", "enabled": true, "reason": "简短说明" }',
    '4. 调整顺序: { "type": "move_entry", "identifier": "目标identifier", "position": "top|bottom", "afterIdentifier": "可选锚点identifier", "beforeIdentifier": "可选锚点identifier", "reason": "简短说明" }',
    '5. 删除条目: { "type": "delete_entry", "identifier": "目标自定义条目identifier", "reason": "简短说明" }（仅限 marker=false 且 system_prompt=false 的自定义条目）',
    '6. 调整参数: { "type": "update_params", "openai_max_context": 65536, "openai_max_tokens": 4096, "temperature": 0.95, "reason": "简短说明" }（仅填需修改的参数字段）',
    '7. 配套预设正则（新增或同名更新绑定在本预设内的正则脚本）:',
    '   { "type": "upsert_regex", "scriptName": "正则名称", "findRegex": "/正则字面量/g", "replaceString": "HTML美化模板或空串", "markdownOnly": true, "promptOnly": false, "minDepth": null, "placement": [2], "disabled": false, "reason": "简短说明" }',
    '',
    '【小剧场 / 动物塑 / 论坛体 / 状态面板的一站式配齐铁律】',
    '当玩家要求增加小剧场、动物塑、平行番外、论坛体、备忘录、日记或状态栏等结构化副产物时，除编写预设提示词条目外，请务必同步配齐配套的 `upsert_regex` 正则（随预设保存、不污染其他预设）：',
    '1. 提示词与标签呼应：在提示词条目中明确要求模型在正剧末尾使用成对闭合标签包裹（例如 `<动物塑小剧场>[角色动物塑 × {{user}}动物塑]\\n小剧场正文\\n</动物塑小剧场>`）。',
    '2. 显示美化正则（`markdownOnly: true, promptOnly: false, placement: [2]`）：',
    '   - `findRegex` 请用标准 `/.../g` 格式，末尾建议用 `(?:<\\/标签名>|$)` 兼容漏写闭合标签的历史楼层（如 `/<动物塑小剧场>\\s*(?:\\[([^\\]\\n]+)\\]\\s*)?([\\s\\S]*?)(?:<\\/动物塑小剧场>|$)/g`）。',
    '   - 美化风格自适应：若上下文 `preset_regex_scripts` 中已有现成卡片美化 `styleSample`，请延续其视觉风格；若原预设无任何美化痕迹，请采用零外部依赖、100% 跟随酒馆深浅主题变量的「半透可折叠卡片」单行紧凑 HTML（严禁彩色 Emoji，严禁在 HTML 行首缩进 4 个空格以防触发 Markdown 代码块）：',
    '     `<details open style="margin:12px 0 6px;border-radius:10px;border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#ccc) 15%,transparent);background:color-mix(in srgb,var(--SmartThemeBlurTintColor,#18181c) 72%,transparent);overflow:hidden;font-size:0.93em;line-height:1.78;"><summary style="cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 13px;border-bottom:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#ccc) 9%,transparent);user-select:none;"><span style="display:inline-flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;"><strong style="color:var(--SmartThemeBodyColor,inherit);font-weight:600;letter-spacing:0.03em;">动物塑小剧场</strong><span style="color:var(--SmartThemeQuoteColor,inherit);font-size:0.86em;padding:1px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--SmartThemeQuoteColor,#aaa) 28%,transparent);">$1</span></span><span style="opacity:0.5;font-size:0.8em;flex-shrink:0;">收起 / 展开</span></summary><div style="padding:10px 14px 12px;color:var(--SmartThemeBodyColor,inherit);white-space:pre-wrap;">$2</div></details>`',
    '     （若剧场无副标题分组 `$1` 则省略副标题胶囊直接填正文分组；可按剧场题材如论坛楼层、机密档案、日记便签微调标题栏排版，但颜色一律绑定 `--SmartThemeBodyColor` / `--SmartThemeQuoteColor` / `--SmartThemeEmColor` / `--SmartThemeBlurTintColor`）。',
    '3. 历史省流剥离正则（`markdownOnly: false, promptOnly: true, minDepth: 1, placement: [2], replaceString: ""`）：对场外小剧场/论坛体，建议额外附带一条 `promptOnly: true, minDepth: 1` 的剥离正则，发送时自动剔除历史轮次的场外副产物，既省 Token 又防比喻串味污染正剧。',
  ].join('\n');
}

// ============================================================================
// 二、6 类安全原子操作校验与前后 Diff 预览计算 (validateAndPreviewPresetOperations)
// ============================================================================

function findEntryByIdOrUniqueName(entries, rawId, rawName = '') {
  const idCandidate = typeof rawId === 'string' ? rawId.trim() : '';
  if (idCandidate) {
    const exactId = entries.find(e => e.identifier === idCandidate);
    if (exactId) return { entry: exactId, ambiguous: false };

    const byNameFromId = entries.filter(e => e.name === idCandidate);
    if (byNameFromId.length === 1) {
      return { entry: byNameFromId[0], ambiguous: false };
    }
    if (byNameFromId.length > 1) {
      return { entry: null, ambiguous: true, matchedName: idCandidate };
    }
  }

  const nameCandidate = typeof rawName === 'string' ? rawName.trim() : '';
  if (nameCandidate) {
    const exactMatches = entries.filter(e => e.name === nameCandidate);
    if (exactMatches.length === 1) {
      return { entry: exactMatches[0], ambiguous: false };
    }
    if (exactMatches.length > 1) {
      return { entry: null, ambiguous: true, matchedName: nameCandidate };
    }
  }

  return { entry: null, ambiguous: false };
}

function resolveAnchorRef(entries, rawAnchor) {
  const clean = typeof rawAnchor === 'string' ? rawAnchor.trim() : '';
  if (!clean) return null;
  const { entry } = findEntryByIdOrUniqueName(entries, clean, clean);
  return entry || null;
}

function describePlacement(op, entries) {
  const afterRef = op.afterIdentifier ?? op.after_identifier ?? op.after ?? '';
  const beforeRef = op.beforeIdentifier ?? op.before_identifier ?? op.before ?? '';
  const pos = typeof op.position === 'string' ? op.position.trim().toLowerCase() : '';

  const afterEntry = resolveAnchorRef(entries, afterRef);
  if (afterEntry) {
    return {
      mode: 'after',
      anchorId: afterEntry.identifier,
      anchorName: afterEntry.name,
      label: `排在「${afterEntry.name}」之后`,
    };
  }

  const beforeEntry = resolveAnchorRef(entries, beforeRef);
  if (beforeEntry) {
    return {
      mode: 'before',
      anchorId: beforeEntry.identifier,
      anchorName: beforeEntry.name,
      label: `排在「${beforeEntry.name}」之前`,
    };
  }

  if (pos === 'top' || pos === 'first' || pos === 'start') {
    return { mode: 'top', anchorId: '', anchorName: '', label: '置于列表顶部' };
  }

  if (typeof op.targetIndex === 'number' && Number.isFinite(op.targetIndex)) {
    const idx = Math.max(0, Math.round(op.targetIndex));
    return { mode: 'index', targetIndex: idx, anchorId: '', anchorName: '', label: `移至第 ${idx + 1} 位` };
  }

  return { mode: 'bottom', anchorId: '', anchorName: '', label: '置于列表末尾' };
}

/**
 * 零正则转义风险的字面量安全子串替换（彻底免疫 JS `.replace()` 中 `$1`/`$$`/`$&` 美元符吃字陷阱）。
 */
function applySafeSubstringReplace(sourceText = '', findStr = '', replaceStr = '', replaceAll = false) {
  if (!findStr) return { ok: false, reason: 'empty_find' };

  let count = 0;
  let cursor = 0;
  let firstIdx = -1;
  while (true) {
    const idx = sourceText.indexOf(findStr, cursor);
    if (idx === -1) break;
    if (firstIdx === -1) firstIdx = idx;
    count += 1;
    cursor = idx + findStr.length;
  }

  if (count === 0) {
    return { ok: false, reason: 'not_found', count: 0 };
  }
  if (count > 1 && !replaceAll) {
    return { ok: false, reason: 'ambiguous_multiple', count };
  }

  const nextContent = replaceAll
    ? sourceText.split(findStr).join(replaceStr)
    : `${sourceText.slice(0, firstIdx)}${replaceStr}${sourceText.slice(firstIdx + findStr.length)}`;

  return {
    ok: true,
    content: nextContent,
    count: replaceAll ? count : 1,
  };
}

function joinWithSmartNewline(headText = '', tailText = '') {
  if (!headText) return tailText;
  if (!tailText) return headText;
  return headText.endsWith('\n') || tailText.startsWith('\n')
    ? `${headText}${tailText}`
    : `${headText}\n${tailText}`;
}

function generateRegexUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function normalizeSillyTavernFindRegex(rawFind = '') {
  const trimmed = typeof rawFind === 'string' ? rawFind.trim() : '';
  if (!trimmed) return { ok: false, reason: '正则匹配式 findRegex 为空' };

  const slashMatch = trimmed.match(/^\/([\s\S]+)\/([dgimsuvy]*)$/);
  if (slashMatch) {
    const body = slashMatch[1];
    const flags = [...new Set(slashMatch[2].split(''))].join('');
    try {
      new RegExp(body, flags);
      return { ok: true, findRegex: `/${body}/${flags}` };
    } catch (err) {
      return { ok: false, reason: `正则语法无效 (${err?.message || '编译失败'})` };
    }
  }

  try {
    new RegExp(trimmed, 'g');
    const escapedBody = trimmed.replace(/(?<!\\)\//g, '\\/');
    return { ok: true, findRegex: `/${escapedBody}/g` };
  } catch (err) {
    return { ok: false, reason: `正则语法无效 (${err?.message || '编译失败'})` };
  }
}

/**
 * 清理美化正则 replaceString 中可能触发 Showdown Markdown 4 空格代码块误判的前导缩进。
 */
function sanitizeRegexReplaceHtml(rawReplace = '', markdownOnly = false) {
  const str = typeof rawReplace === 'string' ? rawReplace : '';
  if (!markdownOnly || !str.includes('<')) return str;
  return str
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]+(?=<)/gm, '')
    .replace(/^[ \t]{4,}/gm, '  ')
    .trim();
}

function formatRegexPreviewDoc(script) {
  if (!script) return '';
  const mode =
    script.markdownOnly && !script.promptOnly
      ? '仅界面渲染美化 (markdownOnly)'
      : script.promptOnly && !script.markdownOnly
        ? `仅发送前省流剥离 (promptOnly${script.minDepth != null ? `, minDepth=${script.minDepth}` : ''})`
        : '渲染与发送双端生效';
  return [
    `脚本名称: ${script.scriptName}`,
    `生效范围: 随本预设生效 · ${mode}${script.disabled ? '（停用）' : '（启用）'}`,
    `匹配正则: ${script.findRegex}`,
    `替换内容:`,
    script.replaceString ? script.replaceString : '（空字符串 · 匹配到的内容将被静默剥离）',
  ].join('\n');
}

/**
 * 严格校验模型给出的操作数组，拦截对系统槽的破坏行为，并生成可直接渲染「修改预览卡片」的结构化清单。
 */
export function validateAndPreviewPresetOperations(
  rawOperations = [],
  oaiSettings = {},
  { promptManager = null } = {},
) {
  const opsList = Array.isArray(rawOperations) ? rawOperations : [];
  const { entries } = readOrderedPromptEntries(oaiSettings, { promptManager });
  const currentParams = readGenerationParams({ chatCompletionSettings: oaiSettings });

  const items = [];
  const rejected = [];
  let seq = 0;

  const pushValid = payload => {
    seq += 1;
    items.push({
      opId: `op_${seq}`,
      ...payload,
    });
  };

  for (const rawOp of opsList) {
    if (!rawOp || typeof rawOp !== 'object' || Array.isArray(rawOp)) continue;

    const rawType = String(rawOp.type || rawOp.action || '').trim().toLowerCase();
    const reasonNote = typeof rawOp.reason === 'string' && rawOp.reason.trim() ? rawOp.reason.trim() : '';

    // -------------------------------------------------------------------------
    // 1. add_entry: 新建自定义提示词条目
    // -------------------------------------------------------------------------
    if (rawType === 'add_entry') {
      const content = typeof rawOp.content === 'string' ? rawOp.content : '';
      if (!content.trim()) {
        rejected.push({ type: 'add_entry', reason: '新增条目正文为空，已自动忽略' });
        continue;
      }

      const name = String(rawOp.name || '助手新增条目').trim().slice(0, 160) || '助手新增条目';
      const role = ['system', 'user', 'assistant'].includes(rawOp.role) ? rawOp.role : 'system';
      const enabled = rawOp.enabled !== undefined ? Boolean(rawOp.enabled) : true;
      const injectionPosition =
        Number(rawOp.injection_position ?? rawOp.injectionPosition) === 1 ? 1 : 0;
      const injectionDepth = clampInt(rawOp.injection_depth ?? rawOp.injectionDepth, 0, 999, 4);
      const injectionOrder = clampInt(rawOp.injection_order ?? rawOp.injectionOrder, -999, 9999, 100);
      const placement = describePlacement(rawOp, entries);

      const metaParts = [
        `角色 ${formatRoleShort(role)}`,
        injectionPosition === 1 ? `深度注入 @D${injectionDepth}` : placement.label,
        enabled ? '默认开启' : '默认停用',
      ];
      if (reasonNote) metaParts.push(reasonNote);

      pushValid({
        type: 'add_entry',
        typeLabel: OPERATION_TYPE_LABELS.add_entry,
        targetName: name,
        summary: metaParts.join(' · '),
        downgradedNote: '',
        canViewDiff: true,
        beforeContent: '',
        afterContent: content,
        metaDiffSummary: `${formatRoleShort(role)}${injectionPosition === 1 ? ` · @D${injectionDepth}` : ` · ${placement.label}`}（共 ${content.length} 字符）`,
        normalizedOp: {
          type: 'add_entry',
          name,
          role,
          enabled,
          injectionPosition,
          injectionDepth,
          injectionOrder,
          content,
          placement,
        },
      });
      continue;
    }

    // -------------------------------------------------------------------------
    // 2. update_entry: 修改已有条目的名称 / 角色 / 注入深度 / 正文
    // -------------------------------------------------------------------------
    if (rawType === 'update_entry') {
      const lookupName =
        rawOp.targetName ?? rawOp.originalName ?? (!rawOp.identifier ? rawOp.name : '');
      const { entry: target, ambiguous, matchedName } = findEntryByIdOrUniqueName(
        entries,
        rawOp.identifier ?? rawOp.id ?? rawOp.targetIdentifier,
        lookupName,
      );

      if (!target) {
        rejected.push({
          type: 'update_entry',
          reason: ambiguous
            ? `存在多条同名条目「${matchedName}」，为防误改已跳过`
            : `未找到待修改的条目「${rawOp.identifier || rawOp.name || '未知'}」`,
        });
        continue;
      }

      if (target.isMarker) {
        // 若模型对系统占位槽仅顺带尝试了切换开关，安全降级为 toggle_entry；否则拦截正文改写
        if (typeof rawOp.enabled === 'boolean' && rawOp.enabled !== target.enabled) {
          pushValid({
            type: 'toggle_entry',
            typeLabel: OPERATION_TYPE_LABELS.toggle_entry,
            targetName: target.name,
            summary: `${rawOp.enabled ? '开启' : '停用'}系统槽（原状态：${target.enabled ? '已开启' : '已停用'}）`,
            downgradedNote: '系统占位槽不可改写正文，已仅保留开关变更',
            canViewDiff: false,
            beforeContent: '',
            afterContent: '',
            metaDiffSummary: '',
            normalizedOp: {
              type: 'toggle_entry',
              identifier: target.identifier,
              enabled: rawOp.enabled,
            },
          });
        } else {
          rejected.push({
            type: 'update_entry',
            reason: `系统动态占位槽「${target.name}」受保护不可修改正文`,
          });
        }
        continue;
      }

      const patch = {};
      const changeNotes = [];

      if (typeof rawOp.name === 'string' && rawOp.name.trim() && rawOp.name.trim() !== target.name) {
        patch.name = rawOp.name.trim().slice(0, 160);
        changeNotes.push(`改名为「${patch.name}」`);
      }

      if (
        rawOp.role !== undefined &&
        ['system', 'user', 'assistant'].includes(rawOp.role) &&
        rawOp.role !== target.role
      ) {
        patch.role = rawOp.role;
        changeNotes.push(`角色 ${formatRoleShort(target.role)} -> ${formatRoleShort(rawOp.role)}`);
      }

      const rawPos = rawOp.injection_position ?? rawOp.injectionPosition;
      if (rawPos !== undefined) {
        const nextPos = Number(rawPos) === 1 ? 1 : 0;
        if (nextPos !== target.injectionPosition) {
          patch.injectionPosition = nextPos;
          changeNotes.push(nextPos === 1 ? '改为 @D 深度注入' : '改为按列表相对顺序发送');
        }
      }

      const rawDepth = rawOp.injection_depth ?? rawOp.injectionDepth;
      if (rawDepth !== undefined) {
        const nextDepth = clampInt(rawDepth, 0, 999, target.injectionDepth);
        const effectivePos = patch.injectionPosition ?? target.injectionPosition;
        if (nextDepth !== target.injectionDepth || patch.injectionPosition === 1) {
          patch.injectionDepth = nextDepth;
          if (effectivePos === 1) {
            changeNotes.push(`深度 @D${target.injectionDepth} -> @D${nextDepth}`);
          }
        }
      }

      const rawOrd = rawOp.injection_order ?? rawOp.injectionOrder;
      if (rawOrd !== undefined) {
        const nextOrd = clampInt(rawOrd, -999, 9999, target.injectionOrder);
        if (nextOrd !== target.injectionOrder) {
          patch.injectionOrder = nextOrd;
          changeNotes.push(`同深权重 ${target.injectionOrder} -> ${nextOrd}`);
        }
      }

      const rawReplacements = Array.isArray(rawOp.replacements) ? rawOp.replacements : [];
      const singleFind = rawOp.findText ?? rawOp.find_text ?? rawOp.searchText;
      const singleReplace = rawOp.replaceText ?? rawOp.replace_text;
      const prependTxt = rawOp.prependContent ?? rawOp.prepend_content;
      const appendTxt = rawOp.appendContent ?? rawOp.append_content;
      const hasIncrementalOps =
        rawReplacements.length > 0 ||
        singleFind !== undefined ||
        prependTxt !== undefined ||
        appendTxt !== undefined;
      const originalHasTruncToken = target.content.includes(TRUNCATE_MARKER_TOKEN);

      if (hasIncrementalOps) {
        let workingContent = target.content;
        let incrementalError = '';
        const incNotes = [];

        const repPairs = [...rawReplacements];
        if (singleFind !== undefined) {
          repPairs.push({
            findText: singleFind,
            replaceText: singleReplace,
            replaceAll: Boolean(rawOp.replaceAll ?? rawOp.replace_all),
          });
        }

        for (const pair of repPairs) {
          const findStr =
            typeof (pair?.findText ?? pair?.find_text ?? pair?.searchText) === 'string'
              ? (pair.findText ?? pair.find_text ?? pair.searchText)
              : '';
          const repRaw = pair?.replaceText ?? pair?.replace_text;
          if (!findStr) {
            incrementalError = `条目「${target.name}」的局部替换缺少待查找原片段 (findText)，已跳过`;
            break;
          }
          if (typeof repRaw !== 'string') {
            incrementalError = `条目「${target.name}」的局部替换缺少替换文本 (replaceText)，已跳过`;
            break;
          }
          if (
            !originalHasTruncToken &&
            (findStr.includes(TRUNCATE_MARKER_TOKEN) || repRaw.includes(TRUNCATE_MARKER_TOKEN))
          ) {
            incrementalError = `条目「${target.name}」的替换片段夹带了省略号截断占位符，已自动拦截`;
            break;
          }

          const repRes = applySafeSubstringReplace(
            workingContent,
            findStr,
            repRaw,
            Boolean(pair?.replaceAll ?? pair?.replace_all ?? rawOp.replaceAll ?? rawOp.replace_all),
          );
          if (!repRes.ok) {
            incrementalError =
              repRes.reason === 'ambiguous_multiple'
                ? `条目「${target.name}」中存在 ${repRes.count} 处相同的「${compactSnippet(findStr, 16)}」，为防误伤已跳过`
                : `条目「${target.name}」中未找到原片段「${compactSnippet(findStr, 20)}」，已跳过`;
            break;
          }
          workingContent = repRes.content;
          incNotes.push(
            repRaw
              ? `局部替换「${compactSnippet(findStr, 16)}」->「${compactSnippet(repRaw, 16)}」`
              : `局部移除「${compactSnippet(findStr, 18)}」`,
          );
        }

        if (!incrementalError && prependTxt !== undefined) {
          if (typeof prependTxt === 'string' && prependTxt.length > 0) {
            if (!originalHasTruncToken && prependTxt.includes(TRUNCATE_MARKER_TOKEN)) {
              incrementalError = `条目「${target.name}」前置文本夹带了截断占位符，已自动拦截`;
            } else {
              workingContent = joinWithSmartNewline(prependTxt, workingContent);
              incNotes.push(`开头前置 ${prependTxt.length} 字符（“${compactSnippet(prependTxt, 18)}”）`);
            }
          }
        }

        if (!incrementalError && appendTxt !== undefined) {
          if (typeof appendTxt === 'string' && appendTxt.length > 0) {
            if (!originalHasTruncToken && appendTxt.includes(TRUNCATE_MARKER_TOKEN)) {
              incrementalError = `条目「${target.name}」追加文本夹带了截断占位符，已自动拦截`;
            } else {
              workingContent = joinWithSmartNewline(workingContent, appendTxt);
              incNotes.push(`末尾追加 ${appendTxt.length} 字符（“${compactSnippet(appendTxt, 18)}”）`);
            }
          }
        }

        if (incrementalError) {
          rejected.push({
            type: 'update_entry',
            reason: incrementalError,
          });
          continue;
        }

        if (workingContent !== target.content) {
          patch.content = workingContent;
          changeNotes.push(...incNotes, `正文 ${target.content.length} -> ${workingContent.length} 字符`);
        }
      } else if (typeof rawOp.content === 'string' && rawOp.content !== target.content) {
        // 防呆拦截：禁止把上下文序列化生成的 `...(中略 ... 字)...` 截断标记写回原条目
        if (!originalHasTruncToken && rawOp.content.includes(TRUNCATE_MARKER_TOKEN)) {
          rejected.push({
            type: 'update_entry',
            reason: `条目「${target.name}」新正文夹带了省略号截断占位符，已自动拦截以保护原长文`,
          });
          continue;
        }
        patch.content = rawOp.content;
        changeNotes.push(`正文 ${target.content.length} -> ${rawOp.content.length} 字符`);
      }

      const hasEnabledToggle =
        typeof rawOp.enabled === 'boolean' && rawOp.enabled !== target.enabled;
      if (hasEnabledToggle) {
        changeNotes.push(rawOp.enabled ? '同时开启此条目' : '同时停用此条目');
      }

      if (Object.keys(patch).length === 0 && !hasEnabledToggle) {
        continue;
      }

      if (reasonNote) {
        changeNotes.push(reasonNote);
      }

      const afterContent = patch.content !== undefined ? patch.content : target.content;
      pushValid({
        type: 'update_entry',
        typeLabel: OPERATION_TYPE_LABELS.update_entry,
        targetName: target.name,
        summary: changeNotes.join(' · '),
        downgradedNote: '',
        canViewDiff: true,
        beforeContent: target.content,
        afterContent,
        metaDiffSummary: changeNotes.slice(0, 3).join(' · '),
        normalizedOp: {
          type: 'update_entry',
          identifier: target.identifier,
          patch,
          ...(hasEnabledToggle ? { enabled: rawOp.enabled } : {}),
        },
      });
      continue;
    }

    // -------------------------------------------------------------------------
    // 3. toggle_entry: 开启或关闭指定条目
    // -------------------------------------------------------------------------
    if (rawType === 'toggle_entry') {
      const { entry: target, ambiguous, matchedName } = findEntryByIdOrUniqueName(
        entries,
        rawOp.identifier ?? rawOp.id ?? rawOp.targetIdentifier,
        rawOp.name ?? rawOp.targetName,
      );

      if (!target) {
        rejected.push({
          type: 'toggle_entry',
          reason: ambiguous
            ? `存在多条同名条目「${matchedName}」，无法唯一判定开关目标`
            : `未找到条目「${rawOp.identifier || rawOp.name || '未知'}」`,
        });
        continue;
      }

      const nextEnabled = typeof rawOp.enabled === 'boolean' ? rawOp.enabled : !target.enabled;
      if (nextEnabled === target.enabled) {
        continue;
      }

      const summaryParts = [
        `${nextEnabled ? '开启' : '停用'}此条目（当前为${target.enabled ? '开启' : '停用'}）`,
      ];
      if (reasonNote) summaryParts.push(reasonNote);

      pushValid({
        type: 'toggle_entry',
        typeLabel: OPERATION_TYPE_LABELS.toggle_entry,
        targetName: target.name,
        summary: summaryParts.join(' · '),
        downgradedNote: '',
        canViewDiff: false,
        beforeContent: '',
        afterContent: '',
        metaDiffSummary: '',
        normalizedOp: {
          type: 'toggle_entry',
          identifier: target.identifier,
          enabled: nextEnabled,
        },
      });
      continue;
    }

    // -------------------------------------------------------------------------
    // 4. move_entry: 调整条目在发送序列中的先后位置
    // -------------------------------------------------------------------------
    if (rawType === 'move_entry') {
      const { entry: target, ambiguous, matchedName } = findEntryByIdOrUniqueName(
        entries,
        rawOp.identifier ?? rawOp.id ?? rawOp.targetIdentifier,
        rawOp.name ?? rawOp.targetName,
      );

      if (!target) {
        rejected.push({
          type: 'move_entry',
          reason: ambiguous
            ? `存在多条同名条目「${matchedName}」，无法唯一判定移动目标`
            : `未找到待移动的条目「${rawOp.identifier || rawOp.name || '未知'}」`,
        });
        continue;
      }

      const placement = describePlacement(rawOp, entries);
      if (placement.anchorId && placement.anchorId === target.identifier) {
        continue;
      }

      const summaryParts = [placement.label];
      if (reasonNote) summaryParts.push(reasonNote);

      pushValid({
        type: 'move_entry',
        typeLabel: OPERATION_TYPE_LABELS.move_entry,
        targetName: target.name,
        summary: summaryParts.join(' · '),
        downgradedNote: '',
        canViewDiff: false,
        beforeContent: '',
        afterContent: '',
        metaDiffSummary: '',
        normalizedOp: {
          type: 'move_entry',
          identifier: target.identifier,
          placement,
        },
      });
      continue;
    }

    // -------------------------------------------------------------------------
    // 5. delete_entry: 删除自定义冗余条目（系统槽拦截，内置核心项自动安全降级为停用）
    // -------------------------------------------------------------------------
    if (rawType === 'delete_entry') {
      const { entry: target, ambiguous, matchedName } = findEntryByIdOrUniqueName(
        entries,
        rawOp.identifier ?? rawOp.id ?? rawOp.targetIdentifier,
        rawOp.name ?? rawOp.targetName,
      );

      if (!target) {
        rejected.push({
          type: 'delete_entry',
          reason: ambiguous
            ? `存在多条同名条目「${matchedName}」，为防误删已跳过`
            : `未找到待删除的条目「${rawOp.identifier || rawOp.name || '未知'}」`,
        });
        continue;
      }

      if (target.isMarker) {
        rejected.push({
          type: 'delete_entry',
          reason: `系统占位槽「${target.name}」不可删除`,
        });
        continue;
      }

      if (target.isSystemPrompt || !target.canDelete) {
        if (target.enabled) {
          pushValid({
            type: 'toggle_entry',
            typeLabel: OPERATION_TYPE_LABELS.toggle_entry,
            targetName: target.name,
            summary: `停用内置条目${reasonNote ? ` · ${reasonNote}` : ''}`,
            downgradedNote: '酒馆核心内置条目不可物理删除，已自动安全转为「停用」',
            canViewDiff: false,
            beforeContent: '',
            afterContent: '',
            metaDiffSummary: '',
            normalizedOp: {
              type: 'toggle_entry',
              identifier: target.identifier,
              enabled: false,
            },
          });
        } else {
          rejected.push({
            type: 'delete_entry',
            reason: `内置条目「${target.name}」不可物理删除（当前已处于停用状态）`,
          });
        }
        continue;
      }

      pushValid({
        type: 'delete_entry',
        typeLabel: OPERATION_TYPE_LABELS.delete_entry,
        targetName: target.name,
        summary: `移除此自定义条目（共 ${target.content.length} 字符）${reasonNote ? ` · ${reasonNote}` : ''}`,
        downgradedNote: '',
        canViewDiff: Boolean(target.content),
        beforeContent: target.content,
        afterContent: '',
        metaDiffSummary: '删除后可通过顶部「撤回修改」完整恢复',
        normalizedOp: {
          type: 'delete_entry',
          identifier: target.identifier,
        },
      });
      continue;
    }

    // -------------------------------------------------------------------------
    // 6. update_params: 修改上下文长度 / 最大回复长度 / 回复温度
    // -------------------------------------------------------------------------
    if (rawType === 'update_params') {
      const paramPatch = {};
      const diffs = [];

      const rawCtx = rawOp.openai_max_context ?? rawOp.maxContext ?? rawOp.max_context;
      if (rawCtx !== undefined && Number.isFinite(Number(rawCtx))) {
        const nextCtx = clampInt(rawCtx, 512, UNLOCKED_MAX_CONTEXT, currentParams.maxContext);
        if (nextCtx !== currentParams.maxContext) {
          paramPatch.maxContext = nextCtx;
          diffs.push(`上下文 ${currentParams.maxContext} -> ${nextCtx}`);
        }
      }

      const rawTok = rawOp.openai_max_tokens ?? rawOp.maxTokens ?? rawOp.max_tokens;
      if (rawTok !== undefined && Number.isFinite(Number(rawTok))) {
        const nextTok = clampInt(rawTok, 16, 131072, currentParams.maxTokens);
        if (nextTok !== currentParams.maxTokens) {
          paramPatch.maxTokens = nextTok;
          diffs.push(`最大回复 ${currentParams.maxTokens} -> ${nextTok}`);
        }
      }

      const rawTemp = rawOp.temperature ?? rawOp.temp_openai ?? rawOp.temp;
      if (rawTemp !== undefined && Number.isFinite(Number(rawTemp))) {
        const nextTemp = Math.round(clampFloat(rawTemp, 0, 2, currentParams.temperature) * 100) / 100;
        if (Math.abs(nextTemp - currentParams.temperature) >= 0.005) {
          paramPatch.temperature = nextTemp;
          diffs.push(`温度 ${currentParams.temperature.toFixed(2)} -> ${nextTemp.toFixed(2)}`);
        }
      }

      if (Object.keys(paramPatch).length === 0) {
        continue;
      }

      if (reasonNote) diffs.push(reasonNote);

      pushValid({
        type: 'update_params',
        typeLabel: OPERATION_TYPE_LABELS.update_params,
        targetName: '核心生成参数',
        summary: diffs.join(' · '),
        downgradedNote: '',
        canViewDiff: false,
        beforeContent: '',
        afterContent: '',
        metaDiffSummary: '',
        normalizedOp: {
          type: 'update_params',
          paramPatch,
        },
      });
      continue;
    }

    // -------------------------------------------------------------------------
    // 7. upsert_regex: 新增或更新随本预设携带的 SillyTavern 正则脚本
    // -------------------------------------------------------------------------
    if (rawType === 'upsert_regex' || rawType === 'add_regex' || rawType === 'update_regex') {
      const scriptName = String(
        rawOp.scriptName ?? rawOp.script_name ?? rawOp.name ?? '伴侣新增正则',
      )
        .trim()
        .slice(0, 160);
      const parsedFind = normalizeSillyTavernFindRegex(
        rawOp.findRegex ?? rawOp.find_regex ?? rawOp.pattern ?? '',
      );
      if (!parsedFind.ok) {
        rejected.push({
          type: 'upsert_regex',
          reason: `正则「${scriptName || '未命名'}」无效：${parsedFind.reason}`,
        });
        continue;
      }

      const markdownOnly =
        rawOp.markdownOnly !== undefined
          ? Boolean(rawOp.markdownOnly)
          : rawOp.markdown_only !== undefined
            ? Boolean(rawOp.markdown_only)
            : !Boolean(rawOp.promptOnly ?? rawOp.prompt_only);
      const promptOnly = Boolean(rawOp.promptOnly ?? rawOp.prompt_only ?? false);
      const disabled = Boolean(rawOp.disabled ?? false);
      const rawMinDepth = rawOp.minDepth ?? rawOp.min_depth ?? null;
      const rawMaxDepth = rawOp.maxDepth ?? rawOp.max_depth ?? null;
      const minDepth =
        rawMinDepth !== null && rawMinDepth !== '' && Number.isFinite(Number(rawMinDepth))
          ? clampInt(rawMinDepth, 0, 999, 0)
          : null;
      const maxDepth =
        rawMaxDepth !== null && rawMaxDepth !== '' && Number.isFinite(Number(rawMaxDepth))
          ? clampInt(rawMaxDepth, 0, 999, 999)
          : null;
      const placementRaw = Array.isArray(rawOp.placement) ? rawOp.placement : [2];
      const placement = placementRaw
        .map(n => Number(n))
        .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
      const safePlacement = placement.length > 0 ? [...new Set(placement)] : [2];

      const rawReplace =
        typeof (rawOp.replaceString ?? rawOp.replace_string ?? rawOp.replace) === 'string'
          ? (rawOp.replaceString ?? rawOp.replace_string ?? rawOp.replace)
          : '';
      const replaceString = sanitizeRegexReplaceHtml(rawReplace, markdownOnly);

      const normalizedScript = {
        scriptName: scriptName || '伴侣新增正则',
        findRegex: parsedFind.findRegex,
        replaceString,
        trimStrings: Array.isArray(rawOp.trimStrings)
          ? rawOp.trimStrings.map(x => String(x))
          : [],
        placement: safePlacement,
        disabled,
        markdownOnly,
        promptOnly,
        runOnEdit: rawOp.runOnEdit !== undefined ? Boolean(rawOp.runOnEdit) : true,
        substituteRegex: Number.isFinite(Number(rawOp.substituteRegex))
          ? Number(rawOp.substituteRegex)
          : 0,
        minDepth,
        maxDepth,
      };

      const existingPresetScripts = Array.isArray(oaiSettings?.extensions?.regex_scripts)
        ? oaiSettings.extensions.regex_scripts
        : [];
      const existingHit = existingPresetScripts.find(
        s =>
          s &&
          (String(s.scriptName || '').trim() === normalizedScript.scriptName ||
            String(s.findRegex || '').trim() === normalizedScript.findRegex),
      );

      const modeBadge =
        markdownOnly && !promptOnly
          ? '显示美化卡片'
          : promptOnly && !markdownOnly
            ? `历史省流剥离${minDepth !== null ? ` (@D>=${minDepth})` : ''}`
            : '双端正则';
      const summaryParts = [
        existingHit ? `更新预设正则 · ${modeBadge}` : `写入预设正则 · ${modeBadge}`,
      ];
      if (reasonNote) summaryParts.push(reasonNote);

      pushValid({
        type: 'upsert_regex',
        typeLabel: OPERATION_TYPE_LABELS.upsert_regex,
        targetName: normalizedScript.scriptName,
        summary: summaryParts.join(' · '),
        downgradedNote: '',
        canViewDiff: true,
        beforeContent: existingHit ? formatRegexPreviewDoc(existingHit) : '',
        afterContent: formatRegexPreviewDoc(normalizedScript),
        metaDiffSummary: '随本预设保存与导出（切换至其他预设时自动隔离），支持一键撤回',
        normalizedOp: {
          type: 'upsert_regex',
          script: normalizedScript,
        },
      });
      continue;
    }

    rejected.push({
      type: rawType || 'unknown',
      reason: `未知的操作类型「${rawType || '空'}」，已自动忽略`,
    });
  }

  return {
    items,
    rejected,
  };
}

// ============================================================================
// 三、多步快照撤回栈 + 选择性勾选应用 + 一键撤回还原
// ============================================================================

/**
 * 创建预设修改多步撤回栈（默认最多保留 10 步完整预设快照）。
 */
export function createPresetUndoStack({ maxSteps = MAX_UNDO_STEPS } = {}) {
  const limit = clampInt(maxSteps, 1, 30, MAX_UNDO_STEPS);
  const stack = [];

  function push(snapshot, { summary = '', turnId = '', uiMsgId = '' } = {}) {
    if (!snapshot?.payload || typeof snapshot.payload !== 'object') return false;
    stack.push({
      id: `undo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      presetName: cleanPresetName(snapshot.presetName || ''),
      isGuiPreset: Boolean(snapshot.isGuiPreset),
      capturedAt: snapshot.capturedAt || Date.now(),
      summary: String(summary || '').trim(),
      turnId: String(turnId || '').trim(),
      uiMsgId: String(uiMsgId || '').trim(),
      snapshot: structuredClone(snapshot),
    });
    if (stack.length > limit) {
      stack.splice(0, stack.length - limit);
    }
    return true;
  }

  function peek() {
    return stack.length > 0 ? stack[stack.length - 1] : null;
  }

  function pop() {
    return stack.length > 0 ? stack.pop() : null;
  }

  function clear() {
    stack.length = 0;
  }

  return {
    push,
    peek,
    pop,
    clear,
    size: () => stack.length,
    list: () => stack.map(item => ({ ...item, snapshot: undefined })),
  };
}

function computeInsertIndexForAdd(bucket, placement) {
  const order = Array.isArray(bucket?.order) ? bucket.order : [];
  if (!placement) return -1;

  if (placement.mode === 'top') {
    return 0;
  }
  if (placement.mode === 'after' && placement.anchorId) {
    const idx = order.findIndex(item => item && item.identifier === placement.anchorId);
    if (idx >= 0) return idx + 1;
  }
  if (placement.mode === 'before' && placement.anchorId) {
    const idx = order.findIndex(item => item && item.identifier === placement.anchorId);
    if (idx >= 0) return idx;
  }
  if (placement.mode === 'index' && typeof placement.targetIndex === 'number') {
    return Math.max(0, Math.min(order.length, placement.targetIndex));
  }
  return -1;
}

function computeTargetIndexForMove(bucket, targetId, placement) {
  const order = Array.isArray(bucket?.order) ? bucket.order : [];
  const fromIdx = order.findIndex(item => item && item.identifier === targetId);
  if (fromIdx < 0 || order.length <= 1) return -1;

  if (placement?.mode === 'top') {
    return 0;
  }
  if (placement?.mode === 'bottom') {
    return order.length - 1;
  }
  if (placement?.mode === 'index' && typeof placement.targetIndex === 'number') {
    return Math.max(0, Math.min(order.length - 1, placement.targetIndex));
  }
  if (placement?.mode === 'after' && placement.anchorId) {
    const anchorIdx = order.findIndex(item => item && item.identifier === placement.anchorId);
    if (anchorIdx < 0 || anchorIdx === fromIdx) return -1;
    // splice(fromIdx, 1) 移除自身后：若 fromIdx < anchorIdx，锚点左移一位，插在其后恰好为 anchorIdx；否则为 anchorIdx + 1
    return fromIdx < anchorIdx ? anchorIdx : anchorIdx + 1;
  }
  if (placement?.mode === 'before' && placement.anchorId) {
    const anchorIdx = order.findIndex(item => item && item.identifier === placement.anchorId);
    if (anchorIdx < 0 || anchorIdx === fromIdx) return -1;
    // splice(fromIdx, 1) 移除自身后：若 fromIdx < anchorIdx，锚点左移至 anchorIdx - 1，插在其前即为 anchorIdx - 1；否则为 anchorIdx
    return fromIdx < anchorIdx ? anchorIdx - 1 : anchorIdx;
  }

  return -1;
}

async function syncHostPresetRegexRuntime(ctx, presetName, { isGuiPreset = false, doc = globalThis.document } = {}) {
  if (!ctx) return;
  if (ctx.extensionSettings && typeof ctx.extensionSettings === 'object') {
    const pm = getHostPresetState({ getContext: () => ctx, doc }).presetManager;
    const apiId = pm?.apiId || 'openai';
    const allowMap =
      ctx.extensionSettings.preset_allowed_regex &&
      typeof ctx.extensionSettings.preset_allowed_regex === 'object'
        ? ctx.extensionSettings.preset_allowed_regex
        : (ctx.extensionSettings.preset_allowed_regex = {});
    const list = Array.isArray(allowMap[apiId]) ? allowMap[apiId] : (allowMap[apiId] = []);
    const targetNames = [];
    if (presetName) targetNames.push(presetName);
    if (isGuiPreset || !presetName) targetNames.push('gui');
    let dirty = false;
    for (const n of targetNames) {
      if (n && !list.includes(n)) {
        list.push(n);
        dirty = true;
      }
    }
    if (dirty) {
      ctx.saveSettingsDebounced?.();
    }
  }

  try {
    const base = doc?.baseURI || globalThis.location?.href;
    if (base && /^https?:/i.test(String(base))) {
      const rxMod = await import(new URL('scripts/extensions/regex/engine.js', base).href);
      rxMod?.RegexProvider?.instance?.clear?.();
    }
  } catch {
    // ignore in unit tests or older hosts
  }

  if (hasActiveChatSelection(ctx) && typeof ctx.reloadCurrentChat === 'function') {
    try {
      await ctx.reloadCurrentChat();
    } catch {
      // ignore
    }
  }
}

/**
 * 按玩家勾选列表依次执行原子修改（应用前自动拍下当前预设完整快照推入 `undoStack`）。
 */
export async function applySelectedPresetOperations({
  previewItems = [],
  selectedOpIds = null,
  targetPresetName = '',
  targetIsGuiPreset = false,
  turnId = '',
  uiMsgId = '',
  undoStack = null,
  getContext,
  autoSaver = null,
  persistImmediately = false,
  openAiModule = null,
  promptManager = null,
  fetchImpl = globalThis.fetch,
  doc = globalThis.document,
} = {}) {
  const expectedPreset = cleanPresetName(targetPresetName);
  const curState = getHostPresetState({ getContext, doc });

  if (expectedPreset) {
    if (curState.activePreset !== expectedPreset) {
      await autoSaver?.flush?.();
      const sw = await selectHostPresetByName(expectedPreset, { getContext, doc });
      if (!sw.ok) {
        return {
          ok: false,
          appliedCount: 0,
          message: `该方案对应的原预设「${expectedPreset}」已不存在，无法应用`,
        };
      }
    }
  } else if (targetIsGuiPreset && !curState.isGuiPreset && curState.activePreset) {
    return {
      ok: false,
      appliedCount: 0,
      message: `该方案生成于默认临时预设，当前已切至「${curState.activePreset}」，请重新提问后再应用`,
    };
  }

  const ctx = getContext?.();
  const oai = ctx?.chatCompletionSettings;
  if (!oai || typeof oai !== 'object') {
    return { ok: false, appliedCount: 0, message: '未读取到当前聊天补全预设数据' };
  }

  const selectedSet =
    selectedOpIds instanceof Set
      ? selectedOpIds
      : Array.isArray(selectedOpIds)
        ? new Set(selectedOpIds)
        : new Set(previewItems.map(item => item.opId));

  const chosen = previewItems.filter(item => item && selectedSet.has(item.opId));
  if (chosen.length === 0) {
    return { ok: false, appliedCount: 0, message: '请至少勾选一项要应用的修改' };
  }

  // 1. 先拍下修改前完整预设快照并推入撤回栈
  const beforeSnapshot = captureCurrentPresetSnapshot({ getContext, openAiModule, doc });
  if (undoStack && typeof undoStack.push === 'function') {
    undoStack.push(beforeSnapshot, {
      summary: chosen.map(c => `${c.typeLabel}:${c.targetName}`).join('、'),
      turnId,
      uiMsgId,
    });
  }

  // 2. 顺序执行已勾选的原子修改
  let appliedCount = 0;
  let structuralChange = false;
  let touchedRegex = false;
  const createdIds = [];

  for (const item of chosen) {
    const op = item.normalizedOp;
    if (!op) continue;

    if (op.type === 'add_entry') {
      const bucket = resolveActivePromptOrderBucket(oai, { promptManager, ensureIfMissing: true });
      const insertIndex = computeInsertIndexForAdd(bucket, op.placement);
      const created = createCustomPromptEntry(
        oai,
        {
          name: op.name,
          role: op.role,
          enabled: op.enabled,
          content: op.content,
          injectionPosition: op.injectionPosition,
          injectionDepth: op.injectionDepth,
          injectionOrder: op.injectionOrder,
        },
        { insertIndex, promptManager },
      );
      if (created) {
        createdIds.push(created.identifier);
        appliedCount += 1;
        structuralChange = true;
      }
    } else if (op.type === 'update_entry') {
      let changed = false;
      if (op.patch && Object.keys(op.patch).length > 0) {
        const res = updatePromptEntryFields(oai, op.identifier, op.patch);
        if (res.ok) changed = true;
      }
      if (typeof op.enabled === 'boolean') {
        const toggled = togglePromptEntryEnabled(oai, op.identifier, op.enabled, { promptManager });
        if (toggled !== null) changed = true;
      }
      if (changed) appliedCount += 1;
    } else if (op.type === 'toggle_entry') {
      const res = togglePromptEntryEnabled(oai, op.identifier, op.enabled, { promptManager });
      if (res !== null) appliedCount += 1;
    } else if (op.type === 'move_entry') {
      const bucket = resolveActivePromptOrderBucket(oai, { promptManager, ensureIfMissing: true });
      const toIdx = computeTargetIndexForMove(bucket, op.identifier, op.placement);
      if (toIdx >= 0 && movePromptEntryOrder(oai, op.identifier, toIdx, { promptManager })) {
        appliedCount += 1;
      }
    } else if (op.type === 'delete_entry') {
      const res = deleteCustomPromptEntry(oai, op.identifier);
      if (res.ok) {
        appliedCount += 1;
        structuralChange = true;
      }
    } else if (op.type === 'update_params') {
      applyGenerationParams(op.paramPatch, { getContext, doc });
      appliedCount += 1;
    } else if (op.type === 'upsert_regex' && op.script) {
      if (!oai.extensions || typeof oai.extensions !== 'object' || Array.isArray(oai.extensions)) {
        oai.extensions = {};
      }
      if (!Array.isArray(oai.extensions.regex_scripts)) {
        oai.extensions.regex_scripts = [];
      }
      const rxList = oai.extensions.regex_scripts;
      const existingIdx = rxList.findIndex(
        item =>
          item &&
          (String(item.scriptName || '').trim() === op.script.scriptName ||
            String(item.findRegex || '').trim() === op.script.findRegex),
      );
      if (existingIdx >= 0) {
        const keepId = rxList[existingIdx].id || generateRegexUuid();
        rxList[existingIdx] = { ...op.script, id: keepId };
      } else {
        rxList.push({ ...op.script, id: generateRegexUuid() });
      }
      appliedCount += 1;
      touchedRegex = true;
    }
  }

  // 若实际 0 项生效（极端并发已被外部移除），回退刚推入的空快照
  if (appliedCount === 0) {
    undoStack?.pop?.();
    return { ok: false, appliedCount: 0, message: '所选目标状态已变化，未产生实际改动' };
  }

  // 3. 同步宿主原生 promptManager 并自动落盘写回预设 .json
  await syncHostPromptManagerAndSettings({
    getContext,
    promptManager,
    openAiModule,
    immediateRender: true,
    structuralChange,
    doc,
  });

  if (autoSaver && typeof autoSaver.schedule === 'function') {
    autoSaver.schedule();
  } else if (persistImmediately && beforeSnapshot.presetName && !beforeSnapshot.isGuiPreset) {
    const afterSnap = captureCurrentPresetSnapshot({ getContext, openAiModule, doc });
    await saveHostPreset(afterSnap.presetName, afterSnap.payload, {
      getContext,
      openAiModule,
      fetchImpl,
      updateDropdown: false,
      selectSaved: false,
      doc,
    });
  }

  const isGui = Boolean(beforeSnapshot.isGuiPreset || !beforeSnapshot.presetName);
  if (touchedRegex) {
    await syncHostPresetRegexRuntime(ctx, beforeSnapshot.presetName || '', {
      isGuiPreset: isGui,
      doc,
    });
  }

  return {
    ok: true,
    appliedCount,
    createdIds,
    isGuiPreset: isGui,
    presetName: beforeSnapshot.presetName || '默认预设',
    undoAvailableSteps: undoStack?.size?.() ?? 0,
    message: isGui
      ? `已内存应用 ${appliedCount} 项修改（默认预设刷新会丢失，建议另存为新预设）`
      : `已应用 ${appliedCount} 项预设修改`,
  };
}

/**
 * 从 `undoStack` 弹出最近一步快照并完整还原预设条目、发送顺序与核心参数：
 * - 若玩家已切到另一套预设 B，会先 `await autoSaver.flush()` 保住预设 B 的未存改动，再安全切回原预设 A 还原并落盘！
 */
export async function undoLastPresetOperation({
  undoStack,
  getContext,
  autoSaver = null,
  openAiModule = null,
  fetchImpl = globalThis.fetch,
  doc = globalThis.document,
} = {}) {
  const topRecord = undoStack?.peek?.();
  if (!topRecord) {
    return {
      ok: false,
      reason: 'empty_stack',
      remainingSteps: 0,
      message: '当前没有可撤回的修改记录',
    };
  }

  const hostState = getHostPresetState({ getContext, doc });
  const pendingPreset = autoSaver?.getPendingPresetName?.() || '';
  let switchedPreset = false;

  // 场景 A：待撤回快照产生于酒馆不可写盘的 `'gui'` 默认临时预设
  if (topRecord.isGuiPreset || !topRecord.presetName) {
    if (!hostState.isGuiPreset && hostState.activePreset) {
      await autoSaver?.flush?.();
      return {
        ok: false,
        reason: 'gui_preset_left',
        remainingSteps: undoStack.size(),
        message: `待撤回记录属于默认临时预设，当前已处于「${hostState.activePreset}」，为保护当前预设未执行覆盖`,
      };
    }
    autoSaver?.cancel?.();
    await autoSaver?.flush?.();
  } else {
    // 场景 B：正式命名预设 —— 跨预设撤回时先 flush 保住当前预设未存改动；同预设撤回时先取消当前脏防抖再等待在途请求结束
    const needSwitchPreset = hostState.activePreset !== topRecord.presetName;
    const hasOtherPresetPending = Boolean(pendingPreset && pendingPreset !== topRecord.presetName);

    if (needSwitchPreset || hasOtherPresetPending) {
      await autoSaver?.flush?.();
      if (needSwitchPreset) {
        const sw = await selectHostPresetByName(topRecord.presetName, { getContext, doc });
        if (!sw.ok) {
          return {
            ok: false,
            reason: 'target_preset_missing',
            remainingSteps: undoStack.size(),
            message: `原预设「${topRecord.presetName}」已不存在，无法切回还原`,
          };
        }
        switchedPreset = true;
      }
    } else {
      autoSaver?.cancel?.();
      await autoSaver?.flush?.();
    }
  }

  const popped = undoStack.pop();
  const prevRegexJson = JSON.stringify(
    getContext?.()?.chatCompletionSettings?.extensions?.regex_scripts || [],
  );
  const nextRegexJson = JSON.stringify(popped.snapshot?.payload?.extensions?.regex_scripts || []);
  const res = await applyPresetSnapshotToHost(popped.snapshot, {
    getContext,
    persistToFile: Boolean(popped.presetName && !popped.isGuiPreset),
    openAiModule,
    fetchImpl,
    doc,
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason || 'restore_failed',
      remainingSteps: undoStack.size(),
      message: '还原预设快照失败',
    };
  }

  if (prevRegexJson !== nextRegexJson) {
    await syncHostPresetRegexRuntime(getContext?.(), popped.presetName || '', {
      isGuiPreset: Boolean(popped.isGuiPreset || !popped.presetName),
      doc,
    });
  }

  const targetTitle = popped.presetName || '默认预设';
  return {
    ok: true,
    presetName: targetTitle,
    isGuiPreset: Boolean(popped.isGuiPreset || !popped.presetName),
    switchedPreset,
    remainingSteps: undoStack.size(),
    undoneTurnId: popped.turnId || '',
    undoneUiMsgId: popped.uiMsgId || '',
    message: switchedPreset
      ? `已切回「${targetTitle}」并撤回上一步修改`
      : `已撤回上一步修改（${targetTitle}）`,
  };
}

// ============================================================================
// 四、预设馆内嵌「伴侣助手」交互视图组件 (createPresetAssistantPanel)
// ============================================================================

function summarizePresetOpsForHistory(operations = []) {
  if (!Array.isArray(operations) || operations.length === 0) return '';
  const brief = operations.slice(0, 8).map(op => {
    const rawT = op?.type === 'add_regex' || op?.type === 'update_regex' ? 'upsert_regex' : op?.type;
    const label = OPERATION_TYPE_LABELS[rawT] || op?.type || '修改';
    const target =
      op?.scriptName ||
      op?.name ||
      op?.identifier ||
      (op?.type === 'update_params' ? '生成参数' : '');
    return target ? `${label}(${target})` : label;
  });
  return `[本轮提供方案: ${brief.join('、')}]`;
}

function resolveAssistantStorage(explicitStorage = undefined) {
  if (explicitStorage !== undefined) return explicitStorage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function serializeUiMessagesForStorage(messages = []) {
  const clean = messages.filter(m => m && !m.isPending);
  return clean.slice(-MAX_PERSISTED_ASSISTANT_ROUNDS * 2).map(m => {
    if (m.role === 'user') {
      return {
        id: String(m.id || `ui_${Date.now()}_u`),
        role: 'user',
        text: String(m.text || ''),
        isPending: false,
        isError: false,
      };
    }
    return {
      id: String(m.id || `ui_${Date.now()}_a`),
      role: 'assistant',
      turnId: String(m.turnId || ''),
      text: String(m.text || ''),
      isPending: false,
      isError: Boolean(m.isError),
      targetPresetName: String(m.targetPresetName || ''),
      targetIsGuiPreset: Boolean(m.targetIsGuiPreset),
      applied: Boolean(m.applied),
      appliedCount: Number(m.appliedCount) || 0,
      appliedOnGuiPreset: Boolean(m.appliedOnGuiPreset),
      selectedIds: m.selectedIds ? [...m.selectedIds] : [],
      expandedDiffIds: m.expandedDiffIds ? [...m.expandedDiffIds] : [],
      plan:
        m.plan && typeof m.plan === 'object'
          ? {
              items: Array.isArray(m.plan.items) ? m.plan.items : [],
              rejected: Array.isArray(m.plan.rejected) ? m.plan.rejected : [],
            }
          : null,
    };
  });
}

function deserializeUiMessagesFromStorage(rawList = []) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const item of rawList.slice(-MAX_PERSISTED_ASSISTANT_ROUNDS * 2)) {
    if (!item || typeof item !== 'object') continue;
    if (item.role === 'user') {
      const text = String(item.text || '').trim();
      if (!text) continue;
      out.push({
        id: String(item.id || `ui_${Date.now()}_u`),
        role: 'user',
        text,
        isPending: false,
        isError: false,
      });
      continue;
    }
    if (item.role === 'assistant') {
      const plan =
        item.plan && typeof item.plan === 'object'
          ? {
              items: Array.isArray(item.plan.items) ? item.plan.items : [],
              rejected: Array.isArray(item.plan.rejected) ? item.plan.rejected : [],
            }
          : null;
      out.push({
        id: String(item.id || `ui_${Date.now()}_a`),
        role: 'assistant',
        turnId: String(item.turnId || ''),
        text: String(item.text || ''),
        isPending: false,
        isError: Boolean(item.isError),
        targetPresetName: String(item.targetPresetName || ''),
        targetIsGuiPreset: Boolean(item.targetIsGuiPreset),
        applied: Boolean(item.applied),
        appliedCount: Number(item.appliedCount) || 0,
        appliedOnGuiPreset: Boolean(item.appliedOnGuiPreset),
        selectedIds: new Set(Array.isArray(item.selectedIds) ? item.selectedIds : []),
        expandedDiffIds: new Set(Array.isArray(item.expandedDiffIds) ? item.expandedDiffIds : []),
        plan,
      });
    }
  }
  return out;
}

export function createPresetAssistantPanel({
  getContext,
  store,
  autoSaver = null,
  storage = undefined,
  onAppliedOrUndone = null,
  onRequestCollapse = null,
  onOpenApiDock = null,
} = {}) {
  const undoStack = createPresetUndoStack({ maxSteps: MAX_UNDO_STEPS });
  const backingStorage = resolveAssistantStorage(storage);

  const session = createAssistantSession({
    domainId: 'preset',
    systemPromptBuilder: buildPresetAssistantSystemPrompt,
    contextBuilder: ({ userText } = {}) =>
      serializePresetContext({ getContext, userPrompt: userText }),
    summarizeOperations: summarizePresetOpsForHistory,
    store,
    getContext,
  });

  // UI 消息流状态（与 session 协同保留预览勾选、Diff 折叠与已应用锁死态，并自动持久化最近 6 轮防刷新丢失）
  let uiMessages = [];
  let draftInput = '';
  let confirmClear = false;
  let destroyed = false;

  function persistState() {
    if (!backingStorage || typeof backingStorage.setItem !== 'function') return;
    try {
      const serializedMsgs = serializeUiMessagesForStorage(uiMessages);
      const turns = session.getHistoryTurns().slice(-MAX_PERSISTED_ASSISTANT_ROUNDS);
      const cleanDraft = String(draftInput || '').slice(0, 4000);
      if (serializedMsgs.length === 0 && turns.length === 0 && !cleanDraft.trim()) {
        backingStorage.removeItem?.(PRESET_ASSISTANT_STORAGE_KEY);
        return;
      }
      backingStorage.setItem(
        PRESET_ASSISTANT_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          updatedAt: Date.now(),
          draftInput: cleanDraft,
          turns,
          uiMessages: serializedMsgs,
        }),
      );
    } catch {
      // 存储配额受限时保留内存副本即可
    }
  }

  function clearPersistedState() {
    if (!backingStorage || typeof backingStorage.removeItem !== 'function') return;
    try {
      backingStorage.removeItem(PRESET_ASSISTANT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function hydratePersistedState() {
    if (!backingStorage || typeof backingStorage.getItem !== 'function') return;
    try {
      const raw = backingStorage.getItem(PRESET_ASSISTANT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      if (Array.isArray(parsed.turns)) {
        session.restoreHistory(parsed.turns.slice(-MAX_PERSISTED_ASSISTANT_ROUNDS));
      }
      if (Array.isArray(parsed.uiMessages)) {
        uiMessages = deserializeUiMessagesFromStorage(parsed.uiMessages);
      }
      if (typeof parsed.draftInput === 'string') {
        draftInput = parsed.draftInput.slice(0, 4000);
      }
    } catch {
      // 损坏缓存静默忽略
    }
  }

  hydratePersistedState();

  let rootEl = null;
  let channelBadgeBtn = null;
  let undoBtn = null;
  let clearBtn = null;
  let logEl = null;
  let textareaEl = null;
  let sendOrStopBtn = null;

  function el(tag, className = '', text = '') {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function autoResizeInput() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    const nextH = Math.min(130, Math.max(38, textareaEl.scrollHeight));
    textareaEl.style.height = `${nextH}px`;
  }

  function scrollToLogBottom() {
    if (!logEl) return;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function syncToolbarStatus() {
    const doc = globalThis.document;
    if (!doc || !rootEl) return;

    const channel = resolveAssistantRuntimeChannel({ store, getContext });
    if (channelBadgeBtn) {
      const hasModel = Boolean(channel.model);
      channelBadgeBtn.className = `stm-ast-channel-badge${channel.channelType === 'aux' ? ' is-aux' : ''}${hasModel ? '' : ' is-warn'}`;
      channelBadgeBtn.textContent = channel.badgeLabel;
      channelBadgeBtn.title = `${channel.detailLabel}（点击可在 API 工作台切换主/副通道模型）`;
    }

    if (undoBtn) {
      const steps = undoStack.size();
      const busy = session.isBusy();
      undoBtn.disabled = steps === 0 || busy;
      undoBtn.className = `stm-ast-undo-btn${steps > 0 ? ' is-ready' : ''}`;
      undoBtn.replaceChildren(
        createIconNode(doc, 'undo', 'stm-inline-svg'),
        el('span', '', steps > 0 ? `撤回修改 (可退 ${steps} 步)` : '撤回修改 (0)'),
      );
      const topSnap = undoStack.peek();
      undoBtn.title =
        steps > 0
          ? `撤回最近一次修改${topSnap?.presetName ? `（所属预设：${topSnap.presetName}）` : ''}`
          : '应用助手修改前会自动拍下快照，随时可在此一键悔棋还原';
    }

    if (clearBtn) {
      clearBtn.disabled = uiMessages.length === 0 && !session.isBusy();
      clearBtn.className = `stm-ghost-link${confirmClear ? ' is-confirm-warn' : ''}`;
      clearBtn.replaceChildren(
        createIconNode(doc, 'trash', 'stm-inline-svg'),
        el('span', '', confirmClear ? '确认清空?' : '清空对话'),
      );
    }

    if (sendOrStopBtn) {
      const busy = session.isBusy();
      if (busy) {
        sendOrStopBtn.className = 'stm-ast-send-btn is-stop';
        sendOrStopBtn.disabled = false;
        sendOrStopBtn.title = '立即停止本次生成';
        sendOrStopBtn.replaceChildren(
          createIconNode(doc, 'stop', 'stm-inline-svg'),
          el('span', '', '停止'),
        );
      } else {
        const hasText = Boolean((textareaEl?.value ?? draftInput).trim());
        sendOrStopBtn.className = 'stm-ast-send-btn';
        sendOrStopBtn.disabled = !hasText;
        sendOrStopBtn.title = '发送给伴侣助手 (Enter)';
        sendOrStopBtn.replaceChildren(
          createIconNode(doc, 'send', 'stm-inline-svg'),
          el('span', '', '发送'),
        );
      }
    }
  }

  function renderPlanCard(doc, msg) {
    const plan = msg.plan;
    if (!plan || (!plan.items.length && !plan.rejected.length)) return null;

    const card = el('div', `stm-ast-plan-card${msg.applied ? ' is-applied' : ''}`);

    if (plan.items.length > 0) {
      const cardHead = el('div', 'stm-ast-plan-head');
      const presetTag = msg.targetPresetName ? ` · ${msg.targetPresetName}` : '';
      const headTitle = el(
        'span',
        'stm-ast-plan-title',
        msg.applied
          ? `已应用预设修改${presetTag}（${msg.appliedCount} 项）`
          : `修改方案预览${presetTag}（共 ${plan.items.length} 项 · 可自由勾选）`,
      );
      cardHead.append(headTitle);

      if (!msg.applied && plan.items.length > 1) {
        const allChecked = plan.items.every(it => msg.selectedIds.has(it.opId));
        const toggleAllBtn = el('button', 'stm-reset-link', allChecked ? '取消全选' : '全选全部');
        toggleAllBtn.type = 'button';
        toggleAllBtn.addEventListener('click', () => {
          if (allChecked) {
            msg.selectedIds.clear();
          } else {
            for (const it of plan.items) msg.selectedIds.add(it.opId);
          }
          persistState();
          renderLogOnly({ stickBottom: false });
        });
        cardHead.append(toggleAllBtn);
      }

      card.append(cardHead);

      const listWrap = el('div', 'stm-ast-op-list');
      for (const item of plan.items) {
        const isChecked = msg.selectedIds.has(item.opId);
        const isDiffOpen = msg.expandedDiffIds.has(item.opId);

        const opBlock = el('div', `stm-ast-op-item${isChecked ? ' is-checked' : ' is-unchecked'}`);
        const opMain = el('div', 'stm-ast-op-row');

        const toggleItemCheck = () => {
          if (msg.applied) return;
          if (msg.selectedIds.has(item.opId)) {
            msg.selectedIds.delete(item.opId);
          } else {
            msg.selectedIds.add(item.opId);
          }
          persistState();
          renderLogOnly({ stickBottom: false });
        };

        // 复选框按钮
        const checkBtn = el('button', `stm-bind-checkbox stm-ast-op-check${isChecked ? ' is-checked' : ''}`);
        checkBtn.type = 'button';
        checkBtn.disabled = Boolean(msg.applied);
        checkBtn.setAttribute('aria-label', `勾选或取消：${item.typeLabel} ${item.targetName}`);
        if (isChecked) {
          checkBtn.innerHTML = svgMarkup('check');
        }
        checkBtn.addEventListener('click', toggleItemCheck);

        const infoCol = el('div', `stm-ast-op-info${msg.applied ? '' : ' is-interactive'}`);
        const titleLine = el('div', 'stm-ast-op-titleline');
        titleLine.append(
          el('span', `stm-ast-op-tag is-${item.type}`, item.typeLabel),
          el('strong', 'stm-ast-op-target', item.targetName),
        );
        infoCol.append(titleLine);

        if (item.summary) {
          infoCol.append(el('div', 'stm-ast-op-summary', item.summary));
        }
        if (item.downgradedNote) {
          infoCol.append(el('div', 'stm-ast-op-downgrade', item.downgradedNote));
        }
        if (!msg.applied) {
          infoCol.addEventListener('click', toggleItemCheck);
        }

        opMain.append(checkBtn, infoCol);

        if (item.canViewDiff) {
          const diffBtn = el('button', `stm-ast-diff-toggle${isDiffOpen ? ' is-open' : ''}`);
          diffBtn.type = 'button';
          diffBtn.append(
            el('span', '', isDiffOpen ? '收起对比 ▴' : '前后对比 ▾'),
          );
          diffBtn.addEventListener('click', () => {
            if (msg.expandedDiffIds.has(item.opId)) {
              msg.expandedDiffIds.delete(item.opId);
            } else {
              msg.expandedDiffIds.add(item.opId);
            }
            persistState();
            renderLogOnly({ stickBottom: false });
          });
          opMain.append(diffBtn);
        }

        opBlock.append(opMain);

        // 折叠展开：修改前 vs 修改后正文对比
        if (item.canViewDiff && isDiffOpen) {
          const diffWrap = el('div', 'stm-ast-diff-wrap');
          if (item.metaDiffSummary) {
            diffWrap.append(el('div', 'stm-ast-diff-meta', item.metaDiffSummary));
          }

          const diffCols = el('div', 'stm-ast-diff-grid');

          const beforeCol = el('div', 'stm-ast-diff-pane is-before');
          beforeCol.append(
            el(
              'div',
              'stm-ast-diff-label',
              item.type === 'add_entry'
                ? '修改前（原预设无此条目）'
                : item.type === 'upsert_regex' && !item.beforeContent
                  ? '修改前（原预设无此正则）'
                  : `修改前（${item.beforeContent.length} 字符）`,
            ),
            el(
              'pre',
              'stm-ast-diff-pre',
              item.type === 'add_entry'
                ? '（新建条目）'
                : item.type === 'upsert_regex' && !item.beforeContent
                  ? '（新增预设正则脚本）'
                  : item.beforeContent || '（空正文）',
            ),
          );

          const afterCol = el('div', 'stm-ast-diff-pane is-after');
          afterCol.append(
            el(
              'div',
              'stm-ast-diff-label',
              item.type === 'delete_entry'
                ? '修改后（将被移除）'
                : `修改后（${item.afterContent.length} 字符）`,
            ),
            el(
              'pre',
              'stm-ast-diff-pre',
              item.type === 'delete_entry' ? '（条目将被删除）' : item.afterContent || '（空正文）',
            ),
          );

          diffCols.append(beforeCol, afterCol);
          diffWrap.append(diffCols);
          opBlock.append(diffWrap);
        }

        listWrap.append(opBlock);
      }
      card.append(listWrap);

      const footBar = el('div', 'stm-ast-plan-foot');
      const selectedCount = plan.items.filter(it => msg.selectedIds.has(it.opId)).length;

      if (msg.applied) {
        const doneBtn = el(
          'button',
          'stm-ast-apply-btn is-done',
        );
        doneBtn.type = 'button';
        doneBtn.disabled = true;
        doneBtn.append(
          createIconNode(doc, 'check', 'stm-inline-svg'),
          el(
            'span',
            '',
            msg.appliedOnGuiPreset
              ? `已在内存中生效 ${msg.appliedCount} 项（默认预设未落盘）`
              : `已应用 ${msg.appliedCount} 项修改（可点上方「撤回修改」还原）`,
          ),
        );
        footBar.append(doneBtn);

        if (msg.appliedOnGuiPreset && getHostPresetState({ getContext, doc }).isGuiPreset) {
          const saveAsBtn = el('button', 'stm-ast-saveas-btn');
          saveAsBtn.type = 'button';
          saveAsBtn.title = '将当前修改后的默认预设保存为正式预设文件，防止刷新丢失';
          saveAsBtn.append(
            createIconNode(doc, 'copy', 'stm-inline-svg'),
            el('span', '', '另存为新预设'),
          );
          saveAsBtn.addEventListener('click', async () => {
            saveAsBtn.disabled = true;
            try {
              const saved = await duplicateHostPreset('', { getContext, selectDuplicate: true, doc });
              if (saved.ok) {
                msg.appliedOnGuiPreset = false;
                msg.targetPresetName = saved.name;
                persistState();
                toastMessage(`已保存并切换至新预设：${saved.name}`, 'success');
                renderLogOnly({ stickBottom: false });
                onAppliedOrUndone?.({
                  type: 'save_as',
                  result: {
                    ok: true,
                    isGuiPreset: false,
                    presetName: saved.name,
                    message: `已保存并启用新预设：${saved.name}`,
                  },
                });
              }
            } catch (err) {
              toastMessage(err?.message || '另存新预设失败', 'warning');
              saveAsBtn.disabled = false;
            }
          });
          footBar.append(saveAsBtn);
        }
      } else {
        const applyBtn = el('button', 'stm-ast-apply-btn');
        applyBtn.type = 'button';
        applyBtn.disabled = selectedCount === 0 || session.isBusy();
        applyBtn.append(
          createIconNode(doc, 'check', 'stm-inline-svg'),
          el('span', '', `应用已勾选修改 (${selectedCount} 项)`),
        );
        applyBtn.addEventListener('click', async () => {
          if (msg.applied || selectedCount === 0) return;
          applyBtn.disabled = true;
          const res = await applySelectedPresetOperations({
            previewItems: plan.items,
            selectedOpIds: msg.selectedIds,
            targetPresetName: msg.targetPresetName || '',
            targetIsGuiPreset: Boolean(msg.targetIsGuiPreset),
            turnId: msg.turnId || '',
            uiMsgId: msg.id || '',
            undoStack,
            getContext,
            autoSaver,
          });

          if (!res.ok) {
            toastMessage(res.message, 'warning');
            renderLogOnly({ stickBottom: false });
            return;
          }

          msg.applied = true;
          msg.appliedCount = res.appliedCount;
          msg.appliedOnGuiPreset = Boolean(res.isGuiPreset);
          if (msg.turnId) {
            session.markTurnApplied(msg.turnId, `用户已采纳并应用 ${res.appliedCount} 项修改`);
          }
          persistState();
          toastMessage(
            res.isGuiPreset
              ? res.message
              : `${res.message}（可随时点击「撤回修改」悔棋）`,
            res.isGuiPreset ? 'info' : 'success',
          );
          syncToolbarStatus();
          renderLogOnly({ stickBottom: false });
          onAppliedOrUndone?.({ type: 'apply', result: res });
        });
        footBar.append(applyBtn);
      }

      card.append(footBar);
    }

    if (plan.rejected.length > 0) {
      const rejectNote = el(
        'div',
        'stm-ast-reject-note',
        `安全护栏已自动跳过 ${plan.rejected.length} 项无效或受保护操作：${plan.rejected.map(r => r.reason).join('；')}`,
      );
      card.append(rejectNote);
    }

    return card;
  }

  function renderLogOnly({ stickBottom = true } = {}) {
    const doc = globalThis.document;
    if (!doc || !logEl) return;

    const prevScroll = logEl.scrollTop;
    logEl.replaceChildren();

    if (uiMessages.length === 0) {
      const emptyBox = el('div', 'stm-ast-welcome');
      emptyBox.append(
        el(
          'div',
          'stm-ast-welcome-title',
          '自动感知当前预设全部条目、发送顺序与核心参数',
        ),
        el(
          'div',
          'stm-ast-welcome-sub',
          '点上方快捷胶囊或直接描述需求 · 所有改动均先展示前后对比预览，支持逐项勾选采纳与多步一键撤回。',
        ),
      );
      logEl.append(emptyBox);
      return;
    }

    for (const msg of uiMessages) {
      const row = el(
        'div',
        `stm-ast-msg is-${msg.role}${msg.isError ? ' is-error' : ''}${msg.isPending ? ' is-pending' : ''}`,
      );

      const bubble = el('div', 'stm-ast-bubble');
      if (msg.isPending) {
        const loadingLine = el('div', 'stm-ast-loading-line');
        const pendingSpan = el('span', 'stm-ast-pending-text', msg.text || '正在读取当前预设并分析方案…');
        if (msg.id) {
          pendingSpan.dataset.stmPendingId = msg.id;
        }
        loadingLine.append(el('span', 'stm-ast-pulse-dot'), pendingSpan);
        bubble.append(loadingLine);
      } else {
        bubble.append(el('div', 'stm-ast-reply-text', msg.text));
      }
      row.append(bubble);

      if (msg.role === 'assistant' && msg.plan && !msg.isPending) {
        const planNode = renderPlanCard(doc, msg);
        if (planNode) {
          row.append(planNode);
        }
      }

      logEl.append(row);
    }

    if (stickBottom) {
      scrollToLogBottom();
    } else {
      logEl.scrollTop = prevScroll;
    }
  }

  async function handleSendPrompt(explicitText = null) {
    if (session.isBusy()) return;
    const promptText = String(explicitText !== null ? explicitText : textareaEl?.value ?? draftInput).trim();
    if (!promptText) return;

    confirmClear = false;
    draftInput = '';
    if (textareaEl) {
      textareaEl.value = '';
      autoResizeInput();
    }

    const originHostState = getHostPresetState({ getContext });
    const originPresetName = originHostState.activePreset || '';
    const originIsGuiPreset = Boolean(originHostState.isGuiPreset);
    const originOaiSnapshot = structuredClone(getContext?.()?.chatCompletionSettings || {});

    const pendingAssistantMsg = {
      id: `ui_${Date.now()}_a`,
      role: 'assistant',
      text: '正在读取当前预设并生成方案…',
      isPending: true,
      isError: false,
      plan: null,
      targetPresetName: originPresetName,
      targetIsGuiPreset: originIsGuiPreset,
    };

    uiMessages.push(
      {
        id: `ui_${Date.now()}_u`,
        role: 'user',
        text: promptText,
        isPending: false,
        isError: false,
      },
      pendingAssistantMsg,
    );

    renderLogOnly({ stickBottom: true });
    syncToolbarStatus();

    let lastProgressAt = 0;
    const onProgress = ({ textChars = 0, reasoningChars = 0 } = {}) => {
      if (destroyed || !pendingAssistantMsg.isPending) return;
      const now = Date.now();
      if (now - lastProgressAt < 180) return;
      lastProgressAt = now;
      const nextText =
        textChars > 0
          ? `正在流式接收方案…（已接收 ${textChars} 字）`
          : reasoningChars > 0
            ? `正在思考分析中…（已推理 ${reasoningChars} 字）`
            : pendingAssistantMsg.text;
      if (nextText === pendingAssistantMsg.text) return;
      pendingAssistantMsg.text = nextText;
      const pendingNode = logEl?.querySelector?.(`.stm-ast-pending-text[data-stm-pending-id="${pendingAssistantMsg.id}"]`);
      if (pendingNode) {
        pendingNode.textContent = nextText;
      }
    };

    const res = await session.send(promptText, { onProgress });
    if (destroyed) return;

    if (!res.ok) {
      pendingAssistantMsg.isPending = false;
      pendingAssistantMsg.isError = !res.aborted;
      pendingAssistantMsg.text = res.message || '请求未成功';
      persistState();
      renderLogOnly({ stickBottom: true });
      syncToolbarStatus();
      return;
    }

    const currentHostState = getHostPresetState({ getContext });
    const oaiForValidation =
      originPresetName && currentHostState.activePreset !== originPresetName
        ? originOaiSnapshot
        : getContext?.()?.chatCompletionSettings || originOaiSnapshot;
    const validatedPlan =
      Array.isArray(res.operations) && res.operations.length > 0
        ? validateAndPreviewPresetOperations(res.operations, oaiForValidation)
        : { items: [], rejected: [] };

    pendingAssistantMsg.isPending = false;
    pendingAssistantMsg.turnId = res.turnId;
    pendingAssistantMsg.text = res.reply || '已完成分析。';
    pendingAssistantMsg.plan = validatedPlan;
    pendingAssistantMsg.selectedIds = new Set(validatedPlan.items.map(it => it.opId));
    pendingAssistantMsg.expandedDiffIds = new Set(
      validatedPlan.items.length === 1 && validatedPlan.items[0].canViewDiff
        ? [validatedPlan.items[0].opId]
        : [],
    );
    pendingAssistantMsg.applied = false;
    pendingAssistantMsg.appliedCount = 0;

    if (uiMessages.length > MAX_PERSISTED_ASSISTANT_ROUNDS * 2) {
      uiMessages = uiMessages.slice(-MAX_PERSISTED_ASSISTANT_ROUNDS * 2);
    }
    persistState();

    renderLogOnly({ stickBottom: true });
    syncToolbarStatus();
    if (validatedPlan.items.length > 0 && (!rootEl?.isConnected || rootEl.closest?.('[hidden]'))) {
      toastMessage('伴侣助手已生成预设方案，打开预设馆即可查看应用', 'info');
    }
  }

  async function handleUndoClick() {
    if (session.isBusy() || undoStack.size() === 0) return;
    const res = await undoLastPresetOperation({
      undoStack,
      getContext,
      autoSaver,
    });
    if (destroyed) return;

    if (res.ok) {
      if (res.undoneUiMsgId) {
        const hitMsg = uiMessages.find(m => m && m.id === res.undoneUiMsgId);
        if (hitMsg) {
          hitMsg.applied = false;
          hitMsg.appliedOnGuiPreset = false;
        }
      }
      if (res.undoneTurnId) {
        session.markTurnApplied(res.undoneTurnId, '用户已撤回本轮修改');
      }
      persistState();
      renderLogOnly({ stickBottom: false });
    }

    toastMessage(res.message, res.ok ? 'success' : 'warning');
    syncToolbarStatus();
    if (res.ok) {
      onAppliedOrUndone?.({ type: 'undo', result: res });
    }
  }

  function ensureElement() {
    const doc = globalThis.document;
    if (!doc) return null;
    if (rootEl) {
      syncToolbarStatus();
      return rootEl;
    }

    rootEl = el('section', 'stm-dock-section stm-ast-panel');

    // 1. 顶部栏：标题 + 当前通道状态徽章 + 撤回修改(可退 N 步) + 清空对话 + 收起
    const headRow = el('div', 'stm-ast-head');
    const headLeft = el('div', 'stm-ast-head-left');
    headLeft.append(
      createIconNode(doc, 'spark', 'stm-ast-brand-icon'),
      el('span', 'stm-sec-title', '伴侣助手'),
    );

    channelBadgeBtn = el('button', 'stm-ast-channel-badge');
    channelBadgeBtn.type = 'button';
    channelBadgeBtn.addEventListener('click', () => {
      onOpenApiDock?.();
    });
    headLeft.append(channelBadgeBtn);

    const headRight = el('div', 'stm-ast-head-right');

    undoBtn = el('button', 'stm-ast-undo-btn');
    undoBtn.type = 'button';
    undoBtn.addEventListener('click', () => {
      void handleUndoClick();
    });

    clearBtn = el('button', 'stm-ghost-link');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', () => {
      if (uiMessages.length === 0 && !session.isBusy()) return;
      if (!confirmClear) {
        confirmClear = true;
        syncToolbarStatus();
        return;
      }
      confirmClear = false;
      session.clearHistory();
      uiMessages = [];
      draftInput = '';
      if (textareaEl) {
        textareaEl.value = '';
        autoResizeInput();
      }
      clearPersistedState();
      renderLogOnly({ stickBottom: false });
      syncToolbarStatus();
    });

    const collapseBtn = el('button', 'stm-reset-link', '收起 ▴');
    collapseBtn.type = 'button';
    collapseBtn.addEventListener('click', () => {
      onRequestCollapse?.();
    });

    headRight.append(undoBtn, clearBtn, collapseBtn);
    headRow.append(headLeft, headRight);
    rootEl.append(headRow);

    // 2. 4 枚快捷灵感胶囊
    const quickBar = el('div', 'stm-ast-quick-bar');
    for (const promptChipText of PRESET_ASSISTANT_QUICK_PROMPTS) {
      const chipBtn = el('button', 'stm-ast-quick-chip', promptChipText);
      chipBtn.type = 'button';
      chipBtn.title = '点击填入下方输入框（可直接回车发送，或补充具体偏好后再发）';
      chipBtn.addEventListener('click', () => {
        if (!textareaEl) return;
        draftInput = promptChipText;
        textareaEl.value = promptChipText;
        persistState();
        autoResizeInput();
        syncToolbarStatus();
        textareaEl.focus();
        textareaEl.setSelectionRange?.(promptChipText.length, promptChipText.length);
      });
      quickBar.append(chipBtn);
    }
    rootEl.append(quickBar);

    // 3. 对话与修改预览卡片滚动区
    logEl = el('div', 'stm-ast-log');
    rootEl.append(logEl);
    renderLogOnly({ stickBottom: false });

    // 4. 底部自适应输入与发送/停止栏
    const composer = el('div', 'stm-ast-composer');
    textareaEl = el('textarea', 'stm-ast-input');
    textareaEl.rows = 1;
    textareaEl.placeholder = '输入想调整的预设规则或问题（Enter 发送，Shift+Enter 换行）…';
    textareaEl.value = draftInput;

    textareaEl.addEventListener('input', () => {
      draftInput = textareaEl.value;
      if (confirmClear) confirmClear = false;
      persistState();
      autoResizeInput();
      syncToolbarStatus();
    });

    textareaEl.addEventListener('keydown', evt => {
      if (
        evt.key === 'Enter' &&
        !evt.shiftKey &&
        !evt.isComposing &&
        evt.keyCode !== 229
      ) {
        // 仅在非窄屏触控或桌面键盘回车时快捷发送
        const isNarrowMobile =
          typeof globalThis.window?.innerWidth === 'number' && globalThis.window.innerWidth <= 640;
        if (!isNarrowMobile) {
          evt.preventDefault();
          void handleSendPrompt();
        }
      }
    });

    sendOrStopBtn = el('button', 'stm-ast-send-btn');
    sendOrStopBtn.type = 'button';
    sendOrStopBtn.addEventListener('click', () => {
      if (session.isBusy()) {
        session.abort();
        syncToolbarStatus();
      } else {
        void handleSendPrompt();
      }
    });

    composer.append(textareaEl, sendOrStopBtn);
    rootEl.append(composer);

    syncToolbarStatus();
    return rootEl;
  }

  return {
    getElement: ensureElement,
    syncStatus: syncToolbarStatus,
    getScrollTop: () => (logEl ? logEl.scrollTop : 0),
    setScrollTop(val) {
      if (logEl && Number.isFinite(val)) {
        logEl.scrollTop = val;
      }
    },
    focusInput() {
      ensureElement();
      setTimeout(() => {
        textareaEl?.focus();
      }, 20);
    },
    isBusy: () => session.isBusy(),
    getUndoCount: () => undoStack.size(),
    getMessageCount: () => uiMessages.filter(m => m && !m.isPending).length,
    hasPendingPlan: () =>
      uiMessages.some(
        m =>
          m &&
          m.role === 'assistant' &&
          !m.isPending &&
          !m.applied &&
          Array.isArray(m.plan?.items) &&
          m.plan.items.length > 0,
      ),
    abort() {
      const didAbort = session.abort();
      if (didAbort) {
        syncToolbarStatus();
      }
      return didAbort;
    },
    destroy() {
      destroyed = true;
      session.clearHistory();
      undoStack.clear();
      uiMessages = [];
      draftInput = '';
      rootEl?.remove();
      rootEl = null;
      channelBadgeBtn = null;
      undoBtn = null;
      clearBtn = null;
      logEl = null;
      textareaEl = null;
      sendOrStopBtn = null;
    },
  };
}
