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
    const withoutRls = await db.$queryRaw`
      SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND (n.nspname = 'forcemultiplier'
          OR (n.nspname = 'public' AND c.relname IN (
            'Contact', 'ContactProperty', 'IntegrationAccount',
            'IntegrationFieldMap', 'ListSync', 'ListSyncContact',
            'SalesforceToken', 'SyncJob'
          )))
        AND NOT c.relrowsecurity
      ORDER BY name`;
    if (withoutRls.length)
      throw new Error(
        `RLS disabled on: ${withoutRls.map((r) => r.name).join(", ")}`,
      );
    console.log("Application table RLS: enabled");
  } catch (e) {
    console.error(
      "Database check failed:",
      e.message?.startsWith("RLS disabled on:") ? e.message : e.code || e.name,
    );
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
})();
