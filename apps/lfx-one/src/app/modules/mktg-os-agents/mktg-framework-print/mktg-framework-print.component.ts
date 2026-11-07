// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  FOUNDATION_MESSAGE_INTAKE,
  FOUNDATION_MESSAGE_PRINT_NO_GAP_MESSAGE,
  FRAMEWORK_PORTRAIT_FACT_COLUMNS,
  FRAMEWORK_PORTRAIT_NUMBER_COLUMNS,
  FRAMEWORK_PORTRAIT_NUMBER_TILE,
  FRAMEWORK_PORTRAIT_PAGE_IDS,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_SEP,
  FRAMEWORK_PORTRAIT_STATEMENT_SHARES,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
  MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE,
  MKTG_PORTRAIT_COLUMNS,
  MKTG_PORTRAIT_COVER_STRIP,
  MKTG_PORTRAIT_PAGE,
  MKTG_PRINT_OBJECTION_DASH,
} from '@lfx-one/shared/constants';
import {
  FoundationMessagePrintFittedText,
  FoundationMessageProofView,
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
  foundationMessagePrintCutNote,
  foundationMessagePrintIcpPageIntro,
  foundationMessagePrintMatrix,
  foundationMessagePrintReportText,
  foundationMessagePrintSourceLabel,
  foundationMessagePrintSourceRows,
  frameworkPortraitAnchors,
  frameworkPortraitAvoidList,
  frameworkPortraitBodyTop,
  frameworkPortraitCutList,
  frameworkPortraitCutNoteHeight,
  frameworkPortraitChipHeight,
  frameworkPortraitContents,
  frameworkPortraitCutNoteHeightIn,
  frameworkPortraitHouse,
  frameworkPortraitIcpMatrixHeight,
  frameworkPortraitIcpPages,
  frameworkPortraitMatrix,
  frameworkPortraitNumbersPages,
  frameworkPortraitServedCards,
  frameworkPortraitServedCount,
  frameworkPortraitPillList,
  frameworkPortraitPlan,
  frameworkPortraitSayRoom,
  frameworkPortraitStatementWidth,
  frameworkPortraitTaglineSize,
  frameworkPortraitTitle,
  frameworkPortraitTitlesAtOneSize,
  mktgPortraitCoverStrip,
  mktgPortraitDocumentName,
  mktgNoWidow,
  mktgPortraitFitBlock,
  mktgPortraitFootLeft,
  mktgPortraitLook,
  mktgPortraitOpensChapter,
  mktgPortraitPageNumber,
  mktgPortraitParaHeight,
  mktgPortraitPlatePadding,
  mktgPortraitSectionLabel,
  mktgPrintJoin,
} from '@lfx-one/shared/utils';
import { MktgPrintService } from '@services/mktg-print.service';
import { distinctUntilChanged, filter } from 'rxjs';

