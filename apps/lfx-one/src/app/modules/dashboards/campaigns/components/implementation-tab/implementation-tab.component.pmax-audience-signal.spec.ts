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
import type { CampaignImplementationDraft, GoogleAdsAudiencesResult, ProjectContext } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { configureGoogleTab, restoreGoogleDraft, seedChannel, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

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
