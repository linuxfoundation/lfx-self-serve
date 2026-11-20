// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Committee } from '@lfx-one/shared';
import { MemberImportAccessState, MemberImportRunSummary } from '@lfx-one/shared/interfaces';
import { CommitteeMemberImportDialogService } from '@services/committee-member-import-dialog.service';
import { CommitteeMemberImportService } from '@services/committee-member-import.service';
import { CommitteeService } from '@services/committee.service';
import { PersonaService } from '@services/persona.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeTableComponent } from './committee-table.component';

function group(overrides: Partial<Committee> = {}): Committee {
  return {
    uid: 'synthetic-alpha',
    name: 'Synthetic Alpha',
    category: 'Working Group',
    enable_voting: true,
    public: true,
    sso_group_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    total_members: 3,
    project_uid: 'synthetic-project',
    project_name: 'Synthetic Project',
    classDisplay: { label: 'Working Group', icon: 'fa-light fa-users', color: 'text-blue-700', bgColor: 'bg-blue-50' },
    ...overrides,
  };
}

const tableHostTemplate = `<lfx-committee-table [committees]="results()" [hasItems]="true" [isMeLens]="isMe()"
  [showFilterBar]="false" [searchForm]="form" [votingStatusOptions]="[]"
  (resetRequested)="reset()" (rowClick)="selected.set($event.uid)" />`;

@Component({
  selector: 'lfx-table-test-host',
  imports: [CommitteeTableComponent],
  template: tableHostTemplate,
})
class TableHostComponent {
  public readonly isMe = signal(true);
  public readonly source = signal<Committee[]>([group()]);
  public readonly category = signal<string | null>('different-category');
  public readonly foundation = signal<string | null>('different-foundation');
  public readonly project = signal<string | null>('different-project');
  public readonly selected = signal<string | null>(null);
  public readonly form = new FormGroup({
    search: new FormControl('no match', { nonNullable: true }),
    votingStatus: new FormControl<string | null>('disabled'),
    joinModeFilter: new FormControl<string | null>('closed'),
    foundationFilter: new FormControl<string | null>('different-foundation'),
    projectFilter: new FormControl<string | null>('different-project'),
  });
  private readonly filters = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  public readonly results = computed(() =>
    this.source().filter(
      (item) =>
        (!this.category() || item.category === this.category()) &&
        (!this.foundation() || item.parent_project_uid === this.foundation()) &&
        (!this.project() || item.project_uid === this.project()) &&
        item.name.includes(this.filters().search ?? '') &&
        (!this.filters().votingStatus || String(item.enable_voting) === (this.filters().votingStatus === 'enabled' ? 'true' : 'false'))
    )
  );

  public reset(): void {
    this.form.patchValue({ search: '', votingStatus: null, joinModeFilter: null, foundationFilter: null, projectFilter: null });
    this.category.set(null);
    this.foundation.set(null);
    this.project.set(null);
  }
}

function importSummary(patch: Partial<MemberImportRunSummary> = {}): MemberImportRunSummary {
  return {
    committeeUid: 'synthetic-alpha',
    committeeName: 'Synthetic Alpha',
    runId: 'member-import-1',
    attempt: 1,
    phase: 'importing',
    batchTotal: 30,
    batchSettled: 25,
    added: 25,
    failed: 0,
    unknown: 0,
    notSubmitted: 0,
    retryable: 0,
    stopReason: null,
    manualStopRequested: false,
    baselineMemberCount: 3,
    reconciliationTarget: 28,
    ...patch,
  };
}

