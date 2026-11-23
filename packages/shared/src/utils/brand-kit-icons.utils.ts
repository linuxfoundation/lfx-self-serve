// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's iconography samples: the colours a kit tints them with.
// Pure, so the web card, the print sheet and the Slides export's PNGs all
// take the same three colours from the same kit.

import { BRAND_KIT_HEX_REGEX } from '../constants/brand-kit.constants';
import { BrandKitIconColours } from '../interfaces/brand-kit-icons.interface';
import { BrandKitPaletteEntry, BrandKitRevision } from '../interfaces/brand-kit.interface';

/** Whether a palette entry's name appears, as a whole word, in any of the lines (case-insensitive). */
function namedInRules(entry: BrandKitPaletteEntry, rules: readonly string[]): boolean {
  const name = entry.name.trim();
  if (!name) {
    return false;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'iu');
  return rules.some((rule) => word.test(rule));
}

/**
 * The three colour roles of the iconography samples, from the kit's own
 * colours (the design board's, with the maintainer's correction): the
 * tiles' ink and the strip's ground are the kit's dark; the highlight (the
 * one strip icon not in white) is the colour the kit's own Iconography rule
 * names ("Lilac only for a single active state": the last palette colour
 * the rules name, in palette order), else the kit's spark when it is a
 * colour, else the accent. The rule wins over the spark because a kit's
 * spark and the colour its rule reserves for the active state can differ,
 * and the samples show what the rule says.
 */
export function brandKitIconColours(kit: BrandKitRevision): BrandKitIconColours {
  const { dark, accent, spark } = kit.kit;
  const rules = kit.chapters.visual.icons.rules;
  const named = kit.chapters.color.palette.filter((entry) => BRAND_KIT_HEX_REGEX.test(entry.hex) && namedInRules(entry, rules));
  const last = named.at(-1);
  let highlight = accent;
  if (last) {
    highlight = last.hex;
  } else if (BRAND_KIT_HEX_REGEX.test(spark)) {
    highlight = spark;
  }
  return { tileInk: dark, stripGround: dark, highlight };
}
