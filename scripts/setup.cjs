const fs = require("node:fs");
const crypto = require("node:crypto");
let content = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
function value(key) {
  const line = content.split(/\r?\n/).find((l) => l.startsWith(key + "="));
  return line?.slice(key.length + 1).replace(/^["']|["']$/g, "");
}
function put(key, val) {
  const line = key + "=" + JSON.stringify(val);
  const re = new RegExp("^" + key + "=.*$", "m");
  content = re.test(content)
    ? content.replace(re, () => line)
    : content.trimEnd() + "\n" + line + "\n";
}
if (!value("APP_ENCRYPTION_KEY"))
  put("APP_ENCRYPTION_KEY", crypto.randomBytes(32).toString("hex"));
if (!value("CRON_SECRET"))
  put("CRON_SECRET", crypto.randomBytes(32).toString("base64url"));
if (!value("APP_URL")) put("APP_URL", "http://localhost:3000");
for (const key of ["DATABASE_URL", "DIRECT_URL"])
  if (value(key)) {
    const url = new URL(value(key));
    url.searchParams.set("schema", "forcemultiplier");
    put(key, url.toString());
  }
fs.writeFileSync(".env", content, { mode: 0o600 });
fs.chmodSync(".env", 0o600);
console.log(
  "Local configuration ready. Keep .env private and back up APP_ENCRYPTION_KEY.",
);
if (
  !value("NEXT_PUBLIC_SUPABASE_URL") ||
  !value("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
)
  console.log(
    "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from Supabase Connect before signing in.",
  );
