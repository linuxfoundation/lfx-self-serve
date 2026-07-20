// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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

import { NewsletterServiceClient } from './newsletter-service.client';

/**
 * Thin pass-through layer in front of NewsletterServiceClient.
 *
 * Express no longer owns any newsletter business logic — the Go service
 * (`lfx-v2-newsletter-service`) handles recipient resolution, email-chrome
 * rendering, per-recipient fan-out via NATS to lfx-v2-email-service, and
 * analytics aggregation. This service exists to give the controller a single
 * collaborator type and to leave room for any UI-side normalization that
 * doesn't belong on the wire (none currently).
 */
export class NewsletterService {
  private readonly newsletterClient: NewsletterServiceClient;

  public constructor(newsletterClient?: NewsletterServiceClient) {
    this.newsletterClient = newsletterClient ?? new NewsletterServiceClient();
  }

  public createNewsletter(req: Request, projectUid: string, payload: CreateNewsletterRequest): Promise<Newsletter> {
    return this.newsletterClient.createNewsletter(req, projectUid, payload);
  }

  public getNewsletter(req: Request, projectUid: string, newsletterUid: string): Promise<Newsletter> {
    return this.newsletterClient.getNewsletter(req, projectUid, newsletterUid);
  }

  public listNewsletters(req: Request, projectUid: string, params: NewsletterListParams): Promise<NewsletterListResponse> {
    return this.newsletterClient.listNewsletters(req, projectUid, params);
  }

  public updateNewsletter(
    req: Request,
    projectUid: string,
    newsletterUid: string,
    ifMatchVersion: number,
    payload: UpdateNewsletterRequest
  ): Promise<Newsletter> {
    return this.newsletterClient.updateNewsletter(req, projectUid, newsletterUid, ifMatchVersion, payload);
  }

  public deleteNewsletter(req: Request, projectUid: string, newsletterUid: string): Promise<void> {
    return this.newsletterClient.deleteNewsletter(req, projectUid, newsletterUid);
  }

  public sendNewsletter(req: Request, projectUid: string, newsletterUid: string, ifMatchVersion: number): Promise<NewsletterSendResult> {
    return this.newsletterClient.sendNewsletter(req, projectUid, newsletterUid, ifMatchVersion);
  }

  public recipientCount(req: Request, projectUid: string, payload: NewsletterRecipientCountPayload): Promise<NewsletterRecipientCount> {
    return this.newsletterClient.recipientCount(req, projectUid, payload);
  }

  public recipients(req: Request, projectUid: string, payload: NewsletterRecipientCountPayload): Promise<NewsletterRecipientsResponse> {
    return this.newsletterClient.recipients(req, projectUid, payload);
  }

  public testSend(req: Request, projectUid: string, payload: NewsletterTestSendPayload): Promise<{ ok: boolean }> {
    return this.newsletterClient.testSend(req, projectUid, payload);
  }

  public getAnalytics(req: Request, projectUid: string, newsletterUid: string): Promise<NewsletterAnalytics> {
    return this.newsletterClient.getAnalytics(req, projectUid, newsletterUid);
  }

  public listOptOuts(req: Request, projectUid: string): Promise<NewsletterOptOutListResponse> {
    return this.newsletterClient.listOptOuts(req, projectUid);
  }
}
