// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  AudienceAttachExistingRequest,
  AudienceAttachExistingResult,
  AudienceBuilderCapabilities,
  AudienceComposeMasterRequest,
  AudienceComposeMasterResult,
  AudienceComposedList,
  AudienceDiscoveredEvent,
  AudienceDiscoveredList,
  AudienceDiscoveryResult,
  AudienceLastSentEmail,
  AudienceListBrief,
  AudienceListSearchResult,
  AudienceMasterListBrief,
  AudiencePreviewCount,
  AudienceQaCandidate,
  AudienceQaCheck,
  AudienceQaFinding,
  AudienceQaResult,
  AudienceQaRunRequest,
  AudienceQaSeverity,
  AudienceQaVerdict,
  AudienceSignal,
  AudienceSpeakerScope,
  AudienceSuppressionCategory,
  AudienceSuppressionList,
  CampaignAudience,
} from '@lfx-one/shared/interfaces';
import { AUDIENCE_BUILDER_REQUEST_TIMEOUT_MS } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { toAudienceStatus } from '../helpers/campaign-audience.helper';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * The snake_case wire shapes of lfx-v2-campaign-service's audience-builder service.
 *
 * Declared here rather than in `@lfx-one/shared` on purpose: these are the WIRE shapes of
 * another service, not this app's contract. Putting them in the shared package would invite a
 * component to import one, and then a contract change upstream would reach the browser instead
 * of stopping at the adapter below. Every method in this class maps a wire shape to the
 * camelCase interface the Angular side already consumes.
 *
 * Source of truth: `design/audience_builder.go` in lfx-v2-campaign-service. `Required(...)` there
 * decides which fields are non-optional here.
 */
interface WireDiscoveredList {
  list_id: string;
  name: string;
  signal: string;
  size?: number;
  reason: string;
  list_type: string;
  scope?: string;
  hubspot_url: string;
}

interface WireEventIdentity {
  event_name: string;
  brand_short?: string;
  event_dates?: string[];
}

interface WireDiscoveryResult {
  event?: WireEventIdentity;
  lists: WireDiscoveredList[];
  missing_signals: string[];
  inspected?: number;
}

interface WireListSearchResult {
  list_id: string;
  name: string;
  size?: number;
  hubspot_url: string;
}

interface WireSuppressionList {
  key: string;
  label: string;
  list_id: string;
  name: string;
  size?: number;
  category: string;
  hubspot_url: string;
}

interface WireListBrief {
  list_id: string;
  name: string;
  size?: number;
  missing: boolean;
  resolved_from_legacy_id?: string;
  hubspot_url?: string;
}

interface WireLastSentEmail {
  email_id: string;
  email_name: string;
  sent_at?: string;
  hubspot_url: string;
  included_lists: WireListBrief[];
  suppression_lists: WireListBrief[];
  lists_unavailable?: boolean;
}

interface WireMasterListBrief {
  list_id: string;
  name: string;
  size?: number;
  hubspot_url: string;
}

interface WirePreviewCount {
  exact: boolean;
  count: number;
  estimate: number;
  reason: string;
}

interface WireComposedList {
  list_id: string;
  name: string;
  hubspot_url: string;
  size?: number;
}

interface WireComposeMasterResult {
  master: WireComposedList;
  suppression?: WireComposedList;
  source_list_ids: string[];
  recorded?: boolean;
  audience?: WireRecordedAudience;
}

interface WireAttachExistingResult {
  master: WireComposedList;
  suppression_list_ids: string[];
  audience: WireRecordedAudience;
}

/**
 * The slim audience row a recording compose returns.
 *
 * Slim by design upstream: it deliberately omits `built_in_portal_id`, because provenance a
 * client can send back is provenance that proves nothing. It also omits the project id, which is
 * why {@link toRecordedAudience} leaves that field unset rather than inventing one.
 */
interface WireRecordedAudience {
  id: string;
  status: string;
  version: number;
  platform_master_list_id: string;
}

interface WireQaFinding {
  severity: string;
  message: string;
  fix: string;
}

interface WireQaCheck {
  verdict: string;
  findings: WireQaFinding[];
}

