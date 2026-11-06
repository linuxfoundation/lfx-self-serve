// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Messaging Framework as landscape print pages: a port of the deck's
// framework print (marketing-os-agents agents/slides-export
// src/framework-print.ts) over LFX One's own print view
// (FoundationMessagePrintView), one page per slide, in the deck's order and
// with its headings: the cover (the eyebrow, "Messaging Framework", the
// tagline, the sections), then 01 Framework (vision, mission, positioning and
// tagline; the goal columns; say and avoid; the anchor questions), 02 ICPs (a
// card per segment), 03 Message house (the umbrella, the pillars, the
// foundation; the audiences) and 04 Key numbers. The reviewer's note and the
// sources and gaps are the run's, not the reader's, and are not printed.
// Cards that do not fit two to a page take a page each; rows and tiles that
// do not fit continue on a numbered page. The deck's content pages carry the
// template's slide number and no footer line: here each content page's
// footer holds its number alone. Pure.

import { FOUNDATION_MESSAGE_PRINT_TITLE, MKTG_PRINT_INK_ON_DARK } from '../constants/mktg-print.constants';
import {
  MKTG_PRINT_FRAMEWORK_CARD_LINE,
  MKTG_PRINT_FRAMEWORK_CHIP,
  MKTG_PRINT_FRAMEWORK_NUMBERS_PER_PAGE,
  MKTG_PRINT_FRAMEWORK_SECTIONS,
} from '../constants/mktg-print-framework.constants';
import { MKTG_PRINT_PAGE_AREA, MKTG_PRINT_PAGE_LEFT, MKTG_PRINT_PAGE_RIGHT } from '../constants/mktg-print-page.constants';
import type { FoundationMessagePair, FoundationMessagePillar } from '../interfaces/foundation-message.interface';
import type {
  MktgPrintFrameworkChip,
  MktgPrintFrameworkContext,
  MktgPrintFrameworkCover,
  MktgPrintFrameworkOptions,
  MktgPrintFrameworkSection,
  MktgPrintFrameworkSectionId,
} from '../interfaces/mktg-print-framework.interface';
import type {
  MktgPrintPage,
  MktgPrintPageBox,
  MktgPrintPageEl,
  MktgPrintPageHead,
  MktgPrintPageLook,
  MktgPrintPara,
  MktgPrintRich,
} from '../interfaces/mktg-print-page.interface';
import type { FoundationMessagePrintGoal, FoundationMessagePrintIcp, FoundationMessagePrintView } from '../interfaces/mktg-print.interface';
import { mktgPrintCharEm, mktgPrintFitRich, mktgPrintFits, mktgPrintPaginate, mktgPrintScaleRich } from './mktg-print-fit.utils';
import {
  mktgPrintClampRow,
  mktgPrintContentPage,
  mktgPrintContinued,
  mktgPrintEyebrowPara,
  mktgPrintHairline,
  mktgPrintMixHex,
  mktgPrintPageLook,
  mktgPrintPara,
  mktgPrintRich,
  mktgPrintRowEl,
  mktgPrintRowHeight,
  mktgPrintScaleRows,
  mktgPrintShapeEl,
  mktgPrintTextEl,
} from './mktg-print-page.utils';

const AREA = MKTG_PRINT_PAGE_AREA;
const LEFT = MKTG_PRINT_PAGE_LEFT;
const RIGHT = MKTG_PRINT_PAGE_RIGHT;
const WHITE = MKTG_PRINT_INK_ON_DARK;

type Ctx = MktgPrintFrameworkContext;

/**
 * The sections the framework prints, in the cover's order, as the deck's
 * presentSections: the framework and the message house always (the deck
 * prints the framework whenever the asset has an `mf`, and LFX One's content
 * always has one), the ICPs and the key numbers when there are any.
 */
export function mktgPrintFrameworkSections(view: FoundationMessagePrintView): MktgPrintFrameworkSection[] {
  const present: MktgPrintFrameworkSectionId[] = ['framework'];
  if (view.icps.length) present.push('icps');
  present.push('message-house');
  if (view.numbers.length) present.push('numbers');
  return MKTG_PRINT_FRAMEWORK_SECTIONS.filter((s) => present.includes(s.id));
}

function head(ctx: Ctx, id: MktgPrintFrameworkSectionId): MktgPrintPageHead {
  const s = MKTG_PRINT_FRAMEWORK_SECTIONS.find((x) => x.id === id) ?? MKTG_PRINT_FRAMEWORK_SECTIONS[0];
  return { left: `${s.number} ${s.title}`, right: ctx.view.runningHead };
}

