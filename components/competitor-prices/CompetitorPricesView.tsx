'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, TrendingUp, TrendingDown, Pencil, X, Check, ExternalLink, Settings2, ChevronUp, ChevronDown, ChevronsUpDown, Eye } from 'lucide-react'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { SearchInput } from '@/components/ui/SearchInput'
import { CompetitorPriceHistoryModal } from './CompetitorPriceHistoryModal'
import { DiscountEditorModal } from './DiscountEditorModal'
import { SLUG_HOMEPAGES } from '@/lib/competitor-homepages'

interface BasketItem {
  id: string
  name: string
  thicknessMm: number
  widthMm: number
  heightMm: number
  magentoEntityId: number | null
  cutMyVariantName: string | null
  variantType: string | null
  typeFinish: string | null
}

interface PriceEntry {
  basketItemId: string
  pricePerM2: number | null
  previousPricePerM2: number | null
  rawValue: string | null
  url: string | null
  screenshotUrl: string | null
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
  magentoName: string | null
  magentoSku: string | null
  description: string
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
  if (previous < 5) return null  // suppress deltas from old error/garbage prices
  const diff = current - previous
  if (Math.abs(diff) < 0.01) return null

  const pct = (diff / previous) * 100
  const up = diff > 0
  const colour = up ? 'text-green-600' : 'text-red-500'
  const Icon = up ? TrendingUp : TrendingDown

  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${colour} mt-0.5 whitespace-nowrap`}>
      <Icon size={10} />
      {up ? '+' : ''}£{Math.abs(diff).toFixed(2)}
      <span className="opacity-70">({up ? '+' : ''}{pct.toFixed(1)}%)</span>
    </span>
  )
}

function applyDiscount(price: number | null, pct: number): number | null {
  if (price == null || pct === 0) return price
  return price * (1 - pct / 100)
}

function ScreenshotLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[92vh] bg-white rounded-xl shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="sticky top-2 float-right mr-2 z-10 bg-white/90 hover:bg-white rounded-full p-1.5 shadow text-gray-600 hover:text-gray-900 transition-colors"
        >
          <X size={16} />
        </button>
        <img
          src={url}
          alt="Competitor page screenshot"
          className="w-full h-auto block"
        />
      </div>
    </div>
  )
}

function PriceCell({
  entry,
  cutMyPrice,
  isCutMy,
  discountPct = 0,
  onScreenshot,
}: {
  entry?: PriceEntry
  cutMyPrice: number | null
  isCutMy?: boolean
  discountPct?: number
  onScreenshot?: (url: string) => void
}) {
  const rawPrice = isCutMy ? cutMyPrice : (entry?.pricePerM2 ?? null)
  const price = applyDiscount(rawPrice, discountPct)
  const previous = entry?.previousPricePerM2 ?? null
  const hasComparison = price != null && cutMyPrice != null && !isCutMy
  const cheaper = hasComparison && price < cutMyPrice
  const pricier = hasComparison && price > cutMyPrice
  const url = !isCutMy ? (entry?.url ?? null) : null
  const screenshotUrl = !isCutMy ? (entry?.screenshotUrl ?? null) : null

  return (
    <td
      className={[
        'px-4 py-3 text-right text-sm tabular-nums',
        isCutMy ? 'bg-[#2DBDAA]/10 font-semibold text-[#1a8a7a]' : 'text-gray-700',
        cheaper ? 'text-red-600' : '',
        pricier ? 'text-green-700' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="flex flex-col items-end">
        <div className="flex items-center gap-1 justify-end">
          <span className="font-mono">{fmt(price)}</span>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-gray-300 hover:text-gray-500 transition-colors shrink-0"
              title="View on competitor site"
            >
              <ExternalLink size={11} />
            </a>
          )}
          {screenshotUrl && onScreenshot && (
            <button
              onClick={e => { e.stopPropagation(); onScreenshot(screenshotUrl) }}
              className="text-gray-300 hover:text-gray-500 transition-colors shrink-0"
              title="View screenshot"
            >
              <Eye size={11} />
            </button>
          )}
        </div>
        {!isCutMy && <Delta current={rawPrice} previous={previous} />}
      </div>
    </td>
  )
}

function VariantPicker({ item, onClose }: { item: BasketItem; onClose: () => void }) {
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

  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = materials.filter(m => {
    const q = search.toLowerCase()
    return (
      (m.magentoName ?? '').toLowerCase().includes(q) ||
      (m.magentoSku ?? '').toLowerCase().includes(q) ||
      String(m.magentoEntityId).includes(q)
    )
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-900 text-sm">Map Cut My variant</p>
            <p className="text-xs text-gray-400 mt-0.5">{item.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>
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
        <div className="overflow-y-auto max-h-72">
          {isLoading && <p className="text-center py-8 text-sm text-gray-400">Loading…</p>}
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
                className={['w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center justify-between gap-3', isSelected ? 'bg-[#2DBDAA]/5' : ''].join(' ')}
              >
                <div className="min-w-0">
                  <span className="text-sm text-gray-800 block truncate">{m.magentoName ?? m.description ?? m.magentoSku ?? `ID ${m.magentoEntityId}`}</span>
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
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
          {filtered.length} of {materials.length} variants
          {mutation.isPending && <span className="ml-2 text-[#2DBDAA]">Saving…</span>}
        </div>
      </div>
    </div>
  )
}

interface Props {
  category: 'plastic' | 'wood'
}

export function CompetitorPricesView({ category }: Props) {
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ['competitor-prices', category],
    queryFn: () => fetch(`/api/competitor-prices?category=${category}&t=${Date.now()}`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  })

  const [discountMap, setDiscountMap] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem('discount-map') ?? '{}') } catch { return {} }
  })
  const [notesMap, setNotesMap] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem('discount-notes') ?? '{}') } catch { return {} }
  })
  const [discountsOn, setDiscountsOn] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('discounts-on') === 'true'
  )
  const [showDiscountEditor, setShowDiscountEditor] = useState(false)
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const columnPickerRef = useRef<HTMLDivElement>(null)

  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)

  const [hiddenSlugs, setHiddenSlugs] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const s = localStorage.getItem('hidden-competitor-slugs')
      return s ? new Set(JSON.parse(s)) : new Set()
    } catch { return new Set() }
  })
  const [hideAvg, setHideAvg] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('hide-avg-col') === 'true'
  )

  // Load persisted discounts from DB on mount
  const { data: dbDiscounts } = useQuery<{ slug: string; label: string; discountPct: number }[]>({
    queryKey: ['discount-settings'],
    queryFn: () => fetch('/api/discount-settings').then(r => r.json()),
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!dbDiscounts?.length) return
    const map: Record<string, number> = {}
    for (const d of dbDiscounts) map[d.slug] = Number(d.discountPct)
    setDiscountMap(map)
    localStorage.setItem('discount-map', JSON.stringify(map))
  }, [dbDiscounts])

  const saveDiscountsMutation = useMutation({
    mutationFn: (payload: { slug: string; label: string; discountPct: number }[]) =>
      fetch('/api/discount-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discount-settings'] }),
  })

  function toggleDiscounts() {
    const next = !discountsOn
    setDiscountsOn(next)
    localStorage.setItem('discounts-on', String(next))
  }

  function handleSaveDiscounts(map: Record<string, number>, notes: Record<string, string>) {
    setDiscountMap(map)
    setNotesMap(notes)
    localStorage.setItem('discount-map', JSON.stringify(map))
    localStorage.setItem('discount-notes', JSON.stringify(notes))

    const labelMap: Record<string, string> = { 'cut-my': 'Cut My' }
    if (data) for (const c of data.competitors) labelMap[c.slug] = c.label
    const payload = Object.entries(map).map(([slug, discountPct]) => ({
      slug,
      label: labelMap[slug] ?? slug,
      discountPct,
    }))
    saveDiscountsMutation.mutate(payload)
  }

  useEffect(() => {
    if (!showColumnPicker) return
    function handleClick(e: MouseEvent) {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node))
        setShowColumnPicker(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showColumnPicker])

  function handleSort(col: string) {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc')
      else setSortCol(null)
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const toggleHiddenSlug = useCallback((slug: string) => {
    setHiddenSlugs(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug); else next.add(slug)
      localStorage.setItem('hidden-competitor-slugs', JSON.stringify([...next]))
      return next
    })
  }, [])

  function toggleHideAvg() {
    setHideAvg(v => {
      localStorage.setItem('hide-avg-col', String(!v))
      return !v
    })
  }

  const [editingItem, setEditingItem] = useState<BasketItem | null>(null)
  const [historyItem, setHistoryItem] = useState<BasketItem | null>(null)
  const [search, setSearch] = useState('')
  const [filterMaterial, setFilterMaterial] = useState('')
  const [filterType, setFilterType] = useState('')

  const materialOptions = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(
      data.basketItems.map(i => i.typeFinish).filter((t): t is string => t !== null)
    )).sort()
  }, [data])

  const typeOptions = useMemo(() => {
    if (!data) return []
    const items = filterMaterial
      ? data.basketItems.filter(i => i.typeFinish === filterMaterial)
      : data.basketItems
    return Array.from(new Set(
      items.map(i => i.variantType).filter((t): t is string => t !== null)
    )).sort()
  }, [data, filterMaterial])

  const visibleItems = useMemo(() => {
    if (!data) return []
    const q = search.toLowerCase()
    return data.basketItems.filter(i => {
      if (filterMaterial && i.typeFinish !== filterMaterial) return false
      if (filterType && i.variantType !== filterType) return false
      if (q && !i.name.toLowerCase().includes(q) && !(i.cutMyVariantName ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [data, filterMaterial, filterType, search])

  const visibleCompetitors = useMemo(
    () => data ? data.competitors.filter(c => !hiddenSlugs.has(c.slug)) : [],
    [data, hiddenSlugs]
  )

  const sortedItems = useMemo(() => {
    if (!sortCol || !data) return visibleItems
    return [...visibleItems].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortCol === 'name') return dir * a.name.localeCompare(b.name)

      let aVal: number | null
      let bVal: number | null

      if (sortCol === 'cut-my') {
        const d = discountsOn ? (discountMap['cut-my'] ?? 0) : 0
        aVal = applyDiscount(data.cutMyPrices[a.id] ?? null, d)
        bVal = applyDiscount(data.cutMyPrices[b.id] ?? null, d)
      } else if (sortCol === 'avg') {
        const avg = (item: BasketItem) => {
          const prices = data.competitors
            .map(c => {
              const raw = c.prices.find(p => p.basketItemId === item.id)?.pricePerM2 ?? null
              return discountsOn ? applyDiscount(raw, discountMap[c.slug] ?? 0) : raw
            })
            .filter((p): p is number => p !== null)
          return prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null
        }
        aVal = avg(a); bVal = avg(b)
      } else {
        const comp = data.competitors.find(c => c.slug === sortCol)
        if (!comp) return 0
        const raw = (item: BasketItem) => comp.prices.find(p => p.basketItemId === item.id)?.pricePerM2 ?? null
        aVal = discountsOn ? applyDiscount(raw(a), discountMap[sortCol] ?? 0) : raw(a)
        bVal = discountsOn ? applyDiscount(raw(b), discountMap[sortCol] ?? 0) : raw(b)
      }

      if (aVal === null && bVal === null) return 0
      if (aVal === null) return 1
      if (bVal === null) return -1
      return dir * (aVal - bVal)
    })
  }, [visibleItems, sortCol, sortDir, data, discountsOn, discountMap])

  const hasActiveFilters = !!(filterMaterial || filterType || search)

  function clearFilters() {
    setFilterMaterial('')
    setFilterType('')
    setSearch('')
  }

  return (
    <div className="flex flex-col">
      {/* Sticky filter bar */}
      <div className="sticky top-0 z-30 bg-[#F7F7F5] pt-4">
        <div className="flex items-center justify-between pb-3">
          <p className="text-[12px] text-gray-400">
            £/m² inc VAT · 1000 × 1000mm · delta vs previous week
            {discountsOn && <span className="ml-1.5 text-[#009FE3] font-medium">· discounts applied</span>}
          </p>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#E5E5E3] text-[12px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors bg-white"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="h-11 flex items-center gap-2">
          <SearchInput
            placeholder="Search variants…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            containerClassName="w-56"
          />
          {materialOptions.length > 0 && (
            <select
              value={filterMaterial}
              onChange={(e) => { setFilterMaterial(e.target.value); setFilterType('') }}
              className="text-[12px] border border-[#E5E5E3] rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]"
            >
              <option value="">All materials</option>
              {materialOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}

          {typeOptions.length > 0 && (
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="text-[12px] border border-[#E5E5E3] rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]"
            >
              <option value="">All types</option>
              {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={12} /> Clear filters
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleDiscounts}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors',
                discountsOn
                  ? 'bg-[#009FE3] border-[#009FE3] text-white'
                  : 'bg-white border-[#E5E5E3] text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              % Discounts {discountsOn ? 'on' : 'off'}
            </button>
            <button
              onClick={() => setShowDiscountEditor(true)}
              className="p-1.5 rounded-lg border border-[#E5E5E3] text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors bg-white"
              title="Edit discount percentages"
            >
              <Settings2 size={13} />
            </button>

            {/* Column visibility picker */}
            <div className="relative" ref={columnPickerRef}>
              <button
                onClick={() => setShowColumnPicker(v => !v)}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors',
                  showColumnPicker || hiddenSlugs.size > 0 || hideAvg
                    ? 'bg-gray-800 border-gray-800 text-white'
                    : 'bg-white border-[#E5E5E3] text-gray-600 hover:bg-gray-50',
                ].join(' ')}
                title="Show / hide columns"
              >
                <Eye size={12} />
                Columns{hiddenSlugs.size + (hideAvg ? 1 : 0) > 0 ? ` (${hiddenSlugs.size + (hideAvg ? 1 : 0)} hidden)` : ''}
              </button>

              {showColumnPicker && data && (
                <div className="absolute right-0 top-full mt-1.5 z-40 bg-white border border-[#E5E5E3] rounded-xl shadow-lg p-3 min-w-[180px]">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">Columns</p>

                  {/* Avg toggle */}
                  <label className="flex items-center gap-2.5 px-1 py-1 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hideAvg}
                      onChange={toggleHideAvg}
                      className="accent-[#2DBDAA] w-3.5 h-3.5"
                    />
                    <span className="text-[12px] text-gray-700">Avg</span>
                  </label>

                  <div className="my-1.5 border-t border-gray-100" />

                  {data.competitors.map(c => (
                    <label key={c.slug} className="flex items-center gap-2.5 px-1 py-1 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!hiddenSlugs.has(c.slug)}
                        onChange={() => toggleHiddenSlug(c.slug)}
                        className="accent-[#2DBDAA] w-3.5 h-3.5"
                      />
                      <span className="text-[12px] text-gray-700">{c.label}</span>
                    </label>
                  ))}

                  {(hiddenSlugs.size > 0 || hideAvg) && (
                    <>
                      <div className="my-1.5 border-t border-gray-100" />
                      <button
                        onClick={() => {
                          setHiddenSlugs(new Set())
                          setHideAvg(false)
                          localStorage.removeItem('hidden-competitor-slugs')
                          localStorage.removeItem('hide-avg-col')
                        }}
                        className="w-full text-left px-1 py-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Show all
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isLoading && <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading…</div>}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700 text-sm">
          Failed to load competitor prices.
        </div>
      )}

      {data && (
        <div className="relative z-0 rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead className="sticky top-[102px] z-20">
              <tr className="bg-gray-50" style={{ boxShadow: 'inset 0 -1px 0 #E5E5E3' }}>
                <th
                  className="px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort('name')}
                >
                  <span className="inline-flex items-center gap-1">
                    Variant
                    {sortCol === 'name' ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronsUpDown size={11} className="text-gray-300" />}
                  </span>
                </th>
                <th
                  className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider text-[#1a8a7a] bg-[#2DBDAA]/10 cursor-pointer select-none hover:bg-[#2DBDAA]/20 transition-colors"
                  onClick={() => handleSort('cut-my')}
                >
                  <span className="inline-flex items-center justify-end gap-1 w-full">
                    {sortCol === 'cut-my' ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronsUpDown size={11} className="opacity-40" />}
                    Cut My
                  </span>
                </th>
                {!hideAvg && (
                  <th
                    className="px-4 py-3 text-right font-semibold text-gray-500 text-xs uppercase tracking-wider bg-gray-50/80 cursor-pointer select-none hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort('avg')}
                  >
                    <span className="inline-flex items-center justify-end gap-1 w-full">
                      {sortCol === 'avg' ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronsUpDown size={11} className="text-gray-300" />}
                      Avg
                    </span>
                  </th>
                )}
                {visibleCompetitors.map(c => (
                  <th key={c.slug} className="px-4 py-3 text-right font-semibold text-gray-600 text-xs uppercase tracking-wider w-[140px] min-w-[140px] bg-gray-50 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort(c.slug)}>
                    <div className="flex items-center justify-end gap-1">
                      {sortCol === c.slug ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronsUpDown size={11} className="text-gray-300" />}
                      <span>{c.label}</span>
                      {SLUG_HOMEPAGES[c.slug] && (
                        <a
                          href={SLUG_HOMEPAGES[c.slug]}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-gray-300 hover:text-gray-500 transition-colors"
                          title={`Visit ${c.label}`}
                        >
                          <ExternalLink size={10} />
                        </a>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); toggleHiddenSlug(c.slug) }}
                        className="text-gray-200 hover:text-gray-500 transition-colors"
                        title={`Hide ${c.label}`}
                      >
                        <X size={10} />
                      </button>
                    </div>
                    <div className="text-[10px] font-normal text-gray-400 normal-case mt-0.5">{fmtDate(c.runAt)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedItems.map(item => {
                const cutMyPrice = data.cutMyPrices[item.id] ?? null
                const effectiveCutMyPrice = discountsOn
                  ? applyDiscount(cutMyPrice, discountMap['cut-my'] ?? 0)
                  : cutMyPrice
                const competitorPrices = data.competitors
                  .map(c => {
                    const raw = c.prices.find(p => p.basketItemId === item.id)?.pricePerM2 ?? null
                    return discountsOn ? applyDiscount(raw, discountMap[c.slug] ?? 0) : raw
                  })
                  .filter((p): p is number => p !== null)
                const avgPrice = competitorPrices.length
                  ? competitorPrices.reduce((a, b) => a + b, 0) / competitorPrices.length
                  : null
                return (
                  <tr
                    key={item.id}
                    className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                    onClick={() => setHistoryItem(item)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium text-gray-900">{item.name}</div>
                          <div className="text-xs text-gray-400">{item.widthMm} × {item.heightMm}mm</div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); setEditingItem(item) }}
                          title="Map to Cut My variant"
                          className="ml-1 p-1 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                      {item.cutMyVariantName && (
                        <div className="text-[10px] text-[#1a8a7a] mt-0.5 truncate max-w-[180px]">→ {item.cutMyVariantName}</div>
                      )}
                      {!item.magentoEntityId && (
                        <div className="text-[10px] text-amber-500 mt-0.5">No Cut My variant mapped</div>
                      )}
                    </td>
                    <PriceCell cutMyPrice={cutMyPrice} isCutMy discountPct={discountsOn ? (discountMap['cut-my'] ?? 0) : 0} />
                    {!hideAvg && (
                      <td className="px-4 py-3 text-right text-sm font-mono tabular-nums text-gray-500 bg-gray-50/40">
                        {fmt(avgPrice)}
                      </td>
                    )}
                    {visibleCompetitors.map(c => {
                      const entry = c.prices.find(x => x.basketItemId === item.id)
                      return (
                        <PriceCell
                          key={c.slug}
                          entry={entry}
                          cutMyPrice={effectiveCutMyPrice}
                          discountPct={discountsOn ? (discountMap[c.slug] ?? 0) : 0}
                          onScreenshot={setScreenshotUrl}
                        />
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sortedItems.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              {hasActiveFilters
                ? 'No items matched the current filters.'
                : 'No basket items found. Run the seed script in competitor-scraper to add items.'}
            </div>
          )}
        </div>
      )}

      {data && data.basketItems.length > 0 && (
        <p className="mt-4 text-xs text-gray-400">
          Competitor price in <span className="text-red-500 font-medium">red</span> = cheaper than Cut My.{' '}
          <span className="text-green-600 font-medium">Green</span> = more expensive.
          Delta: <span className="text-green-600 font-medium">▲</span> competitor raised price,{' '}
          <span className="text-red-500 font-medium">▼</span> competitor lowered price.
          Click <Pencil size={10} className="inline" /> to map a basket item to a Cut My variant.{' '}
          Click any row to view competitor price history over time.
        </p>
      )}

      {editingItem && <VariantPicker item={editingItem} onClose={() => setEditingItem(null)} />}
      {showDiscountEditor && (
        <DiscountEditorModal
          category={category}
          discountMap={discountMap}
          notesMap={notesMap}
          onSave={handleSaveDiscounts}
          onClose={() => setShowDiscountEditor(false)}
        />
      )}
      {historyItem && (
        <CompetitorPriceHistoryModal
          item={historyItem}
          category={category}
          cutMyPrice={data ? (data.cutMyPrices[historyItem.id] ?? null) : null}
          onClose={() => setHistoryItem(null)}
        />
      )}
      {screenshotUrl && (
        <ScreenshotLightbox url={screenshotUrl} onClose={() => setScreenshotUrl(null)} />
      )}
    </div>
  )
}
