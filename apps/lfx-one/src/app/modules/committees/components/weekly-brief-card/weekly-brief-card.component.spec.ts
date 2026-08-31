// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD } from '@lfx-one/shared/constants';
import { Committee, WeeklyBriefCurrentResponse, WeeklyBriefSourceRef } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { WeeklyBriefService } from '@services/weekly-brief.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';

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

  async function setup(response: WeeklyBriefCurrentResponse): Promise<WeeklyBriefCardComponent> {
    await TestBed.configureTestingModule({
      imports: [WeeklyBriefCardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: WeeklyBriefService,
          useValue: { getWeeklyBrief: vi.fn(() => of(response)), listWeeklyBriefs: vi.fn(() => of({ data: [] })) },
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
});
