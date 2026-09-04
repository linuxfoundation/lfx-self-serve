// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, provideZonelessChangeDetection } from '@angular/core';
import { provideClientHydration, withEventReplay, withIncrementalHydration } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withInMemoryScrolling, withPreloading } from '@angular/router';
import { lfxCardTheme, lfxDataTableTheme } from '@lfx-one/shared';
import { lfxPreset } from '@linuxfoundation/lfx-ui-core';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { authenticationInterceptor } from '@shared/interceptors/authentication.interceptor';
import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { DialogService } from 'primeng/dynamicdialog';

import { routes } from './app.routes';
import { provideDataDogRum } from './shared/providers/datadog-rum.provider';
import { provideFeatureFlags } from './shared/providers/feature-flag.provider';
import { provideRuntimeConfig } from './shared/providers/runtime-config.provider';
import { ChunkLoadErrorHandler } from './shared/utils/chunk-load-error.handler';
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
    { provide: ErrorHandler, useClass: ChunkLoadErrorHandler },
    provideRouter(routes, withPreloading(CustomPreloadingStrategy), withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' })),
    // `includeHeaders` selects which *response* headers get serialized into the transfer cache
    // state — it has no effect on which requests are eligible for caching. The prior
    // `includeHeaders: ['Authorization']` was the wrong option for its intended purpose (a no-op)
    // and mildly harmful, since it would have opted an `Authorization` response header into the
    // serialized SSR HTML.
    provideClientHydration(withEventReplay(), withIncrementalHydration()),
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
    provideDataDogRum(),
    provideFeatureFlags(),
    ConfirmationService,
    DialogService,
    MessageService,
  ],
};
