// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CreateNewsletterDraftRequest,
  Newsletter,
  NewsletterAnalytics,
  NewsletterContextType,
  NewsletterDraftListResponse,
  NewsletterListParams,
  NewsletterListResponse,
  NewsletterRecipientCount,
  NewsletterRecipientCountPayload,
  NewsletterRecipientsResponse,
  NewsletterSendPayload,
  NewsletterSendResult,
  NewsletterTestSendPayload,
  UpdateNewsletterDraftRequest,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Typed HTTP client for the lfx-v2-newsletter-service backend. Forwards the
 * user's bearer token via the shared MicroserviceProxyService so the Go service
 * can enforce per-user authorization.
 */
export class NewsletterServiceClient {
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();

  public async createDraft(req: Request, payload: CreateNewsletterDraftRequest): Promise<Newsletter> {
    return this.microserviceProxy.proxyRequest<Newsletter>(req, 'LFX_V2_SERVICE', '/newsletters/drafts', 'POST', undefined, payload, this.edNameHeader(req));
  }

  public async getDraft(req: Request, id: string): Promise<Newsletter> {
    return this.microserviceProxy.proxyRequest<Newsletter>(req, 'LFX_V2_SERVICE', `/newsletters/drafts/${id}`, 'GET');
  }

  public async listDrafts(req: Request, contextType: NewsletterContextType, contextUid: string): Promise<NewsletterDraftListResponse> {
    return this.microserviceProxy.proxyRequest<NewsletterDraftListResponse>(req, 'LFX_V2_SERVICE', '/newsletters/drafts', 'GET', {
      contextType,
      contextUid,
    });
  }

  public async updateDraft(req: Request, id: string, ifMatchVersion: number, payload: UpdateNewsletterDraftRequest): Promise<Newsletter> {
    return this.microserviceProxy.proxyRequest<Newsletter>(req, 'LFX_V2_SERVICE', `/newsletters/drafts/${id}`, 'PUT', undefined, payload, {
      ...this.edNameHeader(req),
      'If-Match': `"${ifMatchVersion}"`,
    });
  }

  public async deleteDraft(req: Request, id: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/newsletters/drafts/${id}`, 'DELETE');
  }

  public async sendDraft(req: Request, id: string, ifMatchVersion: number): Promise<NewsletterSendResult> {
    return this.microserviceProxy.proxyRequest<NewsletterSendResult>(req, 'LFX_V2_SERVICE', `/newsletters/drafts/${id}/send`, 'POST', undefined, undefined, {
      ...this.edNameHeader(req),
      'If-Match': `"${ifMatchVersion}"`,
    });
  }

  public async getRecipientCount(req: Request, payload: NewsletterRecipientCountPayload): Promise<NewsletterRecipientCount> {
    return this.microserviceProxy.proxyRequest<NewsletterRecipientCount>(req, 'LFX_V2_SERVICE', '/newsletters/recipient-count', 'POST', undefined, payload);
  }

  public async getRecipients(req: Request, payload: NewsletterRecipientCountPayload): Promise<NewsletterRecipientsResponse> {
    return this.microserviceProxy.proxyRequest<NewsletterRecipientsResponse>(req, 'LFX_V2_SERVICE', '/newsletters/recipients', 'POST', undefined, payload);
  }

  public async testSend(req: Request, payload: NewsletterTestSendPayload): Promise<{ ok: true }> {
    return this.microserviceProxy.proxyRequest<{ ok: true }>(
      req,
      'LFX_V2_SERVICE',
      '/newsletters/test-send',
      'POST',
      undefined,
      payload,
      this.edNameHeader(req)
    );
  }

  public async send(req: Request, payload: NewsletterSendPayload): Promise<NewsletterSendResult> {
    return this.microserviceProxy.proxyRequest<NewsletterSendResult>(
      req,
      'LFX_V2_SERVICE',
      '/newsletters/send',
      'POST',
      undefined,
      payload,
      this.edNameHeader(req)
    );
  }

  public async listNewsletters(req: Request, params: NewsletterListParams): Promise<NewsletterListResponse> {
    const query: Record<string, string> = {
      contextType: params.contextType,
      contextUid: params.contextUid,
    };
    if (params.status) {
      query['status'] = params.status;
    }
    if (params.pageToken) {
      query['pageToken'] = params.pageToken;
    }
    return this.microserviceProxy.proxyRequest<NewsletterListResponse>(req, 'LFX_V2_SERVICE', '/newsletters', 'GET', query);
  }

  public async getAnalytics(req: Request, id: string): Promise<NewsletterAnalytics> {
    // Path intentionally not /newsletters/{id}/analytics — Go's mux treats that
    // as ambiguous with /newsletters/drafts/{id}.
    return this.microserviceProxy.proxyRequest<NewsletterAnalytics>(req, 'LFX_V2_SERVICE', `/newsletter-analytics/${id}`, 'GET');
  }

  /**
   * Forwards the ED display name from the inbound Auth0 session so the Go
   * service can stamp emails without needing access to the LFX user store.
   */
  private edNameHeader(req: Request): Record<string, string> {
    const user = req.oidc?.user;
    const name = (user?.['name'] as string) || (user?.['nickname'] as string) || (user?.['email'] as string) || '';
    if (!name) {
      return {};
    }
    return { 'X-User-Name': String(name) };
  }
}
