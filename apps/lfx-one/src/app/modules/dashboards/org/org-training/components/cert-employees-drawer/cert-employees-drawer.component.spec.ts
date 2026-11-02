// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ORG_CERT_IN_PROGRESS_WINDOW_NOTE } from '@lfx-one/shared/constants';
import type { OrgCertEmployeeStatus } from '@lfx-one/shared/interfaces';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { PersonDetailDrawerService } from '@shared/services/person-detail-drawer.service';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CertEmployeesDrawerComponent } from './cert-employees-drawer.component';

async function render(status: OrgCertEmployeeStatus): Promise<void> {
  await TestBed.configureTestingModule({
    imports: [CertEmployeesDrawerComponent],
    providers: [
      provideNoopAnimations(),
      { provide: OrgLensTrainingService, useValue: { getCertificationEmployees: vi.fn(() => of({ total: 0, data: [] })) } },
      { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CertEmployeesDrawerComponent);
  fixture.componentRef.setInput('visible', true);
  fixture.componentRef.setInput('orgUid', 'org-1');
  fixture.componentRef.setInput('courseId', 'course-1');
  fixture.componentRef.setInput('certificationName', 'Course One');
  fixture.componentRef.setInput('status', status);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const note = (): Element | null => document.querySelector('[data-testid="cert-employees-window-note"]');

describe('CertEmployeesDrawerComponent enrollment window note', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('states the enrollment window on the in-progress roster', async () => {
    await render('in-progress');

    expect(note()?.textContent?.trim()).toBe(ORG_CERT_IN_PROGRESS_WINDOW_NOTE);
  });

  it('does not show it on the certified roster, which is not windowed', async () => {
    await render('certified');

    expect(document.querySelector('[data-testid="cert-employees-drawer"]')).not.toBeNull();
    expect(note()).toBeNull();
  });
});
