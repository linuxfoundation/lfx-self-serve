// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE, MKTG_PORTRAIT_COLUMNS, MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import {
  FoundationMessagePrintGoal,
  FoundationMessagePrintIcp,
  FoundationMessagePrintMatrixRow,
  FoundationMessagePrintView,
  MktgPortraitBook,
  MktgPortraitLook,
  MktgPortraitPlanPage,
} from '@lfx-one/shared/interfaces';
import {
  foundationMessagePrintMatrix,
  FRAMEWORK_PORTRAIT_PAGE_IDS,
  frameworkPortraitIcpPages,
  frameworkPortraitPlan,
  mktgPortraitDocumentName,
  mktgPortraitFitBlock,
  mktgPortraitFootLeft,
  mktgPortraitLook,
  mktgPortraitOpensChapter,
  mktgPortraitSectionLabel,
} from '@lfx-one/shared/utils';
import { MktgPrintService } from '@services/mktg-print.service';
import { distinctUntilChanged, filter } from 'rxjs';

import { MktgPortraitPageComponent } from '../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../components/mktg-portrait/mktg-portrait-rect.directive';

/** One frame of the book: its plan page with its book number, printed section label, band, and the data it holds. */
interface FrameworkPortraitFrame extends MktgPortraitPlanPage {
  number: number;
  label: string;
  band: boolean;
  /** The goal of a `goal-N` page; null elsewhere. */
  goal: FoundationMessagePrintGoal | null;
  /** The profiles a `goal-N` page's message is written for (the goal's order); the profiles an `icps-k` page holds. */
  icps: FoundationMessagePrintIcp[];
  /** The intro line of an `icps-k` page; '' elsewhere. */
  intro: string;
  /** Goals × profiles, on an `icps-k` page that holds one profile; empty elsewhere. */
  matrix: FoundationMessagePrintMatrixRow[];
}

/** A text fitted to its box: the text (cut at a sentence when it had to be) and the size it is set at, px. */
interface FittedText {
  text: string;
  size: number;
}

/** The key numbers' tiles: 344 px wide in pairs; an odd count's last tile spans the column (never an orphan half-tile). */
const KEY_NUMBER_TILE = { width: 344, height: 140, gap: 16, top: 210, tableGap: 28 } as const;

// The Messaging Framework's PRINT rendering (Download PDF): the framework as
// a portrait book on the portrait print grammar (lfx-mktg-portrait-*), one
// fixed US Letter frame (816×1056 px) per page, placed by the design's
// measurements so Chromium and WebKit paginate one frame per sheet and
// nothing flows across a page edge (CSS Paged Media: `@page` Letter with no
// margin, `break-after: page` per frame). The pages are the plan's
// (`frameworkPortraitPlan`): a cover with the contents; 01 Framework (the
// statements and the goal matrix, one page per goal, say and avoid with the
// anchor questions); 02 ICPs, two a page; 03 Message house; 04 Key numbers
// with every figure's source; 05 Sources & gaps (the run's report). The
// reviewer's note stays on screen. Set in the project's brand when it has a
// Brand Kit (its colours, typeface and logo), in the LF look otherwise.
// Standalone it is its own book (`book` null); inside the family export the
// family's book sets the running head, the footer and the first page number
// and drops the cover and the band. On screen the framework is its app page
// (lfx-mktg-framework-view), which holds this document in a print-only
// wrapper and prints it with Download PDF (the browser's print, from the
// print service's frame; the global print rules in styles.scss show it
// alone). The frames' measurements are the design's, in the component's
// stylesheet and the `[lfxPpRect]` placements.
@Component({
  selector: 'lfx-mktg-framework-print',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-framework-print.component.html',
  styleUrl: './mktg-framework-print.component.scss',
})
export class MktgFrameworkPrintComponent {
  // === Injections ===
  private readonly printService = inject(MktgPrintService);

  // === Inputs ===
  /** The framework as the print lays it out, with the brand it is set in. */
  public readonly view = input.required<FoundationMessagePrintView>();
  /** Family document number; kept for the family export, which mounts this document (the book carries the family's numbering). */
  public readonly number = input('');
  /**
   * The book the pages are set in: `null` standalone (the framework derives
   * its document name and footer, numbers from 1, the band on, its own
   * cover); the family's book inside the family export.
   */
  public readonly book = input<MktgPortraitBook | null>(null);
  /** The look the pages are set in: `null` standalone (the view's brand, no spark); the family's look inside the family export. */
  public readonly look = input<MktgPortraitLook | null>(null);

