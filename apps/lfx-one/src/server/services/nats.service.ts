// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects, ProjectSlugToIdResponse } from '@lfx-one/shared/interfaces';
import { connect, NatsConnection, StringCodec } from 'nats';

import { serverLogger } from '../server';

export class NatsService {
  private connection: NatsConnection | null = null;
  private connectionPromise: Promise<NatsConnection> | null = null;
  private codec = StringCodec();

  /**
   * Get project ID by slug using NATS request-reply pattern
   */
  public async getProjectIdBySlug(slug: string): Promise<ProjectSlugToIdResponse> {
    const connection = await this.ensureConnection();

    try {
      const response = await connection.request(NatsSubjects.PROJECT_SLUG_TO_UID, this.codec.encode(slug), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });

      const projectId = this.codec.decode(response.data);

      // Check if we got a valid project ID
      if (!projectId || projectId.trim() === '') {
        serverLogger.info({ slug }, 'Project slug not found via NATS');
        return {
          projectId: '',
          slug,
          exists: false,
        };
      }

      serverLogger.info({ slug, project_id: projectId }, 'Successfully resolved project slug to ID');

      return {
        projectId: projectId.trim(),
        slug,
        exists: true,
      };
    } catch (error) {
      serverLogger.error({ error: error instanceof Error ? error.message : error, slug }, 'Failed to resolve project slug via NATS');

      // If it's a timeout or no responder error, treat as not found
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          projectId: '',
          slug,
          exists: false,
        };
      }

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
        serverLogger.error({ error: error instanceof Error ? error.message : error }, 'Error during NATS shutdown');
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
          error: error instanceof Error ? error.message : error,
          url: natsUrl,
          suggestion: 'If running locally, you may need to port-forward NATS: kubectl port-forward -n lfx svc/lfx-platform-nats 4222:4222',
        },
        'Failed to connect to NATS server'
      );
      throw error;
    }
  }
}
