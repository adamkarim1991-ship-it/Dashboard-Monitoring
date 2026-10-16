import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = 'afifeffendi@goto.com'
  const newPassword = 'afifeffendi07'

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) { console.log('❌ User tidak ada'); return }

  console.log('User:', user.email, '| name:', user.name)

  const hash = await bcrypt.hash(newPassword, 10)

  // Update pakai field "password" (bukan passwordHash)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: 'Afif Effendi',
      password: hash,
    },
  })

  console.log('✅ Password updated')
  console.log('   Email   :', email)
  console.log('   Password:', newPassword)
}
main().finally(() => prisma.$disconnect())
