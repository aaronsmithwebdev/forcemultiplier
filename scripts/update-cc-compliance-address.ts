import assert from "node:assert/strict";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { db } from "../lib/db";
import { connection, providerRequest } from "../lib/providers";

type Address = {
  organization_name: string;
  address_line1: string;
  address_line2?: string;
  address_line3?: string;
  address_optional?: string;
  city: string;
  state_name?: string;
  state_code?: string;
  postal_code: string;
  country_code: string;
  country_name?: string;
};

export function updatedAddress(current: Address, target: Address): Address {
  return {
    ...current,
    ...target,
    address_line2: target.address_line2 || "",
    address_line3: target.address_line3 || "",
    address_optional: target.address_optional || "",
  };
}

export function sameAddress(current: Address, target: Address) {
  return (
    Object.entries(target).every(
      ([key, value]) =>
        (key === "state_name" && !current.state_name) ||
        current[key as keyof Address] === value,
    ) &&
    (["address_line2", "address_line3", "address_optional"] as const).every(
      (key) => (current[key] || "") === (target[key] || ""),
    )
  );
}

export function editable(activity: any) {
  return (
    activity.role === "primary_email" &&
    (activity.current_status === "DRAFT" ||
      (activity.current_status === "DONE" &&
        [3, 4, 5].includes(activity.format_type)))
  );
}

