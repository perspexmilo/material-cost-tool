import Anthropic from '@anthropic-ai/sdk'
import { getMaterials } from '@/lib/db/materials'
import { getParserContextHints } from '@/lib/db/parser-context'
import type { PerspexParseResult, PerspexProductGroup, PerspexEntry } from '@/types'

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey })
}

// ─── Hardcoded mapping: PDF groupName+subType → DB variantType search string ──
// Values are substrings to match against m.variantType (case-insensitive).
// "COLOUR" sub-types are flagged separately as isColourCategory = true.

interface GroupMapping {
  variantTypeContains: string
  isColourCategory?: boolean
}

const GROUP_MAP: Record<string, Record<string, GroupMapping>> = {
  'cast sheet standard gloss': {
    'clear':          { variantTypeContains: 'clear acrylic' },
    'opal':           { variantTypeContains: 'opal acrylic' },
    'colour':         { variantTypeContains: 'coloured acrylic', isColourCategory: true },
    'glass look':     { variantTypeContains: 'glass look' },
  },
  'cast block standard': {
    'clear':          { variantTypeContains: 'clear acrylic' },
  },
  'cast sheet silk': {
    'clear silk':     { variantTypeContains: 'clear acrylic' },
    'opal silk':      { variantTypeContains: 'opal acrylic' },
    'silk colour':    { variantTypeContains: 'coloured acrylic', isColourCategory: true },
  },
  'cast sheet frost': {
    'clear frost':    { variantTypeContains: 'frosted acrylic' },
    'opal frost':     { variantTypeContains: 'opal frost' },
    'colour frost':   { variantTypeContains: 'coloured frost', isColourCategory: true },
  },
  'fluorescent':      { 'fluorescent': { variantTypeContains: 'fluorescent' } },
  'pearlescent':      { 'pearlescent': { variantTypeContains: 'pearlescent' } },
  'vario':            { 'vario':       { variantTypeContains: 'vario' } },
  'spectrum':         { 'spectrum':    { variantTypeContains: 'spectrum' } },
  'impressions':      { 'impressions': { variantTypeContains: 'impressions' } },
  'duo':              { 'duo':         { variantTypeContains: 'duo' } },
  'extruded sheet': {
    'clear':          { variantTypeContains: 'clear acrylic' },
    'impact im50':    { variantTypeContains: 'impact' },
    'impact im30':    { variantTypeContains: 'impact' },
    'anti-glare':     { variantTypeContains: 'anti-glare' },
    'opal':           { variantTypeContains: 'opal acrylic' },
    'white':          { variantTypeContains: 'white acrylic' },
    'black':          { variantTypeContains: 'black acrylic' },
    'silver mirror':  { variantTypeContains: 'silver mirror' },
    'gold mirror':    { variantTypeContains: 'gold mirror' },
    'prismatic':      { variantTypeContains: 'prismatic' },
  },
  'polycarbonate': {
    'clear':          { variantTypeContains: 'clear polycarbonate' },
    'hard coat':      { variantTypeContains: 'hard coat polycarbonate' },
    'embossed':       { variantTypeContains: 'embossed polycarbonate' },
    'opal':           { variantTypeContains: 'opal polycarbonate' },
    'prismatic':      { variantTypeContains: 'prismatic polycarbonate' },
    'diffused':       { variantTypeContains: 'polycarbonate' },
    'bronze':         { variantTypeContains: 'polycarbonate' },
    'solar grey':     { variantTypeContains: 'polycarbonate' },
  },
  'petg': { 'clear': { variantTypeContains: 'petg' } },
  'pet':  { 'pet':   { variantTypeContains: 'pet' } },
  'petr': { 'petr':  { variantTypeContains: 'petr' } },
}

function resolveMapping(groupName: string, subType: string): GroupMapping | null {
  const groupLower = groupName.toLowerCase()
  const subLower = subType.toLowerCase()

  // Find the group key with the most overlapping tokens
  for (const [groupKey, subMap] of Object.entries(GROUP_MAP)) {
    if (!groupLower.includes(groupKey) && !groupKey.split(' ').every(w => groupLower.includes(w))) continue
    // Try exact sub-type match first
    if (subMap[subLower]) return subMap[subLower]
    // Try partial match
    for (const [subKey, mapping] of Object.entries(subMap)) {
      if (subLower.includes(subKey) || subKey.split(' ').every(w => subLower.includes(w))) {
        return mapping
      }
    }
  }
  return null
}

// ─── Claude extraction tool ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a data extraction assistant for CutMy, a sheet material company.
Extract the full price matrix from a Perspex Distribution Ltd price list PDF.

The PDF is a multi-page rate card. Each page covers one or more product groups.
Structure within each page:
  PRODUCT GROUP (e.g. "Perspex Cast Sheet — Standard Gloss")
    SUB-TYPE (e.g. CLEAR, OPAL, COLOUR, CLEAR SILK, IMPACT IM50)
      Table with:
        - Header row: thickness columns (e.g. 1mm, 1.5mm, 2mm, 3mm ... 25mm)
        - Data rows: sheet size label (e.g. "3050x2030", "2030x1525") + prices per thickness
        - "Price per m²" row at the bottom of each table

