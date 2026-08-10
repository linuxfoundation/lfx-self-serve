// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideZonelessChangeDetection } from '@angular/core';

/**
 * Providers installed into every app-side spec's TestBed by the `test` target
 * (`providersFile` in angular.json).
 *
 * `provideZonelessChangeDetection` is not optional here: the application is
 * zoneless (see `src/app/app.config.ts`), zone.js is not a dependency, and a
 * TestBed left on the default zone-based scheduler would either fail to boot or
 * — worse — pass tests under change-detection semantics the app does not use.
 * Putting it here rather than in each spec's `configureTestingModule` means a
 * new spec cannot forget it and silently test a different application.
 *
 * Keep this list to providers that are true of EVERY spec. Anything a
 * particular spec needs (an HTTP testing backend, a router harness, a fake
 * service) belongs in that spec, where the reader can see it.
 */
export default [provideZonelessChangeDetection()];
