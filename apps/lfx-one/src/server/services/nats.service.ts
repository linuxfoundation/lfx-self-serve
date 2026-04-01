// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_MESSAGE_BODY_SIZE,
  ATTR_MESSAGING_OPERATION_TYPE,
  ATTR_MESSAGING_SYSTEM,
} from '@opentelemetry/semantic-conventions/incubating';
import { ATTR_NETWORK_PROTOCOL_NAME, ATTR_SERVER_ADDRESS, ATTR_SERVER_PORT } from '@opentelemetry/semantic-conventions';
import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { Codec, connect, Msg, NatsConnection, StringCodec } from 'nats';

import { tracer } from '../server-tracer';
import { logger } from './logger.service';

/**
 * Generic NATS service for managing connections and request-reply operations
 * This service handles only infrastructure concerns, not business logic
 */
export class NatsService {
  private connection: NatsConnection | null = null;
  private connectionPromise: Promise<NatsConnection> | null = null;
  private natsHostname: string;
  private natsPort: number;

  public constructor() {
    const natsUrl = process.env['NATS_URL'] || NATS_CONFIG.DEFAULT_SERVER_URL;
    const parsedUrl = new URL(natsUrl.replace(/^nats:/, 'http:'));
    this.natsHostname = parsedUrl.hostname;
    this.natsPort = parseInt(parsedUrl.port, 10) || 4222;
  }

  /**
   * Get the string codec for encoding/decoding messages
   */
  public getCodec(): Codec<string> {
    return StringCodec();
  }

  /**
   * Send a request-reply message to NATS
   * @param subject - The NATS subject to send to
   * @param data - The data to send (will be encoded)
   * @param options - Optional request options (timeout, etc.)
   * @returns The response message
   */
  public async request(subject: string, data: Uint8Array, options?: { timeout?: number }): Promise<Msg> {
    const connection = await this.ensureConnection();
    const requestOptions = {
      timeout: options?.timeout || NATS_CONFIG.REQUEST_TIMEOUT,
    };

    return tracer.startActiveSpan(
      `NATS request ${subject}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          [ATTR_MESSAGING_SYSTEM]: 'nats',
          [ATTR_MESSAGING_OPERATION_TYPE]: 'send',
          [ATTR_MESSAGING_DESTINATION_NAME]: subject,
          [ATTR_NETWORK_PROTOCOL_NAME]: 'nats',
          [ATTR_SERVER_ADDRESS]: this.natsHostname,
          [ATTR_SERVER_PORT]: this.natsPort,
        },
      },
      async (span) => {
        const startTime = Date.now();
        logger.debug(undefined, 'nats_request', 'Sending NATS request', { subject });
        try {
          const response = await connection.request(subject, data, requestOptions);
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttribute(ATTR_MESSAGING_MESSAGE_BODY_SIZE, data.length);
          logger.debug(undefined, 'nats_request', 'NATS request completed', {
            subject,
            response_size: response.data.length,
            duration_ms: Date.now() - startTime,
          });
          return response;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          logger.error(undefined, 'nats_request', startTime, error, { subject });
          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  /**
   * Check if NATS connection is active
   */
  public isConnected(): boolean {
    return this.connection !== null && !this.connection.isClosed();
  }

  /**
   * Gracefully shutdown NATS connection
   */
  public async shutdown(): Promise<void> {
    if (this.connection && !this.connection.isClosed()) {
      const startTime = logger.startOperation(undefined, 'nats_shutdown', {});

      try {
        await this.connection.drain();
        logger.success(undefined, 'nats_shutdown', startTime, {});
      } catch (error) {
        logger.error(undefined, 'nats_shutdown', startTime, error, {});
      }
    }
    this.connection = null;
  }

  /**
   * Ensure NATS connection with thread safety (lazy initialization)
   */
  private async ensureConnection(): Promise<NatsConnection> {
    // Return existing connection if valid
    if (this.connection && !this.connection.isClosed()) {
      return this.connection;
    }

    // If already connecting, wait for that connection
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Create new connection
    this.connectionPromise = this.createConnection();

    try {
      this.connection = await this.connectionPromise;
      return this.connection;
    } catch (error) {
      // Reset connection promise on failure
      this.connectionPromise = null;
      throw error;
    } finally {
      // Reset connection promise after completion
      this.connectionPromise = null;
    }
  }

  /**
   * Create a new NATS connection
   */
  private async createConnection(): Promise<NatsConnection> {
    const natsUrl = process.env['NATS_URL'] || NATS_CONFIG.DEFAULT_SERVER_URL;
    const startTime = logger.startOperation(undefined, 'nats_connect', { url: natsUrl });

    try {
      const connection = await connect({
        servers: [natsUrl],
        timeout: NATS_CONFIG.CONNECTION_TIMEOUT,
      });

      logger.success(undefined, 'nats_connect', startTime, {});
      return connection;
    } catch (error) {
      logger.error(undefined, 'nats_connect', startTime, error, {
        url: natsUrl,
        suggestion: 'If running locally, you may need to port-forward NATS: kubectl port-forward -n lfx svc/lfx-platform-nats 4222:4222',
      });
      throw error;
    }
  }
}
