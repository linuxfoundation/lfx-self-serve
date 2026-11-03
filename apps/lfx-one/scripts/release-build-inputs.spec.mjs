// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import createJiti from 'jiti';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

const appRoot = resolve(import.meta.dirname, '..');

function typescriptInputs(relativePath) {
  const configPath = resolve(appRoot, relativePath);
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, resolve(configPath, '..'));
  expect(parsed.errors).toEqual([]);
  return parsed.fileNames;
}

describe('release build inputs (#4736)', () => {
  it('excludes stories from the application without removing application entrypoints', () => {
    const files = typescriptInputs('tsconfig.app.json');
    expect(files.some((file) => file.endsWith('.stories.ts'))).toBe(false);
    expect(files).toContain(resolve(appRoot, 'src/main.ts'));
    expect(files).toContain(resolve(appRoot, 'src/main.server.ts'));
    expect(files).toContain(resolve(appRoot, 'src/server/server.ts'));
  });

  it('keeps stories in the separate Storybook TypeScript configuration', () => {
    const files = typescriptInputs('.storybook/tsconfig.json');
    expect(files.some((file) => file.endsWith('.stories.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('.spec.ts'))).toBe(false);
    expect(files).toContain(resolve(appRoot, '.storybook/preview.ts'));
  });

  it('type-checks the Storybook project separately from the application in CI', () => {
    const { scripts } = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8'));
    expect(scripts['check-types']).toContain('tsc --noEmit -p tsconfig.app.json');
    expect(scripts['check-types']).toContain('tsc --noEmit -p .storybook/tsconfig.stories.json');
    const files = typescriptInputs('.storybook/tsconfig.stories.json');
    expect(files.some((file) => file.endsWith('.stories.ts'))).toBe(true);
    expect(files).not.toContain(resolve(appRoot, '.storybook/preview.ts'));
  });

  it('continues linting stories through the Storybook project while app code uses the app project', async () => {
    const eslint = new ESLint({ cwd: appRoot });
    const story = await eslint.calculateConfigForFile(resolve(appRoot, 'src/app/shared/uikit/button/button.stories.ts'));
    const component = await eslint.calculateConfigForFile(resolve(appRoot, 'src/app/shared/uikit/button/button.component.ts'));
    expect(story.languageOptions.parserOptions.project).toBe('./.storybook/tsconfig.json');
    expect(component.languageOptions.parserOptions.project).toBe('./tsconfig.app.json');
    expect(story.rules['@angular-eslint/component-selector']).toEqual(component.rules['@angular-eslint/component-selector']);
  });

  it('injects the version after dependency installation and the shared build, but before the Angular build', () => {
    const source = readFileSync(resolve(appRoot, '../../Dockerfile'), 'utf8');
    const [builder, runtime] = source.split(/^FROM node:22-alpine AS runtime$/m);
    const install = builder.indexOf('RUN yarn install --immutable');
    const buildEnvironment = builder.indexOf('ARG BUILD_ENV=production');
    const shared = builder.indexOf('RUN yarn workspace @lfx-one/shared build:${BUILD_ENV}');
    const version = builder.indexOf('ARG APP_VERSION=development');
    const environment = builder.indexOf('ENV APP_VERSION=${APP_VERSION}');
    const angular = builder.indexOf('RUN NODE_OPTIONS=');

    expect(install).toBeGreaterThan(-1);
    expect(buildEnvironment).toBeGreaterThan(install);
    expect(shared).toBeGreaterThan(buildEnvironment);
    expect(version).toBeGreaterThan(shared);
    expect(environment).toBeGreaterThan(version);
    expect(angular).toBeGreaterThan(environment);
    expect(builder.slice(0, version)).not.toContain('ENV APP_VERSION=');
    expect(runtime).toContain('ARG APP_VERSION=development\nENV APP_VERSION=${APP_VERSION}');
  });
});

describe('Tailwind story content isolation (#4736)', () => {
  const fixtures = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  // Loading the real Tailwind plugins and generating CSS competes with the full
  // server suite's workers; allow headroom beyond Vitest's unit-test default.
  it.each([false, true])(
    'includes story-only utilities only for Storybook (enabled: %s)',
    async (storybook) => {
      vi.stubEnv('LFX_STORYBOOK_BUILD', String(storybook));
      const jiti = createJiti(import.meta.url, { cache: false, requireCache: false });
      const loaded = jiti(resolve(appRoot, 'tailwind.config.js'));
      const config = loaded.default ?? loaded;
      const directory = mkdtempSync(resolve(tmpdir(), 'lfx-release-inputs-'));
      fixtures.push(directory);
      mkdirSync(resolve(directory, 'src'));
      writeFileSync(resolve(directory, 'src/example.component.html'), '<div class="w-[123px]"></div>');
      writeFileSync(resolve(directory, 'src/example.stories.ts'), 'export const template = `<div class="w-[987px]"></div>`;');
      const content = config.content.map((glob) => {
        if (glob.startsWith('!')) return `!${resolve(directory, glob.slice(1))}`;
        return resolve(directory, glob);
      });
      const { css } = await postcss([tailwindcss({ ...config, content })]).process('@tailwind utilities;', { from: undefined });

      expect(css).toContain('width: 123px');
      expect(css.includes('width: 987px')).toBe(storybook);
    },
    30000
  );

  it('enables story content when Storybook loads its configuration', () => {
    const main = readFileSync(resolve(appRoot, '.storybook/main.ts'), 'utf8');
    expect(main).toContain("process.env['LFX_STORYBOOK_BUILD'] = 'true'");
  });
});
