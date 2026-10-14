import test from "node:test";
import assert from "node:assert/strict";
import {
  editable,
  sameAddress,
  updatedAddress,
} from "../scripts/update-cc-compliance-address";

test("bulk address update clears old address lines and leaves campaign headers alone", () => {
  const current = {
    organization_name: "Mito Foundation",
    address_line1: "3/727 George St",
    address_line2: "Old suite",
    city: "Haymarket",
    state_name: "NSW",
    postal_code: "2000",
    country_code: "au",
    country_name: "Australia",
  };
  const target = {
    organization_name: "Mito Foundation",
    address_line1: "1 New St",
    city: "Sydney",
    state_name: "NSW",
    postal_code: "2001",
    country_code: "au",
  };
  const next = updatedAddress(current, target);
  assert.deepEqual(next, {
    ...current,
    ...target,
    address_line2: "",
    address_line3: "",
    address_optional: "",
  });
  assert.equal(sameAddress(current, target), false);
  assert.equal(sameAddress(next, target), true);
  assert.equal(sameAddress({ ...next, state_name: undefined }, target), true);
});

test("only draft or supported sent primary activities are changed", () => {
  assert.equal(
    editable({
      role: "primary_email",
      current_status: "DRAFT",
      format_type: 2,
    }),
    true,
  );
  assert.equal(
    editable({ role: "primary_email", current_status: "DONE", format_type: 4 }),
    true,
  );
  assert.equal(
    editable({ role: "primary_email", current_status: "DONE", format_type: 2 }),
    false,
  );
  assert.equal(
    editable({ role: "resend", current_status: "DONE", format_type: 4 }),
    false,
  );
  assert.equal(
    editable({
      role: "primary_email",
      current_status: "SCHEDULED",
      format_type: 4,
    }),
    false,
  );
});
