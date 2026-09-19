import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "ForceMultiplier", template: "%s · ForceMultiplier" },
  description: "Your Salesforce audiences, connected to Constant Contact.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
