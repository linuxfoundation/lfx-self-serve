// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CampaignIndexDoc } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OptimizationTabComponent } from './optimization-tab.component';

/**
 * Pause/resume from the Optimize tab (LFXV2-3224).
 *
 * These assertions are about the three places this UI could state something false, each of which
 * is a claim about money the user acts on:
 *
 *   1. Rendering "no campaigns" over a FAILED read, for campaigns that may be spending.
 *   2. Rendering a transition the service declined to record (`created_degraded`).
 *   3. Rendering a pause as successful when the request failed, so someone stops watching a
 *      campaign that is still running.
 *
 * The layout is not covered here — that needs a browser. What is covered is every branch where
 * the component decides WHAT to say.
 */
describe('OptimizationTabComponent — pause/resume (LFXV2-3224)', () => {
  let fixture: ComponentFixture<OptimizationTabComponent>;
  let updateCampaignStatus: ReturnType<typeof vi.fn>;

  const doc = (over: Partial<CampaignIndexDoc> = {}): CampaignIndexDoc => ({
    id: 'c-1',
    project_id: 'tlf',
    brief_id: 'b-1',
    platform: 'google-ads',
    campaign_name: 'KubeCon EU',
    status: 'created',
    version: 3,
    etag: '"3"',
    ...over,
  });

  beforeEach(async () => {
    updateCampaignStatus = vi
      .fn()
      .mockReturnValue(of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused' }));

    await TestBed.configureTestingModule({
      imports: [OptimizationTabComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: CampaignService,
          useValue: {
            updateCampaignStatus,
            // The tab loads its own monitor data on init; stub the reads it makes so the
            // component constructs without reaching the network.
            getMonitorData: vi.fn().mockReturnValue(of(null)),
            getKeywords: vi.fn().mockReturnValue(of({ keywords: [] })),
            getLinkedInAccounts: vi.fn().mockReturnValue(of([])),
            getRedditAccounts: vi.fn().mockReturnValue(of([])),
            getMetaAccounts: vi.fn().mockReturnValue(of([])),
            getLinkedInMonitor: vi.fn().mockReturnValue(of(null)),
            getRedditMonitor: vi.fn().mockReturnValue(of(null)),
            getMetaMonitor: vi.fn().mockReturnValue(of(null)),
            executeKeywordActions: vi.fn().mockReturnValue(of({ results: [] })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OptimizationTabComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('briefId', 'b-1');
  });

  function render(campaigns: CampaignIndexDoc[] | null, stale = false, unavailable = false): void {
    fixture.componentRef.setInput('briefCampaigns', campaigns);
    fixture.componentRef.setInput('campaignsPossiblyStale', stale);
    fixture.componentRef.setInput('campaignsUnavailable', unavailable);
    fixture.detectChanges();
  }

  // The distinction the whole section is built around. `null` is "not loaded, or the read failed";
  // rendering an empty state for it would assert the brief has no campaigns on the strength of a
  // failure.
  it('renders NOTHING for a null list, rather than an empty state', () => {
    render(null);

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-controls"]')).toBeNull();
  });

  it('renders an empty state only when the read succeeded and returned nothing', () => {
    render([]);

    const empty = fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-empty"]');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain('No campaigns');
  });

  // Indexing is asynchronous. Moments after a create the list is legitimately empty, and saying
  // "no campaigns" there would tell someone their spend does not exist.
  it('softens the empty state while the list may not be indexed yet', () => {
    render([], true);

    const empty = fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-empty"]');
    expect(empty.textContent).toContain('take a little while to appear');
  });

  it('lists each campaign with a toggle', () => {
    render([doc(), doc({ id: 'c-2', campaign_name: 'KubeCon NA', platform: 'linkedin-ads' })]);

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-2"]')).not.toBeNull();
  });

  it.each([
    ['created', 'Pause'],
    ['active', 'Pause'],
    ['enabled', 'Pause'],
    ['paused', 'Resume'],
  ])('offers %s → %s', (status, label) => {
    render([doc({ status })]);

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').textContent.trim()).toContain(label);
  });

  // The visible text is just "Pause", which is unambiguous beside its row and useless out of
  // context: a screen-reader user moving button-to-button hears "Pause" N times with no way to
  // tell the campaigns apart. The label must NAME the campaign and CONTAIN the visible word, so
  // speech input ("click Pause") still matches.
  it('names the campaign in the accessible label, keeping the visible word', () => {
    render([doc({ campaign_name: 'KubeCon EU', status: 'created' }), doc({ id: 'c-2', campaign_name: 'KubeCon NA', status: 'paused' })]);

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').getAttribute('aria-label')).toBe('Pause KubeCon EU');
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-2"]').getAttribute('aria-label')).toBe('Resume KubeCon NA');
  });

  // A dangling aria-describedby is worse than none: it points assistive tech at an element that
  // does not render. The row's error only exists after a failure, so the reference must appear
  // with it and not before.
  it('associates the error with its button only once an error exists', () => {
    render([doc({ etag: undefined })]);
    const button = () => fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');

    expect(button().getAttribute('aria-describedby')).toBeNull();

    button().click();
    fixture.detectChanges();

    const described = button().getAttribute('aria-describedby');
    expect(described).toBe('campaign-error-c-1');
    // The referenced element must actually be in the DOM — that is what makes it not dangling.
    expect(fixture.nativeElement.querySelector(`#${described}`)).not.toBeNull();
  });

  it('sends the row etag as the validator, not one cached elsewhere', () => {
    render([doc({ version: 9, etag: '"9"' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();

    expect(updateCampaignStatus).toHaveBeenCalledWith(
      expect.objectContaining({ projectSlug: 'tlf', briefId: 'b-1', campaignId: 'c-1', status: 'PAUSED', etag: '"9"' })
    );
  });

  // Upstream answers a missing If-Match with 428. Refusing here names the cause instead of
  // spending a round trip to be told.
  it('refuses a row with no etag without calling the service', () => {
    render([doc({ etag: undefined })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    expect(updateCampaignStatus).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]')).not.toBeNull();
  });

  // Pausing a `created_degraded` campaign pauses it UPSTREAM while deliberately leaving the row's
  // status unchanged. Echoing the request would claim a transition the service declined to record.
  it('renders the service status, not the requested one, for a degraded campaign', () => {
    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'created_degraded' })
    );
    render([doc()]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // Asserted through what the ROW RENDERS, not a private method: the claim under test is what
    // the user is told, and a component that computed this correctly but rendered something else
    // would still be lying.
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-controls"]').textContent).toContain('created_degraded');
  });

  // The blocking defect dealako found (#1586). campaign-service bumps the row's version on a
  // successful toggle, so the etag the row was READ with dies the moment the first pause commits.
  // Replaying it earns a 412 that surfaces as a generic failure reading like a concurrent edit —
  // and pause-then-resume is the entire two-step interaction this feature exists to enable.
  it('chains the FRESH etag into a second toggle of the same row', () => {
    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"10"' })
    );
    render([doc({ version: 9, etag: '"9"' })]);

    const button = () => fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    button().click();
    fixture.detectChanges();

    // The row now offers Resume, which is the second half of the interaction.
    expect(button().textContent).toContain('Resume');

    button().click();

    expect(updateCampaignStatus).toHaveBeenCalledTimes(2);
    // The SECOND call must carry the etag the FIRST one returned. Asserting the value rather than
    // the key: `expect.objectContaining({ etag: expect.anything() })` would pass on the stale one.
    expect(updateCampaignStatus.mock.calls[1][0]).toEqual(expect.objectContaining({ etag: '"10"', status: 'ACTIVE' }));
  });

  // A toggle that returns no etag (the legacy per-platform path has no row) must fall back to the
  // INDEXED etag, not to '' — the latter would trip the pre-flight refusal on a row that has a
  // perfectly good validator.
  it('falls back to the indexed etag when a toggle returns none', () => {
    updateCampaignStatus.mockReturnValue(of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused' }));
    render([doc({ version: 9, etag: '"9"' })]);

    const button = () => fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    button().click();
    fixture.detectChanges();
    button().click();

    expect(updateCampaignStatus).toHaveBeenCalledTimes(2);
    expect(updateCampaignStatus.mock.calls[1][0]).toEqual(expect.objectContaining({ etag: '"9"' }));
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]')).toBeNull();
  });

  // The minor finding: `created_degraded` is LIVE AND SPENDING, and upstream refuses to resume it
  // with 409. Classifying it as stopped offers the one action that cannot succeed, on exactly the
  // campaign where an operator most needs the pause lever.
  it('offers PAUSE for a campaign indexed as created_degraded', () => {
    render([doc({ status: 'created_degraded' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.textContent).toContain('Pause');
    expect(button.getAttribute('aria-label')).toBe('Pause KubeCon EU');

    button.click();

    expect(updateCampaignStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAUSED' }));
  });

  // The most expensive lie available to this component: reporting a pause that did not happen
  // would stop someone watching a campaign that is still spending.
  it('keeps the old status and says so when the toggle fails', () => {
    updateCampaignStatus.mockReturnValue(throwError(() => new Error('upstream unavailable')));
    render([doc({ status: 'created' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // Still offering Pause — the action that did not happen.
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').textContent).toContain('Pause');
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]').textContent).toContain('still running');
  });

  // A failed RESUME leaves the campaign PAUSED. Saying "it has not been paused" there is the exact
  // inversion of the outcome — it describes a campaign that is spending when the campaign is dark.
  it('words a failed resume from what actually happened, not from the pause case', () => {
    updateCampaignStatus.mockReturnValue(throwError(() => new Error('upstream unavailable')));
    render([doc({ status: 'paused' })]);

    const button = (): HTMLElement => fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button().textContent).toContain('Resume');

    button().click();
    fixture.detectChanges();

    const message = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]').textContent;
    expect(message).toContain('Could not resume');
    expect(message).toContain('still paused');
    // The inversion, named: a failed resume must never claim anything about a pause.
    expect(message).not.toContain('has not been paused');
    expect(message).not.toContain('still running');
  });

  // The class this finding is about, not the instance. Every status campaign-service refuses with
  // `CampaignStatusToggleable` must be UNAVAILABLE — a two-state row files them under Resume and
  // offers an action guaranteed to 409.
  it.each(['pending', 'group_created', 'unconfirmed'])('disables the toggle for the non-toggleable status %s', (status) => {
    render([doc({ status })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.textContent).not.toContain('Resume');
    expect(button.disabled).toBe(true);

    const reason = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-unavailable-c-1"]');
    expect(reason).not.toBeNull();
    expect(reason.textContent.trim().length).toBeGreaterThan(0);

    button.click();
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  // Fails CLOSED. `campaigns.status` is unconstrained TEXT upstream, so a status this UI has never
  // seen must land on unavailable rather than on the Resume button that would 409.
  it('treats an unknown status as unavailable rather than resumable', () => {
    render([doc({ status: 'some_future_status' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.disabled).toBe(true);
    expect(button.textContent).not.toContain('Resume');
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-unavailable-c-1"]')).not.toBeNull();
  });

  // `paused` is the one status that genuinely SHOULD offer Resume — the guard above must not have
  // swallowed the real resume case along with the doomed ones.
  it('still offers RESUME for a paused campaign', () => {
    render([doc({ status: 'paused' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.textContent).toContain('Resume');
    expect(button.disabled).toBe(false);

    button.click();

    expect(updateCampaignStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
  });

  // `created_degraded` is the asymmetric one: spending (so Pause) but refused a resume with 409.
  // It must stay PAUSEABLE, not be swept into unavailable by the new three-state model.
  it('keeps created_degraded pauseable rather than marking it unavailable', () => {
    render([doc({ status: 'created_degraded' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Pause');
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-unavailable-c-1"]')).toBeNull();
  });

  // Failure-as-absence. A null list means "not loaded" AND "the read failed", and rendering
  // nothing for both makes a Query Service outage look like a fresh page.
  it('states a failed read rather than rendering it as absence', () => {
    render(null, false, true);

    const banner = fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-unavailable"]');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('could not be loaded');
    // Still no empty state: a failed read cannot support "this brief has no campaigns".
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-empty"]')).toBeNull();
  });

  it('offers a retry on a failed read', () => {
    render(null, false, true);
    const retried = vi.fn();
    fixture.componentInstance.retryCampaigns.subscribe(retried);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-retry"]').click();

    expect(retried).toHaveBeenCalledTimes(1);
  });

  // The other side of the same distinction: a genuine empty must NOT be dressed as a failure.
  it('does not report a failure for a genuinely empty list', () => {
    render([]);

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-unavailable"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-empty"]')).not.toBeNull();
  });
});
