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

// ─── Supplier Batch Processing ──────────────────────────────────────────────────

// ─── Format parsers ──────────────────────────────────────────────────────────

function parseMetabaseRow(row: Record<string, string>, supplierId: string) {
  const entityIdRaw = row['entity_id']?.trim().replace(/,/g, '') ?? ''
  const magentoEntityId = entityIdRaw ? parseInt(entityIdRaw, 10) : null

  const variantName = row['Variant Name']?.trim() || row['Name']?.trim() || row['sku']?.trim()
  const magentoName = variantName

  const materialAttr = row['Material']?.trim() || row['Attribute_Set']?.trim() || ''
  const typeAttr = row['Type']?.trim() || ''
  const variantType = row['Variant_Type']?.trim() || null

  const category = materialAttr ? materialToCategory(materialAttr) : 'Accessories'
  const typeFinish = typeAttr || materialAttr || 'Other'
  const description = variantName ?? ''

  const thicknessRaw = (row['Thickness']?.trim() ?? '0').replace(/mm$/i, '')
  const thicknessMm = parseFloat(thicknessRaw) || 0
  const widthMm = parseFloat(row['Cost_Width']?.trim() ?? '0') || 0
  const heightMm = parseFloat(row['Cost_Length']?.trim() ?? '0') || 0
  const costPerSheet = parseFloat(row['Cost']?.trim() ?? '0') || 0
  const markupMultiplierRaw = row['markup_multiplier']?.trim() ?? ''
  const markupMultiplier = markupMultiplierRaw !== '' ? parseFloat(markupMultiplierRaw) : null

  return {
    description,
    category,
    typeFinish,
    thicknessMm,
    widthMm,
    heightMm,
    supplierId,
    costPerSheet,
    markupMultiplier,
    updateSource: 'import',
    lastUpdatedAt: new Date(),
    magentoName,
    magentoEntityId,
    variantType,
  }
}

function parseTemplateRow(row: Record<string, string>, supplierId: string) {
  const magentoEntityIdRaw = row['magento_entity_id']?.trim().replace(/,/g, '') ?? ''
  const magentoEntityId = magentoEntityIdRaw ? parseInt(magentoEntityIdRaw, 10) : null
  const category = row['category']?.trim() || 'Accessories'
  const typeFinish = row['type_finish']?.trim() || 'Other'
  const description = row['description']?.trim() || row['magento_name']?.trim() || row['magento_sku']?.trim() || ''
  const magentoName = row['magento_name']?.trim() || description || null
  const thicknessMm = parseFloat(row['thickness_mm']?.trim() ?? '0') || 0
  const widthMm = parseFloat(row['width_mm']?.trim() ?? '0') || 0
  const heightMm = parseFloat(row['height_mm']?.trim() ?? '0') || 0
  const costPerSheet = parseFloat(row['cost_per_sheet']?.trim() ?? '0') || 0
  const variantType = row['variant_type']?.trim() || null
  const markupMultiplierRaw = row['markup_multiplier']?.trim() ?? ''
  const markupMultiplier = markupMultiplierRaw !== '' ? parseFloat(markupMultiplierRaw) : null

  return {
    description,
    category,
    typeFinish,
    thicknessMm,
    widthMm,
    heightMm,
    supplierId,
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

  // 1. Gather all unique supplier names
  const uniqueSupplierNames = new Set<string>()
  for (const row of rows) {
    if (isMetabase) {
      uniqueSupplierNames.add('Unassigned')
    } else {
      uniqueSupplierNames.add(row['supplier']?.trim() || 'Unassigned')
    }
  }

  // 2. Fetch existing suppliers and create missing ones
  const supplierNamesArr = Array.from(uniqueSupplierNames)
  let existingSuppliers = await prisma.supplier.findMany({
    where: { name: { in: supplierNamesArr } }
  })
  const supplierMap = new Map<string, string>(existingSuppliers.map(s => [s.name, s.id]))
  
  const missingSuppliers = supplierNamesArr.filter(name => !supplierMap.has(name))
  if (missingSuppliers.length > 0) {
    await prisma.supplier.createMany({
      data: missingSuppliers.map(name => ({ name })),
      skipDuplicates: true,
    })
    // Re-fetch all suppliers to get their new IDs
    existingSuppliers = await prisma.supplier.findMany({
      where: { name: { in: supplierNamesArr } }
    })
    for (const s of existingSuppliers) {
      supplierMap.set(s.name, s.id)
    }
  }

  // 3. Collect valid rows and extract SKUs
  const validRows: Array<{ row: Record<string, string>, rowIndex: number, sku: string }> = []
  const skus: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const sku = isMetabase ? row['sku']?.trim() ?? '' : row['magento_sku']?.trim() ?? ''
    if (!sku) {
      result.skipped++
      continue
    }
    validRows.push({ row, rowIndex: i + 2, sku })
    skus.push(sku)
  }

  if (validRows.length === 0) return result

  // 4. Determine which SKUs already exist in the database
  const existingMaterials = await prisma.material.findMany({
    where: { magentoSku: { in: skus } }
  })
  const existingSkuSet = new Set(existingMaterials.map(m => m.magentoSku))

  // 5. Build up arrays of operations
  const creates: any[] = []
  const updates: Array<{ sku: string, rowIndex: number, data: any }> = []

  for (const { row, rowIndex, sku } of validRows) {
    try {
      const supplierName = isMetabase ? 'Unassigned' : (row['supplier']?.trim() || 'Unassigned')
      const supplierId = supplierMap.get(supplierName) || ''

      const parsedData = isMetabase 
        ? parseMetabaseRow(row, supplierId) 
        : parseTemplateRow(row, supplierId)

      if (existingSkuSet.has(sku)) {
        updates.push({ sku, rowIndex, data: parsedData })
      } else {
        creates.push({ ...parsedData, magentoSku: sku })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      result.errors.push({ row: rowIndex, sku, error: message })
    }
  }

  // 6. Execute Creates in bulk
  if (creates.length > 0) {
    try {
      await prisma.material.createMany({
        data: creates,
        skipDuplicates: true,
      })
      result.imported = creates.length
    } catch (err) {
      result.errors.push({
        row: 0,
        sku: 'bulk-create',
        error: `Bulk insert failed: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  // 7. Execute Updates in chunks to avoid connection limits / large transactions
  // They are executed individually but in parallel groups
  const chunkSize = 20
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize)
    await Promise.all(chunk.map(async (u) => {
      try {
        await prisma.material.update({
          where: { magentoSku: u.sku },
          data: u.data,
        })
        result.updated++
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        result.errors.push({ row: u.rowIndex, sku: u.sku, error: message })
      }
    }))
  }

  return result
}
