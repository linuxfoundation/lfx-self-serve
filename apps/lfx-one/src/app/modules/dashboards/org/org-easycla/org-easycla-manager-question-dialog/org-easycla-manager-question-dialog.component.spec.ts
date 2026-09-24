// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ORG_CLA_MANAGER_QUESTION_COPY } from '@lfx-one/shared/constants';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaManagerQuestionDialogComponent, orgClaManagerQuestionDialogConfig } from './org-easycla-manager-question-dialog.component';

describe('OrgEasyclaManagerQuestionDialogComponent', () => {
  const closeDialog = vi.fn();

  async function render(): Promise<ComponentFixture<OrgEasyclaManagerQuestionDialogComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaManagerQuestionDialogComponent],
      providers: [provideNoopAnimations(), { provide: DynamicDialogConfig, useValue: {} }, { provide: DynamicDialogRef, useValue: { close: closeDialog } }],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaManagerQuestionDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  function click(fixture: ComponentFixture<unknown>, testId: string): void {
    (fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement | null)?.click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    closeDialog.mockReset();
  });

  it("asks Corporate Console's question with its message and note", async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Are you authorized to be a CLA Manager for your organization?');
    expect(text).toContain(ORG_CLA_MANAGER_QUESTION_COPY.message);
    expect(text).toContain('If not sure please select "No"');
    expect(orgClaManagerQuestionDialogConfig().header).toBe('No Signed CLA Found');
  });

  it('closes with yes on Yes', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-manager-question-yes');

    expect(closeDialog).toHaveBeenCalledExactlyOnceWith('yes');
  });

  it('closes with no on No', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-manager-question-no');

    expect(closeDialog).toHaveBeenCalledExactlyOnceWith('no');
  });

  it('offers no Contact Company Admin', async () => {
    const fixture = await render();

    expect(((fixture.nativeElement as HTMLElement).textContent ?? '').toLowerCase()).not.toContain('company admin');
  });
});
