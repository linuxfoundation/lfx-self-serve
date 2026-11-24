// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft, CampaignPlatformResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
  SEED_KEYWORD,
  configureGoogleTab,
  stubCreativeLibraryUpload,
  STATE_ONLY,
  tabComponentUnderTest,
  trackStateOnlyTests,
} from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * The create handler's error arm, which is the last step of the named-refusal path.
 *
 * Every guard on the server writes a field and a stated remedy, and all of that is wasted if the
 * tab replaces the message with connection advice on the way to the screen. This handler took no
 * parameter at all before this change, so EVERY non-2xx was reported as a connection failure.
 *
 * Both directions are asserted, because each alone passes against a different wrong handler: a
 * test that only checked the server message passes against a handler that prints whatever it is
 * handed, including the status-derived envelope `gatewayFetch` composes for an upstream failure;
 * and a test that only checked the fallback passes against the unfixed handler.
 */
describe('ImplementationTabComponent create failure messaging', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const submittableGoogleCreate = () => {
    fixture.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://example.com',
      includeSearch: true,
      budgetUsd: 500,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      headlines: ['Join us at KubeCon'],
      descriptions: ['Register today for KubeCon EU 2026.'],
    } as unknown as CampaignImplementationDraft);
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('surfaces the field refusal the server wrote instead of connection advice', STATE_ONLY, async () => {
    // The exact shape a server guard emits: 400 carrying VALIDATION_ERROR and the operator-facing
    // sentence. `isBffValidationError` keys on the CODE, not the status, because a relayed
    // upstream 400 carries a status-derived code and a message no person wrote.
    vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              error:
                'the Google Ads budget must be greater than 0 — this one resolves to no spend at all once the Search share is applied. Set a larger budget and create again.',
            },
          })
      )
    );
    submittableGoogleCreate();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['submit']();
    await fixture.whenStable();

    expect(c['errors']()).toEqual([expect.stringContaining('Google Ads budget must be greater than 0')]);
    // Back to the form, not stranded on the progress step — the operator has to be able to act on
    // the remedy the message just gave them.
    expect(c['step']()).toBe('form');
  });

  // #5491: `ServiceValidationError.forField`'s real body, with a reason longer than the 200 characters
  // `serverAuthoredMessage` puts in front of a reader. This is the registration URL refusal's own text.
  const LONG_FIELD_REFUSAL =
    "the saved brief's registration URL is not a complete web address, so the ad platforms will refuse it. Select Edit brief, enter a full https:// Registration URL, then Save & Proceed and create again, now.";

  it('shows a BFF field refusal in full, even past the plain-text length cap, beside the button', async () => {
    expect(LONG_FIELD_REFUSAL.length).toBeGreaterThan(200);
    vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              error: 'Validation failed for registrationUrl',
              errors: [{ field: 'registrationUrl', message: LONG_FIELD_REFUSAL, code: 'FIELD_VALIDATION_ERROR' }],
            },
          })
      )
    );
    submittableGoogleCreate();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['submit']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c['errors']()).toEqual([LONG_FIELD_REFUSAL]);
    const shown = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-submit-error"]');
    expect(shown?.textContent?.trim()).toBe(LONG_FIELD_REFUSAL);
    expect(shown?.getAttribute('role')).toBe('alert');
  });

  it('keeps reading a non-validation 400 through the shared gate, which prefers its top-level message', STATE_ONLY, async () => {
    // Only a BFF `VALIDATION_ERROR` takes the field-first reader: any other body keeps the shared
    // rule, so a relayed `errors[]` entry does not displace the message the response leads with.
    vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'BAD_REQUEST', error: 'The campaign request was refused.', errors: [{ message: 'an upstream detail' }] },
          })
      )
    );
    submittableGoogleCreate();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['submit']();
    await fixture.whenStable();

    expect(c['errors']()).toEqual(['The campaign request was refused.']);
  });

  it('scrolls the refusal into view once the form is back', async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'VALIDATION_ERROR', error: 'Set an end date and create again.' } }))
      );
      submittableGoogleCreate();

      (fixture.componentInstance as unknown as Record<string, any>)['submit']();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(scrolled.map((node) => node.getAttribute('data-testid'))).toEqual(['implementation-submit-error']);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('keeps the connection fallback for a failure that carried no server message', STATE_ONLY, async () => {
    vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0, error: null, statusText: 'Unknown Error' }))
    );
    submittableGoogleCreate();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['submit']();
    await fixture.whenStable();

    expect(c['errors']()).toEqual([expect.stringContaining('Unable to reach the campaign service')]);
    expect(c['step']()).toBe('form');
  });
});

