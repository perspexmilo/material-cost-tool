import { NextRequest, NextResponse } from 'next/server'
import { parsePerspexPriceList } from '@/lib/ai/perspex-parser'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No PDF file provided', code: 'MISSING_FILE' }, { status: 400 })
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)', code: 'FILE_TOO_LARGE' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const result = await parsePerspexPriceList(base64)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[parse-pdf-perspex] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error', code: 'PARSE_ERROR' },
      { status: 500 }
    )
  }
}
