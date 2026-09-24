// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgClaActivityLogEntry, OrgClaActivityLogPage, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { formatClaSignedOnInstant } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaRecentActivityComponent } from './org-easycla-recent-activity.component';

describe('OrgEasyclaRecentActivityComponent', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000AcmeOrgAAA', accountName: 'Acme' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(null);
  const getActivityLog = vi.fn();

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

  function entry(overrides: Partial<OrgClaActivityLogEntry> = {}): OrgClaActivityLogEntry {
    return {
      id: 'event-1',
      when: '2026-01-15T09:20:00Z',
      actor: 'Alice Example',
      summary: 'Alice Example added an approval-list entry',
      ...overrides,
    };
  }

  function page(rows: OrgClaActivityLogEntry[], overrides: Partial<OrgClaActivityLogPage> = {}): OrgClaActivityLogPage {
    return { signatureId: 'signature-uuid-1', list: rows, resultCount: rows.length, nextKey: null, ...overrides };
  }

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function render(
    row: OrgClaGroup = claGroup(),
    platform: 'browser' | 'server' = 'browser'
  ): Promise<ComponentFixture<OrgEasyclaRecentActivityComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaRecentActivityComponent],
      providers: [
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: AccountContextService, useValue: { selectedAccount } },
        { provide: OrgLensClaService, useValue: { getActivityLog } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaRecentActivityComponent);
    fixture.componentRef.setInput('claGroup', row);
    await settle(fixture);
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

  beforeEach(() => {
    vi.resetAllMocks();
    selectedAccount.set(SELECTED_ACCOUNT);
    getActivityLog.mockReturnValue(of(page([])));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for a three-row first page, with no cursor', async () => {
    await render();

    expect(getActivityLog).toHaveBeenCalledTimes(1);
    expect(getActivityLog).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1', { pageSize: 3 });
  });

  it('renders a Recent activity heading and the Action, By and When columns', async () => {
    getActivityLog.mockReturnValue(of(page([entry()])));
    const fixture = await render();

    expect(textIn(byTestId(fixture, 'org-easycla-recent-activity-heading'))).toBe('Recent activity');
    const headers = Array.from(byTestId(fixture, 'org-easycla-recent-activity-table')?.querySelectorAll('th') ?? []).map((th) => textIn(th));
    expect(headers).toEqual(['Action', 'By', 'When']);
  });

  it('renders one row per event, newest first as the page arrived', async () => {
    getActivityLog.mockReturnValue(
      of(
        page([
          entry({ id: 'e1', summary: 'Alice Example added a CLA Manager', actor: 'Alice Example' }),
          entry({ id: 'e2', summary: 'Bob Example enabled Auto ECLA', actor: 'Bob Example' }),
        ])
      )
    );
    const fixture = await render();

    expect(allByTestId(fixture, 'org-easycla-recent-activity-summary').map(textIn)).toEqual([
      'Alice Example added a CLA Manager',
      'Bob Example enabled Auto ECLA',
    ]);
    expect(allByTestId(fixture, 'org-easycla-recent-activity-actor').map(textIn)).toEqual(['Alice Example', 'Bob Example']);
  });

  it('renders the summary as plain text, never as markup', async () => {
    getActivityLog.mockReturnValue(of(page([entry({ summary: 'Added CLA Manager <b>Bob Example</b>' })])));
    const fixture = await render();

    const cell = byTestId(fixture, 'org-easycla-recent-activity-summary');
    expect(textIn(cell)).toBe('Added CLA Manager <b>Bob Example</b>');
    expect(cell?.querySelector('b')).toBeNull();
  });

  it('reads When through the same formatter as the tab, and em-dashes an absent actor or time', async () => {
    getActivityLog.mockReturnValue(of(page([entry({ id: 'e1', when: '2026-01-15T09:20:00Z' }), entry({ id: 'e2', actor: null, when: '' })])));
    const fixture = await render();

    expect(allByTestId(fixture, 'org-easycla-recent-activity-when').map(textIn)).toEqual([formatClaSignedOnInstant('2026-01-15T09:20:00Z'), '—']);
    expect(allByTestId(fixture, 'org-easycla-recent-activity-actor').map(textIn)).toEqual(['Alice Example', '—']);
  });

  it('shows at most three rows even when a larger page comes back', async () => {
    getActivityLog.mockReturnValue(of(page(['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => entry({ id })))));
    const fixture = await render();

    expect(allByTestId(fixture, 'org-easycla-recent-activity-summary')).toHaveLength(3);
  });

  it('ignores the cursor: no Load more, no count, no search', async () => {
    getActivityLog.mockReturnValue(of(page([entry()], { nextKey: 'opaque-cursor', resultCount: 3 })));
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-recent-activity')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(textIn(fixture.nativeElement)).not.toContain('Load more');
    expect(textIn(fixture.nativeElement)).not.toContain('loaded');
    expect(getActivityLog).toHaveBeenCalledTimes(1);
  });

  it('emits viewFullActivityLog when the View full activity log control is used', async () => {
    getActivityLog.mockReturnValue(of(page([entry()])));
    const fixture = await render();
    const emitted = vi.fn();
    fixture.componentInstance.viewFullActivityLog.subscribe(emitted);

    const button = byTestId(fixture, 'org-easycla-recent-activity-view-all') as HTMLButtonElement;
    expect(textIn(button)).toBe('View full activity log');
    button.click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  describe('while the first page is loading', () => {
    it('shows a skeleton and no table', async () => {
      getActivityLog.mockReturnValue(new Subject<OrgClaActivityLogPage>());
      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-recent-activity-loading')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-recent-activity')).toBeNull();
    });

    it('drops the skeleton and renders nothing when the page comes back empty', async () => {
      const response = new Subject<OrgClaActivityLogPage>();
      getActivityLog.mockReturnValue(response);
      const fixture = await render();
      expect(byTestId(fixture, 'org-easycla-recent-activity-loading')).not.toBeNull();

      response.next(page([]));
      response.complete();
      await settle(fixture);

      expect(byTestId(fixture, 'org-easycla-recent-activity-loading')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-recent-activity')).toBeNull();
      expect(fixture.nativeElement.querySelector('table')).toBeNull();
      expect(textIn(fixture.nativeElement)).toBe('');
    });
  });

  it('renders nothing on an empty first page', async () => {
    const fixture = await render();

    expect(getActivityLog).toHaveBeenCalledTimes(1);
    expect(textIn(fixture.nativeElement)).toBe('');
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
  });

  it('renders nothing on a failed read, and logs the failure', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getActivityLog.mockReturnValue(throwError(() => new Error('boom')));
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-recent-activity-loading')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-recent-activity')).toBeNull();
    expect(textIn(fixture.nativeElement)).toBe('');
    expect(logError).toHaveBeenCalledWith('Failed to load recent activity:', 'unknown', 'Error: boom');
  });

  it('never fetches, and shows no skeleton, for an unsigned agreement', async () => {
    const fixture = await render(claGroup({ signed: false, status: 'not-started', signedOn: undefined }));

    expect(getActivityLog).not.toHaveBeenCalled();
    expect(byTestId(fixture, 'org-easycla-recent-activity-loading')).toBeNull();
    expect(textIn(fixture.nativeElement)).toBe('');
  });

  it('never fetches on the server, so no When label is formatted in the host time zone', async () => {
    const fixture = await render(claGroup(), 'server');

    expect(getActivityLog).not.toHaveBeenCalled();
    expect(byTestId(fixture, 'org-easycla-recent-activity-loading')).toBeNull();
    expect(textIn(fixture.nativeElement)).toBe('');
  });

  it('refetches when the page moves to another agreement', async () => {
    const fixture = await render();
    fixture.componentRef.setInput('claGroup', claGroup({ id: 'signature-uuid-2' }));
    await settle(fixture);

    expect(getActivityLog).toHaveBeenCalledTimes(2);
    expect(getActivityLog).toHaveBeenLastCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-2', { pageSize: 3 });
  });
});
