// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_QUERY_PARAMS } from '@lfx-one/shared/constants';
import { ApiRequestOptions, ApiResponse, MicroserviceUrls } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { ApiClientService } from './api-client.service';

export class MicroserviceProxyService {
  private apiClient: ApiClientService = new ApiClientService();

  public async proxyRequest<T>(
    req: Request,
    service: keyof MicroserviceUrls,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    query?: Record<string, any>,
    data?: any,
    customHeaders?: Record<string, string>,
    options?: ApiRequestOptions
  ): Promise<T> {
    const operation = `${method.toLowerCase()}_${path.replace(/\//g, '_')}`;

    try {
      const baseUrl = this.resolveBaseUrl(service);
      const endpoint = this.buildEndpoint(baseUrl, path);
      // options.bearerToken lets callers fan out parallel requests with different identities
      // (e.g. user token for FGA checks alongside M2M for public data) without mutating the
      // shared req.bearerToken field — which would race across the parallel calls.
      const token = options?.bearerToken ?? req.bearerToken;

      // Merge query parameters with defaults taking precedence
      // This ensures that default params cannot be overridden by the caller
      const mergedQuery = { ...query, ...DEFAULT_QUERY_PARAMS };

      const response = await this.apiClient.request<T>(method, endpoint, token, mergedQuery, data, customHeaders, options);
      return response.data;
    } catch (error: any) {
      // Transform HTTP errors from API client into MicroserviceError
      if (error.status && error.code) {
        throw MicroserviceError.fromMicroserviceResponse(error.status, error.message, error.errorBody, service, path, operation);
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  public async proxyRequestWithResponse<T>(
    req: Request,
    service: keyof MicroserviceUrls,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    query?: Record<string, any>,
    data?: any,
    customHeaders?: Record<string, string>,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<T>> {
    const operation = `${method.toLowerCase()}_${path.replace(/\//g, '_')}`;

    try {
      const baseUrl = this.resolveBaseUrl(service);
      const endpoint = this.buildEndpoint(baseUrl, path);
      // See proxyRequest above — options.bearerToken opts out of req.bearerToken for parallel-safe calls.
      const token = options?.bearerToken ?? req.bearerToken;

      // Merge query parameters with defaults taking precedence
      // This ensures that default params cannot be overridden by the caller
      const mergedQuery = { ...query, ...DEFAULT_QUERY_PARAMS };

      const response = await this.apiClient.request<T>(method, endpoint, token, mergedQuery, data, customHeaders, options);
      return response;
    } catch (error: any) {
      // Transform HTTP errors from API client into MicroserviceError
      if (error.status && error.code) {
        throw MicroserviceError.fromMicroserviceResponse(error.status, error.message, error.errorBody, service, path, operation);
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  /**
   * Proxy a binary request to a microservice that returns a Buffer
   * @param req Express request object
   * @param service Microservice identifier
   * @param path API path
   * @param method HTTP method (defaults to GET)
   * @param query Query parameters
   * @param customHeaders Custom headers
   * @returns Promise with Buffer data
   */
  public async proxyBinaryRequest(
    req: Request,
    service: keyof MicroserviceUrls,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    query?: Record<string, any>,
    customHeaders?: Record<string, string>
  ): Promise<Buffer> {
    const operation = `${method.toLowerCase()}_${path.replace(/\//g, '_')}`;

    try {
      const baseUrl = this.resolveBaseUrl(service);
      const endpoint = this.buildEndpoint(baseUrl, path);
      const token = req.bearerToken;

      // Merge query parameters with defaults taking precedence
      // This ensures that default params cannot be overridden by the caller
      const mergedQuery = { ...query, ...DEFAULT_QUERY_PARAMS };

      const response = await this.apiClient.binaryRequest(method, endpoint, token, mergedQuery, customHeaders);
      return response.data;
    } catch (error: any) {
      // Transform HTTP errors from API client into MicroserviceError
      if (error.status && error.code) {
        throw MicroserviceError.fromMicroserviceResponse(error.status, error.message, error.errorBody, service, path, operation);
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  /**
   * Proxy a streaming request to a microservice. Returns the raw fetch Response
   * so the caller can pipe `response.body` directly to an Express response,
   * avoiding the memory pressure of buffering the whole payload (important for
   * large file downloads under concurrent load).
   *
   * Use this instead of `proxyBinaryRequest` whenever the caller can stream
   * straight through to the client.
   */
  public async proxyStreamRequest(
    req: Request,
    service: keyof MicroserviceUrls,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    query?: Record<string, any>,
    customHeaders?: Record<string, string>,
    /** Only `timeoutMs` is read; it bounds the whole transfer, body included. */
    options?: Pick<ApiRequestOptions, 'timeoutMs'>
  ): Promise<Response> {
    const baseUrl = this.resolveBaseUrl(service);
    const endpoint = this.buildEndpoint(baseUrl, path);
    const token = req.bearerToken;

    const mergedQuery = { ...query, ...DEFAULT_QUERY_PARAMS };

    // ApiClientService.streamRequest already throws MicroserviceError with full context,
    // so no try/catch wrapping is needed here.
    return this.apiClient.streamRequest(method, endpoint, token, mergedQuery, customHeaders, options);
  }

  /**
   * Defense-in-depth against path traversal: every caller here builds `path` by interpolating
   * route params that should already be validated (e.g. as UUIDs), but a single missed call site
   * would otherwise let a crafted param retarget the upstream request — `fetch()` collapses `..`
   * dot-segments and a literal `?`/`#` in the string starts a new query/fragment, re-routing the
   * call to an arbitrary upstream path (linuxfoundation/lfx-self-serve-ops#434). Reject here so
   * that gap can't reopen even if an individual controller's own validation is incomplete.
   *
   * Dot segments are rejected only (not the full WHATWG `URL`-normalized pathname) because
   * several callers interpolate raw, unencoded values (e.g. `committee.service.ts`'s `inviteId`)
   * that legitimately contain characters (spaces, non-ASCII, `^`, backtick, `{`/`}`) the URL
   * parser re-encodes without that being an attack; comparing the full normalized pathname would
   * reject those as a local 400 instead of letting them reach upstream as before. But the segment
   * check itself must match what `fetch()`'s WHATWG URL parser actually treats as a dot segment:
   * per https://url.spec.whatwg.org/#double-dot-path-segment, `%2e` (any case) is equivalent to a
   * literal `.` — so `%2e%2e`, `.%2e`, `%2e.` all resolve the same as `..` — and `\` is treated as
   * `/` for special schemes (http/https), so a caller can smuggle a traversal segment past a
   * `/`-only split. The parser also strips every literal ASCII tab/newline character from the
   * input and trims leading/trailing literal C0 control/space characters from the whole URL
   * *before* it ever splits into segments (https://url.spec.whatwg.org/#concept-basic-url-parser,
   * steps 1-2) — it does not decode `%09`/`%20` first, so e.g. a literal tab between the dots
   * (`.<TAB>.`) or a trailing dot-segment padded with a literal space become real dot segments
   * even though neither is literally `.`/`..`. Detection here mirrors that preprocessing so it
   * can't be bypassed the same way. `isDotSegment` additionally strips `%09`/`%0a`/`%0d` text that
   * survives Express's single route-param decode (e.g. a double-encoded `%2509`) — that's
   * deliberate extra strictness, not something the URL parser itself does. A literal-only,
   * `/`-only check was flagged by multiple independent reviewers (dealako, Copilot, Cursor Bugbot,
   * Greptile) on PR #3511 as still bypassable via these vectors.
   */
  private buildEndpoint(baseUrl: string, path: string): string {
    if (path.includes('?') || path.includes('#')) {
      throw ServiceValidationError.forField('path', 'Upstream path must not contain a query string or fragment', {
        operation: 'proxy_build_endpoint',
        service: 'microservice_proxy_service',
      });
    }

    const isDotSegment = (segment: string): boolean => {
      const decoded = segment.replace(/%09|%0a|%0d/gi, '').replace(/%2e/gi, '.');
      return decoded === '.' || decoded === '..';
    };

    // Mirror the WHATWG URL parser's own preprocessing before splitting into segments: strip every
    // ASCII tab/newline anywhere, then trim leading/trailing C0 controls/space from the whole string.
    // Written with manual character scans rather than regexes -- CodeQL's polynomial-ReDoS query
    // (js/polynomial-redos) flags even a plain anchored `+` quantifier over a character class
    // (e.g. `/^[\x00-\x20]+/`) once it runs against attacker-controlled `path` input, so there is
    // no regex shape here left for it to flag.
    let stripped = '';
    for (let i = 0; i < path.length; i++) {
      const code = path.charCodeAt(i);
      if (code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        stripped += path[i];
      }
    }
    let start = 0;
    let end = stripped.length;
    while (start < end && stripped.charCodeAt(start) <= 0x20) start++;
    while (end > start && stripped.charCodeAt(end - 1) <= 0x20) end--;
    const normalized = stripped.slice(start, end);

    if (normalized.split(/[/\\]/).some(isDotSegment)) {
      throw ServiceValidationError.forField('path', 'Upstream path must not contain traversal segments', {
        operation: 'proxy_build_endpoint',
        service: 'microservice_proxy_service',
      });
    }

    return `${baseUrl}${path}`;
  }

  // Single source of truth for per-service base URLs. LFX_V2_MEMBER_SERVICE,
  // LFX_V2_COMMITTEE_SERVICE, LFX_V2_CAMPAIGN_SERVICE and LFX_V2_FORMATION_SERVICE fall back to
  // LFX_V2_SERVICE (the gateway) when unset.
  private resolveBaseUrl(service: keyof MicroserviceUrls): string {
    const urls: MicroserviceUrls = {
      LFX_V2_SERVICE: process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
      LFX_V2_MEMBER_SERVICE: process.env['LFX_V2_MEMBER_SERVICE'] || process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
      LFX_V2_COMMITTEE_SERVICE: process.env['LFX_V2_COMMITTEE_SERVICE'] || process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
      LFX_V2_CAMPAIGN_SERVICE: process.env['LFX_V2_CAMPAIGN_SERVICE'] || process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
      LFX_V2_FORMATION_SERVICE: process.env['LFX_V2_FORMATION_SERVICE'] || process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
    };
    // Strip trailing slashes so a config value like `https://host/` can't produce `host//path`.
    return urls[service].replace(/\/+$/, '');
  }
}