const card = (look: MktgPrintPageLook) => ({
  shape: 'ROUND_RECTANGLE' as const,
  fill: WHITE,
  line: { color: look.rule, weight: MKTG_PRINT_FRAMEWORK_CARD_LINE },
});

/** A proof row: the fact, then its source in small capitals. */
function proofPara(look: MktgPrintPageLook, fact: string, source: string, size: number, above = 2): MktgPrintPara {
  const src = source ? `  ·  ${source.toUpperCase()}` : '';
  return { text: `${fact}${src}`, size, above, runs: [{ text: fact }, ...(src ? [{ text: src, color: look.muted }] : [])] };
}

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

/** The cover's lines and its own elements, as the deck's cover sets them (framework-print.ts coverSlide): the eyebrow, the version, the accent bar, the rule and the contents line. */
export function mktgPrintFrameworkCover(view: FoundationMessagePrintView, look: MktgPrintPageLook): MktgPrintFrameworkCover {
  const soft = mktgPrintMixHex(look.onDark, look.dark, 0.4);
  const sections = mktgPrintFrameworkSections(view);
  const contents = sections.map((s) => `${s.number}  ${s.title}`).join('        ');
  const runs = sections.flatMap((s, i) => [...(i ? [{ text: '        ' }] : []), { text: s.number, color: soft }, { text: `  ${s.title}` }]);
  return {
    title: FOUNDATION_MESSAGE_PRINT_TITLE,
    subtitle: view.mf.tagline || view.mh.line || '',
    eyebrow: view.eyebrow,
    topRight: view.versionLabel,
    els: [
      mktgPrintShapeEl('RECTANGLE', { x: 38, y: 118, w: 36, h: 3 }, look.accent),
      mktgPrintShapeEl('RECTANGLE', { x: 38, y: 340, w: 624, h: 0.75 }, mktgPrintMixHex(look.dark, look.onDark, 0.3)),
      mktgPrintTextEl({ x: 38, y: 346, w: 624, h: 30 }, mktgPrintRich(look, [{ text: contents, size: 9.5, runs }], { color: look.onDark })),
    ],
  };
}

// ---------------------------------------------------------------------------
// 01 Framework
// ---------------------------------------------------------------------------

function frameworkPage(ctx: Ctx): MktgPrintPage {
  const { look } = ctx;
  const mf = ctx.view.mf;
  const statement = (label: string, text: string, box: MktgPrintPageBox): MktgPrintPageEl[] =>
    text ? [mktgPrintTextEl(box, mktgPrintRich(look, [mktgPrintEyebrowPara(look, label), mktgPrintPara(text, 10.5, { above: 3 })]), card(look))] : [];
  const els: MktgPrintPageEl[] = [
    ...statement('Vision', mf.vision, { x: 25, y: 91, w: 330, h: 82 }),
    ...statement('Mission', mf.mission, { x: 366, y: 91, w: 330, h: 82 }),
    ...statement('Positioning', mf.positioning, { x: 25, y: 181, w: 671, h: 82 }),
  ];
  if (mf.tagline) {
    els.push(
      mktgPrintTextEl(
        { x: 25, y: 271, w: 671, h: 85 },
        mktgPrintRich(look, [mktgPrintEyebrowPara(look, 'Tagline'), mktgPrintPara(mf.tagline, 15, { weight: 500, above: 4 })], { anchor: 'MIDDLE' }),
        { shape: 'ROUND_RECTANGLE', fill: look.tint, line: null }
      )
    );
    els.push(mktgPrintShapeEl('RECTANGLE', { x: 25, y: 279, w: 3, h: 69 }, look.accent));
  }
  return mktgPrintContentPage(look, 'Framework', head(ctx, 'framework'), els);
}

