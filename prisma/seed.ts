import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...\n");

  // 1. Cluster
  const cluster = await prisma.cluster.upsert({
    where: { name: "Jakarta Timur" },
    update: {},
    create: { name: "Jakarta Timur" },
  });
  console.log(`✅ Cluster: ${cluster.name} (${cluster.id})`);

  // 2. Hub Jatinegara
  const hub = await prisma.hub.upsert({
  where: { name: "GTL Jatinegara Hub" },
  update: { hmsHubId: "460450593288" },
  create: {
    name: "GTL Jatinegara Hub",
    hmsHubId: "460450593288",
    region: "Jakarta Timur",
    clusterId: cluster.id,
  },
});
  console.log(`✅ Hub: ${hub.name} (${hub.id})`);

  // 3. Users
  const passwordHash = await bcrypt.hash("password123", 10);

  const users = [
    { email: "manager@goto.com", name: "Budi Manager", role: "MANAGER" as const },
    { email: "spv.barat@goto.com", name: "Andi SPV Barat", role: "SPV" as const },
    { email: "spv.timur@goto.com", name: "Sari SPV Timur", role: "SPV" as const },
    { email: "lead.cakung@goto.com", name: "Rina Lead Cakung", role: "HUB_LEAD" as const },
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        password: passwordHash,
        role: u.role,
        hmsToken: null,
      },
    });
    console.log(`✅ User: ${user.email} (${user.role})`);

    // Link user ke hub
    await prisma.userHub.upsert({
      where: { userId_hubId: { userId: user.id, hubId: hub.id } },
      update: {},
      create: { userId: user.id, hubId: hub.id },
    });
  }

  console.log("\n🎉 Seed selesai!\n");
  console.log("Login credentials:");
  console.log("  Email:    manager@goto.com");
  console.log("  Password: password123\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });