import { NextRequest, NextResponse } from 'next/server'
import { updateMaterial } from '@/lib/db/materials'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const material = await updateMaterial(id, body)
    return NextResponse.json({ material })
  } catch (error) {
    console.error('[PATCH /api/materials/[id]]', error)
    const message = error instanceof Error ? error.message : 'Failed to update material'
    return NextResponse.json(
      { error: message, code: 'UPDATE_ERROR' },
      { status: 500 }
    )
  }
}
