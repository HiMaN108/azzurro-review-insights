import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { NavLinks } from "@/components/nav-links";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Azzurro Review Insights",
  description: "Booking.com guest review insights for Azzurro Hotels operations",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
                A
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-semibold text-ink">Azzurro Hotels</span>
                <span className="block text-xs text-ink-3">Guest review insights · Booking.com</span>
              </span>
            </Link>
            <Suspense fallback={<div className="h-9" />}>
              <NavLinks />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-5 px-4 py-5">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-ink-3">
          Scores are Booking.com guest scores out of 10. Weeks run Monday–Sunday, Sydney time.
        </footer>
      </body>
    </html>
  );
}
