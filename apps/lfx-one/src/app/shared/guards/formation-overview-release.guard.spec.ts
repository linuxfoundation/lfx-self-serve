// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ProjectContextService } from '@shared/services/project-context.service';
import { describe, expect, it, vi } from 'vitest';

import { formationOverviewReleaseGuard } from './formation-overview-release.guard';

describe('formationOverviewReleaseGuard', () => {
  it("clears the redirect guard's fail-open record when navigation leaves the overview, and never blocks", () => {
    const setFormationOverviewAllowedSlug = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: ProjectContextService, useValue: { setFormationOverviewAllowedSlug } }] });

    const result = TestBed.runInInjectionContext(() => formationOverviewReleaseGuard({}, {} as never, {} as never, {} as never));

    expect(setFormationOverviewAllowedSlug).toHaveBeenCalledWith(null);
    expect(result).toBe(true);
  });
});
