// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { trace } from '@opentelemetry/api';

export const SERVICE_NAME = process.env['OTEL_SERVICE_NAME'] || 'lfx-v2-ui';

export const tracer = trace.getTracer(SERVICE_NAME);
