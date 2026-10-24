import { z } from "zod";
import { storageAdmin } from "../../supabase";
import { GenerationError } from "../../generation";
import { repository, databaseError } from "../repository";
import { providerKey } from "./config";
import { demoMode, appOrigin } from "../config";
import { platforms, type Platform, type Connections } from "../../workflow";
import { callPublishingWorkflow } from "./webhook";
import { randomToken, stateHash } from "../social/crypto";

export class ProviderError extends GenerationError {
  constructor(public providerStatus: number) {
    super(
      providerStatus === 429 || providerStatus === 403
        ? "Account connection or publishing capacity has been reached. Your reel is saved; the site owner needs to check the service plan."
        : providerStatus === 401
          ? "The account connection service needs attention. Your reel is saved."
          : "Account connections are temporarily unavailable. Your reel is saved; try again later.",
      providerStatus === 429 ? 429 : 503,
    );
  }
}
export async function providerJSON(path: string, init: RequestInit = {}) {
  if (!providerKey())
    throw new GenerationError(
      "Account connection is not configured by the site owner yet.",
      503,
    );
  if (
    !/^\/uploadposts\/(users(?:\/[a-zA-Z0-9_@.%-]+)?|oauth\/(youtube|instagram|x)\/start)$/.test(
      path,
    )
  )
    throw new Error("Unsupported provider operation");
  const r = await fetch(`https://api.upload-post.com/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      Authorization: `Apikey ${providerKey()}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw new ProviderError(r.status);
  }
  const raw: unknown = await r.json();
  return z.record(z.unknown()).parse(raw);
}
const profileSchema = z.object({
  username: z.string().min(1),
  blocked: z.boolean().optional(),
  social_accounts: z.record(z.unknown()).default({}),
});
export type ProviderProfile = z.infer<typeof profileSchema>;
export async function mappedProfile(
  owner: string,
  create = false,
): Promise<string | null> {
  const admin = storageAdmin();
  let found = await admin
    .from("reelready_profiles")
    .select("external_profile")
    .eq("owner_id", owner)
    .maybeSingle();
  if (found.error) databaseError(found.error);
  if (!found.data && !create) return null;
  if (!found.data) {
    const name = `rr_${owner.replaceAll("-", "")}`;
    const saved = await admin
      .from("reelready_profiles")
      .upsert(
        { owner_id: owner, external_profile: name },
        { onConflict: "owner_id", ignoreDuplicates: true },
      );
    if (saved.error) databaseError(saved.error);
    found = await admin
      .from("reelready_profiles")
      .select("external_profile")
      .eq("owner_id", owner)
      .single();
    if (found.error) databaseError(found.error);
  }
  const name = found.data!.external_profile;
  if (!/^[a-zA-Z0-9_@-]{1,150}$/.test(name))
    throw new GenerationError(
      "This workspace's account mapping needs attention.",
      503,
    );
  return name;
}
export async function ownerProfile(
  owner: string,
  create = false,
): Promise<ProviderProfile | null> {
  const name = await mappedProfile(owner, create);
  if (!name) return null;
  try {
    const raw = await providerJSON(
      `/uploadposts/users/${encodeURIComponent(name)}`,
    );
    const profile = profileSchema.parse(raw.profile);
    if (profile.username !== name) throw new Error("Profile mismatch");
    return profile;
  } catch (e) {
    if (!(e instanceof ProviderError) || e.providerStatus !== 404 || !create)
      throw e;
    // A stable name and an immutable owner mapping make concurrent creation safe.
    try {
      await providerJSON("/uploadposts/users", {
        method: "POST",
        body: JSON.stringify({
          username: name,
          display_name: "ReelReady creator",
        }),
      });
    } catch (error) {
      if (!(error instanceof ProviderError) || error.providerStatus !== 409)
        throw error;
    }
    const raw = await providerJSON(
      `/uploadposts/users/${encodeURIComponent(name)}`,
    );
    const profile = profileSchema.parse(raw.profile);
    if (profile.username !== name) throw new Error("Profile mismatch");
    return profile;
  }
}
export function profileAccounts(
  profile: ProviderProfile | null,
): Connections["accounts"] {
  return Object.fromEntries(
    platforms.map((platform) => {
      const raw = profile?.social_accounts[platform];
      const a =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const id = [a.username, a.id, a.account_id, a.handle].find(
        (v) => typeof v === "string" && !!v,
      );
      const reauth = a.reauth_required === true || profile?.blocked === true;
      return [
        platform,
        {
          name: String(a.handle || a.display_name || ""),
          accountId: id ? String(id) : undefined,
          connected: !!id && !reauth,
          reauth,
          configured: !!providerKey(),
        },
      ];
    }),
  );
}
async function missingProfileIssue() {
  try {
    const listing = await providerJSON("/uploadposts/users");
    if (
      Array.isArray(listing.profiles) &&
      typeof listing.limit === "number" &&
      listing.profiles.length >= listing.limit
    )
      return "This browser workspace has no publishing profile, and the account’s profile limit is full. Recover an existing creator workspace or ask the site owner to add profile capacity.";
  } catch {
    /* Preserve the more specific missing-workspace message. */
  }
  return "This browser workspace has no publishing profile yet. Connect an account to create one.";
}
export async function providerConnections(req: Request): Promise<Connections> {
  const { user } = await repository(req);
  try {
    const profile = providerKey() ? await ownerProfile(user.id) : null;
    return {
      demo: demoMode(),
      connectionMode: "real",
      configured: !!providerKey(),
      accounts: profileAccounts(profile),
    };
  } catch (error) {
    return {
      issue:
        error instanceof ProviderError && error.providerStatus === 404
          ? await missingProfileIssue()
          : "Account connections could not be verified. Your reel is safe; retry the connection check.",
      demo: demoMode(),
      connectionMode: "real",
      configured: !!providerKey(),
      accounts: Object.fromEntries(
        platforms.map((p) => [
          p,
          {
            name: "",
            connected: false,
            reauth: false,
            configured: !!providerKey(),
            unavailable: true,
          },
        ]),
      ),
    };
  }
}
export async function startProviderConnection(
  req: Request,
  platform: Platform,
) {
  const { user } = await repository(req);
  if (!providerKey())
    throw new GenerationError(
      "Account connection is not configured by the site owner yet.",
      503,
    );
  await mappedProfile(user.id, true);
  try {
    await ownerProfile(user.id);
  } catch (error) {
    if (!(error instanceof ProviderError) || error.providerStatus !== 404)
      throw error;
    const issue = await missingProfileIssue();
    if (issue.includes("limit is full")) throw new GenerationError(issue, 409);
  }
  const connectionToken = randomToken();
  const saved = await storageAdmin()
    .from("reelready_oauth_states")
    .insert({
      state_hash: stateHash(connectionToken),
      owner_id: user.id,
      platform,
      encrypted_verifier: "n8n-managed-connect-v1",
      redirect_uri: `${appOrigin(req)}/connect`,
      expires_at: new Date(Date.now() + 120000).toISOString(),
    });
  if (saved.error) databaseError(saved.error);
  const raw = await callPublishingWorkflow("connect", { connectionToken });
  const url = new URL(z.string().url().parse(raw.authorize_url));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    ![
      "accounts.google.com",
      "www.instagram.com",
      "instagram.com",
      "x.com",
      "twitter.com",
      "api.twitter.com",
      "www.twitter.com",
    ].includes(url.hostname)
  )
    throw new GenerationError(
      "Authorization could not start safely. Please try again.",
      502,
    );
  return { url: url.href, demo: false };
}
export async function authorizeProviderConnection(input: unknown) {
  const { connectionToken } = z
    .object({ connectionToken: z.string().min(20).max(200) })
    .strict()
    .parse(input);
  const claimed = await storageAdmin()
    .from("reelready_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash(connectionToken))
    .eq("encrypted_verifier", "n8n-managed-connect-v1")
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("owner_id,platform,redirect_uri")
    .maybeSingle();
  if (claimed.error) databaseError(claimed.error);
  if (!claimed.data)
    throw new GenerationError(
      "This account connection expired or was already used. Choose Connect again.",
      409,
    );
  const state = claimed.data,
    profileUsername = await mappedProfile(state.owner_id);
  if (!profileUsername)
    throw new GenerationError(
      "This workspace's account mapping needs attention.",
      409,
    );
  let needsCreation = false;
  try {
    await ownerProfile(state.owner_id);
  } catch (e) {
    if (e instanceof ProviderError && e.providerStatus === 404)
      needsCreation = true;
    else throw e;
  }
  return {
    profileUsername,
    platform: state.platform,
    redirectUrl: state.redirect_uri,
    needsCreation,
  };
}
export async function disconnectProvider(req: Request, platform: Platform) {
  const { user } = await repository(req);
  const profile = await ownerProfile(user.id);
  if (!profile) return { revoked: true };
  await providerJSON("/uploadposts/users/social", {
    method: "DELETE",
    body: JSON.stringify({
      profile_username: profile.username,
      social_platform: platform,
    }),
  });
  return { revoked: false }; // Unlinks this profile; platform-wide revocation may still require account settings.
}
