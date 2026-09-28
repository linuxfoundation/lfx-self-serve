// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SNOWFLAKE_QUERY_ERROR_CLIENT_MESSAGE } from '@lfx-one/shared/constants';

import { BaseApiError } from '../errors/base.error';
import { MicroserviceError } from '../errors/microservice.error';
import { logger } from '../services/logger.service';
import { SnowflakeService } from '../services/snowflake.service';
import { getCodeForStatus } from './http-status.helper';

import type { SnowflakeQueryResult, SnowflakeViewReadContext } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import type { Bind } from 'snowflake-sdk';

/**
 * `expectMissingObject` still rejects. It records a *success* against the shared circuit breaker
 * instead of a failure, so a missing view or absent GRANT here cannot open the breaker every
 * other Snowflake dashboard depends on. The 500 reaches `apiErrorHandler` either way.
 *
 * The SDK names the fully-qualified view in its message, so a generic sentence is put in
 * `clientMessage` — the raw text stays on `message`, which is what the log records. The provider
 * `code` and `service` are dropped for the same reason.
 */
export async function executeSnowflakeViewRead<T>(
  snowflakeService: SnowflakeService,
  req: Request,
  sql: string,
  binds: Bind[],
  context: SnowflakeViewReadContext
): Promise<SnowflakeQueryResult<T>> {
  const startTime = Date.now();
  try {
    return await snowflakeService.execute<T>(sql, binds, { expectMissingObject: true });
  } catch (error) {
    // The breaker treats this as expected and logs it at `warning`, but the same message covers a
    // revoked GRANT — an access-control event that has to be alertable on its own.
    if (SnowflakeService.isMissingObjectError(error)) {
      // Its own operation key: logging under the controller's would delete that entry from the
      // request's operation stack, leaving `apiErrorHandler` to invent a path-derived one.
      logger.error(req, `${context.operation}_missing_object`, startTime, error, {
        snowflake_expected_missing_object: context.view,
      });
    }

    // SnowflakeService's own generic sentence is replaced by this widget's; any other client message
    // was chosen by the site that threw it and passes through untouched.
    const hasSiteClientMessage =
      error instanceof BaseApiError && error.clientMessage !== undefined && error.clientMessage !== SNOWFLAKE_QUERY_ERROR_CLIENT_MESSAGE;
    if (!(error instanceof BaseApiError) || hasSiteClientMessage) throw error;

    throw new MicroserviceError(error.message, error.statusCode, getCodeForStatus(error.statusCode), {
      operation: error.operation,
      clientMessage: context.clientMessage,
      originalError: error,
    });
  }
}
