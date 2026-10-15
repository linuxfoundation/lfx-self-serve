// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IncomingMessage, Server, ServerResponse, STATUS_CODES } from 'node:http';
import { Duplex } from 'node:stream';

import {
  type RealtimeBridge,
  bridgeRealtime,
  isAdminCheckPending,
  realtimeUpstreamUrl,
  rejectUpgrade,
  retryAfterSeconds,
  SESSION_EXPIRED,
  SESSION_HEADER,
} from '@gatewaze/host-session';
import {
  GW_HOST_SESSION_PROXY_SUPABASE_MOUNT,
  GW_REALTIME_CLOSE_GOING_AWAY,
  GW_REALTIME_FORWARDED_REJECT_HEADERS,
  GW_REALTIME_MAX_PAYLOAD_BYTES,
  GW_REALTIME_MAX_SOCKET_AGE_MS,
  GW_REALTIME_MAX_SOCKETS_PER_USER,
  GW_REALTIME_MAX_SOCKETS_TOTAL,
  GW_REALTIME_PATH,
  GW_REALTIME_UPGRADE_TIMEOUT_MS,
} from '@lfx-one/shared/constants';
import { GatewazeRealtimeLimits, GatewazeRealtimePendingUpgrade } from '@lfx-one/shared/interfaces';
import { Request } from 'express';
import { WebSocketServer } from 'ws';

import { addShutdownHook, isShuttingDown } from '../utils/shutdown';
import { getGatewazeSessionService, hostSessionCoreLogger, isGatewazeHostSessionEnabled, resolveGatewazeHostSessionConfig } from './gatewaze-session.service';
import { logger } from './logger.service';

/** The `Origin` every Realtime upgrade must carry: LFX One's own. Null when `PCC_BASE_URL` is missing or invalid, which refuses every upgrade. */
function siteOrigin(): string | null {
  try {
    return new URL(process.env['PCC_BASE_URL'] || '').origin;
  } catch {
    return null;
  }
}

