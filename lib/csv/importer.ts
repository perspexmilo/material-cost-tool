import { prisma } from '@/lib/db/prisma'

export interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: Array<{ row: number; sku: string; error: string }>
}

// ─── CSV Parsing ──────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  if (nonEmpty.length === 0) return { headers: [], rows: [] }

  const headers = splitCSVLine(nonEmpty[0])
  const rows: Record<string, string>[] = []

  for (let i = 1; i < nonEmpty.length; i++) {
    const values = splitCSVLine(nonEmpty[i])
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? ''
    }
    rows.push(row)
  }

  return { headers, rows }
}

function splitCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

// ─── Material → Category mapping ─────────────────────────────────────────────

// Maps the Magento `Material` attribute value to our internal category grouping.
// typeFinish defaults to the Material value itself unless overridden by `Type`.
const MATERIAL_CATEGORY_MAP: Record<string, string> = {
  mdf: 'Wood',
  plywood: 'Wood',
  osb: 'Wood',
  phenolic: 'Wood',
  hardboard: 'Wood',
  chipboard: 'Wood',
  mfc: 'Wood',   // Melamine-Faced Chipboard
  timber: 'Wood',
  acrylic: 'Plastic',
  polycarbonate: 'Plastic',
  acm: 'Plastic',
  dibond: 'Plastic',
  'aluminium composite': 'Plastic',
  foam: 'Plastic',
  pvc: 'Plastic',
}

function materialToCategory(material: string): string {
  return MATERIAL_CATEGORY_MAP[material.toLowerCase()] ?? 'Accessories'
}

// ─── Supplier Upsert ──────────────────────────────────────────────────────────

async function upsertSupplier(name: string): Promise<string> {
  const supplier = await prisma.supplier.upsert({
    where: { name },
    update: {},
    create: { name },
  })
  return supplier.id
}

// ─── Format A Import (Metabase export) ───────────────────────────────────────
//
// Expected columns (add these to your Metabase report):
//   entity_id, Variant Name, sku, Cost, Cost_Width, Cost_Length, Thickness,
//   Material, Type, Variant_Type
//
// - Material  → category + typeFinish (e.g. "MDF", "Plywood", "Acrylic")
// - Type      → overrides typeFinish if present (e.g. "Standard", "Premium")
// - Variant Name → description
// - Variant_Type → brand/range stored in variantType (e.g. "Kronospan")
// - Supplier is not in Magento data — defaults to "Unassigned" (assign later)

