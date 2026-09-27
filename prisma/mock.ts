import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🧹 Menghapus data lama...");
  await prisma.hourlyMetric.deleteMany();

  console.log("📊 Mengambil daftar hub...");
  const hubs = await prisma.hub.findMany();

  if (hubs.length === 0) {
    console.log("❌ Tidak ada hub di database!");
    console.log("   Jalankan dulu: npx prisma db seed");
    return;
  }

  console.log(`✅ Ditemukan ${hubs.length} hub\n`);

  const now = new Date();
  let totalCreated = 0;

  for (const hub of hubs) {
    for (let i = 23; i >= 0; i--) {
      const ts = new Date(now);
      ts.setHours(now.getHours() - i, 0, 0, 0);

      const hour = ts.getHours();
      const peakFactor =
        hour >= 8 && hour <= 11
          ? 1.5
          : hour >= 14 && hour <= 18
            ? 1.8
            : hour >= 0 && hour <= 5
              ? 0.2
              : 1.0;

      const inbound = Math.floor((Math.random() * 100 + 60) * peakFactor);
      const outbound = Math.floor((Math.random() * 90 + 50) * peakFactor);
      const delivered = Math.floor((Math.random() * 80 + 40) * peakFactor);
      const pending = Math.floor(Math.random() * 25 + 5);
      const slaBreach = Math.floor(Math.random() * 8);
      const activeCouriers = Math.floor(Math.random() * 15 + 8);

      await prisma.hourlyMetric.create({
        data: {
          hubId: hub.id,
          hourTimestamp: ts,
          inbound,
          outbound,
          delivered,
          pending,
          slaBreach,
          activeCouriers,
        },
      });
      totalCreated++;
    }
    console.log(`  ✓ ${hub.name} — 24 jam data dibuat`);
  }

  console.log(`\n🎉 Selesai! Total ${totalCreated} baris data dibuat.`);
  console.log("   Refresh browser untuk lihat hasilnya.\n");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });