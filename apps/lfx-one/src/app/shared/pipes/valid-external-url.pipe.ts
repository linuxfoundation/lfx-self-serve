// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { normalizeToUrl } from '@lfx-one/shared/utils';

/**
 * Resolves an untrusted external URL to a safe href, or `null` when it fails validation.
 * Delegates to the shared `normalizeToUrl` (backed by `isValidUrl`), so it rejects
 * `javascript:`/`data:`/`vbscript:`/`file:`/`ftp:` schemes, non-http(s) protocols, and
 * localhost/private IPs, while still promoting a bare domain (`example.com`) to `https://`.
 * Use for user-provided links that need the stricter `isValidUrl` policy (e.g. profile badges);
 * `SafeUrlPipe` remains the lighter option where private-IP rejection isn't required.
 */
@Pipe({
  name: 'validExternalUrl',
  standalone: true,
  pure: true,
})
export class ValidExternalUrlPipe implements PipeTransform {
  public transform(url: string | null | undefined): string | null {
    return url ? normalizeToUrl(url) : null;
  }
}
