// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Messaging Framework's portrait book: the lists its pages cut and the
// key numbers' pages, pure over the print view and the portrait fit model,
// so the plan (`frameworkPortraitPlan`) can count the pages the data needs
// and the component can print the same rows. The rules are the design
// reader's (7 Nov 2026): a list that will not fit its room is tightened
// first (its tight type and padding), then cut to whole rows, and a muted
// line under it says how many more there are, never a silent cut; the key
// numbers print as tiles up to FRAMEWORK_PORTRAIT_MAX_TILES by the count's
// layout, and as a table of every figure past that, continued on another
// page when a page is full, never cut.

import {
  FOUNDATION_MESSAGE_PRINT_ICPS_PER_PAGE,
  FRAMEWORK_PORTRAIT_FACT_COLUMNS,
  FRAMEWORK_PORTRAIT_MAX_TILES,
  FRAMEWORK_PORTRAIT_NUMBER_COLUMNS,
  FRAMEWORK_PORTRAIT_NUMBER_TILE,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_STATEMENT_SHARES,
  FRAMEWORK_PORTRAIT_TILE_SHARES,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
  mktgPrintJoin,
} from '../constants/mktg-print.constants';
import { MKTG_PORTRAIT_PAGE } from '../constants/mktg-portrait-print.constants';
import type { FoundationMessageNumberRow } from '../interfaces/foundation-message.interface';
import type {
  FoundationMessageAudienceRow,
  FoundationMessageAvoidRow,
  FoundationMessagePillarView,
  FoundationMessageProofView,
} from '../interfaces/foundation-message.interface';
import type {
  FoundationMessagePrintAnchorRow,
  FoundationMessagePrintCutList,
  FoundationMessagePrintCutTab,
  FoundationMessagePrintFittedText,
  FoundationMessagePrintFittedTitle,
  FoundationMessagePrintGoal,
  FoundationMessagePrintGoalProof,
  FoundationMessagePrintHousePage,
  FoundationMessagePrintIcp,
  FoundationMessagePrintIcpPageRows,
  FoundationMessagePrintMatrix,
  FoundationMessagePrintMatrixCell,
  FoundationMessagePrintNumber,
  FoundationMessagePrintFactRow,
  FoundationMessagePrintNumbersPage,
  FoundationMessagePrintNumberTile,
  FoundationMessagePrintType,
  FoundationMessagePrintView,
} from '../interfaces/mktg-print.interface';
import { MKTG_PORTRAIT_FIT } from '../constants/mktg-portrait-print.constants';
import {
  mktgPortraitCharEm,
  mktgPortraitCharsPerLine,
  mktgPortraitFitBlock,
  mktgPortraitPageNumber,
  mktgPortraitParaHeight,
  mktgPortraitWrapLines,
} from './mktg-portrait-print.utils';

const ROOM = FRAMEWORK_PORTRAIT_ROOM;
const TYPE = FRAMEWORK_PORTRAIT_TYPE;
const TOPS = FRAMEWORK_PORTRAIT_TOPS;
const PAGE = MKTG_PORTRAIT_PAGE;
const FIT = MKTG_PORTRAIT_FIT;

/** The line under a cut list: `+3 more on the framework's Sources tab in LFX One` (the design reader's form, 7 Nov 2026). */
export function foundationMessagePrintCutNote(cut: number, tab: FoundationMessagePrintCutTab): string {
  return `+${cut} more on the framework's ${tab} tab in LFX One`;
}

/** The height a text takes at a type in a column, px. */
export function frameworkPortraitTextHeight(text: string, type: FoundationMessagePrintType, width: number): number {
  return mktgPortraitParaHeight({ text, size: type.size, line: type.line, weight: type.weight }, width);
}

/** The room the muted line under a cut list takes: its gap above and one line. */
export function frameworkPortraitCutNoteHeight(): number {
  return ROOM.cutNoteGap + TYPE.cutNote.size * TYPE.cutNote.line;
}

/**
 * A list fitted to its room by the design reader's rule: every row at the normal measure when they all fit; else every
 * row at the tight measure when they all fit; else the leading whole rows that fit at the tight measure with the cut
 * note under them. Nothing is added in a cut row's place; the note's count is the rows left off.
 */
export function frameworkPortraitCutList<T>(
  rows: readonly T[],
  room: number,
  tab: FoundationMessagePrintCutTab,
  normal: (row: T) => number,
  tight: (row: T) => number,
  noteHeight = frameworkPortraitCutNoteHeight()
): FoundationMessagePrintCutList<T> {
  const total = (measure: (row: T) => number): number => rows.reduce((sum, row) => sum + measure(row), 0);
  if (total(normal) <= room) return { rows: [...rows], cut: 0, tight: false, note: '' };
  if (total(tight) <= room) return { rows: [...rows], cut: 0, tight: true, note: '' };
  const kept: T[] = [];
  let used = noteHeight;
  for (const row of rows) {
    used += tight(row);
    if (used > room) break;
    kept.push(row);
  }
  const cut = rows.length - kept.length;
  return { rows: kept, cut, tight: true, note: foundationMessagePrintCutNote(cut, tab) };
}

