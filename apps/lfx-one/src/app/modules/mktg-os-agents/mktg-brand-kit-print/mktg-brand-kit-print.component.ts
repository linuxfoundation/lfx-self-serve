// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { BRAND_KIT_PORTRAIT_COVER_PURPOSE, BRAND_KIT_PORTRAIT_COVER_TITLE } from '@lfx-one/shared/constants';
import { BrandKitBookView, MktgPortraitBook, MktgPortraitPlacedPage, MktgPrintBrand, MktgRevisionApproval } from '@lfx-one/shared/interfaces';
import { MktgPrintService } from '@services/mktg-print.service';
import {
  brandKitInkOnAccent,
  brandKitIsLight,
  brandKitLabelInk,
  brandKitPortraitPlan,
  mktgPortraitDocumentName,
  mktgPortraitFootLeft,
  mktgPortraitLook,
  mktgPortraitPlacePlan,
} from '@lfx-one/shared/utils';
import { distinctUntilChanged, filter } from 'rxjs';
import { MktgPrintRunningHeadComponent } from '../components/mktg-print-running-head/mktg-print-running-head.component';
import { MktgPrintChapterHeaderComponent } from '../components/mktg-print-chapter-header/mktg-print-chapter-header.component';
import { MktgBrandKitIconSamplesComponent } from '../components/mktg-brand-kit-icon-samples/mktg-brand-kit-icon-samples.component';
import { MktgPortraitCoverComponent } from '../components/mktg-portrait/mktg-portrait-cover/mktg-portrait-cover.component';
import { MktgBrandKitPageColorPaletteComponent } from './pages/mktg-brand-kit-page-color-palette.component';
import { MktgBrandKitPageContentsComponent } from './pages/mktg-brand-kit-page-contents.component';
import { MktgBrandKitPageLogoClearSpaceComponent } from './pages/mktg-brand-kit-page-logo-clear-space.component';
import { MktgBrandKitPageLogoColorwaysComponent } from './pages/mktg-brand-kit-page-logo-colorways.component';
import { MktgBrandKitPageLogoPartnershipComponent } from './pages/mktg-brand-kit-page-logo-partnership.component';
import { MktgBrandKitPageLogoSymbolComponent } from './pages/mktg-brand-kit-page-logo-symbol.component';
import { MktgBrandKitPageLogoSystemComponent } from './pages/mktg-brand-kit-page-logo-system.component';
import { MktgBrandKitPageLogoWatchoutsComponent } from './pages/mktg-brand-kit-page-logo-watchouts.component';

