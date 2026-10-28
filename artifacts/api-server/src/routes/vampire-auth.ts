import { and, eq, gt, lt } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { GetAuthSessionResponse } from "@workspace/api-zod";
import { authSessionsTable, db, oauthStatesTable } from "@workspace/db";
import {
  clearOAuthBrowserCookie,
  clearSessionCookies,
  getVampireSession,
  OAUTH_BROWSER_COOKIE,
  requireVampireCsrf,
  requireVampireSession,
  setOAuthBrowserCookie,
  setSessionCookies,
  getCsrfToken,
} from "../middlewares/vampire-auth";
import {
  exchangeDiscordCode,
  getDiscordCurrentUser,
} from "../lib/vampire-discord";
import { decryptSecret, encryptSecret } from "../lib/vampire-crypto";
import {
  consumeOAuthStateOnce,
  hashOpaqueValue,
  logoutSessionOnce,
} from "../lib/vampire-security";
import { memoryRateLimit } from "../lib/vampire-rate-limit";

const router: IRouter = Router();
const oauthLimit = memoryRateLimit("vampire-oauth", 12, 60_000);
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function redirectAuthError(res: Response, reason: string): void {
  res.redirect(302, `/?auth=${encodeURIComponent(reason)}`);
}

function isOAuthConfigured(): boolean {
  return Boolean(
    process.env.DISCORD_CLIENT_ID &&
      process.env.DISCORD_CLIENT_SECRET &&
      process.env.DISCORD_REDIRECT_URI,
  );
}

router.get("/auth/discord", oauthLimit, async (req, res): Promise<void> => {
  if (!isOAuthConfigured()) {
    redirectAuthError(res, "not-configured");
    return;
  }

  const redirectUri = process.env.DISCORD_REDIRECT_URI!;
  let callback: URL;
  try {
    callback = new URL(redirectUri);
  } catch {
    redirectAuthError(res, "not-configured");
    return;
  }
  if (
    callback.pathname !== "/api/auth/discord/callback" ||
    callback.username ||
    callback.password ||
    (process.env.NODE_ENV === "production" && callback.protocol !== "https:")
  ) {
    redirectAuthError(res, "not-configured");
    return;
  }

  try {
    const existingBinding = req.cookies?.[OAUTH_BROWSER_COOKIE];
    const browserBinding =
      typeof existingBinding === "string" && existingBinding.length >= 32
        ? existingBinding
        : randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256")
      .update(verifier, "utf8")
      .digest("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db
      .delete(oauthStatesTable)
      .where(lt(oauthStatesTable.expiresAt, new Date()));
    await db.insert(oauthStatesTable).values({
      stateHash: hashOpaqueValue(state),
      browserHash: hashOpaqueValue(browserBinding),
      codeVerifierCipher: encryptSecret(verifier),
      expiresAt,
    });

    setOAuthBrowserCookie(req, res, browserBinding);
    const authorizationUrl = new URL("https://discord.com/oauth2/authorize");
    authorizationUrl.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID!);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "identify guilds");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    res.redirect(302, authorizationUrl.toString());
  } catch (error) {
    req.log.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Unable to start Discord OAuth",
    );
    redirectAuthError(res, "failed");
  }
});

