"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  const [isConnecting, setIsConnecting] = useState(false);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-12">
      <div className="mx-auto w-full max-w-3xl space-y-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white">Salesforce Report Sync</h1>
        <p className="text-lg text-slate-300">
          This mini-app walks you through connecting to Salesforce, browsing available reports, previewing
          them, and syncing contact data into your Supabase database.
        </p>
        <Card className="bg-slate-900/80">
          <CardHeader>
            <CardTitle>Get Started</CardTitle>
            <CardDescription>
              Click the button below to connect your Salesforce org. You&apos;ll be redirected to Salesforce to
              approve access and then brought back to see your reports.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              className="w-full"
              onClick={() => {
                setIsConnecting(true);
                window.location.href = "/api/salesforce/login";
              }}
              disabled={isConnecting}
            >
              {isConnecting ? "Redirecting…" : "Connect to Salesforce"}
            </Button>
            <p className="text-sm text-left text-slate-400">
              Need credentials? Create a connected app in Salesforce and add the callback URL from your
              <code className="mx-1 rounded bg-slate-800 px-1 py-0.5 text-slate-200">.env</code> file. The README
              explains every step in detail.
            </p>
            <div className="text-left text-sm text-slate-400">
              <p className="font-semibold text-slate-200">Helpful links</p>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <Link href="https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm&type=5" target="_blank">
                    Salesforce Connected App docs
                  </Link>
                </li>
                <li>
                  <Link href="https://supabase.com/docs/guides/getting-started" target="_blank">Supabase Getting Started</Link>
                </li>
                <li>
                  <Link href="https://www.prisma.io/docs/orm" target="_blank">Prisma ORM Guides</Link>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