describe('CommitteeTableComponent consumer behavior', () => {
  let fixture: ComponentFixture<TableHostComponent>;
  let confirmation: ConfirmationService;
  const leaveCommittee = vi.fn(() => of(undefined));
  const writeText = vi.fn(() => Promise.resolve());
  const summaries = signal<ReadonlyMap<string, MemberImportRunSummary>>(new Map());
  const access = signal<ReadonlyMap<string, MemberImportAccessState>>(new Map());
  const probeAccess = vi.fn<(uids: readonly string[]) => Subject<never>>(() => new Subject<never>());
  const openRun = vi.fn();

  beforeEach(async () => {
    leaveCommittee.mockClear();
    writeText.mockClear();
    probeAccess.mockClear();
    openRun.mockClear();
    summaries.set(new Map());
    access.set(new Map());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await TestBed.configureTestingModule({
      imports: [TableHostComponent],
      providers: [
        provideRouter([{ path: 'foundation/groups/:uid', component: TableHostComponent }]),
        provideNoopAnimations(),
        ConfirmationService,
        MessageService,
        { provide: PersonaService, useValue: { currentPersona: signal('contributor') } },
        { provide: CommitteeService, useValue: { leaveCommittee } },
        { provide: CommitteeMemberImportService, useValue: { getSummary: (uid: string) => summaries().get(uid) } },
        { provide: CommitteeMemberImportDialogService, useValue: { accessByUid: access, probeAccess, openRun } },
      ],
    }).compileComponents();
    confirmation = TestBed.inject(ConfirmationService);
    fixture = TestBed.createComponent(TableHostComponent);
    await fixture.whenStable();
  });

  afterEach(() => vi.unstubAllGlobals());

  function element(selector: string): HTMLElement {
    const root: HTMLElement = fixture.nativeElement;
    const result = root.querySelector<HTMLElement>(selector);
    expect(result, selector).not.toBeNull();
    return result!;
  }

  async function showRows(rows: Committee[]): Promise<void> {
    fixture.componentInstance.source.set(rows);
    fixture.componentInstance.reset();
    await fixture.whenStable();
  }

  it('restores the parent full filter state and results from the Me filtered-zero CTA', async () => {
    expect(fixture.componentInstance.results()).toEqual([]);
    element('lfx-empty-state button').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.getRawValue()).toEqual({
      search: '',
      votingStatus: null,
      joinModeFilter: null,
      foundationFilter: null,
      projectFilter: null,
    });
    expect(fixture.componentInstance.category()).toBeNull();
    expect(fixture.componentInstance.foundation()).toBeNull();
    expect(fixture.componentInstance.project()).toBeNull();
    expect(fixture.componentInstance.results().map((item) => item.uid)).toEqual(['synthetic-alpha']);
    expect(element('[data-testid="committee-row-synthetic-alpha"]').textContent).toContain('Synthetic Alpha');
  });

  it('clears legacy controls even without a parent reset handler', async () => {
    const legacy = TestBed.createComponent(CommitteeTableComponent);
    const form = fixture.componentInstance.form;
    legacy.componentRef.setInput('committees', []);
    legacy.componentRef.setInput('searchForm', form);
    legacy.componentRef.setInput('votingStatusOptions', []);
    legacy.componentRef.setInput('showFilterBar', false);
    await legacy.whenStable();
    const root: HTMLElement = legacy.nativeElement;
    root.querySelector<HTMLButtonElement>('lfx-empty-state button')!.click();
    await legacy.whenStable();
    expect(form.getRawValue()).toEqual({ search: '', votingStatus: null, joinModeFilter: null, foundationFilter: null, projectFilter: null });
    legacy.destroy();
  });

  it('distinguishes literal capability booleans from missing and malformed runtime values', async () => {
    const missing = { ...group({ uid: 'missing' }), enable_voting: undefined } as unknown as Committee;
    const malformed = { ...group({ uid: 'malformed' }), enable_voting: 'true' } as unknown as Committee;
    await showRows([group({ uid: 'enabled' }), group({ uid: 'disabled', enable_voting: false }), missing, malformed]);
    expect(element('[data-testid="committee-voting-enabled"]').textContent?.trim()).toBe('Enabled');
    expect(element('[data-testid="committee-voting-disabled"]').textContent?.trim()).toBe('Disabled');
    expect(element('[data-testid="committee-voting-missing"]').textContent?.trim()).toBe('Unavailable');
    expect(element('[data-testid="committee-voting-malformed"]').textContent?.trim()).toBe('Unavailable');
  });

  it('lets Board Members activate the canonical My Groups title link', async () => {
    TestBed.inject(PersonaService).currentPersona.set('board-member');
    await showRows([group({ is_foundation: true, project_slug: 'synthetic-owner' })]);
    const title = element('[data-testid="committee-row-synthetic-alpha"] td[data-label="Group"] a') as HTMLAnchorElement;
    expect(title.getAttribute('href')).toBe('/foundation/groups/synthetic-alpha?project=synthetic-owner');
    title.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/foundation/groups/synthetic-alpha?project=synthetic-owner');
  });

  it('offers only real channel destinations and keeps association-only metadata noninteractive', async () => {
    await showRows([
      group({ uid: 'linked', mailing_list: 'synthetic@example.test', chat_channel: 'https://slack.com/synthetic' }),
      group({ uid: 'associated', has_mailing_list: true }),
      group({ uid: 'none' }),
    ]);
    const linked = element('[data-testid="committee-row-linked"]');
    expect(linked.querySelector('a[href="mailto:synthetic@example.test"]')).not.toBeNull();
    expect(linked.querySelector('a[href="https://slack.com/synthetic"]')?.getAttribute('rel')).toBe('noopener');
    // Icon-only: no visible "Mailing list" / platform text beside the icons.
    expect(linked.querySelector('td[data-label="Channels"]')?.textContent?.trim()).toBe('');
    const associated = element('[data-testid="committee-row-associated"]');
    expect(associated.querySelector('[aria-label="Mailing list associated"]')).not.toBeNull();
    expect(associated.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(element('[data-testid="committee-row-none"]').textContent).toContain('No channels');
  });

  it('links an associated mailing list to its detail page when the list is known', async () => {
    await showRows([
      group({
        uid: 'listed',
        has_mailing_list: true,
        is_foundation: true,
        mailing_lists: [{ uid: 'ml-1', group_name: 'synthetic-list' }],
      }),
    ]);
    const link = element('[data-testid="committee-table-mailing-list-link-listed"]');
    expect(link.getAttribute('href')).toContain('/foundation/mailing-lists/ml-1');
    expect(link.getAttribute('aria-label')).toBe('Mailing list: synthetic-list');
    expect(element('[data-testid="committee-row-listed"]').querySelector('[aria-label="Mailing list associated"]')).toBeNull();
  });

  it.each(['#general', 'team-chat', 'javascript:alert(1)', 'data:text/html,chat', 'vbscript:msgbox(1)', 'file:///chat', 'ftp://example.com/chat'])(
    'shows chat channel %s as an icon with its text as the label, without a destination',
    async (chatChannel) => {
      await showRows([group({ chat_channel: chatChannel })]);
      const channels = element('[data-testid="committee-row-synthetic-alpha"] td[data-label="Channels"]');
      const icon = channels.querySelector('[role="img"]');
      expect(icon?.getAttribute('aria-label')).toBe(chatChannel);
      // Keyboard-focusable so the tooltip with the channel name can be revealed without a mouse.
      expect(icon?.getAttribute('tabindex')).toBe('0');
      expect(channels.querySelector('a, button')).toBeNull();
      expect(channels.textContent).not.toContain('No channels');
    }
  );

  it.each([
    { channel: 'https://slack.com/synthetic', destination: 'https://slack.com/synthetic' },
    { channel: 'http://example.com/chat', destination: 'http://example.com/chat' },
    { channel: 'example.com/chat', destination: 'https://example.com/chat' },
    { channel: 'HTTPS://example.com/chat', destination: 'HTTPS://example.com/chat' },
  ])('opens normalized chat destination $destination without selecting its group', async ({ channel, destination }) => {
    await showRows([group({ chat_channel: channel })]);
    const link = element('[data-testid="committee-row-synthetic-alpha"] td[data-label="Channels"] a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(destination);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    link.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selected()).toBeNull();
  });

  it('does not select a group from channels or copy, but does select from a noninteractive row cell', async () => {
    await showRows([group({ mailing_list: 'synthetic@example.test', chat_channel: 'https://slack.com/synthetic' })]);
    for (const selector of ['a[href^="mailto:"]', 'a[target="_blank"]', '[data-testid="public-group-copy-link-synthetic-alpha"]']) {
      const control = element(selector);
      // Prevent browser navigation while retaining the actual bubbling click path through the wrapper.
      control.addEventListener('click', (event) => event.preventDefault(), { once: true });
      control.click();
      await fixture.whenStable();
      expect(fixture.componentInstance.selected()).toBeNull();
    }
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/groups/synthetic-alpha`);
    element('[data-testid="committee-voting-synthetic-alpha"] span').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selected()).toBe('synthetic-alpha');
  });

  it('canceling Leave never requests a membership mutation or selects the row', async () => {
    await showRows([group()]);
    const confirm = vi.spyOn(confirmation, 'confirm');
    element('[data-testid="committee-leave-synthetic-alpha"] button').click();
    await fixture.whenStable();
    expect(confirm).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.selected()).toBeNull();
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find((button) =>
      button.textContent?.includes('Cancel')
    );
    expect(cancel).toBeDefined();
    cancel!.click();
    await fixture.whenStable();
    expect(leaveCommittee).not.toHaveBeenCalled();
  });

  describe('retained CSV import status (#5731)', () => {
    async function retain(summary: MemberImportRunSummary, state: MemberImportAccessState | null = 'authorized'): Promise<void> {
      summaries.set(new Map([[summary.committeeUid, summary]]));
      access.set(state ? new Map([[summary.committeeUid, state]]) : new Map());
      await fixture.whenStable();
    }

    function status(): HTMLElement | null {
      return fixture.nativeElement.querySelector('[data-testid="committee-import-status-synthetic-alpha"]');
    }

    it.each([true, false])('keeps the API member count and shows the authorized status beneath it (My Groups %s)', async (isMe) => {
      fixture.componentInstance.isMe.set(isMe);
      // My Groups rows carry no effective writer; the fresh access check decides instead.
      await showRows([group({ writer: undefined })]);
      await retain(importSummary());

      const entry = status();
      expect(entry?.tagName).toBe('BUTTON');
      expect(entry?.textContent).toContain('Importing 25/30');
      expect(entry?.getAttribute('aria-label')).toBe('Importing 25/30 for Synthetic Alpha. Opens the import progress.');
      expect(entry?.parentElement?.querySelector('span')?.textContent?.trim()).toBe('3');
    });

    it.each([
      ['paused', 'Import paused'],
      ['stopping', 'Stopping import'],
      ['settled', 'View import report'],
    ] as const)('labels a %s run', async (phase, label) => {
      await showRows([group()]);
      await retain(importSummary({ phase }));

      expect(status()?.textContent).toContain(label);
    });

    it.each(['pending', 'denied', 'error'] as const)('reveals nothing while access is %s', async (state) => {
      await showRows([group({ writer: true })]);
      await retain(importSummary(), state === 'pending' ? null : state);

      expect(status()).toBeNull();
    });

    it('probes only shown groups with retained runs, again on a list refresh but not on progress', async () => {
      await showRows([group(), group({ uid: 'synthetic-beta', name: 'Synthetic Beta' })]);
      expect(probeAccess).toHaveBeenLastCalledWith([]);
      await retain(importSummary());
      expect(probeAccess).toHaveBeenLastCalledWith(['synthetic-alpha']);
      const calls = probeAccess.mock.calls.length;

      await retain(importSummary({ batchSettled: 30 }));
      expect(probeAccess).toHaveBeenCalledTimes(calls);

      await showRows([group({ total_members: 28 }), group({ uid: 'synthetic-beta', name: 'Synthetic Beta' })]);
      expect(probeAccess.mock.calls.length).toBeGreaterThan(calls);
      expect(probeAccess).toHaveBeenLastCalledWith(['synthetic-alpha']);
    });

    it('opens the run by click or keyboard without selecting the row', async () => {
      await showRows([group()]);
      await retain(importSummary({ phase: 'settled' }));

      status()!.click();
      for (const key of ['Enter', ' ']) {
        status()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
      await fixture.whenStable();

      expect(openRun).toHaveBeenCalledExactlyOnceWith('synthetic-alpha');
      expect(fixture.componentInstance.selected()).toBeNull();
    });
  });
});
