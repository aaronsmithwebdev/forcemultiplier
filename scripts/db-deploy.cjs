require("@next/env").loadEnvConfig(process.cwd());
const { spawnSync } = require("node:child_process");
for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
  try {
    if (
      new URL(process.env[name]).searchParams.get("schema") !==
      "forcemultiplier"
    )
      throw new Error();
  } catch {
    console.error(
      name +
        " must target the forcemultiplier schema. Run npm run setup first.",
    );
    process.exit(1);
  }
}
const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
