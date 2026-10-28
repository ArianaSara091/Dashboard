import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consumeOAuthStateOnce,
  guildPermissionLabel,
  isGuildScopeMatch,
  logoutSessionOnce,
  type OAuthStateRecord,
} from "./vampire-security.ts";

describe("Vampire dashboard security helpers", () => {
  it("accepts an OAuth state once and rejects replay", async () => {
    const state = "a".repeat(43);
    const binding = "browser-binding-value-that-is-long-enough";
    const stateHash = "state-hash";
    const browserHash = "browser-hash";
    const records = new Map<string, OAuthStateRecord>([
      [
        stateHash,
        {
          stateHash,
          browserHash,
          codeVerifierCipher: "encrypted-verifier",
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        },
      ],
    ]);
    const store = {
      async consume(input: {
        stateHash: string;
        browserHash: string;
        now: Date;
      }): Promise<OAuthStateRecord | null> {
        const record = records.get(input.stateHash);
        if (
          !record ||
          record.browserHash !== input.browserHash ||
          record.expiresAt <= input.now
        ) {
          return null;
        }
        records.delete(input.stateHash);
        return record;
      },
    };

    const validState = "state-value-used-for-test-state";
    const validBinding = "browser-binding-value-that-is-long-enough";
    const hashes = await import("node:crypto");
    const hash = (value: string) =>
      hashes.createHash("sha256").update(value).digest("hex");
    records.set(hash(validState), {
      stateHash: hash(validState),
      browserHash: hash(validBinding),
      codeVerifierCipher: "encrypted-verifier",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    const first = await consumeOAuthStateOnce(
      validState,
      validBinding,
      store,
      new Date("2029-01-01T00:00:00.000Z"),
    );
    const replay = await consumeOAuthStateOnce(
      validState,
      validBinding,
      store,
      new Date("2029-01-01T00:00:00.000Z"),
    );

    assert.ok(first);
    assert.equal(replay, null);
    assert.equal(records.has(stateHash), false);
    assert.equal(state.length, 43);
    assert.equal(binding.length > 32, true);
  });

  it("rejects a state bound to a different browser or expired time", async () => {
    const store = {
      async consume(): Promise<OAuthStateRecord | null> {
        return null;
      },
    };
    assert.equal(
      await consumeOAuthStateOnce(
        "b".repeat(43),
        "different-browser-binding-that-is-long-enough",
        store,
      ),
      null,
    );
  });

  it("deletes a session once on logout", async () => {
    const active = new Set(["session-hash"]);
    const store = {
      async delete(sessionHash: string): Promise<boolean> {
        return active.delete(sessionHash);
      },
    };
    assert.equal(await logoutSessionOnce("session-hash", store), true);
    assert.equal(await logoutSessionOnce("session-hash", store), false);
    assert.equal(await logoutSessionOnce(undefined, store), false);
  });

  it("recognizes only owners, administrators, and Manage Server", () => {
    assert.equal(guildPermissionLabel(true, "0"), "Owner");
    assert.equal(guildPermissionLabel(false, "8"), "Administrator");
    assert.equal(guildPermissionLabel(false, "32"), "Manage Server");
    assert.equal(guildPermissionLabel(false, "0"), null);
    assert.equal(guildPermissionLabel(false, "not-a-bitset"), null);
  });

  it("does not accept records returned for another server", () => {
    assert.equal(isGuildScopeMatch("guild-1", "guild-1"), true);
    assert.equal(isGuildScopeMatch("guild-1", "guild-2"), false);
    assert.equal(isGuildScopeMatch("guild-1", undefined), false);
  });
});
