// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Account } from './account.interface';

export type PersonaType = 'contributor' | 'maintainer' | 'board-member' | 'executive-director';

export interface PersistedPersonaState {
  primary: PersonaType;
  all: PersonaType[];
  organizations?: Account[];
  userSelected?: boolean;
  /** Writer on tenant ROOT — cookie-seeded so SSR foundation-product guard can decide without awaiting personas API. */
  isRootWriter?: boolean;
  /** Marketing auditor on tenant ROOT — cookie-seeded for SSR lens / marketing-only product gating. */
  isRootMarketingAuditor?: boolean;
}

export interface DevPersonaPreset {
  label: string;
  value: string;
  personas: PersonaType[];
  /** Determines lens behavior. */
  primary: PersonaType;
}

export interface PersonaOption {
  value: PersonaType;
  label: string;
  description?: string;
  icon?: string;
}
