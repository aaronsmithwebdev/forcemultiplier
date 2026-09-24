import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { TemplateContent } from "@templatical/types";
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
import {
  createAudience,
  pullStep,
  startPull,
  updateAudienceQuery,
} from "@/lib/audiences";
import { deliveryStep, startDelivery } from "@/lib/deliveries";
import { resendStatus } from "@/lib/resend";
import {
  archivePreview,
  archiveState,
  archiveStep,
  startArchiveImport,
} from "@/lib/archive";
import { archivePreviewPolicy } from "@/lib/archive-preview";
import {
  imageBackupState,
  imageBackupStep,
  startImageBackup,
} from "@/lib/archive-image-import";
import {
  runScheduleNow,
  runScheduler,
  purgeExpiredDeliveryIssues,
  saveSchedule,
  setScheduleEnabled,
} from "@/lib/schedules";
import {
  retryUnsubscribeEvents,
  runUnsubscribeSync,
  setUnsubscribeSync,
  unsubscribeState,
} from "@/lib/unsubscribes";
import {
  createResubscribeJob,
  finishResubscribeUpload,
  resubscribeJobInput,
  resubscribeState,
  runResubscriptions,
  setResubscribeStatus,
  uploadResubscribeChunk,
} from "@/lib/resubscriptions";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  getTemplateVersion,
  listTemplates,
  listTemplateVersions,
  restoreTemplateVersion,
  saveTemplate,
  templateMergeTags,
} from "@/lib/email-templates";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  saveCampaign,
} from "@/lib/campaigns";
import { sendResendTest } from "@/lib/campaign-email";
import {
  campaignAudienceOptions,
  campaignSendStep,
  saveAndPreviewCampaignAudience,
  startCampaignSend,
} from "@/lib/campaign-sends";
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
async function body(request: Request, maxLength = 50000) {
  const text = await request.text();
  if (text.length > maxLength) throw new AppError("Request is too large.", 413);
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
    if (key === "cron/archive" && method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (
        !secret ||
        request.headers.get("authorization") !== `Bearer ${secret}`
      )
        throw new AppError("Cron authorization failed.", 401);
      return json(await archiveStep());
    }
    if (key === "cron/resubscriptions" && method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (
        !secret ||
        request.headers.get("authorization") !== `Bearer ${secret}`
      )
        throw new AppError("Cron authorization failed.", 401);
      return json(await runResubscriptions());
    }
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
    if (key === "cron/unsubscribes" && method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (
        !secret ||
        request.headers.get("authorization") !== `Bearer ${secret}`
      )
        throw new AppError("Cron authorization failed.", 401);
      return json(await runUnsubscribeSync());
    }
    if (key === "cron/campaign-sends" && method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (
        !secret ||
        request.headers.get("authorization") !== `Bearer ${secret}`
      )
        throw new AppError("Cron authorization failed.", 401);
      return json((await campaignSendStep()) || { idle: true });
    }
    if (method !== "GET") checkOrigin(request);
    if (key === "auth/login" && method === "POST") {
      const data = credentials.parse(await body(request));
      await login(data.email, data.password);
      return json({ ok: true });
    }
    const user = await requireSession();
    const templateContent = z
      .object({
        blocks: z.array(z.unknown()).max(1000),
        settings: z.record(z.string(), z.unknown()),
      })
      .passthrough();
    const templateName = z.string().trim().min(1).max(120);
    const templateId = z.string().min(1).max(100);
    const campaignContent = templateContent;
    const campaignName = z.string().trim().min(1).max(120);
    const singleLine = (max: number) =>
      z
        .string()
        .trim()
        .min(1)
        .max(max)
        .regex(/^[^\r\n]+$/);
    const senderName = singleLine(100).regex(/^[^<>]+$/);
    const email = z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase());
    const audienceSelection = z.object({
      audienceIds: z.array(templateId).min(1).max(100),
      exclusionAudienceIds: z.array(templateId).max(100).default([]),
      manualExclusions: z.array(email).max(5000).default([]),
    });
    if (key === "campaigns" && method === "GET")
      return json(await listCampaigns(params.get("q") || ""));
    if (key === "campaigns" && method === "POST") {
      const data = z
        .object({
          name: campaignName,
          templateId: templateId.optional(),
        })
        .parse(await body(request));
      return json(
        await createCampaign(data.name, user.id, data.templateId),
        201,
      );
    }
    if (p[0] === "campaigns" && p[1]) {
      const id = templateId.parse(p[1]);
      if (p[2] === "review" && p.length === 3 && method === "GET")
        return json(await campaignAudienceOptions(id));
      if (p[2] === "recipients" && p.length === 3 && method === "POST") {
        const data = audienceSelection.parse(await body(request, 1_500_000));
        return json(await saveAndPreviewCampaignAudience(id, data));
      }
      if (p[2] === "send" && p.length === 3 && method === "POST") {
        const data = audienceSelection.parse(await body(request, 1_500_000));
        await saveAndPreviewCampaignAudience(id, data);
        return json(await startCampaignSend(id, user.id), 201);
      }
      if (
        p[2] === "send" &&
        p[3] === "step" &&
        p.length === 4 &&
        method === "POST"
      ) {
        const review = await campaignAudienceOptions(id);
        if (!review.send)
          throw new AppError("This campaign has not been sent.", 404);
        return json(await campaignSendStep(review.send.id));
      }
      if (p[2] === "test" && p.length === 3 && method === "POST") {
        const data = z
          .object({ recipient: email, content: campaignContent })
          .parse(await body(request, 2_000_000));
        if (!user.email || data.recipient !== user.email.toLowerCase())
          throw new AppError(
            "Test emails can only be sent to your signed-in address.",
            403,
          );
        const campaign = await getCampaign(id);
        if (
          !campaign.subject ||
          !campaign.fromName ||
          !campaign.fromEmail ||
          !campaign.replyToEmail
        )
          throw new AppError(
            "Complete and save Email settings before sending a test.",
          );
        const fromDomain = campaign.fromEmail.split("@")[1]?.toLowerCase();
        const resend = await resendStatus();
        if (
          !resend.domains.some(
            (domain: { name: string; status: string; sending: boolean }) =>
              domain.sending &&
              domain.status === "verified" &&
              domain.name.toLowerCase() === fromDomain,
          )
        )
          throw new AppError(
            "The From email must use a verified Resend sending domain.",
            409,
          );
        return json(
          await sendResendTest(
            campaign,
            data.recipient,
            data.content as unknown as TemplateContent,
          ),
          201,
        );
      }
      if (p.length === 2 && method === "GET")
        return json(await getCampaign(id));
      if (p.length === 2 && method === "PATCH") {
        const data = z
          .object({
            name: campaignName.optional(),
            content: campaignContent.optional(),
            subject: singleLine(500).optional(),
            preheader: z
              .string()
              .trim()
              .max(200)
              .regex(/^[^\r\n]*$/)
              .optional(),
            fromName: senderName.optional(),
            fromEmail: email.optional(),
            replyToEmail: email.optional(),
          })
          .refine((value) => Object.keys(value).length > 0, {
            message: "Include a campaign field to save.",
          })
          .parse(await body(request, 2_000_000));
        return json(
          await saveCampaign(id, {
            ...data,
            content: data.content as unknown as TemplateContent | undefined,
          }),
        );
      }
      if (p.length === 2 && method === "DELETE")
        return json(await deleteCampaign(id));
    }
    if (key === "templates/merge-tags" && method === "GET")
      return json(await templateMergeTags());
    if (key === "templates" && method === "GET")
      return json(await listTemplates(params.get("q") || ""));
    if (key === "templates" && method === "POST") {
      const data = z
        .object({ name: templateName, content: templateContent.optional() })
        .parse(await body(request, 2_000_000));
      return json(await createTemplate(data, user.id), 201);
    }
    if (p[0] === "templates" && p[1]) {
      const id = templateId.parse(p[1]);
      if (p[2] === "versions" && p.length === 3 && method === "GET")
        return json(await listTemplateVersions(id));
      if (p[2] === "versions" && p[3] && p.length === 4 && method === "GET")
        return json(await getTemplateVersion(id, templateId.parse(p[3])));
      if (
        p[2] === "versions" &&
        p[3] &&
        p[4] === "restore" &&
        method === "POST"
      )
        return json(
          await restoreTemplateVersion(id, templateId.parse(p[3]), user.id),
        );
      if (p.length === 2 && method === "GET")
        return json(await getTemplate(id));
      if (p.length === 2 && method === "PATCH") {
        const data = z
          .object({
            name: templateName.optional(),
            content: templateContent.optional(),
          })
          .refine((value) => value.name || value.content, {
            message: "Include a template name or content.",
          })
          .parse(await body(request, 2_000_000));
        return json(await saveTemplate(id, data, user.id));
      }
      if (p.length === 2 && method === "DELETE")
        return json(await deleteTemplate(id));
    }
    if (key === "archive" && method === "GET")
      return json(
        await archiveState(
          params.get("q") || "",
          Math.max(
            0,
            Math.min(100000, Math.floor(Number(params.get("offset")) || 0)),
          ),
        ),
      );
    if (key === "archive/start" && method === "POST")
      return json(await startArchiveImport());
    if (key === "archive/step" && method === "POST")
      return json(await archiveStep());
    if (key === "archive/images" && method === "GET")
      return json(await imageBackupState());
    if (key === "archive/images/start" && method === "POST")
      return json(await startImageBackup());
    if (key === "archive/images/step" && method === "POST")
      return json(await imageBackupStep());
    if (p[0] === "archive" && p[1] && p[2] === "preview" && method === "GET") {
      const preview = await archivePreview(z.string().max(100).parse(p[1]));
      return new NextResponse(preview.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": `sandbox; ${archivePreviewPolicy()}`,
          "X-Archive-Images-Unresolved": String(preview.unresolved),
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (key === "resend/status" && method === "GET")
      return json(await resendStatus());
    if (key === "resubscriptions" && method === "GET")
      return json(await resubscribeState());
    if (key === "resubscriptions" && method === "POST")
      return json(
        await createResubscribeJob(
          resubscribeJobInput.parse(await body(request)),
        ),
        201,
      );
    if (p[0] === "resubscriptions" && p[1]) {
      const id = z.string().max(100).parse(p[1]);
      if (p.length === 2 && method === "GET")
        return json(
          await resubscribeState(
            id,
            params.get("status")?.slice(0, 30) || undefined,
            Math.max(
              0,
              Math.min(100000, Math.floor(Number(params.get("offset")) || 0)),
            ),
          ),
        );
      if (p[2] === "chunk" && method === "POST") {
        const data = z
          .object({
            index: z.number().int().min(0).max(100000),
            emails: z.array(z.string().max(254)).min(1).max(500),
          })
          .parse(await body(request));
        return json(await uploadResubscribeChunk(id, data.index, data.emails));
      }
      if (p[2] === "finish" && method === "POST")
        return json(await finishResubscribeUpload(id));
      if (p[2] === "status" && method === "POST") {
        const data = z
          .object({ action: z.enum(["start", "pause", "cancel"]) })
          .parse(await body(request));
        return json(await setResubscribeStatus(id, data.action));
      }
    }
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
      const [rows, writeback] = await Promise.all([
        db.connection.findMany(),
        unsubscribeState(),
      ]);
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
            ...(provider === "salesforce" ? { writeback } : {}),
          };
        }),
      );
    }
    if (key === "unsubscribe-sync" && method === "PUT") {
      const data = z
        .object({
          enabled: z.boolean(),
          includeExisting: z.boolean().default(false),
        })
        .parse(await body(request));
      return json(await setUnsubscribeSync(data.enabled, data.includeExisting));
    }
    if (key === "unsubscribe-sync/run" && method === "POST")
      return json(await runUnsubscribeSync());
    if (key === "unsubscribe-sync/retry" && method === "POST")
      return json(await retryUnsubscribeEvents());
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
        await setUnsubscribeSync(false);
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
          filterable: f.filterable,
          picklistValues: f.picklistValues,
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
      if (p.length === 2 && method === "PUT") {
        const data = z
          .object({ query: z.string().max(20000) })
          .parse(await body(request));
        return json(await updateAudienceQuery(p[1], data.query));
      }
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
    if (key === "constant-contact/campaign-access" && method === "GET") {
      await providerRequest("constant-contact", "/v3/emails?limit=1");
      return json({ ok: true });
    }
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
export const PATCH = handle;
export const DELETE = handle;
