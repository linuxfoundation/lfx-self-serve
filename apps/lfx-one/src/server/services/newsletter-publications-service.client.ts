// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CreatePublicationRequest,
  NewsletterPublication,
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

  public async listPublications(req: Request, projectUid: string): Promise<NewsletterPublicationListResponse> {
    return this.microserviceProxy.proxyRequest<NewsletterPublicationListResponse>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletter-publications`,
      'GET'
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

  public async listPublicationEditions(req: Request, projectUid: string, publicationUid: string): Promise<NewsletterPublicationListResponse> {
    return this.microserviceProxy.proxyRequest<NewsletterPublicationListResponse>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectUid}/newsletter-publications/${publicationUid}/editions`,
      'GET'
    );
  }
}
