'use client'

import { X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'

interface DiscountSetting {
  slug: string
  label: string
  discountPct: number
}

interface Props {
  category: 'plastic' | 'wood'
  onClose: () => void
}

const PLASTIC_SLUGS = ['cut-my', 'simply-plastics', 'plastic-people', 'cut-plastic-sheeting', 'sheet-plastics', 'plastic-sheet-shop', 'plastic-sheets']
const WOOD_SLUGS    = ['cut-my', 'wood-sheets', 'cnc-creations', 'plastic-people-mdf', 'cut-plastic-sheeting-mdf', 'just-mdf', 'mdf-ply-mfc-direct']

const SLUG_LABELS: Record<string, string> = {
  'cut-my':                   'Cut My',
  'simply-plastics':          'Simply Plastics',
  'plastic-people':           'Plastic People',
  'cut-plastic-sheeting':     'Cut Plastic Sheeting',
  'sheet-plastics':           'Sheet Plastics',
  'plastic-sheet-shop':       'Plastic Sheet Shop',
  'plastic-sheets':           'Plastic Sheets',
  'wood-sheets':              'Wood Sheets',
  'cnc-creations':            'CNC Creations',
  'plastic-people-mdf':       'Plastic People (MDF)',
  'cut-plastic-sheeting-mdf': 'Cut Plastic Sheeting (MDF)',
  'just-mdf':                 'Just MDF',
  'mdf-ply-mfc-direct':       'MDF Ply MFC Direct',
}

export function DiscountEditorModal({ category, onClose }: Props) {
  const queryClient = useQueryClient()

  const { data: settings = [], isLoading } = useQuery<DiscountSetting[]>({
    queryKey: ['discount-settings'],
    queryFn: () => fetch('/api/discount-settings').then(r => r.json()),
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  const slugs = category === 'wood' ? WOOD_SLUGS : PLASTIC_SLUGS
  const relevant: DiscountSetting[] = slugs.map(slug => {
    const found = settings.find(s => s.slug === slug)
    return found ?? { slug, label: SLUG_LABELS[slug] ?? slug, discountPct: 0 }
  })

  const [localValues, setLocalValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const initialised = useRef(false)

  useEffect(() => {
    if (initialised.current) return
    if (isLoading) return
    initialised.current = true
    setLocalValues(Object.fromEntries(relevant.map(s => [s.slug, String(Number(s.discountPct))])))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, settings])

  async function handleSave() {
    setSaving(true)
    const items = relevant.map(s => {
      const raw = localValues[s.slug] ?? '0'
      const discountPct = Math.min(100, Math.max(0, parseFloat(raw) || 0))
      return { slug: s.slug, label: s.label, discountPct }
    })
    await fetch('/api/discount-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    })
    await queryClient.invalidateQueries({ queryKey: ['discount-settings'] })
    setSaving(false)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E3]">
          <div>
            <p className="font-semibold text-gray-900 text-sm">Discount settings</p>
            <p className="text-xs text-gray-400 mt-0.5">% off applied when discount toggle is on</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
        )}

        {!isLoading && (
          <div className="divide-y divide-gray-50">
            {relevant.map((s, i) => (
              <div key={s.slug}>
                {i === 1 && (
                  <p className="px-5 pt-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Competitors
                  </p>
                )}
                <div className="flex items-center justify-between px-5 py-3 gap-4">
                  <span className={`text-sm ${s.slug === 'cut-my' ? 'font-semibold text-[#009FE3]' : 'text-gray-700'}`}>
                    {s.label}
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={localValues[s.slug] ?? '0'}
                      onChange={e => setLocalValues(v => ({ ...v, [s.slug]: e.target.value }))}
                      className="w-16 text-right text-sm px-2 py-1 rounded-lg border border-[#E5E5E3] focus:outline-none focus:ring-2 focus:ring-[#2DBDAA]/40 focus:border-[#2DBDAA] tabular-nums"
                    />
                    <span className="text-sm text-gray-400">%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-5 py-3 bg-gray-50 border-t border-[#E5E5E3] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || isLoading}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[#2DBDAA] text-white hover:bg-[#28a898] disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
