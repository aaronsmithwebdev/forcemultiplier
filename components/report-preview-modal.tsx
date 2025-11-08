"use client";

import { Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toaster";
import type { SalesforceReportPreview } from "@/types/salesforce";

async function fetchReportPreview(reportId: string) {
  const res = await fetch(`/api/salesforce/report?reportId=${encodeURIComponent(reportId)}`);
  if (!res.ok) {
    throw new Error("Unable to load report preview");
  }
  return (await res.json()) as SalesforceReportPreview;
}

async function syncReport(reportId: string) {
  const res = await fetch(`/api/salesforce/sync-report?reportId=${encodeURIComponent(reportId)}`, {
    method: "POST"
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? "Sync failed");
  }
  return (await res.json()) as { records: number };
}

type ReportPreviewModalProps = {
  reportId: string | null;
  onClose: () => void;
};

export function ReportPreviewModal({ reportId, onClose }: ReportPreviewModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["report-preview", reportId],
    queryFn: () => fetchReportPreview(reportId ?? ""),
    enabled: !!reportId
  });

  const syncMutation = useMutation({
    mutationFn: () => syncReport(reportId ?? ""),
    onSuccess: (result) => {
      toast({
        title: "Sync complete",
        description: `Synced ${result.records} contacts from the report.`
      });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      onClose();
    },
    onError: (error: unknown) => {
      toast({
        title: "Sync failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive"
      });
    }
  });

  if (!reportId) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4 py-8">
      <div className="w-full max-w-4xl space-y-4">
        <Card className="bg-slate-900">
          <CardHeader className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Report preview</CardTitle>
              <p className="text-sm text-slate-400">Showing the first rows returned by Salesforce.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isLoading}>
                {syncMutation.isLoading ? "Syncing…" : "Sync report"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : isError || !data ? (
              <p className="text-sm text-red-300">
                Unable to load the report preview. Please try another report or reconnect Salesforce.
              </p>
            ) : (
              <Fragment>
                <p className="mb-3 text-sm text-slate-300">{data.reportName}</p>
                <div className="table-scroll max-h-96 overflow-auto rounded-lg border border-slate-800">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {data.fields.map((field) => (
                          <TableHead key={field.fieldName}>{field.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((row, index) => (
                        <TableRow key={index}>
                          {data.fields.map((field) => (
                            <TableCell key={field.fieldName + index}>
                              {formatValue(row[field.fieldName])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Fragment>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toLocaleString();
  return value;
}
