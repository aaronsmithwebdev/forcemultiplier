import test from "node:test";
import assert from "node:assert/strict";
import { archiveNextPath, completedSends } from "../lib/archive";

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
