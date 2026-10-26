// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Member360Envelope } from '../interfaces/member-360.interface';

/** Present the agent's legacy source suffix without changing stored envelope bytes. */
export function member360SourceLabel(text: string): string {
  return text.replace(/ \(not wired\)$/, ' (not connected yet)');
}

/** Shared source-status copy for the document page and workbook. */
export function member360SourceStatusText(status: Member360Envelope['tabs']['method']['data_sources'][number]['status']): string {
  switch (status) {
    case 'not_wired':
      return 'not connected yet';
    case 'used':
      return 'used';
    case 'unavailable':
      return 'unavailable';
  }
}