/**
 * The kit's portrait book, one fixed US Letter frame per page on the portrait
 * print grammar (`lfx-mktg-portrait-*`), shared by the standalone Download
 * PDF and the family export; never a scaled book plate. The pages come
 * from the kit's plan (`brandKitPortraitPlan`), each drawn by its own page
 * component from the live view; the chapters not yet on the grammar follow
 * as the earlier flowing pages until each is a frame.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-print',
  imports: [
    NgTemplateOutlet,
    MktgPrintRunningHeadComponent,
    MktgPrintChapterHeaderComponent,
    MktgBrandKitIconSamplesComponent,
    MktgPortraitCoverComponent,
    MktgBrandKitPageContentsComponent,
    MktgBrandKitPageLogoSystemComponent,
    MktgBrandKitPageLogoColorwaysComponent,
    MktgBrandKitPageLogoClearSpaceComponent,
    MktgBrandKitPageLogoSymbolComponent,
    MktgBrandKitPageLogoPartnershipComponent,
    MktgBrandKitPageLogoWatchoutsComponent,
    MktgBrandKitPageColorPaletteComponent,
  ],
  templateUrl: './mktg-brand-kit-print.component.html',
  styleUrls: ['../mktg-framework-print/mktg-framework-print.component.scss', './mktg-brand-kit-print.component.scss'],
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
  protected readonly head = computed(() => `${this.projectName()} Brand kit`);
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
  /** `aaif.io · V4.0 · November 2026`, less any part the kit lacks. */
  protected readonly coverStripRight = computed(() =>
    [this.view().host, this.view().versionLabel, this.view().monthYear].filter((part) => part !== '').join(' · ')
  );
  protected readonly typeNote = computed(() => {
    const { summary, note } = this.view().type;
    const normalize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    const intro = normalize(summary);
    const detail = normalize(note);
    // Minor editorial differences or a trailing fragment are not a second description.
    const duplicate =
      intro &&
      detail &&
      (intro.includes(detail) || detail.includes(intro) || (intro.length >= 80 && detail.length >= 80 && intro.slice(0, 80) === detail.slice(0, 80)));
    return duplicate ? '' : note;
  });
  protected readonly typeSource = computed(() => {
    const source = this.view().type.source.trim();
    const url = source.match(/https?:\/\/[^\s<>"')]+/i)?.[0];
    if (!url) return source;
    try {
      return `${new URL(url).hostname} site CSS`;
    } catch {
      return 'Site CSS';
    }
  });
  protected readonly specimens = this.initSpecimens();
  protected readonly colourways = this.initColourways();
  protected readonly usageRows = this.initUsageRows();
  protected readonly contrastGroups = this.initContrastGroups();

  public constructor() {
    toObservable(computed(() => this.view().fontUrl))
      .pipe(
        filter((url): url is string => !!url),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((url) => this.print.ensureFontStylesheet(url));
  }

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

  private initContrastGroups() {
    return computed(() => {
      const rows = this.view().contrast;
      if (rows.length <= 12) return [rows];
      // Each fragment has at least three rows; absorb a one/two-row remainder.
      const groups = [];
      for (let index = 0; index < rows.length; ) {
        const size = rows.length - index <= 5 ? rows.length - index : 3;
        groups.push(rows.slice(index, index + size));
        index += size;
      }
      return groups;
    });
  }

  private initColourways() {
    return computed(() =>
      this.view()
        .colorways.map((row, index) => ({
          ...row,
          groundLabel: this.view().logo.colorways[index]?.ground ?? row.ground,
          logoLabel: this.view().logo.colorways[index]?.logo ?? '',
        }))
        .filter((row) => !!row.logo?.src)
    );
  }

  private initUsageRows() {
    return computed(() => {
      const view = this.view();
      const brand = this.brand();
      const samples = view.usageTiles.map((tile, index) => {
        const example = view.usage.examples[index];
        const label = example?.ground.trim().toLowerCase() ?? '';
        let ground = view.palette.find((entry) => entry.name.toLowerCase() === label || entry.hex.toLowerCase() === label)?.hex;
        if (/^#[0-9a-f]{6}$/i.test(label)) ground = label;
        if (label === 'accent') ground = brand.accent;
        if (label === 'tint') ground = brand.tint;
        if (label === 'white' || label === 'light') ground = 'white';
        ground ??= tile.dark ? brand.dark : 'white';
        const hex = /^#[0-9a-f]{6}$/i.test(ground);
        const light = ground === 'white' || ground === brand.tint || (hex && brandKitIsLight(ground));
        // On the accent, the renderer's rule (one shared helper, the contrast table's functions): white ink and the
        // reversed logo only when white reaches AA there, else the kit's dark and the full-colour lockup. A kit whose
        // accent is its dark keeps its dark samples.
        const onAccent = hex && ground.toLowerCase() === brand.accent.toLowerCase() && ground.toLowerCase() !== brand.dark.toLowerCase();
        let ink = hex ? brandKitLabelInk(ground, brand.ink) : brand.ink;
        let logo = light ? brand.logoOnLight : brand.logoOnDark;
        if (onAccent) {
          ink = brandKitInkOnAccent(ground, brand.dark);
          logo = ink === 'white' ? brand.logoOnDark : brand.logoOnLight;
        }
        return {
          ...tile,
          ground,
          ink,
          logo,
          name: example?.name ?? tile.caption,
          format: example?.format ?? '',
        };
      });
      return samples.filter((_, index) => index % 2 === 0).map((_, index) => samples.slice(index * 2, index * 2 + 2));
    });
  }

  private initSpecimens() {
    return computed(() =>
      this.view().type.scale.map((step) => ({
        ...step,
        // Preserve source metrics in the caption, but fit the specimen to a portrait text column.
        printSize: `${Math.min(step.size * 0.75, 32)}pt`,
        printLeading: Math.max(step.line_height / step.size, 1.1),
        transform: step.caps ? 'uppercase' : 'none',
      }))
    );
  }
}
