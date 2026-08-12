// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getCodeForStatus, getDefaultMessageForStatus } from '../helpers/http-status.helper';
import { BaseApiError } from './base.error';

/**
 * Error class for microservice-related failures
 * Designed to pass through error details from backend services
 */
export class MicroserviceError extends BaseApiError {
  public readonly errorBody?: any;
  public readonly originalMessage?: string;

  public constructor(
    message: string,
    statusCode: number,
    code: string,
    options: {
      operation?: string;
      service?: string;
      path?: string;
      errorBody?: any;
      originalMessage?: string;
      originalError?: Error;
    } = {}
  ) {
    super(message, statusCode, code, {
      operation: options.operation,
      service: options.service,
      path: options.path,
      originalError: options.originalError,
    });

    this.errorBody = options.errorBody;
    this.originalMessage = options.originalMessage;
  }

  public override toResponse(): Record<string, any> {
    const response = super.toResponse();

    // Include original message from backend if available
    if (this.originalMessage && this.originalMessage !== this.message) {
      response['originalMessage'] = this.originalMessage;
    }

    // Include any additional error body details from backend
    if (this.errorBody) {
      if (this.errorBody['details']) {
        response['details'] = this.errorBody['details'];
      }
      if (this.errorBody['errors']) {
        response['errors'] = this.errorBody['errors'];
      }
      // Upstream's discriminating error code (e.g. 'scheduled', 'cancel_window_closed',
      // 'send_in_progress', 'already_sent') — distinct from `code`, which is derived purely
      // from the HTTP status (getCodeForStatus) and collapses all 409s to 'CONFLICT'. Forwarded
      // additively so callers that need to branch deterministically on the upstream reason can,
      // without breaking any existing consumer of `code`/`error`.
      if (typeof this.errorBody['error'] === 'string' && this.errorBody['error'].trim()) {
        response['upstreamCode'] = this.errorBody['error'];
      }
    }

    return response;
  }

  public override getLogContext(): Record<string, any> {
    return {
      ...super.getLogContext(),
      error_body: this.errorBody,
      original_message: this.originalMessage,
    };
  }

  /**
   * Factory method to create from microservice response error
   */
  public static fromMicroserviceResponse(
    statusCode: number,
    statusText: string,
    errorBody: any,
    service: string,
    path: string,
    operation?: string
  ): MicroserviceError {
    // Extract the best error message from the backend response
    const backendMessage = errorBody?.message || errorBody?.error;
    const userMessage = backendMessage || getDefaultMessageForStatus(statusCode);
    const errorCode = getCodeForStatus(statusCode);

    return new MicroserviceError(userMessage, statusCode, errorCode, {
      service,
      path,
      operation,
      errorBody,
      originalMessage: `HTTP ${statusCode}: ${statusText}`,
    });
  }
}
