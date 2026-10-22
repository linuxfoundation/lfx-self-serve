<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Marketing OS downstream rebuild

The Family page and the framework Asset view's Downstream action share one flow.
The action selects only downstream assets whose current summaries carry a known,
mismatching framework input identity. Unknown historical provenance is never
backfilled by guessing. Kit state remains based on current, so producing a newer
Draft does not clear an approved current asset's Needs rebuild badge until the
replacement is approved or made current.

## API and sequencing

All endpoints under `/api/mktg-agents/rebuild` require the server-resolved project's
writer grant and block impersonation, including result polling (which can persist
an agent's Draft). Tokens travel only in POST bodies.

- `start`: `{project, frameworkRevisionId}` selects the approved framework and the
  stale set. The server validates every selected agent's required intake from the
  project record before creating a Guild session. No sources, notes or logos are
  invented; the agent re-reads its sources. It starts the first step and returns
  `{project, chainId, ownerToken, framework, status, steps}`.
- `result`: `{project, chainId, ownerToken}` polls only the active step through its
  existing service and envelope-validation/persistence path. A ready result without
  a persistence receipt stays running and is retried by the next poll.
- `advance`: the same capability plus `{stepIndex, questionsId?, answers?}` starts
  the next queued step or answers the exact pending questions turn on the same
  Guild session. Agent-specific validators and exact pending keys gate answers.

The catalog-backed positioning family order is boilerplates, FAQ, then brand kit.
Only the explicit shared downstream graph is eligible. Each step uses the existing
agent service, intake and renderer. The framework's bytes are injected server-side;
identity is checked again before each next step starts and when its generation
captures provenance. If approval changes, the chain stops rather than switching
inputs. Questions appear in place on the Family page using the shared questions
component; answering continues the chain. No run-page behavior is changed.

Refusal or non-transient failure stops later steps and retains earlier Drafts.
Transient poll failures keep the same step running and retry within the existing
run deadline; starting sessions and sending answers are never blindly retried. The UI provides
Open Draft using each canonical revision receipt, never a content-hash lookup or
inferred newest revision. Every generated result uses the existing document writer,
so an approved current selection remains unchanged.

## Durable state and side effects

Private `rebuilds/{project}/{chainId}.json` contains the selected framework, step
sessions and progress, and creation time. It stores neither a requester subject nor
attribution names. The HMAC capability binds the chain to its project and requester;
each request verifies that capability against the authenticated requester before
minting its response token. Records expire for use after 24 hours; completed-record
deletion is a follow-up. No rebuild write intent rides URL query parameters.
The Downstream button carries the project and expected framework revision ID in
router navigation state. Family consumes that state once in the browser, clears
it from history state, and starts only for a matching stale, approved-current
selection with write access outside impersonation.

Before publishing a chain or calling Guild, `start` claims private
`rebuilds/{project}/active` with `ifNoneMatch: '*'`. Its shape is
`{chainId, startedAt, expiresAt}` (ISO start time, epoch-ms expiry), with no requester
subject or capability. `MKTG_REBUILD_ACTIVE_TTL_MS` is the 10-minute step deadline
plus a 2-minute margin; the separate 24-hour chain lifetime is unchanged.
Side-effecting advances and polls observing changed durable progress renew via
`ifMatch`; unchanged polls, attached starts and passive duplicate advances do not. Questions pause polling, but an
expired lease still owned by the same chain can be CAS-renewed by an advancing resume
(including answering). Passive checks of an expired lease return 409 without renewing it.
If a new start reclaimed it first, the old chain cannot
renew or drive further effects: `409 MKTG_REBUILD_EXPIRED` asks for a Family reload.
A non-terminal legacy chain within its 24-hour lifetime can claim an absent marker
with `ifNoneMatch: '*'`; losing that claim to another chain also returns 409.

A competing start attaches to a published active chain with `attached: true` and
its own caller-bound owner token, after the existing writer gate; it never shares
the first writer's capability. A different requested framework returns
`409 MKTG_REBUILD_FRAMEWORK_CHANGED`, not a silent attach to superseded input.
Missing, unreadable or expired chain records behind a live marker return retryable
`503 MKTG_REBUILD_UNAVAILABLE`, without starting Guild. After a publication error,
`start` re-reads the chain: a landed write returns saved progress and retains its lease;
only a confirmed absent chain expires its own marker before returning 503. Failed
verification or cleanup stays closed until TTL.
Terminal chains best-effort CAS-expire their own marker (release failures are
logged without hiding saved terminal progress); new starts CAS-reclaim expired or
terminal markers, never overwriting a replacement chain's claim.
A corrupt/unparseable marker is not TTL-reclaimed: an operator must inspect the
chain and repair the private marker through an authorized storage tool; mark stale
non-terminal chains failed (or confirm none exist) before removing the marker.

Each operation also takes a per-chain conditional-write claim **before** calling
Guild, then conditionally commits progress and releases it. Competing tabs/pods
cannot start or answer the same step twice. A contending result poll or already-started,
answerless advance returns saved progress instead of killing the watch; real
conflicting advances still fail with 409/412. A failed lease renewal after saved
progress is logged and non-fatal. An interrupted operation is never automatically replayed;
inspect saved Drafts before explicitly starting another rebuild after lease expiry.
In-flight queued steps appear running in attached/passive snapshots to avoid a
queued-advance hot loop; an interrupted operation can therefore look running until
the browser's approximately 10-minute step deadline. The browser polls sequentially with the existing run cadence. Each active
step gets its own `MKTG_RUN_POLL.timeoutMs` (10-minute) deadline, restarted when the
active step index changes, not on same-step progress or transient retries. Questions
pause polling; answering starts a new bounded stretch on the same session. Leaving
the page stops browser polling/advancing, not a Guild session already accepted.
A sessionStorage resume entry point remains a follow-up.

Family Slides-export marking is owned by the separate family-export item. This
flow does not modify the exporter or export slot.