/** The size at which a figure sits on one line of `width` px, stepped down from the tile figure's size in whole px, never under half of it. */
export function frameworkPortraitFigureSize(figure: string, width: number): number {
  const type = TYPE.tileFigure;
  let size = type.size;
  while (size > type.size / 2 && mktgPortraitCharsPerLine(width, size, { weight: type.weight }) < figure.length) size -= 1;
  return size;
}

/**
 * The tiles for a count the tiles hold (1 to FRAMEWORK_PORTRAIT_MAX_TILES), each with its share of a row and its text fitted to the
 * tile: the figure on one line, the label in the room under it less the source pill's when the figure has a source; none past that.
 */
export function frameworkPortraitNumberTiles(numbers: readonly FoundationMessagePrintNumber[]): FoundationMessagePrintNumberTile[] {
  const shares: readonly number[] | undefined = FRAMEWORK_PORTRAIT_TILE_SHARES[numbers.length as keyof typeof FRAMEWORK_PORTRAIT_TILE_SHARES];
  if (!shares || numbers.length > FRAMEWORK_PORTRAIT_MAX_TILES) return [];
  const tile = FRAMEWORK_PORTRAIT_NUMBER_TILE;
  return numbers.map((row, index) => {
    const share = shares[index];
    // A tile's content width: its share of the row less the gaps between tiles, less the side padding.
    const width = (PAGE.contentWidth - (share - 1) * tile.gap) / share - 2 * tile.paddingSide;
    const figureSize = frameworkPortraitFigureSize(row.number, width);
    const pillRoom = row.source ? tile.labelGap + tile.sourceHeight : 0;
    const labelRoom = tile.height - 2 * tile.paddingTop - figureSize * TYPE.tileFigure.line - tile.labelGap - pillRoom;
    const label = mktgPortraitFitBlock({ paras: [{ text: row.label, ...TYPE.tileLabel }] }, width, labelRoom).block.paras[0];
    return { ...row, share, wide: share === 1, figureSize, labelText: label?.text ?? row.label, labelSize: label?.size ?? TYPE.tileLabel.size };
  });
}

/** The height of a key numbers table row at the fact type: the taller of its two cells, with the row's padding and hairline. */
function numbersRowHeight(row: FoundationMessageNumberRow, tight: boolean): number {
  const [figure, label] = FRAMEWORK_PORTRAIT_NUMBER_COLUMNS.map((share) => (PAGE.contentWidth * share) / 100 - ROOM.factCellPadding);
  return (
    Math.max(frameworkPortraitTextHeight(row.number, TYPE.fact, figure), frameworkPortraitTextHeight(row.label, TYPE.fact, label)) +
    (tight ? ROOM.factRowTight : ROOM.factRow)
  );
}

/** The room the muted line under a cut list takes in a column `width` px wide: its gap above and its wrapped lines. */
export function frameworkPortraitCutNoteHeightIn(cut: number, tab: FoundationMessagePrintCutTab, width: number): number {
  return ROOM.cutNoteGap + frameworkPortraitTextHeight(foundationMessagePrintCutNote(cut, tab), TYPE.cutNote, width);
}

/**
 * A page's title in the grammar's title room: one line at the grammar's 34 px where it fits, smaller in whole px to the fit
 * model's floor where that holds it on one line, and at the floor over the lines it needs past that, never cut; the lines
 * say how much room the page's first block must leave it. The goal pages' `Goal 2 · <title>` is the one that can run long.
 */
export function frameworkPortraitTitle(title: string): FoundationMessagePrintFittedTitle {
  const type = TYPE.pageTitle;
  const width = PAGE.contentWidth;
  const floor = Math.ceil(type.size * FIT.minScale);
  for (let size = type.size; size >= floor; size -= 1) {
    if (mktgPortraitCharsPerLine(width, size, { weight: type.weight }) >= title.length) return { text: title, size, lines: 1 };
  }
  return { text: title, size: floor, lines: mktgPortraitWrapLines(title, mktgPortraitCharsPerLine(width, floor, { weight: type.weight })) };
}

/** The top of a page's first block under its title: the design's body top, lower by the lines a title takes past its first. */
export function frameworkPortraitBodyTop(title: FoundationMessagePrintFittedTitle): number {
  return PAGE.bodyTop + (title.lines - 1) * title.size * TYPE.pageTitle.line;
}

/** A statement card's text width, px: the card's share of the row less the gaps, less its padding (and the tagline's rule and inset). */
export function frameworkPortraitStatementWidth(share: number, tagline = false): number {
  const shares = FRAMEWORK_PORTRAIT_STATEMENT_SHARES;
  const total = shares.vision + shares.mission + shares.positioning + shares.tagline;
  const row = PAGE.contentWidth - 3 * ROOM.statementGap;
  return (row * share) / total - ROOM.statementPadding - (tagline ? ROOM.taglineInset : 0);
}