function goalRich(ctx: Ctx, g: FoundationMessagePrintGoal): MktgPrintRich {
  const { look } = ctx;
  return mktgPrintRich(look, [
    mktgPrintPara(g.t, 12, { weight: 600 }),
    mktgPrintPara(g.n ? `Goal ${g.n}` : '', 7.5, { color: look.muted, above: 1 }),
    ...(g.vp ? [mktgPrintEyebrowPara(look, 'Value proposition', { above: 6 }), mktgPrintPara(g.vp, 9, { above: 1 })] : []),
    ...(g.key ? [mktgPrintEyebrowPara(look, 'Key message', { above: 5 }), mktgPrintPara(g.key, 9, { above: 1 })] : []),
    ...(g.proof.length ? [mktgPrintEyebrowPara(look, 'Proof', { above: 5 }), ...g.proof.map(([f, s]) => proofPara(look, f, s, 8))] : []),
    ...(g.bite ? [mktgPrintPara(`“${g.bite}”`, 9.5, { italic: true, above: 6 })] : []),
    ...(g.segmentLabel ? [mktgPrintPara(`For ${g.segmentLabel}`, 8, { color: look.muted, above: 4 })] : []),
  ]);
}

function goalPages(ctx: Ctx, firstIndex: number): MktgPrintPage[] {
  const { look } = ctx;
  const mf = ctx.view.mf;
  const goals = ctx.view.goals;
  const groups: FoundationMessagePrintGoal[][] = [];
  const crossH = mf.crosscut ? 34 : 0;
  const h = AREA.h - crossH;
  for (let i = 0; i < goals.length; ) {
    const a = goals[i];
    const b = goals[i + 1];
    if (b && mktgPrintFitRich(goalRich(ctx, a), 330, h) && mktgPrintFitRich(goalRich(ctx, b), 330, h)) {
      groups.push([a, b]);
      i += 2;
    } else {
      groups.push([a]);
      i += 1;
    }
  }
  return groups.map((group, k) => {
    const els: MktgPrintPageEl[] = [];
    group.forEach((g, j) => {
      const box = group.length === 2 ? { x: 25 + j * 341, y: AREA.y, w: 330, h } : { x: 25, y: AREA.y, w: 671, h };
      els.push(mktgPrintTextEl(box, goalRich(ctx, g), card(look)));
    });
    if (mf.crosscut) {
      els.push(
        mktgPrintTextEl({ x: 25, y: AREA.y + h + 4, w: 671, h: crossH - 4 }, mktgPrintRich(look, [mktgPrintPara(mf.crosscut, 8.5, { color: look.muted })]))
      );
    }
    return mktgPrintContentPage(look, mktgPrintContinued('Goal columns', firstIndex + k), head(ctx, 'framework'), els);
  });
}

/** A chip's width for its text at a size (the text box over it is wider by its insets). */
function chipWidth(text: string, size: number): number {
  return Math.ceil(text.length * size * mktgPrintCharEm({})) + MKTG_PRINT_FRAMEWORK_CHIP.inset;
}

type Chip = MktgPrintFrameworkChip;

/** The say chips flow in rows of the card's width; those that do not fit the card continue on the next page. */
function chipPages(say: string[], innerW: number, cardH: number): Chip[][] {
  const { size, h: chipH, gap } = MKTG_PRINT_FRAMEWORK_CHIP;
  const pages: Chip[][] = [[]];
  let cx = 0;
  let cy = 0;
  for (const text of say) {
    const w = Math.min(innerW, chipWidth(text, size));
    if (cx > 0 && cx + w > innerW) {
      cx = 0;
      cy += chipH + gap;
    }
    if (cy + chipH > cardH - 46) {
      pages.push([]);
      cx = 0;
      cy = 0;
    }
    pages[pages.length - 1].push({ text, x: cx, y: cy, w });
    cx += w + gap;
  }
  return pages;
}

