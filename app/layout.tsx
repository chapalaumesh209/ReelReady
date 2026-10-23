import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ReelReady — Plan, record, translate and publish.",
  description:
    "Plan your reel, upload the recording, create an English voiceover and publish across platforms. No ReelReady sign-up. Made for your voice.",
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
