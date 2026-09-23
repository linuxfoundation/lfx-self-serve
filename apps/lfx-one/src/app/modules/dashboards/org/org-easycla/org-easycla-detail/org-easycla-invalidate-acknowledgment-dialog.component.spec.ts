// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OrgClaApprovalEntry, OrgClaInvalidateAcknowledgmentDialogData } from '@lfx-one/shared/interfaces';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaInvalidateAcknowledgmentDialogComponent } from './org-easycla-invalidate-acknowledgment-dialog.component';

/**
 * The invalidate confirmation (#2807).
 *
 * The dialog decides one thing: what it closes with. It never calls the API — the panel owns the
 * request — so every case here is about the value handed back and the copy the manager confirms.
 */
describe('OrgEasyclaInvalidateAcknowledgmentDialogComponent', () => {
  const close = vi.fn();

  // `null` means "the panel passed no data"; an omitted argument means "the usual data". They
  // cannot both be `undefined`, or passing `undefined` would silently re-apply the default.
  function dialogData(matching: OrgClaApprovalEntry[] | null = [], canRemove = true, contributor = 'Ada Lovelace'): OrgClaInvalidateAcknowledgmentDialogData {
    return { contributor, matchingEntries: signal(matching), canRemoveEntries: signal(canRemove) };
  }

  const ENTRIES: OrgClaApprovalEntry[] = [
    { kind: 'email', value: 'ada@example.org' },
    { kind: 'github-username', value: 'ada-l' },
  ];

  async function render(data: OrgClaInvalidateAcknowledgmentDialogData | null = dialogData()) {
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

  function byTestId(fixture: ComponentFixture<unknown>, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  function confirmButton(fixture: ComponentFixture<unknown>): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('[data-testid="org-easycla-invalidate-dialog-confirm"] button');
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('titles the dialog with the contributor, as the prototype does', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-title')?.textContent?.trim()).toBe('Invalidate acknowledgment for Ada Lovelace?');
  });

  it('says what invalidating does and does not stop', async () => {
    const fixture = await render();
    const body = byTestId(fixture, 'org-easycla-invalidate-dialog-body');

    expect(body?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      "This marks Ada Lovelace as no longer covered by this CCLA. It's assumed they've already lost access to any email domain, GitHub org, or GitLab group this CCLA's approval list checks against. If Ada Lovelace still matches this CLA's approval list criteria, they can acknowledge (or be re-added automatically via Auto ECLA) again — remove the matching criteria below if that shouldn't be possible."
    );
    expect(Array.from(body?.querySelectorAll('strong') ?? []).map((node) => node.textContent?.trim())).toEqual([
      'Ada Lovelace',
      "If Ada Lovelace still matches this CLA's approval list criteria, they can acknowledge (or be re-added automatically via Auto ECLA) again",
    ]);
  });

  it('asks for nothing but the click: Confirm is enabled and closes with an empty request', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('select, textarea, p-select')).toBeNull();
    expect(confirmButton(fixture)?.disabled).toBe(false);

    confirmButton(fixture)?.click();

    expect(close).toHaveBeenCalledWith({});
  });

  it('says no individual entry matches when the approval list has none for this contributor', async () => {
    const fixture = await render(dialogData([]));

    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-no-match')?.textContent?.trim()).toBe(
      "No individual approval-list entry matches this contributor. If they still match a broader entry (e.g. an email domain or GitHub org), they'll remain able to re-acknowledge this CCLA."
    );
    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-matches')).toBeNull();
  });

  it('lists the matching entries and removes them on confirm by default', async () => {
    const fixture = await render(dialogData(ENTRIES));
    const box = byTestId(fixture, 'org-easycla-invalidate-dialog-matches');

    expect(box?.textContent?.replace(/\s+/g, ' ')).toContain('Ada Lovelace was approved by entries added specifically for them.');
    expect(
      Array.from(box?.querySelectorAll('[data-testid="org-easycla-invalidate-dialog-match"]') ?? []).map((node) =>
        node.textContent?.replace(/\s+/g, ' ').trim()
      )
    ).toEqual(['Email ada@example.org', 'GitHub username ada-l']);
    expect(box?.textContent).toContain("Also remove these entries from the Approval List so Ada Lovelace can't acknowledge this CCLA again later.");
    expect((byTestId(fixture, 'org-easycla-invalidate-dialog-also-remove') as HTMLInputElement).checked).toBe(true);

    confirmButton(fixture)?.click();

    expect(close).toHaveBeenCalledWith({ removeApprovalEntries: ENTRIES });
  });

  it('keeps the entries when the manager unticks the box', async () => {
    const fixture = await render(dialogData([ENTRIES[0]]));
    const checkbox = byTestId(fixture, 'org-easycla-invalidate-dialog-also-remove') as HTMLInputElement;

    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-matches')?.textContent).toContain('was approved by an entry added specifically for them.');
    checkbox.click();
    fixture.detectChanges();
    confirmButton(fixture)?.click();

    expect(close).toHaveBeenCalledWith({});
  });

  it('shows the matches but offers no removal to a caller who cannot edit the approval list', async () => {
    const fixture = await render(dialogData(ENTRIES, false));

    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-matches')).toBeTruthy();
    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-also-remove')).toBeNull();

    confirmButton(fixture)?.click();

    expect(close).toHaveBeenCalledWith({});
  });

  it('holds Confirm while the approval list is read, so the choice is made with the matches in view', async () => {
    const fixture = await render({ contributor: 'Ada Lovelace', matchingEntries: signal(undefined), canRemoveEntries: signal(true) });

    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-checking')).toBeTruthy();
    expect(confirmButton(fixture)?.disabled).toBe(true);
  });

  it('claims neither way when the approval list could not be read', async () => {
    const fixture = await render(dialogData(null));

    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-matches')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-no-match')).toBeNull();
    expect(confirmButton(fixture)?.disabled).toBe(false);
  });

  it('closes with null on Cancel, so the panel sends nothing', async () => {
    const fixture = await render();

    fixture.nativeElement.querySelector('[data-testid="org-easycla-invalidate-dialog-cancel"] button')?.click();

    expect(close).toHaveBeenCalledWith(null);
  });

  // The panel always passes one, so this is the guard against a blank where a name belongs rather
  // than an expected path.
  it('falls back to a generic name when the panel passed none', async () => {
    const fixture = await render(null);

    expect(byTestId(fixture, 'org-easycla-invalidate-dialog-title')?.textContent?.trim()).toBe('Invalidate acknowledgment for this contributor?');
  });
});
