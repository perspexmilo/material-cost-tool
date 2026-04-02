import Anthropic from '@anthropic-ai/sdk'
import { getMaterials } from '@/lib/db/materials'
import { resolveAliases } from '@/lib/db/supplier-aliases'
import { getParserContextHints } from '@/lib/db/parser-context'
import type { ParseResult, ResolvedChange, UnresolvedItem, ParsedRange, ConfidenceLevel } from '@/types'

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in environment variables')
  return new Anthropic({ apiKey })
}

const SYSTEM_PROMPT = `You are a specialist data extraction assistant for CutMy, a sheet material cutting company. Your job is to parse supplier price update emails and extract structured information about price changes.

CONTEXT:
CutMy purchases sheet materials including:
- Wood-based: MDF (plain, moisture-resistant, fire-retardant), Plywood (birch, hardwood, marine), OSB
- Plastics: Acrylic (cast, extruded, various colours), Polycarbonate (clear, tinted), Dibond (aluminium composite)
- Accessories: Various

EXTRACTION RULES:
1. Extract the supplier/manufacturer name(s) mentioned in the email
2. For each product range or material type with a price change:
   - Extract a SHORT, CLEAN product identifier as the name — just the brand/material/grade (e.g. "Medite Premier MDF", "Clear Acrylic", "Birch Plywood"). NEVER include qualifiers like "all products", "all ranges", "excl. X", "with the exception of", "range", "items" etc. in the name field.
   - If certain products are excluded (e.g. "excl. Trade and Tricoya"), list them in the exclusions field — do NOT put them in the name.
   - If the email says "all products" with no brand/material qualifier, use the manufacturer name as the range name (e.g. "Medite").
   - Determine if the change is a percentage (%) or absolute amount (£/currency)
   - Extract the change value (positive = increase, negative = decrease)
   - Find the effective date if mentioned (ISO 8601 format YYYY-MM-DD, or null if immediate/not specified)
   - Include the raw text snippet that led to this extraction
3. Be conservative: if something is ambiguous, mark it for review rather than guessing
4. Common patterns:
   - "prices will increase by X%" → percentage change
   - "surcharge of £X per sheet" → absolute change
   - "effective from [date]" or "from [date]" → effective date
   - "with immediate effect" → null effective date (apply now)

CONFIDENCE GUIDANCE:
- Use exact product names and clear percentage/amount = high confidence
- General range name with clear change = medium confidence
- Ambiguous product reference or unclear change type = low confidence → mark as unresolved`

const extractionTool: Anthropic.Tool = {
  name: 'extract_price_changes',
  description: 'Extract structured price change data from a supplier email',
  input_schema: {
    type: 'object' as const,
    properties: {
      manufacturers: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of manufacturer/supplier names mentioned in the email',
      },
      ranges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'SHORT clean product identifier — brand/material/grade only (e.g. "Medite Premier MDF", "Clear Acrylic"). Strip qualifiers like "all products", "excl. X", "range", "items" etc.',
            },
            exclusions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Product names or grades explicitly excluded from this price change (e.g. ["Trade", "Tricoya"])',
            },
            manufacturer: {
              type: 'string',
              description: 'Which manufacturer this range belongs to',
            },
            changeType: {
              type: 'string',
              enum: ['percentage', 'absolute'],
              description: 'Whether the change is a percentage or absolute amount',
            },
            changeValue: {
              type: 'number',
              description: 'The change amount (positive = increase, negative = decrease). For percentage: 5 means 5%. For absolute: amount in £.',
            },
            effectiveDate: {
              type: ['string', 'null'],
              description: 'Effective date in YYYY-MM-DD format, or null if immediate or not specified',
            },
            rawText: {
              type: 'string',
              description: 'The exact snippet of text from the email that contains this price change',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Confidence level in the extraction accuracy',
            },
          },
          required: ['name', 'manufacturer', 'changeType', 'changeValue', 'effectiveDate', 'rawText', 'confidence', 'exclusions'],
        },
        description: 'List of product ranges with price changes',
      },
    },
    required: ['manufacturers', 'ranges'],
  },
}

interface ExtractedRange {
  name: string
  exclusions: string[]
  manufacturer: string
  changeType: 'percentage' | 'absolute'
  changeValue: number
  effectiveDate: string | null
  rawText: string
  confidence: ConfidenceLevel
}

interface ExtractionResult {
  manufacturers: string[]
  ranges: ExtractedRange[]
}

function calculateProposedCost(currentCost: number, changeType: 'percentage' | 'absolute', changeValue: number): number {
  if (changeType === 'percentage') {
    return Math.round((currentCost * (1 + changeValue / 100)) * 100) / 100
  } else {
    return Math.round((currentCost + changeValue) * 100) / 100
  }
}

function calculateChangePercent(currentCost: number, proposedCost: number): number {
  if (currentCost === 0) return 0
  return Math.round(((proposedCost - currentCost) / currentCost) * 10000) / 100
}

/**
 * Fuzzy text match — returns a score 0–1 based on how well the range name matches
 * a material description. Higher = better match.
 */
// Generic words that appear in email prose but carry no product identity signal
const RANGE_STOP_WORDS = new Set([
  'all', 'products', 'product', 'range', 'ranges', 'items', 'item',
  'excl', 'except', 'excluding', 'exception', 'including', 'inclusive',
  'and', 'the', 'with', 'without', 'other', 'new', 'standard', 'our',
  'price', 'prices', 'increase', 'decrease', 'update', 'change',
])

