import { OWNER, REPO, BRANCH } from './config.js';

export const ID_PATTERN = /^[a-z0-9]{6,32}$/;

// 网站根目录（查看页 index.html 所在的目录）
const SITE_ROOT = new URL('../', import.meta.url);

export function pagesUrl(path) {
  return new URL(path, SITE_ROOT).href;
}

// GitHub 原始文件地址：上传后立刻可用，并允许跨站读取
export function rawUrl(path) {
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;
}

export function shareLink(id) {
  return `${SITE_ROOT.href}?id=${id}`;
}
