// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The landscape print page model: one printed page = one slide of the
// Marketing OS decks (marketing-os-agents agents/slides-export, src/fit.ts and
// src/pages.ts at 7839d985). The PDF prints and the Slides export share this
// page plan; the model's unit is the deck's point on its 720 × 405 pt canvas,
// and the renderer scales it once onto the page.

/** A box on the 720 × 405 pt canvas (pt). */
export interface MktgPrintPageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One paragraph: its text and how it is set. `runs` restyle stretches of the text (their texts concatenate to `text`). */
export interface MktgPrintPara {
  text: string;
  size: number;
  weight?: number;
  italic?: boolean;
  strike?: boolean;
  /** Set in capitals (the text is upper-cased when written). */
  caps?: boolean;
  color?: string;
  /** Space above the paragraph, pt. */
  above?: number;
  bullet?: boolean;
  /** A typeface for this paragraph only (the retyped-wordmark watchout); else the block's. */
  font?: string;
  runs?: MktgPrintParaRun[];
}

export interface MktgPrintParaRun {
  text: string;
  color?: string;
  weight?: number;
}

export type MktgPrintRichAlign = 'START' | 'CENTER' | 'END';
export type MktgPrintRichAnchor = 'TOP' | 'MIDDLE' | 'BOTTOM';

/** A block of text: its paragraphs, the base colour and typeface, alignment and vertical anchor. */
export interface MktgPrintRich {
  paras: MktgPrintPara[];
  color: string;
  /** The typeface; null keeps the page's. */
  font: string | null;
  align?: MktgPrintRichAlign;
  anchor?: MktgPrintRichAnchor;
}

/** The shapes the page plan draws. */
export type MktgPrintPageShape = 'TEXT_BOX' | 'RECTANGLE' | 'ROUND_RECTANGLE' | 'ELLIPSE';

/** A shape's outline: its colour and weight (pt). */
export interface MktgPrintPageLine {
  color: string;
  weight: number;
}

/** A shape (a text box, a filled rectangle, a pill) in its box; `text` is fitted to the box before it is placed. */
export interface MktgPrintPageShapeEl {
  t: 'shape';
  shape: MktgPrintPageShape;
  box: MktgPrintPageBox;
  text?: MktgPrintRich;
  /** A CSS colour, null for no fill. */
  fill?: string | null;
  line?: MktgPrintPageLine | null;
}

/** An image in its box (the kit's own SVG as a data URL, or an app image), kept inside the box. */
export interface MktgPrintPageImageEl {
  t: 'image';
  box: MktgPrintPageBox;
  src: string;
  alt: string;
  /** CSS filter on the image ('' to draw it as it is). */
  filter?: string;
}

/**
 * A box a page's own markup fills (the kit's icon tiles, a colour swatch
 * grid): the renderer leaves the box and the document projects its content
 * for the slot's name. One shared renderer, custom visuals per document.
 */
export interface MktgPrintPageSlotEl {
  t: 'slot';
  box: MktgPrintPageBox;
  slot: string;
}

export type MktgPrintPageEl = MktgPrintPageShapeEl | MktgPrintPageImageEl | MktgPrintPageSlotEl;

/** The inks and the typeface a document's pages are set in. */
export interface MktgPrintPageLook {
  dark: string;
  accent: string;
  tint: string;
  /** The eyebrow and footer ink, and the page's rules. */
  muted: string;
  rule: string;
  onDark: string;
  /** The CSS font stack; null keeps the app's. */
  font: string | null;
}

/** The page's layout: the dark cover, a content page with the running head and footer, or the dark back cover. */
export type MktgPrintPageLayout = 'cover' | 'content' | 'back';

/** The two eyebrow lines of a content page's running head: left the chapter or section, right the document. */
export interface MktgPrintPageHead {
  left: string;
  right: string;
}

/** A content page's footer: the line left of the logo frame, the page number right (two digits). */
export interface MktgPrintPageFooter {
  left: string;
  number: string;
}

/** One printed page: its layout, its title (and a cover's subtitle), the running head, the footer and its body. */
export interface MktgPrintPage {
  layout: MktgPrintPageLayout;
  /** The page's title as text (the contents list and tests read it). */
  title: string;
  /** The title as set in the title band, fitted. */
  titleRich: MktgPrintRich;
  /** A cover's subtitle, fitted; none on the other layouts. */
  subtitle?: MktgPrintRich;
  head?: MktgPrintPageHead;
  footer?: MktgPrintPageFooter;
  els: MktgPrintPageEl[];
}
