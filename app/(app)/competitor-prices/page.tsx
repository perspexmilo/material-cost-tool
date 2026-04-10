'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, TrendingUp, TrendingDown, Pencil, X, Check } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

interface BasketItem {
  id: string
  name: string
  thicknessMm: number
  widthMm: number
  heightMm: number
  magentoEntityId: number | null
  cutMyVariantName: string | null
}

interface PriceEntry {
  basketItemId: string
  pricePerM2: number | null
  previousPricePerM2: number | null
  rawValue: string | null
}

interface CompetitorData {
  slug: string
  label: string
  runAt: string | null
  previousRunAt: string | null
  prices: PriceEntry[]
}

interface ApiResponse {
  basketItems: BasketItem[]
  competitors: CompetitorData[]
  cutMyPrices: Record<string, number | null>
}

interface MaterialOption {
  magentoEntityId: number
  magentoName: string
  magentoSku: string
}

function fmt(value: number | null | undefined): string {
  if (value == null) return '—'
  return `£${value.toFixed(2)}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Delta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return null
  const diff = current - previous
  if (Math.abs(diff) < 0.01) return null

  const pct = (diff / previous) * 100
  const up = diff > 0
  const colour = up ? 'text-green-600' : 'text-red-500'
  const Icon = up ? TrendingUp : TrendingDown

  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${colour} ml-1.5`}>
      <Icon size={10} />
      {up ? '+' : ''}£{Math.abs(diff).toFixed(2)}
      <span className="opacity-70">({up ? '+' : ''}{pct.toFixed(1)}%)</span>
    </span>
  )
}

function PriceCell({
  entry,
  cutMyPrice,
  isCutMy,
}: {
  entry?: PriceEntry
  cutMyPrice: number | null
  isCutMy?: boolean
}) {
  const price = isCutMy ? cutMyPrice : (entry?.pricePerM2 ?? null)
  const previous = entry?.previousPricePerM2 ?? null
  const hasComparison = price != null && cutMyPrice != null && !isCutMy
  const cheaper = hasComparison && price < cutMyPrice
  const pricier = hasComparison && price > cutMyPrice

  return (
    <td
      className={[
        'px-4 py-3 text-right text-sm tabular-nums',
        isCutMy ? 'bg-[#2DBDAA]/10 font-semibold text-[#1a8a7a]' : 'text-gray-700',
        cheaper ? 'text-red-600' : '',
        pricier ? 'text-green-700' : '',
      ].filter(Boolean).join(' ')}
    >
      <span className="font-mono">{fmt(price)}</span>
      {!isCutMy && <Delta current={price} previous={previous} />}
    </td>
  )
}

