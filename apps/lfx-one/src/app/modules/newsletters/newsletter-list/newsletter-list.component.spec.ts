// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { NewsletterStatusCounts } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NewsletterListComponent } from './newsletter-list.component';

const counts = (overrides: Partial<NewsletterStatusCounts> = {}): NewsletterStatusCounts => ({
  draft: 3,
  scheduled: 1,
  sent: 12,
  optout: 4,
  truncated: false,
  ...overrides,
});

describe('NewsletterListComponent — status counts on tabs', () => {
  let fixture: ComponentFixture<NewsletterListComponent>;
  let service: {
    listNewsletters: ReturnType<typeof vi.fn>;
    listOptOuts: ReturnType<typeof vi.fn>;
    getStatusCounts: ReturnType<typeof vi.fn>;
    deleteNewsletter: ReturnType<typeof vi.fn>;
    deleteOptOut: ReturnType<typeof vi.fn>;
    getAnalytics: ReturnType<typeof vi.fn>;
  };
  let projectUid: ReturnType<typeof signal<string>>;

  async function render(statusCounts: Observable<NewsletterStatusCounts> = of(counts())): Promise<void> {
    projectUid = signal('project-1');
    service = {
      listNewsletters: vi.fn(() => of({ newsletters: [] })),
      listOptOuts: vi.fn(() => of({ opt_outs: [] })),
      getStatusCounts: vi.fn(() => statusCounts),
      deleteNewsletter: vi.fn(() => of(undefined)),
      deleteOptOut: vi.fn(() => of(undefined)),
      getAnalytics: vi.fn(() => of({})),
    };
    await TestBed.configureTestingModule({
      imports: [NewsletterListComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideRouter([]),
        // Server platform skips the per-row analytics fan-out, which these tests don't exercise.
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: NewsletterService, useValue: service },
        { provide: ProjectContextService, useValue: { activeContextUid: projectUid, canWrite: signal(true) } },
        ConfirmationService,
        MessageService,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NewsletterListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const labels = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid="newsletter-status-tabs"] [data-testid^="filter-pill-"]') as NodeListOf<HTMLElement>).map(
      (el) => (el.textContent ?? '').trim()
    );

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows a count on each tab once the counts load', async () => {
    await render();
    expect(service.getStatusCounts).toHaveBeenCalledExactlyOnceWith('project-1');
    expect(labels()).toEqual(['Drafts (3)', 'Scheduled (1)', 'Sent (12)', 'Opt-out (4)']);
  });

  it('keeps plain labels while counts are pending, for zero counts and for a null opt-out count', async () => {
    const pending = new Subject<NewsletterStatusCounts>();
    await render(pending);
    expect(labels()).toEqual(['Drafts', 'Scheduled', 'Sent', 'Opt-out']);

    pending.next(counts({ draft: 0, scheduled: 0, optout: null }));
    pending.complete();
    await settle();
    expect(labels()).toEqual(['Drafts', 'Scheduled', 'Sent (12)', 'Opt-out']);
  });

  it('marks draft/scheduled/sent as lower bounds when truncated, but never the opt-out count', async () => {
    await render(of(counts({ truncated: true })));
    expect(labels()).toEqual(['Drafts (3+)', 'Scheduled (1+)', 'Sent (12+)', 'Opt-out (4)']);
  });

  it('keeps plain labels when the counts request fails', async () => {
    await render(throwError(() => new Error('boom')));
    expect(labels()).toEqual(['Drafts', 'Scheduled', 'Sent', 'Opt-out']);
  });

  it('does not refetch counts when switching tabs', async () => {
    await render();
    (fixture.nativeElement.querySelector('[data-testid="filter-pill-sent"]') as HTMLButtonElement).click();
    await settle();
    expect(service.getStatusCounts).toHaveBeenCalledTimes(1);
  });

  it('refetches counts after a draft is deleted', async () => {
    await render();
    service.getStatusCounts.mockReturnValue(of(counts({ draft: 2 })));

    fixture.componentInstance['runDelete']('draft-1');
    await settle();

    expect(service.deleteNewsletter).toHaveBeenCalledWith('project-1', 'draft-1');
    expect(service.getStatusCounts).toHaveBeenCalledTimes(2);
    expect(labels()[0]).toBe('Drafts (2)');
  });

  it('drops a count refresh from a mutation that finishes after switching project', async () => {
    await render();
    const projectB = new Subject<NewsletterStatusCounts>();
    service.getStatusCounts.mockImplementation((uid: string) => (uid === 'project-2' ? projectB : of(counts())));
    const removal = new Subject<void>();
    service.deleteOptOut.mockReturnValue(removal);

    // Remove an opt-out in project A, then switch to B before the removal finishes.
    fixture.componentInstance['runRemoveOptOut']('project-1', { id: 'o1', email: 'someone@acme-motors.example', unsubscribed_at: '2026-01-01T00:00:00Z' });
    projectUid.set('project-2');
    await settle();
    expect(service.getStatusCounts).toHaveBeenLastCalledWith('project-2');

    removal.next();
    removal.complete();
    await settle();
    // A's refresh must not start (it would supersede B's pending request) ...
    expect(service.getStatusCounts.mock.calls.map((call) => call[0])).toEqual(['project-1', 'project-2']);

    // ... so B's response still lands.
    projectB.next(counts({ draft: 7 }));
    projectB.complete();
    await settle();
    expect(labels()[0]).toBe('Drafts (7)');
  });

  it('ignores a late counts response for a project that is no longer active', async () => {
    const projectA = new Subject<NewsletterStatusCounts>();
    await render(projectA);
    service.getStatusCounts.mockReturnValue(of(counts({ draft: 7 })));

    projectUid.set('project-2');
    await settle();
    expect(labels()[0]).toBe('Drafts (7)');

    projectA.next(counts({ draft: 99 }));
    await settle();
    expect(labels()[0]).toBe('Drafts (7)');
  });

  it('lets the latest counts request win over a slower earlier one', async () => {
    const first = new Subject<NewsletterStatusCounts>();
    await render(first);
    service.getStatusCounts.mockReturnValue(of(counts({ draft: 2 })));

    fixture.componentInstance['runDelete']('draft-1');
    await settle();
    expect(labels()[0]).toBe('Drafts (2)');

    // The slower first response arrives last and must not overwrite the newer counts.
    first.next(counts({ draft: 99 }));
    await settle();
    expect(labels()[0]).toBe('Drafts (2)');
  });
});
