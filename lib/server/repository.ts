import { authContext } from "../supabase/server";
import { session } from "../server";
import { GenerationError } from "../generation";
export function databaseError(error: unknown): never {
  const e = error as { code?: string };
  throw new GenerationError(
    e.code === "42P01" || e.code === "PGRST205"
      ? "Development setup: apply the ReelReady migrations to your local Supabase database."
      : "Your changes could not be saved. Your local draft is safe; please retry.",
    503,
  );
}
export async function repository(req: Request) {
  const user = await session(req);
  return { user, db: authContext(req).db };
}
export async function ensureReel(req: Request, id: string) {
  const { db, user } = await repository(req);
  const found = await db
    .from("reelready_reels")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (found.error) databaseError(found.error);
  if (!found.data) {
    const created = await db
      .from("reelready_reels")
      .insert({
        id,
        owner_id: user.id,
        state: { id, version: 2, step: 0 },
        title: "Untitled reel",
      });
    if (created.error)
      throw new GenerationError(
        "This reel could not be opened in your workspace. Start a new reel and try again.",
        409,
      );
  }
  return { db, user };
}
export async function ownedReel(req: Request, id: string) {
  const { db, user } = await repository(req);
  const { data, error } = await db
    .from("reelready_reels")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data)
    throw new GenerationError(
      "This reel was not found in your workspace.",
      404,
    );
  return { db, user, reel: data };
}
