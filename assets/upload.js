import { OWNER, REPO, BRANCH } from './config.js';
import { shareLink } from './common.js';

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const TOKEN_KEY = 'pdf-share-token';
const INDEX_PATH = 'files/index.json';
const MAX_SIZE = 100 * 1024 * 1024; // GitHub 单个文件上限

// 创建令牌的链接：预填名称、只给 Contents 读写权限
const TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?' +
  new URLSearchParams({
    name: 'PDF share upload',
    description: `Upload PDFs to ${OWNER}/${REPO}`,
    target_name: OWNER,
    expires_in: '365',
    contents: 'write',
  });

const $ = (id) => document.getElementById(id);

let token = readToken();
let index = { files: [] };
let busy = false;

class ApiError extends Error {
  constructor(status, body) {
    let message = body || '';
    try {
      message = JSON.parse(body).message || message;
    } catch {}
    super(message);
    this.status = status;
  }
}

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function writeToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function explain(err) {
  if (!(err instanceof ApiError)) return err.message || String(err);
  switch (err.status) {
    case 0:
      return '网络错误，请检查网络后重试。';
    case 401:
      return '令牌无效或已过期，请重新填写。';
    case 403:
      return /rate limit/i.test(err.message)
        ? 'GitHub 接口调用太频繁，请稍后再试。'
        : '令牌权限不足：需要对这个仓库的 Contents 读写权限。';
    case 404:
      return `找不到仓库 ${OWNER}/${REPO}：令牌可能没有授权这个仓库。`;
    case 409:
      return '仓库还是空的，请先把网站代码推送上去。';
    case 413:
      return '文件太大，GitHub 拒绝接收。';
    default:
      return `GitHub 返回错误 ${err.status}${err.message ? `：${err.message}` : ''}`;
  }
}

async function api(method, path, body, accept = 'application/vnd.github+json') {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, '');
  }
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return accept.includes('raw') ? res.text() : res.json();
}

async function readIndex(ref) {
  try {
    const data = JSON.parse(await api('GET', `/contents/${INDEX_PATH}?ref=${ref}`, null, 'application/vnd.github.raw+json'));
    return Array.isArray(data.files) ? data : { files: [] };
  } catch (err) {
    if (err.status === 404) return { files: [] };
    throw err;
  }
}

// 一次提交里写入/删除文件并更新 index.json；分支被别处抢先更新时重试
async function commit(message, { write = [], remove = [], update }) {
  for (let attempt = 1; ; attempt++) {
    const head = (await api('GET', `/git/ref/heads/${BRANCH}`)).object.sha;
    const baseTree = (await api('GET', `/git/commits/${head}`)).tree.sha;
    const next = await readIndex(head);
    update(next);

    let existing = new Set();
    if (remove.length) {
      const listing = await api('GET', `/contents/files?ref=${head}`);
      existing = new Set(listing.map((item) => item.path));
    }

    const tree = [
      ...write.map(({ path, sha, content }) => ({ path, mode: '100644', type: 'blob', ...(sha ? { sha } : { content }) })),
      ...remove.filter((path) => existing.has(path)).map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
      { path: INDEX_PATH, mode: '100644', type: 'blob', content: JSON.stringify(next, null, 2) + '\n' },
    ];
    const newTree = await api('POST', '/git/trees', { base_tree: baseTree, tree });
    const newCommit = await api('POST', '/git/commits', { message, tree: newTree.sha, parents: [head] });
    try {
      await api('PATCH', `/git/refs/heads/${BRANCH}`, { sha: newCommit.sha });
      index = next;
      return;
    } catch (err) {
      if (err.status !== 422 || attempt >= 3) throw err;
    }
  }
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// 分块转 base64，避免大文件一次占用太多内存；块大小是 3 的倍数，拼起来仍是完整的 base64
async function base64Json(file) {
  const CHUNK = 3 * 1024 * 1024;
  const parts = ['{"encoding":"base64","content":"'];
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    parts.push(await toBase64(file.slice(offset, offset + CHUNK)));
  }
  parts.push('"}');
  return new Blob(parts, { type: 'application/json' });
}

