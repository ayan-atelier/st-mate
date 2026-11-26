/**
 * ST伴侣 (st-mate) · 极简纯色细线图标系统
 * 设计准则：统一 24x24 视口、1.5px 纤细笔触、纯 currentColor 单色线条、零实心色块与零彩色 Emoji 污染。
 * 键名规范：统一采用纯小写英文字母 (/^[a-z]+$/)。
 */

const BASE_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const PATHS = Object.freeze({
  back: '<path d="M15 18l-6-6 6-6"/>',
  bolt: '<path d="M13 2.5L5.5 13h6L10.5 21.5 18.5 11h-6L13 2.5z"/>',
  plug:
    '<line x1="9" y1="3" x2="9" y2="7.5"/><line x1="15" y1="3" x2="15" y2="7.5"/>' +
    '<path d="M6.5 7.5h11v3.8a5.5 5.5 0 0 1-11 0V7.5z"/><line x1="12" y1="16.8" x2="12" y2="21"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5.2 19.8c1.5-3.1 4-4.6 6.8-4.6s5.3 1.5 6.8 4.6"/>',
  // 克制纤细的双轨调校滑杆（替代沉重扎眼的实心齿轮，用于书架右上角「设置」与顶栏「伴侣设置」）
  settings:
    '<line x1="4" y1="8" x2="10" y2="8"/><line x1="14" y1="8" x2="20" y2="8"/><circle cx="12" cy="8" r="2"/>' +
    '<line x1="4" y1="16" x2="8" y2="16"/><line x1="12" y1="16" x2="20" y2="16"/><circle cx="10" cy="16" r="2"/>',
  sliders:
    '<line x1="4" y1="6" x2="13" y2="6"/><line x1="17" y1="6" x2="20" y2="6"/><circle cx="15" cy="6" r="2"/>' +
    '<line x1="4" y1="12" x2="7" y2="12"/><line x1="11" y1="12" x2="20" y2="12"/><circle cx="9" cy="12" r="2"/>' +
    '<line x1="4" y1="18" x2="14" y2="18"/><line x1="18" y1="18" x2="20" y2="18"/><circle cx="16" cy="18" r="2"/>',
  book: '<path d="M2.5 5h6a3.5 3.5 0 0 1 3.5 3.5v11a2.8 2.8 0 0 0-2.8-2.8H2.5z"/><path d="M21.5 5h-6A3.5 3.5 0 0 0 12 8.5v11a2.8 2.8 0 0 1 2.8-2.8h6.7z"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeoff:
    '<path d="M17.9 17.9A10.1 10.1 0 0 1 12 19c-6 0-9.5-7-9.5-7a18.2 18.2 0 0 1 4.8-5.3"/>' +
    '<path d="M10.3 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a18.3 18.3 0 0 1-2.2 3.3"/>' +
    '<line x1="3.5" y1="3.5" x2="20.5" y2="20.5"/>',
  layers: '<path d="M12 3.5L3 8l9 4.5L21 8l-9-4.5z"/><path d="M3 12.5l9 4.5 9-4.5"/><path d="M3 17l9 4.5 9-4.5"/>',
  home: '<path d="M4 10.5L12 4l8 6.5"/><path d="M6.5 9.5V19a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5"/>',
  shelf: '<rect x="4" y="4" width="4.5" height="16" rx="1"/><rect x="10" y="4" width="4.5" height="16" rx="1"/><path d="M16.2 4.4l3.6 15.2"/>',
  branch: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="8" r="2.2"/><circle cx="6" cy="18" r="2.2"/><path d="M6 8.2v7.6"/><path d="M18 10.2c0 4-4.5 4.5-12 5.6"/>',
  memory: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.8 2"/>',
  spark: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2-5.2-1.8 5.2-1.8L12 3.5z"/><path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
  chat: '<path d="M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8.5z"/>',
  fold: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="15" y2="12"/><line x1="4" y1="17" x2="11" y2="17"/>',
  bars: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
  palette: '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10" r="1"/><circle cx="12.5" cy="8.5" r="1"/><circle cx="15.5" cy="11" r="1"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.8" cy="9.5" r="1.4"/><path d="M20.5 16l-4.8-4.5L7 19.5"/>',
  code: '<polyline points="8.5 8 4 12 8.5 16"/><polyline points="15.5 8 20 12 15.5 16"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v3.5h3.5"/><path d="M4 13a8 8 0 0 0 14.6 4.5M20 20v-3.5h-3.5"/>',
  zap: '<path d="M13 2.5L5.2 13.2h6.1L10.4 21.5 18.8 10.8h-6.1L13 2.5z"/>',
  typography:
    '<path d="M3.8 18.5L8 6l4.2 12.5"/><line x1="5.3" y1="14.2" x2="10.7" y2="14.2"/>' +
    '<path d="M15 11.6a2.6 2.6 0 0 1 4.8 1.4v5.5"/><path d="M19.8 14.9h-2.7a2 2 0 0 0 0 3.6h2.7"/>',
  sun:
    '<circle cx="12" cy="12" r="3.8"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/>' +
    '<line x1="5.6" y1="5.6" x2="7" y2="7"/><line x1="17" y1="17" x2="18.4" y2="18.4"/>' +
    '<line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/>' +
    '<line x1="5.6" y1="18.4" x2="7" y2="17"/><line x1="17" y1="7" x2="18.4" y2="5.6"/>',
  upload:
    '<path d="M12 15.5V4.5"/><polyline points="7.5 9 12 4.5 16.5 9"/>' +
    '<path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
  download:
    '<path d="M12 4.5v11"/><polyline points="7.5 11 12 15.5 16.5 11"/>' +
    '<path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
  link:
    '<path d="M10 13a4.5 4.5 0 0 0 6.4.4l2.2-2.2a4.5 4.5 0 0 0-6.4-6.4L10.9 6"/>' +
    '<path d="M14 11a4.5 4.5 0 0 0-6.4-.4l-2.2 2.2a4.5 4.5 0 0 0 6.4 6.4L13.1 18"/>',
  tavern:
    '<path d="M5.5 9a2 2 0 0 1 1.7-3 2.6 2.6 0 0 1 4.8-.6A2.3 2.3 0 0 1 16.5 7.5 1.8 1.8 0 0 1 16 9"/>' +
    '<path d="M6 9h10v9a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 6 18V9z"/>' +
    '<path d="M16 10.5h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2"/>' +
    '<line x1="9.5" y1="12" x2="9.5" y2="17.5"/><line x1="12.5" y1="12" x2="12.5" y2="17.5"/>',
  star: '<polygon points="12 3.2 14.7 8.7 20.8 9.6 16.4 13.9 17.4 20 12 17.1 6.6 20 7.6 13.9 3.2 9.6 9.3 8.7 12 3.2"/>',
  heart:
    '<path d="M12 20.2s-7-4.4-8.8-8.7A5.1 5.1 0 0 1 12 6.3a5.1 5.1 0 0 1 8.8 5.2c-1.8 4.3-8.8 8.7-8.8 8.7z"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash:
    '<polyline points="4.5 6.5 19.5 6.5"/>' +
    '<path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"/>' +
    '<path d="M6.8 6.5l.8 12.2a1.8 1.8 0 0 0 1.8 1.7h5.2a1.8 1.8 0 0 0 1.8-1.7l.8-12.2"/>' +
    '<line x1="10.2" y1="10.8" x2="10.2" y2="16.5"/><line x1="13.8" y1="10.8" x2="13.8" y2="16.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><line x1="15.8" y1="15.8" x2="20.2" y2="20.2"/>',
  check: '<polyline points="4.5 12.5 9.5 17.5 19.5 6.8"/>',
  copy:
    '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/>' +
    '<path d="M5.5 15.5h-1a1.5 1.5 0 0 1-1.5-1.5V5a2 2 0 0 1 2-2h9a1.5 1.5 0 0 1 1.5 1.5v1"/>',
  key:
    '<circle cx="8" cy="15" r="4"/><path d="M10.9 12.1L19.5 3.5"/>' +
    '<path d="M16 7l2.5 2.5"/><path d="M18.5 4.5L21 7"/>',
  archive:
    '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/>' +
    '<path d="M5 9v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V9"/>' +
    '<line x1="10" y1="13.5" x2="14" y2="13.5"/>',
  pin:
    '<path d="M9 4.5h6l-1 5.2 2.8 2.8v1.5H7.2v-1.5L10 9.7 9 4.5z"/>' +
    '<line x1="12" y1="14" x2="12" y2="20"/>',
  flag:
    '<path d="M5.5 20.5V4.5"/><path d="M5.5 5h12l-2.3 4.5L17.5 14h-12"/>',
  unlink:
    '<path d="M14.5 6.5l1.8-1.8a3.8 3.8 0 0 1 5.4 5.4l-1.8 1.8"/>' +
    '<path d="M9.5 17.5l-1.8 1.8a3.8 3.8 0 0 1-5.4-5.4l1.8-1.8"/>' +
    '<line x1="4" y1="4" x2="20" y2="20"/>',
  arrowup: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="6.5 10.5 12 5 17.5 10.5"/>',
  arrowdown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="6.5 13.5 12 19 17.5 13.5"/>',
  chevronup: '<polyline points="6.5 14.5 12 9 17.5 14.5"/>',
  more: '<circle cx="6.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17.5" cy="12" r="1"/>',
  topjump: '<line x1="6.5" y1="6.5" x2="17.5" y2="6.5"/><polyline points="6.5 16 12 10.5 17.5 16"/>',
  bottomjump: '<line x1="6.5" y1="17.5" x2="17.5" y2="17.5"/><polyline points="6.5 8 12 13.5 17.5 8"/>',
  capsule:
    '<rect x="7" y="2.8" width="10" height="18.4" rx="5"/>' +
    '<polyline points="10.2 7.8 12 6 13.8 7.8"/>' +
    '<circle cx="12" cy="12" r="1.2"/>' +
    '<polyline points="10.2 16.2 12 18 13.8 16.2"/>',
  moon: '<path d="M20.2 14.8A8.5 8.5 0 0 1 9.2 3.8a8.5 8.5 0 1 0 11 11z"/>',
  edit: '<path d="M15.8 4.2a2.1 2.1 0 0 1 3 3L8 18l-4.2 1.2L5 15l10.8-10.8z"/>',
  file:
    '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L14 3.5z"/>' +
    '<polyline points="14 3.5 14 8.5 19 8.5"/>',
  chevron: '<polyline points="6.5 9.5 12 15 17.5 9.5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  send: '<line x1="21" y1="3" x2="10" y2="14"/><polygon points="21 3 14.5 21 10 14 3 9.5 21 3"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  close: '<line x1="6.5" y1="6.5" x2="17.5" y2="17.5"/><line x1="17.5" y1="6.5" x2="6.5" y2="17.5"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/>' +
    '<path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18z"/>',
  idcard:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.8" r="2.1"/>' +
    '<path d="M5.8 16.2c.7-1.4 1.7-2 2.7-2s2 .6 2.7 2"/>' +
    '<line x1="13.5" y1="9.5" x2="18" y2="9.5"/><line x1="13.5" y1="13.5" x2="17" y2="13.5"/>',
  users:
    '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c1.2-2.6 3.2-3.8 5.5-3.8s4.3 1.2 5.5 3.8"/>' +
    '<circle cx="16.5" cy="9.5" r="2.3"/><path d="M15.5 15.5c1.8.2 3.3 1.3 4.2 3.5"/>',
  alert:
    '<path d="M10.3 4.2L2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/>' +
    '<line x1="12" y1="9.5" x2="12" y2="13.8"/><line x1="12" y1="17" x2="12.02" y2="17"/>',
  help:
    '<circle cx="12" cy="12" r="8.8"/>' +
    '<path d="M9.6 9.4a2.4 2.4 0 0 1 4.7.8c0 1.5-2.3 2-2.3 3.3"/>' +
    '<line x1="12" y1="16.8" x2="12.01" y2="16.8"/>',
  maximize:
    '<polyline points="15 4 20 4 20 9"/><polyline points="9 20 4 20 4 15"/>' +
    '<line x1="20" y1="4" x2="14" y2="10"/><line x1="4" y1="20" x2="10" y2="14"/>',
});

export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

export function svgMarkup(name) {
  const inner = PATHS[name] || PATHS.settings;
  return `<svg ${BASE_ATTRS}>${inner}</svg>`;
}

export function createIconNode(doc, name, className = 'stm-icon') {
  const wrap = doc.createElement('span');
  wrap.className = className;
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = svgMarkup(name);
  return wrap;
}
