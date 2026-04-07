import { NextResponse } from 'next/server'
import { getMaterialFilterOptions } from '@/lib/db/materials'

export async function GET() {
  try {
    const options = await getMaterialFilterOptions()
    return NextResponse.json(options)
  } catch (error) {
    console.error('[GET /api/materials/filters]', error)
    return NextResponse.json(
      { error: 'Failed to fetch filter options', code: 'FETCH_ERROR' },
      { status: 500 }
    )
  }
}
