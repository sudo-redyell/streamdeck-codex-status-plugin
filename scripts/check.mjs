#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginName = 'io.github.streamdeck-codex-status.sdPlugin';
const pluginRoot = path.join(root, 'plugin', pluginName);
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'));

if (packageJson.version !== manifest.Version) {
  throw new Error(`버전 불일치: package.json=${packageJson.version}, manifest=${manifest.Version}`);
}
if (manifest.CodePath !== 'index.js') throw new Error('manifest CodePath는 index.js여야 합니다.');
if (!manifest.OS?.some((entry) => entry.Platform === 'linux')) {
  throw new Error('manifest에 Linux 지원이 선언되어야 합니다.');
}
if (manifest.Actions?.length !== 6) {
  throw new Error('manifest에는 기능 3개와 라이트/다크 변형을 합친 6개 액션이 있어야 합니다.');
}

const actionIds = new Set(manifest.Actions.map((action) => action.UUID));
if (actionIds.size !== manifest.Actions.length) throw new Error('액션 UUID는 중복될 수 없습니다.');

await Promise.all([
  access(path.join(pluginRoot, manifest.CodePath)),
  access(path.join(pluginRoot, `${manifest.Icon}.svg`)),
  ...manifest.Actions.map((action) => access(path.join(pluginRoot, `${action.Icon}.svg`)))
]);

const javaScriptFiles = [
  'plugin/io.github.streamdeck-codex-status.sdPlugin/index.js',
  'plugin/io.github.streamdeck-codex-status.sdPlugin/lib/pricing.js',
  'plugin/io.github.streamdeck-codex-status.sdPlugin/lib/render.js',
  'plugin/io.github.streamdeck-codex-status.sdPlugin/lib/status.js',
  'plugin/io.github.streamdeck-codex-status.sdPlugin/lib/usage.js',
  'scripts/build.mjs',
  'scripts/check.mjs',
  'scripts/package.mjs',
  'scripts/lib/zip.mjs'
];
for (const file of javaScriptFiles) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
}

console.log('Project checks passed');
