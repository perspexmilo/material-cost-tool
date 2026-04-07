import Anthropic from '@anthropic-ai/sdk'
import { getMaterials } from '@/lib/db/materials'
import { getParserContextHints } from '@/lib/db/parser-context'
import type { ParseResult, ResolvedChange, UnresolvedItem, ParsedRange, ConfidenceLevel } from '@/types'

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey })
}

const SYSTEM_PROMPT = `You are a data extraction assistant for CutMy, a sheet material cutting company.
Extract line items from a James Latham quotation PDF.

James Latham is a sheet material distributor. Their quotes list items in a table:
Item | Description | Qty | Weight | Price (£) | Per | Total (£)

For each line item, extract:
- thicknessMm: first number in mm (e.g. "18mm" → 18, "6mm" → 6)
- widthMm / heightMm: sheet dimensions (e.g. "2440x1220" → 2440, 1220)
- colourName: English colour/finish name ONLY — strip product codes (e.g. "020", "910", "49D", "14C"),
  strip brand/line names (FIBRAPAN, FIBRACOLOUR, FIBRAPLAST, EZ DECOR, FINSA, FSC, MF, MDF, HIDROFUGO),
  strip technical specs (NON STRUCTURAL, EN622-5, E1, CE4, EN13986, INT-COC-002322),
  strip side info ("2 Sides", "Sides"), strip stock notes ("IN STOCK", "STOCKED AT THURROCK").
  Translate Spanish: Gris=Grey, Negro=Black, Blanco=White, Roble=Oak, Nogal=Walnut, Natural=Natural.
  Examples: "020 White Matt 2 Sides" → "White Matt", "910 Roble Natural Mesura 2 Sides" → "Oak Natural",
  "U12 Natural Grey S.4 Soft IV 2 Sides" → "Natural Grey", "14C Toffee S.3 Soft III 2 sides" → "Toffee",
  "NEGRO NATUR" → "Black Oak", "71A GRIS GU 71A GRIS GU" → "Grey".
- materialSubstrate: "MDF" for standard MDF, "MDF.H" for HIDROFUGO/moisture-resistant MDF, "Other" otherwise
- productLine: the FINSA product line (FIBRAPAN EZ DECOR, FIBRACOLOUR, FIBRAPLAST HIDROFUGO etc.)
- pricePerBoard: the Price column value (number, in GBP)
- isPOA: true if price shows "POA", false otherwise

Also extract:
- quoteDate: date from header in YYYY-MM-DD
- quoteReference: quote number
- effectiveDate: new price effective date if mentioned (e.g. "NEW APRIL 2026 PRICE" → infer from quote date context), or null

Skip items where isPOA is true.`

interface ExtractedItem {
  itemNumber: number
  rawDescription?: string
  thicknessMm: number
  widthMm: number
  heightMm: number
  colourName: string
  productLine: string
  materialSubstrate: 'MDF' | 'MDF.H' | 'Other'
  pricePerBoard: number
  isPOA: boolean
}

interface ExtractionResult {
  quoteDate?: string
  quoteReference?: string
  effectiveDate?: string | null
  items: ExtractedItem[]
}

const extractionTool: Anthropic.Tool = {
  name: 'extract_lathams_line_items',
  description: 'Extract structured line items from a James Latham quotation PDF',
  input_schema: {
    type: 'object' as const,
    properties: {
      quoteDate: { type: 'string', description: 'Quote date YYYY-MM-DD' },
      quoteReference: { type: 'string', description: 'Quote number' },
      effectiveDate: {
        type: ['string', 'null'],
        description: 'Effective date for new prices YYYY-MM-DD, or null',
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            itemNumber: { type: 'number' },
            rawDescription: { type: 'string', description: 'First line of the full description' },
            thicknessMm: { type: 'number' },
            widthMm: { type: 'number' },
            heightMm: { type: 'number' },
            colourName: {
              type: 'string',
              description: 'Clean English colour/finish name only — see extraction rules above',
            },
            productLine: { type: 'string' },
            materialSubstrate: { type: 'string', enum: ['MDF', 'MDF.H', 'Other'] },
            pricePerBoard: { type: 'number' },
            isPOA: { type: 'boolean' },
          },
          required: [
            'itemNumber', 'thicknessMm', 'widthMm', 'heightMm',
            'colourName', 'materialSubstrate', 'pricePerBoard', 'isPOA',
          ],
        },
      },
    },
    required: ['items'],
  },
}

// Generic stop words for matching
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'mdf', 'acrylic', 'sheet', 'board',
  'standard', 'natural', 'finish', 'colour', 'color',
])

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
}

/**
 * Score how well a Lathams colour name matches a DB material description.
 * Returns 0–1.
 */
function colourMatchScore(colourName: string, materialDescription: string, variantType?: string | null): number {
  const colourTokens = tokenise(colourName)
  const descTokens = tokenise(materialDescription + ' ' + (variantType ?? ''))

  if (colourTokens.length === 0) return 0

  // Direct substring check
  const colourLower = colourName.toLowerCase()
  const descLower = (materialDescription + ' ' + (variantType ?? '')).toLowerCase()
  if (descLower.includes(colourLower)) return 0.95

  const matches = colourTokens.filter((ct) =>
    descTokens.some((dt) => dt.includes(ct) || ct.includes(dt))
  )
  return matches.length / colourTokens.length
}

