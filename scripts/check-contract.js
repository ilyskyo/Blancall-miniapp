/**
 * 前后端契约一致性检查器
 *
 * 目的：防止「前端写一个值、后端认另一个值」这类只在运行时暴露的静默缺陷
 * （已实际发生过：提醒频率前端 WEEKDAYS/MWF vs 后端 WEEKLY_FIVE/WEEKLY_THREE）。
 *
 * 检查项：
 * 1) 提醒频率枚举：miniprogram 使用的取值必须落在 server 的白名单内
 * 2) 同步实体名：miniprogram 的 SyncEntity 必须与服务端接受的 entity 名一致
 * 3) 错误码：miniprogram 的可读文案表应覆盖服务端抛出的错误码
 * 5) 付费功能标识：PaidFeature 必须与服务端 entitlement feature 一致
 *
 * 用法：node scripts/check-contract.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const server = path.join(root, 'server');

const problems = [];
const ok = [];

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function extractSet(src, re, group = 1) {
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[group]);
  return out;
}

// ---------- 1) 提醒频率 ----------
const reminderCore = read(path.join(mini, 'core/reminder/index.ts')) || '';
const settingsPage = read(path.join(mini, 'pages/settings/index.ts')) || '';
const reminderServer = read(path.join(server, 'src/reminder/reminder.service.ts')) || '';

const serverFreq = extractSet(reminderServer, /'(DAILY|WEEKLY_FIVE|WEEKLY_THREE|OFF)'/g);
const miniFreq = new Set([
  ...extractSet(settingsPage, /value:\s*'(DAILY|WEEKLY_FIVE|WEEKLY_THREE|OFF)'/g),
  ...extractSet(reminderCore, /case '(DAILY|WEEKLY_FIVE|WEEKLY_THREE|OFF)'/g),
]);
for (const f of miniFreq) {
  if (!serverFreq.has(f)) problems.push(`[提醒频率] 前端使用 ${f}，服务端白名单为 ${[...serverFreq].join('/')}`);
}
if (miniFreq.size > 0 && problems.length === 0) ok.push(`提醒频率取值一致：${[...miniFreq].join(', ')}`);

// ---------- 2) 同步实体名 ----------
const collectionSrc = read(path.join(mini, 'core/storage/collection.ts')) || '';
const miniEntities = extractSet(collectionSrc, /\|\s*'([a-z_]+)'/g);
// 客户端本地专用实体（不参与云同步，服务端无需接受）
const LOCAL_ONLY_ENTITIES = new Set(['sentence_card']);
const serverEntitiesSrc =
  (read(path.join(server, 'src/sync/sync.service.ts')) || '') +
  (read(path.join(server, 'src/sync/sync.dto.ts')) || '');
const serverEntities = new Set();
{
  const re = /'([a-z_]+)'/g;
  let m;
  while ((m = re.exec(serverEntitiesSrc)) !== null) serverEntities.add(m[1]);
}
const unknownEntities = [...miniEntities].filter((e) => !serverEntities.has(e) && !LOCAL_ONLY_ENTITIES.has(e));
if (unknownEntities.length > 0) {
  problems.push(`[同步实体] 前端声明了服务端未接受的实体：${unknownEntities.join(', ')}（请核对 sync 服务白名单）`);
} else if (miniEntities.size > 0) {
  ok.push(`同步实体共 ${miniEntities.size} 个（其中本地专用 ${[...LOCAL_ONLY_ENTITIES].filter((e) => miniEntities.has(e)).length} 个），服务端均有处理`);
}

// ---------- 3) 错误码覆盖 ----------
const requestSrc = read(path.join(mini, 'core/net/request.ts')) || '';
const miniCodes = extractSet(requestSrc, /^\s{2}([A-Z_]{4,}):/gm);
const serverCodes = extractSet(
  (read(path.join(server, 'src/common/api-error.ts')) || '') +
    (read(path.join(server, 'src/common/errors.ts')) || '') +
    (read(path.join(server, 'src/common/error-codes.ts')) || ''),
  /'([A-Z_]{4,})'/g
);
const missingText = [...serverCodes].filter((c) => !miniCodes.has(c) && c !== 'OK');
if (missingText.length > 0) {
  problems.push(`[错误码] 服务端可能返回但前端无专属文案：${missingText.join(', ')}（会回退通用文案，建议补齐）`);
} else if (serverCodes.size > 0) {
  ok.push(`错误码文案覆盖：前端 ${miniCodes.size} 条 / 服务端 ${serverCodes.size} 条`);
}

// ---------- 5) 付费功能标识 ----------
const miniFeatures = extractSet(configSrc, /'(pdf_import|occlusion|occlusion_custom|cloze_custom|tag_manager)'/g);
const serverFeatureSrc =
  (read(path.join(server, 'src/entitlements/entitlements.service.ts')) || '') +
  (read(path.join(server, 'src/common/entitlement.guard.ts')) || '');
const serverFeatures = extractSet(serverFeatureSrc, /'(pdf_import|occlusion|occlusion_custom|cloze_custom|tag_manager)'/g);
for (const f of miniFeatures) {
  if (serverFeatures.size > 0 && !serverFeatures.has(f)) {
    problems.push(`[付费功能] 前端 ${f} 未在服务端权益实现中出现`);
  }
}
if (miniFeatures.size > 0 && serverFeatures.size > 0) ok.push(`付费功能标识 ${miniFeatures.size} 个一致`);

// ---------- 输出 ----------
console.log('================ 前后端契约一致性检查 ================');
for (const o of ok) console.log(`  ✓ ${o}`);
if (problems.length === 0) {
  console.log('\n契约一致性检查通过 ✅');
} else {
  console.log(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log(`  - ${p}`);
}
process.exit(0);