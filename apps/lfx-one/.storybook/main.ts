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
  // Only the uikit library is documented here; feature modules are out of scope.
  stories: ['../src/app/shared/uikit/**/*.stories.ts'],
  addons: [getAbsolutePath('@storybook/addon-docs')],
  framework: getAbsolutePath('@storybook/angular'),
};

export default config;