/**
 * The tagline's size in its card: the design's 18 px where a line holds two words, else smaller in whole px, to the fit
 * model's floor, until the longest pair of neighboring words fits one line (no one-word lines, the editor's rule). A
 * tagline of one word keeps the design's size.
 */
export function frameworkPortraitTaglineSize(tagline: string, width: number): number {
  const words = tagline.split(/\s+/).filter((word) => word !== '');
  const pairs = words.slice(1).map((word, index) => words[index].length + 1 + word.length);
  const longest = pairs.length ? Math.max(...pairs) : 0;
  const type = TYPE.tagline;
  const floor = Math.ceil(type.size * FIT.minScale);
  for (let size = type.size; size > floor; size -= 1) {
    if (mktgPortraitCharsPerLine(width, size, { weight: type.weight }) >= longest) return size;
  }
  return floor;
}

/** A goal matrix column's width, px: the content width less the row's padding, the label column and the gaps, shared by the goals. */
export function frameworkPortraitMatrixColumn(goals: number): number {
  return (PAGE.contentWidth - ROOM.matrixPadding - ROOM.matrixLabelColumn - goals * ROOM.matrixGap) / Math.max(1, goals);
}

/** A text fitted into a `width` × `height` box at `type` by the portrait fit model: smaller first (to its floor), then cut at a sentence. */
function fitText(text: string, type: FoundationMessagePrintType, width: number, height: number): FoundationMessagePrintFittedText {
  const para = mktgPortraitFitBlock({ paras: [{ text, ...type }] }, width, Math.max(0, height)).block.paras[0];
  return { text: para?.text ?? text, size: para?.size ?? type.size };
}

/**
 * The framework page's goal matrix, bounded in its `room`: the head row and the crosscut measured at their type; the
 * value, key message and sound bite rows at their type where the three leave the proofs row at least its note (the
 * muted line at the count every proof would make), else each cell fitted by the portrait fit model (smaller first,
 * then cut at a sentence) into the rows' share of the room that stays; then each goal's proof cell a cut list in the
 * room the fitted rows leave (tightened first, then whole rows with the muted line). The matrix's height is returned
 * with it, and is at most the room, so the sound bite row stays above the footer whatever the record runs to.
 */
export function frameworkPortraitMatrix(goals: readonly FoundationMessagePrintGoal[], crosscut: string, room: number): FoundationMessagePrintMatrix {
  const column = frameworkPortraitMatrixColumn(goals.length);
  const biteWidth = column - ROOM.matrixBiteInset;
  const tallest = (heights: readonly number[]): number => heights.reduce((max, height) => Math.max(max, height), 0);
  const head =
    ROOM.matrixRow + TYPE.cutNote.size * TYPE.cutNote.line + 3 + tallest(goals.map((goal) => frameworkPortraitTextHeight(goal.t, TYPE.matrixGoal, column)));
  const note = crosscut ? ROOM.matrixCrosscutGap + frameworkPortraitTextHeight(crosscut, TYPE.matrixCrosscut, PAGE.contentWidth - ROOM.matrixPadding) : 0;
  // The proofs row keeps at least its chrome and the note at the count every proof would make: never less, whatever the text rows run to.
  const mostProofs = tallest(goals.map((goal) => goal.proofRows.length));
  const proofsLeast = ROOM.matrixRow + (mostProofs > 0 ? frameworkPortraitCutNoteHeightIn(mostProofs, 'Framework', column) : 0);
  const quoted = (bite: string): string => `“${bite}”`;
  const measure = (cells: readonly FoundationMessagePrintMatrixCell[]): { value: number; key: number; bite: number } => ({
    value: ROOM.matrixRow + tallest(cells.map((cell) => frameworkPortraitTextHeight(cell.vp.text, { ...TYPE.matrixCell, size: cell.vp.size }, column))),
    key: ROOM.matrixRow + tallest(cells.map((cell) => frameworkPortraitTextHeight(cell.key.text, { ...TYPE.matrixKey, size: cell.key.size }, column))),
    bite:
      ROOM.matrixRow +
      tallest(
        cells.map((cell) => (cell.bite ? frameworkPortraitTextHeight(quoted(cell.bite.text), { ...TYPE.matrixBite, size: cell.bite.size }, biteWidth) : 0))
      ),
  });
  let cells: FoundationMessagePrintMatrixCell[] = goals.map((goal) => ({
    vp: { text: goal.vp, size: TYPE.matrixCell.size },
    key: { text: goal.key, size: TYPE.matrixKey.size },
    bite: goal.bite ? { text: goal.bite, size: TYPE.matrixBite.size } : null,
  }));
  let rows = measure(cells);
  const textRoom = room - head - note - proofsLeast;
  const natural = rows.value + rows.key + rows.bite;
  if (natural > textRoom) {
    // Each row's text gets its share of the room that stays, by its natural height; the cells are fitted into it.
    const chrome = 3 * ROOM.matrixRow;
    const share = (height: number): number => ((textRoom - chrome) * (height - ROOM.matrixRow)) / Math.max(1, natural - chrome);
    const valueRoom = share(rows.value);
    const keyRoom = share(rows.key);
    const biteRoom = share(rows.bite);
    cells = goals.map((goal) => ({
      vp: fitText(goal.vp, TYPE.matrixCell, column, valueRoom),
      key: fitText(goal.key, TYPE.matrixKey, column, keyRoom),
      bite: goal.bite
        ? fitText(goal.bite, TYPE.matrixBite, biteWidth - 2 * TYPE.matrixBite.size * mktgPortraitCharEm({ weight: TYPE.matrixBite.weight }), biteRoom)
        : null,
    }));
    rows = measure(cells);
  }
  const proofsRoom = Math.max(proofsLeast - ROOM.matrixRow, room - head - note - ROOM.matrixRow - rows.value - rows.key - rows.bite);
  const proofRow = (proof: FoundationMessagePrintGoalProof, type: FoundationMessagePrintType): number =>
    frameworkPortraitTextHeight(`${proof.fact} ${proof.source}`, type, column) + ROOM.matrixProofGap;
  const proofs = goals.map((goal) =>
    frameworkPortraitCutList(
      goal.proofRows,
      proofsRoom,
      'Framework',
      (proof) => proofRow(proof, TYPE.matrixProof),
      (proof) => proofRow(proof, TYPE.matrixProofTight),
      frameworkPortraitCutNoteHeightIn(1, 'Framework', column)
    )
  );
  const proofsHeight =
    ROOM.matrixRow +
    tallest(
      proofs.map(
        (cell) =>
          cell.rows.reduce((sum, proof) => sum + proofRow(proof, cell.tight ? TYPE.matrixProofTight : TYPE.matrixProof), 0) +
          (cell.cut > 0 ? frameworkPortraitCutNoteHeightIn(cell.cut, 'Framework', column) : 0)
      )
    );
  return { cells, proofs, height: head + rows.value + rows.key + rows.bite + proofsHeight + note };
}

