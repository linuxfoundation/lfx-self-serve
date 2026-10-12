// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { EmailServiceSendRequest, EmailServiceSendResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from './logger.service';
import { NatsService } from './nats.service';

/**
 * Transactional email through lfx-v2-email-service (`lfx.email-service.send_email`, contract in
 * that repo's `docs/email-service-contract.md`). The service does no templating: callers send
 * pre-rendered HTML and text, one recipient per request. The sender address and reply-to are left
 * to the service's defaults (its allowlists reject anything else).
 */
export class EmailService {
  private readonly natsService: NatsService;

  public constructor(natsService?: NatsService) {
    this.natsService = natsService ?? new NatsService();
  }

  /**
   * Sends one email. Resolves with the reply; an empty reply (no ids) means the service accepted the
   * request but did not send — sending disabled, or a non-prod recipient-domain filter — and is logged.
   * Throws a 502 `EMAIL_SEND_FAILED` when the service rejects the request or cannot be reached.
   */
  public async sendEmail(req: Request, request: EmailServiceSendRequest): Promise<EmailServiceSendResponse> {
    const codec = this.natsService.getCodec();
    let reply: EmailServiceSendResponse;

    try {
      const response = await this.natsService.request(NatsSubjects.EMAIL_SERVICE_SEND, codec.encode(JSON.stringify(request)), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });
      reply = JSON.parse(codec.decode(response.data)) as EmailServiceSendResponse;
    } catch (error) {
      throw new MicroserviceError('Unable to reach the email service', 502, 'EMAIL_SEND_FAILED', {
        operation: 'send_email',
        service: 'email_service',
        originalError: error instanceof Error ? error : undefined,
      });
    }

    if (reply.error) {
      // The reason is one of the contract's fixed strings; it stays in the log, not the client response.
      logger.warning(req, 'send_email', 'Email service rejected the email', { reason: reply.error });
      throw new MicroserviceError('The email service rejected the email', 502, 'EMAIL_SEND_FAILED', {
        operation: 'send_email',
        service: 'email_service',
      });
    }

    if (!reply.email_id) {
      // No subject or recipient in the log: callers put names in both.
      logger.warning(req, 'send_email', 'Email service accepted the email without sending it (disabled or recipient filtered)', {});
    } else {
      logger.debug(req, 'send_email', 'Email accepted by email service', { email_id: reply.email_id });
    }
    return reply;
  }
}
