import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export default defineConfig({
  root: here, publicDir: path.join(root, 'public'), envDir: here, envPrefix: 'PROFILE_MENU_PREVIEW_',
  esbuild: { jsx: 'automatic' },
  resolve: { alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(here, 'fixtureSupabase.ts') },
    { find: /^@\/components\/social\/appSocial$/, replacement: path.join(here, 'fixtureSocial.ts') },
    { find: /^(\.\/|\.\.\/social\/)appSocial$/, replacement: path.join(here, 'fixtureSocial.ts') },
    { find: /^@\/lib\/gameStats$/, replacement: path.join(here, 'fixtureStats.ts') },
    { find: '@', replacement: path.join(root, 'src') },
  ] },
  define: { 'import.meta.env.VITE_CROSSPUNS_STANDINGS': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_INVITE_PERMISSIONS': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_OWNER_ACTIONS': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_DESCRIPTIONS': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_ORDER': JSON.stringify('true'), 'import.meta.env.VITE_SOCIAL_PREFERENCES': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_PNG': JSON.stringify('true'), 'import.meta.env.VITE_SHARED_SOCIAL': JSON.stringify('beta'), 'import.meta.env.VITE_PLATFORM_DISCOVERY_URL': JSON.stringify('http://127.0.0.1:9/fixture') },
  cacheDir: path.join(root, '.local-cache/results-review'),
  server: { host: '127.0.0.1', port: 5247, strictPort: true, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
});
