// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  FOUNDATION_MESSAGE_PRINT_NO_GAP_MESSAGE,
  FRAMEWORK_PORTRAIT_NUMBER_TILE,
  FRAMEWORK_PORTRAIT_PAGE_IDS,
  FRAMEWORK_PORTRAIT_TOPS,
  MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE,
  MKTG_PORTRAIT_COLUMNS,
  MKTG_PORTRAIT_PAGE,
} from '@lfx-one/shared/constants';
import {
  FoundationMessagePrintFactRow,
  FoundationMessagePrintFittedText,
  FoundationMessagePrintFrame,
  FoundationMessagePrintGoal,
  FoundationMessagePrintGoalPage,
  FoundationMessagePrintIcp,
  FoundationMessagePrintIcpPage,
  FoundationMessagePrintNumbersPage,
  FoundationMessagePrintSourcesPage,
  FoundationMessagePrintView,
  MktgPortraitBook,
  MktgPortraitFitPara,
  MktgPortraitLook,
} from '@lfx-one/shared/interfaces';
import {
  foundationMessagePrintMatrix,
  foundationMessagePrintSourceLabel,
  frameworkPortraitIcpPages,
  frameworkPortraitPlan,
  mktgPortraitDocumentName,
  mktgPortraitFitBlock,
  mktgPortraitFootLeft,
  mktgPortraitLook,
  mktgPortraitOpensChapter,
  mktgPortraitPageNumber,
  mktgPortraitParaHeight,
  mktgPortraitSectionLabel,
} from '@lfx-one/shared/utils';
import { MktgPrintService } from '@services/mktg-print.service';
import { distinctUntilChanged, filter } from 'rxjs';

import { MktgPortraitPageComponent } from '../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../components/mktg-portrait/mktg-portrait-rect.directive';

/** The type of a page's blocks the fit model measures (size px, line height as a multiple, weight), the stylesheet's values. */
const TYPE = {
  statement: { size: 11.5, line: 1.45 },
  tagline: { size: 18, line: 1.3, weight: 500 },
  coverUmbrella: { size: 32, line: 1.18, weight: 500 },
  houseUmbrella: { size: 19, line: 1.4, weight: 500 },
  goalValue: { size: 22, line: 1.35, weight: 500 },
  goalKey: { size: 19, line: 1.4, weight: 500 },
  goalProof: { size: 15, line: 1.45 },
  goalBite: { size: 34, line: 1.2, weight: 500 },
  servedLine: { size: 11.5, line: 1.5 },
  fact: { size: 11, line: 1.3 },
  source: { size: 12, line: 1.6 },
} as const;

