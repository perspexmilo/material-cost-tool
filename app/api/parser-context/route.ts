import { NextRequest, NextResponse } from 'next/server'
import { getParserContextRecords, addParserContextHint } from '@/lib/db/parser-context'

export async function GET() {
  const hints = await getParserContextRecords()
  return NextResponse.json(hints)
}

export async function POST(request: NextRequest) {
  const { hint } = await request.json()
  if (!hint || typeof hint !== 'string' || !hint.trim()) {
    return NextResponse.json({ error: 'hint is required' }, { status: 400 })
  }
  const created = await addParserContextHint(hint.trim())
  return NextResponse.json(created, { status: 201 })
}