/** The width a say pill takes, px: its text at the pill's type plus its padding and border, at the normal or the tight measure. */
export function frameworkPortraitPillWidth(text: string, tight: boolean): number {
  const type = tight ? TYPE.sayPillTight : TYPE.sayPill;
  return (
    Math.ceil(text.length * type.size * mktgPortraitCharEm({ weight: type.weight })) + (tight ? ROOM.sayPillPaddingAcrossTight : ROOM.sayPillPaddingAcross)
  );
}

/** The height a row of pills wraps to in a column `width` px wide: the pills packed greedily, a line's height each row, the gap between rows. */
export function frameworkPortraitPillsHeight(pills: readonly string[], width: number, tight: boolean): number {
  if (pills.length === 0) return 0;
  const type = tight ? TYPE.sayPillTight : TYPE.sayPill;
  const line = type.size * type.line + (tight ? ROOM.sayPillPaddingTight : ROOM.sayPillPadding);
  let rows = 1;
  let used = 0;
  for (const pill of pills) {
    const pillWidth = Math.min(width, frameworkPortraitPillWidth(pill, tight));
    if (used > 0 && used + ROOM.sayPillGap + pillWidth > width) {
      rows += 1;
      used = pillWidth;
    } else {
      used += (used > 0 ? ROOM.sayPillGap : 0) + pillWidth;
    }
  }
  return rows * line + (rows - 1) * ROOM.sayPillGap;
}

/**
 * The say pills fitted to their column by the design reader's rule: every pill at the normal measure when the rows fit; else
 * every pill at the tight measure; else the leading pills that fit at the tight measure with the muted line under them.
 */
export function frameworkPortraitPillList(pills: readonly string[], width: number, room: number): FoundationMessagePrintCutList<string> {
  if (frameworkPortraitPillsHeight(pills, width, false) <= room) return { rows: [...pills], cut: 0, tight: false, note: '' };
  if (frameworkPortraitPillsHeight(pills, width, true) <= room) return { rows: [...pills], cut: 0, tight: true, note: '' };
  let kept = pills.length - 1;
  while (
    kept > 0 &&
    frameworkPortraitPillsHeight(pills.slice(0, kept), width, true) + frameworkPortraitCutNoteHeightIn(pills.length - kept, 'Framework', width) > room
  )
    kept -= 1;
  const cut = pills.length - kept;
  return { rows: pills.slice(0, kept), cut, tight: true, note: foundationMessagePrintCutNote(cut, 'Framework') };
}

/** The height an avoid row takes: the taller of its two cells (each half the column less the arrow), the row's padding and hairline. */
export function frameworkPortraitAvoidRowHeight(row: FoundationMessageAvoidRow, width: number, tight: boolean): number {
  const type = tight ? TYPE.avoidRowTight : TYPE.avoidRow;
  const cell = (width - ROOM.avoidArrow) / 2;
  return (
    Math.max(frameworkPortraitTextHeight(row.avoid, type, cell), frameworkPortraitTextHeight(row.instead, type, cell)) +
    (tight ? ROOM.avoidRowTight : ROOM.avoidRow)
  );
}

