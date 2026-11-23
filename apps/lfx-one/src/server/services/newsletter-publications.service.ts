// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CreateNewsletterRequest,
  Newsletter,
  NewsletterListParams,
  NewsletterListResponse,
  NewsletterPublication,
  NewsletterPublicationListResponse,
  NewsletterPublicationRequest,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Thin proxy for lfx-v2-newsletter-service publications, using the caller's bearer token. The Go
 * service owns validation, template and reply-to rules, and edition inheritance.
 */
export class NewsletterPublicationsService {
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();

  public listPublications(req: Request, projectUid: string, pageToken?: string): Promise<NewsletterPublicationListResponse> {
    return this.microserviceProxy.proxyRequest<NewsletterPublicationListResponse>(
      req,
      'LFX_V2_SERVICE',
      this.collectionPath(projectUid),
      'GET',
      pageToken ? { page_token: pageToken } : undefined
    );
  }

  public createPublication(req: Request, projectUid: string, payload: NewsletterPublicationRequest): Promise<NewsletterPublication> {
    return this.microserviceProxy.proxyRequest<NewsletterPublication>(req, 'LFX_V2_SERVICE', this.collectionPath(projectUid), 'POST', undefined, payload);
  }

  public getPublication(req: Request, projectUid: string, publicationUid: string): Promise<NewsletterPublication> {
    return this.microserviceProxy.proxyRequest<NewsletterPublication>(req, 'LFX_V2_SERVICE', this.itemPath(projectUid, publicationUid), 'GET');
  }

  public updatePublication(
    req: Request,
    projectUid: string,
    publicationUid: string,
    ifMatchVersion: number,
    payload: NewsletterPublicationRequest
  ): Promise<NewsletterPublication> {
    return this.microserviceProxy.proxyRequest<NewsletterPublication>(
      req,
      'LFX_V2_SERVICE',
      this.itemPath(projectUid, publicationUid),
      'PUT',
      undefined,
      payload,
      { 'If-Match': `"${ifMatchVersion}"` }
    );
  }

  public listEditions(req: Request, projectUid: string, publicationUid: string, params: NewsletterListParams): Promise<NewsletterListResponse> {
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
      `${this.itemPath(projectUid, publicationUid)}/editions`,
      'GET',
      Object.keys(query).length ? query : undefined
    );
  }

  public createEdition(req: Request, projectUid: string, publicationUid: string, payload: Partial<CreateNewsletterRequest>): Promise<Newsletter> {
    return this.microserviceProxy.proxyRequest<Newsletter>(
      req,
      'LFX_V2_SERVICE',
      `${this.itemPath(projectUid, publicationUid)}/editions`,
      'POST',
      undefined,
      payload
    );
  }

  private collectionPath(projectUid: string): string {
    return `/projects/${encodeURIComponent(projectUid)}/newsletter-publications`;
  }

  private itemPath(projectUid: string, publicationUid: string): string {
    return `${this.collectionPath(projectUid)}/${encodeURIComponent(publicationUid)}`;
  }
}
