// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgClaApprovalEntriesDialogData, OrgClaApprovalEntry } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaApprovalEntriesDialogComponent } from './org-easycla-approval-entries-dialog.component';

/**
 * The dialog's contract is what it closes with: a delta the tab sends, or `undefined` on cancel.
 * So most assertions here read `close`'s argument rather than the DOM — the delta is the part a
 * regression would make wrong in a way nobody notices until acknowledgements are revoked.
 */
describe('OrgEasyclaApprovalEntriesDialogComponent', () => {
  const closeDialog = vi.fn();

  async function render(data: OrgClaApprovalEntriesDialogData): Promise<ComponentFixture<OrgEasyclaApprovalEntriesDialogComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaApprovalEntriesDialogComponent],
      providers: [
        // The edit path renders `lfx-message`, whose PrimeNG base carries an animation. Without a
        // provider the whole edit half of this suite fails on the animation rather than on itself.
        provideNoopAnimations(),
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: DynamicDialogRef, useValue: { close: closeDialog } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaApprovalEntriesDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  function addMode(existing: OrgClaApprovalEntry[] = []): OrgClaApprovalEntriesDialogData {
    return { mode: 'add', existing };
  }

  function editMode(entry: OrgClaApprovalEntry, existing: OrgClaApprovalEntry[] = [entry]): OrgClaApprovalEntriesDialogData {
    return { mode: 'edit', entry, existing };
  }

  function click(fixture: ComponentFixture<unknown>, testId: string): void {
    (fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  /** Sets one row's criteria type and value the way the reactive form sees them. */
  function fillRow(fixture: ComponentFixture<OrgEasyclaApprovalEntriesDialogComponent>, index: number, kind: string, value: string): void {
    const rows = (fixture.componentInstance as unknown as { rows: { at: (i: number) => { patchValue: (v: unknown) => void } } }).rows;
    rows.at(index).patchValue({ kind, value });
    fixture.detectChanges();
  }

  function closedWith(): unknown {
    return closeDialog.mock.calls.at(-1)?.[0];
  }

  function errorText(fixture: ComponentFixture<unknown>, index = 0): string | undefined {
    return fixture.nativeElement.querySelector(`[data-testid="org-easycla-approval-dialog-error-text-${index}"]`)?.textContent?.trim();
  }

  beforeEach(() => {
    closeDialog.mockReset();
  });

  describe('adding entries', () => {
    // Email domain is the design's own first option and the entry that covers a whole workforce
    // with one rule, so it is what a CLA manager reaches for first.
    it('opens on one row defaulted to email domain', async () => {
      const fixture = await render(addMode());

      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-row-0"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-row-1"]')).toBeNull();
      expect(fixture.componentInstance['rows'].at(0).get('kind')?.value).toBe('domain');
    });

    it('closes with the entry as an addition and no removals', async () => {
      const fixture = await render(addMode());
      fillRow(fixture, 0, 'email', 'contributor@example.com');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(closedWith()).toEqual({ add: [{ kind: 'email', value: 'contributor@example.com' }], remove: [] });
    });

    it('trims the value, so a pasted trailing space is not stored as part of the rule', async () => {
      const fixture = await render(addMode());
      fillRow(fixture, 0, 'domain', '  example.com  ');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(closedWith()).toEqual({ add: [{ kind: 'domain', value: 'example.com' }], remove: [] });
    });

    it('collects several rows into one delta', async () => {
      const fixture = await render(addMode());
      click(fixture, 'org-easycla-approval-dialog-add-row');
      fillRow(fixture, 0, 'domain', 'example.com');
      fillRow(fixture, 1, 'github-username', 'octocat');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(closedWith()).toEqual({
        add: [
          { kind: 'domain', value: 'example.com' },
          { kind: 'github-username', value: 'octocat' },
        ],
        remove: [],
      });
    });

    // Someone adding several entries is usually adding several of the same kind, so re-picking
    // "GitHub username" five times is friction with no purpose.
    it('seeds a new row from the criteria type of the row above', async () => {
      const fixture = await render(addMode());
      fillRow(fixture, 0, 'github-username', 'octocat');

      click(fixture, 'org-easycla-approval-dialog-add-row');

      expect(fixture.componentInstance['rows'].at(1).get('kind')?.value).toBe('github-username');
    });

    it('drops a removed row from the delta', async () => {
      const fixture = await render(addMode());
      click(fixture, 'org-easycla-approval-dialog-add-row');
      fillRow(fixture, 0, 'domain', 'example.com');
      fillRow(fixture, 1, 'domain', 'other.example.com');

      click(fixture, 'org-easycla-approval-dialog-remove-row-1');
      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(closedWith()).toEqual({ add: [{ kind: 'domain', value: 'example.com' }], remove: [] });
    });

    // A disabled remove button on the only row is a control that can never do anything, and an
    // empty dialog offers nothing to submit and no way back to a row.
    it('offers no remove control while there is only one row', async () => {
      const fixture = await render(addMode());

      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-remove-row-0"]')).toBeNull();
    });

    it('stops offering more rows at the cap', async () => {
      const fixture = await render(addMode());

      for (let i = 1; i < 100; i++) click(fixture, 'org-easycla-approval-dialog-add-row');

      expect(fixture.componentInstance['rows'].length).toBe(100);
      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-add-row"]')).toBeNull();
    });
  });

  describe('rejecting a value before it is sent', () => {
    it('names the failure against the row it belongs to', async () => {
      const fixture = await render(addMode());
      click(fixture, 'org-easycla-approval-dialog-add-row');
      fillRow(fixture, 0, 'domain', 'example.com');
      fillRow(fixture, 1, 'email', 'not-an-email');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(errorText(fixture, 0)).toBeUndefined();
      expect(errorText(fixture, 1)).toContain('invalid approval list email');
    });

    // The producer rejects the entire request if any one value fails, so a dialog that submitted
    // anyway would lose the four good rows to the typo in the fifth.
    it('sends nothing while any row is invalid', async () => {
      const fixture = await render(addMode());
      click(fixture, 'org-easycla-approval-dialog-add-row');
      fillRow(fixture, 0, 'domain', 'example.com');
      fillRow(fixture, 1, 'email', 'not-an-email');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(closeDialog).not.toHaveBeenCalled();
    });

    it('rejects an empty value', async () => {
      const fixture = await render(addMode());

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(errorText(fixture)).toBeTruthy();
      expect(closeDialog).not.toHaveBeenCalled();
    });

    // Validation output, not live feedback: reporting an error against the first character of an
    // address someone is still typing is noise, so the messages appear on submit.
    it('shows no error before the first submit', async () => {
      const fixture = await render(addMode());
      fillRow(fixture, 0, 'email', 'not-an-email');

      expect(errorText(fixture)).toBeUndefined();
    });

    it('clears a resolved error on the next submit', async () => {
      const fixture = await render(addMode());
      fillRow(fixture, 0, 'email', 'not-an-email');
      click(fixture, 'org-easycla-approval-dialog-submit');

      fillRow(fixture, 0, 'email', 'contributor@example.com');
      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(errorText(fixture)).toBeUndefined();
      expect(closedWith()).toEqual({ add: [{ kind: 'email', value: 'contributor@example.com' }], remove: [] });
    });

    it('names two identical rows rather than silently collapsing them', async () => {
      const fixture = await render(addMode());
      click(fixture, 'org-easycla-approval-dialog-add-row');
      fillRow(fixture, 0, 'domain', 'example.com');
      fillRow(fixture, 1, 'domain', 'example.com');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(errorText(fixture, 1)).toBe('This entry is already in this list of changes.');
      expect(closeDialog).not.toHaveBeenCalled();
    });

    // The producer answers 200 for a rule it already holds, so without this check the dialog
    // would close and the tab would report a receipt for a change that did not happen.
    it('names a value already on the approval list', async () => {
      const fixture = await render(addMode([{ kind: 'domain', value: 'example.com' }]));
      fillRow(fixture, 0, 'domain', 'example.com');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(errorText(fixture)).toBe('Email domain "example.com" is already on the approval list.');
      expect(closeDialog).not.toHaveBeenCalled();
    });

    it('treats a duplicate as one regardless of case', async () => {
      const fixture = await render(addMode([{ kind: 'domain', value: 'Example.com' }]));
      fillRow(fixture, 0, 'domain', 'example.com');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(errorText(fixture)).toBeTruthy();
    });

    // Same text under a different criteria type is a different rule, so it is not a duplicate.
    it('admits the same text under another criteria type', async () => {
      const fixture = await render(addMode([{ kind: 'github-username', value: 'example-org' }]));
      fillRow(fixture, 0, 'github-org', 'example-org');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(closedWith()).toEqual({ add: [{ kind: 'github-org', value: 'example-org' }], remove: [] });
    });
  });

  /**
   * Edit is not an upstream operation — it is the removal of the old entry and the addition of the
   * new one in a single request. The removal half invalidates every acknowledgement that matched
   * the old value, so this dialog warns exactly as delete does.
   */
  describe('editing an entry', () => {
    it('opens on the entry being reworked', async () => {
      const fixture = await render(editMode({ kind: 'domain', value: 'old.example.com' }));

      expect(fixture.componentInstance['rows'].at(0).get('kind')?.value).toBe('domain');
      expect(fixture.componentInstance['rows'].at(0).get('value')?.value).toBe('old.example.com');
    });

    it('closes with the old entry removed and the new one added', async () => {
      const fixture = await render(editMode({ kind: 'domain', value: 'old.example.com' }));
      fillRow(fixture, 0, 'domain', 'new.example.com');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(closedWith()).toEqual({
        add: [{ kind: 'domain', value: 'new.example.com' }],
        remove: [{ kind: 'domain', value: 'old.example.com' }],
      });
    });

    it('warns that contributors covered only by the old value must acknowledge again', async () => {
      const fixture = await render(editMode({ kind: 'domain', value: 'old.example.com' }));

      const warning = fixture.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-edit-warning"]');
      expect(warning?.textContent).toContain('acknowledge this CLA again');
    });

    // The design's copy for this dialog claims the opposite — that existing contributors keep
    // their coverage. The API is the authority, and it does not.
    it('makes no claim that existing coverage is retained', async () => {
      const fixture = await render(editMode({ kind: 'domain', value: 'old.example.com' }));

      expect(fixture.nativeElement.textContent).not.toContain('keep their coverage');
      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-hint"]')?.textContent).toContain('lose coverage');
    });

    it('shows no warning when adding, which removes nothing', async () => {
      const fixture = await render(addMode());

      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-edit-warning"]')).toBeNull();
    });

    // The producer would take the removal and the addition of the same value and process the
    // invalidation half regardless — revoking acknowledgements to arrive back where it started.
    it('sends nothing when the edit changed nothing', async () => {
      const fixture = await render(editMode({ kind: 'domain', value: 'example.com' }));

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(closeDialog).toHaveBeenCalledWith();
      expect(closedWith()).toBeUndefined();
    });

    // Reworking only the criteria type is a legitimate change, and the entry being edited is by
    // definition already on the list — so the duplicate check must not fire on it.
    it('admits a change of criteria type at the same value', async () => {
      const fixture = await render(editMode({ kind: 'github-username', value: 'example-org' }));
      fillRow(fixture, 0, 'github-org', 'example-org');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(closedWith()).toEqual({
        add: [{ kind: 'github-org', value: 'example-org' }],
        remove: [{ kind: 'github-username', value: 'example-org' }],
      });
    });

    it('still names a new value that collides with another entry on the list', async () => {
      const editing: OrgClaApprovalEntry = { kind: 'domain', value: 'old.example.com' };
      const fixture = await render(editMode(editing, [editing, { kind: 'domain', value: 'taken.example.com' }]));
      fillRow(fixture, 0, 'domain', 'taken.example.com');

      click(fixture, 'org-easycla-approval-dialog-submit');

      expect(errorText(fixture)).toContain('already on the approval list');
      expect(closeDialog).not.toHaveBeenCalled();
    });

    // Edit reworks exactly one entry, so a second row and a remove control would both be
    // meaningless here.
    it('offers no way to add or remove rows', async () => {
      const fixture = await render(editMode({ kind: 'domain', value: 'example.com' }));

      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-add-row"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-remove-row-0"]')).toBeNull();
    });

    it('labels the submit control for the mode it is in', async () => {
      const editing = await render(editMode({ kind: 'domain', value: 'example.com' }));
      expect(editing.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-submit"]')?.textContent).toContain('Save changes');

      const adding = await render(addMode());
      expect(adding.nativeElement.querySelector('[data-testid="org-easycla-approval-dialog-submit"]')?.textContent).toContain('Add to approval list');
    });
  });

  describe('cancelling', () => {
    // Closing with no argument is what tells the tab there is nothing to send. Closing with an
    // empty delta would have it call the API to change nothing.
    it('closes with no delta', async () => {
      const fixture = await render(addMode());
      fillRow(fixture, 0, 'domain', 'example.com');

      click(fixture, 'org-easycla-approval-dialog-cancel');

      expect(closeDialog).toHaveBeenCalledWith();
      expect(closedWith()).toBeUndefined();
    });
  });
});
