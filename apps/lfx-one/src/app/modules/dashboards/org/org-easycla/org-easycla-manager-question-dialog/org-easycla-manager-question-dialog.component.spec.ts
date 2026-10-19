// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CCLA_SIGN_COPY, ORG_CLA_MANAGER_QUESTION_COPY } from '@lfx-one/shared/constants';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaManagerQuestionDialogComponent, orgClaManagerQuestionDialogConfig } from './org-easycla-manager-question-dialog.component';

describe('OrgEasyclaManagerQuestionDialogComponent', () => {
  const closeDialog = vi.fn();
  const onYes = vi.fn();

  async function render(): Promise<ComponentFixture<OrgEasyclaManagerQuestionDialogComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaManagerQuestionDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogConfig, useValue: orgClaManagerQuestionDialogConfig({ onYes }) },
        { provide: DynamicDialogRef, useValue: { close: closeDialog } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaManagerQuestionDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  function byTestId(fixture: ComponentFixture<unknown>, testId: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);
  }

  function click(fixture: ComponentFixture<unknown>, testId: string): void {
    (byTestId(fixture, testId)?.querySelector('button') as HTMLButtonElement | null)?.click();
    fixture.detectChanges();
  }

  function pressEscape(fixture: ComponentFixture<unknown>): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
  }

  beforeEach(() => {
    closeDialog.mockReset();
    onYes.mockReset();
  });

  it("asks Corporate Console's question as the heading, with its message and note below", async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(byTestId(fixture, 'org-easycla-manager-question-heading')?.textContent?.trim()).toBe(
      'Are you authorized to be a CLA Manager for your organization?'
    );
    expect(byTestId(fixture, 'org-easycla-manager-question-heading')?.id).toBe(OrgEasyclaManagerQuestionDialogComponent.headingId);
    expect(text).toContain(ORG_CLA_MANAGER_QUESTION_COPY.message);
    expect(text).toContain('If not sure please select "No"');
  });

  it('leaves PrimeNG no way to dismiss it, so the component decides when leaving is allowed', () => {
    const config = orgClaManagerQuestionDialogConfig({ onYes });

    expect(config.showHeader).toBe(false);
    expect(config.closable).toBe(false);
    expect(config.closeOnEscape).toBe(false);
    expect(config.dismissableMask).toBe(false);
  });

  it('can be closed without answering, by its close button or Escape', async () => {
    const fixture = await render();

    (byTestId(fixture, 'org-easycla-manager-question-close') as HTMLButtonElement).click();
    pressEscape(fixture);

    expect(closeDialog).toHaveBeenCalledTimes(2);
    expect(closeDialog.mock.calls.every((call) => call[0] === undefined)).toBe(true);
    expect(onYes).not.toHaveBeenCalled();
  });

  it('closes with no on No', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-manager-question-no');

    expect(closeDialog).toHaveBeenCalledExactlyOnceWith('no');
  });

  it('hands Yes to the opener and stays open on the configuring state', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-manager-question-yes');

    expect(onYes).toHaveBeenCalledTimes(1);
    expect(closeDialog).not.toHaveBeenCalled();
    expect(byTestId(fixture, 'org-easycla-manager-question-heading')?.textContent?.trim()).toBe('Configuring CLA Manager Settings…');
    const configuring = byTestId(fixture, 'org-easycla-manager-question-configuring');
    expect(configuring?.textContent).toContain('Please wait while we configure the initial CLA Manager settings for this CLA.');
    expect(configuring?.textContent).toContain('When this CLA is signed, you will be the initial CLA Manager.');
    expect(configuring?.querySelector('.fa-spin')).not.toBeNull();
    expect(byTestId(fixture, 'org-easycla-manager-question-dialog')?.getAttribute('aria-live')).toBe('polite');
    expect(byTestId(fixture, 'org-easycla-manager-question-dialog')?.getAttribute('role')).toBe('status');
  });

  it('reads the configuring copy the signing hand-off reads, so the two cannot drift apart', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-manager-question-yes');

    expect(byTestId(fixture, 'org-easycla-manager-question-heading')?.textContent?.trim()).toBe(CCLA_SIGN_COPY.preparing.header);
    expect(byTestId(fixture, 'org-easycla-manager-question-configuring')?.textContent).toContain(CCLA_SIGN_COPY.preparing.body);
  });

  it('cannot be dismissed or answered again while configuring', async () => {
    const fixture = await render();

    click(fixture, 'org-easycla-manager-question-yes');
    pressEscape(fixture);

    expect(byTestId(fixture, 'org-easycla-manager-question-close')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-manager-question-yes')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-manager-question-no')).toBeNull();
    expect(closeDialog).not.toHaveBeenCalled();
    expect(onYes).toHaveBeenCalledTimes(1);
  });

  it('offers no Contact Company Admin', async () => {
    const fixture = await render();

    expect(((fixture.nativeElement as HTMLElement).textContent ?? '').toLowerCase()).not.toContain('company admin');
  });
});
