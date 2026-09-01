// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure presentation helpers for the read-only "CLAs" view. Kept framework-free so the
// branching logic (ICLA/ECLA split, empty/CTA rules, status labels) is unit-testable without
// an Angular component-test harness.

import {
  ALREADY_SIGNED_CLA_LABEL,
  CLA_GROUP_MATCH_TYPE_LABELS,
  CLA_GROUP_ORG_SOURCE_ICONS,
  CLA_GROUP_ORG_SOURCE_LABELS,
  GERRIT_CONSOLE_CONTRACT_TYPE,
  GERRIT_CONSOLE_ROUTE_PREFIX,
  UNNAMED_CLA_GROUP,
} from '../constants/cla.constants';
import { PROFILE_TABS } from '../constants/profile.constants';
import { BadgeSeverity, TagSeverity } from '../interfaces/components.interface';
import { ProfileTab } from '../interfaces';
import type {
  ClaGroupOption,
  ClaGroupOptionView,
  ClaGroupOrg,
  ClaSignedVia,
  ClaSignRoute,
  ClaStatus,
  MyClaAgreement,
  MyClasIdentitySummary,
  SignIdentityRef,
} from '../interfaces/cla.interface';

/**
 * Profile subtab list, with the read-only "CLAs" tab appended (before Transactions)
 * when `my-clas-enabled` is on. Shared by both profile-hub nav entry points — the layout
 * subtab strip and the sidebar me-lens ⋯ menu — so they never disagree on whether the tab
 * is present. Returns the static PROFILE_TABS reference unchanged when the flag is off.
 */
export function buildProfileTabs(myClasEnabled: boolean): ProfileTab[] {
  if (!myClasEnabled) return PROFILE_TABS;
  const clasTab: ProfileTab = { id: 'clas', label: 'CLAs', route: 'clas' };
  const insertAt = PROFILE_TABS.findIndex((t) => t.id === 'transactions');
  if (insertAt === -1) return [...PROFILE_TABS, clasTab];
  return [...PROFILE_TABS.slice(0, insertAt), clasTab, ...PROFILE_TABS.slice(insertAt)];
}

/** Partitions agreements into ICLA and ECLA groups, preserving order. */
export function splitAgreementsByKind(agreements: MyClaAgreement[]): { iclas: MyClaAgreement[]; eclas: MyClaAgreement[] } {
  return {
    iclas: agreements.filter((a) => a.kind === 'ICLA'),
    eclas: agreements.filter((a) => a.kind === 'ECLA'),
  };
}

/** True when the list finished loading successfully with zero agreements (empty state). */
export function isMyClasEmpty(loaded: boolean, error: boolean, agreementCount: number): boolean {
  return loaded && !error && agreementCount === 0;
}

/**
 * Whether to show the "link your GitHub account" CTA: the identity has no linked GitHub
 * account (so GitHub-keyed CLA history can't be matched) or nothing matched at all.
 */
export function shouldShowGithubCta(identity: MyClasIdentitySummary | undefined): boolean {
  if (!identity) return false;
  return identity.githubLinked === false || identity.unmatched;
}

/** Badge severity for the ICLA/ECLA kind pill. */
export function claKindSeverity(kind: MyClaAgreement['kind']): BadgeSeverity {
  return kind === 'ICLA' ? 'info' : 'secondary';
}

/**
 * Human-readable status label. Exhaustive — a new ClaStatus member fails the build.
 *
 * "Revoked" belongs to `revoked` alone. It is the reviewed copy for a sanctions-screening
 * outcome, so applying it to `invalidated` would tell a contributor who asked to be removed
 * from an approved list, or whose project manager invalidated their ICLA, that they were
 * screened. `revoked` is employer-level and system-set; `invalidated` mirrors the stored
 * approval flag and attributes nothing.
 */
export function claStatusLabel(status: ClaStatus): string {
  switch (status) {
    case 'valid':
      return 'Valid';
    case 'needs_attention':
      return 'Needs attention';
    case 'revoked':
      return 'Revoked';
    case 'invalidated':
      return 'Invalidated';
    case 'unknown':
      return '—';
    case 'superseded':
      return 'Superseded';
  }
}

