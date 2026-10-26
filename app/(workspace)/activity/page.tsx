import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Empty, Heading } from "@/components/common";
import { defaultTimeZone, formatDate } from "@/lib/time-zone";
export default async function Page() {
  const [runs, settings] = await Promise.all([
    db.pullRun.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      include: { audience: { select: { name: true } } },
    }),
    db.workspaceSettings.findUnique({
      where: { id: "workspace" },
      select: { timeZone: true },
    }),
  ]);
  return (
    <>
      <Heading title="Pull history" />
      <section className="card">
        {!runs.length ? (
          <Empty
            title="No pulls"
            description="Pull an audience from Salesforce and its progress will appear here."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Audience</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link href={"/audiences/" + run.audienceId}>
                        {run.audience.name}
                      </Link>
                    </td>
                    <td>
                      {formatDate(
                        run.createdAt,
                        settings?.timeZone ?? defaultTimeZone,
                      )}
                    </td>
                    <td>
                      <Badge tone={run.status === "completed" ? "green" : ""}>
                        {run.status}
                      </Badge>
                    </td>
                    <td>
                      {run.processed.toLocaleString()} /{" "}
                      {run.total.toLocaleString()}
                    </td>
                    <td>{run.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
