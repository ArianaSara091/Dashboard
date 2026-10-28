import { createHash, timingSafeEqual } from "node:crypto";

export interface OAuthStateRecord {
  stateHash: string;
  browserHash: string;
  codeVerifierCipher: string;
  expiresAt: Date;
}

export interface OAuthStateStore {
  consume(input: {
    stateHash: string;
    browserHash: string;
    now: Date;
  }): Promise<OAuthStateRecord | null>;
}

export interface SessionStore {
  delete(sessionHash: string): Promise<boolean>;
}

export function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export async function consumeOAuthStateOnce(
  state: string | undefined,
  browserBinding: string | undefined,
  store: OAuthStateStore,
  now = new Date(),
): Promise<OAuthStateRecord | null> {
  if (
    !state ||
    !browserBinding ||
    !/^[A-Za-z0-9_-]{40,64}$/.test(state) ||
    browserBinding.length < 32
  ) {
    return null;
  }

  return store.consume({
    stateHash: hashOpaqueValue(state),
    browserHash: hashOpaqueValue(browserBinding),
    now,
  });
}

export async function logoutSessionOnce(
  sessionHash: string | undefined,
  store: SessionStore,
): Promise<boolean> {
  if (!sessionHash) return false;
  return store.delete(sessionHash);
}

export function guildPermissionLabel(
  owner: boolean,
  permissions: string | undefined,
): "Owner" | "Administrator" | "Manage Server" | null {
  if (owner) return "Owner";

  try {
    const bits = BigInt(permissions ?? "0");
    if ((bits & 8n) === 8n) return "Administrator";
    if ((bits & 32n) === 32n) return "Manage Server";
  } catch {
    return null;
  }

  return null;
}

export function isGuildScopeMatch(
  requestedGuildId: string,
  recordGuildId: unknown,
): boolean {
  return recordGuildId === requestedGuildId;
}

export function isSameOrigin(
  origin: string | undefined,
  requestHost: string | undefined,
  requestProtocol: string,
): boolean {
  if (!origin || !requestHost) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.host.toLowerCase() === requestHost.toLowerCase() &&
      parsed.protocol === `${requestProtocol.replace(/:$/, "")}:`
    );
  } catch {
    return false;
  }
}
