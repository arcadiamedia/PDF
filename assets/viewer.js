import EmbedPDF, { ZoomMode } from '../vendor/embedpdf/embedpdf.js';
import { ID_PATTERN, pagesUrl, rawUrl } from './common.js';

// 最大放大倍数（1 = 100%）。分块渲染只画屏幕可见部分，放多大都不会卡
const MAX_ZOOM = 200;

// 点“放大”按钮时每一档的步长；双指缩放不受影响
const ZOOM_RANGES = [
  { min: 0.2, max: 0.5, step: 0.05 },
  { min: 0.5, max: 1, step: 0.1 },
  { min: 1, max: 2, step: 0.2 },
  { min: 2, max: 4, step: 0.4 },
  { min: 4, max: 10, step: 0.8 },
  { min: 10, max: 20, step: 1.6 },
  { min: 20, max: 40, step: 3.2 },
  { min: 40, max: 80, step: 6.4 },
  { min: 80, max: 160, step: 12.8 },
  { min: 160, max: MAX_ZOOM, step: 20 },
];

// 只看不改：去掉批注、表单、签名、涂黑等编辑功能
const DISABLED = [
  'annotation',
  'annotation-shape',
  'form',
  'redaction',
  'insert',
  'history',
  'capture',
  'panel-comment',
  'document-open',
  'document-close',
  'document-protect',
  'document-capture',
];

const zh = /^zh/i.test(navigator.language);
const TEXT = zh
  ? {
      badLink: '链接不完整，请向分享者重新索取。',
      notFound: '文件不存在，可能已被删除。',
    }
  : {
      badLink: 'This link is incomplete. Please ask the sender for a new one.',
      notFound: 'File not found. It may have been deleted.',
    };

const viewerEl = document.getElementById('viewer');
const msgEl = document.getElementById('msg');

function showMessage(text) {
  viewerEl.hidden = true;
  msgEl.textContent = text;
  msgEl.hidden = false;
}

// 按浏览器语言选查看器界面语言
function pickLocale() {
  const lang = (navigator.language || 'en').toLowerCase();
  if (lang.startsWith('zh')) return /-(tw|hk|mo)|hant/.test(lang) ? 'zh-TW' : 'zh-CN';
  if (lang.startsWith('pt')) return 'pt-BR';
  return ['de', 'es', 'fr', 'ja', 'nl', 'sv'].find((code) => lang.startsWith(code)) || 'en';
}

async function exists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

// 刚上传的文件要等 GitHub Pages 部署完（1～2 分钟）才能访问，这之前改从 GitHub 原始文件地址读取
async function locate(path) {
  for (const url of [pagesUrl(path), rawUrl(path)]) {
    if (await exists(url)) return url;
  }
  return null;
}

async function fetchName(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const meta = await res.json();
    return typeof meta.name === 'string' ? meta.name : null;
  } catch {
    return null;
  }
}

async function main() {
  const id = new URLSearchParams(location.search).get('id') || '';
  if (!ID_PATTERN.test(id)) return showMessage(TEXT.badLink);

  const src = await locate(`files/${id}.pdf`);
  if (!src) return showMessage(TEXT.notFound);

  const name = await fetchName(src.replace(/\.pdf$/, '.json'));
  if (name) document.title = name;

  EmbedPDF.init({
    type: 'container',
    target: viewerEl,
    src,
    // PDF 引擎在 Web Worker 里加载 wasm，只能用绝对地址
    wasmUrl: new URL('../vendor/embedpdf/pdfium.wasm', import.meta.url).href,
    tabBar: 'never',
    theme: { preference: 'system' },
    fonts: { ui: null, signature: null },
    i18n: { defaultLocale: pickLocale() },
    zoom: {
      defaultZoomLevel: ZoomMode.FitWidth,
      maxZoom: MAX_ZOOM,
      zoomRanges: ZOOM_RANGES,
    },
    export: { defaultFileName: name || `${id}.pdf` },
    stamp: { manifests: [] }, // 不加载在线图章库（批注已隐藏，用不到）
    disabledCategories: DISABLED,
  });
}

// iOS Safari 会忽略 user-scalable=no，这里阻止它缩放整个网页
document.addEventListener('gesturestart', (e) => e.preventDefault());

main();
