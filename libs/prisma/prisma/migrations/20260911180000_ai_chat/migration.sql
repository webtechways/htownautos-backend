-- Chat de IA sobre los datos de subasta: conversaciones y mensajes por usuario.

CREATE TABLE "ai_chat_conversations" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- La lista del usuario va ordenada por actividad reciente.
CREATE INDEX "ai_chat_conversations_userId_updatedAt_idx"
  ON "ai_chat_conversations"("userId", "updatedAt");
CREATE INDEX "ai_chat_conversations_tenantId_idx"
  ON "ai_chat_conversations"("tenantId");

CREATE TABLE "ai_chat_messages" (
  "id"             TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role"           TEXT NOT NULL,
  "content"        TEXT NOT NULL,
  -- Que herramientas se llamaron: permite auditar de donde salio una cifra.
  "toolCalls"      JSONB,
  -- Consumo real por mensaje, para saber lo que cuesta sin esperar a la factura.
  "tokensIn"       INTEGER,
  "tokensOut"      INTEGER,
  "model"          TEXT,
  "latencyMs"      INTEGER,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_chat_messages_conversationId_createdAt_idx"
  ON "ai_chat_messages"("conversationId", "createdAt");

ALTER TABLE "ai_chat_messages"
  ADD CONSTRAINT "ai_chat_messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "ai_chat_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
