import { NextRequest, NextResponse } from 'next/server'
import { deleteParserContextHint } from '@/lib/db/parser-context'

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  await deleteParserContextHint(id)
  return NextResponse.json({ ok: true })
}
