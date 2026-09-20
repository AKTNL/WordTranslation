/**
 * PaperDict - Comprehensive UX & Functionality Diagnostic Test Suite
 * Evaluates edge cases, intrusive behavior, lemmatization gaps, MV3 lifecycle,
 * and user experience flaws.
 */

const fs = require('fs');
const path = require('path');
const { DictService, IRREGULAR_WORDS } = require('../extension/dict_service.js');
const { FormulaProtector, AcademicFilter } = require('../extension/bilingual.js');

const dictData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../extension/dict/academic_dict.json'), 'utf8')
);
const service = new DictService(dictData);

let totalIssues = 0;
const issues = [];

function recordIssue(category, title, detail, severity = 'HIGH') {
  totalIssues++;
  issues.push({ id: totalIssues, category, title, detail, severity });
  console.log(`  ⚠ [ISSUE #${totalIssues}] [${severity}] ${title}`);
  console.log(`    Detail: ${detail}\n`);
}

function check(condition, passMsg, failIssue) {
  if (condition) {
    console.log(`  ✓ OK: ${passMsg}`);
  } else {
    recordIssue(failIssue.category, failIssue.title, failIssue.detail, failIssue.severity);
  }
}

console.log('====================================================');
console.log('  PaperDict 全面体验缺陷与边界诊断测试');
console.log('====================================================\n');

// ----------------------------------------------------
// 1. 划词查词误触与清洗测试 (Selection & Mis-triggering)
// ----------------------------------------------------
console.log('【模块 1: 划词误触与文本清洗边界】');

// 1.1 所有格形式 ('s 与 ’s)
const possessiveNormal = service.lookupLocal("model's");
const possessiveCurly = service.lookupLocal("model’s");
check(
  possessiveNormal && possessiveNormal.found,
  "所有格 model's 成功还原为 model",
  {
    category: '词法还原',
    title: "所有格形式 ('s) 查词失败",
    detail: "学术论文中极其常见的所有格 (如 model's, author's, algorithm's) 无法被 generateCandidates 还原为原型，导致离线查词直接失效。",
    severity: 'HIGH'
  }
);
check(
  possessiveCurly && possessiveCurly.found,
  "中文/排版弯引号所有格 model’s 成功还原",
  {
    category: '词法还原',
    title: "弯引号排版所有格 (’s) 无法识别",
    detail: "学术 PDF 和网页常用排版单引号 ’ (U+2019)，插件没有对其进行归一化为标准英文单引号 '，导致词库无法匹配。",
    severity: 'MEDIUM'
  }
);

// 1.2 中文混排误触发 (Mixed Chinese/English Text)
const mixedZh1 = '这篇论文提出了一种新型 CNN 架构';
const mixedEligible = service.isLookupEligible(mixedZh1);
check(
  !mixedEligible,
  "中文混排句子不会误触发整句查词",
  {
    category: '划词误触',
    title: "选中有英文缩写的中文句子误触发弹窗与在线翻译",
    detail: `用户在阅读中文博客/文档时，选中包含英文缩写（如“${mixedZh1}”）的文本，因匹配 /[a-zA-Z]/ 被判为有效，立刻发起公网整句翻译并弹出卡片，极度干扰正常阅读。`,
    severity: 'HIGH'
  }
);

// 1.3 代码片段误触发 (Code Snippets)
const codeSnippet = 'for (let i = 0; i < n; i++)';
const codeEligible = service.isLookupEligible(codeSnippet);
check(
  !codeEligible,
  "常见代码循环/语句不会误触发查词",
  {
    category: '划词误触',
    title: "代码片段与编程语句被误触发查词",
    detail: `用户在查看论文中的代码块（如 "${codeSnippet}"）并划选时，被误判为英文长句并弹出翻译卡片。`,
    severity: 'MEDIUM'
  }
);

// 1.4 单字母变量误触发 (Single Letter Variables)
const singleVar = 'x';
const singleEligible = service.isLookupEligible(singleVar);
check(
  !singleEligible,
  "单字母数学变量不应弹窗骚扰",
  {
    category: '划词误触',
    title: "单字母变量/字符划选频繁误弹窗",
    detail: "在学术论文中划选公式或变量（如 x, y, a, i, n）时，单字母被当作单词触发查词，遮挡视线。",
    severity: 'MEDIUM'
  }
);

