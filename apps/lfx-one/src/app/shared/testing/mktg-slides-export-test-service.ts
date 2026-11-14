// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { Injector, Provider } from '@angular/core';
import { MktgSlidesExportService } from '@services/mktg-slides-export.service';

/** The export client's HTTP calls a spec stubs. */
export type MktgSlidesExportHttpStub = Pick<MktgSlidesExportService, 'last' | 'start' | 'poll'>;

/**
 * Provides the real export client — its in-flight registry and the `run`
 * that composes start and poll — with its HTTP calls (`last`, `start`,
 * `poll`) replaced by the spec's stubs. The client is built in an injector of
 * its own with no HttpClient behind it, so the spec's own HTTP providers are
 * left as they are; a call the stubs do not cover fails loudly.
 */
export function provideMktgSlidesExportStub(stub: MktgSlidesExportHttpStub): Provider {
  return {
    provide: MktgSlidesExportService,
    useFactory: () => {
      const injector = Injector.create({
        providers: [
          { provide: HttpClient, useValue: null },
          { provide: MktgSlidesExportService, useClass: MktgSlidesExportService, deps: [] },
        ],
      });
      return Object.assign(injector.get(MktgSlidesExportService), stub);
    },
  };
}
