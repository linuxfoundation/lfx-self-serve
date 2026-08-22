// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CampaignIndexDoc, CampaignStatusUpdateResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, Subject, throwError } from 'rxjs';
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

  // `toggleEnabled` defaults to TRUE here so the existing cases keep testing what they were
  // written to test — status and platform behaviour — rather than all collapsing onto the new
  // deployment gate. The flag-off case is asserted explicitly by its own test below.
  function render(campaigns: CampaignIndexDoc[] | null, stale = false, unavailable = false, toggleEnabled = true): void {
    fixture.componentRef.setInput('briefCampaigns', campaigns);
    fixture.componentRef.setInput('campaignsPossiblyStale', stale);
    fixture.componentRef.setInput('campaignsUnavailable', unavailable);
    fixture.componentRef.setInput('statusToggleEnabled', toggleEnabled);
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

  // `enabled` is deliberately absent: it is a Google Ads platform word, not a status
  // campaign-service ever writes, so it belongs with the unknown statuses that fail closed.
  it.each([
    ['created', 'Pause'],
    ['active', 'Pause'],
    ['paused', 'Resume'],
  ])('offers %s → %s', (status, label) => {
    render([doc({ status })]);

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').textContent.trim()).toContain(label);
  });

  // Drives the malformed value through the REAL `campaignRows` computed, not through
  // `campaignToggleAction` in isolation. That distinction is the whole finding: the shared helper
  // was already guarded, and the crash simply moved to `unavailableReasonFor`, which the isolated
  // test could not see. A row-level assertion is what fails when any single consumer regresses.
  //
  // The status is typed `string`, so a non-string can only arrive by the route it actually takes
  // in production — the BFF spreading an unvalidated index doc through — and the cast reproduces
  // that wire shape rather than inventing a new one.
  it.each([
    ['a number', 7],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('renders every row when status is %s, instead of blanking the section', (_label, bad) => {
    render([doc({ status: bad as unknown as string }), doc({ id: 'c-2', campaign_name: 'KubeCon NA', status: 'created' })]);

    // The malformed row survives and fails closed...
    const broken = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(broken).not.toBeNull();
    expect(broken.disabled).toBe(true);
    // ...with the unknown-status wording, NOT a new branch of its own.
    expect(fixture.nativeElement.textContent).toContain('not in a state that can be paused or resumed');
    // ...and, the point of the finding, the healthy sibling still renders.
    const healthy = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-2"]');
    expect(healthy).not.toBeNull();
    expect(healthy.textContent.trim()).toContain('Pause');
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

  /**
   * A 412 is the ONE failure for which "try again" names an action that provably cannot work.
   *
   * The fresh etag is written only on the success arm, so after a refused toggle the row falls
   * back to `toggledEtag()[id] ?? campaign.etag` — the same dead validator the server just
   * rejected. Clicking again replays it and earns the same 412. The remedy is a re-read, and the
   * copy has to say so.
   *
   * Note this is the THIRD-PARTY concurrent edit only. The self-inflicted 412 (pause-then-resume
   * replaying this row's read-time etag) is already prevented by the `toggledEtag` cache, which
   * has its own tests above.
   */
  it('tells the user to refresh, not retry, when the toggle is refused with 412', () => {
    updateCampaignStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 412, statusText: 'Precondition Failed' })));
    render([doc({ status: 'created' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    const message = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]').textContent;
    expect(message).toContain('Someone else changed this campaign');
    expect(message).toContain('Refresh');
    // The whole point: the futile instruction must be GONE, not merely accompanied.
    expect(message).not.toContain('It is still running — try again.');
  });

  /**
   * The named remedy has to be reachable. Copy that says "refresh the campaign list" while the tab
   * offers no refresh is a different flavour of the same defect — it moves the dead end one step
   * later. Wired to the EXISTING `retryCampaigns` output, which is the parent's re-read path.
   */
  it('offers the list re-read the 412 copy tells the user to perform', () => {
    updateCampaignStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 412, statusText: 'Precondition Failed' })));
    render([doc({ status: 'created' })]);
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();
    const retry = vi.fn();
    fixture.componentInstance.retryCampaigns.subscribe(retry);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-refresh"]').click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  /**
   * The other half of the branch, and the reason it must be asserted separately: a fix that simply
   * replaced the per-direction copy with the conflict copy would pass the 412 test above while
   * telling someone whose pause failed on a 500 that a stranger moved their campaign.
   */
  it.each([
    [500, 'created', 'Could not pause this campaign. It is still running — try again.'],
    [0, 'created', 'Could not pause this campaign. It is still running — try again.'],
    [500, 'paused', 'Could not resume this campaign. It is still paused — try again.'],
  ])('keeps the per-direction copy for a %s failure on a %s campaign', (status, campaignStatus, expected) => {
    updateCampaignStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status, statusText: 'nope' })));
    render([doc({ status: campaignStatus })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]').textContent).toContain(expected);
    // And no conflict banner: nothing proved this list is stale.
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
  });

  // A non-HTTP failure — a thrown TypeError, an rxjs error with no status — must not be mistaken
  // for a concurrent edit. `err.status` on a plain Error is `undefined`, and a fix that read the
  // property without the type guard would compare `undefined === 412` and land here by luck
  // rather than by design; this pins the behaviour either way.
  it('does not claim a concurrent edit for a failure that carries no HTTP status', () => {
    updateCampaignStatus.mockReturnValue(throwError(() => new Error('upstream unavailable')));
    render([doc({ status: 'created' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]').textContent).toContain('still running');
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
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

  // `enabled` is a Google Ads platform word; campaign-service never writes it to `campaigns.status`
  // (the string does not appear in internal/domain/model at all). Listing it as running mapped a
  // value the index cannot produce onto Pause — the fail-OPEN direction. It must fail closed like
  // any other unknown status. Asserting the button is disabled is not enough on its own: the
  // assertion that binds is that a click DISPATCHES NOTHING.
  it('treats enabled as unknown rather than running, dispatching nothing', () => {
    render([doc({ status: 'enabled' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.disabled).toBe(true);
    expect(button.textContent).not.toContain('Pause');
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-unavailable-c-1"]')).not.toBeNull();

    button.click();
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  // Platform, not just status. Microsoft and X are `disabled: true` in CAMPAIGN_PLATFORMS, so the
  // BFF's CAMPAIGN_SERVICE_STATUS_PLATFORMS refuses them outright — a `created` row of theirs is
  // pausable UPSTREAM but not through this app, and status alone would enable a doomed button.
  it.each(['microsoft-ads', 'twitter-ads'])('disables the toggle for the unsupported platform %s', (platform) => {
    render([doc({ platform, status: 'created' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.disabled).toBe(true);
    expect(button.textContent).not.toContain('Pause');

    // The reason must name the PLATFORM. The status reason would tell an operator to wait for
    // something that resolves itself, which is false here — no waiting produces the button.
    const reason = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-unavailable-c-1"]');
    expect(reason.textContent).toContain('not available for this platform');

    button.click();
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  // The platform guard must not swallow the platforms this app DOES offer — the mutation that
  // makes every row unavailable would pass the test above while breaking the feature entirely.
  it.each(['google-ads', 'linkedin-ads', 'meta-ads', 'reddit-ads'])('still offers Pause on the supported platform %s', (platform) => {
    render([doc({ platform, status: 'created' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Pause');

    button.click();
    expect(updateCampaignStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAUSED' }));
  });

  // The list read is UNGATED while the toggle route refuses every UUID unless
  // LFX_CUTOVER_CAMPAIGN_SERVICE_STATUS_TOGGLE is on — and the chart leaves it unset. So the
  // default deployment is precisely the one that would render controls that can only 400.
  // The binding assertion is that the click DISPATCHES NOTHING, not merely that a flag is set.
  it('disables every toggle when the deployment has not enabled status changes', () => {
    render([doc({ status: 'created' }), doc({ id: 'c-2', status: 'paused' })], false, false, false);

    const pauseRow = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    const resumeRow = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-2"]');
    expect(pauseRow.disabled).toBe(true);
    expect(resumeRow.disabled).toBe(true);

    // The reason must name the DEPLOYMENT. A status or platform reason would send the operator
    // hunting for a fault in a campaign that is perfectly healthy.
    const reason = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-unavailable-c-1"]');
    expect(reason.textContent).toContain('not enabled for this deployment');

    pauseRow.click();
    resumeRow.click();
    expect(updateCampaignStatus).not.toHaveBeenCalled();
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

  /**
   * The 412 RECOVERY path (LFXV2-3224 review).
   *
   * The defect these cover is not that the banner appears — that is asserted above — but that
   * nothing ever took it away, and that the etag cache outlived the list it was minted against.
   * Both are only observable ACROSS a refresh, which is why every case here drives the refresh the
   * way the parent actually performs it rather than calling a clear method.
   *
   * `loadBriefCampaigns` (campaigns.component.ts) sets `briefCampaigns` to `null` synchronously on
   * entry and then to the fetched array on the response arm, so the input this tab sees goes
   * `[rows] → null → [freshRows]`. `refreshFromParent` replays exactly that sequence. A test that
   * pushed the fresh array in one step would still pass against a fix keyed on any input change,
   * but would not prove the fix survives the interim `null` the real path goes through.
   *
   * The component is NOT re-created between the 412 and the refresh, deliberately: it lives under
   * the parent's `@case ('optimization')` and the refresh keeps the user on that tab, so a fix
   * that relied on destruction would be testing a lifecycle the operator never triggers.
   */
  function refreshFromParent(freshCampaigns: CampaignIndexDoc[]): void {
    // Exactly what `loadBriefCampaigns` does on entry, before its request is dispatched.
    fixture.componentRef.setInput('briefCampaigns', null);
    fixture.detectChanges();
    // ...and what its `next` arm does when the re-read lands.
    fixture.componentRef.setInput('briefCampaigns', freshCampaigns);
    fixture.detectChanges();
  }

  function conflict(): void {
    updateCampaignStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 412, statusText: 'Precondition Failed' })));
  }

  it('clears the conflict banner when the refresh it asked for delivers a new list', () => {
    conflict();
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    // The precondition. Without this the assertion below could pass on a banner that never showed.
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

    refreshFromParent([doc({ status: 'created', etag: '"7"' })]);

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
  });

  /**
   * The sharper half, and the one a banner-only fix would leave behind.
   *
   * `toggledEtag` is preferred over the row's own etag, so a SUCCESSFUL toggle followed by a
   * refresh must not keep sending the etag from that toggle: the fresh doc carries the current
   * validator and the cached one is dead upstream. The assertion is on the etag the service was
   * ASKED for, not merely on the absence of an error — a component that swallowed the difference
   * would still render fine while sending the wrong `If-Match`.
   *
   * The two etags are deliberately DIFFERENT values ('"9"' vs '"12"'), and neither equals the
   * row's original '"3"'. If the fixture reused one string the assertion would hold for both the
   * fixed and the broken component, which is exactly the vacuous shape this file has been bitten
   * by before.
   */
  it('sends the re-read etag, not the stale session etag, on the toggle after a refresh', () => {
    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"9"' })
    );
    render([doc({ status: 'created', etag: '"3"' })]);

    // First toggle succeeds and caches the fresh etag '"9"'.
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    expect(updateCampaignStatus.mock.calls[0][0].etag).toBe('"3"');

    // The list is then re-read and comes back at version 12 — someone else moved it too.
    refreshFromParent([doc({ status: 'paused', etag: '"12"' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // The whole finding: '"9"' is the dead session validator, '"12"' is what the refresh fetched.
    expect(updateCampaignStatus.mock.calls[1][0].etag).toBe('"12"');
    expect(updateCampaignStatus.mock.calls[1][0].etag).not.toBe('"9"');
  });

  /**
   * The end-to-end loop dealako and cursor each described from one end: 412 → follow the banner →
   * toggle again. Before the fix the second toggle replayed the same dead etag and earned another
   * 412, so the UI's own named remedy changed nothing.
   */
  it('lets a toggle refused with 412 succeed after the operator refreshes', () => {
    conflict();
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]')).not.toBeNull();

    // The refresh the banner told them to perform, returning the version the other editor wrote.
    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"15"' })
    );
    refreshFromParent([doc({ status: 'created', etag: '"14"' })]);

    // The stale row error must be gone too — it described an attempt against a list that no
    // longer exists, and leaving it renders a failure beside rows that were just re-read.
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]')).toBeNull();

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    expect(updateCampaignStatus.mock.calls[1][0].etag).toBe('"14"');
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
  });

  /**
   * The clear is scoped to DELIVERED data. A refresh that fails leaves the parent at `null` plus
   * `campaignsUnavailable`, and nothing was re-read — so the etags in hand are still the stale
   * ones and the conflict warning is still true. Clearing there would drop the warning while the
   * condition it describes persists, which is strictly worse than the original bug: the operator
   * would toggle against a list nobody refreshed, with no banner to say so.
   */
  it('keeps the conflict banner when the refresh itself fails', () => {
    conflict();
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

    // What `loadBriefCampaigns`'s error arm produces: null list, unavailable flag, no rows.
    fixture.componentRef.setInput('briefCampaigns', null);
    fixture.componentRef.setInput('campaignsUnavailable', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();
  });

  /**
   * A refresh must not erase the outcome of a write that has not answered yet.
   *
   * A toggle dispatched before the refresh landed still owns its id: its response arms write
   * `toggledEtag`, `toggledStatus` and `toggleError` for that campaign AFTERWARDS. So the refresh
   * has to leave that row's keys alone — it has no information about a write that has not answered.
   *
   * Asserted on the ETAG the NEXT toggle sends, not on the error message. The message is written
   * by the response arm after the refresh, so it renders whether or not the refresh cleared it —
   * an assertion on it would pass against a component with no in-flight gate at all, which is
   * precisely the vacuous shape this file has to avoid. The etag is different: the in-flight
   * toggle's own success writes '"31"', the refresh delivered '"20"', and only a component that
   * preserved the in-flight row's entry sends '"31"' on the following click.
   */
  it('keeps the etag returned by a toggle that was still in flight when a refresh landed', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // The refresh lands while that toggle is still out. Its row is pending, so its keys stay.
    refreshFromParent([doc({ status: 'created', etag: '"20"' })]);

    // Only now does the in-flight write answer, with the validator it minted upstream.
    inFlight.next({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"31"' });
    inFlight.complete();
    fixture.detectChanges();

    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'ACTIVE', success: true, serviceStatus: 'active', etag: '"32"' })
    );
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // '"31"' is the live validator this campaign actually holds; '"20"' predates the write that
    // was in flight, so sending it would 412 a campaign nobody else touched.
    expect(updateCampaignStatus.mock.calls[1][0].etag).toBe('"31"');
    expect(updateCampaignStatus.mock.calls[1][0].etag).not.toBe('"20"');
  });

  /**
   * The other half of the in-flight gate: a FAILURE that answers after the refresh must still be
   * shown. The operator has not seen it yet, so the refresh must not be what swallows it.
   */
  it('still reports a failure that answers after the refresh landed', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    refreshFromParent([doc({ status: 'created', etag: '"20"' })]);

    inFlight.error(new HttpErrorResponse({ status: 412, statusText: 'Precondition Failed' }));
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]');
    expect(error).not.toBeNull();
    expect(error.textContent).toContain('Someone else changed this campaign');
  });

  /**
   * `toggledStatus` is NOT part of the stale set, and this pins that.
   *
   * It records what the service CONFIRMED for a row, and it exists because the index lags a
   * toggle. A refresh moments after a pause legitimately returns the OLD status, so clearing the
   * overlay would render a campaign the operator just paused as running — the exact failure the
   * overlay was written to prevent. The row below is re-read as `created` and must still show
   * paused.
   */
  it('keeps a confirmed status overlay across a refresh that has not caught up yet', () => {
    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"9"' })
    );
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').textContent).toContain('Resume');

    // The index has not caught up: the re-read still reports the pre-pause status.
    refreshFromParent([doc({ status: 'created', etag: '"12"' })]);

    // Still Resume — the overlay survived. Had it been cleared this would read Pause, telling
    // someone the campaign they just stopped is running.
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').textContent).toContain('Resume');
  });
});
