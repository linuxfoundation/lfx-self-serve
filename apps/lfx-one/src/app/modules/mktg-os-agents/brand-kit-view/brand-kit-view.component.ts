// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { BRAND_KIT_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { BrandKitBookView, BrandKitRevision } from '@lfx-one/shared/interfaces';
import { buildBrandKitBookView } from '@lfx-one/shared/utils';
import { distinctUntilChanged, filter } from 'rxjs';

// The Brand Kit of one revision, laid out as the reference kit's 16 letter
// pages, landscape: cover and back cover on the dark grid, the contents, then
// 01 Logo (the lockups from the real files, the colorways, clear space and
// minimum sizes, the symbol, the partnership lockup, the watchouts), 02 Color
// (the palette with every value's source, the proportion, the WCAG contrast
// table), 03 Type (the typeface from Google Fonts, the weights, the scale),
// 04 Visual (icons, imagery, the graphic elements), 05 Usage (keynote slide,
// social card, report cover, announcement header) and 06 Voice in brief.
// Download PDF prints the book from the page (the browser's print; the
// global print rules show the book alone). Export to Google Slides is a
// later item and shows disabled. Every value comes from the kit: the colours
// and the typeface are the project's, never the app's.
@Component({
  selector: 'lfx-brand-kit-view',
  imports: [NgClass, NgTemplateOutlet, ButtonComponent],
  templateUrl: './brand-kit-view.component.html',
  styleUrl: './brand-kit-view.component.scss',
})
export class BrandKitViewComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  /** The kit to lay out. */
  public readonly kit = input.required<BrandKitRevision>();
  /** Whether the toolbar (Download PDF, Export to Google Slides, the report) shows above the book. */
  public readonly toolbar = input(true);

  // === Signals ===
  /** Whether the agent's report (sources read, sources that failed, gaps, notes) is open. */
  protected readonly reportOpen = signal(false);

  // === Computed ===
  protected readonly view: Signal<BrandKitBookView> = computed(() => buildBrandKitBookView(this.kit()));
  protected readonly gapCount = computed(() => this.view().report.gaps.length + this.view().report.sources_failed.length);
  /** The proportion bar's accessible name: every colour and its share, since the segments themselves are paint. */
  protected readonly proportionLabel = computed(
    () =>
      'How much of a surface each color takes: ' +
      this.view()
        .proportion.map((row) => `${row.name} ${row.share}%`)
        .join(', ')
  );
  /** The Google Fonts stylesheet of the kit's typeface, when the kit says it is there (null otherwise). */
  private readonly fontUrl$ = toObservable(computed(() => this.view().fontUrl));

  public constructor() {
    // The typeface comes from Google Fonts, loaded once per family in the
    // browser; SSR renders the fallback and never touches the head.
    if (isPlatformBrowser(this.platformId)) {
      this.fontUrl$
        .pipe(
          filter((url): url is string => !!url),
          distinctUntilChanged(),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((url) => this.ensureFontLink(url));
    }
    this.destroyRef.onDestroy(() => this.document.body.classList.remove(BRAND_KIT_PRINT_BODY_CLASS));
  }

  // === Protected methods ===
  /** Prints the book: 16 letter pages, landscape, through the browser's print dialog. */
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

  protected onToggleReport(): void {
    this.reportOpen.update((open) => !open);
  }

  // === Private helpers ===
  private ensureFontLink(url: string): void {
    const id = `brand-kit-font-${encodeURIComponent(url)}`;
    if (this.document.getElementById(id)) {
      return;
    }
    const link = this.document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = url;
    this.document.head.appendChild(link);
  }
}
