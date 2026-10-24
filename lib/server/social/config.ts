import { GenerationError } from "../../generation";
import type { Platform } from "../../workflow";
export const requiredScopes: Record<Platform, string[]> = {
  youtube: [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
  ],
  instagram: ["instagram_business_basic", "instagram_business_content_publish"],
  x: [
    "tweet.read",
    "tweet.write",
    "users.read",
    "offline.access",
    "media.write",
  ],
};
export function socialConfiguration(platform: Platform) {
  const prefix =
    platform === "youtube"
      ? "GOOGLE"
      : platform === "instagram"
        ? "INSTAGRAM"
        : "X";
  const clientId = process.env[`${prefix}_CLIENT_ID`] || "",
    clientSecret = process.env[`${prefix}_CLIENT_SECRET`] || "";
  const encryption =
    Buffer.from(process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || "", "base64")
      .length === 32;
  return {
    clientId,
    clientSecret,
    configured: !!clientId && !!clientSecret && encryption,
  };
}
export const nativeConfigured = () =>
  (["youtube", "instagram", "x"] as const).some(
    (p) => socialConfiguration(p).configured,
  );
export const instagramGraph = () => {
  const version = process.env.INSTAGRAM_API_VERSION || "v24.0";
  if (!/^v\d+\.\d+$/.test(version))
    throw new GenerationError("Instagram configuration needs attention.", 503);
  return `https://graph.instagram.com/${version}`;
};
