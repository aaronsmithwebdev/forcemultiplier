import "./globals.css";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ReactNode } from "react";

import { QueryProvider } from "@/components/query-provider";
import { ToastProvider, Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Salesforce Report Sync",
  description: "Minimal starter to sync Salesforce reports into Supabase"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <QueryProvider>
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