/** Tag severity for the status pill. Exhaustive — a new ClaStatus member fails the build. */
export function claStatusSeverity(status: ClaStatus): TagSeverity {
  switch (status) {
    case 'valid':
      return 'success';
    case 'needs_attention':
      return 'warn';
    case 'revoked':
      return 'secondary';
    case 'invalidated':
      return 'danger';
    case 'unknown':
      return 'secondary';
    case 'superseded':
      return 'warn';
  }
}

/**
 * Second line under the signed date (#1573). Undefined ⇒ the Signed cell is date-only.
 *
 * Every platform the producer names takes a suffix. `gerrit` reads wider than the Gerrit
 * tool — it is also the LF SSO / email-identified case and the last resort in the producer's
 * `github > gitlab > gerrit` precedence — and `(Gerrit)` is still the agreed label, because
 * a narrower one cannot be derived from that token alone.
 *
 * An absent or unrecognised platform prints the bare line rather than borrowing a label, and
 * a blank identity omits the line even when a platform is present: `Signed as  (GitHub)` is
 * worse than a date-only cell.
 */
export function signedAsLine(signedVia: ClaSignedVia | undefined, signedAs: string | undefined): string | undefined {
  const identity = signedAs?.trim();
  if (!identity) return undefined;
  return `Signed as ${identityWithPlatform(signedVia, identity)}`;
}

/** `<identity> (GitHub)`, or the bare identity when the platform is absent or unrecognised. */
function identityWithPlatform(signedVia: ClaSignedVia | undefined, identity: string): string {
  switch (signedVia) {
    case 'github':
      return `${identity} (GitHub)`;
    case 'gitlab':
      return `${identity} (GitLab)`;
    case 'gerrit':
      return `${identity} (Gerrit)`;
    default:
      return identity;
  }
}

/**
 * Primary line for a Sign CLA search result. The CLA group name is used when there is no
 * project name; the unnamed literal is only for the both-absent case (FR-008).
 */
export function claGroupPrimaryName(option: Pick<ClaGroupOption, 'projectName' | 'claGroupName'>): string {
  return option.projectName || option.claGroupName || UNNAMED_CLA_GROUP;
}

/** Secondary line — only when it says something the primary line does not. */
export function claGroupSecondaryName(option: Pick<ClaGroupOption, 'projectName' | 'claGroupName'>): string | null {
  return option.claGroupName && option.claGroupName !== claGroupPrimaryName(option) ? option.claGroupName : null;
}

/**
 * Which identity the sign step offers for a selected CLA Group, and therefore which hand-off
 * it can end in (#2002).
 *
 * **Presence is evidence; absence is not.** The empty-list return is the first statement here
 * deliberately, so no branch below can reach a conclusion from missing data. An empty list
 * means nothing is linked or nothing resolved, not "not on GitHub"; those CLA Groups are
 * searchable by name and signable today, so a rule shaped "no GitHub organization ⇒ not
 * GitHub" would misroute them into a step they cannot complete. An empty list keeps the
 * GitHub path, unchanged.
 *
 * The step itself is never skipped, whatever this returns — the contributor is always shown
 * which identity they are about to sign under. Only the identity on offer varies.
 *
 * GitLab yields a block rather than a route because Self Serve holds no verifiable GitLab
 * identity, and only when nothing else is linked: a group reachable through GitHub or Gerrit
 * is signable, so its GitLab organizations are simply not offered.
 */
