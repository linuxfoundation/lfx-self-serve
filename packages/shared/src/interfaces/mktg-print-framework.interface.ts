// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Messaging Framework as landscape print pages (the deck's framework
// print, marketing-os-agents agents/slides-export src/framework-print.ts):
// the sections its cover lists, the cover's lines and the options a larger
// document passes.

import type { MktgPrintPageEl } from './mktg-print-page.interface';

/** The deck's four sections; two of them (the ICPs, the message house) have no tab on the framework's screen. */
export type MktgPrintFrameworkSectionId = 'framework' | 'icps' | 'message-house' | 'numbers';

/** One section as the cover lists it: `01  Framework`. */
export interface MktgPrintFrameworkSection {
  id: MktgPrintFrameworkSectionId;
  /** `01`. */
  number: string;
  title: string;
}

/** The framework cover's lines, as the deck's cover sets them (framework-print.ts coverSlide). */
export interface MktgPrintFrameworkCover {
  /** `Messaging Framework`. */
  title: string;
  /** The tagline, else the message house's line, else ''. */
  subtitle: string;
  /** `<Project> · a Linux Foundation project`, in capitals. */
  eyebrow: string;
  /** `Version 3`, '' when the framework shows no version. */
  topRight: string;
  /** The cover's own elements: the accent bar, the rule and the contents line (the present sections). */
  els: MktgPrintPageEl[];
}

/** What a larger document (the family PDF) passes the framework's pages. */
export interface MktgPrintFrameworkOptions {
  /** The page number of the cover in the document that holds the framework (1 when it prints alone). */
  firstPage?: number;
}
