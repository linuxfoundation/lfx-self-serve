// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft, ProjectContext } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * The LinkedIn targeting profile's facets (#5546): shown under the profile picker, each member group
 * and skill removable, reset to the profile, reseeded on another profile, carried by the draft, and
 * sent as `linkedInConfig.targetingProfileEdit` only when something was removed.
 */
describe('ImplementationTabComponent linkedin targeting facets', () => {
  const EVENT_SLUG = 'kubecon-eu-2026';
  // Synthetic facet ids.
  const PROFILES = [
    { id: 'cloud-native', label: 'Cloud Native', skills: ['urn:li:skill:101', 'urn:li:skill:102'], groups: ['urn:li:group:201', 'urn:li:group:202'] },
    { id: 'mcp', label: 'AI / MCP', skills: ['urn:li:skill:301'], groups: ['urn:li:group:401'] },
  ];

  let createCampaign: ReturnType<typeof vi.fn>;

  const brief = (profile = 'cloud-native'): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: EVENT_SLUG, countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['linkedin-ads'],
      structuredCopy: { google_search: { headlines: ['Attend KubeCon'], descriptions: ['Join us in September'] } },
      linkedInCopy: {
        variants: [{ headline: 'Brief headline', introText: 'Brief intro', destinationUrl: 'https://example.com/brief' }],
        recommendedGeoTargets: [{ urn: 'urn:li:geo:103644278', label: 'United States' }],
        recommendedTargetingProfile: profile,
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  interface Internals {
    campaignForm: { controls: Record<string, { setValue(v: unknown): void; value: unknown }> };
    selectedPlatforms: { set(v: string[]): void };
    createBlockedReason: () => string | null;
    submit(): void;
  }
  const at = (f: ComponentFixture<ImplementationTabComponent>): Internals => f.componentInstance as unknown as Internals;

  async function mount(options: {
    draft?: CampaignImplementationDraft | null;
    edit?: boolean | null;
    briefData?: CampaignBriefOutput;
  }): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    if (options.draft) f.componentRef.setInput('draft', options.draft);
    f.componentRef.setInput('linkedInTargetingEditEnabled', options.edit === undefined ? true : options.edit);
    f.componentRef.setInput('briefData', options.briefData ?? brief());
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { fixture: f, latest: () => captured };
  }

  function makeSubmittable(f: ComponentFixture<ImplementationTabComponent>): void {
    const c = at(f);
    c.selectedPlatforms.set(['linkedin-ads']);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    c.campaignForm.controls['linkedInGeoTargets'].setValue([{ urn: 'urn:li:geo:103644278', label: 'United States' }]);
    f.detectChanges();
  }

  function sentLinkedInConfig(): Record<string, unknown> {
    expect(createCampaign).toHaveBeenCalled();
    return createCampaign.mock.calls[0][0]['linkedInConfig'] as Record<string, unknown>;
  }

  const q = (f: ComponentFixture<ImplementationTabComponent>, testid: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;

  function chips(f: ComponentFixture<ImplementationTabComponent>, section: 'groups' | 'skills'): string[] {
    const host = q(f, `implementation-linkedin-targeting-${section}`);
    return Array.from(host?.querySelectorAll('span.font-mono') ?? []).map((el) => (el.textContent ?? '').trim());
  }

  /** The Reset control stays in the layout and is hidden with `invisible`, so the chips don't shift (frontend-checklist §8). */
  function resetHidden(f: ComponentFixture<ImplementationTabComponent>): boolean {
    const el = q(f, 'implementation-linkedin-targeting-reset')!;
    const hidden = el.classList.contains('invisible');
    expect(el.getAttribute('aria-hidden')).toBe(hidden ? 'true' : 'false');
    expect(el.getAttribute('tabindex')).toBe(hidden ? '-1' : null);
    return hidden;
  }

  function removeChip(f: ComponentFixture<ImplementationTabComponent>, urn: string): void {
    const button = f.nativeElement.querySelector(`[data-testid^="implementation-linkedin-targeting-remove-"][aria-label="Remove ${urn}"]`) as HTMLButtonElement;
    button.click();
    f.detectChanges();
  }

  function pickProfile(f: ComponentFixture<ImplementationTabComponent>, profile: 'cloud-native' | 'mcp'): void {
    q(f, `implementation-linkedin-profile-${profile}`)!.click();
    f.detectChanges();
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
            getLinkedInTargetingProfiles: () => of(PROFILES),
          },
        },
      ],
    }).compileComponents();
  });

  it('seeds the facets from the selected profile, with counts', async () => {
    const { fixture } = await mount({});

    expect(chips(fixture, 'groups')).toEqual(['urn:li:group:201', 'urn:li:group:202']);
    expect(chips(fixture, 'skills')).toEqual(['urn:li:skill:101', 'urn:li:skill:102']);
    expect(q(fixture, 'implementation-linkedin-targeting-groups-count')?.textContent).toContain('2 of 2');
    expect(resetHidden(fixture)).toBe(true);
  });

  it("shows cloud-native's facets for a custom selection, which campaign-service reads as cloud-native", async () => {
    const { fixture } = await mount({ briefData: brief('custom') });

    expect(chips(fixture, 'skills')).toEqual(['urn:li:skill:101', 'urn:li:skill:102']);
  });

  it('removes an entry, and resets to the profile', async () => {
    const { fixture } = await mount({});

    removeChip(fixture, 'urn:li:group:201');

    expect(chips(fixture, 'groups')).toEqual(['urn:li:group:202']);
    expect(q(fixture, 'implementation-linkedin-targeting-groups-count')?.textContent).toContain('1 of 2');
    expect(resetHidden(fixture)).toBe(false);

    q(fixture, 'implementation-linkedin-targeting-reset')!.click();
    fixture.detectChanges();

    expect(chips(fixture, 'groups')).toEqual(['urn:li:group:201', 'urn:li:group:202']);
    expect(resetHidden(fixture)).toBe(true);
  });

  it('reseeds from the newly picked profile, dropping removals made against the old one', async () => {
    const { fixture } = await mount({});
    removeChip(fixture, 'urn:li:skill:101');

    pickProfile(fixture, 'mcp');

    expect(chips(fixture, 'skills')).toEqual(['urn:li:skill:301']);
    expect(chips(fixture, 'groups')).toEqual(['urn:li:group:401']);

    pickProfile(fixture, 'cloud-native');

    expect(chips(fixture, 'skills')).toEqual(['urn:li:skill:101', 'urn:li:skill:102']);
  });

  it('keeps removals when Cloud Native is picked on a custom selection, whose facets it already shows', async () => {
    const { fixture } = await mount({ briefData: brief('custom') });
    removeChip(fixture, 'urn:li:skill:101');

    pickProfile(fixture, 'cloud-native');

    expect(chips(fixture, 'skills')).toEqual(['urn:li:skill:102']);
  });

  it('keeps removals when the already-selected profile is picked again', async () => {
    const { fixture } = await mount({});
    removeChip(fixture, 'urn:li:skill:101');

    pickProfile(fixture, 'cloud-native');

    expect(chips(fixture, 'skills')).toEqual(['urn:li:skill:102']);
  });

  it('sends exactly what it always did when nothing was removed', async () => {
    const { fixture } = await mount({});
    makeSubmittable(fixture);
    at(fixture).submit();

    const config = sentLinkedInConfig();
    expect(config).not.toHaveProperty('targetingProfileEdit');
    expect(config['targetingProfile']).toBe('cloud-native');
  });

  it('sends nothing extra after a removal is undone by a reset', async () => {
    const { fixture } = await mount({});
    removeChip(fixture, 'urn:li:skill:101');
    q(fixture, 'implementation-linkedin-targeting-reset')!.click();
    makeSubmittable(fixture);
    at(fixture).submit();

    expect(sentLinkedInConfig()).not.toHaveProperty('targetingProfileEdit');
  });

  it('sends the edited profile, keyed by the profile campaign-service resolves the selection to', async () => {
    const { fixture } = await mount({ briefData: brief('custom') });
    removeChip(fixture, 'urn:li:skill:101');
    removeChip(fixture, 'urn:li:group:202');
    makeSubmittable(fixture);
    at(fixture).submit();

    const config = sentLinkedInConfig();
    expect(config['targetingProfile']).toBe('custom');
    expect(config['targetingProfileEdit']).toEqual({ id: 'cloud-native', skills: ['urn:li:skill:102'], groups: ['urn:li:group:201'] });
  });

  it('warns, without blocking, when every member group and skill is removed', async () => {
    const { fixture } = await mount({});
    for (const urn of ['urn:li:group:201', 'urn:li:group:202', 'urn:li:skill:101', 'urn:li:skill:102']) removeChip(fixture, urn);
    makeSubmittable(fixture);

    expect(q(fixture, 'implementation-linkedin-targeting-empty-warning')).not.toBeNull();
    expect(at(fixture).createBlockedReason()).toBeNull();
    at(fixture).submit();
    expect(sentLinkedInConfig()['targetingProfileEdit']).toEqual({ id: 'cloud-native', skills: [], groups: [] });
  });

  it('shows the profile read-only while the capability is unanswered', async () => {
    const { fixture } = await mount({ edit: null });

    expect(chips(fixture, 'skills')).toEqual(['urn:li:skill:101', 'urn:li:skill:102']);
    expect(fixture.nativeElement.querySelector('[data-testid^="implementation-linkedin-targeting-remove-"]')).toBeNull();
  });

  it('blocks a create holding removals once the capability says no, rather than dropping them', async () => {
    const first = await mount({});
    removeChip(first.fixture, 'urn:li:skill:101');
    const draft = first.latest();
    first.fixture.destroy();

    const { fixture } = await mount({ draft, edit: false });
    makeSubmittable(fixture);

    expect(at(fixture).createBlockedReason()).toBe('LinkedIn Ads: targeting changes are not available right now. Reset the targeting profile.');
  });

  it('blocks a create holding removals while the capability is unanswered, rather than reaching the BFF', async () => {
    const first = await mount({});
    removeChip(first.fixture, 'urn:li:skill:101');
    const draft = first.latest();
    first.fixture.destroy();

    const { fixture } = await mount({ draft, edit: null });
    makeSubmittable(fixture);

    expect(at(fixture).createBlockedReason()).toBe('LinkedIn Ads: targeting changes are not available right now. Reset the targeting profile.');
  });

  it('never blocks an unedited campaign on the capability, whatever it says', async () => {
    for (const edit of [null, false, true]) {
      const { fixture } = await mount({ edit });
      makeSubmittable(fixture);

      expect(at(fixture).createBlockedReason()).toBeNull();
      fixture.destroy();
    }
  });

  it('shows the empty text for each kind once every entry of that kind is removed', async () => {
    const { fixture } = await mount({});
    expect(q(fixture, 'implementation-linkedin-targeting-groups-empty')).toBeNull();
    expect(q(fixture, 'implementation-linkedin-targeting-skills-empty')).toBeNull();

    removeChip(fixture, 'urn:li:group:201');
    removeChip(fixture, 'urn:li:group:202');
    expect(q(fixture, 'implementation-linkedin-targeting-groups-empty')?.textContent).toContain('No member groups');
    expect(q(fixture, 'implementation-linkedin-targeting-skills-empty')).toBeNull();

    removeChip(fixture, 'urn:li:skill:101');
    removeChip(fixture, 'urn:li:skill:102');
    expect(q(fixture, 'implementation-linkedin-targeting-skills-empty')?.textContent).toContain('No skills');
  });

  it("says the profile isn't configured when the catalogue loads without an entry for it", async () => {
    const service = TestBed.inject(CampaignService) as unknown as { getLinkedInTargetingProfiles: () => Observable<unknown> };
    service.getLinkedInTargetingProfiles = () => of([PROFILES[1]]);
    const { fixture } = await mount({});

    expect(q(fixture, 'implementation-linkedin-targeting-unconfigured')?.textContent).toContain("This profile isn't configured on this deployment.");
    expect(q(fixture, 'implementation-linkedin-targeting-groups')).toBeNull();
  });

  it('blocks a create holding removals when the profile catalogue failed to load, rather than sending the profile unedited', async () => {
    const first = await mount({});
    removeChip(first.fixture, 'urn:li:skill:101');
    const draft = first.latest();
    first.fixture.destroy();

    const service = TestBed.inject(CampaignService) as unknown as { getLinkedInTargetingProfiles: () => Observable<unknown> };
    service.getLinkedInTargetingProfiles = () => throwError(() => new Error('unavailable'));
    const { fixture } = await mount({ draft });
    makeSubmittable(fixture);

    expect(q(fixture, 'implementation-linkedin-targeting-error')).not.toBeNull();
    expect(at(fixture).createBlockedReason()).toBe(
      "LinkedIn Ads: the targeting profile's details have not loaded. Reload the page, or reset the targeting profile."
    );

    // The reset the message asks for is offered even though the profile never loaded.
    q(fixture, 'implementation-linkedin-targeting-reset')!.click();
    fixture.detectChanges();
    expect(at(fixture).createBlockedReason()).toBeNull();
  });

  it('reloads the catalogue on a foundation switch, clearing an earlier failure (a 403 on mount must not stick)', async () => {
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-a', slug: 'a', name: 'a' } as ProjectContext, false);
    const calls: string[] = [];
    const service = TestBed.inject(CampaignService) as unknown as { getLinkedInTargetingProfiles: (slug: string) => Observable<unknown> };
    service.getLinkedInTargetingProfiles = (slug: string) => {
      calls.push(slug);
      return calls.length === 1 ? throwError(() => new HttpErrorResponse({ status: 403 })) : of(PROFILES);
    };
    const { fixture } = await mount({});

    expect(calls).toEqual(['a']);
    expect(q(fixture, 'implementation-linkedin-targeting-error')).not.toBeNull();
    expect(chips(fixture, 'groups')).toEqual([]);

    ctx.setFoundation({ uid: 'uid-b', slug: 'b', name: 'b' } as ProjectContext, false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toEqual(['a', 'b']);
    expect(q(fixture, 'implementation-linkedin-targeting-error')).toBeNull();
    expect(chips(fixture, 'groups')).toEqual(['urn:li:group:201', 'urn:li:group:202']);
  });

  it("shows the failure, not the previous foundation's profiles, when the reload after a switch fails", async () => {
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-a', slug: 'a', name: 'a' } as ProjectContext, false);
    const calls: string[] = [];
    const service = TestBed.inject(CampaignService) as unknown as { getLinkedInTargetingProfiles: (slug: string) => Observable<unknown> };
    service.getLinkedInTargetingProfiles = (slug: string) => {
      calls.push(slug);
      return calls.length === 1 ? of(PROFILES) : throwError(() => new HttpErrorResponse({ status: 403 }));
    };
    const { fixture } = await mount({});
    expect(chips(fixture, 'groups')).toEqual(['urn:li:group:201', 'urn:li:group:202']);

    ctx.setFoundation({ uid: 'uid-b', slug: 'b', name: 'b' } as ProjectContext, false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toEqual(['a', 'b']);
    expect(q(fixture, 'implementation-linkedin-targeting-error')).not.toBeNull();
    expect(chips(fixture, 'groups')).toEqual([]);
  });

  it("drops the previous foundation's late profile answer after a foundation switch", async () => {
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-a', slug: 'a', name: 'a' } as ProjectContext, false);
    const answers: Subject<unknown>[] = [];
    const service = TestBed.inject(CampaignService) as unknown as { getLinkedInTargetingProfiles: () => Observable<unknown> };
    service.getLinkedInTargetingProfiles = () => {
      const subject = new Subject<unknown>();
      answers.push(subject);
      return subject.asObservable();
    };
    const { fixture } = await mount({});
    ctx.setFoundation({ uid: 'uid-b', slug: 'b', name: 'b' } as ProjectContext, false);
    fixture.detectChanges();
    expect(answers).toHaveLength(2);

    answers[0].error(new Error('late 403 for a'));
    fixture.detectChanges();
    expect(q(fixture, 'implementation-linkedin-targeting-error')).toBeNull();

    answers[1].next(PROFILES);
    answers[1].complete();
    fixture.detectChanges();
    expect(chips(fixture, 'groups')).toEqual(['urn:li:group:201', 'urn:li:group:202']);
  });

  it('carries the removals through a tab round-trip and into the request', async () => {
    const first = await mount({});
    removeChip(first.fixture, 'urn:li:group:201');
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.linkedInTargetingRemovals).toEqual({ skills: [], groups: ['urn:li:group:201'] });

    const { fixture } = await mount({ draft });

    expect(chips(fixture, 'groups')).toEqual(['urn:li:group:202']);
    makeSubmittable(fixture);
    at(fixture).submit();
    expect(sentLinkedInConfig()['targetingProfileEdit']).toEqual({
      id: 'cloud-native',
      skills: ['urn:li:skill:101', 'urn:li:skill:102'],
      groups: ['urn:li:group:202'],
    });
  });

  it('starts a different brief from the profile as configured', async () => {
    const first = await mount({});
    removeChip(first.fixture, 'urn:li:group:201');

    first.fixture.componentRef.setInput('briefData', { ...brief(), eventDetails: { ...brief().eventDetails, slug: 'another-event' } });
    first.fixture.detectChanges();

    expect(chips(first.fixture, 'groups')).toEqual(['urn:li:group:201', 'urn:li:group:202']);
  });
});

