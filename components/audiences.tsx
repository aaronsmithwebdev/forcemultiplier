"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Plus,
  UsersRound,
  CheckCircle2,
  PlugZap,
  ArrowUpRight,
  Database,
  Search,
  ArrowRight,
} from "lucide-react";
import { api, Badge, date, Empty, Heading, Loading, Notice } from "./common";
export function Audiences() {
  const [rows, setRows] = useState<any[] | null>(null),
    [connections, setConnections] = useState<any[]>([]),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    Promise.all([api("audiences"), api("connections")])
      .then(([a, c]) => {
        setRows(a);
        setConnections(c);
      })
      .catch((e) => setError(e.message));
  }, []);
  const connected = connections.filter((c) => c.connected).length;
  const filtered = rows?.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Heading
        eyebrow="PEOPLE, WITH PURPOSE"
        title="Your audiences."
        description="Turn Salesforce criteria into lists you can work with."
        action={
          <Link className="button" href="/audiences/new">
            <Plus size={17} />
            New audience
          </Link>
        }
      />
      <Notice message={error} />
      <div className="stats-grid">
        <div className="stat-card">
          <span>
            <UsersRound size={18} />
            Saved audiences
          </span>
          <strong>{rows?.length ?? "—"}</strong>
          <small>Across your Salesforce sources</small>
        </div>
        <div className="stat-card">
          <span>
            <CheckCircle2 size={18} />
            Completed latest pulls
          </span>
          <strong>
            {rows
              ? rows.filter((r) => r.runs[0]?.status === "completed").length
              : "—"}
          </strong>
          <small>Complete snapshots, ready to inspect</small>
        </div>
        <div className="stat-card">
          <span>
            <PlugZap size={18} />
            Connected accounts
          </span>
          <strong>
            {connected}
            <em> / 2</em>
          </strong>
          <small>Salesforce and Constant Contact</small>
        </div>
      </div>
      {connections.length > 0 && connected < 2 && (
        <div className="onboarding-banner">
          <div className="banner-icon">
            <PlugZap size={23} />
          </div>
          <div>
            <h3>Start with your connections</h3>
            <p>
              Authorize your accounts to browse Salesforce sources and Constant
              Contact lists.
            </p>
          </div>
          <Link href="/connections">
            Connect accounts
            <ArrowRight size={17} />
          </Link>
        </div>
      )}
      <section className="card">
        <div className="section-toolbar">
          <div>
            <h2>Audience library</h2>
            <p>Saved criteria. Reusable lists.</p>
          </div>
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label="Search audiences"
              placeholder="Search audiences…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {!rows ? (
          <Loading />
        ) : !filtered?.length ? (
          <Empty
            title={
              search ? "No matching audiences" : "Build your first audience"
            }
            description="Start with a SOQL query, a saved report, a list view, or a Salesforce Campaign."
          >
            <Link href="/audiences/new" className="button secondary">
              <Plus size={17} />
              Create an audience
            </Link>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Audience</th>
                  <th>Source</th>
                  <th>Latest pull</th>
                  <th>Records pulled</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link
                        className="audience-name"
                        href={"/audiences/" + row.id}
                      >
                        <span className="row-icon">
                          <UsersRound size={17} />
                        </span>
                        <div>
                          <strong>{row.name}</strong>
                          <small>
                            Created{" "}
                            {new Date(row.createdAt).toLocaleDateString()}
                          </small>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <Badge>{row.sourceType}</Badge>
                    </td>
                    <td>
                      {row.runs[0] ? (
                        <>
                          <Badge
                            tone={
                              row.runs[0].status === "completed" ? "green" : ""
                            }
                          >
                            {row.runs[0].status}
                          </Badge>
                          <small className="block muted">
                            {date(row.runs[0].createdAt)}
                          </small>
                        </>
                      ) : (
                        <span className="muted">Not pulled yet</span>
                      )}
                    </td>
                    <td>{row.runs[0]?.processed?.toLocaleString() ?? "—"}</td>
                    <td>
                      <Link
                        aria-label={`Open ${row.name}`}
                        href={"/audiences/" + row.id}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="footnote">
        <Database size={15} /> Pulling an audience saves a snapshot here. Open a
        completed audience to review and send it to a Constant Contact list.
      </div>
    </>
  );
}
