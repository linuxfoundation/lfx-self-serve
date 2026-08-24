// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CreatePublicationRequest,
  NewsletterPublication,
  NewsletterPublicationListParams,
  NewsletterPublicationListResponse,
  UpdatePublicationRequest,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Typed HTTP client for the lfx-v2-newsletter-service publication endpoints.
 *
 * Publications are project-scoped. The Express layer is a thin proxy — the Go
 * service owns publication persistence and the relationship between publications
 * and editions (newsletters).
 */
export class NewsletterPublicationsServiceClient {
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();

  public async createPublication(req: Request, projectUid: string, payload: CreatePublicationRequest): Promise<NewsletterPublication> {
    return this.microserviceProxy.proxyRequest<NewsletterPublication>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletter-publications`,
      'POST',
      undefined,
      payload
    );
  }

  /**
   * The upstream list is paginated and caps the page size, so `page_token` and
   * `page_size` are forwarded and `next_page_token` is returned to the caller.
   */
  public async listPublications(req: Request, projectUid: string, params: NewsletterPublicationListParams = {}): Promise<NewsletterPublicationListResponse> {
    const query: Record<string, string> = {};
    if (params.page_token) {
      query['page_token'] = params.page_token;
    }
    if (params.page_size) {
      query['page_size'] = String(params.page_size);
    }
    return this.microserviceProxy.proxyRequest<NewsletterPublicationListResponse>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletter-publications`,
      'GET',
      Object.keys(query).length ? query : undefined
    );
  }

  public async getPublication(req: Request, projectUid: string, publicationUid: string): Promise<NewsletterPublication> {
    return this.microserviceProxy.proxyRequest<NewsletterPublication>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletter-publications/${publicationUid}`,
      'GET'
    );
  }

  public async updatePublication(
    req: Request,
    projectUid: string,
    publicationUid: string,
    ifMatchVersion: number,
    payload: UpdatePublicationRequest
  ): Promise<NewsletterPublication> {
    return this.microserviceProxy.proxyRequest<NewsletterPublication>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletter-publications/${publicationUid}`,
      'PUT',
      undefined,
      payload,
      {
        'If-Match': `"${ifMatchVersion}"`,
      }
    );
  }
}
