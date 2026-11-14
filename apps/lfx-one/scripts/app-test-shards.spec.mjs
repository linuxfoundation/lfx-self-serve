// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { createAppTestShards, parseShard } from './lib/app-test-shards.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('parseShard', () => {
  it('accepts one-based shards', () => {
    expect(parseShard('1/4')).toEqual({ index: 1, count: 4 });
    expect(parseShard('4/4')).toEqual({ index: 4, count: 4 });
  });

  it.each(['0/4', '5/4', '1/0', '1', '1/4oops', '-1/4', '1.5/4', '01/4', '1/9007199254740992', undefined])('rejects %s', (value) => {
    expect(() => parseShard(value)).toThrow();
  });
});

describe('createAppTestShards', () => {
  it('covers every file exactly once and does not depend on discovery order', () => {
    const files = ['new.spec.ts', 'c.spec.ts', 'a.spec.ts', 'b.spec.ts', 'd.spec.ts'];
    const plan = createAppTestShards(files, 4);
    expect(plan.flatMap((shard) => shard.files).sort()).toEqual([...files].sort());
    expect(plan.every((shard) => shard.files.length > 0)).toBe(true);
    expect(createAppTestShards([...files].reverse(), 4)).toEqual(plan);
  });

  it('balances expensive files instead of putting them in the same directory shard', () => {
    const files = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'new.spec.ts'];
    expect(createAppTestShards(files, 2, { 'a.spec.ts': 20, 'b.spec.ts': 19 })).toEqual([
      { files: ['a.spec.ts', 'new.spec.ts'], seconds: 21 },
      { files: ['b.spec.ts', 'c.spec.ts'], seconds: 20 },
    ]);
  });

  it('ignores timings for deleted files and uses a default for new files', () => {
    expect(createAppTestShards(['new.spec.ts'], 1, { 'deleted.spec.ts': 99 })).toEqual([{ files: ['new.spec.ts'], seconds: 1 }]);
  });

  it.each([0, -1, 1.5, 3, NaN])('rejects invalid or empty shard counts (%s)', (count) => {
    expect(() => createAppTestShards(['a.spec.ts', 'b.spec.ts'], count)).toThrow();
  });

  it('rejects empty discovery, duplicates, and invalid timing data', () => {
    expect(() => createAppTestShards([], 1)).toThrow();
    expect(() => createAppTestShards(['a', 'a'], 1)).toThrow('Duplicate');
    for (const value of [0, -1, NaN, Infinity, '10']) {
      expect(() => createAppTestShards(['a'], 1, { a: value })).toThrow('Invalid duration');
    }
  });
});

describe('shard CLI', () => {
  function run(...args) {
    return spawnSync(process.execPath, [join(APP_ROOT, 'scripts/run-app-test-shard.mjs'), ...args], { cwd: APP_ROOT, encoding: 'utf8' });
  }

  it('lists an exhaustive disjoint partition of the actual frontend specs without executing tests', () => {
    const selected = [1, 2, 3, 4].flatMap((index) => {
      const result = run(`${index}/4`, '--list');
      expect(result.status, result.stderr).toBe(0);
      const paths = result.stdout.split('\n').filter((line) => line.startsWith('src/'));
      expect(paths.length).toBeGreaterThan(0);
      return paths;
    });
    const disk = readdirSync(join(APP_ROOT, 'src/app'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
      .map((entry) => relative(APP_ROOT, join(entry.parentPath, entry.name)).split(sep).join('/'));
    expect(selected.sort()).toEqual(disk.sort());
    expect(new Set(selected).size).toBe(disk.length);
  });

  it('fails rather than ignoring invalid arguments', () => {
    expect(run('0/4', '--list').status).toBe(1);
    expect(run('1/4', '--unknown').status).toBe(1);
  });

  it.each([{ include: ['src/**/*.spec.ts'] }, { exclude: ['src/app/shared/**'] }, { builder: 'another:builder' }, { defaultConfiguration: 'ci' }])(
    'fails closed when the Angular discovery contract changes (%j)',
    async (change) => {
      vi.resetModules();
      const fs = await vi.importActual('node:fs');
      vi.doMock('node:fs', () => ({
        ...fs,
        readFileSync: (file, encoding) => {
          const contents = fs.readFileSync(file, encoding);
          if (!file.endsWith('angular.json')) return contents;
          const config = JSON.parse(contents);
          const target = config.projects['lfx-one'].architect.test;
          Object.assign(target.options, change);
          if (change.builder) target.builder = change.builder;
          if (change.defaultConfiguration) target.defaultConfiguration = change.defaultConfiguration;
          return JSON.stringify(config);
        },
      }));
      const argv = process.argv;
      const exitCode = process.exitCode;
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        process.argv = ['node', 'run-app-test-shard.mjs', '1/4', '--list'];
        await import('./run-app-test-shard.mjs');
        expect(process.exitCode).toBe(1);
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Angular test discovery changed'));
      } finally {
        process.argv = argv;
        process.exitCode = exitCode;
        errorLog.mockRestore();
        vi.doUnmock('node:fs');
        vi.resetModules();
      }
    }
  );

  it('passes only selected files to Angular and propagates failures and signals', async () => {
    vi.resetModules();
    const spawn = vi.fn().mockReturnValue({ status: 7, signal: null });
    vi.doMock('node:child_process', () => ({ spawnSync: spawn }));
    const argv = process.argv;
    const exitCode = process.exitCode;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      process.argv = ['node', 'run-app-test-shard.mjs', '1/4'];
      await import('./run-app-test-shard.mjs');
      const [command, args, options] = spawn.mock.calls[0];
      expect(command).toBe('yarn');
      expect(args.slice(0, 2)).toEqual(['test:app', '--watch=false']);
      expect(args.slice(2).every((arg) => arg.startsWith('--include=src/app/') && arg.endsWith('.spec.ts'))).toBe(true);
      expect(options).toMatchObject({ cwd: APP_ROOT, shell: false, stdio: 'inherit' });
      expect(process.exitCode).toBe(7);

      vi.resetModules();
      spawn.mockReturnValue({ status: null, signal: 'SIGTERM' });
      await import('./run-app-test-shard.mjs');
      expect(process.exitCode).toBe(1);
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('SIGTERM'));

      vi.resetModules();
      spawn.mockReturnValue({ status: null, error: new Error('Failed to start yarn') });
      await import('./run-app-test-shard.mjs');
      expect(process.exitCode).toBe(1);
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Failed to start yarn'));
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      log.mockRestore();
      errorLog.mockRestore();
      vi.doUnmock('node:child_process');
      vi.resetModules();
    }
  });
});