function sayAvoidPages(ctx: Ctx): MktgPrintPage[] {
  const { look } = ctx;
  const mf = ctx.view.mf;
  const left = { x: 25, y: AREA.y, w: 330, h: AREA.h };
  const right = { x: 366, y: AREA.y, w: 330, h: AREA.h };
  const { size: chipSize, h: chipH } = MKTG_PRINT_FRAMEWORK_CHIP;
  const chips = chipPages(mf.say, left.w - 24, left.h);
  const colA = 150;
  const colB = right.w - 24 - colA - 8;
  const avoidA = (a: string) => mktgPrintRich(look, [mktgPrintPara(a, 9, { strike: true, color: look.muted })]);
  const avoidB = (b: string) => mktgPrintRich(look, [mktgPrintPara(b, 9)]);
  // Each row bounded to the card (a row taller than it is set smaller, then cut), then as many rows a page as fit.
  const avoidBudget = right.h - 62;
  const avoidRows = ctx.view.avoidRows.map((r) => ({
    a: mktgPrintClampRow(avoidA(r.avoid), colA, avoidBudget),
    b: mktgPrintClampRow(avoidB(r.instead), colB, avoidBudget),
  }));
  const rowOf = (r: { a: MktgPrintRich; b: MktgPrintRich }) => Math.max(mktgPrintRowHeight(r.a, colA), mktgPrintRowHeight(r.b, colB));
  const avoidPages = avoidRows.length ? mktgPrintPaginate(avoidRows, (rows) => rows.reduce((h, r) => h + rowOf(r), 0) <= avoidBudget) : [[]];
  const n = Math.max(chips.length, avoidPages.length);
  const pages: MktgPrintPage[] = [];
  for (let k = 0; k < n; k++) {
    const els: MktgPrintPageEl[] = [
      mktgPrintShapeEl('ROUND_RECTANGLE', left, WHITE, { color: look.rule, weight: MKTG_PRINT_FRAMEWORK_CARD_LINE }),
      mktgPrintShapeEl('ROUND_RECTANGLE', right, WHITE, { color: look.rule, weight: MKTG_PRINT_FRAMEWORK_CARD_LINE }),
      mktgPrintTextEl({ x: left.x + 6, y: left.y + 6, w: left.w - 12, h: 28 }, mktgPrintRich(look, [mktgPrintPara('Say', 11, { weight: 600 })])),
      mktgPrintTextEl({ x: right.x + 6, y: right.y + 6, w: right.w - 12, h: 28 }, mktgPrintRich(look, [mktgPrintPara('Avoid', 11, { weight: 600 })])),
    ];
    for (const c of chips[k] ?? []) {
      const x = left.x + 12 + c.x;
      const y = left.y + 40 + c.y;
      els.push(
        mktgPrintShapeEl('ROUND_RECTANGLE', { x, y, w: c.w, h: chipH }, WHITE, {
          color: mktgPrintMixHex(WHITE, look.dark, 0.25),
          weight: MKTG_PRINT_FRAMEWORK_CARD_LINE,
        })
      );
      els.push(
        mktgPrintTextEl(
          { x: x - 4, y: y + chipH / 2 - 14, w: c.w + 8, h: 28 },
          mktgPrintRich(look, [mktgPrintPara(c.text, chipSize)], { align: 'CENTER', anchor: 'MIDDLE' })
        )
      );
    }
    const rows = avoidPages[k] ?? [];
    if (avoidRows.length === 0 && k === 0) {
      els.push(
        mktgPrintTextEl(
          { x: right.x + 6, y: right.y + 36, w: right.w - 12, h: 30 },
          mktgPrintRich(look, [mktgPrintPara('Nothing to avoid was stated.', 8.5, { color: look.muted })])
        )
      );
    }
    if (rows.length) {
      els.push(mktgPrintTextEl({ x: right.x + 6, y: right.y + 32, w: colA + 6, h: 26 }, mktgPrintRich(look, [mktgPrintEyebrowPara(look, 'Avoid')])));
      els.push(
        mktgPrintTextEl({ x: right.x + 12 + colA, y: right.y + 32, w: colB + 6, h: 26 }, mktgPrintRich(look, [mktgPrintEyebrowPara(look, 'Say instead')]))
      );
      let y = right.y + 58;
      for (const r of rows) {
        els.push(mktgPrintHairline(look, right.x + 12, y, right.w - 24));
        els.push(mktgPrintRowEl(right.x + 6, y, colA, r.a));
        els.push(mktgPrintRowEl(right.x + 12 + colA, y, colB, r.b));
        y += rowOf(r);
      }
    }
    pages.push(mktgPrintContentPage(look, mktgPrintContinued('Say and avoid', k), head(ctx, 'framework'), els));
  }
  return pages;
}

function anchorPage(ctx: Ctx): MktgPrintPage {
  const { look } = ctx;
  const anchor = ctx.view.mf.anchor;
  const els: MktgPrintPageEl[] = [
    mktgPrintTextEl(
      { x: 25, y: AREA.y, w: 671, h: AREA.h },
      mktgPrintRich(
        look,
        anchor.map((q, i) => mktgPrintPara(`${i + 1}.  ${q}`, 15, { above: i === 0 ? 4 : 12 }))
      ),
      card(look)
    ),
  ];
  return mktgPrintContentPage(look, 'Every piece of content answers', head(ctx, 'framework'), els);
}

