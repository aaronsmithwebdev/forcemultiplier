ALTER TABLE "forcemultiplier"."FunraisinSync"
  ADD COLUMN "currentYearOnly" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "scanEventIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "eventIndex" INTEGER NOT NULL DEFAULT 0;
