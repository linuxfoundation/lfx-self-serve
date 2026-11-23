// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FaqContent, FaqQuestionEntry } from '@lfx-one/shared/interfaces';

/**
 * Synthetic FAQ answers in the faq agent's two shapes, shared by the FAQ view and print unit
 * specs and the stubbed FAQ e2e: (a) a plain answer, (b) a lead-in sentence and a five-item
 * "- " list, (c) a plain answer with thousands separators, and (d) an injected-HTML answer the
 * restricted renderer must neutralise. The strings below are what a tester reads on the page
 * and in the PDF.
 */

/** (a) A plain answer, as every stored answer is today. */
export const FAQ_PLAIN_ANSWER = 'Synthetic Toolkit is an open source release toolkit for community projects.';

/** (b) The lead-in sentence that precedes the list. */
export const FAQ_LIST_LEAD_IN = 'The agents in the Positioning family are:';

/** (b) The five list items, in the order they render. */
export const FAQ_LIST_ITEMS = ['Agent Router', 'Brand Kit', 'Boilerplates', 'FAQ', 'Messaging Framework'] as const;

/** (b) The stored answer: the lead-in, a newline, then one "- " line per item. */
export const FAQ_LIST_ANSWER = `${FAQ_LIST_LEAD_IN}\n${FAQ_LIST_ITEMS.map((item) => `- ${item}`).join('\n')}`;

/** (c) A plain answer whose numbers carry thousands separators. */
export const FAQ_PRICE_ANSWER = 'Membership ranges from $5,000 to $75,000 a year, by organisation size.';

/** (d) Raw HTML, a script and a javascript: link: none of them may reach the DOM. */
export const FAQ_INJECTED_ANSWER = 'See <img src=x onerror=alert(1)> and <script>alert(1)</script> or [the docs](javascript:alert(1)) for details.';

/** The FAQ view's question rows, in the order (a), (b), (c), (d): `mktg-faq-view-question-0-0` to `-0-3`. */
export const FAQ_ANSWER_QUESTIONS = [
  ['What is Synthetic Toolkit?', FAQ_PLAIN_ANSWER, 'Website'],
  ['Which agents does the family hold?', FAQ_LIST_ANSWER, 'Docs'],
  ['How much does membership cost?', FAQ_PRICE_ANSWER, 'Website'],
  ['Where is the documentation?', FAQ_INJECTED_ANSWER, 'Docs'],
] as const;

/** One group holding the four answers: a stored FAQ revision the view and the print both accept. */
export function faqAnswersContent(): FaqContent {
  return { faq: [['About Synthetic Toolkit', FAQ_ANSWER_QUESTIONS.map((row): FaqQuestionEntry => [...row])]] };
}
