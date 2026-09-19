<div align="center">

# 📖 PaperDict - 论文划词翻译助手
**专为阅读英文学术论文（网页 & PDF）打造的轻量级“划词即翻”悬浮查词浏览器扩展**

[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-blue?style=flat-square&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Chromium Compatible](https://img.shields.io/badge/Chromium-Edge%20%7C%20Chrome%20%7C%20Brave-brightgreen?style=flat-square&logo=microsoftedge)](https://www.google.com/chrome/)
[![Offline Dictionary](https://img.shields.io/badge/Offline%20Dict-15%2C600%2B%20Words-orange?style=flat-square)](https://github.com/AKTNL/WordTranslation)
[![Zero Config](https://img.shields.io/badge/API%20Key-Zero%20Config%20Required-success?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

</div>

---

## 📑 目录

- [✨ 为什么选择 PaperDict](#-为什么选择-paperdict)
- [🌟 核心功能与亮点](#-核心功能与亮点)
- [🚀 极速安装与部署指南](#-极速安装与部署指南)
- [📄 论文 PDF 阅读与划词解决方案](#-论文-pdf-阅读与划词解决方案)
- [💡 使用技巧与快捷操作](#-使用技巧与快捷操作)
- [🧪 自动化测试与验证](#-自动化测试与验证)
- [📂 项目目录结构](#-项目目录结构)
- [🛠️ 技术架构与实现原理](#️-技术架构与实现原理)
- [📄 开源协议](#-开源协议)

---

## ✨ 为什么选择 PaperDict

在阅读 arXiv、IEEE、ACM、Nature、Science 等学术文献或本地 PDF 论文时，传统翻译工具常面临以下痛点：
1. **频繁跳转打断思考**：每次遇到生词都要复制粘贴到独立词典软件中，思路容易被打断。
2. **需要配置繁琐的 API Key**：市面上大部分扩展需要用户注册各大云厂商翻译平台并绑定信用卡获取 Key。
3. **论文 PDF 跨行断词灾难**：学术论文多为双栏排版，单词经常跨行折行并带有连字符（如 `hypo-` 换行 `thesis`），直接查词导致无法识别。
4. **宿主网页样式污染**：许多扩展悬浮窗容易被学术论文网站自身的全局 CSS 样式干扰，造成文字重叠、错位或透明。
5. **Chrome 原生 PDF 划词被拦截**：Chrome/Edge 内置的 PDF 插件由于沙箱保护，通常禁止普通扩展在上面划词。

**PaperDict 彻底解决了上述问题，提供开箱即用、零配置、无缝集成的极致论文阅读查词体验！**

---

## 🌟 核心功能与亮点

- ⚡ **划选即弹，毫秒秒出**：鼠标划选或双击英文生词，松手瞬间在光标右上角平滑浮现释义卡片；按 `Esc` 或点击空白处自然消失。
- 📚 **内置 15,600+ 学术离线高频词典**：
  - 精选涵盖：考研、CET-4/6、GRE、TOEFL、IELTS、AWL（学术词汇表）以及高频计算机/学术专业词汇。
  - **断网可用**：离线状态下查词零延迟响应，开箱即用，**无需注册或配置任何 API Key**。
- ✂️ **PDF 跨行连字符自动智能修复（De-hyphenation）**：
  - 自动识别并合并论文跨行被横杠切断的单词（例如选中的 `experi-` 换行 `mental` 自动合并为 `experimental`）。
- 🧩 **智能时态与词形还原**：
  - 学术复数与特殊变形（`hypotheses` → `hypothesis`、`criteria` → `criterion`）、过去分词（`formulated` → `formulate`）、动名词等智能还原为原型词条。
- 🌐 **在线长难句整句翻译自动兜底**：
  - 划选完整长句或词典未收录词汇时，自动异步调用免费在线翻译引擎提供流畅中文译文。
- 🔊 **纯正真人美音发音**：
  - 卡片集成小喇叭发音按钮，点击即可播放真人语音，离线自动降级到系统原生 Web Speech TTS。
- 🛡️ **Shadow DOM 样式物理隔离**：
  - 悬浮卡片使用 Web Components / Shadow DOM 封装，彻底隔绝外部网页（如 IEEE、arXiv、Nature 等）的 CSS 污染。
- 📄 **内置专属学术 PDF 阅读器**：
  - 基于高精文本层渲染，支持本地 PDF 拖拽秒开，同时支持在线论文一键转入，享有完整的划词即弹体验。

---

## 🚀 极速安装与部署指南

PaperDict 采用原生 JavaScript 实现，**零构建依赖**，代码透明清晰，直接加载即可使用。

### 1. 下载或克隆仓库
```bash
git clone https://github.com/AKTNL/WordTranslation.git
```

### 2. 在 Google Chrome 中加载
1. 打开 Chrome 浏览器，在地址栏输入并访问：
   ```text
   chrome://extensions/
   ```
2. 打开右上角的 **「开发者模式」(Developer mode)** 开关。
3. 点击左上角的 **「加载已解压的扩展程序」(Load unpacked)** 按钮。
4. 在弹出的文件选择器中，选中本项目中的 **`extension`** 文件夹。
5. 安装完成！浏览器右上角扩展栏会出现 PaperDict 图标。

> ⚠️ **重要设置（本地 PDF 必开）**：  
> 若需要在浏览器中阅读本地下载的 PDF 论文，请在 `chrome://extensions/` 找到 PaperDict，点击 **「详细信息」**，勾选 **「允许访问文件网址」(Allow access to file URLs)**。

### 3. 在 Microsoft Edge 中加载
1. 打开 Edge 浏览器，地址栏输入并访问：
   ```text
   edge://extensions/
   ```
2. 开启左侧菜单底部的 **「开发人员模式」**。
3. 点击顶部的 **「加载解压缩的扩展」**。
4. 选择本项目中的 **`extension`** 文件夹即可。

---

## 📄 论文 PDF 阅读与划词解决方案

> **技术背景**：Chrome 和 Edge 内置的 PDF 查看器底层是 Chromium 闭源插件（`<embed type="application/pdf">`），浏览器官方出于安全机制，**禁止外部扩展程序向默认 PDF 插件内直接插入悬浮卡片或直接捕获文本划选事件**。

为了保障用户在阅读 PDF 论文时的完美体验，PaperDict 提供了 **3 种互补的划词方案**：

### 方案 A：使用内置【学术 PDF 阅读器】（体验最佳 ⭐⭐⭐⭐⭐）
* **阅读本地论文**：点击扩展图标 → 点击 **「打开学术 PDF 阅读器」**，直接将电脑里的论文 PDF **拖入窗口**，即可享受全功能划词即弹、断词修复与语音朗读。
* **阅读在线论文（arXiv 等）**：扩展默认启用了“自动在阅读器中打开 PDF”，点击任何学术 PDF 链接（如 arXiv 论文）会自动无缝转入专属阅读器。

### 方案 B：在 Chrome 自带 PDF 界面中【一键转入】
* 如果你已经在 Chrome 原生窗口中打开了一篇 PDF 论文，点击右上角 PaperDict 图标，顶部会自动弹出引导条：
  > 📄 **当前标签页为 PDF 论文**  
  > 点击按钮 **`在 PaperDict 阅读器中打开 (开启划词即弹)`** 即可瞬间切换。

### 方案 C：在 Chrome 自带 PDF 中【右键划选秒查】
* 如果临时不想切换阅读器，只需在原生 PDF 页面划选单词，**点击鼠标右键**，选择 **「PaperDict 划词翻译」**，即可弹出独立查词窗口秒出释义。

---

## 💡 使用技巧与快捷操作

| 操作场景 | 触发方式 | 说明 |
| :--- | :--- | :--- |
| **生词查词** | 鼠标划选单词 或 双击单词 | 光标右上角立即平滑浮现中文释义与音标 |
| **关闭悬浮卡片** | 点击网页空白处 或 按 `Esc` 键 | 快速关闭，不影响后续阅读 |
| **朗读单词** | 点击卡片上的 🔊 小喇叭 | 播放真人标准发音 |
| **复制释义** | 点击卡片上的 📋 复制图标 | 自动将单词和释义复制到剪贴板 |
| **整句长难句翻译** | 鼠标划选一整段/整句文本 | 自动调用在线翻译引擎给出整句翻译 |
| **个性化设置** | 点击浏览器右上角扩展图标 | 自由开启/关闭划选即弹、连字符拼接、自动发音等开关 |

---

## 🧪 自动化测试与验证

本项目包含完整的单元测试与端到端学术场景测试用例：

### 1. 运行命令行自动化测试套件
```bash
# 运行 Schema、离线词库、智能连字符清洗、时态还原与代码语法测试
node tests/test_extension.js

# 测试在线长句翻译与语音接口连通性
node tests/test_translation.js
```
*测试涵盖 40+ 项断言，确保词典检索 $O(1)$、跨行断词拼接正则与分词解析完全准确。*

### 2. 浏览器交互式验证
在浏览器中直接打开根目录下的 **`test-paper.html`**，页面模拟了真实的深度学习学术论文排版，包含跨行断词、数学变量、学术变形词与长难句，方便直观体验各项功能。

---

## 📂 项目目录结构

```text
WordTranslation/
├── extension/                  # Chrome / Edge 扩展主工程 (Manifest V3)
│   ├── manifest.json           # 扩展清单配置 (权限、规则与脚本注入声明)
│   ├── background.js           # Service Worker (在线翻译调度、PDF 拦截、右键菜单)
│   ├── content.js              # 核心划词监听器与 Shadow DOM 隔离渲染卡片
│   ├── content.css             # 悬浮卡片独立样式表
│   ├── dict_service.js         # 文本预处理算法、PDF 连字符清洗与词形还原引擎
│   ├── dict/                   # 离线学术词库 (15,600+ 词条)
│   │   ├── academic_dict.js    # Content Script 专用词库变量
│   │   └── academic_dict.json  # 词库 JSON 索引源文件
│   ├── popup/                  # 扩展右上角设置弹窗与即时查询界面
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   ├── reader/                 # 内置专属学术 PDF 阅读器 (基于 PDF.js)
│   │   ├── reader.html
│   │   ├── reader.css
│   │   ├── reader.js
│   │   └── lib/                # PDF.js 核心库与 worker 脚本
│   └── icons/                  # 扩展高清应用图标 (16/32/48/128 px)
├── tests/                      # 自动化测试脚本
│   ├── test_extension.js       # 离线功能、词典完整性与预处理测试
│   └── test_translation.js    # 在线翻译引擎连通性测试
├── test-paper.html             # 本地学术论文场景测试验证网页
├── README.md                   # 项目说明文档
└── LICENSE                     # MIT 开源许可证
```

---

## 🛠️ 技术架构与实现原理

```
[ 学术网页 / PDF 阅读器 ]
          │ (鼠标双击 / 划选文本)
          ▼
   [ content.js ]
          │
          ├──> 1. dict_service.js 清洗文本
          │     ├── PDF 跨行断词合并: /(\w+)-\s*\n\s*(\w+)/ -> $1$2
          │     ├── 过滤纯数字 / 引用标签 [1] / 符号
          │     └── 词形与时态还原 (hypotheses -> hypothesis)
          │
          ├──> 2. 本地离线词典检索 (academic_dict.js)
          │     ├── O(1) 毫秒响应
          │     └── 成功命中 -> 格式化音标与词性释义
          │
          └──> 3. 未收录词 / 长难句 -> background.js (Service Worker)
                ├── MyMemory / Google 在线翻译异步并发与容灾兜底
                └── 优雅 Loading 骨架态填充
          │
          ▼
   [ Shadow DOM 隔离卡片 ] (挂载至 document.body)
          ├── 物理 CSS 隔离，防止宿主网站排版污染
          ├── 真人语音朗读播放 (Youdao Voice + Web Speech TTS)
          └── 一键快速复制生词释义
```

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。欢迎学术研究者、开发者提交 Issue 和 Pull Request 共同改进！
