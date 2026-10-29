// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { BrandKitBookView, MktgPrintBrand } from '@lfx-one/shared/interfaces';
import { MktgPrintService } from '@services/mktg-print.service';
import { brandKitIsLight, brandKitLabelInk } from '@lfx-one/shared/utils';
import { distinctUntilChanged, filter } from 'rxjs';
import { MktgPrintRunningHeadComponent } from '../components/mktg-print-running-head/mktg-print-running-head.component';
import { MktgPrintChapterHeaderComponent } from '../components/mktg-print-chapter-header/mktg-print-chapter-header.component';

/** Native portrait text, shared by family and standalone PDFs; never a scaled book plate. */
@Component({
  selector: 'lfx-mktg-brand-kit-print',
  imports: [NgTemplateOutlet, MktgPrintRunningHeadComponent, MktgPrintChapterHeaderComponent],
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
  protected readonly head = computed(() => `${this.projectName()} Brand kit`);
  protected readonly typeNote = computed(() => {
    const { summary, note } = this.view().type;
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    return normalize(note) === normalize(summary) ? '' : note;
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

  public constructor() {
    toObservable(computed(() => this.view().fontUrl))
      .pipe(
        filter((url): url is string => !!url),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((url) => this.print.ensureFontStylesheet(url));
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
        return {
          ...tile,
          ground,
          ink: hex ? brandKitLabelInk(ground, brand.ink) : brand.ink,
          logo: light ? brand.logoOnLight : brand.logoOnDark,
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