export async function parseLathamsQuote(pdfBase64: string): Promise<ParseResult> {
  const client = getClient()

  // 1. Inject any user-defined context hints into the system prompt
  const contextHints = await getParserContextHints()
  const systemPrompt =
    SYSTEM_PROMPT +
    (contextHints.length > 0
      ? `\n\nADDITIONAL CONTEXT FROM CutMy TEAM:\n${contextHints.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
      : '')

  // 2. Extract line items from PDF via Claude
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    system: systemPrompt,
    tools: [extractionTool],
    tool_choice: { type: 'any' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          } as Anthropic.Messages.DocumentBlockParam,
          {
            type: 'text',
            text: 'Please extract all line items from this James Latham quotation PDF.',
          },
        ],
      },
    ],
  })

  console.log('[lathams-parser] response stop_reason:', response.stop_reason)
  console.log('[lathams-parser] response content blocks:', response.content.map(b => b.type))

  const toolBlock = response.content.find((b) => b.type === 'tool_use')
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    const textBlock = response.content.find((b) => b.type === 'text')
    if (textBlock && textBlock.type === 'text') {
      console.log('[lathams-parser] no tool call — text response:', textBlock.text.slice(0, 500))
    }
    return { resolved: [], unresolved: [], manufacturers: ['James Latham'], parseTimestamp: new Date().toISOString() }
  }

  const extracted = toolBlock.input as ExtractionResult
  console.log('[lathams-parser] extracted keys:', Object.keys(extracted ?? {}))
  console.log('[lathams-parser] items count:', extracted?.items?.length ?? 'undefined')
  console.log('[lathams-parser] first 2 items:', JSON.stringify(extracted?.items?.slice(0, 2), null, 2))
  const validItems = (extracted?.items ?? []).filter((i) => !i.isPOA && i.pricePerBoard > 0)

  if (validItems.length === 0) {
    return { resolved: [], unresolved: [], manufacturers: ['James Latham'], parseTimestamp: new Date().toISOString() }
  }

  // 2. Load all DB materials
  const { materials: allMaterials } = await getMaterials()

  // 3. Try to find Lathams materials (supplier name contains "latham")
  const lathamsMaterials = allMaterials.filter((m) =>
    m.supplier?.name?.toLowerCase().includes('latham')
  )
  // Fall back to all materials if supplier isn't mapped yet
  const candidatePool = lathamsMaterials.length > 0 ? lathamsMaterials : allMaterials

  const resolved: ResolvedChange[] = []
  const unresolved: UnresolvedItem[] = []

  // 4. Match each extracted item to a DB material
  for (const item of validItems) {
    const rawText = item.rawDescription ?? `${item.thicknessMm}mm ${item.colourName}`

    // Filter by exact thickness
    const byThickness = candidatePool.filter(
      (m) => Math.abs(m.thicknessMm - item.thicknessMm) < 0.01
    )

    // Score by colour name match
    const scored = byThickness
      .map((m) => ({
        material: m,
        score: colourMatchScore(item.colourName, m.description, m.variantType),
      }))
      .filter((s) => s.score > 0.35)
      .sort((a, b) => b.score - a.score)

    if (scored.length > 0 && scored[0].score >= 0.5) {
      const best = scored[0]
      const confidence: ConfidenceLevel = best.score >= 0.8 ? 'high' : 'medium'

      resolved.push({
        materialId: best.material.id,
        materialDescription: best.material.description,
        currentCost: best.material.costPerSheet,
        proposedCost: item.pricePerBoard,
        changePercent:
          best.material.costPerSheet > 0
            ? Math.round(((item.pricePerBoard - best.material.costPerSheet) / best.material.costPerSheet) * 10000) / 100
            : 0,
        effectiveDate: extracted.effectiveDate ?? null,
        confidence,
        rawText,
        aliasRawText: `${item.thicknessMm}mm ${item.colourName} ${item.materialSubstrate}`,
        supplier: best.material.supplier?.name,
      })
    } else {
      // Cannot resolve — put in unresolved with the absolute new price
      const parsedRange: ParsedRange = {
        name: `${item.thicknessMm}mm ${item.colourName} ${item.materialSubstrate}`,
        manufacturer: 'James Latham',
        changeType: 'absolute',
        changeValue: item.pricePerBoard,
        effectiveDate: extracted.effectiveDate ?? null,
        rawText,
        absoluteNewPrice: item.pricePerBoard,
      }

      unresolved.push({
        rawText,
        parsedRange,
        suggestedMaterials: scored.slice(0, 3).map((s) => ({
          id: s.material.id,
          description: s.material.description,
          score: s.score,
        })),
      })
    }
  }

  // Deduplicate: if same materialId resolved multiple times, keep highest confidence
  const confidenceRank: Record<ConfidenceLevel, number> = { high: 2, medium: 1, low: 0 }
  const dedupedResolved = Object.values(
    resolved.reduce<Record<string, ResolvedChange>>((acc, item) => {
      const existing = acc[item.materialId]
      if (!existing || confidenceRank[item.confidence] > confidenceRank[existing.confidence]) {
        acc[item.materialId] = item
      }
      return acc
    }, {})
  )

  return {
    resolved: dedupedResolved,
    unresolved,
    manufacturers: ['James Latham'],
    parseTimestamp: new Date().toISOString(),
  }
}
