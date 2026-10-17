# HTML 文本视图与原版页面笔记互通及功能对齐

## Goal

让内置阅读器的「原版页面」与「HTML 文本」两种视图共享同一份批注数据与阅读能力：切换视图时高亮与笔记不丢失、不错位；原版页面已有的双语对照、论文笔记、术语表等能力在 HTML 文本视图同样可用。

## Background

阅读器已支持把 PDF 重排为 HTML 文本视图（commit 4145900），划词查词、高亮、笔记走 content.js 常规流程。本次调研确认的现状缺陷（详见 research/reader-view-interop-findings.md）：

1. 两种视图的 DOM 共存，恢复高亮时在全文档索引上匹配、去重也是全文档级，导致高亮被包进隐藏视图后不可见，即"切换界面笔记消失"。
2. HTML 段落文本经过去连字符清洗，与 PDF 文本层原始逐行文本不一致，跨视图按原文匹配失败。
3. reader.js 的 AnnotationManager 实例只在首次使用时读一次 storage，抽屉计数与列表不实时。
4. HTML 模式下「术语表」「论文笔记」按钮随 #zoom-controls 一起被隐藏（直接 bug）。
5. HTML 模式无双语对照/纯享中文、无页码导航、滚动时 currentPage 不更新、Alt+B 表现为无效果。
6. 阅读器页的"论文专属术语"划词查询链路为空（content.js 的术语提取发生在 PDF 打开之前，两种视图都受影响）。

## Requirements

### R1 笔记互通（核心）

- 高亮恢复限定在"当前可见视图"的 DOM 根内进行：页面模式 = PDF 视图容器（跳过 HTML 视图与双语侧栏），HTML 模式 = HTML 文本视图容器；不得包裹到隐藏视图。
- "已存在高亮"去重检查同样按当前视图作用域进行；清除/换色等操作仍保持全文档级（清掉两视图的所有副本）。
- 跨视图文本匹配：新增与 dictService.cleanPaperText 对齐的归一化（引号/破折号归一 + 连字符断词拼接 + 空白压缩）；恢复顺序为 原样 segments → 归一化全文 → 前缀回退。
- 不修改批注存储 schema；旧批注无需迁移即可恢复。
- 切换视图后主动触发一次恢复：HTML 模式在 buildHtmlDocument 完成后（已有）；页面模式在已渲染页 re-render 完成后（新增）。
- 抽屉计数与列表实时刷新：content.js 保存/删除批注后派发 DOM 事件，reader.js 监听刷新；updateReaderNotes 与导出前强制重新读 storage。

### R2 工具栏可见性修复

- HTML 模式下「术语表」「论文笔记」按钮保持可用；仅缩放按钮组随模式隐藏（缩放对重排文本不适用）。

### R3 HTML 视图双语对照 / 纯享中文

- 在 reader.js 内实现（复用 formulaProtector 与 background TRANSLATE_ONLINE，后者已含术语保护与缓存）；requestId 以 `reader_html_` 开头，可被现有 CANCEL_ALL_TRANSLATIONS 前缀取消。
- 视口懒翻译（IntersectionObserver）；译文块 `.pdf-html-trans` 插在段落之后；译文块加入 selection_anchor 的 SKIP 集合，不参与高亮匹配。
- 三态：原版 = 隐藏译文；双语 = 原文 + 译文；纯中文 = 译文成功后隐藏对应原文。
- 与现有 setReaderBilingualMode / Alt+B / 状态徽标打通，按 currentViewMode 分派渲染目标（页面模式走侧栏面板，HTML 模式走段落译文块）。

### R4 页码导航与页码状态

- HTML 模式保留页码控件；scrollToPage 在 HTML 模式滚动到对应 `.pdf-html-page`。
- HTML 模式滚动时 currentPage 跟随更新（按页 section 的 IntersectionObserver）。

### R5 术语表/引用提取覆盖与桥接

- buildHtmlDocument 时对每页段落文本执行 glossaryExtractor / citationParser 提取并刷新计数。
- reader 在提取后派发 `paperdict:glossary-updated`（renderPage 路径同样派发）；content.js 监听后刷新 `dictService.setPaperGlossary`，使"论文专属术语"划词查询在两种视图下可用。

### R6 测试与文档

- 更新 test_highlights.js：新增作用域恢复、跨视图归一化、reader 上下文钩子、HTML 双语、术语桥接断言；同步调整被重构影响的旧断言。
- 保持既有约束不破坏：restorePageHighlights 内 `if (!pageActive) return;` 前置、reader.html 中 selection_anchor.js 紧邻 content.js、reader.html 无 📄/⚡ emoji、reader.js module.exports 兼容、reader.js 中 `dictService.isEnglishSourceText(cleaned)` 字面调用恰好 2 次。
- CLAUDE.md 同步：测试套件数量 13、HTML 视图新能力与钩子说明。

## Out of Scope

- docKey 修复前的历史批注迁移（上一 commit 已声明不可自动重现）。
- 抽屉条目点击跳转定位、HTML 视图字号缩放（记录为后续可选）。
- bilingual.js 的 root 作用域重构（已评估不推荐：需拆 reader 页跳过逻辑与胶囊双状态源，回归风险大）。

## Acceptance Criteria

- [ ] 原版页面创建 3 处高亮（含跨行）→ 切 HTML 文本 → 高亮可见且位置正确；HTML 内新增批注 → 切回原版 → 高亮可见。
- [ ] 两视图导出的 Markdown 为同一份数据；抽屉计数与列表在新增/删除后立即更新。
- [ ] HTML 模式：双语对照 / 纯享中文 / 原版三态可用（工具栏按钮与 Alt+B），滚动懒翻译生效。
- [ ] HTML 模式：术语表、论文笔记抽屉入口可用；页码框可跳转到指定页；滚动时页码跟随。
- [ ] HTML 模式划选论文自定义缩写（如 LoRA）可命中"论文专属术语"。
- [ ] 普通网页（非 reader）划词、高亮、恢复行为无回归。
- [ ] `npm test` 全绿（13 套件）。
