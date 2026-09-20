# Journal - kev1n (Part 1)

> AI development session journal
> Started: 2026-09-19

---

## 2026-09-19: 划词翻译悬浮查词工具 (PaperDict) 实现、发布与自动化

### Completed
- 完成 Chrome / Edge 扩展完整工程构建 (`extension/` 目录，遵循 Manifest V3 规范)。
- 编译并内置 15,644 词的核心学术与考试离线英汉词库（涵盖考研、四六级、GRE、TOEFL、IELTS、AWL 及高频计算机/学术词汇，`extension/dict/`）。
- 实现 `dict_service.js` 智能预处理模块：
  - PDF 跨行断词连字符自动合并（`hypo-\n thesis` -> `hypothesis`）与空白归一化。
  - 智能时态、复数与词形还原（如 `hypotheses` -> `hypothesis`，`formulated` -> `formulate`，`algorithms` -> `algorithm`）。
  - 防误触过滤（过滤纯数字、引用序号 `[1]`、代码标点符号等）。
- 实现 Shadow DOM 物理样式隔离悬浮卡片 (`content.js` + `content.css`)，确保在 arXiv、Nature、IEEE、PubMed 等任何复杂学术网站中样式绝对稳定，不发生任何跑偏或被宿主 CSS 污染。
- **解决 PDF 无法划词的 Chromium 底层限制**：
  - 解释 Chromium 原生 `<embed type="application/pdf">` 阻止外部扩展注入的底层机制。
  - 实现了在线 PDF 智能拦截器（`background.js` 中通过 `webNavigation` 与 `tabs.onUpdated` 自动重定向到内置阅读器）。
  - 为 `reader.js` 添加 `?file=` 参数自动加载和错误降级提示（支持 arXiv 等在线 PDF 自动渲染并开启划选即弹）。
  - 为 Chrome 默认 PDF 页面增加 **右键菜单翻译弹窗**（`paperdict-selection-translate`）作为兜底，即使在 Chrome 默认阅读器中选中文本右键也能秒查。
  - 在 `popup.html` 中增加 PDF 识别横幅（检测到当前处于 PDF 标签页时，提供一键转入专属阅读器按钮）。
- 编写并扩充自动化测试套件 (`tests/test_extension.js` 和 `tests/test_translation.js`)，41 项测试用例全部通过。
- 配置 GitHub Actions 自动化 CI/CD 工作流 (`.github/workflows/release.yml`)：
  - 支持打 Tag（`v*`）时自动运行自动化测试套件。
  - 自动将扩展目录打包成 `paperdict-v*.zip` 产物。
  - 自动创建 GitHub Release 并附带精美完整的中文安装指南与更新日志。
- 打上首个正式版本标签 `v1.0.0` 并成功推送到 GitHub 远程仓库触发自动化发布。
- 更新项目文档 (`README.md`)，增加 Release 徽标与小白一键下载安装引导。

## 2026-09-19: Phase 2 论文就地全文双语对照与全中文速读 (In-situ Reader)

### Completed
- 研发并实现论文就地全文双语与纯中文速读引擎：
  - `extension/bilingual.js` 与 `extension/bilingual.css`：
    - `FormulaProtector`：数学公式识别占位保护与精准还原（保护 LaTeX `$公式$`、`$$行间公式$$`、`<math>`、KaTeX、MathJax，翻译前后零乱码）。
    - `AcademicFilter`：智能过滤参考文献（References/Bibliography）、代码块（`<pre><code>`）、页眉页脚、导航栏。
    - `CapsuleUI`：右侧常驻可折叠、可拖拽悬浮控制胶囊，支持进度展示与模式切换。
    - `PaperBilingualManager`：支持快捷键 `Alt+B` 循环切换（原版英文 -> 双语对照 -> 纯享中文），视口懒加载（`IntersectionObserver`）随滚动平滑流式翻译。
- 升级 PaperDict 学术 PDF 阅读器 (`reader.html`, `reader.css`, `reader.js`)：
  - 增加双语阅读模式切换工具栏按钮（原版 / 双语对照 / 纯享中文）及实时翻译状态徽标。
  - PDF 文本层段落聚类与左右对照布局渲染，支持视口滚动懒加载段落译文。
- 升级扩展弹窗 (`popup.html`, `popup.css`, `popup.js`)：
  - 新增“论文就地全文速读”快捷控制入口，可直接在弹窗内切换当前标签页论文排版。
  - 新增“默认开启双语对照”全局配置项（同步至 `chrome.storage.sync`）。
- 升级 Service Worker (`background.js`)：
  - 增强翻译请求缓存与长句/公式占位符翻译策略。
  - 增加右键菜单快捷开启双语阅读选项。
- 扩充测试套件与学术仿真测试页面：
  - `test-paper.html`：新增 LaTeX、KaTeX、MathML、Python 代码块与参考文献区，全方位验证公式保护与智能过滤。
  - `tests/test_extension.js`：新增 `FormulaProtector` 与 `AcademicFilter` 单元测试，测试用例扩充至 52 项且全部通过。
- 更新 `README.md`：详细记录 Phase 2 核心特性、使用场景、快捷键与全新架构图。


## Session 1: PaperDict Phase 2 Quality Verification & Bug Fixes

**Date**: 2026-09-20
**Task**: PaperDict Phase 2 Quality Verification & Bug Fixes
**Branch**: `main`

### Summary

Fixed formula-currency collisions in FormulaProtector, enhanced observer teardown and queue cleanup on original view restore, prevented duplicate capsule in reader.html, and validated test suite passing 68/68 tests.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `33d49ac` | fix(bilingual): resolve formula currency collision, observer teardown, and reader capsule duplication |
| `ec3ad68` | docs(spec): document formula protection and observer lifecycle quality standards |
| `c88545f` | chore(release): bump version to 1.0.1 for Phase 2 in-situ reader release |

### Release
- 打上正式版本标签 `v1.0.1` 并推送至 GitHub 触发自动化 Release 打包发布。

### Testing

- [OK] 68 项单元测试全部通过 (`node tests/test_extension.js`)。

### Status

[OK] **Completed**

---

## 2026-09-20 - Release v2.2.0 (PR #1 UX Refactor & Academic Vocabulary)

### Summary

- Reviewed and merged PR #1 (`EIR9264:main`), refactoring UX, card dragging/pinning, vocabulary book & Anki export, dark mode, persistent caching, and virtualized dual-column PDF reader.
- Verified all 68 core tests and 21 UX diagnostics tests pass.
- Updated release notes template in `.github/workflows/release.yml`.
- Created Git tag `v2.2.0` and successfully published GitHub Release with `paperdict-v2.2.0.zip`.

### Status

[OK] **Completed**

### Next Steps

- None - v2.2.0 published


