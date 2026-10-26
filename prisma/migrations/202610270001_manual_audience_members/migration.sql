CREATE TABLE "forcemultiplier"."ManualAudienceMember" (
    "audienceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualAudienceMember_pkey" PRIMARY KEY ("audienceId","email")
);

ALTER TABLE "forcemultiplier"."Audience" ADD COLUMN "manualVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "forcemultiplier"."PullRun" ADD COLUMN "manualVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "forcemultiplier"."ManualAudienceMember" ADD CONSTRAINT "ManualAudienceMember_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "forcemultiplier"."Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
