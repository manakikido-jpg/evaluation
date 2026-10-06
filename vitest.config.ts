import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // マイグレーション済みの DB の写しを 1 回だけ作る（テストはそこから読みこむ）
    globalSetup: ['test/dbTemplate.ts'],
    testTimeout: 30000,
  },
});
