import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export default defineConfig({ root, resolve: { alias: { '@': path.join(root, 'src') } }, test: { environment: 'node', include: ['shared-service/tests/*.test.ts'], maxWorkers: 1 } });
