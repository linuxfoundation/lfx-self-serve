// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgClaContributorAcknowledgment, OrgClaContributorAcknowledgmentList, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaContributorAcknowledgmentsComponent } from './org-easycla-contributor-acknowledgments.component';

describe('OrgEasyclaContributorAcknowledgmentsComponent', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000AcmeOrgAAA', accountName: 'Acme' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(null);
  const getContributorAcknowledgments = vi.fn();
  const invalidateAcknowledgment = vi.fn();
  const addMessage = vi.fn();
  /** Emits what the confirmation closed with: a request on confirm, `null` on dismiss. */
  let dialogClosed: Subject<unknown>;
  const openDialog = vi.fn();

  function claGroup(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupName: 'Nimbus Foundation CLA',
      projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD3AAI' }],
      signed: true,
      status: 'signed',
      needsClaManager: false,
      claManagersCount: 2,
      ...overrides,
    };
  }

  function ack(overrides: Partial<OrgClaContributorAcknowledgment> = {}): OrgClaContributorAcknowledgment {
    return {
      signatureId: `ecla-${Math.random().toString(36).slice(2, 8)}`,
      cclaVersion: 'v1',
      approved: true,
      ...overrides,
    };
  }

  function page(rows: OrgClaContributorAcknowledgment[], overrides: Partial<OrgClaContributorAcknowledgmentList> = {}): OrgClaContributorAcknowledgmentList {
    return {
      signatureId: 'signature-uuid-1',
      list: rows,
      canEdit: true,
      resultCount: rows.length,
      totalCount: rows.length,
      nextKey: null,
      ...overrides,
    };
  }

  async function render(row: OrgClaGroup = claGroup()): Promise<ComponentFixture<OrgEasyclaContributorAcknowledgmentsComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaContributorAcknowledgmentsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount } },
        { provide: OrgLensClaService, useValue: { getContributorAcknowledgments, invalidateAcknowledgment } },
        { provide: MessageService, useValue: { add: addMessage } },
      ],
    })
      // `DialogService` is provided by the component itself, so it has to be replaced at the
      // component level — a root provider would be shadowed by the component's own.
      .overrideComponent(OrgEasyclaContributorAcknowledgmentsComponent, {
        set: { providers: [{ provide: DialogService, useValue: { open: openDialog } }] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaContributorAcknowledgmentsComponent);
    fixture.componentRef.setInput('claGroup', row);
    fixture.detectChanges();
    // `combineLatest` sources include `toObservable` streams whose emissions land on the
    // microtask queue. Two stable/detect cycles: the first drains those microtasks so the fetch
    // subscribes; the second flushes the resulting signal update into the DOM.
    await fixture.whenStable();
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

  function textIn(el: HTMLElement | null): string {
    return (el?.textContent ?? '').trim();
  }

  function click(fixture: ComponentFixture<unknown>, id: string): void {
    (fixture.nativeElement.querySelector(`[data-testid="${id}"] button`) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    // `resetAllMocks` clears the `mockReturnValueOnce` queue too — `clearAllMocks` only clears
    // call history, so a leftover `mockReturnValueOnce` from an earlier test would otherwise
    // bleed into the next test's first fetch.
    vi.resetAllMocks();
    selectedAccount.set(SELECTED_ACCOUNT);
    getContributorAcknowledgments.mockReturnValue(of(page([])));
    invalidateAcknowledgment.mockReturnValue(of({ signatureId: 'ecla-1' }));
    dialogClosed = new Subject<unknown>();
    openDialog.mockReturnValue({ onClose: dialogClosed.asObservable(), close: vi.fn() });
  });

  /**
   * Load-more merges the fetched next page onto the current view rather than replacing it.
   *
   * This pins a regression: an earlier version of the component read `listSignal() ?? page()`,
   * which returned the first page (still cached in the `toSignal` handle) instead of the merged
   * `page()` set by Load-more. The user pressed Load-more, no new rows appeared, and the tab
   * looked stuck on page one. The `page() ?? listSignal()` order is the fix.
   */
  it('renders the merged rows after Load-more, not just the first page', async () => {
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1', name: 'Ada Lovelace' })], { totalCount: 2, nextKey: 'cursor-2' })));
    const fixture = await render();

    expect(allByTestId(fixture, 'org-easycla-acknowledgment-name').map(textIn)).toEqual(['Ada Lovelace']);
    expect(byTestId(fixture, 'org-easycla-acknowledgments-load-more')).toBeTruthy();

    // Second page arrives via nextKey; the component appends and renders BOTH rows.
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-2', name: 'Grace Hopper' })], { totalCount: 2, nextKey: null })));

    click(fixture, 'org-easycla-acknowledgments-load-more');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(allByTestId(fixture, 'org-easycla-acknowledgment-name').map(textIn)).toEqual(['Ada Lovelace', 'Grace Hopper']);
    // The producer's nextKey came back null on page 2, so Load-more retires.
    expect(byTestId(fixture, 'org-easycla-acknowledgments-load-more')).toBeNull();
  });

  it('re-enables Load more when a new search starts while the previous page request is still in flight', async () => {
    const pending = new Subject<OrgClaContributorAcknowledgmentList>();
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1', name: 'Ada Lovelace' })], { nextKey: 'cursor-2' })));
    const fixture = await render();

    getContributorAcknowledgments.mockReturnValueOnce(pending.asObservable());
    click(fixture, 'org-easycla-acknowledgments-load-more');
    const spinning = fixture.nativeElement.querySelector('[data-testid="org-easycla-acknowledgments-load-more"] button') as HTMLButtonElement;
    expect(spinning.disabled).toBe(true);

    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-9', name: 'Grace Hopper' })], { nextKey: 'cursor-9' })));
    const search = fixture.componentInstance as unknown as { filterForm: { controls: { search: { setValue: (value: string) => void } } } };
    search.filterForm.controls.search.setValue('grace');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fixture.whenStable();
    fixture.detectChanges();

    const ready = fixture.nativeElement.querySelector('[data-testid="org-easycla-acknowledgments-load-more"] button') as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    expect(allByTestId(fixture, 'org-easycla-acknowledgment-name').map(textIn)).toEqual(['Grace Hopper']);
  });

  it('shows the no-match row when a search returns nothing, not the empty-agreement copy', async () => {
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1', name: 'Ada Lovelace' })])));
    const fixture = await render();

    getContributorAcknowledgments.mockReturnValueOnce(of(page([])));
    const search = fixture.componentInstance as unknown as { filterForm: { controls: { search: { setValue: (value: string) => void } } } };
    search.filterForm.controls.search.setValue('nobody');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('lfx-empty-state')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-acknowledgments-search-empty')?.textContent).toContain('No acknowledgments match your search.');
  });

  // The placeholder disappears as soon as anything is typed, so the label is the only thing
  // naming this field. `[id]` is bound rather than a static attribute precisely so it reaches
  // the native input and not the wrapper's host — and a label that names nothing looks
  // identical in the markup to one that works.
  it('names the search box with a label that resolves to its input', async () => {
    const fixture = await render();
    const label = fixture.nativeElement.querySelector('label[for="org-easycla-acknowledgments-search-input"]') as HTMLLabelElement | null;

    expect(label?.textContent).toContain('Search contributors');
    expect(fixture.nativeElement.querySelectorAll('#org-easycla-acknowledgments-search-input')).toHaveLength(1);
    expect((fixture.nativeElement.querySelector('#org-easycla-acknowledgments-search-input') as HTMLElement).tagName).toBe('INPUT');
  });

  /**
   * The identity column falls through: LF Login → GitHub username → GitLab username → email →
   * em-dash. A row with no LF Login but any downstream identifier must render, or an
   * unaffiliated contributor disappears from the list.
   */
  describe('the identity fallback', () => {
    it('renders the LF Login when present', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ lfLogin: 'jsmith', githubUsername: 'jsmith-gh' })])));
      const fixture = await render();

      expect(textIn(byTestId(fixture, 'org-easycla-acknowledgment-identity'))).toBe('jsmith');
    });

    it('falls through to GitHub when LF Login is absent, so a GitHub-only contributor still renders', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ githubUsername: 'gh-only' })])));
      const fixture = await render();

      const identity = byTestId(fixture, 'org-easycla-acknowledgment-identity');
      expect(textIn(identity)).toBe('@gh-only');
      // Rendered as a link to github.com, matching the mutable-login display posture (never as
      // a stable identifier).
      expect(identity?.getAttribute('href')).toBe('https://github.com/gh-only');
    });

    it('falls through to GitLab when LF Login and GitHub are both absent', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ gitlabUsername: 'gl-only' })])));
      const fixture = await render();

      const identity = byTestId(fixture, 'org-easycla-acknowledgment-identity');
      expect(textIn(identity)).toBe('@gl-only');
      expect(identity?.getAttribute('href')).toBe('https://gitlab.com/gl-only');
    });

    it('falls through to email when no username identifier exists', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ email: 'contributor@example.org' })])));
      const fixture = await render();

      const identity = byTestId(fixture, 'org-easycla-acknowledgment-identity');
      expect(textIn(identity)).toBe('contributor@example.org');
      expect(identity?.getAttribute('href')).toBe('mailto:contributor@example.org');
    });

    it('renders an em-dash for the ID column when the producer sent nothing usable, rather than dropping the row', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ name: 'DocuSign Only' })])));
      const fixture = await render();

      // The row is still rendered — a contributor with only a DocuSign name is a real signature.
      expect(allByTestId(fixture, 'org-easycla-acknowledgment-name').map(textIn)).toEqual(['DocuSign Only']);
      // The identity column carries the em-dash rather than dropping the row.
      expect(textIn(byTestId(fixture, 'org-easycla-acknowledgment-identity'))).toBe('—');
    });
  });

  /**
   * Invalidated is `approved: false`, or any invalidation stamp even when `approved` stays true.
   * Legacy rows carry the stamps with `approved: true`, and the stamps decide the visible state.
   */
  describe('the Invalidated state', () => {
    it('renders Invalidated when the producer says the row is not approved', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ approved: false })])));
      const fixture = await render();

      expect(textIn(byTestId(fixture, 'org-easycla-acknowledgment-state-invalidated'))).toBe('Invalidated');
      expect(byTestId(fixture, 'org-easycla-acknowledgment-state-acknowledged')).toBeNull();
    });

    it('renders Invalidated, with the stamp tooltip, when approved stays true but a stamp is present', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(
        of(
          page([
            ack({
              approved: true,
              invalidatedAt: '2026-03-11T09:20:00Z',
              invalidatedBy: 'cla-manager',
              invalidationReason: 'left the company',
            }),
          ])
        )
      );
      const fixture = await render();

      const tag = byTestId(fixture, 'org-easycla-acknowledgment-state-invalidated');
      const label = tag?.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '';
      expect(textIn(tag)).toBe('Invalidated');
      expect(label).toContain('by cla-manager');
      expect(label).toContain('Reason: left the company');
      expect(byTestId(fixture, 'org-easycla-acknowledgment-state-acknowledged')).toBeNull();
    });
  });

  /**
   * The CCLA version column renders the producer's `signature_version` verbatim (already
   * normalized to a `v`-prefixed string by the mapper). An empty version renders as an em-dash.
   */
  describe('the CCLA version column', () => {
    it('renders a populated version verbatim', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ cclaVersion: 'v2.1' })])));
      const fixture = await render();

      expect(textIn(byTestId(fixture, 'org-easycla-acknowledgment-version'))).toBe('v2.1');
    });

    it('renders an em-dash for an empty version rather than an empty cell', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ cclaVersion: '' })])));
      const fixture = await render();

      expect(textIn(byTestId(fixture, 'org-easycla-acknowledgment-version'))).toBe('—');
    });
  });

  /**
   * Search is wired to the server: the debounced term is forwarded to the BFF, and a new term
   * resets pagination so the producer's per-term `nextKey` is not reused across terms.
   *
   * The debounce is short (`CLA_GROUP_SEARCH_DEBOUNCE_MS = 250ms`) but real; the test drives it
   * through `vi.useFakeTimers` on the timer clock rather than trusting a wall-clock delay.
   */
  it('forwards the debounced search term to the server, not filtering only in-memory', async () => {
    // The initial fetch resolves the first page. Rendering runs under real timers so the
    // `whenStable` cycle in the `render` helper is honoured. The debounce alone runs under
    // fake timers, matching how the sibling picker's spec drives search: only the debounce
    // itself needs a clock. `useFakeTimers()` (with no options) fakes microtasks alongside
    // `setTimeout`, which the RxJS `asyncScheduler` and Zone.js both require to advance.
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1' })], { nextKey: 'cursor-2' })));
    const fixture = await render();
    expect(getContributorAcknowledgments.mock.calls.length).toBeGreaterThan(0);

    // Queue the response the search re-fetch should consume, then drive the debounce.
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-3' })])));

    vi.useFakeTimers();
    try {
      (fixture.componentInstance as unknown as { filterForm: { controls: { search: { setValue: (v: string) => void } } } }).filterForm.controls.search.setValue(
        'ada'
      );
      await vi.advanceTimersByTimeAsync(600);
      fixture.detectChanges();
    } finally {
      vi.useRealTimers();
    }

    // A search request was issued with the term. The nextKey from the first response is NOT
    // reused, because the producer's cursor is scoped to a term.
    const searchCalls = getContributorAcknowledgments.mock.calls.filter((call) => (call[2]?.search ?? '') === 'ada');
    expect(searchCalls.length).toBeGreaterThan(0);
    for (const call of searchCalls) {
      expect(call[2]?.nextKey).toBeFalsy();
    }
  });

  /**
   * A signed agreement with no acknowledgments yet renders the M3 prototype's empty state, not a
   * table with a header row and an empty body. Parent story #1973 AC4 forbids the smiley icon
   * the prototype used; this pins the title and the subtitle from the aligned copy constant.
   */
  it('shows the empty state on a signed agreement that holds no acknowledgments', async () => {
    getContributorAcknowledgments.mockReturnValueOnce(of(page([])));
    const fixture = await render();

    // The `data-testid` on `<lfx-empty-state>` is dropped by Angular when the host is a custom
    // component whose inputs are signal-based, so match by the title text the constant carries.
    const empty = fixture.nativeElement.querySelector('lfx-empty-state');
    expect(empty).toBeTruthy();
    expect(empty?.textContent).toContain('No contributor acknowledgments yet');
    // The table itself is not rendered when the panel is in the empty state.
    expect(byTestId(fixture, 'org-easycla-acknowledgments-table')).toBeNull();
  });
  /**
   * Per-row invalidate (#2807).
   *
   * The write itself is gated server-side — impersonation, the Org Lens grant, the CLA-manager
   * roster and the ownership verify all live behind the BFF. What the tab owns is narrower and
   * is what these pin: who is offered the control, that nothing is sent without the confirmation,
   * and what the list shows once the write returns.
   */
  describe('per-row invalidate', () => {
    function invalidateButton(fixture: ComponentFixture<unknown>): HTMLButtonElement | null {
      return fixture.nativeElement.querySelector('[data-testid="org-easycla-acknowledgment-invalidate"] button');
    }

    it('offers the control on an acknowledged row when the caller may edit', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1', name: 'Ada Lovelace' })], { canEdit: true })));
      const fixture = await render();

      expect(invalidateButton(fixture)).toBeTruthy();
    });

    // `canEdit` is decided server-side from the CCLA's manager roster. An org viewer who is not on
    // it would be refused by the BFF anyway; withholding the control is what stops them being
    // offered an action that cannot succeed.
    it('withholds the control when the server says the caller may not edit', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1' })], { canEdit: false })));
      const fixture = await render();

      expect(invalidateButton(fixture)).toBeNull();
    });

    it('withholds the control on a row that is already invalidated', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1', approved: false })], { canEdit: true })));
      const fixture = await render();

      expect(invalidateButton(fixture)).toBeNull();
    });

    /**
     * A row with no usable id.
     *
     * The shared interface types `signatureId` as required and the BFF mapper drops a producer row
     * without one — but the type is a claim about the contract, not a guarantee about the bytes.
     * An empty id would be sent as an empty path segment and come back 400, so the control is
     * disabled instead: there is no record id to act on, and saying so beats a failing request.
     */
    it('disables the control on a row whose signatureId is empty, rather than firing a request that 400s', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: '', name: 'Ada Lovelace' })], { canEdit: true })));
      const fixture = await render();

      const button = invalidateButton(fixture);

      expect(button).toBeTruthy();
      expect(button?.disabled).toBe(true);

      button?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(openDialog).not.toHaveBeenCalled();
      expect(invalidateAcknowledgment).not.toHaveBeenCalled();
    });

    /**
     * The confirmation is required, and dismissing it is not a quiet yes.
     *
     * The dialog closes with `null` on Cancel, on the mask, and on Escape. This is the reason the
     * API call lives in the panel and not in the dialog: a dismissed dialog has nothing to undo.
     */
    it('sends no request when the confirmation is dismissed', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1' })], { canEdit: true })));
      const fixture = await render();

      click(fixture, 'org-easycla-acknowledgment-invalidate');
      expect(openDialog).toHaveBeenCalledTimes(1);

      dialogClosed.next(null);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(invalidateAcknowledgment).not.toHaveBeenCalled();
    });

    it('sends the confirmed reason and note to the server for that row', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1' })], { canEdit: true })));
      const fixture = await render();

      click(fixture, 'org-easycla-acknowledgment-invalidate');
      dialogClosed.next({ reason: 'signed-in-error', note: 'duplicate signature' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(invalidateAcknowledgment).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1', 'ecla-1', {
        reason: 'signed-in-error',
        note: 'duplicate signature',
      });
    });

    /**
     * Refetch, not optimistic removal.
     *
     * The producer stamps `invalidatedAt` and `invalidatedBy` on the signature and reports neither
     * in its response, so the row's post-write state can only come from a re-read. Removing the
     * row would also make a claim that is simply wrong — the acknowledgment stays on the record,
     * invalidated, and that is what the CLA manager needs to see.
     */
    it('refetches the list after a successful invalidate rather than removing the row', async () => {
      getContributorAcknowledgments
        .mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1', name: 'Ada Lovelace' })], { canEdit: true })))
        .mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1', name: 'Ada Lovelace', approved: false })], { canEdit: true })));
      const fixture = await render();
      const fetchesBefore = getContributorAcknowledgments.mock.calls.length;

      click(fixture, 'org-easycla-acknowledgment-invalidate');
      dialogClosed.next({ reason: 'compliance' });
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getContributorAcknowledgments.mock.calls.length).toBe(fetchesBefore + 1);
      // The row is still listed, now in its Invalidated state — not gone.
      expect(allByTestId(fixture, 'org-easycla-acknowledgment-name').map(textIn)).toEqual(['Ada Lovelace']);
      expect(byTestId(fixture, 'org-easycla-acknowledgment-state-invalidated')).toBeTruthy();
    });

    it('does not refetch when the invalidate fails, and reports the server message', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1' })], { canEdit: true })));
      const fixture = await render();
      const fetchesBefore = getContributorAcknowledgments.mock.calls.length;
      invalidateAcknowledgment.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Only a CLA manager named on this CLA can invalidate acknowledgments' } }))
      );

      click(fixture, 'org-easycla-acknowledgment-invalidate');
      dialogClosed.next({ reason: 'other' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getContributorAcknowledgments.mock.calls.length).toBe(fetchesBefore);
      expect(addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: 'Only a CLA manager named on this CLA can invalidate acknowledgments' })
      );
    });
  });
});
