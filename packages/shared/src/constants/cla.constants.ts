// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgClaDetailTab, OrgClaGroup, OrgClaManagerRefusal, OrgClaStatusDisplay } from '../interfaces/cla.interface';

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
  identifySomeoneElseLabel: 'Not the right person to sign? Identify someone else →',
} as const;

/**
 * Fallback filename on the BFF `Content-Disposition` for the watermarked review copy (#2317).
 * The unsigned overview saves `${claGroupName}-ccla-review.pdf` at the call site instead.
 */
export const ORG_CLA_REVIEW_COPY_FILENAME = 'Corporate_Contributor_License_Agreement.pdf';

/**
 * The leftover EasyCLA address, `/org/easycla` (#1983). Still routed for three consumers:
 * corporate-signing returns minted before lfx-self-serve#2743 deployed, returns minted by any
 * replica still running the previous release, and — while the `ORG_EASYCLA_RETURN_IN_PATH` rollout
 * gate is off (the shipped default) — every return this release mints (`legacyOrgEasyclaReturnPath`).
 * Not used for new in-app links (those go through `OrgLensNavigationService`). Removal (#2743
 * item 4) is one release after the gate has been on for a full signing-session lifetime, not one
 * release after this deploy.
 */
export const ORG_EASYCLA_PATH = '/org/easycla';

/**
 * Query parameter naming which corporate agreement an `/org/{org}/easycla/{claGroupId}` address is about,
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
 * group's `/org/{org}/easycla/{claGroupId}` address (#1983, #2364).
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
 * Legacy query parameter naming the organization a corporate signing session was opened for, on
 * return addresses of the leftover shape (`legacyOrgEasyclaReturnPath`). Spec 050 moves the
 * organization into the path (`orgEasyclaReturnPath`, lfx-self-serve#2743) behind the
 * `ORG_EASYCLA_RETURN_IN_PATH` rollout gate (`ServerFeatureFlag.OrgEasyclaReturnInPath`); until that
 * gate is on, the BFF still writes this parameter. The Org Lens page reads it on the leftover
 * `/org/easycla/…` mount only — never under `/org/:orgSegment/easycla`, where the path is the
 * authority — and keeps reading it for one release after the gate flips, so a signing trip opened
 * against the old shape lands on the right organization when it comes back.
 *
 * **It names an organization; it does not grant one.** The page resolves it against the viewer's
 * own authorized organizations and ignores anything absent from that list, so a crafted link cannot
 * select an organization the viewer does not hold.
 */
export const ORG_EASYCLA_RETURN_ORG_PARAM = 'org';

/**
 * Query parameter saying a corporate signing trip is in flight, carried on the CLA Group address
 * EasyCLA returns the signatory to (#2352).
 *
 * The return destination can be the agreement's own address because the page is addressed by CLA
 * Group and the group is chosen before the signing request is opened (#2364) — but the signature
 * it produced does not exist yet, and upstream takes a moment to list it. Without this flag the
 * page would see a group the organization has no signed row for and settle immediately on the
 * cannot-preview state, which is the right answer for a pasted address and the wrong one here.
 *
 * So it buys a wait, not a result: the page retries for the row on a short budget and, whether or
 * not one arrives, drops the parameter and settles the ordinary way. **It names nothing and grants
 * nothing** — a crafted link costs one retry budget and then resolves exactly as the bare group
 * address would.
 */
export const ORG_EASYCLA_RETURN_SIGNED_PARAM = 'signed';

/**
 * The corporate-signing return parameters (`?org=`, `?signed=`) nulled for a `queryParamsHandling:
 * 'merge'` navigation — the one shape every strip uses (the switch off an EasyCLA address, the
 * wait's settle, the addressed-mount strip), so the set cannot drift between them.
 */
export const ORG_EASYCLA_RETURN_PARAMS_RESET: Readonly<Record<string, null>> = Object.freeze({
  [ORG_EASYCLA_RETURN_ORG_PARAM]: null,
  [ORG_EASYCLA_RETURN_SIGNED_PARAM]: null,
});

