require("@next/env").loadEnvConfig(process.cwd());
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({ log: [] });
(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    console.log("Database connection: successful");
    console.log(
      "Workspace tables:",
      (
        await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='forcemultiplier' ORDER BY tablename`
      )
        .map((r) => r.tablename)
        .join(", "),
    );
    console.log("Connections:", await db.connection.count());
    console.log("Audiences:", await db.audience.count());
  } catch (e) {
    console.error("Database check failed:", e.code || e.name);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
})();
