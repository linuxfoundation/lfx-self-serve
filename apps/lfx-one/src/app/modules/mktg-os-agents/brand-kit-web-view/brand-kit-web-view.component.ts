// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { BRAND_KIT_MODE_LABELS, BRAND_KIT_PRINT_BODY_CLASS, BRAND_KIT_PRINT_ONLY_CLASS, BRAND_KIT_WEB_VIEW_TABS } from '@lfx-one/shared/constants';
import { BrandKitBookView, BrandKitChapterSummary, BrandKitRevision, BrandKitWebViewTab, BrandKitWebViewTabId } from '@lfx-one/shared/interfaces';
import { brandKitChapterSummaries, buildBrandKitBookView } from '@lfx-one/shared/utils';

import { BrandKitViewComponent } from '../brand-kit-view/brand-kit-view.component';

// The Brand Kit on screen, as an app page in the Messaging Framework view's
// look (hand test, 18 Oct: "more like a website — a proper app — not a
// slideshow"): the header with the title, the version and the actions, a tab
// bar, and white cards. Tabs: the overview (what the kit is built from and
// the six chapters in brief), then Logo, Color, Type, Visual, Usage and Voice
// from the kit's own chapters, then the run's sources and gaps. The brand's
// colours, typeface and logo grounds are used inside the samples only; the
// chrome stays LFX One's. The 16-page book (lfx-brand-kit-view) is the kit's
// print rendering: it sits here in a print-only wrapper, never shown on
// screen, and Download PDF prints it. Export to Google Slides — the slideshow
// — is a later item and shows disabled. Purely presentational: the run page
// and the Documents area feed it.
@Component({
  selector: 'lfx-brand-kit-web-view',
  imports: [NgClass, NgTemplateOutlet, ButtonComponent, BrandKitViewComponent],
  templateUrl: './brand-kit-web-view.component.html',
})
export class BrandKitWebViewComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  /** The kit to show. */
  public readonly kit = input.required<BrandKitRevision>();
  /** The revision or run version shown in the header; the kit's own version when not given. */
  public readonly version = input<number | null>(null);
  /** A note beside the version — the revision's standing in Documents ("latest"), or nothing. */
  public readonly note = input('');

  // === Signals ===
  protected readonly selectedTab = signal<BrandKitWebViewTabId>('overview');

  // === Computed ===
  /** Every value the samples bind — built once here and handed to the printed book, which lays out the same view model. */
  protected readonly view: Signal<BrandKitBookView> = computed(() => buildBrandKitBookView(this.kit(), this.versionNumber()));
  protected readonly chapters: Signal<BrandKitChapterSummary[]> = computed(() => brandKitChapterSummaries(this.kit()));
  protected readonly title = computed(() => `${this.kit().projectName} Brand Kit`);
  protected readonly versionNumber = computed(() => this.version() ?? this.kit().version);
  protected readonly modeLabel = computed(() => BRAND_KIT_MODE_LABELS[this.kit().mode] ?? '');
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
  protected readonly printOnlyClass = BRAND_KIT_PRINT_ONLY_CLASS;

  // Literal class names so Tailwind's content scan generates them (the framework view's tab classes).
  private readonly tabClasses: Record<'selected' | 'idle', string> = {
    selected: 'border-blue-600 text-blue-700',
    idle: 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
  };

  public constructor() {
    // The print mark never outlives the view (a print dialog still up when the page goes).
    this.destroyRef.onDestroy(() => this.document.body.classList.remove(BRAND_KIT_PRINT_BODY_CLASS));
  }

  // === Protected methods ===
  protected onSelectTab(id: BrandKitWebViewTabId): void {
    this.selectedTab.set(id);
  }

  /**
   * A shortcut into a tab from outside the tablist (the Overview's "Open …"
   * buttons, the header's sources link): the button that was clicked goes
   * with the panel it sat in, so focus moves onto the selected tab once it
   * has rendered, as on the framework view.
   */
  protected onGoToTab(id: BrandKitWebViewTabId): void {
    this.selectedTab.set(id);
    if (isPlatformBrowser(this.platformId)) {
      const tab = this.tabs().find((entry) => entry.id === id);
      if (tab) {
        setTimeout(() => this.document.getElementById(tab.tabId)?.focus());
      }
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
    this.selectedTab.set(tabs[next].id);
    if (isPlatformBrowser(this.platformId)) {
      this.document.getElementById(tabs[next].tabId)?.focus();
    }
  }

  /** Prints the book: 16 letter pages, landscape, through the browser's print dialog ("Save as PDF"). */
  protected onDownloadPdf(): void {
    // SSR guard: window/document are browser-only (ssr-safety rule).
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const body = this.document.body;
    body.classList.add(BRAND_KIT_PRINT_BODY_CLASS);
    // The class stays for as long as the dialog is up (the preview renders from it) and goes with the print's end.
    window.addEventListener('afterprint', () => body.classList.remove(BRAND_KIT_PRINT_BODY_CLASS), { once: true });
    window.print();
  }

  // === Private initializers ===
  private initTabs(): Signal<BrandKitWebViewTab[]> {
    return computed(() =>
      BRAND_KIT_WEB_VIEW_TABS.map((tab) => {
        const selected = tab.id === this.selectedTab();
        return {
          id: tab.id,
          label: tab.label,
          selected,
          tabClass: this.tabClasses[selected ? 'selected' : 'idle'],
          tabId: `brand-kit-web-view-tab-${tab.id}`,
          panelId: `brand-kit-web-view-panel-${tab.id}`,
        };
      })
    );
  }
}