/** The only value {@link ORG_EASYCLA_RETURN_SIGNED_PARAM} is written with; any other is ignored. */
export const ORG_EASYCLA_RETURN_SIGNED_VALUE = '1';

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
    /** Leaves attestation for the send-by-email path (#2365). Verbatim from the M3 prototype. */
    notAuthorizedLabel: 'I am not authorized',
  },
  /**
   * Name + email the CCLA to a signatory who is not the requester (#2365).
   *
   * Verbatim from the M3 prototype, with the company name interpolated. Distinct from the
   * #1984 CLA Manager modal: this names a signatory, not a manager, and does not collect the
   * self-sign attestation checkboxes.
   */
  sendByEmail: {
    header: 'Identify who should sign',
    body: (company: string): string =>
      `Tell us who's authorized to sign this CLA for ${company}, and we'll send them an email requesting that they review and sign it as the authorized signatory. You'll remain ${company}'s Initial CLA Manager once they complete the signature.`,
    nameLabel: 'Name',
    namePlaceholder: 'Full name',
    emailLabel: 'Email address',
    emailPlaceholder: 'name@company.com',
    sendLabel: 'Send Signature Request Email',
    cancelLabel: 'Cancel',
    missingFields: 'Enter a name and email address to continue.',
    /**
     * Per-field text, shown once the field holds something that cannot be sent.
     *
     * Send is disabled while either field fails, so the form cannot be submitted to get the
     * browser's own validation — without these, a one-character name or a malformed address
     * leaves the button dead with nothing said, and nothing at all for a screen reader.
     *
     * The name text names the bound rather than saying "invalid", because the bound is the part
     * the manager cannot guess: it is the producer's, and two characters is short enough to look
     * like a working value.
     *
     * Both bounds get a message. The field carries no native `maxlength`, which would stop input
     * by UTF-16 unit and so cut a non-BMP name off at half the cap this form actually allows —
     * the length here is counted in code points, as the producer counts it.
     */
    nameError: (min: number): string => `Enter the signatory's full name — at least ${min} characters.`,
    nameTooLongError: (max: number): string => `The signatory's name must be ${max} characters or fewer.`,
    emailError: 'Enter a complete email address, like name@company.com.',
    sendingHeader: 'Sending signature request…',
    successHeader: 'Signature Request Email Sent',
    successBody: (email: string): string =>
      `An email has been sent to ${email}, requesting that they sign the CLA. You may want to follow up with them to confirm they review and sign it.`,
    closeLabel: 'Close',
    failureHeader: 'Unable to send signature request',
    /**
     * Only for a failure the CLA service did not explain. Distinct from `failure.body`, which
     * talks about preparing a CLA — the self-sign outcome this dialog is not.
     */
    failureBody: 'We could not send this signature request right now. Please try again, or contact support if the problem continues.',
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
  /**
   * ACS deny on attestation Continue. Toast so the dialog can stay open; EasyCLA v4 still
   * enforces the write. Not the Corporate Console 403 page — that copy read as a hard block
   * after the viewer had just affirmed they were authorized to sign.
   */
  forbidden: {
    summary: "Can't start signing",
    detail: "You aren't designated to sign this corporate CLA for your organization.",
  },
  /**
   * Shown on the CLA Group detail page when the signatory has come back from signing and the
   * agreement is not in their organization's list yet.
   *
   * EasyCLA writes the signature when DocuSign calls it back, which races the return trip, so the
   * page keeps asking on a short budget. Without this line the wait is an unexplained skeleton on
   * the one visit where the signatory is most primed to see their agreement, and a reload is the
   * obvious thing to try — which restarts the wait rather than shortening it.
   */
  returnWait: 'Confirming your signature with EasyCLA. This can take a few seconds.',
} as const;

/**
 * ACS actions the Organization Lens EasyCLA permission hop accepts (#1980).
 *
 * Keep this the single list: the BFF rejects anything else rather than interpolating a guessed
 * string, and the client posts these literals rather than assembling ACS permissions itself.
 */
export const ORG_CLA_PERMISSION_ACTIONS = ['sign', 'approval-list-update', 'cla-manager-delete'] as const;

