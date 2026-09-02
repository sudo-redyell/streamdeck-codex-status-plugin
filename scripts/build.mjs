#!/usr/bin/env node

import { build } from 'esbuild';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginName = 'io.github.streamdeck-codex-status.sdPlugin';
const source = path.join(root, 'plugin', pluginName);
const destination = path.join(root, 'dist', pluginName);

await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await build({
  bundle: true,
  entryPoints: [path.join(source, 'index.js')],
  format: 'cjs',
  legalComments: 'none',
  minify: false,
  outfile: path.join(destination, 'index.js'),
  platform: 'node',
  target: 'node18'
});
await chmod(path.join(destination, 'index.js'), 0o755);
await cp(path.join(source, 'icons'), path.join(destination, 'icons'), { recursive: true });
await cp(path.join(source, 'manifest.json'), path.join(destination, 'manifest.json'));
await writeFile(path.join(destination, 'LICENSE'), await readFile(path.join(root, 'LICENSE'), 'utf8'));

console.log(`Built dist/${pluginName}`);