async function importMetabaseRow(
  row: Record<string, string>,
  rowIndex: number,
  result: ImportResult,
): Promise<void> {
  const sku = row['sku']?.trim() ?? ''
  if (!sku) {
    result.skipped++
    return
  }

  const entityIdRaw = row['entity_id']?.trim().replace(/,/g, '') ?? ''
  const magentoEntityId = entityIdRaw ? parseInt(entityIdRaw, 10) : null

  // Prefer "Variant Name" over legacy "Name" column
  const variantName = row['Variant Name']?.trim() || row['Name']?.trim() || sku
  const magentoName = variantName

  const materialAttr = row['Material']?.trim() || row['Attribute_Set']?.trim() || ''
  const typeAttr = row['Type']?.trim() || ''
  const variantType = row['Variant_Type']?.trim() || null

  // category comes from Material attribute, never from SKU
  const category = materialAttr ? materialToCategory(materialAttr) : 'Accessories'

  // typeFinish: use Type attribute if present, otherwise use Material value directly
  const typeFinish = typeAttr || materialAttr || 'Other'

  // description = Variant Name (the human-readable product name)
  const description = variantName

  const thicknessRaw = (row['Thickness']?.trim() ?? '0').replace(/mm$/i, '')
  const thicknessMm = parseFloat(thicknessRaw) || 0

  const widthMm = parseFloat(row['Cost_Width']?.trim() ?? '0') || 0
  const heightMm = parseFloat(row['Cost_Length']?.trim() ?? '0') || 0
  const costPerSheet = parseFloat(row['Cost']?.trim() ?? '0') || 0

  // Supplier not available in Magento data — use Unassigned as placeholder
  const supplierId = await upsertSupplier('Unassigned')

  const existing = await prisma.material.findUnique({ where: { magentoSku: sku } })

  try {
    if (existing) {
      await prisma.material.update({
        where: { magentoSku: sku },
        data: {
          costPerSheet,
          magentoEntityId,
          magentoName,
          variantType,
          description,
          category,
          typeFinish,
          thicknessMm,
          widthMm,
          heightMm,
          updateSource: 'import',
          lastUpdatedAt: new Date(),
        },
      })
      result.updated++
    } else {
      await prisma.material.create({
        data: {
          description,
          category,
          typeFinish,
          thicknessMm,
          widthMm,
          heightMm,
          supplierId,
          costPerSheet,
          updateSource: 'import',
          lastUpdatedAt: new Date(),
          magentoSku: sku,
          magentoName,
          magentoEntityId,
          variantType,
        },
      })
      result.imported++
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    result.errors.push({ row: rowIndex, sku, error: message })
  }
}

// ─── Format B Import (Template format) ───────────────────────────────────────

async function importTemplateRow(
  row: Record<string, string>,
  rowIndex: number,
  result: ImportResult,
): Promise<void> {
  const sku = row['magento_sku']?.trim() ?? ''
  if (!sku) {
    result.skipped++
    return
  }

  const magentoName = row['magento_name']?.trim() || null
  const magentoEntityIdRaw = row['magento_entity_id']?.trim() ?? ''
  const magentoEntityId = magentoEntityIdRaw ? parseInt(magentoEntityIdRaw, 10) : null
  const category = row['category']?.trim() || 'Accessories'
  const typeFinish = row['type_finish']?.trim() || 'Other'
  const description = row['description']?.trim() || sku
  const thicknessMm = parseFloat(row['thickness_mm']?.trim() ?? '0') || 0
  const widthMm = parseFloat(row['width_mm']?.trim() ?? '0') || 0
  const heightMm = parseFloat(row['height_mm']?.trim() ?? '0') || 0
  const costPerSheet = parseFloat(row['cost_per_sheet']?.trim() ?? '0') || 0
  const supplierName = row['supplier']?.trim() || 'Unassigned'
  const variantType = row['variant_type']?.trim() || null

  const supplierId = await upsertSupplier(supplierName)
  const existing = await prisma.material.findUnique({ where: { magentoSku: sku } })

  try {
    if (existing) {
      await prisma.material.update({
        where: { magentoSku: sku },
        data: {
          costPerSheet,
          magentoEntityId,
          magentoName,
          variantType,
          updateSource: 'import',
          lastUpdatedAt: new Date(),
        },
      })
      result.updated++
    } else {
      await prisma.material.create({
        data: {
          description,
          category,
          typeFinish,
          thicknessMm,
          widthMm,
          heightMm,
          supplierId,
          costPerSheet,
          updateSource: 'import',
          lastUpdatedAt: new Date(),
          magentoSku: sku,
          magentoName,
          magentoEntityId,
          variantType,
        },
      })
      result.imported++
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    result.errors.push({ row: rowIndex, sku, error: message })
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function importMaterialsFromCsv(csvText: string): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] }

  const { headers, rows } = parseCSV(csvText)
  if (headers.length === 0 || rows.length === 0) return result

  const isMetabase = headers.includes('entity_id')
  const isTemplate = headers.includes('magento_sku')

  if (!isMetabase && !isTemplate) {
    result.errors.push({
      row: 0,
      sku: '',
      error: 'Unrecognised CSV format: missing entity_id or magento_sku column',
    })
    return result
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      if (isMetabase) {
        await importMetabaseRow(row, i + 2, result)
      } else {
        await importTemplateRow(row, i + 2, result)
      }
    } catch (err) {
      const sku = isMetabase ? (row['sku'] ?? '') : (row['magento_sku'] ?? '')
      const message = err instanceof Error ? err.message : 'Unknown error'
      result.errors.push({ row: i + 2, sku, error: message })
    }
  }

  return result
}
