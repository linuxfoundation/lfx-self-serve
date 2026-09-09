// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OrgClaCoverageDialogData, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { orgClaCoverageDialogConfig, OrgEasyclaCoverageDialogComponent } from './org-easycla-coverage-dialog.component';

describe('orgClaCoverageDialogConfig', () => {
  const group: OrgClaGroup = {
    id: 'signature-uuid-1',
    claGroupName: 'Nimbus Foundation CLA',
    foundationName: 'Nimbus Foundation',
    projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
    signed: true,
    status: 'signed',
    needsClaManager: false,
    claManagersCount: 2,
  };

  it('names the agreement in the dialog header', () => {
    expect(orgClaCoverageDialogConfig(group).header).toBe('Projects covered by Nimbus Foundation CLA');
  });

  it('asks for enough width to hold the header on one line', () => {
    // Narrower than this and a typical CLA Group name wraps the header, which is what the design's
    // 560px is buying. Pinned because the value reads as arbitrary and invites being trimmed.
    expect(orgClaCoverageDialogConfig(group).width).toBe('36rem');
  });

  it('keeps the dialog within a narrow viewport', () => {
    // The preferred width is fixed and the Aura preset caps nothing, so without this the dialog is
    // wider than a phone and the list's right edge and the Close control sit off screen.
    expect(orgClaCoverageDialogConfig(group).style).toEqual({ maxWidth: '90vw' });
  });
});

describe('OrgEasyclaCoverageDialogComponent', () => {
  const closeDialog = vi.fn();

  async function render(data: OrgClaCoverageDialogData): Promise<ComponentFixture<OrgEasyclaCoverageDialogComponent>> {
    closeDialog.mockReset();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaCoverageDialogComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: DynamicDialogRef, useValue: { close: closeDialog } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaCoverageDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('lists every covered project', async () => {
    const fixture = await render({
      claGroupName: 'Acme CLA',
      projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
    });

    const names = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="org-easycla-coverage-project"]')).map((el) =>
      (el as HTMLElement).textContent?.trim()
    );
    expect(names).toEqual(['Cascade', 'Driftwood']);
  });

  it('explains when no individual projects are listed', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', projects: [] });

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-empty"]')?.textContent).toContain('No individual projects are listed');
  });

  it('drops the subset caveat when the agreement covers the foundation', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', foundationName: 'Acme Foundation', projects: [] });

    // The empty branch states the agreement covers the foundation. Showing the "not necessarily
    // every project" caveat beside it would assert the opposite legal scope in the same dialog.
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-hint"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-empty"]')?.textContent).toContain('covers the foundation');
  });

  it('warns that a named foundation is not covered in full', async () => {
    const fixture = await render({
      claGroupName: 'Acme CLA',
      foundationName: 'Acme Foundation',
      projects: [{ projectName: 'Cascade' }],
    });

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-hint"]')?.textContent?.trim()).toBe(
      'Part of Acme Foundation — this CLA covers the projects below, not necessarily every project in the foundation.'
    );
  });

  it('makes no foundation claim when the agreement names none', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', projects: [{ projectName: 'Cascade' }] });

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-hint"]')?.textContent?.trim()).toBe('This CLA covers the projects below.');
  });

  it('offers a dismiss control that closes the dialog', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', projects: [{ projectName: 'Cascade' }] });
    const close = fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-close"] button') as HTMLButtonElement | null;

    expect(close).not.toBeNull();
    close?.click();

    expect(closeDialog).toHaveBeenCalledOnce();
  });

  it('scrolls a long list rather than growing past the dismiss control', async () => {
    const fixture = await render({
      claGroupName: 'Acme CLA',
      projects: Array.from({ length: 14 }, (_, i) => ({ projectName: `Project ${i + 1}` })),
    });
    const list = fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-list"]') as HTMLElement | null;

    expect(list?.className).toContain('max-h-80');
    expect(list?.className).toContain('overflow-y-auto');
  });

  it('offers the dismiss control even when no projects are listed', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', projects: [] });

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-close"]')).not.toBeNull();
  });
});
