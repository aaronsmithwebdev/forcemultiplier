ALTER TABLE "forcemultiplier"."FunraisinParticipant" ADD COLUMN "firstName" TEXT;

CREATE TABLE "forcemultiplier"."FunraisinTeam" (
    "teamId" TEXT NOT NULL,
    "eventId" TEXT,
    "name" TEXT NOT NULL,
    "lastSeenScan" TEXT,
    CONSTRAINT "FunraisinTeam_pkey" PRIMARY KEY ("teamId")
);

ALTER TABLE "forcemultiplier"."FunraisinDonation"
ADD COLUMN "memberId" TEXT,
ADD COLUMN "teamId" TEXT,
ADD COLUMN "donatedAt" TIMESTAMP(3);
