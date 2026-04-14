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

// ─── Material → Category fallback mapping ────────────────────────────────────
// Used when `category` column is absent — derives from the `material` value.

const MATERIAL_CATEGORY_MAP: Record<string, string> = {
  mdf: 'Wood',
  plywood: 'Wood',
  osb: 'Wood',
  phenolic: 'Wood',
  hardboard: 'Wood',
  chipboard: 'Wood',
  mfc: 'Wood',
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

// ─── Row parser ───────────────────────────────────────────────────────────────
// Supports the current column layout:
//   entity_id, name, sku, category, material, variant_type,
//   thickness, cost, cost_length, cost_width, supplier
//
// Falls back to old Metabase column names for backward compatibility:
//   entity_id, Variant Name, sku, (derived), Type, Variant_Type,
//   Thickness, Cost, Cost_Length, Cost_Width, (Unassigned)

function col(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k]?.trim()
    if (v) return v
  }
  return ''
}

function parseRow(row: Record<string, string>, defaultSupplierId: string) {
  const entityIdRaw = col(row, 'entity_id', 'magento_entity_id').replace(/,/g, '')
  const magentoEntityId = entityIdRaw ? parseInt(entityIdRaw, 10) : null

  const variantName = col(row, 'name', 'Variant Name', 'Name', 'magento_name')
  const magentoName = variantName || null
  const description = variantName || col(row, 'sku', 'magento_sku')

  // material = specific material type (acrylic, mdf, etc.) — stored as typeFinish
  const material = col(row, 'material', 'Type', 'type_finish', 'Material')

  // category = Wood / Plastic — read directly or derive from material
  const categoryRaw = col(row, 'category')
  const category = categoryRaw || (material ? materialToCategory(material) : 'Accessories')

  const typeFinish = material || 'Other'
  const variantType = col(row, 'variant_type', 'Variant_Type') || null

  const thicknessRaw = col(row, 'thickness', 'Thickness', 'thickness_mm').replace(/mm$/i, '')
  const thicknessMm = parseFloat(thicknessRaw) || 0
  const widthMm = parseFloat(col(row, 'cost_width', 'Cost_Width', 'width_mm')) || 0
  const heightMm = parseFloat(col(row, 'cost_length', 'Cost_Length', 'height_mm')) || 0
  const costPerSheet = parseFloat(col(row, 'cost', 'Cost', 'cost_per_sheet')) || 0

  const markupRaw = col(row, 'markup_multiplier')
  const markupMultiplier = markupRaw !== '' ? parseFloat(markupRaw) : null

  return {
    description,
    category,
    typeFinish,
    thicknessMm,
    widthMm,
    heightMm,
    supplierId: defaultSupplierId,
    costPerSheet,
    markupMultiplier,
    updateSource: 'import',
    lastUpdatedAt: new Date(),
    magentoName,
    magentoEntityId,
    variantType,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function importMaterialsFromCsv(csvText: string): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] }

  const { headers, rows } = parseCSV(csvText)
  if (headers.length === 0 || rows.length === 0) return result

  // Accept CSVs with entity_id (current format) or magento_sku (legacy template)
  const hasSku = headers.includes('sku') || headers.includes('magento_sku')
  if (!hasSku) {
    result.errors.push({
      row: 0,
      sku: '',
      error: 'Unrecognised CSV format: missing sku column',
    })
    return result
  }

  const isLegacyTemplate = !headers.includes('sku') && headers.includes('magento_sku')

  // 1. Gather unique supplier names
  const uniqueSupplierNames = new Set<string>()
  for (const row of rows) {
    uniqueSupplierNames.add(col(row, 'supplier') || 'Unassigned')
  }

  // 2. Fetch/create suppliers
  const supplierNamesArr = Array.from(uniqueSupplierNames)
  let existingSuppliers = await prisma.supplier.findMany({
    where: { name: { in: supplierNamesArr } },
  })
  const supplierMap = new Map<string, string>(existingSuppliers.map((s) => [s.name, s.id]))

  const missingSuppliers = supplierNamesArr.filter((name) => !supplierMap.has(name))
  if (missingSuppliers.length > 0) {
    await prisma.supplier.createMany({
      data: missingSuppliers.map((name) => ({ name })),
      skipDuplicates: true,
    })
    existingSuppliers = await prisma.supplier.findMany({
      where: { name: { in: supplierNamesArr } },
    })
    for (const s of existingSuppliers) supplierMap.set(s.name, s.id)
  }

  const unassignedId = supplierMap.get('Unassigned') ?? ''

  // 3. Collect valid rows
  const validRows: Array<{ row: Record<string, string>; rowIndex: number; sku: string }> = []
  const skus: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const sku = isLegacyTemplate
      ? (row['magento_sku']?.trim() ?? '')
      : (row['sku']?.trim() ?? '')
    if (!sku) { result.skipped++; continue }
    validRows.push({ row, rowIndex: i + 2, sku })
    skus.push(sku)
  }

  if (validRows.length === 0) return result

  // 4. Which SKUs already exist?
  const existingMaterials = await prisma.material.findMany({
    where: { magentoSku: { in: skus } },
  })
  const existingSkuSet = new Set(existingMaterials.map((m) => m.magentoSku))

  // 5. Build creates / updates
  const creates: any[] = []
  const updates: Array<{ sku: string; rowIndex: number; data: any }> = []

  for (const { row, rowIndex, sku } of validRows) {
    try {
      const supplierName = col(row, 'supplier') || 'Unassigned'
      const supplierId = supplierMap.get(supplierName) || unassignedId

      const data = parseRow(row, supplierId)

      if (existingSkuSet.has(sku)) {
        updates.push({ sku, rowIndex, data })
      } else {
        creates.push({ ...data, magentoSku: sku })
      }
    } catch (err) {
      result.errors.push({
        row: rowIndex,
        sku,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  // 6. Bulk create
  if (creates.length > 0) {
    try {
      await prisma.material.createMany({ data: creates, skipDuplicates: true })
      result.imported = creates.length
    } catch (err) {
      result.errors.push({
        row: 0,
        sku: 'bulk-create',
        error: `Bulk insert failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  // 7. Chunked updates
  const chunkSize = 20
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize)
    await Promise.all(
      chunk.map(async (u) => {
        try {
          await prisma.material.update({ where: { magentoSku: u.sku }, data: u.data })
          result.updated++
        } catch (err) {
          result.errors.push({
            row: u.rowIndex,
            sku: u.sku,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }),
    )
  }

  return result
}
