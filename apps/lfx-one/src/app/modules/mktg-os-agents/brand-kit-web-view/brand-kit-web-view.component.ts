// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  PLATFORM_ID,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MessageComponent } from '@components/message/message.component';
import { MktgAssetMetaComponent } from '../components/mktg-asset-meta/mktg-asset-meta.component';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonComponent } from '@components/button/button.component';
import {
  BRAND_KIT_MODE_LABELS,
  BRAND_KIT_PRINT_BODY_CLASS,
  BRAND_KIT_PRINT_ONLY_CLASS,
  BRAND_KIT_WEB_VIEW_TABS,
  FOUNDATION_MESSAGE_PRINT_ONLY_CLASS,
  MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE,
} from '@lfx-one/shared/constants';
import {
  BrandKitBookView,
  BrandKitChapterSummary,
  BrandKitRevision,
  BrandKitWebViewTab,
  BrandKitWebViewTabId,
  MktgSlidesExportTarget,
  MktgRevisionApproval,
  MktgAssetHeaderMetadata,
} from '@lfx-one/shared/interfaces';
import { brandKitChapterSummaries, buildBrandKitBookView, mktgAssetHeaderFallback, mktgPrintBrand } from '@lfx-one/shared/utils';
import { MktgPrintService } from '@services/mktg-print.service';
import { ProjectContextService } from '@services/project-context.service';

import { createMktgAssetTab } from '../utils/mktg-asset-tab.util';
import { MktgBrandKitPrintComponent } from '../mktg-brand-kit-print/mktg-brand-kit-print.component';
import { MktgSlidesExportComponent } from '../mktg-slides-export/mktg-slides-export.component';
import { MktgFieldCommentsComponent } from '../components/mktg-field-comments/mktg-field-comments.component';

