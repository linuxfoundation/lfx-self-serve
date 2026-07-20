#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Phase-1 newsletter block-manifest generator (LFXV2-2381).
 *
 * Parses the declarative newsletter templates (the hard-coded template repo) and
 * emits a NewsletterTemplateManifest JSON asset consumed by the block-composer
 * editor. Under the unified model, `blocks/` AND `bricks/` are ONE block
 * namespace — the filename (without extension) is the `block_type`.
 *
 * Each template begins with an HTML comment of the form:
 *   <!-- SCHEMA: { ...JSON... } -->
 * The JSON is parsed into the manifest entry's `schema`. A block is a container
 * (`is_container: true`) when its schema declares a field of type `slot`.
 *
 * For the client-side visual editor (LFXV2-2381), each entry also carries its
 * raw `template` HTML (the element tree with the SCHEMA comment stripped) and
 * the manifest carries the top-level `wrapper` template (the page chrome). The
 * declarative renderer in the Angular app parses these client-side to draw a
 * styled preview on the composer canvas — the server MJML render remains the
 * source of truth for the SENT email.
 *
 * Usage:
 *   node scripts/build-newsletter-manifest.mjs [--template-repo <path>]
 *
 * Defaults to the local clone at ../../../gatewaze/newsletter-aaif-user-community
 * relative to the app root. Pass --template-repo to override.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..'); // apps/lfx-one

// The Phase-1 template repo lives as a sibling checkout under the gatewaze org
// clone. Resolved from the GATEWAZE_TEMPLATE_REPO env var, then a small set of
// likely sibling locations, then --template-repo overrides everything.
const DEFAULT_TEMPLATE_CANDIDATES = [
  process.env.GATEWAZE_TEMPLATE_REPO,
  resolve(APP_ROOT, '..', '..', '..', 'gatewaze', 'newsletter-aaif-user-community'),
  resolve(APP_ROOT, '..', '..', '..', '..', 'gatewaze', 'newsletter-aaif-user-community'),
].filter(Boolean);
const OUTPUT_PATH = join(APP_ROOT, 'public', 'assets', 'newsletter-block-manifest.json');

// The two template directories that make up the single block namespace.
const BLOCK_DIRS = ['blocks', 'bricks'];
const WRAPPER_KEY = 'default';
// The page-chrome wrapper template (header / footer + <slot name="body" />).
const WRAPPER_PATH = ['wrappers', `${WRAPPER_KEY}.html`];

// Platform-level blocks that are NOT authored as files in the template repo but
// are always available in the palette. The gatewaze editor ships these as
// composite react-email blocks (see gatewaze-modules .../email-blocks/blocks/).
// We declare them here as declarative templates so the same client renderer can
// draw them. `logo_header` is the top-of-edition banner: a full-width logo image
// with an optional right-aligned brand label, mirroring gatewaze's LogoHeader.
//
// This is a generic platform block, so its fields ship without defaults — the
// author supplies the banner image, link, and brand label per edition. The
// template guards each field with `if=`, so an unfilled block simply renders
// nothing. Tenant-specific assets (e.g. a project's masthead) belong in
// per-project/template config, not baked into the shared platform palette.
const PLATFORM_BLOCKS = [
  {
    block_type: 'logo_header',
    label: 'Logo Header',
    category: 'navigation',
    icon: 'fa-light fa-image',
    schema: {
      image_url: {
        type: 'image',
        label: 'Banner image URL',
        default: '',
      },
      brand_label: {
        type: 'text',
        label: 'Brand label (right side)',
        default: '',
      },
      link: {
        type: 'text',
        label: 'Link URL',
        default: '',
      },
    },
    template: [
      '<Section style="padding:16px 24px">',
      '  <Row>',
      '    <Column style="width:50%;vertical-align:middle">',
      '      <Link href="{{link}}"><Img if="image_url" src="{{image_url}}" alt="" width="98" style="display:block;border:0" /></Link>',
      '    </Column>',
      '    <Column style="width:50%;vertical-align:middle;text-align:right">',
      '      <Text if="brand_label" style="margin:0;font-size:13px;color:#7B7D81;text-align:right">{{brand_label}}</Text>',
      '    </Column>',
      '  </Row>',
      '</Section>',
    ].join('\n'),
  },
];

/** Parse `--template-repo <path>` from argv, falling back to the default clone. */
function parseTemplateRepo(argv) {
  const idx = argv.indexOf('--template-repo');
  if (idx !== -1 && argv[idx + 1]) {
    return resolve(argv[idx + 1]);
  }
  return DEFAULT_TEMPLATE_CANDIDATES.find((candidate) => existsSync(candidate)) ?? DEFAULT_TEMPLATE_CANDIDATES[0];
}

