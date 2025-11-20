// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Initialize console override BEFORE any other imports to catch all errors
import { initializeConsoleOverride } from './app/shared/utils/console-override';

initializeConsoleOverride();

import { bootstrapApplication } from '@angular/platform-browser';
import '@linuxfoundation/lfx-ui-core';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