/** The room the stylesheet's padding, labels and gaps take inside a bounded block, px. */
const ROOM = {
  /** A `pp-lab` eyebrow and the gap under it. */
  label: 26,
  /** A card's padding, top and bottom together. */
  cardPadding: 28,
  /** A proof row's padding (13 + 13) and its hairline. */
  proofRow: 27,
  /** A facts row's padding (4 + 4) and its hairline. */
  factRow: 9,
  /** The gap `fwp-block-after` leaves between the Read and Could-not-be-read blocks. */
  blockAfter: 18,
  /** The gap between the last block of a page and the one under it. */
  gap: 16,
} as const;

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
// reviewer's note stays on screen. Every variable-length block on a
// fixed-top page is bounded by the portrait fit model (set smaller down to
// 72 %, then cut at a sentence; lists lose whole rows) so no block passes
// its box or the footer: the frames clip nothing. Set in the project's brand
// when it has a Brand Kit (its colours, typeface and logo), in the LF look
// otherwise. Standalone it is its own book (`book` null); inside the family
// export the family's book sets the running head, the footer and the first
// page number and drops the cover and the band. On screen the framework is
// its app page (lfx-mktg-framework-view), which holds this document in a
// print-only wrapper and prints it with Download PDF (the browser's print,
// from the print service's frame; the global print rules in styles.scss show
// it alone). The frames' measurements are the design's, in the component's
// stylesheet, the `[lfxPpRect]` placements and FRAMEWORK_PORTRAIT_TOPS.
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
  protected readonly tops = FRAMEWORK_PORTRAIT_TOPS;
  protected readonly tile = FRAMEWORK_PORTRAIT_NUMBER_TILE;
  protected readonly noSourceFailed = MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE;
  protected readonly noGap = FOUNDATION_MESSAGE_PRINT_NO_GAP_MESSAGE;

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
  /** The frames, in the plan's order, each with its book page number, printed section label, band and laid-out data. */
  protected readonly frames = this.initFrames();
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
  protected readonly coverUmbrella = computed(() => this.fit(this.view().mh.umbrella, TYPE.coverUmbrella, 640, 160));
  /** The message house's umbrella bar, fitted to three lines. */
  protected readonly houseUmbrella = computed(() => this.fit(this.view().mh.umbrella, TYPE.houseUmbrella, this.page.contentWidth - 56, 84));
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

  // === Private initializers ===

  /** The frames: the plan's pages with their book numbers and labels, and each page's data laid out and bounded once, here, not in the template. */
  private initFrames(): Signal<FoundationMessagePrintFrame[]> {
    return computed((): FoundationMessagePrintFrame[] => {
      const view = this.view();
      const book = this.resolvedBook();
      const plan = frameworkPortraitPlan(view, { inFamily: book.inFamily });
      const icpPages = frameworkPortraitIcpPages(view.icps);
      const contents = plan
        .map((page, index) => ({ id: page.id, title: page.title, number: book.firstPage + index }))
        .filter((entry) => entry.id !== this.ids.cover)
        .map((entry) => ({ ...entry, numberLabel: mktgPortraitPageNumber(entry.number) }));
      return plan.map((page, index) => {
        const goal = /^goal-\d+$/.test(page.id) ? (view.goals.find((entry) => `goal-${entry.n}` === page.id) ?? null) : null;
        const icpIndex = /^icps-\d+$/.test(page.id) ? Number(page.id.slice('icps-'.length)) : 0;
        return {
          ...page,
          number: book.firstPage + index,
          label: mktgPortraitSectionLabel(page.section, book.inFamily, 'Messaging framework'),
          band: !book.inFamily && mktgPortraitOpensChapter(plan, index),
          contents: page.id === this.ids.cover ? contents : [],
          statements: page.id === this.ids.framework ? this.statements(view) : null,
          anchors: page.id === this.ids.sayAvoid ? view.mf.anchor.map((question, rank) => ({ numberLabel: mktgPortraitPageNumber(rank + 1), question })) : [],
          goalPage: goal ? this.goalPage(goal, view) : null,
          icpPage: icpIndex ? this.icpPage(icpIndex, icpPages, view) : null,
          numbersPage: page.id === this.ids.keyNumbers ? this.numbersPage(view) : null,
          sourcesPage: page.id === this.ids.sources ? this.sourcesPage(view) : null,
        };
      });
    });
  }

  // === Private helpers ===

  /** The framework page's four statements, each fitted to its card (the cards share 704 less three 12 gaps by the design's flex ratios). */
  private statements(view: FoundationMessagePrintView): FoundationMessagePrintFrame['statements'] {
    const cardsHeight = 336 - this.page.bodyTop - ROOM.gap - ROOM.cardPadding - ROOM.label;
    const column = (share: number): number => ((this.page.contentWidth - 3 * 12) * share) / 4 - 32;
    return {
      vision: this.fit(view.mf.vision, TYPE.statement, column(0.85), cardsHeight),
      mission: this.fit(view.mf.mission, TYPE.statement, column(1.05), cardsHeight),
      positioning: this.fit(view.mf.positioning, TYPE.statement, column(1.4), cardsHeight),
      tagline: this.fit(view.mf.tagline, TYPE.tagline, column(0.7) - 13, cardsHeight),
    };
  }

  /** A goal's page: every block fitted or cut to the room its fixed top leaves before the next block's top. */
  private goalPage(goal: FoundationMessagePrintGoal, view: FoundationMessagePrintView): FoundationMessagePrintGoalPage {
    const tops = this.tops;
    const width = this.page.contentWidth;
    const proofsRoom = tops.goalBite - tops.goalProofs - ROOM.label - 6 - ROOM.gap;
    const proofs = this.rowsThatFit(goal.proofRows, proofsRoom, (proof) => this.paraHeight(proof.fact, TYPE.goalProof, width - 140) + ROOM.proofRow);
    const served = goal.icps.map((id) => view.icps.find((icp) => icp.id === id)).filter((icp): icp is FoundationMessagePrintIcp => !!icp);
    const cardWidth = served.length ? (width - (served.length - 1) * 16) / served.length - 32 : width;
    const cardRoom = tops.footer - tops.goalServed - ROOM.label - 8 - ROOM.cardPadding - 17 - 6;
    return {
      goal,
      numberLabel: mktgPortraitPageNumber(goal.n),
      value: this.fit(goal.vp, TYPE.goalValue, width - 150 - 28, tops.goalKey - this.page.bodyTop - ROOM.label - 12 - ROOM.gap),
      key: this.fit(goal.key, TYPE.goalKey, width - 56 - 22 - 90, tops.goalProofs - tops.goalKey - 48 - ROOM.gap),
      proofs,
      bite: goal.bite ? this.fit(`“${goal.bite}”`, TYPE.goalBite, width, tops.goalServed - tops.goalBite - ROOM.label - 10 - ROOM.gap) : null,
      served: served.map((icp) => {
        const lines = mktgPortraitFitBlock(
          { paras: [this.para(`Needs ${icp.need}`, TYPE.servedLine), this.para(`Ask them to ${icp.cta}`, TYPE.servedLine, 4)] },
          cardWidth,
          cardRoom
        );
        const [need, cta] = lines.block.paras;
        const size = Math.round(TYPE.servedLine.size * lines.scale * 100) / 100;
        return {
          id: icp.id,
          name: icp.name,
          need: { text: need.text.replace(/^Needs /, ''), size },
          cta: { text: cta.text.replace(/^Ask them to /, ''), size },
        };
      }),
    };
  }

  /** An ICP page: its profiles, its intro, the rows' top (under the long intro on the first page), the matrix when it holds one profile. */
  private icpPage(index: number, pages: FoundationMessagePrintIcp[][], view: FoundationMessagePrintView): FoundationMessagePrintIcpPage {
    const icps = pages[index - 1] ?? [];
    const total = view.icps.length;
    const project = view.projectName || 'the project';
    const start = pages.slice(0, index - 1).reduce((count, page) => count + page.length, 0);
    return {
      index,
      intro:
        index === 1
          ? `${total} ${total === 1 ? 'profile' : 'profiles'}. Each names who they are, what they need, what ${project} gives them, the lead message, the call to action, the objection to expect and where to reach them. Goal numbers refer to the goal pages.`
          : `Profiles ${start + 1}–${start + icps.length} of ${total}.`,
      rowsTop: index === 1 ? this.tops.icpRowsFirst : this.tops.icpRows,
      icps,
      matrix: icps.length === 1 ? foundationMessagePrintMatrix(view.goals, view.icps) : [],
    };
  }

  /** The key numbers page: the tiles in full rows (an odd count's last tile wide), the facts table under them cut to the rows that fit above the footer. */
  private numbersPage(view: FoundationMessagePrintView): FoundationMessagePrintNumbersPage {
    const numbers = view.numbers;
    const rows = Math.ceil(numbers.length / 2);
    const factsTop = this.tile.top + rows * this.tile.height + Math.max(0, rows - 1) * this.tile.gap + this.tile.tableGap;
    // The table's columns at `table-layout: fixed`: the fact 50 %, the source and the user 25 % each, less the cell's 12 padding.
    const factWidth = this.page.contentWidth / 2 - 12;
    const sideWidth = this.page.contentWidth / 4 - 12;
    const headRow = this.paraHeight('Fact', TYPE.fact, factWidth) + ROOM.factRow + 4;
    const room = this.tops.footer - factsTop - ROOM.label - 8 - headRow;
    const facts = this.rowsThatFit(
      view.facts,
      room,
      (fact: FoundationMessagePrintFactRow) =>
        Math.max(
          this.paraHeight(fact.fact, TYPE.fact, factWidth),
          this.paraHeight(fact.source, TYPE.fact, sideWidth),
          this.paraHeight(fact.usedBy, TYPE.fact, sideWidth)
        ) + ROOM.factRow
    );
    const date = view.dateReadLabel;
    return {
      intro: `The figures the framework leans on, with where each came from.${date ? ` LFX figures are as of ${date}.` : ''}`,
      tiles: numbers.map((row, index) => ({ ...row, wide: numbers.length % 2 === 1 && index === numbers.length - 1 })),
      factsTop,
      facts,
    };
  }

  /** The Sources & gaps page: the run's report as stored (null when the record has none), each list cut to the rows that fit above the approval card. */
  private sourcesPage(view: FoundationMessagePrintView): FoundationMessagePrintSourcesPage {
    const date = view.dateReadLabel;
    const report = view.report;
    const listWidth = this.columns.half - 16;
    const columnRoom = this.tops.sourcesApproval - this.tops.sourcesLists - ROOM.gap;
    const rowHeight = (text: string): number => this.paraHeight(text, TYPE.source, listWidth);
    let read: string[] | null = null;
    let failed: string[] | null = null;
    let gaps: string[] | null = null;
    if (report) {
      const failedAll = report.sources_failed.map((source) => `${source.name} — ${source.reason}`);
      // The left column holds Read, then Could not be read: the failed list keeps its rows first (it is the shorter, and the gap it fills is the editor's), the read list takes what is left.
      const failedHeight =
        ROOM.blockAfter + ROOM.label + (failedAll.length ? failedAll.reduce((sum, row) => sum + rowHeight(row), 0) : rowHeight(this.noSourceFailed));
      failed = this.rowsThatFit(failedAll, columnRoom / 2 - ROOM.blockAfter - ROOM.label, rowHeight);
      read = this.rowsThatFit(
        report.sources_read.map(foundationMessagePrintSourceLabel),
        columnRoom - ROOM.label - Math.min(failedHeight, columnRoom / 2),
        rowHeight
      );
      gaps = this.rowsThatFit(report.gaps, columnRoom - ROOM.label, rowHeight);
    }
    const lead = [view.versionLabel, view.approvedLabel].filter((part) => part !== '');
    const gapsClause = view.approvedLabel && (report?.gaps.length ?? 0) > 0 ? 'The gaps above were open at approval. ' : '';
    return {
      intro: date
        ? `What the framework was built from on ${date}, what could not be read, and what is still open.`
        : 'What the framework was built from, what could not be read, and what is still open.',
      read,
      failed,
      gaps,
      approvalLead: lead.length ? `${lead.join(' · ')}.` : '',
      approvalNote: `${gapsClause}A later run re-reads the sources and refreshes the LFX figures.`,
    };
  }

  /** The leading rows of a list that fit the room, whole rows, in order; nothing is added in their place. */
  private rowsThatFit<T>(rows: readonly T[], room: number, height: (row: T) => number): T[] {
    const kept: T[] = [];
    let used = 0;
    for (const row of rows) {
      used += height(row);
      if (used > room) break;
      kept.push(row);
    }
    return kept;
  }

  /** The text set at its preferred size when it fits its box, smaller down to 72 % when it must, cut at a sentence past that (K's fit model). */
  private fit(text: string, type: { size: number; line: number; weight?: number }, width: number, height: number): FoundationMessagePrintFittedText {
    const result = mktgPortraitFitBlock({ paras: [this.para(text, type)] }, width, height);
    return { text: result.block.paras[0]?.text ?? text, size: Math.round(type.size * result.scale * 100) / 100 };
  }

  /** The height a paragraph takes at its type in a column, px (the fit model's measure). */
  private paraHeight(text: string, type: { size: number; line: number; weight?: number }, width: number): number {
    return mktgPortraitParaHeight(this.para(text, type), width);
  }

  private para(text: string, type: { size: number; line: number; weight?: number }, above = 0): MktgPortraitFitPara {
    return { text, size: type.size, line: type.line, weight: type.weight ?? 400, above };
  }
}