/** Humanize a snake_case filename into a Title Case label. */
function humanize(blockType) {
  return blockType
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Extract the JSON from a leading `<!-- SCHEMA: {...} -->` comment. */
function extractSchema(html, filePath) {
  const match = html.match(/<!--\s*SCHEMA:\s*([\s\S]*?)-->/);
  if (!match) {
    throw new Error(`No SCHEMA comment found in ${filePath}`);
  }
  const raw = match[1].trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid SCHEMA JSON in ${filePath}: ${err.message}`);
  }
}

/** A block is a container when any top-level field declares `type: "slot"`. */
function hasSlotField(schema) {
  return Object.values(schema).some((field) => field && typeof field === 'object' && field.type === 'slot');
}

/**
 * Strip the leading `<!-- SCHEMA: {...} -->` comment (and surrounding blank
 * lines) from a template, returning just the element-tree body that the
 * client-side renderer walks. The schema is already captured separately.
 */
function extractTemplateBody(html) {
  // Drop ALL HTML comments — the SCHEMA comment (captured separately) plus any
  // authoring notes. Comments are inert in the renderer (the DOM walk ignores
  // them), so stripping them just keeps the bundled asset tidy. Loop until the
  // string is stable so a single pass can't leave a re-formed `<!--` behind
  // (CodeQL: incomplete multi-character sanitization) — the inputs are trusted
  // build-time template files, but keep the strip robust regardless.
  let out = html;
  let prev;
  do {
    prev = out;
    out = out.replace(/<!--[\s\S]*?-->/g, '');
  } while (out !== prev);
  return out.trim();
}

/** Best-effort provenance: the template repo's git remote + pinned commit. */
function resolveSource(templateRepo) {
  const gitDir = join(templateRepo, '.git');
  if (!existsSync(gitDir)) {
    return undefined;
  }
  try {
    const repo = execFileSync('git', ['-C', templateRepo, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const commit = execFileSync('git', ['-C', templateRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    return { repo, commit };
  } catch {
    return undefined;
  }
}

/** Read one block directory into manifest entries. */
function readBlockDir(templateRepo, dir) {
  const dirPath = join(templateRepo, dir);
  if (!existsSync(dirPath)) {
    return [];
  }
  return readdirSync(dirPath)
    .filter((name) => extname(name) === '.html')
    .map((name) => {
      const filePath = join(dirPath, name);
      const html = readFileSync(filePath, 'utf8');
      const schema = extractSchema(html, filePath);
      const blockType = basename(name, '.html');
      const entry = {
        block_type: blockType,
        label: humanize(blockType),
        category: 'block',
        schema,
        // Raw element tree (SCHEMA comment stripped) for the client-side renderer.
        template: extractTemplateBody(html),
      };
      if (hasSlotField(schema)) {
        entry.is_container = true;
      }
      return entry;
    });
}

function main() {
  const templateRepo = parseTemplateRepo(process.argv.slice(2));
  if (!existsSync(templateRepo)) {
    console.error(`Template repo not found: ${templateRepo}`);
    console.error('Pass --template-repo <path> to point at the newsletter template clone.');
    process.exit(1);
  }

  const blocks = [...PLATFORM_BLOCKS, ...BLOCK_DIRS.flatMap((dir) => readBlockDir(templateRepo, dir))]
    // Deterministic order so the committed asset diffs cleanly across runs.
    .sort((a, b) => a.block_type.localeCompare(b.block_type));

  if (blocks.length === 0) {
    console.error(`No block templates found under ${BLOCK_DIRS.join(', ')} in ${templateRepo}`);
    process.exit(1);
  }

  const manifest = {
    wrapper_key: WRAPPER_KEY,
    blocks,
  };

  // Page-chrome wrapper template (header/footer + <slot name="body" />) for the
  // client-side preview. Optional — the editor falls back to a bare body when
  // it's absent.
  const wrapperPath = join(templateRepo, ...WRAPPER_PATH);
  if (existsSync(wrapperPath)) {
    manifest.wrapper = extractTemplateBody(readFileSync(wrapperPath, 'utf8'));
  }

  const source = resolveSource(templateRepo);
  if (source) {
    manifest.source = source;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const containerCount = blocks.filter((b) => b.is_container).length;
  console.log(`Wrote ${blocks.length} block(s) (${containerCount} container) to ${OUTPUT_PATH}`);
  if (source) {
    console.log(`Source: ${source.repo} @ ${source.commit}`);
  }
}

main();
