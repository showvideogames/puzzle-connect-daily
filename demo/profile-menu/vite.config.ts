import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
// The app's Tailwind config, also scanning this folder: its content globs are
// relative to the working directory and cover src only, so classes used only by
// the preview shell would otherwise never be generated.
const tailwindConfig = loadConfig(path.join(root, 'tailwind.config.ts'));
const tailwindContent = [path.join(root, 'src/**/*.{ts,tsx}'), path.join(here, '*.{ts,tsx,html}')].map(glob => glob.replaceAll('\\', '/'));
export default defineConfig({
  root: here, publicDir: path.join(root, 'public'), envDir: here, envPrefix: 'PROFILE_MENU_PREVIEW_',
  esbuild: { jsx: 'automatic' },
  css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig, content: tailwindContent }), autoprefixer()] } },
  resolve: { alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(here, 'fixtureSupabase.ts') },
    { find: /^@\/components\/social\/appSocial$/, replacement: path.join(here, 'fixtureSocial.ts') },
    { find: /^(\.\/|\.\.\/social\/)appSocial$/, replacement: path.join(here, 'fixtureSocial.ts') },
    { find: '@', replacement: path.join(root, 'src') },
  ] },
  define: { 'import.meta.env.VITE_CROSSPUNS_STANDINGS': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_INVITE_PERMISSIONS': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_OWNER_ACTIONS': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_DESCRIPTIONS': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_ORDER': JSON.stringify('true'), 'import.meta.env.VITE_SOCIAL_PREFERENCES': JSON.stringify('true'), 'import.meta.env.VITE_GROUP_PNG': JSON.stringify('true'), 'import.meta.env.VITE_SHARED_SOCIAL': JSON.stringify('beta'), 'import.meta.env.VITE_PLATFORM_DISCOVERY_URL': JSON.stringify('http://127.0.0.1:9/fixture') },
  cacheDir: path.join(root, '.preview-cache'),
  server: { host: '127.0.0.1', port: 5261, strictPort: true, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
});
