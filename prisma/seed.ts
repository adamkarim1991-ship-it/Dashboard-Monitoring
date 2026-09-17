import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("password123", 10);

  // Bersihkan data lama biar aman kalau seed dijalankan ulang
  await prisma.hourlyMetric.deleteMany();
  await prisma.userHub.deleteMany();
  await prisma.hub.deleteMany();
  await prisma.cluster.deleteMany();
  await prisma.user.deleteMany();

  // === CLUSTER ===
  const jabodetabek = await prisma.cluster.create({
    data: { name: "Jabodetabek" },
  });

  // === HUB ===
  const hubsData = [
    "Hub Cakung",
    "Hub Pulogadung",
    "Hub Duren Sawit",
    "Hub Cengkareng",
    "Hub Kalideres",
    "Hub Tebet",
    "Hub Kebayoran",
  ];

  const hubs = await Promise.all(
    hubsData.map((name) =>
      prisma.hub.create({ data: { name, clusterId: jabodetabek.id } })
    )
  );
  const hubByName: Record<string, string> = Object.fromEntries(
    hubs.map((h) => [h.name, h.id])
  );

  // === MANAGER (akses semua hub di Jabodetabek) ===
  await prisma.user.create({
    data: {
      email: "manager@goto.com",
      name: "Budi Manager",
      password,
      role: "MANAGER",
      hubs: { create: hubs.map((h) => ({ hubId: h.id })) },
    },
  });

  // === SPV Jakarta Timur ===
  await prisma.user.create({
    data: {
      email: "spv.timur@goto.com",
      name: "Sari SPV Jaktim",
      password,
      role: "SPV",
      hubs: {
        create: [
          { hubId: hubByName["Hub Cakung"] },
          { hubId: hubByName["Hub Pulogadung"] },
          { hubId: hubByName["Hub Duren Sawit"] },
        ],
      },
    },
  });

  // === SPV Jakarta Barat ===
  await prisma.user.create({
    data: {
      email: "spv.barat@goto.com",
      name: "Andi SPV Jakbar",
      password,
      role: "SPV",
      hubs: {
        create: [
          { hubId: hubByName["Hub Cengkareng"] },
          { hubId: hubByName["Hub Kalideres"] },
        ],
      },
    },
  });

  // === HUB LEAD (hanya 1 hub) ===
  await prisma.user.create({
    data: {
      email: "lead.cakung@goto.com",
      name: "Rina Hub Lead Cakung",
      password,
      role: "HUB_LEAD",
      hubs: { create: [{ hubId: hubByName["Hub Cakung"] }] },
    },
  });

  // === HOURLY METRIC — 24 jam terakhir per hub ===
  const now = new Date();
  for (const hub of hubs) {
    for (let i = 23; i >= 0; i--) {
      const ts = new Date(now);
      ts.setHours(now.getHours() - i, 0, 0, 0);
      await prisma.hourlyMetric.create({
        data: {
          hubId: hub.id,
          hourTimestamp: ts,
          inbound: Math.floor(Math.random() * 200) + 50,
          outbound: Math.floor(Math.random() * 180) + 40,
          delivered: Math.floor(Math.random() * 150) + 30,
          pending: Math.floor(Math.random() * 30),
          slaBreach: Math.floor(Math.random() * 10),
          activeCouriers: Math.floor(Math.random() * 20) + 5,
        },
      });
    }
  }

  console.log("✅ Seed selesai!");
  console.log("Akun test (password: password123):");
  console.log("  manager@goto.com     → MANAGER");
  console.log("  spv.timur@goto.com   → SPV Jaktim");
  console.log("  spv.barat@goto.com   → SPV Jakbar");
  console.log("  lead.cakung@goto.com → HUB LEAD");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });