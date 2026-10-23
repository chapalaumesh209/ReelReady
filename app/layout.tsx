import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ReelReady — Speak once. Get your plan and your posts.",
  description:
    "Turn your video idea into a recording plan or a multilingual publishing kit. No sign-up. Made for your voice.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
