// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { StorybookConfig } from '@storybook/angular';

// Keep story-only Tailwind utilities in both interactive and static Storybook builds.
process.env['LFX_STORYBOOK_BUILD'] = 'true';

const require = createRequire(import.meta.url);

// Yarn nests @storybook/angular under apps/lfx-one while `storybook` is hoisted to the root, so a bare
// package name cannot be resolved from storybook's own location. Absolute paths always can.
const getAbsolutePath = (packageName: string): string => dirname(require.resolve(join(packageName, 'package.json')));

const config: StorybookConfig = {
  // The uikit library plus one explicit app-level recovery integration harness.
  // Keep feature/PrimeNG dependencies outside shared/uikit; do not glob all features.
  stories: ['../src/app/shared/uikit/**/*.stories.ts', '../src/app/shared/components/chunk-load-recovery/chunk-load-recovery-drawer.stories.ts'],
  addons: [getAbsolutePath('@storybook/addon-docs')],
  framework: getAbsolutePath('@storybook/angular'),
};

export default config;
