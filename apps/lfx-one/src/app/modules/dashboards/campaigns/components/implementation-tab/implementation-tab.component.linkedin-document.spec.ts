// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, LinkedInObjectiveDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedInObjectivePickerComponent } from '../linkedin-objective-picker/linkedin-objective-picker.component';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * Wiring only (linuxfoundation/lfx-v2-campaign-service#665). What a document sends and why Create waits are rules in
 * `campaign-linkedin-document-form.utils.ts` and `campaign-linkedin-document.utils.ts`, tested there. Here: the PDF, title
 * and intro reach the request with no variants, a PDF of another brief or no longer stored and the website visits objective
 * hold Create (a manual bid is a row in the form utils spec), a gated document warns without holding it, and (one render) the format is offered while the single image
 * variants and the website objectives are hidden.
 */
describe('ImplementationTabComponent linkedin document', () => {
  const ACCOUNT = { accountId: 'urn:li:sponsoredAccount:111', label: 'First Account', orgId: 'urn:li:organization:1', status: 'ACTIVE' };
  const PDF = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
  const LEAD_GEN: LinkedInObjectiveDraft = {
    objective: 'lead_generation',
    conversions: [],
    conversionsOwner: null,
    leadGenForm: '6755260984438374400',
    leadGenFormOwner: `tlf|${ACCOUNT.accountId}`,
  };
  const document = (fields: Record<string, string> = {}) => ({
    assetId: PDF,
    assetBriefId: 'b-1',
    title: 'Sponsor prospectus',
    introText: 'Sponsor us',
    ...fields,
  });
  let createCampaign: ReturnType<typeof vi.fn>;
  let enqueueCreativeAssetUploads: ReturnType<typeof vi.fn>;
  const deleting = signal<{ briefId: string; id: string } | null>(null);

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['linkedin-ads'],
      linkedInCopy: {
        variants: [{ introText: 'Intro', headline: 'Headline' }],
        recommendedGeoTargets: [{ urn: 'urn:li:geo:103644278', label: 'United States' }],
        recommendedTargetingProfile: 'cloud-native',
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;
  const c = (f: ComponentFixture<ImplementationTabComponent>): Record<string, any> => f.componentInstance as unknown as Record<string, any>;

  async function mount(): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('linkedInDocumentEnabled', true);
    f.componentRef.setInput('linkedInLeadGenEnabled', true);
    f.componentRef.setInput('linkedInConversionsEnabled', true);
    f.componentRef.setInput('linkedInAssetUploadEnabled', true);
    f.componentRef.setInput('briefData', brief());
    c(f)['selectedPlatforms'].set(['linkedin-ads']);
    f.detectChanges();
    await f.whenStable();
    c(f)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c(f)['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c(f)['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c(f)['campaignForm'].controls['endDate'].setValue('2026-09-30');
    f.detectChanges();
    return f;
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));
    deleting.set(null);
    enqueueCreativeAssetUploads = vi.fn();
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: signal({ slug: 'tlf' }) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            createCampaign,
            enqueueCreativeAssetUploads,
            creativeVideoDeleting: deleting.asReadonly(),
            getLinkedInAccounts: () => of([ACCOUNT]),
            getLinkedInTargetingProfiles: () => of([]),
            getLinkedInLeadForms: () => of({ accountId: '111', forms: [] }),
            getLinkedInConversions: () => of({ accountId: '111', conversions: [] }),
            listCreativeAssets: () => of({ assets: [], videos: [], documents: [{ id: PDF, byteSize: 2048, checksum: 'abcdef0123' }] }),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  it('sends the PDF, title and intro with no variants, and holds what campaign-service refuses', STATE_ONLY, async () => {
    const f = await mount();
    c(f)['onLinkedInFormatSelect']('document');
    c(f)['onLinkedInDocumentChange'](document());
    await f.whenStable();

    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    const sent = createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig'];
    expect(sent).toMatchObject({
      format: 'document',
      documentAssetId: PDF,
      documentTitle: 'Sponsor prospectus',
      documentIntroText: 'Sponsor us',
      variants: [],
    });
    expect(sent).not.toHaveProperty('carouselCards');

    // A PDF picked for another brief, or one the library read no longer lists: Create waits.
    c(f)['onLinkedInDocumentChange'](document({ assetBriefId: 'b-0' }));
    expect(c(f)['createBlockedReason']()).toContain('choose another PDF');
    c(f)['onLinkedInDocumentChange'](document({ assetId: '9a7b1c2d-3e4f-4a6b-8c1e-5d4a3f2b4e6f' }));
    expect(c(f)['createBlockedReason']()).toContain('choose another PDF');

    // While the brief saves the tab has no brief id: the save's hold shows, not the document's.
    f.componentRef.setInput('briefSaveInFlight', true);
    f.componentRef.setInput('briefPersistence', { status: 'saving', briefId: null, message: null, approved: true });
    expect(c(f)['createBlockedReason']()).toBe('Waiting for the brief to finish saving.');
    f.componentRef.setInput('briefSaveInFlight', false);
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    c(f)['onLinkedInDocumentChange'](document());

    // A hidden single image variant whose image is for another brief holds nothing: the document does not send it.
    const variantKey = c(f)['linkedInVariants']()[0].key;
    c(f)['linkedInVariants'].update((variants: Record<string, unknown>[]) =>
      variants.map((v) => (v['key'] === variantKey ? { ...v, imageAssetId: PDF, imageAssetName: 'old.png', imageAssetBriefId: 'b-0' } : v))
    );
    expect(c(f)['createBlockedReason']()).toBeNull();

    // A held website visits objective is refused for a document.
    c(f)['onLinkedInObjectiveDraftChange']({ objective: 'traffic', conversions: [], conversionsOwner: null });
    expect(c(f)['createBlockedReason']()).toContain('no website visits or conversions');

    // A PDF chosen in the editor goes to the brief's library queue as a document, so the queue takes a PDF.
    const pdf = new File([new Uint8Array(16)], 'deck.pdf', { type: 'application/pdf' });
    c(f)['onLinkedInDocumentUpload']([pdf]);
    expect(enqueueCreativeAssetUploads).toHaveBeenCalledWith([pdf], 'tlf', 'b-1', { documents: true });

    // The target cost is not offered beside a document, as beside lead generation.
    f.componentRef.setInput('linkedInTargetCostEnabled', true);
    f.componentRef.setInput('biddingEnabled', true);
    c(f)['onLinkedInFormatSelect']('single_image');
    expect(c(f)['linkedInTargetCostShown']()).toBe(true);
    c(f)['onLinkedInFormatSelect']('document');
    expect(c(f)['linkedInTargetCostShown']()).toBe(false);

    // A gated document is offered, and warns about one-page PDFs (decision 2026-11-25: a warning, not a refusal).
    expect(c(f)['linkedInDocumentGatedWarning']()).toBe('');
    c(f)['onLinkedInObjectiveDraftChange'](LEAD_GEN);
    expect(c(f)['linkedInDocumentGatedWarning']()).toContain('one-page PDF');
  });

  it('needs no registration URL for a document-only create, and still does beside another format or platform', STATE_ONLY, async () => {
    const f = await mount();
    c(f)['campaignForm'].controls['registrationUrl'].setValue('');
    c(f)['onLinkedInFormatSelect']('document');
    c(f)['onLinkedInDocumentChange'](document());

    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['onLinkedInFormatSelect']('single_image');
    expect(c(f)['createBlockedReason']()).toContain('Registration URL is empty');
    c(f)['onLinkedInFormatSelect']('document');
    c(f)['selectedPlatforms'].set(['linkedin-ads', 'reddit-ads']);
    expect(c(f)['createBlockedReason']()).toContain('Registration URL is empty');
  });

  it('clears a PDF the library deleted or took off the ad, and reads the library again after a delete', STATE_ONLY, async () => {
    const f = await mount();
    c(f)['onLinkedInDocumentChange'](document());
    expect(c(f)['linkedInDocumentIdsInUse']()).toEqual([PDF]);
    const revision = c(f)['creativeLibraryRevision']();

    // Another PDF deleted: the ad keeps its own, and the picker's library is read again.
    c(f)['onLibraryDocumentDeleted']('9a7b1c2d-3e4f-4a6b-8c1e-5d4a3f2b4e6f');
    expect(c(f)['linkedInDocument']().assetId).toBe(PDF);
    expect(c(f)['creativeLibraryRevision']()).toBe(revision + 1);

    // While the held PDF's delete runs, Create waits; the rule and the picker's exclusion are rows in the utils spec.
    c(f)['onLinkedInFormatSelect']('document');
    deleting.set({ briefId: 'b-1', id: PDF });
    expect(c(f)['createBlockedReason']()).toContain('is being deleted');
    // A PDF picked after the delete started is refused, not queued.
    c(f)['onLinkedInDocumentUpload']([new File([new Uint8Array(16)], 'deck.pdf', { type: 'application/pdf' })]);
    expect(enqueueCreativeAssetUploads).not.toHaveBeenCalled();
    deleting.set(null);

    // Taken off the ad: cleared, with nothing re-read.
    c(f)['onLibraryDocumentReleased'](PDF);
    expect(c(f)['linkedInDocument']()).toMatchObject({ assetId: '', assetBriefId: '', title: 'Sponsor prospectus' });
    expect(c(f)['linkedInDocumentIdsInUse']()).toEqual([]);
    expect(c(f)['creativeLibraryRevision']()).toBe(revision + 1);
  });

  it('offers the document and its editor in place of the variants, and only engagement or lead generation beside it', async () => {
    const f = await mount();
    const query = (testId: string): HTMLElement | null => f.nativeElement.querySelector(`[data-testid="${testId}"]`);
    const optionValues = (testId: string): unknown[] =>
      f.debugElement
        .query(By.css(`[data-testid="${testId}"]`))
        .componentInstance['options']()
        .map((o: { value: unknown }) => o.value);
    expect(optionValues('implementation-linkedin-format')).toContain('document');
    expect(optionValues('linkedin-objective-picker-objective')).toEqual(['', 'traffic', 'conversions', 'lead_generation']);

    c(f)['onLinkedInFormatSelect']('document');
    f.detectChanges();
    await f.whenStable();

    expect(query('linkedin-document-editor')).not.toBeNull();
    expect(query('implementation-linkedin-variants')).toBeNull();
    expect(optionValues('linkedin-objective-picker-objective')).toEqual(['', 'lead_generation']);
    expect(f.debugElement.query(By.directive(LinkedInObjectivePickerComponent))?.componentInstance.documentChosen()).toBe(true);
  });
});