export const ACS_CLA_SIGN_RESOURCE = 'self_serve_request_corporate_signature';
export const ACS_CLA_SIGN_ACTION = 'create';
export const ACS_CLA_APPROVAL_LIST_RESOURCE = 'signature_approval_list';
export const ACS_CLA_APPROVAL_LIST_ACTION = 'update';
export const ACS_CLA_MANAGER_DELETE_RESOURCE = 'cla_manager_delete';
export const ACS_CLA_MANAGER_DELETE_ACTION = 'remove';
export const ACS_CLA_PROJECT_ORG_OBJECT_TYPE = 'project|organization';

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
 * Why the CLA Managers, Approval List, and Contributor Acknowledgments tabs hold nothing until the
 * agreement is signed, taken verbatim from the M3 prototype's locked panels.
 *
 * Only these three tabs. All three describe a role, a rule set, or an activity stream that comes
 * into existence *with* the signature — the signatory becomes the initial CLA Manager, approval
 * entries are what that manager maintains, and acknowledgments are what contributors then place
 * against the resulting rules — so on an unsigned agreement there is nothing to list rather than
 * a list that failed to load. The remaining tabs are unbuilt for every agreement, signed or not,
 * and saying "once this CLA is signed" on them would promise content signing does not produce.
 *
 * Reached only through the pre-signing preview, since upstream's list draws every row from a
 * signature its query has already filtered to signed. That makes the preview the sole place these
 * panels render — which is why they are copy rather than an empty section. This is the same gap
 * the empty Overview had.
 */
