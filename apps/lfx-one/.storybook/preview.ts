// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideZonelessChangeDetection } from '@angular/core';
import { applicationConfig, type Preview } from '@storybook/angular';

const preview: Preview = {
  // The app is zoneless, so stories run under the same change detection.
  decorators: [applicationConfig({ providers: [provideZonelessChangeDetection()] })],
  tags: ['autodocs'],
  parameters: {
    controls: { expanded: true },
  },
};

export default preview;
