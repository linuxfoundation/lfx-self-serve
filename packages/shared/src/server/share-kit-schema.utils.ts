// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Validates share kit content files (`apps/lfx-one/content/events/<eventSlug>/share-kit.json`, #6058).
// Content owners edit these files by PR, so every field is checked here: plain text only, https links,
// and no keys beyond the schema (a typo'd or unexpected key fails instead of being silently ignored).
import { z } from 'zod';

import {
  SHARE_KIT_HEADING_FONTS,
  SHARE_KIT_LOCAL_ASSET_PREFIX,
  SHARE_KIT_MIN_TEXT_CONTRAST,
  SHARE_KIT_PLATFORM_LIMITS,
  SHARE_KIT_SLUG_PATTERN,
} from '../constants/share-kit.constants';
import { ShareKitContent, ShareKitValidationResult } from '../interfaces/share-kit.interface';
import { buildShareKitTrackedUrl, countShareKitPostLength, shareKitContrastRatio, shareKitMemberBoxColors } from '../utils/share-kit.utils';

const MARKUP_PATTERN = /<[a-z!/?][^>]*>/i;

/** Plain text: trimmed, non-empty, no HTML tags. */
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !MARKUP_PATTERN.test(value), 'must be plain text, not HTML');

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), 'must start with https://');

