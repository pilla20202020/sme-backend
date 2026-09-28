-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tenant_id" INTEGER,
ALTER COLUMN "sso_user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
