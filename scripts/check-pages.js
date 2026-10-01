/**
 * 校验 app.json 中声明的所有页面四件套是否齐全（.json/.wxml/.wxss/.ts）
 * 用法：node scripts/check-pages.js  （在 miniprogram 目录下执行，或传入路径）
 */

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..', 'miniprogram');
const appJsonPath = path.join(root, 'app.json');

if (!fs.existsSync(appJsonPath)) {
  console.error(`未找到 app.json：${appJsonPath}`);
  process.exit(1);
}

const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const pages = [...(app.pages || [])];
for (const pkg of app.subpackages || app.subPackages || []) {
  for (const p of pkg.pages || []) {
    pages.push(`${pkg.root}/${p}`);
  }
}

const exts = ['.json', '.wxml', '.wxss', '.ts'];
const missing = [];
let ok = 0;

for (const page of pages) {
  const base = path.join(root, page);
  const missingExts = exts.filter((ext) => !fs.existsSync(base + ext));
  if (missingExts.length > 0) missing.push(`${page} → 缺少 ${missingExts.join(', ')}`);
  else ok += 1;
}

// 组件（全局组件目录）
const components = ['components/nav-bar/nav-bar', 'components/glass-switch/glass-switch', 'components/empty-state/empty-state', 'components/lock-mask/lock-mask', 'custom-tab-bar/index'];
for (const comp of components) {
  const base = path.join(root, comp);
  const missingExts = exts.filter((ext) => !fs.existsSync(base + ext));
  if (missingExts.length > 0) missing.push(`${comp} → 缺少 ${missingExts.join(', ')}`);
  else ok += 1;
}

console.log(`页面与组件总数：${pages.length + components.length}，完整：${ok}，缺失：${missing.length}`);
if (missing.length > 0) {
  console.log('\n缺失清单：');
  for (const m of missing) console.log(`  - ${m}`);
  process.exit(1);
}
console.log('全部页面/组件四件套齐全 ✅');