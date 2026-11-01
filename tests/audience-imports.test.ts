import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { encrypt } from "../lib/security";
import {
  parseAudienceImport,
  previewAudienceImport,
  commitAudienceImport,
} from "../lib/audience-imports";
import { linkPeople, sourcePeople } from "../lib/people";

test("list parsing reuses CSV quoting and preserves row diagnostics and optional names", () => {
  const rows = parseAudienceImport(
    '\uFEFFEmail Address,First Name,Last Name\r\n A@Example.org ,"Mary, Jane","O""Neil"\r\na@example.org,Dup,\r\nbad,Invalid,\r\nb@example.org,Bee,',
    "csv",
  );
  assert.equal(rows.length, 4);
  assert.equal(rows[0].email, "a@example.org");
  assert.equal(rows[0].firstName, "Mary, Jane");
  assert.equal(rows[0].lastName, 'O"Neil');
  assert.deepEqual(
    rows.map((r) => r.status),
    ["new", "duplicate", "invalid", "new"],
  );
  assert.deepEqual(
    parseAudienceImport(
      " A@example.org; b@example.org\na@example.org",
      "paste",
    ).map((r) => r.status),
    ["new", "new", "duplicate"],
  );
  assert.throws(
    () => parseAudienceImport('Email,First Name\na@example.org,"bad', "csv"),
    /unclosed/,
  );
  assert.throws(
    () =>
      parseAudienceImport(
        Array.from({ length: 2001 }, (_, i) => `p${i}@example.org`).join("\n"),
        "paste",
      ),
    /2,000/,
  );
});
function mock(t: TestContext, target: any, key: string, fn: any) {
  const original = target[key];
  target[key] = fn;
  t.after(() => {
    target[key] = original;
  });
}
function setup(t: TestContext) {
  const old = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  t.after(() => {
    if (old === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = old;
  });
  const people: any[] = [];
  const imports = new Map<string, any>();
  const memberships: any[] = [];
  const suppressions: any[] = [];
  const audits: any[] = [];
  let crm: any[] = [];
  let orgId = "org";
  let version = 0;
  const match = (where: any, p: any): boolean =>
    (!where.orgId || where.orgId === p.orgId) &&
    (!where.OR || where.OR.some((item: any) => match(item, p))) &&
    (!where.id || typeof where.id === "string"
      ? !where.id || where.id === p.id
      : where.id.in.includes(p.id)) &&
    (!where.email || typeof where.email === "string"
      ? !where.email || where.email === p.email
      : where.email.in.includes(p.email)) &&
    (!Object.hasOwn(where, "mergedIntoId") ||
      where.mergedIntoId === p.mergedIntoId);
  const person = {
    findMany: async ({ where }: any) =>
      people
        .filter((p) => match(where, p))
        .map((p) => ({ ...p }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    createMany: async ({ data }: any) => {
      for (const row of data)
        people.push({
          salesforceId: null,
          mergedIntoId: null,
          optedOut: false,
          unavailable: false,
          ...row,
        });
      return { count: data.length };
    },
    findUniqueOrThrow: async ({ where }: any) => ({
      ...people.find((p) => p.id === where.id),
    }),
    update: async ({ where, data }: any) => {
      const p = people.find((p) => p.id === where.id);
      Object.assign(p, data);
      return { ...p };
    },
    updateMany: async ({ where, data }: any) => {
      for (const p of people.filter((p) => match(where, p)))
        Object.assign(p, data);
      return { count: 1 };
    },
  };
  const tx: any = {
    person,
    $executeRaw: async () => 0,
    $queryRaw: async (sql: any) => {
      const result = [];
      for (let i = 0; i < sql.values.length; i += 7) {
        const [id, orgId, salesforceId, email, firstName, lastName, optedOut] =
          sql.values.slice(i, i + 7);
        let p = people.find(
          (p) => p.orgId === orgId && p.salesforceId === salesforceId,
        );
        if (!p) {
          p = {
            id,
            orgId,
            salesforceId,
            source: "salesforce",
            mergedIntoId: null,
          };
          people.push(p);
        }
        Object.assign(p, {
          email,
          firstName,
          lastName,
          optedOut,
          unavailable: false,
        });
        result.push({ ...p });
      }
      return result;
    },
    personEmail: {
      createMany: async () => ({ count: 0 }),
      findMany: async () => [{ email: "old@example.org" }],
    },
    personSource: {
      create: async ({ data }: any) => audits.push(data),
      updateMany: async () => ({ count: 1 }),
    },
    funraisinParticipant: { updateMany: async () => ({ count: 1 }) },
    funraisinDonation: { updateMany: async () => ({ count: 1 }) },
    suppressionEvent: { updateMany: async () => ({ count: 1 }) },
    audience: {
      findFirst: async ({ where }: any) => ({ id: where.id, orgId }),
      create: async ({ data }: any) => ({ id: "audience", ...data }),
      update: async () => ({}),
    },
    audienceImport: {
      create: async ({ data }: any) => {
        const item = {
          id: `preview-${++version}`,
          createdAt: new Date(),
          status: "preview",
          ...data,
        };
        imports.set(item.id, item);
        return structuredClone(item);
      },
      findUnique: async ({ where }: any) =>
        structuredClone(imports.get(where.id)),
      updateMany: async ({ where, data }: any) => {
        const p = imports.get(where.id);
        if (p.status !== where.status) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      },
      update: async ({ where, data }: any) =>
        Object.assign(imports.get(where.id), data),
    },
    manualAudienceMember: {
      findMany: async ({ where }: any) =>
        memberships
          .filter(
            (m) =>
              m.audienceId === where.audienceId &&
              where.email.in.includes(m.email),
          )
          .map((m) => ({
            ...m,
            person: { ...people.find((p) => p.id === m.personId) },
          })),
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const row of data)
          if (
            !memberships.some(
              (m) => m.audienceId === row.audienceId && m.email === row.email,
            )
          ) {
            memberships.push(row);
            count++;
          }
        return { count };
      },
    },
  };
  for (const [key, delegate] of Object.entries(tx))
    if (key.startsWith("$")) continue;
    else
      for (const [method, fn] of Object.entries(delegate as any))
        mock(t, (db as any)[key], method, fn);
  mock(t, db, "$transaction", async (fn: any) => {
    const before = structuredClone({ people, imports, memberships });
    try {
      return await fn(tx);
    } catch (error) {
      people.splice(0, people.length, ...before.people);
      memberships.splice(0, memberships.length, ...before.memberships);
      imports.clear();
      for (const [k, v] of before.imports) imports.set(k, v);
      throw error;
    }
  });
  mock(t, db.connection, "findUnique", async () => ({
    provider: "salesforce",
    externalId: orgId,
    version: 1,
    instanceUrl: "https://example.my.salesforce.com",
    tokens: encrypt(
      JSON.stringify({ accessToken: "test", refreshToken: "test" }),
    ),
    expiresAt: new Date(Date.now() + 3_600_000),
  }));
  mock(t, db.contactMirrorSync, "findUnique", async () => null);
  mock(t, db.suppression, "findMany", async () => suppressions);
  mock(t, globalThis, "fetch", async () =>
    Response.json({ done: true, totalSize: crm.length, records: crm }),
  );
  return {
    people,
    imports,
    memberships,
    suppressions,
    audits,
    tx,
    setCrm: (v: any[]) => {
      crm = v;
    },
    setOrg: (v: string) => {
      orgId = v;
    },
  };
}
const input = {
  name: "List",
  text: "new@example.org",
  format: "paste" as const,
};
test("unmatched imports keep local IDs and repeated imports preserve names and memberships", async (t) => {
  const f = setup(t);
  const first = await previewAudienceImport(
    {
      ...input,
      text: "Email,First Name\nnew@example.org,Original",
      format: "csv",
    },
    "user",
  );
  const result = await commitAudienceImport(first.id, {}, "user");
  assert.equal(result.added, 1);
  const id = f.people[0].id;
  assert.ok(id);
  assert.equal(f.people[0].salesforceId, null);
  const repeated = await previewAudienceImport(
    { ...input, audienceId: "audience" },
    "user",
  );
  assert.equal((repeated.rows as any)[0].candidates[0].id, id);
  assert.equal((await commitAudienceImport(repeated.id, {}, "user")).added, 0);
  assert.equal(f.people.length, 1);
  assert.equal(f.people[0].firstName, "Original");
  assert.equal(f.memberships.length, 1);
  assert.equal(
    (await commitAudienceImport(first.id, {}, "user")).audienceId,
    "audience",
  );
});
test("matching searches Salesforce outside the audience and never overwrites its profile from CSV", async (t) => {
  const f = setup(t);
  f.setCrm([
    {
      Id: "003000000000000001",
      Email: "new@example.org",
      FirstName: "CRM",
      LastName: "Owner",
      HasOptedOutOfEmail: false,
    },
  ]);
  const p = await previewAudienceImport(
    {
      ...input,
      text: "Email,First Name\nnew@example.org,Upload",
      format: "csv",
    },
    "user",
  );
  assert.equal((p.rows as any)[0].status, "matched");
  await commitAudienceImport(p.id, {}, "user");
  assert.equal(f.people.length, 1);
  assert.equal(f.people[0].firstName, "CRM");
  assert.equal(f.memberships[0].personId, f.people[0].id);
});
test("shared addresses are held unless reviewed; suppressed people remain suppressed", async (t) => {
  const f = setup(t);
  f.people.push(
    ...["one", "two"].map((id) => ({
      id,
      orgId: "org",
      email: input.text,
      source: "import",
      mergedIntoId: null,
      salesforceId: null,
      optedOut: false,
      unavailable: false,
    })),
  );
  f.suppressions.push({ email: input.text, kind: "global_unsubscribe" });
  const preview = await previewAudienceImport(input, "user");
  assert.equal((preview.rows as any)[0].status, "ambiguous");
  assert.equal((preview.rows as any)[0].blocked, true);
  const held = await commitAudienceImport(preview.id, {}, "user");
  assert.equal(held.held, 1);
  assert.equal(f.memberships.length, 0);
  const reviewed = await previewAudienceImport(input, "user");
  await commitAudienceImport(reviewed.id, { "1": "two" }, "user");
  assert.equal(f.memberships[0].personId, "two");
  assert.equal(f.suppressions.length, 1);
});
test("changed matches, another org, and a different preview owner cannot commit", async (t) => {
  const f = setup(t);
  const p = await previewAudienceImport(input, "user");
  await assert.rejects(commitAudienceImport(p.id, {}, "other"), /not found/);
  f.people.push({
    id: "concurrent",
    orgId: "org",
    email: input.text,
    source: "import",
    mergedIntoId: null,
  });
  await assert.rejects(
    commitAudienceImport(p.id, {}, "user"),
    /Matches changed/,
  );
  assert.equal(f.memberships.length, 0);
  f.setOrg("another");
  await assert.rejects(commitAudienceImport(p.id, {}, "user"), /not found/);
});
test("linking preserves the local ID and historical memberships while aliasing the CRM identity", async (t) => {
  const f = setup(t);
  f.people.push(
    {
      id: "local",
      orgId: "org",
      email: "old@example.org",
      salesforceId: null,
      mergedIntoId: null,
    },
    {
      id: "crm",
      orgId: "org",
      email: "current@example.org",
      salesforceId: "003000000000000001",
      firstName: "CRM",
      mergedIntoId: null,
    },
  );
  f.memberships.push({
    audienceId: "audience",
    personId: "local",
    email: "old@example.org",
  });
  const linked = await linkPeople(f.tx, "local", "crm", "reviewer");
  assert.equal(linked.id, "local");
  assert.equal(linked.salesforceId, "003000000000000001");
  assert.equal(linked.email, "current@example.org");
  assert.equal(f.people[1].mergedIntoId, "local");
  assert.equal(f.people[1].salesforceId, null);
  assert.equal(f.memberships[0].personId, "local");
  assert.match(f.audits[0].sourceId, /reviewer/);
});
test("Funraisin retains donors without CRM IDs, reuses one unambiguous email, and never uses fundraiser member IDs as donor identity", async (t) => {
  const f = setup(t);
  f.tx.personSource.findMany = async () => [];
  f.tx.personSource.createMany = async () => ({ count: 2 });
  const resolved = await sourcePeople(f.tx, "org", "funraisin-donation", [
    { id: "donation-1", email: "donor@example.org", name: "Donor" },
    { id: "donation-2", email: "donor@example.org", name: "Donor" },
  ]);
  assert.equal(resolved.get("donation-1"), resolved.get("donation-2"));
  assert.equal(f.people.length, 1);
  assert.equal(f.people[0].salesforceId, null);
});

test("verified links converging on one CRM Contact keep every source row on the final canonical person", async (t) => {
  const f = setup(t);
  const salesforceId = "003000000000000001";
  const first = {
    id: "first-local",
    orgId: "org",
    email: "first@example.org",
    source: "import",
    salesforceId: null,
    mergedIntoId: null,
  };
  const second = {
    id: "second-local",
    orgId: "org",
    email: "second@example.org",
    source: "import",
    salesforceId: null,
    mergedIntoId: null,
  };
  f.people.push(first, second, {
    id: "crm",
    orgId: "org",
    email: "crm@example.org",
    source: "salesforce",
    salesforceId,
    mergedIntoId: null,
  });
  f.tx.personSource.findMany = async () => [
    { sourceId: "first-source", person: { ...first } },
    { sourceId: "second-source", person: { ...second } },
  ];
  const resolved = await sourcePeople(f.tx, "org", "funraisin-participant", [
    { id: "first-source", salesforceId, email: first.email },
    { id: "second-source", salesforceId, email: second.email },
  ]);
  assert.equal(resolved.get("first-source"), resolved.get("second-source"));
  const canonical = f.people.filter((p) => p.salesforceId === salesforceId);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].id, resolved.get("first-source"));
  assert.equal(
    f.people.find((p) => p.id === "crm").mergedIntoId,
    canonical[0].id,
  );
});

test("reimporting an existing membership after a CRM email change retains its person ID", async (t) => {
  const f = setup(t);
  const first = await previewAudienceImport(input, "user");
  await commitAudienceImport(first.id, {}, "user");
  const personId = f.people[0].id;
  f.people[0].email = "changed@example.org";
  f.people[0].salesforceId = "003000000000000001";
  const repeated = await previewAudienceImport(
    { ...input, audienceId: "audience" },
    "user",
  );
  const row = (repeated.rows as any)[0];
  assert.equal(row.status, "matched");
  assert.equal(row.candidates[0].id, personId);
  assert.equal(row.candidates[0].currentEmail, "changed@example.org");
  assert.equal((await commitAudienceImport(repeated.id, {}, "user")).added, 0);
  assert.equal(f.people.length, 1);
  assert.equal(f.memberships[0].personId, personId);
});
