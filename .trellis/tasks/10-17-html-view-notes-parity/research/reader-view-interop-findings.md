# 调研：两视图笔记互通与 HTML 视图功能对齐

日期：2026-10-17。基于对 commit 4145900 后代码库的完整走读（content.js / reader.js / bilingual.js / selection_anchor.js / annotation_manager.js / dict_service.js / background.js）。

## 根因：为什么切换视图笔记"消失"

### 1. 恢复把高亮包进了隐藏视图

- content.js `restoreAnnotation` 在 `buildTextIndex(document.body)` 上全文档匹配（content.js:1844）。
- 两种视图 DOM 共存，切换仅 display 开关；PDF 行在文档序上位于 HTML 视图之前 → HTML 模式恢复时同一段文字先命中隐藏的 PDF textLayer。
- 去重 `queryAnnotationMarks(anno.id).length > 0` 为全文档查询（content.js:1835）：隐藏视图里的 mark 让可见视图的恢复被跳过。
- `setViewMode('page')` 不显式触发恢复（reader.js:980-985），依赖 MutationObserver 兜底；反方向同样被去重阻断。

### 2. 两侧文本不一致

- HTML 段落 = `clusterItemsToParagraphs` + `dictService.cleanPaperText(raw, true)`：断词连字符拼接 `([a-zA-Z]+)-\s*[\r\n]+\s*([a-zA-Z]+) → $1$2`、引号/破折号归一、空白压缩、首尾标点处理（dict_service.js:157-191）。
- PDF textLayer = pdf.js 原始逐行文本（"transla-" 与 "tion" 分属不同 span）。
- 前缀回退只对单段注释生效（content.js:1856-1859）。

### 3. 计数与列表陈旧

- reader.js 与 content.js 各自持有 AnnotationManager 实例；`getAnnotationsForDoc` 仅在 `isLoaded=false` 时 `loadAll`（annotation_manager.js:236），content.js 写入后 reader.js 实例不再刷新。
- `updateReaderNotes` 只在抽屉打开时调用（reader.js:108-114）；计数徽标在首次打开抽屉前一直显示 0。

### 4. 历史限制

- docKey 修复（commit 4145900）之前保存的批注使用旧键值，不会自动重现。不在本任务范围。

## 功能缺口（HTML 视图 vs 原版页面）

- 「术语表」「论文笔记」按钮位于 `#zoom-controls`（reader.html:50-57），`setViewMode` 在 HTML 模式整体隐藏该容器（reader.js:964-966）→ 抽屉入口消失。
- 双语对照/纯中文只驱动页面侧栏（pageParagraphsMap + `.pdf-page-bilingual`）；HTML 模式隐藏 bilingual-controls 且无实现；bilingual.js 显式跳过 reader 页（bilingual.js:2459-2466）。
- pageControls 在 HTML 模式隐藏；滚动监听只查 `.pdf-page`（reader.js:1123-1142）→ currentPage 不更新；`scrollToPage` 只认 `#pdf-page-N`。
- Alt+B 在 HTML 模式只切换隐藏面板的状态，表现为无效果。
- 术语提取：reader 仅在 renderPage 提取（reader.js:521-529，且是 reader 自己的 GlossaryExtractor 实例）；content.js 的 `extractAndRegisterGlossary` 在 PDF 打开前执行（content.js:2667-2672）；background `lookupGlossary` 只查内置术语包 + 用户术语库（background.js:615-627）。→ 阅读器页"论文专属术语"划词查询为空，两种视图都受影响。
- 引用索引同样只在 renderPage 提取。

## 设计决策

### D1 视图作用域恢复

- `selection_anchor.buildTextIndex(root, options)` 增加可选 `skipSelector`，缺省行为不变（普通网页零影响）。
- reader.js 提供 `window.__paperDictHighlightContext()`：
  - 页面模式：`{ root: #pdf-viewer, skipSelector: '.pdf-html-view, .pdf-page-bilingual' }`；
  - HTML 模式：`{ root: #pdf-html-view }`。
- content.js `restoreAnnotation(anno, restoreCtx)` 使用在 `restorePageHighlights` 内建一次的共享索引；去重与包裹限定 root 内。`clearCurrentHighlight` / 换色保持全文档级（清/改两视图全部副本）。
- 双语侧栏与 HTML 译文块不参与匹配（避免把高亮包进"另一种表达"的文本里）。

### D2 跨视图归一化匹配

