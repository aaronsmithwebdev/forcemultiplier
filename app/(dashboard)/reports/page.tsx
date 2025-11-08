"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ReportPreviewModal } from "@/components/report-preview-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SalesforceReportSummary } from "@/types/salesforce";

async function fetchReports(params: { search?: string; folder?: string }) {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  if (params.folder) searchParams.set("folder", params.folder);
  const response = await fetch(`/api/salesforce/reports?${searchParams.toString()}`);
  if (!response.ok) throw new Error("Failed to load reports");
  return (await response.json()) as SalesforceReportSummary[];
}

const folderFilters = [
  { value: "", label: "All folders" },
  { value: "My", label: "My reports" },
  { value: "Shared", label: "Shared" },
  { value: "Public", label: "Public" }
];

export default function ReportsPage() {
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState<string>("");
  const [selectedReport, setSelectedReport] = useState<string | null>(null);

  const queryKey = useMemo(() => ["salesforce-reports", { search, folder }], [search, folder]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchReports({ search, folder })
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Reports</h1>
        <p className="text-sm text-slate-400">
          Search your Salesforce org for tabular and summary reports. Filter by folder type and preview the
          data before syncing.
        </p>
      </div>
      <Card className="bg-slate-900/60">
        <CardHeader>
          <CardTitle>Available reports</CardTitle>
          <CardDescription>
            Use the controls below to narrow down large orgs. Click <span className="text-sky-300">Preview</span> to
            view the top rows of a report.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex w-full flex-col gap-2 md:max-w-sm">
              <label className="text-xs uppercase tracking-wide text-slate-400">Search by name</label>
              <Input
                placeholder="Search reports"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="flex w-full flex-col gap-2 md:max-w-xs">
              <label className="text-xs uppercase tracking-wide text-slate-400">Folder type</label>
              <Select value={folder} onChange={(event) => setFolder(event.target.value)}>
                {folderFilters.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isError ? (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              No reports available — check permissions or reconnect Salesforce.
            </p>
          ) : !data?.length ? (
            <p className="rounded-md border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-300">
              No reports matched your filters. Try another folder or search term.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report name</TableHead>
                    <TableHead>Folder</TableHead>
                    <TableHead>Last modified</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell className="font-medium text-white">{report.name}</TableCell>
                      <TableCell>{report.folderName}</TableCell>
                      <TableCell>{new Date(report.lastModifiedDate).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelectedReport(report.id)}>
                          Preview
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <ReportPreviewModal reportId={selectedReport} onClose={() => setSelectedReport(null)} />
    </div>
  );
}
