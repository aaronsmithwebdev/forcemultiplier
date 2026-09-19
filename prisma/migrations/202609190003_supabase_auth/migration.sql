ALTER TABLE "forcemultiplier"."OAuthAttempt"
  DROP CONSTRAINT "OAuthAttempt_sessionId_fkey";

ALTER TABLE "forcemultiplier"."OAuthAttempt"
  RENAME COLUMN "sessionId" TO "userId";

DROP TABLE "forcemultiplier"."Session";
DROP TABLE "forcemultiplier"."Admin";
DROP TABLE "forcemultiplier"."RateLimit";
