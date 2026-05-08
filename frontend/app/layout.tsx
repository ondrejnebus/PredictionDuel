import type { Metadata } from "next";
import "./globals.css";

import { Providers } from "./providers";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "PredictionDuel",
  description:
    "Trustless peer-to-peer prediction wagers with asymmetric stakes and on-chain dispute resolution.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <Providers>
          <Header />
          <main className="container max-w-5xl py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
