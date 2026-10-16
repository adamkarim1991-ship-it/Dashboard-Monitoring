import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const oldEmail = 'spv.timur@goto.com'
  const newEmail = 'afifeffendi@goto.com'
  const newName = 'Afif Effendi'
  const newPassword = 'afifeffendi07'

  // Cek user lama
  const oldUser = await prisma.user.findUnique({ where: { email: oldEmail } })
  if (!oldUser) {
    console.log('❌ User lama tidak ditemukan:', oldEmail)
    return
  }

  console.log('User lama:', oldUser.email, '|', oldUser.name)

  // Cek apakah email baru sudah dipakai
  const existing = await prisma.user.findUnique({ where: { email: newEmail } })
  if (existing && existing.id !== oldUser.id) {
    console.log('❌ Email', newEmail, 'sudah dipakai user lain')
    return
  }

  const hash = await bcrypt.hash(newPassword, 10)

  const updated = await prisma.user.update({
    where: { id: oldUser.id },
    data: {
      email: newEmail,
      name: newName,
      password: hash,
    },
  })

  console.log('✅ User diupdate:')
  console.log('   Name    :', updated.name)
  console.log('   Email   :', updated.email)
  console.log('   Password: (afifeffendi07)')

  // Cek apakah token HMS masih ada
  const tokenCheck = await prisma.user.findUnique({
    where: { id: oldUser.id },
    select: { hmsToken: true, hmsRefreshToken: true },
  })
  console.log('   HMS token:', tokenCheck?.hmsToken ? 'ADA ✅' : 'KOSONG ❌')
  console.log('   HMS refresh token:', tokenCheck?.hmsRefreshToken ? 'ADA ✅' : 'KOSONG ❌')
}
main().finally(() => prisma.$disconnect())
