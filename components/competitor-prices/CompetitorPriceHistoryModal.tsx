'use client'

import { useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { format } from 'date-fns'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'

interface BasketItem {
  id: string
  name: string
  widthMm: number
  heightMm: number
}

interface HistoryPoint {
  date: number
  pricePerM2: number
}

interface CompetitorHistory {
  slug: string
  label: string
  points: HistoryPoint[]
}

interface ApiResponse {
  competitors: CompetitorHistory[]
}

const LINE_COLORS = [
  '#6366F1',
  '#F59E0B',
  '#EF4444',
  '#10B981',
  '#8B5CF6',
  '#F97316',
  '#06B6D4',
]

const CUTMY_COLOR = '#009FE3'

function buildChartData(competitors: CompetitorHistory[], cutMyPrice: number | null) {
  const allDates = Array.from(
    new Set(competitors.flatMap(c => c.points.map(p => p.date)))
  ).sort((a, b) => a - b)

  return allDates.map(date => {
    const point: Record<string, number | null | undefined> & { date: number } = { date }
    for (const c of competitors) {
      const match = c.points.find(p => p.date === date)
      point[c.slug] = match?.pricePerM2 ?? null
    }
    // Flat line at the current Cut My price across all competitor dates
    if (cutMyPrice != null) point['__cutmy'] = cutMyPrice
    return point
  })
}

interface Props {
  item: BasketItem
  category: 'plastic' | 'wood'
  cutMyPrice: number | null
  onClose: () => void
}

export function CompetitorPriceHistoryModal({ item, category, cutMyPrice, onClose }: Props) {
  const { data, isLoading, isError } = useQuery<ApiResponse>({
    queryKey: ['competitor-price-history', item.id],
    queryFn: () =>
      fetch(`/api/competitor-prices/history?basketItemId=${item.id}&category=${category}`)
        .then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const competitors = data?.competitors ?? []
  const chartData = buildChartData(competitors, cutMyPrice)

  const allPrices = [
    ...competitors.flatMap(c => c.points.map(p => p.pricePerM2)),
    ...(cutMyPrice != null ? [cutMyPrice] : []),
  ]
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 100
  const pad = (maxPrice - minPrice) * 0.15 || maxPrice * 0.1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E3]">
          <div className="flex items-center gap-2">
            <div className="w-[3px] h-4 rounded-full" style={{ backgroundColor: CUTMY_COLOR }} />
            <div>
              <p className="text-[12px] font-semibold text-gray-500 uppercase tracking-widest">
                Competitor Price History
              </p>
              <p className="text-sm font-semibold text-gray-900 mt-0.5">
                {item.name}{' '}
                <span className="text-gray-400 font-normal text-xs">
                  {item.widthMm} × {item.heightMm}mm
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5" style={{ backgroundColor: '#FAFAF9' }}>
          {isLoading && (
            <div className="flex items-center gap-2 py-12 justify-center">
              <svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-gray-400">Loading history…</span>
            </div>
          )}

          {isError && (
            <p className="text-sm text-red-500 py-8 text-center">Failed to load price history.</p>
          )}

          {!isLoading && !isError && competitors.length === 0 && (
            <p className="text-sm text-gray-400 py-8 text-center">No price history recorded yet.</p>
          )}

          {competitors.length > 0 && (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#F0F0EE" />
                <XAxis
                  dataKey="date"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fontSize: 10, fill: '#9CA3AF', fontFamily: 'inherit', textRendering: 'geometricPrecision' }}
                  tickFormatter={v => format(new Date(v), 'd MMM yy')}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                />
                <YAxis
                  domain={[Math.max(0, minPrice - pad), maxPrice + pad]}
                  tickFormatter={v =>
                    new Intl.NumberFormat('en-GB', {
                      style: 'currency',
                      currency: 'GBP',
                      maximumFractionDigits: 0,
                    }).format(v)
                  }
                  tick={{ fontSize: 10, fill: '#9CA3AF', fontFamily: 'inherit' }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const validPayload = payload.filter(p => p.value != null)
                    if (!validPayload.length) return null
                    return (
                      <div className="bg-white border border-[#E5E5E3] rounded-lg px-3 py-2 shadow-sm text-[12px]">
                        <p className="text-gray-400 mb-1.5">{format(new Date(label as number), 'dd MMM yyyy')}</p>
                        {validPayload.map(p => (
                          <div key={p.dataKey as string} className="flex items-center gap-2 mb-0.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: p.color }}
                            />
                            <span className="text-gray-600">{p.name}</span>
                            <span className="font-semibold text-gray-900 ml-auto pl-4">
                              {new Intl.NumberFormat('en-GB', {
                                style: 'currency',
                                currency: 'GBP',
                              }).format(p.value as number)}/m²
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={7}
                  wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                />
                {competitors.map((c, i) => (
                  <Line
                    key={c.slug}
                    type="monotone"
                    dataKey={c.slug}
                    name={c.label}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: LINE_COLORS[i % LINE_COLORS.length] }}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    connectNulls={false}
                  />
                ))}
                {cutMyPrice != null && (
                  <Line
                    type="monotone"
                    dataKey="__cutmy"
                    name="Cut My"
                    stroke={CUTMY_COLOR}
                    strokeWidth={2.5}
                    strokeDasharray="5 3"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: CUTMY_COLOR }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}

          <p className="mt-3 text-[11px] text-gray-400 text-right">
            £/m² inc VAT · {item.widthMm} × {item.heightMm}mm · weekly scrape
          </p>
        </div>
      </div>
    </div>
  )
}
