// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_OPAQUE_FILE_STEM_REGEX } from '../constants/brand-kit.constants';
import { MKTG_READABLE_SOURCE } from '../constants/mktg-readable-source.constants';
import { brandKitWebsiteHost } from './brand-kit.utils';

/** A URL, up to whitespace or a closing bracket or quote (the record's prose wraps them in parentheses). */
const URL_REGEX = /https?:\/\/[^\s)\]}>"'”’]+/gi;

/** A bare file name (no `/` before it) with an image, archive or document extension, as the record names uploads and site files. */
const FILE_NAME_SOURCE = '(?<![\\w/.%-])[\\w.%-]+\\.(?:svg|png|jpe?g|webp|gif|pdf|eps|ai|zip|tar\\.gz|7z|rar)(?![\\w.%-])';
const FILE_NAME_REGEX = new RegExp(FILE_NAME_SOURCE, 'gi');
const WHOLE_FILE_NAME_REGEX = new RegExp(`^${FILE_NAME_SOURCE}$`, 'i');

const ARCHIVE_REGEX = /\.(?:zip|tar\.gz|7z|rar)$/i;
const IMAGE_REGEX = /\.(?:svg|png|jpe?g|webp|gif|eps|ai)$/i;

/** The file name's stem: the last path segment without its extension and a CMS's `-838x203` size suffix. */
function fileStem(path: string): string {
  const segment = path.split('/').pop() ?? '';
  return segment
    .replace(/\.(?:tar\.gz|[a-z0-9]{1,5})$/i, '')
    .replace(/[-_]\d+x\d+$/i, '')
    .trim();
}

/** Whether a file is named by nothing a reader knows (a CDN's hash, a UUID), the kit's own test. */
function isOpaque(path: string): boolean {
  return BRAND_KIT_OPAQUE_FILE_STEM_REGEX.test(fileStem(path));
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
  const isUrl = /^https?:\/\//i.test(text);
  if (!isUrl) {
    if (WHOLE_FILE_NAME_REGEX.test(text)) {
      if (ARCHIVE_REGEX.test(text)) return MKTG_READABLE_SOURCE.uploadedPackage;
      return count === 'one' ? MKTG_READABLE_SOURCE.uploadedFile : MKTG_READABLE_SOURCE.uploadedFiles;
    }
    return text;
  }
  const path = text.replace(/[?#].*$/, '');
  const host = brandKitWebsiteHost(text);
  if (ARCHIVE_REGEX.test(path)) return MKTG_READABLE_SOURCE.linkedPackage;
  if (IMAGE_REGEX.test(path)) return MKTG_READABLE_SOURCE.linkedImage;
  if (isOpaque(path)) return MKTG_READABLE_SOURCE.linkedFile;
  if (host && /\/_next\/static\/|\.css$/i.test(path)) return `${host} stylesheets`;
  return path.replace(/^https?:\/\/(?:www\.)?/i, '');
}

/**
 * A sentence of the run record (a reason, a warning, a gap, a note, a fix)
 * with every URL and bare file name in it replaced by `mktgReadableSourceName`'s
 * words, so no hashed name and no long file URL is printed: "(16dd7d…-838x203.svg)"
 * reads "(a logo image linked from the site)".
 */
export function mktgReadableSourceText(text: string): string {
  return text
    .replace(URL_REGEX, (url) => mktgReadableSourceName(url, 'one'))
    .replace(FILE_NAME_REGEX, (name) => (isOpaque(name) ? MKTG_READABLE_SOURCE.linkedImage : mktgReadableSourceName(name, 'one')));
}
