// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// jose v2 doesn't ship JWK/JWT namespaces or errors.JWTExpired in its types; shim fills the gap until we can migrate to jose v5+ (blocked on openid-client hoisting conflict with @modelcontextprotocol/sdk).
declare module 'jose' {
  export type JoseKey = Readonly<Record<string, unknown>>;

  export const errors: {
    JWTExpired: new (message?: string) => Error;
  };

  export const JWK: {
    asKey: (key: Buffer) => JoseKey;
  };

  export const JWT: {
    verify: <TPayload = Record<string, unknown>>(token: string, key: JoseKey, options?: { algorithms?: string[] }) => TPayload;
  };
}