export const ORG_CLA_LOCKED_TAB_COPY: Partial<Record<OrgClaDetailTab, { title: string; subtitle: string }>> = {
  approval: {
    title: 'The approval list becomes available once this CLA is signed',
    subtitle: 'Sign this CLA first, then add approval list entries to automatically cover matching contributors.',
  },
  acknowledgments: {
    title: 'No contributor acknowledgments yet',
    subtitle: 'Once this CLA is signed, contributors who match the approval list will appear here.',
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
 * Cap on the named-signatory field for send-by-email (#2365).
 *
 * Shared so the dialog and the BFF refuse at the same length. Both count code points, as the
 * producer does — the dialog through `maxCodePointsValidator`, never a native `maxlength`, which
 * counts UTF-16 units and would halve the cap for a non-BMP name. The producer allows 255; this is
 * the Self Serve bound, and the BFF names it when a request still exceeds it.
 */
export const ORG_CLA_AUTHORITY_NAME_MAX_LENGTH = 200;

/**
 * Floor on the same field, mirroring the producer's `authority_name` `minLength: 2`.
 *
 * The producer's own handler only refuses a blank after trimming, so the minimum is enforced a
 * layer above it by generated request validation — which answers a status this BFF does not
 * relabel, so the body is dropped and the dialog falls back to its generic failure copy. Refusing
 * a single character here is what turns that dead end into a message naming the field.
 *
 * Only the minimum is mirrored, not the producer's `authority_email` pattern. That pattern caps
 * the TLD at ten letters and omits `'` from the local part, so mirroring it would reject
 * `.international` addresses and names like `o'brien@…` as *our* validation error for a
 * constraint that belongs upstream.
 */
export const ORG_CLA_AUTHORITY_NAME_MIN_LENGTH = 2;

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

export const ORG_CLA_MANAGER_REFUSALS = ['no-lf-login', 'lf-username-required', 'not-authorized', 'last-manager', 'already-manager', 'unknown'] as const;

export const ORG_CLA_MANAGER_REFUSAL_COPY: Record<OrgClaManagerRefusal, string> = {
  'no-lf-login': 'This person needs an LF Login account before they can be added as a CLA Manager. Ask them to create one, then try again.',
  'lf-username-required':
    'This person has an LF Login account but has not chosen an LF username yet. Ask them to finish setting up their LF Login username, then try again.',
  'not-authorized': 'You do not have permission to change the CLA Managers for this CLA.',
  'last-manager': 'A CLA must always have at least one CLA Manager, so this person cannot be removed. Add another CLA Manager first.',
  'already-manager': 'This person is already a CLA Manager for this CLA.',
  unknown: 'Something went wrong. Please try again.',
};

export const ORG_CLA_MANAGERS_COPY = {
  heading: 'CLA Managers',
  addAction: 'Add CLA Manager',
  intro:
    "CLA Managers maintain this CLA's approval list. If a CLA Manager also plans to contribute code themselves, they should add themselves to the Approved List.",
  unsignedTitle: 'CLA Managers become available once this CLA is signed',
  unsignedBody: 'The person who coordinates signing becomes the initial CLA Manager once this CLA is signed. Additional managers can be added afterward.',
  loadFailed: 'Could not load the CLA Managers for this CLA.',
  retry: 'Try again',
  empty: 'This CLA has no CLA Managers yet.',
  lastManagerHint: 'A CLA must always have at least one CLA Manager.',
  addDialogTitle: 'Add CLA Manager',
  addDialogIntro: "Add someone as a CLA Manager for this CLA. They'll be able to maintain its approval list and manage contributor approvals.",
  addedTitle: 'CLA Manager added',
  removeAction: 'Remove',
  removeBlockedLabel: 'Remove. A CLA must always have at least one CLA Manager.',
} as const;

export const ORG_CLA_MANAGER_REMOVE_COPY = {
  title: (name: string): string => `Remove ${name} as CLA Manager?`,
  self: 'You are removing yourself as a CLA Manager for this CLA. You will lose the ability to manage its approval list and add or remove other CLA Managers — this takes effect immediately.',
  other: (name: string): string => `${name} will no longer be able to manage this CLA's approval list or add other CLA Managers.`,
} as const;

/** Name-part bounds, matching what the CLA service accepts. */
export const ORG_CLA_MANAGER_NAME_MIN = 2;
export const ORG_CLA_MANAGER_NAME_MAX = 30;

// ---------------------------------------------------------------------------
// Contributor Acknowledgments (#1986)
// ---------------------------------------------------------------------------

/** The heading and subtitle over the Contributor Acknowledgments table, as the M3 prototype words them. */
export const ORG_CLA_ACKNOWLEDGMENTS_HEADING = 'Contributor Acknowledgments from My Organization';
export const ORG_CLA_ACKNOWLEDGMENTS_SUBTITLE = "Employees who've acknowledged they're covered by this CLA.";

/**
 * Cap on the acknowledgment page size the BFF forwards to the producer.
 *
 * The producer accepts up to 100 rows per page. The tab requests 50 by default and lets the CLA
 * manager fetch more with the Load-more control. A page above 100 is clamped silently to protect
 * the producer; a request for zero rows is clamped to 1 to prevent a runaway zero-loop.
 */
export const ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_DEFAULT = 50;
export const ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_MAX = 100;
export const ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_MIN = 1;

/**
 * Empty-state copy for a signed agreement with no acknowledgments yet.
 *
 * The title matches the M3 prototype's single empty state. The subtitle deliberately does NOT
 * repeat "once this CLA is signed" (that wording is reserved for the locked/unsigned state in
 * `ORG_CLA_LOCKED_TAB_COPY`) — the agreement is already signed on this path, so the answer is
 * simply "not yet". Parent story #1973 AC4 forbids the smiley icon the prototype used; render the
 * text with no decorative imagery.
 */
export const ORG_CLA_ACKNOWLEDGMENTS_EMPTY_COPY = {
  title: 'No contributor acknowledgments yet',
  subtitle: 'No employee has acknowledged this agreement yet.',
} as const;

/** Column headers for the Contributor Acknowledgments table. */
export const ORG_CLA_ACKNOWLEDGMENTS_COLUMN_HEADERS = {
  name: 'Name',
  identity: 'LF Login/GitHub or GitLab ID',
  signedOn: 'Acknowledged On',
  state: 'Status',
  actions: '',
} as const;

/**
 * The three acknowledgment states the M3 prototype shows. `acknowledged` is an approved
 * acknowledgment, which the prototype labels Authorized. `notAuthorized` is an acknowledgment whose
 * approval-list criteria were removed; `invalidated` is one a CLA manager or admin revoked.
 */
export const ORG_CLA_ACKNOWLEDGMENT_STATE_LABELS = {
  acknowledged: 'Authorized',
  notAuthorized: 'Not Authorized',
  invalidated: 'Invalidated',
} as const;

/** The explanation a Not Authorized row carries, worded as the M3 prototype words it. */
export const ORG_CLA_ACKNOWLEDGMENT_NOT_AUTHORIZED_COPY = {
  tooltip: (criteria?: string): string =>
    `Not Authorized is not the same as Invalidate. This person's approval criteria${criteria ? ` (${criteria})` : ''} was removed from the Approval List — no one purposefully revoked their access. If they should still be covered, add their criteria back to the Approval List. Use Invalidate only to deliberately revoke this acknowledgment.`,
  detail: 'No longer matches Approval List criteria.',
  approvalListLink: 'Add the user to the Approval list',
  detailSuffix: ', or Invalidate to remove for good.',
} as const;

/** Placeholder for a row whose field is empty. Never omit the row; render this instead. */
export const ORG_CLA_ACKNOWLEDGMENTS_EM_DASH = '—';

/**
 * Reasons a CLA manager can pick when invalidating an acknowledgment.
 *
 * The producer accepts these four enum values; the free-text note is separate. The tuple order
 * is the UI order the picker presents them in.
 */
export const ORG_CLA_INVALIDATION_REASONS = ['signed-in-error', 'should-be-corporate', 'compliance', 'other'] as const;

/**
 * Maximum length of the free-text note, matching the producer's own `maxLength: 2048`.
 *
 * Counted in code points, not UTF-16 units: go-swagger validates `maxLength` with
 * `utf8.RuneCountInString`. The dialog uses `maxCodePointsValidator` and carries no native
 * `maxlength`, which would stop a non-BMP note at half this cap.
 */
export const ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH = 2048;

/**
 * Confirmation-dialog copy for a row invalidate, as the M3 prototype words it.
 *
 * It names the contributor and says what invalidating does not stop: a contributor who still
 * matches the approval list can acknowledge again, or be re-added by Auto ECLA.
 */
export const ORG_CLA_INVALIDATE_DIALOG_COPY = {
  title: (contributor: string): string => `Invalidate acknowledgment for ${contributor}?`,
  marksPrefix: 'This marks',
  marksSuffix:
    " as no longer covered by this CCLA. It's assumed they've already lost access to any email domain, GitHub org, or GitLab group this CCLA's approval list checks against.",
  reacknowledge: (contributor: string): string =>
    `If ${contributor} still matches this CLA's approval list criteria, they can acknowledge (or be re-added automatically via Auto ECLA) again`,
  removeCriteria: " — remove the matching criteria below if that shouldn't be possible.",
  matchedBy: (count: number): string => ` was approved by ${count > 1 ? 'entries' : 'an entry'} added specifically for them.`,
  alsoRemove: (contributor: string, count: number): string =>
    `Also remove ${count > 1 ? 'these entries' : 'this entry'} from the Approval List so ${contributor} can't acknowledge this CCLA again later.`,
  noMatch:
    "No individual approval-list entry matches this contributor. If they still match a broader entry (e.g. an email domain or GitHub org), they'll remain able to re-acknowledge this CCLA.",
  checking: 'Checking the Approval List…',
  cancel: 'Cancel',
  confirm: 'Invalidate acknowledgment',
} as const;

/**
 * Toast copy for the outcome of an invalidate.
 *
 * The success detail names the contributor as the row displayed them, so the receipt is legible
 * on a list where several rows can otherwise look alike. The failure detail is the fallback only
 * — a message the BFF sent is preferred verbatim, because it is the producer's own sentence about
 * why this particular write was refused.
 */
export const ORG_CLA_INVALIDATE_RECEIPT_COPY = {
  successSummary: 'Acknowledgment invalidated',
  successDetail: (contributor: string): string => `${contributor} is no longer covered by this CLA.`,
  failureSummary: 'Invalidate failed',
  failureDetail: "We couldn't invalidate this acknowledgment. Try again in a moment.",
  removalFailedSummary: 'Approval List not updated',
  removalFailedDetail: "The acknowledgment was invalidated, but its approval-list entry couldn't be removed. Remove it from the Approval List tab.",
} as const;

/** Why the CLA service refused an invalidate: it only invalidates an approved acknowledgment. */
export const ORG_CLA_INVALIDATE_NOT_APPROVED_MESSAGE = "This acknowledgment is no longer approved, so it can't be invalidated yet.";

/** Label and accessible name for the per-row Invalidate control. */
export const ORG_CLA_INVALIDATE_ACTION_COPY = {
  label: 'Invalidate',
  ariaLabel: (contributor: string): string => `Invalidate the acknowledgment for ${contributor}`,
  /** Shown instead of the control when the producer sent a row with no per-ack id to address. */
  unavailableTooltip: 'This acknowledgment has no record id, so it cannot be invalidated here.',
} as const;
