-- CreateEnum
CREATE TYPE "inventory_movement_type" AS ENUM ('receipt', 'adjustment', 'sale', 'return');

-- CreateTable
CREATE TABLE "inventory_movements" (
    "movement_id" BIGSERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_batch_id" INTEGER,
    "movement_type" "inventory_movement_type" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reason" TEXT,
    "reference_type" VARCHAR(50),
    "reference_id" INTEGER,
    "actor_id" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("movement_id")
);

-- CreateIndex
CREATE INDEX "inventory_movements_tenant_id_idx" ON "inventory_movements"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_movements_product_id_idx" ON "inventory_movements"("product_id");

-- CreateIndex
CREATE INDEX "inventory_movements_product_batch_id_idx" ON "inventory_movements"("product_batch_id");

-- CreateIndex
CREATE INDEX "inventory_movements_occurred_at_idx" ON "inventory_movements"("occurred_at");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_batch_id_fkey" FOREIGN KEY ("product_batch_id") REFERENCES "product_batches"("batch_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
