// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
 * (`cla/gerrit/project/:projectId/:contractType`). Always the individual agreement: every
 * Gerrit-linked CLA Group in production has ICLA enabled, and the search response deliberately
 * omits the enablement flags, so there is nothing to read and nothing to choose.
 */
export const GERRIT_CONSOLE_ROUTE_PREFIX = '#/cla/gerrit/project';
export const GERRIT_CONSOLE_CONTRACT_TYPE = 'individual';

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
