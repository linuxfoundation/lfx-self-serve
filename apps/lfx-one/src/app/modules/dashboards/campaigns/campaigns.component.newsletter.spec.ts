// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Signal, WritableSignal } from '@angular/core';
import type {
  AudienceAttachExistingResult,
  AudienceLastSentEmail,
  AudienceListDescription,
  AudienceSelectionSummaryItem,
  AudienceSuppressionListsResult,
  CampaignAudience,
  CampaignBriefOutput,
  CampaignDeliveryType,
  CampaignTab,
  EmailBriefCopy,
} from '@lfx-one/shared/interfaces';
import { provideRouter } from '@angular/router';
import { CampaignService } from '@services/campaign.service';
import { PersonaService } from '@services/persona.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { NEVER, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignsComponent } from './campaigns.component';
import { campaignsComponentUnderTest, seedSelectedFoundation, STATE_ONLY, trackStateOnlyTests } from './campaigns.spec-helper';

seedSelectedFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' });
// Most of these assert on signals and service calls, so they mount the page with no template
// (STATE_ONLY). The ones that read the rendered hint, note or panel keep the full render.
trackStateOnlyTests();

/**
 * The newsletter surface's Implement step: one issue of a brand's newsletter, written from the
 * operator's notes and staged as a clone of the brand's previous issue.
 */
