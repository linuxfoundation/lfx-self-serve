// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  FOUNDATION_MESSAGE_PRINT_NO_GAP_MESSAGE,
  FRAMEWORK_PORTRAIT_FACT_COLUMNS,
  FRAMEWORK_PORTRAIT_NUMBER_COLUMNS,
  FRAMEWORK_PORTRAIT_NUMBER_TILE,
  FRAMEWORK_PORTRAIT_PAGE_IDS,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_STATEMENT_SHARES,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
  MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE,
  MKTG_PORTRAIT_COLUMNS,
  MKTG_PORTRAIT_PAGE,
  MKTG_PRINT_DOT,
  mktgPrintJoin,
} from '@lfx-one/shared/constants';
import {
  FoundationMessagePrintFittedText,
  FoundationMessagePrintFrame,
  FoundationMessagePrintGoal,
  FoundationMessagePrintGoalPage,
  FoundationMessagePrintIcp,
  FoundationMessagePrintIcpPage,
  FoundationMessagePrintIcpPageRows,
  FoundationMessagePrintSourcesPage,
  FoundationMessagePrintType,
  FoundationMessagePrintView,
  MktgPortraitBook,
  MktgPortraitFitPara,
  MktgPortraitLook,
} from '@lfx-one/shared/interfaces';
import {
  foundationMessagePrintAnchorIntro,
  foundationMessagePrintMatrix,
  foundationMessagePrintReportText,
  foundationMessagePrintSourceLabel,
  frameworkPortraitAnchors,
  frameworkPortraitAvoidList,
  frameworkPortraitBodyTop,
  frameworkPortraitCutList,
  frameworkPortraitHouse,
  frameworkPortraitIcpMatrixHeight,
  frameworkPortraitIcpPages,
  frameworkPortraitMatrix,
  frameworkPortraitNumbersPages,
  frameworkPortraitPillList,
  frameworkPortraitPlan,
  frameworkPortraitSayRoom,
  frameworkPortraitStatementWidth,
  frameworkPortraitTaglineSize,
  frameworkPortraitTitle,
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

const TYPE = FRAMEWORK_PORTRAIT_TYPE;
const ROOM = FRAMEWORK_PORTRAIT_ROOM;

// The Messaging Framework's PRINT rendering (Download PDF): the framework as
// a portrait book on the portrait print grammar (lfx-mktg-portrait-*), one
// fixed US Letter frame (816×1056 px) per page, placed by the design's
// measurements so Chromium and WebKit paginate one frame per sheet and
// nothing flows across a page edge (CSS Paged Media: the grammar's `.pp-page`
// is the named Letter page with no margin and carries the one break per
// frame, `break-before: page; break-after: auto`; this component sets no
// page and no break, and its host is a block, MKTG_PORTRAIT_BLOCK_HOST, so
// Google Chrome adds no sheet at an inline host). The pages are the plan's
// (`frameworkPortraitPlan`): a cover with the contents; 01 Framework (the
// statements and the goal matrix, one page per goal, say and avoid with the
// anchor questions); 02 ICPs, by their measured cards, two a page at most;
// 03 Message house; 04 Key numbers with their sources; 05 Sources & gaps (the
// run's report). The reviewer's note stays on screen. Every block whose
// height follows the data is bounded in the shared layout utils
// (`mktg-framework-portrait-layout.utils.ts`), never in the template, so it
// stops at the next block's top or the footer: text (the statements, a page
// title, a goal page's value proposition, key message, sound bite and "who
// it's for" lines, the matrix cells, a tile's figure and label, the house's
// Why now) by the portrait fit model (set smaller first, then cut at a
// sentence); lists (the cover's contents, a goal page's proof rows, the
// matrix's proofs, the say pills and avoid rows, the pillars' proofs, the
// audiences, the facts table and the Sources & gaps lists) by the design
// reader's list rule (tightened first, then cut to whole rows, with a muted
// "+N more" line under the cut, never silently); the profile cards by their
// measured height (a page holds the cards that end above the footer, a lone
// card past the room is set tight and its long fields fitted). The key
// numbers print as tiles up to FRAMEWORK_PORTRAIT_MAX_TILES by the count's
// layout, past that (or when a figure would not hold a tile) as a table of
// every figure continued on more pages (`frameworkPortraitNumbersPages`).
// The type the fit model measures is FRAMEWORK_PORTRAIT_TYPE, bound on the
// root as `--fwp-*` custom properties the stylesheet reads, so measured and
// printed type are one value. Set in the project's brand when it has a Brand
// Kit (its colors, typeface and logo), in the LF look otherwise. Standalone
// it is its own book (`book` null); inside the family export the family's
// book sets the running head, the footer and the first page number and drops
// the cover and the band. On screen the framework is its app page
// (lfx-mktg-framework-view), which holds this document in a print-only
// wrapper and prints it with Download PDF (the browser's print, from the
// print service's frame; the global print rules in styles.scss show it
// alone). The frames' measurements are the design's, in the `[lfxPpRect]`
// placements, FRAMEWORK_PORTRAIT_TOPS and FRAMEWORK_PORTRAIT_ROOM; the pages'
// styles are the global partial `_mktg-framework-print-pages.scss` beside
// this file, `@use`d from styles.scss, scoped to this book's root.
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
  /** The blocks' measures the template places by (the say and avoid columns). */
  protected readonly room = FRAMEWORK_PORTRAIT_ROOM;
  /** The statement cards' shares of their row (their flex), one value for the fit model and the template. */
  protected readonly shares = FRAMEWORK_PORTRAIT_STATEMENT_SHARES;
  protected readonly tile = FRAMEWORK_PORTRAIT_NUMBER_TILE;
  /** The facts table's `<colgroup>` widths, %: the fact, the source, the goal that uses it (the layout measures the rows by these). */
  protected readonly factColumns = FRAMEWORK_PORTRAIT_FACT_COLUMNS;
  /** The key numbers table's `<colgroup>` widths, %: the figure, what it counts. */
  protected readonly numberColumns = FRAMEWORK_PORTRAIT_NUMBER_COLUMNS;
  protected readonly noSourceFailed = MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE;
  protected readonly noGap = FOUNDATION_MESSAGE_PRINT_NO_GAP_MESSAGE;
  /** The fitted blocks' type as custom properties on the root (`--fwp-statement-size: 11.5px`, `--fwp-statement-line: 1.45`, …): the stylesheet reads these, the fit model the constants. */
  protected readonly typeVars: Record<string, string> = Object.fromEntries(
    Object.entries(TYPE).flatMap(([name, type]) => {
      const kebab = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      return [
        [`--fwp-${kebab}-size`, `${type.size}px`],
        [`--fwp-${kebab}-line`, `${type.line}`],
        [`--fwp-${kebab}-weight`, `${type.weight}`],
      ];
    })
  );

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
  /** The one middle-dot separator the template joins a line's parts with (MKTG_PRINT_DOT). */
  protected readonly dot = MKTG_PRINT_DOT;
  /** The frames, in the plan's order, each with its book page number, printed section label, band and laid-out data. */
  protected readonly frames = this.initFrames();
  /** The cover's edition line: `V1.0 · Approved 6 Nov 2026 · figures as of 4 Nov 2026`, less any clause the revision lacks. */
  protected readonly coverVersionLine = computed(() => {
    const view = this.view();
    return mktgPrintJoin([view.versionLabel, view.approvedLabel, view.dateReadLabel ? `figures as of ${view.dateReadLabel}` : '']);
  });
  /** The cover's bottom strip, right: `aaif.io · V1.0 · 6 Nov 2026`, less any part the revision lacks. */
  protected readonly coverStripRight = computed(() => mktgPrintJoin([this.view().website, this.view().versionLabel, this.view().dateLabel]));
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

  /** The frames: the plan's pages with their book numbers and labels, and each page's data laid out once, here, not in the template (the fitted blocks are the header's list). */
  private initFrames(): Signal<FoundationMessagePrintFrame[]> {
    return computed((): FoundationMessagePrintFrame[] => {
      const view = this.view();
      const book = this.resolvedBook();
      const plan = frameworkPortraitPlan(view, { inFamily: book.inFamily });
      const icpPages = frameworkPortraitIcpPages(view.icps);
      const numbersPages = frameworkPortraitNumbersPages(view);
      const contents = plan
        .map((page, index) => ({ id: page.id, title: page.title, number: book.firstPage + index }))
        .filter((entry) => entry.id !== this.ids.cover)
        .map((entry) => ({ ...entry, numberLabel: mktgPortraitPageNumber(entry.number) }));
      return plan.map((page, index) => {
        const goal = /^goal-\d+$/.test(page.id) ? (view.goals.find((entry) => `goal-${entry.n}` === page.id) ?? null) : null;
        const icpIndex = /^icps-\d+$/.test(page.id) ? Number(page.id.slice('icps-'.length)) : 0;
        const numbersIndex = this.pageIndex(page.id, this.ids.keyNumbers);
        const sayAvoid = page.id === this.ids.sayAvoid;
        // The anchors never move; their questions are set smaller, then cut, until they and the crosscut box end above the footer.
        const anchors = sayAvoid ? frameworkPortraitAnchors(view.mf.anchor, view.mf.crosscut) : { anchors: [], crosscutTop: 0 };
        const titleFit = frameworkPortraitTitle(page.title);
        return {
          ...page,
          number: book.firstPage + index,
          label: mktgPortraitSectionLabel(page.section, book.inFamily, 'Messaging framework'),
          band: !book.inFamily && mktgPortraitOpensChapter(plan, index),
          titleFit,
          contents: page.id === this.ids.cover ? contents : [],
          statements: page.id === this.ids.framework ? this.statements(view) : null,
          matrix: page.id === this.ids.framework ? frameworkPortraitMatrix(view.goals, view.mf.crosscut, this.tops.footer - this.tops.matrix) : null,
          anchorIntro: sayAvoid ? foundationMessagePrintAnchorIntro(view.mf.anchor.length) : '',
          sayAvoid: sayAvoid
            ? {
                say: frameworkPortraitPillList(view.mf.say, ROOM.sayColumn, frameworkPortraitSayRoom()),
                avoid: frameworkPortraitAvoidList(view.avoidRows, ROOM.avoidColumn, frameworkPortraitSayRoom()),
              }
            : null,
          anchors: anchors.anchors,
          crosscutTop: anchors.crosscutTop,
          goalPage: goal ? this.goalPage(goal, view, frameworkPortraitBodyTop(titleFit)) : null,
          icpPage: icpIndex ? this.icpPage(icpIndex, icpPages, view) : null,
          numbersPage: numbersIndex ? (numbersPages[numbersIndex - 1] ?? null) : null,
          sourcesPage: page.id === this.ids.sources ? this.sourcesPage(view) : null,
          housePage: page.id === this.ids.messageHouse ? frameworkPortraitHouse(view, this.houseUmbrella()) : null,
        };
      });
    });
  }

  // === Private helpers ===

  /**
   * The framework page's four statements, each fitted to its card (the cards share the row by FRAMEWORK_PORTRAIT_STATEMENT_SHARES);
   * the tagline first at the size whose line holds two of its words, then to the card's height.
   */
  private statements(view: FoundationMessagePrintView): FoundationMessagePrintFrame['statements'] {
    const cardsHeight = this.tops.matrix - this.page.bodyTop - ROOM.gap - ROOM.cardPadding - ROOM.label;
    const taglineWidth = frameworkPortraitStatementWidth(this.shares.tagline, true);
    return {
      vision: this.fit(view.mf.vision, TYPE.statement, frameworkPortraitStatementWidth(this.shares.vision), cardsHeight),
      mission: this.fit(view.mf.mission, TYPE.statement, frameworkPortraitStatementWidth(this.shares.mission), cardsHeight),
      positioning: this.fit(view.mf.positioning, TYPE.statement, frameworkPortraitStatementWidth(this.shares.positioning), cardsHeight),
      tagline: this.fit(view.mf.tagline, { ...TYPE.tagline, size: frameworkPortraitTaglineSize(view.mf.tagline, taglineWidth) }, taglineWidth, cardsHeight),
    };
  }

  /** A goal's page: the value, the key message and the sound bite fitted to the room their fixed tops leave, the proof rows cut to what fits above the bite, the served cards' lines fitted. */
  private goalPage(goal: FoundationMessagePrintGoal, view: FoundationMessagePrintView, leadTop: number): FoundationMessagePrintGoalPage {
    const tops = this.tops;
    const width = this.page.contentWidth;
    const proofsRoom = tops.goalBite - tops.goalProofs - ROOM.label - 6 - ROOM.gap;
    // A proof row is the fact beside its chip: the chip is capped at ROOM.chip (`.fwp-chip-wrap`), so the fact measures against the rest;
    // the list is tightened before it is cut, and the cut is said under it.
    const proofs = frameworkPortraitCutList(
      goal.proofRows,
      proofsRoom,
      'Framework',
      (proof) => this.paraHeight(proof.fact, TYPE.goalProof, width - ROOM.chip - ROOM.proofGap) + ROOM.proofRow,
      (proof) => this.paraHeight(proof.fact, TYPE.goalProofTight, width - ROOM.chip - ROOM.proofGap) + ROOM.proofRowTight
    );
    const served = goal.icps.map((id) => view.icps.find((icp) => icp.id === id)).filter((icp): icp is FoundationMessagePrintIcp => !!icp);
    const cardWidth = served.length ? (width - (served.length - 1) * 16) / served.length - 32 : width;
    const cardRoom = tops.footer - tops.goalServed - ROOM.label - 8 - ROOM.cardPadding - 17 - 6;
    return {
      goal,
      numberLabel: mktgPortraitPageNumber(goal.n),
      leadTop,
      value: this.fit(goal.vp, TYPE.goalValue, width - 150 - 28, tops.goalKey - leadTop - ROOM.label - 12 - ROOM.gap),
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
        return {
          id: icp.id,
          name: icp.name,
          need: { text: need.text.replace(/^Needs /, ''), size: need.size },
          cta: { text: cta.text.replace(/^Ask them to /, ''), size: cta.size },
        };
      }),
    };
  }

  /** An ICP page: its profiles, its intro, the rows' top (under the long intro on the first page), the matrix when it holds one profile. */
  private icpPage(index: number, pages: FoundationMessagePrintIcpPageRows[], view: FoundationMessagePrintView): FoundationMessagePrintIcpPage {
    const rows = pages[index - 1] ?? { icps: [], tight: false, height: 0 };
    const total = view.icps.length;
    const project = view.projectName || 'the project';
    const start = pages.slice(0, index - 1).reduce((count, page) => count + page.icps.length, 0);
    const rowsTop = index === 1 ? this.tops.icpRowsFirst : this.tops.icpRows;
    // The goals × profiles matrix under a lone card: at the design's top, or under the card when it runs lower, and only where it ends above the footer.
    const matrixTop = Math.max(this.tops.icpMatrix, rowsTop + rows.height + ROOM.gap);
    const matrixFits = rows.icps.length === 1 && matrixTop + frameworkPortraitIcpMatrixHeight(view.icps.length) <= this.tops.footer - ROOM.icpFooterRoom;
    return {
      index,
      intro:
        index === 1
          ? `${total} ${total === 1 ? 'profile' : 'profiles'}. Each names who they are, what they need, what ${project} gives them, the lead message, the call to action, the objection to expect and where to reach them. Goal numbers refer to the goal pages.`
          : `Profiles ${start + 1}–${start + rows.icps.length} of ${total}.`,
      rowsTop,
      icps: rows.icps,
      tight: rows.tight,
      matrix: matrixFits ? foundationMessagePrintMatrix(view.goals, view.icps) : [],
      matrixTop,
    };
  }

  /** The Sources & gaps page: an existing report's lists, each tightened then cut to the rows that fit above the approval card; with no report, the approval card alone. */
  private sourcesPage(view: FoundationMessagePrintView): FoundationMessagePrintSourcesPage {
    const date = view.dateReadLabel;
    const report = view.report;
    const listWidth = this.columns.half;
    const columnRoom = this.tops.sourcesApproval - this.tops.sourcesLists - ROOM.gap;
    const rowHeight = (text: string): number => this.paraHeight(text, TYPE.source, listWidth);
    const tightHeight = (text: string): number => this.paraHeight(text, TYPE.sourceTight, listWidth);
    const list = (rows: readonly string[], room: number) => frameworkPortraitCutList(rows, room, 'Sources', rowHeight, tightHeight);
    let lists: FoundationMessagePrintSourcesPage['report'] = null;
    if (report) {
      const failedAll = report.sources_failed.map(
        (source) => `${foundationMessagePrintSourceLabel(source.name)} — ${foundationMessagePrintReportText(source.reason)}`
      );
      // The left column holds Read, then Could not be read: the failed list keeps its rows first (it is the shorter, and the gap it fills is the editor's), the read list takes what is left.
      const failedHeight =
        ROOM.blockAfter + ROOM.label + (failedAll.length ? failedAll.reduce((sum, row) => sum + rowHeight(row), 0) : rowHeight(this.noSourceFailed));
      lists = {
        intro: date
          ? `What the framework was built from on ${date}, what could not be read, and what is still open.`
          : 'What the framework was built from, what could not be read, and what is still open.',
        read: list(report.sources_read.map(foundationMessagePrintSourceLabel), columnRoom - ROOM.label - Math.min(failedHeight, columnRoom / 2)),
        failed: list(failedAll, columnRoom / 2 - ROOM.blockAfter - ROOM.label),
        failedCount: report.sources_failed.length,
        gaps: list(report.gaps.map(foundationMessagePrintReportText), columnRoom - ROOM.label),
        gapsCount: report.gaps.length,
      };
    }
    const lead = [view.versionLabel, view.approvedLabel].filter((part) => part !== '');
    const gapsClause = view.approvedLabel && (report?.gaps.length ?? 0) > 0 ? 'The gaps above were open at approval. ' : '';
    return {
      report: lists,
      approvalLead: lead.length ? `${mktgPrintJoin(lead)}.` : '',
      approvalNote: `${gapsClause}A later run re-reads the sources and refreshes the LFX figures.`,
    };
  }

  /** The 1-based index a page id carries after a base (`key-numbers` → 1, `key-numbers-2` → 2), or 0 when the id is another page's. */
  private pageIndex(pageId: string, base: string): number {
    if (pageId === base) return 1;
    return pageId.startsWith(`${base}-`) ? Number(pageId.slice(base.length + 1)) : 0;
  }

  /** The text set at its preferred size when it fits its box, smaller down to 72 % when it must, cut at a sentence past that (K's fit model); printed at the size the model measured. */
  private fit(text: string, type: FoundationMessagePrintType, width: number, height: number): FoundationMessagePrintFittedText {
    const result = mktgPortraitFitBlock({ paras: [this.para(text, type)] }, width, height);
    const para = result.block.paras[0];
    return para ? { text: para.text, size: para.size } : { text, size: type.size };
  }

  /** The height a paragraph takes at its type in a column, px (the fit model's measure). */
  private paraHeight(text: string, type: FoundationMessagePrintType, width: number): number {
    return mktgPortraitParaHeight(this.para(text, type), width);
  }

  private para(text: string, type: FoundationMessagePrintType, above = 0): MktgPortraitFitPara {
    return { text, size: type.size, line: type.line, weight: type.weight, above };
  }
}
