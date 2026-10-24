<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# LinkedIn Post Agent

The catalog's `linkedin-post` intake delegates to a dedicated profile/source surface. It consumes the deployed `linux-foundation~linkedin-post` agent's [linkedin-post-output/v1 contract](https://github.com/linuxfoundation/marketing-os-agents/blob/main/docs/contracts/linkedin-post-output.md). Shared renderers mirror the first-draft path of that agent's `src/form.ts` and its profile file format. No feedback, prior options, comments or regeneration request is accepted by these endpoints.

## 2.0 compatibility, profile questions and live activity

The output contract stays `linkedin-post-output/v1`. Output comes only from main's paired `finalize_linkedin_post` tool-result reader (`extractMktgToolResults`), never arbitrary source/user/chat JSON. The BFF validates the fields LFX renders and their cross-field/hash rules, while treating additional `inputs` provenance (including `inputs.research` from agent 2.0) as opaque. Stored 1.x envelopes/documents still work. One shared switch, `LINKEDIN_FORM_RENDER_VERSION`, defaults to **2** since agent **2.0.0 deployed 20 Oct**. The expert approved this default after deployment so the legacy instruction not to ask questions cannot suppress the live agent's gap round. Renderer **1** remains available behind the switch for 1.x compatibility. The independently tested **2** renderer follows the first-draft path in merged [agent PR #61](https://github.com/linuxfoundation/marketing-os-agents/pull/61): trusted date/version/sources followed by JSON-quoted `PROJECT SCOPE`/`PROFILE GAPS`, then guarded profile/source blocks and 2.0 wording. Envelope acceptance is tolerant of both versions regardless of this switch. The 2.0 renderer takes optional `project_name`/`project_uid`, mirroring the live form. Generate supplies both from its server-resolved writable project, never client-supplied display metadata; an unresolved name or uid refuses the run before creating a Guild session. The BFF still fetches URL text for the older path; 2.0 can also read that URL itself. The UI therefore says only that the agent reads the public page, never that it cannot browse.

A `linkedin-post-questions/v1` agent text turn pauses the existing run, not a fresh session or document. Only agent-authored text is parsed (not source/tool/user bodies). Question ids, uniqueness, limits and suggestion/basis pairing are validated, then mapped to main's `MktgRunQuestion` shape and shown by `MktgRunQuestionsComponent` on its own questions state, with the intake hidden. `POST /api/mktg-agents/linkedin-post/answers` uses the same catalog `endpoints.answers`/`MktgRunAnswer`/owner-token protocol as the generic runs. It requires the creator token and writer entitlement, matches a hash of the current trusted questions and refuses unasked ids. Guarded `linkedin-post-answers/v1` text goes through existing `GuildService.sendFollowUp` on that SAME session; no generate call. Answers are kept in memory for retry. A weak-keyed acknowledgement for the live run object prevents the same successful round from reappearing when a caller reuses that object, even without recovery storage; it does not mutate the caller's run. A successful reply records the answered question id in the existing TTL/user/project-bound pending capability so a reload ignores that old round while polling for the output. A ready, persisted result or a terminal failed session removes the capability; profile persistence still happens only after the validated final envelope.

Every result status (pending/questions/ready) carries sanitized activity. The BFF drops any payload with `content.type=application/guild-reasoning-progress` before envelope/question/feed processing, regardless of event type or streaming/final status. It reuses `buildMktgRunActivity` for tool-derived steps and adds bounded ordinary `content.type=text` progress; raw events and reasoning never reach the page. `MktgRunActivityComponent` replaces the static drafting sentence. Its public steps and the standalone questions component follow the Run board; the breadcrumb uses the Member 360 structure (`<project> kit › Social & community › LinkedIn`). The single shared tile-adjacent label is `MKTG_FAMILY_SOCIAL_COMMUNITY`; the kit-home layer owns generalising the family model/routing. No feedback/revision form is added.

Recorded test fixtures derive from agent QA runs `2026-10-19T14-07-12-140Z` (six cases) and `2026-10-19T20-25-45-097Z` (file + first-run completion). Names and organisations are aliased to synthetic labels; LF-owned names and other research/output values and structures are retained. Document hashes are recomputed after aliasing and original document hashes retained as provenance. Fixture headers identify the source run paths and explicitly say names and organisations aliased. Questions/answers retain their recorded bytes. The progress fixture keeps only ordinary public text and safe type/time metadata; reasoning uses a synthetic marker, never recorded thinking, and no authentication/session metadata is copied. These are aliased recorded QA runs, not a claim that the fixtures exercise the live deployment. The live 2.0 smoke in UI QA was deferred because the test account has no writer access; the product owner's hand test covers it. Renderer default 2 remains provisional.

## Identity and persistence

**Product owner's ruling:** durable LinkedIn profiles are keyed by the account's stable `sub`, not its username. The profile must follow the same stable identity across username changes. This is a deliberate exception to the repository's default username-based identity references, not an incidental use of the deprecated helper. The HMAC input remains the effective account `sub`; Guild session owner-token binding also remains on `sub`.

`GET /api/mktg-agents/linkedin-post/profile` reads the effective signed-in subject's profile. `PUT` saves edited setup answers or an explicitly accepted voice update, without running the agent or making a document. `DELETE` removes the effective user's current profile and returns 204; callers cannot name another user's key. It does not promise immediate removal of historical S3 versions. No user identifier or project from the client chooses the profile partition. During impersonation, GET remains open for viewing the target's settings. PUT/DELETE are guarded by `blockDuringImpersonation` and return 403 `IMPERSONATION_READ_ONLY`; a generate request carrying first-run `setup` is refused with the same guard. Generation from an already saved profile remains available. If an existing first-run session is polled while impersonating, its document can complete but the result skips profile auto-save and returns `profileSaved: false`. Separate controller operations (`get_linkedin_profile`, `update_linkedin_profile`, `delete_linkedin_profile`) own HTTP logging; the profile service owns conversion and Markdown rendering. Both setup and full-profile input cap each field at 4,000 characters.

Profiles use the existing private `marketing-os-artifacts` object store (S3 in production, its existing file backend locally). One stable `user-profiles/linkedin-post/{HMAC-SHA256(server-secret, linkedin-profile:effective-sub)}/current.json` object carries both `profile` and `profile_markdown`, with a content hash in its metadata. The server-held `PCC_AUTH0_SECRET` is required: there is no public/default HMAC key. The unkeyed subject hash is never used for new writes. Profile byte-integrity/JSON/structured-profile failures remain classified `object_store` errors, not an invented first-run state. After checking the stored bytes' hash and validating `profile`, reads render `profile_markdown` from the structured profile; an older agent's Markdown formatting does not brick saved settings. Profile endpoints send `private, no-store` cache headers. Profile reads use the private object-store wrapper, just like writes/deletes: neither keys, response bodies nor raw provider messages enter logs.

Retention: the application addresses one `current.json`, but the deployed `marketing-os-artifacts` S3 bucket is versioned. Each replacement retains the previous personal profile as a noncurrent version under the bucket's **30-day noncurrent-version expiration** lifecycle. `DELETE` sends ordinary `DeleteObject` with no `VersionId`: it creates a delete marker on that bucket, hides the current profile from normal reads immediately, and leaves noncurrent versions subject to the same 30-day expiration policy. It is logical current-profile deletion, not immediate historical erasure. The local file backend removes the current body/metadata and prunes empty directories.

Profile save performs only the normal bucket-readiness/`PutObject` path: no deletion, enumeration or version purge is a prerequisite. Current-profile deletion needs only the deployed `DeleteObject` grant. A confirmed absent key/bucket is idempotent success, including a fresh local S3-compatible bucket; permission/transport failures remain errors and log only safe name, Code/code and HTTP-status classification, never raw messages/keys. The unshipped legacy namespace and version-purge implementation have been removed. Any local prototype data should be cleaned manually rather than adding a deployed purge dependency.

Immediate noncurrent-version erasure is a separate **lfx-v2-opentofu follow-up**: the `marketing-os-artifacts` grant for `k8s-secret-access-pcc` in `object-store-definitions.yaml` / `s3-object-stores.tf` would need `s3:ListBucketVersions` on the bucket and `s3:DeleteObjectVersion` on `user-profiles/*`. This branch does not depend on those permissions and issues no version operations.

HMAC key rotation is deliberately coupled to `PCC_AUTH0_SECRET`; no new secret is introduced. Changing that auth secret changes the profile namespace, making existing profiles appear absent and leaving their old current objects unmigrated. Keep the key stable and coordinate profile migration/current-object removal with the previous key available **before** rotating/discarding it; session-secret rotation is not transparently supported for saved profiles.

The first-run screen keeps setup answers in the current view until the first draft. `generate` reads the stored profile server-side when one exists, otherwise sends those setup answers. A validated first-run result consumes an at-most-once initialization claim at `initializations/{SHA256(sessionId)}.json` inside the user's HMAC partition, then creates `current.json` with `If-None-Match: *`. A concurrent profile edit wins without being overwritten. The empty claim stores no profile or raw session identity. Acknowledged completed initialization retains its claim across current-profile deletion, so later replay and server restart do not recreate that completed run's profile. If its profile write throws, initialization best-effort releases the incomplete claim before rethrowing the original classified error, allowing a later retry; failed cleanup remains fail-closed and logs only a fixed message. This is not cross-instance deletion fencing: a first run already admitted past its claim can finish after a concurrent delete that removed the current key. That narrow in-flight window is documented and deterministically tested; durable lifecycle-generation fencing remains follow-up F7. When persistence is reported absent, the page retains unsaved settings and offers explicit save rather than claiming success. The first-draft Save voice offer is removed: this intake sends no feedback and the live contract cannot emit that offer on a first draft. A real offer belongs to comment-and-revise on the document page.

A ready result with `profileSaved: false` keeps the post on its Document with a warning. Explicit Edit profile can reuse creator/project/document-bound setup in SAME-VISIT memory, never reconstructed from browser storage after reload. Without that memory, setup is re-entered. Saving is explicit and starts no new generation.

Both `generate` and `result` enforce the selected project's writer grant. Result reads additionally check the session's user-bound owner token. Every ready output is persisted through `MktgDocumentStoreService.persistGeneration` as its own session-keyed `run-…` document. The stored sidecar includes options and posting notes, **not** the personal profile or voice settings. The agent's H1 includes the profile name, so before project persistence the BFF replaces that title with `# LinkedIn post options` and recomputes `content_sha256` over the edited bytes. Neither the project-readable artifact nor its immutable revision retains the identifying title. The creator-bound result envelope remains the original, integrity-validated agent output.

The dedicated page is now profile/source intake only: accepted Generate opens its Document immediately. It never polls or navigates on plain load/reload. Questions return to the form; answers ACK returns to the SAME Document/session without Generate. The shared receiver below owns progress, storage receipts and plain-URL cross-browser recovery. Failed runs return to source/setup re-entry: the previous one-click Retry with kept inputs is removed. Source bytes, URLs, filenames and personal setup are never carried in the navigation hint.

## Shared accepted-one-off resume core

The shared receiver can resume a dedicated form's **already accepted** session without
submitting another Generate. `MktgRunAttemptService.prepareAccepted(request, session)`
projects only session id, owner proof, public run selector and document destination into
the existing subject-bound, single-use `generation` handoff map. It does not copy the
LinkedIn generation response, source summary, retry setup or personalized envelope.
Requests and attempts carry the same `documentId`; consumption checks project, agent,
subject and that exact destination. One-offs cannot use the generic fresh-Generate path.
The dedicated LinkedIn form uses this handoff; results, activity, Copy post and share-link editing stay on the Document.

Pending proof keys are scoped per subject/project/agent/**document**, not merely per
agent. Reload storage contains no one-off intake answers, feedback, question text,
answers text, source labels/bytes or personal setup: only the minimum session capability,
public destination/run selector and the last acknowledged questions digest. The live
registry restores endpoint configuration. Private Q&A/source/history remains same-visit
memory only; one-off generated versions are not serialized by the generic history cache.
Successful receipt cleanup removes only that document's pending proof. Neither this
optional cache nor a URL token is the authoritative pending record: a plain document
URL in another browser still uses server `detail.runs[]` reconciliation.

The owned result controller validates the HMAC and LinkedIn body shape before the
writer lookup, then delegates to `MktgDocumentRunService.ownedOneOffResult` with a
validated typed `MktgOneOffRunContext`, never the raw HTTP body, for that exact
project/agent/session and creator. Its shared `agentResult` dispatcher owns the captured
link answers, source word count and original profile-initialization permission for BOTH owned polls and Documents
reconciliation; the controller applies no completion policy. It reuses the fetched record
and resolved outcome for tracking, without a duplicate pre-write record/result lookup.
The existing post-write metadata winner confirmation remains unchanged.
Browser omissions or later source context cannot replace captured values. Legacy untracked
sessions retain the result-body contract. One server utility classifies repository,
Smithy timeout and network errors (including status 0, 408, 429 and 5xx). A transient tracking
read failure logs fixed diagnostic categories and numeric status, never provider text,
and uses that same legacy creator contract for this poll; authorization failures are
never softened. Tracking-write failures retain the error under the logger's `err` field.
This service method is not a new endpoint or public progress projection.
`profileSaved: false` remains distinct from a successful document receipt in the shared progress event, for the cutover's existing
profile-persistence warning.

## Dedicated-form transport extension

`LinkedinPostService.startForDocument` uses the same Generate request implementation
as the legacy client, but writes no legacy pending storage. It retains original setup
only in creator/project/document-bound live memory for explicit profile editing after
an unsaved-profile warning; a new browser/client instance cannot recover that setup.
The intake uses this API, never legacy pending-cache/result-wait methods.

The receiver carries only an allow-listed `source=text|file|url` navigation hint; absent
or invalid values become `text`. It never puts source text, a source URL, filename or
setup in a navigation URL. Its existing submitted handler replaces an accepted
one-off generation token with the public run selector, so reload uses the saved run.
The same prepared map can carry failed-intake re-entry, including a public hint with
no session capability when another authorized browser opens a failed document.
That hint grants neither Generate provenance nor result-poll authority. Server failure
wins over a still-writing private cache. An owner's valid capability also reconnects a
server questions pause after reload, when private question text was not retained; the
intake action waits for those private details rather than opening an empty form. The dedicated intake consumes the
hint for source/setup re-entry; unsupported Member questions retain their separate
bounded-pause policy and no intake link.

### Adopting the one-off hook

Register a run-kind document type pointing at its catalog agent and an active intake with
`oneOffDocument` and `tracksDocumentRun`. Its dedicated Generate records `startForOneOff`
and returns the accepted session, public runId and exact documentId. Call `prepareAccepted`
and open that Document with `generation`; the existing receiver replaces it with public
`run`, resumes the saved run and handles registered result/answers endpoints. Do not use
shared fresh-Generate or add another registry/poller; private owner proof stays out of URLs.

## Terminal Guild failures

The shared [`GuildService.resolveRunOutcome` step](./mktg-document-revisions.md#run-outcomes)
runs before controller logging and response. It reuses raw events and preserves
healthy/recovering sessions. A non-tool error must settle for 30 seconds without
recovery. Only explicit new-work events or trusted agent text (including progress
and questions) recover immediately; passive status/heartbeat/completion events do
not. Tool-task errors are not session errors. The 30-second settle period comes
from the Slides contract; no recorded failed stream is available yet. No
unverified session-status probe runs. Lookups are
best-effort; ready/refused and an already-returned failed status are unchanged.
Both provider failure metadata and idle-runtime failureText use the client layer's
same stop/Retry path; raw failureText is not rendered as a document or provider reason.

Both the generic run shell and LinkedIn stop polling on `failed`, keep the current form, show Retry and create no document or revision. Failed LinkedIn pending capabilities are retired so another reload cannot automatically resume the dead session. Generic stored version history survives failure; only session reuse is invalidated. Retry starts a new session, not another poll of the failed one. Provisional first-run reload behavior: if profile setup was lost with the old page, Retry opens an empty setup form with “Your setup answers aren't kept in the browser — enter them again to draft”. It never resumes the dead session or persists profile answers. After profile re-entry, Retry also asks for the source again when it was lost on reload.

The [durable started-run record](./mktg-document-revisions.md#durable-started-runs) also permits
writer-entitled Documents reconciliation without a creator owner token. It completes the same
session/document and initializes a first-run profile only for the ORIGINAL creator recorded at
Generate, never the visiting writer. Initialization is disabled if Generate began during
impersonation, and the existing read-time impersonation restriction remains. Activity on this
project-readable progress surface is creator-only; other writers receive progress without the feed.

## Source ingestion

- Pasted text: trimmed, nonempty UTF-8, at most 1 MiB.
- Files: UTF-8 `.txt`, `.md`, `.csv` or `.html`, at most 1 MiB. The browser transports base64 bytes; the BFF decodes and validates them. No PDF/Word dependency is added.
- Links: public HTTPS pages only, no credential-bearing URLs, 2,048-character URL limit. The existing `fetchSafeUrl` helper validates every DNS result and redirect, pins the connection to the validated IP, and refuses private/reserved hosts. This flow requests a 1 MiB response limit and HTML/plain-text/Markdown/XHTML content types, with a 10-second abort signal; the helper also has its own 15-second transport timeout and five-redirect cap. Its DNS-resolution policy is shared with existing scraping callers.
- HTML/XHTML responses are parsed with the existing `sanitize-html` dependency; plain-text/Markdown responses retain literal angle brackets and autolinks. The SSRF helper reports the final normalized content type and skips the allowlist on non-2xx redirect/error hops. HTML scripts/styles and markup are removed before the content is sent to the agent. Failed fetches/extraction are reported, never substituted with client-provided text or silent truncation. Credential, empty-content, HTTP and file-size refusals keep their specific validation reasons. Transport/HTTP failure details are logged at DEBUG in the source service, leaving one WARN to the API validation handler for caller-controlled refusals. These details contain only safe classification/code or status, never raw error messages or source URLs that may contain personal query values.

`today` is the BFF's UTC date. The trusted date, version and provenance lines precede all user-supplied content; delimiter-shaped lines and unusual line terminators are neutralized exactly as in the live renderer. Result candidates come from Guild's filtered raw events, pass the shared schema/cross-field validator, and have their document SHA-256 recomputed before selection by highest version.

The result shows three labeled full-text options, hashtags, tagging suggestions, copy controls and separate notes. Copy includes the post and missing hashtags, never notes or tagging instructions. The copy action does not publish anything to LinkedIn.

## Share-link presentation

`Link to share` is optional LFX-side data, prefilled from the URL source until the user edits it, and initially empty for pasted text or files. The client sends it as `answers.share_link`; it is validated as a bounded HTTPS URL without credentials and is not added to the agent form. Generate records the link and source word count for shared Document completion alongside the structured option sidecar; no dedicated client pending-cache or poll is involved. The source label/fetched state come from the validated envelope's provenance.

For browser-independent completion, Generate captures the normalized link answers and source word
count in that private started-run record, alongside initialization permission and the already-recorded
opaque creator subject. It stores no profile fields there. Documents reconciliation uses those
captured values instead of relying on a creator-bound result poll to return them; the public progress
projection exposes none of that private context. See [Durable started runs](./mktg-document-revisions.md#durable-started-runs).

A LinkedIn revision read adds a validated `linkedinPost` projection (options, notes, LFX answers and optional source summary) for its read-only view. No raw personal profile fields are exposed. The Document uses `LinkedinPostOptionsComponent`: it substitutes every literal `[LINK]` only for display/copy, shows a dashed `add your link` chip when absent, and keeps the literal placeholder in copied text with the design's quiet reminder. Raw option text, the original agent envelope and the existing privacy-normalized persisted Markdown/content hash are not modified by link substitution.

The initial link answer is persisted with the run and recovered with its document. Omitted result-poll answers remain absent rather than being converted to an empty link. If a later poll supplies the first answer, it seeds an absent presentation overlay with a create-only write; it never rewrites immutable revision bytes, replaces an originally supplied answer, or overwrites a later explicit link edit. `PATCH /api/mktg-agents/linkedin-post/documents/:documentId/share-link` accepts only `{ project, share_link }`, checks the effective signed-in user and the project's writer entitlement, and refuses writes during impersonation. A blank string clears the link; HTTPS-only, credential/whitespace refusal and the 2,048-character cap use the same shared normalizer as the intake. The route checks that the run has valid option cards before replacing `documents/{project}/linkedin-post/{documentId}/presentation.json` through the mutable private-object facility. Profile and presentation writes delegate to the generic conditional-write API: create with `If-None-Match`, replace with the observed ETag/`If-Match`, and refuse contention rather than overwriting a concurrent save. Private key logging remains suppressed. Reads validate the overlay's hash and link before applying it. An absent overlay uses the original run answer; a failed read is an error, never a silent fallback to stale presentation.

The Document field has explicit Edit link, Save link and Cancel controls; Enter in its editor uses the same guarded Save. While saving, controls are disabled; cards and Copy post switch only after success. Failed saves retain the last saved link and show a fixed inline error; Cancel restores the saved value. Clearing saves an empty link. There is no new revision, agent run or Markdown/hash mutation; repeated result polls do not overwrite the mutable link. The intake has no result, post-save status or Open document action: before Draft its optional link travels only in Generate, never a PATCH to an earlier document. Only explicit Draft starts generation; share-field Enter applies validation without submitting, implicit form submits are cancelled, and textarea Enter remains multiline. The dashed `add your link` chip is a native keyboard-focusable button with an accessible name/focus ring; on the Document it activates editing, focuses and scrolls the one field into view. Older Markdown-only revisions remain readable through the generic renderer.

## Read-time document attribution

Decided by the operator, 23 Oct 2026: a LinkedIn post is a one-off run, not an approvable kit asset. Draft/Approved belongs to the asset JSON views; post approval is out of scope until the later comment-and-revise item. LinkedIn retains its author by-line, option cards, source/share-link controls and Draft another post. It hides asset metadata, Approve, generic Run again, About/Revisions and the revision pill, including for readable legacy Markdown posts. Generic metadata, approval, export and Run again behavior remains unchanged for every other document type; no write-lifecycle unification is introduced.

**Binding operator decision:** `lfx/mktgos-ui-expert/decision-mktgos-ui-expert-revision-authors-are-stored-as-an-opaque-id-and-named-at-read-time@hb1.01M490BZHWCJX7NQWV4QS09CA2.11.01M52MCN7Z88FNFW4G40GV3PQJ`. As ruled in #3773, persisted attribution uses only the effective Auth0 sub. Persisting a username or display name was explicitly rejected. This is a deliberate privacy exception to backend-auth guidance that normally prefers username-based identity references, not an accidental use of the legacy subject helper. Names are resolved through `UserService.getUserInfo` at read time and memoized per request.

Uses the generic document store from [#3773](https://github.com/linuxfoundation/lfx-self-serve/pull/3773): new LinkedIn revisions record only `author-id` object metadata through its shared author helper. Missing effective identity outside impersonation fails closed; an unidentified impersonation target stays unattributed, never attributed to the operator. No author display name or username is stored in revision bytes, sidecars or presentation metadata; the existing neutral-H1 transform is retained. LinkedIn's presentation service handles links only: card attribution reuses the generic revision's resolved author and compares the effective viewer subject server-side.

On a writer-entitled revision read, `resolveAuthor(req, userId)` performs a request-memoized directory `getUserInfo` lookup and returns `{ name: string | null }`. Failed lookups log one warning per author/request and return null; a username is never a fallback. The BFF compares the effective viewer subject with the stored id and returns `isAuthor`, never the id. The author sees Writing as with Edit profile (navigates to the LinkedIn page with `?profile=edit`); other project writers see Drafted by with no profile-edit control. Null names render as name unavailable. Pre-existing revisions with no author-id have no byline at all. The generic revision pill is not shown on the structured LinkedIn document. Stored card sidecars cannot supply attribution; only the metadata-backed BFF projection may carry it. The explicit profile-edit entry is consumed on Save/Cancel; Draft another clears the edit flag so reload does not reopen a stale editor. There is no intake Open document action.
