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
   - Extract the product name EXACTLY as written in the email — do not paraphrase, substitute, or invent product names. Copy the brand, material name, grade, and thickness verbatim from the email text. If the email says "Roble Hera (Sega)", the name must be "Roble Hera (Sega)" — never replace it with another product name you may know. NEVER include qualifiers like "all products", "all ranges", "excl. X", "with the exception of", "range", "items" etc. in the name field.
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
              description: 'Product name copied VERBATIM from the email — do not substitute or invent names. Include brand, grade, and thickness exactly as written (e.g. "18mm FINSA 12Twenty Roble Hera (Sega) Melamine"). Strip only prose qualifiers like "all products", "excl. X", "range", "items".',
            },
            thicknesses: {
              type: 'array',
              items: { type: 'number' },
              description: 'List of any specific material thicknesses explicitly mentioned (e.g. [3, 5] for "3 and 5 mm", or [6] for "6mm"). Leave empty if no specific thicknesses are mentioned.',
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
          required: ['name', 'manufacturer', 'changeType', 'changeValue', 'effectiveDate', 'rawText', 'confidence', 'exclusions', 'thicknesses'],
        },
        description: 'List of product ranges with price changes',
      },
    },
    required: ['manufacturers', 'ranges'],
  },
}

interface ExtractedRange {
  name: string
  thicknesses: number[]
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

// Core material nouns that define the fundamental type of a product.
// If a range explicitly names one of these, we strictly require the material description
// to also contain it, otherwise we instantly reject the match.
const MATERIAL_NOUNS = new Set([
  'acrylic', 'polycarbonate', 'poly', 'mdf', 'plywood', 'ply', 'osb',
  'foam', 'pvc', 'dibond', 'acm', 'chipboard', 'mfc', 'timber'
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

  // Strict check: if the range explicitly specifies a core material type,
  // the description must contain it, or we immediately reject the match.
  const requiredNouns = rangeWords.filter((w) => MATERIAL_NOUNS.has(w))
  for (const noun of requiredNouns) {
    if (!descWords.some((d) => d.includes(noun) || noun.includes(d))) {
      return 0 // Total mismatch on a core material type
    }
  }

  const matches = rangeWords.filter((w) => descWords.some((d) => d.includes(w) || w.includes(d)))
  // Score = fraction of the range name's meaningful words that matched.
  // Dividing by rangeWords.length (not the max) means a short range like
  // "Coloured Acrylic" against a long combined target "3mm Red Acrylic Cast Coloured"
  // still scores 1.0 when both words are present, rather than being diluted to 0.4.
  return matches.length / rangeWords.length
}

export async function parseEmail(emailBody: string): Promise<ParseResult> {
  // 1. Load any user-defined context hints and build the final system prompt.
  //    Always inject today's date so Claude infers the correct year for relative
  //    dates like "7th April" or "next week" (without this it defaults to 2025).
  const contextHints = await getParserContextHints()
  const todayStr = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  const dateNote = `\n\nTODAY'S DATE: ${todayStr}. Use this to resolve relative or partial dates (e.g. "7th April" → ${new Date().getFullYear()}-04-07, "next week" → the appropriate date). Always use the current year unless the date has clearly already passed this year.`
  const systemPrompt =
    SYSTEM_PROMPT +
    dateNote +
    (contextHints.length > 0
      ? `\n\nADDITIONAL CONTEXT FROM CutMy TEAM:\n${contextHints.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
      : '')

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

    const candidateMaterials = allMaterials.filter((m) => {
      // Skip materials with no cost set — percentage changes would resolve to £0.00
      if (m.costPerSheet <= 0) return false
      // Skip materials whose description matches an exclusion from the email
      if (exclusionWords.some((ex) => m.description.toLowerCase().includes(ex))) return false
      // Enforce exact thickness when array of thicknesses is specified in the range
      if (range.thicknesses && range.thicknesses.length > 0) {
        // Must match at least one of the extracted thicknesses
        const matchesThickness = range.thicknesses.some((reqThick) => Math.abs(m.thicknessMm - reqThick) < 0.01)
        if (!matchesThickness) return false
      }
      return true
    })

    const scored = candidateMaterials
      .map((m) => {
        // Primary score: description + variantType + typeFinish combined
        // typeFinish must be included so material nouns like "MDF" stored there
        // don't cause a hard rejection when they appear in the extracted range name
        const searchTarget = [m.description, m.variantType, m.typeFinish].filter(Boolean).join(' ')
        // Score against both extracted name AND raw email text — Claude sometimes
        // hallucinates a product name, but rawText contains the original wording
        const nameScore = fuzzyScore(range.name, searchTarget)
        const rawScore = fuzzyScore(range.rawText, searchTarget)
        const combinedScore = Math.max(nameScore, rawScore)

        // Bonus: if every meaningful word in variantType appears in the range name
        // AND the range name is not much more specific than the variantType itself,
        // it's a group-level match (e.g. "Coloured Acrylic +5%" → all colours).
        // Do NOT boost when the range name is a specific product (e.g. it has many
        // extra tokens beyond the variantType words) — that would incorrectly pull in
        // all siblings of a specifically-named product.
        let variantBoost = 0
        if (m.variantType) {
          const vtWords = m.variantType.toLowerCase()
            .split(/\s+/)
            .map((w) => w.replace(/[^a-z0-9]/g, ''))
            .filter((w) => w.length > 2 && !RANGE_STOP_WORDS.has(w))
          const rangeLower = range.name.toLowerCase()
          if (vtWords.length > 0 && vtWords.every((w) => rangeLower.includes(w))) {
            // Only boost if the range name isn't significantly more specific than variantType
            // i.e. the number of extra meaningful tokens beyond vtWords is small (≤ 2)
            const rangeWordsList = rangeLower
              .split(/\s+/)
              .map((w) => w.replace(/[^a-z0-9]/g, ''))
              .filter((w) => w.length > 2 && !RANGE_STOP_WORDS.has(w))
            const extraWords = rangeWordsList.filter(
              (w) => !vtWords.some((vt) => vt.includes(w) || w.includes(vt))
            )
            if (extraWords.length <= 2) {
              variantBoost = 0.25
            }
          }
        }

        return { material: m, score: Math.min(1, combinedScore + variantBoost) }
      })
      .filter((s) => s.score > 0.3)
      .sort((a, b) => b.score - a.score)

    if (scored.length > 0 && scored[0].score > 0.65) {
      const matches = scored.filter((s) => s.score >= 0.65)
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
