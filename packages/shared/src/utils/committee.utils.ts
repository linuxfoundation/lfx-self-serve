// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GroupBehavioralClass } from '../interfaces/committee.interface';
import { CATEGORY_BEHAVIORAL_CLASS } from '../constants/committees.constants';

/**
 * Determine the behavioral class for a given committee category.
 * Falls back to partial string matching if exact match not found.
 */
export function getGroupBehavioralClass(category: string | undefined): GroupBehavioralClass {
  if (!category) return 'other';

  // Exact match first
  if (CATEGORY_BEHAVIORAL_CLASS[category]) {
    return CATEGORY_BEHAVIORAL_CLASS[category];
  }

  // Partial match fallback (handles custom/variant PCC categories)
  const lower = category.toLowerCase();

  // Governing board
  if (lower.includes('board') || lower.includes('government')) {
    return 'governing-board';
  }

  // Oversight committee
  if (
    lower === 'tsc' ||
    lower === 'toc' ||
    lower === 'tac' ||
    lower.includes('technical steering') ||
    lower.includes('technical advisory') ||
    lower.includes('technical oversight') ||
    lower.includes('legal') ||
    lower.includes('finance') ||
    lower.includes('code of conduct') ||
    lower.includes('product security')
  ) {
    return 'oversight-committee';
  }

  // Working group
  if (lower.includes('working group') || lower.includes('expert') || lower.includes('maintainer') || lower.includes('committer')) {
    return 'working-group';
  }

  // Special interest group (includes marketing outreach)
  if (lower.includes('special interest') || /\bsig\b/.test(lower) || lower.includes('technical mailing') || lower.includes('marketing')) {
    return 'special-interest-group';
  }

  // Ambassador program
  if (lower.includes('ambassador')) {
    return 'ambassador-program';
  }

  return 'other';
}

// ── Per-type query helpers ──────────────────────────────────────────────────

/** True for governing-board type */
export function isGoverningBoard(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'governing-board';
}

/** True for oversight-committee type */
export function isOversightCommittee(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'oversight-committee';
}

/** True for working-group type */
export function isWorkingGroup(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'working-group';
}

/** True for special-interest-group type */
export function isSpecialInterestGroup(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'special-interest-group';
}

/** True for ambassador-program type */
export function isAmbassadorProgram(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'ambassador-program';
}

/** True for other (catch-all) type */
export function isOtherClass(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'other';
}

// ── Backward-compatible aggregate helpers ───────────────────────────────────

/**
 * Check if a category shows governance-style dashboard cards (votes, budgets, resolutions).
 * True for: governing-board and oversight-committee.
 */
export function isGovernanceClass(category: string | undefined): boolean {
  const cls = getGroupBehavioralClass(category);
  return cls === 'governing-board' || cls === 'oversight-committee';
}

/**
 * Check if a category shows collaboration-style dashboard cards (activity, contributors).
 * True for: working-group, special-interest-group, oversight-committee, ambassador-program, and other.
 */
export function isCollaborationClass(category: string | undefined): boolean {
  const cls = getGroupBehavioralClass(category);
  return cls === 'working-group' || cls === 'special-interest-group' || cls === 'oversight-committee' || cls === 'ambassador-program' || cls === 'other';
}