// ---------------------------------------------------------------------------
// 02 ICPs
// ---------------------------------------------------------------------------

/** A segment card's label-and-value rows (the print's definition list). */
function icpRows(ctx: Ctx, s: FoundationMessagePrintIcp): Array<{ label: string; value: MktgPrintRich }> {
  const { look } = ctx;
  const v = (paras: MktgPrintPara[]) => mktgPrintRich(look, paras);
  const rows: Array<{ label: string; value: MktgPrintRich }> = [];
  if (s.need) rows.push({ label: 'Need', value: v([mktgPrintPara(s.need, 9.5)]) });
  if (s.value) rows.push({ label: 'Value', value: v([mktgPrintPara(s.value, 9.5)]) });
  if (s.lead) rows.push({ label: 'Lead', value: v([mktgPrintPara(s.lead, 9.5, { weight: 600 })]) });
  if (s.proof.length) rows.push({ label: 'Proof', value: v(s.proof.map(([f, src], i) => proofPara(look, f, src, 8.5, i === 0 ? 0 : 2))) });
  if (s.cta) rows.push({ label: 'Call to action', value: v([mktgPrintPara(s.cta, 9.5)]) });
  if (s.channels.length) rows.push({ label: 'Channels', value: v([mktgPrintPara(s.channelsLabel, 9.5)]) });
  if (s.objectionText) {
    rows.push({
      label: 'Objection',
      value: v([
        mktgPrintPara(s.objectionText, 9.5),
        ...(s.objectionResponse ? [mktgPrintPara(`→ ${s.objectionResponse}`, 9.5, { color: look.muted, above: 2 })] : []),
      ]),
    });
  }
  if (s.personaRows.length) {
    rows.push({
      label: 'Personas',
      value: v(
        s.personaRows.map(({ role, cares }, i) => ({
          text: `${role} — ${cares}`,
          size: 9.5,
          above: i === 0 ? 0 : 2,
          runs: [{ text: role, weight: 600 }, { text: ` — ${cares}` }],
        }))
      ),
    });
  }
  return rows;
}

