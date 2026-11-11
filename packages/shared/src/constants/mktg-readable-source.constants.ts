// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The words a Sources page prints for a run record's sources instead of a
 * file name or a long file URL (the editor's rule, 7 November 2026): what the
 * reader can recognise, never what a CDN called a file.
 */
export const MKTG_READABLE_SOURCE = {
  lfxRecord: 'The LFX project record',
  uploadedFiles: 'the uploaded logo files',
  uploadedFile: 'an uploaded logo file',
  uploadedPackage: 'the uploaded logo package',
  linkedPackage: 'the logo package linked from the site',
  linkedImage: 'a logo image linked from the site',
  linkedFile: 'a file linked from the site',
} as const;