/** Graphics may also live in the app's public folder, under `/share-kits/<eventSlug>/`. */
const imageUrl = z.union([
  httpsUrl,
  z
    .string()
    .regex(
      /^\/share-kits\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif|svg)$/,
      `must be https or a path under ${SHARE_KIT_LOCAL_ASSET_PREFIX}<eventSlug>/`
    ),
]);

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  // Date.parse rolls impossible days over (2027-02-30 → March 2), so round-trip the day instead.
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00Z`);
    return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
  }, 'must be a real date');

const slug = z.string().regex(SHARE_KIT_SLUG_PATTERN, 'must be lowercase letters, digits and hyphens');

// X and Bluesky count a link at a fixed length, so any https URL stands in for the real one here.
const PLACEHOLDER_LINK = 'https://events.example.org/';

/** Text for one platform that still fits once the copy button adds the blank line and the link. */
const fixedLinkPostText = (platform: 'x' | 'bluesky') =>
  plainText(SHARE_KIT_PLATFORM_LIMITS[platform].limit).superRefine((text, ctx) => {
    const length = countShareKitPostLength(text, PLACEHOLDER_LINK, platform);
    const { limit } = SHARE_KIT_PLATFORM_LIMITS[platform];
    if (length > limit) {
      ctx.addIssue({ code: 'custom', message: `is ${length} of ${limit} characters once the link is added; shorten it by ${length - limit}` });
    }
  });

const postSchema = z
  .object({
    id: slug,
    title: plainText(80),
    text: z.object({ linkedin: plainText(2800), x: fixedLinkPostText('x'), bluesky: fixedLinkPostText('bluesky') }).strict(),
  })
  .strict();

const graphicSchema = z
  .object({
    label: plainText(80),
    url: imageUrl,
    alt: plainText(300),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a #RRGGBB colour');

// Each text colour and the background it is drawn on: white sits on `primary` (copy buttons), and `primary` is
// text on the page and on white cards (links, tabs, outline buttons).
const THEME_CONTRAST_PAIRS = [
  ['heroText', 'hero'],
  ['buttonText', 'button'],
  ['#FFFFFF', 'primary'],
  ['primary', 'page'],
  ['primary', '#FFFFFF'],
] as const;

const themeSchema = z
  .object({
    colors: z
      .object({
        hero: hexColor,
        heroText: hexColor,
        soft: hexColor,
        accent: hexColor,
        button: hexColor,
        buttonText: hexColor,
        primary: hexColor,
        page: hexColor,
      })
      .strict()
      .superRefine((colors, ctx) => {
        const colorOf = (key: string): string => (key.startsWith('#') ? key : colors[key as keyof typeof colors]);
        for (const [text, background] of THEME_CONTRAST_PAIRS) {
          const ratio = shareKitContrastRatio(colorOf(text), colorOf(background));
          if (ratio < SHARE_KIT_MIN_TEXT_CONTRAST) {
            ctx.addIssue({
              code: 'custom',
              path: [background],
              message: `${text} on ${background} has contrast ${ratio.toFixed(2)}:1; it needs at least ${SHARE_KIT_MIN_TEXT_CONTRAST}:1`,
            });
          }
        }
        // Hero text also sits on the member box, which is lighter (or darker) than the hero, and darker still under a hovered button.
        const { hover } = shareKitMemberBoxColors(colors.hero, colors.heroText);
        const memberRatio = shareKitContrastRatio(colors.heroText, hover);
        if (memberRatio < SHARE_KIT_MIN_TEXT_CONTRAST) {
          ctx.addIssue({
            code: 'custom',
            path: ['hero'],
            message: `heroText on the member box has contrast ${memberRatio.toFixed(2)}:1; it needs at least ${SHARE_KIT_MIN_TEXT_CONTRAST}:1, so the hero needs more contrast with its text`,
          });
        }
      }),
    logo: z
      .object({ url: imageUrl, alt: plainText(120), width: z.number().int().positive(), height: z.number().int().positive() })
      .strict()
      .optional(),
    headline: plainText(120).optional(),
    headingFont: z.enum(SHARE_KIT_HEADING_FONTS),
  })
  .strict();

export const shareKitContentSchema = z
  .object({
    eventSlug: slug,
    foundationSlug: slug,
    foundationName: plainText(120),
    title: plainText(120),
    tagline: plainText(300),
    startDate: isoDay,
    endDate: isoDay,
    venue: plainText(120),
    city: plainText(120),
    eventUrl: httpsUrl,
    registration: z.object({ url: httpsUrl, priceLabel: plainText(40), earlyBirdUntil: isoDay.optional() }).strict(),
    posts: z.array(postSchema).min(1).max(12),
    newsletterBlurb: z.object({ text: plainText(1200), url: httpsUrl }).strict(),
    graphics: z.array(graphicSchema).max(12),
    cfp: z
      .object({
        url: httpsUrl,
        closesOn: isoDay,
        heading: plainText(120),
        body: plainText(600),
        invitation: plainText(240),
        guide: z
          .object({ title: plainText(120), description: plainText(300), url: httpsUrl })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    ogImage: z
      .object({ url: imageUrl, alt: plainText(300) })
      .strict()
      .optional(),
    theme: themeSchema.optional(),
    memberBenefit: z
      .object({ membershipSlug: slug, membershipName: plainText(80), discountLabel: plainText(80), joinUrl: httpsUrl })
      .strict()
      .optional(),
  })
  .strict()
  .refine((content) => content.endDate >= content.startDate, { message: 'endDate must not be before startDate', path: ['endDate'] })
  .refine((content) => new Set(content.posts.map((post) => post.id)).size === content.posts.length, {
    message: 'post ids must be unique',
    path: ['posts'],
  })
  .superRefine((content, ctx) => {
    // LinkedIn counts the link in full, so check each post with the tracked link the copy button adds.
    // A malformed registration URL is already reported above; building a link from it would throw.
    if (!httpsUrl.safeParse(content.registration.url).success) {
      return;
    }
    const { limit } = SHARE_KIT_PLATFORM_LIMITS.linkedin;
    content.posts.forEach((post, index) => {
      const link = buildShareKitTrackedUrl(content.registration.url, { medium: 'linkedin', campaign: content.eventSlug, content: post.id });
      const length = countShareKitPostLength(post.text.linkedin, link, 'linkedin');
      if (length > limit) {
        ctx.addIssue({
          code: 'custom',
          message: `is ${length} of ${limit} characters once the link is added; shorten it by ${length - limit}`,
          path: ['posts', index, 'text', 'linkedin'],
        });
      }
    });
  });

/** Validates raw share kit content. `expectedSlug` is the folder name, which must match `eventSlug`. */
export function validateShareKitContent(raw: unknown, expectedSlug?: string): ShareKitValidationResult {
  const parsed = shareKitContentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`) };
  }
  if (expectedSlug !== undefined && parsed.data.eventSlug !== expectedSlug) {
    return { ok: false, problems: [`eventSlug: "${parsed.data.eventSlug}" must match its folder name "${expectedSlug}"`] };
  }
  return { ok: true, content: parsed.data as ShareKitContent, problems: [] };
}
