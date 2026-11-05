import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export default defineConfig({
  root: here, publicDir: path.join(root, 'public'), envDir: here, envPrefix: 'PROFILE_MENU_PREVIEW_',
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.join(root, 'src') } },
  cacheDir: path.join(root, 'node_modules/.vite-profile-menu'),
  server: { host: '127.0.0.1', port: 5215, strictPort: true, fs: { allow: [root] } },
});