/** The avoid rows fitted to their column: tightened first, then cut to whole rows with the muted line (the design reader's rule). */
export function frameworkPortraitAvoidList(
  rows: readonly FoundationMessageAvoidRow[],
  width: number,
  room: number
): FoundationMessagePrintCutList<FoundationMessageAvoidRow> {
  return frameworkPortraitCutList(
    rows,
    room,
    'Framework',
    (row) => frameworkPortraitAvoidRowHeight(row, width, false),
    (row) => frameworkPortraitAvoidRowHeight(row, width, true),
    frameworkPortraitCutNoteHeightIn(1, 'Framework', width)
  );
}

/** The room the say and avoid lists share: from their top to the anchors' top, less the label, the list's margin and a gap. */
export function frameworkPortraitSayRoom(): number {
  return TOPS.anchors - TOPS.sayLists - ROOM.label - ROOM.sayListTop - ROOM.gap;
}

/** The height an anchor row takes at a question size: the taller of the number and the question's lines, the row's padding and hairline. */
function anchorRowHeight(question: string, size: number): number {
  const width = PAGE.contentWidth - ROOM.anchorNumber - ROOM.anchorGap;
  const questionHeight = frameworkPortraitTextHeight(question, { ...TYPE.anchorQuestion, size }, width);
  return Math.max(TYPE.anchorNumber.size * TYPE.anchorNumber.line, questionHeight) + ROOM.anchorRow;
}

/** The height of the crosscut box: its padding, the label, the text's margin and its lines. */
function crosscutHeight(crosscut: string): number {
  return (
    ROOM.crosscutPadding +
    ROOM.label +
    ROOM.crosscutTextTop +
    frameworkPortraitTextHeight(crosscut, TYPE.crosscutText, PAGE.contentWidth - ROOM.crosscutPaddingAcross)
  );
}

/**
 * The anchor questions and the crosscut box on the say-and-avoid page: the anchors never move (their top is the design's);
 * their questions are set smaller, in the fit model's steps to its floor, then cut, until the block and the crosscut box
 * under it end above the footer; the crosscut box sits at the design's top, or under the anchors when they run longer.
 */
export function frameworkPortraitAnchors(questions: readonly string[], crosscut: string): { anchors: FoundationMessagePrintAnchorRow[]; crosscutTop: number } {
  const footer = TOPS.footer;
  const listTop = TOPS.anchors + ROOM.label + ROOM.anchorListTop;
  const boxHeight = crosscut ? crosscutHeight(crosscut) + ROOM.gap : 0;
  const room = footer - listTop - boxHeight;
  const rows = (texts: readonly string[], size: number): FoundationMessagePrintAnchorRow[] =>
    texts.map((question, rank) => ({ numberLabel: mktgPortraitPageNumber(rank + 1), question, size }));
  const finish = (anchors: FoundationMessagePrintAnchorRow[]): { anchors: FoundationMessagePrintAnchorRow[]; crosscutTop: number } => {
    const bottom = listTop + anchors.reduce((sum, anchor) => sum + anchorRowHeight(anchor.question, anchor.size), 0);
    return { anchors, crosscutTop: Math.max(TOPS.sayCrosscut, bottom + ROOM.gap) };
  };
  const size = TYPE.anchorQuestion.size;
  for (let scale = 1; scale >= FIT.minScale - 1e-9; scale -= FIT.scaleStep) {
    const stepped = Math.round(size * scale * 10) / 10;
    if (questions.reduce((sum, question) => sum + anchorRowHeight(question, stepped), 0) <= room) return finish(rows(questions, stepped));
  }
  // Past the floor: the fit model takes the questions to its floor and cuts them at a sentence, in the room less the rows' own chrome.
  const chrome = questions.length * ROOM.anchorRow;
  const width = PAGE.contentWidth - ROOM.anchorNumber - ROOM.anchorGap;
  const fitted = mktgPortraitFitBlock(
    { paras: questions.map((question) => ({ text: question, size, line: TYPE.anchorQuestion.line, weight: TYPE.anchorQuestion.weight })) },
    width,
    Math.max(0, room - chrome)
  );
  return finish(fitted.block.paras.map((para, rank) => ({ numberLabel: mktgPortraitPageNumber(rank + 1), question: para.text, size: para.size })));
}

/** The height a pillar's fixed part takes in a column `width` px wide: its rule and padding, title and message. */
export function frameworkPortraitPillarHeadHeight(pillar: FoundationMessagePillarView, width: number): number {
  const message = pillar.m ? ROOM.pillarMessageTop + frameworkPortraitTextHeight(pillar.m, TYPE.pillarMessage, width) : 0;
  return ROOM.pillarTop + frameworkPortraitTextHeight(pillar.t, TYPE.pillarTitle, width) + message;
}

/** The height a pillar's proof row takes: its hairline and padding, the fact's lines and the source chip's line. */
export function frameworkPortraitPillarProofHeight(proof: FoundationMessageProofView, width: number): number {
  return ROOM.pillarProofRow + frameworkPortraitTextHeight(proof.fact, TYPE.pillarProof, width) + ROOM.pillarProofChip;
}

