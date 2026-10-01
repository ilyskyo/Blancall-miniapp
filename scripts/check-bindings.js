/**
 * 小程序 WXML / TS 一致性检查器
 *
 * 检查项（都是运行时才会暴露、编译器查不出的问题）：
 * 1) WXML 中 bind / catch 绑定的事件处理函数，是否在同目录 .ts 中定义
 * 2) WXML 中 {{...}} 引用的顶层 data 字段，是否在 .ts 的 data 中声明（启发式，排除 wx:for 别名与字面量）
 * 3) 页面/组件 .json 的 usingComponents 引用的组件路径是否存在
 * 4) WXML 使用到的自定义组件标签，是否已在 usingComponents 中声明
 * 5) <wxs> 引入与 module 使用
 * 6) 练习引擎不变量：业务代码（非测试）不得出现字面量句子归因 `sentenceIndex: 0`
 *
 * 用法：node scripts/check-bindings.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'miniprogram');
const problems = [];
const stats = { files: 0, handlers: 0, dataRefs: 0 };

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.tsbuild' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(root);
const wxmlFiles = allFiles.filter((f) => f.endsWith('.wxml'));

// ---------- 工具 ----------

/** 去掉注释，避免误报 */
function stripComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

/** 解析事件绑定：bindtap="x"、bind:tap="x"、catchtap="x"、capture-bind:tap="x" */
function extractHandlers(wxml) {
  const out = new Set();
  const re = /(?:capture-)?(?:bind|catch)[:\-]?([a-zA-Z]+)\s*=\s*"([^"{}]+)"/g;
  let m;
  while ((m = re.exec(wxml)) !== null) {
    const handler = m[2].trim();
    if (handler) out.add(handler);
  }
  return out;
}

/** 小程序内置组件（含连字符的），不属于自定义组件 */
const BUILTIN_TAGS = new Set([
  'scroll-view', 'swiper-item', 'movable-view', 'movable-area', 'cover-view', 'cover-image',
  'rich-text', 'picker-view', 'picker-view-column', 'checkbox-group', 'radio-group', 'web-view',
  'open-data', 'functional-page-navigator', 'official-account', 'navigation-bar', 'page-meta',
  'match-media', 'keyboard-accessory', 'page-container', 'share-element', 'root-portal',
  'ad-custom', 'voip-room', 'channel-live', 'channel-video', 'aria-component', 'grid-view',
  'list-view', 'sticky-header', 'sticky-section', 'snapshot', 'span', 'text-area',
]);

/** 从 .ts 中提取 methods/顶层函数名（启发式） */
function extractTsIdentifiers(ts) {
  const ids = new Set();
  const patterns = [
    // 允许 async / 生成器 前缀
    /^\s{2,}(?:async\s+)?(?:static\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm, // foo(  / async foo(
    /^\s{2,}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*:\s*(?:async\s*)?\(/gm, // foo: (
    /^\s{2,}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*:\s*(?:async\s*)?function/gm, // foo: function
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(ts)) !== null) ids.add(m[1]);
  }
  let m;
  const fnRe = /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/gm;
  while ((m = fnRe.exec(ts)) !== null) ids.add(m[1]);
  return ids;
}

