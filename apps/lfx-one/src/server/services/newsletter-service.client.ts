// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_SEND_TIMEOUT_MS } from '@lfx-one/shared/constants';
import {
  CreateNewsletterRequest,
  Newsletter,
  NewsletterAnalytics,
  NewsletterListParams,
  NewsletterListResponse,
  NewsletterOptOutListResponse,
  NewsletterRecipientCount,
  NewsletterRecipientCountPayload,
  NewsletterRecipientsResponse,
  NewsletterSendResult,
  NewsletterTestSendPayload,
  UpdateNewsletterRequest,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Typed HTTP client for the lfx-v2-newsletter-service backend.
 *
 * All endpoints are project-scoped. The Express layer is a thin proxy — the Go
 * service owns recipient resolution (via NATS to lfx-v2-committee-service),
 * email-chrome rendering, per-recipient fan-out to lfx-v2-email-service, and
 * analytics aggregation. The UI no longer mints group_id, talks to
 * email-service, or computes engagement.
 */
export class NewsletterServiceClient {
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();

  public async createNewsletter(req: Request, projectUid: string, payload: CreateNewsletterRequest): Promise<Newsletter> {
    return this.microserviceProxy.proxyRequest<Newsletter>(req, 'LFX_V2_SERVICE', `/projects/${projectUid}/newsletters`, 'POST', undefined, payload);
  }

  public async getNewsletter(req: Request, projectUid: string, newsletterUid: string): Promise<Newsletter> {
    return this.microserviceProxy.proxyRequest<Newsletter>(req, 'LFX_V2_SERVICE', `/projects/${projectUid}/newsletters/${newsletterUid}`, 'GET');
  }

  public async listNewsletters(req: Request, projectUid: string, params: NewsletterListParams): Promise<NewsletterListResponse> {
    const query: Record<string, string> = {};
    if (params.status) {
      query['status'] = params.status;
    }
    if (params.page_token) {
      query['page_token'] = params.page_token;
    }
    return this.microserviceProxy.proxyRequest<NewsletterListResponse>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletters`,
      'GET',
      Object.keys(query).length ? query : undefined
    );
  }

  public async updateNewsletter(
    req: Request,
    projectUid: string,
    newsletterUid: string,
    ifMatchVersion: number,
    payload: UpdateNewsletterRequest
  ): Promise<Newsletter> {
    return this.microserviceProxy.proxyRequest<Newsletter>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletters/${newsletterUid}`,
      'PUT',
      undefined,
      payload,
      {
        'If-Match': `"${ifMatchVersion}"`,
      }
    );
  }

  public async deleteNewsletter(req: Request, projectUid: string, newsletterUid: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/projects/${projectUid}/newsletters/${newsletterUid}`, 'DELETE');
  }

  /**
   * Send a previously-saved newsletter draft. The Go service transitions the
   * draft to status='sending' (202) and completes the per-recipient fan-out in
   * a detached background job — callers branch on `newsletter.status` in the
   * response body. The sender's display name is resolved server-side from the
   * signed JWT principal via the auth-service NATS lookup — Express forwards
   * only the bearer token and the If-Match version. The extended per-request
   * timeout covers pre-async upstream deployments whose synchronous fan-out
   * can exceed the client's 30s default (LFXV2-2604).
   */
  public async sendNewsletter(req: Request, projectUid: string, newsletterUid: string, ifMatchVersion: number): Promise<NewsletterSendResult> {
    return this.microserviceProxy.proxyRequest<NewsletterSendResult>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletters/${newsletterUid}/send`,
      'POST',
      undefined,
      {},
      { 'If-Match': `"${ifMatchVersion}"` },
      { timeoutMs: NEWSLETTER_SEND_TIMEOUT_MS }
    );
  }

  public async recipientCount(req: Request, projectUid: string, payload: NewsletterRecipientCountPayload): Promise<NewsletterRecipientCount> {
    return this.microserviceProxy.proxyRequest<NewsletterRecipientCount>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletters/recipient-count`,
      'POST',
      undefined,
      payload
    );
  }

  public async recipients(req: Request, projectUid: string, payload: NewsletterRecipientCountPayload): Promise<NewsletterRecipientsResponse> {
    return this.microserviceProxy.proxyRequest<NewsletterRecipientsResponse>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletters/recipients`,
      'POST',
      undefined,
      payload
    );
  }

  public async testSend(req: Request, projectUid: string, payload: NewsletterTestSendPayload): Promise<{ ok: boolean }> {
    return this.microserviceProxy.proxyRequest<{ ok: boolean }>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletters/test-send`,
      'POST',
      undefined,
      payload
    );
  }

  public async getAnalytics(req: Request, projectUid: string, newsletterUid: string): Promise<NewsletterAnalytics> {
    return this.microserviceProxy.proxyRequest<NewsletterAnalytics>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletters/${newsletterUid}/analytics`,
      'GET'
    );
  }

  public async listOptOuts(req: Request, projectUid: string): Promise<NewsletterOptOutListResponse> {
    return this.microserviceProxy.proxyRequest<NewsletterOptOutListResponse>(req, 'LFX_V2_SERVICE', `/projects/${projectUid}/newsletter-opt-outs`, 'GET');
  }

  public async deleteOptOut(req: Request, projectUid: string, optOutId: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/projects/${projectUid}/newsletter-opt-outs/${optOutId}`, 'DELETE');
  }
}
