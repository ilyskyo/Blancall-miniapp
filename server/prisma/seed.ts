/**
 * Prisma seed
 * 本项目无需预置数据，保留空实现以兼容 package.json 的 prisma.seed 配置。
 */
async function main(): Promise<void> {
  // 本项目无需预置数据
  // eslint-disable-next-line no-console
  console.log('[seed] 无 seed 数据，跳过');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[seed] 失败：', e);
    process.exitCode = 1;
  });
