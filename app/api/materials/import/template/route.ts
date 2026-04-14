import { NextResponse } from 'next/server'

const TEMPLATE_CSV = `sku,name,entity_id,category,material,variant_type,thickness,cost,cost_width,cost_length,markup_multiplier,supplier
cts-18-mdf-kronospan-white-gloss,Kronospan White Gloss 18mm MDF,10001,Wood,MDF,Kronospan,18,42.50,2440,1220,1.45,Kronospan
cts-10-acrylic-cast-clear,Cast Clear Acrylic 10mm,10002,Plastic,Acrylic,FINSA 12Twenty,10,85.00,2050,1520,1.55,Perspex Solutions
`

export async function GET() {
  return new NextResponse(TEMPLATE_CSV, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="import-template.csv"',
    },
  })
}

