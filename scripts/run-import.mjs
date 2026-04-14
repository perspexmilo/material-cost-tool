// Standalone import script — runs outside Next.js, reads .env directly
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Load .env files manually
function loadEnv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // file not found — skip
  }
}

loadEnv(resolve(root, '.env.local'))
loadEnv(resolve(root, '.env'))

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function splitCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim()); current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  const headers = splitCSVLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i])
    const row = {}
    headers.forEach((h, j) => { row[h] = values[j] ?? '' })
    rows.push(row)
  }
  return { headers, rows }
}

// Helper: read first non-empty value across candidate column names
function col(row, ...keys) {
  for (const k of keys) {
    const v = row[k]?.trim()
    if (v) return v
  }
  return ''
}

// ─── Category fallback mapping ────────────────────────────────────────────────
// Used when `category` column is absent — derives from the `material` value.

const MATERIAL_CATEGORY_MAP = {
  mdf: 'Wood', plywood: 'Wood', osb: 'Wood', phenolic: 'Wood',
  hardboard: 'Wood', chipboard: 'Wood', mfc: 'Wood', timber: 'Wood',
  acrylic: 'Plastic', polycarbonate: 'Plastic', acm: 'Plastic',
  dibond: 'Plastic', 'aluminium composite': 'Plastic', foam: 'Plastic', pvc: 'Plastic',
}

function materialToCategory(material) {
  return MATERIAL_CATEGORY_MAP[material.toLowerCase()] ?? 'Accessories'
}

// ─── Supplier upsert ──────────────────────────────────────────────────────────

async function upsertSupplier(name) {
  const s = await prisma.supplier.upsert({
    where: { name }, update: {}, create: { name }
  })
  return s.id
}

// ─── Import ───────────────────────────────────────────────────────────────────
//
// Expected CSV columns:
//   entity_id, name, sku, category, material, variant_type,
//   thickness, cost, cost_length, cost_width, supplier
//
// Old Metabase column names are accepted as fallbacks for backward compatibility.

async function run() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('Usage: node scripts/run-import.mjs <path-to-csv>')
    console.error('')
    console.error('Expected columns:')
    console.error('  entity_id, name, sku, category, material, variant_type,')
    console.error('  thickness, cost, cost_length, cost_width, supplier')
    process.exit(1)
  }

  const csvText = readFileSync(csvPath, 'utf8')
  const { rows } = parseCSV(csvText)

  // Cache supplier IDs to avoid repeated DB round-trips
  const supplierCache = new Map()
  async function getOrCreateSupplier(name) {
    if (supplierCache.has(name)) return supplierCache.get(name)
    const id = await upsertSupplier(name)
    supplierCache.set(name, id)
    return id
  }

  let imported = 0, updated = 0, skipped = 0
  const errors = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const sku = col(row, 'sku', 'magento_sku')
    if (!sku) { skipped++; continue }

    const entityIdRaw = col(row, 'entity_id').replace(/,/g, '')
    const magentoEntityId = entityIdRaw ? parseInt(entityIdRaw, 10) : null

    const variantName = col(row, 'name', 'Variant Name', 'Name')
    const magentoName = variantName || null
    const description = variantName || sku

    // material = specific type (acrylic, mdf …) — stored as typeFinish
    const material = col(row, 'material', 'Type', 'Material')

    // category = Wood / Plastic — read directly or derive from material
    const categoryRaw = col(row, 'category')
    const category = categoryRaw || (material ? materialToCategory(material) : 'Accessories')

    const typeFinish = material || 'Other'
    const variantType = col(row, 'variant_type', 'Variant_Type') || null

    const thicknessMm = parseFloat(col(row, 'thickness', 'Thickness').replace(/mm$/i, '')) || 0
    const widthMm  = parseFloat(col(row, 'cost_width',  'Cost_Width'))  || 0
    const heightMm = parseFloat(col(row, 'cost_length', 'Cost_Length')) || 0
    const costPerSheet = parseFloat(col(row, 'cost', 'Cost')) || 0

    const supplierName = col(row, 'supplier') || 'Unassigned'

    try {
      const supplierId = await getOrCreateSupplier(supplierName)
      const data = {
        description, category, typeFinish, thicknessMm, widthMm, heightMm,
        supplierId, costPerSheet, updateSource: 'import', lastUpdatedAt: new Date(),
        magentoName, magentoEntityId, variantType,
      }

      const existing = await prisma.material.findUnique({ where: { magentoSku: sku } })
      if (existing) {
        await prisma.material.update({ where: { magentoSku: sku }, data })
        updated++
      } else {
        await prisma.material.create({ data: { ...data, magentoSku: sku } })
        imported++
      }
    } catch (err) {
      errors.push({ row: i + 2, sku, error: err.message })
    }

    const done = imported + updated + skipped
    if (done % 100 === 0) {
      process.stdout.write(`\r  Progress: ${imported + updated} done, ${errors.length} errors...`)
    }
  }

  console.log(`\n\n✓ Import complete`)
  console.log(`  Imported: ${imported}`)
  console.log(`  Updated:  ${updated}`)
  console.log(`  Skipped:  ${skipped}`)
  console.log(`  Errors:   ${errors.length}`)
  if (errors.length > 0) {
    console.log('\nErrors:')
    errors.slice(0, 20).forEach(e => console.log(`  Row ${e.row} [${e.sku}]: ${e.error}`))
    if (errors.length > 20) console.log(`  ... and ${errors.length - 20} more`)
  }

  await prisma.$disconnect()
}

run().catch(err => { console.error(err); prisma.$disconnect(); process.exit(1) })
