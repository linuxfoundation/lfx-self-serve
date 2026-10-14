// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { PendingActionItem } from '@lfx-one/shared';
import { hasJoinApplicationAddress } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

import { CookieRegistryService } from './cookie-registry.service';
import { UserService } from './user.service';

/**
 * Service for managing hidden pending actions using browser cookies.
 * Provides 24-hour automatic expiration without manual cleanup.
 * SSR-compatible using SsrCookieService.
 */
@Injectable({
  providedIn: 'root',
})
export class HiddenActionsService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly userService = inject(UserService);
  private readonly cookiePrefix = 'lfx_hidden_';
  private readonly dismissCookiePrefix = 'lfx_dismissed_';
  private readonly maxAgeDays = 1; // 24 hours
  private readonly permanentExpireDays = 3650; // ~10 years

  /**
   * Hide an action for 24 hours by setting a cookie.
   * The browser will automatically remove the cookie after expiration.
   *
   * @param item The pending action item to hide
   */
  public hideAction(item: PendingActionItem): void {
    const identifier = this.getActionIdentifier(item);
    const cookieName = this.getCookieName(identifier);
    this.cookieService.set(cookieName, '1', {
      expires: this.maxAgeDays,
      path: '/',
      sameSite: 'Strict',
    });
    // Register cookie for tracking
    this.cookieRegistry.registerCookie(cookieName);
  }

  /**
   * Permanently dismiss an action by setting a long-lived cookie (~10 years).
   * The item will never reappear for this user in this browser.
   *
   * @param item The pending action item to dismiss
   */
  public dismissAction(item: PendingActionItem): void {
    const cookieName = this.getDismissCookieName(item);
    if (!cookieName) return;
    this.cookieService.set(cookieName, '1', {
      expires: this.permanentExpireDays,
      path: '/',
      sameSite: 'Strict',
      secure: process.env['NODE_ENV'] === 'production',
    });
    this.cookieRegistry.registerCookie(cookieName);
  }

  /**
   * Check if an action is currently hidden — either via a 24h completion cookie or a permanent dismiss cookie.
   *
   * Formation rows are never cookie-hidden (#2732): they are resolved on the checklist and offer no
   * Dismiss, so the only cookies that could match are dismissals written while the button still
   * existed — ~10-year cookies with no control left to undo them. Honouring those would hide an
   * item its assignee still owns, forever. Keyed on `type` rather than the decorated view's
   * `isFormationItem`: this runs on the wire row before decoration, and that flag also encodes
   * linkability (slug + key present), which is the wrong criterion for a cookie exemption.
   * Join applications stay visible until an authoritative review succeeds or the reviewer explicitly dismisses
   * the request (a delegating admin may not want it in their own list; it stays pending for other reviewers and
   * on the group's applications tab). Only a dismiss cookie counts, and incomplete wire rows are never hidden.
   *
   * @param item The pending action item to check
   * @returns true if the action is hidden, false otherwise
   */
  public isActionHidden(item: PendingActionItem): boolean {
    if (item.type === 'FormationItem') return false;
    if (item.type === 'JoinApplication') {
      // Only an explicit Dismiss hides a request (never the 24h completion cookie). No cookie name means the row has no full
      // address or there is no effective user to scope the dismissal to — in both cases the request stays visible.
      const dismissName = this.getDismissCookieName(item);
      return dismissName ? this.cookieService.check(dismissName) : false;
    }
    const identifier = this.getActionIdentifier(item);
    const hash = this.hashString(identifier);
    return this.cookieService.check(`${this.cookiePrefix}${hash}`) || this.cookieService.check(`${this.dismissCookiePrefix}${hash}`);
  }

  /**
   * Name of the permanent dismiss cookie for an item, or null when it must not be dismissible.
   *
   * Join requests are scoped to the effective user (the impersonated user while impersonating): the cookie lives in the
   * browser, not the account, so an unscoped name would hide a request from anyone who later uses it — another login on a
   * shared browser, or an admin impersonating a writer — who never dismissed it and may owe it a decision. They also need
   * the full committee + application address; an incomplete row would hash to one shared identifier and bury every other one.
   */
  private getDismissCookieName(item: PendingActionItem): string | null {
    if (item.type !== 'JoinApplication') {
      return `${this.dismissCookiePrefix}${this.hashString(this.getActionIdentifier(item))}`;
    }
    const subject = this.userService.user()?.sub;
    if (!subject || !hasJoinApplicationAddress(item)) return null;
    return `${this.dismissCookiePrefix}${this.hashString(`${this.getActionIdentifier(item)}|${subject}`)}`;
  }

  // Prefer intrinsic IDs (meetingUid, voteUid, briefActionUid, formationItemUid) so same-text siblings never collide; fall back to type+badge+text+buttonLink for legacy action shapes without one.
  private getActionIdentifier(item: PendingActionItem): string {
    if (item.type === 'JoinApplication') {
      return `JoinApplication-${item.committeeUid}-${item.applicationUid}`;
    }
    if (item.meetingUid) {
      return `${item.type}-${item.meetingUid}-${item.occurrenceId ?? ''}`;
    }
    if (item.voteUid) {
      return `${item.type}-${item.voteUid}`;
    }
    if (item.briefActionUid) {
      return `${item.type}-${item.briefActionUid}`;
    }
    if (item.formationItemUid) {
      return `${item.type}-${item.formationItemUid}`;
    }
    const base = `${item.type}-${item.badge}-${item.text}`;
    return item.buttonLink ? `${base}|${item.buttonLink}` : base;
  }

  /**
   * Convert an identifier to a safe cookie name using simple string hashing.
   * Uses a deterministic hash to create short, consistent cookie names.
   *
   * @param identifier The action identifier
   * @returns A cookie-safe name with prefix
   */
  private getCookieName(identifier: string): string {
    const hash = this.hashString(identifier);
    return `${this.cookiePrefix}${hash}`;
  }

  /**
   * Simple string hash function for generating short, deterministic identifiers.
   * Uses a variant of the DJB2 hash algorithm.
   *
   * @param str String to hash
   * @returns 8-character hexadecimal hash
   */
  private hashString(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) + hash + str.charCodeAt(i); // hash * 33 + char
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Convert to unsigned and return as hex string
    return Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8);
  }
}
