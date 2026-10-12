// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Committee } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { PersonaService } from '@services/persona.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';
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

describe('CommitteeTableComponent consumer behavior', () => {
  let fixture: ComponentFixture<TableHostComponent>;
  let confirmation: ConfirmationService;
  const leaveCommittee = vi.fn(() => of(undefined));
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(async () => {
    leaveCommittee.mockClear();
    writeText.mockClear();
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
    const associated = element('[data-testid="committee-row-associated"]');
    expect(associated.textContent).toContain('Mailing list associated');
    expect(associated.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(element('[data-testid="committee-row-none"]').textContent).toContain('No channels');
  });

  it.each(['#general', 'team-chat', 'javascript:alert(1)', 'data:text/html,chat', 'vbscript:msgbox(1)', 'file:///chat', 'ftp://example.com/chat'])(
    'shows chat channel %s as informational text without a destination',
    async (chatChannel) => {
      await showRows([group({ chat_channel: chatChannel })]);
      const channels = element('[data-testid="committee-row-synthetic-alpha"] td[data-label="Channels"]');
      expect(channels.textContent).toContain(chatChannel);
      expect(channels.querySelector('a, button, [tabindex]')).toBeNull();
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
});