// 1.5 短语末尾标点清洗 (Trailing Punctuation in Phrases)
const phraseClean1 = service.cleanPaperText('deep learning.', true);
const phraseClean2 = service.cleanPaperText('natural language processing,', true);
check(
  !phraseClean1.endsWith('.') && !phraseClean2.endsWith(','),
  "多词学术短语末尾的句号、逗号已被彻底清洗",
  {
    category: '文本清洗',
    title: "多词短语清洗未去除末尾标点符号",
    detail: `cleanPaperText 仅在 !cleaned.includes(' ') 时才剥离外层标点，导致选中“deep learning.”时末尾句号被保留，导致在线短语查询时带着逗号或句号。`,
    severity: 'LOW'
  }
);

// 1.6 学术复合连字符词 (Hyphenated Academic Terms)
const hyphenated1 = service.cleanPaperText('state-of-the-art', false);
const isSingleHyphenated = service.isSingleWord(hyphenated1);
const hyphenatedLookup = service.lookupLocal(hyphenated1);
check(
  isSingleHyphenated,
  "state-of-the-art 识别为复合词单元",
  {
    category: '词法还原',
    title: "学术常见连字符复合词处理不佳",
    detail: "如 state-of-the-art, end-to-end, large-scale 等在学术界高频出现的复合词，缺乏专门的词典收录与分词降级策略。",
    severity: 'MEDIUM'
  }
);


// ----------------------------------------------------
// 2. 前端事件交互与重复绑定缺陷 (Event Handling Bugs)
// ----------------------------------------------------
console.log('\n【模块 2: 前端事件监听与交互缺陷】');

const contentJsContent = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');

// 2.1 mouseup 双重注册
const mouseUpTrue = contentJsContent.includes("document.addEventListener('mouseup', onMouseUp, true)");
const mouseUpFalse = contentJsContent.includes("document.addEventListener('mouseup', onMouseUp, false)");
check(
  !(mouseUpTrue && mouseUpFalse),
  "mouseup 事件仅注册单向阶段",
  {
    category: '交互缺陷',
    title: "mouseup 事件在捕获与冒泡双阶段重复绑定",
    detail: "content.js 中同时在捕获阶段(true)和冒泡阶段(false)监听 mouseup，导致用户鼠标每次松开都触发两次 onMouseUp()，产生无谓的二次计算与潜在的竞态抖动。",
    severity: 'HIGH'
  }
);

// 2.2 缺乏查词触发模式（仅有即弹，无图标模式/按键模式）
const hasIconTrigger = contentJsContent.includes('triggerMode') || contentJsContent.includes('showTriggerIcon');
check(
  hasIconTrigger,
  "支持悬浮图标点击触发或按键触发模式",
  {
    category: '人性化设计',
    title: "缺乏“小图标触发”与“快捷键触发”模式，强制秒弹极度侵入",
    detail: "目前只有开启或关闭划选即弹（25ms）。主流优质翻译插件（如 Saladict、沉浸式翻译）均提供“显示小图标，点击后再展开卡片”以及“按住 Alt/Ctrl 划词才翻译”的选项，避免在用户只是想复制文本时强行弹窗遮挡正文。",
    severity: 'CRITICAL'
  }
);

// 2.3 卡片无法拖拽与钉住 (Draggable & Pin Card)
const isCardDraggable = contentJsContent.includes('card-drag') || contentJsContent.includes('isDraggingCard');
const hasPinButton = contentJsContent.includes('btn-pin') || contentJsContent.includes('pinCard');
check(
  isCardDraggable && hasPinButton,
  "悬浮卡片支持拖拽移动与固定钉住",
  {
    category: '人性化设计',
    title: "查词卡片无法拖拽位置，也无法钉住固定（Pin）",
    detail: "弹出的释义卡片是 fixed 定位的固定框，若遮挡了下一行正文或参考段落，用户无法拖开它；点击空白处卡片立刻消失，无法固定在屏幕角落以便对照写作或阅读。",
    severity: 'HIGH'
  }
);


// ----------------------------------------------------
// 3. 常驻悬浮胶囊设计与站点隔离缺陷 (Capsule & Site Isolation)
// ----------------------------------------------------
console.log('\n【模块 3: 悬浮控制胶囊与站点隔离缺陷】');

const bilingualJsContent = fs.readFileSync(path.join(__dirname, '../extension/bilingual.js'), 'utf8');

// 3.1 是否检查 window.self === window.top
const hasTopFrameCheck = bilingualJsContent.includes('window.self === window.top') || bilingualJsContent.includes('window.top === window.self');
check(
  hasTopFrameCheck,
  "悬浮胶囊严格限制在 top frame 顶层窗口加载",
  {
    category: '架构缺陷',
    title: "悬浮胶囊未做顶层窗口检查，多 iframe 页面重复注入",
    detail: "manifest.json 配置了 all_frames: true，而 bilingual.js 没有检查 window.self === window.top，导致任何内嵌 iframe（广告、评论框、第三方组件）都会尝试挂载一个悬浮胶囊，造成界面错乱与报错。",
    severity: 'HIGH'
  }
);

