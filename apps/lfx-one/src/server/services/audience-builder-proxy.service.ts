// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
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
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
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
}

interface WireLastSentEmail {
  email_id: string;
  email_name: string;
  sent_at?: string;
  hubspot_url: string;
  included_lists: WireListBrief[];
  suppression_lists: WireListBrief[];
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

  public constructor(message: string, suppression?: AudienceComposedList) {
    super(message);
    this.name = 'AudienceComposePartialError';
    this.suppression = suppression;
  }
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
    return { hubspotConfigured: wire.hubspot_configured === true };
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

    return (wire.lists ?? []).map((list) => ({
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
    };

    try {
      const wire = await this.post<WireComposeMasterResult>(req, projectSlug, 'compose-master', { compose });
      return {
        master: toComposedList(wire.master),
        suppression: wire.suppression ? toComposedList(wire.suppression) : undefined,
        sourceListIds: wire.source_list_ids ?? [],
      };
    } catch (error) {
      const partial = asComposePartial(error);
      if (partial) {
        throw new AudienceComposePartialError(
          partial.message?.trim() || 'The suppression list was created but the master list was not.',
          partial.suppression ? toComposedList(partial.suppression) : undefined
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

  private get<T>(req: Request, projectSlug: string, suffix: string, query?: Record<string, unknown>): Promise<T> {
    // Query params go in the FIFTH argument. `proxyRequest(req, service, path, method, query,
    // data)` — passing them sixth would send them as a body, which a GET discards.
    return this.microserviceProxy.proxyRequest<T>(req, 'LFX_V2_CAMPAIGN_SERVICE', this.path(projectSlug, suffix), 'GET', query);
  }

  private post<T>(req: Request, projectSlug: string, suffix: string, body: unknown): Promise<T> {
    return this.microserviceProxy.proxyRequest<T>(req, 'LFX_V2_CAMPAIGN_SERVICE', this.path(projectSlug, suffix), 'POST', undefined, body);
  }
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
function asComposePartial(error: unknown): WireComposePartialError | null {
  if (!(error instanceof MicroserviceError) || error.statusCode !== 500) return null;

  const body = error.errorBody as WireComposePartialError | undefined;
  if (!body || typeof body !== 'object') return null;
  if (!body.suppression || typeof body.suppression.list_id !== 'string') return null;

  return body;
}
