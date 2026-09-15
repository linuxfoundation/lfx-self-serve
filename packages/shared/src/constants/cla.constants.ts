// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgClaDetailTab, OrgClaGroup, OrgClaStatusDisplay } from '../interfaces/cla.interface';

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
    hint: (project: string) => `Ask the CLA manager(s) below to re-approve your CCLA coverage for ${project}.`,
    receipt: CLA_MANAGER_REQUEST_RECEIPT,
  },
  removal: {
    title: 'Request Removal',
    hint: (project: string) =>
      `Ask the CLA manager(s) below to remove your CCLA coverage for ${project}. This starts the process to invalidate it on your behalf.`,
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
 * Reached only through the pre-signing preview, which builds its agreement from the picker's
 * choice. The organization's own list cannot show this state: upstream draws every row from a
 * signature its query has already filtered to signed. Before this copy existed the tab rendered a
 * heading and then nothing.
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
  downloadLabel: 'Download a copy of the CCLA for review (non-executable)',
  startLabel: 'Start the CLA process',
} as const;

/**
 * Fallback filename on the BFF `Content-Disposition` for the watermarked review copy (#2317).
 * The unsigned overview saves `${claGroupName}-ccla-review.pdf` at the call site instead.
 */
export const ORG_CLA_REVIEW_COPY_FILENAME = 'Corporate_Contributor_License_Agreement.pdf';

/**
 * Where EasyCLA returns a signatory after signing a corporate CLA (#1983). Mirrors the `easycla`
 * child route under /org in the org dashboard routes.
 *
 * Sibling of `MY_CLAS_PATH` for the same reason that one is shared: the BFF derives the return
 * address from the request Host, and the two hand-offs must not disagree on where they land.
 */
export const ORG_EASYCLA_PATH = '/org/easycla';

/**
 * Query parameter naming which corporate agreement a `ORG_EASYCLA_PATH` group address is about,
 * when the group id alone does not say (#2364).
 *
 * The path segment is the CLA Group, which identifies an agreement *template* rather than one
 * organization's agreement: the upstream list grain is (signing entity × CLA group), so an
 * organization with two signing entities holds two agreements at one group id. The group id is
 * still the address, because it is the only identifier that exists before a signature does — this
 * parameter is what keeps the two rows distinct within it.
 *
 * A query parameter rather than router state or a matrix parameter, because a card link has to
 * survive being copied and reloaded, which is the reason the row is addressable at all.
 *
 * **It narrows; it does not grant.** The page resolves it inside the selected organization's own
 * list and ignores a signature absent from it, so a crafted link reaches nothing new. A signature
 * naming a different CLA Group than the path is likewise ignored — the path is authoritative.
 */
export const ORG_EASYCLA_SIGNATURE_PARAM = 'sig';

/**
 * Key the picker's chosen CLA Group travels under, in the router state of the navigation to that
 * group's `ORG_EASYCLA_PATH` address (#1983, #2364).
 *
 * State rather than the address, because the address holds nothing that could be resolved into the
 * agreement this page has to name: the CLA service exposes no fetch-a-CLA-group-by-id endpoint —
 * `/cla-group/{id}` offers only PUT and DELETE, and the search takes a term — so the display names
 * would have to ride along in the URL, leaving the page to render its heading from text taken out
 * of the address.
 *
 * The group id in the path does not make this redundant. It says *which* group the preview is for,
 * which is what stops a stale history entry driving the page; it cannot supply the names.
 */
export const ORG_CLA_SIGN_SELECTION_STATE = 'orgClaSignSelection';

/**
 * `sessionStorage` key holding the signature a corporate signing session just created, so the
 * signatory returns to the agreement they signed rather than to the list (#1983).
 *
 * `sessionStorage` precisely because router state is not available: the return from DocuSign is a
 * cross-site round trip, which no in-memory or history-bound value survives, and this does — in
 * the one tab that made the request. The value is single-use and cleared on the way back.
 */
export const ORG_CLA_SIGNED_SIGNATURE_KEY = 'lfx.orgCla.signedSignatureId';

/**
 * Query parameter naming the organization a corporate signing session was opened for, carried on
 * `ORG_EASYCLA_PATH` when EasyCLA returns the signatory (#1983).
 *
 * The return is a cross-site navigation, and which organization is selected survives only in a
 * `SameSite=Lax` cookie. When that cookie does not come back the page falls to the first
 * organization in the viewer's list, so a signatory who signed for one company returns looking at
 * another — reading as though the signature landed on the wrong organization.
 *
 * Shared because the BFF writes it and the Org Lens page reads it. **It names an organization; it
 * does not grant one.** The page resolves it against the viewer's own authorized organizations and
 * ignores anything absent from that list, so a crafted link cannot select an organization the
 * viewer does not hold.
 */
