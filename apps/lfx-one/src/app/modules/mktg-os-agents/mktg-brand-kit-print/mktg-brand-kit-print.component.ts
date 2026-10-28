// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { BrandKitBookView, MktgPrintBrand } from '@lfx-one/shared/interfaces';
import { MktgPrintService } from '@services/mktg-print.service';
import { distinctUntilChanged, filter } from 'rxjs';
import { MktgPrintRunningHeadComponent } from '../components/mktg-print-running-head/mktg-print-running-head.component';

/** Native portrait text, shared by family and standalone PDFs; never a scaled book plate. */
@Component({
  selector: 'lfx-mktg-brand-kit-print',
  imports: [NgTemplateOutlet, MktgPrintRunningHeadComponent],
  templateUrl: './mktg-brand-kit-print.component.html',
  styleUrls: ['../mktg-framework-print/mktg-framework-print.component.scss', './mktg-brand-kit-print.component.scss'],
})
export class MktgBrandKitPrintComponent {
  private readonly print = inject(MktgPrintService);

  public readonly view = input.required<BrandKitBookView>();
  public readonly brand = input.required<MktgPrintBrand>();
  public readonly number = input('02');
  protected readonly head = computed(() => `${this.number()} Brand kit · ${this.view().projectName}`);
  protected readonly specimens = this.initSpecimens();

  public constructor() {
    toObservable(computed(() => this.view().fontUrl))
      .pipe(
        filter((url): url is string => !!url),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((url) => this.print.ensureFontStylesheet(url));
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
