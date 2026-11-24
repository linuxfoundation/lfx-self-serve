// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * The per-platform Bidding control (#3299): Automatic or Manual max CPC bid on LinkedIn, Meta,
 * Microsoft Ads and Reddit, behind `biddingEnabled` (`LFX_CUTOVER_CAMPAIGN_SERVICE_BIDDING`).
 *
 * Asserted on what `createCampaign` is CALLED with, because the guarantee that matters is the wire
 * shape campaign-service #332 accepts: `bidding` absent while the flag is off, otherwise an explicit
 * object with exactly `strategy` (and `bidAmount` for manual) — never `null`, never `''`.
 */
describe('ImplementationTabComponent bidding control', () => {
  const LANE_CONFIGS = ['linkedInConfig', 'metaConfig', 'microsoftConfig', 'redditConfig'] as const;

  let createCampaign: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['linkedin-ads', 'reddit-ads', 'meta-ads', 'microsoft-ads'],
      structuredCopy: { google_search: { headlines: ['Attend KubeCon'], descriptions: ['Join us in September'] } },
      linkedInCopy: {
        variants: [{ headline: 'Brief headline', introText: 'Brief intro', destinationUrl: 'https://example.com/brief' }],
        recommendedGeoTargets: [{ urn: 'urn:li:geo:103644278', label: 'United States' }],
        recommendedTargetingProfile: 'cloud-native',
      },
      redditCopy: {
        variants: [{ headline: 'Brief reddit headline', destinationUrl: 'https://example.com/brief' }],
        recommendedSubreddits: ['briefsub'],
        recommendedInterests: ['brief-interest'],
        recommendedKeywords: ['brief-keyword'],
        recommendedGeos: ['US'],
      },
      metaCopy: {
        variants: [{ primaryText: 'Brief primary', headline: 'Brief meta headline', description: 'Brief description' }],
        recommendedGeos: ['US'],
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  function component(f: ComponentFixture<ImplementationTabComponent> = fixture): Record<string, any> {
    return f.componentInstance as unknown as Record<string, any>;
  }

  function query(testId: string, f: ComponentFixture<ImplementationTabComponent> = fixture): HTMLElement | null {
    return f.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function mount(
    bidding: boolean | null | undefined,
    draft: CampaignImplementationDraft | null = null
  ): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    if (draft) f.componentRef.setInput('draft', draft);
    if (bidding !== undefined) f.componentRef.setInput('biddingEnabled', bidding);
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    const c = component(f);
    c['selectedPlatforms'].set(['linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads']);
    c['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c['campaignForm'].controls['endDate'].setValue('2026-09-30');
    c['addMicrosoftKeyword']('service mesh');
    f.detectChanges();
    await f.whenStable();
    return f;
  }

  /** Pick a strategy through the control's own form, so the change travels the real `(biddingChange)` binding. */
  async function pickStrategy(platform: string, strategy: 'automatic' | 'manual', f: ComponentFixture<ImplementationTabComponent> = fixture): Promise<void> {
    const host = query(`implementation-bidding-${platform}`, f)?.closest('lfx-campaign-bidding-control');
    expect(host).not.toBeNull();
    const control = f.debugElement.queryAll((el) => el.nativeElement === host)[0].componentInstance;
    control.form.controls.strategy.setValue(strategy);
    f.detectChanges();
    await f.whenStable();
  }

  /** Type a bid into the rendered amount input, as an operator would. */
  async function typeBid(platform: string, value: string, f: ComponentFixture<ImplementationTabComponent> = fixture): Promise<void> {
    const input = query(`implementation-bidding-${platform}-amount`, f)?.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    (input as HTMLInputElement).value = value;
    (input as HTMLInputElement).dispatchEvent(new Event('input'));
    f.detectChanges();
    await f.whenStable();
  }

  async function submitted(f: ComponentFixture<ImplementationTabComponent> = fixture): Promise<Record<string, Record<string, unknown>>> {
    expect(component(f)['canSubmit']()).toBe(true);
    component(f)['submit']();
    await f.whenStable();
    expect(createCampaign).toHaveBeenCalled();
    return createCampaign.mock.calls[createCampaign.mock.calls.length - 1][0];
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));

    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            createCampaign,
            getLinkedInAccounts: () => of([{ accountId: 'urn:li:sponsoredAccount:1', name: 'LF Account', status: 'ACTIVE' }]),
            getLinkedInTargetingProfiles: () => of([]),
          },
        },
      ],
    }).compileComponents();
  });

  describe('with the flag off', () => {
    it.each([
      ['unanswered', undefined],
      ['null', null],
      ['false', false],
    ])('hides the control when the capability is %s', async (_label, bidding) => {
      fixture = await mount(bidding);

      for (const platform of ['linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads']) {
        expect(query(`implementation-bidding-${platform}`)).toBeNull();
      }
      // The legacy Microsoft max CPC field stays exactly as it was.
      expect(query('implementation-microsoft-cpc-bid')).not.toBeNull();
    });

    it('sends no bidding key on any config, so the create is unchanged', STATE_ONLY, async () => {
      fixture = await mount(false);
      component()['microsoftCpcBid'].set('2.5');

      const request = await submitted();

      for (const key of LANE_CONFIGS) {
        expect(request[key]).toBeDefined();
        expect(Object.keys(request[key])).not.toContain('bidding');
      }
      // The legacy field still travels while the control is not offered.
      expect(request['microsoftConfig']['cpcBid']).toBe(2.5);
    });
  });

  /**
   * A Manual choice retained across a tab round-trip while the capability is not an explicit yes
   * (#3299). The control is hidden then and `bidding` is not sent, which campaign-service reads as
   * automatic — so the create must be BLOCKED, never sent without the choice.
   */
  describe('a retained Manual choice while the capability is unknown or off', () => {
    async function manualDraft(platform: 'meta-ads' | 'microsoft-ads' = 'meta-ads'): Promise<CampaignImplementationDraft> {
      let draft: CampaignImplementationDraft | null = null;
      const first = await mount(true);
      first.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (draft = d));
      await pickStrategy(platform, 'manual', first);
      await typeBid(platform, '1', first);
      first.destroy();
      expect(draft).not.toBeNull();
      return draft as unknown as CampaignImplementationDraft;
    }

    async function remount(
      bidding: boolean | null,
      read: 'unknown' | 'pending' | 'ready' | 'failed',
      platform: 'meta-ads' | 'microsoft-ads' = 'meta-ads',
      edit: (d: CampaignImplementationDraft) => CampaignImplementationDraft = (d) => d,
      briefId: string | null = 'brief-1'
    ): Promise<ComponentFixture<ImplementationTabComponent>> {
      const draft = edit(await manualDraft(platform));
      const f = TestBed.createComponent(tabComponentUnderTest());
      f.componentRef.setInput('draft', draft);
      f.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: !!briefId });
      f.componentRef.setInput('biddingEnabled', bidding);
      f.componentRef.setInput('createCapabilityRead', read);
      f.componentRef.setInput('briefData', brief());
      f.detectChanges();
      await f.whenStable();
      const c = component(f);
      c['selectedPlatforms'].set(['linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads']);
      c['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
      c['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
      c['campaignForm'].controls['startDate'].setValue('2026-09-01');
      c['campaignForm'].controls['endDate'].setValue('2026-09-30');
      c['addMicrosoftKeyword']('service mesh');
      f.detectChanges();
      await f.whenStable();
      return f;
    }

    it('blocks Create and says it is checking while the capability read is pending', async () => {
      fixture = await remount(null, 'pending');

      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-bidding-capability-pending')?.textContent).toContain('Checking bidding support…');
      expect(query('implementation-bidding-capability-live')?.textContent?.trim()).toBe('Checking bidding support…');
      component()['submit']();
      expect(createCampaign).not.toHaveBeenCalled();

      // The answer arrives: the control returns with the retained choice, and it is sent.
      fixture.componentRef.setInput('biddingEnabled', true);
      fixture.componentRef.setInput('createCapabilityRead', 'ready');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query('implementation-bidding-capability-live')?.textContent?.trim()).toBe('');
      const request = await submitted();
      expect(request['metaConfig']['bidding']).toEqual({ strategy: 'manual', bidAmount: 1 });
    });

    it('blocks Create with a Retry that asks the parent to re-read when the read failed', async () => {
      fixture = await remount(null, 'failed');
      const retried = vi.fn();
      fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);

      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-bidding-capability-failed')?.textContent).toContain('Could not confirm that manual bidding is supported');
      (query('implementation-bidding-capability-retry')?.querySelector('button') as HTMLButtonElement).click();

      expect(retried).toHaveBeenCalledTimes(1);
      expect(createCampaign).not.toHaveBeenCalled();
    });

    it('blocks Create when the capability is off, until the operator switches to Automatic', async () => {
      fixture = await remount(false, 'ready');

      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-bidding-capability-unsupported')?.textContent).toContain('Meta');

      (query('implementation-bidding-capability-automatic')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query('implementation-bidding-capability-unsupported')).toBeNull();
      expect(component()['biddingDrafts']()['meta-ads']).toEqual({ strategy: 'automatic', bidAmount: 1 });
      const request = await submitted();
      // Off: no bidding key at all — the operator chose automatic, which is what that means.
      expect(Object.keys(request['metaConfig'])).not.toContain('bidding');
    });

    it('lets the operator switch to Automatic while the read is still pending', async () => {
      fixture = await remount(null, 'pending');

      (query('implementation-bidding-capability-automatic')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query('implementation-bidding-capability-pending')).toBeNull();
      expect(component()['canSubmit']()).toBe(true);
    });

    /**
     * A foundation switch (or a list load with no brief id) clears the capability WITHOUT starting a
     * read, leaving `unknown`. "Checking…" would wait forever there, so it is treated like a failed
     * read: Retry starts one, and Switch to Automatic is offered too.
     */
    it('offers Retry and Switch to Automatic when no read is in flight (after a foundation switch)', async () => {
      fixture = await remount(null, 'unknown');
      const retried = vi.fn();
      fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);

      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-bidding-capability-pending')).toBeNull();
      expect(query('implementation-bidding-capability-failed')).not.toBeNull();
      (query('implementation-bidding-capability-retry')?.querySelector('button') as HTMLButtonElement).click();
      expect(retried).toHaveBeenCalledTimes(1);

      (query('implementation-bidding-capability-automatic')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component()['canSubmit']()).toBe(true);
    });

    /**
     * The thread's sequence: a legacy Microsoft max CPC is in the draft beside a retained Manual
     * choice; the capability comes back off; the operator switches to Automatic. Without `bidding`,
     * campaign-service reads a `cpcBid` as MANUAL — so it must not be sent.
     */
    it('sends no Microsoft cpcBid after Switch to Automatic, even with a legacy value in the draft', async () => {
      fixture = await remount(false, 'ready', 'microsoft-ads', (d) => ({ ...d, microsoftCpcBid: '2.5' }));
      expect(query('implementation-bidding-capability-unsupported')).not.toBeNull();

      (query('implementation-bidding-capability-automatic')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component()['microsoftCpcBid']()).toBe('');
      const request = await submitted();
      expect(Object.keys(request['microsoftConfig'])).not.toContain('cpcBid');
      expect(Object.keys(request['microsoftConfig'])).not.toContain('bidding');
    });

    it('never sends a legacy cpcBid beside an explicit Automatic choice, however it got there', async () => {
      // A restored draft that already says Automatic for Microsoft, carrying a stale legacy value.
      fixture = await remount(false, 'ready', 'microsoft-ads', (d) => ({
        ...d,
        microsoftCpcBid: '2.5',
        bidding: { ...d.bidding, 'microsoft-ads': { strategy: 'automatic', bidAmount: 1 } },
      }));

      const request = await submitted();

      expect(Object.keys(request['microsoftConfig'])).not.toContain('cpcBid');
    });

    it('lets a bid typed into the legacy field win over an earlier Automatic', async () => {
      fixture = await remount(false, 'ready', 'microsoft-ads', (d) => ({
        ...d,
        bidding: { ...d.bidding, 'microsoft-ads': { strategy: 'automatic', bidAmount: 1 } },
      }));
      const input = query('implementation-microsoft-cpc-bid') as HTMLInputElement;
      input.value = '3';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const request = await submitted();

      expect(request['microsoftConfig']['cpcBid']).toBe(3);
    });

    /**
     * With no brief id there is nothing to read against: the parent's read returns at once, so a
     * Retry would do nothing. Saving the brief starts the read, so the banner asks for that instead.
     */
    it.each(['unknown', 'failed'] as const)('asks to save the brief, and offers no Retry, when %s with no brief id', async (read) => {
      fixture = await remount(null, read, 'meta-ads', (d) => d, null);

      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-bidding-capability-unsaved')?.textContent).toContain(
        "Bidding support can't be checked until this brief is saved. Save the brief, or switch to Automatic."
      );
      expect(query('implementation-bidding-capability-retry')).toBeNull();
      expect(query('implementation-bidding-capability-automatic')).not.toBeNull();
    });

    /**
     * The thread's sequence: the capability is unanswered, so the legacy Microsoft field shows and
     * the operator types a bid into it; then the capability resolves to true and the legacy field
     * hides. The bid must carry into the control as Manual — not vanish and be sent as Automatic.
     */
    it('carries a legacy Microsoft bid into the control as Manual when the capability turns true', async () => {
      fixture = await mount(null);
      const input = query('implementation-microsoft-cpc-bid') as HTMLInputElement;
      input.value = '2.5';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      fixture.componentRef.setInput('biddingEnabled', true);
      fixture.componentRef.setInput('createCapabilityRead', 'ready');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query('implementation-microsoft-cpc-bid')).toBeNull();
      expect(component()['biddingDrafts']()['microsoft-ads']).toEqual({ strategy: 'manual', bidAmount: 2.5 });
      expect(component()['microsoftCpcBid']()).toBe('');
      expect((query('implementation-bidding-microsoft-ads-amount')?.querySelector('input') as HTMLInputElement).value).toBe('2.5');
      const request = await submitted();
      expect(request['microsoftConfig']['bidding']).toEqual({ strategy: 'manual', bidAmount: 2.5 });
      expect(Object.keys(request['microsoftConfig'])).not.toContain('cpcBid');
    });

    it('leaves an explicit Microsoft choice alone when the capability turns true', async () => {
      fixture = await remount(null, 'unknown', 'microsoft-ads', (d) => ({
        ...d,
        microsoftCpcBid: '2.5',
        bidding: { ...d.bidding, 'microsoft-ads': { strategy: 'automatic', bidAmount: null } },
      }));

      fixture.componentRef.setInput('biddingEnabled', true);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component()['biddingDrafts']()['microsoft-ads']).toEqual({ strategy: 'automatic', bidAmount: null });
      const request = await submitted();
      expect(request['microsoftConfig']['bidding']).toEqual({ strategy: 'automatic' });
      expect(Object.keys(request['microsoftConfig'])).not.toContain('cpcBid');
    });

    it('never renders Retry while a read is in flight either', async () => {
      fixture = await remount(null, 'pending');

      expect(query('implementation-bidding-capability-retry')).toBeNull();
    });

    it('does not block a retained Manual choice on a platform that is not selected', async () => {
      fixture = await remount(null, 'pending');
      component()['selectedPlatforms'].set(['linkedin-ads']);
      fixture.detectChanges();

      expect(query('implementation-bidding-capability-pending')).toBeNull();
      expect(component()['canSubmit']()).toBe(true);
    });
  });

  describe('with the flag on', () => {
    beforeEach(async () => {
      fixture = await mount(true);
    });

    it('renders a control per supported platform, defaulting to Automatic', () => {
      for (const platform of ['linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads']) {
        expect(query(`implementation-bidding-${platform}`)).not.toBeNull();
        // Automatic is the default, so the bid input is not shown.
        expect(query(`implementation-bidding-${platform}-amount`)).toBeNull();
        expect(component()['biddingViews']()[platform].value).toEqual({ strategy: 'automatic', bidAmount: null });
      }
      expect(query('implementation-bidding-google-ads')).toBeNull();
    });

    it('labels the strategy group and names the currency per platform', async () => {
      expect(query('implementation-bidding-linkedin-ads')?.querySelector('legend')?.textContent?.trim()).toBe('Bidding');

      await pickStrategy('linkedin-ads', 'manual');
      await pickStrategy('meta-ads', 'manual');

      expect(query('implementation-bidding-linkedin-ads-currency')?.textContent).toContain('USD');
      expect(query('implementation-bidding-meta-ads-currency')?.textContent).toContain("ad account's currency");
      expect(query('implementation-bidding-meta-ads-limit')?.textContent).toContain('5×');
      const label = fixture.nativeElement.querySelector('label[for="campaign-bidding-linkedin-ads-amount"]') as HTMLLabelElement | null;
      expect(label?.textContent).toContain('USD');
    });

    it('hides the legacy Microsoft max CPC field and never sends cpcBid beside bidding', async () => {
      expect(query('implementation-microsoft-cpc-bid')).toBeNull();
      // A stale legacy value (a restored draft) neither blocks the create nor reaches the wire.
      component()['microsoftCpcBid'].set('5000');
      fixture.detectChanges();

      const request = await submitted();

      expect(Object.keys(request['microsoftConfig'])).not.toContain('cpcBid');
    });

    it('sends an explicit automatic strategy, and nothing else, on every config by default', STATE_ONLY, async () => {
      const request = await submitted();

      for (const key of LANE_CONFIGS) {
        expect(request[key]['bidding']).toEqual({ strategy: 'automatic' });
        expect(Object.keys(request[key]['bidding'] as object)).toEqual(['strategy']);
      }
      expect(request['googleAdsConfig']).toBeUndefined();
    });

    /** A live brief switch (#4624): a manual bid typed for one event must not become the next's, on any lane. */
    it('drops every per-platform bidding choice when a different brief is handed over', async () => {
      const held: { draft: CampaignImplementationDraft | null } = { draft: null };
      fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (held.draft = d));
      const platforms = ['linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads'];
      for (const platform of platforms) {
        await pickStrategy(platform, 'manual');
        await typeBid(platform, '1.5');
      }
      for (const platform of platforms) expect((held.draft?.bidding as Record<string, { strategy: string }> | undefined)?.[platform]?.strategy).toBe('manual');

      fixture.componentRef.setInput('draft', null);
      fixture.componentRef.setInput('briefData', { ...brief(), eventDetails: { ...brief().eventDetails, name: 'Open Source Summit', slug: 'oss-na-2026' } });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(held.draft?.eventSlug).toBe('oss-na-2026');
      expect(held.draft?.bidding).toEqual({});
      const c = component();
      c['selectedPlatforms'].set(platforms);
      c['addMicrosoftKeyword']('service mesh');
      fixture.detectChanges();
      for (const platform of platforms) {
        expect(c['biddingViews']()[platform].value).toEqual({ strategy: 'automatic', bidAmount: null });
        expect(query(`implementation-bidding-${platform}-amount`)).toBeNull();
      }
      const request = await submitted();
      for (const key of LANE_CONFIGS) expect(request[key]['bidding']).toEqual({ strategy: 'automatic' });
    });

    it('sends a manual bid exactly as typed', async () => {
      await pickStrategy('linkedin-ads', 'manual');
      await typeBid('linkedin-ads', '2.5');

      const request = await submitted();

      expect(request['linkedInConfig']['bidding']).toEqual({ strategy: 'manual', bidAmount: 2.5 });
      expect(request['metaConfig']['bidding']).toEqual({ strategy: 'automatic' });
    });

    it('never puts null or an empty string on the wire', async () => {
      await pickStrategy('microsoft-ads', 'manual');
      await typeBid('microsoft-ads', '1.25');
      await pickStrategy('reddit-ads', 'manual');
      component()['redditObjective'].set('traffic');
      await typeBid('reddit-ads', '0.75');
      // Picked and then put back: the typed amount must not travel with automatic.
      await pickStrategy('meta-ads', 'manual');
      await typeBid('meta-ads', '1');
      await pickStrategy('meta-ads', 'automatic');

      const request = await submitted();

      for (const key of LANE_CONFIGS) {
        const bidding = request[key]['bidding'] as Record<string, unknown>;
        expect(bidding).not.toBeNull();
        for (const [field, value] of Object.entries(bidding)) {
          expect(['strategy', 'bidAmount']).toContain(field);
          expect(value).not.toBeNull();
          expect(value).not.toBe('');
        }
      }
      expect(request['metaConfig']['bidding']).toEqual({ strategy: 'automatic' });
      expect(request['microsoftConfig']['bidding']).toEqual({ strategy: 'manual', bidAmount: 1.25 });
      expect(request['redditConfig']['bidding']).toEqual({ strategy: 'manual', bidAmount: 0.75 });
    });

    it('blocks the create while a manual choice has no bid, and says why', async () => {
      await pickStrategy('linkedin-ads', 'manual');

      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-bidding-linkedin-ads-error')?.textContent).toContain('Enter a max CPC bid');
      const input = query('implementation-bidding-linkedin-ads-amount')?.querySelector('input');
      expect(input?.getAttribute('aria-invalid')).toBe('true');
      expect(input?.getAttribute('aria-describedby')).toContain('campaign-bidding-linkedin-ads-error');

      await typeBid('linkedin-ads', '3');

      expect(component()['canSubmit']()).toBe(true);
      expect(query('implementation-bidding-linkedin-ads-error')).toBeNull();
    });

    it.each([
      ['linkedin-ads', '2.345', 'two decimal places'],
      ['microsoft-ads', '1000.01', 'at most 1,000'],
      ['meta-ads', '0.125', 'two decimal places'],
    ])('refuses a %s bid of %s', async (platform, bid, message) => {
      await pickStrategy(platform, 'manual');
      await typeBid(platform, bid);

      expect(component()['canSubmit']()).toBe(false);
      expect(query(`implementation-bidding-${platform}-error`)?.textContent).toContain(message);
    });

    it('refuses manual Meta under an objective without link clicks, and accepts it under traffic', async () => {
      await pickStrategy('meta-ads', 'manual');
      await typeBid('meta-ads', '1');
      component()['metaObjective'].set('awareness');
      fixture.detectChanges();

      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-bidding-meta-ads-error')?.textContent).toContain('Traffic or Leads');

      component()['metaObjective'].set('traffic');
      fixture.detectChanges();

      expect(component()['canSubmit']()).toBe(true);
    });

    it('refuses a Meta bid above a fifth of the daily budget, but not under a lifetime budget', async () => {
      component()['metaBudgetUsd'].set(10);
      await pickStrategy('meta-ads', 'manual');
      await typeBid('meta-ads', '2.01');

      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-bidding-meta-ads-error')?.textContent).toContain('at least 5× the bid');

      component()['metaLifetimeBudget'].set(true);
      fixture.detectChanges();

      expect(component()['canSubmit']()).toBe(true);
    });

    it('refuses manual Reddit under the default conversions objective, and accepts it under traffic', async () => {
      await pickStrategy('reddit-ads', 'manual');
      await typeBid('reddit-ads', '0.5');

      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-bidding-reddit-ads-error')?.textContent).toContain('needs the Traffic objective');

      component()['redditObjective'].set('traffic');
      fixture.detectChanges();

      expect(component()['canSubmit']()).toBe(true);
    });

    it('keeps the choice through a tab round-trip and sends it from the remount', async () => {
      let draft: CampaignImplementationDraft | null = null;
      fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (draft = d));
      await pickStrategy('linkedin-ads', 'manual');
      await typeBid('linkedin-ads', '3.5');
      fixture.destroy();

      expect(draft).not.toBeNull();
      expect((draft as unknown as CampaignImplementationDraft).bidding?.['linkedin-ads']).toEqual({ strategy: 'manual', bidAmount: 3.5 });

      const restored = await mount(true, draft);

      // The remounted control shows the restored choice, not the default.
      expect(query('implementation-bidding-linkedin-ads-amount', restored)?.querySelector('input')?.value).toBe('3.5');
      const request = await submitted(restored);
      expect(request['linkedInConfig']['bidding']).toEqual({ strategy: 'manual', bidAmount: 3.5 });
    });
  });
});