  // === Fields the template binds ===
  protected readonly ids = FRAMEWORK_PORTRAIT_PAGE_IDS;
  protected readonly page = MKTG_PORTRAIT_PAGE;
  protected readonly columns = MKTG_PORTRAIT_COLUMNS;
  protected readonly noSourceFailed = MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE;
  /** The on-screen Sources card's empty state for the gaps, reused verbatim. */
  protected readonly noGap = 'The sources left no gap.';

  // === Computed ===
  protected readonly resolvedLook = computed((): MktgPortraitLook => this.look() ?? mktgPortraitLook(this.view().brand));
  protected readonly resolvedBook = computed(
    (): MktgPortraitBook =>
      this.book() ?? {
        inFamily: false,
        headRight: mktgPortraitDocumentName(this.view().projectName, 'messaging framework'),
        footLeft: mktgPortraitFootLeft(this.view().projectName),
        firstPage: 1,
      }
  );
  /** The frames, in the plan's order, each with its book page number, printed section label, band and data. */
  protected readonly frames = computed((): FrameworkPortraitFrame[] => {
    const view = this.view();
    const book = this.resolvedBook();
    const plan = frameworkPortraitPlan(view, { inFamily: book.inFamily });
    const icpPages = frameworkPortraitIcpPages(view.icps);
    return plan.map((page, index) => {
      const goal = /^goal-\d+$/.test(page.id) ? (view.goals.find((entry) => `goal-${entry.n}` === page.id) ?? null) : null;
      const icpPage = /^icps-\d+$/.test(page.id) ? Number(page.id.slice('icps-'.length)) : 0;
      const icps = goal
        ? goal.icps.map((id) => view.icps.find((icp) => icp.id === id)).filter((icp): icp is FoundationMessagePrintIcp => !!icp)
        : (icpPages[icpPage - 1] ?? []);
      return {
        ...page,
        number: book.firstPage + index,
        label: mktgPortraitSectionLabel(page.section, book.inFamily, 'Messaging framework'),
        band: !book.inFamily && mktgPortraitOpensChapter(plan, index),
        goal,
        icps,
        intro: icpPage ? this.icpIntro(icpPage, icpPages, view.icps.length) : '',
        matrix: icpPage && icps.length === 1 ? foundationMessagePrintMatrix(view.goals, view.icps) : [],
      };
    });
  });
  /** The cover's contents: every page but the cover, with its book page number. */
  protected readonly contents = computed(() => this.frames().filter((frame) => frame.id !== this.ids.cover));
  /** The cover's edition line: `V1.0 · Approved 6 Nov 2026 · figures as of 4 Nov 2026`, less any clause the revision lacks. */
  protected readonly coverVersionLine = computed(() => {
    const view = this.view();
    return [view.versionLabel, view.approvedLabel, view.dateReadLabel ? `figures as of ${view.dateReadLabel}` : ''].filter((part) => part !== '').join(' · ');
  });
  /** The cover's bottom strip, right: `aaif.io · V1.0 · 6 Nov 2026`, less any part the revision lacks. */
  protected readonly coverStripRight = computed(() =>
    [this.view().website, this.view().versionLabel, this.view().dateLabel].filter((part) => part !== '').join(' · ')
  );
  /** The cover's umbrella, fitted to the dark band's room under the lockup and the tagline. */
  protected readonly coverUmbrella = computed(() => this.fit(this.view().mh.umbrella, 32, 1.18, 640, 160, 500));
  /** The message house's umbrella bar, fitted to three lines. */
  protected readonly houseUmbrella = computed(() => this.fit(this.view().mh.umbrella, 19, 1.4, this.page.contentWidth - 56, 84, 500));
  /** The key numbers' intro: the figures and, when the run's read date is known, when the LFX figures are from. */
  protected readonly numbersIntro = computed(() => {
    const date = this.view().dateReadLabel;
    return `The figures the framework leans on, with where each came from.${date ? ` LFX figures are as of ${date}.` : ''}`;
  });
  /** The key numbers' tile widths: pairs of 344; an odd count's last tile spans the column. */
  protected readonly numberTiles = computed(() => {
    const numbers = this.view().numbers;
    return numbers.map((row, index) => ({ ...row, wide: numbers.length % 2 === 1 && index === numbers.length - 1 }));
  });
  /** The top of the "Every figure and its source" table: under the tiles' full rows. */
  protected readonly factsTop = computed(() => {
    const rows = Math.ceil(this.view().numbers.length / 2);
    const tile = KEY_NUMBER_TILE;
    return tile.top + rows * tile.height + Math.max(0, rows - 1) * tile.gap + tile.tableGap;
  });
  protected readonly tile = KEY_NUMBER_TILE;
  /** The sources page's intro, dated by the run's read when the revision carries it. */
  protected readonly sourcesIntro = computed(() => {
    const date = this.view().dateReadLabel;
    return date
      ? `What the framework was built from on ${date}, what could not be read, and what is still open.`
      : 'What the framework was built from, what could not be read, and what is still open.';
  });
  /** The sources read, as the design lists them: without the `Website: ` and `Link: ` prefixes, a press-release URL named. */
  protected readonly sourcesRead = computed(() =>
    this.view().report.sources_read.map((source) =>
      source
        .replace(/^Website: /, '')
        .replace(/^Link: /, '')
        .replace(/^Press release: https?:\/\/[^ ]+/, 'The launch press release (linuxfoundation.org/press)')
    )
  );
  /** `<name> — <reason>` per source that could not be read. */
  protected readonly sourcesFailed = computed(() => this.view().report.sources_failed.map((source) => `${source.name} — ${source.reason}`));
  /** The run's notes, one bullet per line; none when the report has no notes. */
  protected readonly notes = computed(() =>
    this.view()
      .report.notes.split('\n')
      .map((note) => note.trim())
      .filter((note) => note !== '')
  );
  /** The approval card's lead: `V1.0 · Approved 6 Nov 2026.`, or `V1.0.` without an approval date; '' when there is no version either. */
  protected readonly approvalLead = computed(() => {
    const parts = [this.view().versionLabel, this.view().approvedLabel].filter((part) => part !== '');
    return parts.length ? `${parts.join(' · ')}.` : '';
  });
  /** The approval card's sentence: with the approval clause only when the revision was approved. */
  protected readonly approvalNote = computed(() =>
    this.view().approvedLabel
      ? 'The gaps above were open at approval. A later run re-reads the sources and refreshes the LFX figures.'
      : 'A later run re-reads the sources and refreshes the LFX figures.'
  );
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

