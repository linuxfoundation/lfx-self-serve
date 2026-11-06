// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Text that fits its box, for the landscape print pages: a port of the deck's
// fit (marketing-os-agents agents/slides-export src/fit.ts at 7839d985),
// value for value, so the PDF cuts where the slide cuts. A character-width
// model of the line wrap (conservative: a sans face averages about half an
// em per character; the model takes more), the deck's line height and the
// text box insets. A text that does not fit at its preferred size is set
// smaller, down to a floor; one that still does not fit is cut at a sentence
// (prose) or continued on a numbered page (lists, by the callers). Pure and
// synchronous. Units are points on the 720 × 405 pt canvas.

import {
  MKTG_PRINT_PAGE_BULLET_INDENT,
  MKTG_PRINT_PAGE_CAPS_TRACKING_EM,
  MKTG_PRINT_PAGE_CUT_MIN_CHARS,
  MKTG_PRINT_PAGE_CUT_SHARE,
  MKTG_PRINT_PAGE_INSET,
  MKTG_PRINT_PAGE_LINE,
  MKTG_PRINT_PAGE_MIN_SCALE,
  MKTG_PRINT_PAGE_SCALE_STEP,
} from '../constants/mktg-print-page.constants';
import type { MktgPrintPara, MktgPrintParaRun, MktgPrintRich } from '../interfaces/mktg-print-page.interface';

/**
 * Average character width in ems: wider for bold and for capitals, which the
 * print also letter-spaces (MKTG_PRINT_PAGE_CAPS_TRACKING_EM, counted here so
 * the fit sees the width the page draws).
 */
export function mktgPrintCharEm(p: { weight?: number; caps?: boolean }): number {
  if (p.caps) return 0.72 + MKTG_PRINT_PAGE_CAPS_TRACKING_EM;
  return (p.weight ?? 400) >= 600 ? 0.6 : 0.55;
}

/** Characters per line in a column `width` pt wide at `size` pt. */
export function mktgPrintCharsPerLine(width: number, size: number, p: { weight?: number; caps?: boolean; bullet?: boolean } = {}): number {
  const usable = width - 2 * MKTG_PRINT_PAGE_INSET - (p.bullet ? MKTG_PRINT_PAGE_BULLET_INDENT : 0);
  return Math.max(1, Math.floor(usable / (size * mktgPrintCharEm(p))));
}

/** Lines a text wraps to at `max` characters per line. Each hard line wraps on its own, a blank one counting as a line. */
export function mktgPrintWrapLines(text: string, max: number): number {
  return text.split(/\r?\n|\v/).reduce((n, line) => n + wrapLine(line, max), 0);
}

/** Lines one hard line wraps to at `max` characters per line (greedy by words; a word longer than a line breaks). */
function wrapLine(text: string, max: number): number {
  const words = text.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const w of words) {
    if (w.length > max) {
      // Start the long word on a fresh line (unless the line is empty) and break it.
      if (used > 0) lines++;
      const pieces = Math.ceil(w.length / max);
      lines += pieces - 1;
      used = w.length - (pieces - 1) * max;
      continue;
    }
    const need = used === 0 ? w.length : used + 1 + w.length;
    if (need <= max) used = need;
    else {
      lines++;
      used = w.length;
    }
  }
  return lines;
}

/** The height of one paragraph in a column `width` pt wide, its space above included. */
export function mktgPrintParaHeight(p: MktgPrintPara, width: number): number {
  const lines = mktgPrintWrapLines(p.text, mktgPrintCharsPerLine(width, p.size, p));
  return (p.above ?? 0) + lines * p.size * MKTG_PRINT_PAGE_LINE;
}

/** The height a block needs in a box `width` pt wide, insets included. */
export function mktgPrintRichHeight(r: MktgPrintRich, width: number): number {
  return 2 * MKTG_PRINT_PAGE_INSET + r.paras.reduce((h, p) => h + mktgPrintParaHeight(p, width), 0);
}

/** Whether a block fits a box. */
export function mktgPrintFits(r: MktgPrintRich, w: number, h: number): boolean {
  return mktgPrintRichHeight(r, w) <= h + 0.01;
}

/** The block with every size (and space above) scaled by `s`, sizes rounded down to the half point. */
export function mktgPrintScaleRich(r: MktgPrintRich, s: number): MktgPrintRich {
  const size = (v: number) => Math.max(1, Math.floor(v * s * 2) / 2);
  return { ...r, paras: r.paras.map((p) => ({ ...p, size: size(p.size), above: p.above ? Math.round(p.above * s * 10) / 10 : p.above })) };
}

/** The block at the largest scale (1 down to `min`, in steps of 4%) at which it fits; null when it does not fit even at `min`. */
export function mktgPrintFitRich(r: MktgPrintRich, w: number, h: number, min = MKTG_PRINT_PAGE_MIN_SCALE): MktgPrintRich | null {
  for (let s = 1; s >= min - 1e-9; s -= MKTG_PRINT_PAGE_SCALE_STEP) {
    const scaled = s === 1 ? r : mktgPrintScaleRich(r, s);
    if (mktgPrintFits(scaled, w, h)) return scaled;
  }
  return null;
}