export function claSignRoute(organizations: ClaGroupOrg[]): ClaSignRoute {
  if (organizations.length === 0) return 'github';

  const has = (source: ClaGroupOrg['source']): boolean => organizations.some((org) => org.source === source);
  const github = has('github');
  const gerrit = has('gerrit');

  // Must precede the single-source tests: a group carrying both is a choice, not whichever
  // one happens to be checked first.
  if (github && gerrit) return 'github-or-gerrit';
  if (gerrit) return 'gerrit';
  if (github) return 'github';
  if (has('gitlab')) return 'gitlab-unsupported';

  // A non-empty list of sources none of which is recognised. The search mapper drops unknown
  // sources before the client sees them, so this is unreachable in practice; it carries no
  // positive evidence either way, and so falls to today's behaviour rather than to a block.
  return 'github';
}

/**
 * The Contributor Console address a Gerrit contributor is sent to (#2002).
 *
 * The one address in this flow Self Serve composes itself. Every other hand-off uses the
 * `signUrl` the producer returns, because the producer owns a signing session the address
 * belongs to — the Gerrit route opens no session, carries no user id, and makes no producer
 * call, so there is nothing to defer to. Keeping the composition here means a Console route
 * change is a single edit.
 *
 * Returns `null` rather than a malformed address when the base or the group id is unusable,
 * so the caller reports a failure instead of navigating somewhere that cannot work.
 */
export function gerritSignUrl(consoleBaseUrl: string, claGroupId: string, returnUrl: string): string | null {
  // Trailing slashes are stripped by scanning, not by an anchored `/\/+$/`: that pattern
  // backtracks polynomially on a long run of slashes, which CodeQL flags as a ReDoS even
  // though this particular input is build-time configuration.
  let base = consoleBaseUrl.trim();
  while (base.endsWith('/')) base = base.slice(0, -1);

  const groupId = claGroupId.trim();
  if (!base || !groupId) return null;

  // Parsed rather than pattern-matched so a base that is not an absolute URL is rejected here
  // rather than producing a relative address the browser resolves against our own origin.
  try {
    new URL(base);
  } catch {
    return null;
  }

  const redirect = encodeURIComponent(returnUrl);
  return `${base}/${GERRIT_CONSOLE_ROUTE_PREFIX}/${encodeURIComponent(groupId)}/${GERRIT_CONSOLE_CONTRACT_TYPE}?redirect=${redirect}`;
}

/**
 * Statuses that mean signing again with the same identity cannot produce a new agreement (#1914).
 *
 * `invalidated` is excluded: that signature no longer covers contributions, so the
 * contributor may need to sign again. `unknown` is included — we cannot tell they are
 * uncovered, and walking them through a ceremony that produces nothing is worse.
 */
const ALREADY_SIGNED_CLA_STATUSES: ReadonlySet<ClaStatus> = new Set(['valid', 'needs_attention', 'revoked', 'unknown', 'superseded']);

/**
 * The agreement that makes this CLA group already-signed, if any. First match wins;
 * the My CLAs list is already newest-first.
 *
 * Already-signed is not the same as covered: `needs_attention` and `revoked` do not cover
 * contributions, but signing again cannot restore them either.
 *
 * Group grain is for the **tag** on a search result, not for blocking. One contributor can
 * hold several identities and sign the same group again under a different one, so the group
 * stays selectable and it is the identity picker that blocks — see
 * `alreadySignedAgreementForIdentity`.
 */
export function alreadySignedAgreementForGroup(agreements: readonly MyClaAgreement[], claGroupId: string): MyClaAgreement | undefined {
  const id = claGroupId.trim();
  if (!id) return undefined;
  return agreements.find((agreement) => agreement.claGroupId === id && ALREADY_SIGNED_CLA_STATUSES.has(agreement.status));
}

/** Every agreement already held for this CLA group, across identities. */
export function alreadySignedAgreementsForGroup(agreements: readonly MyClaAgreement[], claGroupId: string): MyClaAgreement[] {
  const id = claGroupId.trim();
  if (!id) return [];
  return agreements.filter((agreement) => agreement.claGroupId === id && ALREADY_SIGNED_CLA_STATUSES.has(agreement.status));
}

/**
 * Tag on a Sign a CLA search result the contributor already holds a CLA for (#1914). Names the
 * identity, because that is what tells them which of their accounts is already covered and
 * therefore which one the next step will gray out.
 */
