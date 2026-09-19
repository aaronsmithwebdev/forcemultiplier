import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { AppError } from "./errors";
export const randomToken = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function key() {
  const value = process.env.APP_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new AppError("Run npm run setup to configure encryption.", 503);
  return Buffer.from(value, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}
export function decrypt(value: string) {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body)
    throw new AppError(
      "Stored credentials cannot be read. Reconnect the provider.",
      503,
    );
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(body, "base64url")),
    cipher.final(),
  ]).toString("utf8");
}
export function appUrl() {
  const url = new URL(process.env.APP_URL ?? "http://localhost:3000");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw new AppError("APP_URL must be HTTPS, except on localhost.", 503);
  return url.origin;
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== appUrl())
    throw new AppError("Request origin is not allowed.", 403);
}
export function salesforceHost(value: string, login = false) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("Enter a valid Salesforce HTTPS login URL.");
  }
  const valid = login
    ? ["login.salesforce.com", "test.salesforce.com"].includes(url.hostname) ||
      url.hostname.endsWith(".my.salesforce.com")
    : url.hostname.endsWith(".salesforce.com");
  if (
    url.protocol !== "https:" ||
    !valid ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new AppError(
      "Use login.salesforce.com, test.salesforce.com, or your Salesforce My Domain URL.",
    );
  return url.origin;
}
export function safeProviderPath(base: string, path: string, prefix: string) {
  const url = new URL(path, base);
  if (
    url.origin !== new URL(base).origin ||
    !url.pathname.startsWith(prefix) ||
    url.username ||
    url.password
  )
    throw new AppError(
      "The provider returned an unexpected pagination URL.",
      502,
    );
  return url.toString();
}
