import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@prisma/client";
import { Empty, Heading } from "@/components/common";
import { db } from "@/lib/db";

type Person = {
  salesforceId: string;
  name: string;
  email: string | null;
  activity: bigint;
  current: bigint;
  paid: boolean;
  netAmount: Prisma.Decimal | null;
};
const PAGE_SIZE = 50;
const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const [{ id }, options] = await Promise.all([params, searchParams]);
  const view = options.view === "donors" ? "donors" : "participants";
  const requestedPage = Number(options.page);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 100_000)
      : 1;
  const [event, sync, salesforce] = await Promise.all([
    db.funraisinEvent.findUnique({ where: { id } }),
    db.funraisinSync.findUnique({ where: { id: "default" } }),
    db.connection.findUnique({
      where: { provider: "salesforce" },
      select: { externalId: true, instanceUrl: true, tokens: true },
    }),
  ]);
  if (
    !event ||
    !sync?.orgId ||
    !salesforce?.tokens ||
    sync.orgId !== salesforce.externalId
  )
    notFound();

  const source =
    view === "participants"
      ? Prisma.sql`
          SELECT p."salesforceId", MAX(p.name) AS name, MAX(p.email) AS email,
            COUNT(*) AS activity,
            COUNT(*) FILTER (WHERE r.complete AND NOT r.archived) AS current,
            BOOL_OR(r."isPaid") AS paid,
            NULL::numeric AS "netAmount"
          FROM "forcemultiplier"."FunraisinRegistration" r
          JOIN "forcemultiplier"."FunraisinParticipant" p ON p."memberId" = r."memberId"
          WHERE r."eventId" = ${id}
          GROUP BY p."salesforceId"
        `
      : Prisma.sql`
          SELECT d."salesforceId", MAX(d.name) AS name, MAX(d.email) AS email,
            COUNT(*) AS activity,
            COUNT(*) FILTER (WHERE d.status = 'paid') AS current,
            FALSE AS paid,
            CASE
              WHEN COUNT(*) FILTER (WHERE d.status = 'paid' AND
                (d.amount IS NULL OR d."refundAmount" IS NULL)) > 0 THEN NULL
              ELSE COALESCE(SUM(d.amount - d."refundAmount") FILTER (WHERE d.status = 'paid'), 0)
            END AS "netAmount"
          FROM "forcemultiplier"."FunraisinDonation" d
          WHERE d."eventId" = ${id}
          GROUP BY d."salesforceId"
        `;
  const [count, people] = await Promise.all([
    db.$queryRaw<[{ total: bigint }]>(Prisma.sql`
      SELECT COUNT(*) AS total FROM (${source}) source
    `),
    db.$queryRaw<Person[]>(Prisma.sql`
      SELECT source."salesforceId",
        COALESCE(NULLIF(CONCAT_WS(' ', mirror."firstName", mirror."lastName"), ''), source.name, 'Unnamed contact') AS name,
        COALESCE(mirror.email, source.email) AS email,
        source.activity, source.current, source.paid, source."netAmount"
      FROM (${source}) source
      LEFT JOIN "forcemultiplier"."ContactMirror" mirror
        ON mirror."orgId" = ${sync.orgId}
        AND mirror."salesforceId" = source."salesforceId"
        AND mirror."deletedAt" IS NULL
      ORDER BY name, source."salesforceId"
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `),
  ]);
  const total = Number(count[0]?.total ?? 0);
  const href = (nextPage: number) =>
    `/events/${id}?view=${view}&page=${nextPage}`;
  const waitingForRecords =
    !!sync.scanUntil &&
    (view === "participants"
      ? sync.phase === "events" || sync.phase === "participants"
      : sync.phase !== "donations");
  const emptyDescription = waitingForRecords
    ? view === "participants"
      ? "Participant profiles are importing first. Event registrations come next, so this list will fill as registrations arrive."
      : "The import has not reached donations yet. This list will fill as donation records arrive."
    : sync.scanUntil
      ? "The import is still running. More people may appear as records arrive."
      : "No Funraisin records with a valid Salesforce Contact ID are linked to this event.";

  return (
    <>
      <Link className="back-link" href="/events">
        Back to events
      </Link>
      <Heading title={event.name} />
      <p className="page-intro">
        {event.eventDate?.toLocaleDateString("en-AU", { timeZone: "UTC" }) ??
          "Date not set"}{" "}
        · Funraisin event {event.id}
      </p>
      {sync.scanUntil && (
        <p className="page-intro">
          Syncing {sync.phase}: {sync.processed.toLocaleString()}
          {sync.total ? ` of ${sync.total.toLocaleString()}` : ""} records
          processed in this stage.
          {sync.error &&
            ` Last attempt failed: ${sync.error} Next retry: ${sync.dueAt.toLocaleString()}.`}
        </p>
      )}
      <section className="card">
        <div className="section-toolbar">
          <div>
            <h2>{view === "participants" ? "Participants" : "Donors"}</h2>
            <p>
              {total.toLocaleString()} unique Salesforce Contacts.{" "}
              {view === "participants"
                ? "Registration counts include every stored record. Is paid follows Funraisin's event registration flag."
                : "Donation records and paid gifts are linked to this event only. Net paid total subtracts recorded refunds."}
            </p>
          </div>
          <div className="button-row">
            <Link
              className={`button ${view === "participants" ? "" : "secondary"}`}
              href={`/events/${id}?view=participants`}
            >
              Participants
            </Link>
            <Link
              className={`button ${view === "donors" ? "" : "secondary"}`}
              href={`/events/${id}?view=donors`}
            >
              Donors
            </Link>
          </div>
        </div>
        {people.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>
                    {view === "participants"
                      ? "Registrations"
                      : "Donation records"}
                  </th>
                  <th>
                    {view === "participants" ? "Completed" : "Paid gifts"}
                  </th>
                  {view === "participants" && <th>Is paid</th>}
                  {view === "donors" && <th>Net paid (AUD)</th>}
                  <th>Salesforce ID</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.salesforceId}>
                    <td>
                      {salesforce.instanceUrl ? (
                        <a
                          href={`${salesforce.instanceUrl}/lightning/r/Contact/${person.salesforceId}/view`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {person.name}
                        </a>
                      ) : (
                        person.name
                      )}
                    </td>
                    <td>{person.email ?? "—"}</td>
                    <td>{Number(person.activity).toLocaleString()}</td>
                    <td>{Number(person.current).toLocaleString()}</td>
                    {view === "participants" && (
                      <td>{person.paid ? "Yes" : "No"}</td>
                    )}
                    {view === "donors" && (
                      <td>
                        {person.netAmount === null
                          ? sync.scanUntil
                            ? "Syncing"
                            : "Unavailable"
                          : money.format(Number(person.netAmount))}
                      </td>
                    )}
                    <td>{person.salesforceId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              waitingForRecords
                ? `${view === "participants" ? "Participants" : "Donors"} are still syncing`
                : `No ${view} on this page`
            }
            description={emptyDescription}
          />
        )}
      </section>
      <nav className="button-row" aria-label={`${view} pages`}>
        {page > 1 && (
          <Link className="button secondary" href={href(page - 1)}>
            Previous
          </Link>
        )}
        {page * PAGE_SIZE < total && (
          <Link className="button secondary" href={href(page + 1)}>
            Next
          </Link>
        )}
      </nav>
    </>
  );
}
