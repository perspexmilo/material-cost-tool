import { NextRequest, NextResponse } from 'next/server'
import { bulkUpdateMaterials } from '@/lib/db/materials'
import type { BulkUpdateRequest } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const body: BulkUpdateRequest = await request.json()

    if (!body.changes || !Array.isArray(body.changes) || body.changes.length === 0) {
      return NextResponse.json(
        { error: 'changes array is required and must not be empty', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    // Validate each change
    for (const change of body.changes) {
      if (!change.materialId || typeof change.materialId !== 'string') {
        return NextResponse.json(
          { error: 'Each change must have a valid materialId', code: 'VALIDATION_ERROR' },
          { status: 400 }
        )
      }
      if (typeof change.proposedCost !== 'number' || change.proposedCost < 0) {
        return NextResponse.json(
          { error: 'Each change must have a non-negative proposedCost', code: 'VALIDATION_ERROR' },
          { status: 400 }
        )
      }
    }

    const result = await bulkUpdateMaterials(body.changes)

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error('[POST /api/materials/bulk-update]', error)
    return NextResponse.json(
      { error: 'Bulk update failed', code: 'UPDATE_ERROR' },
      { status: 500 }
    )
  }
}
