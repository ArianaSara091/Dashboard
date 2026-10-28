import {
  GetGuildReportsResponse,
  ListGuildStaffResponse,
  UpdateGuildStaffResponse,
} from "@workspace/api-zod";
import { isGuildScopeMatch } from "./vampire-security";

export class ActivityIntegrationError extends Error {
  constructor(message = "The activity integration is temporarily unavailable.") {
    super(message);
    this.name = "ActivityIntegrationError";
  }
}

export function isActivityIntegrationConfigured(): boolean {
  return Boolean(
    process.env.VAMPIRE_ACTIVITY_API_URL &&
      process.env.VAMPIRE_ACTIVITY_API_SECRET,
  );
}

function integrationConfig(): { baseUrl: URL; secret: string } {
  const rawUrl = process.env.VAMPIRE_ACTIVITY_API_URL;
  const secret = process.env.VAMPIRE_ACTIVITY_API_SECRET;
  if (!rawUrl || !secret) throw new ActivityIntegrationError();

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw new ActivityIntegrationError("The activity integration URL is invalid.");
  }
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.hostname === "localhost" ||
    baseUrl.hostname.endsWith(".local")
  ) {
    throw new ActivityIntegrationError("The activity integration URL is not allowed.");
  }
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  return { baseUrl, secret };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function requestIntegration(
  path: string,
  method: "GET" | "POST" | "PUT",
  expectedGuildIds: string[],
  body?: unknown,
): Promise<unknown> {
  const { baseUrl, secret } = integrationConfig();
  const url = new URL(path, baseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ActivityIntegrationError();
  }
  if (!response.ok) throw new ActivityIntegrationError();

  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > 1_000_000) throw new ActivityIntegrationError();

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ActivityIntegrationError();
  }

  if (expectedGuildIds.length === 1) {
    if (
      !isRecord(payload) ||
      !isGuildScopeMatch(expectedGuildIds[0]!, payload["guildId"])
    ) {
      throw new ActivityIntegrationError(
        "The activity integration returned data for a different server.",
      );
    }
  }
  return payload;
}

export async function readGuildStaff(
  guildId: string,
  search: string,
): Promise<ReturnType<typeof ListGuildStaffResponse.parse> | null> {
  if (!isActivityIntegrationConfigured()) return null;
  const payload = await requestIntegration(
    `v1/guilds/${encodeURIComponent(guildId)}/staff/search`,
    "POST",
    [guildId],
    { search },
  );
  return ListGuildStaffResponse.parse(payload);
}

export async function writeGuildStaff(
  guildId: string,
  userId: string,
  action: "grant" | "revoke",
): Promise<ReturnType<typeof UpdateGuildStaffResponse.parse> | null> {
  if (!isActivityIntegrationConfigured()) return null;
  const payload = await requestIntegration(
    `v1/guilds/${encodeURIComponent(guildId)}/staff/${encodeURIComponent(userId)}`,
    "PUT",
    [guildId],
    { action },
  );
  return UpdateGuildStaffResponse.parse(payload);
}

export async function readGuildReports(
  guildId: string,
  input: { from: string; to: string; sort: string },
): Promise<ReturnType<typeof GetGuildReportsResponse.parse> | null> {
  if (!isActivityIntegrationConfigured()) return null;
  const query = new URLSearchParams({
    from: input.from,
    to: input.to,
    sort: input.sort,
  });
  const payload = await requestIntegration(
    `v1/guilds/${encodeURIComponent(guildId)}/reports?${query.toString()}`,
    "GET",
    [guildId],
  );
  return GetGuildReportsResponse.parse(payload);
}

export async function readGuildBotStatuses(
  guildIds: string[],
): Promise<Map<string, "installed" | "not_installed" | "unknown">> {
  const statuses = new Map<
    string,
    "installed" | "not_installed" | "unknown"
  >();
  if (!isActivityIntegrationConfigured() || guildIds.length === 0) {
    return statuses;
  }

  const payload = await requestIntegration(
    "v1/guilds/statuses",
    "POST",
    guildIds,
    { guildIds },
  );
  if (!isRecord(payload) || !Array.isArray(payload["guilds"])) {
    throw new ActivityIntegrationError();
  }

  const allowedIds = new Set(guildIds);
  for (const item of payload["guilds"]) {
    if (!isRecord(item) || typeof item["guildId"] !== "string") continue;
    if (!allowedIds.has(item["guildId"])) {
      throw new ActivityIntegrationError(
        "The activity integration returned data for a different server.",
      );
    }
    const status = item["botStatus"];
    if (
      status === "installed" ||
      status === "not_installed" ||
      status === "unknown"
    ) {
      statuses.set(item["guildId"], status);
    }
  }
  return statuses;
}