interface WireQaSuppressionCheck extends WireQaCheck {
  applied_gdpr: boolean;
  applied_opt_out: boolean;
}

interface WireQaExclusionCheck extends WireQaCheck {
  exclusion_count: number;
}

interface WireQaChecks {
  signal_mapping: WireQaCheck;
  suppression: WireQaSuppressionCheck;
  exclusion_completeness: WireQaExclusionCheck;
}

interface WireQaCandidate {
  list_id: string;
  name: string;
  size?: number;
}

/**
 * Upstream's single QA struct, which the design documents as carrying a MANDATORY discriminator
 * precisely because Goa has no union type. `narrowQaResult` turns it back into this app's real
 * discriminated union.
 */
interface WireQaResult {
  needs_disambiguation: boolean;
  candidates?: WireQaCandidate[];
  list_id?: string;
  name?: string;
  hubspot_url?: string;
  checks?: WireQaChecks;
  findings?: WireQaFinding[];
  overall?: string;
}

/** The ComposePartial 500 body: `{code, message, suppression}`. */
interface WireComposePartialError {
  code?: string;
  message?: string;
  suppression?: WireComposedList;
  suppression_name?: string;
  master_name?: string;
  master?: WireComposedList;
}

/**
 * A `compose-master` that created the suppression list and then failed on the master.
 *
 * Thrown rather than returned so the controller's 502 path stays a catch, and carries the
 * orphaned list because a retry would create a SECOND one — the operator has to be linked to
 * what exists, not offered a button that duplicates it.
 */
export class AudienceComposePartialError extends Error {
  public readonly suppression?: AudienceComposedList;
  /** Set when the suppression CREATE itself is unconfirmed — no id came back to confirm it. */
  public readonly suppressionName?: string;
  /** Set when the master create is unconfirmed. */
  public readonly masterName?: string;
  /**
   * Set when BOTH lists exist and only the attach to the brief failed.
   *
   * Never set alongside `masterName`: one asserts the master is confirmed, the other that it is
   * not. This is the shape whose lists are usable, so the UI it drives points the operator at
   * this list rather than at a retry.
   */
  public readonly master?: AudienceComposedList;

  public constructor(message: string, suppression?: AudienceComposedList, suppressionName?: string, masterName?: string, master?: AudienceComposedList) {
    super(message);
    this.name = 'AudienceComposePartialError';
    this.suppression = suppression;
    this.suppressionName = suppressionName;
    this.masterName = masterName;
    this.master = master;
  }
}

/**
 * Asserts a field upstream declares REQUIRED is actually present.
 *
 * A 2xx with a malformed body is not a successful answer, and defaulting the missing field is
 * how it becomes one: `lists ?? []` turned an unverifiable suppression read into a verified
 * empty set, clearing `suppressionFailed` and enabling compose without the exclusions the UI
 * never managed to confirm. Failing the read keeps the caller's failure arm — which exists for
 * exactly this — reachable.
 */
function required<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null) {
    throw new Error(`audience-builder: upstream response is missing the required field \`${field}\``);
  }
  // A blank string is missing, not present. An id of `''` passes every null check and then
  // reaches the "Master list created" banner as a list with nothing to open or search — the
  // same unusable create this guard exists to stop, arriving through a narrower door.
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error(`audience-builder: upstream response has a blank required field \`${field}\``);
  }
  return value;
}

function toDiscoveredList(wire: WireDiscoveredList): AudienceDiscoveredList {
  return {
    listId: wire.list_id,
    name: wire.name,
    signal: wire.signal as AudienceSignal,
    size: wire.size,
    reason: wire.reason,
    listType: wire.list_type,
    scope: wire.scope === undefined ? undefined : (wire.scope as AudienceSpeakerScope),
    hubspotUrl: wire.hubspot_url,
  };
}

function toListBrief(wire: WireListBrief): AudienceListBrief {
  return {
    listId: wire.list_id,
    name: wire.name,
    size: wire.size,
    missing: wire.missing,
    resolvedFromLegacyId: wire.resolved_from_legacy_id,
    hubspotUrl: wire.hubspot_url || undefined,
  };
}

function toComposedList(wire: WireComposedList): AudienceComposedList {
  return {
    listId: wire.list_id,
    name: wire.name,
    hubspotUrl: wire.hubspot_url,
    size: wire.size,
  };
}

/**
 * A list reported as CREATED on the SUCCESS path, with every identifying field validated.
 *
 * Separate from {@link toComposedList} rather than replacing it, because the two paths want
 * opposite things. A create is non-idempotent, so on success a blank name or url renders a
 * confirmed, actionable list the operator cannot reconcile — that must fail. On the PARTIAL
 * path the same blank must NOT throw: that code runs inside a catch, and throwing there
 * replaces the orphan banner with a generic error, destroying the one record of a list that
 * already exists in the portal. Validating there would be strictly worse than tolerating it.
 *
 * `label` names which list failed, so the error is diagnosable.
 */
function toCreatedList(wire: WireComposedList, label: string): AudienceComposedList {
  return {
    listId: required(wire.list_id, `${label}.list_id`),
    name: required(wire.name, `${label}.name`),
    hubspotUrl: required(wire.hubspot_url, `${label}.hubspot_url`),
    size: wire.size,
  };
}

/**
 * The recorded audience row, widened to the shape the rest of the app already speaks.
 *
 * Three fields are supplied here rather than read off the wire, and each is knowable with
 * certainty at this point:
 *
 *  - `briefId` is the id this request SENT. Upstream records the row under exactly that brief or
 *    refuses the compose outright, so echoing it states a fact rather than a guess.
 *  - `platform` is `hubspot` because the audience builder has no other backend — every route in
 *    it composes HubSpot lists — and upstream stamps the row the same way.
 *  - `projectId` is left UNSET, on purpose. Upstream does not return it and this layer holds the
 *    project slug, not its id; writing the slug into an id field would be a value that looks
 *    usable and is not.
 *
 * `status` goes through the shared coercion so an unrecognised wire string cannot masquerade as
 * a usable audience — though a recording compose only ever reports `built`.
 */
function toRecordedAudience(wire: WireRecordedAudience, briefId: string): CampaignAudience {
  return {
    id: required(wire.id, 'audience.id'),
    briefId,
    platform: 'hubspot',
    platformMasterListId: required(wire.platform_master_list_id, 'audience.platform_master_list_id'),
    status: toAudienceStatus(required(wire.status, 'audience.status')),
    version: required(wire.version, 'audience.version'),
  };
}

function toFinding(wire: WireQaFinding): AudienceQaFinding {
  return {
    severity: wire.severity as AudienceQaSeverity,
    message: wire.message,
    fix: wire.fix,
  };
}

function toCheck(wire: WireQaCheck): AudienceQaCheck {
  return {
    verdict: wire.verdict as AudienceQaVerdict,
    findings: (wire.findings ?? []).map(toFinding),
  };
}

/**
 * Narrows upstream's one QA struct into this app's discriminated union.
 *
 * The discriminator is trusted for the AMBIGUOUS arm and verified for the resolved one: a
 * `needs_disambiguation: false` with no `checks` is a malformed response, and mapping it to a
 * report with empty verdicts would render as a clean pass.
 *
 * It is REJECTED rather than reshaped. Folding it into the ambiguous arm avoided the false
 * pass but invented a different wrong answer: the UI then states the name matched several
 * lists while rendering none, so the operator retypes a reference that was never ambiguous.
 * `needs_disambiguation: false` means QA completed; a response that says so without its
 * result is a broken contract, and the only honest report of a broken contract is an error.
 */
function narrowQaResult(wire: WireQaResult): AudienceQaResult {
  const checks = wire.checks;
  if (!wire.needs_disambiguation && !checks) {
    throw new Error('The audience QA service reported a resolved result with no checks.');
  }
  if (wire.needs_disambiguation || !checks) {
    const candidates: AudienceQaCandidate[] = (wire.candidates ?? []).map((candidate) => ({
      listId: candidate.list_id,
      name: candidate.name,
      size: candidate.size,
    }));
    return { needsDisambiguation: true, candidates };
  }

  return {
    needsDisambiguation: false,
    listId: wire.list_id ?? '',
    name: wire.name ?? '',
    hubspotUrl: wire.hubspot_url ?? '',
    checks: {
      signalMapping: toCheck(checks.signal_mapping),
      // Upstream reports the two regulatory booleans FLAT alongside the verdict; the client
      // contract nests them under `applied`. The nesting is not cosmetic — it keeps "a GDPR
      // suppression was applied" from reading as a sibling of the verdict it only informs.
      suppression: {
        ...toCheck(checks.suppression),
        applied: {
          gdpr: checks.suppression.applied_gdpr,
          optOut: checks.suppression.applied_opt_out,
        },
      },
      exclusionCompleteness: {
        ...toCheck(checks.exclusion_completeness),
        exclusionCount: checks.exclusion_completeness.exclusion_count,
      },
    },
    findings: (wire.findings ?? []).map(toFinding),
    overall: (wire.overall ?? 'NEEDS VERIFY') as AudienceQaVerdict,
  };
}

/**
 * Audience Builder reads and writes, proxied to lfx-v2-campaign-service.
 *
 * Every endpoint lives upstream: the portal credentials are stored there as per-project
 * encrypted connections, so this app has no HubSpot token of its own and nothing here talks to
 * HubSpot. This class is the adapter — snake_case wire in, the camelCase `Audience*` interfaces
 * out — and it absorbs four shape mismatches the two contracts disagree on:
 *
 * 1. Upstream wraps collections in `{lists}` / `{emails}`; the client expects bare arrays.
 * 2. Upstream reports the QA suppression booleans flat; the client nests them under `applied`.
 * 3. Upstream has no union type, so QA returns one struct with a discriminator; the client has a
 *    real discriminated union.
 * 4. Upstream answers compose with 201 plus a typed `ComposePartial` 500; the controller answers
 *    the client with 502 carrying the orphaned list.
 *
 * Discovery's SSE↔synchronous mismatch is the fifth, and it is deliberately NOT handled here —
 * Goa's HTTP transport has no SSE encoding, so `discover` is one synchronous upstream call and
 * the controller owns the stream it is wrapped in.
 */
export class AudienceBuilderProxyService {
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor(microserviceProxy?: MicroserviceProxyService) {
    this.microserviceProxy = microserviceProxy ?? new MicroserviceProxyService();
  }

  public async getCapabilities(req: Request, projectSlug: string): Promise<AudienceBuilderCapabilities> {
    const wire = await this.get<{ hubspot_configured: boolean; detail?: string }>(req, projectSlug, 'capabilities');
    // `detail` was declared here and then dropped, so every unusable connection rendered as
    // "no credentials configured" — the wrong remediation for an inactive or undecryptable one.
    const detail = typeof wire.detail === 'string' ? wire.detail.trim() : '';
    return { hubspotConfigured: wire.hubspot_configured === true, ...(detail === '' ? {} : { detail }) };
  }

  /**
   * One synchronous discovery pass.
   *
   * Returns the event identity separately from the classified lists because the client's stream
   * frames them separately — `event` as soon as the identity is known, `discovered` for the
   * buckets. Upstream sends both in one body, so the split happens here rather than in the
   * controller, which should not know the wire shape.
   */
  public async discover(
    req: Request,
    projectSlug: string,
    eventUrl: string
  ): Promise<{ event: AudienceDiscoveredEvent | null; result: AudienceDiscoveryResult; inspected: number }> {
    const wire = await this.post<WireDiscoveryResult>(req, projectSlug, 'discover', { event_url: eventUrl });

    return {
      event: wire.event
        ? {
            eventName: wire.event.event_name,
            brandShort: wire.event.brand_short ?? '',
            eventDates: wire.event.event_dates ?? [],
          }
        : null,
      result: {
        lists: (wire.lists ?? []).map(toDiscoveredList),
        missingSignals: (wire.missing_signals ?? []) as AudienceSignal[],
      },
      inspected: wire.inspected ?? 0,
    };
  }

  public async searchLists(req: Request, projectSlug: string, query: string): Promise<AudienceListSearchResult[]> {
    const wire = await this.get<{ lists?: WireListSearchResult[] }>(req, projectSlug, 'lists/search', { q: query });
    return (wire.lists ?? []).map((list) => ({
      listId: list.list_id,
      name: list.name,
      size: list.size,
      hubspotUrl: list.hubspot_url,
    }));
  }

  public async getSuppressionLists(req: Request, projectSlug: string, brandShort: string, eventName: string): Promise<AudienceSuppressionList[]> {
    // Both params are optional upstream and omitted rather than sent empty: an empty
    // `event_name` is a filter that matches nothing, where an absent one means "do not filter".
    const wire = await this.get<{ lists?: WireSuppressionList[] }>(req, projectSlug, 'suppression-lists', {
      ...(brandShort === '' ? {} : { brand_short: brandShort }),
      ...(eventName === '' ? {} : { event_name: eventName }),
    });

    return required(wire.lists, 'lists').map((list) => ({
      key: list.key,
      label: list.label,
      listId: list.list_id,
      name: list.name,
      size: list.size,
      category: list.category as AudienceSuppressionCategory,
      hubspotUrl: list.hubspot_url,
    }));
  }

  public async getLastSent(req: Request, projectSlug: string, eventName: string, brandShort: string, limit: number): Promise<AudienceLastSentEmail[]> {
    const wire = await this.get<{ emails?: WireLastSentEmail[] }>(req, projectSlug, 'last-sent', {
      event_name: eventName,
      ...(brandShort === '' ? {} : { brand_short: brandShort }),
      limit,
    });

    return (wire.emails ?? []).map((email) => ({
      emailId: email.email_id,
      emailName: email.email_name,
      sentAt: email.sent_at ?? '',
      hubspotUrl: email.hubspot_url,
      includedLists: (email.included_lists ?? []).map(toListBrief),
      suppressionLists: (email.suppression_lists ?? []).map(toListBrief),
      // Dropped, the two empty arrays above are indistinguishable from a send that genuinely
      // targeted nothing — so a HubSpot read failure rendered as "None recorded".
      ...(email.lists_unavailable === true ? { listsUnavailable: true } : {}),
    }));
  }

  public async getExistingMasterLists(req: Request, projectSlug: string, brandShort: string, eventName: string): Promise<AudienceMasterListBrief[]> {
    const wire = await this.get<{ lists?: WireMasterListBrief[] }>(req, projectSlug, 'existing-master-lists', {
      event_name: eventName,
      ...(brandShort === '' ? {} : { brand_short: brandShort }),
    });

    return (wire.lists ?? []).map((list) => ({
      listId: list.list_id,
      name: list.name,
      size: list.size,
      hubspotUrl: list.hubspot_url,
    }));
  }

  public async previewCount(req: Request, projectSlug: string, listIds: string[]): Promise<AudiencePreviewCount> {
    const wire = await this.post<WirePreviewCount>(req, projectSlug, 'preview-count', { list_ids: listIds });
    return {
      exact: wire.exact === true,
      estimate: wire.estimate ?? 0,
      count: wire.count ?? 0,
      reason: wire.reason ?? '',
    };
  }

  /**
   * Creates the combined suppression list and then the master list, upstream.
   *
   * `eventUrl` on the request is dropped deliberately: upstream's compose input takes the
   * REVIEWED naming inputs (`brand_short`, `event_name`, `event_dates`) and no URL, because the
   * name must reflect what the operator saw on screen rather than being re-derived from a page
   * fetch this call would have to repeat.
   */
  public async composeMaster(req: Request, projectSlug: string, request: AudienceComposeMasterRequest): Promise<AudienceComposeMasterResult> {
    const compose = {
      list_ids: request.listIds,
      ...(request.excludeListIds?.length ? { exclude_list_ids: request.excludeListIds } : {}),
      ...(request.name ? { name: request.name } : {}),
      ...(request.brandShort ? { brand_short: request.brandShort } : {}),
      ...(request.eventName ? { event_name: request.eventName } : {}),
      ...(request.eventDates?.length ? { event_dates: request.eventDates } : {}),
      // Forwarded only when set. Sending `brief_id: ''` is NOT the same request: upstream reads a
      // present-but-empty id as an attach that then fails its own brief lookup, turning the
      // exploratory compose the builder is designed for into a 404 — after refusing to create
      // anything.
      ...(request.briefId ? { brief_id: request.briefId } : {}),
    };

    try {
      const wire = await this.post<WireComposeMasterResult>(req, projectSlug, 'compose-master', { compose });
      // Validated before it is reported as a success: this is a non-idempotent create, and a
      // rewritten `{ master: {}, source_list_ids: [] }` would render "Master list created" over
      // a list id the operator cannot act on.
      // toComposedList validates every identifying field of BOTH lists — the suppression object
      // was previously passed through unchecked beside a validated master.
      // `recorded` defaults to FALSE, and the default is the whole point of reading it separately
      // from `audience`. Goa's decoder ignores unknown body fields, so an upstream deployed before
      // this feature accepts the request, composes normally and returns neither field — which must
      // degrade to today's unattached behaviour, not to a UI claiming the send is wired up.
      const recorded = wire.recorded === true;
      return {
        master: toCreatedList(required(wire.master, 'master'), 'master'),
        suppression: wire.suppression ? toCreatedList(wire.suppression, 'suppression') : undefined,
        sourceListIds: required(wire.source_list_ids, 'source_list_ids'),
        recorded,
        // Validated with `required` exactly as `master` is, and for the same reason: this is the
        // object the UI reads to say "attached". A rewritten `audience: {}` beside `recorded: true`
        // would render an attachment over a row the operator cannot address.
        audience: recorded ? toRecordedAudience(required(wire.audience, 'audience'), request.briefId ?? '') : undefined,
      };
    } catch (error) {
      const partial = asComposePartial(error);
      if (partial) {
        throw new AudienceComposePartialError(
          // The old default described only the one shape that carries a confirmed suppression
          // list; four of the five reachable shapes do not, so it stated the wrong thing for
          // most of them. The generic default is correct for all five and upstream's own
          // message is preferred whenever it sends one.
          partial.message?.trim() || 'The compose did not complete. Some lists may already exist in HubSpot.',
          // Truthiness is not enough now that the discriminator admits bodies without a
          // confirmed suppression: forwarding an object whose `list_id` is missing or blank
          // makes the banner render a HubSpot link for a create that was never confirmed —
          // reintroducing, one layer up, exactly the false certainty this widening removed.
          confirmedWireList(partial.suppression) ? toComposedList(partial.suppression) : undefined,
          partial.suppression_name?.trim() || undefined,
          partial.master_name?.trim() || undefined,
          // Same id check as the suppression above, for the same reason — and it matters more
          // here: this is the shape whose whole message is "the master EXISTS, attach it by
          // hand", so a blank id would send the operator looking for a list that was never
          // confirmed to exist.
          confirmedWireList(partial.master) ? toComposedList(partial.master) : undefined
        );
      }
      throw error;
    }
  }

  public async runQa(req: Request, projectSlug: string, request: AudienceQaRunRequest): Promise<AudienceQaResult> {
    const wire = await this.post<WireQaResult>(req, projectSlug, 'qa/run', {
      list_ref: request.listRef,
      targets_eu: request.targetsEu === true,
      targets_ca: request.targetsCa === true,
    });
    return narrowQaResult(wire);
  }

  /**
   * The project-scoped path every endpoint hangs off.
   *
   * An empty slug is refused rather than sent, for the reason every sibling proxy method refuses
   * it: `/projects//audience-builder/...` is a DIFFERENT route that 404s at the gateway, and a
   * gateway 404 is not the service saying "no such project".
   */
  private path(projectSlug: string, suffix: string): string {
    if (projectSlug === '') {
      throw new Error('An audience-builder request requires the project it is scoped to.');
    }
    return `/projects/${encodeURIComponent(projectSlug)}/audience-builder/${suffix}`;
  }

  /**
   * Records EXISTING lists as the brief's send audience. Creates nothing in HubSpot, so unlike
   * compose it has no partial state and every failure is safe to retry.
   */
  public async attachExisting(req: Request, projectSlug: string, request: AudienceAttachExistingRequest): Promise<AudienceAttachExistingResult> {
    const attach = {
      brief_id: request.briefId,
      master_list_id: request.masterListId,
      ...(request.suppressionListIds?.length ? { suppression_list_ids: request.suppressionListIds } : {}),
      ...(request.inclusionSummary ? { inclusion_summary: request.inclusionSummary } : {}),
    };
    const wire = await this.post<WireAttachExistingResult>(req, projectSlug, 'attach-existing', { attach });
    return {
      master: toCreatedList(required(wire.master, 'master'), 'master'),
      suppressionListIds: required(wire.suppression_list_ids, 'suppression_list_ids'),
      audience: toRecordedAudience(required(wire.audience, 'audience'), request.briefId),
    };
  }

