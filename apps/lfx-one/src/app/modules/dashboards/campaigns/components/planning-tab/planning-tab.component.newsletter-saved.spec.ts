// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import type { AudienceLastSentEmail, CampaignBriefLoadResult, CampaignBriefOutput, CampaignProgramTypeOption } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { PlanningTabComponent } from './planning-tab.component';

/**
 * Coming back to a newsletter issue that already has a saved brief. The planner offered to restore
 * it beside an EMPTY notes box, which read as the notes having been lost and left no way to change
 * one line and generate again short of retyping all of them.
 */
describe('PlanningTabComponent newsletter issue with a saved brief', () => {
  let fixture: ComponentFixture<PlanningTabComponent>;
  let loadBrief: Mock;

  const programTypeConfig: CampaignProgramTypeOption = {
    id: 'events',
    label: 'Events',
    breadcrumbLabel: 'Events',
    urlLabel: 'Event URL',
    urlPlaceholder: 'https://events.example.com/event-name',
    urlHelp: 'Enter the event registration URL',
    goalLabel: 'Event conversions',
    audiencePlaceholder: 'Enter target audience',
    valuePropPlaceholder: 'Enter value proposition',
  };

  const SAVED_NOTES = 'Guide is out: https://acme.example/blog/guide\nNew members joined';

  const issue = (emailId: string): AudienceLastSentEmail => ({
    emailId,
    emailName: `Acme Newsletter ${emailId}`,
    sentAt: '',
    hubspotUrl: '',
    includedLists: [],
    suppressionLists: [],
  });

  const loaded = (slug: string): CampaignBriefLoadResult =>
    ({
      status: 'loaded',
      briefId: 'brief-nl',
      etag: '"2"',
      approved: true,
      brief: {
        deliveryType: 'newsletter',
        emailStage: 'Newsletter',
        eventDetails: { name: 'Acme Newsletter - November 2026', slug, sourceText: SAVED_NOTES, newsletterBrand: 'Acme', referenceEmailIds: ['30', '10'] },
      } as unknown as CampaignBriefOutput,
    }) as CampaignBriefLoadResult;

  const none: CampaignBriefLoadResult = { status: 'none', briefId: null, brief: null, etag: null, approved: false };

  interface Internals {
    briefForm: FormGroup;
    canGenerate(): boolean;
    selectedReferenceIds(): string[];
    notesFromSavedBrief(): boolean;
  }

  const internals = (): Internals => fixture.componentInstance as unknown as Internals;
  const notes = (): string => internals().briefForm.controls['sourceText'].value as string;

  /**
   * Past the brand read's and the saved-brief lookup's 500ms debounce, on fake timers: waiting it
   * out in real time cost 650ms a call and put this file far over the per-file runtime budget.
   */
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(650);
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const type = (brand: string, issueName: string): void => {
    internals().briefForm.controls['newsletterBrand'].setValue(brand);
    internals().briefForm.controls['newsletterIssue'].setValue(issueName);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanningTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    const campaignService = TestBed.inject(CampaignService);
    loadBrief = vi.fn().mockImplementation((slug: string) => of(slug === 'acme-newsletter-november-2026' ? loaded(slug) : none));
    vi.spyOn(campaignService, 'loadBrief').mockImplementation(loadBrief);
    vi.spyOn(campaignService, 'getAudienceBrandNewsletters').mockReturnValue(of([issue('30'), issue('20'), issue('10')]));
    vi.spyOn(campaignService, 'getAudienceNewsletterBrands').mockReturnValue(
      of([{ brand: 'Acme', latestEmailName: '26Q4 - Acme - Newsletter - October', latestSentAt: '2026-11-02T15:00:00Z', issues: 12 }])
    );

    const projectContextService = TestBed.inject(ProjectContextService);
    projectContextService.setRouteLensKind('foundation');
    projectContextService.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);

    // Before the component exists, so every debounce it schedules runs on the fake clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    fixture = TestBed.createComponent(PlanningTabComponent);
    fixture.componentRef.setInput('programTypeConfig', programTypeConfig);
    fixture.componentRef.setInput('deliveryType', 'newsletter');
    fixture.componentRef.setInput('emailStage', 'Newsletter');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fills an untouched notes box from the saved brief and ticks the issues it was styled on', async () => {
    type('Acme', 'November 2026');
    await settle();

    expect(loadBrief).toHaveBeenCalledWith('acme-newsletter-november-2026', 'foundation-a', 'newsletter', 'Newsletter');
    expect(notes()).toBe(SAVED_NOTES);
    expect(internals().notesFromSavedBrief()).toBe(true);
    // The saved brief was styled on 30 and 10; issue 20 is unticked, as it was.
    expect(internals().selectedReferenceIds()).toEqual(['30', '10']);
    // With brand, issue and notes present the issue can be generated again as it stands.
    expect(internals().canGenerate()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-newsletter-notes-from-saved"]')?.textContent).toContain(
      'Filled from the brief saved for this issue'
    );
  });

  it('never replaces notes the operator has typed', async () => {
    const control = internals().briefForm.controls['sourceText'];
    control.setValue('My own notes');
    control.markAsDirty();
    type('Acme', 'November 2026');
    await settle();

    expect(notes()).toBe('My own notes');
    expect(internals().notesFromSavedBrief()).toBe(false);
  });

  it('takes the filled notes back when the planner moves to another issue', async () => {
    type('Acme', 'November 2026');
    await settle();
    expect(notes()).toBe(SAVED_NOTES);

    type('Acme', 'December 2026');
    await settle();

    // November's notes must not ride along to an issue they were never written for.
    expect(notes()).toBe('');
    expect(internals().notesFromSavedBrief()).toBe(false);
    expect(internals().selectedReferenceIds()).toEqual(['30', '20', '10']);
  });

  it('still takes the filled notes back after the same issue is read again', async () => {
    type('Acme', 'November 2026');
    await settle();
    expect(notes()).toBe(SAVED_NOTES);

    // The saved-brief lookup runs again for the SAME issue: the parent bumps the refresh token
    // after a write of its own, which re-keys the lookup without changing the slug.
    const reads = loadBrief.mock.calls.length;
    fixture.componentRef.setInput('savedBriefRefreshToken', 1);
    fixture.detectChanges();
    await settle();
    expect(loadBrief.mock.calls.length).toBeGreaterThan(reads);
    expect(notes()).toBe(SAVED_NOTES);
    expect(internals().notesFromSavedBrief()).toBe(true);

    type('Acme', 'December 2026');
    await settle();
    expect(notes()).toBe('');
  });

  it('keeps notes the operator edited after the fill when the issue changes', async () => {
    type('Acme', 'November 2026');
    await settle();
    const control = internals().briefForm.controls['sourceText'];
    control.setValue(`${SAVED_NOTES}\nOne more item`);
    control.markAsDirty();

    type('Acme', 'December 2026');
    await settle();

    expect(notes()).toContain('One more item');
  });
});
