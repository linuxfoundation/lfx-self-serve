// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { GoogleAdsAudiencesResult, GoogleAdsUserListsResult, ProjectContext } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
  DISPLAY_COMPLETE,
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
 * The Display audience pickers (#5262): user lists, custom audiences, custom affinity segments and
 * interests for the single ad group or each named group, and the campaign's excluded user lists, read only
 * for a caller the routes admit, and judged on Create as campaign-service judges them.
 */
describe('ImplementationTabComponent display audiences', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const ACCOUNT = '1234567890';
  const LIST = `customers/${ACCOUNT}/userLists/5`;
  const LIST_B = `customers/${ACCOUNT}/userLists/6`;
  const CUSTOM = `customers/${ACCOUNT}/customAudiences/7`;
  const AFFINITY = `customers/${ACCOUNT}/customInterests/8`;
  const INTEREST = `customers/${ACCOUNT}/userInterests/80001`;
  const LISTS: GoogleAdsUserListsResult = {
    accountId: ACCOUNT,
    userLists: [
      { resourceName: LIST, id: '5', name: 'Registrants', type: 'CRM_BASED', eligibleForSearch: true },
      { resourceName: LIST_B, id: '6', name: 'Site visitors', type: 'RULE_BASED', eligibleForSearch: true },
    ],
    truncated: false,
  };
  const ENTRIES: Record<string, GoogleAdsAudiencesResult> = {
    custom_audience: { accountId: ACCOUNT, audiences: [{ resourceName: CUSTOM, id: '7', name: 'Cloud searchers', description: null }], truncated: false },
    custom_interest: { accountId: ACCOUNT, audiences: [{ resourceName: AFFINITY, id: '8', name: 'Platform engineers', description: null }], truncated: false },
    user_interest: { accountId: ACCOUNT, audiences: [{ resourceName: INTEREST, id: '80001', name: 'Cloud Computing', description: null }], truncated: true },
  };
  let readLists: ReturnType<typeof vi.fn>;
  let readAudiences: ReturnType<typeof vi.fn>;

  async function setup(audiences: (type: string, q: string) => unknown = (type) => of(ENTRIES[type])): Promise<void> {
    await configureGoogleTab();
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    readLists = vi.fn(() => of(LISTS));
    readAudiences = vi.fn((_project: string, type: string, q = '') => audiences(type, q));
    vi.spyOn(TestBed.inject(CampaignService), 'getGoogleAdsUserLists').mockImplementation(readLists as never);
    vi.spyOn(TestBed.inject(CampaignService), 'getGoogleAdsAudiences').mockImplementation(readAudiences as never);
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Display with a complete ad, and the per-caller capability. */
  function seedDisplay(enabled: boolean | null = true): Record<string, any> {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue(DISPLAY_COMPLETE);
    fixture.componentRef.setInput('googleDisplayAudiencesEnabled', enabled);
    fixture.detectChanges();
    return c;
  }

  /** Split into named groups, each with a complete ad. */
  function split(c: Record<string, any>, names: string[]): void {
    c['campaignForm'].controls.displayAdGroupsSplit.setValue(true);
    c['onDisplayAdGroupsSplitChange']();
    for (let i = 1; i < names.length; i++) c['addDisplayAdGroup']();
    names.forEach((name, i) => {
      const controls = c['campaignForm'].controls.displayAdGroups.at(i).controls;
      controls.name.setValue(name);
      controls.creative.patchValue(DISPLAY_COMPLETE);
    });
    fixture.detectChanges();
  }

  const pick = (c: Record<string, any>, group: number | null | 'excluded', kind: string, resourceName: string): void => {
    c['onDisplayAudiencePicked'](c['displayAudienceControl'](group, kind), resourceName, { writeValue: vi.fn() });
    fixture.detectChanges();
  };

  async function requestOf(c: Record<string, any>): Promise<Record<string, unknown>> {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    createCampaign.mockClear();
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);
    c['submit']();
    await fixture.whenStable();
    return createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
  }

  it('reads nothing and shows no picker for a caller the routes would not admit, or off Display', async () => {
    await setup();
    seedDisplay(false);
    expect(readLists).not.toHaveBeenCalled();
    expect(readAudiences).not.toHaveBeenCalled();
    expect(query('implementation-display-audience-single-audienceSegments')).toBeNull();

    seedDisplay(null);
    expect(readAudiences).not.toHaveBeenCalled();

    seedChannel(fixture, { includeSearch: true });
    fixture.componentRef.setInput('googleDisplayAudiencesEnabled', true);
    fixture.detectChanges();
    expect(readLists).not.toHaveBeenCalled();
    expect(readAudiences).not.toHaveBeenCalled();
  });

  it('reads each kind once, offers the four pickers and the exclusions, and sends the picks for the single ad group', async () => {
    await setup();
    const c = seedDisplay();
    expect(readLists).toHaveBeenCalledWith('tlf');
    expect(readAudiences).toHaveBeenCalledWith('tlf', 'custom_audience', '');
    expect(readAudiences).toHaveBeenCalledWith('tlf', 'custom_interest', '');
    expect(readAudiences).toHaveBeenCalledWith('tlf', 'user_interest', '');
    for (const id of ['single-audienceSegments', 'single-customAudiences', 'single-customAffinities', 'single-userInterests', 'excluded']) {
      expect(query(`implementation-display-audience-picker-${id}`)).not.toBeNull();
    }
    expect(query('implementation-display-audience-note-single-userInterests')?.textContent).toContain('Search to narrow them');

    pick(c, null, 'audienceSegments', LIST);
    pick(c, null, 'audienceSegments', LIST);
    // A picked list leaves that list's picker, not the exclusions'.
    expect(c['displayAudienceUnpicked']()['single-audienceSegments'].map((o: { resourceName: string }) => o.resourceName)).toEqual([LIST_B]);
    expect(c['displayAudienceUnpicked']()['excluded']).toHaveLength(2);
    pick(c, null, 'customAudiences', CUSTOM);
    pick(c, null, 'customAffinities', AFFINITY);
    pick(c, null, 'userInterests', INTEREST);
    pick(c, 'excluded', 'audienceSegments', LIST_B);
    expect(query('implementation-display-audience-single-audienceSegments')?.textContent).toContain('Registrants');
    expect(query('implementation-display-audience-remove-single-userInterests-0')?.getAttribute('aria-label')).toBe('Remove Cloud Computing');

    expect((await requestOf(c))['displayAudiences']).toEqual({
      audienceSegments: [LIST],
      customAudiences: [CUSTOM],
      customAffinities: [AFFINITY],
      userInterests: [INTEREST],
      excludedAudienceSegments: [LIST_B],
    });
  });

  it('picks through the combobox itself and clears it', async () => {
    await setup();
    const c = seedDisplay();
    const combobox = fixture.debugElement.query(By.css('[data-testid="implementation-display-audience-picker-single-customAudiences"]'))
      .componentInstance as UiComboboxComponent;
    const writeValue = vi.spyOn(combobox, 'writeValue');
    (combobox as unknown as { select(option: { value: string; label: string }): void }).select({ value: CUSTOM, label: 'x' });
    fixture.detectChanges();

    expect(c['campaignForm'].controls.displayAudiences.controls.customAudiences.value).toEqual([CUSTOM]);
    expect(writeValue).toHaveBeenCalledWith(null);
  });

  it('removes a pick, keeps the request unchanged with none, and moves focus to the picker', async () => {
    await setup();
    const focused: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    const c = seedDisplay();
    pick(c, null, 'userInterests', INTEREST);

    c['removeDisplayAudience'](c['displayAudienceControl'](null, 'userInterests'), INTEREST, 'single-userInterests');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(c['googleDisplayAudiencesPayload']()).toEqual({});
    expect(focused.at(-1)).toBe(query('implementation-display-audience-picker-single-userInterests')?.querySelector('input'));
    expect(await requestOf(c)).not.toHaveProperty('displayAudiences');
  });

  it('searches interests by name, keeping an earlier pick named', async () => {
    await setup((type, q) => (type === 'user_interest' && q !== '' ? of({ ...ENTRIES['user_interest'], audiences: [], truncated: false }) : of(ENTRIES[type])));
    const c = seedDisplay();
    pick(c, null, 'userInterests', INTEREST);

    c['displayInterestSearchForm'].controls.q.setValue('  devops ');
    c['onDisplayInterestSearch']();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(readAudiences).toHaveBeenCalledWith('tlf', 'user_interest', 'devops');
    expect(query('implementation-display-interest-search')?.querySelector('input')?.getAttribute('maxlength')).toBe('100');
    expect(query('implementation-display-audience-note-single-userInterests')?.textContent).toContain('No interest matches that search.');
    expect(query('implementation-display-audience-single-userInterests')?.textContent).toContain('Cloud Computing');
  });

  it('says why a list is unavailable, per kind', async () => {
    await setup((type) => (type === 'custom_interest' ? throwError(() => new HttpErrorResponse({ status: 404 })) : of(ENTRIES[type])));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    seedDisplay();
    fixture.detectChanges();

    expect(query('implementation-display-audience-note-single-customAffinities')?.textContent).toContain(
      "custom affinity segments picker isn't available here"
    );
    expect(query('implementation-display-audience-picker-single-customAffinities')).toBeNull();
    expect(query('implementation-display-audience-picker-live')?.textContent).toContain('Custom affinity segments:');
  });

  it("sends each named group's picks on its own group, the exclusions at the campaign level", async () => {
    await setup();
    const c = seedDisplay();
    split(c, ['Retargeting', 'Prospecting']);
    expect(query('implementation-display-audience-single-audienceSegments')).toBeNull();
    expect(query('implementation-display-audience-picker-1-customAffinities')).not.toBeNull();

    pick(c, 0, 'audienceSegments', LIST);
    pick(c, 1, 'customAffinities', AFFINITY);
    pick(c, 'excluded', 'audienceSegments', LIST_B);
    const request = await requestOf(c);

    const groups = request['displayAdGroups'] as Record<string, unknown>[];
    expect(groups[0]['audienceSegments']).toEqual([LIST]);
    expect(groups[0]).not.toHaveProperty('customAffinities');
    expect(groups[1]['customAffinities']).toEqual([AFFINITY]);
    expect(request['displayAudiences']).toEqual({ excludedAudienceSegments: [LIST_B] });
  });

  it('holds the single ad group picks while split, and the group picks while not, saying so', async () => {
    await setup();
    const c = seedDisplay();
    pick(c, null, 'userInterests', INTEREST);
    split(c, ['Retargeting']);

    expect(query('implementation-display-audiences-held')?.textContent).toContain('kept but not sent while the campaign is split');
    expect(query('implementation-display-audiences-held-live')?.textContent).toContain('kept but not sent while the campaign is split');
    expect(c['googleDisplayAudiencesPayload']()).toEqual({});

    pick(c, 0, 'customAudiences', CUSTOM);
    c['campaignForm'].controls.displayAdGroupsSplit.setValue(false);
    fixture.detectChanges();
    expect(query('implementation-display-audiences-held')?.textContent).toContain('kept but not sent while the campaign is not split');
    expect(c['googleDisplayAudiencesPayload']()).toEqual({ displayAudiences: { userInterests: [INTEREST] } });
  });

  it('holds Create for a list both targeted and excluded, and for another account', async () => {
    await setup();
    const c = seedDisplay();
    pick(c, null, 'audienceSegments', LIST);
    pick(c, 'excluded', 'audienceSegments', LIST);
    expect(c['displayAudiencesError']()).toContain('also excludes');
    expect(query('implementation-display-audiences-error')?.textContent).toContain('also excludes');
    expect(c['canSubmit']()).toBe(false);

    c['displayAudienceControl']('excluded', 'audienceSegments').setValue([]);
    c['displayAudienceControl'](null, 'customAudiences').setValue(['customers/999/customAudiences/7']);
    fixture.detectChanges();
    expect(c['displayAudiencesError']()).toContain('another Google Ads account');
    expect(c['canSubmit']()).toBe(false);
  });

  it('round-trips the picks through the draft, keeping strings only', STATE_ONLY, async () => {
    await setup();
    const c = seedDisplay();
    restoreGoogleDraft(fixture, c, {
      includeDisplay: true,
      displayAudiences: { userInterests: [INTEREST, 7], customAudiences: 'x', excludedAudienceSegments: [LIST_B] },
      displayAdGroupsSplit: false,
      displayAdGroups: [{ name: 'Retargeting', creative: {}, audiences: { audienceSegments: [LIST, null] } }],
    });

    expect(c['campaignForm'].controls.displayAudiences.controls.userInterests.value).toEqual([INTEREST]);
    expect(c['campaignForm'].controls.displayAudiences.controls.customAudiences.value).toEqual([]);
    // A repeat is restored once, as the pickers add it once.
    restoreGoogleDraft(fixture, c, { includeDisplay: true, displayAudiences: { userInterests: [INTEREST, INTEREST] } });
    expect(c['campaignForm'].controls.displayAudiences.controls.userInterests.value).toEqual([INTEREST]);
    expect(c['campaignForm'].controls.displayExcludedUserLists.value).toEqual([LIST_B]);
    expect(c['campaignForm'].controls.displayAdGroups.at(0).controls.audiences.controls.audienceSegments.value).toEqual([LIST]);

    let draft: Record<string, any> = {};
    fixture.componentInstance.draftChange.subscribe((d) => (draft = d as Record<string, any>));
    c['emitDraft']();
    expect(draft['displayAudiences']).toEqual({
      audienceSegments: [],
      customAudiences: [],
      customAffinities: [],
      userInterests: [INTEREST],
      excludedAudienceSegments: [LIST_B],
    });
    expect(draft['displayAdGroups'][0].audiences.audienceSegments).toEqual([LIST]);
  });

  /** PR #5388 review: the draft carries the names the picks were made under, so a restored pick keeps its name. */
  it('restores a pick by the name it was picked under after a search that does not list it', async () => {
    await setup((type, q) => (type === 'user_interest' && q !== '' ? of({ ...ENTRIES['user_interest'], audiences: [], truncated: false }) : of(ENTRIES[type])));
    const c = seedDisplay();
    let draft: Record<string, any> = {};
    fixture.componentInstance.draftChange.subscribe((d) => (draft = d as Record<string, any>));
    pick(c, null, 'userInterests', INTEREST);
    // The pick's own emission carries the name, not only a later one.
    expect(draft['displayAudienceNames']).toEqual({ [INTEREST]: 'Cloud Computing' });

    // A teardown loses the tab's names; the restore brings them back, strings only.
    c['displayAudiencePickedNames'].set(new Map());
    restoreGoogleDraft(fixture, c, {
      includeDisplay: true,
      displayAudiences: { userInterests: [INTEREST] },
      displayAudienceNames: { [INTEREST]: 'Cloud Computing', [CUSTOM]: 7 },
    });
    c['displayInterestSearchForm'].controls.q.setValue('devops');
    c['onDisplayInterestSearch']();
    fixture.detectChanges();
    await fixture.whenStable();

    expect([...c['displayAudiencePickedNames']().entries()]).toEqual([[INTEREST, 'Cloud Computing']]);
    expect(query('implementation-display-audience-remove-single-userInterests-0')?.getAttribute('aria-label')).toBe('Remove Cloud Computing');
  });

  it('shows a restored pick by resource name when the draft carries no name for it', async () => {
    await setup((type, q) => (type === 'user_interest' && q !== '' ? of({ ...ENTRIES['user_interest'], audiences: [], truncated: false }) : of(ENTRIES[type])));
    const c = seedDisplay();
    restoreGoogleDraft(fixture, c, { includeDisplay: true, displayAudiences: { userInterests: [INTEREST] } });
    c['displayInterestSearchForm'].controls.q.setValue('devops');
    c['onDisplayInterestSearch']();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(query('implementation-display-audience-remove-single-userInterests-0')?.getAttribute('aria-label')).toBe(`Remove ${INTEREST}`);
  });

  /** PR #5388 review: a new brief clears the interest search with the picks, so the picker lists the first interests again. */
  it('clears the interest search when the form resets for a brief', STATE_ONLY, async () => {
    await setup();
    const c = seedDisplay();
    c['displayInterestSearchForm'].controls.q.setValue('devops');
    c['onDisplayInterestSearch']();
    fixture.detectChanges();
    expect(readAudiences).toHaveBeenLastCalledWith('tlf', 'user_interest', 'devops');

    // A new brief object re-runs the seed, which resets the Google fields first.
    seedDisplay();
    await fixture.whenStable();

    expect(c['displayInterestSearchForm'].controls.q.value).toBe('');
    expect(c['displayInterestQuery']()).toBe('');
    expect(readAudiences).toHaveBeenLastCalledWith('tlf', 'user_interest', '');
  });

  describe('a draft holding audiences the request cannot carry', () => {
    function hold(
      enabled: boolean | null,
      read: 'pending' | 'failed' | 'unknown' | 'ready',
      briefId: string | null = 'brief-1',
      creative: boolean | null = true
    ): Record<string, any> {
      const c = seedDisplay(enabled);
      restoreGoogleDraft(fixture, c, { includeDisplay: true, displayAudiences: { userInterests: [INTEREST], excludedAudienceSegments: [LIST_B] } });
      c['campaignForm'].controls.displayCreative.patchValue(DISPLAY_COMPLETE);
      fixture.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: !!briefId });
      fixture.componentRef.setInput('createCapabilityRead', read);
      fixture.componentRef.setInput('googleDisplayAudiencesEnabled', enabled);
      fixture.componentRef.setInput('googleCreativeEnabled', creative);
      fixture.detectChanges();
      return c;
    }

    const DENIAL = 'Only the LF marketing team can target audiences on Display';

    it('waits with a pending line, not the denial, while the answer is being read', async () => {
      await setup();
      const c = hold(null, 'pending');
      expect(c['displayAudiencesBlock']()?.kind).toBe('pending');
      expect(query('implementation-display-audiences-block-live')?.textContent?.trim()).toBe(c['displayAudiencesBlockMessage']());
      expect(fixture.nativeElement.textContent).not.toContain(DENIAL);
      expect(c['canSubmit']()).toBe(false);
    });

    it('offers a Retry when the read failed and the answer is still out', async () => {
      await setup();
      const retried = vi.fn();
      fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
      const c = hold(null, 'failed');
      expect(c['displayAudiencesBlock']()?.kind).toBe('failed');
      (query('implementation-display-audiences-block-retry')?.querySelector('button') as HTMLButtonElement).click();
      expect(retried).toHaveBeenCalledTimes(1);
    });

    it('asks for the brief to be saved, and says the deployment cannot send them, listing them while the section is hidden', async () => {
      await setup();
      expect(hold(null, 'unknown', null)['displayAudiencesBlock']()?.kind).toBe('unsaved');
      expect(hold(true, 'ready', 'brief-1', false)['displayAudiencesBlock']()?.kind).toBe('unsupported');
      expect(query('implementation-display-audiences-block-list')?.textContent).toContain('Excluded:');
    });

    it('holds Create with the restricted block on an explicit no, listing them, and Remove clears it', async () => {
      await setup();
      const c = hold(false, 'ready');
      expect(query('implementation-display-audiences-block-restricted')?.textContent).toContain(DENIAL);
      // Display's creative section is on screen, so the held values show there as chips, not again in the block.
      expect(query('implementation-display-audiences-block-list')).toBeNull();
      expect(query('implementation-display-audience-remove-excluded-0')).not.toBeNull();
      expect(c['canSubmit']()).toBe(false);

      (query('implementation-display-audiences-block-remove')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(c['campaignForm'].controls.displayAudiences.controls.userInterests.value).toEqual([]);
      expect(c['campaignForm'].controls.displayExcludedUserLists.value).toEqual([]);
      expect(c['displayAudiencesBlock']()).toBeNull();
      expect(c['canSubmit']()).toBe(true);
    });

    it.each([
      ['answered no', false],
      ['unanswered', null],
    ])('keeps focus on a surviving control when a list loses its last chip with access %s', async (_label, enabled) => {
      await setup();
      const focused: HTMLElement[] = [];
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
        focused.push(this);
      });
      const c = hold(enabled, enabled === null ? 'failed' : 'ready');

      (query('implementation-display-audience-remove-excluded-0') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      // The exclusions list left with its label, so focus goes to the interest still held.
      expect(query('implementation-display-audience-excluded')).toBeNull();
      expect(focused.at(-1)).toBe(query('implementation-display-audience-remove-single-userInterests-0'));

      (query('implementation-display-audience-remove-single-userInterests-0') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      // Nothing is held any more, so the notice leaves too and Create Campaign takes focus.
      expect(c['displayAudiencesBlock']()).toBeNull();
      expect(focused.at(-1)).toBe(query('implementation-submit-btn')?.querySelector('button'));
      expect(focused.at(-1)?.isConnected).toBe(true);
    });

    it('clears once the caller is answered yes', STATE_ONLY, async () => {
      await setup();
      const c = hold(true, 'ready');
      expect(c['displayAudiencesBlock']()).toBeNull();
    });

    /** The #5393 fix round's gate, for Display: `googleChannelsEnabled` null hides the Display checkbox. */
    describe.each([['pending'], ['failed']] as const)('with the channel capability unanswered (read %s)', (read) => {
      function holdUnanswered(): Record<string, any> {
        const c = hold(null, read);
        fixture.componentRef.setInput('googleChannelsEnabled', null);
        fixture.componentRef.setInput('googleCreativeEnabled', null);
        fixture.detectChanges();
        return c;
      }

      it('keeps the block with its Retry and Remove, and Create held, though selectedGoogleChannels drops Display', async () => {
        await setup();
        const c = holdUnanswered();

        expect(c['selectedGoogleChannels']()).not.toContain('display');
        expect(query('implementation-include-display')).toBeNull();
        expect(c['displayAudiencesBlock']()?.kind).toBe(read);
        expect(query('implementation-display-audiences-block-list')?.textContent).toContain('Excluded:');
        expect(c['canSubmit']()).toBe(false);
        expect(query('implementation-display-audiences-block-remove')).not.toBeNull();
        expect(query('implementation-display-audiences-block-retry') !== null).toBe(read === 'failed');
      });

      it('falls back to the Search checkbox on Remove, the Display checkbox being hidden and Create disabled', async () => {
        await setup();
        const focused: HTMLElement[] = [];
        vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
          focused.push(this);
        });
        const c = holdUnanswered();

        (query('implementation-display-audiences-block-remove')?.querySelector('button') as HTMLButtonElement).click();
        fixture.detectChanges();
        await fixture.whenStable();

        expect(c['displayAudiencesBlock']()).toBeNull();
        expect(focused.at(-1)).toBe(query('implementation-include-search'));
      });

      it('clears the block only once the channel capability is answered no', async () => {
        await setup();
        const c = holdUnanswered();
        fixture.componentRef.setInput('googleChannelsEnabled', false);
        fixture.detectChanges();
        expect(c['displayAudiencesBlock']()).toBeNull();
      });
    });
  });
});
