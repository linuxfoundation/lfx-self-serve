// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  PLATFORM_ID,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import {
  FOUNDATION_MESSAGE_MODE_LABELS,
  FOUNDATION_MESSAGE_PRINT_BODY_CLASS,
  FOUNDATION_MESSAGE_PRINT_ONLY_CLASS,
  FOUNDATION_MESSAGE_TABLE_MIN_WIDTH_REM,
  FOUNDATION_MESSAGE_VIEW_TABS,
  MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE,
  MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE,
  MKTG_REPORT_GAPS_TITLE,
  MKTG_PRINT_KIT_READ_NONE,
  MKTG_REPORT_ASSET_LABELS,
  MKTG_PRINT_KIT_READ_NOTES,
  MKTG_SLIDES_EXPORT_DECK_TITLE_LABELS,
} from '@lfx-one/shared/constants';
import {
  FoundationMessageAvoidRow,
  FoundationMessageGoalView,
  FoundationMessageNumberRow,
  FoundationMessagePrintView,
  FoundationMessageViewTab,
  MktgFrameworkAsset,
  MktgFrameworkViewState,
  MktgFrameworkViewTab,
  MktgPrintKitRead,
  MktgSlidesExportTarget,
  MktgRevisionApproval,
  MktgAssetHeaderMetadata,
} from '@lfx-one/shared/interfaces';
import {
  buildFoundationMessagePrintView,
  describeMktgAcceptedGaps,
  mktgAssetHeaderFallback,
  foundationMessageAvoidRows,
  foundationMessageGoalViews,
  foundationMessageNumberRows,
  mktgPrintDocumentTitle,
  mktgReportFindingsView,
} from '@lfx-one/shared/utils';
import { MktgPrintService } from '@services/mktg-print.service';
import { createMktgAssetTab } from '../utils/mktg-asset-tab.util';
import { MktgAssetMetaComponent } from '../components/mktg-asset-meta/mktg-asset-meta.component';
import { MktgReportFindingsComponent } from '../components/mktg-report-findings/mktg-report-findings.component';
import { MktgDocumentCommentsService } from '@services/mktg-document-comments.service';

import { MktgFrameworkPrintComponent } from '../mktg-framework-print/mktg-framework-print.component';
import { MktgSlidesExportComponent } from '../mktg-slides-export/mktg-slides-export.component';
import { MktgFieldCommentsComponent } from '../components/mktg-field-comments/mktg-field-comments.component';

