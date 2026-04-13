// ─── Database Entity Types ───────────────────────────────────────────────────

export interface Supplier {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface Material {
  id: string
  description: string
  category: string
  typeFinish: string
  thicknessMm: number
  widthMm: number
  heightMm: number
  supplierId: string
  costPerSheet: number
  updateSource: UpdateSource
  lastUpdatedAt: string
  createdAt: string
  updatedAt: string
  // Joined
  supplier?: Supplier
  markupMultiplier?: number | null
  magentoSku?: string | null
  magentoName?: string | null
  magentoEntityId?: number | null
  variantType?: string | null
  // Derived
  costPerM2?: number
  lastCostUpdatedAt?: string | null
  hasPendingChange?: boolean
}

export interface CostHistory {
  id: string
  materialId: string
  previousCost: number
  newCost: number
  changedAt: string
  effectiveDate?: string | null
  updateSource: UpdateSource
  notes?: string | null
}

export interface StagedChange {
  id: string
  materialId: string
  proposedCost: number
  currentCost: number
  effectiveDate: string
  updateSource: UpdateSource
  notes?: string | null
  createdAt: string
  // Joined
  material?: Material
}

export interface SupplierAlias {
  id: string
  rawText: string
  materialId: string
  supplierId?: string | null
  createdAt: string
}

export interface ParserContextHint {
  id: string
  hint: string
  createdAt: string
}

// ─── Update Source ────────────────────────────────────────────────────────────

export type UpdateSource = 'manual' | 'email-parse' | 'import' | 'staged'

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface MaterialFilters {
  category?: string
  typeFinish?: string
  variantType?: string
  supplierId?: string
  search?: string
}

// ─── Bulk Update ─────────────────────────────────────────────────────────────

export interface UpdateChange {
  materialId: string
  proposedCost: number
  effectiveDate: string | null // null = immediate
  updateSource?: UpdateSource
  notes?: string
  aliasRawText?: string // if we want to save a new alias alongside
}

// ─── AI Parser Types ──────────────────────────────────────────────────────────

export type ChangeType = 'percentage' | 'absolute'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface ParsedRange {
  name: string
  manufacturer: string
  changeType: ChangeType
  changeValue: number
  effectiveDate: string | null
  rawText: string
  /** For PDF imports (e.g. Lathams): the absolute new price per sheet, used instead of
   *  calculating a delta from the current cost when an unresolved item is manually mapped. */
  absoluteNewPrice?: number
}

export interface ResolvedChange {
  materialId: string
  materialDescription: string
  currentCost: number
  proposedCost: number
  changePercent: number
  effectiveDate: string | null
  confidence: ConfidenceLevel
  rawText: string
  aliasRawText: string
  supplier?: string
}

export interface UnresolvedItem {
  rawText: string
  parsedRange: ParsedRange
  suggestedMaterials?: Array<{ id: string; description: string; score: number }>
}

export interface ParseResult {
  resolved: ResolvedChange[]
  unresolved: UnresolvedItem[]
  manufacturers: string[]
  parseTimestamp: string
}

// ─── Perspex PDF Parser ───────────────────────────────────────────────────────

export interface PerspexEntry {
  thicknessMm: number
  pricePerSheet: number   // for the standard 3050×2030 sheet
  pricePerM2: number | null
  sheetSize: string       // e.g. "3050x2030"
  /** DB materials that will be updated by this entry */
  matchedMaterials: Array<{ id: string; description: string; currentCost: number }>
}

export interface PerspexProductGroup {
  groupName: string       // e.g. "Cast Sheet Standard Gloss"
  subType: string         // e.g. "CLEAR", "COLOUR"
  dbVariantType: string | null  // resolved DB variantType, null if no mapping found
  isColourCategory: boolean     // true → bulk-update ALL colour variants per thickness
  entries: PerspexEntry[]
}

export interface PerspexParseResult {
  productGroups: PerspexProductGroup[]
  effectiveDate: string | null
  quoteDate: string | null
  parseTimestamp: string
}

// ─── API Response Shapes ──────────────────────────────────────────────────────

export interface ApiError {
  error: string
  code: string
}

export interface MaterialsResponse {
  materials: Material[]
  total: number
}

export interface BulkUpdateRequest {
  changes: UpdateChange[]
}

export interface BulkUpdateResponse {
  updated: number
  staged: number
  errors: Array<{ materialId: string; error: string }>
}

export interface ParseEmailRequest {
  emailBody: string
}

export interface SaveAliasRequest {
  rawText: string
  materialId: string
  supplierId?: string
}

// ─── UI State Types ───────────────────────────────────────────────────────────

export interface ReviewRow {
  materialId: string
  materialDescription: string
  supplier: string
  currentCost: number
  proposedCost: number
  changePercent: number
  effectiveDate: string | null
  confidence: ConfidenceLevel
  rawText: string
  aliasRawText: string
  selected: boolean
  isEditing: boolean
}

export interface UnresolvedRow {
  rawText: string
  parsedRange: ParsedRange
  mappedMaterialId: string | null
}

// ─── Grouped Materials ────────────────────────────────────────────────────────

export interface MaterialGroup {
  category: string
  typeFinish: string
  materials: Material[]
}
