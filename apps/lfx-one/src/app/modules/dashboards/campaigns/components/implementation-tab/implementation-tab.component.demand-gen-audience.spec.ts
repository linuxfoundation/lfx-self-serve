// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { CampaignImplementationDraft, GoogleAdsAudiencesResult, ProjectContext } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
  configureGoogleTab,
  restoreGoogleDraft,
  seedChannel,
  stubCreativeLibraryUpload,
  STATE_ONLY,
  tabComponentUnderTest,
  trackStateOnlyTests,
} from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * The Demand Gen audience picker (#5244): one Google Ads Audience for the single ad group, or one per
 * named group, read from the account only for a caller the route admits, and judged on Create as
 * campaign-service judges it.
 */
describe('ImplementationTabComponent demand gen audience', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const ACCOUNT = '1234567890';
  const AUDIENCE_A = `customers/${ACCOUNT}/audiences/111`;
  const AUDIENCE_B = `customers/${ACCOUNT}/audiences/222`;
  const AUDIENCES: GoogleAdsAudiencesResult = {
    accountId: ACCOUNT,
    audiences: [
      { resourceName: AUDIENCE_A, id: '111', name: 'Example Summit - High Intent', description: null },
      { resourceName: AUDIENCE_B, id: '222', name: 'Example Summit - Registrants', description: 'CRM list' },
    ],
    truncated: false,
  };
  const IMAGE_COMPLETE = {
    headlines: 'One headline',
    descriptions: 'A description',
    businessName: 'Acme',
    logoImages: 'https://example.com/logo.png',
    marketingImages: 'https://example.com/a.png',
  };
  let read: ReturnType<typeof vi.fn>;

  async function setup(answer: () => unknown = () => of(AUDIENCES)): Promise<void> {
    await configureGoogleTab();
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    read = vi.fn(answer);
    vi.spyOn(TestBed.inject(CampaignService), 'getGoogleAdsAudiences').mockImplementation(read as never);
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Demand Gen with a complete image ad, and the per-caller capability. */
  function seedDemandGen(enabled: boolean | null = true, f: ComponentFixture<ImplementationTabComponent> = fixture): Record<string, any> {
    const c = seedChannel(f, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    f.componentRef.setInput('googleDemandGenAudienceEnabled', enabled);
    f.detectChanges();
    return c;
  }

  /** Split into named groups, each with a complete image ad. */
  function split(c: Record<string, any>, names: string[]): void {
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    c['onDemandGenAdGroupsSplitChange']();
    for (let i = 1; i < names.length; i++) c['addDemandGenAdGroup']();
    names.forEach((name, i) => {
      const controls = c['campaignForm'].controls.demandGenAdGroups.at(i).controls;
      controls.name.setValue(name);
      controls.creative.patchValue(IMAGE_COMPLETE);
    });
    fixture.detectChanges();
  }

  async function requestOf(c: Record<string, any>, f: ComponentFixture<ImplementationTabComponent> = fixture): Promise<Record<string, unknown>> {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    createCampaign.mockClear();
    f.detectChanges();
    expect(c['canSubmit']()).toBe(true);
    c['submit']();
    await f.whenStable();
    return createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
  }

  it('reads nothing and shows nothing for a caller the route would not admit, or off Demand Gen', async () => {
    await setup();
    seedDemandGen(false);
    expect(read).not.toHaveBeenCalled();
    expect(query('implementation-demand-gen-audience-single')).toBeNull();
    expect(query('implementation-google-audience-picker-live')?.textContent?.trim()).toBe('');

    seedDemandGen(null);
    expect(read).not.toHaveBeenCalled();

    seedChannel(fixture, { includeDisplay: true });
    fixture.componentRef.setInput('googleDemandGenAudienceEnabled', true);
    fixture.detectChanges();
    expect(read).not.toHaveBeenCalled();
  });

  it('offers the Audiences, shows a pick by name with Remove, and sends it for the single ad group', async () => {
    await setup();
    const c = seedDemandGen();
    expect(read).toHaveBeenCalledWith('tlf');
    expect(query('implementation-demand-gen-audience-picker-single')).not.toBeNull();

    c['onDemandGenAudiencePicked'](null, AUDIENCE_B);
    fixture.detectChanges();
    expect(query('implementation-demand-gen-audience-picker-single')).toBeNull();
    expect(query('implementation-demand-gen-audience-picked-single')?.textContent).toContain('Example Summit - Registrants');
    expect(query('implementation-demand-gen-audience-remove-single')?.getAttribute('aria-label')).toBe('Remove Example Summit - Registrants');
    expect(c['googleDemandGenAudiencePayload']()).toEqual({ demandGenAudience: AUDIENCE_B });

    c['removeDemandGenAudience'](null);
    fixture.detectChanges();
    expect(query('implementation-demand-gen-audience-picker-single')).not.toBeNull();
    expect(c['googleDemandGenAudiencePayload']()).toEqual({});

    c['onDemandGenAudiencePicked'](null, AUDIENCE_A);
    expect((await requestOf(c))['demandGenAudience']).toBe(AUDIENCE_A);
  });

  it('picks through the combobox itself', async () => {
    await setup();
    const c = seedDemandGen();
    const combobox = fixture.debugElement.query(By.css('[data-testid="implementation-demand-gen-audience-picker-single"]'))
      .componentInstance as UiComboboxComponent;
    (combobox as unknown as { select(option: { value: string; label: string }): void }).select({ value: AUDIENCE_A, label: 'x' });
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenAudience.value).toBe(AUDIENCE_A);
  });

  it("moves focus to the picked Audience's Remove button, and back to the picker on Remove", async () => {
    await setup();
    const focused: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    const c = seedDemandGen();

    c['onDemandGenAudiencePicked'](null, AUDIENCE_A);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(focused).toEqual([query('implementation-demand-gen-audience-remove-single')]);

    c['removeDemandGenAudience'](null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(focused[1]).toBe(query('implementation-demand-gen-audience-picker-single')?.querySelector('input'));
  });

  it('offers one picker per named group and sends each pick on its own group', async () => {
    await setup();
    const c = seedDemandGen();
    split(c, ['Retargeting', 'Prospecting']);
    expect(query('implementation-demand-gen-audience-picker-0')).not.toBeNull();
    expect(query('implementation-demand-gen-audience-picker-1')).not.toBeNull();
    expect(query('implementation-demand-gen-audience-single')).toBeNull();

    c['onDemandGenAudiencePicked'](1, AUDIENCE_A);
    const groups = (await requestOf(c))['demandGenAdGroups'] as Record<string, unknown>[];
    expect(groups[0]).not.toHaveProperty('audience');
    expect(groups[1]['audience']).toBe(AUDIENCE_A);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('holds the single ad group audience while split, and the group audiences while not, saying so', async () => {
    await setup();
    const c = seedDemandGen();
    c['onDemandGenAudiencePicked'](null, AUDIENCE_A);
    split(c, ['Retargeting']);

    expect(query('implementation-demand-gen-audience-held')?.textContent).toContain('kept but not sent while the campaign is split');
    expect(query('implementation-demand-gen-audience-held-live')?.textContent).toContain('kept but not sent while the campaign is split');
    expect(c['googleDemandGenAudiencePayload']()).toEqual({});

    // A group holding only its audience is entered, so turning the split off says it is kept.
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.name.setValue('');
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.creative.reset();
    c['onDemandGenAudiencePicked'](0, AUDIENCE_B);
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(false);
    fixture.detectChanges();
    expect(query('implementation-demand-gen-audience-held')).toBeNull();
    expect(query('implementation-demand-gen-ad-groups-held')?.textContent).toContain('ad group you entered is kept but not sent');
    const request = await requestOf(c);
    expect(request['demandGenAudience']).toBe(AUDIENCE_A);
    expect(request).not.toHaveProperty('demandGenAdGroups');
  });

  it.each([
    ['the single ad group', false],
    ['named ad groups', true],
  ])('sends a byte-identical request for %s when no audience is picked', STATE_ONLY, async (_label, splitOn) => {
    await setup();
    const before = seedDemandGen(false);
    if (splitOn) split(before, ['Retargeting']);
    const without = JSON.stringify(await requestOf(before));

    const other = TestBed.createComponent(tabComponentUnderTest());
    other.detectChanges();
    await other.whenStable();
    const after = seedDemandGen(true, other);
    if (splitOn) {
      after['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
      after['onDemandGenAdGroupsSplitChange']();
      after['campaignForm'].controls.demandGenAdGroups.at(0).controls.name.setValue('Retargeting');
      after['campaignForm'].controls.demandGenAdGroups.at(0).controls.creative.patchValue(IMAGE_COMPLETE);
    }

    expect(JSON.stringify(await requestOf(after, other))).toBe(without);
    expect(without).not.toContain('udience');
  });

  it.each([
    ['a malformed resource name', true, 'customers/1234567890/userLists/111', 'is not a Google Ads Audience resource name'],
    ["another account's Audience", true, 'customers/999/audiences/111', 'belongs to another Google Ads account'],
  ])('holds Create, with the reason shown and announced, for %s', async (_label, enabled, value, reason) => {
    await setup();
    const c = seedDemandGen(enabled);
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenAudience: value });
    fixture.componentRef.setInput('googleDemandGenAudienceEnabled', enabled);
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();

    expect(c['canSubmit']()).toBe(false);
    expect(query('implementation-demand-gen-audience-error')?.textContent).toContain(reason);
    expect(query('implementation-demand-gen-audience-error-live')?.textContent).toContain(reason);
    // The held value is shown with Remove, so it can be taken out.
    expect(query('implementation-demand-gen-audience-remove-single')).not.toBeNull();

    c['removeDemandGenAudience'](null);
    fixture.detectChanges();
    expect(c['demandGenAudienceError']()).toBeNull();
  });

  /**
   * A retained audience the request cannot carry (#5244), on the audience segments' terms: held with a
   * pending line or a Retry while the per-caller answer is out, the restricted block only on an explicit
   * no, and the deployment named while the cutover is dark. Never dropped, and Remove in every state.
   */
  function holdAudience(
    enabled: boolean | null,
    read: 'pending' | 'ready' | 'failed' | 'unknown',
    briefId: string | null = 'brief-1',
    creative: boolean | null = true
  ): Record<string, any> {
    const c = seedDemandGen(enabled);
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenAudience: AUDIENCE_A });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: !!briefId });
    fixture.componentRef.setInput('createCapabilityRead', read);
    fixture.componentRef.setInput('googleDemandGenAudienceEnabled', enabled);
    fixture.componentRef.setInput('googleCreativeEnabled', creative);
    fixture.detectChanges();
    return c;
  }

  const DENIAL = 'Only the LF marketing team can target a Google Ads Audience on Demand Gen';

  it('holds Create with a pending line, not the denial, while the per-caller answer is being read', async () => {
    await setup();
    const c = holdAudience(null, 'pending');

    expect(c['demandGenAudienceBlock']()?.kind).toBe('pending');
    expect(query('implementation-demand-gen-audience-block-pending')?.textContent).toContain('Checking whether you can send Demand Gen audiences');
    expect(query('implementation-demand-gen-audience-block-live')?.textContent?.trim()).toBe(c['demandGenAudienceBlockMessage']());
    expect(fixture.nativeElement.textContent).not.toContain(DENIAL);
    expect(c['demandGenAudienceError']()).toBeNull();
    expect(query('implementation-demand-gen-audience-block-retry')).toBeNull();
    expect(c['canSubmit']()).toBe(false);
  });

  it.each([['failed'], ['unknown'], ['ready']])('offers a Retry, not the denial, when the read is %s and the answer is still out', async (read) => {
    await setup();
    const retried = vi.fn();
    fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
    const c = holdAudience(null, read as 'failed' | 'unknown' | 'ready');

    expect(c['demandGenAudienceBlock']()?.kind).toBe('failed');
    expect(fixture.nativeElement.textContent).not.toContain(DENIAL);
    expect(c['canSubmit']()).toBe(false);
    (query('implementation-demand-gen-audience-block-retry')?.querySelector('button') as HTMLButtonElement).click();
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it.each([['pending'], ['failed']])(
    'keeps the block, with Retry and Remove, while the Demand Gen capability is unanswered and the read is %s',
    async (read) => {
      await setup();
      const c = holdAudience(null, read as 'pending' | 'failed');
      fixture.componentRef.setInput('demandGenEnabled', null);
      fixture.detectChanges();

      // `selectedGoogleChannels()` drops Demand Gen here, and the checkbox is hidden; the block must not follow it.
      expect(c['selectedGoogleChannels']()).not.toContain('demand-gen');
      expect(query('implementation-include-demand-gen')).toBeNull();
      expect(c['demandGenAudienceBlock']()?.kind).toBe(read);
      expect(c['canSubmit']()).toBe(false);
      expect(query('implementation-demand-gen-audience-block-remove')).not.toBeNull();
      expect(query('implementation-demand-gen-audience-block-retry') !== null).toBe(read === 'failed');
    }
  );

  it('moves focus to the Search checkbox on Remove all while the Demand Gen checkbox is hidden and Create is disabled', async () => {
    await setup();
    const focused: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    const c = holdAudience(null, 'failed');
    fixture.componentRef.setInput('demandGenEnabled', null);
    fixture.detectChanges();

    (query('implementation-demand-gen-audience-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(c['demandGenAudienceBlock']()).toBeNull();
    expect(focused.at(-1)).toBe(query('implementation-include-search'));
  });

  it('clears the block only when the Demand Gen capability is answered no, which drops the channel', STATE_ONLY, async () => {
    await setup();
    const c = holdAudience(null, 'failed');
    fixture.componentRef.setInput('demandGenEnabled', false);
    fixture.detectChanges();

    expect(c['demandGenAudienceBlock']()).toBeNull();
  });

  it('asks for the brief to be saved when there is no brief to check against', async () => {
    await setup();
    const c = holdAudience(null, 'unknown', null);

    expect(c['demandGenAudienceBlock']()?.kind).toBe('unsaved');
    expect(query('implementation-demand-gen-audience-block-retry')).toBeNull();
  });

  it('holds Create with the restricted block on an explicit no, and Remove clears it', async () => {
    await setup();
    const c = holdAudience(false, 'ready');

    expect(c['demandGenAudienceBlock']()?.kind).toBe('restricted');
    expect(query('implementation-demand-gen-audience-block-restricted')?.textContent).toContain(DENIAL);
    expect(query('implementation-demand-gen-audience-block-retry')).toBeNull();
    // The section is on screen, so the held value shows there with its own Remove, not again in the block.
    expect(query('implementation-demand-gen-audience-remove-single')).not.toBeNull();
    expect(query('implementation-demand-gen-audience-block-list')).toBeNull();
    expect(c['canSubmit']()).toBe(false);

    (query('implementation-demand-gen-audience-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenAudience.value).toBe('');
    expect(c['demandGenAudienceBlock']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('clears the block once the caller is answered yes on a deployment the cutover serves', async () => {
    await setup();
    const c = holdAudience(null, 'pending');
    fixture.componentRef.setInput('createCapabilityRead', 'ready');
    fixture.componentRef.setInput('googleDemandGenAudienceEnabled', true);
    fixture.detectChanges();

    expect(c['demandGenAudienceBlock']()).toBeNull();
    expect(query('implementation-demand-gen-audience-block-live')?.textContent?.trim()).toBe('');
    expect((await requestOf(c))['demandGenAudience']).toBe(AUDIENCE_A);
  });

  it('holds nothing off Demand Gen, where the channel is the reason', STATE_ONLY, async () => {
    await setup();
    const c = holdAudience(false, 'ready');
    c['campaignForm'].patchValue({ includeDemandGen: false, includeDisplay: true });
    fixture.detectChanges();

    expect(c['demandGenAudienceBlock']()).toBeNull();
  });

  /**
   * The cutover dark: Demand Gen creates through the legacy creator, its creative section is hidden and
   * both payload helpers answer `{}`, so the retained audience is read from the form itself.
   */
  it('holds Create naming the deployment while the cutover is dark, listing the single ad group audience with Remove', async () => {
    await setup();
    const c = holdAudience(false, 'ready', 'brief-1', false);

    expect(c['googleDemandGenAudiencePayload']()).toEqual({});
    expect(c['demandGenAudienceBlock']()?.kind).toBe('unsupported');
    expect(query('implementation-demand-gen-audience-block-unsupported')?.textContent).toContain('not available on this deployment');
    expect(query('implementation-demand-gen-audience-block-list')?.textContent).toContain(`Single ad group: ${AUDIENCE_A}`);
    expect(c['canSubmit']()).toBe(false);

    (query('implementation-demand-gen-audience-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['demandGenAudienceBlock']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it("holds Create while the cutover is dark for a named group's audience, naming its group, and leaves the single one held", async () => {
    await setup();
    const c = holdAudience(false, 'ready', 'brief-1', false);
    restoreGoogleDraft(fixture, c, {
      includeDemandGen: true,
      demandGenAudience: AUDIENCE_A,
      demandGenAdGroupsSplit: true,
      demandGenAdGroups: [
        { name: 'Retargeting', format: 'image', creative: {}, videoCreative: {} },
        { name: 'Prospecting', format: 'image', creative: {}, videoCreative: {}, audience: AUDIENCE_B },
      ],
    });

    expect(c['demandGenAudienceBlock']()?.kind).toBe('unsupported');
    expect(c['demandGenAudienceBlock']()?.message).toContain('the Demand Gen audience on this brief');
    expect(query('implementation-demand-gen-audience-block-list')?.textContent).toContain(`Prospecting: ${AUDIENCE_B}`);
    expect(query('implementation-demand-gen-audience-block-list')?.textContent).not.toContain('Single ad group');
    expect(c['canSubmit']()).toBe(false);

    (query('implementation-demand-gen-audience-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenAdGroups.at(1).controls.audience.value).toBe('');
    expect(c['campaignForm'].controls.demandGenAudience.value).toBe(AUDIENCE_A);
    expect(c['demandGenAudienceBlock']()).toBeNull();
  });

  /**
   * Search + Demand Gen with the cutover dark: the channel resolves to Search, but the legacy creator builds
   * the Demand Gen campaign from the pair too, so its retained audience holds Create just the same.
   */
  describe('beside Search while the cutover is dark', () => {
    it('holds Create for the single ad group audience, listing it with Remove', async () => {
      await setup();
      const c = holdAudience(false, 'ready', 'brief-1', false);
      restoreGoogleDraft(fixture, c, { includeSearch: true, includeDemandGen: true, demandGenAudience: AUDIENCE_A });

      expect(c['resolveGoogleChannel']()).toBe('search');
      expect(c['demandGenAudienceBlock']()?.kind).toBe('unsupported');
      expect(query('implementation-demand-gen-audience-block-list')?.textContent).toContain(`Single ad group: ${AUDIENCE_A}`);
      expect(c['canSubmit']()).toBe(false);

      (query('implementation-demand-gen-audience-block-remove')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(c['campaignForm'].controls.demandGenAudience.value).toBe('');
      expect(c['demandGenAudienceBlock']()).toBeNull();
      expect(c['canSubmit']()).toBe(true);
    });

    it("holds Create for a named group's audience, naming its group", async () => {
      await setup();
      const c = holdAudience(false, 'ready', 'brief-1', false);
      restoreGoogleDraft(fixture, c, {
        includeSearch: true,
        includeDemandGen: true,
        demandGenAdGroupsSplit: true,
        demandGenAdGroups: [
          { name: 'Retargeting', format: 'image', creative: {}, videoCreative: {} },
          { name: 'Prospecting', format: 'image', creative: {}, videoCreative: {}, audience: AUDIENCE_B },
        ],
      });

      expect(c['demandGenAudienceBlock']()?.kind).toBe('unsupported');
      expect(query('implementation-demand-gen-audience-block-list')?.textContent).toContain(`Prospecting: ${AUDIENCE_B}`);
      expect(c['canSubmit']()).toBe(false);

      (query('implementation-demand-gen-audience-block-remove')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(c['campaignForm'].controls.demandGenAdGroups.at(1).controls.audience.value).toBe('');
      expect(c['demandGenAudienceBlock']()).toBeNull();
      expect(c['canSubmit']()).toBe(true);
    });

    it('holds nothing once Demand Gen is unticked, leaving Search alone', STATE_ONLY, async () => {
      await setup();
      const c = holdAudience(false, 'ready', 'brief-1', false);
      restoreGoogleDraft(fixture, c, { includeSearch: true, includeDemandGen: false, demandGenAudience: AUDIENCE_A });

      expect(c['demandGenAudienceRetained']()).toEqual([]);
      expect(c['demandGenAudienceBlock']()).toBeNull();
    });
  });

  /** The block's Remove takes its own focused button away; with the cutover dark nothing nearby takes focus. */
  describe("focus after the block's Remove", () => {
    let focused: HTMLElement[];
    beforeEach(() => {
      focused = [];
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
        focused.push(this);
      });
    });

    it('moves to Create Campaign once Create is enabled', async () => {
      await setup();
      const c = holdAudience(false, 'ready', 'brief-1', false);

      (query('implementation-demand-gen-audience-block-remove')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(c['canSubmit']()).toBe(true);
      expect(focused.at(-1)).toBe(query('implementation-submit-btn')?.querySelector('button'));
    });

    it('moves to the Demand Gen checkbox while Create stays disabled', async () => {
      await setup();
      const c = holdAudience(false, 'ready', 'brief-1', false);
      c['campaignForm'].controls.eventName.setValue('');
      fixture.detectChanges();

      (query('implementation-demand-gen-audience-block-remove')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(c['canSubmit']()).toBe(false);
      expect(focused.at(-1)).toBe(query('implementation-include-demand-gen'));
    });
  });

  /** With no picker rendered, Remove would take the focused control away and leave focus nowhere. */
  describe('focus after Remove with no picker to take it', () => {
    let focused: HTMLElement[];
    beforeEach(() => {
      focused = [];
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
        focused.push(this);
      });
    });

    it('moves to the split checkbox for the single ad group when the caller has no picker access', async () => {
      await setup();
      const c = holdAudience(false, 'ready');

      c['removeDemandGenAudience'](null);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query('implementation-demand-gen-audience-picker-single')).toBeNull();
      expect(focused.at(-1)?.id).toBe('implementation-demand-gen-ad-groups-split-input');
    });

    it("moves to the group's name for a named group when the list is unavailable", async () => {
      await setup(() => throwError(() => new HttpErrorResponse({ status: 503 })));
      const c = seedDemandGen();
      split(c, ['Retargeting', 'Prospecting']);
      c['onDemandGenAudiencePicked'](1, AUDIENCE_A);
      fixture.detectChanges();
      await fixture.whenStable();

      c['removeDemandGenAudience'](1);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query('implementation-demand-gen-audience-picker-1')).toBeNull();
      expect(focused.at(-1)?.id).toBe('demand-gen-ad-group-1-name');
    });

    it('moves to the split checkbox when the account has no Audiences', async () => {
      await setup(() => of({ ...AUDIENCES, audiences: [] }));
      const c = seedDemandGen();
      c['onDemandGenAudiencePicked'](null, AUDIENCE_A);
      fixture.detectChanges();
      await fixture.whenStable();

      c['removeDemandGenAudience'](null);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(focused.at(-1)?.id).toBe('implementation-demand-gen-ad-groups-split-input');
    });
  });

  it("holds Create for a group's audience on another account, naming the group", STATE_ONLY, async () => {
    await setup();
    const c = seedDemandGen();
    split(c, ['Retargeting', 'Prospecting']);
    c['onDemandGenAudiencePicked'](1, 'customers/999/audiences/5');
    fixture.detectChanges();

    expect(c['demandGenAudienceError']()).toContain('The audience of Demand Gen ad group 2 belongs to another Google Ads account');
  });

  it('carries the audiences through the draft, and restores strings only', STATE_ONLY, async () => {
    await setup();
    const c = seedDemandGen();
    let captured: CampaignImplementationDraft | null = null;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    c['onDemandGenAudiencePicked'](null, AUDIENCE_A);
    split(c, ['Retargeting']);
    c['onDemandGenAudiencePicked'](0, AUDIENCE_B);
    c['emitDraft']();

    const draft = captured as unknown as CampaignImplementationDraft;
    expect(draft.demandGenAudience).toBe(AUDIENCE_A);
    expect(draft.demandGenAdGroups?.[0].audience).toBe(AUDIENCE_B);

    restoreGoogleDraft(fixture, c, {
      includeDemandGen: true,
      demandGenAudience: AUDIENCE_B,
      demandGenAdGroupsSplit: true,
      demandGenAdGroups: [
        { name: 'a', format: 'image', creative: {}, videoCreative: {}, audience: AUDIENCE_A },
        { name: 'b', format: 'image', creative: {}, videoCreative: {}, audience: 7 },
      ],
    });
    expect(c['campaignForm'].controls.demandGenAudience.value).toBe(AUDIENCE_B);
    expect(c['campaignForm'].controls.demandGenAdGroups.at(0).controls.audience.value).toBe(AUDIENCE_A);
    expect(c['campaignForm'].controls.demandGenAdGroups.at(1).controls.audience.value).toBe('');

    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenAudience: 7 });
    expect(c['campaignForm'].controls.demandGenAudience.value).toBe(AUDIENCE_B);
  });

  it('says so when the account has no Audiences, and when it has more than were returned', async () => {
    await setup(() => of({ ...AUDIENCES, audiences: [] }));
    seedDemandGen();
    expect(query('implementation-demand-gen-audience-picker-single')).toBeNull();
    expect(query('implementation-demand-gen-audience-picker-empty-single')?.textContent).toContain('no Audiences to pick from');
    expect(query('implementation-google-audience-picker-live')?.textContent).toContain('no Audiences to pick from');

    fixture.destroy();
    TestBed.resetTestingModule();
    await setup(() => of({ ...AUDIENCES, truncated: true }));
    seedDemandGen();
    expect(query('implementation-demand-gen-audience-picker-truncated-single')?.textContent).toContain('more Audiences than the picker shows');
    expect(query('implementation-google-audience-picker-live')?.textContent).toContain('more Audiences than the picker shows');
  });

  it.each([
    [403, "isn't available here"],
    [404, "isn't available here"],
    [503, "couldn't be read"],
    [0, "couldn't be read"],
  ])('says why there is no picker when the read answers %s', async (status, reason) => {
    await setup(() => throwError(() => new HttpErrorResponse({ status })));
    seedDemandGen();

    expect(query('implementation-demand-gen-audience-picker-single')).toBeNull();
    expect(query('implementation-demand-gen-audience-picker-unavailable-single')?.textContent).toContain(reason);
    expect(query('implementation-google-audience-picker-live')?.textContent).toContain(reason);
  });

  it('shows the loading line while the read is in flight, and drops the read when the picker hides', async () => {
    const pending = new Subject<GoogleAdsAudiencesResult>();
    await setup(() => pending.asObservable());
    seedDemandGen();
    expect(query('implementation-demand-gen-audience-picker-loading-single')).not.toBeNull();
    expect(query('implementation-google-audience-picker-live')?.textContent).toContain('Loading');

    fixture.componentRef.setInput('googleDemandGenAudienceEnabled', false);
    fixture.detectChanges();
    expect(pending.observed).toBe(false);
    expect(query('implementation-google-audience-picker-live')?.textContent?.trim()).toBe('');
  });
});