import { MKTG_PORTRAIT_BLOCK_HOST } from '../components/mktg-portrait/mktg-portrait-host';
import { MktgPortraitPageComponent } from '../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitPlateDirective } from '../components/mktg-portrait/mktg-portrait-plate.directive';
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
// page and no break; its one component style is the grammar's
// MKTG_PORTRAIT_BLOCK_HOST, `:host { display: block }`, so Google Chrome adds
// no sheet at an inline host). The pages are the plan's
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
// sentence); lists (a goal page's proof rows and "who it's for" cards, the
// matrix's proofs, the say pills and avoid rows, the pillars' proofs, the
// audiences, the facts table and the Sources & gaps lists) by the design
// reader's list rule (tightened first, then cut to whole rows, with a muted
// "+N more" line under the cut, never silently); the cover's contents
// tightened, then its repeated runs collapsed to one row with a page range
// (never cut, every page listed); the profile cards by their
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
// this file, `@use`d from styles.scss, scoped to this book's root (no
// component stylesheet: the host rule above is the component's whole style).
@Component({
  selector: 'lfx-mktg-framework-print',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgPortraitPlateDirective],
  templateUrl: './mktg-framework-print.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
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
  /** The framework book's middle dot the template joins a line's parts with (FRAMEWORK_PORTRAIT_SEP). */
  protected readonly dot = FRAMEWORK_PORTRAIT_SEP;
  /** The dash between an objection and its response, bound to the question by a no-break space (MKTG_PRINT_OBJECTION_DASH). */
  protected readonly objectionDash = MKTG_PRINT_OBJECTION_DASH;
  /** The frames, in the plan's order, each with its book page number, printed section label, band and laid-out data. */
  protected readonly frames = this.initFrames();
  /** The cover's edition line: `V1.0 · Approved 6 Nov 2026 · figures as of 4 Nov 2026`, less any clause the revision lacks. */
  protected readonly coverVersionLine = computed(() => {
    const view = this.view();
    return mktgPrintJoin([view.versionLabel, view.approvedLabel, view.dateReadLabel ? `figures as of ${view.dateReadLabel}` : ''], FRAMEWORK_PORTRAIT_SEP);
  });
  /**
   * The cover's strip by the grammar's rule (`mktgPortraitCoverStrip`, the kit cover's): the two halves on one line of the
   * content column; a long project name or host loses its segments after the name, then words with an ellipsis, before the
   * strip wraps, and then it wraps moved up a line so it ends where the one line did (`MKTG_PORTRAIT_COVER_STRIP`). The
   * left half is the book's foot line (`project · a Linux Foundation project`), whose segments the rule reads by the
   * grammar's own dot; the framework prints the segments it keeps with its separator (S-b), as it prints the right half
   * (`aaif.io · V1.0 · 6 Nov 2026`, less any part the revision lacks).
   */
  protected readonly coverStrip = computed(() => {
    const right = mktgPrintJoin([this.view().website, this.view().versionLabel, this.view().dateLabel], FRAMEWORK_PORTRAIT_SEP);
    const strip = mktgPortraitCoverStrip(this.resolvedBook().footLeft, right, MKTG_PORTRAIT_PAGE.contentWidth, this.resolvedLook().fontStack);
    const left = mktgPrintJoin(strip.left.split(MKTG_PORTRAIT_COVER_STRIP.separator), FRAMEWORK_PORTRAIT_SEP);
    return { ...strip, left, top: this.tops.coverStrip - (strip.wraps ? MKTG_PORTRAIT_COVER_STRIP.size * MKTG_PORTRAIT_COVER_STRIP.lineHeight : 0) };
  });
  /** The cover's umbrella, fitted to the dark band's room under the lockup and the tagline. */
  protected readonly coverUmbrella = computed(() => this.fit(this.view().mh.umbrella, TYPE.coverUmbrella, ROOM.coverUmbrellaWidth, ROOM.coverUmbrellaRoom));
  /**
   * The cover's lockup on the dark band: the kit grammar's artwork (supplied reversed, else the one-ink primary filtered to
   * white, else the full-colour primary on the white plate, `MktgPrintLogo.plate`). The plate is the grammar's `lfxPpPlate`
   * directive, given its outer height (the lockup in its padding, half the drawn height, above and below); the block starts
   * that padding higher so the artwork keeps its place (the kit cover's rule).
   */
  protected readonly coverLogo = computed(() => {
    const logo = this.view().brand.logoOnDark;
    if (!logo) return null;
    const padding = logo.plate ? mktgPortraitPlatePadding(ROOM.coverLogoHeight) : 0;
    return { ...logo, plateHeight: logo.plate ? ROOM.coverLogoHeight + 2 * padding : null, top: ROOM.coverLogoTop - padding };
  });
  /** The message house's umbrella bar, fitted to three lines. */
  protected readonly houseUmbrella = computed(() =>
    this.fit(this.view().mh.umbrella, TYPE.houseUmbrella, this.page.contentWidth - ROOM.houseUmbrellaPaddingAcross, ROOM.houseUmbrellaRoom)
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

  // === Private initializers ===

  /** The frames: the plan's pages with their book numbers and labels, and each page's data laid out once, here, not in the template (the fitted blocks are the header's list). */
  private initFrames(): Signal<FoundationMessagePrintFrame[]> {
    return computed((): FoundationMessagePrintFrame[] => {
      const view = this.view();
      const book = this.resolvedBook();
      const look = this.resolvedLook();
      const plan = frameworkPortraitPlan(view, { inFamily: book.inFamily });
      const icpPages = frameworkPortraitIcpPages(view.icps);
      const numbersPages = frameworkPortraitNumbersPages(view);
      const contents = frameworkPortraitContents(plan, book.firstPage);
      // The goal pages' titles at one size across the set (the editor's rule), the smallest any of them needs; the other pages fit their own.
      const goalPages = plan.filter((page) => /^goal-\d+$/.test(page.id));
      const goalTitles = new Map(frameworkPortraitTitlesAtOneSize(goalPages.map((page) => page.title)).map((fit, at) => [goalPages[at].id, fit]));
      return plan.map((page, index) => {
        // A goal page is keyed on the goal's position (frameworkPortraitPlan), never on its number: two goals may share an `n`.
        const goalAt = /^goal-(\d+)$/.exec(page.id);
        const goal = goalAt ? (view.goals[Number(goalAt[1]) - 1] ?? null) : null;
        const icpIndex = /^icps-\d+$/.test(page.id) ? Number(page.id.slice('icps-'.length)) : 0;
        const numbersIndex = this.pageIndex(page.id, this.ids.keyNumbers);
        const sayAvoid = page.id === this.ids.sayAvoid;
        // The anchors never move; their questions are set smaller, then cut, until they and the crosscut box end above the footer.
        const anchors = sayAvoid ? frameworkPortraitAnchors(view.mf.anchor, view.mf.crosscut) : { anchors: [], crosscutTop: 0 };
        const titleFit = goalTitles.get(page.id) ?? frameworkPortraitTitle(page.title);
        const matrix =
          page.id === this.ids.framework ? frameworkPortraitMatrix(view.goals, view.mf.crosscut, this.tops.footer - this.tops.matrix, look.fontStack) : null;
        return {
          ...page,
          number: book.firstPage + index,
          label: mktgPortraitSectionLabel(page.section, book.inFamily, FOUNDATION_MESSAGE_INTAKE.documentName),
          band: !book.inFamily && mktgPortraitOpensChapter(plan, index),
          titleFit,
          contents: page.id === this.ids.cover ? contents : null,
          statements: page.id === this.ids.framework ? this.statements(view) : null,
          matrix,
          // The matrix's bands with their goals (one strip, or bands of the board's four columns where the strip cannot hold the titles).
          matrixBands: matrix ? matrix.bands.map((band) => ({ ...band, goals: view.goals.slice(band.offset, band.offset + band.count) })) : [],
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
    // The three statements at ONE size (the editor's rule: never one card shrunk alone): each fitted to its card first, then every one set
    // at the smallest size any needed; a card already at the floor keeps the cut the fit gave it. The row is the board's box, the tallest card's.
    const cards = {
      vision: { text: view.mf.vision, width: frameworkPortraitStatementWidth(this.shares.vision) },
      mission: { text: view.mf.mission, width: frameworkPortraitStatementWidth(this.shares.mission) },
      positioning: { text: view.mf.positioning, width: frameworkPortraitStatementWidth(this.shares.positioning) },
    };
    const own = {
      vision: this.fit(cards.vision.text, TYPE.statement, cards.vision.width, cardsHeight),
      mission: this.fit(cards.mission.text, TYPE.statement, cards.mission.width, cardsHeight),
      positioning: this.fit(cards.positioning.text, TYPE.statement, cards.positioning.width, cardsHeight),
    };
    const size = Math.min(own.vision.size, own.mission.size, own.positioning.size);
    const atOne = (card: keyof typeof cards): FoundationMessagePrintFittedText =>
      own[card].size === size ? own[card] : this.fit(own[card].text, { ...TYPE.statement, size }, cards[card].width, cardsHeight);
    return {
      vision: atOne('vision'),
      mission: atOne('mission'),
      positioning: atOne('positioning'),
      tagline: this.fit(view.mf.tagline, { ...TYPE.tagline, size: frameworkPortraitTaglineSize(view.mf.tagline, taglineWidth) }, taglineWidth, cardsHeight),
    };
  }

  /** A goal's page: the value, the key message and the sound bite fitted to the room their fixed tops leave, the proof rows cut to what fits above the bite, the served cards' lines fitted. */
  private goalPage(goal: FoundationMessagePrintGoal, view: FoundationMessagePrintView, leadTop: number): FoundationMessagePrintGoalPage {
    const tops = this.tops;
    const width = this.page.contentWidth;
    const proofsRoom = tops.goalBite - tops.goalProofs - ROOM.label - ROOM.proofListTop - ROOM.gap;
    // A proof row is the fact beside its chip: the chip is capped at ROOM.chip (`.fwp-chip-wrap`) and wraps inside it, so the row is the
    // taller of the fact (measured against the rest) and the chip; the list is tightened before it is cut, and the cut is said under it.
    const factWidth = width - ROOM.chip - ROOM.proofGap;
    const proofRow = (proof: FoundationMessageProofView, type: FoundationMessagePrintType): number =>
      Math.max(this.paraHeight(proof.fact, type, factWidth), frameworkPortraitChipHeight(proof.source, ROOM.chip));
    const proofs = frameworkPortraitCutList(
      goal.proofRows,
      proofsRoom,
      (proof) => proofRow(proof, TYPE.goalProof) + ROOM.proofRow,
      (proof) => proofRow(proof, TYPE.goalProofTight) + ROOM.proofRowTight
    );
    // The "Who it's for" row holds as many cards as the board's narrowest card allows (four across); the rest are said under the row.
    const servedAll = goal.icps.map((id) => view.icps.find((icp) => icp.id === id)).filter((icp): icp is FoundationMessagePrintIcp => !!icp);
    const served = servedAll.slice(0, frameworkPortraitServedCount(width));
    const servedCut = servedAll.length - served.length;
    const cardWidth = served.length ? (width - (served.length - 1) * ROOM.servedGap) / served.length - ROOM.cardPaddingSide : width;
    // The cards' room: under the label and the row's margin, inside a card's padding and border, above the note the cut profiles take,
    // less the two fixed gaps between a card's lines (the stylesheet's margins, which the fit model's scale does not reach).
    const servedNote = servedCut > 0 ? frameworkPortraitCutNoteHeightIn(servedCut, width) : 0;
    const cardRoom =
      tops.footer - tops.goalServed - ROOM.label - ROOM.servedTop - ROOM.cardPadding - ROOM.cardBorder - servedNote - ROOM.servedLineTop - ROOM.servedLineGap;
    return {
      goal,
      numberLabel: mktgPortraitPageNumber(goal.n),
      leadTop,
      value: this.fit(
        goal.vp,
        TYPE.goalValue,
        width - ROOM.goalNumberWidth - ROOM.goalLeadGap,
        tops.goalKey - leadTop - ROOM.label - ROOM.goalValueTop - ROOM.gap
      ),
      key: this.fit(
        goal.key,
        TYPE.goalKey,
        width - ROOM.goalKeyPaddingAcross - ROOM.goalKeyGap - ROOM.goalKeyLabel,
        tops.goalProofs - tops.goalKey - ROOM.goalKeyPaddingDown - ROOM.gap
      ),
      proofs,
      // The sound bite at the board's fixed top (TOPS.goalBite, the mock's 690) on every goal page, fitted to the room above the served row;
      // its last two words joined (the grammar's widow rule), so a line never ends on one short word alone.
      bite: goal.bite
        ? this.noWidow(
            this.quoted(this.fit(`“${goal.bite}”`, TYPE.goalBite, width, tops.goalServed - tops.goalBite - ROOM.label - ROOM.goalBiteTop - ROOM.gap))
          )
        : null,
      served: {
        // The cards at one size across the row (the editor's S-a): each fitted with its name, then every one set at the smallest scale any needed.
        rows: frameworkPortraitServedCards(served, cardWidth, cardRoom),
        cut: servedCut,
        tight: false,
        note: servedCut > 0 ? foundationMessagePrintCutNote(servedCut) : '',
      },
    };
  }

  /** An ICP page: its profiles, its intro, the rows' top (under the long intro on the first page), the matrix when it holds one profile. */
  private icpPage(index: number, pages: FoundationMessagePrintIcpPageRows[], view: FoundationMessagePrintView): FoundationMessagePrintIcpPage {
    const rows = pages[index - 1] ?? { icps: [], tight: false, cut: false, height: 0 };
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
          ? `${total} ${total === 1 ? 'profile. It names' : 'profiles. Each names'} who they are, what they need, what ${project} gives them, the lead message, the call to action, the objection to expect and where to reach them. Goal numbers refer to the goal pages.`
          : foundationMessagePrintIcpPageIntro(start + 1, rows.icps.length, total),
      rowsTop,
      icps: rows.icps,
      tight: rows.tight,
      cut: rows.cut,
      matrix: matrixFits ? foundationMessagePrintMatrix(view.goals, view.icps) : [],
      matrixTop,
    };
  }

  /** The Sources & gaps page: an existing report's lists, each tightened then cut to the rows that fit above the approval card; with no report, the approval card alone. */
  private sourcesPage(view: FoundationMessagePrintView): FoundationMessagePrintSourcesPage {
    const date = view.dateReadLabel;
    const report = view.report;
    // A row's text width: the column less the bullet's indent (`.fwp-source-list`, ROOM.sourceBullet).
    const listWidth = this.columns.half - ROOM.sourceBullet;
    const columnRoom = this.tops.sourcesApproval - this.tops.sourcesLists - ROOM.gap;
    const rowHeight = (text: string): number => this.paraHeight(text, TYPE.source, listWidth);
    const tightHeight = (text: string): number => this.paraHeight(text, TYPE.sourceTight, listWidth);
    const list = (rows: readonly string[], room: number) => frameworkPortraitCutList(rows, room, rowHeight, tightHeight);
    let lists: FoundationMessagePrintSourcesPage['report'] = null;
    if (report) {
      const failedAll = report.sources_failed.map(
        (source) => `${foundationMessagePrintSourceLabel(source.name)} — ${foundationMessagePrintReportText(source.reason)}`
      );
      // The left column holds Read, then Could not be read: the failed list keeps its rows first (it is the shorter, and the gap it fills is the editor's), the read list takes what is left.
      const failedHeight =
        ROOM.blockAfter + ROOM.label + (failedAll.length ? failedAll.reduce((sum, row) => sum + rowHeight(row), 0) : rowHeight(this.noSourceFailed));
      const read = list(foundationMessagePrintSourceRows(report.sources_read), columnRoom - ROOM.label - Math.min(failedHeight, columnRoom / 2));
      // Then the failed list takes what the Read block leaves as it prints (its heading, its rows at the measure they print at, its cut
      // note and the gap under it, each only when present): a short or empty Read block leaves the failures the whole column, never half by rule.
      const readPrinted = read.rows.length > 0 || read.cut > 0;
      const readHeight = readPrinted
        ? ROOM.label +
          read.rows.reduce((sum, row) => sum + (read.tight ? tightHeight(row) : rowHeight(row)), 0) +
          (read.cut > 0 ? frameworkPortraitCutNoteHeight() : 0) +
          ROOM.blockAfter
        : 0;
      lists = {
        intro: date
          ? `What the framework was built from on ${date}, what could not be read, and what is still open.`
          : 'What the framework was built from, what could not be read, and what is still open.',
        read,
        failed: list(failedAll, columnRoom - readHeight - ROOM.label),
        failedCount: report.sources_failed.length,
        gaps: list(report.gaps.map(foundationMessagePrintReportText), columnRoom - ROOM.label),
        gapsCount: report.gaps.length,
      };
    }
    const lead = [view.versionLabel, view.approvedLabel].filter((part) => part !== '');
    const gapsClause = view.approvedLabel && (report?.gaps.length ?? 0) > 0 ? 'The gaps above were open at approval. ' : '';
    return {
      report: lists,
      approvalLead: lead.length ? `${mktgPrintJoin(lead, FRAMEWORK_PORTRAIT_SEP)}.` : '',
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

  /** A fitted quotation with its closing mark restored when the cut at a sentence dropped it (the mark is one character past a sentence end, inside the slack the cut leaves). */
  private quoted(fitted: FoundationMessagePrintFittedText): FoundationMessagePrintFittedText {
    return fitted.text.endsWith('”') ? fitted : { text: `${fitted.text}”`, size: fitted.size };
  }

  /** A fitted headline with its last two words joined (the grammar's widow rule): the measure is the same, the break before the last word is not. */
  private noWidow(fitted: FoundationMessagePrintFittedText): FoundationMessagePrintFittedText {
    return { text: mktgNoWidow(fitted.text), size: fitted.size };
  }

  /** The height a paragraph takes at its type in a column, px (the fit model's measure). */
  private paraHeight(text: string, type: FoundationMessagePrintType, width: number): number {
    return mktgPortraitParaHeight(this.para(text, type), width);
  }

  private para(text: string, type: FoundationMessagePrintType): MktgPortraitFitPara {
    return { text, size: type.size, line: type.line, weight: type.weight };
  }
}
