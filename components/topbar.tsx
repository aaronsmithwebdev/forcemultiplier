"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

async function fetchIdentity() {
  const response = await fetch("/api/salesforce/identity");
  if (!response.ok) throw new Error("Failed to load identity");
  return (await response.json()) as { orgName?: string; userName?: string };
}

export function Topbar() {
  const router = useRouter();
  const { data, isLoading, error } = useQuery({ queryKey: ["salesforce-identity"], queryFn: fetchIdentity });
  const { toast } = useToast();

  return (
    <header className="flex items-center justify-between border-b border-slate-900 bg-slate-950/70 px-6 py-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-300">
          {isLoading ? "Connecting to Salesforce…" : data?.orgName ?? "Not connected"}
        </p>
        <p className="text-xs text-slate-500">{data?.userName ? `Signed in as ${data.userName}` : null}</p>
        {error ? (
          <p className="text-xs text-red-300">Salesforce connection failed — please reconnect.</p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <Link href="https://developer.salesforce.com/docs" target="_blank" className="text-xs text-slate-400">
          Salesforce Docs
        </Link>
        <Button
          variant="ghost"
          onClick={() => {
            toast({
              title: "Logging out",
              description: "Clear your Salesforce cookies manually in this demo.",
              variant: "destructive"
            });
            router.push("/");
          }}
        >
          Logout
        </Button>
      </div>
    </header>
  );
}
