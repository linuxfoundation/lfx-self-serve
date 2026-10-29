// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { setCompodocJson } from '@storybook/addon-docs/angular';
import type { Preview } from '@storybook/angular';

import docJson from '../documentation.json';

setCompodocJson(docJson);

const preview: Preview = {
  tags: ['autodocs'],
  parameters: {
    controls: { expanded: true },
  },
};

export default preview;
