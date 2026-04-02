import { prisma } from '@/lib/db/prisma'

export async function getParserContextHints(): Promise<string[]> {
  const hints = await prisma.parserContext.findMany({ orderBy: { createdAt: 'asc' } })
  return hints.map((h) => h.hint)
}

export async function getParserContextRecords() {
  return prisma.parserContext.findMany({ orderBy: { createdAt: 'asc' } })
}

export async function addParserContextHint(hint: string) {
  return prisma.parserContext.create({ data: { hint } })
}

export async function deleteParserContextHint(id: string) {
  return prisma.parserContext.delete({ where: { id } })
}