/** The height a pillar takes with the proof rows it prints: its head, then the list's margin and the rows (and the cut's line). */
function pillarHeight(pillar: FoundationMessagePillarView, proofs: FoundationMessagePrintCutList<FoundationMessageProofView>, width: number): number {
  const rows = proofs.rows.reduce((sum, proof) => sum + frameworkPortraitPillarProofHeight(proof, width), 0);
  const note = proofs.cut > 0 ? frameworkPortraitCutNoteHeightIn(proofs.cut, 'Framework', width) : 0;
  return frameworkPortraitPillarHeadHeight(pillar, width) + (pillar.proofRows.length ? ROOM.pillarProofsTop + rows + note : 0);
}

/**
 * The message house page, bounded: each pillar's proofs cut to whole rows in the room that leaves the lower blocks their
 * least (the design reader's rule; a pillar's proofs have no tight measure, so the cut is to whole rows and the muted
 * line); then Why now and the audiences a gap under the tallest pillar, where the umbrella, the brand line and the pillars
 * end (the editor's read, 7 Nov 2026: no empty band at the design's fixed 780), the Why now text fitted and the audiences
 * cut to the whole rows that end above the footer.
 */
export function frameworkPortraitHouse(view: FoundationMessagePrintView, umbrella: FoundationMessagePrintFittedText): FoundationMessagePrintHousePage {
  const width = PAGE.contentWidth;
  const umbrellaHeight = umbrella.text
    ? ROOM.houseUmbrellaPadding +
      frameworkPortraitTextHeight(umbrella.text, { ...TYPE.houseUmbrella, size: umbrella.size }, width - ROOM.houseUmbrellaPaddingAcross)
    : 0;
  const line = view.mh.line ? ROOM.houseLineMargins + TYPE.houseLine.size * TYPE.houseLine.line : 0;
  const count = Math.max(1, view.pillars.length);
  const column = (width - (count - 1) * ROOM.pillarGap) / count;
  const pillarsTop = TOPS.house + umbrellaHeight + line;
  const pillarsRoom = TOPS.footer - ROOM.houseLowerMin - ROOM.houseLowerGap - pillarsTop;
  const pillars = view.pillars.map((pillar) => {
    const measure = (proof: FoundationMessageProofView): number => frameworkPortraitPillarProofHeight(proof, column);
    const room = pillarsRoom - frameworkPortraitPillarHeadHeight(pillar, column) - ROOM.pillarProofsTop;
    return frameworkPortraitCutList(pillar.proofRows, room, 'Framework', measure, measure, frameworkPortraitCutNoteHeightIn(1, 'Framework', column));
  });
  const tallest = view.pillars.reduce((max, pillar, index) => Math.max(max, pillarHeight(pillar, pillars[index], column)), 0);
  const top = pillarsTop + tallest + ROOM.houseLowerGap;
  const room = TOPS.footer - top - ROOM.label;
  const whyNow = view.mh.found
    ? mktgPortraitFitBlock({ paras: [{ text: view.mh.found, ...TYPE.whyNow }] }, ROOM.whyNowColumn, room - ROOM.whyNowTextTop).block.paras[0]
    : null;
  const audienceRow = (audience: FoundationMessageAudienceRow, type: FoundationMessagePrintType, chrome: number): number =>
    frameworkPortraitTextHeight(`${audience.name}. ${audience.lead}`, type, ROOM.audiencesColumn) + chrome;
  return {
    pillars,
    lowerTop: top,
    whyNow: whyNow ? { text: whyNow.text, size: whyNow.size } : null,
    audiences: frameworkPortraitCutList(
      view.audiences,
      room - ROOM.audienceListTop,
      'Framework',
      (audience) => audienceRow(audience, TYPE.audienceRow, ROOM.audienceRow),
      (audience) => audienceRow(audience, TYPE.audienceRowTight, ROOM.audienceRowTight),
      frameworkPortraitCutNoteHeightIn(1, 'Framework', ROOM.audiencesColumn)
    ),
  };
}

/**
 * The height a profile card takes across the page, px: its hairline and padding, then the taller of its two columns, the
 * name-and-tags column (the name, the chips line, the who text, the persona rows, at the card's own who width) and the
 * fields grid (the fields the profile has, three a row, each its eyebrow and text, the channels field holding the proof
 * rows), at the fields' normal or tight measure.
 */
