import Link from "next/link";
import { Empty, Heading } from "@/components/common";
import { db } from "@/lib/db";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const search = q.trim().slice(0, 100);
  const [sync, salesforce] = await Promise.all([
    db.funraisinSync.findUnique({ where: { id: "default" } }),
    db.connection.findUnique({
      where: { provider: "salesforce" },
      select: { externalId: true, tokens: true },
    }),
  ]);
  const currentOrg =
    !!sync?.orgId &&
    !!salesforce?.tokens &&
    sync.orgId === salesforce.externalId;
  const events = currentOrg
    ? await db.funraisinEvent.findMany({
        where: search
          ? { name: { contains: search, mode: "insensitive" } }
          : {},
        orderBy: [{ eventDate: "desc" }, { name: "asc" }],
      })
    : [];
  const [issues, issueCount] = currentOrg
    ? await Promise.all([
        db.funraisinIssue.findMany({
          orderBy: [{ phase: "asc" }, { sourceId: "asc" }],
          take: 50,
        }),
        db.funraisinIssue.count(),
      ])
    : [[], 0];
  const configured = !!(
    process.env.FUNRAISIN_BASE_URL && process.env.FUNRAISIN_API_KEY
  );

  return (
    <>
      <Heading title="Funraisin events" />
      <p className="page-intro">
        Browse participants and donors by event. People are grouped by
        Salesforce Contact ID.
      </p>
      <section className="card">
        <div className="section-toolbar">
          <div>
            <h2>Event catalog</h2>
            <p>
              {!configured
                ? "Set FUNRAISIN_BASE_URL and FUNRAISIN_API_KEY on the server to start syncing."
                : !salesforce?.externalId || !salesforce.tokens
                  ? "Connect Salesforce before importing Funraisin contacts."
                  : sync?.error
                    ? `Sync issue (retrying): ${sync.error}`
                    : !sync
                      ? "The scheduled import will start shortly."
                      : sync.scanUntil
                        ? `Importing ${sync.phase}: ${sync.processed.toLocaleString()} records processed${sync.skipped ? `; ${sync.skipped.toLocaleString()} records without a valid Contact or event link skipped` : ""}.`
                        : sync.lastCompletedAt
                          ? `Last synced ${sync.lastCompletedAt.toLocaleString()}${sync.skipped ? `; ${sync.skipped.toLocaleString()} records without a valid Contact or event link skipped` : ""}.`
                          : "The scheduled import will start shortly."}
            </p>
          </div>
          <form action="/events" method="get" className="search-box">
            <input
              name="q"
              aria-label="Search events"
              placeholder="Search events"
              defaultValue={search}
            />
          </form>
        </div>
        {events.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th>Funraisin ID</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Link href={`/events/${event.id}`}>{event.name}</Link>
                    </td>
                    <td>
                      {event.eventDate?.toLocaleDateString("en-AU", {
                        timeZone: "UTC",
                      }) ?? "—"}
                    </td>
                    <td>{event.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={search ? "No matching events" : "No events imported yet"}
            description={
              search
                ? "Try another event name."
                : "The scheduled Funraisin sync will populate this list."
            }
          />
        )}
      </section>
      {issueCount > 0 && (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="section-toolbar">
            <div>
              <h2>Unlinked Funraisin records</h2>
              <p>
                {issueCount.toLocaleString()} records need a valid Salesforce
                Contact or event link. Showing the first 50 source IDs.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Funraisin ID</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={`${issue.phase}:${issue.sourceId}`}>
                    <td>{issue.phase}</td>
                    <td>{issue.sourceId}</td>
                    <td>{issue.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
