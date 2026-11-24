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
import { stubCreativeLibraryUpload, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

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
    const f = TestBed.createComponent(tabComponentUnderTest());
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
