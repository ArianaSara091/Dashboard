import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetGuildDashboardParams,
  GetGuildDashboardResponse,
  GetGuildReportsBody,
  GetGuildReportsParams,
  GetGuildReportsResponse,
  GetGuildSettingsParams,
  GetGuildSettingsResponse,
  ListGuildStaffBody,
  ListGuildStaffParams,
  ListGuildStaffResponse,
  ListManagedGuildsResponse,
  UpdateGuildSettingsBody,
  UpdateGuildSettingsParams,
  UpdateGuildSettingsResponse,
  UpdateGuildStaffBody,
  UpdateGuildStaffParams,
  UpdateGuildStaffResponse,
} from "@workspace/api-zod";
import { db, guildSettingsTable, authSessionsTable } from "@workspace/db";
import {
  requireVampireCsrf,
  requireVampireSession,
  clearSessionCookies,
} from "../middlewares/vampire-auth";
import {
  canManageDiscordGuild,
  DiscordSessionExpiredError,
  listDiscordGuilds,
  type DiscordGuild,
} from "../lib/vampire-discord";
import {
  isActivityIntegrationConfigured,
  readGuildBotStatuses,
  readGuildReports,
  readGuildStaff,
  writeGuildStaff,
} from "../lib/vampire-activity";
import { guildPermissionLabel } from "../lib/vampire-security";
import { memoryRateLimit } from "../lib/vampire-rate-limit";

const router: IRouter = Router();
const guildRateLimit = memoryRateLimit("vampire-guild", 120, 60_000);
const invitePermissions = "66688";

function isSnowflake(value: string): boolean {
  return /^[0-9]{17,20}$/.test(value);
}

function guildIconUrl(guild: DiscordGuild): string | null {
  if (!guild.icon) return null;
  return `https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=128`;
}

function vampireInviteUrl(): string | null {
  const applicationId = process.env.VAMPIRE_BOT_APPLICATION_ID;
  if (!applicationId || !isSnowflake(applicationId)) return null;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", applicationId);
  url.searchParams.set("scope", "bot applications.commands");
  url.searchParams.set("permissions", invitePermissions);
  return url.toString();
}

function unavailableStaff(guildId: string) {
  return ListGuildStaffResponse.parse({
    guildId,
    available: false,
    message: "Staff data is unavailable until a real Vampire data integration is connected.",
    staff: [],
  });
}

function unavailableReport(guildId: string, from: string, to: string) {
  return GetGuildReportsResponse.parse({
    guildId,
    available: false,
    message: "Activity reports are unavailable until a real Vampire data integration is connected.",
    from,
    to,
    totals: null,
    staff: [],
  });
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validReportRange(from: string, to: string): boolean {
  if (!validDate(from) || !validDate(to) || from > to) return false;
  const days =
    (Date.parse(`${to}T00:00:00.000Z`) -
      Date.parse(`${from}T00:00:00.000Z`)) /
    86_400_000;
  return days <= 365;
}

async function accessibleGuild(
  req: Request,
  res: Response,
  guildId: string,
): Promise<DiscordGuild | null> {
  const session = req.vampireSession;
  if (!session) {
    res.status(401).json({ error: "Sign in with Discord to continue." });
    return null;
  }

  try {
    const result = await listDiscordGuilds(session);
    req.vampireSession = result.session;
    return (
      result.guilds.find(
        (guild) => guild.id === guildId && canManageDiscordGuild(guild),
      ) ?? null
    );
  } catch (error) {
    if (error instanceof DiscordSessionExpiredError) {
      await db
        .delete(authSessionsTable)
        .where(eq(authSessionsTable.sessionHash, session.sessionHash));
      clearSessionCookies(req, res);
      res.status(401).json({ error: "Discord authorization expired. Sign in again." });
      return null;
    }
    req.log.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Discord permission verification failed",
    );
    res
      .status(502)
      .json({ error: "Discord permissions could not be checked right now." });
    return null;
  }
}

async function loadSettings(guildId: string) {
  const [settings] = await db
    .select()
    .from(guildSettingsTable)
    .where(eq(guildSettingsTable.guildId, guildId))
    .limit(1);

  return GetGuildSettingsResponse.parse({
    guildId,
    staffRoleId: settings?.staffRoleId ?? null,
    timezone: settings?.timezone ?? "UTC",
    reportRangeDays: settings?.reportRangeDays ?? 7,
    updatedAt: (settings?.updatedAt ?? new Date()).toISOString(),
  });
}