/**
 * #5491: whenever Create Campaign is disabled, the line under it says what blocks it. `canSubmit` is
 * `createBlockedReason() === null`, so the two cannot disagree; these pin the reason's wording for the
 * registration URL case (#5490) and the generic invalid-control case, and that nothing shows when
 * Create is enabled.
 */
describe('ImplementationTabComponent create blocked reason', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const reasonEl = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-submit-blocked-reason"]');
  const c = (): Record<string, any> => fixture.componentInstance as unknown as Record<string, any>;

  const seed = (registrationUrl: string): void => {
    fixture.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl,
      includeSearch: true,
      budgetUsd: 500,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      headlines: ['Join us at KubeCon'],
      descriptions: ['Register today for KubeCon EU 2026.'],
    } as unknown as CampaignImplementationDraft);
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl, countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows nothing while Create is enabled', () => {
    seed('https://example.com');

    expect(c()['canSubmit']()).toBe(true);
    expect(c()['createBlockedReason']()).toBeNull();
    expect(reasonEl()).toBeNull();
  });

  it('names the empty Registration URL and the editor that sets it on the brief', () => {
    seed('');

    expect(c()['canSubmit']()).toBe(false);
    expect(reasonEl()?.textContent?.trim()).toBe(
      'Create Campaign is unavailable: Registration URL is empty. Select Edit brief, enter the Registration URL, then Save & Proceed to Implement.'
    );
  });

  it('names the first invalid required control when the Google form is invalid', () => {
    seed('https://example.com');
    c()['campaignForm'].controls.budgetUsd.setValue(0);
    fixture.detectChanges();

    expect(c()['canSubmit']()).toBe(false);
    expect(reasonEl()?.textContent?.trim()).toBe('Create Campaign is unavailable: Google Ads: the daily budget is missing or not valid.');
  });

  it('names an unlisted control from its key', STATE_ONLY, () => {
    seed('https://example.com');
    c()['campaignForm'].controls.eventSlug.setValidators(() => ({ required: true }));
    c()['campaignForm'].controls.eventSlug.updateValueAndValidity();
    fixture.detectChanges();

    expect(c()['createBlockedReason']()).toBe('Google Ads: the event slug field is missing or not valid.');
  });

  it('names the missing Start Date', () => {
    seed('https://example.com');
    c()['campaignForm'].controls.startDate.setValue('');
    fixture.detectChanges();

    expect(reasonEl()?.textContent?.trim()).toBe('Create Campaign is unavailable: Choose a Start Date.');
  });
});

/**
 * campaign-service platform rows whose `error` is one of issue #208's fixed dispatch-failure
 * sentences (`DispatchFailureMessage`). The row must turn a known connection reason into a next
 * step, mark a proven pre-create failure as nothing sent, and keep "could not be confirmed" for
 * everything else.
 */
