// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The text rules every marketing print shares: parts joined with the middle
// dot (MKTG_PRINT_DOT), and a figure printed with its thousands separators.
// On its own so the constants file exports values only and the plan utils
// and the print utils both import it without a cycle (mktg-print.utils.ts
// imports the layout utils, which must not import the print utils back).

import { MKTG_PRINT_DOT } from '../constants/mktg-print.constants';

/**
 * Parts joined with the middle dot, each trimmed, the empty ones left out: `Goal 1 · Events`. The default is the
 * prints' plain dot; the framework book passes its own, FRAMEWORK_PORTRAIT_SEP.
 */
export function mktgPrintJoin(parts: readonly string[], dot: string = MKTG_PRINT_DOT): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(dot);
}

/**
 * A key number's label that names a calendar year, so the figure beside it is a date, not a count: `founded`, `established`,
 * `since` or `est.` as the label's first word or the whole label (`Founded`, `Founded in`, `Since`, `Est.`), or `year founded`
 * / `year established` as the whole label. A label that only mentions a year or a start elsewhere (`downloads per year`,
 * `members added since launch`) counts something, and its figure is separated.
 */
const YEAR_LABEL_REGEX = /^(?:(?:founded|established|since|est\.?)(?:\s|$)|year\s+(?:founded|established)$)/i;

/**
 * A key number's figure as it prints: a purely numeric one gets thousands separators ("1000" → "1,000", "$8000" → "$8,000",
 * "10000+" → "10,000+", "1234.5" → "1,234.5"); one already separated, a percentage, and anything that is not a plain number
 * print as stored (the editor's rule, 7 Nov 2026: separators on figures, the rest untouched). A year prints as stored only
 * when it is one: a bare four-digit 1900–2099 integer as the whole value AND a label that names a calendar year
 * (`YEAR_LABEL_REGEX`: `Founded`, `Since`, `Year established`, never a label that merely mentions a year, such as
 * `downloads per year`); a count of 2,000 under any other label is separated (the editor's S1 read of 33584d0ea, where the
 * year rule took the overfull record's "2000" for a date). US grouping: the printed strings are US English (the editor's spelling
 * rule), and `Intl` is not reached for, so the server and the browser print the same string.
 */
export function mktgPrintFigure(figure: string, label = ''): string {
  const trimmed = figure.trim();
  const match = /^([$€£]?)(\d+)(\.\d+)?([+%]?)$/.exec(trimmed);
  if (!match) return trimmed;
  const [, currency, integer, fraction = '', suffix] = match;
  if (suffix === '%' || integer.length < 4) return trimmed;
  const bareYear = currency === '' && fraction === '' && suffix === '' && /^(19|20)\d\d$/.test(integer);
  if (bareYear && YEAR_LABEL_REGEX.test(label.trim())) return trimmed;
  const grouped: string[] = [];
  for (let end = integer.length; end > 0; end -= 3) grouped.unshift(integer.slice(Math.max(0, end - 3), end));
  return `${currency}${grouped.join(',')}${fraction}${suffix}`;
}
