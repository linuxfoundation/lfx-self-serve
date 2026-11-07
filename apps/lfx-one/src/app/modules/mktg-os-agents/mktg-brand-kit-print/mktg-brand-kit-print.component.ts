// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { BRAND_KIT_PORTRAIT_COVER_PURPOSE, BRAND_KIT_PORTRAIT_COVER_TITLE } from '@lfx-one/shared/constants';
import { BrandKitBookView, MktgPortraitBook, MktgPortraitPlacedPage, MktgPrintBrand, MktgRevisionApproval } from '@lfx-one/shared/interfaces';
import { MktgPrintService } from '@services/mktg-print.service';
import { brandKitPortraitPlan, mktgPortraitDocumentName, mktgPortraitFootLeft, mktgPortraitLook, mktgPortraitPlacePlan } from '@lfx-one/shared/utils';
import { distinctUntilChanged, filter } from 'rxjs';
import { MktgPortraitBackCoverComponent } from '../components/mktg-portrait/mktg-portrait-back-cover/mktg-portrait-back-cover.component';
import { MktgPortraitCoverComponent } from '../components/mktg-portrait/mktg-portrait-cover/mktg-portrait-cover.component';
import { MktgBrandKitPageColorContrastComponent } from './pages/mktg-brand-kit-page-color-contrast.component';
import { MktgBrandKitPageColorPaletteComponent } from './pages/mktg-brand-kit-page-color-palette.component';
import { MktgBrandKitPageContentsComponent } from './pages/mktg-brand-kit-page-contents.component';
import { MktgBrandKitPageLogoClearSpaceComponent } from './pages/mktg-brand-kit-page-logo-clear-space.component';
import { MktgBrandKitPageLogoColorwaysComponent } from './pages/mktg-brand-kit-page-logo-colorways.component';
import { MktgBrandKitPageLogoPartnershipComponent } from './pages/mktg-brand-kit-page-logo-partnership.component';
import { MktgBrandKitPageLogoSymbolComponent } from './pages/mktg-brand-kit-page-logo-symbol.component';
import { MktgBrandKitPageLogoSystemComponent } from './pages/mktg-brand-kit-page-logo-system.component';
import { MktgBrandKitPageLogoWatchoutsComponent } from './pages/mktg-brand-kit-page-logo-watchouts.component';
import { MktgBrandKitPageSourcesComponent } from './pages/mktg-brand-kit-page-sources.component';
import { MktgBrandKitPageTypeComponent } from './pages/mktg-brand-kit-page-type.component';
import { MktgBrandKitPageUsageComponent } from './pages/mktg-brand-kit-page-usage.component';
import { MktgBrandKitPageVisualIconographyComponent } from './pages/mktg-brand-kit-page-visual-iconography.component';
import { MktgBrandKitPageVisualImageryComponent } from './pages/mktg-brand-kit-page-visual-imagery.component';
import { MktgBrandKitPageVoiceComponent } from './pages/mktg-brand-kit-page-voice.component';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../components/mktg-portrait/mktg-portrait-host';

/**
 * The kit's portrait book, one fixed US Letter frame per page on the portrait
 * print grammar (`lfx-mktg-portrait-*`), shared by the standalone Download
 * PDF and the family export; never a scaled book plate. The pages come
 * from the kit's plan (`brandKitPortraitPlan`), each drawn by its own page
 * component from the live view.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-print',
  imports: [
    MktgPortraitCoverComponent,
    MktgPortraitBackCoverComponent,
    MktgBrandKitPageContentsComponent,
    MktgBrandKitPageLogoSystemComponent,
    MktgBrandKitPageLogoColorwaysComponent,
    MktgBrandKitPageLogoClearSpaceComponent,
    MktgBrandKitPageLogoSymbolComponent,
    MktgBrandKitPageLogoPartnershipComponent,
    MktgBrandKitPageLogoWatchoutsComponent,
    MktgBrandKitPageColorPaletteComponent,
    MktgBrandKitPageColorContrastComponent,
    MktgBrandKitPageTypeComponent,
    MktgBrandKitPageVisualIconographyComponent,
    MktgBrandKitPageVisualImageryComponent,
    MktgBrandKitPageUsageComponent,
    MktgBrandKitPageVoiceComponent,
    MktgBrandKitPageSourcesComponent,
  ],
  templateUrl: './mktg-brand-kit-print.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPrintComponent {
  private readonly print = inject(MktgPrintService);

  public readonly view = input.required<BrandKitBookView>();
  public readonly brand = input.required<MktgPrintBrand>();
  /** Project context, never the name embedded in kit content. */
  public readonly projectName = input.required<string>();
  /** Only the family exporter supplies the document prefix. */
  public readonly number = input('');
  /**
   * The book the pages are set in: `null` standalone (the kit derives its
   * document name and footer, numbers from 1, the band on, its own cover,
   * contents and back cover); the family's book inside the family export.
   * Until the family exporter passes its book, its `number` (which only it
   * supplies) stands for one: inside the family, the family's document
   * name, numbered from 1.
   */
  public readonly book = input<MktgPortraitBook | null>(null);
  /** The printed revision's approval (date, approver), for the contents page; null leaves its line out. */
  public readonly approval = input<MktgRevisionApproval | null>(null);
  /** The document's look: the kit's dark, accent and spark, the ink on the accent by the shared rule, the typeface. */
  protected readonly look = computed(() => mktgPortraitLook(this.brand(), this.view().spark));
  protected readonly resolvedBook: Signal<MktgPortraitBook> = this.initResolvedBook();
  /** The pages, in the mock's order, each with its book page number, printed section label and band. */
  protected readonly pages: Signal<MktgPortraitPlacedPage[]> = this.initPages();
  protected readonly coverTitle = BRAND_KIT_PORTRAIT_COVER_TITLE;
  /** The brand line as a sentence, then the cover's purpose. */
  protected readonly coverLede = computed(() => {
    const line = this.view().voice.line.trim().replace(/\.?$/, '.');
    return line === '.' ? BRAND_KIT_PORTRAIT_COVER_PURPOSE : `${line} ${BRAND_KIT_PORTRAIT_COVER_PURPOSE}`;
  });
  /** `V4.0 · November 2026`, less any part the kit lacks: the back cover's line. */
  protected readonly versionLine = computed(() => [this.view().versionLabel, this.view().monthYear].filter((part) => part !== '').join(' · '));
  /** `aaif.io · V4.0 · November 2026`, less any part the kit lacks: the cover's strip. */
  protected readonly coverStripRight = computed(() => [this.view().host, this.versionLine()].filter((part) => part !== '').join(' · '));
  public constructor() {
    toObservable(computed(() => this.view().fontUrl))
      .pipe(
        filter((url): url is string => !!url),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((url) => this.print.ensureFontStylesheet(url));
  }

  /**
   * The book the pages are in: the family's when it passes one; else derived here (standalone, or the family's legacy
   * `number` input without a book: in family, numbered from 1 until the family lane passes its book with the kit's
   * first page).
   */
  private initResolvedBook() {
    return computed((): MktgPortraitBook => {
      const book = this.book();
      if (book) return book;
      const inFamily = this.number() !== '';
      return {
        inFamily,
        headRight: mktgPortraitDocumentName(this.projectName(), inFamily ? 'positioning & brand' : 'brand kit'),
        footLeft: mktgPortraitFootLeft(this.projectName()),
        firstPage: 1,
      };
    });
  }

  private initPages() {
    return computed(() => {
      const book = this.resolvedBook();
      return mktgPortraitPlacePlan(brandKitPortraitPlan(this.view(), { inFamily: book.inFamily }), book);
    });
  }
}
