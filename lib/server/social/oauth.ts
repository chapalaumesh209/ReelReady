import { z } from "zod";
import { storageAdmin } from "../../supabase";
import { GenerationError } from "../../generation";
import { appOrigin } from "../config";
import { databaseError, repository } from "../repository";
import { requiredScopes, socialConfiguration } from "./config";
import { randomToken, stateHash, encryptSocial, decryptSocial } from "./crypto";
import { socialJSON } from "./http";
import { identify, saveAccount } from "./accounts";
import type { SocialCredential } from "./accounts";
import type { Platform } from "../../workflow";
export async function startOAuth(req: Request, platform: Platform) {
  const { user } = await repository(req),
    config = socialConfiguration(platform);
  if (!config.configured)
    throw new GenerationError(
      "This platform is not configured by the site owner yet. Your reel is saved.",
      503,
    );
  const state = randomToken(),
    verifier = randomToken(),
    redirect = `${appOrigin(req)}/api/connect/callback/${platform}`;
  const saved = await storageAdmin()
    .from("reelready_oauth_states")
    .insert({
      state_hash: stateHash(state),
      owner_id: user.id,
      platform,
      encrypted_verifier: encryptSocial(
        verifier,
        `${user.id}:${platform}:oauth`,
      ),
      redirect_uri: redirect,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    });
  if (saved.error) databaseError(saved.error);
  const url = new URL(
    platform === "youtube"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : platform === "instagram"
        ? "https://www.instagram.com/oauth/authorize"
        : "https://x.com/i/oauth2/authorize",
  );
  Object.entries({
    client_id: config.clientId,
    redirect_uri: redirect,
    response_type: "code",
    state,
    scope: requiredScopes[platform].join(platform === "instagram" ? "," : " "),
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  if (platform !== "instagram") {
    url.searchParams.set(
      "code_challenge",
      Buffer.from(stateHash(verifier), "hex").toString("base64url"),
    );
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (platform === "youtube") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  if (platform === "instagram") url.searchParams.set("force_reauth", "true");
  return { url: url.href, demo: false };
}
export async function finishOAuth(req: Request, platform: Platform) {
  const { user } = await repository(req),
    query = new URL(req.url).searchParams;
  const state = z.string().min(20).max(200).parse(query.get("state"));
  const consumed = await storageAdmin()
    .from("reelready_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash(state))
    .eq("owner_id", user.id)
    .eq("platform", platform)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("encrypted_verifier,redirect_uri")
    .maybeSingle();
  if (consumed.error) databaseError(consumed.error);
  if (!consumed.data)
    throw new GenerationError(
      "This authorization expired or was already used. Connect again.",
      409,
    );
  if (query.has("error")) return "cancelled";
  const code = z.string().min(1).max(4096).parse(query.get("code")),
    config = socialConfiguration(platform);
  if (!config.configured)
    throw new GenerationError("This platform is not configured yet.", 503);
  const verifier = decryptSocial<string>(
    consumed.data.encrypted_verifier,
    `${user.id}:${platform}:oauth`,
  );
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: consumed.data.redirect_uri,
    client_id: config.clientId,
  });
  if (platform !== "x") form.set("client_secret", config.clientSecret);
  if (platform !== "instagram") form.set("code_verifier", verifier);
  let raw = await socialJSON(
    platform === "youtube"
      ? "https://oauth2.googleapis.com/token"
      : platform === "instagram"
        ? "https://api.instagram.com/oauth/access_token"
        : "https://api.x.com/2/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(platform === "x"
          ? {
              Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
            }
          : {}),
      },
      body: form,
    },
  );
  if (Array.isArray(raw.data)) raw = raw.data[0] as Record<string, unknown>;
  const granted =
    typeof raw.scope === "string"
      ? raw.scope.split(/[ ,]+/)
      : Array.isArray(raw.permissions)
        ? raw.permissions.map(String)
        : [];
  const token = z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().optional(),
      expires_in: z.number().positive().optional(),
    })
    .parse(raw);
  let credential: SocialCredential = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
    scopes: granted,
  };
  if (platform === "instagram") {
    const long = z
      .object({
        access_token: z.string().min(1),
        expires_in: z.number().positive(),
      })
      .parse(
        await socialJSON(
          `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: config.clientSecret, access_token: token.access_token })}`,
        ),
      );
    credential = {
      ...credential,
      accessToken: long.access_token,
      expiresAt: Date.now() + long.expires_in * 1000,
    };
    if (!credential.scopes.length) {
      const permissions = await socialJSON<{
        data?: { permission: string; status: string }[];
      }>("https://graph.instagram.com/me/permissions", {
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      credential.scopes =
        permissions.data
          ?.filter((p) => p.status === "granted")
          .map((p) => p.permission) || [];
    }
  }
  const identity = await identify(platform, credential);
  await saveAccount(user.id, platform, { ...identity, credential });
  return "success";
}