function icpPages(ctx: Ctx): MktgPrintPage[] {
  const { look, view } = ctx;
  const labelW = 92;
  const valueW = RIGHT.w - labelW;
  const pages: MktgPrintPage[] = [];
  for (const s of view.icps) {
    const meta = [s.kind, s.basis ? `Basis: ${s.basis}` : null].filter(Boolean).join(' · ');
    const left = mktgPrintRich(look, [
      mktgPrintPara(s.name, 14, { weight: 600 }),
      mktgPrintPara(meta, 8, { color: look.muted, above: 4 }),
      mktgPrintPara(s.who ?? '', 10, { above: 8 }),
      mktgPrintPara(s.goalLabel ? `Goals: ${s.goalLabel}` : '', 8.5, { color: look.muted, above: 6 }),
    ]);
    // The card on one page at the print's size or a little smaller; else its rows continue (a row taller than a page is set smaller, then cut).
    const base = icpRows(ctx, s);
    const rows = mktgPrintScaleRows(
      base.map((r) => r.value),
      valueW,
      AREA.h
    ).map((scaled, i) => {
      const value = mktgPrintClampRow(scaled, valueW, AREA.h);
      return { label: base[i].label, value, h: mktgPrintRowHeight(value, valueW) };
    });
    const rowPages = mktgPrintPaginate(rows, (page) => page.reduce((h, r) => h + r.h, 0) <= AREA.h);
    rowPages.forEach((page) => {
      const els: MktgPrintPageEl[] = [mktgPrintTextEl(LEFT, left)];
      let y = AREA.y;
      for (const r of page) {
        els.push(mktgPrintHairline(look, RIGHT.x, y, RIGHT.w));
        els.push(mktgPrintRowEl(RIGHT.x, y, labelW, mktgPrintRich(look, [mktgPrintEyebrowPara(look, r.label, { above: 1.5 })])));
        els.push(mktgPrintRowEl(RIGHT.x + labelW, y, valueW, r.value));
        y += r.h;
      }
      pages.push(mktgPrintContentPage(look, mktgPrintContinued('ICPs', pages.length), head(ctx, 'icps'), els));
    });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// 03 Message house
// ---------------------------------------------------------------------------

function pillarRich(ctx: Ctx, p: FoundationMessagePillar, proofs: boolean, messages = true): MktgPrintRich {
  const { look } = ctx;
  return mktgPrintRich(look, [
    mktgPrintPara(p.t, 10.5, { weight: 600 }),
    ...(messages ? [mktgPrintPara(p.m, 9, { above: 3 })] : []),
    ...(proofs ? p.p.map(([f, s], i) => proofPara(look, f, s, 8, i === 0 ? 6 : 2)) : []),
  ]);
}

const pillarCard = (look: MktgPrintPageLook) => ({
  shape: 'RECTANGLE' as const,
  fill: WHITE,
  line: { color: look.rule, weight: MKTG_PRINT_FRAMEWORK_CARD_LINE },
});

function messageHousePages(ctx: Ctx): MktgPrintPage[] {
  const { look, view } = ctx;
  const mh = view.mh;
  // Every pillar (the framework contract allows one to five), side by side.
  const pillars = mh.pillars;
  const n = Math.max(1, pillars.length);
  const pw = (671 - (n - 1) * 10) / n;
  const pillarTop = 163;
  const pillarH = 136;
  // The pillars share one size: the largest at which every card fits with its proof points (down to 85%); else the proof points continue.
  const pillarScale = [1, 0.95, 0.9, 0.85].find((sc) => pillars.every((p) => mktgPrintFits(mktgPrintScaleRich(pillarRich(ctx, p, true), sc), pw, pillarH)));
  const withProofs = pillarScale !== undefined;
  const els: MktgPrintPageEl[] = [];
  const roof = [
    mktgPrintEyebrowPara(look, 'Umbrella', { color: look.onDark }),
    ...(mh.umbrella ? [mktgPrintPara(mh.umbrella, 10, { color: look.onDark, above: 3 })] : []),
    ...(mh.line ? [mktgPrintPara(mh.line, 13, { weight: 500, color: look.onDark, above: 3 })] : []),
  ];
  els.push(
    mktgPrintTextEl({ x: 25, y: AREA.y, w: 671, h: 66 }, mktgPrintRich(look, roof, { align: 'CENTER', anchor: 'MIDDLE' }), {
      shape: 'ROUND_RECTANGLE',
      fill: look.dark,
      line: null,
    })
  );
  pillars.forEach((p, i) => {
    const x = 25 + i * (pw + 10);
    els.push(mktgPrintTextEl({ x, y: pillarTop, w: pw, h: pillarH }, mktgPrintScaleRich(pillarRich(ctx, p, withProofs), pillarScale ?? 1), pillarCard(look)));
    els.push(mktgPrintShapeEl('RECTANGLE', { x, y: pillarTop, w: pw, h: 3 }, look.accent));
  });
  if (mh.found) {
    els.push(
      mktgPrintTextEl(
        { x: 25, y: 307, w: 671, h: 49 },
        mktgPrintRich(look, [mktgPrintEyebrowPara(look, 'Foundation'), mktgPrintPara(mh.found, 9.5, { above: 2 })], { align: 'CENTER', anchor: 'MIDDLE' }),
        { shape: 'ROUND_RECTANGLE', fill: look.tint, line: null }
      )
    );
  }
  const pages = [mktgPrintContentPage(look, 'Message house', head(ctx, 'message-house'), els)];
  if (!withProofs && pillars.some((p) => p.p.length)) {
    // The pillars' proof points did not fit the house: they continue, a card per pillar.
    const more: MktgPrintPageEl[] = pillars.map((p, i) =>
      mktgPrintTextEl({ x: 25 + i * (pw + 10), y: AREA.y, w: pw, h: AREA.h }, pillarRich(ctx, p, true, false), pillarCard(look))
    );
    pillars.forEach((_, i) => more.push(mktgPrintShapeEl('RECTANGLE', { x: 25 + i * (pw + 10), y: AREA.y, w: pw, h: 3 }, look.accent)));
    pages.push(mktgPrintContentPage(look, mktgPrintContinued('Message house', 1), head(ctx, 'message-house'), more));
  }
  const nameW = 190;
  const leadW = 671 - nameW;
  const audA = (a: string) => mktgPrintRich(look, [mktgPrintPara(a, 10.5, { weight: 600 })]);
  const audB = (b: string) => mktgPrintRich(look, [mktgPrintPara(b, 10.5)]);
  // Each row bounded to a page (set smaller, then cut), then as many rows a page as fit.
  const audRows = view.audiences.map((r) => ({
    a: mktgPrintClampRow(audA(r.name), nameW, AREA.h - 6),
    b: mktgPrintClampRow(audB(r.lead), leadW, AREA.h - 6),
  }));
  const rowOf = (r: { a: MktgPrintRich; b: MktgPrintRich }) => Math.max(mktgPrintRowHeight(r.a, nameW), mktgPrintRowHeight(r.b, leadW)) + 6;
  mktgPrintPaginate(audRows, (rows) => rows.reduce((h, r) => h + rowOf(r), 0) <= AREA.h).forEach((rows, k) => {
    const out: MktgPrintPageEl[] = [];
    let y = AREA.y;
    for (const r of rows) {
      out.push(mktgPrintHairline(look, 25, y, 671));
      out.push(mktgPrintRowEl(25, y + 3, nameW, r.a));
      out.push(mktgPrintRowEl(25 + nameW, y + 3, leadW, r.b));
      y += rowOf(r);
    }
    pages.push(mktgPrintContentPage(look, mktgPrintContinued('Audiences', k), head(ctx, 'message-house'), out));
  });
  return pages;
}

// ---------------------------------------------------------------------------
// 04 Key numbers
// ---------------------------------------------------------------------------

function numberPages(ctx: Ctx): MktgPrintPage[] {
  const { look, view } = ctx;
  const w = (671 - 20) / 3;
  const tiles: FoundationMessagePair[] = view.numbers.map((r) => [r.number, r.label]);
  return mktgPrintPaginate(tiles, (page) => page.length <= MKTG_PRINT_FRAMEWORK_NUMBERS_PER_PAGE).map((page, k) => {
    const els: MktgPrintPageEl[] = page.map(([n, label], i) =>
      mktgPrintTextEl(
        { x: 25 + (i % 3) * (w + 10), y: AREA.y + Math.floor(i / 3) * 110, w, h: 100 },
        mktgPrintRich(look, [mktgPrintPara(n, 28, { weight: 500, color: look.accent }), mktgPrintPara(label, 9, { color: look.muted, above: 4 })], {
          align: 'CENTER',
          anchor: 'MIDDLE',
        }),
        { shape: 'ROUND_RECTANGLE', fill: look.tint, line: null }
      )
    );
    els.push(mktgPrintTextEl({ x: 25, y: 318, w: 671, h: 24 }, mktgPrintRich(look, [mktgPrintPara(view.eyebrow, 7.5, { color: look.muted })])));
    return mktgPrintContentPage(look, mktgPrintContinued('Key numbers', k), head(ctx, 'numbers'), els);
  });
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * The framework's content pages after the cover, in the print's order
 * (framework-print.ts frameworkPrintSlides), each with its page number in
 * the footer (the deck's template slide number: the cover is page
 * `firstPage`, the first content page `firstPage + 1`) and no footer line.
 */
export function buildFrameworkPrintPages(view: FoundationMessagePrintView, options: MktgPrintFrameworkOptions = {}): MktgPrintPage[] {
  const first = options.firstPage ?? 1;
  const ctx: Ctx = { view, look: mktgPrintPageLook(view.brand) };
  const out: MktgPrintPage[] = [];
  out.push(frameworkPage(ctx));
  if (view.goals.length) out.push(...goalPages(ctx, 0));
  if (view.mf.say.length || view.avoidRows.length) out.push(...sayAvoidPages(ctx));
  if (view.mf.anchor.length) out.push(anchorPage(ctx));
  if (view.icps.length) out.push(...icpPages(ctx));
  out.push(...messageHousePages(ctx));
  if (view.numbers.length) out.push(...numberPages(ctx));
  return out.map((page, i) => ({ ...page, footer: { left: '', number: String(first + 1 + i) } }));
}

/** How many pages the framework prints: the cover and its content pages (buildFrameworkPrintPages). The deck has no back cover for it. */
export function mktgPrintFrameworkPageCount(view: FoundationMessagePrintView, options: MktgPrintFrameworkOptions = {}): number {
  return 1 + buildFrameworkPrintPages(view, options).length;
}

/** The section a content page belongs to, from its running head (`01 Framework` → `framework`); null for a cover. */
export function mktgPrintFrameworkSectionOf(page: MktgPrintPage): MktgPrintFrameworkSectionId | null {
  const left = page.head?.left ?? '';
  return MKTG_PRINT_FRAMEWORK_SECTIONS.find((s) => left === `${s.number} ${s.title}`)?.id ?? null;
}
