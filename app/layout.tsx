import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "ForceMultiplier", template: "%s · ForceMultiplier" },
  description: "Salesforce audiences, consent, and email campaigns.",
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
