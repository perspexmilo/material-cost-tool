import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

// Returns all materials that have a magentoEntityId, for use in the basket item picker.
export async function GET() {
  try {
    const materials = await prisma.material.findMany({
      where: { magentoEntityId: { not: null } },
      select: {
        magentoEntityId: true,
        magentoName: true,
        magentoSku: true,
        description: true,
      },
      orderBy: { magentoName: 'asc' },
    })
    return NextResponse.json(materials)
  } catch (err) {
    console.error('competitor-prices/materials error:', err)
    return NextResponse.json({ error: 'Failed to load materials' }, { status: 500 })
  }
}
