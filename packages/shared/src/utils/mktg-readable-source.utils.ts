// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_FOUND_IN_KINDS, BRAND_KIT_OPAQUE_FILE_STEM_REGEX } from '../constants/brand-kit.constants';
import { MKTG_READABLE_SOURCE } from '../constants/mktg-readable-source.constants';
import { brandKitWebsiteHost } from './brand-kit.utils';

/** Where a URL starts in the record's prose. */
const URL_START_REGEX = /https?:\/\//gi;
/** What ends a URL in prose: whitespace, or the closing bracket or quote the record wraps it in. */
const URL_END = new Set([' ', '\t', '\n', '\r', '\f', '\v', '\u00a0', ')', ']', '}', '>', '"', "'", '”', '’']);
/** The sentence's own punctuation after a URL (`…logo.svg.`, `…/brand,`): kept out of the address and put back after it. */
const URL_TRAIL = new Set(['.', ',', ';', ':', '!', '?']);
/** The words a rewrite can produce: a parenthetical holding one source alone is dropped only when its rewrite is one of them. */
const READABLE_PHRASES = new Set<string>(Object.values(MKTG_READABLE_SOURCE));

/**
 * A bare file name (no `/` before it) with an image, archive or document extension, as the record names uploads and site
 * files; a full stop after the extension is the sentence's own (`Could not read logo.svg.`) unless a name goes on after it.
 */
const FILE_NAME_SOURCE = '(?<![\\w/.%-])[\\w.%-]+\\.(?:svg|png|jpe?g|webp|gif|pdf|eps|ai|zip|tar\\.gz|7z|rar)(?![\\w%-])(?!\\.[\\w%-])';
const FILE_NAME_REGEX = new RegExp(FILE_NAME_SOURCE, 'gi');
const WHOLE_FILE_NAME_REGEX = new RegExp(`^${FILE_NAME_SOURCE}$`, 'i');
/** ` (https://…)` or ` (logo.svg)`: a parenthetical the record wrote around one source and nothing else. */
const SOURCE_PARENTHETICAL_REGEX = new RegExp(` \\((https?://[^\\s()]+|${FILE_NAME_SOURCE})\\)`, 'gi');
/**
 * `agentic.ai`, `agntcy.eps`: in prose a token whose extension is also a top-level domain (`.ai`, `.eps` is not one, but
 * reads the same way) is host-shaped, not a file, unless its stem is a CDN's hash or the record wrote it as a file
 * (`logo_v2.ai`, an underscore or a size suffix): a site's name is printed as written, never as "an uploaded logo file".
 */
const HOST_SHAPED_EXTENSION_REGEX = /\.(?:ai|eps)$/i;
const FILE_SHAPED_STEM_REGEX = /[_]|[-_]\d+x\d+$/;

const ARCHIVE_REGEX = /\.(?:zip|tar\.gz|7z|rar)$/i;
/** `site_css: https://…`, `logo: brand.zip/logo.svg`: the record's provenance kind before the source itself, one of the kit's kinds and nothing else (`Note: …` is the record's own word). */
const KIND_PREFIX_REGEX = new RegExp(`^(?:${BRAND_KIT_FOUND_IN_KINDS.join('|')}):\\s+(?=\\S)`, 'i');
/** `brand.zip/logo.svg`: a member of an uploaded archive. */
const ARCHIVE_MEMBER_REGEX = /^[^\s/]+\.(?:zip|tar\.gz|7z|rar)\/\S+$/i;
const IMAGE_REGEX = /\.(?:svg|png|jpe?g|webp|gif|eps|ai)$/i;

/** The file name's stem: the last path segment without its extension and a CMS's `-838x203` size suffix. */
function fileStem(path: string): string {
  const segment = path.split('/').pop() ?? '';
  return segment
    .replace(/\.(?:tar\.gz|[a-z0-9]{1,5})$/i, '')
    .replace(/[-_]\d+x\d+$/i, '')
    .trim();
}

/** Whether a file is named by nothing a reader knows (a CDN's hash, a UUID), the kit's own test; a path with no file in it (a site's root) is not a file. */
function isOpaque(path: string): boolean {
  const stem = fileStem(path);
  return stem !== '' && BRAND_KIT_OPAQUE_FILE_STEM_REGEX.test(stem);
}

/**
 * One source of a run record in words a reader knows, the editor's rule
 * (7 November 2026): never a hashed file name, never a long file URL. The LFX
 * record by name; an archive URL as the logo package the site links; an
 * image URL as a logo image the site links; a hashed URL as a file the site
 * links; a stylesheet chunk as the site's stylesheets; any other URL (a page,
 * a brand guide PDF) as its address without scheme, `www.` or query, the
 * record naming nothing more readable; a bare file name as the uploaded
 * files, whatever it is called. Framework and family Sources pages share it.
 */
