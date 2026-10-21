# PDF 分享

上传 PDF，生成一个链接发给别人。对方用手机或电脑打开就能在线看，可以一直放大（最大 200 倍），放大后文字和线条依然清晰。

- 查看页：`https://arcadiamedia.github.io/PDF/?id=文件编号`
- 上传页：<https://arcadiamedia.github.io/PDF/upload/>

## 第一次使用（只需做一次）

1. **开启 GitHub Pages**：打开仓库的 Settings → Pages，Source 选 **Deploy from a branch**，Branch 选 `main`、文件夹选 `/ (root)`，点 Save。1～2 分钟后网站上线。
2. **创建上传令牌**：打开上传页，点“点这里创建令牌”（名称和权限已自动填好），在 Repository access 里选 **Only select repositories** → `PDF`，点 Generate token，把令牌粘贴回上传页保存。
   - 令牌只保存在当前浏览器里。换电脑、换浏览器要重新填一次（可以再建一个令牌）。
   - 令牌有效期 1 年，过期后上传页会提示重新填写。

## 日常使用

打开上传页 → 选择 PDF（可多选，或拖进去）→ 复制生成的链接发给对方。

- 链接上传后马上能用。GitHub Pages 更新需要 1～2 分钟，这期间查看页会自动改从 GitHub 原始文件地址读取。
- 上传页下方的列表可以复制链接、打开或删除已上传的文件。删除后链接失效。

## 限制

- 仓库是公开的，上传的 PDF 任何人都能在仓库里看到。
- 单个 PDF 不超过 100 MB（建议 50 MB 以内）；整个网站不超过 1 GB；每月流量约 100 GB（GitHub 的软性上限）。
- 删除的文件仍留在 git 历史里，不会释放仓库空间。
- PDF 里的矢量内容（文字、线条）放大后始终清晰；照片和扫描件超过原图分辨率后会看到像素颗粒。
- 如果 PDF 本身没有嵌入字体（常见于部分中文 PDF），查看器会从 jsDelivr 按需下载补充字体。

## 文件结构

| 路径 | 说明 |
|---|---|
| `index.html`、`assets/viewer.js` | 查看页 |
| `upload/index.html`、`assets/upload.js`、`assets/upload.css` | 上传页 |
| `assets/config.js` | 仓库名和分支，换仓库时改这里 |
| `files/` | 上传的 PDF（`编号.pdf`）、文件信息（`编号.json`）和文件列表（`index.json`） |
| `vendor/embedpdf/` | [EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer) 2.15.1 查看器和 PDFium 引擎（自托管） |

最大放大倍数在 `assets/viewer.js` 的 `MAX_ZOOM` 里修改。

## 第三方组件

- EmbedPDF：MIT 许可，见 `vendor/embedpdf/LICENSE`
- PDFium：BSD 风格许可，见 `vendor/embedpdf/LICENSE.pdfium`
