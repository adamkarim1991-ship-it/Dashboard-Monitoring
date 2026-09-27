import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const regionMap: Record<string, string> = {
  "Hub Cakung": "Jakarta Timur",
  "Hub Pulogadung": "Jakarta Timur",
  "Hub Duren Sawit": "Jakarta Timur",
  "Hub Cengkareng": "Jakarta Barat",
  "Hub Kalideres": "Jakarta Barat",
  "Hub Tebet": "Jakarta Selatan",
  "Hub Kebayoran": "Jakarta Selatan",
};

async function main() {
  for (const [name, region] of Object.entries(regionMap)) {
    const result = await prisma.hub.updateMany({
      where: { name },
      data: { region },
    });
    console.log(`✓ ${name} → ${region} (${result.count} updated)`);
  }
  console.log("\n🎉 Selesai!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());