  private get<T>(req: Request, projectSlug: string, suffix: string, query?: Record<string, unknown>): Promise<T> {
    // Query params go in the FIFTH argument. `proxyRequest(req, service, path, method, query,
    // data)` — passing them sixth would send them as a body, which a GET discards. The eighth
    // carries the raised timeout every audience-builder call needs — see `timeout()` below.
    return this.microserviceProxy.proxyRequest<T>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      this.path(projectSlug, suffix),
      'GET',
      query,
      undefined,
      undefined,
      timeout()
    );
  }

  private post<T>(req: Request, projectSlug: string, suffix: string, body: unknown): Promise<T> {
    return this.microserviceProxy.proxyRequest<T>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      this.path(projectSlug, suffix),
      'POST',
      undefined,
      body,
      undefined,
      timeout()
    );
  }
}

/**
 * The per-request options every audience-builder call carries.
 *
 * A function rather than a shared const so no caller can mutate the options object out from
 * under the others. See AUDIENCE_BUILDER_REQUEST_TIMEOUT_MS for why 30s was not enough.
 */
function timeout(): { timeoutMs: number } {
  return { timeoutMs: AUDIENCE_BUILDER_REQUEST_TIMEOUT_MS };
}

/**
 * The `ComposePartial` body, when this error is one.
 *
 * Upstream maps BOTH `ComposePartial` and its ordinary `InternalServerError` to 500 and tells
 * them apart with a `goa-error` response header, which `MicroserviceError` does not carry. The
 * body does: only `ComposePartial` has a `suppression` object, and the Go handler populates it
 * unconditionally (`partial.Suppression` is a value, not a pointer), so its presence is a sound
 * discriminator. A 500 without it is an ordinary failure and is rethrown.
 */
/**
 * Does this wire object describe a list whose creation was CONFIRMED?
 *
 * Trimmed, not merely non-empty. A `list_id` of `'  '` survives a length check and then reaches
 * the operator as a HubSpot link to nothing — the same unconfirmed-create-rendered-as-real bug the
 * length check was added to close, through a narrower door. One predicate rather than a copy per
 * arm, because two copies of this rule is how one of them ends up admitting a blank id.
 */
function confirmedWireList(list: WireComposedList | undefined): list is WireComposedList {
  return list !== undefined && list !== null && typeof list.list_id === 'string' && list.list_id.trim().length > 0;
}

function asComposePartial(error: unknown): WireComposePartialError | null {
  if (!(error instanceof MicroserviceError) || error.statusCode !== 500) return null;

  const body = error.errorBody as WireComposePartialError | undefined;
  if (!body || typeof body !== 'object') return null;

  // Four shapes are reachable (`docs/api-catalog.md`), and only ONE carries a confirmed
  // `suppression.list_id`. Keying on that field alone rethrew the other three as ordinary
  // failures, losing the deterministic NAMES the operator needs to find lists that may already
  // exist in the portal — on a create path that is explicitly not idempotent, where a blind
  // retry either collides on a duplicate name or leaves a second list behind.
  const hasSuppression = !!body.suppression && typeof body.suppression.list_id === 'string';
  const hasSuppressionName = typeof body.suppression_name === 'string' && body.suppression_name.length > 0;
  const hasMasterName = typeof body.master_name === 'string' && body.master_name.length > 0;
  // The fifth shape: both lists created, the attach to the brief failed. It carries a confirmed
  // `master` and no `master_name`, so without this arm it fell through to an ordinary 500 — and
  // a 500 on a non-idempotent create is exactly the prompt to retry that would mint a second
  // master list for one send.
  const hasMaster = !!body.master && typeof body.master.list_id === 'string' && body.master.list_id.length > 0;
  if (!hasSuppression && !hasSuppressionName && !hasMasterName && !hasMaster) return null;

  return body;
}
