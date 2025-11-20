// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { connect, NatsConnection, Msg, StringCodec, Codec } from 'nats';

import { serverLogger } from '../server';

/**
 * Generic NATS service for managing connections and request-reply operations
 * This service handles only infrastructure concerns, not business logic
 */
export class NatsService {
  private connection: NatsConnection | null = null;
  private connectionPromise: Promise<NatsConnection> | null = null;

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

    try {
      return await connection.request(subject, data, requestOptions);
    } catch (error) {
      serverLogger.error(
        {
          err: error,
          subject,
        },
        'NATS request failed'
      );
      throw error;
    }
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
      serverLogger.info('Shutting down NATS connection');

      try {
        await this.connection.drain();
        serverLogger.info('NATS connection closed successfully');
      } catch (error) {
        serverLogger.error({ err: error }, 'Error during NATS shutdown');
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

    try {
      serverLogger.info({ url: natsUrl }, 'Connecting to NATS server on demand');

      const connection = await connect({
        servers: [natsUrl],
        timeout: NATS_CONFIG.CONNECTION_TIMEOUT,
      });

      serverLogger.info('Successfully connected to NATS server');
      return connection;
    } catch (error) {
      serverLogger.error(
        {
          err: error,
          url: natsUrl,
          suggestion: 'If running locally, you may need to port-forward NATS: kubectl port-forward -n lfx svc/lfx-platform-nats 4222:4222',
        },
        'Failed to connect to NATS server'
      );
      throw error;
    }
  }
}
