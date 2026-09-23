/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Lists every file of the built site (except the narration, which has its own manifest) with
 * its size and sha256, so "Save for offline" can download and verify exactly this build.
 */
function appFiles(): Plugin {
  let outDir = 'dist';
  return {
    name: 'fab-one-app-files',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    writeBundle() {
      const files: { path: string; bytes: number; sha256: string }[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          const rel = relative(outDir, full).split(sep).join('/');
          if (statSync(full).isDirectory()) walk(full);
          // narration audio is listed (with checksums) by each version's own manifest
          else if (rel.startsWith('narration/') && !rel.endsWith('/manifest.json')) continue;
          else if (rel !== 'app-files.json' && rel !== 'sw.js') {
            const buf = readFileSync(full);
            files.push({ path: rel, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
          }
        }
      };
      walk(outDir);
      files.sort((a, b) => a.path.localeCompare(b.path));
      const build = createHash('sha256')
        .update(files.map((f) => f.path + f.sha256).join('\n'))
        .digest('hex')
        .slice(0, 16);
      writeFileSync(join(outDir, 'app-files.json'), JSON.stringify({ build, files }, null, 1));
    },
  };
}

export default defineConfig({
  plugins: [react(), appFiles()],
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/__debug__/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 120000,
  },
});
