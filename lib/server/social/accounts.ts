import { z } from "zod";
import { storageAdmin } from "../../supabase";
import { GenerationError } from "../../generation";
import { databaseError } from "../repository";
import { encryptSocial, decryptSocial } from "./crypto";
import { requiredScopes, socialConfiguration, instagramGraph } from "./config";
import { bearer, socialJSON } from "./http";
import type { Platform } from "../../workflow";
export type SocialCredential = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
};
export type SocialAccount = {
  accountId: string;
  name: string;
  credential: SocialCredential;
};
export async function identify(
  platform: Platform,
  credential: SocialCredential,
) {
  if (platform === "youtube") {
    const raw = await socialJSON(
      "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
      { headers: bearer(credential.accessToken) },
    );
    const data = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string().min(1),
              snippet: z.object({
                title: z.string(),
                customUrl: z.string().optional(),
              }),
            }),
          )
          .min(1),
      })
      .parse(raw);
    return {
      accountId: data.items[0].id,
      name: data.items[0].snippet.customUrl || data.items[0].snippet.title,
    };
  }
  if (platform === "x") {
    const raw = await socialJSON("https://api.x.com/2/users/me", {
      headers: bearer(credential.accessToken),
    });
    const { data } = z
      .object({
        data: z.object({ id: z.string().min(1), username: z.string().min(1) }),
      })
      .parse(raw);
    return { accountId: data.id, name: `@${data.username}` };
  }
  const raw = await socialJSON(
    `${instagramGraph()}/me?fields=user_id,username,account_type`,
    { headers: bearer(credential.accessToken) },
  );
  const data = z
    .object({
      user_id: z.union([z.string(), z.number()]).optional(),
      id: z.string().optional(),
      username: z.string().min(1),
      account_type: z.string().optional(),
    })
    .parse(raw);
  if (
    data.account_type &&
    !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(data.account_type)
  )
    throw new GenerationError(
      "Instagram publishing needs a Business or Creator account.",
      409,
    );
  const id = String(data.user_id || data.id || "");
  if (!id)
    throw new GenerationError(
      "Instagram did not return an account identity. Reconnect your professional account.",
      409,
    );
  return { accountId: id, name: `@${data.username}` };
}
export async function saveAccount(
  owner: string,
  platform: Platform,
  account: SocialAccount,
) {
  if (
    !requiredScopes[platform].every((scope) =>
      account.credential.scopes.includes(scope),
    )
  )
    throw new GenerationError(
      "Publishing permissions were not granted. Reconnect and approve the requested access.",
      409,
    );
  const r = await storageAdmin()
    .from("reelready_social_credentials")
    .upsert({
      owner_id: owner,
      platform,
      account_id: account.accountId,
      display_name: account.name,
      encrypted_credentials: encryptSocial(
        account.credential,
        `${owner}:${platform}`,
      ),
      updated_at: new Date().toISOString(),
      refresh_lease: null,
      refresh_until: null,
    });
  if (r.error) databaseError(r.error);
}
const refreshing = new Map<string, Promise<SocialAccount | null>>();
async function loadAccount(
  owner: string,
  platform: Platform,
): Promise<SocialAccount | null> {
  const r = await storageAdmin()
    .from("reelready_social_credentials")
    .select("*")
    .eq("owner_id", owner)
    .eq("platform", platform)
    .maybeSingle();
  if (r.error) databaseError(r.error);
  if (!r.data) return null;
  let credential = decryptSocial<SocialCredential>(
    r.data.encrypted_credentials,
    `${owner}:${platform}`,
  );
  if (!requiredScopes[platform].every((s) => credential.scopes.includes(s)))
    throw new GenerationError(
      "Reconnect this account to grant publishing permissions.",
      409,
    );
  if (credential.expiresAt < Date.now() + 120000) {
    const config = socialConfiguration(platform);
    if (!config.configured)
      throw new GenerationError("This platform is not configured yet.", 503);
    const lease = crypto.randomUUID();
    const claimed = await storageAdmin()
      .from("reelready_social_credentials")
      .update({
        refresh_lease: lease,
        refresh_until: new Date(Date.now() + 90000).toISOString(),
      })
      .eq("owner_id", owner)
      .eq("platform", platform)
      .or(`refresh_until.is.null,refresh_until.lt.${new Date().toISOString()}`)
      .select("encrypted_credentials,account_id,display_name")
      .maybeSingle();
    if (claimed.error) databaseError(claimed.error);
    if (!claimed.data)
      throw new GenerationError(
        "Account access is being renewed. Please retry in a moment.",
        503,
      );
    credential = decryptSocial<SocialCredential>(
      claimed.data.encrypted_credentials,
      `${owner}:${platform}`,
    );
    r.data.account_id = claimed.data.account_id;
    r.data.display_name = claimed.data.display_name;
    try {
      if (credential.expiresAt < Date.now() + 120000) {
        let raw: Record<string, unknown>;
        if (platform === "instagram") {
          raw = await socialJSON(
            `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: credential.accessToken })}`,
          );
        } else {
          if (!credential.refreshToken)
            throw new GenerationError(
              "Reconnect this account to renew access.",
              409,
            );
          const form = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: credential.refreshToken,
            client_id: config.clientId,
          });
          if (platform === "youtube")
            form.set("client_secret", config.clientSecret);
          raw = await socialJSON(
            platform === "youtube"
              ? "https://oauth2.googleapis.com/token"
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
        }
        const refreshed = z
          .object({
            access_token: z.string().min(1),
            expires_in: z.number().positive(),
            refresh_token: z.string().optional(),
            scope: z.string().optional(),
          })
          .parse(raw);
        credential = {
          accessToken: refreshed.access_token,
          expiresAt: Date.now() + refreshed.expires_in * 1000,
          refreshToken: refreshed.refresh_token || credential.refreshToken,
          scopes: refreshed.scope?.split(" ") || credential.scopes,
        };
        if (
          !requiredScopes[platform].every((scope) =>
            credential.scopes.includes(scope),
          )
        )
          throw new GenerationError(
            "Reconnect this account to grant publishing permissions.",
            409,
          );
        const saved = await storageAdmin()
          .from("reelready_social_credentials")
          .update({
            encrypted_credentials: encryptSocial(
              credential,
              `${owner}:${platform}`,
            ),
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", owner)
          .eq("platform", platform)
          .eq("refresh_lease", lease)
          .eq("encrypted_credentials", claimed.data.encrypted_credentials)
          .select("owner_id");
        if (saved.error) databaseError(saved.error);
        if (!saved.data?.length)
          throw new GenerationError(
            "This connection changed while renewing access. Refresh your accounts.",
            503,
          );
      }
    } finally {
      await storageAdmin()
        .from("reelready_social_credentials")
        .update({ refresh_lease: null, refresh_until: null })
        .eq("owner_id", owner)
        .eq("platform", platform)
        .eq("refresh_lease", lease);
    }
  }
  return {
    accountId: r.data.account_id,
    name: r.data.display_name,
    credential,
  };
}
export async function getAccount(owner: string, platform: Platform) {
  const key = `${owner}:${platform}`;
  if (!refreshing.has(key))
    refreshing.set(
      key,
      loadAccount(owner, platform).finally(() => refreshing.delete(key)),
    );
  return refreshing.get(key)!;
}
