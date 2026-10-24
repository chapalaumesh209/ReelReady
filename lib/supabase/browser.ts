"use client";
import { createBrowserClient } from "@supabase/ssr";
/** Optional future account-linking client. The MVP's HttpOnly session is managed by /api/session. */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