router.get(
  "/auth/discord/callback",
  oauthLimit,
  async (req, res): Promise<void> => {
    const state = typeof req.query["state"] === "string" ? req.query["state"] : undefined;
    const binding = req.cookies?.[OAUTH_BROWSER_COOKIE];
    const store = {
      async consume(input: {
        stateHash: string;
        browserHash: string;
        now: Date;
      }) {
        const [record] = await db
          .delete(oauthStatesTable)
          .where(
            and(
              eq(oauthStatesTable.stateHash, input.stateHash),
              eq(oauthStatesTable.browserHash, input.browserHash),
              gt(oauthStatesTable.expiresAt, input.now),
            ),
          )
          .returning();
        return record ?? null;
      },
    };

    try {
      const oauthState = await consumeOAuthStateOnce(
        state,
        binding,
        store,
        new Date(),
      );
      clearOAuthBrowserCookie(req, res);
      if (!oauthState) {
        redirectAuthError(res, "invalid-state");
        return;
      }

      const oauthError =
        typeof req.query["error"] === "string" ? req.query["error"] : undefined;
      if (oauthError) {
        redirectAuthError(
          res,
          oauthError === "access_denied" ? "denied" : "failed",
        );
        return;
      }

      const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
      if (!code || code.length > 2048) {
        redirectAuthError(res, "failed");
        return;
      }

      const verifier = decryptSecret(oauthState.codeVerifierCipher);
      const tokens = await exchangeDiscordCode(code, verifier);
      const discordUser = await getDiscordCurrentUser(tokens.accessToken);
      const sessionId = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const sessionHash = hashOpaqueValue(sessionId);
      const oldSessionId = req.cookies?.["vampire_session"];

      if (typeof oldSessionId === "string" && oldSessionId.length >= 32) {
        await db
          .delete(authSessionsTable)
          .where(eq(authSessionsTable.sessionHash, hashOpaqueValue(oldSessionId)));
      }

      const fallbackAvatar = (() => {
        try {
          return Number((BigInt(discordUser.id) >> 22n) % 6n);
        } catch {
          return 0;
        }
      })();
      const avatarUrl = discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordUser.id)}/${encodeURIComponent(discordUser.avatar)}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${fallbackAvatar}.png?size=128`;

      await db.insert(authSessionsTable).values({
        sessionHash,
        discordUserId: discordUser.id,
        username: discordUser.username,
        displayName: discordUser.global_name ?? discordUser.username,
        avatarUrl,
        accessTokenCipher: encryptSecret(tokens.accessToken),
        refreshTokenCipher: encryptSecret(tokens.refreshToken),
        accessTokenExpiresAt: tokens.expiresAt,
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        csrfTokenHash: hashOpaqueValue(csrfToken),
        updatedAt: new Date(),
      });

      setSessionCookies(req, res, sessionId, csrfToken);
      res.redirect(302, "/servers");
    } catch (error) {
      req.log.warn(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Discord OAuth callback did not complete",
      );
      clearSessionCookies(req, res);
      redirectAuthError(res, "failed");
    }
  },
);

router.get("/auth/me", async (req, res): Promise<void> => {
  try {
    const session = await getVampireSession(req, res);
    if (!session) {
      res.json(
        GetAuthSessionResponse.parse({
          authenticated: false,
          user: null,
          csrfToken: null,
        }),
      );
      return;
    }

    const csrfToken = await getCsrfToken(req, res, session);
    res.json(
      GetAuthSessionResponse.parse({
        authenticated: true,
        user: {
          id: session.discordUserId,
          username: session.username,
          displayName: session.displayName,
          avatarUrl: session.avatarUrl,
        },
        csrfToken,
      }),
    );
  } catch (error) {
    req.log.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Unable to read dashboard session",
    );
    res.status(500).json({ error: "Unable to read the current session." });
  }
});

router.post(
  "/auth/logout",
  requireVampireSession,
  requireVampireCsrf,
  async (req, res): Promise<void> => {
    try {
      await logoutSessionOnce(req.vampireSessionHash, {
        async delete(sessionHash) {
          const deleted = await db
            .delete(authSessionsTable)
            .where(eq(authSessionsTable.sessionHash, sessionHash))
            .returning({ sessionHash: authSessionsTable.sessionHash });
          return deleted.length > 0;
        },
      });
      clearSessionCookies(req, res);
      clearOAuthBrowserCookie(req, res);
      res.sendStatus(204);
    } catch (error) {
      req.log.error(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Unable to end dashboard session",
      );
      res.status(500).json({ error: "Unable to sign out right now." });
    }
  },
);

export default router;
