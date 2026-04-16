import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const PERMISSION_CATALOG = [
  { key: 'users:read', description: 'Benutzer anzeigen' },
  { key: 'users:create', description: 'Benutzer erstellen' },
  { key: 'users:update', description: 'Benutzer bearbeiten' },
  { key: 'users:delete', description: 'Benutzer löschen' },
  { key: 'devices:read', description: 'Geräte anzeigen' },
  { key: 'devices:create', description: 'Geräte erstellen' },
  { key: 'devices:update', description: 'Geräte bearbeiten' },
  { key: 'devices:delete', description: 'Geräte löschen' },
  { key: 'devices:view_all', description: 'Alle Geräte anzeigen (Filter umgehen)' },
  { key: 'anlagen:read', description: 'Anlagen anzeigen' },
  { key: 'anlagen:create', description: 'Anlagen erstellen' },
  { key: 'anlagen:update', description: 'Anlagen bearbeiten' },
  { key: 'anlagen:delete', description: 'Anlagen löschen' },
  { key: 'groups:read', description: 'Gruppen anzeigen' },
  { key: 'groups:create', description: 'Gruppen erstellen' },
  { key: 'groups:update', description: 'Gruppen bearbeiten' },
  { key: 'groups:delete', description: 'Gruppen löschen' },
  { key: 'roles:read', description: 'Rollen anzeigen' },
  { key: 'roles:create', description: 'Rollen erstellen' },
  { key: 'roles:update', description: 'Rollen bearbeiten' },
  { key: 'roles:delete', description: 'Rollen löschen' },
  { key: 'todos:read', description: 'Todos anzeigen' },
  { key: 'todos:create', description: 'Todos erstellen' },
  { key: 'todos:update', description: 'Todos abhaken / Status ändern' },
  { key: 'logbook:read', description: 'Logbuch anzeigen' },
  { key: 'logbook:create', description: 'Logbuch-Einträge erstellen' },
]

