// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaIdentifyManagerDialogComponent, orgClaIdentifyManagerDialogConfig } from './org-easycla-identify-manager-dialog.component';

describe('OrgEasyclaIdentifyManagerDialogComponent', () => {
  const closeDialog = vi.fn();

  async function render(): Promise<ComponentFixture<OrgEasyclaIdentifyManagerDialogComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaIdentifyManagerDialogComponent],
      providers: [provideNoopAnimations(), { provide: DynamicDialogConfig, useValue: {} }, { provide: DynamicDialogRef, useValue: { close: closeDialog } }],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaIdentifyManagerDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  function click(fixture: ComponentFixture<unknown>, testId: string): void {
    (fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement | null)?.click();
    fixture.detectChanges();
  }

  function fill(fixture: ComponentFixture<OrgEasyclaIdentifyManagerDialogComponent>, fullName: string, email: string): void {
    fixture.componentInstance['form'].setValue({ fullName, email });
    fixture.detectChanges();
  }

  function text(fixture: ComponentFixture<unknown>, testId: string): string {
    return ((fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').trim();
  }

  beforeEach(() => {
    closeDialog.mockReset();
  });

  it("is titled with Corporate Console's Identify CLA Manager", () => {
    expect(orgClaIdentifyManagerDialogConfig().header).toBe('Identify CLA Manager');
  });

  it('closes with the trimmed name and address on a valid submit', async () => {
    const fixture = await render();
    fill(fixture, '  Pat Contributor ', ' contributor@example.org ');

    click(fixture, 'org-easycla-identify-manager-submit');

    expect(closeDialog).toHaveBeenCalledExactlyOnceWith({ fullName: 'Pat Contributor', email: 'contributor@example.org' });
  });

  it('does not close on an empty submit and says what is missing', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-identify-manager-submit');

    expect(closeDialog).not.toHaveBeenCalled();
    expect(text(fixture, 'org-easycla-identify-manager-name-error')).toBe('Name is required.');
    expect(text(fixture, 'org-easycla-identify-manager-email-error')).toBe('Email address is required.');
  });

  it('tells the viewer which characters the CLA service accepts before they can submit', async () => {
    const fixture = await render();
    fill(fixture, 'Zoë Contributor', 'contributor@example.org');

    click(fixture, 'org-easycla-identify-manager-submit');

    expect(closeDialog).not.toHaveBeenCalled();
    expect(text(fixture, 'org-easycla-identify-manager-name-error')).toContain('Accents, hyphens, and apostrophes are not accepted');
  });

  it('closes with undefined on Cancel', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-identify-manager-cancel');

    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(closeDialog.mock.calls[0][0]).toBeUndefined();
  });

  it('offers no Contact Company Admin', async () => {
    const fixture = await render();

    expect(((fixture.nativeElement as HTMLElement).textContent ?? '').toLowerCase()).not.toContain('company admin');
  });
});
