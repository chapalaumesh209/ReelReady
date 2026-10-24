import { GenerationError } from "../generation";
import { repository, databaseError } from "./repository";
import { storageAdmin } from "../supabase";
import { demoMode } from "./config";
import { socialConfiguration, nativeConfigured } from "./social/config";
import { getAccount, identify } from "./social/accounts";
import { startOAuth } from "./social/oauth";
import { SocialAPIError, socialFetch } from "./social/http";
import { decryptSocial } from "./social/crypto";
import type { SocialCredential } from "./social/accounts";
import { instagramGraph } from "./social/config";
import { platforms, type Platform, type Connections } from "../workflow";
import { publishingProvider } from "./provider/config";
import {
  providerConnections,
  startProviderConnection,
  disconnectProvider,
} from "./provider/accounts";
export async function connectionStatus(req: Request): Promise<Connections> {
  if (publishingProvider() === "uploadpost") return providerConnections(req);
  const { user } = await repository(req);
  const accounts: Connections["accounts"] = {};
  await Promise.all(
    platforms.map(async (platform) => {
      if (!socialConfiguration(platform).configured) {
        accounts[platform] = {
          name: "",
          connected: false,
          reauth: false,
          configured: false,
        };
        return;
      }
      try {
        const account = await getAccount(user.id, platform);
        if (!account) {
          accounts[platform] = {
            name: "",
            connected: false,
            reauth: false,
            configured: true,
          };
          return;
        }
        const identity = await identify(platform, account.credential);
        accounts[platform] = {
          name: identity.name,
          accountId: identity.accountId,
          connected: identity.accountId === account.accountId,
          reauth: identity.accountId !== account.accountId,
          configured: true,
        };
      } catch (e) {
        const reauth =
          (e instanceof SocialAPIError &&
            [400, 401, 403].includes(e.providerStatus)) ||
          (e instanceof GenerationError && e.status === 409);
        accounts[platform] = {
          name: "",
          connected: false,
          reauth,
          configured: true,
          unavailable: !reauth,
        };
      }
    }),
  );
  return {
    demo: demoMode(),
    connectionMode: "real",
    configured: nativeConfigured(),
    accounts,
  };
}
export const startConnection = (req: Request, platform: Platform) =>
  publishingProvider() === "uploadpost"
    ? startProviderConnection(req, platform)
    : startOAuth(req, platform);
export async function disconnect(req: Request, platform: Platform) {
  if (publishingProvider() === "uploadpost")
    return disconnectProvider(req, platform);
  const { user } = await repository(req);
  const admin = storageAdmin(),
    config = socialConfiguration(platform);
  const found = await admin
    .from("reelready_social_credentials")
    .select("encrypted_credentials,account_id")
    .eq("owner_id", user.id)
    .eq("platform", platform)
    .maybeSingle();
  if (found.error) databaseError(found.error);
  let revoked = !found.data;
  if (found.data) {
    try {
      const credential = decryptSocial<SocialCredential>(
        found.data.encrypted_credentials,
        `${user.id}:${platform}`,
      );
      const r =
        platform === "instagram"
          ? await socialFetch(
              `${instagramGraph()}/${encodeURIComponent(found.data.account_id)}/permissions`,
              {
                method: "DELETE",
                headers: { Authorization: `Bearer ${credential.accessToken}` },
              },
            )
          : await socialFetch(
              platform === "youtube"
                ? "https://oauth2.googleapis.com/revoke"
                : "https://api.x.com/2/oauth2/revoke",
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
                body: new URLSearchParams({
                  token: credential.refreshToken || credential.accessToken,
                  ...(platform === "x"
                    ? {
                        client_id: config.clientId,
                        token_type_hint: credential.refreshToken
                          ? "refresh_token"
                          : "access_token",
                      }
                    : {}),
                }),
              },
            );
      revoked = r.ok;
    } catch {
      /* A revoked/expired grant can still be removed from this workspace. */
    }
    const removed = await admin
      .from("reelready_social_credentials")
      .delete()
      .eq("owner_id", user.id)
      .eq("platform", platform)
      .eq("encrypted_credentials", found.data.encrypted_credentials);
    if (removed.error) databaseError(removed.error);
  }
  return { revoked };
}
