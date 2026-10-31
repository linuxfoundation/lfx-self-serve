// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMAIL_SEND_UNCONFIRMED, EMAIL_SERVICE_DELIVERY_FAILED_REASON, EMAIL_SERVICE_PRE_SEND_REJECTIONS, NATS_CONFIG } from '@lfx-one/shared/constants';
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
   * Throws 502 on failure. Transport failures carry `transportFailure`; known pre-send refusals use
   * `EMAIL_SEND_FAILED`. Generic SMTP delivery errors and unknown replies use `EMAIL_SEND_UNCONFIRMED`:
   * even a received error reply can follow SMTP acceptance, so those must not invite a blind retry.
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
        // Losing the request or its reply leaves the SMTP outcome unknown.
        transportFailure: true,
      });
    }

    if (reply.error) {
      const rejectedBeforeSend = EMAIL_SERVICE_PRE_SEND_REJECTIONS.includes(reply.error);
      // Only contractually pre-send refusals prove nothing was sent. `email delivery failed`
      // also covers a disconnect after SMTP DATA acceptance; unknown errors are conservative too.
      // Preserve fixed contract reasons for diagnosis; arbitrary replies may contain recipient data.
      const knownReason = rejectedBeforeSend || reply.error === EMAIL_SERVICE_DELIVERY_FAILED_REASON ? reply.error : 'unrecognized';
      logger.warning(req, 'send_email', 'Email service reported a send error', { rejected_before_send: rejectedBeforeSend, reason: knownReason });
      throw new MicroserviceError(
        rejectedBeforeSend ? 'The email service rejected the email' : 'The email service could not confirm the send outcome',
        502,
        rejectedBeforeSend ? 'EMAIL_SEND_FAILED' : EMAIL_SEND_UNCONFIRMED,
        { operation: 'send_email', service: 'email_service' }
      );
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
