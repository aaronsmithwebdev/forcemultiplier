import assert from "node:assert/strict";
import test from "node:test";
import {
  funraisinContactId,
  funraisinId,
  funraisinPageUrl,
  funraisinRow,
} from "../lib/funraisin";

test("Funraisin records keep event and Salesforce identities distinct", () => {
  assert.equal(
    funraisinPageUrl(new URL("https://example.org/"), "events", 0, null)
      .pathname,
    "/api/events",
  );
  assert.equal(
    funraisinPageUrl(
      new URL("https://example.org/site/"),
      "donations",
      1000,
      null,
    ).pathname,
    "/site/api/donations",
  );
  const contact = "003ABCDEFGHIJKL";
  const linked = funraisinContactId(contact);
  assert.equal(linked?.length, 18);
  assert.equal(funraisinContactId(linked), linked);
  assert.equal(funraisinContactId(`${contact}AAA`), null);
  assert.equal(funraisinContactId("00vABCDEFGHIJKL"), null);
  assert.equal(funraisinId(0), null);

  assert.deepEqual(
    funraisinRow("events", {
      event_id: "42",
      event_name: " Autumn Walk ",
      event_date: "2026-10-17",
    }),
    { id: "42", name: "Autumn Walk", eventDate: new Date("2026-10-17") },
  );
  assert.deepEqual(
    funraisinRow("registrations", {
      history_id: "9",
      member_id: "7",
      event_id: "42",
      is_active: "Y",
      is_complete: "Y",
      is_paid: "Y",
      is_archived: "N",
      crm_history_id: "00vABCDEFGHIJKL",
    }),
    {
      id: "9",
      memberId: "7",
      eventId: "42",
      active: true,
      complete: true,
      isPaid: true,
      archived: false,
    },
  );
  assert.equal(
    funraisinRow("registrations", {
      history_id: "10",
      member_id: "7",
      event_id: "42",
      is_active: "N",
      is_complete: "",
      is_paid: "N",
      is_archived: "Y",
    }).complete,
    false,
  );
  assert.throws(() =>
    funraisinRow("registrations", {
      history_id: "11",
      is_active: "N",
      is_complete: "Y",
      is_paid: "maybe",
      is_archived: "N",
    }),
  );
  assert.deepEqual(
    funraisinRow("donations", {
      donation_id: "11",
      event_id: "42",
      member_id: "7",
      crm_donor_id: contact,
      d_fname: "Pat",
      d_lname: "Donor",
      d_email: "PAT@example.com",
      d_status: "paid",
      d_amount: "75.50",
      d_refund_amount: "10.00",
    }),
    {
      id: "11",
      eventId: "42",
      salesforceId: linked,
      name: "Pat Donor",
      email: "pat@example.com",
      status: "paid",
      amount: "75.50",
      refundAmount: "10.00",
    },
  );
  assert.throws(() =>
    funraisinRow("donations", {
      donation_id: "12",
      d_amount: "not money",
      d_refund_amount: "0.00",
    }),
  );
});