export function alreadySignedChipLabel(agreement: MyClaAgreement): string {
  const identity = agreement.signedAs?.trim();
  if (!identity) return ALREADY_SIGNED_CLA_LABEL;
  return `${ALREADY_SIGNED_CLA_LABEL} as ${identityWithPlatform(agreement.signedVia, identity)}`;
}

/**
 * Tooltip on a tagged Sign a CLA result (#1914). Names the kind they already hold, the employer
 * covering an ECLA, and — since the row is still selectable — that another identity may sign it.
 *
 * The closing sentence is conditional on purpose. All this has to work from is the agreements
 * list, which says nothing about how many identities are linked, so it cannot promise a second
 * one exists: a contributor with a single account would be told another identity can sign and
 * then reach a step offering only the card that already signed.
 */
export function alreadySignedGroupTooltip(agreement: MyClaAgreement): string {
  const kind = agreement.kind === 'ECLA' ? 'an ECLA' : 'an ICLA';
  const company = agreement.kind === 'ECLA' ? agreement.companyName?.trim() : undefined;
  const held = company ? `You already have ${kind} for this CLA group, covered by ${company}.` : `You already have ${kind} for this CLA group.`;
  const signed = signedAsLine(agreement.signedVia, agreement.signedAs);

  return `${signed ? `${held} ${signed}.` : held} If you have another identity linked, you can still sign with it.`;
}

/**
 * The agreement this one identity already signed for the group, if any — the check that
 * actually blocks (#1914).
 *
 * Matching is on the recorded **handle**, not the GitHub account number, because the My CLAs
 * list carries no account number to compare. That is acceptable here and nowhere else: this
 * decides whether to gray a card, while the hand-off still submits `githubId`, and EasyCLA
 * re-derives the attested set from the caller's own token regardless of what is sent.
 *
 * **On the GitHub branch only**, an agreement with no recorded identity matches nothing and
 * blocks no card. Naming a card as already-signed on the strength of a blank is the worse error:
 * it would strand a contributor whose only account is the one it grayed out.
 *
 * The Gerrit branch cannot make that trade, because it has nothing to compare. Only one Gerrit
 * card is ever offered and it is the contributor's own LF identity, so the platform alone
 * identifies it — which does mean a Gerrit agreement with a blank handle still blocks that card.
 */
export function alreadySignedAgreementForIdentity(agreements: readonly MyClaAgreement[], identity: SignIdentityRef): MyClaAgreement | undefined {
  return agreements.find((agreement) => {
    if (!ALREADY_SIGNED_CLA_STATUSES.has(agreement.status)) return false;
    if (identity.platform === 'gerrit') return agreement.signedVia === 'gerrit';
    if (agreement.signedVia !== 'github') return false;

    const signedAs = agreement.signedAs?.trim().toLowerCase();
    return !!signedAs && signedAs === identity.username.trim().toLowerCase();
  });
}

/** Tooltip on a grayed-out identity card: this account is the one already on the agreement. */
export function alreadySignedIdentityTooltip(agreement: MyClaAgreement): string {
  const kind = agreement.kind === 'ECLA' ? 'an ECLA' : 'an ICLA';
  return `You already have ${kind} for this CLA group signed with this account. Choose another identity to sign again.`;
}

/** Maps a producer search result to the picker view model. */
export function toClaGroupOptionView(option: ClaGroupOption, expanded = false): ClaGroupOptionView {
  return {
    ...option,
    primaryName: claGroupPrimaryName(option),
    secondaryName: claGroupSecondaryName(option),
    matchTypeLabels: option.matchTypes.map((type) => CLA_GROUP_MATCH_TYPE_LABELS[type]),
    orgViews: option.organizations.map((org) => ({
      name: org.name,
      source: org.source,
      sourceLabel: CLA_GROUP_ORG_SOURCE_LABELS[org.source],
      sourceIcon: CLA_GROUP_ORG_SOURCE_ICONS[org.source],
    })),
    expanded,
  };
}
