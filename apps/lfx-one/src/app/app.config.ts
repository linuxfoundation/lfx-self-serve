// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideClientHydration, withEventReplay, withHttpTransferCacheOptions, withIncrementalHydration } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withInMemoryScrolling, withPreloading } from '@angular/router';
import { lfxPreset } from '@linuxfoundation/lfx-ui-core';
import { lfxCardTheme, lfxDataTableTheme } from '@lfx-one/shared';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { authenticationInterceptor } from '@shared/interceptors/authentication.interceptor';
import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { DialogService } from 'primeng/dynamicdialog';

import { routes } from './app.routes';
import { provideFeatureFlags } from './shared/providers/feature-flag.provider';
import { provideRuntimeConfig } from './shared/providers/runtime-config.provider';
import { CustomPreloadingStrategy } from './shared/strategies/custom-preloading.strategy';

const customPreset = definePreset(Aura, {
  primitive: lfxPreset.primitive,
  semantic: lfxPreset.semantic,
  components: {
    ...lfxPreset.component,
    card: lfxCardTheme,
    datatable: lfxDataTableTheme,
  } as any,
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withPreloading(CustomPreloadingStrategy), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
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
    provideRuntimeConfig(), // Must be before other providers that depend on runtime config
    provideFeatureFlags(),
    ConfirmationService,
    DialogService,
    MessageService,
  ],
};
