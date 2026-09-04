// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpBackend } from '@angular/common/http';
import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';

import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { SsrBaseUrlBackend } from './shared/backends/ssr-base-url.backend';

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes)), { provide: HttpBackend, useClass: SsrBaseUrlBackend }],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
