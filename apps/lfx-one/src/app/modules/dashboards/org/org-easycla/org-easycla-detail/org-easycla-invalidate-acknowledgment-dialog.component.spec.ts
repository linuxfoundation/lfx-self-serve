// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH } from '@lfx-one/shared/constants';
import type { OrgClaInvalidationReason } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaInvalidateAcknowledgmentDialogComponent } from './org-easycla-invalidate-acknowledgment-dialog.component';

/**
 * The invalidate confirmation (#2807).
 *
 * The dialog decides one thing: what it closes with. It never calls the API — the panel owns the
 * request — so every case here is about the value handed back, and about the Confirm control not
 * being reachable before a reason exists.
 */
describe('OrgEasyclaInvalidateAcknowledgmentDialogComponent', () => {
  const close = vi.fn();

  // `null` means "the panel passed no data"; an omitted argument means "the usual data". They
  // cannot both be `undefined`, or passing `undefined` would silently re-apply the default.
  async function render(data: { contributor: string } | null = { contributor: 'contributor@example.org' }) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaInvalidateAcknowledgmentDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogConfig, useValue: { data: data ?? undefined } },
        { provide: DynamicDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaInvalidateAcknowledgmentDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function confirmButton(fixture: ComponentFixture<unknown>): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('[data-testid="org-easycla-invalidate-dialog-confirm"] button');
  }

  /** Reaches the reason control directly; the picker itself is PrimeNG's and is not under test. */
  function chooseReason(fixture: ComponentFixture<OrgEasyclaInvalidateAcknowledgmentDialogComponent>, reason: OrgClaInvalidationReason): void {
    fixture.componentInstance.form.controls.reason.setValue(reason);
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  /**
   * The producer accepts an empty body, so this requirement is the UI's own. A CLA manager's
   * record of *why* coverage was revoked is the point of the field — without it the audit trail
   * says a contributor lost coverage and nothing about the reason.
   */
  it('keeps Confirm disabled until a reason is chosen', async () => {
    const fixture = await render();

    expect(confirmButton(fixture)?.disabled).toBe(true);

    chooseReason(fixture, 'signed-in-error');

    expect(confirmButton(fixture)?.disabled).toBe(false);
  });

  it('closes with the chosen reason and the trimmed note', async () => {
    const fixture = await render();
    chooseReason(fixture, 'should-be-corporate');
    fixture.componentInstance.form.controls.note.setValue('  moved to the corporate agreement  ');
    fixture.detectChanges();

    confirmButton(fixture)?.click();

    expect(close).toHaveBeenCalledWith({ reason: 'should-be-corporate', note: 'moved to the corporate agreement' });
  });

  it('omits an empty note rather than sending a blank string the producer would store', async () => {
    const fixture = await render();
    chooseReason(fixture, 'compliance');

    confirmButton(fixture)?.click();

    expect(close).toHaveBeenCalledWith({ reason: 'compliance' });
  });

  /**
   * Cancel closes with `null`, which is what the panel reads as "send nothing". A falsy close
   * value is the only signal it has — closing with `{}` here would fire a write on a cancel.
   */
  it('closes with null on cancel, so the panel sends nothing', async () => {
    const fixture = await render();

    (fixture.nativeElement.querySelector('[data-testid="org-easycla-invalidate-dialog-cancel"] button') as HTMLButtonElement).click();

    expect(close).toHaveBeenCalledWith(null);
  });

  it('exposes the reason control as required', async () => {
    const fixture = await render();

    const reason = fixture.nativeElement.querySelector('#org-easycla-invalidate-reason');

    expect(reason?.getAttribute('aria-required')).toBe('true');
  });

  it('caps the note at the length the producer accepts', async () => {
    const fixture = await render();

    const note = fixture.nativeElement.querySelector('#org-easycla-invalidate-note') as HTMLTextAreaElement;

    expect(note?.getAttribute('maxlength')).toBe(String(ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH));
  });

  it('names the contributor the panel resolved', async () => {
    const fixture = await render({ contributor: 'contributor@example.org' });

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-invalidate-dialog-contributor"]')?.textContent?.trim()).toBe(
      'contributor@example.org'
    );
  });

  // The panel always passes one, so this is the guard against a blank line where a name belongs
  // rather than an expected path.
  it('falls back to a generic name when the panel passed none', async () => {
    const fixture = await render(null);

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-invalidate-dialog-contributor"]')?.textContent?.trim()).toBe('this contributor');
  });
});