/**
 * #4784. Performance Max was the one Google channel whose copy a person still had to write, though
 * the brief already holds copy of the right shape. The seed fills headlines, long headlines,
 * descriptions and the business name from the generated Search and Demand Gen copy, each within its
 * own catalogue bounds, and the draft restore still wins over it.
 */
describe('ImplementationTabComponent performance max prefill', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const longText = (n: number): string => 'x'.repeat(n);

  function brief(structuredCopy: Record<string, unknown> | undefined): CampaignBriefOutput {
    return {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/kubecon', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      structuredCopy,
    } as unknown as CampaignBriefOutput;
  }

  function seed(b: CampaignBriefOutput, draft?: CampaignImplementationDraft): void {
    if (draft !== undefined) fixture.componentRef.setInput('draft', draft);
    fixture.componentRef.setInput('briefData', b);
    fixture.detectChanges();
  }

  function pmax(): Record<string, string> {
    return (fixture.componentInstance as unknown as Record<string, any>)['campaignForm'].controls['performanceMaxCreative'].getRawValue();
  }

  function lines(value: string): string[] {
    return value === '' ? [] : value.split('\n');
  }

  function prefilled(): boolean {
    return (
      (fixture.componentInstance as unknown as { googleCreativePrefillShown(): Record<string, boolean> }).googleCreativePrefillShown()['performance-max'] ===
      true
    );
  }

  const generated = {
    google_search: {
      headlines: ['Join KubeCon EU', 'Cloud native in Amsterdam', 'Register for KubeCon'],
      descriptions: [
        'Three days of talks, workshops and the hallway track with the cloud native community.',
        'Meet the maintainers and end users of the CNCF projects you run in production.',
      ],
    },
    google_display: {
      headlines: ['KubeCon EU 2026 in Amsterdam', 'Where cloud native meets'],
      descriptions: ['Register now for KubeCon EU 2026.'],
      business_name: 'CNCF',
    },
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

  it('fills headlines, long headlines, descriptions and the business name from the brief', STATE_ONLY, () => {
    seed(brief(generated));

    expect(lines(pmax()['headlines'])).toEqual(generated.google_search.headlines);
    expect(lines(pmax()['longHeadlines'])).toEqual(generated.google_display.headlines);
    expect(lines(pmax()['descriptions'])).toEqual([...generated.google_search.descriptions, ...generated.google_display.descriptions]);
    expect(pmax()['businessName']).toBe('CNCF');
    expect(prefilled()).toBe(true);
  });

  it('keeps every value within its field bounds: width, count and duplicates', STATE_ONLY, () => {
    // The duplicate sits INSIDE the 15-entry cap, so it is the de-duplication that keeps it out,
    // not the cap.
    const headlines = [longText(31), 'Headline 0', 'Headline 0', ...Array.from({ length: 19 }, (_, i) => `Headline ${i + 1}`)];
    seed(brief({ google_search: { headlines, descriptions: [] }, google_display: { business_name: longText(26) } }));

    const seeded = lines(pmax()['headlines']);
    expect(seeded).toHaveLength(15);
    expect(seeded).not.toContain(longText(31));
    expect(new Set(seeded).size).toBe(seeded.length);
    expect(pmax()['businessName']).toBe('');
  });

  it('keeps one description short enough for the short slot when the brief has one', STATE_ONLY, () => {
    const wordy = Array.from({ length: 5 }, (_, i) => `${longText(70)} ${i}`);
    seed(brief({ google_search: { headlines: [], descriptions: wordy }, google_display: { descriptions: ['Register today.'] } }));

    const seeded = lines(pmax()['descriptions']);
    expect(seeded).toHaveLength(5);
    expect(seeded).toContain('Register today.');
  });

  /**
   * Short by Google's display width, as campaign-service's rule counts it (#5219): 31 ideographs are
   * 31 characters but 62 wide, so the prefill must not swap one in as the short description.
   */
  it('does not take a CJK description as short when its display width is over 60', STATE_ONLY, () => {
    const wordy = Array.from({ length: 5 }, (_, i) => `${longText(70)} ${i}`);
    const cjk = '会'.repeat(31);
    seed(brief({ google_search: { headlines: [], descriptions: wordy }, google_display: { descriptions: [cjk] } }));

    expect(lines(pmax()['descriptions'])).not.toContain(cjk);
  });

  /** The prefill holds each value to its field's display width, so a 46-ideograph description — 92 wide — is not seeded. */
  it('does not seed a description wider than 90 by display width', STATE_ONLY, () => {
    const cjk = '会'.repeat(46);
    seed(brief({ google_search: { headlines: [], descriptions: [cjk, 'Register today.'] } }));

    expect(lines(pmax()['descriptions'])).toEqual(['Register today.']);
  });

  it('seeds from the older demand_gen key too', STATE_ONLY, () => {
    seed(brief({ demand_gen: { headlines: ['Legacy long headline'], business_name: 'CNCF' } }));

    expect(lines(pmax()['longHeadlines'])).toEqual(['Legacy long headline']);
    expect(pmax()['businessName']).toBe('CNCF');
  });

  it('leaves the creative empty, with no prefill notice, when the brief has no generated copy', STATE_ONLY, () => {
    seed(brief(undefined));

    expect(pmax()['headlines']).toBe('');
    expect(pmax()['businessName']).toBe('');
    expect(prefilled()).toBe(false);
  });

  it('lets a restored draft win over the seed', STATE_ONLY, () => {
    const draft = {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://events.example.com/kubecon',
      headlines: [''],
      descriptions: [''],
      // The whole group, as `emitDraft` snapshots it: every field is the operator's.
      googleCreatives: {
        performanceMaxCreative: {
          headlines: 'Operator headline',
          longHeadlines: 'Operator long headline',
          descriptions: 'Operator description',
          businessName: 'Operator Co',
        },
      },
    } as unknown as CampaignImplementationDraft;
    seed(brief(generated), draft);

    expect(pmax()['headlines']).toBe('Operator headline');
    expect(pmax()['businessName']).toBe('Operator Co');
    // The operator's copy is not the brief's, so the notice must not claim it is.
    expect(prefilled()).toBe(false);
  });

  /** A draft as the parent holds it, with the given Performance Max fields. */
  function draftWith(performanceMaxCreative: Record<string, string>): CampaignImplementationDraft {
    return {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://events.example.com/kubecon',
      headlines: [''],
      descriptions: [''],
      googleCreatives: { performanceMaxCreative },
    } as unknown as CampaignImplementationDraft;
  }

  it('drops the notice when a restored draft cleared the copy, as the notice invites', STATE_ONLY, () => {
    seed(brief(generated), draftWith({ headlines: '', longHeadlines: '', descriptions: '', businessName: '' }));

    expect(pmax()['headlines']).toBe('');
    expect(prefilled()).toBe(false);
  });

  it('keeps the notice across a round trip that restores the seeded copy unchanged', STATE_ONLY, () => {
    seed(brief(generated));
    const seeded = { ...pmax() };
    fixture.componentRef.setInput('briefData', null);
    fixture.detectChanges();

    seed(brief(generated), draftWith(seeded));

    expect(prefilled()).toBe(true);
  });

  it('drops the notice once the operator rewrites the seeded copy', STATE_ONLY, () => {
    seed(brief(generated));
    const group = (fixture.componentInstance as unknown as Record<string, any>)['campaignForm'].controls['performanceMaxCreative'];
    group.patchValue({ headlines: 'Mine', longHeadlines: 'Mine too', descriptions: 'Mine as well', businessName: 'Mine Co' });

    expect(prefilled()).toBe(false);
  });

  it('folds a line break inside one generated value into a space', STATE_ONLY, () => {
    seed(brief({ google_search: { headlines: ['Join\nKubeCon EU'], descriptions: [] } }));

    expect(lines(pmax()['headlines'])).toEqual(['Join KubeCon EU']);
  });

  it('reads copy nested under platforms, for Search and Performance Max alike', STATE_ONLY, () => {
    seed(
      brief({
        platforms: { google_search: { headlines: ['Nested headline'], descriptions: ['Nested description'] }, google_display: { business_name: 'CNCF' } },
      })
    );

    const searchHeadlines = (fixture.componentInstance as unknown as Record<string, any>)['campaignForm'].controls['headlines'].getRawValue();
    expect(searchHeadlines).toEqual(['Nested headline']);
    expect(lines(pmax()['headlines'])).toEqual(['Nested headline']);
    expect(pmax()['businessName']).toBe('CNCF');
  });

  it('clears the prefill when a brief without copy replaces one with it', STATE_ONLY, () => {
    seed(brief(generated));
    seed(brief(undefined));

    expect(pmax()['headlines']).toBe('');
    expect(prefilled()).toBe(false);
  });

  it('shows the prefill notice on the Performance Max section when the copy came from the brief', () => {
    fixture.componentRef.setInput('googleChannelsEnabled', true);
    fixture.componentRef.setInput('googleCreativeEnabled', true);
    seed(brief(generated));
    (fixture.componentInstance as unknown as Record<string, any>)['campaignForm'].patchValue({ includeSearch: false, includePerformanceMax: true });
    fixture.detectChanges();

    const notice = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-creative-prefill-notice-performance-max"]');
    expect(notice?.textContent).toContain('filled in from the brief');
  });
});
