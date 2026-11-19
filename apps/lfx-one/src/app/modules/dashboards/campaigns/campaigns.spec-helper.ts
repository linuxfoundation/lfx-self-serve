// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ProjectContext } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeAll } from 'vitest';

/**
 * Selects a foundation once before a spec file's suites run. The selection lives in a cookie that
 * outlives each TestBed, and these suites were written against one an earlier suite had left there.
 */
export function seedSelectedFoundation(foundation: ProjectContext): void {
  beforeAll(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: () => undefined } },
        { provide: DialogService, useValue: { open: () => undefined } },
      ],
    });
    TestBed.inject(ProjectContextService).setFoundation(foundation, false);
    TestBed.resetTestingModule();
  });
}
