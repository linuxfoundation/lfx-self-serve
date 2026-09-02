// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import {
  WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS,
  WEEKLY_BRIEF_POLL_INTERVAL_MS,
  WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD,
} from '@lfx-one/shared/constants';
import {
  Committee,
  GenerateWeeklyBriefResponse,
  WeeklyBriefCurrentResponse,
  WeeklyBriefRating,
  WeeklyBriefSourceRef,
  WeeklyBriefThrottle,
} from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { WeeklyBriefService } from '@services/weekly-brief.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError, TimeoutError } from 'rxjs';

import { WeeklyBriefCardComponent } from './weekly-brief-card.component';

/**
 * Covers performShareToSlack's error classifier (weekly-brief-card.component.ts's largest new
 * surface on LFXV2-3080, previously untested) — getting a branch's message wrong (e.g. an
 * ambiguous 5xx claiming "safe to retry") is a silent correctness bug with no compiler signal.
 * ConfirmationService is the real class, not a fake —
 * PrimeNG's own <p-confirmDialog> in the template subscribes to its internal Subjects directly in
 * its constructor (see committee-settings-tab.component.spec.ts for the same finding) — but its
 * `confirm()` method is spied so the accept callback can be invoked directly without going through
 * the rendered dialog's DOM.
 */
describe('WeeklyBriefCardComponent — Share to Slack (LFXV2-3080)', () => {
  let fixture: ComponentFixture<WeeklyBriefCardComponent>;
  let component: WeeklyBriefCardComponent;
  let shareWeeklyBriefToSlack: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  let impersonating: WritableSignal<boolean>;

  const COMMITTEE: Committee = {
    uid: 'committee-1',
    name: 'Test Committee',
    project_uid: 'project-1',
    has_slack_webhook: true,
  } as Committee;

  const BRIEF_RESPONSE: WeeklyBriefCurrentResponse = {
    brief: {
      uid: 'brief-1',
      committee_uid: 'committee-1',
      window_start: '2026-08-02T00:00:00Z',
      window_end: '2026-08-08T23:59:59Z',
      state: 'generated',
      brief_text: 'Weekly summary.',
      source_refs: [],
      prompt_version: 'v1',
      model: 'test-model',
      regeneration_count: 0,
      private_source_present: false,
      created_at: '2026-08-08T00:00:00Z',
      updated_at: '2026-08-08T00:00:00Z',
      revision: 3,
    },
    throttle: { generates_used: 1, generates_limit: 2, regenerations_used: 0, regenerations_limit: 3, window_resets_at: '2026-08-09T00:00:00Z' },
    caller_rating: null,
  };

  beforeEach(async () => {
    shareWeeklyBriefToSlack = vi.fn(() => of({}));
    messageAdd = vi.fn();
    impersonating = signal(false);

    await TestBed.configureTestingModule({
      imports: [WeeklyBriefCardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: WeeklyBriefService,
          useValue: {
            getWeeklyBrief: vi.fn(() => of(BRIEF_RESPONSE)),
            shareWeeklyBriefToSlack,
            listWeeklyBriefs: vi.fn(() => of({ data: [] })),
          },
        },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: MessageService, useValue: { add: messageAdd } },
        // Real service — see file docblock.
        ConfirmationService,
        { provide: UserService, useValue: { impersonating } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyBriefCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
  });

  /** Triggers onShareToSlack() and immediately accepts the confirmation dialog without touching the DOM. */
  function shareToSlack(): void {
    const confirmationService = TestBed.inject(ConfirmationService);
    const confirmSpy = vi.spyOn(confirmationService, 'confirm');
    component.onShareToSlack();
    // Under vitest ^3.2.4 (this workspace's pinned version — packages/shared runs vitest 4,
    // which behaves differently: it reuses the existing spy and calls DO accumulate there),
    // vi.spyOn installs a fresh, empty spy on every call, so since this function calls it and
    // then immediately triggers exactly one confirm(), [0] and .at(-1) are equivalent today.
    // .at(-1) is used anyway — it's the correct read under both versions' semantics, so it costs
    // nothing now and removes one thing to fix if this workspace ever moves to vitest 4.
    const opts = confirmSpy.mock.calls.at(-1)?.[0];
    // Asserted, not optional-chained through: onShareToSlack() returning early (e.g. a future
    // negative test where committeeUid/revision is missing) must fail loudly here, not silently
    // no-op past a missing confirm() call into a vacuously-passing assertion below.
    expect(opts?.accept).toBeTypeOf('function');
    opts!.accept!();
  }

  it('sends the brief and shows a success toast on a 200', () => {
    shareToSlack();

    expect(shareWeeklyBriefToSlack).toHaveBeenCalledWith('committee-1', 3);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('distinguishes IMPERSONATION_READ_ONLY (403) from a plain not-a-writer 403', () => {
    shareWeeklyBriefToSlack.mockReturnValueOnce(throwError(() => ({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } })));
    shareToSlack();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('impersonating') }));

    messageAdd.mockClear();
    shareWeeklyBriefToSlack.mockReturnValueOnce(throwError(() => ({ status: 403, error: {} })));
    shareToSlack();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('project writers') }));
  });

  it('REVISION_MISMATCH (409) tells the user to reload and triggers a refresh', () => {
    shareWeeklyBriefToSlack.mockReturnValueOnce(throwError(() => ({ status: 409, error: { code: 'REVISION_MISMATCH' } })));

    shareToSlack();

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('Reload') }));
  });

  it('NO_SLACK_WEBHOOK (409) tells the user no webhook is configured', () => {
    shareWeeklyBriefToSlack.mockReturnValueOnce(throwError(() => ({ status: 409, error: { code: 'NO_SLACK_WEBHOOK' } })));

    shareToSlack();

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('No Slack webhook') }));
  });

  it('an unclassified 5xx says the send may not have completed', () => {
    shareWeeklyBriefToSlack.mockReturnValueOnce(throwError(() => ({ status: 503, error: {} })));

    shareToSlack();

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('may not have completed') }));
  });

  it('a network failure (status 0) also says the send may not have completed', () => {
    shareWeeklyBriefToSlack.mockReturnValueOnce(throwError(() => ({ status: 0, error: {} })));

    shareToSlack();

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('may not have completed') }));
  });

  it('BACKEND_NOT_LIVE (409) tells the user sharing is unavailable in this environment', () => {
    shareWeeklyBriefToSlack.mockReturnValueOnce(throwError(() => ({ status: 409, error: { code: 'BACKEND_NOT_LIVE' } })));

    shareToSlack();

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('not available in this environment') }));
  });

  it('FEATURE_DISABLED (409) tells the user Slack sharing is not enabled here — must not fall through to the generic "reload and try again" fallback, which implies retrying could help', () => {
    shareWeeklyBriefToSlack.mockReturnValueOnce(throwError(() => ({ status: 409, error: { code: 'FEATURE_DISABLED' } })));

    shareToSlack();

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('not enabled in this environment') }));
    expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('Reload and try again') }));
  });

  it('shows the disabled hint (not the impersonating hint) when no webhook is configured and the caller is not impersonating', async () => {
    fixture.componentRef.setInput('committee', { ...COMMITTEE, has_slack_webhook: false });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-share-slack-disabled-hint"]')?.textContent).toContain(
      'No Slack webhook configured'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-share-slack-impersonating-hint"]')).toBeNull();
  });

  it('shows the impersonating hint when impersonating, even though a webhook is configured', async () => {
    impersonating.set(true);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-share-slack-impersonating-hint"]')?.textContent).toContain('impersonating');
  });

  it("shows the impersonating hint, not the disabled hint, when both conditions are true — pins the template's @if/@else-if precedence", async () => {
    fixture.componentRef.setInput('committee', { ...COMMITTEE, has_slack_webhook: false });
    impersonating.set(true);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-share-slack-impersonating-hint"]')?.textContent).toContain('impersonating');
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-share-slack-disabled-hint"]')).toBeNull();
  });

  it('shows neither Slack hint (but does render the Share to Slack button) when a webhook is configured and the caller is not impersonating', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-share-slack-button"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-share-slack-disabled-hint"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-share-slack-impersonating-hint"]')).toBeNull();
  });
});

