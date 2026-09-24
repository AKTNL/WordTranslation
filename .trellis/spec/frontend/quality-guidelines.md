# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

1. **未做货币防御的行内公式贪婪提取**：
   - 严禁使用单纯的 `/(?<!\\)\$([^$]+)\$(?!\d)/` 匹配 LaTeX 公式。在论文涉及经济/成本时，会把 `$10 ... $20` 中间整段英文吞没破坏。
   - 必须通过 `isLikelyLatexFormula()` 结合数字、常见货币词（dollar, million）以及 LaTeX 操作符特征（`\`, `_`, `^`, `=`, `\le`, `\sim` 等）进行二次校验。

2. **外部翻译 API 假定大小写与空格严格不变**：
   - 严禁假定外部在线翻译引擎会原封不动返回 `PDMATH_0`。
   - 外部引擎常因标点规则将其格式化为 `PD MATH 0`、`PD-MATH_0` 或小写。回填正则必须支持不区分大小写及灵活的空白/下划线兼容（`/PD\s*[-_]?\s*MATH\s*[_ \-:]*\s*(\d+)/gi`）。

3. **视图销毁遗留未完成异步观察器与并发队列**：
   - 模式切换回“原版英文”时，严禁只隐藏 DOM 而不清理 `IntersectionObserver` / `MutationObserver`。必须主动断开观察器、清空待翻译队列、释放并发槽位并移除扩展拥有的临时节点。
   - 段落状态必须显式区分 `idle`、`queued`、`translating`、`done`、`error`。模式或引擎配置变化后，旧请求只能写缓存，不得再修改当前 DOM；使用 view/config generation 和 request id 判定响应是否仍有效。

4. **带索引的翻译占位符前缀匹配**：
   - 恢复 `PDTERM_n`、`PDMATH_n` 等占位符时，索引后必须带数字边界，避免 `PDTERM_1` 误匹配 `PDTERM_10`。

5. **自定义翻译引擎静默降级**：
   - 用户明确选择 OpenAI 兼容接口或 DeepL 后，认证、限流、配置和网络错误必须原样返回，不得自动改用公共引擎。
   - API Key 只能保存在 `chrome.storage.local`；同步存储仅保存 Endpoint、模型和引擎类型等非敏感配置。

---

## Required Patterns

1. **宿主隔离优先 (Shadow DOM Encapsulation)**：
   - 所有注入到第三方学术页面（arXiv, Nature, IEEE 等）的独立浮动 UI（悬浮查词卡片、悬浮控制胶囊），必须通过 `attachShadow({ mode: 'open' })` 挂载，防止被宿主页面的 CSS reset（如 `div { all: unset }`）破坏。
2. **论文正文智能降噪**：
   - 双语/纯中文阅读器提取正文段落时，必须主动过滤参考文献区（`#references`, `.references`, `.bibliography` 等）、代码块（`pre`, `code`）及数学公式块。
3. **视口懒加载与并发节流**：
   - 必须采用 `IntersectionObserver` 进行流式按需加载，限制单次并发请求量（如最大并发 2~3），并内置内存字典/短语缓存，避免触发翻译引擎 Rate Limit。
4. **统一英语源文本判定**：
   - 划词、网页整页和 PDF 阅读器必须复用 `DictService.isEnglishSourceText()`；包含中日韩统一表意文字的文本不得进入英语到中文翻译链路。
5. **离线能力边界清晰**：
   - “离线”仅表示本地词典或术语库命中。整句和整页机器翻译必须明确标记为在线能力，关闭在线翻译后不得发送网络请求。
6. **划词卡片使用实时选区锚点**：
   - 划词后保存克隆的 DOM `Range`，在页面滚动、嵌套容器滚动和窗口缩放时重新读取几何位置。选区失效、端点断开或完全离开视口时必须释放锚点并关闭卡片。
   - `keyup` 等浏览器事件可能来自脚本合成；读取 `event.key` 前必须做类型检查。
7. **段落发现与动态调度去重**：
   - 首屏可见正文应立即入队，后续正文交给 `IntersectionObserver`，动态插入和文本水合交给 `MutationObserver`。
   - 正文发现必须排除导航、控件、代码、公式、参考文献及扩展生成节点，并在父级聚合块与具体子段落之间只保留一个翻译目标。

---

## Testing Requirements

- **回归测试覆盖**：所有文本清洗、连字符去噪、公式提取还原逻辑必须在 `tests/test_extension.js` 中有可离线执行的单测。
- **语法校验**：提交前必须确保 `background.js`、`content.js`、`bilingual.js`、`reader.js` 等所有脚本文件均能通过 `node --check` 语法检查。
- **翻译链路回归**：必须覆盖中文/中英混合过滤、术语最长匹配与多位索引恢复、引擎严格选路、错误映射、缓存隔离和在线开关行为。
- **浏览器生命周期回归**：段落模式改动必须覆盖首屏、滚动懒加载、动态 DOM、失败重试、纯中文隐藏条件、恢复原文和过期异步响应；划词卡片改动必须覆盖页面与嵌套滚动。

---

## Code Review Checklist

- [ ] 是否存在全局样式污染风险？类名是否有 `pd-` 前缀或 Shadow DOM 隔离？
- [ ] 公式定界符是否区分了货币符号？
- [ ] 视图还原与组件卸载时是否清理了事件监听与观察器？
- [ ] 是否在没有网络权限/离线状态下具备优雅的错误捕获与用户提示？
- [ ] 模式或配置切换后，旧请求是否可能重新插入译文或消耗当前并发槽位？
- [ ] 动态正文扫描是否排除了生成节点并避免父子重复翻译？
