'use client'

import { useEffect, useCallback, useState } from 'react'
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
  ReferenceLine,
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
  screenshotUrl: string | null
}

interface CompetitorHistory {
  slug: string
  label: string
  points: HistoryPoint[]
  screenshot: { url: string; runAt: string } | null
}

interface ApiResponse {
  competitors: CompetitorHistory[]
}

const SLUG_COLORS: Record<string, string> = {
  // Plastic
  'simply-plastics':        '#F97316',
  'plastic-people':         '#6366F1',
  'cut-plastic-sheeting':   '#8B5CF6',
  'sheet-plastics':         '#10B981',
  'plastic-sheet-shop':     '#EF4444',
  'plastic-sheets':         '#F59E0B',
  // Wood
  'wood-sheets':            '#6366F1',
  'cnc-creations':          '#F59E0B',
  'plastic-people-mdf':     '#8B5CF6',
  'cut-plastic-sheeting-mdf': '#EF4444',
  'just-mdf':               '#10B981',
  'mdf-ply-mfc-direct':     '#F97316',
}


const CUTMY_COLOR = '#009FE3'

function slugColor(slug: string): string {
  return SLUG_COLORS[slug] ?? '#9CA3AF'
}

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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<number | null>(null)

  const { data, isLoading, isError } = useQuery<ApiResponse>({
    queryKey: ['competitor-price-history', item.id],
    queryFn: () =>
      fetch(`/api/competitor-prices/history?basketItemId=${item.id}&category=${category}`)
        .then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (lightboxUrl) setLightboxUrl(null)
      else onClose()
    }
  }, [onClose, lightboxUrl])

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
        <div className="px-6 py-4 border-b border-[#E5E5E3]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2">
              <div className="w-[3px] h-4 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: CUTMY_COLOR }} />
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
              className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>
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
              <LineChart
                data={chartData}
                margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                onClick={(state) => {
                  const date = state?.activeLabel as number | undefined
                  if (!date) return
                  setSelectedDate(prev => prev === date ? null : date)
                }}
                style={{ cursor: 'pointer' }}
              >
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
                    const idx = chartData.findIndex(d => d.date === label)
                    const prev = idx > 0 ? chartData[idx - 1] : null
                    return (
                      <div className="bg-white border border-[#E5E5E3] rounded-lg px-3 py-2 shadow-sm text-[12px]">
                        <p className="text-gray-400 mb-1.5">{format(new Date(label as number), 'dd MMM yyyy')}</p>
                        {validPayload.map(p => {
                          const key = p.dataKey as string
                          const cur = p.value as number
                          const prevVal = prev?.[key] as number | null | undefined
                          const diff = (prevVal != null && prevVal > 0) ? cur - prevVal : null
                          const pct = diff != null && prevVal ? (diff / prevVal) * 100 : null
                          const up = diff != null && diff > 0
                          return (
                            <div key={key} className="flex items-center gap-2 mb-0.5">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                              <span className="text-gray-600">{p.name}</span>
                              <span className="font-semibold text-gray-900 ml-auto pl-4">
                                {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cur)}/m²
                              </span>
                              {diff != null && Math.abs(diff) >= 0.01 && (
                                <span className={`text-[10px] font-medium ${up ? 'text-green-600' : 'text-red-500'}`}>
                                  {up ? '▲' : '▼'}{Math.abs(diff).toFixed(2)} ({Math.abs(pct!).toFixed(1)}%)
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={7}
                  wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                />
                {competitors.map((c) => (
                  <Line
                    key={c.slug}
                    type="monotone"
                    dataKey={c.slug}
                    name={c.label}
                    stroke={slugColor(c.slug)}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: slugColor(c.slug) }}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    connectNulls={true}
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
                {selectedDate != null && (
                  <ReferenceLine
                    x={selectedDate}
                    stroke="#6B7280"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}

          <p className="mt-3 text-[11px] text-gray-400 text-right">
            £/m² inc VAT · {item.widthMm} × {item.heightMm}mm · weekly scrape
          </p>

          {/* Screenshot thumbnails */}
          {competitors.some(c => c.screenshot || c.points.some(p => p.screenshotUrl)) && (() => {
            const thumbs = competitors.map(c => {
              if (selectedDate != null) {
                const point = c.points.find(p => p.date === selectedDate)
                return point?.screenshotUrl ? { slug: c.slug, label: c.label, url: point.screenshotUrl, date: selectedDate } : null
              }
              return c.screenshot ? { slug: c.slug, label: c.label, url: c.screenshot.url, date: new Date(c.screenshot.runAt).getTime() } : null
            }).filter((t): t is NonNullable<typeof t> => t !== null)

            if (thumbs.length === 0 && selectedDate != null) {
              return (
                <div className="mt-4 border-t border-[#E5E5E3] pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                      Screenshots · {format(new Date(selectedDate), 'd MMM yyyy')}
                    </p>
                    <button onClick={() => setSelectedDate(null)} className="text-[10px] text-gray-400 hover:text-gray-600">
                      Show latest
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400">No screenshots captured on this date.</p>
                </div>
              )
            }

            return (
              <div className="mt-4 border-t border-[#E5E5E3] pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    {selectedDate != null
                      ? `Screenshots · ${format(new Date(selectedDate), 'd MMM yyyy')}`
                      : 'Latest screenshots'}
                  </p>
                  {selectedDate != null && (
                    <button onClick={() => setSelectedDate(null)} className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors">
                      Show latest
                    </button>
                  )}
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {thumbs.map(t => (
                    <button
                      key={t.slug}
                      onClick={() => setLightboxUrl(t.url)}
                      className="shrink-0 rounded-lg overflow-hidden border border-[#E5E5E3] hover:border-gray-400 transition-colors"
                      style={{ width: 140 }}
                    >
                      <img src={t.url} alt={t.label} className="w-full h-20 object-cover object-top" />
                      <div className="px-2 py-1.5 bg-white border-t border-[#E5E5E3]">
                        <p className="text-[10px] font-semibold truncate" style={{ color: slugColor(t.slug) }}>
                          {t.label}
                        </p>
                        <p className="text-[9px] text-gray-400">{format(new Date(t.date), 'd MMM yyyy')}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Screenshot lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/75 p-6"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="relative w-full max-w-4xl max-h-[92vh] bg-white rounded-xl shadow-2xl overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxUrl(null)}
              className="sticky top-2 float-right mr-2 z-10 bg-white/90 hover:bg-white rounded-full p-1.5 shadow text-gray-600 hover:text-gray-900 transition-colors"
            >
              <X size={16} />
            </button>
            <img
              src={lightboxUrl}
              alt="Competitor page screenshot"
              className="w-full h-auto block"
            />
          </div>
        </div>
      )}
    </div>
  )
}