async function main() {
  const [mode, arg, extra] = process.argv.slice(2);
  const backupPath = mode === "apply" ? arg : undefined;
  if (!["plan", "apply"].includes(mode) || (mode === "apply" && !backupPath))
    throw new Error(
      "Usage: node --env-file=.env --import tsx scripts/update-cc-compliance-address.ts plan [MAX_CAMPAIGNS] | apply BACKUP.jsonl [MAX_UPDATES]",
    );
  const max =
    (mode === "plan" ? arg : extra) === undefined
      ? Infinity
      : Number(mode === "plan" ? arg : extra);
  assert.ok(
    (Number.isSafeInteger(max) && max > 0) || max === Infinity,
    "Limit must be positive",
  );
  const account = await connection("constant-contact");
  assert.ok(
    account.externalId && account.tokens,
    "Constant Contact is not connected",
  );
  const guard = { externalId: account.externalId };
  let nextCallAt = 0;
  const call = async (path: string, init?: RequestInit) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const now = Date.now();
        const wait = Math.max(0, nextCallAt - now);
        nextCallAt = Math.max(now, nextCallAt) + 300;
        await new Promise((resolve) => setTimeout(resolve, wait));
        return await providerRequest("constant-contact", path, init, guard);
      } catch (error: any) {
        if (error.status !== 429 || attempt === 5) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 2000 * (attempt + 1)),
        );
      }
    }
  };
  const [summary, defaultAddress] = await Promise.all([
    call("/v3/account/summary"),
    call("/v3/account/summary/physical_address"),
  ]);
  assert.equal(
    summary.encoded_account_id,
    account.externalId,
    "Connected account changed",
  );
  const target: Address = {
    ...defaultAddress,
    organization_name: summary.organization_name,
  };
  for (const key of [
    "organization_name",
    "address_line1",
    "city",
    "postal_code",
    "country_code",
  ] as const)
    assert.ok(target[key], `Account address is missing ${key}`);
  assert.match(target.country_code, /^[a-z]{2}$/i);
  assert.ok(
    target.state_name || target.state_code,
    "Account address is missing its state",
  );
  assert.ok(
    target.address_line1.trim().toLowerCase().includes("727 george st") &&
      target.city.trim().toLowerCase() === "haymarket",
    "Connected account does not show the expected new George Street address.",
  );
  console.log(
    JSON.stringify({
      account: account.label,
      accountAddress: defaultAddress,
      target,
    }),
  );
  const backup = mode === "apply" ? openSync(backupPath!, "ax", 0o600) : null;
  const archived = await db.archivedEmail.findMany({
    where: { accountId: account.externalId, role: "primary_email" },
    select: { campaignId: true, activityId: true },
  });
  const activityIds = new Map(
    archived.map((row) => [row.campaignId, row.activityId]),
  );
  const counts = { scanned: 0, changed: 0, alreadyCurrent: 0, unsupported: 0 };
  const addresses = new Map<string, number>();
  const seen = new Set<string>();
  let path: string | null = "/v3/emails?limit=500";
  try {
    const campaigns: any[] = [];
    while (path) {
      assert.ok(!seen.has(path), "Campaign pagination repeated");
      seen.add(path);
      const page = await call(path);
      assert.ok(Array.isArray(page.campaigns), "Campaign page is incomplete");
      campaigns.push(...page.campaigns);
      const next = page._links?.next?.href;
      if (next) {
        const url = new URL(next, "https://api.cc.email");
        assert.equal(url.origin, "https://api.cc.email");
        assert.equal(url.pathname, "/v3/emails");
        path = url.pathname + url.search;
      } else path = null;
    }
    console.log(JSON.stringify({ campaignCount: campaigns.length }));
    const processCampaign = async (campaign: any) => {
      counts.scanned++;
      if (
        !["DRAFT", "DONE"].includes(
          String(campaign.current_status).toUpperCase(),
        )
      ) {
        counts.unsupported++;
        return;
      }
      let activityId = activityIds.get(campaign.campaign_id);
      if (!activityId) {
        const detail = await call(
          `/v3/emails/${encodeURIComponent(campaign.campaign_id)}`,
        );
        assert.ok(
          Array.isArray(detail.campaign_activities),
          "Campaign activities are incomplete",
        );
        activityId = detail.campaign_activities.find(
          (row: any) => row.role === "primary_email",
        )?.campaign_activity_id;
      }
      if (!activityId) {
        counts.unsupported++;
        return;
      }
      const activityPath = `/v3/emails/activities/${encodeURIComponent(activityId)}`;
      const activity = await call(
        activityPath + "?include=physical_address_in_footer",
      );
      if (!editable(activity)) {
        counts.unsupported++;
        return;
      }
      const current = activity.physical_address_in_footer || {};
      const addressLabel = [
        current.address_line1,
        current.address_line2,
        current.city,
        current.postal_code,
      ]
        .filter(Boolean)
        .join(", ");
      addresses.set(addressLabel, (addresses.get(addressLabel) || 0) + 1);
      const replacement = updatedAddress(current, target);
      if (sameAddress(current, target)) {
        counts.alreadyCurrent++;
        return;
      }
      if (mode === "plan") {
        counts.changed++;
        return;
      }
      writeSync(
        backup!,
        JSON.stringify({ campaign: campaign.name, activity }) + "\n",
      );
      fsyncSync(backup!);
      const result = await call(activityPath, {
        method: "PUT",
        body: JSON.stringify({
          ...activity,
          physical_address_in_footer: replacement,
        }),
      });
      const verified = result.physical_address_in_footer
        ? result
        : await call(activityPath + "?include=physical_address_in_footer");
      assert.ok(
        sameAddress(verified.physical_address_in_footer, target),
        `Address verification failed: ${campaign.name}`,
      );
      counts.changed++;
      console.log(
        JSON.stringify({
          updated: campaign.name,
          activityId,
        }),
      );
      if (counts.scanned % 50 === 0) console.log(JSON.stringify(counts));
    };
    const batchSize = max === Infinity ? 4 : 1;
    for (let i = 0; i < campaigns.length; i += batchSize) {
      if ((mode === "apply" ? counts.changed : counts.scanned) >= max) break;
      const results = await Promise.allSettled(
        campaigns.slice(i, i + batchSize).map(processCampaign),
      );
      for (const result of results)
        if (result.status === "rejected") throw result.reason;
    }
  } finally {
    if (backup !== null) closeSync(backup);
  }
  console.log(
    JSON.stringify({ ...counts, addresses: [...addresses.entries()] }),
  );
}

if (process.argv[1]?.endsWith("update-cc-compliance-address.ts"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
