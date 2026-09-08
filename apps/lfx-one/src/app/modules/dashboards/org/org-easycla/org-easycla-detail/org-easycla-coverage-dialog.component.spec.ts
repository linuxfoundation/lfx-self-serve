// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OrgClaCoverageDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';
import { describe, expect, it } from 'vitest';

import { OrgEasyclaCoverageDialogComponent } from './org-easycla-coverage-dialog.component';

describe('OrgEasyclaCoverageDialogComponent', () => {
  async function render(data: OrgClaCoverageDialogData): Promise<ComponentFixture<OrgEasyclaCoverageDialogComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaCoverageDialogComponent],
      providers: [{ provide: DynamicDialogConfig, useValue: { data } }],
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
});
