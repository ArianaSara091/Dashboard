import { eq } from "drizzle-orm";
import { authSessionsTable, db } from "@workspace/db";
import { decryptSecret, encryptSecret } from "./vampire-crypto";
import { guildPermissionLabel } from "./vampire-security";
import type { VampireSession } from "../middlewares/vampire-auth";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_OAUTH = "https://discord.com/api/oauth2";

export interface DiscordOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: string;
}

export class DiscordSessionExpiredError extends Error {
  constructor() {
    super("Discord authorization has expired.");
    this.name = "DiscordSessionExpiredError";
  }
}

function oauthConfig() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Discord OAuth settings are incomplete.");
  }
  return { clientId, clientSecret, redirectUri };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function postTokenForm(body: URLSearchParams): Promise<DiscordOAuthTokens> {
  const config = oauthConfig();
  const response = await fetch(`${DISCORD_OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload)) {
    throw new Error("Discord rejected the OAuth token request.");
  }

  const accessToken = payload["access_token"];
  const refreshToken = payload["refresh_token"];
  const expiresIn = payload["expires_in"];
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error("Discord returned an invalid OAuth token response.");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

export async function exchangeDiscordCode(
  code: string,
  verifier: string,
): Promise<DiscordOAuthTokens> {
  const config = oauthConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });
  return postTokenForm(body);
}

async function refreshDiscordTokens(
  session: VampireSession,
): Promise<{ session: VampireSession; accessToken: string }> {
  const config = oauthConfig();
  const refreshToken = decryptSecret(session.refreshTokenCipher);
  let tokens: DiscordOAuthTokens;
  try {
    tokens = await postTokenForm(
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        redirect_uri: config.redirectUri,
      }),
    );
  } catch {
    throw new DiscordSessionExpiredError();
  }

  const [updated] = await db
    .update(authSessionsTable)
    .set({
      accessTokenCipher: encryptSecret(tokens.accessToken),
      refreshTokenCipher: encryptSecret(tokens.refreshToken),
      accessTokenExpiresAt: tokens.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(authSessionsTable.sessionHash, session.sessionHash))
    .returning();

  if (!updated) throw new DiscordSessionExpiredError();
  return { session: updated, accessToken: tokens.accessToken };
}

export async function getValidDiscordAccessToken(
  session: VampireSession,
): Promise<{ session: VampireSession; accessToken: string }> {
  if (session.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return { session, accessToken: decryptSecret(session.accessTokenCipher) };
  }
  return refreshDiscordTokens(session);
}

async function discordGet(
  path: string,
  accessToken: string,
): Promise<Response> {
  return fetch(`${DISCORD_API}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
}

export async function getDiscordCurrentUser(
  accessToken: string,
): Promise<DiscordUser> {
  const response = await discordGet("/users/@me", accessToken);
  if (!response.ok) throw new Error("Discord could not verify the user.");
  const payload: unknown = await response.json();
  if (
    !isRecord(payload) ||
    typeof payload["id"] !== "string" ||
    typeof payload["username"] !== "string"
  ) {
    throw new Error("Discord returned an invalid user profile.");
  }
  return payload as unknown as DiscordUser;
}

export async function listDiscordGuilds(
  startingSession: VampireSession,
): Promise<{ session: VampireSession; guilds: DiscordGuild[] }> {
  let { session, accessToken } =
    await getValidDiscordAccessToken(startingSession);
  let response = await discordGet("/users/@me/guilds?limit=200", accessToken);

  if (response.status === 401) {
    ({ session, accessToken } = await refreshDiscordTokens(session));
    response = await discordGet("/users/@me/guilds?limit=200", accessToken);
  }

  if (response.status === 401) throw new DiscordSessionExpiredError();
  if (!response.ok) {
    throw new Error(`Discord guild lookup failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Discord returned an invalid server list.");
  }

  const guilds: DiscordGuild[] = [];
  for (const row of payload) {
    if (
      !isRecord(row) ||
      typeof row["id"] !== "string" ||
      typeof row["name"] !== "string"
    ) {
      continue;
    }
    guilds.push({
      id: row["id"],
      name: row["name"],
      icon: typeof row["icon"] === "string" ? row["icon"] : null,
      owner: row["owner"] === true,
      permissions:
        typeof row["permissions"] === "string" ? row["permissions"] : "0",
    });
  }
  return { session, guilds };
}

export function canManageDiscordGuild(guild: DiscordGuild): boolean {
  return Boolean(guildPermissionLabel(guild.owner === true, guild.permissions));
}
