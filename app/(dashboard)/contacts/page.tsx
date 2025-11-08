"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { Contact } from "@prisma/client";

type FilterOption = {
  value: string;
  label: string;
};

async function fetchContacts(reportId?: string) {
  const params = new URLSearchParams();
  if (reportId) params.set("reportId", reportId);
  const response = await fetch(`/api/contacts?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to load contacts");
  return (await response.json()) as Contact[];
}

export default function ContactsPage() {
  const [reportFilter, setReportFilter] = useState<string>("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["contacts", reportFilter],
    queryFn: () => fetchContacts(reportFilter || undefined)
  });

  const reportOptions = useMemo<FilterOption[]>(() => {
    if (!data) return [{ value: "", label: "All reports" }];
    const uniqueReports = Array.from(new Set(data.map((contact) => contact.reportId)));
    return [{ value: "", label: "All reports" }, ...uniqueReports.map((id) => ({ value: id, label: id }))];
  }, [data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Contacts</h1>
        <p className="text-sm text-slate-400">
          These contacts were synced from Salesforce reports. Use the dropdown to filter by report ID and spot
          the latest data pulls.
        </p>
      </div>
      <Card className="bg-slate-900/60">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Synced contacts</CardTitle>
            <CardDescription>Every sync refreshes the data for the selected report.</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 md:max-w-xs">
            <label className="text-xs uppercase tracking-wide text-slate-400">Filter by report</label>
            <Select value={reportFilter} onChange={(event) => setReportFilter(event.target.value)}>
              {reportOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label || "All reports"}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isError ? (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              Unable to load contacts — run a sync first.
            </p>
          ) : !data?.length ? (
            <p className="rounded-md border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-300">
              No contacts found yet. Sync a report to populate this table.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Synced at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium text-white">{contact.name ?? "—"}</TableCell>
                      <TableCell>{contact.email ?? "—"}</TableCell>
                      <TableCell>{contact.company ?? "—"}</TableCell>
                      <TableCell>{contact.phone ?? "—"}</TableCell>
                      <TableCell>{new Date(contact.syncedAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