describe('ImplementationTabComponent dispatch failure reasons', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const atResults = (rows: CampaignPlatformResult[]): HTMLElement => {
    const c = fixture.componentInstance as unknown as {
      platformResults: { set(v: CampaignPlatformResult[]): void };
      step: { set(v: 'results'): void };
    };
    c.platformResults.set(rows);
    c.step.set('results');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const row = (el: HTMLElement, platform: string): HTMLElement => el.querySelector(`[data-testid="implementation-platform-result-${platform}"]`) as HTMLElement;
  const heading = (el: HTMLElement): string => el.querySelector('[data-testid="implementation-platform-results"] h3')?.textContent?.trim() ?? '';
  const notUsable = (provider: string, token: string) =>
    `this project's ${provider} connection cannot be used as configured (reason: ${token}); nothing was sent`;

  it.each([
    ['account_not_selected', "Ask an LFX administrator to choose an ad account on this project's Meta Ads connection, then create again."],
    ['connection_inactive', "Ask an LFX administrator to reactivate this project's Meta Ads connection, then create again."],
    ['credentials_undecodable', "Ask an LFX administrator to reconnect this project's Meta Ads connection to save fresh credentials, then create again."],
    ['credentials_incomplete', "Ask an LFX administrator to reconnect this project's Meta Ads connection to save fresh credentials, then create again."],
    ['credentials_expired', "Ask an LFX administrator to re-authorize this project's Meta Ads connection, then create again."],
  ])('renders the next step for %s in place of the raw reason', (token, step) => {
    const el = row(atResults([{ platform: 'meta-ads', ok: false, error: notUsable('meta-ads', token) }]), 'meta-ads');
    expect(el.querySelector('[data-testid="implementation-platform-result-next-step"]')?.textContent?.trim()).toBe(step);
    expect(el.textContent).not.toContain('(reason:');
    expect(el.textContent).toContain('cannot be used as configured; nothing was sent');
    expect(el.textContent).toContain('not created');
    expect(el.querySelector('[data-testid="implementation-platform-result-nothing-created"]')?.textContent?.trim()).toBe(
      'Nothing was created on the platform.'
    );
    expect(el.textContent).not.toContain('could not be confirmed');
  });

  it('shows an unknown reason token verbatim with no next step', () => {
    const error = notUsable('meta-ads', 'token_request_rejected');
    const el = row(atResults([{ platform: 'meta-ads', ok: false, error }]), 'meta-ads');
    expect(el.textContent).toContain(error);
    expect(el.querySelector('[data-testid="implementation-platform-result-next-step"]')).toBeNull();
  });

  it('keeps "could not be confirmed" for an unconfirmed failure', () => {
    const error = 'meta-ads campaign creation could not be confirmed; something may have been created — verify on the platform before retrying';
    const el = atResults([{ platform: 'meta-ads', ok: false, error }]);
    expect(row(el, 'meta-ads').textContent).toContain('could not be confirmed — check the ad account before creating it again');
    expect(el.querySelector('[data-testid="implementation-platform-result-nothing-created"]')).toBeNull();
    expect(heading(el)).toBe('Campaign Status Unconfirmed');
  });

  it('labels the service-defect sentence as nothing created, with no next step', () => {
    const error = 'meta-ads campaign creation was stopped before anything was sent by a defect in this service; the connection is not at fault';
    const el = row(atResults([{ platform: 'meta-ads', ok: false, error }]), 'meta-ads');
    expect(el.querySelector('[data-testid="implementation-platform-result-nothing-created"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="implementation-platform-result-next-step"]')).toBeNull();
    expect(el.textContent).not.toContain('could not be confirmed');
    // No operator fix exists for a service defect, so the row states the fact and offers no retry advice.
    expect(el.textContent).not.toMatch(/retry|create again/i);
  });

  it('keeps "could not be confirmed" for an unclassified failure and a skip', () => {
    const el = atResults([
      { platform: 'meta-ads', ok: false, error: 'platform campaign creation failed' },
      { platform: 'reddit-ads', ok: false, error: 'skipped: another concurrent dispatch owns this platform' },
    ]);
    expect(row(el, 'meta-ads').textContent).toContain('could not be confirmed');
    expect(row(el, 'reddit-ads').textContent).toContain('could not be confirmed');
  });

  it('keeps an id-bearing row orphaned, with no "create again" step, whatever its message says', () => {
    const el = atResults([{ platform: 'meta-ads', ok: false, campaignId: '123', error: notUsable('meta-ads', 'account_not_selected') }]);
    expect(row(el, 'meta-ads').textContent).toContain('created upstream but not recorded');
    expect(row(el, 'meta-ads').querySelector('[data-testid="implementation-platform-result-next-step"]')).toBeNull();
    expect(row(el, 'meta-ads').querySelector('[data-testid="implementation-platform-result-nothing-created"]')).toBeNull();
    expect(heading(el)).toBe('Campaigns Created');
  });

  it('heads the panel "No Campaigns Created" only when every row is a proven pre-create failure', () => {
    let el = atResults([
      { platform: 'meta-ads', ok: false, error: notUsable('meta-ads', 'account_not_selected') },
      { platform: 'reddit-ads', ok: false, error: 'reddit-ads refused the request (HTTP 400) before anything was created; nothing was created' },
    ]);
    expect(heading(el)).toBe('No Campaigns Created');

    el = atResults([
      { platform: 'meta-ads', ok: false, error: notUsable('meta-ads', 'account_not_selected') },
      { platform: 'reddit-ads', ok: false, error: 'platform campaign creation failed' },
    ]);
    expect(heading(el)).toBe('Campaign Status Unconfirmed');
  });
});
