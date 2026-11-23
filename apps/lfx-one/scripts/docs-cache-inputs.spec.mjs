// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);
const turboPackage = require.resolve('turbo/package.json');
const turboBin = resolve(dirname(turboPackage), require(turboPackage).bin.turbo);
const rootTasks = JSON.parse(readFileSync(resolve(repoRoot, 'turbo.json'), 'utf8')).tasks;
const appScripts = JSON.parse(readFileSync(resolve(repoRoot, 'apps/lfx-one/package.json'), 'utf8')).scripts;
const docsTasks = Object.keys(rootTasks).filter((task) => rootTasks[task].cache !== false && appScripts[task]?.includes('yarn docs:build'));

function plan(directory) {
  // Dry runs resolve real task inputs and hashes without executing any build or test task.
  const output = execFileSync(process.execPath, [turboBin, 'run', ...docsTasks, '--dry=json'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
  });
  return JSON.parse(output).tasks;
}

describe('documentation cache inputs (#5692)', () => {
  const fixtures = [];

  afterEach(() => {
    for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('invalidates docs-generating app tasks, but not shared tasks, after an article edit', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'lfx-docs-cache-'));
    fixtures.push(directory);
    for (const path of [
      'package.json',
      'yarn.lock',
      '.gitignore',
      'turbo.json',
      'apps/lfx-one/package.json',
      'apps/lfx-one/turbo.json',
      'packages/shared/package.json',
    ]) {
      mkdirSync(dirname(resolve(directory, path)), { recursive: true });
      copyFileSync(resolve(repoRoot, path), resolve(directory, path));
    }
    mkdirSync(resolve(directory, 'apps/lfx-one/src'), { recursive: true });
    writeFileSync(resolve(directory, 'apps/lfx-one/src/main.ts'), 'export {};\n');
    mkdirSync(resolve(directory, 'docs/user/committees/example'), { recursive: true });
    const article = resolve(directory, 'docs/user/committees/example/index.md');
    writeFileSync(article, '# Example\n\nOriginal instructions.\n');
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    execFileSync('git', ['add', '.'], { cwd: directory });

    const before = plan(directory);
    writeFileSync(article, '# Example\n\nUpdated instructions.\n');
    const after = plan(directory);

    expect(docsTasks).toEqual(['build', 'build:development', 'build:production', 'build:staging', 'check-types', 'test']);
    for (const name of docsTasks) {
      const appBefore = before.find((task) => task.taskId === `lfx-one-ui#${name}`);
      const appAfter = after.find((task) => task.taskId === `lfx-one-ui#${name}`);
      expect(appAfter.inputs).toHaveProperty('../../docs/user/committees/example/index.md');
      expect(appAfter.inputs).toHaveProperty('src/main.ts');
      expect(appAfter.hash, `${name} must include article contents in its cache key`).not.toBe(appBefore.hash);
      expect(appAfter.resolvedTaskDefinition.dependsOn).toEqual(rootTasks[name].dependsOn);
      expect(appAfter.resolvedTaskDefinition.outputs).toEqual(rootTasks[name].outputs ?? []);
      if (rootTasks[name].inputs?.includes('.env*')) {
        expect(appAfter.resolvedTaskDefinition.inputs).toContain('.env*');
      }

      const sharedBefore = before.find((task) => task.taskId === `@lfx-one/shared#${name}`);
      const sharedAfter = after.find((task) => task.taskId === `@lfx-one/shared#${name}`);
      expect(sharedAfter.hash, `docs-only changes must not invalidate shared ${name}`).toBe(sharedBefore.hash);
      expect(sharedAfter.inputs).not.toHaveProperty('../../docs/user/committees/example/index.md');
    }
  }, 60_000);
});