async function botStatusForGuilds(
  guildIds: string[],
  req: Request,
): Promise<Map<string, "installed" | "not_installed" | "unknown">> {
  if (!isActivityIntegrationConfigured()) return new Map();
  try {
    return await readGuildBotStatuses(guildIds);
  } catch (error) {
    req.log.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Vampire installation status could not be checked",
    );
    return new Map();
  }
}

router.use("/guilds", guildRateLimit);

router.get(
  "/guilds",
  requireVampireSession,
  async (req, res): Promise<void> => {
    try {
      const session = req.vampireSession;
      if (!session) {
        res.status(401).json({ error: "Sign in with Discord to continue." });
        return;
      }
      const result = await listDiscordGuilds(session);
      req.vampireSession = result.session;
      const manageable = result.guilds.flatMap((guild) => {
        const permissionLabel = guildPermissionLabel(
          guild.owner === true,
          guild.permissions,
        );
        return permissionLabel ? [{ guild, permissionLabel }] : [];
      });
      const statusMap = await botStatusForGuilds(
        manageable.map(({ guild }) => guild.id),
        req,
      );
      const addUrl = vampireInviteUrl();
      const response = {
        guilds: manageable.map(({ guild, permissionLabel }) => {
          const botStatus = statusMap.get(guild.id) ?? "unknown";
          return {
            id: guild.id,
            name: guild.name,
            iconUrl: guildIconUrl(guild),
            permissionLabel,
            botStatus,
            inviteUrl: botStatus === "not_installed" ? addUrl : null,
          };
        }),
        integrationConfigured: isActivityIntegrationConfigured(),
      };
      res.json(ListManagedGuildsResponse.parse(response));
    } catch (error) {
      if (error instanceof DiscordSessionExpiredError) {
        if (req.vampireSession) {
          await db
            .delete(authSessionsTable)
            .where(
              eq(
                authSessionsTable.sessionHash,
                req.vampireSession.sessionHash,
              ),
            );
        }
        clearSessionCookies(req, res);
        res.status(401).json({ error: "Discord authorization expired. Sign in again." });
        return;
      }
      req.log.warn(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Unable to load managed Discord servers",
      );
      res
        .status(502)
        .json({ error: "Your Discord servers could not be loaded right now." });
    }
  },
);

router.get(
  "/guilds/:guildId",
  requireVampireSession,
  async (req, res): Promise<void> => {
    const params = GetGuildDashboardParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid server ID." });
      return;
    }
    const guild = await accessibleGuild(req, res, params.data.guildId);
    if (!guild) {
      if (!res.headersSent) {
        res.status(403).json({ error: "You cannot manage this Discord server." });
      }
      return;
    }

    try {
      const statuses = await botStatusForGuilds([guild.id], req);
      const botStatus = statuses.get(guild.id) ?? "unknown";
      const response = {
        guild: {
          id: guild.id,
          name: guild.name,
          iconUrl: guildIconUrl(guild),
          permissionLabel: guildPermissionLabel(
            guild.owner === true,
            guild.permissions,
          ),
          botStatus,
          inviteUrl:
            botStatus === "not_installed" ? vampireInviteUrl() : null,
        },
        settings: await loadSettings(guild.id),
        integrationAvailable: isActivityIntegrationConfigured(),
        integrationMessage: isActivityIntegrationConfigured()
          ? "Connected to Vampire activity data."
          : "No Vampire activity integration is connected yet.",
      };
      res.json(GetGuildDashboardResponse.parse(response));
    } catch (error) {
      req.log.error(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Unable to load server dashboard",
      );
      res.status(500).json({ error: "The server dashboard could not be loaded." });
    }
  },
);

router.post(
  "/guilds/:guildId/staff/search",
  requireVampireSession,
  requireVampireCsrf,
  async (req, res): Promise<void> => {
    const params = ListGuildStaffParams.safeParse(req.params);
    const body = ListGuildStaffBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "The staff search request is invalid." });
      return;
    }
    const guild = await accessibleGuild(req, res, params.data.guildId);
    if (!guild) {
      if (!res.headersSent) {
        res.status(403).json({ error: "You cannot manage this Discord server." });
      }
      return;
    }

    try {
      const response = await readGuildStaff(guild.id, body.data.search);
      res.json(response ?? unavailableStaff(guild.id));
    } catch (error) {
      req.log.warn(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Vampire staff integration request failed",
      );
      res
        .status(503)
        .json({ error: "Vampire staff data is temporarily unavailable." });
    }
  },
);