/**
 * Covers the Sources row collapse-behind-disclosure + dedupe (LFXV2-3335): flat render at/under
 * the 5-source threshold, the disclosure appearing above it, level-1 (row) and level-2 (group)
 * toggles, that an expanded group instance still fires onSourceChipAction with its own action,
 * and that both expanded states reset on a committee navigation — mirrors the existing
 * committeeUid$ reset-block coverage pattern (none of those other resets have dedicated tests in
 * this file either; this is the first, following the same input-swap + whenStable() approach).
 */
describe('WeeklyBriefCardComponent — Sources disclosure (LFXV2-3335)', () => {
  let fixture: ComponentFixture<WeeklyBriefCardComponent>;
  let component: WeeklyBriefCardComponent;
  let getWeeklyBrief: ReturnType<typeof vi.fn>;

  const COMMITTEE_A: Committee = { uid: 'committee-a', name: 'Committee A', project_uid: 'project-1' } as Committee;
  const COMMITTEE_B: Committee = { uid: 'committee-b', name: 'Committee B', project_uid: 'project-1' } as Committee;

  function sourceRef(id: string, overrides: Partial<WeeklyBriefSourceRef> = {}): WeeklyBriefSourceRef {
    return { id, kind: 'meeting', title: `Meeting ${id}`, ...overrides };
  }

  function briefResponse(sourceRefs: WeeklyBriefSourceRef[]): WeeklyBriefCurrentResponse {
    return {
      brief: {
        uid: 'brief-1',
        committee_uid: 'committee-a',
        window_start: '2026-08-02T00:00:00Z',
        window_end: '2026-08-08T23:59:59Z',
        state: 'generated',
        brief_text: 'Weekly summary.',
        source_refs: sourceRefs,
        prompt_version: 'v1',
        model: 'test-model',
        regeneration_count: 0,
        private_source_present: false,
        created_at: '2026-08-08T00:00:00Z',
        updated_at: '2026-08-08T00:00:00Z',
        revision: 1,
      },
      throttle: { generates_used: 0, generates_limit: 2, regenerations_used: 0, regenerations_limit: 3, window_resets_at: '2026-08-09T00:00:00Z' },
      caller_rating: null,
    };
  }

  async function setup(sourceRefs: WeeklyBriefSourceRef[]): Promise<void> {
    getWeeklyBrief = vi.fn(() => of(briefResponse(sourceRefs)));

    await TestBed.configureTestingModule({
      imports: [WeeklyBriefCardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: WeeklyBriefService, useValue: { getWeeklyBrief, listWeeklyBriefs: vi.fn(() => of({ data: [] })) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        // Real service — see the Share to Slack describe block's docblock above for why.
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyBriefCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE_A);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
  }

  const OVER_THRESHOLD_COUNT = WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD + 1;

  /** Clicks a data-testid element and flushes it, failing loudly if the element isn't there. */
  async function clickTestId(testId: string): Promise<HTMLElement> {
    const el = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    expect(el).not.toBeNull();
    el!.click();
    await fixture.whenStable();
    return el!;
  }

  it(`renders flat with no disclosure toggle at the collapse threshold (${WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD} sources)`, async () => {
    await setup(Array.from({ length: WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD }, (_, i) => sourceRef(`ref-${i}`, { title: `Unique Meeting ${i}` })));

    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-sources-toggle"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="weekly-brief-card-source-chip-"]')).toHaveLength(WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD);
  });

  it(`collapses behind a disclosure toggle above the threshold (${OVER_THRESHOLD_COUNT} sources)`, async () => {
    await setup(Array.from({ length: OVER_THRESHOLD_COUNT }, (_, i) => sourceRef(`ref-${i}`, { title: `Unique Meeting ${i}` })));

    const toggle = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-sources-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toContain(`Sources (${OVER_THRESHOLD_COUNT})`);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('[data-testid^="weekly-brief-card-source-chip-"]')).toBeNull();
  });

  it('renders a duplicate-label group chip with its own level-2 toggle even inside the flat (at-threshold) row — dedupe applies regardless of the disclosure', async () => {
    await setup([
      sourceRef('vote-1', { kind: 'vote', title: 'Q1 Budget' }),
      sourceRef('vote-2', { kind: 'vote', title: 'Q1 Budget' }),
      sourceRef('vote-3', { kind: 'vote', title: 'Q1 Budget' }),
      sourceRef('doc-1', { kind: 'doc', title: 'Charter.pdf' }),
      sourceRef('meeting-1', { kind: 'meeting', title: 'Weekly Sync' }),
    ]);

    // 5 raw refs, at the threshold — flat row, no level-1 disclosure toggle.
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-sources-toggle"]')).toBeNull();

    const groupToggle = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-source-group-toggle-vote-1"]');
    expect(groupToggle).not.toBeNull();
    expect(groupToggle.textContent).toContain('Q1 Budget (3)');
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-source-chip-vote-2"]')).toBeNull();

    await clickTestId('weekly-brief-card-source-group-toggle-vote-1');

    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-source-chip-vote-2"]').textContent).toContain('Q1 Budget #2');
  });

  it('still renders a chip of an unrecognized kind in the expanded view, under an "Other" section', async () => {
    await setup([
      ...Array.from({ length: WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD }, (_, i) => sourceRef(`ref-${i}`, { title: `Unique Meeting ${i}` })),
      sourceRef('future-1', { kind: 'some_future_kind', title: 'A Brand New Source Kind' }),
    ]);

    await clickTestId('weekly-brief-card-sources-toggle');

    // sourceRefCount still counts it even though it isn't one of the five known kinds.
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-sources-toggle"]').textContent).toContain(`Sources (${OVER_THRESHOLD_COUNT})`);
    const otherSection = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-source-section-other"]');
    expect(otherSection).not.toBeNull();
    expect(otherSection.textContent).toContain('Other');
    const chip = otherSection.querySelector('[data-testid="weekly-brief-card-source-chip-future-1"]');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('A Brand New Source Kind');
  });

  it('renders sections in the fixed Meetings / Votes / Mailing List / Documents / Membership / Other order', async () => {
    await setup([
      sourceRef('members-1', { kind: 'members', title: 'Member roster changes' }),
      sourceRef('doc-1', { kind: 'doc', title: 'Charter.pdf' }),
      sourceRef('ml-1', { kind: 'mailing-list', title: 'Announce List' }),
      sourceRef('vote-1', { kind: 'vote', title: 'Q1 Budget' }),
      sourceRef('meeting-1', { kind: 'meeting', title: 'Weekly Sync' }),
      sourceRef('future-1', { kind: 'some_future_kind', title: 'A Brand New Source Kind' }),
    ]);

    await clickTestId('weekly-brief-card-sources-toggle');

    const sectionKinds = Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="weekly-brief-card-source-section-"]')).map((el) =>
      (el as HTMLElement).getAttribute('data-testid')
    );
    expect(sectionKinds).toEqual([
      'weekly-brief-card-source-section-meeting',
      'weekly-brief-card-source-section-vote',
      'weekly-brief-card-source-section-mailing-list',
      'weekly-brief-card-source-section-doc',
      'weekly-brief-card-source-section-members',
      'weekly-brief-card-source-section-other',
    ]);
  });

  it('level-1 toggle expands and re-collapses the sectioned view', async () => {
    await setup(Array.from({ length: OVER_THRESHOLD_COUNT }, (_, i) => sourceRef(`ref-${i}`, { title: `Unique Meeting ${i}` })));

    const toggle = await clickTestId('weekly-brief-card-sources-toggle');
    expect(component.sourcesExpanded()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="weekly-brief-card-source-chip-"]')).toHaveLength(OVER_THRESHOLD_COUNT);

    await clickTestId('weekly-brief-card-sources-toggle');
    expect(component.sourcesExpanded()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid^="weekly-brief-card-source-chip-"]')).toBeNull();
  });

  it('level-2 toggle expands a group chip into ordinally-labeled instances, each still firing onSourceChipAction with its own action', async () => {
    await setup([
      sourceRef('vote-1', { kind: 'vote', title: 'Q1 Budget' }),
      sourceRef('vote-2', { kind: 'vote', title: 'Q1 Budget' }),
      sourceRef('vote-3', { kind: 'vote', title: 'Q1 Budget' }),
      sourceRef('doc-1', { kind: 'doc', title: 'Charter.pdf' }),
      sourceRef('meeting-1', { kind: 'meeting', title: 'Weekly Sync' }),
      sourceRef('members-1', { kind: 'members', title: 'Member roster changes' }),
    ]);

    await clickTestId('weekly-brief-card-sources-toggle');

    const groupToggle = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-source-group-toggle-vote-1"]');
    expect(groupToggle).not.toBeNull();
    expect(groupToggle.textContent).toContain('Q1 Budget (3)');
    expect(groupToggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-source-chip-vote-2"]')).toBeNull();

    const voteDrawerRequested = vi.fn();
    component.voteDrawerRequested.subscribe(voteDrawerRequested);

    await clickTestId('weekly-brief-card-source-group-toggle-vote-1');

    expect(groupToggle.getAttribute('aria-expanded')).toBe('true');
    const instanceButton = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-source-chip-vote-2"]');
    expect(instanceButton).not.toBeNull();
    expect(instanceButton.textContent).toContain('Q1 Budget #2');

    instanceButton.click();
    expect(voteDrawerRequested).toHaveBeenCalledWith('vote-2');
  });

  it('clears sourcesExpanded and expandedSourceGroups when navigating to a different committee', async () => {
    await setup([
      sourceRef('vote-1', { kind: 'vote', title: 'Q1 Budget' }),
      sourceRef('vote-2', { kind: 'vote', title: 'Q1 Budget' }),
      sourceRef('doc-1', { kind: 'doc', title: 'Charter.pdf' }),
      sourceRef('meeting-1', { kind: 'meeting', title: 'Weekly Sync' }),
      sourceRef('members-1', { kind: 'members', title: 'Member roster changes' }),
      sourceRef('mailing-1', { kind: 'mailing-list', title: 'Announce List' }),
    ]);

    await clickTestId('weekly-brief-card-sources-toggle');
    await clickTestId('weekly-brief-card-source-group-toggle-vote-1');
    expect(component.sourcesExpanded()).toBe(true);
    expect(component.expandedSourceGroups().has('vote-1')).toBe(true);

    getWeeklyBrief.mockReturnValue(of(briefResponse([])));
    fixture.componentRef.setInput('committee', COMMITTEE_B);
    await fixture.whenStable();

    expect(component.sourcesExpanded()).toBe(false);
    expect(component.expandedSourceGroups().size).toBe(0);
  });
});

/**
 * Covers the "this week so far" activity tally (GH-1922): the caption for a multi-kind and an
 * all-zero week, the governance-only gate (Board vs. a non-governance category), the
 * absent-vs-empty distinction that keeps live mode's backend gap from rendering a misleading
 * "no activity yet", the per-kind click-to-reveal (mirroring LFXV2-3335's group toggle), and
 * reset on committee navigation.
 */
describe('WeeklyBriefCardComponent — Current activity tally (GH-1922)', () => {
  let fixture: ComponentFixture<WeeklyBriefCardComponent>;
  let component: WeeklyBriefCardComponent;
  let getWeeklyBrief: ReturnType<typeof vi.fn>;

  const BOARD_COMMITTEE: Committee = { uid: 'committee-board', name: 'Board of Directors', project_uid: 'project-1', category: 'Board' } as Committee;
  const WORKING_GROUP_COMMITTEE: Committee = {
    uid: 'committee-wg',
    name: 'Some Working Group',
    project_uid: 'project-1',
    category: 'Working Group',
  } as Committee;

  function activityRef(id: string, kind: string, title: string): WeeklyBriefSourceRef {
    return { id, kind, title };
  }

  /**
   * `activityRefs: null` omits `current_activity` entirely — simulates a server-side degrade
   * (non-governance committee, or a failed lookup/fetch — see
   * weekly-brief.service.ts#buildCurrentActivity). `options.truncated` layers GH-1998's
   * truncated: true onto a present `current_activity` — the raw upstream page filled a full page.
   */
  function briefResponse(
    activityRefs: WeeklyBriefSourceRef[] | null,
    callerRating: WeeklyBriefRating | null = null,
    options: { truncated?: boolean } = {}
  ): WeeklyBriefCurrentResponse {
    if (activityRefs === null && options.truncated) {
      throw new Error('truncated has no meaning when current_activity is omitted (activityRefs === null)');
    }
    return {
      brief: {
        uid: 'brief-1',
        committee_uid: 'committee-board',
        window_start: '2026-08-02T00:00:00Z',
        window_end: '2026-08-08T23:59:59Z',
        state: 'generated',
        brief_text: 'Weekly summary.',
        source_refs: [],
        prompt_version: 'v1',
        model: 'test-model',
        regeneration_count: 0,
        private_source_present: false,
        created_at: '2026-08-08T00:00:00Z',
        updated_at: '2026-08-08T00:00:00Z',
        revision: 1,
      },
      throttle: { generates_used: 0, generates_limit: 2, regenerations_used: 0, regenerations_limit: 3, window_resets_at: '2026-08-09T00:00:00Z' },
      caller_rating: callerRating,
      ...(activityRefs !== null
        ? {
            current_activity: {
              window_start: '2026-08-24T00:00:00Z',
              window_end: '2026-08-27T12:00:00Z',
              source_refs: activityRefs,
              ...(options.truncated ? { truncated: true } : {}),
            },
          }
        : {}),
    };
  }

  /** A poll-tick response at `revision` — terminal by state; whether it's *newly* terminal (and so stops the poll) depends on the caller's priorRevision. */
  function pollTick(revision: number, extra: Partial<WeeklyBriefCurrentResponse> = {}): WeeklyBriefCurrentResponse {
    const base = briefResponse(null);
    return { brief: { ...base.brief!, revision }, throttle: base.throttle, ...extra };
  }

  async function setup(
    committee: Committee,
    activityRefs: WeeklyBriefSourceRef[] | null,
    generateWeeklyBrief: ReturnType<typeof vi.fn> = vi.fn(),
    callerRating: WeeklyBriefRating | null = null,
    options: { truncated?: boolean } = {}
  ): Promise<void> {
    getWeeklyBrief = vi.fn(() => of(briefResponse(activityRefs, callerRating, options)));

    await TestBed.configureTestingModule({
      imports: [WeeklyBriefCardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: WeeklyBriefService, useValue: { getWeeklyBrief, listWeeklyBriefs: vi.fn(() => of({ data: [] })), generateWeeklyBrief } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        // Real service — see the Share to Slack describe block's docblock above for why.
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyBriefCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', committee);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
  }

  /** Clicks a data-testid element and flushes it, failing loudly if the element isn't there. */
  async function clickTestId(testId: string): Promise<HTMLElement> {
    const el = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    expect(el).not.toBeNull();
    el!.click();
    await fixture.whenStable();
    return el!;
  }

  it('hints includeCurrentActivity: true on the initial load for a governance committee — it already knows this from its own committee input', async () => {
    await setup(BOARD_COMMITTEE, []);
    expect(getWeeklyBrief).toHaveBeenCalledWith('committee-board', { includeCurrentActivity: true });
  });

  it('hints includeCurrentActivity: false on the initial load for a non-governance committee — the tally section can never render either way', async () => {
    await setup(WORKING_GROUP_COMMITTEE, null);
    expect(getWeeklyBrief).toHaveBeenCalledWith('committee-wg', { includeCurrentActivity: false });
  });

  it('renders a comma-separated, kind-ordered caption for a governance committee with multi-kind activity', async () => {
    await setup(BOARD_COMMITTEE, [
      activityRef('meeting-1', 'meeting', 'Board Sync'),
      activityRef('vote-1', 'vote', 'Q3 Resolution'),
      activityRef('doc-1', 'doc', 'Meeting Minutes'),
    ]);

    const el = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]');
    expect(el).not.toBeNull();
    const text = (el.textContent as string).replace(/\s+/g, ' ').trim();
    expect(text).toContain('This week so far:');
    expect(text).toContain('1 meeting held');
    expect(text).toContain('1 vote closed');
    expect(text).toContain('1 document added');
    // WEEKLY_BRIEF_CURRENT_ACTIVITY_PHRASES order: meeting, vote, ..., doc — the list
    // initCurrentActivitySections actually iterates, not WEEKLY_BRIEF_SOURCE_SECTIONS.
    expect(text.indexOf('1 meeting held')).toBeLessThan(text.indexOf('1 vote closed'));
    expect(text.indexOf('1 vote closed')).toBeLessThan(text.indexOf('1 document added'));
  });

  it('pluralizes a kind with more than one ref this week', async () => {
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync'), activityRef('meeting-2', 'meeting', 'Committee Sync')]);

    const el = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]');
    expect(el.textContent as string).toContain('2 meetings held');
  });

  it('puts the comma inside each toggle button — not a separate element that would pick up the flex gap as space before it', async () => {
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync'), activityRef('vote-1', 'vote', 'Q3 Resolution')]);

    const meetingToggle = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-toggle-meeting"]');
    const voteToggle = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-toggle-vote"]');
    expect((meetingToggle.textContent as string).replace(/\s+/g, ' ').trim()).toBe('1 meeting held,');
    // Last item has no trailing comma.
    expect((voteToggle.textContent as string).replace(/\s+/g, ' ').trim()).toBe('1 vote closed');
  });

  it('sets role="group" + aria-label on the container, and aria-controls on each toggle only once its revealed list actually exists', async () => {
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync')]);

    const container = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]');
    expect(container.getAttribute('role')).toBe('group');
    expect(container.getAttribute('aria-label')).toContain('1 meeting held');

    // Collapsed by default: the @if-guarded list this would point at isn't rendered yet, so
    // aria-controls must be absent rather than reference a nonexistent id (axe aria-valid-attr-value).
    const toggle = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-toggle-meeting"]');
    expect(toggle.getAttribute('aria-controls')).toBeNull();

    await clickTestId('weekly-brief-card-current-activity-toggle-meeting');
    const items = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-items-meeting"]');
    expect(items.getAttribute('id')).toBe('weekly-brief-card-current-activity-items-meeting');
    expect(toggle.getAttribute('aria-controls')).toBe(items.getAttribute('id'));
  });

  it('rolls an unrecognized kind into an "Other" bucket instead of dropping it, and does not render the false "no activity yet" line', async () => {
    await setup(BOARD_COMMITTEE, [activityRef('future-1', 'some_future_kind', 'A Brand New Source Kind')]);

    const el = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]');
    expect(el).not.toBeNull();
    expect(el.textContent).not.toContain('no activity yet');
    expect((el.textContent as string).replace(/\s+/g, ' ')).toContain('1 other update');

    await clickTestId('weekly-brief-card-current-activity-toggle-other');
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-items-other"]').textContent).toContain(
      'A Brand New Source Kind'
    );
  });

  it('renders "no activity yet" when current_activity is present but empty (a genuine quiet week-so-far)', async () => {
    await setup(BOARD_COMMITTEE, []);

    const el = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]');
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('no activity yet');
  });

  it('renders nothing at all when current_activity is absent — a server-side degrade must not be presented as "no activity yet" (GH-1922)', async () => {
    await setup(BOARD_COMMITTEE, null);

    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]')).toBeNull();
  });

  it('does not render the tally for a non-governance committee, even with activity present', async () => {
    await setup(WORKING_GROUP_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Some Meeting')]);

    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]')).toBeNull();
  });

  it('renders nothing when current_activity is explicitly null (the BFF\'s settled "doesn\'t apply" state) — same as absent, not "no activity yet"', async () => {
    // A real getWeeklyBrief response can carry current_activity: null (distinct from the key
    // being absent entirely — see WeeklyBriefCurrentResponse.current_activity's doc comment).
    // hasCurrentActivityData's `!!` check must treat both the same for rendering purposes; only
    // the poll loop's opt-out decision cares about the distinction.
    getWeeklyBrief = vi.fn(() => of({ ...briefResponse(null), current_activity: null }));
    await TestBed.configureTestingModule({
      imports: [WeeklyBriefCardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: WeeklyBriefService, useValue: { getWeeklyBrief, listWeeklyBriefs: vi.fn(() => of({ data: [] })) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WeeklyBriefCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', BOARD_COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();

    expect(component.hasCurrentActivityData()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]')).toBeNull();
  });

  it('renders the tally PLUS a truncation disclosure when current_activity.truncated is true (GH-1998) — the partial count still shows, it is not discarded', async () => {
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync')], undefined, null, { truncated: true });

    expect(component.isTruncated()).toBe(true);
    const tally = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]');
    expect(tally).not.toBeNull();
    expect((tally.textContent as string).replace(/\s+/g, ' ')).toContain('1 meeting held');
    const note = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-truncation-note"]');
    expect(note).not.toBeNull();
    // Pins the non-empty-tally variant specifically — 'see Recent Activity below for the latest
    // events' alone is shared by both variants and wouldn't catch the empty-tally wording
    // rendering here.
    expect(note.textContent as string).toContain('This count may be incomplete');
    // The note's only actionable content is the CTA — keep asserting it survives alongside the
    // variant-specific text above.
    expect(note.textContent as string).toContain('see Recent Activity below for the latest events');
    // The note is its own visible element (not folded into the tally's aria-label) — a screen
    // reader must not hear it announced twice, once for the group and once for the note itself.
    expect(tally.getAttribute('aria-label')).not.toContain('see Recent Activity below for the latest events');
  });

  it('still renders a truncation note, with different wording, when truncated is true but every ref was filtered/unmapped away (GH-1998)', async () => {
    await setup(BOARD_COMMITTEE, [], undefined, null, { truncated: true });

    // A bare, unqualified "no activity yet" would be a false-complete signal here — the raw
    // upstream page was full, so this genuinely might not be a quiet week (GH-1922: "do NOT
    // fabricate ... degrade gracefully"). isTruncated stays true and both the tally line's own
    // placeholder and the separate note reflect that, so a screen-reader user reading only the
    // group's aria-label (not the note, a sibling element) still gets the honest signal.
    expect(component.isTruncated()).toBe(true);
    const tally = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]');
    expect((tally.textContent as string).replace(/\s+/g, ' ')).not.toContain('no activity yet');
    expect((tally.textContent as string).replace(/\s+/g, ' ')).toContain("activity couldn't be counted");
    expect(tally.getAttribute('aria-label')).toContain("activity couldn't be counted");
    const note = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-truncation-note"]');
    expect(note).not.toBeNull();
    expect(note.textContent as string).toContain('could not be fully counted');
    expect(note.textContent as string).toContain('see Recent Activity below for the latest events');
  });

  it('clicking a kind reveals its underlying ref titles, and clicking again collapses it', async () => {
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync'), activityRef('vote-1', 'vote', 'Q3 Resolution')]);

    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-items-meeting"]')).toBeNull();

    const toggle = await clickTestId('weekly-brief-card-current-activity-toggle-meeting');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const items = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-items-meeting"]');
    expect(items).not.toBeNull();
    expect(items.textContent).toContain('Board Sync');
    // The vote kind wasn't toggled — its items stay collapsed.
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-items-vote"]')).toBeNull();

    await clickTestId('weekly-brief-card-current-activity-toggle-meeting');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity-items-meeting"]')).toBeNull();
  });

  it('clears expandedActivityKinds when navigating to a different committee', async () => {
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync')]);

    await clickTestId('weekly-brief-card-current-activity-toggle-meeting');
    expect(component.expandedActivityKinds().has('meeting')).toBe(true);

    getWeeklyBrief.mockReturnValue(of(briefResponse(null)));
    fixture.componentRef.setInput('committee', WORKING_GROUP_COMMITTEE);
    await fixture.whenStable();

    expect(component.expandedActivityKinds().size).toBe(0);
  });

  it('preserves current_activity, caller_rating, brief, and throttle through a generate/regenerate round-trip — the 202 envelope carries none of them', async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync')], generateWeeklyBrief, 'up');
    expect(component.hasCurrentActivityData()).toBe(true);
    expect(component.callerRating()).toBe('up');
    const briefBeforeGenerate = component.brief();
    const throttleBeforeGenerate = component.throttle();

    component.onGenerate();
    await fixture.whenStable();

    expect(generateWeeklyBrief).toHaveBeenCalled();
    // GenerateWeeklyBriefResponse has none of these fields at all — regenerating a brief doesn't
    // change this week's activity, and a bare 202 (no res.brief/res.throttle) means the brief and
    // throttle still on screen are genuinely the pre-regenerate ones, so their rating is still
    // accurate too. All four must survive the 202 handler's `res.x ?? prev?.x ?? null` fallbacks
    // rather than vanish until the next pollUntilTerminal tick lands — this is the behavior the
    // handler's `.set()` -> `.update()` change exists for.
    expect(component.hasCurrentActivityData()).toBe(true);
    expect(component.callerRating()).toBe('up');
    expect(component.brief()).toEqual(briefBeforeGenerate);
    expect(component.throttle()).toEqual(throttleBeforeGenerate);
    const el = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-current-activity"]');
    expect(el.textContent as string).toContain('1 meeting held');
  });

  it('adopts a throttle the 202 envelope DOES carry, rather than keeping the pre-generate value', async () => {
    const newThrottle: WeeklyBriefThrottle = {
      generates_used: 2,
      generates_limit: 2,
      regenerations_used: 0,
      regenerations_limit: 3,
      window_resets_at: '2026-08-09T00:00:00Z',
    };
    const generateWeeklyBrief = vi.fn(() => of({ throttle: newThrottle } as GenerateWeeklyBriefResponse));
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync')], generateWeeklyBrief);
    expect(component.throttle()).not.toEqual(newThrottle);

    component.onGenerate();
    await fixture.whenStable();

    // A generate response that DOES report throttle (the normal shape — upstream bumps
    // generates_used before returning) must be adopted immediately, not deferred to the next poll
    // tick — the fallback exists for the fields a bare 202 omits, not to ignore ones it supplies.
    expect(component.throttle()).toEqual(newThrottle);
  });

  /**
   * `vi.useFakeTimers` must fake `setTimeout`/`clearTimeout`/`setInterval`/`clearInterval` — RxJS's
   * `timer(delay, period)` schedules its periodic emissions via `setInterval`, not repeated
   * `setTimeout` calls, so faking only `setTimeout` (as the two prior commits in this sequence
   * tried) leaves the poll's own timer running on the real clock and `vi.advanceTimersByTimeAsync`
   * advances nothing it's actually waiting on. Deliberately excludes `requestAnimationFrame` and
   * every other vitest-fakes-by-default primitive this suite doesn't need — critically, zoneless
   * Angular's own change-detection stability tracking depends on one of them (`rAF` is the prime
   * suspect, though the exact mechanism wasn't root-caused), and faking it hangs
   * `fixture.whenStable()` indefinitely. For that reason the tests below never call
   * `fixture.whenStable()` while fake timers are active — assertions read component signals and
   * the `getWeeklyBrief` spy's call args directly instead, which `vi.advanceTimersByTimeAsync`'s
   * own microtask flushing keeps current without it.
   */
  function fakePollTimers(): void {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  }

  it('a poll tick opts out once current_activity is present and merges it forward, then the poll fully stops (generating/pollActive both clear) so a later Regenerate can start a new poll', async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync')], generateWeeklyBrief);
    expect(component.hasCurrentActivityData()).toBe(true);
    // setup()'s own initial getWeeklyBrief call — pinned so the nth-call assertions below have a
    // known starting index regardless of what setup() does internally.
    expect(getWeeklyBrief.mock.calls).toHaveLength(1);

    fakePollTimers();
    try {
      // A new terminal revision with no current_activity of its own — a real
      // includeCurrentActivity: false response shape — so the poll stops after this one tick.
      getWeeklyBrief.mockImplementation(() => of(pollTick(2)));

      component.onGenerate();
      // Flushes the generate POST's own response before the poll's timer(4000, 4000) has even
      // started, then advances one full interval to trigger its first tick.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);

      // Length asserted explicitly, not just the last call's args — a call count that isn't
      // exactly 2 means either the tick never fired or (e.g. a regressed pollActive guard) fired
      // more than once within this same window, either of which would make
      // toHaveBeenLastCalledWith silently read the wrong call.
      expect(getWeeklyBrief.mock.calls).toHaveLength(2);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(2, 'committee-board', { includeCurrentActivity: false });
      // The tick's own response has no current_activity key — this must still read as present,
      // merged forward from before the tick, not blanked out.
      expect(component.hasCurrentActivityData()).toBe(true);

      // Proves takeWhile actually stopped the poll on this terminal revision, not just that this
      // one tick's own args were right — the call count above alone can't distinguish "the poll
      // stopped" from "we just haven't advanced far enough to see the next tick yet" (confirmed
      // by mutation-testing isNewTerminal to always return false: the assertions above still pass
      // with the poll never stopping — only a further advance catches it).
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief.mock.calls).toHaveLength(2);
      // A stopped stream must also have cleared the spinner — pollUntilTerminal's finalize does
      // double duty (releases pollActive AND clears generating), and a poll that stops without
      // clearing generating strands the card on "Generating…" with no way out but a reload.
      expect(component.generating()).toBe(false);

      // The other half of finalize's double duty: pollActive must also have been released, or
      // pollUntilTerminal's own re-entrancy guard (`if (!isPlatformBrowser... || this.pollActive)
      // return`) makes every later Regenerate set generating() with no poll left to ever clear
      // it — a deeper version of the same dead end. Proven by actually regenerating again and
      // confirming a new poll tick fires. A genuinely new terminal revision (not the same 2 as
      // before) so this second poll settles too, rather than leaving an open subscription behind.
      getWeeklyBrief.mockImplementation(() => of(pollTick(3)));
      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief.mock.calls).toHaveLength(3);
      expect(component.generating()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a poll tick keeps asking (includeCurrentActivity: true) while current_activity is absent, and a settled null it comes back with is not discarded as "no value" (the exact case ?? got wrong)', async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    // null activityRefs — current_activity starts absent (e.g. a degraded initial lookup).
    await setup(BOARD_COMMITTEE, null, generateWeeklyBrief);
    expect(component.hasCurrentActivityData()).toBe(false);
    // setup()'s own initial getWeeklyBrief call — pinned so the nth-call assertions below have a
    // known starting index regardless of what setup() does internally.
    expect(getWeeklyBrief.mock.calls).toHaveLength(1);

    fakePollTimers();
    try {
      // First tick: same revision as before (not terminal, so the poll keeps ticking) but WITH
      // current_activity: null — a settled "doesn't apply" answer the merge must adopt. Second
      // tick: a new terminal revision, to let the poll stop cleanly.
      getWeeklyBrief.mockImplementationOnce(() => of(pollTick(1, { current_activity: null }))).mockImplementation(() => of(pollTick(2)));

      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      // Length asserted explicitly, not just the last call's args — a call count that isn't
      // exactly 2 means either the tick never fired or fired more than once, either of which
      // would make toHaveBeenLastCalledWith silently read the wrong call.
      expect(getWeeklyBrief.mock.calls).toHaveLength(2);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(2, 'committee-board', { includeCurrentActivity: true });

      // The second tick is the real proof: if the first tick's fresh null had been discarded by
      // a `??` merge (rather than adopted via `!== undefined`), current_activity would still
      // read as absent here and this second tick would ask again with `true` — forever, on every
      // subsequent tick, which is the exact regression this commit exists to fix.
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief.mock.calls).toHaveLength(3);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(3, 'committee-board', { includeCurrentActivity: false });

      // Proves the poll actually stopped on tick 2's terminal revision, not just that tick 2's
      // own args were right — see the sibling test above for why a further advance is needed to
      // tell "stopped" apart from "haven't looked far enough yet".
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief.mock.calls).toHaveLength(3);
      // A stopped stream must also have cleared the spinner — see the sibling test above.
      expect(component.generating()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never asks for current_activity on a non-governance committee's poll — the initial load's deliberate opt-out (absent) must not be mistaken for a transient degrade", async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    // null activityRefs on setup — matches what a real includeCurrentActivity: false initial
    // load actually returns (current_activity key absent), not a governance committee's
    // transient degrade.
    await setup(WORKING_GROUP_COMMITTEE, null, generateWeeklyBrief);
    expect(getWeeklyBrief.mock.calls).toHaveLength(1);

    fakePollTimers();
    try {
      getWeeklyBrief.mockImplementation(() => of(pollTick(2)));

      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);

      expect(getWeeklyBrief.mock.calls).toHaveLength(2);
      // false, not true — before this fix, current_activity being absent alone would have made
      // this tick ask, spending a wasted upstream fan-out on a committee the client already
      // knows can never render the tally.
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(2, 'committee-wg', { includeCurrentActivity: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops re-asking for current_activity after WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS ticks, even though it is still absent', async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    await setup(BOARD_COMMITTEE, null, generateWeeklyBrief);
    expect(getWeeklyBrief.mock.calls).toHaveLength(1);

    fakePollTimers();
    try {
      // Every tick keeps the same (non-terminal) revision and never carries current_activity —
      // models a persistently failing tally fan-out (e.g. an upstream error caught inside
      // buildCurrentActivity), not a one-off transient degrade the poll should keep retrying
      // forever for.
      getWeeklyBrief.mockImplementation(() => of(pollTick(1)));

      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);

      // The first WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS ticks after setup's own initial
      // call each still ask.
      for (let attempt = 0; attempt < WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS; attempt++) {
        await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
        expect(getWeeklyBrief).toHaveBeenNthCalledWith(2 + attempt, 'committee-board', { includeCurrentActivity: true });
      }

      // The next tick — past the cap — stops asking, even though current_activity is still
      // absent and nothing has changed about the committee's governance status.
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(2 + WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS, 'committee-board', { includeCurrentActivity: false });

      // And stays capped — a further tick still doesn't ask, proving this is a permanent cap for
      // the rest of this poll cycle, not a one-tick skip that resumes asking right after.
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(3 + WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS, 'committee-board', { includeCurrentActivity: false });

      // Terminate the poll cleanly (a new terminal revision) so no open subscription leaks past
      // this test.
      getWeeklyBrief.mockImplementation(() => of(pollTick(2)));
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(component.generating()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not burn the ask-attempt cap on a tick that fails before reaching the server — only a tick that actually got an answer counts', async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    await setup(BOARD_COMMITTEE, null, generateWeeklyBrief);
    expect(getWeeklyBrief.mock.calls).toHaveLength(1);

    fakePollTimers();
    try {
      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);

      // A transport-level failure (status: 0 — connection refused, DNS failure, CORS block: the
      // request never reached, or never got a response from, the BFF at all) — this asked
      // (includeCurrentActivity: true), but must NOT count against
      // WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS, since the server never had a chance to
      // answer. Contrast the sibling tests below: a TimeoutError or a real HTTP error status BOTH
      // mean the BFF received the request, so both count against the cap; only status === 0 does not.
      getWeeklyBrief.mockImplementationOnce(() => throwError(() => new HttpErrorResponse({ status: 0 })));
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(2, 'committee-board', { includeCurrentActivity: true });
      // A failed tick degrades gracefully — it must not look like a terminal state and stop the
      // poll (see the pipe's own comment in weekly-brief-card.component.ts).
      expect(component.generating()).toBe(true);

      // Every subsequent tick succeeds but still reports no current_activity. If the failed tick
      // above had wrongly consumed a slot (the bug this test pins the fix for), the cap would be
      // reached one tick earlier than this loop expects.
      getWeeklyBrief.mockImplementation(() => of(pollTick(1)));
      for (let attempt = 0; attempt < WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS; attempt++) {
        await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
        expect(getWeeklyBrief).toHaveBeenNthCalledWith(3 + attempt, 'committee-board', { includeCurrentActivity: true });
      }
      // Past the full cap now (one failed ask + WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS
      // real ones) — this next tick stops asking.
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(3 + WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS, 'committee-board', { includeCurrentActivity: false });

      // Terminate the poll cleanly so no open subscription leaks past this test.
      getWeeklyBrief.mockImplementation(() => of(pollTick(2)));
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(component.generating()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('DOES burn the ask-attempt cap on a tick that times out waiting for a response — the server may still be doing the fan-out work the client gave up on', async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    await setup(BOARD_COMMITTEE, null, generateWeeklyBrief);
    expect(getWeeklyBrief.mock.calls).toHaveLength(1);

    fakePollTimers();
    try {
      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);

      // Unlike the sibling "fails before reaching the server" test above, a TimeoutError DOES
      // count against the cap — aborting the client-side wait doesn't cancel the BFF's in-flight
      // getCommitteeBase + getCommitteeActivity fan-out, so this tick genuinely cost what the cap
      // exists to bound, even though no response ever came back.
      getWeeklyBrief.mockImplementationOnce(() => throwError(() => new TimeoutError()));
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(2, 'committee-board', { includeCurrentActivity: true });
      expect(component.generating()).toBe(true);

      // Only WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS - 1 further real asks remain — the
      // timed-out tick above already spent one slot.
      getWeeklyBrief.mockImplementation(() => of(pollTick(1)));
      for (let attempt = 0; attempt < WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS - 1; attempt++) {
        await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
        expect(getWeeklyBrief).toHaveBeenNthCalledWith(3 + attempt, 'committee-board', { includeCurrentActivity: true });
      }
      // The cap is already spent — one tick earlier than the sibling network-failure test, since
      // the timed-out tick counted.
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(2 + WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS, 'committee-board', { includeCurrentActivity: false });

      getWeeklyBrief.mockImplementation(() => of(pollTick(2)));
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(component.generating()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('DOES burn the ask-attempt cap on a tick that gets a real HTTP error response — the BFF received and processed the request, it just failed to answer well', async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    await setup(BOARD_COMMITTEE, null, generateWeeklyBrief);
    expect(getWeeklyBrief.mock.calls).toHaveLength(1);

    fakePollTimers();
    try {
      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);

      // Unlike the "fails before reaching the server" test above (status: 0), a real HTTP error
      // status means the request DID reach the BFF and got a response — even a failing one. This
      // is the exact bug a bot reviewer caught: refunding on "any non-TimeoutError" also refunded
      // on a persistent 500/503, defeating the cap for a persistently-ERRORING (not just slow)
      // upstream the same way the earlier TimeoutError bug did for a persistently-slow one.
      getWeeklyBrief.mockImplementationOnce(() => throwError(() => new HttpErrorResponse({ status: 503 })));
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(2, 'committee-board', { includeCurrentActivity: true });
      expect(component.generating()).toBe(true);

      // Only WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS - 1 further real asks remain — the
      // 503 tick above already spent one slot, same as the sibling TimeoutError test.
      getWeeklyBrief.mockImplementation(() => of(pollTick(1)));
      for (let attempt = 0; attempt < WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS - 1; attempt++) {
        await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
        expect(getWeeklyBrief).toHaveBeenNthCalledWith(3 + attempt, 'committee-board', { includeCurrentActivity: true });
      }
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(2 + WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS, 'committee-board', { includeCurrentActivity: false });

      getWeeklyBrief.mockImplementation(() => of(pollTick(2)));
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(component.generating()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the ask-attempt budget on a new poll cycle — currentActivityAskAttempts is scoped per pollUntilTerminal call, not the component instance', async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    await setup(BOARD_COMMITTEE, null, generateWeeklyBrief);
    expect(getWeeklyBrief.mock.calls).toHaveLength(1);

    fakePollTimers();
    try {
      // First cycle: spend the entire ask-attempt budget, same as the sibling cap test above.
      getWeeklyBrief.mockImplementation(() => of(pollTick(1)));
      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);
      for (let attempt = 0; attempt < WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS; attempt++) {
        await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      }
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenLastCalledWith('committee-board', { includeCurrentActivity: false });
      // Terminate the first poll (revision 2) so a second Regenerate can start a fresh one.
      getWeeklyBrief.mockImplementation(() => of(pollTick(2)));
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(component.generating()).toBe(false);
      const callsAfterFirstCycle = getWeeklyBrief.mock.calls.length;

      // Second cycle: current_activity is absent again (e.g. the tally keeps failing) — if the
      // budget were a component field instead of scoped inside pollUntilTerminal, it would
      // already read as exhausted here and this tick would never ask.
      getWeeklyBrief.mockImplementation(() => of(pollTick(3)));
      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(getWeeklyBrief).toHaveBeenNthCalledWith(callsAfterFirstCycle + 1, 'committee-board', { includeCurrentActivity: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('adopts a real current_activity a poll tick returns — hasCurrentActivityData flips false to true, the actual success case the retry budget exists to reach', async () => {
    const generateWeeklyBrief = vi.fn(() => of({} as GenerateWeeklyBriefResponse));
    await setup(BOARD_COMMITTEE, null, generateWeeklyBrief);
    expect(component.hasCurrentActivityData()).toBe(false);

    fakePollTimers();
    try {
      // First tick: same revision as before (not terminal — keeps polling), now WITH a real,
      // non-empty current_activity — the success case, not just the settled-null case the
      // sibling "keeps asking" test already covers. Second tick: a new terminal revision, so the
      // poll stops cleanly.
      getWeeklyBrief
        .mockImplementationOnce(() =>
          of(
            pollTick(1, {
              current_activity: {
                window_start: '2026-08-24T00:00:00Z',
                window_end: '2026-08-27T12:00:00Z',
                source_refs: [activityRef('meeting-1', 'meeting', 'Board Sync')],
              },
            })
          )
        )
        .mockImplementation(() => of(pollTick(2)));

      component.onGenerate();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);

      // Signal-level assertions only — under fake timers (see fakePollTimers's own docblock)
      // zoneless Angular's change-detection scheduler can't run, so a DOM query here would read
      // stale content rather than proving anything about this tick's effect.
      expect(component.hasCurrentActivityData()).toBe(true);
      expect(component.currentActivity()).toEqual([expect.objectContaining({ kind: 'meeting', countText: '1 meeting held' })]);

      // Let the poll terminate cleanly.
      await vi.advanceTimersByTimeAsync(WEEKLY_BRIEF_POLL_INTERVAL_MS);
      expect(component.generating()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops (not carries forward) caller_rating when the 202 envelope itself already carries a new brief', async () => {
    const generateWeeklyBrief = vi.fn(() =>
      of({
        brief: {
          // Same uid as briefResponse()'s fixture — upstream's regenerate reuses the existing
          // brief's uid and only bumps revision (verified against
          // group_weekly_brief_generator.go: "brief.UID = existing.UID"), so this fixture keeps
          // the uid fixed and changes only revision/state, matching the real shape.
          uid: 'brief-1',
          committee_uid: 'committee-board',
          window_start: '2026-08-02T00:00:00Z',
          window_end: '2026-08-08T23:59:59Z',
          state: 'generating',
          brief_text: '',
          source_refs: [],
          prompt_version: 'v1',
          model: 'test-model',
          regeneration_count: 1,
          private_source_present: false,
          created_at: '2026-08-08T00:00:00Z',
          updated_at: '2026-08-08T00:00:00Z',
          revision: 2,
        },
      } as GenerateWeeklyBriefResponse)
    );
    await setup(BOARD_COMMITTEE, [activityRef('meeting-1', 'meeting', 'Board Sync')], generateWeeklyBrief, 'up');
    expect(component.callerRating()).toBe('up');

    component.onGenerate();
    await fixture.whenStable();

    // The type allows a populated res.brief on the 202 — the old rating describes the
    // pre-regenerate revision, not this new one, so it must NOT carry forward here (contrast
    // the bare-202 case above, where it correctly does). No DOM assertion alongside this: the
    // rating buttons live in the renderableBrief template branch, which generating() (already
    // true by this point) routes around regardless of caller_rating's value — a DOM query here
    // would pass or fail on branch structure alone, not on the drop this test actually exercises.
    expect(component.callerRating()).toBeNull();
    // current_activity is unaffected either way — it isn't scoped to a brief revision.
    expect(component.hasCurrentActivityData()).toBe(true);
  });
});

describe('WeeklyBriefCardComponent — staleness indicator (GH-1966)', () => {
  let fixture: ComponentFixture<WeeklyBriefCardComponent>;

  const COMMITTEE: Committee = { uid: 'committee-1', name: 'Test Committee', project_uid: 'project-1' } as Committee;

  function briefResponse(overrides: Partial<WeeklyBriefCurrentResponse> = {}): WeeklyBriefCurrentResponse {
    return {
      brief: {
        uid: 'brief-1',
        committee_uid: 'committee-1',
        window_start: '2026-08-23T00:00:00Z',
        window_end: '2026-08-29T23:59:59Z',
        state: 'generated',
        brief_text: 'Weekly summary.',
        source_refs: [],
        prompt_version: 'v1',
        model: 'test-model',
        regeneration_count: 0,
        private_source_present: false,
        created_at: '2026-08-24T00:00:00Z',
        updated_at: '2026-08-24T00:00:00Z',
        revision: 1,
      },
      throttle: { generates_used: 0, generates_limit: 2, regenerations_used: 0, regenerations_limit: 3, window_resets_at: '2026-08-30T00:00:00Z' },
      caller_rating: null,
      ...overrides,
    };
  }

  async function setup(response: WeeklyBriefCurrentResponse, generateWeeklyBrief: ReturnType<typeof vi.fn> = vi.fn()): Promise<WeeklyBriefCardComponent> {
    await TestBed.configureTestingModule({
      imports: [WeeklyBriefCardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: WeeklyBriefService,
          useValue: { getWeeklyBrief: vi.fn(() => of(response)), listWeeklyBriefs: vi.fn(() => of({ data: [] })), generateWeeklyBrief },
        },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyBriefCardComponent);
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  function stalenessTag(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-staleness-tag"]');
  }

  function regenerateButton(): HTMLButtonElement {
    const el = fixture.nativeElement.querySelector('[data-testid="weekly-brief-card-regenerate-button"] button');
    if (!el) throw new Error('no native button rendered inside weekly-brief-card-regenerate-button');
    return el as HTMLButtonElement;
  }

  it('renders the staleness tag when stale', async () => {
    await setup(briefResponse({ staleness: { stale: true, event_count: 3, event_count_is_floor: false } }));

    expect(stalenessTag()).not.toBeNull();
  });

  it('does not render the staleness tag when not stale', async () => {
    await setup(briefResponse({ staleness: { stale: false, event_count: 0, event_count_is_floor: false } }));

    expect(stalenessTag()).toBeNull();
  });

  it('does not render the staleness tag when staleness is null (uncomputable)', async () => {
    await setup(briefResponse({ staleness: null }));

    expect(stalenessTag()).toBeNull();
  });

  it('tooltip says "last updated", not "generated" — updated_at is the last edit time for an edited brief, not its original generation time', async () => {
    const component = await setup(briefResponse({ staleness: { stale: true, event_count: 3, event_count_is_floor: false } }));

    expect(component.stalenessTooltip()).toBe('3 new events since this brief was last updated');
  });

  it('pluralizes "event" for a floor count of exactly 1 (a "1+" count is never exactly one)', async () => {
    const component = await setup(briefResponse({ staleness: { stale: true, event_count: 1, event_count_is_floor: true } }));

    expect(component.stalenessTooltip()).toBe('1+ new events since this brief was last updated');
  });

  it('keeps the singular for a non-floor count of exactly 1', async () => {
    const component = await setup(briefResponse({ staleness: { stale: true, event_count: 1, event_count_is_floor: false } }));

    expect(component.stalenessTooltip()).toBe('1 new event since this brief was last updated');
  });

  it('leaves the Regenerate button enabled when stale, even with a fresh quota', async () => {
    await setup(
      briefResponse({
        staleness: { stale: true, event_count: 1, event_count_is_floor: false },
        throttle: { generates_used: 0, generates_limit: 2, regenerations_used: 0, regenerations_limit: 3, window_resets_at: '2026-08-30T00:00:00Z' },
      })
    );

    expect(stalenessTag()).not.toBeNull();
    expect(regenerateButton().disabled).toBeFalsy();
  });

  it('leaves the Regenerate button disabled on exhausted quota even when not stale — staleness never overrides the throttle gate', async () => {
    await setup(
      briefResponse({
        staleness: { stale: false, event_count: 0, event_count_is_floor: false },
        throttle: { generates_used: 2, generates_limit: 2, regenerations_used: 3, regenerations_limit: 3, window_resets_at: '2026-08-30T00:00:00Z' },
      })
    );

    expect(stalenessTag()).toBeNull();
    expect(regenerateButton().disabled).toBeTruthy();
  });

  it('drops (not carries forward) staleness when the 202 envelope itself already carries a new brief — the old verdict was computed against the pre-regenerate updated_at', async () => {
    const generateWeeklyBrief = vi.fn(() =>
      of({
        // Same uid as briefResponse()'s fixture — upstream's regenerate reuses the existing
        // brief's uid and only bumps revision, matching the real shape (see the identical
        // fixture rationale in the "current activity tally" describe block's own drop test).
        brief: {
          uid: 'brief-1',
          committee_uid: 'committee-1',
          window_start: '2026-08-23T00:00:00Z',
          window_end: '2026-08-29T23:59:59Z',
          state: 'generating',
          brief_text: '',
          source_refs: [],
          prompt_version: 'v1',
          model: 'test-model',
          regeneration_count: 1,
          private_source_present: false,
          created_at: '2026-08-24T00:00:00Z',
          updated_at: '2026-08-24T00:00:00Z',
          revision: 2,
        },
      } as GenerateWeeklyBriefResponse)
    );
    const component = await setup(briefResponse({ staleness: { stale: true, event_count: 3, event_count_is_floor: false } }), generateWeeklyBrief);
    expect(stalenessTag()).not.toBeNull();

    component.onGenerate();
    await fixture.whenStable();

    // The old stale:true verdict described the pre-regenerate brief's updated_at — it must NOT
    // carry forward onto the new, just-created revision. The poll's first GET restores the
    // correct (freshly computed) value for that revision instead.
    expect(component.staleness()).toBeNull();
    expect(stalenessTag()).toBeNull();
  });
});