describe('CampaignsComponent — newsletter issue', () => {
  let fixture: ComponentFixture<CampaignsComponent>;

  interface Internals {
    selectedEmailTab: WritableSignal<Exclude<CampaignTab, 'optimization'>>;
    emailBriefOutput: WritableSignal<CampaignBriefOutput | null>;
    emailCopy: WritableSignal<EmailBriefCopy | null>;
    emailAudience: WritableSignal<CampaignAudience | null>;
    emailAudienceWriteInFlight: WritableSignal<boolean>;
    selectedEmailTemplateId: WritableSignal<string>;
    emailBodyHtmlPreview: Signal<string>;
    emailCtaDestination: Signal<string>;
    emailNoteLinks: Signal<string[] | null>;
    canStageEmail: Signal<boolean>;
    newsletterAudienceIncludes: Signal<AudienceSelectionSummaryItem[]>;
    newsletterAudienceExcludes: Signal<AudienceSelectionSummaryItem[]>;
    newsletterAudienceDescribeError: Signal<string | null>;
    newsletterAudienceState: Signal<string>;
    newsletterAudiencePrecedent: Signal<string>;
    onEmailProceedFromPlanning(brief: CampaignBriefOutput): void;
    selectorForm: { controls: { deliveryType: { setValue(v: CampaignDeliveryType): void } } };
  }

  const internals = (): Internals => fixture.componentInstance as unknown as Internals;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const select = (surface: CampaignDeliveryType): void => {
    internals().selectorForm.controls.deliveryType.setValue(surface);
    fixture.detectChanges();
  };

  const NOTES = [
    'Guide is out: https://acme.example/blog/guide/.',
    'Read the whole issue: https://acme.example/newsletter/november',
    'New members joined',
  ].join('\n');

  const newsletterBrief = {
    eventDetails: {
      name: 'Acme Newsletter - November 2026',
      slug: 'acme-newsletter-november-2026',
      registrationUrl: '',
      sourceText: NOTES,
      newsletterBrand: 'Acme',
      newsletterIssue: 'November 2026',
      referenceEmailIds: ['900', '800'],
    },
  } as unknown as CampaignBriefOutput;

  const copy = (overrides: Partial<EmailBriefCopy> = {}): EmailBriefCopy => ({
    subject: 'Acme Newsletter: the guide is out',
    preheader: 'New members too',
    body:
      '<h1>Acme Newsletter</h1><p>Read <a href="https://acme.example/blog/guide/">the guide</a>, ' +
      '<a href="https://acme.example/blog/invented-post">a post</a>, <a href="https://acme.example/blog/guide">the guide again</a> ' +
      'and <a href="https://training.linuxfoundation.org/x">a course</a>.</p>',
    cta: '',
    ctaUrl: '',
    ...overrides,
  });

  const builtAudience: CampaignAudience = {
    id: 'aud-1',
    briefId: 'brief-nl',
    platform: 'hubspot',
    platformMasterListId: '3797',
    suppressionListIds: ['3732', '888'],
    inclusionSummary: 'Same lists as 26Q2 - Acme - Newsletter - October',
    status: 'built',
    version: 1,
  };

  /** The issue the new one is cloned from, with the lists it was sent to and kept off. */
  const previousIssue: AudienceLastSentEmail = {
    emailId: '900',
    emailName: '26Q2 - Acme - Newsletter - October',
    sentAt: '2026-11-02T15:00:00Z',
    hubspotUrl: '',
    includedLists: [{ listId: '3797', name: 'Acme Newsletter Subscriptions', missing: false }],
    suppressionLists: [
      { listId: '3732', name: 'Master Exclusion List', missing: false },
      { listId: '888', name: 'Unsubscribed', missing: false },
    ],
  };

  const description = (listId: string, name: string, size?: number): AudienceListDescription => ({
    listId,
    name,
    ...(size !== undefined ? { size } : {}),
    processingType: 'DYNAMIC',
    hubspotUrl: `https://app.hubspot.example/contacts/1/objectLists/${listId}`,
    status: 'described',
    summary: `Everyone in ${name}`,
    match: 'any',
    groups: [],
    complete: true,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(campaignsComponentUnderTest());
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    fixture.detectChanges();
  });

  describe('links', () => {
    /**
     * The defect: a newsletter has no registration page, so the host rule every other email is
     * judged by vouched for nothing, and every link the operator wrote into the notes reached the
     * preview, and then the draft, as dead text.
     */
    it("keeps the links the notes carry and drops every other link's href", STATE_ONLY, () => {
      select('newsletter');
      internals().emailBriefOutput.set(newsletterBrief);
      internals().emailCopy.set(copy());
      fixture.detectChanges();

      const body = internals().emailBodyHtmlPreview();
      expect(body).toContain('<a href="https://acme.example/blog/guide/">the guide</a>');
      // The notes give the guide WITH its trailing slash; the slashless address is not one they carry.
      expect(body).toContain('<a>the guide again</a>');
      // An invented path on the brand's own site is the link a model writes when it was given none.
      expect(body).toContain('<a>a post</a>');
      // No host is vouched for on a newsletter, an LF-owned one included.
      expect(body).toContain('<a>a course</a>');
      expect(internals().emailNoteLinks()).toEqual(['https://acme.example/blog/guide/', 'https://acme.example/newsletter/november']);
    });

    it('leaves every other surface on the host rule', STATE_ONLY, () => {
      select('email');
      internals().emailBriefOutput.set(newsletterBrief);
      internals().emailCopy.set(copy());
      fixture.detectChanges();

      expect(internals().emailNoteLinks()).toBeNull();
      // An event email with no registration URL vouches only for LF-owned event-page links, so the
      // notes do not unlock the brand's link here.
      expect(internals().emailBodyHtmlPreview()).toContain('<a>the guide</a>');
    });

    it('points the one button at an address from the notes, and nowhere else', STATE_ONLY, () => {
      select('newsletter');
      internals().emailBriefOutput.set(newsletterBrief);

      internals().emailCopy.set(copy({ cta: 'Read More', ctaUrl: 'https://acme.example/newsletter/november' }));
      fixture.detectChanges();
      expect(internals().emailCtaDestination()).toBe('https://acme.example/newsletter/november');

      // The address must match exactly: the notes give it without a trailing slash.
      internals().emailCopy.set(copy({ cta: 'Read More', ctaUrl: 'https://acme.example/newsletter/november/' }));
      fixture.detectChanges();
      expect(internals().emailCtaDestination()).toBe('');

      internals().emailCopy.set(copy({ cta: 'Read More', ctaUrl: 'https://acme.example/elsewhere' }));
      fixture.detectChanges();
      expect(internals().emailCtaDestination()).toBe('');
    });
  });

  describe('tabs', () => {
    // A newsletter has no Audience tab. Switching to it from the Email surface's Audience tab left
    // the audience panel showing with no tab selected.
    it('moves off the Audience tab when the send becomes a newsletter', STATE_ONLY, () => {
      select('email');
      internals().selectedEmailTab.set('audience');

      select('newsletter');

      expect(internals().selectedEmailTab()).toBe('planning');
    });

    it('keeps the tab the operator was on when the newsletter has it', STATE_ONLY, () => {
      select('email');
      internals().selectedEmailTab.set('implementation');

      select('newsletter');

      expect(internals().selectedEmailTab()).toBe('implementation');
    });
  });

  describe('staging', () => {
    /**
     * A newsletter's template is the PREVIOUS ISSUE, so a draft staged without copy is last
     * issue's newsletter under this issue's name. The handler already refused it; the button
     * stayed enabled and did nothing when pressed.
     */
    it('cannot be staged until the issue is written, and says why', () => {
      select('newsletter');
      internals().emailBriefOutput.set(newsletterBrief);
      internals().selectedEmailTemplateId.set('900');
      internals().emailAudience.set(builtAudience);
      internals().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      expect(internals().canStageEmail()).toBe(false);
      expect(host().querySelector('[data-testid="campaigns-email-stage-hint"]')?.textContent).toContain('Generate the newsletter content first');

      internals().emailCopy.set(copy());
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(true);
    });

    it('never sends the operator to an Audience tab the surface does not have', () => {
      select('newsletter');
      internals().emailBriefOutput.set(newsletterBrief);
      internals().selectedEmailTemplateId.set('900');
      internals().emailCopy.set(copy());
      internals().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-email-audience-goto-btn"]')).toBeNull();
      expect(host().querySelector('[data-testid="campaigns-email-stage-hint"]')?.textContent).toContain('The recipients are not set yet');
    });

    /**
     * The page attaches the previous issue's lists itself, on arrival. While that ran, the hint
     * blamed "an audience write on the Audience tab, possibly for another email".
     */
    it('says the recipients are being attached while the page attaches them', () => {
      select('newsletter');
      internals().emailBriefOutput.set(newsletterBrief);
      internals().selectedEmailTemplateId.set('900');
      internals().emailCopy.set(copy());
      internals().emailAudienceWriteInFlight.set(true);
      internals().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      const hint = host().querySelector('[data-testid="campaigns-email-stage-hint"]')?.textContent ?? '';
      expect(hint).toContain('The recipients are being attached');
      expect(hint).not.toContain('Audience tab');
    });

    it('says the previous issue’s header and footer are kept, not replaced', () => {
      select('newsletter');
      internals().emailBriefOutput.set(newsletterBrief);
      internals().emailCopy.set(copy());
      internals().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      const note = host().querySelector('[data-testid="campaigns-email-preview-note"]')?.textContent ?? '';
      expect(note).toContain('header, footer, social links, fonts and colours are kept');
      expect(note).not.toContain('footer are replaced');
    });
  });

  describe('clone source', () => {
    /** A clone takes its sender, subscription type, header and footer from the source. */
    it("picks only the previous issue the plan named, never another brand's newsletter", STATE_ONLY, () => {
      const pick = (templates: { id: string; name: string; state: string }[]): string => {
        internals().selectedEmailTemplateId.set('');
        (fixture.componentInstance as unknown as { autoSelectNewsletterTemplate(t: unknown[]): void }).autoSelectNewsletterTemplate(templates);
        return internals().selectedEmailTemplateId();
      };
      select('newsletter');
      internals().emailBriefOutput.set(newsletterBrief);
      const otherBrand = { id: '500', name: 'Other Foundation Newsletter - October', state: 'PUBLISHED' };

      expect(pick([otherBrand, { id: '900', name: '26Q2 - Acme - Newsletter - October', state: 'PUBLISHED' }])).toBe('900');
      expect(pick([otherBrand])).toBe('');
      internals().emailBriefOutput.set({ ...newsletterBrief, eventDetails: { ...newsletterBrief.eventDetails, referenceEmailIds: [] } } as CampaignBriefOutput);
      expect(pick([otherBrand])).toBe('');
    });
  });

  describe('drafting after a reset', () => {
    /** The latch is once per stage; discarding the copy must re-arm it, or Stage clones the template's old content. */
    it('re-arms the auto-draft when the copy is discarded', STATE_ONLY, () => {
      const component = fixture.componentInstance as unknown as { emailCopyAutoGeneratedFor: string; resetEmailBriefDerivedState(): void };
      component.emailCopyAutoGeneratedFor = 'tlf|acme-newsletter-november-2026|Newsletter';
      component.resetEmailBriefDerivedState();
      expect(component.emailCopyAutoGeneratedFor).toBe('');
    });
  });

  describe('drafting on arrival', () => {
    // Kept on the full render: on the empty-template page the draft on arrival does not start
    // (generateEmailCopy is never called), so a state-only version would not exercise it.
    it('writes the issue as soon as the plan is handed over, with no variant', async () => {
      const service = TestBed.inject(CampaignService);
      vi.spyOn(service, 'persistBrief').mockReturnValue(of({ enabled: true, briefId: 'brief-nl', etag: '"1"', created: true, approved: true }));
      vi.spyOn(service, 'getAudienceBrandNewsletters').mockReturnValue(of([]));
      vi.spyOn(service, 'searchAudienceLists').mockReturnValue(of([]));
      vi.spyOn(service, 'getAudienceSuppressionLists').mockReturnValue(of({ lists: [] }) as never);
      const generateEmailCopy = vi.spyOn(service, 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy: copy() }));

      select('newsletter');
      internals().onEmailProceedFromPlanning(newsletterBrief);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(internals().selectedEmailTab()).toBe('implementation');
      expect(generateEmailCopy).toHaveBeenCalledTimes(1);
      expect(generateEmailCopy).toHaveBeenCalledWith('tlf', 'brief-nl', 'Newsletter', undefined, undefined);
      expect(internals().emailCopy()?.subject).toBe('Acme Newsletter: the guide is out');
      // The template is the first previous issue the planner ticked.
      expect(internals().selectedEmailTemplateId()).toBe('900');
    });
  });

  describe('who the issue goes to', () => {
    /**
     * The recipients are attached FOR the operator and the surface has no Audience tab, so before
     * this the only thing on screen ahead of a send to every subscriber was "Master list 3797".
     */
    it('names, sizes and explains each attached list', async () => {
      const describeAudienceLists = vi
        .spyOn(TestBed.inject(CampaignService), 'describeAudienceLists')
        .mockReturnValue(of([description('3797', 'Acme Newsletter Subscriptions', 13468), description('3732', 'Master Exclusion List')]));

      select('newsletter');
      internals().emailBriefOutput.set(newsletterBrief);
      internals().emailAudience.set(builtAudience);
      internals().selectedEmailTab.set('implementation');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(describeAudienceLists).toHaveBeenCalledWith('tlf', { listIds: ['3797', '3732', '888'] });
      expect(internals().newsletterAudienceIncludes()).toEqual([
        expect.objectContaining({ listId: '3797', name: 'Acme Newsletter Subscriptions', size: 13468 }),
      ]);
      // A list the read did not answer for keeps its id rather than disappearing.
      expect(
        internals()
          .newsletterAudienceExcludes()
          .map((item) => item.name)
      ).toEqual(['Master Exclusion List', 'List 888']);

      const panel = host().querySelector('[data-testid="campaigns-newsletter-audience-meaning"]');
      expect(panel?.textContent).toContain('Who this issue goes to');
      expect(panel?.textContent).toContain('Acme Newsletter Subscriptions');
      expect(panel?.textContent).toContain('except anyone in any of the 2 excluded lists');
    });

    /**
     * A NEW issue, the ordinary case: the page attaches the previous issue's lists and keeps the
     * row the attach returns. That row is slim, naming the send list but not the suppression
     * lists, which upstream reports beside it. Dropping them made the panel say the issue went to
     * everyone in the included list, until the brief was reopened and its stored row read.
     */
    it('names the exclusions of an audience attached a moment ago, as upstream recorded them', async () => {
      const service = TestBed.inject(CampaignService);
      vi.spyOn(service, 'persistBrief').mockReturnValue(of({ enabled: true, briefId: 'brief-nl', etag: '"1"', created: true, approved: true }));
      vi.spyOn(service, 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy: copy() }));
      // The brief is new: upstream holds no audience for it yet.
      vi.spyOn(service, 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [] }));
      vi.spyOn(service, 'getAudienceBrandNewsletters').mockReturnValue(of([previousIssue]));
      // Upstream records the project's standing suppression list (9001) in place of a standard
      // list it was sent (888), so what it reports is not simply what the page asked for.
      const attachExistingAudience = vi.spyOn(service, 'attachExistingAudience').mockReturnValue(
        of({
          master: { listId: '3797', name: 'Acme Newsletter Subscriptions', hubspotUrl: '' },
          suppressionListIds: ['3732', '9001'],
          audience: { id: 'aud-2', briefId: 'brief-nl', platform: 'hubspot', platformMasterListId: '3797', status: 'built', version: 1 },
        })
      );
      const describeAudienceLists = vi
        .spyOn(service, 'describeAudienceLists')
        .mockReturnValue(
          of([
            description('3797', 'Acme Newsletter Subscriptions', 13468),
            description('3732', 'Master Exclusion List'),
            description('9001', 'Acme Standard Suppression'),
          ])
        );

      select('newsletter');
      internals().onEmailProceedFromPlanning(newsletterBrief);
      await vi.waitFor(() => expect(internals().emailAudience()?.id).toBe('aud-2'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(attachExistingAudience).toHaveBeenCalledWith('tlf', {
        briefId: 'brief-nl',
        includeListIds: ['3797'],
        suppressionListIds: ['3732', '888'],
        inclusionSummary: 'Same lists as 26Q2 - Acme - Newsletter - October',
      });
      expect(internals().emailAudience()?.suppressionListIds).toEqual(['3732', '9001']);
      expect(describeAudienceLists).toHaveBeenLastCalledWith('tlf', { listIds: ['3797', '3732', '9001'] });
      expect(
        internals()
          .newsletterAudienceExcludes()
          .map((item) => item.name)
      ).toEqual(['Master Exclusion List', 'Acme Standard Suppression']);
      expect(host().querySelector('[data-testid="campaigns-newsletter-audience-meaning"]')?.textContent).toContain(
        'except anyone in any of the 2 excluded lists'
      );
    });

    /**
     * Reopening a saved issue. The stored audience is still being read back when the page decides
     * about the recipients, so deciding on what the page held attached the previous issue's lists
     * again: a second audience row on every reopen, and over lists the operator had confirmed.
     */
    it('does not attach again when the brief already has an audience', async () => {
      const service = TestBed.inject(CampaignService);
      vi.spyOn(service, 'persistBrief').mockReturnValue(of({ enabled: true, briefId: 'brief-nl', etag: '"1"', created: true, approved: true }));
      vi.spyOn(service, 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy: copy() }));
      vi.spyOn(service, 'getAudienceBrandNewsletters').mockReturnValue(of([previousIssue]));
      // The operator confirmed the brand's own lists for this issue, not the previous issue's.
      const confirmed: CampaignAudience = { ...builtAudience, id: 'aud-confirmed', platformMasterListId: '4100', suppressionListIds: ['3732'] };
      // The race itself: the read-back that follows the save has not answered when the page
      // decides, so the page holds no audience. The decision's own read is the second call.
      const listAudiences = vi
        .spyOn(service, 'listAudiences')
        .mockReturnValueOnce(NEVER)
        .mockReturnValue(of({ enabled: true, audiences: [confirmed] }));
      const attachExistingAudience = vi.spyOn(service, 'attachExistingAudience');
      vi.spyOn(service, 'describeAudienceLists').mockReturnValue(of([]));

      select('newsletter');
      internals().onEmailProceedFromPlanning(newsletterBrief);
      await vi.waitFor(() => expect(internals().emailAudience()?.id).toBe('aud-confirmed'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(listAudiences).toHaveBeenCalledTimes(2);
      expect(listAudiences).toHaveBeenLastCalledWith('tlf', 'brief-nl');
      expect(attachExistingAudience).not.toHaveBeenCalled();
      expect(internals().emailAudience()?.platformMasterListId).toBe('4100');
      expect(host().querySelector('[data-testid="campaigns-newsletter-audience-error"]')).toBeNull();
    });

    /**
     * The brief clones issue 900, but the brand has sent newer issues since and 900 is no longer
     * among the few that are read. Attaching the newest issue's lists would send a clone of one
     * issue to another issue's recipients with nobody choosing them, so nothing is attached and
     * the suggestion is left for the operator to confirm.
     */
    it("does not attach another issue's lists when the issue being cloned is not among those read", STATE_ONLY, async () => {
      const service = TestBed.inject(CampaignService);
      vi.spyOn(service, 'persistBrief').mockReturnValue(of({ enabled: true, briefId: 'brief-nl', etag: '"1"', created: true, approved: true }));
      vi.spyOn(service, 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy: copy() }));
      vi.spyOn(service, 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [] }));
      vi.spyOn(service, 'getAudienceBrandNewsletters').mockReturnValue(
        of([{ ...previousIssue, emailId: '950', emailName: '26Q2 - Acme - Newsletter - November' }])
      );
      const searchAudienceLists = vi.spyOn(service, 'searchAudienceLists').mockReturnValue(of([]));
      vi.spyOn(service, 'getAudienceSuppressionLists').mockReturnValue(of({ lists: [] } as unknown as AudienceSuppressionListsResult));
      const attachExistingAudience = vi.spyOn(service, 'attachExistingAudience');

      select('newsletter');
      internals().onEmailProceedFromPlanning(newsletterBrief);
      await vi.waitFor(() => expect(searchAudienceLists).toHaveBeenCalled());
      await fixture.whenStable();
      fixture.detectChanges();

      expect(attachExistingAudience).not.toHaveBeenCalled();
      expect(internals().emailAudience()).toBeNull();
    });

    it("does not reuse the previous issue's lists when one of them is gone, and suggests instead", STATE_ONLY, async () => {
      const service = TestBed.inject(CampaignService);
      vi.spyOn(service, 'persistBrief').mockReturnValue(of({ enabled: true, briefId: 'brief-nl', etag: '"1"', created: true, approved: true }));
      vi.spyOn(service, 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy: copy() }));
      vi.spyOn(service, 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [] }));
      // One of the three recorded lists no longer exists: the rest is not the audience the
      // previous issue went to, so the page must not claim to reuse it.
      vi.spyOn(service, 'getAudienceBrandNewsletters').mockReturnValue(
        of([{ ...previousIssue, suppressionLists: [previousIssue.suppressionLists[0], { listId: '888', name: 'Unsubscribed', missing: true }] }])
      );
      const searchAudienceLists = vi.spyOn(service, 'searchAudienceLists').mockReturnValue(of([]));
      vi.spyOn(service, 'getAudienceSuppressionLists').mockReturnValue(of({ lists: [] } as unknown as AudienceSuppressionListsResult));
      const attachExistingAudience = vi.spyOn(service, 'attachExistingAudience');

      select('newsletter');
      internals().onEmailProceedFromPlanning(newsletterBrief);
      await vi.waitFor(() => expect(searchAudienceLists).toHaveBeenCalled());
      await fixture.whenStable();
      fixture.detectChanges();

      expect(attachExistingAudience).not.toHaveBeenCalled();
      expect(internals().newsletterAudienceState()).toBe('suggested');
    });

    it('attaches nothing when the stored audience cannot be read, and offers to try again', async () => {
      const service = TestBed.inject(CampaignService);
      vi.spyOn(service, 'persistBrief').mockReturnValue(of({ enabled: true, briefId: 'brief-nl', etag: '"1"', created: true, approved: true }));
      vi.spyOn(service, 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy: copy() }));
      vi.spyOn(service, 'getAudienceBrandNewsletters').mockReturnValue(of([previousIssue]));
      // An outage is not an absence: attaching now could sit on top of an audience it hid.
      vi.spyOn(service, 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [], error: 'upstream unavailable' }));
      const attachExistingAudience = vi.spyOn(service, 'attachExistingAudience');

      select('newsletter');
      internals().onEmailProceedFromPlanning(newsletterBrief);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(host().querySelector('[data-testid="campaigns-newsletter-audience-error"]')?.textContent).toContain('could not be read');
      });

      expect(attachExistingAudience).not.toHaveBeenCalled();
      expect(internals().emailAudience()).toBeNull();
      expect(host().querySelector('[data-testid="campaigns-newsletter-audience-retry"]')).not.toBeNull();
    });

    /**
     * The attach is awaited. If the operator plans another issue while it is in flight, its answer
     * arrives on a page showing that other issue, and must not mark ITS recipients as attached.
     */
    it("does not mark another issue as attached when an earlier issue's attach answers late", STATE_ONLY, async () => {
      const service = TestBed.inject(CampaignService);
      vi.spyOn(service, 'persistBrief').mockReturnValue(of({ enabled: true, briefId: 'brief-nl', etag: '"1"', created: true, approved: true }));
      vi.spyOn(service, 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy: copy() }));
      vi.spyOn(service, 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [] }));
      vi.spyOn(service, 'getAudienceBrandNewsletters').mockReturnValue(of([previousIssue]));
      vi.spyOn(service, 'describeAudienceLists').mockReturnValue(of([]));
      const searchAudienceLists = vi.spyOn(service, 'searchAudienceLists').mockReturnValue(of([]));
      vi.spyOn(service, 'getAudienceSuppressionLists').mockReturnValue(of({ lists: [] } as unknown as AudienceSuppressionListsResult));
      const slowAttach = new Subject<AudienceAttachExistingResult>();
      const attachExistingAudience = vi.spyOn(service, 'attachExistingAudience').mockReturnValue(slowAttach);

      select('newsletter');
      // Issue A clones 900, which is among the issues read: its lists are attached, slowly.
      internals().onEmailProceedFromPlanning(newsletterBrief);
      await vi.waitFor(() => expect(attachExistingAudience).toHaveBeenCalledTimes(1));

      // Issue B names a template that is not among them, so it ends on the suggestion.
      const otherIssue = {
        eventDetails: { ...newsletterBrief.eventDetails, name: 'Acme Newsletter - December 2026', referenceEmailIds: ['777'] },
      } as unknown as CampaignBriefOutput;
      internals().onEmailProceedFromPlanning(otherIssue);
      await vi.waitFor(() => expect(searchAudienceLists).toHaveBeenCalled());
      await vi.waitFor(() => expect(internals().newsletterAudienceState()).toBe('suggested'));

      slowAttach.next({
        master: { listId: '3797', name: 'Acme Newsletter Subscriptions', hubspotUrl: '' },
        suppressionListIds: ['3732', '888'],
        audience: { id: 'aud-late', briefId: 'brief-nl', platform: 'hubspot', platformMasterListId: '3797', status: 'built', version: 1 },
      });
      slowAttach.complete();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(internals().newsletterAudienceState(), "issue A's late answer marked issue B as attached").toBe('suggested');
      expect(internals().newsletterAudiencePrecedent()).toBe('');
      expect(internals().emailAudience()).toBeNull();
    });

    it('is not read on any other surface', STATE_ONLY, async () => {
      const describeAudienceLists = vi.spyOn(TestBed.inject(CampaignService), 'describeAudienceLists').mockReturnValue(of([]));

      select('email');
      internals().emailBriefOutput.set(newsletterBrief);
      internals().emailAudience.set(builtAudience);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(describeAudienceLists).not.toHaveBeenCalled();
      expect(internals().newsletterAudienceIncludes()).toEqual([]);
    });
  });
});