// 3.2 胶囊是否支持用户主动彻底关闭/隐藏
const hasCapsuleHideOption = bilingualJsContent.includes('disableCapsule') || bilingualJsContent.includes('hideCapsule');
check(
  hasCapsuleHideOption,
  "用户可自由隐藏悬浮胶囊或设置不显示",
  {
    category: '人性化设计',
    title: "悬浮胶囊霸道常驻屏幕边缘，完全无法关闭或隐藏",
    detail: "页面右侧常驻的“论文速读”胶囊无视用户当前访问的是学术网页还是日常网站（B站、GitHub、网银、表单），点击关闭仅仅是收缩为小胶囊，无法彻底关闭或从当前网站隐藏。",
    severity: 'CRITICAL'
  }
);

// 3.3 是否支持黑白名单与特定域名规则
const popupJsContent = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.js'), 'utf8');
const hasBlacklist = popupJsContent.includes('blacklist') || popupJsContent.includes('excludeDomains');
check(
  hasBlacklist,
  "支持网站黑名单/白名单禁用功能",
  {
    category: '人性化设计',
    title: "缺乏站点黑名单/白名单（禁用列表）机制",
    detail: "用户在代码仓库、富文本编辑器（Notion、Google Docs、语雀）或公司内网工作时，划选文本频繁被弹窗打扰，无法一键将当前域名加入黑名单。",
    severity: 'HIGH'
  }
);


// ----------------------------------------------------
// 4. Manifest V3 Service Worker 生命周期与缓存缺陷
// ----------------------------------------------------
console.log('\n【模块 4: MV3 架构与后台生命周期缺陷】');

const backgroundJsContent = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');

// 4.1 Service Worker 内存缓存失效
const usesMemoryMapCache = backgroundJsContent.includes('const translationMemoryCache = new Map()');
const usesStorageForTransCache = backgroundJsContent.includes('chrome.storage.local') && backgroundJsContent.includes('translationCache');
check(
  !usesMemoryMapCache || usesStorageForTransCache,
  "翻译缓存持久化到 chrome.storage.local 或 IndexedDB",
  {
    category: '架构缺陷',
    title: "MV3 Service Worker 内存缓存因空闲休眠而被瞬间清空",
    detail: "background.js 中将译文缓存保存在 Map() 中。在 Chrome MV3 中，后台 Service Worker 在 30 秒空闲后会被强制杀死，唤醒后内存变量完全归零！用户在长论文中上下滚动时，原本已翻译的段落缓存完全丢失，必须重新请求网络，极易被封 IP。",
    severity: 'CRITICAL'
  }
);

// 4.2 翻译失败重试机制
const hasParagraphRetry = bilingualJsContent.includes('btn-retry-trans') || bilingualJsContent.includes('retryTranslation');
check(
  hasParagraphRetry,
  "段落翻译失败后提供点击重试交互",
  {
    category: '人性化设计',
    title: "就地速读翻译失败时无重试按钮，留下死状态",
    detail: "当某段落因网络抖动或接口限流失败时，界面仅输出一行红字“(翻译暂不可用: 网络超时)”，没有提供“重新翻译此段”的点击重试交互，用户只能刷新整个页面重新开始。",
    severity: 'MEDIUM'
  }
);

// 4.3 自定义 API 密钥支持 (Custom LLM / DeepL / OpenAI API Key)
const hasCustomApiConfig = popupJsContent.includes('apiKey') || popupJsContent.includes('customEngine');
check(
  hasCustomApiConfig,
  "支持用户配置 DeepL / OpenAI / 硅基流动等自定义 API Key",
  {
    category: '功能缺失',
    title: "仅依赖免费公网爬虫接口，缺乏高质量自定义 API 接入能力",
    detail: "学术论文翻译对术语准确度和语言连贯性要求极高。当前仅使用 MyMemory 和 Google GTX 免费接口，极易被 429 限流且翻译僵硬，不支持用户填入自己的 DeepL、OpenAI、Claude 或国内模型 API Key。",
    severity: 'HIGH'
  }
);


// ----------------------------------------------------
// 5. 学术 PDF 阅读器性能与排版缺陷 (PDF Reader UX)
// ----------------------------------------------------
console.log('\n【模块 5: 学术 PDF 阅读器体验与性能缺陷】');

const readerJsContent = fs.readFileSync(path.join(__dirname, '../extension/reader/reader.js'), 'utf8');