// 用 XHR 而不是 fetch，是为了拿到上传进度
async function uploadBlob(file, onProgress) {
  const body = await base64Json(file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/git/blobs`);
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status === 201 ? resolve(JSON.parse(xhr.responseText).sha) : reject(new ApiError(xhr.status, xhr.responseText));
    xhr.onerror = () => reject(new ApiError(0, ''));
    xhr.send(body);
  });
}

async function isPdf(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return new TextDecoder('latin1').decode(head).includes('%PDF-');
}

function newId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => chars[b % chars.length]).join('');
}

async function uploadOne(file, label) {
  if (file.size > MAX_SIZE) throw new Error(`“${file.name}”超过 100 MB，GitHub 不接收。`);
  if (!(await isPdf(file))) throw new Error(`“${file.name}”不是 PDF 文件。`);

  const id = newId();
  showProgress(`${label}正在上传“${file.name}”`, 0);
  const sha = await uploadBlob(file, (p) => showProgress(`${label}正在上传“${file.name}”`, p));
  showProgress(`${label}正在保存“${file.name}”`, 1);

  const meta = { name: file.name, size: file.size, uploadedAt: new Date().toISOString() };
  await commit(`上传 ${file.name}`, {
    write: [
      { path: `files/${id}.pdf`, sha },
      { path: `files/${id}.json`, content: JSON.stringify(meta) + '\n' },
    ],
    update: (next) => next.files.unshift({ id, ...meta }),
  });
  return { id, ...meta };
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length || busy) return;
  setBusy(true);
  hide('upload-error');
  try {
    for (const [i, file] of files.entries()) {
      const label = files.length > 1 ? `（${i + 1}/${files.length}）` : '';
      try {
        const uploaded = await uploadOne(file, label);
        $('results').prepend(resultItem(uploaded));
        renderList();
      } catch (err) {
        fail('upload-error', err);
        if (err instanceof ApiError) break; // GitHub 出错时，后面的文件多半也会失败
      }
    }
  } finally {
    hide('progress');
    setBusy(false);
  }
}

async function removeFile(file, button) {
  if (busy || !confirm(`确定删除“${file.name}”吗？删除后分享链接会失效。`)) return;
  setBusy(true);
  button.textContent = '删除中…';
  hide('list-error');
  try {
    await commit(`删除 ${file.name}`, {
      remove: [`files/${file.id}.pdf`, `files/${file.id}.json`],
      update: (next) => {
        next.files = next.files.filter((f) => f.id !== file.id);
      },
    });
    renderList();
  } catch (err) {
    button.textContent = '删除';
    fail('list-error', err);
  } finally {
    setBusy(false);
  }
}

// —— 界面 ——

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function hide(id) {
  $(id).hidden = true;
}

function showError(id, text) {
  $(id).textContent = text;
  $(id).hidden = false;
}

// 令牌失效（401）时直接回到填写令牌的界面
function fail(id, err) {
  if (err.status === 401) {
    token = '';
    writeToken('');
    showTokenForm();
    id = 'token-error';
  }
  showError(id, explain(err));
}

function showProgress(text, ratio) {
  $('progress').hidden = false;
  $('progress-text').textContent = `${text}… ${Math.round(ratio * 100)}%`;
  $('bar-fill').style.width = `${ratio * 100}%`;
}

function setBusy(value) {
  busy = value;
  $('file-input').disabled = value;
  for (const button of document.querySelectorAll('.files button.danger')) button.disabled = value;
}

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso) {
  const date = new Date(iso);
  return isNaN(date) ? '' : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el('textarea', { value: text });
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const original = button.textContent;
  button.textContent = '已复制';
  setTimeout(() => (button.textContent = original), 1500);
}

function linkButtons(file) {
  const url = shareLink(file.id);
  const copy = el('button', { type: 'button', className: 'secondary', textContent: '复制链接' });
  copy.addEventListener('click', () => copyText(url, copy));
  const open = el('button', { type: 'button', className: 'secondary', textContent: '打开' });
  open.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
  const buttons = [copy, open];
  if (navigator.share) {
    const share = el('button', { type: 'button', className: 'secondary', textContent: '分享' });
    share.addEventListener('click', () => navigator.share({ title: file.name, url }).catch(() => {}));
    buttons.push(share);
  }
  return buttons;
}

function resultItem(file) {
  const url = shareLink(file.id);
  const input = el('input', { type: 'text', value: url, readOnly: true });
  input.addEventListener('focus', () => input.select());
  return el('li', {}, [
    el('div', { className: 'name', textContent: `已上传：${file.name}` }),
    el('div', { className: 'link-row' }, [input]),
    el('div', { className: 'actions' }, linkButtons(file)),
    el('p', { className: 'hint', textContent: '链接现在就能打开。' }),
  ]);
}

function fileItem(file) {
  const remove = el('button', { type: 'button', className: 'danger', textContent: '删除', disabled: busy });
  remove.addEventListener('click', () => removeFile(file, remove));
  return el('li', {}, [
    el('div', { className: 'name', textContent: file.name }),
    el('div', { className: 'hint', textContent: `${formatSize(file.size)} · ${formatDate(file.uploadedAt)}` }),
    el('div', { className: 'actions' }, [...linkButtons(file), remove]),
  ]);
}

function renderList() {
  $('file-list').replaceChildren(...index.files.map(fileItem));
  $('count').textContent = index.files.length ? `（${index.files.length}）` : '';
  $('list-empty').hidden = index.files.length > 0;
}

async function showMain() {
  hide('token-card');
  for (const id of ['upload-card', 'list-card', 'footer']) $(id).hidden = false;
  try {
    index = await readIndex(BRANCH);
    renderList();
  } catch (err) {
    fail('list-error', err);
  }
}

function showTokenForm() {
  for (const id of ['upload-card', 'list-card', 'footer']) hide(id);
  $('token-card').hidden = false;
  $('token-input').value = '';
}

$('token-link').href = TOKEN_URL;
$('repo-name').textContent = REPO;

$('token-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = $('token-input').value.trim();
  if (!value) return;
  token = value;
  $('token-save').disabled = true;
  hide('token-error');
  try {
    // 写一个空的 git 对象来确认令牌有写权限（不会改动仓库里的任何文件）
    await api('POST', '/git/blobs', { content: '', encoding: 'utf-8' });
    writeToken(value);
    showMain();
  } catch (err) {
    token = '';
    showError('token-error', explain(err));
  } finally {
    $('token-save').disabled = false;
  }
});

$('logout').addEventListener('click', () => {
  if (busy) return;
  token = '';
  writeToken('');
  showTokenForm();
});

$('file-input').addEventListener('change', (e) => {
  handleFiles(e.target.files);
  e.target.value = '';
});

const drop = $('drop');
for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
  });
}
drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
// 文件拖到上传框外面时，不要让浏览器直接打开它
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

window.addEventListener('beforeunload', (e) => {
  if (busy) e.preventDefault();
});

if (token) showMain();
else showTokenForm();
