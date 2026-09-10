// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgClaApprovalEntry, OrgClaApprovalList, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import type { Confirmation } from 'primeng/api';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaApprovalEntriesDialogComponent } from './org-easycla-approval-entries-dialog.component';
import { OrgEasyclaApprovalListComponent } from './org-easycla-approval-list.component';

describe('OrgEasyclaApprovalListComponent', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000AcmeOrgAAA', accountName: 'Acme' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(null);
  const getApprovalList = vi.fn();
  const updateApprovalList = vi.fn();
  const addMessage = vi.fn();
  const openDialog = vi.fn();

  /**
   * Confirmations raised during a test, read off the real `ConfirmationService`.
   *
   * The real service rather than a stub of `confirm`, because the template renders
   * `p-confirmDialog`, which subscribes to the service's own streams on construction — a stub
   * makes every test in this file fail inside PrimeNG rather than on its own assertion. And
   * `requireConfirmation$` is where `confirm()` puts its argument, so this reads the same object
   * the dialog would have rendered, including the `accept` callback the tests invoke.
   */
  let confirmations: Confirmation[];

  function claGroup(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupName: 'Nimbus Foundation CLA',
      projects: [{ projectName: 'Cascade' }],
      signed: true,
      status: 'signed',
      needsClaManager: false,
      claManagersCount: 2,
      ...overrides,
    };
  }

  function list(entries: OrgClaApprovalEntry[], canEdit = true): OrgClaApprovalList {
    return { signatureId: 'signature-uuid-1', entries, canEdit };
  }

  async function render(row: OrgClaGroup = claGroup()): Promise<ComponentFixture<OrgEasyclaApprovalListComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaApprovalListComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount } },
        { provide: OrgLensClaService, useValue: { getApprovalList, updateApprovalList } },
        { provide: MessageService, useValue: { add: addMessage } },
        ConfirmationService,
      ],
    }).compileComponents();

    // The component provides `DialogService` itself, so the stub has to replace it at that level.
    TestBed.overrideComponent(OrgEasyclaApprovalListComponent, {
      set: { providers: [{ provide: DialogService, useValue: { open: openDialog } }] },
    });

    // Subscribed before the first render, so a confirmation raised during it is still captured.
    confirmations = [];
    // The stream also carries `null`, which is how the service closes an open dialog rather than
    // asking anything — not a confirmation, so it is not collected as one.
    TestBed.inject(ConfirmationService).requireConfirmation$.subscribe((confirmation) => {
      if (confirmation) confirmations.push(confirmation);
    });

    const fixture = TestBed.createComponent(OrgEasyclaApprovalListComponent);
    fixture.componentRef.setInput('claGroup', row);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function byTestId(fixture: ComponentFixture<unknown>, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  function allByTestId(fixture: ComponentFixture<unknown>, id: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`));
  }

  /**
   * The search box, found by `data-test` rather than `data-testid`.
   *
   * `lfx-input-text` renders its `dataTest` input as `data-test`, so a `data-testid` query returns
   * null for it whether the box is there or not — which would make the "withheld" assertions below
   * pass without testing anything.
   */
  function searchBox(fixture: ComponentFixture<unknown>): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-test="org-easycla-approval-search"]');
  }

  function click(fixture: ComponentFixture<unknown>, id: string): void {
    (fixture.nativeElement.querySelector(`[data-testid="${id}"] button`) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  /** Closes the most recently opened dialog with the delta a real one would have produced. */
  function closeDialogWith(update: unknown): void {
    (openDialog.mock.results.at(-1)?.value as { onClose: Subject<unknown> }).onClose.next(update);
  }

  /** A dialog handle whose `onClose` the test drives. */
  function dialogHandle(): { onClose: Subject<unknown> } {
    return { onClose: new Subject<unknown>() };
  }

  /** Drives the search control, as the CLA Group list's own spec does. */
  function search(fixture: ComponentFixture<OrgEasyclaApprovalListComponent>, term: string): void {
    fixture.componentInstance['filterForm'].controls.search.setValue(term);
    fixture.detectChanges();
  }

  beforeEach(() => {
    selectedAccount.set(SELECTED_ACCOUNT);
    getApprovalList.mockReset();
    updateApprovalList.mockReset();
    addMessage.mockReset();
    openDialog.mockReset();
    getApprovalList.mockReturnValue(of(list([{ kind: 'domain', value: 'example.com', addedOn: '2026-03-04' }])));
    updateApprovalList.mockReturnValue(of(list([])));
    openDialog.mockImplementation(() => dialogHandle());
  });

  describe('rendering the list', () => {
    it('renders one row per entry, with its value, criteria type and date', async () => {
      getApprovalList.mockReturnValue(
        of(
          list([
            { kind: 'domain', value: 'example.com', addedOn: '2026-03-04' },
            { kind: 'github-username', value: 'octocat', addedOn: '2026-03-05' },
          ])
        )
      );

      const fixture = await render();

      expect(allByTestId(fixture, 'org-easycla-approval-row')).toHaveLength(2);
      expect(allByTestId(fixture, 'org-easycla-approval-value').map((el) => el.textContent?.trim())).toEqual(['example.com', 'octocat']);
      expect(allByTestId(fixture, 'org-easycla-approval-kind').map((el) => el.textContent?.trim())).toEqual(['Email domain', 'GitHub username']);
      expect(byTestId(fixture, 'org-easycla-approval-added-on')?.textContent?.trim()).toBe('Mar 4, 2026');
    });

    // The producer falls back to the signature's modified date and omits the field where it holds
    // neither. An absent date has to render as unknown rather than as today.
    it('renders an absent date as unknown rather than as today', async () => {
      getApprovalList.mockReturnValue(of(list([{ kind: 'domain', value: 'example.com' }])));

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-approval-added-on')?.textContent?.trim()).toBe('—');
    });

    it('names the panel with the heading the console being replaced uses', async () => {
      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-approval-heading')?.textContent).toContain('Approved List of Contributors');
    });

    it('fetches the list for the selected organization and this agreement', async () => {
      await render();

      expect(getApprovalList).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1');
    });

    it('shows the error state, and no table, when the fetch fails', async () => {
      getApprovalList.mockReturnValue(throwError(() => new Error('boom')));

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-approval-error')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-approval-table')).toBeNull();
      // No write controls either: an unloaded list cannot tell us whether the caller may write.
      expect(byTestId(fixture, 'org-easycla-approval-add')).toBeNull();
    });
  });

  /**
   * Two empty states rather than the design's single "No matching approval list entries", which
   * would tell a CLA manager who has never added a rule to try a different search term.
   */
  describe('the two empty states', () => {
    it('offers to add a first entry when the list is empty', async () => {
      getApprovalList.mockReturnValue(of(list([])));

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-approval-empty')?.textContent).toContain('No approval list entries yet');
      expect(byTestId(fixture, 'org-easycla-approval-search-empty')).toBeNull();
    });

    it('says the search matched nothing when the list is not empty', async () => {
      const fixture = await render();

      search(fixture, 'acme');

      expect(byTestId(fixture, 'org-easycla-approval-search-empty')?.textContent).toContain('No entries match your search');
      expect(byTestId(fixture, 'org-easycla-approval-empty')).toBeNull();
    });

    // A filter over nothing is a control that cannot change what is shown.
    it('withholds the search box while the list is empty', async () => {
      getApprovalList.mockReturnValue(of(list([])));

      const fixture = await render();

      expect(searchBox(fixture)).toBeNull();
    });

    it('keeps the search box on a search miss, so the term can be changed', async () => {
      const fixture = await render();

      search(fixture, 'acme');

      expect(searchBox(fixture)).not.toBeNull();
    });

    // The placeholder disappears as soon as anything is typed, so the label is the only thing
    // naming this field. `[id]` is bound rather than a static attribute precisely so it reaches
    // the native input and not the wrapper's host — and a label that names nothing looks
    // identical in the markup to one that works.
    it('names the search box with a label that resolves to its input', async () => {
      const fixture = await render();
      const label = fixture.nativeElement.querySelector('label[for="org-easycla-approval-search-input"]') as HTMLLabelElement | null;

      expect(label?.textContent).toContain('Search the approval list');
      expect(fixture.nativeElement.querySelectorAll('#org-easycla-approval-search-input')).toHaveLength(1);
      expect((fixture.nativeElement.querySelector('#org-easycla-approval-search-input') as HTMLElement).tagName).toBe('INPUT');
    });
  });

  describe('searching', () => {
    it('filters the table by value', async () => {
      getApprovalList.mockReturnValue(
        of(
          list([
            { kind: 'domain', value: 'example.com' },
            { kind: 'domain', value: 'acme.test' },
          ])
        )
      );
      const fixture = await render();

      search(fixture, 'acme');

      expect(allByTestId(fixture, 'org-easycla-approval-value').map((el) => el.textContent?.trim())).toEqual(['acme.test']);
    });

    it('filters by criteria type, which is a column the term is visibly compared against', async () => {
      getApprovalList.mockReturnValue(
        of(
          list([
            { kind: 'domain', value: 'example.com' },
            { kind: 'github-username', value: 'octocat' },
          ])
        )
      );
      const fixture = await render();

      search(fixture, 'GitHub');

      expect(allByTestId(fixture, 'org-easycla-approval-value').map((el) => el.textContent?.trim())).toEqual(['octocat']);
    });
  });

  /**
   * The design locks the tab on the display status, but status is a single slot where sanctions
   * outrank signing — so a sanctioned organization that HAS signed would be told to sign first,
   * which is untrue and hides an approval list it holds.
   */
  describe('an unsigned agreement', () => {
    it('locks the tab and points at signing', async () => {
      const fixture = await render(claGroup({ signed: false, status: 'not-started' }));

      expect(byTestId(fixture, 'org-easycla-approval-locked')?.textContent).toContain('once this CLA is signed');
      expect(byTestId(fixture, 'org-easycla-approval-table')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-approval-add')).toBeNull();
    });

    // The answer is already known to be empty, so the request is not made.
    it('does not fetch a list it knows to be empty', async () => {
      await render(claGroup({ signed: false, status: 'not-started' }));

      expect(getApprovalList).not.toHaveBeenCalled();
    });

    it('shows a signed-but-sanctioned agreement its list rather than locking it', async () => {
      const fixture = await render(claGroup({ signed: true, status: 'sanctioned' }));

      expect(byTestId(fixture, 'org-easycla-approval-locked')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-approval-table')).not.toBeNull();
    });
  });

  /**
   * The producer requires the caller to be named on this agreement's own CLA-manager list and
   * explicitly refuses an organization-level admin scope in its place — so an org admin who can
   * read this page routinely cannot write to it. Absent controls rather than disabled ones,
   * because a permanently disabled button has no way to explain itself.
   */
  describe('a caller who may only read', () => {
    it('offers no add, edit or delete control', async () => {
      getApprovalList.mockReturnValue(of(list([{ kind: 'domain', value: 'example.com' }], false)));

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-approval-add')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-approval-edit')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-approval-delete')).toBeNull();
    });

    it('still renders the entries', async () => {
      getApprovalList.mockReturnValue(of(list([{ kind: 'domain', value: 'example.com' }], false)));

      const fixture = await render();

      expect(allByTestId(fixture, 'org-easycla-approval-row')).toHaveLength(1);
    });

    it('offers the write controls to a CLA manager', async () => {
      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-approval-add')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-approval-edit')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-approval-delete')).not.toBeNull();
    });
  });

  describe('adding entries', () => {
    it('sends the delta the dialog closed with', async () => {
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [] });

      expect(updateApprovalList).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1', {
        add: [{ kind: 'domain', value: 'new.example.com' }],
        remove: [],
      });
    });

    // Cancel, and an edit that changed nothing, both close with nothing to send.
    it('sends nothing when the dialog closes empty', async () => {
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith(undefined);

      expect(updateApprovalList).not.toHaveBeenCalled();
    });

    // The dialog needs the current list to name a duplicate as one; without it a re-added rule is
    // a silent no-op, since the producer de-duplicates and answers 200.
    it('hands the dialog the list as it currently stands', async () => {
      const fixture = await render();

      click(fixture, 'org-easycla-approval-add');

      expect(openDialog).toHaveBeenCalledWith(
        OrgEasyclaApprovalEntriesDialogComponent,
        expect.objectContaining({ data: { mode: 'add', existing: [{ kind: 'domain', value: 'example.com', addedOn: '2026-03-04' }] } })
      );
    });

    it('replaces the table with what the write returned, without refetching', async () => {
      updateApprovalList.mockReturnValue(of(list([{ kind: 'domain', value: 'new.example.com' }])));
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [] });
      fixture.detectChanges();

      expect(allByTestId(fixture, 'org-easycla-approval-value').map((el) => el.textContent?.trim())).toEqual(['new.example.com']);
      expect(getApprovalList).toHaveBeenCalledTimes(1);
    });

    it('confirms the addition, counting what was added', async () => {
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith({
        add: [
          { kind: 'domain', value: 'a.example.com' },
          { kind: 'domain', value: 'b.example.com' },
        ],
        remove: [],
      });

      expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: '2 entries were added.' }));
    });
  });

  /**
   * Edit is a removal and an addition in one request, and the removal half invalidates every
   * acknowledgement that matched the old value. So the receipt says so, exactly as delete's does.
   */
  describe('editing an entry', () => {
    it('opens the dialog on the entry being edited', async () => {
      const fixture = await render();

      click(fixture, 'org-easycla-approval-edit');

      expect(openDialog).toHaveBeenCalledWith(
        OrgEasyclaApprovalEntriesDialogComponent,
        expect.objectContaining({ data: expect.objectContaining({ mode: 'edit', entry: { kind: 'domain', value: 'example.com', addedOn: '2026-03-04' } }) })
      );
    });

    it('sends the removal and the addition together', async () => {
      const fixture = await render();
      click(fixture, 'org-easycla-approval-edit');

      closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [{ kind: 'domain', value: 'example.com' }] });

      expect(updateApprovalList).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1', {
        add: [{ kind: 'domain', value: 'new.example.com' }],
        remove: [{ kind: 'domain', value: 'example.com' }],
      });
    });

    it("says the previous value's acknowledgements were invalidated", async () => {
      const fixture = await render();
      click(fixture, 'org-easycla-approval-edit');

      closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [{ kind: 'domain', value: 'example.com' }] });

      expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('invalidated') }));
    });
  });

  describe('deleting an entry', () => {
    // The producer flips the matching acknowledgements to unapproved and emails the contributors.
    // A CLA manager is entitled to know that before the click, not from the receipt.
    it('names the invalidation in the confirmation, before anything is sent', async () => {
      const fixture = await render();

      click(fixture, 'org-easycla-approval-delete');

      expect(confirmations).toHaveLength(1);
      expect(confirmations[0].message).toContain('invalidated');
      expect(confirmations[0].message).toContain('example.com');
      expect(updateApprovalList).not.toHaveBeenCalled();
    });

    it('sends the removal once confirmed', async () => {
      const fixture = await render();
      click(fixture, 'org-easycla-approval-delete');

      confirmations[0].accept?.();

      expect(updateApprovalList).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1', {
        add: [],
        remove: [{ kind: 'domain', value: 'example.com' }],
      });
    });

    it('sends nothing if the confirmation is dismissed', async () => {
      const fixture = await render();

      click(fixture, 'org-easycla-approval-delete');

      expect(updateApprovalList).not.toHaveBeenCalled();
    });

    it('confirms the removal and what it cost', async () => {
      const fixture = await render();
      click(fixture, 'org-easycla-approval-delete');

      confirmations[0].accept?.();

      expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: expect.stringContaining('invalidated') }));
    });
  });

  /**
   * The tab badge is drawn from the CLA Group row's `approvalCriteriaCount`, which came from the
   * list fetch and does not move when this tab writes. Without the event the badge would keep
   * reporting the count from page load while the table below it showed a different number.
   */
  describe('keeping the tab badge honest', () => {
    it('reports the new size after a write', async () => {
      updateApprovalList.mockReturnValue(
        of(
          list([
            { kind: 'domain', value: 'a.example.com' },
            { kind: 'domain', value: 'b.example.com' },
          ])
        )
      );
      const fixture = await render();
      const counts: number[] = [];
      fixture.componentInstance.countChanged.subscribe((count) => counts.push(count));

      click(fixture, 'org-easycla-approval-add');
      closeDialogWith({ add: [{ kind: 'domain', value: 'b.example.com' }], remove: [] });

      expect(counts).toEqual([2]);
    });

    it('reports nothing when the write failed, so the badge keeps the last true count', async () => {
      updateApprovalList.mockReturnValue(throwError(() => ({ status: 500 })));
      const fixture = await render();
      const counts: number[] = [];
      fixture.componentInstance.countChanged.subscribe((count) => counts.push(count));

      click(fixture, 'org-easycla-approval-add');
      closeDialogWith({ add: [{ kind: 'domain', value: 'b.example.com' }], remove: [] });

      expect(counts).toEqual([]);
    });
  });

  describe('a write that fails', () => {
    // Not an edge case: the producer refuses an organization-level admin scope, so an org admin
    // who can read this page gets a 403 on every write. "Something went wrong" would leave them
    // retrying it.
    it('explains a 403 as the CLA-manager requirement it is', async () => {
      updateApprovalList.mockReturnValue(throwError(() => ({ status: 403 })));
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [] });

      expect(addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: 'Only a CLA manager named on this CLA can change its approval list.' })
      );
    });

    // A 400 on this path is the producer's own sentence about a value — the useful half of the
    // answer, and the only status whose prose is echoed.
    it("echoes a 400's reason", async () => {
      updateApprovalList.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'invalid approval list email nope' } })));
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [] });

      expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'invalid approval list email nope' }));
    });

    it('stays generic on a 500, rather than surfacing upstream prose', async () => {
      updateApprovalList.mockReturnValue(throwError(() => ({ status: 500, error: { message: 'panic: runtime error at 0x...' } })));
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [] });

      expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Please try again.' }));
    });

    it('leaves the table showing the list as it was', async () => {
      updateApprovalList.mockReturnValue(throwError(() => ({ status: 403 })));
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [] });
      fixture.detectChanges();

      expect(allByTestId(fixture, 'org-easycla-approval-value').map((el) => el.textContent?.trim())).toEqual(['example.com']);
    });

    // `finalize` rather than clearing in each handler: without it the controls stay disabled for
    // the rest of the page's life after one failed write.
    it('re-enables the controls afterwards', async () => {
      updateApprovalList.mockReturnValue(throwError(() => ({ status: 403 })));
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [] });
      fixture.detectChanges();

      expect((byTestId(fixture, 'org-easycla-approval-add')?.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('while a write is in flight', () => {
    it('sends only one request, so a double click cannot invalidate twice', async () => {
      updateApprovalList.mockReturnValue(new Subject());
      const fixture = await render();

      click(fixture, 'org-easycla-approval-add');
      closeDialogWith({ add: [{ kind: 'domain', value: 'a.example.com' }], remove: [] });
      click(fixture, 'org-easycla-approval-add');
      closeDialogWith({ add: [{ kind: 'domain', value: 'b.example.com' }], remove: [] });

      expect(updateApprovalList).toHaveBeenCalledTimes(1);
    });

    it('disables the row controls', async () => {
      updateApprovalList.mockReturnValue(new Subject());
      const fixture = await render();
      click(fixture, 'org-easycla-approval-add');

      closeDialogWith({ add: [{ kind: 'domain', value: 'a.example.com' }], remove: [] });
      fixture.detectChanges();

      expect((byTestId(fixture, 'org-easycla-approval-delete')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('sends nothing when no organization is selected', async () => {
    const fixture = await render();
    selectedAccount.set(null);
    fixture.detectChanges();

    click(fixture, 'org-easycla-approval-add');
    closeDialogWith({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [] });

    expect(updateApprovalList).not.toHaveBeenCalled();
  });
});
