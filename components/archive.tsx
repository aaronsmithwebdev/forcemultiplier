"use client";
import { useEffect, useState } from "react";
import { archivePreviewDocument } from "@/lib/archive-preview";
import { api, Badge, Button, Empty, Heading, Loading, Notice } from "./common";

type Item = {
  id: string;
  campaignName: string;
  campaignType: string;
  role: string;
  subject: string;
  sentAt: string;
  sendCount: number;
  warning: string | null;
  permalink: string | null;
  previewText: string | null;
};
type Job = {
  status: string;
  scanned: number;
  stored: number;
  missing: number;
  error: string | null;
};
type State = { importJob: Job | null; total: number; items: Item[] };
type ImageJob = {
  status: string;
  scanned: number;
  error: string | null;
  cutoff: string;
  leaseUntil: string | null;
};
type ImageState = {
  job: ImageJob | null;
  counts: Record<string, number>;
};

export function Archive() {
  const [state, setState] = useState<State | null>(null);
  const [imageState, setImageState] = useState<ImageState | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Item | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [unresolvedImages, setUnresolvedImages] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [next, images]: [State, ImageState] = await Promise.all([
          api(`archive?q=${encodeURIComponent(search)}&offset=${offset}`),
          api("archive/images"),
        ]);
        if (alive) {
          setState(next);
          setImageState(images);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) timer = setTimeout(refresh, 15000);
      }
    }
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search, offset]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    fetch(`/api/archive/${encodeURIComponent(selected.id)}/preview`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 401) window.location.assign("/login");
        if (!response.ok) throw new Error("Could not load this email preview.");
        return Promise.all([
          response.text(),
          Promise.resolve(
            Number(response.headers.get("X-Archive-Images-Unresolved") || 0),
          ),
        ]);
      })
      .then(([html, unresolved]) => {
        if (!controller.signal.aborted) {
          setPreviewHtml(archivePreviewDocument(html));
          setUnresolvedImages(unresolved);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setPreviewError((error as Error).message);
      });
    return () => controller.abort();
  }, [selected]);

  useEffect(() => {
    if (
      !state?.importJob ||
      !["pending", "running"].includes(state.importJob.status)
    )
      return;
    let alive = true;
    async function work() {
      while (alive) {
        try {
          const job: Job = await api("archive/step", "POST");
          if (!alive) return;
          setState((previous) => previous && { ...previous, importJob: job });
          if (!["pending", "running"].includes(job.status)) return;
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch {
          // The scheduled worker continues if this browser request times out.
          return;
        }
      }
    }
    void work();
    return () => {
      alive = false;
    };
  }, [state?.importJob?.status]);

  useEffect(() => {
    if (
      !imageState?.job ||
      !["inventory", "copying"].includes(imageState.job.status)
    )
      return;
    let alive = true;
    async function work() {
      let failures = 0;
      while (alive) {
        try {
          const next: ImageState = await api("archive/images/step", "POST");
          if (!alive) return;
          failures = 0;
          setImageState(next);
          if (!next.job || !["inventory", "copying"].includes(next.job.status))
            return;
          const lease = next.job.leaseUntil
            ? new Date(next.job.leaseUntil).getTime() - Date.now()
            : 0;
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              lease > 0 ? Math.min(lease + 1000, 10000) : 500,
            ),
          );
        } catch (e) {
          if (!alive) return;
          failures++;
          if (failures === 3) {
            setError(
              `Image backup stopped after repeated server errors: ${(e as Error).message}`,
            );
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
      }
    }
    void work();
    return () => {
      alive = false;
    };
  }, [imageState?.job?.status]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const job: Job = await api("archive/start", "POST");
      setState((previous) => previous && { ...previous, importJob: job });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startImages() {
    setBusy(true);
    setError("");
    try {
      setImageState(await api("archive/images/start", "POST"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const job = state?.importJob;
  return (
    <>
      <Heading
        eyebrow="PAST CAMPAIGNS"
        title="Email archive"
        description="Search sent Constant Contact emails. Originals remain available as reference when you create a new campaign."
      />
      <Notice message={error} />
      {!state ? (
        <Loading />
      ) : (
        <>
          <section className="card archive-controls">
            <div>
              <h2>Archive import</h2>
              <p>
                {job
                  ? `${job.status} · ${job.scanned.toLocaleString()} campaigns scanned · ${job.stored.toLocaleString()} sent emails stored`
                  : "Ready to import sent campaigns. No Constant Contact lists will be copied."}
              </p>
              {job?.missing ? (
                <p>
                  {job.missing.toLocaleString()} emails need content review.
                </p>
              ) : null}
              <Notice message={job?.error || ""} />
              {job?.status === "running" || job?.status === "pending" ? (
                <small>
                  Import continues while this page is open and through the
                  scheduled worker.
                </small>
              ) : null}
            </div>
            {(!job ||
              job.status === "paused" ||
              job.status === "completed") && (
              <Button busy={busy} onClick={() => void start()}>
                {job?.status === "paused"
                  ? "Resume import"
                  : job?.status === "completed"
                    ? "Check for new emails"
                    : "Start import"}
              </Button>
            )}
          </section>
          <section className="card archive-controls">
            <div>
              <h2>Image backup</h2>
              <p>
                {imageState?.job
                  ? `${imageState.job.status} · ${imageState.job.scanned.toLocaleString()} emails scanned · ${(imageState.counts.copied || 0).toLocaleString()} images copied`
                  : "Copy account-hosted images from sent emails into Supabase Storage."}
              </p>
              {imageState?.job ? (
                <small>
                  Sent since{" "}
                  {new Date(imageState.job.cutoff).toLocaleDateString()} ·{" "}
                  {(imageState.counts.failed || 0).toLocaleString()} failed ·{" "}
                  {(imageState.counts.excluded || 0).toLocaleString()} shared or
                  external images need review.
                </small>
              ) : null}
              <Notice message={imageState?.job?.error || ""} />
              {imageState?.job &&
              ["inventory", "copying"].includes(imageState.job.status) ? (
                <small>Keep this page open while images are copied.</small>
              ) : null}
            </div>
            {(!imageState?.job ||
              ["paused", "completed"].includes(imageState.job.status)) && (
              <Button busy={busy} onClick={() => void startImages()}>
                {imageState?.job?.status === "paused"
                  ? "Resume image backup"
                  : imageState?.job?.status === "completed"
                    ? "Check for new images"
                    : "Start image backup"}
              </Button>
            )}
          </section>
          <form
            className="archive-search"
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              setSearch(query);
            }}
          >
            <label htmlFor="archive-query">
              Search campaign name, subject, or text
            </label>
            <div className="button-row">
              <input
                id="archive-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={100}
              />
              <Button type="submit">Search</Button>
            </div>
          </form>
          <section className="card archive-results">
            <h2>{state.total.toLocaleString()} archived emails</h2>
            {!state.items.length ? (
              <Empty
                title="No archived emails found"
                description={
                  search
                    ? "Try another search."
                    : "Start the import to bring in past sent emails."
                }
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Subject</th>
                      <th>Sent</th>
                      <th>Variant</th>
                      <th>Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.campaignName}</td>
                        <td>{item.subject || "—"}</td>
                        <td>{new Date(item.sentAt).toLocaleDateString()}</td>
                        <td>{item.role}</td>
                        <td>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setPreviewHtml("");
                              setPreviewError("");
                              setUnresolvedImages(0);
                              setSelected({ ...item });
                              setTimeout(
                                () =>
                                  document
                                    .getElementById("archive-preview")
                                    ?.scrollIntoView({ behavior: "smooth" }),
                                0,
                              );
                            }}
                          >
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="button-row">
              <Button
                variant="secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 25))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={offset + 25 >= state.total}
                onClick={() => setOffset(offset + 25)}
              >
                Next
              </Button>
            </div>
          </section>
          {selected && (
            <section className="card archive-preview" id="archive-preview">
              <div className="archive-preview-heading">
                <div>
                  <Badge tone="green">Archived</Badge>
                  <h2>{selected.campaignName}</h2>
                  <p>{selected.subject}</p>
                  <small>
                    Sent {new Date(selected.sentAt).toLocaleString()} ·{" "}
                    {selected.role} · {selected.sendCount.toLocaleString()}{" "}
                    recipients
                  </small>
                </div>
                <Button variant="secondary" onClick={() => setSelected(null)}>
                  Close preview
                </Button>
              </div>
              <Notice message={selected.warning || ""} />
              <p>
                Copied images are shown from Supabase. Links and other remote
                requests remain blocked. The original HTML is stored separately.
              </p>
              {unresolvedImages ? (
                <Notice
                  message={`${unresolvedImages} images are unavailable in this preview or need ownership review.`}
                />
              ) : null}
              <Notice message={previewError} />
              {!previewHtml && !previewError ? <Loading /> : null}
              {previewHtml ? (
                <iframe
                  key={selected.id}
                  title={`Archived preview: ${selected.campaignName}`}
                  srcDoc={previewHtml}
                  sandbox=""
                  tabIndex={-1}
                />
              ) : null}
              {selected.previewText && (
                <details>
                  <summary>Text version</summary>
                  <pre>{selected.previewText}</pre>
                </details>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
