// THROWAWAY verification script for SPRINT-016 / STORY-056 manual QA only.
// Not committed, not part of any shipped file (PRD §2). Run with cwd =
// ai-backend so require() resolves node_modules and dotenv reads its .env.
//
// Usage: node verify-sprint16.js list      -> lists tenant 514's users/roles
// Usage: node verify-sprint16.js set-admin-pw -> sets a passwordHash on the
//        seeded admin user (ssoUserId 1001) so it can be logged into via
//        POST /auth/login for curl verification. Never reverted (PRD §2 —
//        local dev DB state, not something that ships; prisma/seed.ts
//        itself is untouched).

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function list() {
  const users = await prisma.user.findMany({
    where: { tenantId: 514 },
    include: { roles: { include: { role: true } } },
  });
  for (const u of users) {
    console.log(
      u.email,
      '| active:', u.isActive,
      '| hasPasswordHash:', !!u.passwordHash,
      '| roles:', u.roles.map((ur) => ur.role.roleName).join(',')
    );
  }
}

async function setAdminPw() {
  const passwordHash = await bcrypt.hash('AdminVerify@123', 12);
  const updated = await prisma.user.update({
    where: { ssoUserId: 1001 },
    data: { passwordHash },
  });
  console.log('Set passwordHash for admin user id', updated.userId, updated.email);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'list') await list();
  else if (cmd === 'set-admin-pw') await setAdminPw();
  else console.log('usage: node verify-sprint16.js [list|set-admin-pw]');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
