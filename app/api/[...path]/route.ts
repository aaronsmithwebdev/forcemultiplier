import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, publicError } from "@/lib/errors";
import { login, logout, requireSession } from "@/lib/auth";
import { appUrl, checkOrigin, encrypt, salesforceHost } from "@/lib/security";
import {
  callbackUrl,
  finishOAuth,
  isProvider,
  providerRequest,
  startOAuth,
  testConnection,
  connection,
  sfQuery,
  SF_VERSION,
} from "@/lib/providers";
import {
  catalog,
  describe,
  enrich,
  sourceQuery,
  validatePaths,
} from "@/lib/salesforce";
import { previewQuery, validateQuery, sfId } from "@/lib/soql";
import { createAudience, pullStep, startPull } from "@/lib/audiences";
import { deliveryStep, startDelivery } from "@/lib/deliveries";
import {
  runScheduleNow,
  runScheduler,
  purgeExpiredDeliveryIssues,
  saveSchedule,
  setScheduleEnabled,
} from "@/lib/schedules";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1).max(128),
});
const queryBody = z.object({
  query: z.string().max(20000),
  fields: z.array(z.string().max(200)).max(30).default([]),
});
async function body(request: Request) {
  const text = await request.text();
  if (text.length > 50000) throw new AppError("Request is too large.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("Invalid request body.");
  }
}
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: p } = await context.params;
  const key = p.join("/");
  const method = request.method;
  const params = request.nextUrl.searchParams;
  try {
    if (key === "cron/sync" && method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (
        !secret ||
        request.headers.get("authorization") !== `Bearer ${secret}`
      )
        throw new AppError("Cron authorization failed.", 401);
      return json(await runScheduler());
    }
    if (key === "cron/cleanup" && method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (
        !secret ||
        request.headers.get("authorization") !== `Bearer ${secret}`
      )
        throw new AppError("Cron authorization failed.", 401);
      return json(await purgeExpiredDeliveryIssues());
    }
    if (method !== "GET") checkOrigin(request);
    if (key === "auth/login" && method === "POST") {
      const data = credentials.parse(await body(request));
      await login(data.email, data.password);
      return json({ ok: true });
    }
    const user = await requireSession();
    if (key === "auth/logout" && method === "POST") {
      await logout();
      return json({ ok: true });
    }
    if (p[0] === "oauth" && isProvider(p[1])) {
      const provider = p[1];
      if (p[2] === "start" && method === "POST")
        return json({ url: await startOAuth(provider, user.id) });
      if (p[2] === "callback" && method === "GET") {
        if (params.has("error"))
          throw new AppError(
            "Authorization was declined or failed. Start again from Connections.",
          );
        const code = params.get("code"),
          state = params.get("state");
        if (!code || !state)
          throw new AppError("Missing OAuth code or state. Start again.");
        await finishOAuth(provider, user.id, state, code);
        return NextResponse.redirect(
          `${appUrl()}/connections?connected=${provider}`,
        );
      }
    }
    if (key === "connections" && method === "GET") {
      const rows = await db.connection.findMany();
      return json(
        ["salesforce", "constant-contact"].map((provider) => {
          const row = rows.find((r) => r.provider === provider);
          return {
            provider,
            clientId: row?.clientId ?? "",
            hasSecret: !!row?.secret,
            loginUrl: row?.loginUrl ?? "https://login.salesforce.com",
            connected: !!row?.tokens,
            label: row?.label,
            externalId: row?.externalId,
            instanceUrl: row?.instanceUrl,
            checkedAt: row?.checkedAt,
            error: row?.error,
            callbackUrl: callbackUrl(
              provider as "salesforce" | "constant-contact",
            ),
          };
        }),
      );
    }
    if (p[0] === "connections" && isProvider(p[1])) {
      const provider = p[1];
      if (method === "PUT") {
        const data = z
          .object({
            clientId: z.string().trim().min(3).max(1000),
            clientSecret: z.string().max(2000).optional(),
            loginUrl: z.string().optional(),
          })
          .parse(await body(request));
        const previous = await db.connection.findUnique({
          where: { provider },
        });
        if (previous?.tokens)
          throw new AppError(
            "Disconnect this account before changing its application credentials.",
            409,
          );
        const secret = data.clientSecret
          ? encrypt(data.clientSecret)
          : previous?.secret;
        if (!secret)
          throw new AppError("Enter your application client secret.");
        const loginUrl =
          provider === "salesforce"
            ? salesforceHost(
                data.loginUrl ?? "https://login.salesforce.com",
                true,
              )
            : "https://authz.constantcontact.com";
        if (previous) {
          const updated = await db.connection.updateMany({
            where: { provider, version: previous.version, tokens: null },
            data: {
              clientId: data.clientId,
              secret,
              loginUrl,
              version: { increment: 1 },
              error: null,
            },
          });
          if (!updated.count)
            throw new AppError(
              "Connection settings changed. Reload this page before saving.",
              409,
            );
        } else
          await db.connection.create({
            data: { provider, clientId: data.clientId, secret, loginUrl },
          });
        return json({ ok: true });
      }
      if (method === "DELETE") {
        await db.connection.updateMany({
          where: { provider },
          data: {
            tokens: null,
            externalId: null,
            label: null,
            instanceUrl: null,
            expiresAt: null,
            checkedAt: null,
            error: null,
            version: { increment: 1 },
            refreshLeaseUntil: null,
          },
        });
        return json({ ok: true });
      }
      if (p[2] === "test" && method === "POST")
        return json(await testConnection(provider));
    }
    if (key === "salesforce/catalog" && method === "GET")
      return json(
        await catalog(
          params.get("kind") ?? "reports",
          (params.get("search") ?? "").slice(0, 100),
          params.get("cursor"),
        ),
      );
    if (key === "salesforce/source" && method === "POST") {
      const data = z
        .object({
          kind: z.enum(["report", "listview", "campaign"]),
          id: z.string(),
        })
        .parse(await body(request));
      return json(await sourceQuery(data.kind, data.id));
    }
    if (key === "salesforce/metadata" && method === "GET") {
      const info = await describe(params.get("object") ?? "Contact");
      return json({
        name: info.name,
        label: info.label,
        fields: info.fields.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          relationshipName: f.relationshipName,
          referenceTo: f.referenceTo,
        })),
        childRelationships: info.childRelationships,
      });
    }
    if (key === "salesforce/preview" && method === "POST") {
      const data = queryBody.parse(await body(request));
      await validatePaths(data.fields);
      const page = await sfQuery(previewQuery(data.query));
      return json({
        records: await enrich(page.records, data.fields),
        sample: true,
        limit: 25,
      });
    }
    if (key === "audiences" && method === "GET")
      return json(
        await db.audience.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            runs: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                status: true,
                processed: true,
                total: true,
                createdAt: true,
                error: true,
              },
            },
          },
        }),
      );
    if (key === "audiences" && method === "POST") {
      const data = queryBody
        .extend({
          name: z.string().trim().min(1).max(120),
          sourceType: z.enum(["soql", "report", "listview", "campaign"]),
          sourceId: z.string().optional(),
        })
        .parse(await body(request));
      return json(await createAudience(data), 201);
    }
    if (p[0] === "audiences" && p[1]) {
      if (p[2] === "pull" && method === "POST")
        return json(await startPull(p[1]));
      if (p[2] === "deliveries" && method === "POST") {
        const data = z
          .object({
            listId: z.uuid(),
            permissionConfirmed: z.literal(true),
            mappings: z
              .array(
                z.object({
                  source: z.string().min(1).max(200),
                  targetId: z.uuid(),
                }),
              )
              .max(25)
              .default([]),
          })
          .parse(await body(request));
        return json(await startDelivery(p[1], data.listId, data.mappings), 201);
      }
      if (p[2] === "schedule" && method === "PUT") {
        const data = z
          .object({
            listId: z.uuid(),
            permissionConfirmed: z.literal(true),
            mappings: z
              .array(
                z.object({
                  source: z.string().min(1).max(200),
                  targetId: z.uuid(),
                }),
              )
              .max(25)
              .default([]),
            cadence: z.enum(["hours", "daily", "weekly"]),
            intervalHours: z.number().int().min(1).max(168).nullable(),
            localTime: z
              .string()
              .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
              .nullable(),
            weekday: z.number().int().min(0).max(6).nullable(),
            timeZone: z.string().trim().min(1).max(100),
          })
          .parse(await body(request));
        return json(await saveSchedule(p[1], data));
      }
      if (p.length === 2 && method === "GET") {
        const audience = await db.audience.findUnique({
          where: { id: p[1] },
          include: {
            runs: { take: 10, orderBy: { createdAt: "desc" } },
            schedule: {
              include: { runs: { take: 10, orderBy: { createdAt: "desc" } } },
            },
          },
        });
        if (!audience) throw new AppError("Audience not found.", 404);
        const complete = await db.pullRun.findFirst({
          where: { audienceId: audience.id, status: "completed" },
          orderBy: { createdAt: "desc" },
        });
        const offset = Math.max(
          0,
          Math.min(150000, Number(params.get("offset")) || 0),
        );
        const search = (params.get("search") ?? "").trim().slice(0, 100);
        const memberWhere = {
          runId: complete?.id ?? "",
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { email: { contains: search, mode: "insensitive" as const } },
                  {
                    salesforceId: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                ],
              }
            : {}),
        };
        const members = complete
          ? await db.audienceMember.findMany({
              where: memberWhere,
              orderBy: { salesforceId: "asc" },
              skip: offset,
              take: 50,
            })
          : [];
        return json({
          ...audience,
          completeRun: complete,
          members,
          memberCount: complete
            ? await db.audienceMember.count({ where: { runId: complete.id } })
            : 0,
          filteredCount: complete
            ? await db.audienceMember.count({ where: memberWhere })
            : 0,
          deliveries: await db.deliveryRun.findMany({
            where: { audienceId: audience.id },
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              issues: {
                orderBy: [{ category: "asc" }, { name: "asc" }],
                take: 100,
              },
              _count: { select: { issues: true } },
            },
          }),
          schedulerReady: Boolean(process.env.CRON_SECRET),
          offset,
        });
      }
    }
    if (p[0] === "schedules" && p[1]) {
      if (p[2] === "enabled" && method === "POST") {
        const data = z
          .object({ enabled: z.boolean() })
          .parse(await body(request));
        return json(await setScheduleEnabled(p[1], data.enabled));
      }
      if (p[2] === "run" && method === "POST")
        return json(await runScheduleNow(p[1]), 201);
    }
    if (p[0] === "deliveries" && p[1] && p[2] === "step" && method === "POST")
      return json(await deliveryStep(p[1]));
    if (p[0] === "runs" && p[1]) {
      if (p[2] === "step" && method === "POST")
        return json(await pullStep(p[1]));
      if (p[2] === "cancel" && method === "POST") {
        await db.pullRun.updateMany({
          where: { id: p[1], status: { in: ["pending", "running", "paused"] } },
          data: {
            status: "cancelled",
            leaseUntil: null,
            finishedAt: new Date(),
          },
        });
        return json({ ok: true });
      }
    }
    if (key === "constant-contact/lists" && method === "GET")
      return json(
        await providerRequest(
          "constant-contact",
          params.get("cursor") ||
            "/v3/contact_lists?limit=100&include_membership_count=all",
        ),
      );
    if (key === "constant-contact/lists" && method === "POST") {
      const data = z
        .object({
          name: z.string().trim().min(1).max(255),
          description: z.string().max(500).default(""),
        })
        .parse(await body(request));
      return json(
        await providerRequest("constant-contact", "/v3/contact_lists", {
          method: "POST",
          body: JSON.stringify(data),
        }),
        201,
      );
    }
    if (key === "constant-contact/fields" && method === "GET")
      return json(
        await providerRequest(
          "constant-contact",
          params.get("cursor") || "/v3/contact_custom_fields?limit=100",
        ),
      );
    if (
      p[0] === "constant-contact" &&
      p[1] === "lists" &&
      p[2] &&
      p[3] === "members" &&
      method === "GET"
    ) {
      const id = z.uuid().parse(p[2]);
      return json(
        await providerRequest(
          "constant-contact",
          params.get("cursor") ||
            `/v3/contacts?lists=${id}&limit=50&include=custom_fields,list_memberships&status=all`,
        ),
      );
    }
    throw new AppError("Route not found.", 404);
  } catch (error) {
    const safe = publicError(error);
    if (p[0] === "oauth" && p[2] === "callback")
      return NextResponse.redirect(
        `${appUrl()}/connections?error=${encodeURIComponent(safe.error)}`,
      );
    return json({ error: safe.error }, safe.status);
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