/** 从 .ts 的 data 与 properties 块提取字段名（只取第一层） */
function extractDataFields(ts) {
  const ids = new Set();
  const blocks = ['data', 'properties'];
  for (const key of blocks) {
    const re = new RegExp(`\\b${key}\\s*:\\s*\\{`);
    const match = re.exec(ts);
    if (!match) continue;
    let i = match.index + match[0].length;
    let depth = 1;
    const start = i;
    while (i < ts.length && depth > 0) {
      const ch = ts[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    const block = ts.slice(start, i - 1);
    let d = 0;
    for (const raw of block.split('\n')) {
      const trimmed = raw.trim();
      if (d === 0) {
        const km = /^([a-zA-Z_$][\w$]*)\s*:/.exec(trimmed);
        if (km) ids.add(km[1]);
      }
      for (const ch of raw) {
        if (ch === '{' || ch === '[' || ch === '(') d++;
        else if (ch === '}' || ch === ']' || ch === ')') d--;
      }
    }
  }
  return ids;
}

/** 提取 WXML 中 {{}} 内引用的根标识符 */
function extractMustacheRoots(wxml) {
  const roots = new Set();
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m;
  while ((m = re.exec(wxml)) !== null) {
    const expr = m[1];
    // 去掉字符串字面量
    const cleaned = expr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    const idRe = /([a-zA-Z_$][\w$]*)/g;
    let im;
    while ((im = idRe.exec(cleaned)) !== null) {
      const id = im[1];
      // 跳过关键字与常见全局
      if (['true', 'false', 'null', 'undefined', 'item', 'index', 'idx', 'in', 'of', 'typeof', 'length', 'Math', 'Number', 'String', 'JSON'].includes(id)) continue;
      // 跳过属性访问的中间段（前面紧跟 . 的）
      const before = cleaned.slice(0, im.index);
      if (/[.]$/.test(before.trim())) continue;
      // 跳过对象字面量键
      if (/[{,]\s*$/.test(before) && /^\s*:/.test(cleaned.slice(im.index + id.length))) continue;
      roots.add(id);
    }
  }
  return roots;
}

/** 提取 WXML 中用到的自定义组件标签（含 - 的标签名，排除内置） */
function extractCustomTags(wxml) {
  const tags = new Set();
  const re = /<([a-z][a-z0-9]*-[a-z0-9-]+)[\s/>]/g;
  let m;
  while ((m = re.exec(wxml)) !== null) tags.add(m[1]);
  return tags;
}

// ---------- 主流程 ----------

for (const wxmlPath of wxmlFiles) {
  stats.files += 1;
  const dir = path.dirname(wxmlPath);
  const base = path.basename(wxmlPath, '.wxml');
  const tsPath = path.join(dir, `${base}.ts`);
  const jsonPath = path.join(dir, `${base}.json`);
  const rel = path.relative(root, wxmlPath);

  const wxml = stripComments(fs.readFileSync(wxmlPath, 'utf8'));
  const ts = fs.existsSync(tsPath) ? fs.readFileSync(tsPath, 'utf8') : null;
  const json = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : {};

  // 1) 事件处理函数
  const handlers = extractHandlers(wxml);
  stats.handlers += handlers.size;
  if (ts) {
    const tsIds = extractTsIdentifiers(ts);
    for (const h of handlers) {
      if (!tsIds.has(h)) problems.push(`[事件未定义] ${rel} → ${h}() 在 ${base}.ts 中找不到`);
    }
  } else if (handlers.size > 0) {
    problems.push(`[缺少 TS] ${rel} 绑定了 ${handlers.size} 个事件但无同名 .ts`);
  }

  // 2) data 字段引用（启发式）
  if (ts) {
    const dataFields = extractDataFields(ts);
    const roots = extractMustacheRoots(wxml);
    stats.dataRefs += roots.size;
    // 页面内 wx:for 别名（猜测：item/index 已排除；其余常见别名）
    const aliasRe = /wx:for-item\s*=\s*"([^"]+)"/g;
    let am;
    while ((am = aliasRe.exec(wxml)) !== null) dataFields.add(am[1]);
    const aliasIdxRe = /wx:for-index\s*=\s*"([^"]+)"/g;
    while ((am = aliasIdxRe.exec(wxml)) !== null) dataFields.add(am[1]);
    // wxs 模块名
    const wxsRe = /<wxs[^>]*module\s*=\s*"([^"]+)"/g;
    while ((am = wxsRe.exec(wxml)) !== null) dataFields.add(am[1]);
    for (const r of roots) {
      if (!dataFields.has(r)) {
        problems.push(`[data 未声明] ${rel} → {{${r}}} 未在 ${base}.ts 的 data 中声明`);
      }
    }
  }

  // 3) usingComponents 路径存在性
  const using = json.usingComponents || {};
  for (const [tag, p] of Object.entries(using)) {
    const target = p.startsWith('/') ? path.join(root, p.slice(1)) : path.join(dir, p);
    const exists = fs.existsSync(`${target}.wxml`) && fs.existsSync(`${target}.ts`);
    if (!exists) problems.push(`[组件缺失] ${rel} → usingComponents["${tag}"] = ${p} 指向的文件不存在`);
  }

  // 4) 自定义组件标签是否已声明
  const usedTags = extractCustomTags(wxml);
  for (const tag of usedTags) {
    if (BUILTIN_TAGS.has(tag)) continue;
    if (!using[tag]) {
      if (tag === 'tab-bar' || tag === 'custom-tab-bar') continue;
      problems.push(`[组件未声明] ${rel} → <${tag}> 未在 ${base}.json 的 usingComponents 中声明`);
    }
  }
}

// ---------- 练习引擎不变量（历史缺陷防复发） ----------

/**
 * 历史缺陷：字词模式的「空位 → 句子」归因被硬编码为 0，
 * 导致跨句挖空的错题全部落到第 0 句，热力图锚点恒空（P0，见 docs/05-验收清单 6.17/6.18）。
 * 归因必须由 core/practice/blankMapping.ts 的映射计算，禁止在业务代码里写死。
 */
const srcFiles = allFiles.filter(
  (f) =>
    f.endsWith('.ts') &&
    !f.includes(`${path.sep}tests${path.sep}`) &&
    !f.includes(`${path.sep}typings${path.sep}`) &&
    (f.includes(`${path.sep}core${path.sep}`) ||
      f.includes(`${path.sep}pages${path.sep}`) ||
      f.includes(`${path.sep}packages${path.sep}`) ||
      f.includes(`${path.sep}components${path.sep}`))
);
const SENTENCE_HARDCODE_RE = /(?<![\w.])sentenceIndex\s*:\s*0\s*(?:,|\}|$)/gm;
let invariantHits = 0;
for (const file of srcFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp(SENTENCE_HARDCODE_RE.source, 'gm');
  let m;
  while ((m = re.exec(src)) !== null) {
    invariantHits += 1;
    const line = src.slice(0, m.index).split('\n').length;
    problems.push(
      `[练习引擎不变量] ${path.relative(root, file)}:${line} → 出现字面量句子归因 sentenceIndex: 0；` +
        '必须走 blankMapping.ts 的 blankIndex→sentenceIndex 映射'
    );
  }
}

// ---------- 输出 ----------

console.log('================ WXML/TS 一致性检查 ================');
console.log(`检查 WXML 文件：${stats.files}，事件绑定：${stats.handlers}，data 引用：${stats.dataRefs}`);
console.log(`练习引擎不变量：扫描 TS 文件 ${srcFiles.length}，命中字面量归因 ${invariantHits}`);
if (problems.length === 0) {
  console.log('一致性检查通过 ✅');
} else {
  const grouped = new Map();
  for (const p of problems) {
    const kind = p.slice(1, p.indexOf(']'));
    if (!grouped.has(kind)) grouped.set(kind, []);
    grouped.get(kind).push(p);
  }
  console.log(`发现 ${problems.length} 个问题：`);
  for (const [kind, list] of grouped) {
    console.log(`\n── ${kind}（${list.length}）`);
    for (const p of list.slice(0, 30)) console.log(`  ${p}`);
    if (list.length > 30) console.log(`  ...（其余 ${list.length - 30} 条省略）`);
  }
}
process.exit(0);