// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FOUNDATION_MESSAGE_PRINT_BODY_CLASS, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { BrandKitRevision, MktgRevisionResponse, ProjectContext } from '@lfx-one/shared/interfaces';
import { mktgPrintBrand } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
// package-architecture.md § Import Patterns: fixtures are intentionally not re-exported by the production utils barrel.
import { aeoGeoEnvelopeFixture } from '@lfx-one/shared/utils/aeo-geo.fixture';
import { FeatureFlagService } from '@services/feature-flag.service';
import { Member360Service } from '@services/member-360.service';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgPendingDocumentService } from '@services/mktg-pending-document.service';
import { MktgPrintService } from '@services/mktg-print.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { provideMktgCommentsStub } from '@shared/testing/mktg-comments-test-service';
import { provideMktgSlidesExportStub } from '@shared/testing/mktg-slides-export-test-service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { NEVER, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { MktgDocumentViewComponent } from './mktg-document-view.component';

/**
 * The AEO/GEO report's print block (Download PDF): the order of its pages' content and the running head it wears.
 * Beside `mktg-document-view.component.spec.ts`, which covers the rest of the view, so the print's assertions read on their own.
 */
describe('MktgDocumentViewComponent AEO/GEO report print', () => {
  const PROJECT: ProjectContext = { uid: 'proj-1', name: 'Synthetic Audit Project', slug: 'synthetic-audit-project' };
  const TYPE = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'aeo-geo');
  const envelope = aeoGeoEnvelopeFixture();
  const typed = envelope.report;
  if (!TYPE || !typed) {
    throw new Error('Recorded audit fixture is incomplete.');
  }
  const revision = {
    id: `000001-${envelope.content_sha256}`,
    number: 1,
    createdAt: '2026-10-15T10:00:00.000Z',
    origin: 'generated' as const,
    restoredFromNumber: null,
    intakeMode: 'form' as const,
    status: '',
    contentSha256: envelope.content_sha256,
    format: 'markdown' as const,
    commentCount: 0,
    latest: true,
    author: null,
    approval: null,
  };
  const response: MktgRevisionResponse = {
    project: PROJECT.uid,
    type: TYPE,
    documentId: 'run-012345678901234567890123',
    revisions: [revision],
    revision,
    approval: null,
    approvedCurrent: null,
    markdown: envelope.document_markdown,
    sidecar: null,
    aeoGeoReport: {
      domain: envelope.domain,
      report_filename: envelope.report_filename,
      overall_score: envelope.overall_score,
      verdict: envelope.verdict,
      scores: envelope.scores,
      report: typed,
      auditCounts: { keyPagesNamed: 2, pagesAudited: envelope.inputs.pages_audited.length },
    },
  };

  /** The same revision as a legacy Markdown-only report: no typed `report`, its Markdown carries the title. */
  const legacyResponse: MktgRevisionResponse = {
    ...response,
    aeoGeoReport: response.aeoGeoReport && { ...response.aeoGeoReport, report: undefined },
  };

  let harness: RouterTestingHarness;
  let served: MktgRevisionResponse = response;
  const resolveBrandKit = vi.fn();

  function query(testId: string): HTMLElement | null {
    return harness.routeNativeElement?.querySelector(`[data-testid="${testId}"]`) ?? null;
  }

  function printArticle(): HTMLElement {
    const article = query('mktg-document-view-print')?.querySelector<HTMLElement>('article.lfx-framework-print');
    if (!article) throw new Error('Missing synthetic report print article');
    return article;
  }

  beforeEach(async () => {
    resolveBrandKit.mockReset().mockReturnValue(of(null));
    served = response;
    const detail = { project: PROJECT.uid, type: TYPE, documentId: response.documentId, revisions: [revision], approvedCurrent: null };
    await TestBed.configureTestingModule({
      providers: [
        provideMktgCommentsStub(),
        { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: 'UTC' } },
        provideRouter([{ path: 'documents/:agentKey/:documentId', component: MktgDocumentViewComponent }]),
        provideNoopAnimations(),
        MessageService,
        { provide: MktgDependencyService, useValue: { resolveBrandKit, notifyDocumentsChanged: vi.fn(), documentsChanged$: NEVER } },
        provideMktgSlidesExportStub({ last: vi.fn(() => of({ last: null, latestRevision: null })), start: vi.fn(() => of()), poll: vi.fn(() => of()) }),
        { provide: ProjectContextService, useValue: { activeContext: signal(PROJECT), activeContextUid: computed(() => PROJECT.uid) } },
        {
          provide: MktgDocumentStoreService,
          useValue: {
            listDocuments: vi.fn(() => of({ project: PROJECT.uid, groups: [] })),
            getDocument: vi.fn(() => of(detail)),
            getRevision: vi.fn(() => of(served)),
            getApprovedRevision: vi.fn(() => of(null)),
            restoreRevision: vi.fn(),
            approveRevision: vi.fn(),
            retryRun: vi.fn(() => of(detail)),
            saveLinkedinShareLink: vi.fn(),
          },
        },
        { provide: ProjectService, useValue: { getProject: vi.fn(() => of({ writer: true })) } },
        { provide: Member360Service, useValue: { download: vi.fn() } },
        { provide: UserService, useValue: { impersonating: signal(false), user: computed(() => ({ sub: 'synthetic-sub' })) } },
        { provide: MktgAgentRunService, useValue: { resume: vi.fn(() => NEVER), activeRunConflict: MktgAgentRunService.prototype.activeRunConflict } },
        {
          provide: MktgRunAttemptService,
          useValue: { peek: vi.fn(() => null), consume: vi.fn(() => null), load: vi.fn(() => null), prepare: vi.fn(), save: vi.fn() },
        },
        { provide: HttpClient, useValue: {} },
        { provide: MktgPendingDocumentService, useValue: { load: vi.fn(() => null), waitForStorage: vi.fn(), clear: vi.fn() } },
        { provide: MktgPrintService, useValue: { prepare: vi.fn(() => Promise.resolve()), printNow: vi.fn(), clear: vi.fn(), ensureFontStylesheet: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true) } },
      ],
    })
      .overrideComponent(MktgDocumentViewComponent, { set: { providers: [{ provide: DialogService, useValue: { open: vi.fn() } }] } })
      .compileComponents();
  });

  async function render(): Promise<void> {
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/documents/aeo-geo/${response.documentId}`, MktgDocumentViewComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  it('opens the printed report with its title and facts, then the score card, then the typed report without a second headline', async () => {
    await render();
    const article = printArticle();
    const headline = query('mktg-document-view-print-headline');
    const subline = query('mktg-document-view-print-subline');
    const overall = query('mktg-document-view-print-overall');
    const report = article.querySelector('lfx-aeo-geo-report');
    if (!headline || !subline || !overall || !report) throw new Error('Missing synthetic report print blocks');
    expect(headline.textContent?.trim()).toBe(typed.headline);
    // The title is the first text of the sheet's body (the head group above it carries the running head), and it comes before
    // the score card the web summary leads with; the web view keeps its order.
    const body = article.querySelector<HTMLElement>('.lfx-print-sheet-body');
    const firstText = Array.from(body?.querySelectorAll<HTMLElement>('*') ?? []).find(
      (element) => element.children.length === 0 && element.textContent?.trim()
    );
    expect(firstText && headline.contains(firstText)).toBe(true);
    expect(headline.compareDocumentPosition(overall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(overall.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headline.classList.contains('break-after-avoid')).toBe(true);
    expect(headline.parentElement?.classList.contains('break-inside-avoid')).toBe(true);
    expect(overall.closest('.grid')?.classList.contains('break-inside-avoid')).toBe(true);
    expect(report.querySelector('h2')).toBeNull();
    expect(article.querySelectorAll('h2')).toHaveLength(1);
    // The facts under the title, without the web summary's storage note.
    // The recorded fixture audits six pages (aeo-geo-project.fixture.ts, `pages_audited`): the count the view prints is the fixture's.
    const audited = envelope.inputs.pages_audited.length;
    expect(audited).toBe(6);
    expect(subline.textContent?.replace(/\s+/g, ' ').trim()).toBe(`AEO/GEO report — 15 Oct 2026 · 2 key pages named, ${audited} audited`);
    expect(query('mktg-document-view-audit-subline')?.textContent).toContain('stored under AEO/GEO reports');
    // The web summary's own order does not move: its title, then its score card, then the typed report.
    const summary = query('mktg-document-view-report-summary');
    const webHeadline = query('mktg-document-view-headline');
    const webOverall = query('mktg-document-view-overall');
    if (!summary || !webHeadline || !webOverall) throw new Error('Missing synthetic report summary');
    expect(summary.contains(webHeadline) && summary.contains(webOverall)).toBe(true);
    expect(webHeadline.compareDocumentPosition(webOverall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Still one flowing sheet row, no footer group.
    expect(article.querySelectorAll(':scope > lfx-mktg-print-sheet > .lfx-print-sheet-body > lfx-mktg-print-sheet-row.lfx-print-sheet-row-flows')).toHaveLength(
      1
    );
    expect(article.querySelector('[data-testid="mktg-print-sheet-foot"], tfoot')).toBeNull();
  });

  it('wears the shared running head in the sheet head group: project, document and date, no version, the LF look without a kit', async () => {
    await render();
    const article = printArticle();
    const head = article.querySelector('[data-testid="mktg-print-sheet-head"]');
    const runningHead = head?.querySelector('[data-testid="mktg-print-running-head"]');
    if (!runningHead) throw new Error('Missing synthetic report running head');
    expect(head?.querySelector('[data-testid="mktg-print-sheet-head-row"]')?.contains(runningHead)).toBe(true);
    expect(runningHead.textContent?.replace(/\s+/g, ' ').trim()).toBe(`${PROJECT.name} AEO/GEO report · 15 Oct 2026`);
    expect(runningHead.textContent).not.toMatch(/version|v1/i);
    expect(runningHead.querySelector('img')?.getAttribute('alt')).toBe(mktgPrintBrand(null).logoOnLight?.alt);
    // The report reads the project's kit for its brand, as the other prints do; none stored here, so the LF look.
    expect(resolveBrandKit).toHaveBeenCalledWith(PROJECT.uid);
    expect(article.querySelectorAll('[data-testid="mktg-print-running-head"]')).toHaveLength(1);
  });

  it('prints a legacy Markdown-only report with the one title its Markdown carries, after the score card', async () => {
    served = legacyResponse;
    await render();
    const article = printArticle();
    const overall = query('mktg-document-view-print-overall');
    const markdown = article.querySelector('lfx-markdown-renderer');
    if (!overall || !markdown) throw new Error('Missing synthetic legacy report print blocks');
    // No typed title block: the Markdown's own H1 is the only title, so the report never prints two (its `##` sections are h2 by design).
    expect(query('mktg-document-view-print-headline')).toBeNull();
    expect(query('mktg-document-view-print-subline')).toBeNull();
    expect(article.querySelector('lfx-aeo-geo-report')).toBeNull();
    const titles = Array.from(article.querySelectorAll('h1'), (heading) => heading.textContent?.trim());
    expect(titles).toEqual(['AEO/GEO Analysis: project.example']);
    expect(overall.compareDocumentPosition(markdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The running head still rides in the sheet's head group.
    expect(article.querySelector('[data-testid="mktg-print-sheet-head"] [data-testid="mktg-print-running-head"]')?.textContent).toContain('AEO/GEO report');
  });

  it('waits for the Brand Kit read before printing: a press while the read is open prints once, in the kit look, when it settles', async () => {
    const kitRead = new Subject<BrandKitRevision | null>();
    resolveBrandKit.mockReturnValue(kitRead);
    await render();
    const print = TestBed.inject(MktgPrintService);
    const runningHead = (): Element | null => printArticle().querySelector('[data-testid="mktg-print-sheet-head"] [data-testid="mktg-print-running-head"]');
    // printNow clones the print root synchronously, so what the running head shows AT THE CALL is what the PDF carries.
    const headAtPrint: string[] = [];
    (print.printNow as Mock).mockImplementation(() => headAtPrint.push(runningHead()?.innerHTML ?? ''));
    const lfHead = runningHead()?.innerHTML ?? '';
    expect(lfHead).toContain(mktgPrintBrand(null).logoOnLight?.alt);
    const button = query('mktg-document-view-download')?.querySelector('button');
    if (!button) throw new Error('Missing synthetic Download PDF button');
    // The button stays enabled while the kit is read; the press is kept, not printed yet (it would be the LF-default PDF).
    expect(button.disabled).toBe(false);
    button.click();
    button.click();
    expect(print.printNow).not.toHaveBeenCalled();
    const kit = brandKitTestRevision();
    kitRead.next(kit);
    kitRead.complete();
    // The read has settled but nothing has rendered yet: a third press in this frame is dropped too (one press is waiting).
    button.click();
    expect(print.printNow).not.toHaveBeenCalled();
    // The app is zoneless: the response's signal write schedules the tick that runs the effect and the render after it.
    await harness.fixture.whenStable();
    // One print for the three presses, with the kit's brand on the running head, both after the render and at the call itself.
    expect(print.printNow).toHaveBeenCalledTimes(1);
    expect(print.printNow).toHaveBeenCalledWith(FOUNDATION_MESSAGE_PRINT_BODY_CLASS, `${PROJECT.name} · AEO/GEO report · v1 · 2026-10-15`);
    const brand = mktgPrintBrand(kit);
    if (brand.logoOnLight) expect(runningHead()?.querySelector('img')?.getAttribute('src')).toBe(brand.logoOnLight.src);
    else expect(runningHead()?.querySelector('img')).toBeNull();
    expect(headAtPrint).toEqual([runningHead()?.innerHTML]);
    expect(headAtPrint[0]).not.toBe(lfHead);
    // Settled, a later press prints at once.
    button.click();
    expect(print.printNow).toHaveBeenCalledTimes(2);
  });

  it('prints at once when the Brand Kit read has failed (null), never dropping the press', async () => {
    // resolveBrandKit turns a 404 or an error into null before it reaches the view; here that null arrives after the press.
    const kitRead = new Subject<BrandKitRevision | null>();
    resolveBrandKit.mockReturnValue(kitRead);
    await render();
    const print = TestBed.inject(MktgPrintService);
    query('mktg-document-view-download')?.querySelector('button')?.click();
    expect(print.printNow).not.toHaveBeenCalled();
    kitRead.next(null);
    // The settled signal reaches the waiting press through an effect, on the tick the response schedules, then the render.
    await harness.fixture.whenStable();
    expect(print.printNow).toHaveBeenCalledTimes(1);
  });

  it('drops a press waiting for the Brand Kit read when the document leaves the screen', async () => {
    const kitRead = new Subject<BrandKitRevision | null>();
    resolveBrandKit.mockReturnValue(kitRead);
    await render();
    const print = TestBed.inject(MktgPrintService);
    query('mktg-document-view-download')?.querySelector('button')?.click();
    expect(print.printNow).not.toHaveBeenCalled();
    // The view is destroyed (the same clearAeoPrint runs on a document change) while the read is still open.
    harness.fixture.destroy();
    expect(print.clear).toHaveBeenCalled();
    kitRead.next(brandKitTestRevision());
    kitRead.complete();
    await harness.fixture.whenStable();
    expect(print.printNow).not.toHaveBeenCalled();
  });

  it('wears the project kit brand on the running head once the kit resolves', async () => {
    const kit = brandKitTestRevision();
    resolveBrandKit.mockReturnValue(of(kit));
    await render();
    const runningHead = printArticle().querySelector('[data-testid="mktg-print-sheet-head"] [data-testid="mktg-print-running-head"]');
    const brand = mktgPrintBrand(kit);
    expect(runningHead?.textContent).toContain(`${PROJECT.name} AEO/GEO report`);
    if (brand.logoOnLight) expect(runningHead?.querySelector('img')?.getAttribute('src')).toBe(brand.logoOnLight.src);
    else expect(runningHead?.querySelector('img')).toBeNull();
  });
});
