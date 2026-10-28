// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Client heuristic only: sharing permissions cannot be inferred from a URL. */
export function describeMktgLinkAdvice(value: string): 'drive-folder' | 'drive-private' | null {
  try {
    const url = new URL(value.trim());
    if (url.hostname === 'drive.google.com' && /^\/drive\/(?:u\/\d+\/)?folders(?:\/|$)/.test(url.pathname)) return 'drive-folder';
    const document = url.hostname === 'docs.google.com' && /^\/(document|presentation|spreadsheets)\/(?:u\/\d+\/)?d\//.test(url.pathname);
    const file =
      url.hostname === 'drive.google.com' && (/^\/file\/d\//.test(url.pathname) || (/^\/open\/?$/.test(url.pathname) && !!url.searchParams.get('id')?.trim()));
    if ((document || file) && !/\/(export|pub|pubhtml)(?:\/|$)/.test(url.pathname)) return 'drive-private';
  } catch {
    // Invalid/empty values belong to the existing validators, not this warning.
  }
  return null;
}

/** Ignore sharing decoration, but preserve path case and meaningful query parameters. */
export function normalizeMktgLink(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    url.hash = '';
    url.searchParams.delete('usp');
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return '';
  }
}

/** Returns normalized links that occur more than once; blanks/non-links never duplicate. */
export function findDuplicateLinks(urls: string[]): Set<string> {
  const seen = new Set<string>();
  return new Set(
    urls.map(normalizeMktgLink).filter((url) => {
      const duplicate = seen.has(url);
      seen.add(url);
      return !!url && duplicate;
    })
  );
}

/** Ordered fields/lines: only a later occurrence says it is already added above. */
export function mktgLinkWarnings(values: Record<string, string>, earlierUrls: string[] = []): Record<string, string> {
  const seen = new Set(earlierUrls.map(normalizeMktgLink).filter(Boolean));
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const warnings = value.split(/\r?\n/).flatMap((line) => {
        const normalized = normalizeMktgLink(line);
        const messages: string[] = [];
        if (describeMktgLinkAdvice(line)) messages.push("We can't open private Google Drive links or folders. Share the document publicly, or paste its text.");
        if (normalized && seen.has(normalized)) messages.push('This link is already added above.');
        if (normalized) seen.add(normalized);
        return messages;
      });
      return [key, [...new Set(warnings)].join(' ')];
    })
  );
}
