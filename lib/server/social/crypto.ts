import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { GenerationError } from "../../generation";
function key() {
  const value = Buffer.from(
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || "",
    "base64",
  );
  if (value.length !== 32)
    throw new GenerationError(
      "Secure social account storage is not configured yet.",
      503,
    );
  return value;
}
export function encryptSocial(value: unknown, context: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function decryptSocial<T>(value: string, context: string): T {
  try {
    const data = Buffer.from(value, "base64url"),
      decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    ) as T;
  } catch {
    throw new GenerationError(
      "This account needs to be reconnected securely.",
      409,
    );
  }
}
export const stateHash = (state: string) =>
  createHash("sha256").update(state).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
