// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MentorshipProgramsResponse } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminComponent } from './admin.component';

describe('AdminComponent — programs load', () => {
  const page: MentorshipProgramsResponse = { data: [], total: 0 };
  let getPrograms: ReturnType<typeof vi.fn<() => Observable<MentorshipProgramsResponse>>>;

  const create = async () => {
    TestBed.overrideComponent(AdminComponent, { set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        { provide: MentorshipAdminService, useValue: { getPrograms } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AdminComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    getPrograms = vi.fn(() => throwError(() => new Error('down')));
  });

  it('flags a failed first page and clears the flag when Retry succeeds', async () => {
    const fixture = await create();
    const component = fixture.componentInstance as unknown as { programsLoadError: () => boolean; retryPrograms: () => void };

    expect(component.programsLoadError()).toBe(true);

    getPrograms.mockReturnValue(of(page));
    component.retryPrograms();
    fixture.detectChanges();

    expect(component.programsLoadError()).toBe(false);
    expect(getPrograms).toHaveBeenCalledTimes(2);
  });
});
