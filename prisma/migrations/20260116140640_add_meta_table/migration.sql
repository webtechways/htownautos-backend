-- CreateTable
CREATE TABLE "metas" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'string',
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metas_entityType_entityId_idx" ON "metas"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "metas_userId_idx" ON "metas"("userId");

-- CreateIndex
CREATE INDEX "metas_key_idx" ON "metas"("key");

-- CreateIndex
CREATE INDEX "metas_isActive_idx" ON "metas"("isActive");

-- CreateIndex
CREATE INDEX "metas_isSystem_idx" ON "metas"("isSystem");

-- CreateIndex
CREATE UNIQUE INDEX "metas_entityType_entityId_key_key" ON "metas"("entityType", "entityId", "key");