export const ORG_EASYCLA_RETURN_ORG_PARAM = 'org';

/**
 * Copy for the corporate signing flow (#1983), taken verbatim from the M3 prototype.
 *
 * Held here rather than inlined in the template because this is the first attestation the
 * product renders itself — every earlier CLA surface handed off to another product before any
 * attestation appeared. Wording that a signatory affirms under their own authority should not
 * be reachable by a template edit that reads as a copy tweak, and keeping it in one file gives
 * the legal review a single subject.
 *
 * Not paraphrased, not re-ordered, not shortened.
 */
export const CCLA_SIGN_COPY = {
  attestation: {
    header: 'Confirm Authorization to Sign the CLA',
    authorityHeading: 'Authorization Confirmation',
    authorityLabel: 'I am authorized to sign this Contributor License Agreement (CLA) on behalf of my company.',
    embargoHeading: 'Compliance Confirmation',
    embargoLabel: 'I hereby certify that I am not, and/or the organization I am representing is not:',
    embargoConditions: [
      'located in Cuba, Iran, North Korea, Syria, the Crimea Region of Ukraine, or the Russian-controlled areas of the Donetsk or Luhansk regions of Ukraine;',
      'owned or controlled by, acting for or on behalf of, or an individual or entity that has in the past acted for or on behalf of the Government of Cuba, Iran, North Korea, Syria, or Venezuela;',
    ],
    /**
     * The third condition carries a link mid-sentence, so it cannot sit in the array above
     * without the template either rendering markup from a string or losing the link.
     */
    embargoSanctionsCondition: {
      before: "listed as a blocked person by the U.S. Department of the Treasury's ",
      linkText: 'Office of Foreign Assets Control (OFAC)',
      linkUrl: 'https://ofac.treasury.gov/sanctions-programs-and-country-information',
      after: ' or directly or indirectly owned 50 percent or more by such a listed person',
    },
    continueLabel: 'Continue',
    cancelLabel: 'Cancel',
  },
  preparing: {
    header: 'Configuring CLA Manager Settings…',
    body: 'Please wait while we configure the initial CLA Manager settings for this CLA.',
    /** Stated before the signatory commits, so the consequence is not first learned after signing. */
    consequence: 'When this CLA is signed, you will be the initial CLA Manager.',
  },
  /**
   * No cancel label, deliberately. By the time this state is on screen the agreement and its
   * DocuSign envelope already exist upstream, and the address below is the only way anyone reaches
   * them — so there is no exit here that does not abandon a real agreement. The one way on is
   * forward, and the copy says the envelope is already waiting rather than implying it is not.
   */
  ready: {
    header: 'Review CCLA',
    body: 'Your CCLA is ready and waiting for signature. Continue to review and sign it. After the CCLA is signed, you will be the initial CLA Manager and authorized to approve contributors and add additional CLA Managers.',
    continueLabel: 'Review and Sign CCLA',
  },
  failure: {
    header: 'Unable to prepare CLA',
    /**
     * Only for a failure the CLA service did not explain. A refusal it *did* explain is shown in
     * its own words — it names the reason and what to do next, and substituting this would
     * discard both.
     */
    body: 'We could not prepare this CLA right now. Please try again, or contact support if the problem continues.',
  },
  picker: {
    header: 'Sign a CLA',
    body: 'Choose the project, CLA group, or repository source (GitHub, GitLab, or Gerrit), for which you want to sign a CLA.',
    placeholder: 'Search projects, CLA groups, repo sources, or paste a repo link',
    empty: 'Search for a project, CLA group, repo source, or paste a repo link.',
    noMatch: 'No matching projects, CLA groups, repo sources, or repo links.',
    continueLabel: 'Continue to sign →',
    cancelLabel: 'Cancel',
    /** Why a row cannot be signed. Shown on the row, because the row stays visible. */
    multiProjectDisabledReason: 'This CLA group covers several projects and cannot be signed from here.',
    cclaDisabledReason: 'This CLA group does not offer a corporate CLA.',
    /**
     * Names the organization rather than the CLA group, because that is the true scope of the
     * refusal: the group is not spent, this organization's corporate agreement for it exists.
     */
    alreadySignedDisabledReason: 'Your organization has already signed a corporate CLA for this CLA group.',
  },
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

/**
 * Why the CLA Managers and Approval List tabs hold nothing until the agreement is signed, taken
 * verbatim from the M3 prototype's locked panels.
 *
 * Only these two tabs. Both describe a role and a rule set that come into existence *with* the
 * signature — the signatory becomes the initial CLA Manager, and approval entries are what that
 * manager then maintains — so on an unsigned agreement there is nothing to list rather than a list
 * that failed to load. The remaining tabs are unbuilt for every agreement, signed or not, and
 * saying "once this CLA is signed" on them would promise content signing does not produce.
 *
 * Reached only through the pre-signing preview, since upstream's list draws every row from a
 * signature its query has already filtered to signed. That makes the preview the sole place these
 * panels render — which is why they are copy rather than an empty section. This is the same gap
 * the empty Overview had.
 */
export const ORG_CLA_LOCKED_TAB_COPY: Partial<Record<OrgClaDetailTab, { title: string; subtitle: string }>> = {
  managers: {
    title: 'CLA Managers become available once this CLA is signed',
    subtitle: 'The person who coordinates signing becomes the initial CLA Manager once this CLA is signed. Additional managers can be added afterward.',
  },
  approval: {
    title: 'The approval list becomes available once this CLA is signed',
    subtitle: 'Sign this CLA first, then add approval list entries to automatically cover matching contributors.',
  },
};

/**
 * The six approval-list criteria types (#1985), in the order the picker offers them and the
 * table sorts by.
 *
 * `OrgClaApprovalCriteriaKind` is derived from this, so the set exists once — a seventh upstream
 * list is a compile error at every exhaustive switch until it is handled.
 *
 * Order is the design's: email domain leads because it is the entry a CLA manager reaches for
 * first — one domain rule covers a whole workforce, where the per-person entries below it cover
 * one contributor each.
 */
export const ORG_CLA_APPROVAL_CRITERIA = [
  { kind: 'domain', label: 'Email domain', placeholder: 'example.com' },
  { kind: 'email', label: 'Email', placeholder: 'contributor@example.com' },
  { kind: 'github-org', label: 'GitHub org', placeholder: 'example-org' },
  { kind: 'github-username', label: 'GitHub username', placeholder: 'octocat' },
  { kind: 'gitlab-group', label: 'GitLab group', placeholder: 'https://gitlab.com/example-group' },
  { kind: 'gitlab-username', label: 'GitLab username', placeholder: 'example-user' },
] as const;

/**
 * Cap on the entries one approval-list change may carry.
 *
 * Shared so the modal stops accepting rows at the same point the server stops accepting them,
 * rather than letting someone fill in 120 entries and lose all of them to a 400. The producer
 * declares no limit of its own — but every removal in a request fans out into an
 * acknowledgement-invalidation pass, so an unbounded write is an unbounded amount of work inside
 * one synchronous request.
 */
export const ORG_CLA_APPROVAL_UPDATE_MAX_ENTRIES = 100;

/**
 * The heading the approval-list tab carries.
 *
 * Verbatim from the design, which takes it from the console being replaced. It is a misleading
 * label — the table lists the rules that grant coverage, not the contributors covered — but
 * renaming it here would leave a CLA manager unable to find the section they already know, and
 * would disagree with the label in the legacy console while both are live. The count beside it
 * is `approvalCriteriaCount` for the same reason the label is not trusted: it counts rules.
 */
export const ORG_CLA_APPROVAL_HEADING = 'Approved List of Contributors from My Organization';

/**
 * Toast copy for a completed approval-list write.
 *
 * A removal's summary names invalidation rather than removal, because that is the consequence a
 * CLA manager needs confirmed: the rule is gone *and* the acknowledgements it covered are no
 * longer valid. Upstream reports no count of the acknowledgements it invalidated, so none of
 * this copy claims one.
 */
export const ORG_CLA_APPROVAL_RECEIPT = {
  added: { summary: 'Approval list updated', detail: (count: number) => (count === 1 ? 'The entry was added.' : `${count} entries were added.`) },
  edited: { summary: 'Approval list updated', detail: () => 'The entry was updated. Acknowledgements matching the previous value were invalidated.' },
  removed: { summary: 'Entry removed', detail: () => 'The entry was removed. Acknowledgements it covered were invalidated.' },
} as const;
