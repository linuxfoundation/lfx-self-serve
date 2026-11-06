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
  /** Drawn in capitals (CSS text-transform; the text is kept as given). */
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
export type MktgPrintPageShape = 'TEXT_BOX' | 'RECTANGLE' | 'ROUND_RECTANGLE' | 'ELLIPSE' | 'PILL';

/** A ground the renderer paints by its own CSS: the covers' grid of the accent on the dark (the prototype's gridGround). */
export type MktgPrintPageGround = 'grid';

/** A shape's outline: its colour and weight (pt); `dash` draws it dashed (the clear-space frame, a partner logo's slot). */
export interface MktgPrintPageLine {
  color: string;
  weight: number;
  dash?: boolean;
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
  /** A painted ground over the fill (the renderer's CSS; one source with the covers'). */
  ground?: MktgPrintPageGround;
}

/** An image in its box (the kit's own SVG as a data URL, or an app image), kept inside the box. */
export interface MktgPrintPageImageEl {
  t: 'image';
  box: MktgPrintPageBox;
  src: string;
  alt: string;
  /** CSS filter on the image ('' to draw it as it is). */
  filter?: string;
  /** A CSS transform on the image, for a distortion shown on purpose (the watchouts' stretched and rotated lockup). */
  transform?: string;
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
  /** What the document's template for the slot receives as its context (one template, many boxes: an icon's index and ink). */
  context?: Record<string, string | number | boolean>;
}

export type MktgPrintPageEl = MktgPrintPageShapeEl | MktgPrintPageImageEl | MktgPrintPageSlotEl;

/** A block stacked down a column (mktgPrintStack): its text, the gap above it, and the box's fill, outline and shape. */
export interface MktgPrintStackBlock {
  rich: MktgPrintRich;
  gap?: number;
  fill?: string | null;
  line?: MktgPrintPageLine | null;
  shape?: MktgPrintPageShape;
}

/** The inks and the typeface a document's pages are set in. */
export interface MktgPrintPageLook {
  /** The brand's dark: the covers' ground and the panels. */
  dark: string;
  /** The body ink on white: the dark when it reads there, else the app's darkest gray (mktgPrintBrand's `ink`). */
  ink: string;
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

/**
 * A content page's footer: the line left of the logo frame, the page number right (two digits). `leftBox` moves the
 * line (MKTG_PRINT_PAGE_FOOTER_MARGIN_LEFT_BOX when the page draws no lockup, so the line starts at the margin).
 */
export interface MktgPrintPageFooter {
  left: string;
  number: string;
  leftBox?: MktgPrintPageBox;
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
  /** A cover's own boxes; absent = the deck's cover boxes. */
  titleBox?: MktgPrintPageBox;
  subtitleBox?: MktgPrintPageBox;
  head?: MktgPrintPageHead;
  footer?: MktgPrintPageFooter;
  els: MktgPrintPageEl[];
}

/** A paragraph as the page shell renders it: the paragraph and its inline CSS (size, space above, weight, colour, typeface, in page units). */
export interface MktgPrintParaView {
  para: MktgPrintPara;
  style: Record<string, string>;
}

/** A text block as the page shell renders it: the block and its paragraphs' views, built once per change of the page. */
export interface MktgPrintRichView {
  rich: MktgPrintRich;
  paras: MktgPrintParaView[];
}

/** A page element as the page shell renders it: the element, its box's CSS (and a shape's fill and outline), and its text's view. */
export interface MktgPrintPageElView {
  el: MktgPrintPageEl;
  style: Record<string, string>;
  text: MktgPrintRichView | null;
}
