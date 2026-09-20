import crypto from 'crypto';

/**
 * In-memory stand-in for the FalFoos bot Website Integration Layer, used by the
 * Phase 7 test. It verifies the website's inbound HMAC and signs its own
 * responses exactly like `src/website/security.js` in the bot repo, so the test
 * exercises the real signing/verification code paths end to end.
 */

export interface BotMockState {
  purchaseMode: 'ok' | 'insufficient' | 'pending' | 'received' | 'processing';
  badAttestation: boolean;
  badResponseSignature: boolean;
  purchaseCalls: number;
  refundCalls: number;
  linkStartCalls: number;
  challenges: Map<string, { channel: string; name: string; website_user_id: string }>;
  /**
   * Mirrors the real Bot `website_requests` store: `request_id` is an
   * operation-scoped key. Reusing an id across different operations must yield
   * 409 `request_id_conflict`.
   */
  requests: Map<string, 'identity_link_start' | 'identity_link_verify' | 'purchase' | 'refund'>;
  /** Recorded HTTP methods for the GET `/api/v1/website/health` probe. */
  healthMethods: string[];
  healthMode: 'ok' | 'nonjson';
}

const originalFetch = globalThis.fetch;

function hmac(secret: string, message: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function jsonResponse(status: number, body: unknown, secret: string, badSignature = false) {
  const text = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const sig = badSignature ? '0'.repeat(64) : hmac(secret, `${ts}.${text}`);
  const ResponseCtor = (globalThis as any).Response;
  return new ResponseCtor(text, {
    status,
    headers: {
      'content-type': 'application/json',
      'x-falfoos-response-signature': `t=${ts},v1=${sig}`,
    },
  });
}

export function installBotMock(secret: string): BotMockState {
  const state: BotMockState = {
    purchaseMode: 'ok',
    badAttestation: false,
    badResponseSignature: false,
    purchaseCalls: 0,
    refundCalls: 0,
    linkStartCalls: 0,
    challenges: new Map(),
    requests: new Map(),
    healthMethods: [],
    healthMode: 'ok',
  };

  (globalThis as any).fetch = async (url: string, init: any) => {
    const pathname = new URL(url).pathname;

    // M3 — the Bot health probe is an unauthenticated, UNSIGNED GET liveness
    // endpoint (`src/website/routes.js`). Handle it before any signature check.
    if (pathname.endsWith('/health')) {
      state.healthMethods.push(String(init?.method ?? 'GET'));
      const ResponseCtor = (globalThis as any).Response;
      const nonJson = state.healthMode === 'nonjson';
      return new ResponseCtor(nonJson ? 'not json' : JSON.stringify({ ok: true, integration: true }), {
        status: 200,
        headers: { 'content-type': nonJson ? 'text/plain' : 'application/json' },
      });
    }

    const bodyString = String(init?.body ?? '');
    const headers = (init?.headers ?? {}) as Record<string, string>;

    const sigHeader = headers['X-FalFoos-Signature'];
    const parsed = /^t=(\d+),v1=([0-9a-f]+)$/.exec(sigHeader || '');
    if (!parsed) return jsonResponse(401, { error: 'invalid_signature_header' }, secret, state.badResponseSignature);
    const expected = hmac(secret, `${parsed[1]}.${bodyString}`);
    if (expected !== parsed[2]) {
      return jsonResponse(401, { error: 'invalid_signature' }, secret, state.badResponseSignature);
    }

    const body = JSON.parse(bodyString) as Record<string, any>;
    let status = 200;
    let response: Record<string, unknown>;

    if (pathname.endsWith('/link/start')) {
      state.linkStartCalls += 1;
      const requestId = String(body.request_id ?? '');
      const existingKind = state.requests.get(requestId);
      if (existingKind && existingKind !== 'identity_link_start') {
        status = 409;
        response = { error: 'request_id_conflict' };
      } else {
        state.requests.set(requestId, 'identity_link_start');
        const channel =
          typeof body.channel === 'string' && body.channel.startsWith('UC')
            ? body.channel
            : 'UC' + 'a'.repeat(22);
        const challenge_id = crypto.randomUUID();
        const code = 'falfoos-link-' + crypto.randomBytes(5).toString('hex');
        state.challenges.set(challenge_id, {
          channel,
          name: 'Test Channel',
          website_user_id: String(body.website_user_id),
        });
        response = {
          request_id: body.request_id,
          challenge_id,
          code,
          expires_at: Date.now() + 15 * 60 * 1000,
          youtube_channel_id: channel,
          youtube_name: 'Test Channel',
        };
      }
    } else if (pathname.endsWith('/link/verify')) {
      const requestId = String(body.request_id ?? '');
      const existingKind = state.requests.get(requestId);
      if (existingKind && existingKind !== 'identity_link_verify') {
        // Mirrors the real Bot: reusing a request id from another operation.
        status = 409;
        response = { error: 'request_id_conflict' };
      } else {
        state.requests.set(requestId, 'identity_link_verify');
        const challenge = state.challenges.get(String(body.challenge_id));
        if (!challenge) {
          status = 404;
          response = { error: 'challenge_not_found' };
        } else {
          const att = {
            request_id: body.request_id,
            youtube_channel_id: challenge.channel,
            youtube_name: challenge.name,
            platform: 'Youtube',
            platform_id: challenge.channel,
            loyalty_id: 'loyalty-1',
            points: 100,
            attested_at: Date.now(),
          };
          const canonical = [
            'FalfoosWebsiteAttestationV1',
            String(att.request_id),
            String(att.youtube_channel_id),
            String(att.youtube_name),
            String(att.platform),
            String(att.platform_id),
            String(att.loyalty_id),
            String(att.points),
            String(att.attested_at),
          ].join('\n');
          const attSig = state.badAttestation ? 'deadbeef' : hmac(secret, canonical);
          response = { ...att, attestation_algorithm: 'HMAC-SHA256', attestation_signature: attSig };
        }
      }
    } else if (pathname.endsWith('/purchase/refund')) {
      state.refundCalls += 1;
      response = {
        request_id: body.request_id,
        status: 'COMPLETED',
        related_request_id: body.related_request_id,
        tx_id: `refund-tx-${state.refundCalls}`,
        amount: 30,
        balance_before: 70,
        balance_after: 100,
      };
    } else if (pathname.endsWith('/purchase')) {
      state.purchaseCalls += 1;
      if (state.purchaseMode === 'insufficient') {
        response = { request_id: body.request_id, status: 'FAILED', error: 'insufficient_balance' };
      } else if (state.purchaseMode === 'pending') {
        status = 202;
        response = { request_id: body.request_id, status: 'PENDING_RECOVERY' };
      } else if (state.purchaseMode === 'received') {
        // Real Bot: an in-flight/replayed purchase request (HTTP 202).
        status = 202;
        response = { request_id: body.request_id, status: 'RECEIVED' };
      } else if (state.purchaseMode === 'processing') {
        status = 202;
        response = { request_id: body.request_id, status: 'PROCESSING' };
      } else {
        const txId = `tx-${state.purchaseCalls}`;
        response = {
          request_id: body.request_id,
          status: 'COMPLETED',
          tx_id: txId,
          product_id: 1,
          product_name: 'Test Ticket',
          amount: 30,
          balance_before: 100,
          balance_after: 70,
          ticket_event_id: `evt_${txId}`,
        };
      }
    } else {
      status = 404;
      response = { error: 'not_found' };
    }

    return jsonResponse(status, response, secret, state.badResponseSignature);
  };

  return state;
}

export function restoreFetch(): void {
  (globalThis as any).fetch = originalFetch;
}
