"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Compatibility landing for OAuth providers. Authorization is verified by the studio. */
export default function ConnectionReturn() {
  const router = useRouter();
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    let back = query.get("returnTo") || "";
    try {
      back ||= sessionStorage.getItem("reelready.return") || "";
    } catch {
      /* Resume browser draft instead. */
    }
    const match = /^\/(?:studio)?\?id=([a-f0-9-]{36})$/.exec(back);
    const target = new URL("/", location.origin);
    if (match) target.searchParams.set("id", match[1]);
    const status = query.get("connect_status");
    if (status && ["success", "cancelled", "error"].includes(status))
      target.searchParams.set("connect_status", status);
    router.replace(target.pathname + target.search);
  }, [router]);
  return (
    <main className="connection-return" aria-busy="true">
      <p role="status">Returning to your reel…</p>
    </main>
  );
}
