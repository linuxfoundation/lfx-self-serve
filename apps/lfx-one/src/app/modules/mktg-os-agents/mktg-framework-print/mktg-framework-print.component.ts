// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FoundationMessagePrintView } from '@lfx-one/shared/interfaces';
import { MktgPrintService } from '@services/mktg-print.service';
import { distinctUntilChanged, filter } from 'rxjs';
import { MktgPrintRunningHeadComponent } from '../components/mktg-print-running-head/mktg-print-running-head.component';
import { MktgPrintChapterHeaderComponent } from '../components/mktg-print-chapter-header/mktg-print-chapter-header.component';

// The Messaging Framework's PRINT rendering (Download PDF): the framework
// view's tabs as one document on portrait pages of the paper the print
// dialog has (A4 or US Letter) — a cover, then the framework (the
// statements, the goal columns, say and avoid, the anchor questions) and the
// key numbers. ICPs and the message house stay hidden. The run's
// sources and gaps, and the reviewer's note, stay on screen. Set in the
// project's brand when it has a Brand Kit (its colours, typeface and logo),
// in the LF look otherwise. On screen the framework is its app page
// (lfx-mktg-framework-view), which holds this document in a print-only
// wrapper and prints it with Download PDF (the browser's print; the global
// print rules in styles.scss show it alone). The layout grew from the brand
// kit book's sheet and the one pager's letter page.
@Component({
  selector: 'lfx-mktg-framework-print',
  imports: [NgTemplateOutlet, MktgPrintRunningHeadComponent, MktgPrintChapterHeaderComponent],
  templateUrl: './mktg-framework-print.component.html',
  styleUrl: './mktg-framework-print.component.scss',
})
export class MktgFrameworkPrintComponent {
  // === Injections ===
  private readonly printService = inject(MktgPrintService);

  // === Inputs ===
  /** The framework as the print lays it out, with the brand it is set in. */
  public readonly view = input.required<FoundationMessagePrintView>();
  /** Family document number; standalone exports retain their own section numbers. */
  public readonly number = input('');

  // === Computed ===
  /** The Google Fonts stylesheet of the brand's typeface, when the kit says it is there (null otherwise). */
  private readonly fontUrl$ = toObservable(computed(() => this.view().brand.fontUrl));

  public constructor() {
    // The typeface comes from Google Fonts, loaded once per stylesheet (the
    // print service shares the link with the brand kit book).
    this.fontUrl$
      .pipe(
        filter((url): url is string => !!url),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((url) => this.printService.ensureFontStylesheet(url));
  }
}