function fuzzyScore(rangeName: string, materialDescription: string): number {
  const range = rangeName.toLowerCase()
  const desc = materialDescription.toLowerCase()

  if (desc.includes(range) || range.includes(desc)) return 0.9

  // Filter out short words (≤ 2 chars) AND generic prose words so that a range
  // name like "Medite All Products (excl. Trade)" scores purely on "medite".
  const rangeWords = range
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 2 && !RANGE_STOP_WORDS.has(w))
  const descWords = desc.split(/\s+/).filter((w) => w.length > 2)
  if (rangeWords.length === 0) return 0

  const matches = rangeWords.filter((w) => descWords.some((d) => d.includes(w) || w.includes(d)))
  return matches.length / Math.max(rangeWords.length, descWords.length)
}

export async function parseEmail(emailBody: string): Promise<ParseResult> {
  // 1. Load any user-defined context hints and append to the system prompt
  const contextHints = await getParserContextHints()
  const systemPrompt =
    contextHints.length > 0
      ? `${SYSTEM_PROMPT}\n\nADDITIONAL CONTEXT FROM CutMy TEAM:\n${contextHints.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
      : SYSTEM_PROMPT

  // 2. Call Claude to extract structured data
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    tools: [extractionTool],
    tool_choice: { type: 'any' },
    messages: [
      {
        role: 'user',
        content: `Please extract all price change information from this supplier email:\n\n---\n${emailBody}\n---`,
      },
    ],
  })

  // 3. Parse the tool use response
  const toolUseBlock = response.content.find((block) => block.type === 'tool_use')
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    return {
      resolved: [],
      unresolved: [],
      manufacturers: [],
      parseTimestamp: new Date().toISOString(),
    }
  }

  const extracted = toolUseBlock.input as ExtractionResult

  // 4. Load all materials and known aliases
  const [allMaterials, aliasMap] = await Promise.all([
    getMaterials(),
    resolveAliases(extracted.ranges.map((r) => r.name)),
  ])

  const resolved: ResolvedChange[] = []
  const unresolved: UnresolvedItem[] = []

  // 5. Try to match each extracted range to a material
  for (const range of extracted.ranges) {
    const knownMaterialId = aliasMap[range.name]

    if (knownMaterialId) {
      // Direct alias match → high confidence
      const material = allMaterials.find((m) => m.id === knownMaterialId)
      if (material) {
        const proposedCost = calculateProposedCost(material.costPerSheet, range.changeType, range.changeValue)
        resolved.push({
          materialId: material.id,
          materialDescription: material.description,
          currentCost: material.costPerSheet,
          proposedCost,
          changePercent: calculateChangePercent(material.costPerSheet, proposedCost),
          effectiveDate: range.effectiveDate,
          confidence: 'high',
          rawText: range.rawText,
          aliasRawText: range.name,
          supplier: material.supplier?.name,
        })
        continue
      }
    }

    // 5. Fuzzy match against all materials — return ALL good matches so that
    //    a range-level description (e.g. "Clear Acrylic") resolves every thickness.
    //    Skip any material whose description matches an exclusion word from the email.
    const exclusionWords = (range.exclusions ?? []).map((e) => e.toLowerCase())
    const candidateMaterials = exclusionWords.length > 0
      ? allMaterials.filter((m) => !exclusionWords.some((ex) => m.description.toLowerCase().includes(ex)))
      : allMaterials

    const scored = candidateMaterials
      .map((m) => ({ material: m, score: fuzzyScore(range.name, m.description) }))
      .filter((s) => s.score > 0.3)
      .sort((a, b) => b.score - a.score)

    if (scored.length > 0 && scored[0].score > 0.6) {
      // Include every material whose score is ≥ 0.6 (not just the top one)
      const matches = scored.filter((s) => s.score >= 0.6)
      for (const match of matches) {
        const confidence: ConfidenceLevel = match.score > 0.8 ? 'high' : 'medium'
        const proposedCost = calculateProposedCost(match.material.costPerSheet, range.changeType, range.changeValue)
        resolved.push({
          materialId: match.material.id,
          materialDescription: match.material.description,
          currentCost: match.material.costPerSheet,
          proposedCost,
          changePercent: calculateChangePercent(match.material.costPerSheet, proposedCost),
          effectiveDate: range.effectiveDate,
          confidence,
          rawText: range.rawText,
          aliasRawText: range.name,
          supplier: match.material.supplier?.name,
        })
      }
    } else {
      // Cannot resolve
      const parsedRange: ParsedRange = {
        name: range.name,
        manufacturer: range.manufacturer,
        changeType: range.changeType,
        changeValue: range.changeValue,
        effectiveDate: range.effectiveDate,
        rawText: range.rawText,
      }
      unresolved.push({
        rawText: range.rawText,
        parsedRange,
        suggestedMaterials: scored.slice(0, 3).map((s) => ({
          id: s.material.id,
          description: s.material.description,
          score: s.score,
        })),
      })
    }
  }

  // Deduplicate resolved items: if the same materialId was matched by multiple
  // extracted ranges, keep the one with the highest-confidence entry.
  const confidenceRank: Record<ConfidenceLevel, number> = { high: 2, medium: 1, low: 0 }
  const dedupedResolved = Object.values(
    resolved.reduce<Record<string, ResolvedChange>>((acc, item) => {
      const existing = acc[item.materialId]
      if (!existing || confidenceRank[item.confidence] > confidenceRank[existing.confidence]) {
        acc[item.materialId] = item
      }
      return acc
    }, {}),
  )

  return {
    resolved: dedupedResolved,
    unresolved,
    manufacturers: extracted.manufacturers,
    parseTimestamp: new Date().toISOString(),
  }
}
