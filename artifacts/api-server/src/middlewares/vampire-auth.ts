import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { authSessionsTable, db } from "@workspace/db";
import {
  constantTimeEqual,
  hashOpaqueValue,
  isSameOrigin,
} from "../lib/vampire-security";

export const SESSION_COOKIE = "vampire_session";
export const CSRF_COOKIE = "vampire_csrf";
export const OAUTH_BROWSER_COOKIE = "vampire_oauth_browser";

export type VampireSession = typeof authSessionsTable.$inferSelect;

declare global {
  namespace Express {
    interface Request {
      vampireSession?: VampireSession;
      vampireSessionHash?: string;
    }
  }
}

function cookieOptions(req: Request, maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || req.secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function setSessionCookies(
  req: Request,
  res: Response,
  sessionId: string,
  csrfToken: string,
): void {
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  res.cookie(SESSION_COOKIE, sessionId, cookieOptions(req, maxAge));
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...cookieOptions(req, maxAge),
    httpOnly: false,
  });
}

export function clearSessionCookies(req: Request, res: Response): void {
  const options = cookieOptions(req, 0);
  res.clearCookie(SESSION_COOKIE, options);
  res.clearCookie(CSRF_COOKIE, { ...options, httpOnly: false });
}

export function setOAuthBrowserCookie(
  req: Request,
  res: Response,
  value: string,
): void {
  res.cookie(OAUTH_BROWSER_COOKIE, value, {
    ...cookieOptions(req, 10 * 60 * 1000),
    path: "/api/auth",
  });
}

export function clearOAuthBrowserCookie(req: Request, res: Response): void {
  res.clearCookie(OAUTH_BROWSER_COOKIE, {
    ...cookieOptions(req, 0),
    path: "/api/auth",
  });
}

export async function getVampireSession(
  req: Request,
  res: Response,
): Promise<VampireSession | null> {
  const opaqueSession = req.cookies?.[SESSION_COOKIE];
  if (typeof opaqueSession !== "string" || opaqueSession.length < 32) {
    return null;
  }

  const sessionHash = hashOpaqueValue(opaqueSession);
  const [session] = await db
    .select()
    .from(authSessionsTable)
    .where(eq(authSessionsTable.sessionHash, sessionHash))
    .limit(1);

  if (!session || session.expiresAt <= new Date()) {
    if (session) {
      await db
        .delete(authSessionsTable)
        .where(eq(authSessionsTable.sessionHash, sessionHash));
    }
    clearSessionCookies(req, res);
    return null;
  }

  req.vampireSessionHash = sessionHash;
  return session;
}

export async function requireVampireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await getVampireSession(req, res);
    if (!session) {
      res.status(401).json({ error: "Your session has expired. Sign in again." });
      return;
    }

    req.vampireSession = session;
    next();
  } catch (error) {
    req.log.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Failed to load dashboard session",
    );
    res.status(500).json({ error: "Unable to verify the current session." });
  }
}

export function requireVampireCsrf(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const protocol =
    req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  if (!isSameOrigin(req.get("origin"), req.get("host"), protocol)) {
    res.status(403).json({ error: "The request origin could not be verified." });
    return;
  }

  const csrfCookie = req.cookies?.[CSRF_COOKIE];
  const csrfHeader = req.get("x-csrf-token");
  const session = req.vampireSession;
  if (
    typeof csrfCookie !== "string" ||
    typeof csrfHeader !== "string" ||
    !session ||
    !constantTimeEqual(csrfCookie, csrfHeader) ||
    !constantTimeEqual(hashOpaqueValue(csrfHeader), session.csrfTokenHash)
  ) {
    res.status(403).json({ error: "The request could not be verified." });
    return;
  }

  next();
}

export async function getCsrfToken(
  req: Request,
  res: Response,
  session: VampireSession,
): Promise<string> {
  const current = req.cookies?.[CSRF_COOKIE];
  if (
    typeof current === "string" &&
    constantTimeEqual(hashOpaqueValue(current), session.csrfTokenHash)
  ) {
    return current;
  }

  const replacement = randomBytes(32).toString("base64url");
  await db
    .update(authSessionsTable)
    .set({ csrfTokenHash: hashOpaqueValue(replacement), updatedAt: new Date() })
    .where(eq(authSessionsTable.sessionHash, session.sessionHash));
  res.cookie(CSRF_COOKIE, replacement, {
    ...cookieOptions(req, 7 * 24 * 60 * 60 * 1000),
    httpOnly: false,
  });
  return replacement;
}