/**
 * X create (`twitterCreateEnabled`, behind `LFX_CUTOVER_CAMPAIGN_SERVICE_TWITTER_CREATE`).
 *
 * `CAMPAIGN_PLATFORMS` keeps X `disabled: true`; the tab consults the capability instead. On an
 * explicit yes the X section collects a budget, the authored tweet and an optional image, and the
 * request carries `twitterConfig` in the wire shape campaign-service decodes. Without one, a brief
 * still holding X blocks Create with a Remove rather than creating the rest without it.
 */
describe('ImplementationTabComponent x create', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  const ASSET_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  let createCampaign: ReturnType<typeof vi.fn>;
  let uploadCreativeAsset: ReturnType<typeof vi.fn>;
  let resumeCreativeAssetUpload: ReturnType<typeof vi.fn>;
  let getTwitterAdsAccounts: ReturnType<typeof vi.fn>;
  const ACCOUNT_ID = '18ce54d4x5t';
  const accounts = (connection: Record<string, unknown>) => of({ accounts: [{ key: ACCOUNT_ID, label: 'Linux Foundation' }], connection });

  const brief = (platforms: string[] = ['twitter-ads']): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2099', slug: 'kubecon-eu-2099', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: platforms,
      structuredCopy: { google_search: { headlines: ['Attend KubeCon'], descriptions: ['Join us in September'] } },
      metaCopy: {
        variants: [{ primaryText: 'Brief primary', headline: 'Brief meta headline', description: 'Brief description' }],
        recommendedGeos: ['US'],
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  const c = (f: ComponentFixture<ImplementationTabComponent>): Record<string, any> => f.componentInstance as unknown as Record<string, any>;
  const q = (f: ComponentFixture<ImplementationTabComponent>, id: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  async function mount(
    enabled: boolean | null,
    options: { platforms?: string[]; draft?: CampaignImplementationDraft | null; read?: 'pending' | 'unknown'; briefId?: string | null; bidding?: boolean } = {}
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    if (options.draft) f.componentRef.setInput('draft', options.draft);
    f.componentRef.setInput('twitterCreateEnabled', enabled);
    if (options.bidding !== undefined) f.componentRef.setInput('biddingEnabled', options.bidding);
    if (options.read) f.componentRef.setInput('createCapabilityRead', options.read);
    const briefId = options.briefId === undefined ? BRIEF_ID : options.briefId;
    f.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: true });
    f.componentRef.setInput('briefData', brief(options.platforms));
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { fixture: f, latest: () => captured };
  }

  function fill(f: ComponentFixture<ImplementationTabComponent>, overrides: Record<string, string> = {}): void {
    const values: Record<string, string> = {
      eventName: 'KubeCon EU 2099',
      registrationUrl: 'https://example.com/kubecon',
      startDate: '2099-09-01',
      endDate: '2099-09-30',
      twitterBudget: '75',
      twitterTweetText: 'Join us at KubeCon',
      ...overrides,
    };
    for (const [control, value] of Object.entries(values)) c(f)['campaignForm'].controls[control].setValue(value);
    f.detectChanges();
  }

  function submitted(f: ComponentFixture<ImplementationTabComponent>): Record<string, any> {
    expect(c(f)['canSubmit']()).toBe(true);
    c(f)['submit']();
    expect(createCampaign).toHaveBeenCalled();
    return createCampaign.mock.calls[createCampaign.mock.calls.length - 1][0];
  }

  function choose(f: ComponentFixture<ImplementationTabComponent>, file: File): void {
    const input = q(f, 'implementation-twitter-image-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  const png = (size = 16): File => new File([new Uint8Array(size)], 'tweet.png', { type: 'image/png' });

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));
    uploadCreativeAsset = vi.fn().mockReturnValue(of({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true }));
    resumeCreativeAssetUpload = vi.fn().mockReturnValue(null);
    getTwitterAdsAccounts = vi.fn().mockReturnValue(accounts({ state: 'connected', accountId: ACCOUNT_ID, label: 'LF X' }));

    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: () => ({ slug: 'tlf' }) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            createCampaign,
            uploadCreativeAsset,
            resumeCreativeAssetUpload,
            forgetCreativeAssetUpload: vi.fn(),
            cancelCreativeAssetUpload: vi.fn(),
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
            getTwitterAdsAccounts,
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  it('sends the twitterConfig wire shape on an explicit yes', async () => {
    const { fixture } = await mount(true);
    fill(fixture, { twitterTweetText: '  Join us at KubeCon  ' });

    const request = submitted(fixture);

    expect(request['platforms']).toEqual(['twitter-ads']);
    expect(request['twitterConfig']).toEqual({ budgetAmount: 75, startDate: '2099-09-01', endDate: '2099-09-30', tweetText: 'Join us at KubeCon' });
  });

  /** A live brief switch (#4624): the budget and tweet typed for one event must not ride into the next. */
  it('drops the typed x budget and tweet text when a different brief is handed over', async () => {
    const { fixture, latest } = await mount(true);
    fill(fixture, { twitterBudget: '75', twitterTweetText: 'See you at KubeCon' });
    expect(latest()).toMatchObject({ twitterBudget: '75', twitterTweetText: 'See you at KubeCon' });

    fixture.componentRef.setInput('draft', null);
    fixture.componentRef.setInput('briefData', { ...brief(), eventDetails: { ...brief().eventDetails, name: 'Open Source Summit', slug: 'oss-na-2099' } });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(latest()).toMatchObject({ eventSlug: 'oss-na-2099', twitterBudget: '', twitterTweetText: '' });
    const box = (testId: string): HTMLInputElement | HTMLTextAreaElement => {
      const el = q(fixture, testId) as HTMLElement;
      return (el.matches('input, textarea') ? el : el.querySelector('input, textarea')) as HTMLInputElement | HTMLTextAreaElement;
    };
    expect(box('implementation-twitter-budget').value).toBe('');
    expect(box('implementation-twitter-tweet-text').value).toBe('');
    // Blank is refused, so the stale values cannot be created by accident; the config Create would build carries neither.
    expect(c(fixture)['canSubmit']()).toBe(false);
    expect(c(fixture)['twitterConfigForCreate']('2099-09-01', '2099-09-30')).toEqual({
      budgetAmount: 0,
      startDate: '2099-09-01',
      endDate: '2099-09-30',
      tweetText: '',
    });
  });

  it('renders the X fields, the no-location note and a preview with the registration link', async () => {
    const { fixture } = await mount(true);
    fill(fixture);

    expect(q(fixture, 'implementation-twitter-budget')).not.toBeNull();
    expect(q(fixture, 'implementation-twitter-tweet-text')).not.toBeNull();
    expect(q(fixture, 'implementation-twitter-no-geo')?.textContent).toContain('no location targeting');
    expect(q(fixture, 'implementation-twitter-preview-text')?.textContent).toContain('Join us at KubeCon');
    expect(q(fixture, 'implementation-twitter-preview-link')?.textContent).toContain('https://example.com/kubecon');
    expect(q(fixture, 'implementation-twitter-tweet-count')?.textContent).toContain('42/280');
  });

  describe.each([
    ['unanswered', null, 'unknown', 'failed'],
    ['being read', null, 'pending', 'pending'],
    ['answered no', false, 'unknown', 'unsupported'],
  ] as const)('while the capability is %s', (_label, enabled, read, kind) => {
    it('holds X behind a block, renders none of its fields and refuses Create', async () => {
      const { fixture } = await mount(enabled, { platforms: ['meta-ads', 'twitter-ads'], read });
      fill(fixture);

      expect(q(fixture, `implementation-twitter-create-block-${kind}`)).not.toBeNull();
      expect(q(fixture, 'implementation-twitter-budget')).toBeNull();
      expect(c(fixture)['canSubmit']()).toBe(false);
    });

    it('lets the operator remove X and create the rest without it', async () => {
      const { fixture } = await mount(enabled, { platforms: ['meta-ads', 'twitter-ads'], read });
      fill(fixture);

      (q(fixture, 'implementation-twitter-create-block-remove')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(q(fixture, 'implementation-twitter-section')).toBeNull();
      const request = submitted(fixture);
      expect(request['platforms']).toEqual(['meta-ads']);
      expect(request).not.toHaveProperty('twitterConfig');
    });
  });

  it('asks for the brief to be saved when no capability read can run', async () => {
    const { fixture } = await mount(null, { briefId: null });

    expect(q(fixture, 'implementation-twitter-create-block-unsaved')).not.toBeNull();
  });

  it('blocks X again, and stops sending it, when the capability is withdrawn', async () => {
    const { fixture } = await mount(true);
    fill(fixture);
    fixture.componentRef.setInput('twitterCreateEnabled', false);
    fixture.detectChanges();

    expect(c(fixture)['canSubmit']()).toBe(false);
    expect(q(fixture, 'implementation-twitter-create-block-unsupported')).not.toBeNull();
  });

  it.each([
    ['a blank budget', { twitterBudget: '' }, 'implementation-twitter-budget-error'],
    ['a budget below 1', { twitterBudget: '0.5' }, 'implementation-twitter-budget-error'],
    ['a budget that is not a number', { twitterBudget: 'lots' }, 'implementation-twitter-budget-error'],
    ['an exponent budget, which Number would read as 1000', { twitterBudget: '1e3' }, 'implementation-twitter-budget-error'],
    ['a hex budget, which Number would read as 16', { twitterBudget: '0x10' }, 'implementation-twitter-budget-error'],
    ['blank tweet text', { twitterTweetText: '  ' }, 'implementation-twitter-tweet-error'],
    ['tweet text over the cap once the link is appended', { twitterTweetText: 'a'.repeat(257) }, 'implementation-twitter-tweet-error'],
    ['a start date of today, which X refuses', { startDate: new Date().toISOString().slice(0, 10) }, 'implementation-twitter-flight-error'],
    ['an end date on the start date', { endDate: '2099-09-01' }, 'implementation-twitter-flight-error'],
  ])('refuses Create for %s and says why', async (_label, overrides, errorId) => {
    const { fixture } = await mount(true);
    fill(fixture, overrides);

    expect(c(fixture)['canSubmit']()).toBe(false);
    expect(q(fixture, errorId)).not.toBeNull();
  });

  it("previews the saved brief's registration link, not an unsaved edit of the form field", async () => {
    const { fixture } = await mount(true);
    fill(fixture, { registrationUrl: 'https://example.com/edited-here' });

    expect(q(fixture, 'implementation-twitter-preview-link')?.textContent).toContain('https://example.com/kubecon');
    expect(q(fixture, 'implementation-twitter-preview-link')?.textContent).not.toContain('edited-here');
  });

  it('re-checks the X start at submit, refusing a start the clock has since made too soon', async () => {
    const { fixture } = await mount(true);
    fill(fixture);
    expect(c(fixture)['canSubmit']()).toBe(true);

    // Four minutes before the start's midnight UTC: inside campaign-service's five-minute lead.
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-08-31T23:56:00Z'));
    try {
      c(fixture)['submit']();
    } finally {
      now.mockRestore();
    }

    expect(createCampaign).not.toHaveBeenCalled();
    expect(c(fixture)['errors']()[0]).toContain('more than five minutes ahead');
  });

  it('accepts tweet text exactly at the cap once the link is appended', async () => {
    const { fixture } = await mount(true);
    fill(fixture, { twitterTweetText: 'a'.repeat(256) });

    expect(q(fixture, 'implementation-twitter-tweet-error')).toBeNull();
    expect(c(fixture)['canSubmit']()).toBe(true);
  });

  it('uploads the chosen image for the saved brief as an X upload and sends it as imageAssetId', async () => {
    const { fixture } = await mount(true);
    fill(fixture);
    choose(fixture, png());

    expect(uploadCreativeAsset).toHaveBeenCalledWith(expect.any(File), 'tlf', BRIEF_ID, 'twitter');
    expect(q(fixture, 'implementation-twitter-preview-image')?.textContent).toContain('tweet.png');
    expect(submitted(fixture)['twitterConfig']['imageAssetId']).toBe(ASSET_ID);
  });

  it('refuses an image over X’s 5 MB before uploading, and holds Create on the failure', async () => {
    const { fixture } = await mount(true);
    fill(fixture);
    choose(fixture, png(5 * 1024 * 1024 + 1));

    expect(uploadCreativeAsset).not.toHaveBeenCalled();
    expect(q(fixture, 'implementation-twitter-image-error')?.textContent).toContain('X accepts images up to 5 MB');
    expect(q(fixture, 'implementation-twitter-image-asset-block-uploadFailed')).not.toBeNull();
    expect(c(fixture)['canSubmit']()).toBe(false);
  });

  it('round-trips the typed fields and the upload through the draft', async () => {
    const first = await mount(true);
    fill(first.fixture, { twitterBudget: '120', twitterTweetText: 'Draft tweet' });
    choose(first.fixture, png());
    const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2099' };
    first.fixture.destroy();

    expect(draft.twitterBudget).toBe('120');
    expect(draft.twitterTweetText).toBe('Draft tweet');
    expect(draft.twitterImageAssetId).toBe(ASSET_ID);

    const { fixture } = await mount(true, { draft });
    expect(c(fixture)['campaignForm'].controls['twitterBudget'].value).toBe('120');
    expect(c(fixture)['campaignForm'].controls['twitterTweetText'].value).toBe('Draft tweet');
    expect(c(fixture)['twitterImageAssetId']()).toBe(ASSET_ID);
  });

  it('holds a restored upload behind a block when the capability is withdrawn, rather than dropping it', async () => {
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2099' };
    first.fixture.destroy();

    const { fixture } = await mount(false, { draft });

    expect(c(fixture)['twitterImageAssetId']()).toBe(ASSET_ID);
    expect(q(fixture, 'implementation-twitter-image-asset-block-unsupported')).not.toBeNull();
    expect(c(fixture)['canSubmit']()).toBe(false);
  });

  it('offers the bidding control and sends an X manual bid only within the daily budget', async () => {
    const { fixture } = await mount(true, { bidding: true });
    fill(fixture, { twitterBudget: '10' });

    expect(fixture.nativeElement.querySelector('[data-testid="implementation-twitter-section"] lfx-campaign-bidding-control')).not.toBeNull();
    c(fixture)['onBiddingChange']('twitter-ads', { strategy: 'manual', bidAmount: 12 });
    fixture.detectChanges();
    expect(c(fixture)['canSubmit']()).toBe(false);

    c(fixture)['onBiddingChange']('twitter-ads', { strategy: 'manual', bidAmount: 2.5 });
    fixture.detectChanges();
    expect(submitted(fixture)['twitterConfig']['bidding']).toEqual({ strategy: 'manual', bidAmount: 2.5 });
  });

  /** Which X ad account the create uses (LFXV2-3319): shown, since `twitterConfig` takes no account id. */
  describe('ad account', () => {
    it('names the account bound on the project X connection, read for the open foundation', async () => {
      const { fixture } = await mount(true);

      expect(getTwitterAdsAccounts).toHaveBeenCalledWith('tlf');
      expect(q(fixture, 'implementation-twitter-account-connected')?.textContent).toContain('Linux Foundation (18ce54d4x5t)');
    });

    it('does not read the account while X creation is not an explicit yes', async () => {
      await mount(null, { read: 'pending' });

      expect(getTwitterAdsAccounts).not.toHaveBeenCalled();
    });

    it('warns, without blocking Create, when the project connection has no account bound', async () => {
      // Not a block: a deployment forcing the LF system account creates there regardless.
      getTwitterAdsAccounts.mockReturnValue(accounts({ state: 'no_account', accountId: null, label: null }));
      const { fixture } = await mount(true);
      fill(fixture);

      expect(q(fixture, 'implementation-twitter-account-unbound')?.textContent).toContain('no ad account chosen');
      expect(c(fixture)['canSubmit']()).toBe(true);
    });

    it('re-reads the account from the unbound warning, so binding it elsewhere shows here', async () => {
      getTwitterAdsAccounts.mockReturnValueOnce(accounts({ state: 'no_account', accountId: null, label: null }));
      const { fixture } = await mount(true);

      (q(fixture, 'implementation-twitter-account-unbound-retry')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getTwitterAdsAccounts).toHaveBeenCalledTimes(2);
      expect(q(fixture, 'implementation-twitter-account-connected')).not.toBeNull();
    });

    it('treats a connection campaign-service could not read as a failed read, with Retry', async () => {
      getTwitterAdsAccounts.mockReturnValue(accounts({ state: 'unavailable', accountId: null, label: null }));
      const { fixture } = await mount(true);

      expect(q(fixture, 'implementation-twitter-account-error')).not.toBeNull();
      expect(q(fixture, 'implementation-twitter-account-retry')).not.toBeNull();
    });

    /** A refusal for lack of the project's `campaign_manager` role (#4837) is standing: named, with no Retry. */
    it('names the missing project role when campaign-service refused to read the X connection', async () => {
      getTwitterAdsAccounts.mockReturnValue(accounts({ state: 'forbidden', accountId: null, label: null }));
      const { fixture } = await mount(true);

      expect(q(fixture, 'implementation-twitter-account-forbidden')?.textContent).toContain('Your account needs the campaign manager role on this project');
      expect(q(fixture, 'implementation-twitter-account-retry')).toBeNull();
      expect(q(fixture, 'implementation-twitter-account-error')).toBeNull();
    });

    it('says the LF shared account is used when the project has no X connection, and lets Create through', async () => {
      getTwitterAdsAccounts.mockReturnValue(accounts({ state: 'no_connection', accountId: null, label: null }));
      const { fixture } = await mount(true);
      fill(fixture);

      expect(q(fixture, 'implementation-twitter-account-shared')).not.toBeNull();
      expect(c(fixture)['canSubmit']()).toBe(true);
    });

    it.each([
      [403, 'implementation-twitter-account-restricted'],
      [503, 'implementation-twitter-account-error'],
    ])('leaves the create to campaign-service on a %s read, saying why', async (status, testId) => {
      getTwitterAdsAccounts.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
      const { fixture } = await mount(true);
      fill(fixture);

      expect(q(fixture, testId)).not.toBeNull();
      expect(c(fixture)['canSubmit']()).toBe(true);
    });

    it('re-reads on Retry after a failed read', async () => {
      getTwitterAdsAccounts.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
      const { fixture } = await mount(true);

      (q(fixture, 'implementation-twitter-account-retry')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getTwitterAdsAccounts).toHaveBeenCalledTimes(2);
      expect(q(fixture, 'implementation-twitter-account-connected')).not.toBeNull();
    });
  });

  it('sends no bidding key while the bidding capability is off', async () => {
    const { fixture } = await mount(true, { bidding: false });
    fill(fixture);

    expect(submitted(fixture)['twitterConfig']).not.toHaveProperty('bidding');
  });
});
