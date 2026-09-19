# Journal - kev1n (Part 1)

> AI development session journal
> Started: 2026-09-19

---

## 2026-09-19: 划词翻译悬浮查词工具 (PaperDict) 实现与 PDF 深度优化

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
- 更新项目文档 (`README.md`)，详细说明 PDF 阅读与划选查词的 3 种使用方案。