async function main() {
  console.log('Seeding database...')

  // Permissions
  for (const perm of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { description: perm.description },
      create: perm,
    })
  }
  console.log(`✓ ${PERMISSION_CATALOG.length} permissions seeded`)

  // Roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', description: 'Vollzugriff auf alle Funktionen' },
  })

  const verwalterRole = await prisma.role.upsert({
    where: { name: 'verwalter' },
    update: {},
    create: { name: 'verwalter', description: 'Geräte und Anlagen verwalten' },
  })

  const benutzerRole = await prisma.role.upsert({
    where: { name: 'benutzer' },
    update: {},
    create: { name: 'benutzer', description: 'Nur eigene zugewiesene Geräte sehen' },
  })
  console.log('✓ 3 roles seeded (admin, verwalter, benutzer)')

  // Benutzer-Rolle: minimale Permissions – sieht nur User-Dashboard mit seinen Visus
  const benutzerPerms = ['devices:read', 'anlagen:read', 'todos:read', 'logbook:read']
  const benutzerPermIds = await prisma.permission.findMany({
    where: { key: { in: benutzerPerms } },
    select: { id: true },
  })
  // Erst alte Zuweisungen löschen, dann neu setzen (damit Änderungen wirken)
  await prisma.rolePermission.deleteMany({ where: { roleId: benutzerRole.id } })
  for (const perm of benutzerPermIds) {
    await prisma.rolePermission.create({
      data: { roleId: benutzerRole.id, permissionId: perm.id },
    })
  }
  console.log('✓ benutzer permissions assigned')

  // Verwalter-Rolle: alles außer Rollen- und VPN-Verwaltung
  const verwalterExcluded = ['roles:read', 'roles:create', 'roles:update', 'roles:delete']
  const verwalterPermRecords = await prisma.permission.findMany({
    where: { key: { notIn: verwalterExcluded } },
    select: { id: true },
  })
  await prisma.rolePermission.deleteMany({ where: { roleId: verwalterRole.id } })
  for (const perm of verwalterPermRecords) {
    await prisma.rolePermission.create({
      data: { roleId: verwalterRole.id, permissionId: perm.id },
    })
  }
  console.log('✓ verwalter permissions assigned')

  // Admin user
  const adminPassword = await bcrypt.hash('Admin1234!', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ycontrol.local' },
    update: {},
    create: {
      email: 'admin@ycontrol.local',
      passwordHash: adminPassword,
      firstName: 'System',
      lastName: 'Admin',
      roleId: adminRole.id,
      isActive: true,
    },
  })
  console.log(`✓ Admin user created: ${admin.email} / Admin1234!`)

  // Demo: Verwalter user
  const verwalterPassword = await bcrypt.hash('Verwalter1234!', 12)
  await prisma.user.upsert({
    where: { email: 'verwalter@ycontrol.local' },
    update: {},
    create: {
      email: 'verwalter@ycontrol.local',
      passwordHash: verwalterPassword,
      firstName: 'Max',
      lastName: 'Muster',
      roleId: verwalterRole.id,
      isActive: true,
    },
  })

  // Demo: Benutzer
  const benutzerPassword = await bcrypt.hash('Benutzer1234!', 12)
  await prisma.user.upsert({
    where: { email: 'benutzer@ycontrol.local' },
    update: {},
    create: {
      email: 'benutzer@ycontrol.local',
      passwordHash: benutzerPassword,
      firstName: 'Hans',
      lastName: 'Müller',
      roleId: benutzerRole.id,
      isActive: true,
    },
  })
  console.log('✓ Demo users created')

  // Demo-Daten nur anlegen wenn noch keine Geräte existieren (frische Installation)
  const existingDeviceCount = await prisma.device.count()
  if (existingDeviceCount === 0) {
    const anlage1 = await prisma.anlage.upsert({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Produktionshalle A',
        description: 'Hauptanlage im Erdgeschoss',
        street: 'Industriestrasse 10',
        zip: '8000',
        city: 'Zürich',
        country: 'Schweiz',
        contactName: 'Max Muster',
        contactPhone: '+41 44 123 45 67',
        latitude: 47.3769,
        longitude: 8.5417,
      },
    })

    const device1 = await prisma.device.upsert({
      where: { serialNumber: 'RPI-001' },
      update: {},
      create: {
        name: 'Raspberry Pi #1',
        serialNumber: 'RPI-001',
        status: 'ONLINE',
        ipAddress: '192.168.1.101',
        firmwareVersion: '1.0.0',
        lastSeen: new Date(),
      },
    })

    await prisma.device.upsert({
      where: { serialNumber: 'RPI-002' },
      update: {},
      create: {
        name: 'Raspberry Pi #2',
        serialNumber: 'RPI-002',
        status: 'OFFLINE',
        ipAddress: '192.168.1.102',
        firmwareVersion: '1.0.0',
        lastSeen: new Date(Date.now() - 3600000),
      },
    })

    await prisma.device.upsert({
      where: { serialNumber: 'RPI-003' },
      update: {},
      create: {
        name: 'Raspberry Pi #3',
        serialNumber: 'RPI-003',
        status: 'UNKNOWN',
      },
    })

    await prisma.anlageDevice.upsert({
      where: { anlageId_deviceId: { anlageId: anlage1.id, deviceId: device1.id } },
      update: {},
      create: { anlageId: anlage1.id, deviceId: device1.id },
    })

    console.log('✓ Demo Anlage and Devices created')
  } else {
    console.log(`✓ ${existingDeviceCount} Geräte vorhanden – Demo-Daten übersprungen`)
  }
  console.log('\nSeeding complete!')
  console.log('Login credentials:')
  console.log('  admin@ycontrol.local     / Admin1234!')
  console.log('  verwalter@ycontrol.local / Verwalter1234!')
  console.log('  benutzer@ycontrol.local  / Benutzer1234!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
