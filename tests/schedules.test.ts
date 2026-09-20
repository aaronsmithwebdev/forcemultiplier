import test from "node:test";
import assert from "node:assert/strict";
import { deliveryIssueCutoff, nextRunAt } from "../lib/schedules";

test("delivery issue details expire after 90 days", () => {
  assert.equal(
    deliveryIssueCutoff(new Date("2026-09-20T03:00:00.000Z")).toISOString(),
    "2026-06-22T03:00:00.000Z",
  );
});

test("daily and weekly schedules use the saved local time zone", () => {
  const after = new Date("2026-09-20T22:30:00.000Z");
  assert.equal(
    nextRunAt(
      {
        cadence: "daily",
        intervalHours: null,
        localTime: "09:00",
        weekday: null,
        timeZone: "Australia/Sydney",
      },
      after,
    ).toISOString(),
    "2026-09-20T23:00:00.000Z",
  );
  assert.equal(
    nextRunAt(
      {
        cadence: "weekly",
        intervalHours: null,
        localTime: "09:00",
        weekday: 1,
        timeZone: "Australia/Sydney",
      },
      after,
    ).toISOString(),
    "2026-09-20T23:00:00.000Z",
  );
});

test("hourly schedules retain their interval anchor without drift", () => {
  assert.equal(
    nextRunAt(
      {
        cadence: "hours",
        intervalHours: 2,
        localTime: null,
        weekday: null,
        timeZone: "Australia/Sydney",
      },
      new Date("2026-09-20T05:01:00.000Z"),
      new Date("2026-09-20T00:00:00.000Z"),
    ).toISOString(),
    "2026-09-20T06:00:00.000Z",
  );
});

test("a missing daylight-saving clock time advances to the next valid day", () => {
  assert.equal(
    nextRunAt(
      {
        cadence: "daily",
        intervalHours: null,
        localTime: "02:30",
        weekday: null,
        timeZone: "Australia/Sydney",
      },
      new Date("2026-10-03T15:00:00.000Z"),
    ).toISOString(),
    "2026-10-04T15:30:00.000Z",
  );
});
