// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import type { Signal, WritableSignal } from '@angular/core';
import type {
  AudienceComposedList,
  AudienceComposeUnattachedEvent,
  CampaignAudience,
  EmailBriefCopy,
  CampaignBriefOutput,
  CampaignDeliveryType,
  CampaignEventSponsor,
  CampaignProgramType,
  CampaignTab,
  CampaignTabOption,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { provideRouter } from '@angular/router';
import { CampaignService } from '@services/campaign.service';
import { PersonaService } from '@services/persona.service';
import { CAMPAIGN_SURVEY_TYPES, HUBSPOT_TEMPLATE_RENDER_LIMIT, MAX_SPONSOR_NAME_LENGTH } from '@lfx-one/shared/constants';
import type { HubSpotMarketingEmail } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { CampaignsComponent } from './campaigns.component';
import { seedSelectedFoundation, STATE_ONLY, campaignsComponentUnderTest, trackStateOnlyTests } from './campaigns.spec-helper';
import { AudienceBuilderTabComponent } from './components/audience-builder-tab/audience-builder-tab.component';
import { PlanningTabComponent } from './components/planning-tab/planning-tab.component';

seedSelectedFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' });
trackStateOnlyTests();

describe('CampaignsComponent — email delivery channel', () => {
  let fixture: ComponentFixture<CampaignsComponent>;

  // The component's members are protected; the tests reach them through one narrow cast rather
  // than exercising the DOM, because what is being pinned is the state machine, not the markup.
  // Reuses the real `CampaignTabOption` and `WritableSignal` rather than hand-rolled shapes, so
  // a retype on the component is at least a type error here instead of a silently-passing test
  // against a shape that no longer exists. The cast still cannot catch a RENAME — that is the
  // cost of reaching protected members, and the reason the assertions below stay behavioral.
  interface Internals {
    /** The rows the picker draws, after type ranking and the render cap. */
    emailTemplatesRendered: Signal<{ id: string }[]>;
    emailTemplatesRenderCapMessage: Signal<string>;
    emailTemplates: WritableSignal<unknown[] | null>;
    selectedDeliveryType: Signal<CampaignDeliveryType>;
    selectedTab: WritableSignal<CampaignTab>;
    selectedEmailTab: WritableSignal<Exclude<CampaignTab, 'optimization'>>;
    briefOutput: WritableSignal<CampaignBriefOutput | null>;
    emailBriefOutput: WritableSignal<CampaignBriefOutput | null>;
    emailTabs: readonly CampaignTabOption[];
    tabs: readonly CampaignTabOption[];
    isEmail: Signal<boolean>;
    selectTab(tab: CampaignTab, owner: CampaignDeliveryType): void;
    onTabKeydown(event: KeyboardEvent, index: number, owner: CampaignDeliveryType): void;
    onProceedToImplementation(brief: CampaignBriefOutput): void;
    onEmailProceedFromPlanning(brief: CampaignBriefOutput): void;
    selectedEmailTemplateId: WritableSignal<string>;
    selectedEmailTypeId: WritableSignal<string>;
    emailCopy: WritableSignal<EmailBriefCopy | null>;
    emailCtaDestination: Signal<string>;
    generatedDestinations: Signal<string[]>;
    emailBodyHtmlPreview: Signal<string>;
    emailCtaUnlinkedLabel: Signal<string>;
    emailHeroImageHost: Signal<string>;
    emailAudience: WritableSignal<CampaignAudience | null>;
    emailBriefId: WritableSignal<string>;
    emailAudienceOrigin: WritableSignal<'composed' | 'restored' | null>;
    emailAudienceUnattached: Signal<AudienceComposedList | null>;
    activeFoundationSlug: Signal<string>;
    emailAudienceScope: Signal<number>;
    emailAudienceReadUnavailable: Signal<boolean>;
    emailAudienceReadPending: Signal<boolean>;
    emailBriefResolving: Signal<boolean>;
    emailAudienceSkipped: WritableSignal<boolean>;
    emailAudienceReadFailed: WritableSignal<boolean>;
    onSkipAudienceStep(): void;
    onContinueToEmailStep(): void;
    onGoToAudienceStep(): void;
    onAudienceComposed(audience: CampaignAudience): void;
    onAudienceComposeUnattached(event: AudienceComposeUnattachedEvent): void;
    restoreEmailAudience(projectSlug: string, briefId: string): Promise<void>;
    resetEmailBriefDerivedState(): void;
    emailCopyState: WritableSignal<'idle' | 'generating' | 'error'>;
    emailCopyError: WritableSignal<string>;
    canGenerateEmailCopy: Signal<boolean>;
    onGenerateEmailCopy(): Promise<void>;
    emailStaging: WritableSignal<'idle' | 'staging' | 'done' | 'error'>;
    emailStagingMessage: WritableSignal<string>;
    emailStagingDraftUrl: Signal<string>;
    emailStagingWarnings: Signal<readonly string[]>;
    canStageEmail: Signal<boolean>;
    onStageEmailSend(): Promise<void>;
    // Read-only now: the form is the source of truth and these derive from it, so a test
    // drives `abTestForm` (the same path the bound control uses) rather than the signal.
    abTestEnabled: Signal<boolean>;
    abTestSubjectB: Signal<string>;
    abTestBodyHtmlB: Signal<string>;
    abTestBodyHtmlBPreview: Signal<string>;
    abTestPreheaderBForSend: Signal<string>;
    abTestBodyHtmlBForSend: Signal<string>;
    emailBodyHtmlForSend: Signal<string>;
    abTestPreheaderBPreview: Signal<string>;
    emailPreheaderPreview: Signal<string>;
    abTestForm: {
      controls: {
        // `value` as well as `setValue`: asserting the CONTROL is what catches a stale write
        // that lands outside change detection, which the `toSignal` mirrors miss.
        enabled: { setValue(v: boolean): void; value: boolean };
        subjectB: { setValue(v: string): void; value: string };
        preheaderB: { setValue(v: string): void; value: string };
        bodyHtmlB: { setValue(v: string): void; value: string };
      };
    };
    abTestCopyState: WritableSignal<'idle' | 'generating' | 'error'>;
    abTestCopyError: WritableSignal<string>;
    canGenerateAbTestCopy: Signal<boolean>;
    selectedEmailStage: Signal<string>;
    selectedEmailSegment: Signal<string | undefined>;
    emailCtaIsStageable: Signal<boolean>;
    emailCtaLabel: Signal<string>;
    emailHeroImageUrl: Signal<string>;
    emailHeroPreviewUrl: Signal<string>;
    emailRegistrationUrl: Signal<string>;
    emailSponsors: Signal<CampaignEventSponsor[]>;
    emailBodyIsStageable: Signal<boolean>;
    abTestIsStageable: Signal<boolean>;
    onGenerateAbTestCopy(): Promise<void>;
    selectorForm: {
      controls: {
        deliveryType: { setValue(v: CampaignDeliveryType): void };
        programType: { setValue(v: CampaignProgramType): void };
        emailType: { disabled: boolean; value: string };
        emailSegment: { disabled: boolean; setValue(v: string): void };
      };
    };
    emailAudienceWriteInFlight: WritableSignal<boolean>;
    emailStagingUnresolved: Signal<boolean>;
    emailStagingHeld: Signal<boolean>;
  }

  const internals = (): Internals => fixture.componentInstance as unknown as Internals;

  const selectEmail = (): void => {
    internals().selectorForm.controls.deliveryType.setValue('email');
    fixture.detectChanges();
  };

  const exampleBrief = { eventDetails: { name: 'KubeCon', slug: 'kubecon' } } as CampaignBriefOutput;

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

  describe('email staging trigger (LFXV2-3201)', () => {
    // Scoped to THIS block: the outer `persistBrief` spy belongs to the first describe and is
    // not in scope here.
    let persistBrief: Mock;

    beforeEach(() => {
      persistBrief = vi.fn();
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(persistBrief);
    });

    // A brief shaped like the email planner's output. `eventDetails` is what the create request
    // is built FROM, so the fields asserted below must come from here and not from a spread.
    const emailBrief = {
      eventDetails: {
        name: 'KubeCon EU 2026',
        slug: 'kubecon-eu-2026',
        countryCode: 'NL',
        registrationUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
      },
    } as unknown as CampaignBriefOutput;

    it('renders the button inside the email Implement panel, disabled with a reason', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      const panel = host.querySelector('[data-testid="campaigns-email-implementation-panel"]');
      const btn = panel?.querySelector('[data-testid="campaigns-email-stage-btn"]');

      // PLACEMENT is the claim: the button must live under the EMAIL implement panel, not the
      // paid one. Querying from the panel rather than the document proves containment.
      expect(btn).not.toBeNull();

      // With no brief and no template the control must be disabled AND say why — a disabled
      // button with no reason reads as a broken panel.
      const hint = panel?.querySelector('[data-testid="campaigns-email-stage-hint"]');
      expect(hint?.textContent?.trim()).toContain('Generate a brief');
    });

    it('cannot stage without a brief, a template, an audience, and a project', STATE_ONLY, () => {
      selectEmail();
      expect(internals().canStageEmail()).toBe(false);

      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();
      // A brief alone is not enough: `hubspot.go` refuses a blank sourceEmailId.
      expect(internals().canStageEmail()).toBe(false);

      internals().selectedEmailTemplateId.set('hs-123');
      fixture.detectChanges();
      // Still not enough. campaign-service's `resolveBuiltAudience` refuses to stage a brief with
      // no BUILT audience, so enabling here would start the HubSpot draft work only to have the
      // send refused afterwards -- which is what the panel's own copy promises it will not do.
      expect(internals().canStageEmail()).toBe(false);

      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(true);
    });

    it('refuses to stage while copy is still generating', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();
      // Starts from a genuine true, so the assertions below cannot pass on some other gate.
      expect(internals().canStageEmail()).toBe(true);

      // `onStageEmailSend` reads `emailCopy()` unconditionally, and a regeneration clears it
      // only when the response LANDS. Staging mid-generation therefore sends the PREVIOUS copy
      // while the operator watches new copy being written -- a draft that reads as plausible and
      // is simply the wrong content.
      internals().emailCopyState.set('generating');
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(false);

      internals().emailCopyState.set('idle');
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(true);

      // Variant B has its own in-flight state and the same sink.
      internals().abTestCopyState.set('generating');
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(false);
    });

    it('refuses to stage on an audience that is not BUILT', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');

      // Upstream's three states are building | built | failed, and a build that ENDS in `failed`
      // still returns an audience object. Gating on existence alone re-admits exactly the
      // dispatcher refusal the gate exists to prevent.
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(false);

      internals().emailAudience.set({ id: 'aud-1', status: 'building' } as never);
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(false);

      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(true);
    });

    it('does not announce a failed audience as built', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      fixture.detectChanges();

      const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-built"]');
      // A green check beside the word "failed" tells the operator the opposite of what happened.
      expect(panel?.textContent).toContain('Audience failed');
      expect(panel?.textContent).not.toContain('Audience built');
    });

    it('counts suppression lists, not the characters of an encoded one', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({ id: 'aud-1', status: 'built', suppressionListIds: ['sup-1'] } as never);
      fixture.detectChanges();

      const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-built"]');
      // Upstream declares ArrayOf(String). If it ever arrived JSON-encoded, `.length` would read
      // the STRING length and report "9 suppression list(s)" for a single list -- a
      // compliance-facing number on a send list, wrong by a factor of nine.
      expect(panel?.textContent).toContain('1 exclusion list(s) applied');
    });

    it("tells the Audience tab why there is no brief id, rather than 'save the plan first'", STATE_ONLY, () => {
      const state = internals() as unknown as {
        emailBriefState: () => string;
        emailBriefSaveOutcome: { set: (v: string) => void };
      };
      internals().emailBriefId.set('');
      state.emailBriefSaveOutcome.set('failed');
      expect(state.emailBriefState()).toBe('failed');

      state.emailBriefSaveOutcome.set('unapproved');
      expect(state.emailBriefState()).toBe('unapproved');

      // An earlier session's brief for this send is a refusal Retry cannot clear, so it is not 'failed'.
      const outcome = (internals() as unknown as { emailBriefOutcome: (id: string, c?: string) => string }).emailBriefOutcome.bind(internals());
      expect(outcome('', 'unowned-brief-exists')).toBe('unopened');
      expect(outcome('', undefined)).toBe('failed');
      expect(outcome('brief-9', undefined)).toBe('unapproved');
      // A conflict carrying an id is still a failed save with its own recovery, not "unapproved".
      for (const conflict of ['stale-brief', 'unverified-validator', 'superseded-after-write']) {
        expect(outcome('brief-9', conflict), `${conflict} with an id read as unapproved`).toBe('failed');
      }

      // A brief id wins over any recorded outcome: the plan is saved and approved.
      internals().emailBriefId.set('brief-77');
      expect(state.emailBriefState()).toBe('ready');
    });

    it('names every include list when lists were attached directly with no master', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({
        id: 'aud-1',
        status: 'built',
        platformMasterListId: '101',
        includeListIds: ['101', '102'],
        suppressionListIds: ['201'],
      } as never);
      fixture.detectChanges();

      const includes = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-include-lists"]');
      expect(includes?.textContent).toContain('101');
      expect(includes?.textContent).toContain('102');
    });

    it('refuses to stage if the audience stops being built before the await', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      // A cached brief id, so `ensureEmailBriefId` cannot be what stops this. Without it the
      // default `persistBrief` stub NEVER emits and the test would pass on the hang instead of
      // on the guard -- which is exactly how it survived its first mutation run.
      internals().emailBriefId.set('brief-77');
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign');

      await internals().onStageEmailSend();

      // The re-check exists because a signal can change between the guard and the await. Leaving
      // the audience out of it let the enumeration drift from `canStageEmail`, so the refusal
      // would come back from HubSpot after the draft work had begun.
      expect(create).not.toHaveBeenCalled();
    });

    it("sends the selected type's STAGE, not its id", STATE_ONLY, async () => {
      selectEmail();
      const gen = vi
        .spyOn(TestBed.inject(CampaignService), 'generateEmailCopy')
        .mockReturnValue(of({ enabled: true, copy: { subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'c', ctaUrl: '' } }) as never);

      // The type is chosen BEFORE the brief id is cached, deliberately. An earlier revision set
      // `emailBriefId` first and then switched to a different stage, which pinned the id across a
      // stage change -- the exact desync `onSelectEmailType` now clears, so that ordering asserted
      // the bug rather than the contract. Selecting first, then caching, keeps this test about the
      // stage-vs-type-id distinction it is named for.
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');
      // BOTH set after the type change: it now clears the brief output as well as the id, since
      // the previous stage's CONTENT would otherwise be persisted under the new stage.
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-77');

      await internals().onGenerateEmailCopy();

      // campaign-service enumerates STAGES, not type ids -- sending 'thank-you-survey' would be
      // refused by its enum. Several types share a stage, which is why the two are distinct.
      // Variant A always requests the `urgency-fomo` draft; dropping it would silently
      // generate default copy and make the A/B test compare A against A.
      //
      // The trailing `undefined` is the SEGMENT, and it is asserted rather than left off: this is
      // an exact-arity matcher, and the selector defaults to "All audiences" -- so a default
      // generate must travel with no segment, exactly as it did before the field existed.
      expect(gen).toHaveBeenCalledWith('tlf', 'brief-77', 'Post-Event', 'urgency-fomo', undefined);
    });

    it('defaults the Survey & Report dropdown to Survey Promo -- the control, not just the planner', STATE_ONLY, () => {
      internals().selectorForm.controls.deliveryType.setValue('survey');
      fixture.detectChanges();

      // The dropdown renders the CONTROL. The signal alone fed the planner and left the dropdown
      // showing the email surface's id, which names no survey option, so it read as unselected.
      expect(internals().selectorForm.controls.emailType.value).toBe('survey-promo');
      expect(internals().selectedEmailTypeId()).toBe('survey-promo');
      expect(internals().selectedEmailStage()).toBe('Survey Promo');
    });

    it('puts the email default back on the dropdown when returning from Survey & Report', STATE_ONLY, () => {
      internals().selectorForm.controls.deliveryType.setValue('survey');
      fixture.detectChanges();
      selectEmail();

      expect(internals().selectorForm.controls.emailType.value).toBe(internals().selectedEmailTypeId());
      expect(internals().selectedEmailStage()).not.toBe('Survey Promo');
    });

    it('does not offer the audience segment on Survey & Report, and sends none from it', async () => {
      selectEmail();
      // Chosen on the email surface first: hiding the picker must also stop this riding along.
      internals().selectorForm.controls.emailSegment.setValue('alumni');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-segment-picker"]'), 'email keeps the picker').not.toBeNull();
      expect(internals().selectedEmailSegment()).toBe('alumni');

      internals().selectorForm.controls.deliveryType.setValue('survey');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-segment-picker"]'), 'survey hides the picker').toBeNull();
      expect(internals().selectedEmailSegment()).toBeUndefined();

      const gen = vi
        .spyOn(TestBed.inject(CampaignService), 'generateEmailCopy')
        .mockReturnValue(of({ enabled: true, copy: { subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'c', ctaUrl: '' } }) as never);
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-9');

      await internals().onGenerateEmailCopy();

      // No urgency variant: campaign-service writes it as an event invite.
      expect(gen).toHaveBeenCalledWith('tlf', 'brief-9', 'Survey Promo', undefined, undefined);
    });

    it('ranks templates matching the selected type first, without removing any', STATE_ONLY, () => {
      selectEmail();
      const templates = [
        { id: '1', name: 'Registration reminder', subject: 'Register now' },
        { id: '2', name: 'Post-event thank you', subject: 'Survey inside' },
        { id: '3', name: 'Unrelated newsletter', subject: 'Monthly update' },
      ];
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      const rendered = internals().emailTemplatesRendered();

      // The match rises...
      expect(rendered[0].id).toBe('2');
      // ...but NOTHING is removed. A filter would hide a template the operator may know is right
      // and the keywords do not describe, and cloning writes a real HubSpot draft.
      expect(rendered.map((t: { id: string }) => t.id).sort()).toEqual(['1', '2', '3']);
    });

    it('leaves the order untouched when nothing matches', STATE_ONLY, () => {
      selectEmail();
      const templates = [
        { id: '1', name: 'Alpha', subject: 'One' },
        { id: '2', name: 'Beta', subject: 'Two' },
      ];
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // Ties keep the server's newest-first order, so an unmatched list is identical to what the
      // picker showed before ranking existed.
      expect(
        internals()
          .emailTemplatesRendered()
          .map((t: { id: string }) => t.id)
      ).toEqual(['1', '2']);
    });

    it('ranks before the render cap, so a match beyond it can still surface', STATE_ONLY, () => {
      selectEmail();
      // 600 unmatched rows, then the match -- comfortably past HUBSPOT_TEMPLATE_RENDER_LIMIT.
      const templates = Array.from({ length: 600 }, (_, i) => ({ id: `u${i}`, name: 'Unrelated', subject: 'Monthly update' }));
      templates.push({ id: 'match', name: 'Post-event thank you', subject: 'Survey inside' });
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // Ranking AFTER the slice could only reorder the first HUBSPOT_TEMPLATE_RENDER_LIMIT
      // rows -- the one template the operator was looking for would have been cut before it
      // could rise.
      expect(internals().emailTemplatesRendered()[0].id).toBe('match');
    });

    /**
     * Name and subject are searched INDEPENDENTLY, never concatenated.
     *
     * Every other fixture puts each keyword wholly inside one field, so an implementation that
     * joined the two would score identically and pass them all. This is the case that separates
     * them: `thank you` is a multi-word type keyword, and a template whose name ends "Thank" and
     * whose subject begins "you" must NOT score for it -- a match across the boundary between two
     * unrelated fields is a coincidence of adjacency, not a description of the template.
     */
    it('does not score a keyword split across the name and subject boundary', STATE_ONLY, () => {
      selectEmail();
      internals().emailTemplates.set([
        // The SPLIT row is listed FIRST by the server, so the server order and the correct order
        // disagree. That is what makes this test able to fail: with the real match listed first,
        // `['real','split']` holds under a concatenating scorer too, and the assertion proved
        // nothing.
        //
        // Splits `thank you` across the two fields. Scores 0 independently, 1 under concatenation
        // -- and 1 is enough to hold its incoming position ahead of a row that scores 0.
        { id: 'split', name: 'Speaker Thank', subject: 'you are invited' },
        // A REAL match, listed second: it must rise to the top on score alone.
        { id: 'real', name: 'Post-event survey', subject: 'Share feedback' },
      ] as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // ORDER is the observable, and the fixture is built so it changes: 'real' matches three
      // keywords, 'split' matches none -- unless the fields are joined, when it matches one. Two
      // rows that both score 0 would keep the server's order under either implementation, which
      // is why an earlier version of this test could not fail.
      expect(
        internals()
          .emailTemplatesRendered()
          .map((t) => t.id)
      ).toEqual(['real', 'split']);
      // The split row must not have scored at all. With a concatenating scorer it scores 1, and
      // a row scoring 1 sorts above every 0-scoring row -- so a THIRD, unmatched row makes the
      // difference visible in the ordering rather than only in an internal number.
      internals().emailTemplates.set([
        { id: 'zero', name: 'Quarterly update', subject: 'Newsletter' },
        { id: 'split', name: 'Speaker Thank', subject: 'you are invited' },
      ] as never);
      expect(
        internals()
          .emailTemplatesRendered()
          .map((t) => t.id),
        'the split phrase scored, so the fields were concatenated'
      ).toEqual(['zero', 'split']);
    });

    /**
     * The type score must COUNT matched keywords, not merely report that one matched.
     *
     * Every prior case compared a multi-keyword match against zero-score rows, so collapsing the
     * reduce to a boolean left them all green — ranking would silently stop distinguishing a
     * three-keyword match from a one-keyword one, which is the whole point of scoring.
     */
    it('ranks a template matching more type keywords above one matching fewer', STATE_ONLY, () => {
      selectEmail();
      // `final-countdown` carries seven keywords. The first row matches one, the second several,
      // and BOTH are non-zero — so only a counting score can order them.
      internals().emailTemplates.set([
        { id: 'one', name: 'Deadline reminder', subject: 'Sign up' },
        { id: 'many', name: 'Final countdown: last chance, closing soon', subject: 'Deadline' },
      ] as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('final-countdown');

      expect(
        internals()
          .emailTemplatesRendered()
          .map((t) => t.id)
      ).toEqual(['many', 'one']);
    });

    /**
     * The index tie-break at a NON-ZERO score. Testing it only at score 0 leaves the comparator's
     * `|| a.index - b.index` unverified for the case it exists for: several templates matching the
     * type equally, where the server's newest-first order must survive the sort.
     */
    it('keeps the server order among templates that score equally above zero', STATE_ONLY, () => {
      selectEmail();
      // All three carry the same type keyword, so they score identically and only `index` orders
      // them. Ids are deliberately NOT alphabetical, so a comparator falling back to any other
      // key would reorder them visibly.
      internals().emailTemplates.set([
        { id: 'zebra', name: 'Post-event thank you', subject: 'Survey inside' },
        { id: 'alpha', name: 'Post-event thank you', subject: 'Survey inside' },
        { id: 'mike', name: 'Post-event thank you', subject: 'Survey inside' },
      ] as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      expect(
        internals()
          .emailTemplatesRendered()
          .map((t) => t.id)
      ).toEqual(['zebra', 'alpha', 'mike']);
    });

    /**
     * The cap banner must not claim "the FIRST 100" once a spliced row is among them — that is
     * false in exactly the case the splice exists for.
     */
    it('does not claim the drawn rows are the first N when a selection was spliced in', STATE_ONLY, () => {
      selectEmail();
      const templates: { id: string; name: string; subject: string }[] = [{ id: 'chosen', name: 'Bespoke', subject: 'Nothing' }];
      for (let i = 0; i < 600; i++) {
        templates.push({ id: `t${i}`, name: 'Post-event thank you', subject: 'Survey inside' });
      }
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailTemplate(id: string): void }).onSelectEmailTemplate('chosen');
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // Present but NOT promoted: the spliced row takes the last slot, so the first row remains a
      // genuine ranking result. That is what makes the banner's "Showing N of M" honest.
      const drawn = internals().emailTemplatesRendered();
      expect(drawn[drawn.length - 1].id).toBe('chosen');
      expect(internals().emailTemplatesRenderCapMessage()).not.toContain('first');
    });

    /**
     * Reranking must never HIDE the operator's current choice.
     *
     * Ranking depends on the chosen type, so switching type reorders the list under a selection
     * already made: with enough matches for the new type the selected row drops below the render
     * cap and disappears. Nothing else notices — `canStageEmail` stays enabled and staging still
     * clones that now-invisible template, so the operator stages a clone of something they can no
     * longer see or change.
     */
    it('keeps the selected template visible after a type change reranks the list', STATE_ONLY, () => {
      selectEmail();
      // The operator's pick names no type keyword, so reranking sinks it; the 600 rows that follow
      // all match the new type and crowd it out of the first 100 drawn.
      const templates: { id: string; name: string; subject: string }[] = [{ id: 'chosen', name: 'Bespoke template', subject: 'Nothing in particular' }];
      for (let i = 0; i < 600; i++) {
        templates.push({ id: `t${i}`, name: 'Post-event thank you', subject: 'Survey inside' });
      }
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailTemplate(id: string): void }).onSelectEmailTemplate('chosen');
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      const rendered = internals().emailTemplatesRendered();
      expect(rendered.some((t) => t.id === 'chosen')).toBe(true);
      // In the LAST slot, not the first. Promoting it kept the row visible but put a zero-scoring
      // template above every matching one, which contradicts the ranking invariant: the first row
      // is meant to be the best suggestion. Visible-but-not-promoted satisfies both.
      expect(rendered[rendered.length - 1].id).toBe('chosen');
      // And the first row is still a genuine match, which is the invariant that was broken.
      expect(rendered[0].id).not.toBe('chosen');
      // The cap is still honoured — the splice replaces a row rather than appending one.
      expect(rendered.length).toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT);
    });

    it('renders the selector defaulted to the registration push type', () => {
      selectEmail();
      fixture.detectChanges();

      // The picker lives above the PLANNER now, not on Implement. It moved because the stage it
      // resolves to is part of a brief's identity upstream, so it has to be answered before the
      // lookup rather than after a brief already exists.
      // `data-test`, not `data-testid`: that is the attribute `lfx-select` renders from its
      // `dataTest` input. Querying `data-testid` matched the <lfx-select> HOST element instead of
      // the control, so this passed for the wrong reason — the same trap the sibling test below
      // documents.
      const sel = (fixture.nativeElement as HTMLElement).querySelector('[data-test="campaigns-email-stage-select"]');
      expect(sel, 'the email-type selector is not rendered above the planner').not.toBeNull();

      // The RENDERED label, not the signal, and not the form value either. The raw <select> this
      // replaced ignored a `[value]` binding applied before its options existed and fell back to
      // the FIRST option -- so the signal read "main-registration-push" while the control showed
      // CFP Launch, and an operator who never touched the selector silently got CFP copy. Reading
      // the control's own text is the only assertion that can see that class of bug; driving the
      // handler, or reading the FormControl, cannot.
      expect(sel?.textContent).toContain('Main Registration Push');
      expect(sel?.textContent).not.toContain('CFP Launch');

      // The signal the rest of the component reads must agree with what is on screen.
      expect(internals().selectedEmailTypeId()).toBe('main-registration-push');
    });

    // Implement DISPLAYS the type; it must not offer a second control for it. Two selectors bound
    // to the same `emailType` control is what the bots caught: only the planner's lookup follows a
    // change, so switching type on Implement moved the stage while `emailBriefId` still named the
    // previous stage's brief, and generation then sent the new stage against the old brief's id.
    it('shows the chosen type on implement without a second selector', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const display = host.querySelector('[data-testid="campaigns-email-type-display"]');
      expect(display, 'implement does not show which email type is selected').not.toBeNull();
      expect(display?.textContent).toContain('Main Registration Push');

      // `data-test`, not `data-testid`: that is the attribute `lfx-select` renders from its
      // `dataTest` input, and querying the wrong one returns null on a control that IS present --
      // which would make this assertion pass for the wrong reason.
      expect(
        host.querySelector('[data-test="campaigns-email-type-select"]'),
        'implement still renders a second email-type selector; changing it there desyncs the loaded brief'
      ).toBeNull();
    });

    it('drops copy written for the previous type when the type changes', () => {
      selectEmail();
      internals().emailCopy.set({ subject: 'CFP copy', preheader: '', body: '<p>x</p>', cta: '', ctaUrl: '' } as never);

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // The copy on screen was written for the PREVIOUS stage -- its subject, tone and CTA all
      // belong to it. `onStageEmailSend` reads `emailCopy()` unconditionally, so leaving it makes
      // mismatched copy stageable under the new type's label.
      expect(internals().emailCopy()).toBeNull();
    });

    it('drops the previous copy when a regeneration fails', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-77');
      internals().emailCopy.set({ subject: 'Old subject', preheader: '', body: '<p>Old</p>', cta: '', ctaUrl: '' } as never);
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, error: 'upstream refused' }) as never);

      await internals().onGenerateEmailCopy();

      // `onStageEmailSend` reads `emailCopy()` unconditionally, so stale copy left here is
      // stageable -- the operator would send the OLD subject and body while the panel says the
      // regeneration failed.
      expect(internals().emailCopy()).toBeNull();
    });

    it('does not call an unconfirmed audience "building"', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({ id: 'aud-1', status: 'building' } as never);
      fixture.detectChanges();

      const card = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-built"]');
      // The whole argument for this state is that "building" tells the operator the wrong thing:
      // the row is not in flight, it is a finished build whose outcome upstream could not
      // confirm, and the ids in the summary may need reconciling.
      expect(card?.textContent).toContain('unconfirmed');
      expect(card?.textContent).not.toContain('Audience attached');
    });

    it('does NOT offer a rebuild while the outcome is unconfirmed', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({ id: 'aud-1', status: 'building' } as never);
      fixture.detectChanges();

      // Upstream keeps a row BUILDING when a HubSpot list may already exist, and records the ids
      // to reconcile. Observed live: "HubSpot lists ALREADY CREATED (reconcile these before
      // retrying): 30779". Any retry here creates the duplicate contact list that state exists to
      // prevent -- and the empty-state pointer must not appear either, because there IS a row.
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-testid="campaigns-email-audience-btn"]')).toBeNull();
      expect(host.querySelector('[data-testid="campaigns-email-audience-empty"]')).toBeNull();
    });

    it('says why staging is blocked while the outcome is unconfirmed', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'building' } as never);
      fixture.detectChanges();

      const hint = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]');
      // With no retry offered, the copy is the ONLY thing telling the operator what to do next.
      expect(hint?.textContent).toContain('reconcile');
    });

    /**
     * A failed row must not be a DEAD END, and the escape is no longer a button here.
     *
     * The panel used to offer a rebuild so the operator was not stranded. That control is gone
     * with the derived build, so the stage hint carries the whole escape: it has to name the
     * Audience tab, because nothing else on this screen does.
     */
    it('names the escape route when the audience failed', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-testid="campaigns-email-audience-btn"]')).toBeNull();
      expect(host.querySelector('[data-testid="campaigns-email-stage-hint"]')?.textContent).toContain('Audience tab');
    });

    it('explains a disabled Stage button when the audience is present but not built', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      fixture.detectChanges();

      // The hint chain tested PRESENCE while the guard tested STATUS, so this state fell through
      // every branch and rendered an empty span -- a disabled button with no reason, which the
      // panel's own comment says it exists to prevent.
      const hint = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]');
      expect(hint?.textContent?.trim()).toBeTruthy();
      expect(hint?.textContent).toContain('failed');
    });

    it('says the audience is what is missing when only it is missing', () => {
      selectEmail();
      // The hint lives in the Implement panel; without this the panel never renders and the
      // query below would be vacuously undefined rather than asserting anything.
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      fixture.detectChanges();

      const hint = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]');
      // A disabled button with no reason reads as a broken panel -- the same standard the
      // no-brief case above is held to. The Implement tab produces no audience of its own any
      // more, so the hint has to name the tab that does.
      expect(hint?.textContent?.trim()).toContain('Compose the send audience on the Audience tab');
    });

    it('drops the previous brief id when a new brief arrives', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefId.set('brief-old');
      internals().emailAudience.set({ id: 'aud-old', status: 'built' } as never);

      internals().onEmailProceedFromPlanning(emailBrief);

      // `ensureEmailBriefId` returns the cached id when it is set, so a stale one silently points
      // the audience build, the copy generation and the staged draft at the PREVIOUS event's row.
      expect(internals().emailBriefId()).toBe('');
      expect(internals().emailAudience()).toBeNull();
    });

    it('persists the brief FIRST, then creates with the returned brief id', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: 'W/"1"' }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1', result: undefined, error: undefined }));

      await internals().onStageEmailSend();

      // The ORDER is the point: creation posts to /briefs/{id}/campaigns, so a create issued
      // before the persist resolved would have no id to address.
      expect(persistBrief).toHaveBeenCalled();
      const [request, slug, briefId] = create.mock.calls[0];
      expect(briefId).toBe('brief-77');
      expect(slug).toBe('tlf');
      // Asserts the VALUE and where it came from, not merely that create ran.
      expect(request.platforms).toEqual(['hubspot']);
      expect(request.hubspotConfig).toEqual({ sourceEmailId: 'hs-123' });
      expect(request.eventSlug).toBe('kubecon-eu-2026');
      expect(request.eventName).toBe('KubeCon EU 2026');
      // 'staging', NOT 'done'. The create answers 202 with a job id and the HubSpot clone, the
      // audience resolution and the copy application all run in the background job -- so the ack
      // alone is not a created draft. This assertion said 'done' before polling landed, which is
      // exactly the claim that made a dispatcher failure read as success.
      expect(internals().emailStaging()).toBe('staging');
    });

    it('drops the brief-derived state when the foundation changes', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefId.set('brief-from-old-foundation');
      internals().emailAudience.set({ id: 'aud-old', status: 'built' } as never);

      TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-b', slug: 'foundation-b', name: 'Foundation B' }, false);
      await fixture.whenStable();
      fixture.detectChanges();

      // `emailBriefId` names a row in the PREVIOUS foundation, and `ensureEmailBriefId` returns
      // the cached id when set -- so carrying it across would point the audience build, the copy
      // generation and the staged draft at the old foundation's brief while the page says the new
      // one. Silently, because every call still succeeds against that row.
      expect(internals().emailBriefId()).toBe('');
      expect(internals().emailAudience()).toBeNull();
    });

    it('does not cache a brief id that never reached approved', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockReturnValue(of({ enabled: true, briefId: 'brief-77', approved: false }) as never);

      const id = await (internals() as unknown as { ensureEmailBriefId(b: unknown, p: string): Promise<string> }).ensureEmailBriefId(emailBrief, 'tlf');

      // campaign-service gates build-audience AND campaign creation on `approved`, so a cached
      // unapproved id makes every downstream call fail against a brief this session believes is
      // ready -- and the cache short-circuits, so a retry never re-attempts the approval.
      expect(id).toBe('');
      expect(internals().emailBriefId()).toBe('');
    });

    it('reuses a brief this session already owns instead of trying to create a second', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      const persist = vi
        .spyOn(TestBed.inject(CampaignService), 'persistBrief')
        .mockReturnValue(of({ enabled: true, approved: true, briefId: 'brief-77' }) as never);
      // The ownership record the PAID save writes when it generates or restores a brief.
      (internals() as unknown as { knownBriefIds: Map<string, unknown> }).knownBriefIds.set(
        (internals() as unknown as { ownershipKey(p: string, b: unknown): string }).ownershipKey('tlf', emailBrief),
        { id: 'brief-77', etag: 'W/"3"' }
      );

      await (internals() as unknown as { ensureEmailBriefId(b: unknown, p: string): Promise<string> }).ensureEmailBriefId(emailBrief, 'tlf');

      // A first-save call sends no brief_id and is refused as `unowned-brief-exists` against a row
      // this session actually owns. Reusing the recorded id is what keeps a second save on the
      // same brief from looking like an attempt to create a duplicate.
      const [, , knownId, knownEtag] = persist.mock.calls[0] as unknown as [unknown, string, string | null, string | null];
      expect(knownId).toBe('brief-77');
      expect(knownEtag).toBe('W/"3"');
    });

    // The ownership map is keyed on the SAME four parts campaign-service keys a brief on. Under
    // the old two-part key (project, event) an event's paid brief and every stage of its email
    // series shared one entry, so recording one overwrote the others -- and the next save of a
    // sibling sent that other brief's id and was refused as `unowned-brief-exists`. That is the
    // exact failure the reuse test above depends on NOT happening.
    // The stage IS the brief's identity upstream, so changing the type changes WHICH brief the
    // Implement tab is working on. Moving the picker above the planner re-pointed the planner's
    // LOOKUP, but the parent's cached `emailBriefId` is separate state and survived the change --
    // so generate and stage ran the new stage against the previous stage's row. Staging is the
    // one that writes: it clones a HubSpot draft against that brief's audience.
    it('drops the cached brief id when the type change moves the stage', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-cfp');

      // 'main-registration-push' -> 'thank-you-survey' is a real STAGE change
      // (Registration Push -> Post-Event), not merely a label change.
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      expect(internals().emailBriefId(), 'the previous stage brief id survived a type change; generate and stage would address the wrong row').toBe('');
    });

    // The audience card's origin, the unattached-list warning and the skip all describe the
    // previous stage's send. Clearing `emailAudience` alone left them rendering on the new one.
    it('drops the audience-derived state when the type change moves the stage', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-cfp');
      internals().emailAudienceOrigin.set('composed');
      internals().onAudienceComposeUnattached({
        master: { listId: '900', name: 'Master', hubspotUrl: 'https://app.hubspot.com/l/1' },
        briefId: '',
        projectSlug: internals().activeFoundationSlug(),
        scope: internals().emailAudienceScope(),
      });
      internals().emailAudienceSkipped.set(true);

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      expect(internals().emailAudienceOrigin()).toBeNull();
      expect(internals().emailAudienceUnattached()).toBeNull();
      expect(internals().emailAudienceSkipped()).toBe(false);
    });

    // The other half of the gate, and the one a wholesale reset would break. Twelve types collapse
    // onto six stages -- `cfp-launch` and `colocated-cfp-reminder` are both CFP Launch -- so
    // switching between two types that share a stage addresses the SAME brief upstream. Discarding
    // the loaded brief there would make the operator re-fetch and re-generate for no reason, and
    // would silently drop a built audience. Resetting only when the STAGE moves is what separates
    // the two cases; without this test, a reset on every type change passes just as happily.
    // Clearing the cached ID alone is not enough. `emailBriefOutput` holds the CONTENT of the
    // previous stage's brief, and `ensureEmailBriefId` persists whatever it is handed — so with an
    // empty id it creates a NEW row for the new stage carrying the OLD stage's copy, which is the
    // wrong-brief association the id clearing exists to prevent, reached one step later.
    it('drops the previous stage brief output, not just its id', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-cfp');

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      expect(internals().emailBriefId()).toBe('');
      expect(internals().emailBriefOutput(), "the previous stage's brief content survived; a persist would file it under the new stage").toBeNull();
    });

    // An UNAPPROVED restore must not cache the id. `ensureEmailBriefId` short-circuits on a
    // non-empty `emailBriefId`, so caching an unapproved brief's id means the persist -- which is
    // what approves -- never runs again, and audience, copy and staging keep failing against a
    // brief campaign-service will not create from. `persistEmailBrief` already applies this exact
    // rule at its own call site ("caching that id would make every downstream call fail"); the
    // restore path is the other way in.
    it('does not cache the restored brief id when the stored brief is unapproved', STATE_ONLY, () => {
      selectEmail();

      (
        internals() as unknown as {
          onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        }
      ).onRestoreSavedEmailBrief(emailBrief, 'brief-unapproved', 'W/"2"', false);

      expect(internals().emailBriefId(), 'an unapproved brief id was cached; ensureEmailBriefId will short-circuit and never retry approval').toBe('');
    });

    it('caches the restored brief id when the stored brief IS approved', STATE_ONLY, () => {
      selectEmail();

      (
        internals() as unknown as {
          onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        }
      ).onRestoreSavedEmailBrief(emailBrief, 'brief-approved', 'W/"2"', true);

      expect(internals().emailBriefId()).toBe('brief-approved');
    });

    // Restoring an approved brief must not WRITE to it. The handoff resets derived state --
    // which clears `emailBriefId` -- and then calls `warmEmailBriefId`, whose only guard is that
    // the id is non-empty. With the id installed AFTER the handoff, that guard passed and
    // `ensureEmailBriefId` sent a replacement-and-approval request for a brief the operator had
    // only OPENED. The ownership cache supplied an id and ETag, so it succeeded rather than
    // failing loudly.
    //
    // The id is now handed THROUGH the handoff, so the warm-up sees it and skips.
    it('does not persist the brief when an approved one is restored', STATE_ONLY, () => {
      selectEmail();
      persistBrief.mockClear();

      (
        internals() as unknown as {
          onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        }
      ).onRestoreSavedEmailBrief(emailBrief, 'brief-approved', 'W/"2"', true);

      expect(persistBrief, 'restoring an approved brief wrote to it; the operator only opened it').not.toHaveBeenCalled();
      expect(internals().emailBriefId(), 'the restored id must still be installed').toBe('brief-approved');
    });

    // A live staging POLL must be cancelled by a stage change, not merely counted past.
    // `pollStagingJob` never reads `emailStagingGeneration`, so bumping it only guards the awaits
    // BEFORE the poll starts. A subscription already running keeps writing `done`/`error` — and
    // announces "Draft created" for the PREVIOUS send under the newly selected stage.
    // `resetEmailBriefDerivedState` cancels it for exactly this reason; the stage-change path has
    // the same hazard and had none of the protection.
    it('cancels a live staging poll when the type change moves the stage', STATE_ONLY, () => {
      selectEmail();
      internals().emailStaging.set('staging');
      const sub = { unsubscribe: vi.fn(), closed: false };
      (internals() as unknown as { stagingJobSubscription: unknown }).stagingJobSubscription = sub;

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      expect(sub.unsubscribe, 'the previous stage poll kept running and can still report against the new stage').toHaveBeenCalled();
      expect((internals() as unknown as { stagingJobSubscription: unknown }).stagingJobSubscription).toBeNull();
      expect(internals().emailStaging()).toBe('idle');
    });

    // `conflictMessages` is SHARED with the paid persist banner, so the email-only "re-select this
    // email type" step must not live in it -- paid has no type selector, and an earlier revision
    // told paid users to use one. The step belongs to `emailSaveFailureMessage`, the one caller
    // that knows a stage is involved.
    it('keeps the email re-select step out of the shared conflict copy', STATE_ONLY, () => {
      selectEmail();
      const shared = (internals() as unknown as { conflictMessages: Record<string, string> }).conflictMessages;

      expect(shared['unowned-brief-exists'], 'the shared copy names a control the paid surface does not have').not.toContain('email type');

      const priv = internals() as unknown as {
        emailBriefConflict: string | null;
        emailSaveFailureMessage(c: string): string;
      };
      priv.emailBriefConflict = 'unowned-brief-exists';
      const emailCopy = priv.emailSaveFailureMessage('so no audience was built.');
      expect(emailCopy, 'the email path dropped the re-select step').toContain('Re-select this email type');
    });

    // `stale-brief` and `unverified-validator` return a NON-EMPTY briefId with approved:false, so
    // recording the conflict only when the id is empty dropped it — and the operator got the
    // generic "Try again" copy for a refusal that retrying alone cannot clear. That is the exact
    // gap `emailBriefConflict` was added to close.
    it.each([['stale-brief'], ['unverified-validator']])('records the %s conflict even though the server returned a brief id', STATE_ONLY, async (conflict) => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockReturnValue(
        of({ enabled: true, briefId: 'brief-77', etag: null, created: false, approved: false, conflict }) as never
      );

      await (internals() as unknown as { ensureEmailBriefId(b: unknown, p: string): Promise<string> }).ensureEmailBriefId(emailBrief, 'tlf');

      const priv = internals() as unknown as { emailBriefConflict: string | null; emailSaveFailureMessage(c: string): string };
      expect(priv.emailBriefConflict, 'the conflict was dropped because the server returned an id').toBe(conflict);
      expect(priv.emailSaveFailureMessage('so no audience was built.')).not.toContain('The brief could not be saved,');
    });

    // Ownership is what `onRestoreSavedEmailBrief`'s own JSDoc calls "the part that matters", and
    // no test asserted it: removing the `rememberBriefId` block left the restore tests green.
    // Without the record, the next save arrives with no `knownBriefId` and is refused as
    // `unowned-brief-exists` — against a row this session demonstrably just opened.
    //
    // The UNAPPROVED case is the one that needs it most: `emailBriefId` deliberately stays empty
    // there, so ownership is the ONLY thing carrying the restore forward.
    it.each([
      ['an approved brief', true, 'brief-approved'],
      ['an unapproved brief', false, 'brief-unapproved'],
    ])('records ownership when restoring %s', STATE_ONLY, (_label, approved, id) => {
      selectEmail();

      (
        internals() as unknown as {
          onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        }
      ).onRestoreSavedEmailBrief(emailBrief, id, 'W/"4"', approved);

      const priv = internals() as unknown as {
        ownershipKey(p: string, b: unknown): string | null;
        knownBriefIds: Map<string, { id: string; etag: string | null }>;
        activeFoundationSlug(): string;
      };
      // The handler keys on `activeFoundationSlug()`, so the test must read the same source rather
      // than hardcode a slug -- a mismatch here would look like "no ownership recorded".
      const key = priv.ownershipKey(priv.activeFoundationSlug(), emailBrief);
      expect(key).not.toBeNull();
      expect(priv.knownBriefIds.get(key as string), 'the restore recorded no ownership; the next save will be refused as unowned').toEqual(
        expect.objectContaining({ id, etag: 'W/"4"' })
      );
    });

    // The paid restore adopts the brief's own program; the email restore did not, so an Events
    // brief could be opened while the selector still said Education. Correcting it by hand then
    // triggers the program-switch reset and discards the brief the operator just restored.
    it('adopts the restored email brief program', STATE_ONLY, () => {
      selectEmail();
      internals().selectorForm.controls.programType.setValue('education');

      (
        internals() as unknown as {
          onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        }
      ).onRestoreSavedEmailBrief({ ...emailBrief, programType: 'events' }, 'brief-1', 'W/"1"', true);

      const programControl = internals().selectorForm.controls.programType as unknown as { value: string };
      expect(programControl.value, 'the restored brief opened under the wrong program').toBe('events');
    });

    it('keeps the loaded brief when two types share one stage', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('cfp-launch');
      internals().emailBriefId.set('brief-cfp');

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('colocated-cfp-reminder');

      expect(internals().emailBriefId(), 'a same-stage type change discarded the loaded brief; it addresses the same row upstream').toBe('brief-cfp');
    });

    it('keys ownership per delivery type and stage, not per event', STATE_ONLY, () => {
      const key = (b: unknown): string => (internals() as unknown as { ownershipKey(p: string, b: unknown): string }).ownershipKey('tlf', b);

      const paid = { ...emailBrief, deliveryType: 'paid-marketing', emailStage: undefined };
      const cfp = { ...emailBrief, deliveryType: 'email', emailStage: 'CFP Launch' };
      const countdown = { ...emailBrief, deliveryType: 'email', emailStage: 'Final Countdown' };

      const keys = [key(paid), key(cfp), key(countdown)];
      expect(new Set(keys).size, `siblings of one event collapsed onto the same ownership key: ${JSON.stringify(keys)}`).toBe(3);

      // A brief with no delivery type normalizes to paid with an empty stage, so it must land on
      // the SAME key as an explicit paid brief -- otherwise restoring a legacy brief would orphan
      // the ownership record written for the same row under its explicit identity.
      //
      // That is a KEY-COMPATIBILITY requirement, not a claim about where such a row came from:
      // pre-field email briefs exist and are indistinguishable after the backfill
      // (linuxfoundation/lfx-self-serve#2214). This assertion holds either way.
      const legacy = { ...emailBrief, deliveryType: undefined, emailStage: undefined };
      expect(key(legacy)).toBe(key(paid));
    });

    it('reports an error when the staging job FAILS after the ack', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailBriefId.set('brief-77');
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1', result: undefined, error: undefined }) as never);
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(of({ campaigns: [], errors: ['hubspot refused the clone'] }) as never);

      await internals().onStageEmailSend();

      // The failure the ack hid: the draft was never created, and saying "Draft created in
      // HubSpot" would send the operator looking for something that does not exist.
      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingMessage()).toContain('hubspot refused the clone');
    });

    it('reports done once the staging job settles successfully', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailBriefId.set('brief-77');
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1', result: undefined, error: undefined }) as never);
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(of({ campaigns: [], errors: [] }) as never);

      await internals().onStageEmailSend();

      expect(internals().emailStaging()).toBe('done');
    });

    it('clears variant B when the A/B toggle is switched off', STATE_ONLY, async () => {
      selectEmail();
      internals().abTestForm.controls.enabled.setValue(true);
      internals().abTestForm.controls.subjectB.setValue('Variant B subject');
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>Variant B body</p>');
      fixture.detectChanges();

      internals().abTestForm.controls.enabled.setValue(false);
      fixture.detectChanges();

      // A re-enable must start clean. Leaving the draft behind would stage copy the operator
      // never confirmed they still wanted -- and because the clearing now lives on the control's
      // own stream, this also covers the programmatic resets, which a (change) handler missed.
      expect(internals().abTestSubjectB()).toBe('');
      expect(internals().abTestBodyHtmlB()).toBe('');
    });

    it.each([
      ['only a subject', 'Variant B subject', ''],
      ['only a body', '', '<p>Variant B body</p>'],
    ])('omits the A/B fields when variant B has %s', async (_label, subjectB, bodyHtmlB) => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().abTestForm.controls.enabled.setValue(true);
      internals().abTestForm.controls.subjectB.setValue(subjectB);
      internals().abTestForm.controls.bodyHtmlB.setValue(bodyHtmlB);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // Sending the filled half with the other as '' is worse than sending neither: upstream
      // reads an empty string as "blank this field", so a half-filled variant B would clear the
      // very content it was meant to set.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.abTestEnabled).toBeUndefined();
      expect(cfg?.subjectB).toBeUndefined();
      expect(cfg?.bodyHtmlB).toBeUndefined();
    });

    /** #3306: the event page's links ride with the stage request, so the controller can judge the body as the preview did. */
    it('sends the event-page links with the stage request as secondaryLinkUrls', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://kubecon.example/eu/',
          cfpUrl: 'https://kubecon.example/eu/cfp',
          agendaUrl: '',
          venueUrl: 'https://training.linuxfoundation.org/venue',
          sponsorshipUrl: 'not a url',
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: 'Register', ctaUrl: 'https://kubecon.example/eu/' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.secondaryLinkUrls).toEqual(['https://kubecon.example/eu/cfp', 'https://training.linuxfoundation.org/venue']);
    });

    it('omits the CTA when the registration URL is not an http(s) URL', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'javascript:alert(1)' },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // The generator copies the Registration URL EXACTLY, so an unusable one arrives here
      // unchanged -- `canonicalHttpUrl` is what refuses it.
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: 'Register', ctaUrl: 'javascript:alert(1)' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // The controller drops a non-http(s) buttonUrl, so a "non-empty" preview test would show a
      // button the draft never gets. Both sides read one predicate precisely to avoid that.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.buttonText).toBeUndefined();
      expect(cfg?.['buttonUrl']).toBeUndefined();
      expect(internals().emailCtaIsStageable()).toBe(false);
    });

    // These pin the CLASS, not one instance. The defect they guard against is a predicate
    // duplicated between the preview and the wire path and drifting apart, so the operator
    // previews something the draft never gets. Each case below is a value that passes a naive
    // `!== ''` and is then dropped server-side.
    it.each([
      ['whitespace-only subject B', '   ', '<p>b</p>'],
      ['whitespace-only body B', 'S', '   '],
      // The cases that actually pin the CLASS: each is a NON-EMPTY string that `.trim()` keeps
      // and that renders nothing, so it passes a naive check here and is dropped by the
      // controller's `hasVisibleHtmlText` gate. Variant B is the one body that reaches this gate
      // without passing any server predicate first -- it is typed into the form.
      ['zero-width-space body B', 'S', '<p>\u200B\u200B</p>'],
      ['soft-hyphen body B', 'S', '<p>\u00AD</p>'],
      ['Hangul-filler body B', 'S', '<p>\u3164</p>'],
      // The SUBJECT half of the same predicate. `sanitizeDisplayText` reduces each of these to
      // '' at the request boundary, so the controller drops the whole A/B triple -- while a bare
      // `.trim()` on the client called them present and previewed two variants.
      ['zero-width-space subject B', '\u200B\u200B', '<p>b</p>'],
      ['soft-hyphen subject B', '\u00AD', '<p>b</p>'],
      ['Hangul-filler subject B', '\u3164', '<p>b</p>'],
    ])('does not stage an A/B test for %s', STATE_ONLY, async (_label, subjectB, bodyHtmlB) => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().abTestForm.controls.enabled.setValue(true);
      internals().abTestForm.controls.subjectB.setValue(subjectB);
      internals().abTestForm.controls.bodyHtmlB.setValue(bodyHtmlB);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // The predicate and the wire must agree: buildHubSpotConfig trims, so an untrimmed check
      // here would preview an A/B test that stages as single-variant.
      expect(internals().abTestIsStageable()).toBe(false);
      expect(create.mock.calls[0][0].hubspotConfig?.abTestEnabled).toBeUndefined();
    });

    it('generates variant B with ordinary stage copy and writes it into the B controls', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-77');
      internals().abTestForm.controls.enabled.setValue(true);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const gen = vi
        .spyOn(TestBed.inject(CampaignService), 'generateEmailCopy')
        .mockReturnValue(of({ enabled: true, copy: { subject: 'B subject', preheader: 'P', body: '<p>B body</p>', cta: '', ctaUrl: '' } }) as never);

      await internals().onGenerateAbTestCopy();
      fixture.detectChanges();

      // Variant B takes ORDINARY stage copy -- variant A is the one that requests urgency-fomo.
      // If B passed the same variant, both arms would be the same draft and the A/B test would
      // compare a copy against itself, which no other test would notice.
      expect(gen).toHaveBeenCalledWith(expect.any(String), 'brief-77', internals().selectedEmailStage(), undefined, undefined);
      expect(internals().abTestSubjectB()).toBe('B subject');
      expect(internals().abTestBodyHtmlB()).toBe('<p>B body</p>');
    });

    it('sanitizes the previewed sponsor name, so preview and wire cannot disagree', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          sponsors: [{ name: 'Acme\u202Emoc.evil', logoUrl: 'https://cdn.example.com/acme.png' }],
        },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      fixture.detectChanges();

      // U+202E visually REVERSES what follows it. The controller strips it before staging, so
      // leaving the preview unsanitised showed the operator a reversed name while the sent
      // draft carried the cleaned one -- the preview lying about the result.
      const [sponsor] = internals().emailSponsors();
      expect(sponsor.name).toBe('Acmemoc.evil');
      expect(sponsor.name).not.toContain('\u202E');
    });

    it('truncates a long sponsor name the same way the controller does', STATE_ONLY, () => {
      selectEmail();
      // 150 code points, past the 100 the controller forwards. An astral character at the cut
      // boundary proves the slice is by CODE POINT -- a UTF-16 slice would split the surrogate
      // pair and emit a lone half.
      const longName = `${'a'.repeat(99)}\u{1F600}${'b'.repeat(50)}`;
      internals().emailBriefOutput.set({
        eventDetails: {
          sponsors: [{ name: longName, logoUrl: 'https://cdn.example.com/acme.png' }],
        },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      fixture.detectChanges();

      const [sponsor] = internals().emailSponsors();
      // The preview must show what the draft will carry. Showing the full name promised a label
      // the sent email does not have.
      expect([...sponsor.name].length).toBe(MAX_SPONSOR_NAME_LENGTH);
      expect(sponsor.name.endsWith('\u{1F600}')).toBe(true);
    });

    it('keeps a subject typed during generation but still fills the untouched body', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-77');
      internals().abTestForm.controls.enabled.setValue(true);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const pending = new Subject<unknown>();
      const gen = vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(pending as never);

      const generating = internals().onGenerateAbTestCopy();
      await vi.waitFor(() => expect(gen).toHaveBeenCalled());

      // The fields stay EDITABLE while generating -- making the operator wait to type would be
      // worse -- so this is an ordinary thing to do, not an edge case.
      internals().abTestForm.controls.subjectB.setValue('My own subject');
      fixture.detectChanges();

      pending.next({ enabled: true, copy: { subject: 'Generated subject', preheader: 'P', body: '<p>Generated body</p>', cta: '', ctaUrl: '' } });
      pending.complete();
      await generating;
      fixture.detectChanges();

      // Per FIELD, not all-or-nothing: the typed subject survives, the untouched body is filled.
      // `isCurrent()` tracks toggles and resets; a keystroke is neither, so without this guard
      // the late response silently replaced what the operator had just written.
      expect(internals().abTestForm.controls.subjectB.value).toBe('My own subject');
      expect(internals().abTestForm.controls.bodyHtmlB.value).toBe('<p>Generated body</p>');
    });

    it('discards a variant B response that lands after the operator toggled A/B off', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-77');
      internals().abTestForm.controls.enabled.setValue(true);
      fixture.detectChanges();

      // The SECOND await window: let the brief-id persist resolve so execution parks on
      // `generateEmailCopy`, which is what the sibling test above cannot reach. This is where a
      // late response would write back into the controls the toggle-off emptied.
      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const pending = new Subject<unknown>();
      const gen = vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(pending as never);

      const generating = internals().onGenerateAbTestCopy();
      await vi.waitFor(() => expect(gen).toHaveBeenCalled());

      internals().abTestForm.controls.enabled.setValue(false);
      fixture.detectChanges();

      pending.next({ enabled: true, copy: { subject: 'B subject', preheader: 'P', body: '<p>B body</p>', cta: '', ctaUrl: '' } });
      pending.complete();
      await generating;
      fixture.detectChanges();

      // The post-`generateEmailCopy` isCurrent() guard is what stops this write-back. Without
      // it the discarded draft reappears in the cleared controls.
      expect(internals().abTestForm.controls.subjectB.value).toBe('');
      expect(internals().abTestForm.controls.bodyHtmlB.value).toBe('');
    });

    it('abandons an in-flight variant B generation when the operator toggles A/B off', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().abTestForm.controls.enabled.setValue(true);
      fixture.detectChanges();

      // Hold the BRIEF-ID persist open, not generateEmailCopy. onGenerateAbTestCopy awaits
      // ensureEmailBriefId first, so this is the boundary where the toggle can land while the
      // generation is genuinely in flight -- holding the later call resolved too early to race.
      const persisting = new Subject<unknown>();
      persistBrief.mockReturnValue(persisting as never);
      const gen = vi
        .spyOn(TestBed.inject(CampaignService), 'generateEmailCopy')
        .mockReturnValue(of({ enabled: true, copy: { subject: 'B subject', preheader: 'P', body: '<p>B body</p>', cta: '', ctaUrl: '' } }) as never);

      const generating = internals().onGenerateAbTestCopy();
      await vi.waitFor(() => expect(persistBrief).toHaveBeenCalled());

      // Operator changes their mind mid-flight. This routes through clearAbTestDraft().
      internals().abTestForm.controls.enabled.setValue(false);
      fixture.detectChanges();

      persisting.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null });
      persisting.complete();
      await generating;
      fixture.detectChanges();

      // WHAT THIS PINS: `clearAbTestDraft()`'s `abTestCopyGeneration` bump, for the FIRST await
      // window (the brief-id persist).
      //
      // `onGenerateAbTestCopy` captures `++this.abTestCopyGeneration`; toggling off mid-flight
      // runs `clearAbTestDraft`, which bumps it again. When the persist resolves, `isCurrent()`
      // is false and the method returns BEFORE `generateEmailCopy` is called -- which is what
      // `expect(gen).not.toHaveBeenCalled()` below asserts. Delete the bump and the guard is
      // bypassed: the call happens and this test fails.
      //
      // The SECOND await window -- after `generateEmailCopy` resolves, where a late response
      // would write back into the cleared controls -- is NOT covered here. Reaching it needs the
      // generation call itself held open, not the persist.

      expect(gen).not.toHaveBeenCalled();
      // The CONTROLS, not the `toSignal` mirrors, which lag a setValue landing outside change
      // detection -- asserting the mirrors let a stale write through unnoticed.
      expect(internals().abTestForm.controls.subjectB.value).toBe('');
      expect(internals().abTestForm.controls.bodyHtmlB.value).toBe('');
    });

    it('keeps a terminal staging banner when the type changes after a completed stage', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailStaging.set('done');
      internals().emailStagingMessage.set('Draft created');
      fixture.detectChanges();

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('registration-launch');
      fixture.detectChanges();

      // A FINISHED stage has nothing to abandon. Cancelling unconditionally erased the
      // operator's confirmation that the send they just made exists -- the state the banner is
      // there to report.
      expect(internals().emailStaging()).toBe('done');
      expect(internals().emailStagingMessage()).toBe('Draft created');
    });

    it('does not leave the Stage button spinning when the type changes mid-stage', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailStaging.set('staging');
      // A REAL subscription and a non-empty message, so the unsubscribe and the message clear are
      // actually exercised rather than asserted against values that were already correct.
      const polled = new Subject<unknown>();
      const sub = polled.subscribe();
      (fixture.componentInstance as unknown as { stagingJobSubscription: unknown }).stagingJobSubscription = sub;
      internals().emailStagingMessage.set('Creating draft...');
      fixture.detectChanges();

      // `main-registration-push` maps to the SAME stage as the default, which is the whole
      // point. A type change abandons an in-flight stage by bumping `emailStagingGeneration`,
      // so `onStageEmailSend` returns at its `isCurrent()` check WITHOUT touching
      // `emailStaging`. The stage-change branch that resets it does not run here, so
      // invalidating without cleaning up left the button spinning until a reload. A
      // different-stage type takes that other branch and would prove nothing.
      expect(internals().selectedEmailStage()).toBe('Registration Push');

      // `registration-launch`, not `main-registration-push`: the latter IS the default, so
      // `onSelectEmailType` returns early and the test proves nothing.
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('registration-launch');
      fixture.detectChanges();

      expect(internals().selectedEmailStage()).toBe('Registration Push');
      expect(internals().emailStaging()).toBe('idle');
      // The poll is CANCELLED, not merely bumped past: `pollStagingJob` never reads the
      // generation counter, so a live subscription would keep writing done/error for the
      // abandoned send.
      expect(sub.closed).toBe(true);
      expect(internals().emailStagingMessage()).toBe('');
    });

    it('drops variant B when A/B is toggled off and back ON during the await', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      internals().abTestForm.controls.enabled.setValue(true);
      internals().abTestForm.controls.subjectB.setValue('B subject');
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>B body</p>');
      fixture.detectChanges();

      const persisting = new Subject<unknown>();
      persistBrief.mockReturnValue(persisting as never);
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      const staging = internals().onStageEmailSend();
      await vi.waitFor(() => expect(persistBrief).toHaveBeenCalled());

      // OFF then back ON, both inside the await. The toggle-off ran clearAbTestDraft and emptied
      // the B controls; toggling back on does NOT restore them.
      internals().abTestForm.controls.enabled.setValue(false);
      internals().abTestForm.controls.enabled.setValue(true);
      fixture.detectChanges();

      persisting.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null });
      persisting.complete();
      await staging;

      // A live `abTestEnabled()` re-read sees TRUE again here and ships the pre-await snapshot --
      // a variant whose controls the operator emptied. Only a monotonic discard counter survives
      // the round trip, because a cancel cannot be un-bumped by a second toggle.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.abTestEnabled).toBeUndefined();
      expect(cfg?.subjectB).toBeUndefined();
      expect(internals().abTestForm.controls.subjectB.value).toBe('');
    });

    it('drops variant B when the operator toggles A/B off during the brief-id await', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      internals().abTestForm.controls.enabled.setValue(true);
      internals().abTestForm.controls.subjectB.setValue('B subject');
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>B body</p>');
      fixture.detectChanges();

      // Hold the brief-id persist open so the operator's edit lands mid-stage -- the ordering in
      // which a live read and a snapshot disagree.
      const persisting = new Subject<unknown>();
      persistBrief.mockReturnValue(persisting as never);
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      const staging = internals().onStageEmailSend();
      await vi.waitFor(() => expect(persistBrief).toHaveBeenCalled());

      // Operator turns A/B off while the round trip is in flight.
      internals().abTestForm.controls.enabled.setValue(false);
      fixture.detectChanges();

      persisting.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null });
      persisting.complete();
      await staging;

      // NARROWING wins. The snapshot stops a mid-stage edit producing a config that never
      // coexisted, but "turn A/B off" is the operator explicitly cancelling -- honouring the
      // snapshot there shipped a two-variant test they had just stopped, which recipients see
      // and which cannot be undone after staging. So the variant is DROPPED.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.abTestEnabled).toBeUndefined();
      expect(cfg?.subjectB).toBeUndefined();
      expect(cfg?.bodyHtmlB).toBeUndefined();
      // The rest of the snapshot still holds -- only the A/B triple narrows.
      expect(cfg?.subject).toBe('S');
    });

    it('forwards variant B preheader as previewTextB, so B does not inherit A', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'A preheader', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      internals().abTestForm.controls.enabled.setValue(true);
      internals().abTestForm.controls.subjectB.setValue('B subject');
      internals().abTestForm.controls.preheaderB.setValue('  B preheader  ');
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>B body</p>');
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // Trimmed, and DISTINCT from A's. These are the INBOUND names; the controller renames
      // them to previewText/previewTextB on the wire (covered in the controller spec). Without
      // B's own value campaign-service preserves the parent's preview text, so B silently ran
      // with A's preheader -- biasing a test whose winner is judged on opens.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.preheaderB).toBe('B preheader');
      expect(cfg?.preheader).toBe('A preheader');
    });

    it('omits previewTextB when blank rather than blanking B preheader', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'A preheader', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      internals().abTestForm.controls.enabled.setValue(true);
      internals().abTestForm.controls.subjectB.setValue('B subject');
      internals().abTestForm.controls.preheaderB.setValue('   ');
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>B body</p>');
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // ABSENT, not ''. Upstream preserves the parent's preview text for an absent value, so
      // sending an empty string would BLANK B's preheader instead of leaving it alone.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.preheaderB).toBeUndefined();
      expect(cfg?.abTestEnabled).toBe(true);
    });

    it('still links the hero when the generator omitted the button url', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          registrationUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
          heroImageUrl: 'https://cdn.example.com/hero.png',
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // CFP Launch: a button with no destination, but the event page is still the right
      // target for the hero image.
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Speak</p>', cta: 'Submit Your Proposal', ctaUrl: '' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // Gating the hero link on the CTA predicate cost the image its link on exactly the stages
      // where the generator withholds a button url -- a regression from repointing that
      // predicate at the generator's destination.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.heroLinkUrl).toBe('https://events.linuxfoundation.org/kubecon-eu-2026/');
      expect(cfg?.buttonUrl).toBeUndefined();
    });

    it('trims the previewed preheaders and falls B back to A', STATE_ONLY, () => {
      selectEmail();
      internals().emailCopy.set({ subject: 'S', preheader: '  A preheader  ', body: '<p>b</p>', cta: '', ctaUrl: '' });
      internals().abTestForm.controls.preheaderB.setValue('   ');
      fixture.detectChanges();

      // Whitespace-only reads as ABSENT on both cards, matching the wire: staging trims and
      // omits, so an untrimmed preview showed a blank line the send would never produce.
      expect(internals().emailPreheaderPreview()).toBe('A preheader');
      expect(internals().abTestPreheaderBForSend()).toBe('');
      // B with none of its own shows A's -- what upstream actually does with an absent
      // previewTextB, rather than an empty line.
      expect(internals().abTestPreheaderBPreview()).toBe('A preheader');

      internals().abTestForm.controls.preheaderB.setValue('  B preheader  ');
      fixture.detectChanges();
      expect(internals().abTestPreheaderBForSend()).toBe('B preheader');
      expect(internals().abTestPreheaderBPreview()).toBe('B preheader');
    });

    it('accepts a CTA url that differs from the brief only by a trailing slash', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/' },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // Same page, no trailing slash. `canonicalHttpUrl` does NOT equalise this, so a strict
      // comparison silently dropped the button for a generation that had followed its
      // instructions.
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        body: '<p>Join</p>',
        cta: 'Register',
        ctaUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026',
      });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.buttonUrl).toBe('https://events.linuxfoundation.org/kubecon-eu-2026');
      expect(cfg?.buttonText).toBe('Register');
    });

    it('refuses a CTA url the brief never contained', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/' },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // A public-looking URL the model invented. The generator is told to copy the brief's
      // Registration URL exactly or omit the field, so anything else is a model that did not
      // follow its instructions.
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join</p>', cta: 'Register', ctaUrl: 'https://evil.example.com/phish' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // Checking only that the URL is public-looking would ship this button pointing at a host
      // the brief never contained.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.buttonUrl).toBeUndefined();
      expect(cfg?.buttonText).toBeUndefined();
    });

    it('accepts a CTA url that matches the brief, modulo canonical form', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/' },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        body: '<p>Join</p>',
        cta: 'Register',
        ctaUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
      });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // The equality check must not refuse the legitimate case -- that would be the
      // over-denial this file keeps guarding against.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.buttonUrl).toBe('https://events.linuxfoundation.org/kubecon-eu-2026/');
      expect(cfg?.buttonText).toBe('Register');
    });

    it('sends no button when the generator omitted its url, even with a registration URL', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // "Submit Your Proposal" on CFP Launch. The generator OMITS `url` for the stages where
      // registration is the wrong destination -- it is told to copy the Registration URL exactly
      // or omit the field, never invent one.
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Speak with us</p>', cta: 'Submit Your Proposal', ctaUrl: '' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // Substituting the brief's registrationUrl here pointed "Submit Your Proposal" at the
      // registration page -- a button that goes somewhere the operator never chose. No
      // destination means no button.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.buttonUrl).toBeUndefined();
      expect(cfg?.buttonText).toBeUndefined();
    });

    it('omits a whitespace-only CTA even when the registration URL is valid', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '   ', ctaUrl: '' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // The destination is fine here; the LABEL is the problem. Without the trim this sent a
      // blank buttonText the controller then dropped, so the preview showed a button the draft
      // never got -- the same drift, reached from the other side.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.buttonText).toBeUndefined();
      expect(cfg?.buttonUrl).toBeUndefined();
      expect(internals().emailCtaLabel()).toBe('');
    });

    it('omits heroLinkUrl when the registration URL is not an http(s) URL, but keeps the image', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'javascript:alert(1)',
          heroImageUrl: 'https://events.example/hero.png',
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // Copy is required for the hero to ship at all: a hero with no body reaches
      // RebuildEmailContent with an empty body and drops the clone's body entirely.
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // The existing test used an EMPTY registrationUrl, which passes under either predicate, so
      // the tightening from `!== ''` to emailCtaIsStageable() was untested. A non-http(s) value
      // separates them: the image still ships, unlinked, which is the right degrade.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.heroImageUrl).toBe('https://events.example/hero.png');
      expect(cfg?.heroLinkUrl).toBeUndefined();
    });

    it.each([
      ['a whitespace-only body', '   '],
      ['an empty body', ''],
    ])('withholds the hero and sponsors for %s', STATE_ONLY, async (_label, body) => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://events.example/register',
          heroImageUrl: 'https://events.example/hero.png',
          sponsors: [{ name: 'Acme', logoUrl: 'https://events.example/acme.png' }],
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // Copy EXISTS — generation requires a subject, not a body — so `copy !== null` passed while
      // the controller trimmed bodyHtml away and the hero shipped anyway. That is the data-loss
      // case, reached from the one direction a null check cannot see.
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body, cta: '', ctaUrl: '' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.heroImageUrl).toBeUndefined();
      expect(cfg?.sponsors).toBeUndefined();
      expect(internals().emailBodyIsStageable()).toBe(false);
    });

    it('canonicalizes the preview hero and drops blank-name sponsors, matching the controller', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://events.example/register',
          heroImageUrl: 'https://user:secret@cdn.example.com/hero.png',
          sponsors: [
            { name: '   ', logoUrl: 'https://cdn.example.com/blank.png' },
            { name: 'Acme', logoUrl: 'https://cdn.example.com/acme.png' },
          ],
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      fixture.detectChanges();

      // The model returned the RAW trimmed value and kept blank-name sponsors, while the
      // controller canonicalizes and filters on the name too — so the preview bound a
      // credentialed <img src> and showed a logo the draft omits. Both now read one shared
      // canonicalHttpUrl, so the two cannot restate the rule differently.
      expect(internals().emailHeroImageUrl()).toBe('https://cdn.example.com/hero.png');
      expect(internals().emailSponsors()).toEqual([{ name: 'Acme', logoUrl: 'https://cdn.example.com/acme.png' }]);
    });

    it('loads the preview hero only for https linuxfoundation.org hosts', STATE_ONLY, () => {
      selectEmail();
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      const previewFor = (heroImageUrl: string): string => {
        internals().emailBriefOutput.set({
          eventDetails: {
            name: 'KubeCon EU 2026',
            slug: 'kubecon-eu-2026',
            countryCode: 'NL',
            registrationUrl: 'https://events.example/register',
            heroImageUrl,
          },
        } as unknown as CampaignBriefOutput);
        fixture.detectChanges();
        return internals().emailHeroPreviewUrl();
      };

      expect(previewFor('https://events.linuxfoundation.org/hero.png')).toBe('https://events.linuxfoundation.org/hero.png');
      expect(previewFor('https://linuxfoundation.org/hero.png')).toBe('https://linuxfoundation.org/hero.png');
      // Parsed-hostname match, not a string suffix: the first three below look like the trusted
      // name but are not it; then a non-https scheme, and an unrelated host as the control.
      expect(previewFor('https://evil.com/?.linuxfoundation.org')).toBe('');
      expect(previewFor('https://notlinuxfoundation.org/hero.png')).toBe('');
      expect(previewFor('https://linuxfoundation.org.evil.com/hero.png')).toBe('');
      expect(previewFor('http://events.linuxfoundation.org/hero.png')).toBe('');
      expect(previewFor('https://cdn.example.com/hero.png')).toBe('');
      // Exact hosts and an image path: LFX One and SSO live in the linuxfoundation.org zone, and the
      // image request carries same-site cookies, so a scraped og:image of the app's own /logout
      // signed the operator out as the preview rendered.
      expect(previewFor('https://app.lfx.linuxfoundation.org/logout'), 'the app host is in the zone, not on the list').toBe('');
      expect(previewFor('https://sso.linuxfoundation.org/hero.png'), 'a zone subdomain off the list').toBe('');
      expect(previewFor('https://events.linuxfoundation.org/logout'), 'an allowed host with a non-image path').toBe('');
      expect(previewFor('https://events.linuxfoundation.org/hero.png?next=/logout'), 'a query string').toBe('');
      expect(previewFor('https://events.linuxfoundation.org/uploads/HERO.JPG')).toBe('https://events.linuxfoundation.org/uploads/HERO.JPG');
    });

    it('stages the call to action whose destination was refused, as text', STATE_ONLY, async () => {
      // The server keeps a button's label inline in `body` only when the section carried NO url
      // (`!section.url`). A url supplied and then REFUSED takes the label out of `body` there and
      // sends no native button here, so the CTA vanished from the draft while the preview still
      // showed it. The preview was right about intent; the draft was losing content.
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        body: '<p>Join us</p>',
        cta: 'Register Now',
        // A hallucinated host: truthy, so the server dropped the label, and refused by
        // `emailCtaDestination`, so no native button is sent either.
        ctaUrl: 'https://evil.example/phish',
      });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.bodyHtml).toContain('Register Now');
      expect(cfg?.buttonUrl).toBeUndefined();
      // The label ships; the refused destination does not.
      expect(cfg?.bodyHtml).not.toContain('evil.example');
    });

    it('does not ship a hero from copy that was cleared mid-stage', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://events.example/register',
          heroImageUrl: 'https://cdn.example.com/hero.png',
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      fixture.detectChanges();

      // The persist resolves on a later tick; clear the copy while staging is mid-flight, the
      // way a regeneration would.
      persistBrief.mockReturnValue(
        new Observable<{ status: string; approved: boolean; briefId: string; etag: null }>((sub) => {
          setTimeout(() => {
            internals().emailCopy.set(null);
            sub.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null });
            sub.complete();
          }, 0);
        }) as never
      );
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // `copy` is snapshotted before the await while the gates used to be read live, so a
      // generation completing mid-stage made them disagree: bodyHtml from the old copy, hero
      // from the new state -- or worse, a hero with no body at all. One snapshot, one config.
      // UNCONDITIONAL. A first version of this guarded the assertion on the hero being present,
      // which the race makes absent -- so the check was skipped exactly when it mattered and the
      // mutation survived. The body was snapshotted BEFORE the clear, so it is still present;
      // the hero must be too, because both now come from that same moment.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.bodyHtml).toBe('<p>Join us</p>');
      expect(cfg?.heroImageUrl).toBe('https://cdn.example.com/hero.png');
    });

    it('sends the registration URL in the canonical form, without userinfo', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://user:secret@events.example/register',
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // The generator copies the Registration URL EXACTLY, so a credentialed one arrives here
      // with its userinfo intact -- which is what this test checks gets stripped.
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        body: '<p>Join us</p>',
        cta: 'Register',
        ctaUrl: 'https://user:secret@events.example/register',
      });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // The controller strips userinfo and canonicalizes, so sending the raw string made the
      // PREVIEW show credentials and a different URL than the draft receives. Benign for the
      // draft; not for a preview whose whole job is to match it.
      expect(internals().emailRegistrationUrl()).toBe('https://events.example/register');
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.buttonUrl).toBe('https://events.example/register');
      expect(String(cfg?.buttonUrl)).not.toContain('secret');
    });

    it('does not preview or stage a hero the controller would drop', STATE_ONLY, async () => {
      selectEmail();
      // A RESTORED brief: asEventDetails accepts any string, so a persisted blob can carry a
      // host the controller later refuses. Binding it raw made the BROWSER fetch it, which no
      // server-side guard can prevent.
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://events.example/register',
          heroImageUrl: 'http://169.254.169.254/hero.png',
          sponsors: [
            { name: 'Bad', logoUrl: 'http://127.0.0.1/logo.png' },
            { name: 'Good', logoUrl: 'https://cdn.example.com/good.png' },
          ],
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: '', ctaUrl: '' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // One validated model drives BOTH, so the preview cannot show what staging omits.
      expect(internals().emailHeroImageUrl()).toBe('');
      expect(internals().emailSponsors()).toEqual([{ name: 'Good', logoUrl: 'https://cdn.example.com/good.png' }]);

      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.heroImageUrl).toBeUndefined();
      expect(cfg?.sponsors).toEqual([{ name: 'Good', logoUrl: 'https://cdn.example.com/good.png' }]);
    });

    it('withholds the CTA when the body is blank, even with a valid destination', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://events.example/register' },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // A real CTA label and a valid destination -- only the BODY is blank.
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '   ', cta: 'Register', ctaUrl: '' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // The button is written by the same full-tree rebuild as the hero, so a button with no body
      // drops the cloned template's body exactly as a hero would -- the same data-loss path
      // reached through a different field.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.buttonText).toBeUndefined();
      expect(cfg?.buttonUrl).toBeUndefined();
      expect(internals().emailCtaLabel()).toBe('');
    });

    it('withholds the hero and sponsors when no copy was generated', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://events.example/register',
          heroImageUrl: 'https://events.example/hero.png',
          sponsors: [{ name: 'Acme', logoUrl: 'https://events.example/acme.png' }],
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // No emailCopy: staging does not require it, so this path is reachable.
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // DATA LOSS, not a cosmetic gap: campaign-service's RebuildEmailContent replaces the whole
      // widget tree, and a rebuild carrying a hero but no body drops the cloned template's body
      // entirely. Sending the hero alone would quietly empty the draft the operator is about to
      // send, so neither field goes without copy to put beside it.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.heroImageUrl).toBeUndefined();
      expect(cfg?.sponsors).toBeUndefined();
      // The template clone itself still proceeds — this withholds content, it does not block.
      expect(cfg?.sourceEmailId).toBe('hs-123');
    });

    it('omits the CTA entirely when the brief has no registration URL to send it to', STATE_ONLY, async () => {
      selectEmail();
      // normalizeEventDetails defaults an absent registrationUrl to '' -- a real shape, not a
      // contrived one: a brief scraped from a page with no register link produces exactly this.
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: '',
          heroImageUrl: 'https://events.example/hero.png',
        },
      } as unknown as CampaignBriefOutput);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'S', preheader: 'P', body: '<p>Join us</p>', cta: 'Register', ctaUrl: '' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // Sending buttonText with a blank buttonUrl is worse than sending neither: the controller's
      // allow-list drops the PAIR when the url is empty, so the CTA the operator previewed
      // disappears with nothing anywhere reporting it. Withholding it here keeps the wire honest.
      const cfg = create.mock.calls[0][0].hubspotConfig;
      expect(cfg?.buttonText).toBeUndefined();
      expect(cfg?.buttonUrl).toBeUndefined();
      // The rest of the copy still goes -- this gate is about the CTA, not the send.
      expect(cfg?.bodyHtml).toBe('<p>Join us</p>');
      // Same gate on heroLinkUrl, but the IMAGE still ships: the controller pairs heroLinkUrl
      // inside the heroImageUrl gate, so an unlinked hero renders, which is the right degrade.
      expect(cfg?.heroImageUrl).toBe('https://events.example/hero.png');
      expect(cfg?.heroLinkUrl).toBeUndefined();
    });

    it('carries the generated copy into hubspotConfig when copy exists', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      // A "Register" button carries the registration URL, which is what the generator supplies
      // for the stages where registration IS the destination.
      internals().emailCopy.set({
        subject: 'Three days in Amsterdam',
        preheader: 'P',
        body: '<p>Join us</p>',
        cta: 'Register',
        // Matches the brief's registrationUrl, because the generator is told to copy it exactly.
        ctaUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
      });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // The VALUES, not merely that the keys exist: a staging call that sent the template id but
      // dropped the copy -- or dropped only the preheader, leaving the clone source's own -- would
      // look identical in a shape-only assertion.
      // `buttonText`/`buttonUrl` ride as structured fields rather than an anchor inside
      // `bodyHtml`, so the template renders its own native button once instead of twice.
      expect(create.mock.calls[0][0].hubspotConfig).toEqual({
        sourceEmailId: 'hs-123',
        subject: 'Three days in Amsterdam',
        bodyHtml: '<p>Join us</p>',
        preheader: 'P',
        buttonText: 'Register',
        buttonUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
      });
    });

    it('omits subject, bodyHtml, and preheader entirely when no copy was generated', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // Empty strings would be wrong, not merely untidy: upstream reads a blank subject as
      // "leave the template's own", so sending '' claims copy that does not exist.
      expect(create.mock.calls[0][0].hubspotConfig).toEqual({ sourceEmailId: 'hs-123' });
    });

    it('carries abTestEnabled/subjectB/bodyHtmlB into hubspotConfig when the test is on and variant B has content', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().abTestForm.controls.enabled.setValue(true);
      internals().abTestForm.controls.subjectB.setValue('Variant B subject');
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>Variant B body</p>');
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      expect(create.mock.calls[0][0].hubspotConfig).toEqual({
        sourceEmailId: 'hs-123',
        abTestEnabled: true,
        subjectB: 'Variant B subject',
        bodyHtmlB: '<p>Variant B body</p>',
      });
    });

    /**
     * An enabled toggle with nothing typed must not stage a broken test: upstream's STEP 3B
     * writes subject/body onto a variant it creates, so sending `abTestEnabled: true` with empty
     * strings would claim a test exists when there is no B-side content to run it with.
     */
    it('omits the A/B fields entirely when the test is enabled but variant B has no content', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().abTestForm.controls.enabled.setValue(true);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      expect(create.mock.calls[0][0].hubspotConfig).toEqual({ sourceEmailId: 'hs-123' });
    });

    /** Variant B content typed before the toggle is switched on must not leak onto the wire. */
    it('omits the A/B fields when variant B has content but the toggle is off', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().abTestForm.controls.subjectB.setValue('Variant B subject');
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>Variant B body</p>');
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      expect(create.mock.calls[0][0].hubspotConfig).toEqual({ sourceEmailId: 'hs-123' });
    });

    it('does NOT create when the persist returns no brief id', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', briefId: '', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign');

      await internals().onStageEmailSend();

      // Creating without an id would post to /briefs//campaigns; refusing is the safe arm.
      expect(create).not.toHaveBeenCalled();
      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingMessage()).not.toBe('');
    });

    it('reports a create failure rather than claiming the draft was staged', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
        of({ jobId: '', result: undefined, error: 'platform campaign creation failed' })
      );

      await internals().onStageEmailSend();

      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingMessage()).toBe('platform campaign creation failed');
    });
  });

  /**
   * The Survey & Report series: one brief per send, written in one pass, staged as drafts, then
   * handed to campaign-service as ONE disabled workflow.
   */
  describe('survey email sequence', () => {
    interface SequenceInternals {
      selectorForm: Internals['selectorForm'];
      emailBriefOutput: WritableSignal<CampaignBriefOutput | null>;
      emailBriefId: WritableSignal<string>;
      emailAudience: WritableSignal<CampaignAudience | null>;
      selectedEmailTemplateId: WritableSignal<string>;
      emailTemplates: WritableSignal<HubSpotMarketingEmail[] | null>;
      selectedEmailStage: Signal<string | undefined>;
      surveyEmailCount: WritableSignal<number>;
      surveySequenceStages: Signal<readonly string[]>;
      surveySequenceSends: WritableSignal<
        readonly { stage: string; label: string; briefId: string; copy: EmailBriefCopy; draftUrl?: string; draftId?: string }[]
      >;
      surveySequenceState: Signal<string>;
      surveySequenceError: Signal<string>;
      sequenceStagingState: Signal<string>;
      sequenceStagingMessage: Signal<string>;
      sequenceStagedBriefIds: WritableSignal<readonly string[]>;
      sendWorkflowState: Signal<string>;
      sendWorkflowError: Signal<string>;
      canBuildSequenceWorkflow: Signal<boolean>;
      surveySequenceBodies: Signal<ReadonlyMap<string, string>>;
      surveySequenceButtons: Signal<ReadonlyMap<string, { text: string; url: string }>>;
      onSurveyEmailCountChange(count: number): void;
      sequenceDatesForm: { controls: Record<string, { setValue(v: string): void }> };
      sequenceUnresolvedBriefIds: WritableSignal<readonly string[]>;
      surveySequenceWarning: Signal<string>;
      canStageSequence: Signal<boolean>;
      sendWorkflowResult: Signal<{ editUrl: string } | null>;
      onGenerateSurveySequence(): Promise<void>;
      onStageSequenceSends(): Promise<void>;
      onBuildSequenceWorkflow(): Promise<void>;
      onSelectEmailType(typeId: string): void;
      emailAudienceWriteInFlight: WritableSignal<boolean>;
      emailChannelEnabled: WritableSignal<boolean | null>;
      surveyTemplateHint: Signal<string>;
      surveyTemplateProblem: Signal<string>;
      audienceLockedByStaging: Signal<boolean>;
      onRetrySurveyTemplates(): void;
      canGenerateSurveySequence: Signal<boolean>;
      emailStaging: WritableSignal<'idle' | 'staging' | 'done' | 'error'>;
      canStageEmail: Signal<boolean>;
      selectedEmailTab: WritableSignal<string>;
      onStartSeriesOver(): void;
      surveySeriesStarted: Signal<boolean>;
      surveySeriesRestarted: Signal<boolean>;
      emailCopy: WritableSignal<unknown>;
      onStageEmailSend(): Promise<void>;
      canGenerateEmailCopy: Signal<boolean>;
      onEmailProceedFromPlanning(brief: unknown): void;
      sequenceNeedsRestart: Signal<boolean>;
      sendWorkflowUnconfirmed: Signal<boolean>;
      selectedEmailTypeId: Signal<string>;
    }
    const seq = (): SequenceInternals => fixture.componentInstance as unknown as SequenceInternals;

    const surveyBrief = {
      deliveryType: 'survey',
      emailStage: 'Survey Promo',
      eventDetails: {
        name: '2026 Cloud Native Survey',
        slug: 'cloud-native-2026',
        countryCode: '',
        registrationUrl: 'https://surveys.example.com/r/cloud-native-2026',
        sourceText: '2026 Cloud Native Survey',
      },
    } as unknown as CampaignBriefOutput;

    const copyFor = (stage: string): EmailBriefCopy =>
      ({ subject: `${stage} subject`, preheader: `${stage} preheader`, body: `<p>${stage} body</p>`, cta: 'Take the survey', ctaUrl: '' }) as EmailBriefCopy;

    const selectSurvey = (): void => {
      seq().selectorForm.controls.deliveryType.setValue('survey');
      fixture.detectChanges();
    };

    let service: CampaignService;
    let persistBrief: MockInstance;
    let generateEmailCopy: MockInstance;

    beforeEach(() => {
      sessionStorage.clear();
      service = TestBed.inject(CampaignService);
      let next = 0;
      persistBrief = vi
        .spyOn(service, 'persistBrief')
        .mockImplementation(() => of({ enabled: true, briefId: `brief-${++next}`, etag: '"1"', approved: true, created: true }) as never);
      generateEmailCopy = vi
        .spyOn(service, 'generateEmailCopy')
        .mockImplementation((_project: string, _briefId: string, stage?: string) => of({ enabled: true, copy: copyFor(stage ?? '') }) as never);
      vi.spyOn(service, 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [] }) as never);
    });

    it('offers one email or the full promo, reminder and closing series', STATE_ONLY, () => {
      selectSurvey();
      expect(seq().surveySequenceStages()).toEqual(['Survey Promo']);

      seq().onSurveyEmailCountChange(3);
      expect(seq().surveySequenceStages()).toEqual(['Survey Promo', 'Survey Reminder', 'Survey Closing']);

      // A report has no series, whatever count was chosen for the survey.
      seq().onSelectEmailType('report-promo');
      expect(seq().surveySequenceStages()).toEqual(['Report Promo']);
    });

    it('drops the email brief when switching to the survey surface, a different brief identity', STATE_ONLY, () => {
      selectEmail();
      seq().emailBriefOutput.set(exampleBrief);
      seq().emailBriefId.set('email-brief-1');

      selectSurvey();

      // Kept, the survey generate and stage would address the EMAIL brief's row.
      expect(seq().emailBriefId()).toBe('');
      expect(seq().emailBriefOutput()).toBeNull();
      expect(seq().selectedEmailStage()).toBe('Survey Promo');
    });

    it('writes one brief per send under its own stage, in send order', STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);

      await seq().onGenerateSurveySequence();

      const persisted = persistBrief.mock.calls.map((call) => (call[0] as CampaignBriefOutput).emailStage);
      expect(persisted).toEqual(['Survey Promo', 'Survey Reminder', 'Survey Closing']);
      expect(persistBrief.mock.calls.every((call) => (call[0] as CampaignBriefOutput).deliveryType === 'survey')).toBe(true);
      expect(generateEmailCopy.mock.calls.map((call) => [call[1], call[2]])).toEqual([
        ['brief-1', 'Survey Promo'],
        ['brief-2', 'Survey Reminder'],
        ['brief-3', 'Survey Closing'],
      ]);
      expect(
        seq()
          .surveySequenceSends()
          .map((send) => send.briefId)
      ).toEqual(['brief-1', 'brief-2', 'brief-3']);
      expect(seq().surveySequenceState()).toBe('done');
    });

    it('keeps the sends already written when a later one fails, and says which', async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      generateEmailCopy.mockImplementation((_p: string, _b: string, stage?: string) =>
        stage === 'Survey Closing' ? (of({ enabled: true, error: 'model refused' }) as never) : (of({ enabled: true, copy: copyFor(stage ?? '') }) as never)
      );

      await seq().onGenerateSurveySequence();

      expect(seq().surveySequenceState()).toBe('error');
      expect(seq().surveySequenceError()).toBe('model refused');
      expect(
        seq()
          .surveySequenceSends()
          .map((send) => send.stage)
      ).toEqual(['Survey Promo', 'Survey Reminder']);
      // On screen for review, but not stageable or buildable: the series is missing its closing.
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      seq().sequenceStagedBriefIds.set(['brief-1', 'brief-2']);
      seq().sequenceDatesForm.controls['date-0'].setValue('2026-11-02');
      seq().sequenceDatesForm.controls['date-1'].setValue('2026-11-09');
      expect(seq().canStageSequence(), 'stage a partial series').toBe(false);
      expect(seq().canBuildSequenceWorkflow(), 'build a partial series').toBe(false);
    });

    it('shares a multi-list audience with the later sends as the same lists, suppression included', STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      vi.spyOn(service, 'listAudiences').mockImplementation(
        (_p: string, briefId: string) =>
          of({
            enabled: true,
            audiences:
              briefId === 'brief-1'
                ? [
                    // NEWEST FIRST, as campaign-service lists them: the current audience is the
                    // first built row, not the last.
                    {
                      id: 'aud-2',
                      platform: 'hubspot',
                      status: 'built',
                      platformMasterListId: '31027',
                      includeListIds: ['31027', '31028'],
                      suppressionListIds: ['201'],
                    },
                    { id: 'aud-1', platform: 'hubspot', status: 'built', platformMasterListId: '30001', suppressionListIds: ['200'] },
                  ]
                : [],
          }) as never
      );
      const attach = vi.spyOn(service, 'attachExistingAudience').mockReturnValue(of({}) as never);

      await seq().onGenerateSurveySequence();

      // Not just the first list as a master: the workflow refuses briefs whose audiences differ.
      expect(attach).toHaveBeenCalledTimes(2);
      expect(attach.mock.calls[0][1]).toMatchObject({ briefId: 'brief-2', includeListIds: ['31027', '31028'], suppressionListIds: ['201'] });
      expect(attach.mock.calls[0][1]).not.toHaveProperty('masterListId');
    });

    it("shows each send's button as it will be staged, beside its body", STATE_ONLY, () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().surveySequenceSends.set([
        {
          stage: 'Survey Promo',
          label: 'Survey Promotion',
          briefId: 'brief-1',
          copy: { ...copyFor('Survey Promo'), ctaUrl: 'https://surveys.example.com/r/cloud-native-2026' },
        },
        {
          stage: 'Survey Reminder',
          label: 'Survey Reminder',
          briefId: 'brief-2',
          copy: { ...copyFor('Survey Reminder'), ctaUrl: 'https://elsewhere.example.com/' },
        },
      ]);

      expect(seq().surveySequenceButtons().get('brief-1')).toEqual({ text: 'Take the survey', url: 'https://surveys.example.com/r/cloud-native-2026' });
      // A button pointing anywhere but the promoted link is not staged, so it is not shown either.
      expect(seq().surveySequenceButtons().get('brief-2')?.text).toBe('');
    });

    it('shows each body as it will be staged, without resource-loading HTML', STATE_ONLY, () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().surveySequenceSends.set([
        {
          stage: 'Survey Promo',
          label: 'Survey Promotion',
          briefId: 'brief-1',
          copy: {
            subject: 's',
            preheader: 'p',
            body: '<p>Hello</p><img src="https://tracker.example.com/pixel.gif">',
            cta: 'Take the survey',
            ctaUrl: 'https://surveys.example.com/r/cloud-native-2026',
          } as EmailBriefCopy,
        },
      ]);

      const body = seq().surveySequenceBodies().get('brief-1') ?? '';
      expect(body).toContain('Hello');
      expect(body).not.toContain('tracker.example.com');
    });

    it("surfaces a refused draft in the refusal's own words and stops the series there", STATE_ONLY, async () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      seq().onSurveyEmailCountChange(3);
      seq().surveySequenceSends.set([
        { stage: 'Survey Promo', label: 'Survey Promotion', briefId: 'brief-1', copy: copyFor('Survey Promo') },
        { stage: 'Survey Reminder', label: 'Survey Reminder', briefId: 'brief-2', copy: copyFor('Survey Reminder') },
        { stage: 'Survey Closing', label: 'Survey Closing', briefId: 'brief-3', copy: copyFor('Survey Closing') },
      ]);
      const create = vi.spyOn(service, 'createCampaign').mockReturnValue(of({ jobId: '', error: 'no audience found for this brief' }) as never);

      await seq().onStageSequenceSends();

      expect(create).toHaveBeenCalledTimes(1);
      expect(seq().sequenceStagingState()).toBe('error');
      expect(seq().sequenceStagingMessage()).toBe('no audience found for this brief (Survey Promotion)');
      expect(seq().sequenceStagedBriefIds()).toEqual([]);
    });

    it('stages each send with its own copy and a button to the promoted link, then records the draft', STATE_ONLY, async () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      seq().surveySequenceSends.set([
        {
          stage: 'Survey Promo',
          label: 'Survey Promotion',
          briefId: 'brief-1',
          copy: { ...copyFor('Survey Promo'), ctaUrl: 'https://surveys.example.com/r/cloud-native-2026/' },
        },
      ]);
      const create = vi.spyOn(service, 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      vi.spyOn(service, 'getCreateResult').mockReturnValue(
        of({
          campaigns: [],
          errors: [],
          platformResults: [{ platform: 'hubspot', ok: true, campaignId: 'em-1', hubspotUrl: 'https://app.hubspot.com/email/1/edit/em-1' }],
        }) as never
      );

      await seq().onStageSequenceSends();

      const request = create.mock.calls[0][0] as unknown as { hubspotConfig: Record<string, string> };
      expect(request.hubspotConfig).toMatchObject({
        sourceEmailId: 'hs-1',
        subject: 'Survey Promo subject',
        buttonText: 'Take the survey',
        buttonUrl: 'https://surveys.example.com/r/cloud-native-2026/',
      });
      expect(create.mock.calls[0][2]).toBe('brief-1');
      expect(seq().sequenceStagedBriefIds()).toEqual(['brief-1']);
      expect(seq().surveySequenceSends()[0].draftId).toBe('em-1');
      expect(seq().sequenceStagingState()).toBe('done');
    });

    it('builds the workflow only once every send is staged AND has its date', STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      await seq().onGenerateSurveySequence();
      const build = vi
        .spyOn(service, 'createSendWorkflow')
        .mockReturnValue(of({ flowId: '9', name: 'w', editUrl: 'https://app.hubspot.com/x', sendEmailSteps: 2 }) as never);

      seq().sequenceStagedBriefIds.set(['brief-1']);
      seq().sequenceDatesForm.controls['date-0'].setValue('2026-11-02');
      seq().sequenceDatesForm.controls['date-1'].setValue('2026-11-09');
      seq().sequenceDatesForm.controls['date-2'].setValue('2026-11-16');
      expect(seq().canBuildSequenceWorkflow(), 'one send not staged').toBe(false);

      seq().sequenceStagedBriefIds.set(['brief-1', 'brief-2', 'brief-3']);
      seq().sequenceDatesForm.controls['date-1'].setValue('');
      // campaign-service needs one date per dated step and refuses a missing one with a 409.
      expect(seq().canBuildSequenceWorkflow(), 'one date blank').toBe(false);
      await seq().onBuildSequenceWorkflow();
      expect(build).not.toHaveBeenCalled();

      seq().sequenceDatesForm.controls['date-1'].setValue('2026-11-09');
      expect(seq().canBuildSequenceWorkflow()).toBe(true);
      await seq().onBuildSequenceWorkflow();
      expect(build).toHaveBeenCalledWith(expect.any(String), {
        name: '2026 Cloud Native Survey - Workflow',
        briefIds: ['brief-1', 'brief-2', 'brief-3'],
        sendDates: ['2026-11-02', '2026-11-09', '2026-11-16'],
      });
    });

    it('creates each send date control before publishing it, so a failed later send leaves them usable', STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      generateEmailCopy.mockImplementation((_p: string, _b: string, stage?: string) =>
        stage === 'Survey Closing' ? (of({ enabled: true, error: 'model refused' }) as never) : (of({ enabled: true, copy: copyFor(stage ?? '') }) as never)
      );

      await seq().onGenerateSurveySequence();

      // Two sends published, so the template renders two date inputs bound to these controls.
      expect(seq().surveySequenceSends()).toHaveLength(2);
      expect(Object.keys(seq().sequenceDatesForm.controls)).toEqual(['date-0', 'date-1']);
    });

    it('does not offer Stage all while later sends are still being written', STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      const closing = new Subject<unknown>();
      generateEmailCopy.mockImplementation((_p: string, _b: string, stage?: string) =>
        stage === 'Survey Closing' ? (closing as never) : (of({ enabled: true, copy: copyFor(stage ?? '') }) as never)
      );

      const writing = seq().onGenerateSurveySequence();
      await vi.waitFor(() => expect(seq().surveySequenceSends()).toHaveLength(2));

      // Staging snapshots the list, so it would stage one send and call the series done.
      expect(seq().canStageSequence()).toBe(false);

      closing.next({ enabled: true, copy: copyFor('Survey Closing') });
      closing.complete();
      await writing;
      expect(seq().canStageSequence()).toBe(true);
    });

    it("stops at a refused save instead of writing over another editor's brief", STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      // The page's own brief is already saved; the REMINDER's save is refused.
      seq().emailBriefId.set('brief-primary');
      persistBrief.mockImplementation(
        () => of({ enabled: true, briefId: 'brief-x', etag: null, approved: false, created: false, conflict: 'stale-brief' }) as never
      );

      await seq().onGenerateSurveySequence();

      expect(generateEmailCopy).toHaveBeenCalledTimes(1);
      expect(seq().surveySequenceState()).toBe('error');
      expect(
        seq()
          .surveySequenceSends()
          .map((send) => send.briefId)
      ).toEqual(['brief-primary']);
      // An honest next step, not a promise of an overwrite this path does not have.
      expect(seq().surveySequenceError()).toContain('Reload the page, restore the brief');
    });

    it('names the step that failed when the error carries no message of its own', STATE_ONLY, async () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      generateEmailCopy.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })) as never);

      await seq().onGenerateSurveySequence();

      expect(seq().surveySequenceError()).toBe('The emails could not be written.');
    });

    it("re-attaches the first send's audience to a later send built against different lists", STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      const current = { id: 'aud-b', platform: 'hubspot', status: 'built', platformMasterListId: '500', suppressionListIds: ['201'] };
      vi.spyOn(service, 'listAudiences').mockImplementation(
        (_p: string, briefId: string) =>
          of({
            enabled: true,
            audiences:
              briefId === 'brief-1'
                ? [current]
                : [{ id: 'aud-a', platform: 'hubspot', status: 'built', platformMasterListId: '400', suppressionListIds: ['201'] }],
          }) as never
      );
      const attach = vi.spyOn(service, 'attachExistingAudience').mockReturnValue(of({}) as never);

      await seq().onGenerateSurveySequence();

      // A built audience that does not MATCH is not "already shared": the workflow refuses
      // briefs whose audiences differ.
      expect(attach).toHaveBeenCalledTimes(2);
      expect(attach.mock.calls[0][1]).toMatchObject({ briefId: 'brief-2', masterListId: '500', suppressionListIds: ['201'] });

      attach.mockClear();
      vi.spyOn(service, 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [current] }) as never);
      await seq().onGenerateSurveySequence();
      expect(attach, 'a matching audience is skipped').not.toHaveBeenCalled();
    });

    it.each([
      ['a dropped connection', 0, true],
      ['a gateway error', 504, true],
      ['a request timeout', 408, true],
      ['throttling', 429, true],
      ['an explicit refusal', 400, false],
    ])('after %s on the create request, holds the send only when a draft may exist', STATE_ONLY, async (_label, status, held) => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      seq().surveySequenceSends.set([{ stage: 'Survey Promo', label: 'Survey Promotion', briefId: 'brief-1', copy: copyFor('Survey Promo') }]);
      vi.spyOn(service, 'createCampaign').mockReturnValue(throwError(() => new HttpErrorResponse({ status })) as never);

      await seq().onStageSequenceSends();

      expect(seq().sequenceUnresolvedBriefIds()).toEqual(held ? ['brief-1'] : []);
      expect(seq().canStageSequence()).toBe(!held);
    });

    it('does not hold a send of a series that was reset while its create was in flight', STATE_ONLY, async () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      seq().surveySequenceSends.set([{ stage: 'Survey Promo', label: 'Survey Promotion', briefId: 'brief-1', copy: copyFor('Survey Promo') }]);
      const answer = new Subject<unknown>();
      vi.spyOn(service, 'createCampaign').mockReturnValue(answer as never);

      const staging = seq().onStageSequenceSends();
      await vi.waitFor(() => expect(service.createCampaign).toHaveBeenCalled());
      seq().onSelectEmailType('report-promo');
      answer.next({ jobId: '', error: 'unconfirmed', indeterminate: true });
      answer.complete();
      await staging;

      expect(seq().sequenceUnresolvedBriefIds()).toEqual([]);
    });

    const stageable = (sends: number): void => {
      // A foundation of its own, so a series test never depends on what an earlier test left behind.
      TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-t', slug: 'tlf', name: 'TLF' } as ProjectContext, false);
      selectSurvey();
      seq().onSurveyEmailCountChange(sends === 3 ? 3 : 1);
      seq().emailBriefOutput.set(surveyBrief);
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      const stages = sends === 3 ? ['Survey Promo', 'Survey Reminder', 'Survey Closing'] : ['Survey Promo'];
      seq().surveySequenceSends.set(stages.map((stage, i) => ({ stage, label: stage, briefId: `brief-${i + 1}`, copy: copyFor(stage) })));
    };

    it("joins the page's own save for the first send instead of creating its brief a second time", STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      // The Audience tab's warm-up already saved the page's brief.
      seq().emailBriefId.set('brief-primary');

      await seq().onGenerateSurveySequence();

      expect(seq().surveySequenceSends()[0].briefId).toBe('brief-primary');
      const savedStages = persistBrief.mock.calls.map((call) => (call[0] as CampaignBriefOutput).emailStage);
      expect(savedStages).toEqual(['Survey Reminder', 'Survey Closing']);
    });

    it('keeps ownership of a brief saved without approval, so writing again updates it', STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      seq().emailBriefId.set('brief-primary');
      let reminderAttempts = 0;
      persistBrief.mockImplementation((brief: CampaignBriefOutput) => {
        if (brief.emailStage === 'Survey Reminder' && reminderAttempts++ === 0) {
          return of({ enabled: true, briefId: 'brief-r', etag: '"2"', approved: false, created: true }) as never;
        }
        return of({ enabled: true, briefId: `brief-${String(brief.emailStage)}`, etag: '"3"', approved: true, created: false }) as never;
      });

      await seq().onGenerateSurveySequence();
      expect(seq().surveySequenceState()).toBe('error');

      await seq().onGenerateSurveySequence();

      const retry = persistBrief.mock.calls.find((call, index) => index > 0 && (call[0] as CampaignBriefOutput).emailStage === 'Survey Reminder');
      // The saved row's id and validator -- and no overwrite licence.
      expect(retry?.slice(2)).toEqual(['brief-r', '"2"', false]);
    });

    it('does not offer a rewrite once a send is staged, since HubSpot keeps the staged draft', STATE_ONLY, () => {
      stageable(1);
      expect(seq().canGenerateSurveySequence()).toBe(true);
      seq().sequenceStagedBriefIds.set(['brief-1']);
      expect(seq().canGenerateSurveySequence()).toBe(false);
    });

    it('holds a send whose create was accepted with nothing to track, as the single-send path does', STATE_ONLY, async () => {
      stageable(1);
      vi.spyOn(service, 'createCampaign').mockReturnValue(of({ jobId: '' }) as never);

      await seq().onStageSequenceSends();

      expect(seq().sequenceUnresolvedBriefIds()).toEqual(['brief-1']);
      expect(seq().canStageSequence(), 'staging again could clone a second draft').toBe(false);
    });

    it('holds a send whose failed job still created its draft, and records where it landed', STATE_ONLY, async () => {
      stageable(1);
      vi.spyOn(service, 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      vi.spyOn(service, 'getCreateResult').mockReturnValue(
        of({
          campaigns: [],
          errors: ['recording failed'],
          platformResults: [{ platform: 'hubspot', ok: false, campaignId: 'em-9', error: 'recording failed' }],
        }) as never
      );

      await seq().onStageSequenceSends();

      expect(seq().surveySequenceSends()[0].draftId).toBe('em-9');
      expect(seq().sequenceUnresolvedBriefIds()).toEqual(['brief-1']);
      expect(seq().canStageSequence()).toBe(false);
    });

    it("reports the HubSpot row's own refusal before the job's generic failure", STATE_ONLY, async () => {
      stageable(1);
      vi.spyOn(service, 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      vi.spyOn(service, 'getCreateResult').mockReturnValue(
        of({
          campaigns: [],
          errors: ['Campaign creation was unsuccessful.'],
          platformResults: [{ platform: 'hubspot', ok: false, error: 'no audience found for this brief' }],
        }) as never
      );

      await seq().onStageSequenceSends();

      expect(seq().sequenceStagingMessage()).toContain('no audience found for this brief');
    });

    it('stops sharing an audience once the series it was for is reset', STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      const laterRead = new Subject<unknown>();
      vi.spyOn(service, 'listAudiences').mockImplementation(
        (_p: string, briefId: string) =>
          (briefId === 'brief-1'
            ? of({
                enabled: true,
                audiences: [{ id: 'aud-1', platform: 'hubspot', status: 'built', platformMasterListId: '500', suppressionListIds: ['201'] }],
              })
            : laterRead) as never
      );
      const attach = vi.spyOn(service, 'attachExistingAudience').mockReturnValue(of({}) as never);

      const writing = seq().onGenerateSurveySequence();
      await vi.waitFor(() => expect(service.listAudiences).toHaveBeenCalledWith(expect.anything(), 'brief-2'));
      seq().onSurveyEmailCountChange(1);
      laterRead.next({ enabled: true, audiences: [] });
      laterRead.complete();
      await writing;

      expect(attach).not.toHaveBeenCalled();
    });

    it("shares nothing when the first send's NEWEST audience is not built, rather than an older one", STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      // Only the FIRST send has rows; the later sends have none, so sharing the older built row
      // would show up as an attach.
      vi.spyOn(service, 'listAudiences').mockImplementation(
        (_p: string, briefId: string) =>
          (briefId === 'brief-1'
            ? of({
                enabled: true,
                audiences: [
                  { id: 'aud-new', platform: 'hubspot', status: 'building', platformMasterListId: '600', suppressionListIds: ['201'] },
                  { id: 'aud-old', platform: 'hubspot', status: 'built', platformMasterListId: '500', suppressionListIds: ['201'] },
                ],
              })
            : of({ enabled: true, audiences: [] })) as never
      );
      const attach = vi.spyOn(service, 'attachExistingAudience').mockReturnValue(of({}) as never);

      await seq().onGenerateSurveySequence();

      expect(attach).not.toHaveBeenCalled();
    });

    it('locks the audience once the series has staged drafts, and still lets the workflow build', async () => {
      stageable(3);
      await seq().onGenerateSurveySequence();
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      expect(seq().audienceLockedByStaging(), 'nothing staged yet').toBe(false);

      seq().sequenceStagedBriefIds.set(['brief-1', 'brief-2', 'brief-3']);
      seq().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      // The Audience tab is handed the lock, so a replace is refused there.
      expect(seq().audienceLockedByStaging()).toBe(true);
      const audienceTab = fixture.debugElement.query(By.directive(AudienceBuilderTabComponent));
      expect((audienceTab.componentInstance as { stagingInFlight(): boolean }).stagingInFlight()).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-sequence-start-over"]')?.textContent).toContain(
        'The audience is locked because this series has staged drafts.'
      );

      // The count is locked with it: a new count would rewrite briefs HubSpot holds drafts for.
      seq().onSurveyEmailCountChange(1);
      expect(seq().surveySequenceStages()).toHaveLength(3);

      for (const [index, date] of ['2026-11-02', '2026-11-09', '2026-11-16'].entries()) {
        seq().sequenceDatesForm.controls[`date-${index}`].setValue(date);
      }
      expect(seq().canBuildSequenceWorkflow()).toBe(true);
      seq().emailAudienceWriteInFlight.set(true);
      expect(seq().canBuildSequenceWorkflow(), 'build during an audience write').toBe(false);
    });

    it('blocks a rewrite while a send is held unconfirmed, even with none confirmed staged', STATE_ONLY, () => {
      stageable(3);
      expect(seq().canGenerateSurveySequence(), 'fixture precondition').toBe(true);
      seq().sequenceUnresolvedBriefIds.set(['brief-1']);
      expect(seq().canGenerateSurveySequence(), 'a rewrite would clear the hold and reuse the brief').toBe(false);
    });

    it('locks the count and rewrites once the single Stage button staged the brief, until a restart', STATE_ONLY, async () => {
      stageable(1);
      seq().emailBriefId.set('brief-primary');
      seq().surveySequenceSends.set([]);
      seq().emailCopy.set(copyFor('Survey Promo'));
      vi.spyOn(service, 'createCampaign').mockReturnValue(of({ jobId: 'j1' }) as never);
      vi.spyOn(service, 'getCreateResult').mockReturnValue(
        of({ campaigns: [], errors: [], platformResults: [{ platform: 'hubspot', ok: true, campaignId: 'c1' }] }) as never
      );
      expect(seq().canGenerateSurveySequence(), 'fixture precondition').toBe(true);

      await seq().onStageEmailSend();

      expect(seq().emailStaging()).toBe('done');
      expect(seq().surveySeriesStarted()).toBe(true);
      expect(seq().canGenerateSurveySequence(), 'a rewrite would reuse the staged draft').toBe(false);
      seq().onSurveyEmailCountChange(3);
      expect(seq().surveyEmailCount(), 'a series would open on the staged draft').toBe(1);

      // Staging another brief must not forget this one, whose draft still exists.
      seq().emailBriefId.set('brief-other');
      await seq().onStageEmailSend();
      expect(service.createCampaign, 'fixture precondition: the second stage ran').toHaveBeenCalledTimes(2);
      seq().emailBriefId.set('brief-primary');
      expect(seq().surveySeriesStarted(), 'the earlier brief is still staged').toBe(true);

      seq().onStartSeriesOver();

      expect(seq().surveySeriesRestarted()).toBe(true);
      expect(seq().surveySeriesStarted()).toBe(false);
      expect(seq().canGenerateSurveySequence()).toBe(true);
    });

    it('selects the survey template itself, since its picker is hidden, and never replaces a choice', STATE_ONLY, () => {
      selectSurvey();
      const templates = [
        { id: 'hs-a', name: 'Newsletter', subject: 'News' },
        { id: 'hs-b', name: 'Survey invitation', subject: 'Take our survey' },
      ] as HubSpotMarketingEmail[];
      const fill = fixture.componentInstance as unknown as { ensureSurveyTemplateSelected(): void };
      seq().selectedEmailTemplateId.set('');
      seq().emailTemplates.set(templates);

      fill.ensureSurveyTemplateSelected();
      expect(seq().selectedEmailTemplateId()).not.toBe('');

      seq().selectedEmailTemplateId.set('hs-a');
      fill.ensureSurveyTemplateSelected();
      expect(seq().selectedEmailTemplateId(), "the operator's choice stays").toBe('hs-a');

      seq().selectorForm.controls.deliveryType.setValue('email');
      seq().selectedEmailTemplateId.set('');
      fill.ensureSurveyTemplateSelected();
      expect(seq().selectedEmailTemplateId(), 'the event picker only suggests (#2057)').toBe('');
    });

    it('never takes the survey template from a list an Email search filtered', STATE_ONLY, () => {
      const component = fixture.componentInstance as unknown as {
        emailTemplateSubmittedQuery: { set(q: string): void };
        ensureSurveyTemplateSelected(): void;
        searchEmailTemplates(q: string): void;
      };
      const search = vi.spyOn(component, 'searchEmailTemplates').mockImplementation(() => undefined);
      selectSurvey();
      seq().selectedEmailTemplateId.set('');
      seq().emailTemplates.set([{ id: 'hs-filtered', name: 'Newsletter', subject: 'News' }] as HubSpotMarketingEmail[]);
      component.emailTemplateSubmittedQuery.set('newsletter');

      component.ensureSurveyTemplateSelected();

      expect(seq().selectedEmailTemplateId(), 'a pick from filtered rows would stick').toBe('');
      expect(search).toHaveBeenCalledWith('');
    });

    it('reads the portal templates once when a filtered pick is dropped on the way off Planning', STATE_ONLY, () => {
      TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-t', slug: 'tlf', name: 'TLF' } as ProjectContext, false);
      selectSurvey();
      const search = vi.spyOn(service, 'searchHubSpotEmails').mockReturnValue(new Subject<never>() as never);
      const component = fixture.componentInstance as unknown as {
        emailTemplateSubmittedQuery: { set(q: string): void };
        onEmailProceedFromPlanning(brief: CampaignBriefOutput): void;
      };
      seq().emailTemplates.set([{ id: 'hs-filtered', name: 'Newsletter', subject: 'News' }] as HubSpotMarketingEmail[]);
      component.emailTemplateSubmittedQuery.set('newsletter');
      seq().selectedEmailTemplateId.set('hs-filtered');

      component.onEmailProceedFromPlanning(surveyBrief);

      expect(search, 'the handoff joins the search the reset started').toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('tlf', '');
    });

    it('stages a one-email survey only once its copy is generated, since the template alone promotes nothing', STATE_ONLY, async () => {
      stageable(1);
      const component = fixture.componentInstance as unknown as { canStageEmail(): boolean };
      const create = vi.spyOn(service, 'createCampaign');
      seq().emailCopy.set(null);

      expect(component.canStageEmail()).toBe(false);
      await seq().onStageEmailSend();
      expect(create).not.toHaveBeenCalled();

      seq().emailCopy.set(copyFor('Survey Promo'));
      expect(component.canStageEmail()).toBe(true);
    });

    it('does not pick the survey template while a search is replacing the list', () => {
      const component = fixture.componentInstance as unknown as {
        emailTemplatesLoading: { set(v: boolean): void };
        ensureSurveyTemplateSelected(): void;
      };
      selectSurvey();
      seq().selectedEmailTemplateId.set('');
      seq().emailTemplates.set([{ id: 'hs-stale', name: 'Newsletter', subject: 'News' }] as HubSpotMarketingEmail[]);
      component.emailTemplatesLoading.set(true);

      component.ensureSurveyTemplateSelected();

      expect(seq().selectedEmailTemplateId(), 'the rows on screen are the ones being replaced').toBe('');
    });

    it('treats a restored approved survey send as possibly staged until the series is started over', STATE_ONLY, () => {
      stageable(1);
      const component = fixture.componentInstance as unknown as {
        onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        canGenerateEmailCopy(): boolean;
        surveySingleSendRestored(): boolean;
      };

      component.onRestoreSavedEmailBrief(surveyBrief, 'brief-restored', '"1"', true);

      expect(component.surveySingleSendRestored()).toBe(true);
      expect(component.canGenerateEmailCopy(), 'staging new copy would hand back the old draft').toBe(false);

      seq().onStartSeriesOver();

      expect(component.surveySingleSendRestored()).toBe(false);
      expect(component.canGenerateEmailCopy()).toBe(true);
    });

    it('does not hold back a restored survey brief that was never approved, since nothing was staged from it', STATE_ONLY, () => {
      stageable(1);
      const component = fixture.componentInstance as unknown as {
        onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        canGenerateEmailCopy(): boolean;
      };

      component.onRestoreSavedEmailBrief(surveyBrief, 'brief-unapproved', '"1"', false);

      expect(component.canGenerateEmailCopy()).toBe(true);
    });

    it('offers Start the series over when Write all meets a send saved in an earlier session', async () => {
      stageable(3);
      seq().surveySequenceSends.set([]);
      let call = 0;
      persistBrief.mockImplementation(() => {
        call++;
        // The first send is the page's own brief; the reminder was saved by an earlier session.
        return of(
          call === 1
            ? { enabled: true, briefId: 'brief-1', etag: '"1"', approved: true, created: true }
            : { enabled: true, briefId: 'old-reminder', approved: false, created: false, conflict: 'unowned-brief-exists' }
        ) as never;
      });

      await seq().onGenerateSurveySequence();

      expect(seq().sequenceNeedsRestart()).toBe(true);
      expect(seq().canGenerateSurveySequence(), 'writing again would meet the same refusal').toBe(false);
      seq().selectedEmailTab.set('implementation');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-sequence-start-over"]')).not.toBeNull();

      seq().onStartSeriesOver();

      expect(seq().surveySeriesRestarted(), 'the next write uses new briefs').toBe(true);
      expect(seq().sequenceNeedsRestart()).toBe(false);
      expect(seq().canGenerateSurveySequence()).toBe(true);
    });

    it('builds the workflow once, and holds Build after an unconfirmed create', STATE_ONLY, async () => {
      const ready = (): void => {
        stageable(3);
        const dates = (fixture.componentInstance as unknown as { sequenceDatesForm: FormGroup }).sequenceDatesForm;
        [0, 1, 2].forEach((index) => {
          if (!dates.contains(`date-${index}`)) {
            dates.addControl(`date-${index}`, new FormControl('', { nonNullable: true }));
          }
          dates.controls[`date-${index}`].setValue(`2026-12-0${index + 1}`);
        });
        seq().sequenceStagedBriefIds.set(['brief-1', 'brief-2', 'brief-3']);
      };
      ready();
      const build = vi
        .spyOn(service, 'createSendWorkflow')
        .mockReturnValue(of({ flowId: '9', name: 'w', editUrl: 'https://app.hubspot.com/workflows/1/platform/flow/9/edit' }) as never);
      expect(seq().canBuildSequenceWorkflow(), 'fixture precondition').toBe(true);

      await seq().onBuildSequenceWorkflow();

      expect(build).toHaveBeenCalledTimes(1);
      expect(seq().canBuildSequenceWorkflow(), 'a second click would build a second workflow').toBe(false);

      seq().onStartSeriesOver();
      ready();
      build.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })) as never);
      await seq().onBuildSequenceWorkflow();

      expect(seq().sendWorkflowUnconfirmed()).toBe(true);
      expect(seq().canBuildSequenceWorkflow(), 'the workflow may exist').toBe(false);
    });

    it('names the validation reason, not the field prefix, when the workflow is refused', STATE_ONLY, async () => {
      stageable(3);
      const dates = (fixture.componentInstance as unknown as { sequenceDatesForm: FormGroup }).sequenceDatesForm;
      [0, 1, 2].forEach((index) => dates.addControl(`date-${index}`, new FormControl(`2026-12-0${index + 1}`, { nonNullable: true })));
      seq().sequenceStagedBriefIds.set(['brief-1', 'brief-2', 'brief-3']);
      vi.spyOn(service, 'createSendWorkflow').mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: {
                error: 'Validation failed for name',
                code: 'VALIDATION_ERROR',
                errors: [{ field: 'name', message: 'name must be at most 200 characters' }],
              },
            })
        ) as never
      );

      await seq().onBuildSequenceWorkflow();

      expect(seq().sendWorkflowError()).toBe('name must be at most 200 characters');
      expect(seq().sendWorkflowUnconfirmed(), 'a 400 created nothing').toBe(false);
    });

    it('moves the next write to new briefs when an asset switch drops a staged series', STATE_ONLY, async () => {
      stageable(3);
      await seq().onGenerateSurveySequence();
      expect(persistBrief, 'fixture precondition: the series was written').toHaveBeenCalled();
      seq().sequenceStagedBriefIds.set([seq().surveySequenceSends()[0].briefId]);
      const surveyType = seq().selectedEmailTypeId();
      const reportType = CAMPAIGN_SURVEY_TYPES.find((type) => type.stage === 'Report Promo')?.id ?? '';
      expect(reportType, 'fixture precondition').not.toBe('');

      seq().onSelectEmailType(reportType);
      seq().onSelectEmailType(surveyType);
      // The stage change cleared the brief; the planner restores the same survey's brief on return.
      seq().emailBriefOutput.set(surveyBrief);

      expect(seq().sequenceStagedBriefIds()).toEqual([]);
      expect(seq().surveySeriesRestarted(), 'the old briefs hold drafts').toBe(true);
    });

    it('turns off a variant B left armed on Email when the surface switches to Survey', STATE_ONLY, () => {
      seq().selectorForm.controls.deliveryType.setValue('email');
      fixture.detectChanges();
      const ab = (fixture.componentInstance as unknown as { abTestForm: { controls: { enabled: { setValue(v: boolean): void; value: boolean } } } }).abTestForm;
      ab.controls.enabled.setValue(true);

      selectSurvey();

      expect(ab.controls.enabled.value, 'survey has no A/B control to turn it off').toBe(false);
    });

    it('ignores a late unowned answer for a series a reset already replaced', STATE_ONLY, async () => {
      stageable(3);
      seq().surveySequenceSends.set([]);
      const late = new Subject<unknown>();
      let call = 0;
      persistBrief.mockImplementation(() => {
        call++;
        return (call === 1 ? of({ enabled: true, briefId: 'brief-1', etag: '"1"', approved: true, created: true }) : late) as never;
      });

      const writing = seq().onGenerateSurveySequence();
      // The reminder's save is on the wire before the reset, or the reset would only stop the loop.
      await vi.waitFor(() => expect(persistBrief).toHaveBeenCalledTimes(2));
      seq().onSurveyEmailCountChange(1);
      late.next({ enabled: true, briefId: 'old', approved: false, created: false, conflict: 'unowned-brief-exists' });
      late.complete();
      await writing;

      expect(seq().sequenceNeedsRestart(), 'the reset series must stay writable').toBe(false);
    });

    it('explains the restart for sends saved in an earlier session, not as staged drafts', () => {
      stageable(3);
      // Write all refused before any send landed, so there are no rows (and no date controls).
      seq().surveySequenceSends.set([]);
      (seq().sequenceNeedsRestart as unknown as WritableSignal<boolean>).set(true);
      seq().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      const card = fixture.nativeElement.querySelector('[data-testid="campaigns-sequence-start-over"]') as HTMLElement | null;
      expect(card?.textContent).toContain('saved in an earlier session');
      expect(card?.textContent).not.toContain('audience is locked');
    });

    it('locks Regenerate once the single Stage button staged the brief', STATE_ONLY, () => {
      stageable(1);
      seq().emailBriefId.set('brief-primary');
      expect(seq().canGenerateEmailCopy(), 'fixture precondition').toBe(true);
      seq().emailStaging.set('staging');
      expect(seq().canGenerateEmailCopy(), 'regenerating would never reach the draft').toBe(false);
    });

    it('moves the next write to new briefs when Planning drops a staged series', STATE_ONLY, async () => {
      stageable(3);
      await seq().onGenerateSurveySequence();
      seq().sequenceStagedBriefIds.set([seq().surveySequenceSends()[0].briefId]);
      expect(seq().surveySeriesRestarted(), 'fixture precondition').toBe(false);

      seq().onEmailProceedFromPlanning(surveyBrief);

      expect(seq().sequenceStagedBriefIds()).toEqual([]);
      expect(seq().surveySeriesRestarted(), 'the old briefs hold drafts').toBe(true);
    });

    it('keeps the briefs when Planning drops a series that never reached HubSpot', STATE_ONLY, async () => {
      stageable(3);
      await seq().onGenerateSurveySequence();

      seq().onEmailProceedFromPlanning(surveyBrief);

      expect(seq().surveySeriesRestarted()).toBe(false);
    });

    it('locks the count and rewrites while the single Stage button is still in flight', STATE_ONLY, () => {
      stageable(1);
      seq().emailStaging.set('staging');

      expect(seq().surveySeriesStarted()).toBe(true);
      expect(seq().canGenerateSurveySequence()).toBe(false);
      seq().onStartSeriesOver();
      expect(seq().surveySeriesRestarted(), 'a restart must wait for the create').toBe(false);
    });

    it('warns when HubSpot reports the built workflow as on, and only reassures for an off one', async () => {
      stageable(3);
      // Writing the series is what creates its date controls, which the panel binds.
      await seq().onGenerateSurveySequence();
      seq().selectedEmailTab.set('implementation');
      const workflow = fixture.componentInstance as unknown as {
        sendWorkflowState: WritableSignal<string>;
        sendWorkflowResult: WritableSignal<unknown>;
      };
      workflow.sendWorkflowState.set('done');
      workflow.sendWorkflowResult.set({ name: 'Survey sends', sendEmailSteps: 3, isEnabled: true, editUrl: '' });
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-testid="campaigns-send-workflow-enabled"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="campaigns-send-workflow-result"]')?.textContent).not.toContain('turned OFF');

      workflow.sendWorkflowResult.set({ name: 'Survey sends', sendEmailSteps: 3, isEnabled: false, editUrl: '' });
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="campaigns-send-workflow-enabled"]')).toBeNull();
      expect(host.querySelector('[data-testid="campaigns-send-workflow-result"]')?.textContent).toContain('turned OFF');
    });

    it('names a nameless survey template by its id rather than reading as still searching', () => {
      selectSurvey();
      seq().emailTemplates.set([{ id: 'hs-9', name: '', subject: 'S' }] as HubSpotMarketingEmail[]);
      seq().selectedEmailTemplateId.set('hs-9');
      seq().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      const line = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-template-auto"]')?.textContent ?? '';
      expect(line).toContain('hs-9');
      expect(line).not.toContain('Finding');
    });

    it('says to wait, not start over, while a single stage is in flight', () => {
      stageable(1);
      seq().selectedEmailTab.set('implementation');
      seq().emailStaging.set('staging');
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-testid="campaigns-survey-sequence-hint"]')?.textContent).toContain('Wait for HubSpot to finish');
      expect(host.querySelector('[data-testid="campaigns-sequence-start-over"]')).toBeNull();
    });

    it('releases the audience after a restart leaves a single-send hold on the original brief', STATE_ONLY, () => {
      stageable(1);
      seq().emailBriefId.set('brief-primary');
      const unresolved = fixture.componentInstance as unknown as {
        activeFoundationSlug: Signal<string>;
        emailStagingUnresolved: Signal<boolean>;
        markStageUnresolved(project: string, brief: string): void;
      };
      unresolved.markStageUnresolved(unresolved.activeFoundationSlug(), 'brief-primary');
      expect(unresolved.emailStagingUnresolved(), 'fixture precondition').toBe(true);
      expect(seq().audienceLockedByStaging()).toBe(true);

      seq().onStartSeriesOver();

      expect(unresolved.emailStagingUnresolved(), 'the hold on the original brief remains').toBe(true);
      expect(seq().surveySeriesRestarted()).toBe(true);
      expect(seq().audienceLockedByStaging()).toBe(false);
    });

    it('offers one copy path at a time for a one-email survey', () => {
      stageable(1);
      seq().selectedEmailTab.set('implementation');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-survey-sequence"]')).toBeNull();

      seq().onSurveyEmailCountChange(3);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-survey-sequence"]')).not.toBeNull();
    });

    it('starts the series over from a held send, clearing its staging so it can be written again', STATE_ONLY, () => {
      stageable(3);
      seq().sequenceStagedBriefIds.set(['brief-1']);
      seq().sequenceUnresolvedBriefIds.set(['brief-2']);
      expect(seq().canGenerateSurveySequence()).toBe(false);

      seq().onStartSeriesOver();

      expect(seq().surveySeriesStarted()).toBe(false);
      expect(seq().sequenceUnresolvedBriefIds()).toEqual([]);
      expect(seq().surveySequenceSends()).toEqual([]);
      expect(seq().canGenerateSurveySequence()).toBe(true);
    });

    it("writes a restarted series under NEW briefs, sharing the page's audience, and remembers it across a reload", STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      seq().emailBriefId.set('brief-primary');
      await seq().onGenerateSurveySequence();
      seq().sequenceStagedBriefIds.set(
        seq()
          .surveySequenceSends()
          .map((send) => send.briefId)
      );

      seq().onStartSeriesOver();
      persistBrief.mockClear();
      vi.spyOn(service, 'listAudiences').mockImplementation(
        (_p: string, briefId: string) =>
          of({
            enabled: true,
            audiences:
              briefId === 'brief-primary'
                ? [{ id: 'aud-1', platform: 'hubspot', status: 'built', platformMasterListId: '500', suppressionListIds: ['201'] }]
                : [],
          }) as never
      );
      const attach = vi.spyOn(service, 'attachExistingAudience').mockReturnValue(of({}) as never);
      await seq().onGenerateSurveySequence();

      // Every send, the first included, is a new brief: campaign-service would hand the original
      // briefs' drafts back unchanged.
      const slugs = persistBrief.mock.calls.map((call) => (call[0] as CampaignBriefOutput).eventDetails.slug);
      expect(slugs).toEqual(['cloud-native-2026-r2', 'cloud-native-2026-r2', 'cloud-native-2026-r2']);
      expect(
        seq()
          .surveySequenceSends()
          .map((send) => send.briefId)
      ).not.toContain('brief-primary');
      // The audience composed for the page's own brief reaches all three new briefs.
      expect(attach).toHaveBeenCalledTimes(3);

      // A fresh page (a reload) keeps writing the restarted identity, not the original briefs.
      const reloaded = TestBed.createComponent(campaignsComponentUnderTest());
      const page = reloaded.componentInstance as unknown as { readSeriesRestart(project: string, slug: string): number };
      const project = (fixture.componentInstance as unknown as { activeFoundationSlug(): string }).activeFoundationSlug();
      expect(page.readSeriesRestart(project, 'cloud-native-2026')).toBe(1);
      reloaded.destroy();
    });

    it('stages a restarted one-email survey on its new brief, never the original single-send brief', async () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().emailBriefId.set('brief-primary');
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      await seq().onGenerateSurveySequence();
      seq().sequenceStagedBriefIds.set(['brief-primary']);
      const seriesMode = (): boolean => (fixture.componentInstance as unknown as { surveySeriesMode(): boolean }).surveySeriesMode();
      // Read BEFORE the start-over, so the assertion after it proves the mode follows the restart.
      expect(seriesMode(), 'a one-email survey before any restart').toBe(false);
      seq().onStartSeriesOver();
      expect(seriesMode(), 'after a restart, the series path').toBe(true);

      persistBrief.mockImplementation(
        (brief: CampaignBriefOutput) => of({ enabled: true, briefId: `new-${brief.eventDetails.slug}`, etag: '"1"', approved: true, created: true }) as never
      );
      await seq().onGenerateSurveySequence();
      const create = vi.spyOn(service, 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      vi.spyOn(service, 'getCreateResult').mockReturnValue(
        of({ campaigns: [], errors: [], platformResults: [{ platform: 'hubspot', ok: true, campaignId: 'em-1' }] }) as never
      );

      // The single Stage button addresses the ORIGINAL brief: hidden, and refused if reached.
      seq().selectedEmailTab.set('implementation');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-stage-btn"]')).toBeNull();
      await (fixture.componentInstance as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      expect(create).not.toHaveBeenCalled();

      await seq().onStageSequenceSends();
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][2]).toBe('new-cloud-native-2026-r2');
    });

    it("stages a restarted series even when the original brief's single send is held unconfirmed", async () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().emailBriefId.set('brief-primary');
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      await seq().onGenerateSurveySequence();
      seq().sequenceStagedBriefIds.set(['brief-primary']);
      // The single Stage button lost its response on the ORIGINAL brief: held, and its
      // "I have checked HubSpot" acknowledgment lives in the controls a restart hides.
      const page = fixture.componentInstance as unknown as {
        unresolvedStages: { set(v: ReadonlySet<string>): void };
        stageScopeKey(project: string, briefId: string): string;
        activeFoundationSlug(): string;
        canStageSequence(): boolean;
      };
      page.unresolvedStages.set(new Set([page.stageScopeKey(page.activeFoundationSlug(), 'brief-primary')]));
      seq().onStartSeriesOver();

      persistBrief.mockImplementation(
        (brief: CampaignBriefOutput) => of({ enabled: true, briefId: `new-${brief.eventDetails.slug}`, etag: '"1"', approved: true, created: true }) as never
      );
      await seq().onGenerateSurveySequence();

      expect(page.canStageSequence(), "the old brief's hold blocked the new series").toBe(true);

      // Another condition now disables Stage all: the hint names THAT, not the hidden single draft.
      seq().selectedEmailTemplateId.set('');
      seq().selectedEmailTab.set('implementation');
      fixture.detectChanges();
      const hint = fixture.nativeElement.querySelector('[data-testid="campaigns-sequence-stage-hint"]')?.textContent ?? '';
      expect(hint, 'the hint pointed at the hidden single-email draft').not.toContain('single-email draft');
    });

    it('runs audience QA without a stage on the survey surface, since QA only takes event stages', () => {
      selectSurvey();
      const page = fixture.componentInstance as unknown as { selectedEmailStage(): string | undefined; audienceQaStage(): string };
      expect(page.selectedEmailStage(), 'fixture precondition: a survey stage is selected').toMatch(/Survey|Report/);
      expect(page.audienceQaStage()).toBe('');
      // The planner still gets the real stage: its saved-brief lookup needs it to reopen a survey.
      const planners = fixture.debugElement
        .queryAll(By.directive(PlanningTabComponent))
        .map((d) => d.componentInstance as unknown as { deliveryType(): string; emailStage(): string });
      const planner = planners.find((p) => p.deliveryType() === 'survey');
      expect(planner, 'fixture precondition: the survey planner').toBeDefined();
      expect(planner?.emailStage()).toBe(page.selectedEmailStage());
    });

    it('keeps the original briefs when a series is started over before anything reached HubSpot', STATE_ONLY, async () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().onStartSeriesOver();
      persistBrief.mockClear();
      seq().onSurveyEmailCountChange(3);

      await seq().onGenerateSurveySequence();

      expect(persistBrief.mock.calls.map((call) => (call[0] as CampaignBriefOutput).eventDetails.slug)).toEqual([
        'cloud-native-2026',
        'cloud-native-2026',
        'cloud-native-2026',
      ]);
    });

    it('hides the single-email generate and stage controls for a three-email series only', () => {
      selectSurvey();
      seq().selectedEmailTab.set('implementation');
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-testid="campaigns-email-generate-btn"]'), 'one-email survey keeps them').not.toBeNull();

      seq().onSurveyEmailCountChange(3);
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="campaigns-email-generate-btn"]')).toBeNull();
      expect(host.querySelector('[data-testid="campaigns-email-stage-btn"]')).toBeNull();
    });

    it('says why each Stage button is off while the other path holds the brief', () => {
      stageable(1);
      seq().selectedEmailTab.set('implementation');
      seq().emailStaging.set('staging');
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-testid="campaigns-sequence-stage-hint"]')?.textContent).toContain('single-email draft');

      seq().emailStaging.set('idle');
      seq().sequenceUnresolvedBriefIds.set(['brief-1']);
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="campaigns-email-stage-hint"]')?.textContent).toContain('email series below');
    });

    it('creates no further drafts once the page is left mid-staging', STATE_ONLY, async () => {
      stageable(3);
      const first = new Subject<unknown>();
      const create = vi
        .spyOn(service, 'createCampaign')
        .mockReturnValueOnce(first as never)
        .mockReturnValue(of({ jobId: 'job-n' }) as never);
      vi.spyOn(service, 'getCreateResult').mockReturnValue(
        of({ campaigns: [], errors: [], platformResults: [{ platform: 'hubspot', ok: true, campaignId: 'em-1' }] }) as never
      );

      const staging = seq().onStageSequenceSends();
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      fixture.destroy();
      first.next({ jobId: 'job-1' });
      first.complete();
      await staging;

      expect(create).toHaveBeenCalledTimes(1);
    });

    it('keeps the single Stage button and Stage all from creating beside each other', STATE_ONLY, () => {
      stageable(1);
      expect(seq().canStageSequence()).toBe(true);
      seq().emailStaging.set('staging');
      expect(seq().canStageSequence(), 'Stage all during a single-send create').toBe(false);
      seq().emailStaging.set('idle');

      seq().sequenceUnresolvedBriefIds.set(['brief-1']);
      expect(seq().canStageEmail(), 'single Stage over a held series send').toBe(false);
    });

    it('says why Stage all is off while the audience is being replaced', () => {
      stageable(3);
      // The writer adds these before publishing a row; this fixture sets the rows directly.
      const dates = (fixture.componentInstance as unknown as { sequenceDatesForm: FormGroup }).sequenceDatesForm;
      [0, 1, 2].forEach((index) => dates.addControl(`date-${index}`, new FormControl('', { nonNullable: true })));
      seq().selectedEmailTab.set('implementation');
      seq().emailAudienceWriteInFlight.set(true);
      fixture.detectChanges();

      const hint = fixture.nativeElement.querySelector('[data-testid="campaigns-sequence-stage-hint"]') as HTMLElement | null;
      expect(hint?.textContent).toContain('Wait for the audience to finish updating.');
    });

    it('says why Build is off while the audience is being replaced', () => {
      stageable(3);
      const dates = (fixture.componentInstance as unknown as { sequenceDatesForm: FormGroup }).sequenceDatesForm;
      [0, 1, 2].forEach((index) => dates.addControl(`date-${index}`, new FormControl('2026-12-0' + (index + 1), { nonNullable: true })));
      seq().sequenceStagedBriefIds.set(['brief-1', 'brief-2', 'brief-3']);
      seq().selectedEmailTab.set('implementation');
      seq().emailAudienceWriteInFlight.set(true);
      fixture.detectChanges();

      const note = fixture.nativeElement.querySelector('[data-testid="campaigns-send-workflow-note"]') as HTMLElement | null;
      expect(note?.textContent).toContain('Wait for the audience to finish updating.');
    });

    it('keeps the audience locked and Stage all off around an audience replacement', STATE_ONLY, () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      seq().surveySequenceSends.set([{ stage: 'Survey Promo', label: 'Survey Promotion', briefId: 'brief-1', copy: copyFor('Survey Promo') }]);
      expect(seq().canStageSequence()).toBe(true);

      seq().emailAudienceWriteInFlight.set(true);
      expect(seq().canStageSequence(), 'staging during an audience write').toBe(false);
      seq().emailAudienceWriteInFlight.set(false);

      seq().sequenceUnresolvedBriefIds.set(['brief-1']);
      expect(seq().audienceLockedByStaging(), 'audience replaced while a series send is held').toBe(true);
    });

    it('says why there is no template on the survey surface, and retries the read', STATE_ONLY, () => {
      selectSurvey();
      seq().selectedEmailTemplateId.set('');
      seq().emailTemplates.set(null);
      seq().emailChannelEnabled.set(false);
      expect(seq().surveyTemplateHint()).not.toBe('Finding a template in this portal to clone.');

      seq().emailChannelEnabled.set(true);
      seq().emailTemplates.set([]);
      expect(seq().surveyTemplateProblem()).toContain('no marketing emails');

      const search = vi
        .spyOn(fixture.componentInstance as unknown as { searchEmailTemplates(q: string): void }, 'searchEmailTemplates')
        .mockImplementation(() => undefined);
      seq().onRetrySurveyTemplates();
      expect(search).toHaveBeenCalledWith('');
    });

    it('keeps the chosen type, brief and copy across a trip through Paid Marketing', STATE_ONLY, () => {
      selectSurvey();
      seq().onSelectEmailType('report-promo');
      seq().emailBriefOutput.set(surveyBrief);
      seq().emailBriefId.set('brief-9');

      seq().selectorForm.controls.deliveryType.setValue('paid-marketing');
      fixture.detectChanges();
      selectSurvey();

      expect(seq().selectedEmailStage()).toBe('Report Promo');
      expect(seq().emailBriefId()).toBe('brief-9');
      expect(seq().emailBriefOutput()).not.toBeNull();
    });

    it('sends every date when every one is filled in', STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      await seq().onGenerateSurveySequence();
      seq().sequenceDatesForm.controls['date-0'].setValue('2026-11-02');
      seq().sequenceDatesForm.controls['date-1'].setValue('2026-11-09');
      seq().sequenceDatesForm.controls['date-2'].setValue('2026-11-16');
      seq().sequenceStagedBriefIds.set(['brief-1', 'brief-2', 'brief-3']);
      const build = vi
        .spyOn(service, 'createSendWorkflow')
        .mockReturnValue(of({ flowId: '9', name: 'w', editUrl: 'javascript:alert(1)', sendEmailSteps: 2 }) as never);

      await seq().onBuildSequenceWorkflow();

      expect(build.mock.calls[0][1]).toMatchObject({ briefIds: ['brief-1', 'brief-2', 'brief-3'], sendDates: ['2026-11-02', '2026-11-09', '2026-11-16'] });
      // The review link is pinned to HubSpot's https app host; anything else is not rendered.
      expect(seq().sendWorkflowResult()?.editUrl).toBe('');
    });

    it('does not attach an audience to a send whose own audience could not be read, and says so', STATE_ONLY, async () => {
      selectSurvey();
      seq().onSurveyEmailCountChange(3);
      seq().emailBriefOutput.set(surveyBrief);
      vi.spyOn(service, 'listAudiences').mockImplementation(
        (_p: string, briefId: string) =>
          (briefId === 'brief-1'
            ? of({
                enabled: true,
                audiences: [{ id: 'aud-1', platform: 'hubspot', status: 'built', platformMasterListId: '31027', suppressionListIds: ['201'] }],
              })
            : of({ enabled: false })) as never
      );
      const attach = vi.spyOn(service, 'attachExistingAudience').mockReturnValue(of({}) as never);

      await seq().onGenerateSurveySequence();

      // An outage that hid an existing audience must not mint a second one.
      expect(attach).not.toHaveBeenCalled();
      expect(seq().surveySequenceState()).toBe('done');
      expect(seq().surveySequenceWarning()).toContain('could not be read');
    });

    it('holds a send whose draft never reported back instead of offering to stage it again', STATE_ONLY, async () => {
      selectSurvey();
      seq().emailBriefOutput.set(surveyBrief);
      seq().selectedEmailTemplateId.set('hs-1');
      seq().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      seq().surveySequenceSends.set([{ stage: 'Survey Promo', label: 'Survey Promotion', briefId: 'brief-1', copy: copyFor('Survey Promo') }]);
      vi.spyOn(service, 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      vi.spyOn(service, 'getCreateResult').mockReturnValue(throwError(() => new Error('Campaign creation is taking longer than expected.')) as never);

      await seq().onStageSequenceSends();

      expect(seq().sequenceUnresolvedBriefIds()).toEqual(['brief-1']);
      expect(seq().sequenceStagingMessage()).toContain('Check HubSpot');
      // A retry could clone a second draft, so staging stays off until the series is rewritten.
      expect(seq().canStageSequence()).toBe(false);
    });

    it('forgets the series, its drafts and its workflow when the brief is reset', STATE_ONLY, () => {
      selectSurvey();
      seq().surveySequenceSends.set([{ stage: 'Survey Promo', label: 'Survey Promotion', briefId: 'brief-1', copy: copyFor('Survey Promo') }]);
      seq().sequenceStagedBriefIds.set(['brief-1']);

      seq().onSelectEmailType('report-promo');

      expect(seq().surveySequenceSends()).toEqual([]);
      expect(seq().sequenceStagedBriefIds()).toEqual([]);
    });

    it('picks the survey template again from the loaded list after a reset clears it', STATE_ONLY, () => {
      selectSurvey();
      seq().emailTemplates.set([{ id: 'hs-7', name: 'Survey template' } as HubSpotMarketingEmail]);
      seq().selectedEmailTemplateId.set('');

      seq().onSelectEmailType('report-promo');

      // The picker is hidden on this surface, so an empty selection would never be filled.
      expect(seq().selectedEmailTemplateId()).toBe('hs-7');
    });
  });
});
