export const demoMode = () => process.env.DEMO_MODE !== "false";
export function appOrigin(req: Request) {
  const configured = process.env.APP_URL;
  if (configured) {
    const u = new URL(configured);
    return u.origin;
  }
  const u = new URL(req.url);
  if (!["127.0.0.1", "localhost"].includes(u.hostname))
    throw new Error("APP_URL is required");
  return u.origin;
}