router.put(
  "/guilds/:guildId/staff/:userId",
  requireVampireSession,
  requireVampireCsrf,
  async (req, res): Promise<void> => {
    const params = UpdateGuildStaffParams.safeParse(req.params);
    const body = UpdateGuildStaffBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "The staff update request is invalid." });
      return;
    }
    const guild = await accessibleGuild(req, res, params.data.guildId);
    if (!guild) {
      if (!res.headersSent) {
        res.status(403).json({ error: "You cannot manage this Discord server." });
      }
      return;
    }

    try {
      const response = await writeGuildStaff(
        guild.id,
        params.data.userId,
        body.data.action,
      );
      if (!response) {
        res.status(503).json({
          error: "Staff changes require a configured Vampire data integration.",
        });
        return;
      }
      res.json(UpdateGuildStaffResponse.parse(response));
    } catch (error) {
      req.log.warn(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Vampire staff update failed",
      );
      res.status(503).json({ error: "The staff update could not be completed." });
    }
  },
);

router.post(
  "/guilds/:guildId/reports/query",
  requireVampireSession,
  requireVampireCsrf,
  async (req, res): Promise<void> => {
    const params = GetGuildReportsParams.safeParse(req.params);
    const body = GetGuildReportsBody.safeParse(req.body);
    if (
      !params.success ||
      !body.success ||
      !validReportRange(body.data.from, body.data.to)
    ) {
      res.status(400).json({
        error: "Choose a valid date range of 366 days or less.",
      });
      return;
    }
    const guild = await accessibleGuild(req, res, params.data.guildId);
    if (!guild) {
      if (!res.headersSent) {
        res.status(403).json({ error: "You cannot manage this Discord server." });
      }
      return;
    }

    try {
      const response = await readGuildReports(guild.id, body.data);
      res.json(
        response ?? unavailableReport(guild.id, body.data.from, body.data.to),
      );
    } catch (error) {
      req.log.warn(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Vampire report integration request failed",
      );
      res
        .status(503)
        .json({ error: "Vampire activity data is temporarily unavailable." });
    }
  },
);

router.get(
  "/guilds/:guildId/settings",
  requireVampireSession,
  async (req, res): Promise<void> => {
    const params = GetGuildSettingsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid server ID." });
      return;
    }
    const guild = await accessibleGuild(req, res, params.data.guildId);
    if (!guild) {
      if (!res.headersSent) {
        res.status(403).json({ error: "You cannot manage this Discord server." });
      }
      return;
    }

    try {
      res.json(await loadSettings(guild.id));
    } catch (error) {
      req.log.error(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Unable to load server settings",
      );
      res.status(500).json({ error: "Server settings could not be loaded." });
    }
  },
);

router.patch(
  "/guilds/:guildId/settings",
  requireVampireSession,
  requireVampireCsrf,
  async (req, res): Promise<void> => {
    const params = UpdateGuildSettingsParams.safeParse(req.params);
    const body = UpdateGuildSettingsBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "The settings request is invalid." });
      return;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: body.data.timezone });
    } catch {
      res.status(400).json({ error: "Choose a valid time zone." });
      return;
    }

    const guild = await accessibleGuild(req, res, params.data.guildId);
    if (!guild) {
      if (!res.headersSent) {
        res.status(403).json({ error: "You cannot manage this Discord server." });
      }
      return;
    }

    try {
      const [settings] = await db
        .insert(guildSettingsTable)
        .values({
          guildId: guild.id,
          staffRoleId: body.data.staffRoleId,
          timezone: body.data.timezone,
          reportRangeDays: body.data.reportRangeDays,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: guildSettingsTable.guildId,
          set: {
            staffRoleId: body.data.staffRoleId,
            timezone: body.data.timezone,
            reportRangeDays: body.data.reportRangeDays,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!settings) {
        res.status(500).json({ error: "The server settings were not saved." });
        return;
      }
      res.json(
        UpdateGuildSettingsResponse.parse({
          guildId: settings.guildId,
          staffRoleId: settings.staffRoleId,
          timezone: settings.timezone,
          reportRangeDays: settings.reportRangeDays,
          updatedAt: settings.updatedAt.toISOString(),
        }),
      );
    } catch (error) {
      req.log.error(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Unable to save server settings",
      );
      res.status(500).json({ error: "The server settings were not saved." });
    }
  },
);

export default router;
