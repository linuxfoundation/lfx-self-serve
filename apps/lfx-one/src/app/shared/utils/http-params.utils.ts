// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpParameterCodec, HttpParams } from '@angular/common/http';

/**
 * A query-string codec that keeps `encodeURIComponent`'s output intact. Angular's default
 * `HttpUrlEncodingCodec` deliberately undoes the encoding of a handful of characters, `+` among
 * them, and Express's query parser then reads a literal `+` as a space — so a plus-addressed email
 * such as `jane+lfx@example.com` would reach the BFF as `jane lfx@example.com` and match nothing.
 * Use it for any parameter that carries user-typed text.
 */
export class StrictHttpParameterCodec implements HttpParameterCodec {
  public encodeKey(key: string): string {
    return encodeURIComponent(key);
  }

  public encodeValue(value: string): string {
    return encodeURIComponent(value);
  }

  public decodeKey(key: string): string {
    return decodeURIComponent(key);
  }

  public decodeValue(value: string): string {
    return decodeURIComponent(value);
  }
}

/** `HttpParams` bound to {@link StrictHttpParameterCodec}. */
export function strictHttpParams(): HttpParams {
  return new HttpParams({ encoder: new StrictHttpParameterCodec() });
}
