import { prisma } from './prisma'
import type { StagedChange } from '@/types'

function serializeStagedChange(sc: {
  id: string
  materialId: string
  proposedCost: { toNumber(): number }
  currentCost: { toNumber(): number }
  effectiveDate: Date
  updateSource: string
  notes: string | null
  createdAt: Date
  material?: {
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
    supplier?: { id: string; name: string; createdAt: Date; updatedAt: Date } | null
  } | null
}): StagedChange {
  const result: StagedChange = {
    id: sc.id,
    materialId: sc.materialId,
    proposedCost: sc.proposedCost.toNumber(),
    currentCost: sc.currentCost.toNumber(),
    effectiveDate: sc.effectiveDate.toISOString(),
    updateSource: sc.updateSource as StagedChange['updateSource'],
    notes: sc.notes,
    createdAt: sc.createdAt.toISOString(),
  }

  if (sc.material) {
    const mat = sc.material
    const costPerSheet = mat.costPerSheet.toNumber()
    const widthMm = mat.widthMm.toNumber()
    const heightMm = mat.heightMm.toNumber()
    result.material = {
      id: mat.id,
      description: mat.description,
      category: mat.category,
      typeFinish: mat.typeFinish,
      thicknessMm: mat.thicknessMm.toNumber(),
      widthMm,
      heightMm,
      supplierId: mat.supplierId,
      costPerSheet,
      updateSource: mat.updateSource as StagedChange['updateSource'],
      lastUpdatedAt: mat.lastUpdatedAt.toISOString(),
      createdAt: mat.createdAt.toISOString(),
      updatedAt: mat.updatedAt.toISOString(),
      costPerM2: (costPerSheet / (widthMm * heightMm)) * 1_000_000,
      supplier: mat.supplier
        ? {
            id: mat.supplier.id,
            name: mat.supplier.name,
            createdAt: mat.supplier.createdAt.toISOString(),
            updatedAt: mat.supplier.updatedAt.toISOString(),
          }
        : undefined,
    }
  }

  return result
}

export async function getStagedChanges(): Promise<StagedChange[]> {
  const rows = await prisma.stagedChange.findMany({
    include: {
      material: {
        include: { supplier: true },
      },
    },
    orderBy: { effectiveDate: 'asc' },
  })

  return rows.map(serializeStagedChange)
}

export async function applyStagedChanges(): Promise<{ applied: number; errors: string[] }> {
  const today = new Date()
  today.setHours(23, 59, 59, 999)

  const due = await prisma.stagedChange.findMany({
    where: {
      effectiveDate: { lte: today },
    },
    include: { material: true },
  })

  let applied = 0
  const errors: string[] = []

  for (const sc of due) {
    try {
      await prisma.$transaction([
        prisma.material.update({
          where: { id: sc.materialId },
          data: {
            costPerSheet: sc.proposedCost,
            updateSource: 'staged',
            lastUpdatedAt: new Date(),
          },
        }),
        prisma.costHistory.create({
          data: {
            materialId: sc.materialId,
            previousCost: sc.material.costPerSheet,
            newCost: sc.proposedCost,
            effectiveDate: sc.effectiveDate,
            updateSource: 'staged',
            notes: sc.notes,
          },
        }),
        prisma.stagedChange.delete({
          where: { id: sc.id },
        }),
      ])
      applied++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`Failed to apply staged change ${sc.id}: ${message}`)
    }
  }

  return { applied, errors }
}

export async function cancelStagedChange(id: string): Promise<void> {
  await prisma.stagedChange.delete({
    where: { id },
  })
}