// The Messaging Framework asset view (design: Agent run, Asset view): the
// framework's own page inside the mktg-os-agents module, with one tab per
// part of the bundle — the framework (the four statements and the goal
// columns as one table, then say and avoid), the key numbers, and the sources
// and gaps of the run's report; the stored ICPs and message house are not
// shown (FOUNDATION_MESSAGE_VIEW_TABS). While a run is live
// the same shell shows the generating state and projects the feed or the
// questions where the framework will be, so the run lands here and stays
// here. Once the framework exists the header carries what you can do with
// it: Download PDF prints the framework as one document in the project's
// brand (lfx-mktg-framework-print, held here in a print-only wrapper and
// never shown on screen), and Export to Google Slides builds the framework
// as a deck from the stored revision the page names (lfx-mktg-slides-export,
// the panel under the header: progress, the deck, the last export), in the
// project's brand when it has a kit. Presentational: the run page and the
// Documents area feed it the framework, the project's Brand Kit and the
// revision to export.
@Component({
  selector: 'lfx-mktg-framework-view',
  imports: [
    TooltipModule,
    NgClass,
    NgTemplateOutlet,
    MktgAssetMetaComponent,
    MessageComponent,
    ButtonComponent,
    MarkdownRendererComponent,
    MktgFrameworkPrintComponent,
    MktgSlidesExportComponent,
    MktgFieldCommentsComponent,
    MktgReportFindingsComponent,
  ],
  templateUrl: './mktg-framework-view.component.html',
})
export class MktgFrameworkViewComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly printService = inject(MktgPrintService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly comments = inject(MktgDocumentCommentsService);

  // === Inputs ===
  /** The project the framework is for. */
  public readonly projectName = input.required<string>();
  /** The validated framework with its report and checks; null while the run is live. */
  public readonly asset = input<MktgFrameworkAsset | null>(null);
  /** Generating (the feed is projected in), questions (the stepper is projected in), or ready. */
  public readonly state = input<MktgFrameworkViewState>('ready');
  /** The revision or run version shown in the header, when known. */
  public readonly version = input<number | null>(null);
  public readonly headerMetadata = input<MktgAssetHeaderMetadata | null>(null);
  public readonly showMetadata = input(true);
  public readonly titleActions = viewChild<TemplateRef<unknown>>('titleActions');
  public readonly approval = input<MktgRevisionApproval | null>(null);
  /**
   * The host's read of the project's stored Brand Kit, which the print is set in: the print root is built only once the read has
   * settled with the kit or with none stored (the LF look); while it is open, or after it failed, Download PDF waits and says why,
   * so no project with a kit is ever printed in the LF default. A host that passes none: no kit, the LF look.
   */
  public readonly kitRead = input<MktgPrintKitRead>(MKTG_PRINT_KIT_READ_NONE);
  /** The stored revision Export to Google Slides reads; null while there is none (the button shows disabled). */
  public readonly exportTarget = input<MktgSlidesExportTarget | null>(null);
  /** The viewed document for last-export lookup, independent of approved export bytes. */
  public readonly exportLookupTarget = input<MktgSlidesExportTarget | null>(null);
  public readonly exportLookupAnswered = output<string>();
  public readonly viewingDraft = input(false);
  public readonly approvedAsset = input<MktgFrameworkAsset | null>(null);
  public readonly approvedVersion = input<number | null>(null);
  /** When the approved revision was stored (ISO), as the page shows it: it dates the PDF's name. */
  public readonly approvedCreatedAt = input<string | null>(null);
  /** When the approved revision was approved (ISO): the print's cover and its Sources & gaps approval card date it. */
  public readonly approvedAt = input<string | null>(null);
  public readonly approvedLoading = input(false);
  public readonly approvedError = input('');

  // === Signals ===
  private readonly tabState = createMktgAssetTab(
    FOUNDATION_MESSAGE_VIEW_TABS.map((tab) => tab.id),
    'framework'
  );
  protected readonly selectedTab = this.tabState.selected;

  // === Computed ===
  protected readonly content = computed(() => this.asset()?.content ?? null);
  protected readonly report = computed(() => this.asset()?.report ?? null);
  /** The report's findings as the Sources tab shows them: a v2 report's three groups, a v1 report's failed list alone. */
  protected readonly reportFindings = computed(() => mktgReportFindingsView(this.report(), MKTG_REPORT_ASSET_LABELS));
  protected readonly findings = computed(() => this.asset()?.checks.findings ?? []);
  protected readonly ready = computed(() => this.state() === 'ready' && this.content() !== null);
  protected readonly title = computed(() => `${this.projectName()} Messaging framework`);
  protected readonly header = computed(() => this.headerMetadata() ?? mktgAssetHeaderFallback('foundation-message', this.version(), null, this.approval()));
  protected readonly approvalRequiredNote = MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE;
  protected readonly noSourceFailedNote = MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE;
  protected readonly gapsTitle = MKTG_REPORT_GAPS_TITLE;
  /** Under an approved revision's gaps: accepted at that approval, still open. */
  protected readonly acceptedGapsNote = computed(() => describeMktgAcceptedGaps(this.report(), this.approval(), this.version()));
  protected readonly modeLabel = computed(() => {
    const asset = this.asset();
    return asset && asset.mode !== 'draft' ? FOUNDATION_MESSAGE_MODE_LABELS[asset.mode] : '';
  });
  protected readonly stateLabel = computed(() => {
    if (this.state() === 'generating') {
      return 'Generating';
    }
    if (this.state() === 'questions') {
      return 'Waiting for your answers';
    }
    return '';
  });
  protected readonly tabs: Signal<MktgFrameworkViewTab[]> = this.initTabs();
  protected readonly goals: Signal<FoundationMessageGoalView[]> = computed(() => {
    const content = this.content();
    return content ? foundationMessageGoalViews(content) : [];
  });
  /** The goal table's least width in rem: the row header plus one reading width per goal, so more goals scroll sideways instead of squeezing. */
  protected readonly goalsTableMinWidthRem: Signal<number> = computed(
    () => FOUNDATION_MESSAGE_TABLE_MIN_WIDTH_REM.rowHeader + FOUNDATION_MESSAGE_TABLE_MIN_WIDTH_REM.goal * this.goals().length
  );
  protected readonly avoidRows: Signal<FoundationMessageAvoidRow[]> = computed(() => {
    const content = this.content();
    return content ? foundationMessageAvoidRows(content) : [];
  });
  protected readonly numbers: Signal<FoundationMessageNumberRow[]> = computed(() => {
    const content = this.content();
    return content ? foundationMessageNumberRows(content) : [];
  });
  /**
   * The framework as its print lays it out, in the kit's brand or the LF look; null until the framework exists and the kit read
   * has settled without failing (a print built before that would be the LF default for a project that has a kit).
   */
  protected readonly printView: Signal<FoundationMessagePrintView | null> = computed(() => {
    const approved = this.approvedAsset();
    const read = this.kitRead();
    return approved && read.settled && !read.failed
      ? buildFoundationMessagePrintView(
          approved.content,
          this.projectName(),
          this.approvedVersion(),
          read.kit,
          this.approvedAt(),
          approved.report,
          approved.dateRead ?? null
        )
      : null;
  });
  /** Why Download PDF is disabled: no approved current yet, the kit read still open, or the kit read failed; empty once it can print. */
  protected readonly pdfTooltip = computed(() => {
    if (this.printView()) return '';
    if (!this.approvedAsset()) return this.approvalRequiredNote;
    return this.kitRead().failed ? MKTG_PRINT_KIT_READ_NOTES.failed : MKTG_PRINT_KIT_READ_NOTES.pending;
  });
  protected readonly printOnlyClass = FOUNDATION_MESSAGE_PRINT_ONLY_CLASS;
  /** The report's notes as lines (a check writes one issue per line). */
  protected readonly reportNotes = computed(() =>
    (this.report()?.notes ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  );

  // Literal class names so Tailwind's content scan generates them.
  private readonly tabClasses: Record<'selected' | 'idle', string> = {
    selected: 'border-blue-600 text-blue-700',
    idle: 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
  };

  public constructor() {
    // The print mark never outlives the view (a print dialog still up when the page goes).
    this.destroyRef.onDestroy(() => this.printService.clear());
    toObservable(this.printView)
      .pipe(takeUntilDestroyed())
      .subscribe((view) => {
        if (!view) return;
        if (view.brand.fontUrl) this.printService.ensureFontStylesheet(view.brand.fontUrl);
        void this.printService.prepare(view.brand.fontFamily);
      });
  }

  // === Protected methods ===
  protected async onSelectTab(id: FoundationMessageViewTab): Promise<void> {
    await this.tabState.select(id);
    if (isPlatformBrowser(this.platformId) && !this.destroyRef.destroyed) {
      afterNextRender(
        () => {
          if (this.selectedTab() !== id) return;
          const panel = this.host.nativeElement.querySelector<HTMLElement>('[role="tabpanel"]');
          if (panel) {
            if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
            panel.focus();
          }
        },
        { injector: this.injector }
      );
    }
  }

  /**
   * Keyboard tabs: only the selected tab is in the tab order (roving
   * tabindex), so the arrow keys, Home and End move the selection and the
   * focus along the tablist. Other keys pass through.
   */
  protected onTabKeydown(event: KeyboardEvent): void {
    const tabs = this.tabs();
    const current = tabs.findIndex((tab) => tab.selected);
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    void this.tabState.select(tabs[next].id);
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById(tabs[next].tabId)?.focus();
    }
  }

  /**
   * Prints the framework as one document — the cover, the framework and
   * the key numbers — through the browser's print dialog ("Save as PDF")
   * inside the click; the typeface is prepared ahead. The frame's title names
   * the saved PDF like the deck: the project, the asset, the approved revision
   * and that revision's date.
   */
  protected onDownloadPdf(): void {
    if (!this.printView()) {
      return;
    }
    const label = MKTG_SLIDES_EXPORT_DECK_TITLE_LABELS['foundation-message'];
    this.printService.printNow(
      FOUNDATION_MESSAGE_PRINT_BODY_CLASS,
      mktgPrintDocumentTitle(this.projectName(), label, this.approvedVersion(), this.approvedCreatedAt())
    );
  }

  // === Private initializers ===
  private initTabs(): Signal<MktgFrameworkViewTab[]> {
    return computed(() =>
      FOUNDATION_MESSAGE_VIEW_TABS.map((tab) => {
        const selected = tab.id === this.selectedTab();
        return {
          id: tab.id,
          label: tab.label,
          selected,
          tabClass: this.tabClasses[selected ? 'selected' : 'idle'],
          tabId: `mktg-framework-tab-${tab.id}`,
          panelId: `mktg-framework-panel-${tab.id}`,
        };
      })
    );
  }
}
