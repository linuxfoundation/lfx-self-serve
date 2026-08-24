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

import { NewsletterPublicationsServiceClient } from './newsletter-publications-service.client';

/**
 * Thin pass-through layer in front of NewsletterPublicationsServiceClient.
 *
 * Express no longer owns any publication business logic — the Go service
 * (`lfx-v2-newsletter-service`) handles publication persistence and the
 * relationship between publications and editions. This service exists to give
 * the controller a single collaborator type.
 */
export class NewsletterPublicationsService {
  private readonly publicationsClient: NewsletterPublicationsServiceClient;

  public constructor(publicationsClient?: NewsletterPublicationsServiceClient) {
    this.publicationsClient = publicationsClient ?? new NewsletterPublicationsServiceClient();
  }

  public createPublication(req: Request, projectUid: string, payload: CreatePublicationRequest): Promise<NewsletterPublication> {
    return this.publicationsClient.createPublication(req, projectUid, payload);
  }

  public listPublications(req: Request, projectUid: string, params: NewsletterPublicationListParams = {}): Promise<NewsletterPublicationListResponse> {
    return this.publicationsClient.listPublications(req, projectUid, params);
  }

  public getPublication(req: Request, projectUid: string, publicationUid: string): Promise<NewsletterPublication> {
    return this.publicationsClient.getPublication(req, projectUid, publicationUid);
  }

  public updatePublication(
    req: Request,
    projectUid: string,
    publicationUid: string,
    ifMatchVersion: number,
    payload: UpdatePublicationRequest
  ): Promise<NewsletterPublication> {
    return this.publicationsClient.updatePublication(req, projectUid, publicationUid, ifMatchVersion, payload);
  }
}
