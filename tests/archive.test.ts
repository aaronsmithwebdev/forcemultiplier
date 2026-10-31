import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveNextPath,
  archiveSearchWhere,
  completedSends,
  retryableArchiveError,
} from "../lib/archive";
import { AppError } from "../lib/errors";

test("archive pagination keeps the provider cursor and a bounded page size", () => {
  assert.equal(
    archiveNextPath(
      "https://api.cc.email/v3/emails?limit=50&next=opaque%2Bcursor",
    ),
    "/v3/emails?limit=1&next=opaque%2Bcursor",
  );
  assert.throws(
    () => archiveNextPath("https://other.example/v3/emails?next=x"),
    /invalid archive cursor/,
  );
});

test("archive search matches words in any order across searchable fields", () => {
  const expected = {
    accountId: "account",
    AND: ["sydney", "east", "2025", "results"].map((term) => ({
      OR: ["campaignName", "subject", "previewText"].map((field) => ({
        [field]: { contains: term, mode: "insensitive" },
      })),
    })),
  };
  assert.deepEqual(
    archiveSearchWhere("account", "sydney east 2025 results"),
    expected,
  );
  assert.deepEqual(
    archiveSearchWhere("account", "sydney-east, 2025 results"),
    expected,
  );
  assert.deepEqual(archiveSearchWhere("account", "  "), {
    accountId: "account",
  });
});

test("only completed sends qualify for the archive", () => {
  assert.deepEqual(
    completedSends([
      { send_status: "ERRORED" },
      { send_status: "COMPLETED", run_date: "2026-09-22T00:00:00Z" },
    ]),
    [{ send_status: "COMPLETED", run_date: "2026-09-22T00:00:00Z" }],
  );
  assert.throws(() => completedSends({}), /incomplete send history/);
});

test("a provider rate limit leaves the archive ready for its next scheduled step", () => {
  assert.equal(retryableArchiveError(new AppError("Rate limited", 429)), true);
  assert.equal(retryableArchiveError(new AppError("Forbidden", 403)), false);
  assert.equal(retryableArchiveError(new Error("Network failure")), false);
});