function pathOf(url: string | undefined): string {
  const raw = url ?? '/';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

/**
 * The Realtime WebSocket proxy for Gatewaze host-session mode. `supabase-js` in the embed opens its
 * Realtime socket at `/api/gatewaze/supabase/realtime/v1/websocket` with the placeholder token. This
 * service ends that socket on LFX One and opens its own to Supabase Realtime, and the package's
 * `bridgeRealtime` puts the real access token into every `phx_join` and `access_token` message.
 *
 * An upgrade runs outside Express, so `onUpgrade` first makes the cheap checks (path, flag, Origin,
 * the pod's socket cap), then runs the request through the Express app with a response that never
 * reaches the socket. The upgrade therefore passes the same `auth()`, `authMiddleware`, rate limiter,
 * `requireGatewazeHostSession` and `requireGwEmbedAccess` as every other `/api/gatewaze` request.
 * Whatever Express answers becomes the refused handshake's status. Only the realtime route
 * (`handleRoute`) completes the upgrade. See `docs/architecture/backend/gw-host-session.md`.
 */
type PendingUpgrade = GatewazeRealtimePendingUpgrade<Duplex, Buffer>;

export class GatewazeRealtimeService {
  private wss: WebSocketServer | null = null;
  private readonly bridges = new Set<RealtimeBridge>();
  private readonly pending = new WeakMap<IncomingMessage, PendingUpgrade>();
  private readonly socketsPerUser = new Map<string, number>();
  private totalSockets = 0;
  private closing = false;

  public constructor(
    private readonly limits: GatewazeRealtimeLimits = { perUser: GW_REALTIME_MAX_SOCKETS_PER_USER, total: GW_REALTIME_MAX_SOCKETS_TOTAL },
    private readonly upgradeTimeoutMs: number = GW_REALTIME_UPGRADE_TIMEOUT_MS,
    private readonly maxSocketAgeMs: number = GW_REALTIME_MAX_SOCKET_AGE_MS
  ) {}

  /**
   * Hooks the service onto the HTTP server and registers its shutdown hook, but only when host-session
   * mode is on at startup. With an `upgrade` listener in place, Node hands it every request that
   * carries an `Upgrade` header instead of serving it as a normal request, so with the mode off
   * nothing is attached and the server behaves as before. Turning the flag on needs a restart, as
   * every environment flag does. Returns whether it attached. Called once from `startServer`.
   */
  public attach(server: Server, dispatch: (req: IncomingMessage, res: ServerResponse) => void): boolean {
    if (!isGatewazeHostSessionEnabled()) {
      return false;
    }
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.onUpgrade(req, socket, head, dispatch));
    addShutdownHook(() => this.closeAll());
    return true;
  }

  /**
   * The HTTP server's `upgrade` listener. Node hands it every request that carries an `Upgrade`
   * header, so anything that is not the Realtime path is refused with 404.
   */
  public onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, dispatch: (req: IncomingMessage, res: ServerResponse) => void): void {
    // First, before any reject or await: Node removes its own error listener from an upgraded
    // socket, and ws adds one only inside handleUpgrade. A client that resets the connection in
    // between would otherwise raise an unhandled 'error' and take the process down.
    socket.on('error', () => socket.destroy());

    // Exactly the socket realtime-js opens; no other Realtime path is proxied.
    if (pathOf(req.url) !== GW_REALTIME_PATH) {
      this.reject(socket, 404, 'not the Realtime path');
      return;
    }
    if (this.closing || isShuttingDown()) {
      this.reject(socket, 503, 'shutting down');
      return;
    }
    // The same uniform 404 the HTTP routes give while host-session mode is off, before any Valkey read.
    if (!isGatewazeHostSessionEnabled()) {
      this.reject(socket, 404, 'host-session mode is off');
      return;
    }
    // Exact match. A browser always sends Origin on a WebSocket, and SameSite=Lax still sends the
    // cookie on a cross-site WebSocket, so this is the cross-site check.
    const origin = siteOrigin();
    if (!origin || req.headers.origin !== origin) {
      this.reject(socket, 403, req.headers.origin ? 'another origin' : 'no origin');
      return;
    }
    if (this.totalSockets >= this.limits.total) {
      logger.warning(undefined, 'gatewaze_realtime_upgrade', 'Refusing a Realtime upgrade: the pod is at its socket cap', { cap: this.limits.total });
      this.reject(socket, 503, 'pod socket cap');
      return;
    }

    // Reserve the slot now, before anything async, so concurrent upgrades cannot all pass the cap.
    // Freed on every way the upgrade can end: a refusal, the socket closing (which covers ws aborting
    // a malformed handshake), and the bridged socket closing.
    this.totalSockets++;
    const releaseSteps: (() => void)[] = [() => this.totalSockets--];
    let released = false;
    const pending: PendingUpgrade = {
      socket,
      head,
      taken: false,
      settled: false,
      release: () => {
        if (released) return;
        released = true;
        for (const step of releaseSteps) step();
      },
      onRelease: (step) => {
        if (released) step();
        else releaseSteps.push(step);
      },
    };
    socket.once('close', pending.release);
    this.pending.set(req, pending);

    // Bounds the whole upgrade, the Express gates and the Gatewaze session load, so a middleware that
    // never answers or a hung Valkey or GoTrue call cannot hold the slots until the client gives up.
    const deadline = setTimeout(() => {
      if (!pending.settled) {
        pending.taken = true;
        logger.warning(undefined, 'gatewaze_realtime_upgrade', 'A Realtime upgrade did not complete in time', { timeout_ms: this.upgradeTimeoutMs });
        this.refuse(pending, 503, 'upgrade timed out');
      }
    }, this.upgradeTimeoutMs);
    deadline.unref();
    pending.onRelease(() => clearTimeout(deadline));

    // A response with no socket: nothing Express writes reaches the client. Every way Express answers
    // ends in `end`, so its status becomes the refused handshake. The realtime route never calls it.
    const res = new ServerResponse(req);
    res.end = ((): ServerResponse => {
      if (!pending.taken) {
        pending.taken = true;
        const headers: Record<string, string> = {};
        for (const name of GW_REALTIME_FORWARDED_REJECT_HEADERS) {
          const value = res.getHeader(name);
          if (value !== undefined) headers[name] = String(value);
        }
        // A 2xx or 3xx here is not an answer an upgrade can use (e.g. a sign-in redirect), so it is a 500.
        this.refuse(pending, res.statusCode >= 400 ? res.statusCode : 500, 'answered by the Express gates', headers);
      }
      return res;
    }) as ServerResponse['end'];

    try {
      dispatch(req, res);
    } catch (error) {
      logger.warning(undefined, 'gatewaze_realtime_upgrade', 'The Express app threw on a Realtime upgrade', { err: error });
      if (!pending.taken) {
        pending.taken = true;
        this.refuse(pending, 500, 'the Express app threw');
      }
    }
  }

  /**
   * The realtime route, reached only after every `/api/gatewaze` gate passed. A plain HTTP GET to the
   * same path, with no upgrade behind it, gets false and the router answers the uniform 404.
   * Otherwise it applies the per-user cap, loads the Gatewaze session and completes the handshake.
   */
  public async handleRoute(req: Request): Promise<boolean> {
    const pending = this.pending.get(req);
    if (!pending || pending.taken) {
      return false;
    }
    // From here on this route answers the upgrade, not Express.
    pending.taken = true;
    try {
      await this.completeUpgrade(req, pending);
    } catch (error) {
      // Express can no longer answer this upgrade, so a throw here must refuse it itself.
      logger.warning(req, 'gatewaze_realtime_upgrade', 'Realtime upgrade failed', { err: error });
      this.refuse(pending, 500, 'the upgrade failed');
    }
    return true;
  }

  /** Closes every bridged socket with 1001 (going away), so realtime-js reconnects to another pod, and stops taking upgrades. */
  public async closeAll(): Promise<void> {
    this.closing = true;
    for (const bridge of this.bridges) {
      bridge.close(GW_REALTIME_CLOSE_GOING_AWAY, 'server shutting down');
    }
    this.bridges.clear();
    const wss = this.wss;
    this.wss = null;
    if (wss) {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  }

  /** Open bridged sockets on this pod. For specs and diagnostics. */
  public openSocketCount(): number {
    return this.bridges.size;
  }

  /** The per-user cap, the Gatewaze session, the upstream URL and the handshake. Every early return refuses the upgrade. */
  private async completeUpgrade(req: Request, pending: PendingUpgrade): Promise<void> {
    const { socket, head } = pending;

    if (this.closing) {
      this.refuse(pending, 503, 'shutting down');
      return;
    }
    const sub = req.oidc?.user?.['sub'];
    if (typeof sub !== 'string' || !sub) {
      this.refuse(pending, 401, 'no signed-in subject', { [SESSION_HEADER]: SESSION_EXPIRED });
      return;
    }
    if ((this.socketsPerUser.get(sub) ?? 0) >= this.limits.perUser) {
      this.refuse(pending, 429, 'per-user socket cap');
      return;
    }
    // The client went away while the gates ran: do not load, or mint, a session for nobody.
    if (socket.destroyed) {
      this.refuse(pending, 400, 'client went away');
      return;
    }
    this.socketsPerUser.set(sub, (this.socketsPerUser.get(sub) ?? 0) + 1);
    pending.onRelease(() => {
      const n = (this.socketsPerUser.get(sub) ?? 1) - 1;
      if (n > 0) this.socketsPerUser.set(sub, n);
      else this.socketsPerUser.delete(sub);
    });

    const result = await getGatewazeSessionService().openRealtimeSession(req);
    // The deadline refused the upgrade while the session loaded.
    if (pending.settled) {
      if (result.outcome === 'ok') result.session.release();
      return;
    }
    if (result.outcome !== 'ok') {
      // The marker is informational: a browser cannot read handshake headers. The embed learns the
      // session ended from its next HTTP call, which carries the same marker.
      const status = { host_session_unavailable: 404, ended: 401, refused: 503, unavailable: 503 }[result.outcome];
      this.refuse(pending, status, `session ${result.outcome}`, result.outcome === 'ended' ? { [SESSION_HEADER]: SESSION_EXPIRED } : {});
      return;
    }
    const realtime = result.session;
    pending.onRelease(realtime.release);
    // Shutdown began while the gates or the session load ran. closeAll() only reaches open bridges,
    // so an upgrade still in flight must not open a socket after it.
    if (this.closing) {
      this.refuse(pending, 503, 'shutting down');
      return;
    }
    const session = realtime.session;
    if (!session.is_admin) {
      if (isAdminCheckPending(session)) {
        this.refuse(pending, 503, 'admin check pending', { 'retry-after': String(retryAfterSeconds(session)) });
      } else {
        this.refuse(pending, 403, 'not a Gatewaze admin');
      }
      return;
    }

    const config = resolveGatewazeHostSessionConfig();
    if (!config) {
      this.refuse(pending, 404, 'host-session mode is off');
      return;
    }
    let upstreamUrl: string;
    try {
      // '/realtime/v1/websocket?...': the package checks it stays under /realtime/v1 after
      // normalisation, drops any URL-borne token and sets `apikey` to the anon key.
      upstreamUrl = realtimeUpstreamUrl(config.supabaseUrl, req.originalUrl.slice(GW_HOST_SESSION_PROXY_SUPABASE_MOUNT.length), config.anonKey);
    } catch {
      this.refuse(pending, 400, 'path left /realtime/v1');
      return;
    }
    // The client went away while the session loaded.
    if (socket.destroyed || !socket.readable || !socket.writable) {
      this.refuse(pending, 400, 'client went away');
      return;
    }

    pending.settled = true;
    this.getWss().handleUpgrade(req, socket, head, (client) => {
      const bridge = bridgeRealtime(client, {
        upstreamUrl,
        session,
        fresh: realtime.fresh,
        onSignedOut: realtime.onSignedOut,
        log: hostSessionCoreLogger('gatewaze_realtime_bridge'),
      });
      // The bridge now listens for the sign-out itself.
      realtime.release();
      client.once('close', () => {
        this.bridges.delete(bridge);
        pending.release();
      });
      if (realtime.signedOut()) {
        bridge.close(4001, 'signed out');
        return;
      }
      if (this.closing) {
        bridge.close(GW_REALTIME_CLOSE_GOING_AWAY, 'server shutting down');
        return;
      }
      this.bridges.add(bridge);
      // Reconnect through every check again from time to time; the refresh does not re-check LFX access.
      const reauthorize = setTimeout(() => bridge.close(GW_REALTIME_CLOSE_GOING_AWAY, 'reauthorize'), this.maxSocketAgeMs);
      reauthorize.unref();
      client.once('close', () => clearTimeout(reauthorize));
      logger.debug(req, 'gatewaze_realtime_upgrade', 'Opened a Gatewaze Realtime socket', { open_sockets: this.bridges.size });
    });
  }

  /** Frees the upgrade's slots, then refuses it. */
  private refuse(pending: PendingUpgrade, status: number, reason: string, headers: Record<string, string> = {}): void {
    if (pending.settled) return;
    pending.settled = true;
    pending.release();
    this.reject(pending.socket, status, reason, headers);
  }

  /**
   * Answers a refused handshake. A browser cannot read it, and pino-http never logs an upgrade, so this
   * DEBUG line is the trace of why. The reason is a fixed phrase; no URL, cookie or header is logged.
   */
  private reject(socket: Duplex, status: number, reason: string, headers: Record<string, string> = {}): void {
    logger.debug(undefined, 'gatewaze_realtime_upgrade', 'Refused a Realtime upgrade', { status, reason });
    rejectUpgrade(socket, status, STATUS_CODES[status] ?? 'Error', headers);
  }

  private getWss(): WebSocketServer {
    this.wss ??= new WebSocketServer({ noServer: true, maxPayload: GW_REALTIME_MAX_PAYLOAD_BYTES });
    return this.wss;
  }
}

let instance: GatewazeRealtimeService | null = null;

/** The pod's Realtime proxy. `server.ts` attaches it to the HTTP server; the `/api/gatewaze` router hands it the upgrade. */
export function getGatewazeRealtimeService(): GatewazeRealtimeService {
  instance ??= new GatewazeRealtimeService();
  return instance;
}