  /** `03`: a goal's or a question's number as the pages print it. */
  protected pad(value: number): string {
    return String(value).padStart(2, '0');
  }

  /** A goal's value proposition, fitted to its room beside the number (above the key message bar). */
  protected goalValue(goal: FoundationMessagePrintGoal): FittedText {
    return this.fit(goal.vp, 22, 1.35, this.page.contentWidth - 150 - 28, 150, 500);
  }

  /** A goal's sound bite, fitted to two lines above "Who it's for". */
  protected goalBite(goal: FoundationMessagePrintGoal): FittedText {
    return this.fit(`“${goal.bite}”`, 34, 1.2, this.page.contentWidth, 90, 500);
  }

  /** The text set at its preferred size when it fits its box, smaller down to 72 % when it must, cut at a sentence past that (K's fit model). */
  private fit(text: string, size: number, line: number, width: number, height: number, weight = 400): FittedText {
    const result = mktgPortraitFitBlock({ paras: [{ text, size, line, weight }] }, width, height);
    return { text: result.block.paras[0]?.text ?? text, size: Math.round(size * result.scale * 100) / 100 };
  }

  /** The intro of an ICP page: the count and what each profile names on the first, the range on the later ones. */
  private icpIntro(pageIndex: number, pages: FoundationMessagePrintIcp[][], total: number): string {
    const project = this.view().projectName || 'the project';
    if (pageIndex === 1) {
      return `${total} ${total === 1 ? 'profile' : 'profiles'}. Each names who they are, what they need, what ${project} gives them, the lead message, the call to action, the objection to expect and where to reach them. Goal numbers refer to the goal pages.`;
    }
    const start = pages.slice(0, pageIndex - 1).reduce((count, page) => count + page.length, 0);
    return `Profiles ${start + 1}–${start + (pages[pageIndex - 1]?.length ?? 0)} of ${total}.`;
  }
}
