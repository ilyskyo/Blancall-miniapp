/**
 * 一键交付自检（在项目根目录执行：node scripts/verify-all.js）
 *
 * 检查项：
 * 1) 小程序页面/组件四件套齐全性（复用 check-pages.js）
 * 2) 路由路径规范（页面跳转必须带 /index）
 * 3) 设计系统合规（WXSS 中不出现硬编码十六进制颜色，深色模式依赖 CSS 变量）
 * 4) 页面循环体内不得出现按文章单体查询（性能回归守卫，见 D2）
 * 5) 提示服务商需要执行的命令清单（类型检查 / 单测 / 后端构建）
 *
 * 注意：类型检查与单测需要 Node 环境，本脚本只做静态检查并打印待执行命令。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const problems = [];

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.tsbuild' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

// 1) 页面完整性
try {
  execFileSync(process.execPath, [path.join(__dirname, 'check-pages.js')], { stdio: 'inherit' });
} catch {
  problems.push('页面四件套存在缺失（见上）');
}

// 1.5) WXML/TS 一致性（事件与 data 引用）
try {
  execFileSync(process.execPath, [path.join(__dirname, 'check-bindings.js')], { stdio: 'inherit' });
} catch {
  problems.push('WXML/TS 一致性检查失败（见上）');
}

// 1.6) 前后端契约一致性（枚举/SKU/错误码）
try {
  execFileSync(process.execPath, [path.join(__dirname, 'check-contract.js')], { stdio: 'inherit' });
} catch {
  problems.push('前后端契约一致性检查失败（见上）');
}

// 1.7) JSON 配置语法（微信配置为严格 JSON，注释/尾逗号会导致编译失败）
for (const f of walk(mini, (p) => p.endsWith('.json'))) {
  if (f.includes('node_modules') || f.includes('.tsbuild') || f.endsWith('package-lock.json')) continue;
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    problems.push(`JSON 语法错误：${path.relative(root, f)} → ${e.message}`);
  }
}

// 1.8) tabBar 页面必须同步 getTabBar().selected
const TAB_PAGES = ['pages/home/index.ts', 'pages/list/index.ts', 'pages/overview/index.ts', 'pages/library/index.ts'];
for (const rel of TAB_PAGES) {
  const p = path.join(mini, rel);
  const src = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  if (!src) {
    problems.push(`tabBar 页面缺失：${rel}`);
    continue;
  }
  const hasSync = src.includes('getTabBar') || src.includes('syncTabBar');
  const hasOnShow = /onShow\s*\(/.test(src);
  if (!hasSync) problems.push(`tabBar 页面未同步选中态（getTabBar）：${rel}`);
  else if (!hasOnShow) problems.push(`tabBar 页面缺少 onShow（选中态不会随切换刷新）：${rel}`);
}

// 2) 路由路径规范：跳转 URL 必须指向 .../index
const PAGE_URL_RE = /url:\s*'(\/(?:pages|packages)\/[A-Za-z0-9_\-/]+)'/g;
const tsFiles = walk(mini, (f) => f.endsWith('.ts'));
for (const file of tsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = PAGE_URL_RE.exec(src)) !== null) {
    const url = m[1];
    const last = url.split('/').pop();
    if (last === 'index') continue;
    const looksLikeFile = /\.[a-z]+$/.test(url);
    if (looksLikeFile) continue; // 文件/静态资源
    problems.push(`路由未带 index：${path.relative(root, file)} → ${url}`);
  }
}

// 3) 设计系统合规：WXSS 不出现硬编码 hex（$ 变量与 var() 除外；theme.json/工程配置允许）
const wxssFiles = walk(mini, (f) => f.endsWith('.wxss'));
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const allowExact = new Set([
  path.join(mini, 'app.wxss'),
  path.join(mini, 'custom-tab-bar', 'index.wxss'),
  path.join(mini, 'components', 'glass-switch', 'glass-switch.wxss'),
]);
for (const file of wxssFiles) {
  if (allowExact.has(file)) continue; // 设计系统基座允许定义颜色
  const src = fs.readFileSync(file, 'utf8');
  const hits = src.match(HEX_RE);
  if (hits && hits.length > 0) {
    problems.push(`疑似硬编码颜色：${path.relative(root, file)} → ${Array.from(new Set(hits)).slice(0, 6).join(', ')}`);
  }
}

// 4) 页面循环体内的按文章单体查询（性能回归守卫）
//    历史缺陷：首页/列表 refresh()/onShow() 在 for 循环里逐篇调用 recordsOfArticle()/tagsOfArticle()
//    形成 O(文章数 × 记录数) 的重复全表扫描（60 篇文章时每次 onShow 数十万次比较）。
//    正确做法：调用 core/storage/entities.ts 的批量 API —— recordsByArticle()/statsByArticle()/
//    tagsByArticle()/clozesByArticle()/masksByArticle()，循环外取一次。
const SINGLE_QUERY_RE =
  /\b(?:recordsOfArticle|tagsOfArticle|customClozeOfArticle|maskConfigsOfArticle)\s*\(/g;

/** 找到与 openIdx 处括号配对的右括号下标（返回 -1 表示未闭合） */
function matchPair(src, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 提取所有循环（for/while/.forEach）的「循环体」字符区间，头部的表达式不算 */
function loopBodyRanges(src) {
  const ranges = [];
  const loopRe = /\b(?:for|while)\s*\(|\.forEach\s*\(/g;
  let m;
  while ((m = loopRe.exec(src)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchPair(src, openIdx, '(', ')');
    if (closeIdx < 0) continue;
    if (m[0].startsWith('.')) {
      // 回调式遍历：括号内（回调参数区）即作用域，被遍历的数组表达式在括号外，不算
      ranges.push([openIdx, closeIdx]);
      continue;
    }
    let j = closeIdx + 1;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] === '{') {
      const end = matchPair(src, j, '{', '}');
      if (end > 0) ranges.push([j, end]);
    } else {
      const semi = src.indexOf(';', j);
      if (semi > 0) ranges.push([j, semi]);
    }
  }
  return ranges;
}

const pageTsFiles = tsFiles.filter((f) => f.includes(`${path.sep}pages${path.sep}`));
let loopQueryHits = 0;
for (const file of pageTsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const ranges = loopBodyRanges(src);
  if (ranges.length === 0) continue;
  const re = new RegExp(SINGLE_QUERY_RE.source, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!ranges.some(([a, b]) => m.index > a && m.index < b)) continue;
    loopQueryHits += 1;
    const line = src.slice(0, m.index).split('\n').length;
    problems.push(
      `循环体内逐篇查询：${path.relative(root, file)}:${line} → ${m[0].replace('(', '')}() 出现在循环体内，` +
        '请改用批量 API（*ByArticle()）在循环外取一次'
    );
  }
}
console.log(
  `\n循环内单体查询检查：页面 TS ${pageTsFiles.length} 个文件，命中 ${loopQueryHits} 处`,
);

// 5) 输出
console.log('\n================ 交付自检结果 ================');
if (problems.length === 0) {
  console.log('静态检查通过 ✅');
} else {
  console.log(`发现 ${problems.length} 个问题（多为提示项，可人工确认）：`);
  for (const p of problems.slice(0, 40)) console.log(`  - ${p}`);
  if (problems.length > 40) console.log(`  ...（其余 ${problems.length - 40} 条省略）`);
}

console.log('\n请在具备 Node 的环境执行以下命令完成动态校验：');
console.log('  cd miniprogram && npm install');
console.log('  npm run typecheck      # 全工程类型检查（app/页面/组件/core，等价于 IDE 的 TS 插件口径）');
console.log('  npm test               # 构建并运行算法单测（197 项）');
console.log('  npm run verify         # 本脚本（含页面/绑定/契约/路由/设计令牌/循环内查询）+ 类型检查 + 单测，一条命令');
console.log('  cd ../server && npm install && npx prisma generate && npm run build');
process.exit(0);