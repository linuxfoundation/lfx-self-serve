// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DEFAULT_META_AUDIENCE_TARGETING } from '@lfx-one/shared/constants';
import type {
  CampaignBriefOutput,
  CampaignBriefPersistenceState,
  CampaignCapabilityReadState,
  CampaignImplementationDraft,
  MetaAudienceTargetingDraft,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { NEVER, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { SEED_KEYWORD, stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * The submit gate, which is the only place the brief-save race is observable.
 *
 * The parent sets `briefId: null` for the duration of a save. With the creation cutover on, the
 * create needs that id — and `createCampaigns` refuses an empty one TERMINALLY, with no
 * fall-through to the legacy path. So a user who submits during that window used to be told
 * "brief has not been saved yet" about a brief that was being saved as they clicked.
 */
describe('ImplementationTabComponent submit gate', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  /** `canSubmit` is protected; read it the way the sibling campaign specs do. */
  function canSubmit(): boolean {
    return (fixture.componentInstance as unknown as { canSubmit(): boolean }).canSubmit();
  }

  /**
   * Fill everything `canSubmit` requires so persistence state is the only remaining variable.
   *
   * Google is selected, so the whole `campaignForm` must be valid — including the `headlines` and
   * `descriptions` FormArrays, whose first control is `Validators.required` and starts empty.
   */
  function makeOtherwiseValid(): void {
    const c = fixture.componentInstance as unknown as {
      selectedPlatforms: { set(v: string[]): void };
      briefKeywords: { set(v: unknown[]): void };
      campaignForm: {
        controls: Record<string, { setValue(v: unknown): void }>;
        get(name: string): { controls: { setValue(v: unknown): void }[] } | null;
      };
    };
    c.selectedPlatforms.set(['google-ads']);
    // A Search create needs a keyword (#4848).
    c.briefKeywords.set([SEED_KEYWORD]);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://events.example.com/kubecon-eu-2026');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    c.campaignForm.controls['includeSearch'].setValue(true);
    c.campaignForm.controls['includeDemandGen'].setValue(false);
    c.campaignForm.get('headlines')?.controls.forEach((ctrl) => ctrl.setValue('Attend KubeCon'));
    c.campaignForm.get('descriptions')?.controls.forEach((ctrl) => ctrl.setValue('Join us in September'));
    fixture.detectChanges();
  }

  function setPersistence(state: CampaignBriefPersistenceState): void {
    fixture.componentRef.setInput('briefPersistence', state);
    fixture.detectChanges();
  }

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

  it('blocks submit while a brief save is in flight', STATE_ONLY, async () => {
    makeOtherwiseValid();
    expect(canSubmit()).toBe(true);

    setPersistence({ status: 'saving', briefId: null, message: null, approved: false });

    expect(canSubmit()).toBe(false);
  });

  it('re-enables submit once the save lands', STATE_ONLY, async () => {
    makeOtherwiseValid();
    setPersistence({ status: 'saving', briefId: null, message: null, approved: false });
    expect(canSubmit()).toBe(false);

    setPersistence({ status: 'saved', briefId: 'brief-1', message: null, approved: true });

    expect(canSubmit()).toBe(true);
  });

  /**
   * A conflict outcome carries the STORED row's `briefId`, which by definition is not the brief on
   * screen — the save was refused precisely because the two disagree. Creating from it would
   * launch paid campaigns off someone else's version while the user reads their own unsaved copy.
   * The id being present is what makes it dangerous, so a null-id guard would not catch it.
   */
  it('blocks submit when a save conflicted, even though it carries a brief id', STATE_ONLY, async () => {
    makeOtherwiseValid();

    setPersistence({ status: 'error', briefId: 'brief-stored-1', message: 'This brief changed elsewhere.', approved: false });

    expect(canSubmit()).toBe(false);
  });

  /**
   * The other half of `error`, and the reason the guard keys on the brief id rather than the
   * status. A save that simply FAILED carries no id, and its own banner tells the user "You can
   * continue setting up the campaign" — so disabling Create here would contradict the message
   * they are reading. With the cutover dark the legacy create needs no brief id at all.
   */
  it('does not block submit when a save failed without leaving a brief id', STATE_ONLY, async () => {
    makeOtherwiseValid();

    setPersistence({
      status: 'error',
      briefId: null,
      message: 'This brief could not be saved — it will be lost if you reload. You can continue setting up the campaign.',
      approved: false,
    });

    expect(canSubmit()).toBe(true);
  });

  /**
   * The FIRST save of a session, which the status alone cannot express.
   *
   * `CampaignsComponent` leaves `briefPersistence` at `off` while that save is in flight — the
   * persistence flag lives on the server and is unknown until the response lands, so showing a
   * spinner would put a banner in front of every user in every environment where the cutover is
   * dark. The parent also switches to Implementation before the save starts, so a fast click was
   * reaching a create with `briefId: ''` and the terminal "brief has not been saved yet" refusal.
   */
  it('blocks submit during the first save, when the status still reads off', STATE_ONLY, async () => {
    makeOtherwiseValid();
    setPersistence({ status: 'off', briefId: null, message: null, approved: false });
    expect(canSubmit()).toBe(true);

    fixture.componentRef.setInput('briefSaveInFlight', true);
    fixture.detectChanges();

    expect(canSubmit()).toBe(false);
  });

  /**
   * A durable but unapproved brief. `saved` is honest — the write landed — but campaign-service
   * refuses a create from it (`BriefService.CreateCampaigns`, 400 "brief must be approved before creating
   * campaigns"), so leaving Create enabled invited the user to discover that the hard way.
   */
  it('blocks submit when the brief saved but was not approved', STATE_ONLY, async () => {
    makeOtherwiseValid();

    setPersistence({
      status: 'saved',
      briefId: 'brief-1',
      message: 'This brief was saved but not approved, so campaigns cannot be created from it yet.',
      approved: false,
    });

    expect(canSubmit()).toBe(false);
  });

  /**
   * A RESTORED brief arrives as `off` with its own id, and Planning deliberately allows restoring
   * an unapproved one. campaign-service still refuses to create from it, so the id — not the
   * status — is what separates a restored brief from the cutover-dark case below.
   */
  it('blocks submit for a restored brief that was never approved', STATE_ONLY, async () => {
    makeOtherwiseValid();

    setPersistence({ status: 'off', briefId: 'brief-restored-1', message: null, approved: false });

    expect(canSubmit()).toBe(false);
  });

  it('allows submit for a restored brief that IS approved', STATE_ONLY, async () => {
    makeOtherwiseValid();

    setPersistence({ status: 'off', briefId: 'brief-restored-1', message: null, approved: true });

    expect(canSubmit()).toBe(true);
  });

  it('does not block submit when persistence is off', async () => {
    // The cutover-dark case. `briefId` is null here too, so a guard written as "block on a null
    // brief id" would disable the button permanently — for a path that needs no brief id at all.
    makeOtherwiseValid();

    setPersistence({ status: 'off', briefId: null, message: null, approved: false });

    expect(canSubmit()).toBe(true);
  });

  /**
   * `applyDraft` runs under `untracked` during mount, so it reads `demandGenEnabled` once.
   * If the tab mounts while the request is pending (`null`), it preserves the draft's
   * `includeDemandGen: true`. A later `false` hides the checkbox but `applyDraft` does not
   * re-run — so without this guard a hidden `true` would still satisfy the "Google needs at
   * least one sub-type" check and let the user submit with `demand-gen` silently appended.
   */
  it('blocks submit when Google is selected with only a hidden DemandGen checked', STATE_ONLY, async () => {
    const c = fixture.componentInstance as unknown as {
      selectedPlatforms: { set(v: string[]): void };
      briefKeywords: { set(v: unknown[]): void };
      campaignForm: {
        controls: Record<string, { setValue(v: unknown): void }>;
        get(name: string): { controls: { setValue(v: unknown): void }[] } | null;
      };
    };
    c.selectedPlatforms.set(['google-ads']);
    // A Search create needs a keyword (#4848).
    c.briefKeywords.set([SEED_KEYWORD]);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://events.example.com/kubecon-eu-2026');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    c.campaignForm.controls['includeSearch'].setValue(false);
    // DemandGen is checked in the form (draft restored before capability arrived)
    c.campaignForm.controls['includeDemandGen'].setValue(true);
    c.campaignForm.get('headlines')?.controls.forEach((ctrl) => ctrl.setValue('Attend KubeCon'));
    c.campaignForm.get('descriptions')?.controls.forEach((ctrl) => ctrl.setValue('Join us in September'));
    fixture.detectChanges();

    // Capability now resolves to false — the checkbox is hidden.
    fixture.componentRef.setInput('demandGenEnabled', false);
    fixture.detectChanges();

    // A hidden DemandGen must not satisfy the "at least one Google sub-type" requirement.
    expect(canSubmit()).toBe(false);
  });
});

/**
 * What the create request actually CARRIES for the email channel.
 *
 * The template picker's `selectedEmailTemplateId` was write-only before this: set on click, read
 * only for `aria-pressed` and row styling, and never placed on a request. These assert the value
 * reaches `hubspotConfig.sourceEmailId`, which campaign-service requires with no default.
 */
describe('ImplementationTabComponent hubspotConfig wiring', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  let posted: Record<string, unknown> | null;

  function makeOtherwiseValid(): void {
    const c = fixture.componentInstance as unknown as {
      selectedPlatforms: { set(v: string[]): void };
      briefKeywords: { set(v: unknown[]): void };
      campaignForm: {
        controls: Record<string, { setValue(v: unknown): void }>;
        get(name: string): { controls: { setValue(v: unknown): void }[] } | null;
      };
    };
    c.selectedPlatforms.set(['google-ads']);
    // A Search create needs a keyword (#4848).
    c.briefKeywords.set([SEED_KEYWORD]);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://events.example.com/kubecon-eu-2026');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    c.campaignForm.controls['includeSearch'].setValue(true);
    c.campaignForm.controls['includeDemandGen'].setValue(false);
    c.campaignForm.get('headlines')?.controls.forEach((ctrl) => ctrl.setValue('Attend KubeCon'));
    c.campaignForm.get('descriptions')?.controls.forEach((ctrl) => ctrl.setValue('Join us in September'));
    fixture.detectChanges();
  }

  /** Drive the real `submit()` and capture the body handed to the service. */
  function submitAndCapture(): void {
    (fixture.componentInstance as unknown as { submit(): void }).submit();
  }

  beforeEach(async () => {
    posted = null;
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          // Stubbed at the service boundary rather than the HTTP one: the assertion is about the
          // REQUEST BODY the component builds, and a stub keeps the create from being dispatched
          // anywhere. Nothing here can reach HubSpot or spend money.
          provide: CampaignService,
          useValue: {
            createCampaign: (request: Record<string, unknown>) => {
              posted = request;
              return of({ jobId: '' });
            },
            // `ngOnInit` resolves the LinkedIn ad-account list on mount. Stubbed empty because
            // these tests select google-ads only, so the list is never read.
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('carries the chosen template id as hubspotConfig.sourceEmailId', STATE_ONLY, () => {
    makeOtherwiseValid();
    fixture.componentRef.setInput('sourceEmailId', 'email-123');
    fixture.detectChanges();

    submitAndCapture();

    expect(posted?.['hubspotConfig']).toEqual({ sourceEmailId: 'email-123' });
  });

  it('omits hubspotConfig entirely when no template is chosen', STATE_ONLY, () => {
    // The paid-only path, which is every create today. An empty-but-present config would be a
    // configured-looking email channel on a campaign that has none.
    makeOtherwiseValid();

    submitAndCapture();

    expect(posted).not.toHaveProperty('hubspotConfig');
  });

  it('treats a whitespace-only template id as no selection, matching the server', STATE_ONLY, () => {
    // `buildHubSpotConfig` trims and returns null (UNCONFIGURED) for a blank id. Sending
    // `{ sourceEmailId: '   ' }` would claim a template was picked and be refused upstream.
    makeOtherwiseValid();
    fixture.componentRef.setInput('sourceEmailId', '   ');
    fixture.detectChanges();

    submitAndCapture();

    expect(posted).not.toHaveProperty('hubspotConfig');
  });

  it('trims a padded template id rather than sending the padding', STATE_ONLY, () => {
    makeOtherwiseValid();
    fixture.componentRef.setInput('sourceEmailId', '  email-456  ');
    fixture.detectChanges();

    submitAndCapture();

    expect(posted?.['hubspotConfig']).toEqual({ sourceEmailId: 'email-456' });
  });
});

/**
 * A brief saved BEFORE a platform was disabled must not restore that platform.
 *
 * The Plan picker gates `disabled` at the tile, but a stored brief reaches `selectedPlatforms`
 * through `populateFromBrief`, which never consults the picker. Without a filter there, a brief
 * naming a since-disabled platform still submits that platform's config on brief-derived values
 * the user never saw — and the disabled tile means they cannot deselect it either.
 *
 * X (`twitter-ads`) was the example here until its create landed behind `twitterCreateEnabled`.
 * Its `disabled` is now a static default the capability overrides, so the seed KEEPS it and the
 * X section's `twitterCreateBlock` holds it instead (see the X create spec). No other platform is
 * disabled today, so the drop rule is pinned with a platform id this app does not know at all.
 */
describe('ImplementationTabComponent brief restore', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function selectedPlatforms(): string[] {
    return [...(fixture.componentInstance as unknown as { selectedPlatforms(): string[] }).selectedPlatforms()];
  }

  function restore(platforms: string[]): void {
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com' },
      selectedPlatforms: platforms,
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  }

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

  it('drops a platform that is not selectable from a restored brief', STATE_ONLY, () => {
    restore(['google-ads', 'tiktok-ads']);

    expect(selectedPlatforms()).not.toContain('tiktok-ads');
    // The enabled sibling must SURVIVE — a filter that dropped everything would pass a
    // not-toContain assertion on its own while silently discarding the user's real choice.
    expect(selectedPlatforms()).toContain('google-ads');
  });

  it('keeps X from a restored brief, to be held by the X section rather than dropped', STATE_ONLY, () => {
    restore(['google-ads', 'twitter-ads']);

    expect(selectedPlatforms()).toEqual(['google-ads', 'twitter-ads']);
  });

  it('selects nothing for an all-unselectable brief rather than substituting a default', STATE_ONLY, () => {
    restore(['tiktok-ads']);

    // NOT ['google-ads']. Retaining the default would open a brief for a disabled platform as a
    // GOOGLE campaign, and submit() builds its request from this signal — the user would
    // dispatch a platform they never chose. Empty leaves canSubmit() blocking, which is honest.
    expect(selectedPlatforms()).toEqual([]);
  });
});

/**
 * #4731. The `unowned-brief-exists` refusal is the one save failure Retry cannot clear and Restore
 * escapes only by discarding the brief on screen, so the banner offers Replace saved brief on it —
 * and on nothing else.
 */
describe('ImplementationTabComponent replace saved brief', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function setPersistence(state: CampaignBriefPersistenceState, inFlight = false): void {
    fixture.componentRef.setInput('briefPersistence', state);
    fixture.componentRef.setInput('briefSaveInFlight', inFlight);
    fixture.detectChanges();
  }

  function replaceButton(): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-brief-replace-btn"]');
  }

  const refused: CampaignBriefPersistenceState = {
    status: 'error',
    briefId: '',
    message: 'This event already has a saved brief for this send that was not opened here, so this one was not saved over it.',
    approved: false,
    conflict: 'unowned-brief-exists',
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

  it('offers Replace saved brief on an unowned-brief-exists refusal', () => {
    setPersistence(refused);
    expect(replaceButton()).not.toBeNull();
  });

  it('asks the parent to replace when clicked', () => {
    setPersistence(refused);
    const emitted = vi.fn();
    fixture.componentInstance.replaceSavedBriefRequested.subscribe(emitted);

    // The inner native button: `(onClick)` is the wrapper's gated output, which a host click skips.
    replaceButton()?.querySelector('button')?.click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('does not offer it on any other save error', () => {
    setPersistence({ ...refused, conflict: 'stale-brief' });
    expect(replaceButton()).toBeNull();

    setPersistence({ ...refused, conflict: undefined });
    expect(replaceButton()).toBeNull();
  });

  it('withholds it while a save is in flight', () => {
    setPersistence(refused, true);
    expect(replaceButton()).toBeNull();
  });

  /** #4983: the other way out of the same refusal — keep the saved brief and edit it. */
  it('offers Open to edit beside Replace, and asks the parent to open the saved brief', () => {
    setPersistence(refused);
    const open = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-brief-open-saved-btn"]');
    expect(open, 'no Open to edit on the unowned refusal').not.toBeNull();
    const emitted = vi.fn();
    fixture.componentInstance.openSavedBriefRequested.subscribe(emitted);

    open?.querySelector('button')?.click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });
});

/**
 * #4983. Edit brief reopens this tab's brief in the Plan editor, except while a create job is being
 * polled: saving from the editor resets the brief to `draft` under a job already running from it.
 */
describe('ImplementationTabComponent edit brief', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const brief = {
    eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/kubecon', countryCode: 'US' },
    selectedPlatforms: ['google-ads'],
  } as unknown as CampaignBriefOutput;

  const button = (): HTMLButtonElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="implementation-edit-brief-btn"] button');

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
    fixture.componentRef.setInput('briefData', brief);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('asks the parent to reopen the brief in the Plan editor', () => {
    const emitted = vi.fn();
    fixture.componentInstance.editBriefRequested.subscribe(emitted);

    expect(button()?.disabled).toBe(false);
    button()?.click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('is not offered on the unowned-brief refusal, where Open to edit and Replace are the ways out', () => {
    fixture.componentRef.setInput('briefPersistence', {
      status: 'error',
      briefId: '',
      message: 'refused',
      approved: false,
      conflict: 'unowned-brief-exists',
    } as CampaignBriefPersistenceState);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-edit-brief-btn"]')).toBeNull();
  });

  it('says why the last Edit brief opened nothing', () => {
    fixture.componentRef.setInput('editBriefError', 'The saved brief could not be read, so nothing was opened. Try Edit brief again.');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-edit-brief-error"]')?.textContent).toContain('could not be read');
  });

  it('tells the parent a create job is starting', STATE_ONLY, () => {
    const started = vi.fn();
    fixture.componentInstance.createStarted.subscribe(started);
    vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(NEVER);
    vi.spyOn(fixture.componentInstance as unknown as { canSubmit(): boolean }, 'canSubmit').mockReturnValue(true);

    (fixture.componentInstance as unknown as { submit(): void }).submit();

    expect(started).toHaveBeenCalledTimes(1);
  });

  it('is disabled, with the reason beside it, while a create job is polling', () => {
    (fixture.componentInstance as unknown as { step: WritableSignal<string> }).step.set('creating');
    fixture.detectChanges();

    expect(button()?.disabled, 'Edit brief stayed enabled under a running create job').toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-edit-brief-hint"]')?.textContent).toContain(
      'Available once campaign creation finishes'
    );
  });
});

/**
 * Meta audience targeting (#5905), behind `metaAudienceTargetingEnabled`, with custom audiences behind the
 * per-caller `metaCustomAudiencesEnabled`. Sent compacted only on an explicit yes; targeting the request
 * cannot carry HOLDS Create (never dropped) with a way to clear it; a refusal of the child's rules holds it too.
 */
describe('ImplementationTabComponent meta audience targeting', () => {
  let createCampaign: ReturnType<typeof vi.fn>;

  const brief = (slug = 'kubecon-eu-2026'): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug, countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['meta-ads'],
      metaCopy: { variants: [{ primaryText: 'Primary', headline: 'Headline', description: '' }], recommendedGeos: ['US'] },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;
  const c = (f: ComponentFixture<ImplementationTabComponent>): Record<string, any> => f.componentInstance as unknown as Record<string, any>;
  const query = (f: ComponentFixture<ImplementationTabComponent>, testId: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${testId}"]`);

  const setFoundation = (slug: string): void =>
    TestBed.inject(ProjectContextService).setFoundation({ uid: `uid-${slug}`, slug, name: slug } as ProjectContext, false);
  /** A draft holding `targeting`, saved under foundation `tlf`. */
  const held = (targeting: Partial<MetaAudienceTargetingDraft>): Record<string, unknown> => ({
    metaAudienceTargeting: { ...DEFAULT_META_AUDIENCE_TARGETING, ...targeting },
    metaAudienceTargetingProject: 'tlf',
  });

  async function mount(
    enabled: boolean | null,
    customAudiences: boolean | null,
    draft?: Record<string, unknown>,
    read: CampaignCapabilityReadState = 'ready'
  ): Promise<{ f: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    f.componentRef.setInput('createCapabilityRead', read);
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    f.componentRef.setInput('metaAudienceTargetingEnabled', enabled);
    f.componentRef.setInput('metaCustomAudiencesEnabled', customAudiences);
    if (draft) f.componentRef.setInput('draft', { eventSlug: 'kubecon-eu-2026', headlines: [''], descriptions: [''], ...draft });
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    c(f)['selectedPlatforms'].set(['meta-ads']);
    c(f)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c(f)['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c(f)['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c(f)['campaignForm'].controls['endDate'].setValue('2026-09-30');
    f.detectChanges();
    await f.whenStable();
    return { f, latest: () => captured };
  }

  async function edit(f: ComponentFixture<ImplementationTabComponent>, targeting: Partial<MetaAudienceTargetingDraft>): Promise<void> {
    c(f)['onMetaAudienceTargetingChange']({ ...DEFAULT_META_AUDIENCE_TARGETING, ...targeting });
    f.detectChanges();
    await f.whenStable();
  }

  async function submittedMeta(f: ComponentFixture<ImplementationTabComponent>): Promise<Record<string, unknown>> {
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    await f.whenStable();
    return createCampaign.mock.calls.at(-1)?.[0]['metaConfig'];
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
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
            getMetaCustomAudiences: () => of({ accountId: 'act_1', audiences: [], truncated: false }),
            // The slot grid reads the plan once the brief is saved, as in the suites above.
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
    TestBed.inject(ProjectContextService).setRouteLensKind('foundation');
    setFoundation('tlf');
  });

  it('sends the compacted targeting only on an explicit yes', async () => {
    const { f } = await mount(true, true);
    expect(query(f, 'implementation-meta-audience-targeting')).not.toBeNull();
    // The custom-audiences answer reaches the child, which offers the picker before any audience is chosen.
    expect(query(f, 'meta-audience-targeting-custom-audiences')).not.toBeNull();
    await edit(f, { ageMin: 25, genders: ['female'], customAudiences: ['1001'] });

    expect((await submittedMeta(f))['targeting']).toEqual({ ageMin: 25, genders: ['female'], customAudiences: ['1001'] });

    const off = await mount(false, false);
    expect(query(off.f, 'implementation-meta-audience-targeting')).toBeNull();
    expect('targeting' in (await submittedMeta(off.f))).toBe(false);
  });

  it("holds Create on the child's own refusal", STATE_ONLY, async () => {
    const { f } = await mount(true, false);
    await edit(f, { ageMin: 30, advantageAudience: true });

    expect(c(f)['createBlockedReason']()).toContain('Advantage+ audience');
  });

  // Wiring for the hold with Remove; the unanswered (`failed`, `pending`) kinds are rows in `metaAudienceTargetingBlock`'s helper table.
  it('holds Create, keeping each audience removable, when custom audiences are restricted for the caller', async () => {
    const { f } = await mount(true, false, held({ excludedCustomAudiences: ['1001'] }));

    expect(c(f)['createBlockedReason']()).toContain('custom audiences');
    expect(query(f, 'implementation-meta-audience-targeting-block-restricted')).not.toBeNull();
    expect(query(f, 'implementation-meta-audience-targeting-clear')).toBeNull();
    query(f, 'meta-audience-targeting-excludedCustomAudiences-remove-1001')?.click();
    f.detectChanges();

    expect(c(f)['createBlockedReason']()).toBeNull();
  });

  it('holds Create for targeting this deployment answered no to, offering Clear', async () => {
    const { f } = await mount(false, false, held({ ageMax: 44 }));

    expect(query(f, 'implementation-meta-audience-targeting-block-unsupported')).not.toBeNull();
    query(f, 'implementation-meta-audience-targeting-clear')?.querySelector('button')?.click();
    f.detectChanges();

    expect('targeting' in (await submittedMeta(f))).toBe(false);
  });

  // An unanswered capability (the list loading or failed) is not a no: Create waits, and nothing destructive is offered.
  // The `failed` and `unsaved` kinds are rows in `metaAudienceTargetingBlock`'s helper table.
  it('holds Create without offering Clear while the capability read is pending', async () => {
    const { f } = await mount(null, null, held({ advantageAudience: false }), 'pending');

    expect(c(f)['createBlockedReason']()).toContain('Meta audience targeting');
    expect(query(f, 'implementation-meta-audience-targeting-block-pending')).not.toBeNull();
    expect(query(f, 'implementation-meta-audience-targeting-clear')).toBeNull();
  });

  it("drops the previous foundation's targeting on a foundation switch, live and from the saved draft", STATE_ONLY, async () => {
    const { f, latest } = await mount(true, true);
    await edit(f, { ageMin: 30, customAudiences: ['1001'] });
    const savedUnderA = latest();

    setFoundation('cncf');
    f.detectChanges();
    await f.whenStable();
    expect(c(f)['metaAudienceTargeting']()).toEqual(DEFAULT_META_AUDIENCE_TARGETING);
    expect(latest()?.metaAudienceTargeting).toEqual(DEFAULT_META_AUDIENCE_TARGETING);

    const remounted = await mount(true, true, { ...savedUnderA });
    expect(c(remounted.f)['metaAudienceTargeting']()).toEqual(DEFAULT_META_AUDIENCE_TARGETING);
  });

  it('saves the targeting to the draft, restores it, and clears it on a brief switch', STATE_ONLY, async () => {
    const { f, latest } = await mount(true, true);
    await edit(f, { genders: ['male'], customAudiences: ['1001'] });
    expect(latest()?.metaAudienceTargeting).toMatchObject({ genders: ['male'], customAudiences: ['1001'] });

    const restored = await mount(true, true, { ...latest() });
    expect(c(restored.f)['metaAudienceTargeting']()).toMatchObject({ genders: ['male'], customAudiences: ['1001'] });

    f.componentRef.setInput('draft', null);
    f.componentRef.setInput('briefData', brief('oss-na-2026'));
    f.detectChanges();
    await f.whenStable();
    expect(c(f)['metaAudienceTargeting']()).toEqual(DEFAULT_META_AUDIENCE_TARGETING);
  });
});

/**
 * The Meta call to action, conversion event and optimization goal (#5934), one capability each in
 * `metaAdOptionsEnabled`. A dropdown shows on an explicit yes where the objective fits; "Not set" sends
 * nothing; a choice the request cannot carry HOLDS Create (never dropped); objective and foundation changes clear.
 */
describe('ImplementationTabComponent meta ad options', () => {
  let createCampaign: ReturnType<typeof vi.fn>;
  const allOn = { callToAction: true, conversionEvent: true, optimizationGoal: true };

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['meta-ads'],
      metaCopy: { variants: [{ primaryText: 'Primary', headline: 'Headline', description: '' }], recommendedGeos: ['US'] },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;
  const c = (f: ComponentFixture<ImplementationTabComponent>): Record<string, any> => f.componentInstance as unknown as Record<string, any>;
  const query = (f: ComponentFixture<ImplementationTabComponent>, testId: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const setFoundation = (slug: string): void =>
    TestBed.inject(ProjectContextService).setFoundation({ uid: `uid-${slug}`, slug, name: slug } as ProjectContext, false);

  async function mount(
    enabled: Record<string, boolean | null>,
    draft?: Record<string, unknown>,
    read: CampaignCapabilityReadState = 'ready'
  ): Promise<{ f: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    f.componentRef.setInput('createCapabilityRead', read);
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('biddingEnabled', true);
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    f.componentRef.setInput('metaAdOptionsEnabled', enabled);
    if (draft) f.componentRef.setInput('draft', { eventSlug: 'kubecon-eu-2026', headlines: [''], descriptions: [''], ...draft });
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    c(f)['selectedPlatforms'].set(['meta-ads']);
    c(f)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c(f)['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c(f)['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c(f)['campaignForm'].controls['endDate'].setValue('2026-09-30');
    f.detectChanges();
    await f.whenStable();
    return { f, latest: () => captured };
  }

  const choose = (f: ComponentFixture<ImplementationTabComponent>, key: string, value: string): void => {
    c(f)['onMetaAdOptionChange'](key, value);
    f.detectChanges();
  };
  const objective = (f: ComponentFixture<ImplementationTabComponent>, value: string): void => {
    c(f)['onMetaObjectiveChange']({ target: { value } });
    c(f)['metaPixelId'].set('123');
    f.detectChanges();
  };

  async function submittedMeta(f: ComponentFixture<ImplementationTabComponent>): Promise<Record<string, unknown>> {
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    await f.whenStable();
    return createCampaign.mock.calls.at(-1)?.[0]['metaConfig'];
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
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
    TestBed.inject(ProjectContextService).setRouteLensKind('foundation');
    setFoundation('tlf');
  });

  it('offers each dropdown only on an explicit yes and where the objective fits', async () => {
    const { f } = await mount({ callToAction: true, conversionEvent: true, optimizationGoal: null });
    expect(query(f, 'implementation-meta-callToAction')).not.toBeNull();
    expect(query(f, 'implementation-meta-conversionEvent')).toBeNull();
    expect(query(f, 'implementation-meta-optimizationGoal')).toBeNull();

    objective(f, 'conversions');
    expect(query(f, 'implementation-meta-conversionEvent')).not.toBeNull();
  });

  it('sends the chosen values, and nothing for "Not set"', STATE_ONLY, async () => {
    const { f } = await mount(allOn);
    choose(f, 'callToAction', 'SIGN_UP');
    choose(f, 'optimizationGoal', 'LANDING_PAGE_VIEWS');
    expect(await submittedMeta(f)).toMatchObject({ callToAction: 'SIGN_UP', optimizationGoal: 'LANDING_PAGE_VIEWS' });

    choose(f, 'callToAction', '');
    choose(f, 'optimizationGoal', '');
    const sent = await submittedMeta(f);
    expect('callToAction' in sent || 'optimizationGoal' in sent || 'conversionEvent' in sent).toBe(false);
  });

  it('clears a choice the new objective does not take', STATE_ONLY, async () => {
    const { f, latest } = await mount(allOn);
    choose(f, 'callToAction', 'BOOK_NOW');
    choose(f, 'optimizationGoal', 'LANDING_PAGE_VIEWS');
    objective(f, 'conversions');

    expect(c(f)['metaAdOptions']()).toEqual({ callToAction: 'BOOK_NOW' });
    expect(latest()?.metaAdOptions).toEqual({ callToAction: 'BOOK_NOW' });
  });

  it('refuses landing page views under manual bidding, disabling the option', async () => {
    const { f } = await mount(allOn);
    choose(f, 'optimizationGoal', 'LANDING_PAGE_VIEWS');
    c(f)['biddingDrafts'].set({ 'meta-ads': { strategy: 'manual', bidAmount: 1 } });
    f.detectChanges();

    expect(c(f)['createBlockedReason']()).toContain('manual bidding');
    expect(query(f, 'implementation-meta-ad-options-error')).not.toBeNull();
    const views: { key: string; options: { value: string; disabled: boolean }[] }[] = c(f)['metaAdOptionViews']();
    const goal = views.find((view) => view.key === 'optimizationGoal');
    expect(goal?.options.find((option) => option.value === 'LANDING_PAGE_VIEWS')?.disabled).toBe(true);
  });

  // An unanswered capability (the read loading or failed) is not a no: Create waits, and Clear is not offered.
  // The `failed` and `unsaved` kinds are rows in `metaAdOptionsBlock`'s helper table; the Retry test below renders `failed`.
  it('holds a restored choice without offering Clear while the capability read is pending', async () => {
    const { f } = await mount({ callToAction: null }, { metaAdOptions: { callToAction: 'SIGN_UP' }, metaAdOptionsProject: 'tlf' }, 'pending');

    expect(c(f)['createBlockedReason']()).toContain('call to action');
    expect(query(f, 'implementation-meta-ad-options-block-pending')).not.toBeNull();
    expect(query(f, 'implementation-meta-ad-options-clear')).toBeNull();
  });

  it('asks the parent to retry the capability check from the failed hold', async () => {
    const { f } = await mount({ callToAction: null }, { metaAdOptions: { callToAction: 'SIGN_UP' }, metaAdOptionsProject: 'tlf' }, 'failed');
    const retry = vi.fn();
    f.componentInstance.retryCreateCapabilities.subscribe(retry);

    query(f, 'implementation-meta-ad-options-block-retry')?.querySelector('button')?.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('holds a choice this deployment answered no to, offering Clear', async () => {
    const { f } = await mount({ callToAction: false }, { metaAdOptions: { callToAction: 'SIGN_UP' }, metaAdOptionsProject: 'tlf' });

    expect(query(f, 'implementation-meta-ad-options-block-unsupported')).not.toBeNull();
    query(f, 'implementation-meta-ad-options-clear')?.querySelector('button')?.click();
    f.detectChanges();

    expect('callToAction' in (await submittedMeta(f))).toBe(false);
  });

  it('resets the choices on a foundation switch, and restores a draft only under its own foundation', STATE_ONLY, async () => {
    const { f, latest } = await mount(allOn);
    choose(f, 'callToAction', 'CONTACT_US');
    const savedUnderTlf = latest();
    expect(savedUnderTlf).toMatchObject({ metaAdOptions: { callToAction: 'CONTACT_US' }, metaAdOptionsProject: 'tlf' });

    const restored = await mount(allOn, { ...savedUnderTlf });
    expect(c(restored.f)['metaAdOptions']()).toEqual({ callToAction: 'CONTACT_US' });

    setFoundation('cncf');
    f.detectChanges();
    await f.whenStable();
    expect(c(f)['metaAdOptions']()).toEqual({});
    expect(latest()?.metaAdOptions).toEqual({});

    const elsewhere = await mount(allOn, { ...savedUnderTlf });
    expect(c(elsewhere.f)['metaAdOptions']()).toEqual({});
  });
});
