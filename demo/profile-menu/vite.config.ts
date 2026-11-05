import path from 'node:path';
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
    { find: '@', replacement: path.join(root, 'src') },
  ] },
  define: { 'import.meta.env.VITE_GROUP_PNG': JSON.stringify('true'), 'import.meta.env.VITE_SHARED_SOCIAL': JSON.stringify('beta'), 'import.meta.env.VITE_PLATFORM_DISCOVERY_URL': JSON.stringify('http://127.0.0.1:9/fixture') },
  cacheDir: path.join(root, 'node_modules/.vite-profile-menu'),
  server: { host: '127.0.0.1', port: 5215, strictPort: true, fs: { allow: [root] } },
});
