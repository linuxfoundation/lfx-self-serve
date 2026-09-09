// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgClaGroup, OrgClaStatusDisplay } from '../interfaces/cla.interface';

/** Long enough to not query on every keystroke, short enough that the CLA-group list feels live. */
export const CLA_GROUP_SEARCH_DEBOUNCE_MS = 250;

/**
 * Shortest term the CLA-group search will accept. Matches the producer's `searchTerm` minLength:
 * below this it answers 422 (or 400 once trimmed), which is the wrong thing to show someone who
 * is simply still typing.
 */
export const CLA_GROUP_SEARCH_MIN_CHARS = 3;

/** Stands in for a result the producer could name neither by project nor by CLA group (FR-008). */
export const UNNAMED_CLA_GROUP = 'Unnamed CLA group';

/** Why a result matched, in contributor language rather than the producer's enum. */
export const CLA_GROUP_MATCH_TYPE_LABELS = {
  claGroup: 'CLA group name',
  project: 'Project name',
  organization: 'Linked organization',
  repository: 'Repository link',
} as const;

export const CLA_GROUP_ORG_SOURCE_LABELS = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gerrit: 'Gerrit',
} as const;

export const CLA_GROUP_ORG_SOURCE_ICONS = {
  github: 'fa-brands fa-github',
  gitlab: 'fa-brands fa-gitlab',
  gerrit: 'fa-light fa-code-branch',
} as const;

/**
 * Where the Contributor Console returns a contributor after signing (#1251). Mirrors the
 * `clas` child route under /profile in profile.routes.ts.
 *
 * Shared because both hand-offs compose a return address and must not disagree on the path:
 * the BFF derives one from the request Host for prepare-sign, and the browser composes one
 * from its own origin for the Gerrit route, which has no BFF round trip (#2002).
 */
export const MY_CLAS_PATH = '/profile/clas';

/**
 * The Contributor Console's Gerrit signing route, as its own router declares it
 * (`cla/gerrit/project/:projectId/:contractType`). The contract-type segment is chosen on
 * the Gerrit path from the group's enablement flags (#2066).
 */
export const GERRIT_CONSOLE_ROUTE_PREFIX = '#/cla/gerrit/project';

/** Contract-type segments the Console Gerrit route accepts (#2066). */
export const GERRIT_CONTRACT_TYPE_INDIVIDUAL = 'individual';
export const GERRIT_CONTRACT_TYPE_CORPORATE = 'corporate';

/**
 * Copy for the Gerrit contract-type step (#2066), mirroring the Contributor Console decision
 * screen rather than inventing new wording.
 */
export const SIGN_CONTRACT_TYPE_COPY = {
  header: 'What type of contributor are you?',
  body: "Choose how you'll sign for this project — you'll be redirected to EasyCLA to complete it.",
  individual: {
    label: 'Individual Contributor',
    description:
      'If you are making a contribution of content that you own, and not content owned by your employer, you should proceed as an individual contributor.',
  },
  corporate: {
    label: 'Corporate Contributor',
    description: 'If you are making a contribution of content owned by your employer, you should proceed as a corporate contributor.',
  },
  /** Why a card is disabled: the identity confirmed a step earlier already holds that type. */
  alreadyHeld: 'You already have this agreement for this CLA group signed with this identity.',
} as const;

/**
 * The value the Gerrit card writes into the step's form control.
 *
 * Cannot collide with a GitHub account: those are the account *number*, which is digits only.
 */
export const GERRIT_IDENTITY_VALUE = 'gerrit';

/**
 * Copy for the sign identity step, per variant. All three sets are taken from the design
 * rather than composed here — a contributor signing under a Gerrit identity must not be told
 * the group is linked to GitHub repositories, and that sentence is the whole reason the
 * variants exist rather than one reusable string.
 */
export const SIGN_IDENTITY_COPY = {
  github: {
    header: 'Select a GitHub account',
    body: "This CLA group is linked to GitHub repositories. Choose the GitHub account you'll sign with — you'll be redirected to EasyCLA to complete it.",
  },
  gerrit: {
    header: 'Select a Gerrit account',
    body: "This CLA group is linked to Gerrit repositories. Choose the Gerrit account you'll sign with — you'll be redirected to EasyCLA to complete it.",
  },
  'github-or-gerrit': {
    header: 'Select a GitHub or Gerrit account',
    body: "This CLA group is linked to GitHub and Gerrit repositories. Choose the GitHub or Gerrit account you'll sign with — you'll be redirected to EasyCLA to complete it.",
  },
} as const;

/**
 * How a card names its platform when two platforms share one list.
 *
 * Only ever appended on the mixed variant. The two rows there carry a GitHub handle and an LF
 * username, which are routinely different strings for the same person — without the suffix
 * they read either as duplicates or as one identity listed twice. A single-source list has
 * nothing to disambiguate, and its design shows bare labels.
 */
export const SIGN_IDENTITY_PLATFORM_LABELS = {
  github: 'GitHub',
  gerrit: 'Gerrit',
} as const;

/**
 * Why a GitLab-linked CLA Group cannot be signed here. An identity gap, not a configuration
 * flag: GitLab signing authenticates the contributor through GitLab OAuth at signing time and
 * keys the EasyCLA user record on the GitLab numeric id, and Self Serve can neither obtain nor
 * verify a GitLab identity today.
 */
export const GITLAB_UNSUPPORTED_MESSAGE = 'Signing CLA using GitLab is not supported from Self Serve';

/**
 * Names the source in the block's header, so the dialog says which platform it is about before
 * the contributor reads a word of the body. Every other dialog in this flow is titled for what
 * it is asking about; a source-neutral title here would be the one screen that is entirely
 * about a source and does not say so.
 */
