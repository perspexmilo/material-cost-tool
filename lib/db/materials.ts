import { prisma } from './prisma'
import type { Material, MaterialFilters, UpdateChange } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveCostPerM2(costPerSheet: number, widthMm: number, heightMm: number): number {
  return (costPerSheet / (widthMm * heightMm)) * 1_000_000
}

function serializeMaterial(m: {
  id: string
  description: string
  category: string
  typeFinish: string
  thicknessMm: { toNumber(): number }
  widthMm: { toNumber(): number }
  heightMm: { toNumber(): number }
  supplierId: string
  costPerSheet: { toNumber(): number }
  updateSource: string
  lastUpdatedAt: Date
  createdAt: Date
  updatedAt: Date
  markupMultiplier: { toNumber(): number } | null
  magentoSku: string | null
  magentoName: string | null
  magentoEntityId: number | null
  variantType: string | null
  supplier?: { id: string; name: string; createdAt: Date; updatedAt: Date }
  costHistory?: { changedAt: Date }[]
  _count?: { stagedChanges: number }
}): Material {
  const costPerSheet = m.costPerSheet.toNumber()
  const widthMm = m.widthMm.toNumber()
  const heightMm = m.heightMm.toNumber()

  return {
    id: m.id,
    description: m.description,
    category: m.category,
    typeFinish: m.typeFinish,
    thicknessMm: m.thicknessMm.toNumber(),
    widthMm,
    heightMm,
    supplierId: m.supplierId,
    costPerSheet,
    updateSource: m.updateSource as Material['updateSource'],
    lastUpdatedAt: m.lastUpdatedAt.toISOString(),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    markupMultiplier: m.markupMultiplier?.toNumber() ?? null,
    magentoSku: m.magentoSku,
    magentoName: m.magentoName,
    magentoEntityId: m.magentoEntityId,
    variantType: m.variantType,
    costPerM2: deriveCostPerM2(costPerSheet, widthMm, heightMm),
    lastCostUpdatedAt: m.costHistory?.[0]?.changedAt.toISOString() ?? null,
    hasPendingChange: (m._count?.stagedChanges ?? 0) > 0,
    supplier: m.supplier
      ? {
          id: m.supplier.id,
          name: m.supplier.name,
          createdAt: m.supplier.createdAt.toISOString(),
          updatedAt: m.supplier.updatedAt.toISOString(),
        }
      : undefined,
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getMaterials(
  filters?: MaterialFilters,
  pagination?: { limit?: number; offset?: number },
): Promise<{ materials: Material[]; total: number }> {
  const where: {
    category?: string
    typeFinish?: string
    variantType?: string
    supplierId?: string
    OR?: Array<{ description?: { contains: string; mode: 'insensitive' } | { contains: string } }>
  } = {}

  if (filters?.category) where.category = filters.category
  if (filters?.typeFinish) where.typeFinish = filters.typeFinish
  if (filters?.variantType) where.variantType = filters.variantType
  if (filters?.supplierId) where.supplierId = filters.supplierId
  if (filters?.search) {
    where.OR = [
      { description: { contains: filters.search, mode: 'insensitive' } },
    ]
  }

  const [total, rows] = await Promise.all([
    prisma.material.count({ where }),
    prisma.material.findMany({
      where,
      include: {
        supplier: true,
        costHistory: { orderBy: { changedAt: 'desc' }, take: 1, select: { changedAt: true } },
        _count: { select: { stagedChanges: true } },
      },
      orderBy: [{ category: 'asc' }, { typeFinish: 'asc' }, { thicknessMm: 'asc' }],
      ...(pagination?.limit !== undefined ? { take: pagination.limit } : {}),
      ...(pagination?.offset !== undefined ? { skip: pagination.offset } : {}),
    }),
  ])

  return { materials: rows.map(serializeMaterial), total }
}

export async function getMaterialFilterOptions() {
  const [categories, suppliers, categoryTypePairs, typeVariantPairs] = await Promise.all([
    prisma.material.findMany({ select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } }),
    prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    // All unique category + typeFinish combinations for cascading
    prisma.material.findMany({
      select: { category: true, typeFinish: true },
      distinct: ['category', 'typeFinish'],
      orderBy: [{ category: 'asc' }, { typeFinish: 'asc' }],
    }),
    // All unique typeFinish + variantType combinations for cascading
    prisma.material.findMany({
      select: { typeFinish: true, variantType: true },
      distinct: ['typeFinish', 'variantType'],
      where: { variantType: { not: null } },
      orderBy: [{ typeFinish: 'asc' }, { variantType: 'asc' }],
    }),
  ])

  // Build cascading maps
  const typeFinishByCategory: Record<string, string[]> = {}
  for (const r of categoryTypePairs) {
    if (!typeFinishByCategory[r.category]) typeFinishByCategory[r.category] = []
    typeFinishByCategory[r.category].push(r.typeFinish)
  }

  const variantTypeByTypeFinish: Record<string, string[]> = {}
  for (const r of typeVariantPairs) {
    if (!variantTypeByTypeFinish[r.typeFinish]) variantTypeByTypeFinish[r.typeFinish] = []
    variantTypeByTypeFinish[r.typeFinish].push(r.variantType as string)
  }

  return {
    categories: categories.map((c) => c.category),
    typeFinishes: categoryTypePairs.map((r) => r.typeFinish).filter((v, i, a) => a.indexOf(v) === i).sort(),
    variantTypes: typeVariantPairs.map((r) => r.variantType as string).filter((v, i, a) => a.indexOf(v) === i).sort(),
    suppliers,
    typeFinishByCategory,
    variantTypeByTypeFinish,
  }
}

export async function getMaterialById(id: string): Promise<Material | null> {
  const material = await prisma.material.findUnique({
    where: { id },
    include: { supplier: true },
  })

  if (!material) return null
  return serializeMaterial(material)
}

export async function getCostHistory(materialId: string) {
  const history = await prisma.costHistory.findMany({
    where: { materialId },
    orderBy: { changedAt: 'desc' },
  })

  return history.map((h) => ({
    id: h.id,
    materialId: h.materialId,
    previousCost: h.previousCost.toNumber(),
    newCost: h.newCost.toNumber(),
    changedAt: h.changedAt.toISOString(),
    effectiveDate: h.effectiveDate?.toISOString() ?? null,
    updateSource: h.updateSource as Material['updateSource'],
    notes: h.notes,
  }))
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function bulkUpdateMaterials(changes: UpdateChange[]): Promise<{
  updated: number
  staged: number
  errors: Array<{ materialId: string; error: string }>
}> {
  let updated = 0
  let staged = 0
  const errors: Array<{ materialId: string; error: string }> = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const change of changes) {
    try {
      const material = await prisma.material.findUnique({
        where: { id: change.materialId },
      })

      if (!material) {
        errors.push({ materialId: change.materialId, error: 'Material not found' })
        continue
      }

      const effectiveDate = change.effectiveDate ? new Date(change.effectiveDate) : null
      const isFutureDated = effectiveDate && effectiveDate > today

      console.log('[bulkUpdate]', {
        materialId: change.materialId,
        rawEffectiveDate: change.effectiveDate,
        parsedEffectiveDate: effectiveDate?.toISOString(),
        today: today.toISOString(),
        isFutureDated: !!isFutureDated,
      })

      if (isFutureDated) {
        // Write to staged_changes
        await prisma.stagedChange.create({
          data: {
            materialId: change.materialId,
            proposedCost: change.proposedCost,
            currentCost: material.costPerSheet,
            effectiveDate: effectiveDate,
            updateSource: change.updateSource ?? 'email-parse',
            notes: change.notes,
          },
        })
        staged++
      } else {
        // Immediate update — use a transaction
        await prisma.$transaction([
          prisma.material.update({
            where: { id: change.materialId },
            data: {
              costPerSheet: change.proposedCost,
              updateSource: change.updateSource ?? 'email-parse',
              lastUpdatedAt: new Date(),
            },
          }),
          prisma.costHistory.create({
            data: {
              materialId: change.materialId,
              previousCost: material.costPerSheet,
              newCost: change.proposedCost,
              effectiveDate: effectiveDate ?? new Date(),
              updateSource: change.updateSource ?? 'email-parse',
              notes: change.notes,
            },
          }),
        ])
        updated++
      }

      // Save alias if provided
      if (change.aliasRawText) {
        await prisma.supplierAlias.upsert({
          where: { rawText: change.aliasRawText },
          update: { materialId: change.materialId },
          create: {
            rawText: change.aliasRawText,
            materialId: change.materialId,
            supplierId: material.supplierId,
          },
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      errors.push({ materialId: change.materialId, error: message })
    }
  }

  return { updated, staged, errors }
}

export async function deleteMaterials(ids: string[]): Promise<{ deleted: number }> {
  const result = await prisma.material.deleteMany({ where: { id: { in: ids } } })
  return { deleted: result.count }
}

export async function createMaterial(data: {
  description: string
  category: string
  typeFinish: string
  thicknessMm: number
  widthMm: number
  heightMm: number
  supplierName: string
  costPerSheet: number
  markupMultiplier?: number | null
  variantType?: string | null
  magentoSku?: string | null
  magentoEntityId?: number | null
}): Promise<Material> {
  const supplier = await prisma.supplier.upsert({
    where: { name: data.supplierName },
    update: {},
    create: { name: data.supplierName },
  })

  const material = await prisma.material.create({
    data: {
      description:  data.description,
      category:     data.category,
      typeFinish:   data.typeFinish,
      thicknessMm:  data.thicknessMm,
      widthMm:      data.widthMm,
      heightMm:     data.heightMm,
      supplierId:   supplier.id,
      costPerSheet: data.costPerSheet,
      markupMultiplier: data.markupMultiplier ?? null,
      variantType:  data.variantType || null,
      magentoSku:   data.magentoSku || null,
      magentoEntityId: data.magentoEntityId ?? null,
      updateSource: 'manual',
    },
    include: { supplier: true },
  })

  return serializeMaterial(material)
}

export async function updateMaterial(id: string, data: {
  description?: string
  magentoName?: string | null
  markupMultiplier?: number | null
  variantType?: string | null
  magentoSku?: string | null
  magentoEntityId?: number | null
  thicknessMm?: number
  widthMm?: number
  heightMm?: number
  supplierName?: string
  costPerSheet?: number
}): Promise<Material> {
  const existing = await prisma.material.findUnique({ where: { id } })
  if (!existing) throw new Error('Material not found')

  let supplierId: string | undefined
  if (data.supplierName !== undefined) {
    const supplier = await prisma.supplier.upsert({
      where: { name: data.supplierName },
      update: {},
      create: { name: data.supplierName },
    })
    supplierId = supplier.id
  }

  const updateData = {
    ...(data.description !== undefined && { description: data.description }),
    ...(data.magentoName !== undefined && { magentoName: data.magentoName }),
    ...(data.markupMultiplier !== undefined && { markupMultiplier: data.markupMultiplier }),
    ...(data.variantType !== undefined && { variantType: data.variantType }),
    ...(data.magentoSku !== undefined && { magentoSku: data.magentoSku }),
    ...(data.magentoEntityId !== undefined && { magentoEntityId: data.magentoEntityId }),
    ...(data.thicknessMm !== undefined && { thicknessMm: data.thicknessMm }),
    ...(data.widthMm !== undefined && { widthMm: data.widthMm }),
    ...(data.heightMm !== undefined && { heightMm: data.heightMm }),
    ...(supplierId !== undefined && { supplierId }),
    ...(data.costPerSheet !== undefined && { costPerSheet: data.costPerSheet }),
    updateSource: 'manual' as const,
    lastUpdatedAt: new Date(),
  }

  const costChanged = data.costPerSheet !== undefined && data.costPerSheet !== existing.costPerSheet.toNumber()

  if (costChanged) {
    const [updated] = await prisma.$transaction([
      prisma.material.update({ where: { id }, data: updateData, include: { supplier: true } }),
      prisma.costHistory.create({
        data: {
          materialId: id,
          previousCost: existing.costPerSheet,
          newCost: data.costPerSheet!,
          effectiveDate: new Date(),
          updateSource: 'manual',
        },
      }),
    ])
    return serializeMaterial(updated)
  }

  const updated = await prisma.material.update({
    where: { id },
    data: updateData,
    include: { supplier: true },
  })
  return serializeMaterial(updated)
}
