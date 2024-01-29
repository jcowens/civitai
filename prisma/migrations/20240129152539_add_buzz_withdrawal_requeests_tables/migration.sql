-- CreateEnum
CREATE TYPE "BuzzWithdrawalRequestStatus" AS ENUM ('Requested', 'Canceled', 'Rejected', 'Approved', 'Reverted', 'Transferred');
-- CreateTable

CREATE TABLE "BuzzWithdrawalRequestHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "updatedById" INTEGER NOT NULL,
    "status" "BuzzWithdrawalRequestStatus" NOT NULL DEFAULT 'Requested',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "BuzzWithdrawalRequestHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuzzWithdrawalRequest" (
    "id" TEXT NOT NULL,
    "userId" INTEGER,
    "connectedAccountId" TEXT NOT NULL,
    "buzzWithdrawalTransactionId" TEXT NOT NULL,
    "requestedBuzzAmount" INTEGER NOT NULL,
    "platformFeeRate" INTEGER NOT NULL,
    "transferredAmount" INTEGER,
    "transferId" TEXT,
    "currency" "Currency",
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "BuzzWithdrawalRequestStatus" NOT NULL DEFAULT 'Requested',

    CONSTRAINT "BuzzWithdrawalRequest_pkey" PRIMARY KEY ("id")
);
 
-- AddForeignKey
ALTER TABLE "BuzzWithdrawalRequestHistory" ADD CONSTRAINT "BuzzWithdrawalRequestHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BuzzWithdrawalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuzzWithdrawalRequestHistory" ADD CONSTRAINT "BuzzWithdrawalRequestHistory_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuzzWithdrawalRequest" ADD CONSTRAINT "BuzzWithdrawalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION update_buzz_withdrawal_request_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Update status to be the latest
    UPDATE "BuzzWithdrawalRequest" SET "status" = NEW."status", "updatedAt" = now() WHERE "id" = NEW."requestId";
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
---
CREATE OR REPLACE TRIGGER trigger_update_buzz_withdrawal_request_status
AFTER INSERT ON "UserBuzzWithdrawalRequestHistory"
FOR EACH ROW
EXECUTE FUNCTION update_buzz_withdrawal_request_status();