Extract ALL product groups and ALL sub-types you find.
For each sub-type, extract ALL thickness/price combinations for the 3050x2030 sheet size.
If 3050x2030 is not present, use the largest available sheet size.
Skip any cell showing "POA", "poa", or "-".
Extract pricePerM2 from the "Price per m²" row for the same thickness.`

const extractionTool: Anthropic.Tool = {
  name: 'extract_perspex_price_matrix',
  description: 'Extract the full price matrix from a Perspex rate card PDF',
  input_schema: {
    type: 'object' as const,
    properties: {
      quoteDate: { type: 'string', description: 'Price list date YYYY-MM-DD, or null' },
      effectiveDate: {
        type: ['string', 'null'],
        description: 'Effective date for new prices YYYY-MM-DD, or null',
      },
      productGroups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            groupName: { type: 'string', description: 'Product group heading, e.g. "Cast Sheet Standard Gloss"' },
            subType:   { type: 'string', description: 'Sub-type, e.g. "CLEAR", "OPAL", "COLOUR", "IMPACT IM50"' },
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  thicknessMm:   { type: 'number', description: 'Thickness in mm' },
                  sheetSize:     { type: 'string', description: 'Sheet size label, e.g. "3050x2030"' },
                  pricePerSheet: { type: 'number', description: 'Price per sheet in GBP (numeric only)' },
                  pricePerM2:    { type: ['number', 'null'], description: 'Price per m² in GBP, or null' },
                },
                required: ['thicknessMm', 'sheetSize', 'pricePerSheet'],
              },
            },
          },
          required: ['groupName', 'subType', 'entries'],
        },
      },
    },
    required: ['productGroups'],
  },
}

interface RawEntry {
  thicknessMm: number
  sheetSize: string
  pricePerSheet: number
  pricePerM2?: number | null
}

interface RawGroup {
  groupName: string
  subType: string
  entries: RawEntry[]
}

interface RawExtraction {
  quoteDate?: string | null
  effectiveDate?: string | null
  productGroups: RawGroup[]
}

export async function parsePerspexPriceList(pdfBase64: string): Promise<PerspexParseResult> {
  const client = getClient()

  // Inject context hints
  const contextHints = await getParserContextHints()
  const systemPrompt =
    SYSTEM_PROMPT +
    (contextHints.length > 0
      ? `\n\nADDITIONAL CONTEXT FROM CutMy TEAM:\n${contextHints.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
      : '')

  // Call Claude with the PDF
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
            text: 'Please extract the complete price matrix from this Perspex rate card. Include every product group, sub-type, and thickness.',
          },
        ],
      },
    ],
  })

  console.log('[perspex-parser] stop_reason:', response.stop_reason)

  const toolBlock = response.content.find((b) => b.type === 'tool_use')
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    console.log('[perspex-parser] no tool call — returning empty result')
    return {
      productGroups: [],
      effectiveDate: null,
      quoteDate: null,
      parseTimestamp: new Date().toISOString(),
    }
  }

  const extracted = toolBlock.input as RawExtraction
  console.log('[perspex-parser] groups extracted:', extracted?.productGroups?.length ?? 0)

  // Load all DB materials
  const { materials: allMaterials } = await getMaterials()
  const perspexMaterials = allMaterials.filter((m) =>
    m.supplier?.name?.toLowerCase().includes('perspex')
  )
  // Fall back to all materials if supplier not mapped yet
  const candidatePool = perspexMaterials.length > 0 ? perspexMaterials : allMaterials

  const productGroups: PerspexProductGroup[] = []

  for (const rawGroup of (extracted?.productGroups ?? [])) {
    const mapping = resolveMapping(rawGroup.groupName, rawGroup.subType)
    const dbVariantType = mapping?.variantTypeContains ?? null
    const isColourCategory = mapping?.isColourCategory ?? false

    // Build entries with matched materials
    const entries: PerspexEntry[] = []

    for (const rawEntry of rawGroup.entries) {
      // Derive price for standard 3050×2030 if a different size was used
      let pricePerSheet = rawEntry.pricePerSheet
      if (rawEntry.sheetSize !== '3050x2030' && rawEntry.pricePerM2) {
        pricePerSheet = Math.round(rawEntry.pricePerM2 * 3.050 * 2.030 * 100) / 100
      }

      // Find matching DB materials
      let matchedMaterials: Array<{ id: string; description: string; currentCost: number }> = []

      if (dbVariantType) {
        matchedMaterials = candidatePool
          .filter((m) => {
            const vtMatch = m.variantType?.toLowerCase().includes(dbVariantType.toLowerCase())
            const thicknessMatch = Math.abs(m.thicknessMm - rawEntry.thicknessMm) < 0.01
            return vtMatch && thicknessMatch
          })
          .map((m) => ({ id: m.id, description: m.description, currentCost: m.costPerSheet }))
      }

      entries.push({
        thicknessMm: rawEntry.thicknessMm,
        pricePerSheet,
        pricePerM2: rawEntry.pricePerM2 ?? null,
        sheetSize: rawEntry.sheetSize,
        matchedMaterials,
      })
    }

    if (entries.length > 0) {
      productGroups.push({
        groupName: rawGroup.groupName,
        subType: rawGroup.subType,
        dbVariantType,
        isColourCategory,
        entries,
      })
    }
  }

  return {
    productGroups,
    effectiveDate: extracted?.effectiveDate ?? null,
    quoteDate: extracted?.quoteDate ?? null,
    parseTimestamp: new Date().toISOString(),
  }
}
