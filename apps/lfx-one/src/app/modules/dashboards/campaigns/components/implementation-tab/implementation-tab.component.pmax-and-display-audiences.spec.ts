// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  GOOGLE_AUDIENCE_PICKER_EMPTY,
  GOOGLE_AUDIENCE_PICKER_LOADING,
  GOOGLE_AUDIENCE_PICKER_REASONS,
  GOOGLE_AUDIENCE_PICKER_TRUNCATED,
  GOOGLE_PERFORMANCE_MAX_AUDIENCE_SIGNAL_NEED_CREATIVE_REFUSAL,
} from '@lfx-one/shared/constants';
import type { CampaignImplementationDraft, GoogleAdsAudiencesResult, GoogleAdsUserListsResult, ProjectContext } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { DISPLAY_COMPLETE, configureGoogleTab, restoreGoogleDraft, seedChannel, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

describe('ImplementationTabComponent performance max audience signal', () => {
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
  const PMAX_COMPLETE = {
    headlines: 'One headline\nTwo headline\nThree headline',
    longHeadlines: 'A long headline',
    descriptions: 'A short description\nAnother short description',
    businessName: 'Acme',
    marketingImages: 'https://example.com/a.png',
    squareMarketingImages: 'https://example.com/square.png',
    logoImages: 'https://example.com/logo.png',
  };
  const DENIAL = 'Only the LF marketing team can add a Google Ads Audience as a Performance Max audience signal';
  let read: ReturnType<typeof vi.fn>;

  async function setup(answer: () => unknown = () => of(AUDIENCES)): Promise<void> {
    await configureGoogleTab();
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    read = vi.fn(answer);
    vi.spyOn(TestBed.inject(CampaignService), 'getGoogleAdsAudiences').mockImplementation(read as never);
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Performance Max with a complete creative, and the per-caller capability. */
  function seedPmax(enabled: boolean | null = true, f: ComponentFixture<ImplementationTabComponent> = fixture): Record<string, any> {
    const c = seedChannel(f, { includePerformanceMax: true });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);
    f.componentRef.setInput('googlePerformanceMaxAudienceSignalEnabled', enabled);
    f.detectChanges();
    return c;
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

  it('reads nothing and shows nothing for a caller the route would not admit, or off Performance Max', async () => {
    await setup();
    seedPmax(false);
    expect(read).not.toHaveBeenCalled();
    expect(query('implementation-performance-max-audience-signal-section')).toBeNull();

    seedPmax(null);
    expect(read).not.toHaveBeenCalled();
    expect(query('implementation-performance-max-audience-signal-section')).toBeNull();

    for (const channel of [{ includeSearch: true }, { includeDisplay: true }, { includeDemandGen: true }]) {
      seedChannel(fixture, channel);
      fixture.componentRef.setInput('googlePerformanceMaxAudienceSignalEnabled', true);
      fixture.detectChanges();
      expect(query('implementation-performance-max-audience-signal-section')).toBeNull();
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('offers the Audiences, shows a pick by name with Remove, and sends it on a Performance Max create', async () => {
    await setup();
    const c = seedPmax();
    expect(read).toHaveBeenCalledWith('tlf');
    expect(query('implementation-performance-max-audience-signal-picker')).not.toBeNull();

    c['onPerformanceMaxAudienceSignalPicked'](AUDIENCE_B);
    fixture.detectChanges();
    expect(query('implementation-performance-max-audience-signal-picker')).toBeNull();
    expect(query('implementation-performance-max-audience-signal-picked')?.textContent).toContain('Example Summit - Registrants');
    expect(query('implementation-performance-max-audience-signal-remove')?.getAttribute('aria-label')).toBe('Remove Example Summit - Registrants');

    c['removePerformanceMaxAudienceSignal']();
    fixture.detectChanges();
    expect(query('implementation-performance-max-audience-signal-picker')).not.toBeNull();
    expect(c['googlePerformanceMaxAudienceSignalPayload']()).toEqual({});

    c['onPerformanceMaxAudienceSignalPicked'](null);
    expect(c['campaignForm'].controls.googlePerformanceMaxAudienceSignal.value).toBe('');
    c['onPerformanceMaxAudienceSignalPicked'](AUDIENCE_A);
    expect((await requestOf(c))['performanceMaxAudienceSignal']).toBe(AUDIENCE_A);
  });

  it('reads the Audiences once across a switch between Demand Gen and Performance Max, since one list serves both pickers', async () => {
    await setup();
    const c = seedChannel(fixture, { includeDemandGen: true });
    fixture.componentRef.setInput('googleDemandGenAudienceEnabled', true);
    fixture.componentRef.setInput('googlePerformanceMaxAudienceSignalEnabled', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(1);

    c['campaignForm'].patchValue({ includeDemandGen: false, includePerformanceMax: true });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(read).toHaveBeenCalledTimes(1);
    expect(query('implementation-performance-max-audience-signal-picker')).not.toBeNull();
  });

  it('picks through the combobox itself', async () => {
    await setup();
    const c = seedPmax();
    const combobox = fixture.debugElement.query(By.css('[data-testid="implementation-performance-max-audience-signal-picker"]'))
      .componentInstance as UiComboboxComponent;
    (combobox as unknown as { select(option: { value: string; label: string }): void }).select({ value: AUDIENCE_A, label: 'x' });
    fixture.detectChanges();

    expect(c['campaignForm'].controls.googlePerformanceMaxAudienceSignal.value).toBe(AUDIENCE_A);
  });

  it("moves focus to the picked Audience's Remove button, and back to the picker on Remove", async () => {
    await setup();
    const focused: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    const c = seedPmax();

    c['onPerformanceMaxAudienceSignalPicked'](AUDIENCE_A);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(focused).toEqual([query('implementation-performance-max-audience-signal-remove')]);

    c['removePerformanceMaxAudienceSignal']();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(focused[1]).toBe(query('implementation-performance-max-audience-signal-picker')?.querySelector('input'));
  });

  it.each([
    ['loading', () => NEVER, 'implementation-performance-max-audience-signal-picker-loading', GOOGLE_AUDIENCE_PICKER_LOADING],
    ['empty', () => of({ ...AUDIENCES, audiences: [] }), 'implementation-performance-max-audience-signal-picker-empty', GOOGLE_AUDIENCE_PICKER_EMPTY],
    [
      'truncated',
      () => of({ ...AUDIENCES, truncated: true }),
      'implementation-performance-max-audience-signal-picker-truncated',
      GOOGLE_AUDIENCE_PICKER_TRUNCATED,
    ],
    [
      'refused',
      () => throwError(() => new HttpErrorResponse({ status: 403 })),
      'implementation-performance-max-audience-signal-picker-unavailable',
      GOOGLE_AUDIENCE_PICKER_REASONS.unavailable,
    ],
    [
      'failed',
      () => throwError(() => new HttpErrorResponse({ status: 502 })),
      'implementation-performance-max-audience-signal-picker-unavailable',
      GOOGLE_AUDIENCE_PICKER_REASONS.failed,
    ],
  ])('says so, visibly and in the shared live region, when the list is %s', async (_label, answer, testId, text) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(answer);
    seedPmax();

    expect(query(testId)?.textContent).toContain(text);
    expect(query('implementation-google-audience-picker-live')?.textContent).toContain(text);
  });

  /** A Performance Max request with no signal picked is byte-identical to one built before it existed. */
  it('sends a byte-identical request when no signal is picked', async () => {
    await setup();
    const without = JSON.stringify(await requestOf(seedPmax(false)));

    const other = TestBed.createComponent(ImplementationTabComponent);
    other.detectChanges();
    await other.whenStable();
    const after = seedPmax(true, other);

    expect(JSON.stringify(await requestOf(after, other))).toBe(without);
    expect(without).not.toContain('performanceMaxAudienceSignal');
  });

  it.each([
    ['a malformed resource name', 'customers/1234567890/userLists/111', 'is not a Google Ads Audience'],
    ["another account's Audience", 'customers/999/audiences/111', 'belongs to another Google Ads account'],
  ])('holds Create, with the reason shown and announced, for %s', async (_label, value, reason) => {
    await setup();
    const c = seedPmax();
    restoreGoogleDraft(fixture, c, { includePerformanceMax: true, googlePerformanceMaxAudienceSignal: value });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);
    fixture.detectChanges();

    expect(c['canSubmit']()).toBe(false);
    expect(query('implementation-performance-max-audience-signal-error')?.textContent).toContain(reason);
    expect(query('implementation-performance-max-audience-signal-error-live')?.textContent).toContain(reason);
    expect(query('implementation-performance-max-audience-signal-remove')).not.toBeNull();

    c['removePerformanceMaxAudienceSignal']();
    fixture.detectChanges();
    expect(c['performanceMaxAudienceSignalError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it("takes a restored bare audience id, which upstream resolves in the campaign's own account", async () => {
    await setup();
    const c = seedPmax();
    restoreGoogleDraft(fixture, c, { includePerformanceMax: true, googlePerformanceMaxAudienceSignal: ' 111 ' });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);

    expect((await requestOf(c))['performanceMaxAudienceSignal']).toBe('111');
  });

  it('holds Create while the Performance Max creative is empty, as the signal attaches to its asset group', async () => {
    await setup();
    const c = seedPmax();
    c['onPerformanceMaxAudienceSignalPicked'](AUDIENCE_A);
    c['campaignForm'].controls.performanceMaxCreative.reset();
    fixture.detectChanges();

    expect(c['performanceMaxAudienceSignalError']()).toBe(GOOGLE_PERFORMANCE_MAX_AUDIENCE_SIGNAL_NEED_CREATIVE_REFUSAL);
    expect(query('implementation-performance-max-audience-signal-error')?.textContent).toContain(GOOGLE_PERFORMANCE_MAX_AUDIENCE_SIGNAL_NEED_CREATIVE_REFUSAL);
    expect(c['canSubmit']()).toBe(false);
  });

  it('holds the signal back after a switch away from Performance Max, saying so, and sends it again on the way back', async () => {
    await setup();
    const c = seedPmax();
    c['onPerformanceMaxAudienceSignalPicked'](AUDIENCE_A);
    c['campaignForm'].patchValue({ includePerformanceMax: false, includeDisplay: true });
    fixture.detectChanges();

    expect(c['googlePerformanceMaxAudienceSignalPayload']()).toEqual({});
    expect(query('implementation-performance-max-audience-signal-section')).toBeNull();
    expect(query('implementation-performance-max-audience-signal-withheld')?.textContent).toContain(
      'Display campaigns do not take an audience signal, so the audience signal on this brief will not be sent.'
    );
    expect(query('implementation-performance-max-audience-signal-withheld-live')?.textContent).toContain('Display campaigns do not take an audience signal');
    expect(c['performanceMaxAudienceSignalBlock']()).toBeNull();

    c['campaignForm'].patchValue({ includePerformanceMax: true, includeDisplay: false });
    fixture.detectChanges();
    expect(query('implementation-performance-max-audience-signal-withheld')).toBeNull();
    expect(c['googlePerformanceMaxAudienceSignalPayload']()).toEqual({ performanceMaxAudienceSignal: AUDIENCE_A });
  });

  it('carries the signal through the draft, restores it under any channel, and clears it on reset', async () => {
    await setup();
    const c = seedPmax();
    c['onPerformanceMaxAudienceSignalPicked'](AUDIENCE_A);
    let captured: CampaignImplementationDraft | null = null;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    c['emitDraft']();
    expect((captured as unknown as CampaignImplementationDraft).googlePerformanceMaxAudienceSignal).toBe(AUDIENCE_A);

    restoreGoogleDraft(fixture, c, { includeSearch: true, googlePerformanceMaxAudienceSignal: AUDIENCE_B });
    expect(c['campaignForm'].controls.googlePerformanceMaxAudienceSignal.value).toBe(AUDIENCE_B);

    // A draft that predates the field, or holds a non-string, leaves it alone.
    restoreGoogleDraft(fixture, c, { includeSearch: true });
    restoreGoogleDraft(fixture, c, { includeSearch: true, googlePerformanceMaxAudienceSignal: 42 });
    expect(c['campaignForm'].controls.googlePerformanceMaxAudienceSignal.value).toBe(AUDIENCE_B);

    c['resetGoogleFields']();
    expect(c['campaignForm'].controls.googlePerformanceMaxAudienceSignal.value).toBe('');
  });

  /**
   * A retained signal the request cannot carry, on the Demand Gen audience's terms: a pending line or a
   * Retry while the per-caller answer is out, the restricted block only on an explicit no, and the
   * deployment named while the cutover is dark. Never dropped, and Remove in every state.
   */
  function holdSignal(
    enabled: boolean | null,
    capabilityRead: 'pending' | 'ready' | 'failed' | 'unknown',
    briefId: string | null = 'brief-1',
    creative: boolean | null = true
  ): Record<string, any> {
    const c = seedPmax(enabled);
    restoreGoogleDraft(fixture, c, { includePerformanceMax: true, googlePerformanceMaxAudienceSignal: AUDIENCE_A });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);
    fixture.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: !!briefId });
    fixture.componentRef.setInput('createCapabilityRead', capabilityRead);
    fixture.componentRef.setInput('googlePerformanceMaxAudienceSignalEnabled', enabled);
    fixture.componentRef.setInput('googleCreativeEnabled', creative);
    fixture.detectChanges();
    return c;
  }

  it('holds Create with a pending line, not the denial, while the per-caller answer is being read', async () => {
    await setup();
    const c = holdSignal(null, 'pending');

    expect(c['performanceMaxAudienceSignalBlock']()?.kind).toBe('pending');
    expect(query('implementation-performance-max-audience-signal-block-pending')?.textContent).toContain(
      'Checking whether you can send Performance Max audience signals'
    );
    expect(query('implementation-performance-max-audience-signal-block-live')?.textContent?.trim()).toBe(c['performanceMaxAudienceSignalBlockMessage']());
    expect(fixture.nativeElement.textContent).not.toContain(DENIAL);
    expect(c['performanceMaxAudienceSignalError']()).toBeNull();
    expect(query('implementation-performance-max-audience-signal-block-retry')).toBeNull();
    expect(c['canSubmit']()).toBe(false);
  });

  it.each([['failed'], ['unknown'], ['ready']])('offers a Retry, not the denial, when the read is %s and the answer is still out', async (capabilityRead) => {
    await setup();
    const retried = vi.fn();
    fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
    const c = holdSignal(null, capabilityRead as 'failed' | 'unknown' | 'ready');

    expect(c['performanceMaxAudienceSignalBlock']()?.kind).toBe('failed');
    expect(fixture.nativeElement.textContent).not.toContain(DENIAL);
    expect(c['canSubmit']()).toBe(false);
    (query('implementation-performance-max-audience-signal-block-retry')?.querySelector('button') as HTMLButtonElement).click();
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it('asks for the brief to be saved when there is no brief to check against', async () => {
    await setup();
    const c = holdSignal(null, 'unknown', null);

    expect(c['performanceMaxAudienceSignalBlock']()?.kind).toBe('unsaved');
    expect(query('implementation-performance-max-audience-signal-block-retry')).toBeNull();
  });

  it('holds Create with the restricted block on an explicit no, and Remove clears it', async () => {
    await setup();
    const c = holdSignal(false, 'ready');

    expect(c['performanceMaxAudienceSignalBlock']()?.kind).toBe('restricted');
    expect(query('implementation-performance-max-audience-signal-block-restricted')?.textContent).toContain(DENIAL);
    // The section is on screen, so the held value shows there with its own Remove, not again in the block.
    expect(query('implementation-performance-max-audience-signal-remove')).not.toBeNull();
    expect(query('implementation-performance-max-audience-signal-block-value')).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(c['canSubmit']()).toBe(false);

    (query('implementation-performance-max-audience-signal-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['campaignForm'].controls.googlePerformanceMaxAudienceSignal.value).toBe('');
    expect(c['performanceMaxAudienceSignalBlock']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('clears the block once the caller is answered yes on a deployment the cutover serves', async () => {
    await setup();
    const c = holdSignal(null, 'pending');
    fixture.componentRef.setInput('createCapabilityRead', 'ready');
    fixture.componentRef.setInput('googlePerformanceMaxAudienceSignalEnabled', true);
    fixture.detectChanges();

    expect(c['performanceMaxAudienceSignalBlock']()).toBeNull();
    expect(query('implementation-performance-max-audience-signal-block-live')?.textContent?.trim()).toBe('');
    expect((await requestOf(c))['performanceMaxAudienceSignal']).toBe(AUDIENCE_A);
  });

  it.each([
    ['a lone U+FEFF', '\uFEFF'],
    ['a U+FEFF before an id', '\uFEFF42'],
  ])('trims as Go does, so %s is judged and refused rather than omitted or accepted', async (_label, value) => {
    await setup();
    const c = seedPmax();
    restoreGoogleDraft(fixture, c, { includePerformanceMax: true, googlePerformanceMaxAudienceSignal: value });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);
    fixture.detectChanges();

    // JS `trim()` would give '' and '42'; Go's TrimSpace keeps U+FEFF.
    expect(c['performanceMaxAudienceSignal']()).toBe(value);
    expect(c['googlePerformanceMaxAudienceSignalPayload']()).toEqual({ performanceMaxAudienceSignal: value });
    expect(c['performanceMaxAudienceSignalError']()).toContain('is not a Google Ads Audience');
    expect(c['canSubmit']()).toBe(false);
  });

  it('still trims the whitespace Go trims around an id', async () => {
    await setup();
    const c = seedPmax();
    restoreGoogleDraft(fixture, c, { includePerformanceMax: true, googlePerformanceMaxAudienceSignal: '\u00a0\t111\n' });
    expect(c['performanceMaxAudienceSignal']()).toBe('111');
  });

  /** The channel capability read pending or failed: `googleChannelsEnabled` is `null`, so the PMax checkbox is hidden. */
  describe.each([
    ['pending', 'pending'],
    ['failed', 'failed'],
  ] as const)('with the channel capability unanswered (read %s)', (read, kind) => {
    it('keeps the block with its Retry and Remove, and Create held, though selectedGoogleChannels drops Performance Max', async () => {
      await setup();
      const retried = vi.fn();
      fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
      const c = holdSignal(null, read);
      fixture.componentRef.setInput('googleChannelsEnabled', null);
      fixture.componentRef.setInput('googleCreativeEnabled', null);
      fixture.detectChanges();

      expect(c['selectedGoogleChannels']()).not.toContain('performance-max');
      expect(query('implementation-include-performance-max')).toBeNull();
      expect(c['performanceMaxAudienceSignalBlock']()?.kind).toBe(kind);
      expect(c['canSubmit']()).toBe(false);
      expect(query('implementation-performance-max-audience-signal-block-remove')).not.toBeNull();
      if (kind === 'failed') {
        (query('implementation-performance-max-audience-signal-block-retry')?.querySelector('button') as HTMLButtonElement).click();
        expect(retried).toHaveBeenCalledTimes(1);
      }
    });

    it('falls back to the Search checkbox on Remove, the PMax checkbox being hidden and Create disabled', async () => {
      await setup();
      const focused: HTMLElement[] = [];
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
        focused.push(this);
      });
      const c = holdSignal(null, read);
      fixture.componentRef.setInput('googleChannelsEnabled', null);
      fixture.detectChanges();

      (query('implementation-performance-max-audience-signal-block-remove')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(c['performanceMaxAudienceSignalBlock']()).toBeNull();
      expect(focused.at(-1)).toBe(query('implementation-include-search'));
    });
  });

  /**
   * PR #5393 review: the block reads the channel box from the form, which is not a signal, and the signal
   * value does not change on a switch, so the block must read the form's revision to follow the switch.
   */
  it.each([
    ['denied', false, 'ready', 'restricted'],
    ['unanswered', null, 'failed', 'failed'],
  ] as const)('follows a channel switch away and back with access %s', async (_label, enabled, read, kind) => {
    await setup();
    const c = holdSignal(enabled, read);
    expect(c['performanceMaxAudienceSignalBlock']()?.kind).toBe(kind);

    for (const away of [{ includeSearch: true }, { includeDisplay: true }]) {
      c['campaignForm'].patchValue({ includePerformanceMax: false, ...away });
      fixture.detectChanges();
      expect(c['performanceMaxAudienceSignalBlock']()).toBeNull();

      c['campaignForm'].patchValue({ includePerformanceMax: true, includeSearch: false, includeDisplay: false });
      fixture.detectChanges();
      expect(c['performanceMaxAudienceSignalBlock']()?.kind).toBe(kind);
    }
  });

  it('clears the block only once the channel capability is answered no, which drops Performance Max', async () => {
    await setup();
    const c = holdSignal(null, 'failed');
    fixture.componentRef.setInput('googleChannelsEnabled', null);
    fixture.detectChanges();
    expect(c['performanceMaxAudienceSignalBlock']()?.kind).toBe('failed');

    fixture.componentRef.setInput('googleChannelsEnabled', false);
    fixture.detectChanges();
    expect(c['performanceMaxAudienceSignalBlock']()).toBeNull();
  });

  it('holds Create naming the deployment while the cutover is dark, listing the signal with Remove', async () => {
    await setup();
    const focused: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    const c = holdSignal(false, 'ready', 'brief-1', false);

    expect(c['googlePerformanceMaxAudienceSignalPayload']()).toEqual({});
    expect(c['performanceMaxAudienceSignalBlock']()?.kind).toBe('unsupported');
    expect(query('implementation-performance-max-audience-signal-block-unsupported')?.textContent).toContain('not available on this deployment');
    expect(query('implementation-performance-max-audience-signal-block-value')?.textContent).toContain(`Audience signal: ${AUDIENCE_A}`);
    expect(query('implementation-performance-max-audience-signal-section')).toBeNull();
    expect(c['canSubmit']()).toBe(false);

    (query('implementation-performance-max-audience-signal-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(c['performanceMaxAudienceSignalBlock']()).toBeNull();
    expect(focused.at(-1)?.closest('[data-testid]')?.getAttribute('data-testid')).toMatch(/implementation-(submit-btn|include-performance-max)/);
  });
});

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
    fixture = TestBed.createComponent(ImplementationTabComponent);
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

  it('round-trips the picks through the draft, keeping strings only', async () => {
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
  it('clears the interest search when the form resets for a brief', async () => {
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

    it('clears once the caller is answered yes', async () => {
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