export function mktgReadableSourceName(source: string, count: 'one' | 'many' = 'many'): string {
  const text = source.trim();
  if (/^LFX record/i.test(text)) return MKTG_READABLE_SOURCE.lfxRecord;
  // The framework's record line names itself with its slug ("LFX project record agentic-ai-foundation and standard metrics");
  // the kit's bare "LFX project record" line, and its "LFX project record — … was not found" row, print as written.
  if (/^LFX project record\s+[A-Za-z0-9]/i.test(text)) return MKTG_READABLE_SOURCE.lfxRecord;
  if (KIND_PREFIX_REGEX.test(text)) return mktgReadableSourceName(text.replace(KIND_PREFIX_REGEX, ''), count);
  const isUrl = /^https?:\/\//i.test(text);
  if (!isUrl) {
    if (ARCHIVE_MEMBER_REGEX.test(text)) return MKTG_READABLE_SOURCE.uploadedPackage;
    if (WHOLE_FILE_NAME_REGEX.test(text) && !isHostShaped(text)) {
      if (ARCHIVE_REGEX.test(text)) return MKTG_READABLE_SOURCE.uploadedPackage;
      return count === 'one' ? MKTG_READABLE_SOURCE.uploadedFile : MKTG_READABLE_SOURCE.uploadedFiles;
    }
    return text;
  }
  const query = text.search(/[?#]/);
  const path = query === -1 ? text : text.slice(0, query);
  const host = brandKitWebsiteHost(text);
  // The file tests read the pathname alone: a host's top-level domain (`agntcy.ai`) is no extension.
  const pathname = path.replace(/^https?:\/\/[^/]*/i, '');
  if (ARCHIVE_REGEX.test(pathname)) return MKTG_READABLE_SOURCE.linkedPackage;
  if (IMAGE_REGEX.test(pathname)) return MKTG_READABLE_SOURCE.linkedImage;
  if (isOpaque(pathname)) return MKTG_READABLE_SOURCE.linkedFile;
  if (host && /\/_next\/static\/|\.css$/i.test(pathname)) return `${host} stylesheets`;
  return path.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '');
}

/**
 * A sentence of the run record (a reason, a warning, a gap, a note, a fix)
 * with every URL and bare file name in it replaced by `mktgReadableSourceName`'s
 * words, so no hashed name and no long file URL is printed, the sentence's own
 * punctuation kept after the rewritten address. A parenthetical the record
 * wrote around one source alone (" (logo.svg)", " (https://…/logo.svg)") whose
 * rewrite is only such words ("links a logo image (a logo image linked from
 * the site)") is dropped with it, the sentence already naming the thing; a
 * parenthetical with any other words, or one the record wrote in words, stays.
 * A host-shaped token (`agentic.ai`) is not a file and prints as written.
 */
export function mktgReadableSourceText(text: string): string {
  const withoutSourceParentheticals = text.replace(SOURCE_PARENTHETICAL_REGEX, (whole, source: string) =>
    READABLE_PHRASES.has(mktgReadableProseName(source)) ? '' : whole
  );
  return mktgReplaceUrls(withoutSourceParentheticals, (url) => mktgReadableSourceName(url, 'one')).replace(FILE_NAME_REGEX, (name) =>
    isHostShaped(name) ? name : mktgReadableProseName(name)
  );
}

/** A URL or a bare file name in prose, in words: a hashed bare name is a logo image the site links (the record's CDN names). */
function mktgReadableProseName(source: string): string {
  if (/^https?:\/\//i.test(source)) return mktgReadableSourceName(source, 'one');
  return isOpaque(source) ? MKTG_READABLE_SOURCE.linkedImage : mktgReadableSourceName(source, 'one');
}

/** Whether a token in prose is a site's name rather than a file (`agentic.ai`), by its extension and stem. */
function isHostShaped(token: string): boolean {
  return HOST_SHAPED_EXTENSION_REGEX.test(token) && !isOpaque(token) && !FILE_SHAPED_STEM_REGEX.test(fileStem(token));
}

/**
 * Every URL in a text replaced by `rewrite`'s words, the sentence's own punctuation after it kept: each address is read
 * once, forward to what ends it and back over its trailing punctuation, so the pass is linear in the text (a run record
 * is library input; no backtracking pattern runs over it).
 */
function mktgReplaceUrls(text: string, rewrite: (url: string) => string): string {
  let out = '';
  let from = 0;
  for (const start of text.matchAll(URL_START_REGEX)) {
    const begin = start.index;
    if (begin < from) continue;
    let end = begin + start[0].length;
    while (end < text.length && !URL_END.has(text[end])) end += 1;
    let address = end;
    while (address > begin + start[0].length && URL_TRAIL.has(text[address - 1])) address -= 1;
    if (address === begin + start[0].length) continue;
    out += text.slice(from, begin) + rewrite(text.slice(begin, address)) + text.slice(address, end);
    from = end;
  }
  return out + text.slice(from);
}
