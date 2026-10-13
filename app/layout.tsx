import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "Dropick — Beam a file to any browser",
  description:
    "Peer-to-peer, encrypted file transfer between two browsers. No uploads.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geist.variable} antialiased`}>
        <div className="aurora" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}