// Searchable material picker modal
function VariantPicker({
  item,
  onClose,
}: {
  item: BasketItem
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: materials = [], isLoading } = useQuery<MaterialOption[]>({
    queryKey: ['competitor-materials'],
    queryFn: () => fetch('/api/competitor-prices/materials').then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const mutation = useMutation({
    mutationFn: (entityId: number | null) =>
      fetch(`/api/competitor-prices/basket-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magentoEntityId: entityId }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitor-prices'] })
      onClose()
    },
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = materials.filter(m => {
    const q = search.toLowerCase()
    return (
      m.magentoName.toLowerCase().includes(q) ||
      m.magentoSku.toLowerCase().includes(q) ||
      String(m.magentoEntityId).includes(q)
    )
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-900 text-sm">Map Cut My variant</p>
            <p className="text-xs text-gray-400 mt-0.5">{item.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-gray-100">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, SKU, or entity ID…"
            className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2DBDAA]/40 focus:border-[#2DBDAA]"
          />
        </div>

        {/* List */}
        <div className="overflow-y-auto max-h-72">
          {isLoading && (
            <p className="text-center py-8 text-sm text-gray-400">Loading…</p>
          )}

          {/* Clear mapping option */}
          {item.magentoEntityId && (
            <button
              onClick={() => mutation.mutate(null)}
              className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 border-b border-gray-50 transition-colors"
            >
              Remove mapping
            </button>
          )}

          {filtered.map(m => {
            const isSelected = m.magentoEntityId === item.magentoEntityId
            return (
              <button
                key={m.magentoEntityId}
                onClick={() => mutation.mutate(m.magentoEntityId)}
                className={[
                  'w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center justify-between gap-3',
                  isSelected ? 'bg-[#2DBDAA]/5' : '',
                ].join(' ')}
              >
                <div className="min-w-0">
                  <span className="text-sm text-gray-800 block truncate">{m.magentoName}</span>
                  <span className="text-xs text-gray-400">{m.magentoSku} · ID {m.magentoEntityId}</span>
                </div>
                {isSelected && <Check size={14} className="text-[#2DBDAA] shrink-0" />}
              </button>
            )
          })}

          {!isLoading && filtered.length === 0 && (
            <p className="text-center py-8 text-sm text-gray-400">No matches</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
          {filtered.length} of {materials.length} variants
          {mutation.isPending && <span className="ml-2 text-[#2DBDAA]">Saving…</span>}
        </div>
      </div>
    </div>
  )
}

export default function CompetitorPricesPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ['competitor-prices'],
    queryFn: () => fetch('/api/competitor-prices').then(r => r.json()),
  })

  const [editingItem, setEditingItem] = useState<BasketItem | null>(null)

  return (
    <div className="p-8 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Competitor Prices</h1>
          <p className="text-sm text-gray-500 mt-1">
            £/m² inc VAT · 1000 × 1000mm · delta vs previous run
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading…</div>
      )}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700 text-sm">
          Failed to load competitor prices.
        </div>
      )}

      {data && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wider">
                  Variant
                </th>
                <th className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider text-[#1a8a7a] bg-[#2DBDAA]/10">
                  Cut My
                </th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500 text-xs uppercase tracking-wider bg-gray-50/80">
                  Avg
                </th>
                {data.competitors.map(c => (
                  <th key={c.slug} className="px-4 py-3 text-right font-semibold text-gray-600 text-xs uppercase tracking-wider">
                    <div>{c.label}</div>
                    <div className="text-[10px] font-normal text-gray-400 normal-case mt-0.5">
                      {fmtDate(c.runAt)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.basketItems.map(item => {
                const cutMyPrice = data.cutMyPrices[item.id] ?? null
                const competitorPrices = data.competitors
                  .map(c => c.prices.find(p => p.basketItemId === item.id)?.pricePerM2 ?? null)
                  .filter((p): p is number => p !== null)
                const avgPrice = competitorPrices.length
                  ? competitorPrices.reduce((a, b) => a + b, 0) / competitorPrices.length
                  : null
                return (
                  <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium text-gray-900">{item.name}</div>
                          <div className="text-xs text-gray-400">
                            {item.widthMm} × {item.heightMm}mm
                          </div>
                        </div>
                        <button
                          onClick={() => setEditingItem(item)}
                          title="Map to Cut My variant"
                          className="ml-1 p-1 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                      {item.cutMyVariantName && (
                        <div className="text-[10px] text-[#1a8a7a] mt-0.5 truncate max-w-[180px]">
                          → {item.cutMyVariantName}
                        </div>
                      )}
                      {!item.magentoEntityId && (
                        <div className="text-[10px] text-amber-500 mt-0.5">
                          No Cut My variant mapped
                        </div>
                      )}
                    </td>
                    <PriceCell cutMyPrice={cutMyPrice} isCutMy />
                    <td className="px-4 py-3 text-right text-sm font-mono tabular-nums text-gray-500 bg-gray-50/40">
                      {fmt(avgPrice)}
                    </td>
                    {data.competitors.map(c => {
                      const entry = c.prices.find(x => x.basketItemId === item.id)
                      return (
                        <PriceCell key={c.slug} entry={entry} cutMyPrice={cutMyPrice} />
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {data.basketItems.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              No basket items found. Run the seed script in competitor-scraper to add items.
            </div>
          )}
        </div>
      )}

      {data && data.basketItems.length > 0 && (
        <p className="mt-4 text-xs text-gray-400">
          Competitor price in{' '}
          <span className="text-red-500 font-medium">red</span> = cheaper than Cut My.{' '}
          <span className="text-green-600 font-medium">Green</span> = more expensive.
          Delta: <span className="text-green-600 font-medium">▲</span> competitor raised price,{' '}
          <span className="text-red-500 font-medium">▼</span> competitor lowered price.
          Click <Pencil size={10} className="inline" /> to map a basket item to a Cut My variant.
        </p>
      )}

      {editingItem && (
        <VariantPicker item={editingItem} onClose={() => setEditingItem(null)} />
      )}
    </div>
  )
}
