import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const oldEmail = 'spv.timur@goto.com'
  const newEmail = 'afifeffendi@goto.com'
  const newName = 'Afif Effendi'
  const newPassword = 'afifeffendi07'

  // Cari user lama
  const user = await prisma.user.findUnique({ where: { email: oldEmail } })
  if (!user) {
    console.log('❌ User', oldEmail, 'tidak ditemukan')
    
    // Cek email baru mungkin sudah ada
    const alt = await prisma.user.findUnique({ where: { email: newEmail } })
    if (alt) console.log('   Tapi email', newEmail, 'sudah ada:', alt.name)
    return
  }

  console.log('Ditemukan:', user.email, '|', user.name)

  const hash = await bcrypt.hash(newPassword, 10)

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      email: newEmail,
      name: newName,
      password: hash,
    },
  })

  console.log('\n✅ User updated:')
  console.log('   Name    :', updated.name)
  console.log('   Email   :', updated.email)
  console.log('   Password:', newPassword)
}
main().finally(() => prisma.$disconnect())
