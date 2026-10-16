import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Cari user dengan role HUB_LEAD
  const hubLead = await prisma.user.findFirst({
    where: { role: 'HUB_LEAD' },
  })

  if (!hubLead) {
    console.log('❌ User dengan role HUB_LEAD tidak ditemukan')
    // List semua user
    const all = await prisma.user.findMany({ select: { email: true, name: true, role: true } })
    console.log('\nUser yang tersedia:')
    all.forEach(u => console.log(`  ${u.email} | ${u.name} | ${u.role}`))
    return
  }

  console.log('Ditemukan:', hubLead.email, '|', hubLead.name, '|', hubLead.role)

  const newEmail = 'lm.jatinegara@goto.com'
  const newName = 'LM Jatinegara'
  const newPassword = 'gtljtn'

  // Cek apakah email baru sudah dipakai user lain
  const existing = await prisma.user.findUnique({ where: { email: newEmail } })
  if (existing && existing.id !== hubLead.id) {
    console.log('❌ Email', newEmail, 'sudah dipakai user lain:', existing.name)
    return
  }

  const hash = await bcrypt.hash(newPassword, 10)

  const updated = await prisma.user.update({
    where: { id: hubLead.id },
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
  console.log('   Role    :', updated.role)
}
main().finally(() => prisma.$disconnect())
