import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const oauthStatesTable = pgTable("vampire_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  codeVerifierCipher: text("code_verifier_cipher").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const authSessionsTable = pgTable("vampire_auth_sessions", {
  sessionHash: text("session_hash").primaryKey(),
  discordUserId: text("discord_user_id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  accessTokenCipher: text("access_token_cipher").notNull(),
  refreshTokenCipher: text("refresh_token_cipher").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  csrfTokenHash: text("csrf_token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const guildSettingsTable = pgTable("vampire_guild_settings", {
  guildId: text("guild_id").primaryKey(),
  staffRoleId: text("staff_role_id"),
  timezone: text("timezone").notNull().default("UTC"),
  reportRangeDays: integer("report_range_days").notNull().default(7),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