/** The sentences of a text. */
export function mktgPrintSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** A text cut to at most `max` characters: whole sentences when one fits, else whole words and an ellipsis. */
export function mktgPrintCutText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const s of mktgPrintSentences(text)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  if (out !== '') return out;
  const words = text.split(/\s+/);
  out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length + 1 > max) break;
    out = next;
  }
  return `${mktgPrintTrimTrailing(out || text.slice(0, Math.max(1, max - 1)), CUT_TAIL_CHARS)}…`;
}

/** The punctuation a cut sheds before its ellipsis (the deck's); a run's tail sheds the middle dot too. */
const CUT_TAIL_CHARS = ',;:.—-';
const RUN_TAIL_CHARS = `${CUT_TAIL_CHARS}·`;

/**
 * A text without its trailing whitespace and `chars`: one pass from the end
 * (a trailing-class regex such as `[\s,;:.—-]+$` backtracks once per
 * character on a long run of tabs or spaces, which CodeQL flags as polynomial
 * on library input; the scan is linear).
 */
export function mktgPrintTrimTrailing(text: string, chars: string): string {
  let end = text.length;
  while (end > 0) {
    const c = text[end - 1];
    if (!(/\s/.test(c) || chars.includes(c))) break;
    end--;
  }
  return text.slice(0, end);
}

/**
 * A paragraph cut to at most `max` characters (mktgPrintCutText). A paragraph
 * with runs keeps them: the cut is a prefix of its text (whole words and an
 * ellipsis when the sentence cut is not one), each run clipped to it, the
 * runs past it dropped, the ellipsis on the last run kept.
 */
export function mktgPrintCutPara(p: MktgPrintPara, max: number): MktgPrintPara {
  const cut = mktgPrintCutText(p.text, max);
  if (!p.runs || cut === p.text) return { ...p, text: cut };
  // The cut gives whole sentences (no ellipsis) or whole words and an ellipsis.
  let tail = cut.endsWith('…') ? '…' : '';
  let base = tail ? cut.slice(0, -1) : cut;
  if (!p.text.startsWith(base)) {
    // The sentence cut re-joined whitespace: cut at the last word boundary instead, a true prefix.
    const room = p.text.slice(0, Math.max(1, max - 1));
    const space = room.search(/\s\S*$/);
    base = (space > 0 ? room.slice(0, space) : room).replace(/[\s,;:.—-]+$/, '');
    tail = '…';
  }
  const runs: MktgPrintParaRun[] = [];
  let left = base.length;
  for (const run of p.runs) {
    if (left <= 0) break;
    const text = run.text.slice(0, left);
    left -= text.length;
    if (text !== '') runs.push({ ...run, text });
  }
  while (runs.length > 0 && runs[runs.length - 1].text.trim() === '') runs.pop();
  if (runs.length === 0) return { ...p, text: cut, runs: undefined };
  const last = runs[runs.length - 1];
  runs[runs.length - 1] = { ...last, text: tail ? `${mktgPrintTrimTrailing(last.text, RUN_TAIL_CHARS)}${tail}` : last.text };
  return { ...p, text: runs.map((r) => r.text).join(''), runs };
}

/**
 * The block fitted to its box, always: set smaller down to `min`, then the
 * longest paragraph cut (sentence first) until it fits. A paragraph with
 * runs (a proof row, a persona) is cut with its runs rebuilt, so a block of
 * only those fits too.
 */
export function mktgPrintFitOrCut(r: MktgPrintRich, w: number, h: number, min = MKTG_PRINT_PAGE_MIN_SCALE): { rich: MktgPrintRich; cut: boolean } {
  const fitted = mktgPrintFitRich(r, w, h, min);
  if (fitted) return { rich: fitted, cut: false };
  let cur = mktgPrintScaleRich(r, min);
  for (let guard = 0; guard < 120 && !mktgPrintFits(cur, w, h); guard++) {
    let longest = -1;
    for (let i = 0; i < cur.paras.length; i++) {
      const p = cur.paras[i];
      if (p.text.length < MKTG_PRINT_PAGE_CUT_MIN_CHARS) continue;
      if (longest === -1 || p.text.length > cur.paras[longest].text.length) longest = i;
    }
    if (longest === -1) break;
    const p = cur.paras[longest];
    const cut = mktgPrintCutPara(p, Math.floor(p.text.length * MKTG_PRINT_PAGE_CUT_SHARE));
    if (cut.text === p.text || cut.text.length >= p.text.length) break;
    cur = { ...cur, paras: cur.paras.map((q, i) => (i === longest ? cut : q)) };
  }
  return { rich: cur, cut: true };
}

/** A text cut to fit one line `width` pt wide at `size` pt (no ellipsis when it already fits). */
export function mktgPrintOneLine(text: string, width: number, size: number, p: { weight?: number; caps?: boolean } = {}): string {
  const max = mktgPrintCharsPerLine(width, size, p);
  if (text.length <= max) return text;
  return mktgPrintCutText(text, max);
}

/**
 * Items split into pages: as many as fit per page, in order, at least one
 * per page. `fitsPage(items)` says whether a page holding those items fits.
 */
export function mktgPrintPaginate<T>(items: T[], fitsPage: (page: T[]) => boolean): T[][] {
  const pages: T[][] = [];
  let cur: T[] = [];
  for (const item of items) {
    const next = [...cur, item];
    if (cur.length > 0 && !fitsPage(next)) {
      pages.push(cur);
      cur = [item];
    } else cur = next;
  }
  if (cur.length) pages.push(cur);
  return pages;
}