export const GITLAB_UNSUPPORTED_HEADER = 'GitLab CLA signing';

/**
 * Chip on a Sign a CLA search result the contributor already holds a CLA for (#1914).
 * The tooltip on that row carries the sentence that says which agreement; this is only
 * the short label that makes the grayed-out state readable without hovering.
 */
export const ALREADY_SIGNED_CLA_LABEL = 'Already signed';

/** Hover tooltips on a right-edge kebab open off-screen; keep the CCLA reason in the item. */
export const ECLA_COVERED_DOWNLOAD_LABEL = 'Download PDF<br><span class="mt-0.5 block text-xs font-normal">Covered by Corporate CLA (CCLA)</span>';

/**
 * Mirrors the producer's `message` bound (`my-cla-manager-request.yaml`: maxLength 4096).
 * Shared between the BFF validator, the modal's reactive-form validator and its counter so
 * client and server enforce one contract. Counted in code points, not UTF-16 units: go-swagger
 * validates `maxLength` with `utf8.RuneCountInString`, so counting units would reject an
 * emoji-heavy message the producer would have accepted.
 */
export const CLA_MANAGER_MESSAGE_MAX_LENGTH = 4096;

/** The `requestType` values the producer's enum accepts (`my-cla-manager-request.yaml`). */
export const CLA_MANAGER_REQUEST_TYPES = ['approval', 'removal', 'contact'] as const;

/** Approval and removal share one receipt; contact phrases it as a message. */
const CLA_MANAGER_REQUEST_RECEIPT = {
  sent: { summary: 'Request sent', detail: 'The CLA manager(s) you selected will be notified.' },
  recorded: { summary: 'Request recorded', detail: 'The request was recorded, but no CLA manager email could be delivered.' },
} as const;

/** v17 `mgrCopy` — titles also used as DialogService headers by the kebab factory. */
export const CLA_MANAGER_MODAL_COPY = {
  approval: {
    title: 'Request approval',
    hint: (project: string) => `Ask the CLA manager(s) below to re-approve your ECLA for ${project}.`,
    receipt: CLA_MANAGER_REQUEST_RECEIPT,
  },
  removal: {
    title: 'Request Removal',
    hint: (project: string) => `Ask the CLA manager(s) below to remove your ECLA for ${project}. This starts the process to invalidate it on your behalf.`,
    receipt: CLA_MANAGER_REQUEST_RECEIPT,
  },
  contact: {
    title: 'Contact CLA Manager',
    hint: (project: string) => `Send a message to the CLA manager(s) for ${project}.`,
    receipt: {
      sent: { summary: 'Message sent', detail: 'The CLA manager(s) you selected will be notified.' },
      recorded: { summary: 'Message recorded', detail: 'The message was recorded, but no CLA manager email could be delivered.' },
    },
  },
} as const;

/**
 * The Overview body for an agreement the organization has not signed.
 *
 * The list is not exclusively signed agreements — a row's status is read from the producer's
 * `signed` flag — so this state is reached from the list itself, without going near the signing
 * flow. Before this copy existed the tab rendered a heading and then nothing.
 *
 * Taken verbatim from the M3 prototype, steps and all. The three steps are the only place the
 * consequence of signing is spelled out before it happens: that whoever signs becomes the initial
 * CLA Manager, and what that role then controls. Paraphrasing them would quietly change what the
 * organization is told it is agreeing to arrange.
 */
export const ORG_CLA_NOT_STARTED_COPY = {
  /** `company` and `claGroup` are the organization's and the agreement's names. */
  lead: (company: string, claGroup: string): string => `${company} has not yet signed a CLA for ${claGroup}.`,
  stepsHeading: "Here's what the process looks like:",
  steps: [
    {
      label: 'Step 1:',
      body: 'You will identify who should be the initial CLA Manager. The CLA Manager is the person who manages the list of approved contributors. This might be you, or might be someone else at your company.',
    },
    { label: 'Step 2:', body: 'That person will be able to sign the CLA (or send it to someone else for signature).' },
    { label: 'Step 3:', body: 'Finally, the CLA Manager will be able to start approving contributors and adding other CLA Managers.' },
  ],
  startLabel: 'Start the CLA process',
} as const;

/**
 * Tab order of the Organization Lens CLA Group detail page. `OrgClaDetailTab` is derived from
 * this, so the set exists once: a tab added here is a compile error everywhere that switches on
 * the union until it is handled.
 */
export const ORG_CLA_DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'managers', label: 'CLA Managers' },
  { id: 'approval', label: 'Approval List' },
  { id: 'acknowledgments', label: 'Contributor Acknowledgments' },
  { id: 'activity', label: 'Activity Log' },
] as const;

/** Pill shown against an agreement in the Organization Lens CLA list and on its detail page. */
export const ORG_CLA_STATUS_DISPLAY: Record<OrgClaGroup['status'], OrgClaStatusDisplay> = {
  signed: { label: 'Signed', severity: 'success' },
  'not-started': { label: 'Not started', severity: 'secondary' },
  sanctioned: { label: 'Sanctioned', severity: 'danger' },
};

/**
 * Status wording for the detail page's card heading. Deliberately not the pill's label: the
 * heading reads as a sentence about the agreement ("… — Not yet signed"), where the pill is a
 * terse badge, and "Unavailable" states the consequence of a sanction without repeating it.
 */
export const ORG_CLA_HEADING_STATUS: Record<OrgClaGroup['status'], string> = {
  signed: 'Signed',
  'not-started': 'Not yet signed',
  sanctioned: 'Unavailable',
};
