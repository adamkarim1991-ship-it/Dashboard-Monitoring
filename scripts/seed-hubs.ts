import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HUBS = [
  { name: "GTL Ciracas Hub", hmsHubId: "294" },
  { name: "GTL Duren Sawit Hub", hmsHubId: "272" },
  { name: "GTL Jatinegara Hub", hmsHubId: "460450593288" },
  { name: "GTL Kramatjati Hub", hmsHubId: "303" },
  { name: "GTL Matraman Hub", hmsHubId: "460450593308" },
  { name: "GTL Pasar Rebo Hub", hmsHubId: "460450593295" },
  { name: "GTL Pulogadung Hub", hmsHubId: "275" },
  { name: "GTL Senen Hub", hmsHubId: "460450593312" },
  { name: "GTL Tanahabang Hub", hmsHubId: "302" },
];

async function main() {
  console.log("🌱 Seeding hubs for Jabodetabek - East...\n");

  // 1. Create/Upsert Cluster
  const cluster = await prisma.cluster.upsert({
    where: { name: "Jabodetabek - East" },
    create: { name: "Jabodetabek - East" },
    update: {},
  });
  console.log(`✅ Cluster: ${cluster.name} (${cluster.id})\n`);

  // 2. Upsert 9 hubs
  for (const h of HUBS) {
    const hub = await prisma.hub.upsert({
      where: { hmsHubId: h.hmsHubId },
      create: {
        name: h.name,
        hmsHubId: h.hmsHubId,
        region: "Jabodetabek",
        clusterId: cluster.id,
      },
      update: {
        name: h.name,
        clusterId: cluster.id,
      },
    });
    console.log(`✅ Hub: ${hub.name} (hmsHubId: ${hub.hmsHubId})`);
  }

  // 3. Setup user SPV — kasih akses ke SEMUA 9 hub
  const spvEmail = "spv.barat@goto.com";
  const spvUser = await prisma.user.findUnique({
    where: { email: spvEmail },
  });

  if (spvUser) {
    console.log(`\n👤 Found SPV user: ${spvUser.email}`);
    
    const allHubs = await prisma.hub.findMany({
      where: { clusterId: cluster.id },
    });

    for (const hub of allHubs) {
      await prisma.userHub.upsert({
        where: {
          userId_hubId: { userId: spvUser.id, hubId: hub.id },
        },
        create: { userId: spvUser.id, hubId: hub.id },
        update: {},
      });
    }
    console.log(`✅ Linked SPV to ${allHubs.length} hubs`);
  } else {
    console.log(`\n⚠️ SPV user not found: ${spvEmail}`);
    console.log("   Create user SPV first or update email.");
  }

  console.log("\n🎉 Seed done!\n");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });