// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CHANGELOG_CONFIG } from '@lfx-one/shared/constants';
import { ChangelogViewMarkViewedResponse, ChangelogViewUnseenResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { getEffectiveSub } from '../utils/auth-helper';
import { logger } from './logger.service';

export class ChangelogService {
  // Resolved lazily on first access so dotenv has finished loading, then memoized.
  private _apiUrl: string | undefined;
  private _apiKey: string | undefined;
  private _productId: string | undefined;

  private static readonly errorBodyPreviewLimit = 200;

  private get apiUrl(): string {
    return (this._apiUrl ??= (process.env['CHANGELOG_API_URL'] || CHANGELOG_CONFIG.DEFAULT_API_URL).replace(/\/+$/, ''));
  }

  private get apiKey(): string {
    return (this._apiKey ??= process.env['CHANGELOG_API_KEY'] || '');
  }

  private get productId(): string {
    return (this._productId ??= process.env['CHANGELOG_PRODUCT_ID'] || '');
  }

  public async getUnseenCount(req: Request): Promise<ChangelogViewUnseenResponse> {
    this.assertConfigured('get_changelog_unseen');

    const viewerId = getEffectiveSub(req);
    if (!viewerId) {
      throw new MicroserviceError('User authentication required', 401, 'CHANGELOG_UNAUTHENTICATED', {
        operation: 'get_changelog_unseen',
        service: 'changelog_service',
      });
    }

    const url = new URL(CHANGELOG_CONFIG.ENDPOINTS.UNSEEN, this.apiUrl);
    url.searchParams.set('viewerId', viewerId);
    url.searchParams.set('productId', this.productId);

    logger.debug(req, 'get_changelog_unseen', 'Fetching unseen changelog count', { product_id: this.productId });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new MicroserviceError(`Changelog unseen request failed: ${response.statusText}`, response.status, 'CHANGELOG_UNSEEN_ERROR', {
        operation: 'get_changelog_unseen',
        service: 'changelog_service',
        errorBody: await this.previewErrorBody(response),
      });
    }

    return this.parseJson<ChangelogViewUnseenResponse>(response, 'get_changelog_unseen', 'CHANGELOG_UNSEEN_ERROR');
  }

  public async markViewed(req: Request): Promise<ChangelogViewMarkViewedResponse> {
    this.assertConfigured('mark_changelog_viewed');

    const viewerId = getEffectiveSub(req);
    if (!viewerId) {
      throw new MicroserviceError('User authentication required', 401, 'CHANGELOG_UNAUTHENTICATED', {
        operation: 'mark_changelog_viewed',
        service: 'changelog_service',
      });
    }

    const url = new URL(CHANGELOG_CONFIG.ENDPOINTS.MARK_VIEWED, this.apiUrl).toString();

    logger.debug(req, 'mark_changelog_viewed', 'Marking changelog as viewed', { product_id: this.productId });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ viewerId, productId: this.productId }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new MicroserviceError(`Changelog mark-viewed request failed: ${response.statusText}`, response.status, 'CHANGELOG_MARK_VIEWED_ERROR', {
        operation: 'mark_changelog_viewed',
        service: 'changelog_service',
        errorBody: await this.previewErrorBody(response),
      });
    }

    return this.parseJson<ChangelogViewMarkViewedResponse>(response, 'mark_changelog_viewed', 'CHANGELOG_MARK_VIEWED_ERROR');
  }

  // Short-circuit when env vars are missing so misconfigured deployments fail fast with a clear error
  // instead of generating noisy 401/400 logs from upstream calls with empty bearer tokens.
  private assertConfigured(operation: string): void {
    const missing: string[] = [];
    if (!this.apiKey) missing.push('CHANGELOG_API_KEY');
    if (!this.productId) missing.push('CHANGELOG_PRODUCT_ID');
    if (missing.length === 0) return;

    throw new MicroserviceError(`Changelog API not configured (missing: ${missing.join(', ')})`, 503, 'CHANGELOG_NOT_CONFIGURED', {
      operation,
      service: 'changelog_service',
    });
  }

  // Guard against HTML responses (SPA fallback, auth challenge) so callers see a clear error instead of a JSON.parse failure.
  private async parseJson<T>(response: Response, operation: string, code: string): Promise<T> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new MicroserviceError(`Changelog API returned non-JSON response (content-type: ${contentType || 'unknown'})`, 502, code, {
        operation,
        service: 'changelog_service',
        errorBody: await this.previewErrorBody(response),
      });
    }
    return (await response.json()) as T;
  }

  private async previewErrorBody(response: Response): Promise<string> {
    return (await response.text()).slice(0, ChangelogService.errorBodyPreviewLimit);
  }
}
