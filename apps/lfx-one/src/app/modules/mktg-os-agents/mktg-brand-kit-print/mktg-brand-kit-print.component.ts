// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { BRAND_KIT_ICON_SAMPLES, MKTG_PRINT_BRAND_KIT_ICON_SLOT } from '@lfx-one/shared/constants';
import { BrandKitBookView, MktgPrintBrand, MktgPrintBrandKitOptions, MktgPrintPage, MktgPrintPageLook } from '@lfx-one/shared/interfaces';
import { buildBrandKitPrintPages, mktgBrandKitBookPageCount, mktgPrintBrandKitCover, mktgPrintPageLook } from '@lfx-one/shared/utils';
import { MktgPrintService } from '@services/mktg-print.service';
import { distinctUntilChanged, filter } from 'rxjs';
import { MktgBrandKitIconComponent } from '../components/mktg-brand-kit-icon/mktg-brand-kit-icon.component';
import { MktgPrintBackCoverComponent } from '../components/mktg-print-back-cover/mktg-print-back-cover.component';
import { MktgPrintCoverComponent } from '../components/mktg-print-cover/mktg-print-cover.component';
import { MktgPrintPageSlotDirective } from '../components/mktg-print-page/mktg-print-page-slot.directive';
import { MktgPrintPageComponent } from '../components/mktg-print-page/mktg-print-page.component';

/**
 * The Brand Kit as Download PDF prints it: the deck's pages (marketing-os-agents
 * `agents/slides-export` kit-book.ts), one landscape page per slide, in the
 * deck's order with its headings and numbers — the cover, the contents, the
 * thirteen chapter pages (`buildBrandKitPrintPages`, the shared page plan the
 * Slides export builds from) and the back cover, each on the page shell
 * (`lfx-mktg-print-page`) in the kit's inks and typeface. Inside a larger
 * document (the family PDF) `firstPage` numbers the cover and `backCover`
 * drops the kit's own back cover. The kit's data path is unchanged: the view,
 * the brand and the project name come in as before, and the kit's typeface
 * is loaded through the print service.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-print',
  imports: [MktgBrandKitIconComponent, MktgPrintBackCoverComponent, MktgPrintCoverComponent, MktgPrintPageComponent, MktgPrintPageSlotDirective],
  templateUrl: './mktg-brand-kit-print.component.html',
  styleUrl: './mktg-brand-kit-print.component.scss',
})
export class MktgBrandKitPrintComponent {
  private readonly print = inject(MktgPrintService);

  // === Inputs ===
  public readonly view = input.required<BrandKitBookView>();
  public readonly brand = input.required<MktgPrintBrand>();
  public readonly projectName = input.required<string>();
  /** The family PDF's chapter number for this document; the deck's pages carry none, so it is accepted and not drawn. */
  public readonly number = input('');
  /** The page number of the cover in the document that holds the kit (1 when the kit prints alone). */
  public readonly firstPage = input(1);
  /** Whether the kit's own back cover prints (false inside a document with a back cover of its own). */
  public readonly backCover = input(true);

  // === The pages ===
  protected readonly look = computed<MktgPrintPageLook>(() => mktgPrintPageLook(this.brand()));
  protected readonly cover = computed(() => mktgPrintBrandKitCover(this.view(), this.projectName()));
  /** The builder's options: the cover's number and whether the back cover is in (the contents list its row). */
  private readonly options = computed<MktgPrintBrandKitOptions>(() => ({ firstPage: this.firstPage(), backCover: this.backCover() }));
  protected readonly pages = computed<MktgPrintPage[]>(() => buildBrandKitPrintPages(this.view(), this.brand(), this.projectName(), this.options()));
  protected readonly pageCount = computed(() => mktgBrandKitBookPageCount(this.pages(), this.options().backCover));
  /** The back cover's title: the brand line, else the project name (the deck's back cover). */
  protected readonly backTitle = computed(() => this.view().voice.line || this.projectName());
  protected readonly icons = BRAND_KIT_ICON_SAMPLES;
  protected readonly iconSlot = MKTG_PRINT_BRAND_KIT_ICON_SLOT;

  public constructor() {
    toObservable(computed(() => this.view().fontUrl))
      .pipe(
        filter((url): url is string => !!url),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((url) => this.print.ensureFontStylesheet(url));
  }
}