export function frameworkPortraitIcpHeight(icp: FoundationMessagePrintIcp, tight = false): number {
  const field = tight ? TYPE.icpFieldTight : TYPE.icpField;
  const who = icp.whoWidth;
  const whoColumn =
    frameworkPortraitTextHeight(icp.name, TYPE.icpName, who) +
    ROOM.icpChipsTop +
    ROOM.icpChipLine +
    (icp.who ? ROOM.icpWhoTextTop + frameworkPortraitTextHeight(icp.who, TYPE.icpWho, who) : 0) +
    (icp.personaRows.length
      ? ROOM.icpPersonasTop +
        icp.personaRows.reduce((sum, persona) => sum + frameworkPortraitTextHeight(mktgPrintJoin([persona.role, persona.cares]), TYPE.icpPersona, who), 0)
      : 0);
  const column = (PAGE.contentWidth - who - ROOM.icpColumnGap - 2 * ROOM.icpGridColumnGap) / 3;
  const texts: string[] = [];
  if (icp.need) texts.push(icp.need);
  if (icp.value) texts.push(icp.value);
  if (icp.lead) texts.push(icp.lead);
  if (icp.cta) texts.push(icp.cta);
  if (icp.objectionText) texts.push(icp.objectionResponse ? `“${icp.objectionText}” — ${icp.objectionResponse}` : `“${icp.objectionText}”`);
  const fields = texts.map((text) => frameworkPortraitTextHeight(text, field, column));
  if (icp.channelsLabel || icp.proofRows.length > 0) {
    const proofs = icp.proofRows.reduce((sum, proof) => sum + frameworkPortraitTextHeight(`${proof.fact} ${proof.source}`, field, column), 0);
    fields.push(
      (icp.channelsLabel ? frameworkPortraitTextHeight(icp.channelsLabel, field, column) : 0) + (icp.proofRows.length ? ROOM.icpProofsTop + proofs : 0)
    );
  }
  const eyebrow = TYPE.icpEyebrow.size * TYPE.icpEyebrow.line + ROOM.icpFieldGap;
  let grid = 0;
  for (let row = 0; row < fields.length; row += 3) {
    grid += (row > 0 ? ROOM.icpGridRowGap : 0) + eyebrow + Math.max(...fields.slice(row, row + 3));
  }
  return ROOM.icpRow + Math.max(whoColumn, grid);
}

/** The room an ICP page's cards have: from the rows' top (under the long intro on the first page) to the footer rule, less the card's least room above it. */
export function frameworkPortraitIcpRoom(pageIndex: number): number {
  return TOPS.footer - ROOM.icpFooterRoom - (pageIndex === 1 ? TOPS.icpRowsFirst : TOPS.icpRows);
}

/**
 * The profiles paged in data order, two a page at most (the design), fewer where two measured cards would end past the
 * footer: a card never crosses the footer rule, so a profile that would moves whole to the next page (the harness's A4
 * finding: the last line crossed it). A card alone that outruns its page sets its fields at the tight measure.
 */
export function frameworkPortraitIcpPages(icps: readonly FoundationMessagePrintIcp[]): FoundationMessagePrintIcpPageRows[] {
  const pages: FoundationMessagePrintIcpPageRows[] = [];
  for (const icp of icps) {
    const height = frameworkPortraitIcpHeight(icp);
    const last = pages[pages.length - 1];
    if (last && !last.tight && last.icps.length < FOUNDATION_MESSAGE_PRINT_ICPS_PER_PAGE && last.height + height <= frameworkPortraitIcpRoom(pages.length)) {
      last.icps.push(icp);
      last.height += height;
      continue;
    }
    const tight = height > frameworkPortraitIcpRoom(pages.length + 1);
    pages.push({ icps: [icp], tight, height: tight ? frameworkPortraitIcpHeight(icp, true) : height });
  }
  return pages;
}

/** The height the goals × profiles matrix takes under a lone card: its label, note, head row and one cell row per profile. */
export function frameworkPortraitIcpMatrixHeight(rows: number): number {
  return (
    ROOM.label +
    ROOM.matrixNoteTop +
    TYPE.matrixNote.size * TYPE.matrixNote.line +
    ROOM.matrixTableTop +
    ROOM.matrixHeadRow +
    2 * TYPE.matrixHead.size * TYPE.matrixHead.line +
    rows * (ROOM.matrixCellRow + TYPE.matrixCellText.size * TYPE.matrixCellText.line)
  );
}

/** The width a chip takes, px: its text in the grammar's capitals at `.pp-chip`'s size, plus its padding and border. */
export function frameworkPortraitChipWidth(text: string): number {
  return Math.ceil(text.trim().length * ROOM.chipSize * mktgPortraitCharEm({ caps: true })) + ROOM.chipPadding;
}

/**
 * The width of a profile's name-and-tags column, px: the board's 190, grown to hold the kind and goal tags on one line (they never
 * wrap, the editor's rule), to a cap that leaves the fields their three columns.
 */
export function frameworkPortraitIcpWhoWidth(chips: readonly string[]): number {
  const tags = chips.reduce((width, chip) => width + frameworkPortraitChipWidth(chip), 0) + Math.max(0, chips.length - 1) * ROOM.chipGap;
  return Math.min(ROOM.icpWhoMax, Math.max(ROOM.icpWho, tags));
}