// The Brand Kit on screen, as an app page in the Messaging Framework view's
// look (hand test, 18 Oct: "more like a website — a proper app — not a
// slideshow"): the header with the title, the version and the actions, a tab
// bar, and white cards. Tabs: the overview (what the kit is built from and
// the six chapters in brief), then Logo, Color, Type, Visual, Usage and Voice
// from the kit's own chapters, then the run's sources and gaps. The brand's
// colours, typeface and logo grounds are used inside the samples only; the
// chrome stays LFX One's. The native portrait kit print is mounted in a
// print-only wrapper, never shown on screen, and Download PDF prints it. Export to Google Slides builds the kit
// as a deck from the stored revision the page names, in the kit's colours,
// typeface and logo (lfx-mktg-slides-export, the panel under the header).
// Purely presentational: the run page and the Documents area feed it the kit
// and the revision to export.
@Component({
  selector: 'lfx-brand-kit-web-view',
  imports: [
    TooltipModule,
    NgClass,
    NgTemplateOutlet,
    MktgAssetMetaComponent,
    MessageComponent,
    ButtonComponent,
    MktgBrandKitPrintComponent,
    MktgSlidesExportComponent,
    MktgFieldCommentsComponent,
  ],
  templateUrl: './brand-kit-web-view.component.html',
})
export class BrandKitWebViewComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly printService = inject(MktgPrintService);
  private readonly projectContext = inject(ProjectContextService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // === Inputs ===
  /** The kit to show. */
  public readonly kit = input.required<BrandKitRevision>();
  /** The revision or run version shown in the header; the kit's own version when not given. */
  public readonly version = input<number | null>(null);
  public readonly headerMetadata = input<MktgAssetHeaderMetadata | null>(null);
  public readonly showMetadata = input(true);
  public readonly titleActions = viewChild<TemplateRef<unknown>>('titleActions');
  /** Only the selected stored document hosts comments; run previews and printed chapters remain read-only. */
  public readonly commentsEnabled = input(false);
  public readonly approval = input<MktgRevisionApproval | null>(null);
  /** The stored revision Export to Google Slides reads; null while there is none (the button shows disabled). */
  public readonly exportTarget = input<MktgSlidesExportTarget | null>(null);
  /** The viewed document for last-export lookup, independent of approved export bytes. */
  public readonly exportLookupTarget = input<MktgSlidesExportTarget | null>(null);
  public readonly viewingDraft = input(false);
  public readonly approvedKit = input<BrandKitRevision | null>(null);
  public readonly approvedVersion = input<number | null>(null);
  public readonly approvedLoading = input(false);
  public readonly approvedError = input('');

  // === Signals ===
  private readonly tabState = createMktgAssetTab(
    BRAND_KIT_WEB_VIEW_TABS.map((tab) => tab.id),
    'overview'
  );
  protected readonly selectedTab = this.tabState.selected;

  // === Computed ===
  /** Existing screen sample model, also used as data by the native portrait print. */
  protected readonly view: Signal<BrandKitBookView> = computed(() => buildBrandKitBookView(this.kit(), this.versionNumber()));
  protected readonly chapters: Signal<BrandKitChapterSummary[]> = computed(() => brandKitChapterSummaries(this.kit()));
  protected readonly title = computed(() => `${this.kit().projectName} Brand Kit`);
  protected readonly header = computed(
    () => this.headerMetadata() ?? mktgAssetHeaderFallback('brand-kit', this.versionNumber(), this.kit().generatedAt, this.approval())
  );
  protected readonly approvalRequiredNote = MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE;
  protected readonly printView = computed(() => {
    const kit = this.approvedKit();
    return kit ? buildBrandKitBookView(kit, this.approvedVersion() ?? kit.version) : null;
  });
  protected readonly printBrand = computed(() => mktgPrintBrand(this.approvedKit()));
  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name ?? 'Project');
  /** Why Download PDF is disabled (no approved current yet); empty once it can print. */
  protected readonly pdfTooltip = computed(() => (this.printView() ? '' : this.approvalRequiredNote));
  protected readonly versionNumber = computed(() => this.version() ?? this.kit().version);
  protected readonly modeLabel = computed(() => (this.kit().mode === 'draft' ? '' : BRAND_KIT_MODE_LABELS[this.kit().mode]));
  /** What the reviewer should look at: the gaps and the sources that could not be read. */
  protected readonly gapCount = computed(() => this.kit().report.gaps.length + this.kit().report.sources_failed.length);
  /** The report's notes as lines. */
  protected readonly reportNotes = computed(() =>
    this.kit()
      .report.notes.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  );
  /** The proportion bar's accessible name: every colour and its share, since the segments themselves are paint. */
  protected readonly proportionLabel = computed(
    () =>
      'How much of a surface each color takes: ' +
      this.view()
        .proportion.map((row) => `${row.name} ${row.share}%`)
        .join(', ')
  );
  protected readonly tabs: Signal<BrandKitWebViewTab[]> = this.initTabs();
  /**
   * The kit's typeface as Download PDF waits for it, read from the book's own
   * view model so the wait names exactly the family and weights the book
   * loads from Google Fonts; null when it is not there.
   */
  private readonly printFont = computed(() => {
    const view = this.printView();
    return view?.fontUrl ? { family: view.type.family.trim(), weights: view.weights.map((entry) => entry.weight) } : null;
  });
  protected readonly printOnlyClass = `${BRAND_KIT_PRINT_ONLY_CLASS} ${FOUNDATION_MESSAGE_PRINT_ONLY_CLASS}`;

  // Literal class names so Tailwind's content scan generates them (the framework view's tab classes).
  private readonly tabClasses: Record<'selected' | 'idle', string> = {
    selected: 'border-blue-600 text-blue-700',
    idle: 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
  };

  public constructor() {
    // The print mark never outlives the view (a print dialog still up when
    // the page goes), and a print still waiting for its font is cancelled.
    this.destroyRef.onDestroy(() => this.printService.clear(BRAND_KIT_PRINT_BODY_CLASS));
    toObservable(this.printFont)
      .pipe(takeUntilDestroyed())
      .subscribe((font) => {
        const url = this.printView()?.fontUrl;
        if (url) this.printService.ensureFontStylesheet(url);
        void this.printService.prepare(font?.family ?? null, font?.weights);
      });
  }

  // === Protected methods ===
  protected async onSelectTab(id: BrandKitWebViewTabId): Promise<void> {
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
   * Keyboard tabs, as on the framework view: only the selected tab is in the
   * tab order (roving tabindex), so the arrow keys, Home and End move the
   * selection and the focus along the tablist. Other keys pass through.
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
      this.document.getElementById(tabs[next].tabId)?.focus();
    }
  }

  /**
   * Prints the native portrait chapters inside the click, with the approved
   * kit's typeface prepared ahead. The service guards SSR.
   */
  protected onDownloadPdf(): void {
    if (!this.printView()) return;
    this.printService.printNow(BRAND_KIT_PRINT_BODY_CLASS);
  }

  // === Private initializers ===
  private initTabs(): Signal<BrandKitWebViewTab[]> {
    return computed(() =>
      BRAND_KIT_WEB_VIEW_TABS.map((tab) => {
        const selected = tab.id === this.selectedTab();
        return {
          id: tab.id,
          label: tab.id === 'sources' && this.gapCount() > 0 ? `${tab.label} (${this.gapCount()})` : tab.label,
          selected,
          tabClass: this.tabClasses[selected ? 'selected' : 'idle'],
          tabId: `brand-kit-web-view-tab-${tab.id}`,
          panelId: `brand-kit-web-view-panel-${tab.id}`,
        };
      })
    );
  }
}
