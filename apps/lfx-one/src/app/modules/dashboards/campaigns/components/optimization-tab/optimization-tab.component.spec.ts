// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CAMPAIGN_TOGGLE_FAILURE_MESSAGES } from '@lfx-one/shared/constants';
import { CampaignIndexDoc, CampaignRow, CampaignStatusUpdateResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { MessageService } from 'primeng/api';
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
  // The toggle now reports its outcome through the app-root toast as well as the row, because the
  // request outlives this component. Captured so the announcement can be asserted rather than
  // merely not-crashing.
  let messageAdd: ReturnType<typeof vi.fn>;

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
    messageAdd = vi.fn();

    await TestBed.configureTestingModule({
      imports: [OptimizationTabComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: messageAdd } },
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
   * FINDING 1: an eventually-consistent re-read is not proof the conflict resolved.
   *
   * `listBriefCampaigns` reads the QUERY SERVICE index and derives each etag from the indexed
   * `version`, while a toggle writes through campaign-service, which bumps that version at once.
   * Indexing is asynchronous, so a refresh issued immediately after a 412 can hand back a NEW
   * ARRAY carrying the SAME version that was just rejected.
   *
   * The fixture is built to make that the ONLY difference: same id, same status, same etag as the
   * pre-refresh row, delivered as a distinct array object. A component keyed on array identity
   * clears here and re-arms the loop; one keyed on the etag changing correctly concludes nothing
   * moved. Asserting the etag SENT is what keeps this honest — a "stale" fixture carrying a
   * different etag would pass for the wrong reason.
   */
  it('keeps the conflict banner when the re-read returns the same version it just rejected', () => {
    conflict();
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

    // A brand-new array object, but the index has not caught up: identical version.
    refreshFromParent([doc({ status: 'created', etag: '"3"' })]);

    // Nothing advanced, so nothing is proven — the warning has to stand.
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();
  });

  /**
   * The same skew, asserted on the wire rather than the banner: the cached validator must survive
   * a re-read that did not advance, because it remains the best etag available for that row.
   */
  it('keeps the cached validator when a re-read does not advance the version', () => {
    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"9"' })
    );
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // The index still reports version 3 — it has not seen the write that produced '"9"'.
    refreshFromParent([doc({ status: 'created', etag: '"3"' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // '"9"' came from campaign-service and is AHEAD of the index; '"3"' is the version already
    // known to be behind. Sending '"3"' here is the re-armed 412 loop.
    expect(updateCampaignStatus.mock.calls[1][0].etag).toBe('"9"');
    expect(updateCampaignStatus.mock.calls[1][0].etag).not.toBe('"3"');
  });

  /**
   * The complement, and the reason finding 1's fix is not simply "never clear": a row whose
   * indexed etag DID advance has demonstrably moved, so its stale state must still be dropped.
   * Without this, the fix for finding 1 could degenerate into clearing nothing at all.
   */
  it('still clears once the re-read actually advances the version', () => {
    conflict();
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

    refreshFromParent([doc({ status: 'created', etag: '"8"' })]);

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]')).toBeNull();
  });

  /**
   * FINDING 2: a toggle that ANSWERS inside the parent's `null` window.
   *
   * `loadBriefCampaigns` sets the input to `null` on entry and to the fetched array on the
   * response arm. A toggle dispatched beforehand can complete between those two pushes — and its
   * `next` arm clears `togglePending` BEFORE writing `toggledEtag`, so by the time the fresh array
   * lands the row is no longer pending yet holds a validator minted by campaign-service, which is
   * ahead of anything the index can report.
   *
   * This is distinct from the previously tested case of a toggle still OUTSTANDING at clear time.
   * That one had no entry to protect; this one does, which is why an in-flight-only guard does not
   * cover it.
   *
   * The delivered etag is deliberately DIFFERENT ('"5"') from the pre-refresh one, so the row does
   * qualify as advanced — proving the protection comes from the write itself, not from the row
   * happening to look unchanged.
   */
  it('keeps an etag written by a toggle that answered inside the refresh window', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // The parent begins its re-read: input goes null first.
    fixture.componentRef.setInput('briefCampaigns', null);
    fixture.detectChanges();

    // The toggle answers HERE — inside the window, before the fresh array arrives.
    inFlight.next({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"11"' });
    inFlight.complete();
    fixture.detectChanges();

    // Now the re-read lands, at a version that IS newer than the pre-refresh one but still behind
    // the write that just completed.
    fixture.componentRef.setInput('briefCampaigns', [doc({ status: 'created', etag: '"5"' })]);
    fixture.detectChanges();

    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'ACTIVE', success: true, serviceStatus: 'active', etag: '"12"' })
    );
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    expect(updateCampaignStatus.mock.calls[1][0].etag).toBe('"11"');
    expect(updateCampaignStatus.mock.calls[1][0].etag).not.toBe('"5"');
  });

  /**
   * Per-row scoping, stated directly: one row advancing must not drop another row's state. A
   * wholesale clear passes every single-row test above while still discarding a second campaign's
   * validator, which is a money-affecting write sent with the wrong `If-Match`.
   */
  it('clears only the rows whose version advanced, leaving the others intact', () => {
    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-2', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"77"' })
    );
    render([doc({ id: 'c-1', status: 'created', etag: '"3"' }), doc({ id: 'c-2', status: 'created', etag: '"4"' })]);

    // c-2 is toggled and caches '"77"'.
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-2"]').click();
    fixture.detectChanges();

    // c-1 advances in the index; c-2 does not.
    refreshFromParent([doc({ id: 'c-1', status: 'created', etag: '"6"' }), doc({ id: 'c-2', status: 'created', etag: '"4"' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-2"]').click();
    fixture.detectChanges();

    // c-2 never moved in the index, so its session validator is still the right one to send.
    expect(updateCampaignStatus.mock.calls[1][0].etag).toBe('"77"');
  });

  /**
   * `toggledStatus` survives a refresh the index has NOT caught up on.
   *
   * It records what the service CONFIRMED for a row, and it exists because the index lags a
   * toggle. A refresh moments after a pause legitimately returns the OLD status, so clearing the
   * overlay would render a campaign the operator just paused as running — the exact failure the
   * overlay was written to prevent.
   *
   * The lagging row is delivered at its ORIGINAL etag `"3"`, which is what "the index has not
   * caught up" actually looks like on the wire. An earlier version of this test delivered `"12"`
   * — an etag AHEAD of the toggle's own `"9"` — while calling it a lagging index. That fixture
   * was self-contradictory, and it is why the inverse defect below shipped: an advanced etag is
   * proof the index moved PAST this session's write, so the row it describes is not lagging at
   * all. Both halves are now tested, and they are distinguished by the only evidence available:
   * whether the delivered etag moved.
   */
  it('keeps a confirmed status overlay across a refresh that has not caught up yet', () => {
    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"9"' })
    );
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').textContent).toContain('Resume');

    // The index has not caught up: the re-read reports the pre-pause status AT THE OLD VERSION.
    refreshFromParent([doc({ status: 'created', etag: '"3"' })]);

    // Still Resume — the overlay survived. Had it been cleared this would read Pause, telling
    // someone the campaign they just stopped is running.
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').textContent).toContain('Resume');
  });

  /**
   * ...and it is DROPPED once the index proves it moved past this session's write.
   *
   * The inverse of the case above, and the one that was inverted. Clearing the cached etag while
   * keeping the status it was minted with let the row render a confident falsehood: this session
   * pauses at v4, another actor resumes at v5, the refresh adopts v5's etag — and the row went on
   * showing `paused` and offering Resume for a campaign that is spending.
   *
   * The two are one claim about one version, so they are dropped together. The delivered status
   * is deliberately the OPPOSITE of the overlay's, and the assertion is on the ACTION the button
   * offers rather than on the label alone: a row that wrongly believes it is paused offers
   * Resume, which is the click that would actually cost money here.
   */
  it('drops the status overlay once a delivered etag proves the index moved past it', () => {
    updateCampaignStatus.mockReturnValue(
      of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"4"' })
    );
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    // The overlay is in force: the row shows the pause this session confirmed.
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').textContent).toContain('Resume');

    // Another actor resumed it at v5. The etag ADVANCED past this session's v4, so the delivered
    // row — not the overlay — is the authority.
    refreshFromParent([doc({ status: 'created', etag: '"5"' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.textContent).toContain('Pause');
    expect(button.textContent).not.toContain('Resume');
    // And the row's rendered status follows the authoritative list rather than the dropped overlay.
    expect(fixture.nativeElement.textContent).toContain('created');
  });

  /**
   * PER-ROW conflict state (second review round).
   *
   * Everything above proved the conflict CLEARS. These prove it clears for the right ROWS, which
   * a single list-wide boolean structurally cannot do: resolution is proved per row by the index
   * advancing, so one flag has to answer "is anything still conflicted?" from evidence about one
   * row, and gets it wrong in both directions.
   */
  describe('per-row conflict state', () => {
    const twoRows = (c1Etag: string, c2Etag: string): CampaignIndexDoc[] => [
      doc({ id: 'c-1', status: 'created', etag: c1Etag }),
      doc({ id: 'c-2', campaign_name: 'KubeCon NA', status: 'created', etag: c2Etag }),
    ];

    /**
     * The finding cursor and copilot each reported independently, which is the strong signal.
     *
     * With `c-1` conflicted, a refresh that still returns `c-1`'s rejected version but a NEWER one
     * for `c-2` proves nothing whatsoever about `c-1`. The old code called `clearConflictStateFor`
     * with `['c-2']` and set the list-wide flag false, hiding the banner and its Refresh control
     * while `c-1` still held the dead validator and per-row copy telling the operator to refresh.
     *
     * Asserted on the BANNER and on `c-1`'s cached validator, not on one of them: a fix that kept
     * the banner but still dropped `c-1`'s etag would leave the 412 loop armed behind a correct-
     * looking UI.
     */
    it('keeps the banner when an unrelated row advances but the conflicted one does not', () => {
      conflict();
      render(twoRows('"3"', '"5"'));
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

      // c-2 advanced (5 → 6); c-1 is still at the version that was just rejected.
      refreshFromParent(twoRows('"3"', '"6"'));

      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]')).not.toBeNull();
    });

    /**
     * The complement, so the fix cannot degenerate into "never clear when more than one row
     * exists": once the CONFLICTED row itself advances, the banner must go even though `c-2`
     * never moved at all.
     */
    it('clears the banner once the conflicted row itself advances', () => {
      conflict();
      render(twoRows('"3"', '"5"'));
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

      // Only c-1 moves this time.
      refreshFromParent(twoRows('"4"', '"5"'));

      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]')).toBeNull();
    });

    /**
     * Two rows conflicted, one resolved: the banner is not a claim about a row, it is a claim that
     * SOMETHING is unresolved. It must survive a partial resolution and disappear only on the
     * last one — the property a boolean cannot express and a set gets for free.
     */
    it('holds the banner until every conflicted row has advanced', () => {
      conflict();
      render(twoRows('"3"', '"5"'));
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-2"]').click();
      fixture.detectChanges();

      // c-1 resolves, c-2 does not.
      refreshFromParent(twoRows('"4"', '"5"'));
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

      // Now c-2 resolves too.
      refreshFromParent(twoRows('"4"', '"6"'));
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
    });

    /**
     * Copilot on the template: after a 412 every row stayed enabled, so clicking the same row
     * resent the exact ETag just rejected and produced another 412 deterministically — while the
     * banner beside it said to refresh first.
     *
     * Asserted on the CONFLICTED row being disabled AND the untouched row staying enabled. The
     * second half is what stops the fix from over-reaching: the other rows' validators are
     * untested, not disproved, and withdrawing controls from campaigns that are spending on no
     * evidence would be its own defect.
     */
    it('disables only the conflicted row, leaving the others clickable', () => {
      conflict();
      render(twoRows('"3"', '"5"'));
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').disabled).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-2"]').disabled).toBe(false);
    });

    /**
     * The button must come BACK once the refresh proves the row advanced — a disable that never
     * lifts is a worse bug than the one it fixes, because the operator's only remedy is a page
     * reload. Asserted through the real refresh path.
     */
    it('re-enables the row once the refresh proves it advanced', () => {
      conflict();
      render([doc({ status: 'created', etag: '"3"' })]);
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').disabled).toBe(true);

      refreshFromParent([doc({ status: 'created', etag: '"8"' })]);

      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').disabled).toBe(false);
    });

    /**
     * A toggle that ANSWERS after the context it was dispatched in is gone.
     *
     * `takeUntilDestroyed` does not fire on a foundation or brief switch — the component stays
     * mounted under `@case ('optimization')` — so an in-flight request outlives the context that
     * started it. Its response arms write `toggleError` and the conflicted-id set keyed by campaign
     * id alone, so a 412 landing after the switch re-arms the banner for a brief that was never
     * conflicted. Worse, that id is not in the new list, so no delivery can ever clear it: the
     * per-row clear only removes ids a delivered row advanced. A permanently latched banner — the
     * exact defect this PR exists to remove, reintroduced through the back door.
     *
     * Driven with a `Subject` so the response is delivered under test control, AFTER the switch.
     */
    it('ignores a 412 that lands after the brief has already changed', () => {
      const inFlight = new Subject<CampaignStatusUpdateResult>();
      updateCampaignStatus.mockReturnValue(inFlight.asObservable());
      render([doc({ status: 'created', etag: '"3"' })]);
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();

      // The operator switches brief while the toggle is still out.
      fixture.componentRef.setInput('briefCampaigns', null);
      fixture.componentRef.setInput('briefId', 'b-2');
      fixture.detectChanges();
      fixture.componentRef.setInput('briefCampaigns', [doc({ status: 'created', etag: '"5"' })]);
      fixture.detectChanges();

      // Only now does the abandoned request fail with a conflict.
      inFlight.error(new HttpErrorResponse({ status: 412, statusText: 'Precondition Failed' }));
      fixture.detectChanges();

      // The new brief was never conflicted, and its row must stay usable.
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').disabled).toBe(false);
    });

    /**
     * The success arm needs the same guard, asserted on the CONFIRMED overlay rather than the
     * banner: a late success writes `toggledStatus` and `toggledEtag` for an id that now addresses
     * a different brief's row, so the new row would render a status it never reported.
     */
    it('ignores a late toggle success from an abandoned brief', () => {
      const inFlight = new Subject<CampaignStatusUpdateResult>();
      updateCampaignStatus.mockReturnValue(inFlight.asObservable());
      render([doc({ status: 'created', etag: '"3"' })]);
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();

      fixture.componentRef.setInput('briefCampaigns', null);
      fixture.componentRef.setInput('briefId', 'b-2');
      fixture.detectChanges();
      fixture.componentRef.setInput('briefCampaigns', [doc({ status: 'created', etag: '"5"' })]);
      fixture.detectChanges();

      inFlight.next({
        platform: 'google-ads',
        campaignId: 'c-1',
        newStatus: 'PAUSED',
        success: true,
        serviceStatus: 'paused',
        etag: '"9"',
      } as CampaignStatusUpdateResult);
      inFlight.complete();
      fixture.detectChanges();

      // The new brief's row is `created`, so it must still offer Pause — not the Resume that the
      // abandoned brief's confirmed pause would have overlaid onto it.
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').textContent).toContain('Pause');

      // And the next toggle must send the NEW brief's validator, not the leaked '"9"'.
      updateCampaignStatus.mockReturnValue(of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused' }));
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();
      expect(updateCampaignStatus.mock.calls[1][0].etag).toBe('"5"');
    });

    /**
     * The handler's own guard, which the template disable hides from every click-driven test.
     *
     * Copilot asked for the handler to stay fail-closed "as well if it can be invoked outside the
     * template", and it can: `toggleCampaign` takes a `CampaignRow`, so any future caller — a
     * keyboard shortcut, a bulk action, a row re-rendered from a stale computed — reaches it
     * without passing through the disabled button. Driven by CALLING the handler, because a click
     * on a disabled button is a no-op and would pass against a component with no guard at all.
     *
     * Asserted on no request being dispatched, which is the whole point: the etag it would send is
     * already known dead, so the round trip is a guaranteed 412.
     */
    it('refuses a conflicted row when the handler is invoked outside the template', () => {
      conflict();
      render([doc({ status: 'created', etag: '"3"' })]);
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();
      expect(updateCampaignStatus).toHaveBeenCalledTimes(1);

      // Reach past the disabled button, the way a non-template caller would.
      const component = fixture.componentInstance as unknown as {
        campaignRows: () => CampaignRow[];
        toggleCampaign: (row: CampaignRow) => void;
      };
      const row = component.campaignRows()[0];
      expect(row.conflicted).toBe(true);
      component.toggleCampaign(row);
      fixture.detectChanges();

      // Still one call: the guard refused before dispatch rather than replaying the dead etag.
      expect(updateCampaignStatus).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]').textContent).toContain('Refresh the campaign list');
    });

    /**
     * Cursor's context-switch finding, driven the way the parent actually performs it.
     *
     * A foundation switch sets `briefCampaigns` to `null`, and when the new foundation has no
     * brief `loadBriefCampaigns` early-returns without dispatching a read — so NO list is ever
     * delivered. The delivery-based clear cannot reach that case, and the component stays mounted
     * under `@case ('optimization')` showing the previous foundation's banner over a context that
     * was never conflicted.
     *
     * The `null` push happens BEFORE the slug change here, matching the parent's real order:
     * the switch effect clears the list, then `loadBriefCampaigns` re-reads the new context.
     */
    it('drops the conflict banner when the foundation changes with no brief to read', () => {
      conflict();
      render([doc({ status: 'created', etag: '"3"' })]);
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

      // The parent's foundation-switch path: list cleared, then the new context bound. No list
      // ever arrives, because the new foundation has no brief.
      fixture.componentRef.setInput('briefCampaigns', null);
      fixture.componentRef.setInput('projectSlug', 'cncf');
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
    });

    /**
     * The same abandonment must drop the cached VALIDATORS, not merely the banner. An etag minted
     * against brief A is meaningless against brief B, and if the ids ever collide sending it would
     * be a write against the wrong campaign's version.
     *
     * Asserted on the etag the next toggle sends: '"5"' is brief B's own freshly-read validator;
     * '"9"' would be brief A's session leftover.
     *
     * The two briefs deliver the row at the SAME version ('"5"'), and that is what isolates this
     * to the context change. A differing version would advance the row on delivery, so the
     * per-row delivery clear would drop the validator on its own and the assertion would hold
     * against a component with no context handling at all — the vacuous shape this file has been
     * bitten by before. With the versions equal, delivery proves nothing and only abandoning on
     * the brief change can produce '"5"'.
     */
    it('abandons cached validators when the brief changes', () => {
      updateCampaignStatus.mockReturnValue(
        of({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"9"' })
      );
      render([doc({ status: 'created', etag: '"5"' })]);
      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();

      // A different brief in the same foundation, delivering a row that happens to share the id
      // AND the version — so nothing about the delivery itself proves the cached etag is stale.
      fixture.componentRef.setInput('briefCampaigns', null);
      fixture.componentRef.setInput('briefId', 'b-2');
      fixture.detectChanges();
      fixture.componentRef.setInput('briefCampaigns', [doc({ status: 'created', etag: '"5"' })]);
      fixture.detectChanges();

      fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
      fixture.detectChanges();

      expect(updateCampaignStatus.mock.calls[1][0].etag).toBe('"5"');
      expect(updateCampaignStatus.mock.calls[1][0].etag).not.toBe('"9"');
    });
  });

  /**
   * Copilot's fail-open finding on row construction.
   *
   * `listBriefCampaigns` spreads index docs through unvalidated, so a doc missing `platform`
   * reaches the row builder as `undefined`. `campaignToggleAction` treats an absent platform as
   * "not asked" and answers on status alone — correct for a status-only caller, fail-OPEN here:
   * the row earned a live Pause button whose every click 400s, because the request omits
   * `body.platform` and the controller refuses it before dispatch.
   *
   * Asserted on the button being DISABLED and on no request being made, rather than on the label:
   * a fix that merely relabelled the button would still let the click through.
   */
  it('refuses a row whose platform the payload omitted, rather than offering a doomed button', () => {
    const noPlatform = { ...doc({ status: 'created' }) } as Partial<CampaignIndexDoc>;
    delete noPlatform.platform;
    render([noPlatform as CampaignIndexDoc]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Unavailable');

    button.click();
    fixture.detectChanges();
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  /**
   * dealako follow-up #1: the mutation must not be aborted by leaving the Optimize tab.
   *
   * `lfx-optimization-tab` renders inside the parent's `@case ('optimization')`, so switching tab
   * DESTROYS it. Piping the toggle through `takeUntilDestroyed(this.destroyRef)` therefore
   * cancelled the in-flight pause: the operator clicked Pause, saw "Working", switched tab, and
   * the request they believed they had submitted was aborted with nothing shown.
   *
   * `fixture.destroy()` is exactly what the `@switch` does — this is the lifecycle the operator
   * actually triggers, not a synthetic one.
   *
   * Asserted on the SUBSCRIBER COUNT of the in-flight subject, which is the only thing that
   * distinguishes the two implementations. A completion-based assertion would not: with
   * `takeUntilDestroyed` the observable is unsubscribed (the HTTP layer aborts the XHR) while the
   * subject itself is untouched, so nothing about the subject's own state changes. `observed`
   * answers the actual question — is anyone still listening for this response, or was the
   * mutation cut loose?
   */
  it('does NOT abort an in-flight toggle when the Optimize tab is destroyed', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    // Precondition: the request is genuinely outstanding, so the assertion below is about the
    // teardown rather than about a request that already finished.
    expect(inFlight.observed).toBe(true);

    // What `@switch (selectedTab())` does on a trip to another tab.
    fixture.destroy();

    // The finding. Under `takeUntilDestroyed` this is false: the subscription is torn down and the
    // pause is cancelled mid-flight.
    expect(inFlight.observed).toBe(true);
  });

  /**
   * The other half of #1: surviving the abort is worthless if the operator never learns the result.
   *
   * The row that would have shown it is gone with the component, so the outcome has to reach a
   * surface that outlives the tab. `MessageService` is provided at app root and rendered by
   * `app.component`, above the `@switch`.
   *
   * Asserted on the toast CONTENT, not merely that `add` was called: a component that announced
   * every response with the same generic string would satisfy a call-count assertion while
   * telling the operator nothing about which campaign did what.
   */
  it('tells the operator the toggle landed even though the tab that started it is gone', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"', campaign_name: 'KubeCon EU' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    fixture.destroy();

    // The response the operator navigated away from, arriving after the component is gone.
    inFlight.next({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"9"' });

    expect(messageAdd).toHaveBeenCalledTimes(1);
    const toast = messageAdd.mock.calls[0][0];
    expect(toast.severity).toBe('success');
    expect(toast.summary).toBe('Paused KubeCon EU');
  });

  /**
   * And a FAILED toggle after teardown, which is the arm that actually costs money.
   *
   * A pause that failed leaves the campaign RUNNING. If that failure is swallowed because the tab
   * was destroyed, the operator believes they paused a campaign that is still spending — the
   * exact "silently cancelled" outcome the finding names, reached through the error arm instead.
   *
   * `sticky` is asserted because it is load-bearing rather than cosmetic: a timed toast for "your
   * pause did not happen" can expire unseen while the operator is on another tab.
   */
  it('reports a toggle FAILURE after teardown, rather than swallowing it with the component', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"', campaign_name: 'KubeCon EU' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    fixture.destroy();

    inFlight.error(new HttpErrorResponse({ status: 500, statusText: 'Server Error' }));

    expect(messageAdd).toHaveBeenCalledTimes(1);
    const toast = messageAdd.mock.calls[0][0];
    expect(toast.severity).toBe('error');
    expect(toast.summary).toBe('KubeCon EU');
    // The per-direction copy, so the toast states which way the failure left the campaign.
    expect(toast.detail).toBe(CAMPAIGN_TOGGLE_FAILURE_MESSAGES.pause);
    expect(toast.sticky).toBe(true);
  });

  /**
   * dealako follow-up #2: a conflicted row that LEAVES the list must not latch the banner.
   *
   * `clearConflictStateFor` only ever saw ids derived from delivered rows, so a campaign that a
   * 412 conflicted and that was then deleted/archived upstream never re-appeared, never entered
   * `advanced`, and stayed in `conflictedCampaignIds` forever — a banner whose Refresh control
   * provably cannot dismiss it, because the row it is about never comes back.
   *
   * Two rows deliberately: `c-1` conflicts and then vanishes, `c-2` stays. A single-row fixture
   * would pass against a fix that simply wiped the whole set on any delivery, which is the
   * over-broad fix that would re-break the per-row evidence this component was rewritten for.
   */
  it('clears the banner for a conflicted row that is gone from a later full delivery', () => {
    conflict();
    render([doc({ status: 'created', etag: '"3"' }), doc({ id: 'c-2', status: 'created', etag: '"4"', campaign_name: 'Other' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

    // `c-1` was deleted upstream. `c-2` comes back UNCHANGED at '"4"', so it contributes no
    // "advance" — nothing here could clear the banner via the etag path, which is what makes this
    // a test of the absence rule specifically.
    refreshFromParent([doc({ id: 'c-2', status: 'created', etag: '"4"', campaign_name: 'Other' })]);

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).toBeNull();
  });

  /**
   * The safety half of #2, and the reason absence clears only on a TRUSTWORTHY list.
   *
   * `possiblyStale` is the server's own statement that the delivery may be incomplete — it is set
   * when the index returned nothing (which can just mean "not indexed yet") and on a refusal,
   * which answers `[]` with the flag rather than an error. Reading absence from that list as
   * "the campaign is gone, so its conflict is resolved" would clear a LIVE conflict on the
   * strength of a lagging index: the failure-as-confident-value defect this whole PR exists to
   * remove, re-introduced by its own fix.
   *
   * The row is absent AND the list is stale, so only the staleness gate can keep the banner up.
   */
  it('keeps the banner when the conflicted row is missing from a POSSIBLY STALE delivery', () => {
    conflict();
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();

    // The index has not caught up: an empty-but-stale list, which proves nothing about `c-1`.
    fixture.componentRef.setInput('briefCampaigns', null);
    fixture.detectChanges();
    fixture.componentRef.setInput('campaignsPossiblyStale', true);
    fixture.componentRef.setInput('briefCampaigns', []);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="optimization-campaigns-conflict"]')).not.toBeNull();
  });

  /**
   * dealako follow-up #3: the pending state is announced from a live region, and it is tested.
   *
   * The previous announcement swapped the button's `aria-label` to "Working" and set `aria-busy`
   * on the SAME button that goes native-`disabled` in the same tick. A disabled button leaves the
   * focus order and screen readers do not reliably announce attribute changes on an unfocused,
   * disabled element, so the announcement was only perceivable to someone who manually navigated
   * back to a control they could no longer focus.
   *
   * Held in flight with a Subject so the pending branch is actually observed — the prior aria
   * tests all ran against non-pending rows, which is why this branch shipped uncovered.
   *
   * Asserted on the region's TEXT naming both the action and the campaign. A fix that rendered an
   * empty live region, or one saying only "Working", would pass a presence-only assertion while
   * announcing nothing the operator can act on.
   */
  it('announces the pending toggle in a live region, naming the action and the campaign', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"', campaign_name: 'KubeCon EU' })]);

    const region = (): HTMLElement => fixture.nativeElement.querySelector('[data-testid="optimization-toggle-announcement"]');
    // The region must PRE-EXIST its content: a live region created in the same tick as its text
    // is frequently not announced at all.
    expect(region()).not.toBeNull();
    expect((region().textContent ?? '').trim()).toBe('');
    // And it must be a polite status region rather than an ordinary div.
    expect(region().getAttribute('aria-live')).toBe('polite');

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // The pending announcement, while the request is genuinely outstanding.
    expect(inFlight.observed).toBe(true);
    expect(region().textContent).toContain('Pausing');
    expect(region().textContent).toContain('KubeCon EU');
    // The button is disabled and busy, which is precisely why the region has to carry the message.
    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    inFlight.next({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"9"' });
    fixture.detectChanges();

    // On completion the region empties rather than announcing the outcome. `p-toast` is itself a
    // live region (`role="alert"`), so announcing the completion here too would speak one action
    // twice to the same user. The region owns the pending state; the toast owns the outcome — and
    // the toast is also the only surface that still works once this tab is destroyed. It empties
    // because it is COMPUTED from the pending map, which no longer holds this row.
    expect((region().textContent ?? '').trim()).toBe('');
    expect(messageAdd).toHaveBeenCalledTimes(1);
    expect(messageAdd.mock.calls[0][0].summary).toBe('Paused KubeCon EU');
    expect(button.getAttribute('aria-busy')).toBeNull();
  });

  /**
   * The live region must not narrate an abandoned brief into the next one.
   *
   * The region is part of THIS list's rendering, unlike the toast, which belongs to the operator's
   * action and is deliberately context-free. A switch of (project, brief) leaves the component
   * mounted under `@case ('optimization')`, so a "Pausing <campaign>" left in the region would sit
   * there describing a campaign the new brief does not contain.
   */
  it('clears the live region when the brief changes mid-toggle', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"', campaign_name: 'KubeCon EU' })]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    const region = (): HTMLElement => fixture.nativeElement.querySelector('[data-testid="optimization-toggle-announcement"]');
    expect(region().textContent).toContain('Pausing');

    // The operator switches brief while the toggle is still out.
    fixture.componentRef.setInput('briefId', 'b-2');
    render([doc({ id: 'c-9', status: 'created', etag: '"1"', campaign_name: 'Other Brief Campaign' })]);

    expect((region().textContent ?? '').trim()).toBe('');
  });

  /**
   * The button's accessible NAME stays stable across the pending transition.
   *
   * It used to become "Working <campaign>" while in flight. A control whose accessible name
   * changes mid-interaction breaks speech input ("click Pause" no longer matches) and makes the
   * button unidentifiable in a rotor listing. The transient state belongs on `aria-busy` and in
   * the live region; the NAME should keep naming the control.
   */
  it('keeps the button accessible name stable while a toggle is in flight', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"', campaign_name: 'KubeCon EU' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.getAttribute('aria-label')).toBe('Pause KubeCon EU');

    button.click();
    fixture.detectChanges();

    expect(button.getAttribute('aria-label')).toBe('Pause KubeCon EU');
  });

  /**
   * Group A, the announcement-ownership design (post-`058da8875` review).
   *
   * Three findings landed against the a11y fix, and they pull against each other if taken as
   * three patches: drop the inline `role="alert"`, restore the visible label, and stop one row's
   * completion silencing another's pending message. They resolve to ONE rule:
   *
   *   PENDING is owned by the live region. OUTCOME is owned by the toast.
   *
   * ...plus one structural change that makes the third unrepresentable rather than guarded: the
   * region is COMPUTED from the per-row pending map instead of being an imperatively-written
   * slot. These cases pin the rule at each site it governs.
   */
  it('keeps narrating a row still working when another row finishes', () => {
    const first = new Subject<CampaignStatusUpdateResult>();
    const second = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValueOnce(first.asObservable()).mockReturnValueOnce(second.asObservable());
    render([
      doc({ id: 'c-1', status: 'created', etag: '"3"', campaign_name: 'KubeCon EU' }),
      doc({ id: 'c-2', status: 'created', etag: '"4"', campaign_name: 'Open Source Summit' }),
    ]);

    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-2"]').click();
    fixture.detectChanges();

    const region = (): HTMLElement => fixture.nativeElement.querySelector('[data-testid="optimization-toggle-announcement"]');
    // Both in flight: the region names BOTH, because "which campaign" is exactly what a count
    // would fail to give the operator.
    expect(region().textContent).toContain('KubeCon EU');
    expect(region().textContent).toContain('Open Source Summit');

    // The FIRST finishes. Under the old shared-slot implementation this wiped the region wholesale.
    first.next({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"9"' });
    fixture.detectChanges();

    // c-2 is still working and must still be narrated; c-1 is done and must not be.
    expect(region().textContent).toContain('Open Source Summit');
    expect(region().textContent).not.toContain('KubeCon EU');
    expect(second.observed).toBe(true);
  });

  /**
   * The same shared-slot defect reached from the other end: a LATE response from an abandoned
   * brief must not silence a live message.
   *
   * The old implementation cleared the region before the `dispatchedIn` context guard, so a
   * response belonging to a brief the operator had already left wiped narration about the brief
   * they were now looking at. Deriving the text from the current rows removes the pathway.
   */
  it('does not let a late response from an abandoned brief silence the current one', () => {
    const abandoned = new Subject<CampaignStatusUpdateResult>();
    const current = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValueOnce(abandoned.asObservable()).mockReturnValueOnce(current.asObservable());
    render([doc({ id: 'c-1', status: 'created', etag: '"3"', campaign_name: 'Old Brief Campaign' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    // Switch brief, then start a toggle in the NEW context.
    fixture.componentRef.setInput('briefId', 'b-2');
    render([doc({ id: 'c-9', status: 'created', etag: '"1"', campaign_name: 'New Brief Campaign' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-9"]').click();
    fixture.detectChanges();

    const region = (): HTMLElement => fixture.nativeElement.querySelector('[data-testid="optimization-toggle-announcement"]');
    expect(region().textContent).toContain('New Brief Campaign');

    // The abandoned brief's request finally answers.
    abandoned.next({ platform: 'google-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, serviceStatus: 'paused', etag: '"9"' });
    fixture.detectChanges();

    // The live narration about the CURRENT brief survives it.
    expect(region().textContent).toContain('New Brief Campaign');
  });

  /**
   * The inline failure text is a DESCRIPTION, not a second live region.
   *
   * The failure is already announced by the toast, which is itself a live region, so a
   * `role="alert"` here made one failure speak twice. It stays as the button's
   * `aria-describedby` target — read WITH the control on demand rather than fired at the user
   * again — which is why the assertion covers both halves: the role is gone AND the wiring that
   * makes the text still reachable is intact.
   */
  it('renders the inline failure as a description rather than a second live region', () => {
    updateCampaignStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })));
    render([doc({ status: 'created', etag: '"3"' })]);
    fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]').click();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-error-c-1"]');
    expect(error).not.toBeNull();
    // Not a live region: the toast already announced this failure.
    expect(error.getAttribute('role')).toBeNull();
    // ...but still reachable, named by the button that failed.
    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    expect(button.getAttribute('aria-describedby')).toContain('campaign-error-c-1');
    expect(error.id).toBe('campaign-error-c-1');
  });

  /**
   * Label-in-name: the visible label must remain part of the accessible name while pending.
   *
   * The pending button used to render the word "Working" while its accessible name stayed
   * "Pause <campaign>". A speech-input user says what they SEE, so "click Pause" no longer
   * matched the control. The action word now stays visible throughout and progress is carried by
   * the spinner, `aria-busy` and the live region — none of which change what the control is
   * called.
   */
  it('keeps the visible label inside the accessible name while pending', () => {
    const inFlight = new Subject<CampaignStatusUpdateResult>();
    updateCampaignStatus.mockReturnValue(inFlight.asObservable());
    render([doc({ status: 'created', etag: '"3"', campaign_name: 'KubeCon EU' })]);

    const button = fixture.nativeElement.querySelector('[data-testid="optimization-campaign-toggle-c-1"]');
    button.click();
    fixture.detectChanges();

    // Genuinely mid-flight, so this is the pending branch and not the resting one.
    expect(inFlight.observed).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    const visible = button.textContent.trim();
    const accessibleName = button.getAttribute('aria-label');
    expect(visible).toContain('Pause');
    expect(visible).not.toContain('Working');
    // The actual WCAG 2.5.3 condition, asserted as a relationship rather than two fixed strings.
    expect(accessibleName).toContain(visible);
  });
});
