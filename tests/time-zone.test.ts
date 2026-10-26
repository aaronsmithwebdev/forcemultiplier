import assert from "node:assert/strict";
import test from "node:test";
import { formatDate } from "../lib/time-zone";

test("Sydney display time follows daylight saving and differs from UTC", () => {
  const summer = "2026-01-01T00:30:00.000Z";
  const winter = "2026-06-01T00:30:00.000Z";
  assert.match(formatDate(summer, "Australia/Sydney"), /11:30:00 am AEDT/);
  assert.match(formatDate(winter, "Australia/Sydney"), /10:30:00 am AEST/);
  assert.match(formatDate(summer, "UTC"), /12:30:00 am UTC/);
});
