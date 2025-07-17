// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideExperimentalZonelessChangeDetection } from '@angular/core';
import { provideClientHydration, withEventReplay, withHttpTransferCacheOptions, withIncrementalHydration } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { lfxPreset } from '@linuxfoundation/lfx-ui-core';
import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';
import { authenticationInterceptor } from '@shared/interceptors/authentication.interceptor';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';

const customPreset = definePreset(Aura, {
  primitive: lfxPreset.primitive,
  semantic: lfxPreset.semantic,
  components: {
    ...lfxPreset.component,
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay(), withIncrementalHydration(), withHttpTransferCacheOptions({ includeHeaders: ['Authorization'] })),
    provideHttpClient(withFetch(), withInterceptors([authenticationInterceptor])),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: customPreset,
        options: {
          prefix: 'p',
          darkModeSelector: '.dark-mode',
          cssLayer: {
            name: 'primeng',
            order: 'tailwind-base, primeng, tailwind-utilities',
          },
        },
      },
    }),
  ],
};