/** The height of a facts table row: the tallest of its three cells at the `<colgroup>` widths, with the row's padding and hairline. */
export function frameworkPortraitFactRowHeight(fact: FoundationMessagePrintFactRow, tight: boolean): number {
  const [factWidth, sourceWidth, usedWidth] = FRAMEWORK_PORTRAIT_FACT_COLUMNS.map((share) => (PAGE.contentWidth * share) / 100 - ROOM.factCellPadding);
  return (
    Math.max(
      frameworkPortraitTextHeight(fact.fact, TYPE.fact, factWidth),
      frameworkPortraitTextHeight(fact.source, TYPE.fact, Math.min(sourceWidth, ROOM.chip)),
      frameworkPortraitTextHeight(fact.usedBy, TYPE.fact, usedWidth)
    ) + (tight ? ROOM.factRowTight : ROOM.factRow)
  );
}

/** The rows of tiles a count takes (each FRAMEWORK_PORTRAIT_NUMBER_TILE.height high). */
function tileRows(tiles: readonly FoundationMessagePrintNumberTile[]): number {
  return Math.ceil(tiles.reduce((sum, tile) => sum + 1 / tile.share, 0) - 1e-9);
}

/**
 * The key numbers pages the data needs, laid out: page 1 with the intro and the tiles (when the count allows them) or
 * the start of the key numbers table; more pages while table rows remain; the facts table on the last page in the room
 * left (on a page of its own when none is left), cut by the rule. At least one page, even with no figure.
 */
export function frameworkPortraitNumbersPages(view: FoundationMessagePrintView): FoundationMessagePrintNumbersPage[] {
  const tile = FRAMEWORK_PORTRAIT_NUMBER_TILE;
  const tops = FRAMEWORK_PORTRAIT_TOPS;
  const date = view.dateReadLabel;
  const intro = `The figures the framework leans on, with where each came from.${date ? ` LFX figures are as of ${date}.` : ''}`;
  const tiles = frameworkPortraitNumberTiles(view.numbers);
  const tableRows = tiles.length ? [] : [...view.numbers];
  const noFacts: FoundationMessagePrintCutList<FoundationMessagePrintFactRow> = { rows: [], cut: 0, tight: false, note: '' };
  const pages: FoundationMessagePrintNumbersPage[] = [];
  // Page 1's content starts at the tiles' top; the tiles, when any, leave the facts their gap under the rows.
  let cursor: number = tile.top;
  if (tiles.length) {
    const rows = tileRows(tiles);
    cursor = tile.top + rows * tile.height + Math.max(0, rows - 1) * tile.gap + tile.tableGap;
  }
  let remaining = tableRows;
  for (;;) {
    const index = pages.length + 1;
    const numbersTop = index === 1 ? tile.top : tops.numbersContinued;
    if (index > 1) cursor = numbersTop;
    const page: FoundationMessagePrintNumbersPage = {
      index,
      intro: index === 1 ? intro : '',
      tiles: index === 1 ? tiles : [],
      numbersTable: [],
      numbersTop,
      factsTop: null,
      facts: noFacts,
    };
    if (remaining.length) {
      // The key numbers table: whole rows down to the footer, the rest on the next page; never cut. A fresh page always
      // keeps at least one row (K's paginate rule), so a row taller than the page still moves the loop on.
      let used = cursor + ROOM.label + ROOM.tableHead;
      const kept: FoundationMessageNumberRow[] = [];
      for (const row of remaining) {
        const height = numbersRowHeight(row, false);
        if (kept.length > 0 && used + height > tops.footer) break;
        used += height;
        kept.push(row);
      }
      page.numbersTable = kept;
      remaining = remaining.slice(kept.length);
      cursor = used + tile.tableGap;
      if (remaining.length) {
        pages.push(page);
        continue;
      }
    }
    // The facts table, in the room left on this page: at least its head, one tight row and the cut note's room, else on a page of its own.
    const factsRoom = tops.footer - cursor - ROOM.label - ROOM.tableHead;
    const firstRow = view.facts[0] ? frameworkPortraitFactRowHeight(view.facts[0], true) + frameworkPortraitCutNoteHeight() : 0;
    if (view.facts.length && factsRoom < firstRow && (page.numbersTable.length || page.tiles.length)) {
      pages.push(page);
      cursor = tops.numbersContinued;
      pages.push({
        index: index + 1,
        intro: '',
        tiles: [],
        numbersTable: [],
        numbersTop: tops.numbersContinued,
        factsTop: tops.numbersContinued,
        facts: frameworkPortraitCutList(
          view.facts,
          tops.footer - tops.numbersContinued - ROOM.label - ROOM.tableHead,
          'Framework',
          (fact) => frameworkPortraitFactRowHeight(fact, false),
          (fact) => frameworkPortraitFactRowHeight(fact, true)
        ),
      });
      return pages;
    }
    page.factsTop = cursor;
    page.facts = frameworkPortraitCutList(
      view.facts,
      factsRoom,
      'Framework',
      (fact) => frameworkPortraitFactRowHeight(fact, false),
      (fact) => frameworkPortraitFactRowHeight(fact, true)
    );
    pages.push(page);
    return pages;
  }
}