- 新增 `normalizePaperMatch(text)`（纯字符串）与 `normalizeTextIndex({text, map})`（在索引上做同样归一，删除连字符及其后空白字符并同步 map；引号/破折号为 1:1 替换，map 不变）。
- 规则与 cleanPaperText 对齐：`' '` `" "` 归一、`– —` → `-`、`([A-Za-z])-\s+([A-Za-z])` → `$1$2`、空白压缩。两侧使用同一规则，保证一致性。
- 恢复顺序：原样 segments（同视图快路径）→ 归一化全文（跨视图兜底）→ 前缀回退（归一化侧前缀 24 字符）。
- 不新增存储字段；归一化文本在恢复时现场从 `segments`/`text` 计算，旧批注零迁移。

### D3 事件桥（计数实时化）

- content.js 保存/删除批注后 `window.dispatchEvent(new CustomEvent('paperdict:annotations-changed'))`。
- reader.js 监听该事件刷新计数与抽屉；`chrome.storage.onChanged('paperdict_annotations')` 作兜底。
- `updateReaderNotes` 与导出前 `await annotationManager.loadAll()` 强制重读 storage。
- PDF 加载完成后立即调用一次 `updateReaderNotes()`，计数不再等首次打开抽屉。

### D4 HTML 双语实现位置

- 在 reader.js 内实现小管线，不复用 PaperBilingualManager。理由：复用需拆掉 reader 页跳过逻辑、给 `findContentElements(document)` / `observeContentChanges` / observer 做 root 作用域改造、与胶囊 UI 形成双状态源；bilingual.js 为 2483 行核心文件且被多个测试套件约束，回归风险不成比例。
- 复用面：formulaProtector、background TRANSLATE_ONLINE（含 glossary protect + 缓存 + 引擎路由）、`reader_` requestId 前缀（现有 CANCEL_ALL_TRANSLATIONS 直接生效）。
- 译文块 `.pdf-html-trans` 加入 selection_anchor 的 SKIP 集合；内容 MutationObserver 对译文节点变更跳过 scheduleRestore，避免翻译期恢复风暴。

### D5 页码导航

- HTML 模式保留 pageControls；`scrollToPage` 分支到 `.pdf-html-page[data-page-number]`。
- 按页 section 的 IntersectionObserver（中间带 rootMargin）维护 currentPage 与页码输入框。

### D6 术语/引用桥接

- buildHtmlDocument 每页段落文本 → glossaryExtractor/citationParser 提取并刷新计数；renderPage 提取后同样派发。
- reader 派发 `paperdict:glossary-updated`（detail.terms）；content.js 监听后 `dictService.setPaperGlossary(terms)`。

## 测试约束（必须保持或同步更新）

- test_highlights.js:96-100 断言 `function restoreAnnotation(anno)`、`findInTextIndex(index, text, cursor)`、`buildTextIndex(document.body)` → 随重构同步更新断言。
- test_highlights.js:113-115 要求 `restorePageHighlights() {` 后 220 字符内出现 `if (!pageActive) return;` → 保持该前置结构。
- test_translation_maintenance.js:87 `dictService.isEnglishSourceText(cleaned)` 在 reader.js 恰好出现 2 次 → 新代码不得新增该字面调用。
- test_paragraph_translation_experience.js:2922 reader.html 中 selection_anchor.js 必须紧邻 content.js 之前 → 保持加载顺序。
- test_ui_layout.js:80 reader.html 不得包含 📄 / ⚡ emoji。
- reader.js module.exports 兼容：clusterPdfTextIntoParagraphs、clusterItemsToParagraphs、isFigureOrTableCaption、isTabularData、translatePageParagraphs、pageParagraphsMap、renderPage、pageRenderTasks、setViewMode、resetHtmlView、setCurrentPdfDoc。
- npm test 链当前 13 套件（package.json:6）；CLAUDE.md 的"12 test files"需更正。

## 关键文件索引

- extension/selection_anchor.js — SKIP 集合、buildTextIndex、新增归一化函数
- extension/content.js — 恢复链路、事件派发、glossary 桥、导出 docKey 一致性
- extension/reader/reader.js — 上下文钩子、setViewMode、HTML 双语管线、页码导航、计数刷新
- extension/reader/reader.html — 工具栏分组（zoom-buttons）
- extension/reader/reader.css — .pdf-html-trans / .zoom-buttons 样式
- extension/dict_service.js — cleanPaperText 规则参照（不改）
