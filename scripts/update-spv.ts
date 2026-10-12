import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ============================================================
// GANTI EMAIL & PASSWORD DI SINI
// ============================================================
const TARGET_EMAIL = "Afifeffendi@goto.com";   // ← email yang mau diupdate
const NEW_EMAIL = "afifeffendi@goto.com";       // ← email baru (opsional, kalau mau ganti)
const NEW_PASSWORD = "afifeffendi07";           // ← password baru
// ============================================================

async function main() {
  console.log("🔄 Update SPV user...\n");

  // 1. Cari user
  const existing = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
  });

  if (!existing) {
    console.error(`❌ User dengan email ${TARGET_EMAIL} tidak ditemukan!`);
    const allUsers = await prisma.user.findMany({
      select: { email: true, name: true, role: true },
    });
    console.table(allUsers);
    return;
  }

  console.log(`Found: ${existing.email} (${existing.role})\n`);

  // 2. Cek konflik email baru
  if (NEW_EMAIL !== TARGET_EMAIL) {
    const conflict = await prisma.user.findUnique({
      where: { email: NEW_EMAIL },
    });
    if (conflict && conflict.id !== existing.id) {
      console.error(`❌ Email ${NEW_EMAIL} sudah dipakai user lain!`);
      return;
    }
  }

  // 3. Hash password baru
  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 10);

  // 4. Update
  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      email: NEW_EMAIL,
      password: passwordHash,
    },
  });

  console.log("✅ Update BERHASIL!\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📧 Email baru:", updated.email);
  console.log("🔑 Password baru:", NEW_PASSWORD);
  console.log("👤 Role:", updated.role);
  console.log("👤 Name:", updated.name);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });