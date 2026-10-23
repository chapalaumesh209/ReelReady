import { z } from "zod";
import { GenerationError, generationConfiguration } from "@/lib/generation";
import { body, failure, json, limit, session } from "@/lib/server";
import {
  connections,
  profileName,
  providerFailure,
  uploadPost,
} from "@/lib/upload-post";
import { platforms } from "@/lib/workflow";
export async function GET(req: Request) {
  let cookie: string | undefined;
  try {
    const visitor = await session(req, true);
    cookie = visitor.cookie;
    const state = await connections(visitor.id);
    return json(
      { ...state, aiConfigured: !!generationConfiguration().key },
      200,
      visitor.cookie ? { "Set-Cookie": visitor.cookie } : undefined,
    );
  } catch (e) {
    const response = failure(e);
    if (cookie) response.headers.set("Set-Cookie", cookie);
    return response;
  }
}
export async function POST(req: Request) {
  try {
    const visitor = await session(req);
    limit(visitor.id, "connect", 5);
    const { action, platform } = await body(
      req,
      z.object({
        action: z.enum(["connect", "disconnect"]),
        platform: z.enum(platforms).optional(),
      }),
    );
    const username = profileName(visitor.id);
    limit(
      req.headers.get("cf-connecting-ip") || visitor.id,
      "connection-creation",
      5,
      86400000,
    );
    if (action === "disconnect") {
      if (!platform)
        throw new GenerationError("Choose an account to disconnect.", 400);
      const response = await uploadPost("/api/uploadposts/users/social", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_username: username,
          social_platform: platform,
        }),
      });
      if (!response.ok && response.status !== 404)
        return providerFailure(response);
      return json({ disconnected: true });
    }
    // Profile creation happens only after the visitor presses Connect.
    const created = await uploadPost("/api/uploadposts/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, display_name: "ReelReady creator" }),
    });
    if (!created.ok && created.status !== 409) return providerFailure(created);
    const origin = new URL(req.url).origin;
    const response = await uploadPost("/api/uploadposts/users/generate-jwt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        redirect_url: `${origin}/?connected=1`,
        logo_image: `${origin}/favicon.svg`,
        redirect_button_text: "Return to ReelReady",
        connect_title: "Connect your ReelReady accounts",
        connect_description:
          "Choose where your approved reels will be published.",
        platforms: [...platforms],
        show_calendar: false,
        connect_theme: "light",
      }),
    });
    if (!response.ok) return providerFailure(response);
    const data = (await response.json()) as { access_url?: string };
    const url = new URL(data.access_url || "");
    if (url.protocol !== "https:" || url.hostname !== "app.upload-post.com")
      throw new GenerationError(
        "The connection link was invalid. Try again.",
        502,
      );
    return json({ url: url.href });
  } catch (e) {
    return failure(e);
  }
}
