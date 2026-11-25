// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { OrgLensFoundationRow } from '@lfx-one/shared/interfaces';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FoundationRowComponent } from './foundation-row.component';

const row = (rowKind: OrgLensFoundationRow['rowKind'] = 'member'): OrgLensFoundationRow => ({
  foundationId: 'f-1',
  foundationSlug: 'cncf',
  foundationName: 'Example Foundation',
  foundationLogoUrl: null,
  rowKind,
  membershipTierClass: null,
  membershipTierDisplayName: null,
  projectCount: 2,
  badges: { orgRole: 'Member', votingStatus: 'Voting', governanceParticipation: 'Active', governanceAttendancePct: 0.5 },
  projects: [],
});

describe('FoundationRowComponent navigation', () => {
  let fixture: ComponentFixture<FoundationRowComponent>;
  let navigate: ReturnType<typeof vi.spyOn>;

  const render = async (navigable: boolean, kind: OrgLensFoundationRow['rowKind'] = 'member'): Promise<HTMLElement> => {
    fixture = TestBed.createComponent(FoundationRowComponent);
    fixture.componentRef.setInput('row', row(kind));
    fixture.componentRef.setInput('navigable', navigable);
    fixture.detectChanges();
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).querySelector('tr') as HTMLElement;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FoundationRowComponent],
      providers: [provideRouter([]), { provide: OrgLensNavigationService, useValue: { orgLensLink: (...segments: string[]) => ['/company', ...segments] } }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  it('opens the Memberships page from the row, by click and by keyboard, as before', async () => {
    const tr = await render(true);

    expect(tr.getAttribute('role')).toBe('button');
    tr.click();
    tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith(['/company', 'memberships']);
  });

  it('is not a link in the all employee view: no button role, no tab stop, no navigation by click or keyboard', async () => {
    const tr = await render(false);

    expect(tr.getAttribute('role')).toBeNull();
    expect(tr.getAttribute('tabindex')).toBeNull();
    expect(tr.className).toContain('cursor-default');
    tr.click();
    tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the project expansion control working when the row is not navigable', async () => {
    const tr = await render(false);
    const toggled = vi.fn();
    fixture.componentInstance.toggle.subscribe(toggled);

    (tr.querySelector('[data-testid$="-caret"]') as HTMLButtonElement).click();

    expect(toggled).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('never navigates from an outside-LF row', async () => {
    const tr = await render(true, 'outside_lf');

    tr.click();

    expect(navigate).not.toHaveBeenCalled();
  });
});
