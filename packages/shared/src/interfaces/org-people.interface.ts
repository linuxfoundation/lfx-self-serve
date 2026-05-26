// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Tab identifier for the Org People page tab strip. */
export type PeopleTabId = 'all' | 'board' | 'committee' | 'contacts' | 'contributors' | 'events' | 'training';

/** Tab definition for the Org People page. */
export interface PeopleTabConfig {
  readonly id: PeopleTabId;
  readonly label: string;
  readonly icon: string;
  /** Empty-state noun used to complete "...to view {noun}." */
  readonly noun: string;
}
