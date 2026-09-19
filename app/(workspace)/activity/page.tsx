import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Empty, Heading } from "@/components/common";
export default async function Page() {
  const runs = await db.pullRun.findMany({
    take: 100,
    orderBy: { createdAt: "desc" },
    include: { audience: { select: { name: true } } },
  });
  return (
    <>
      <Heading
        eyebrow="A CLEAR RECORD"
        title="Every pull, accounted for."
        description="See what ran, what completed, and what needs your attention."
      />
      <section className="card">
        {!runs.length ? (
          <Empty
            title="Your history starts here"
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
                    <td>{run.createdAt.toLocaleString()}</td>
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
