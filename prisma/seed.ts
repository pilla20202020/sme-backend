import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  // ─── ROLES ───────────────────────────────────────────────────────────────────
  // Matches the AI SME target personas (BRD §6): Owner, Manager, Cashier/Staff,
  // Inventory Staff, Accountant, Admin/Support.
  //
  // Upserts key on roleName (now @unique), not a hardcoded roleId. Keying on
  // an assumed roleId while running all 6 upserts concurrently via
  // Promise.all was a real bug: on the very first run (empty table), none of
  // the `where: { roleId: N }` clauses matched anything, so all 6 fell
  // through to `create` — which never pinned an explicit roleId — and
  // Postgres assigned autoincrement IDs in whatever order the concurrent
  // inserts actually committed, not the array's declared order. Every later
  // run's `update: {}` then preserved that scrambled mapping forever
  // (upsert doesn't rename a role that already exists under a different
  // roleId, since it never matched it as "existing" via roleId in the first
  // place). Keying on the unique roleName instead makes this correct
  // regardless of concurrency or run order.
  const [
    roleAdmin,
    roleOwner,
    roleManager,
    roleCashier,
    roleInventoryStaff,
    roleAccountant,
  ] = await Promise.all([
    prisma.role.upsert({
      where: { roleName: 'admin' },
      update: {},
      create: {
        roleName: 'admin',
        description: 'Platform admin/support — tenant governance and billing',
      },
    }),
    prisma.role.upsert({
      where: { roleName: 'owner' },
      update: {},
      create: {
        roleName: 'owner',
        description:
          'Business owner — visibility, control, AI insights and approvals',
      },
    }),
    prisma.role.upsert({
      where: { roleName: 'manager' },
      update: {},
      create: {
        roleName: 'manager',
        description:
          'Branch manager — daily sales, purchasing and inventory operations',
      },
    }),
    prisma.role.upsert({
      where: { roleName: 'cashier' },
      update: {},
      create: {
        roleName: 'cashier',
        description: 'Cashier/staff — fast sales and returns',
      },
    }),
    prisma.role.upsert({
      where: { roleName: 'inventory_staff' },
      update: {},
      create: {
        roleName: 'inventory_staff',
        description: 'Inventory staff — receiving and accurate stock',
      },
    }),
    prisma.role.upsert({
      where: { roleName: 'accountant' },
      update: {},
      create: {
        roleName: 'accountant',
        description: 'Accountant — reconciliation and exports',
      },
    }),
  ]);

  console.log('  ✓ Roles');

  // ─── PERMISSIONS ─────────────────────────────────────────────────────────────
  // Only the permissions exercised by code shipped so far (users module +
  // tenant registration). Later stories add resource-specific permissions
  // (catalog, purchasing, inventory, sales, billing) as those modules land.
  const permissions = await Promise.all([
    prisma.permission.upsert({
      where: { name: 'user:create' },
      update: {},
      create: { resource: 'user', action: 'create', name: 'user:create' },
    }),
    prisma.permission.upsert({
      where: { name: 'user:read' },
      update: {},
      create: { resource: 'user', action: 'read', name: 'user:read' },
    }),
    prisma.permission.upsert({
      where: { name: 'tenant:read' },
      update: {},
      create: { resource: 'tenant', action: 'read', name: 'tenant:read' },
    }),
    prisma.permission.upsert({
      where: { name: 'tenant:update' },
      update: {},
      create: { resource: 'tenant', action: 'update', name: 'tenant:update' },
    }),
    prisma.permission.upsert({
      where: { name: 'branch:create' },
      update: {},
      create: { resource: 'branch', action: 'create', name: 'branch:create' },
    }),
    prisma.permission.upsert({
      where: { name: 'branch:read' },
      update: {},
      create: { resource: 'branch', action: 'read', name: 'branch:read' },
    }),
    // Product catalog (STORY-006..009 / EPIC-002). Customer/supplier
    // permissions are EPIC-003 scope — not added here.
    prisma.permission.upsert({
      where: { name: 'catalog:create' },
      update: {},
      create: { resource: 'catalog', action: 'create', name: 'catalog:create' },
    }),
    prisma.permission.upsert({
      where: { name: 'catalog:read' },
      update: {},
      create: { resource: 'catalog', action: 'read', name: 'catalog:read' },
    }),
    prisma.permission.upsert({
      where: { name: 'catalog:update' },
      update: {},
      create: { resource: 'catalog', action: 'update', name: 'catalog:update' },
    }),
    // Customers & suppliers (STORY-010/011 / EPIC-003).
    prisma.permission.upsert({
      where: { name: 'customer:create' },
      update: {},
      create: {
        resource: 'customer',
        action: 'create',
        name: 'customer:create',
      },
    }),
    prisma.permission.upsert({
      where: { name: 'customer:read' },
      update: {},
      create: { resource: 'customer', action: 'read', name: 'customer:read' },
    }),
    prisma.permission.upsert({
      where: { name: 'supplier:create' },
      update: {},
      create: {
        resource: 'supplier',
        action: 'create',
        name: 'supplier:create',
      },
    }),
    prisma.permission.upsert({
      where: { name: 'supplier:read' },
      update: {},
      create: { resource: 'supplier', action: 'read', name: 'supplier:read' },
    }),
    // Purchasing & receiving (STORY-012..014 / EPIC-004).
    prisma.permission.upsert({
      where: { name: 'purchasing:create' },
      update: {},
      create: {
        resource: 'purchasing',
        action: 'create',
        name: 'purchasing:create',
      },
    }),
    prisma.permission.upsert({
      where: { name: 'purchasing:read' },
      update: {},
      create: {
        resource: 'purchasing',
        action: 'read',
        name: 'purchasing:read',
      },
    }),
    prisma.permission.upsert({
      where: { name: 'purchasing:update' },
      update: {},
      create: {
        resource: 'purchasing',
        action: 'update',
        name: 'purchasing:update',
      },
    }),
    // Audit log (STORY-036/037 / EPIC-013). Admin-only by deliberate design —
    // covered automatically by admin's "grant all" loop below; never added
    // to owner's or manager's permission list (PRD Part B: "retrievable by
    // authorized Admin/Support roles only" is intentional, not an oversight
    // — even a tenant's own owner is denied).
    prisma.permission.upsert({
      where: { name: 'audit:read' },
      update: {},
      create: { resource: 'audit', action: 'read', name: 'audit:read' },
    }),
    // Inventory management (STORY-015..018 / EPIC-005).
    prisma.permission.upsert({
      where: { name: 'inventory:read' },
      update: {},
      create: {
        resource: 'inventory',
        action: 'read',
        name: 'inventory:read',
      },
    }),
    prisma.permission.upsert({
      where: { name: 'inventory:adjust' },
      update: {},
      create: {
        resource: 'inventory',
        action: 'adjust',
        name: 'inventory:adjust',
      },
    }),
    // Sales / POS (STORY-019..022 / EPIC-006). sales:create is cashier's
    // first-ever permission in this project — previous sprints left cashier
    // with zero permissions because nothing cashier-relevant existed yet.
    prisma.permission.upsert({
      where: { name: 'sales:read' },
      update: {},
      create: { resource: 'sales', action: 'read', name: 'sales:read' },
    }),
    prisma.permission.upsert({
      where: { name: 'sales:create' },
      update: {},
      create: { resource: 'sales', action: 'create', name: 'sales:create' },
    }),
    // Returns (STORY-023/024 / EPIC-007). returns:override is deliberately
    // NOT granted to cashier — it's the whole point of STORY-024's
    // manager-override check.
    prisma.permission.upsert({
      where: { name: 'returns:create' },
      update: {},
      create: { resource: 'returns', action: 'create', name: 'returns:create' },
    }),
    prisma.permission.upsert({
      where: { name: 'returns:override' },
      update: {},
      create: {
        resource: 'returns',
        action: 'override',
        name: 'returns:override',
      },
    }),
    prisma.permission.upsert({
      where: { name: 'returns:read' },
      update: {},
      create: { resource: 'returns', action: 'read', name: 'returns:read' },
    }),
    // Expenses & cash (STORY-025/026 / EPIC-008). expense:create mirrors
    // inventory:adjust's "the people who cause it record it" pattern —
    // explicitly NOT cashier, NOT accountant. cash:read is an
    // owner/accountant-facing reconciliation view — explicitly NOT cashier.
    prisma.permission.upsert({
      where: { name: 'expense:create' },
      update: {},
      create: { resource: 'expense', action: 'create', name: 'expense:create' },
    }),
    prisma.permission.upsert({
      where: { name: 'expense:read' },
      update: {},
      create: { resource: 'expense', action: 'read', name: 'expense:read' },
    }),
    prisma.permission.upsert({
      where: { name: 'cash:read' },
      update: {},
      create: { resource: 'cash', action: 'read', name: 'cash:read' },
    }),
  ]);

  console.log('  ✓ Permissions');

  // ─── ADMIN USER ────────────────────────────────────────────────────────────────
  const userAdmin = await prisma.user.upsert({
    where: { ssoUserId: 1001 },
    update: {},
    create: {
      ssoUserId: 1001,
      email: 'admin@aismeplatform.com',
      firstName: 'System',
      lastName: 'Admin',
      phone: '555-0100',
      isActive: true,
    },
  });

  console.log('  ✓ Admin user');

  // ─── USER ROLES ───────────────────────────────────────────────────────────────
  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: userAdmin.userId, roleId: roleAdmin.roleId },
    },
    update: {},
    create: { userId: userAdmin.userId, roleId: roleAdmin.roleId },
  });

  console.log('  ✓ User roles');

  // ─── ROLE PERMISSIONS ─────────────────────────────────────────────────────────
  // Admin gets all permissions.
  for (const perm of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleAdmin.roleId,
          permissionId: perm.permissionId,
        },
      },
      update: {},
      create: { roleId: roleAdmin.roleId, permissionId: perm.permissionId },
    });
  }
  // Owner gets tenant read/update, branch management, and staff invitation
  // (STORY-003 — "As a pharmacy owner, I want to invite staff...").
  for (const name of [
    'tenant:read',
    'tenant:update',
    'branch:create',
    'branch:read',
    'user:create',
    'user:read',
    'catalog:create',
    'catalog:read',
    'catalog:update',
    'customer:create',
    'customer:read',
    'supplier:create',
    'supplier:read',
    'purchasing:create',
    'purchasing:read',
    'purchasing:update',
    'inventory:read',
    'inventory:adjust',
    'sales:read',
    'sales:create',
    'returns:create',
    'returns:override',
    'returns:read',
    'expense:create',
    'expense:read',
    'cash:read',
  ]) {
    const perm = permissions.find((p) => p.name === name)!;
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleOwner.roleId,
          permissionId: perm.permissionId,
        },
      },
      update: {},
      create: { roleId: roleOwner.roleId, permissionId: perm.permissionId },
    });
  }

  // Manager gets read-only branch visibility plus full day-to-day catalog
  // management (create/read/update products, categories, pricing, batches),
  // plus customer/supplier create+read and full purchasing/receiving
  // (day-to-day branch/catalog/purchasing operations, not tenant governance —
  // matches BRD's "Manager: daily sales, purchasing and inventory
  // operations").
  //
  // user:read (fast-follow, found by Sprint 14 UI's QA pass): STORY-053's
  // own "asA" is "branch manager" ("I want [to] approve a return with no
  // matching original sale"), and its override panel's approver picker
  // (PRD §4) resolves a named approver via GET /tenants/:tenantId/users
  // (Sprint 10's staff list, gated user:read) — a permission manager never
  // held, because Sprint 10's own grant was written only for STORY-003's
  // "as a pharmacy owner, I want to invite staff" narrative, not because
  // manager was ever deliberately barred from seeing the tenant's own staff
  // directory. Without it, the exact screen this story exists for comes up
  // with an empty/erroring approver dropdown for its own intended user.
  // Deliberately NOT granting user:create alongside it — inviting new staff
  // stays owner-only (STORY-003's own scope); this is a narrow, read-only,
  // least-privilege addition mirroring the inventory_staff catalog:read /
  // purchasing:read+update fast-follows above, not a broader "manager can
  // administer staff" decision.
  for (const name of [
    'branch:read',
    'user:read',
    'catalog:create',
    'catalog:read',
    'catalog:update',
    'customer:create',
    'customer:read',
    'supplier:create',
    'supplier:read',
    'purchasing:create',
    'purchasing:read',
    'purchasing:update',
    'inventory:read',
    'inventory:adjust',
    'sales:read',
    'sales:create',
    'returns:create',
    'returns:override',
    'returns:read',
    'expense:create',
    'expense:read',
    'cash:read',
  ]) {
    const perm = permissions.find((p) => p.name === name)!;
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleManager.roleId,
          permissionId: perm.permissionId,
        },
      },
      update: {},
      create: { roleId: roleManager.roleId, permissionId: perm.permissionId },
    });
  }

  // Inventory staff (STORY-015..018 / EPIC-005) — receiving already gives
  // them a movement trail; this sprint adds explicit read of that ledger
  // plus the manual adjustment endpoint (mirrors BRD "Inventory staff —
  // receiving and accurate stock").
  //
  // purchasing:read/update (fast-follow, found by Sprint 12 UI's QA pass):
  // the BRD's own persona narrative (Bikash, Inventory Staff — "checks
  // received quantities/batches/expiry dates against the PO... system must
  // let him record the actual received amount") describes inventory_staff
  // as the one who performs receiving, but this role never actually held
  // purchasing:read/update — meaning the Sprint 3 backend endpoint and the
  // Sprint 12 "Receive Stock" screen were both unusable by their intended
  // real-world user. Deliberately NOT granting purchasing:create — creating
  // a PO stays owner/manager's job, only receiving against an existing one
  // is inventory_staff's.
  //
  // catalog:read (fast-follow, found by Sprint 13 UI's QA pass): the manual
  // stock adjustment screen's product picker calls GET /products, which
  // requires catalog:read — a permission this role never held, so the
  // adjustment form's product dropdown came up empty via its main entry
  // point (the page-level "+ Adjust Stock" button) for the exact role whose
  // job (BRD: "receiving and accurate stock") this screen exists for. The
  // only workaround was the Low Stock tab's per-row "Adjust" shortcut, which
  // only reaches products already flagged low-stock — not the general
  // "correct any product's count after a recount" case STORY-050 is for.
  // Same shape and same additive, read-only, least-privilege fix as the
  // purchasing:read/update grant above — NOT catalog:create/update, which
  // stay owner/manager's job.
  for (const name of [
    'inventory:read',
    'inventory:adjust',
    'purchasing:read',
    'purchasing:update',
    'catalog:read',
  ]) {
    const perm = permissions.find((p) => p.name === name)!;
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleInventoryStaff.roleId,
          permissionId: perm.permissionId,
        },
      },
      update: {},
      create: {
        roleId: roleInventoryStaff.roleId,
        permissionId: perm.permissionId,
      },
    });
  }

  // Accountant gets read-only visibility into inventory (reconciliation) but
  // explicitly NOT inventory:adjust — mirrors BRD "Accountant — reconciliation
  // and exports", not day-to-day stock correction. sales:read added this
  // sprint (STORY-019..022 / EPIC-006) for cash/sales reconciliation (PRD
  // FR-19 persona rationale) — still explicitly NOT sales:create.
  for (const name of [
    'inventory:read',
    'sales:read',
    'returns:read',
    'expense:read',
    'cash:read',
  ]) {
    const perm = permissions.find((p) => p.name === name)!;
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleAccountant.roleId,
          permissionId: perm.permissionId,
        },
      },
      update: {},
      create: {
        roleId: roleAccountant.roleId,
        permissionId: perm.permissionId,
      },
    });
  }

  // Cashier (STORY-019..022 / EPIC-006) — this sprint's Sales/POS module is
  // the first-ever resource cashier gets a permission for; every prior
  // sprint left them at zero since nothing cashier-relevant existed yet.
  // Explicitly NOT inventory:adjust (PRD STORY-016) or any purchasing/
  // catalog-management permission — cashier's scope this sprint is checkout
  // only.
  for (const name of [
    'sales:read',
    'sales:create',
    'returns:create',
    'returns:read',
  ]) {
    const perm = permissions.find((p) => p.name === name)!;
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleCashier.roleId,
          permissionId: perm.permissionId,
        },
      },
      update: {},
      create: {
        roleId: roleCashier.roleId,
        permissionId: perm.permissionId,
      },
    });
  }

  console.log('  ✓ Role permissions');

  // ─── SAMPLE TENANT ─────────────────────────────────────────────────────────────
  await prisma.tenant.upsert({
    where: { tenantId: 1 },
    update: {},
    create: {
      tenantId: 1,
      name: 'Sample Pharmacy Pvt. Ltd.',
      vertical: 'pharmacy',
      currency: 'NPR',
      batchExpiryTrackingEnabled: true,
      isActive: true,
    },
  });

  console.log('  ✓ Sample tenant');

  // The upsert above inserts an explicit tenantId, which does not advance
  // Postgres's autoincrement sequence — without this, the next real
  // registration via TenantsService.register() collides with tenantId 1.
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('tenants', 'tenant_id'), (SELECT MAX(tenant_id) FROM tenants))`,
  );

  console.log('\n✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