// 5.1 全量并发渲染所有页面 (全量渲染无分页)
const rendersAllPagesInLoop = readerJsContent.includes('for (let i = 1; i <= totalPages; i++)') && readerJsContent.includes('await renderPage(i)');
check(
  !rendersAllPagesInLoop,
  "PDF 阅读器采用虚拟滚动或按需分页渲染",
  {
    category: '性能灾难',
    title: "PDF 阅读器全量循环渲染所有页面，长文档瞬间卡死",
    detail: "打开 20~50 页的长篇学术论文或毕业设计时，reader.js 使用 for 循环一口气同时渲染所有页面的 Canvas 和 TextLayer，造成浏览器主线程严重阻塞、内存占用飙升数 GB 甚至崩溃卡死。",
    severity: 'CRITICAL'
  }
);

// 5.2 缩放导致全页面销毁与滚动位置丢失
const zoomReRenderAll = readerJsContent.includes('async function reRenderAll()') && readerJsContent.includes("pdfViewer.innerHTML = ''");
check(
  !zoomReRenderAll,
  "PDF 缩放采用平滑 CSS 变换或保留当前阅读位置",
  {
    category: '交互缺陷',
    title: "缩放操作（Zoom）清空整个 DOM 重绘，阅读进度瞬间丢失",
    detail: "点击放大或缩小按钮时，reRenderAll() 暴力将 pdfViewer.innerHTML 置空并从第 1 页重新渲染，导致用户已滚动的阅读位置强制跳回顶部，且已生成的双语对照状态被完全摧毁。",
    severity: 'HIGH'
  }
);

// 5.3 强制 PDF 劫持 (autoInterceptPdf: true)
const backgroundSettings = backgroundJsContent.includes('autoInterceptPdf: true');
check(
  !backgroundSettings,
  "默认不强制劫持浏览器原生 PDF 浏览",
  {
    category: '流氓行为',
    title: "默认强制劫持用户访问的所有网络 PDF 链接",
    detail: "autoInterceptPdf 默认值为 true，只要用户点击任意 PDF 链接，后台无脑重定向到插件阅读器，严重打扰只需要快速浏览原生 PDF 或使用其他阅读器的用户。",
    severity: 'HIGH'
  }
);

// 5.4 双栏排版聚类混乱
const clustersPureY = readerJsContent.includes('Math.abs(y - currentY) > 3');
check(
  !clustersPureY,
  "PDF 段落提取支持双栏排版（X 坐标分栏检测）",
  {
    category: '排版缺陷',
    title: "双栏论文段落提取算法将左右两栏文本交叉混成同一行",
    detail: "clusterPdfTextIntoParagraphs 仅按 Y 坐标聚合文本，在 IEEE/ACM 等典型双栏学术论文排版中，左栏第 1 行与右栏第 1 行 Y 坐标相同，被直接拼接到同一个句子中，导致段落内容完全乱套。",
    severity: 'HIGH'
  }
);


// ----------------------------------------------------
// 6. 生词本与复习工具缺失 (Vocabulary Notebook & History)
// ----------------------------------------------------
console.log('\n【模块 6: 论文生词本与历史记录缺失】');

const hasHistory = popupJsContent.includes('searchHistory') || contentJsContent.includes('saveToNotebook');
const hasNotebook = contentJsContent.includes('btn-star') || contentJsContent.includes('addToWordBook');
check(
  hasHistory && hasNotebook,
  "具备查词历史记录与一键加入生词本功能",
  {
    category: '核心功能缺失',
    title: "完全缺失生词本（Wordbook）与历史记录（History）",
    detail: "学术论文阅读者的核心目的之一是积累学术词汇。插件既没有记录用户查过哪些词，也没有提供“收藏/加入生词本”的星标按钮，无法导出到 Anki 或本地 CSV，查完即忘，毫无学习闭环。",
    severity: 'HIGH'
  }
);

// ----------------------------------------------------
// 7. 深色模式与视觉舒适度 (Dark Mode Support)
// ----------------------------------------------------
console.log('\n【模块 7: 深色模式与视觉适应】');

const contentCss = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
const hasDarkMode = contentCss.includes('prefers-color-scheme: dark') || contentCss.includes('dark-mode');
check(
  hasDarkMode,
  "悬浮卡片与界面支持自适应系统深色模式",
  {
    category: '人性化设计',
    title: "完全不支持深色模式（Dark Mode），夜间阅读极度刺眼",
    detail: "卡片与弹窗采用强硬的纯白底色 (#ffffff)，在用户使用 Dark Reader、系统暗色主题或夜间阅读论文时，强白光弹窗刺眼，视觉体验极不人性化。",
    severity: 'MEDIUM'
  }
);

console.log('\n====================================================');
console.log(`  诊断完毕！共排查出 ${totalIssues} 项严重影响人性化体验的关键缺陷`);
console.log('====================================================\n');
