-- CreateTable
CREATE TABLE "document_counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("key")
);

-- Backfill: continue numbering after the POs that already exist ("PO-2026-00002" -> key "PO-2026", value 2).
INSERT INTO "document_counters" ("key", "value")
SELECT 'PO-' || substr("poNumber", 4, 4), MAX(CAST(substr("poNumber", 9) AS INTEGER))
FROM "purchase_orders"
WHERE "poNumber" ~ '^PO-[0-9]{4}-[0-9]+$'
GROUP BY 1
ON CONFLICT ("key") DO NOTHING;
