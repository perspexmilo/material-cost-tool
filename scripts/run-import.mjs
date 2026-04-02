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

// ─── Category mapping ─────────────────────────────────────────────────────────

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

async function run() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('Usage: node scripts/run-import.mjs <path-to-csv>')
    process.exit(1)
  }

  const csvText = readFileSync(csvPath, 'utf8')
  const { rows } = parseCSV(csvText)

  let imported = 0, updated = 0, skipped = 0
  const errors = []
  const unassignedId = await upsertSupplier('Unassigned')

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const sku = row['sku']?.trim() ?? ''
    if (!sku) { skipped++; continue }

    const entityIdRaw = row['entity_id']?.trim().replace(/,/g, '') ?? ''
    const magentoEntityId = entityIdRaw ? parseInt(entityIdRaw, 10) : null
    const magentoName = row['Name']?.trim() || null
    const variantType = row['Variant_Type']?.trim() || null
    const materialAttr = row['Material']?.trim() || ''
    const category = materialAttr ? materialToCategory(materialAttr) : 'Accessories'
    const typeFinish = materialAttr || 'Other'
    const description = magentoName || sku
    const thicknessMm = parseFloat((row['Thickness']?.trim() ?? '0').replace(/mm$/i, '')) || 0
    const widthMm = parseFloat(row['Cost_Width']?.trim() ?? '0') || 0
    const heightMm = parseFloat(row['Cost_Length']?.trim() ?? '0') || 0
    const costPerSheet = parseFloat(row['Cost']?.trim() ?? '0') || 0

    try {
      const existing = await prisma.material.findUnique({ where: { magentoSku: sku } })
      if (existing) {
        await prisma.material.update({
          where: { magentoSku: sku },
          data: { costPerSheet, magentoEntityId, magentoName, variantType, description, category, typeFinish, thicknessMm, widthMm, heightMm, updateSource: 'import', lastUpdatedAt: new Date() }
        })
        updated++
      } else {
        await prisma.material.create({
          data: { description, category, typeFinish, thicknessMm, widthMm, heightMm, supplierId: unassignedId, costPerSheet, updateSource: 'import', lastUpdatedAt: new Date(), magentoSku: sku, magentoName, magentoEntityId, variantType }
        })
        imported++
      }
    } catch (err) {
      errors.push({ row: i + 2, sku, error: err.message })
    }

    if ((imported + updated + skipped) % 100 === 0) {
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
