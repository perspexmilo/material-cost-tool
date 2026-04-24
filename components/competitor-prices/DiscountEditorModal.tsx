'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface DiscountSetting {
  slug: string
  label: string
  discountPct: number
}

interface Props {
  settings: DiscountSetting[]
  category: 'plastic' | 'wood'
  onClose: () => void
}

const PLASTIC_SLUGS = ['cut-my', 'simply-plastics', 'plastic-people', 'cut-plastic-sheeting', 'sheet-plastics', 'plastic-sheet-shop', 'plastic-sheets']
const WOOD_SLUGS    = ['cut-my', 'wood-sheets', 'cnc-creations', 'plastic-people-mdf', 'cut-plastic-sheeting-mdf', 'just-mdf', 'mdf-ply-mfc-direct']

export function DiscountEditorModal({ settings, category, onClose }: Props) {
  const queryClient = useQueryClient()
  const slugs = category === 'wood' ? WOOD_SLUGS : PLASTIC_SLUGS
  const relevant = slugs.map(slug => settings.find(s => s.slug === slug)).filter(Boolean) as DiscountSetting[]

  const [localValues, setLocalValues] = useState<Record<string, string>>(
    Object.fromEntries(relevant.map(s => [s.slug, String(s.discountPct)]))
  )

  const mutation = useMutation({
    mutationFn: ({ slug, discountPct }: { slug: string; discountPct: number }) =>
      fetch('/api/discount-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, discountPct }),
      }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discount-settings'] }),
  })

  function handleBlur(slug: string) {
    const raw = localValues[slug] ?? '0'
    const parsed = Math.min(100, Math.max(0, parseFloat(raw) || 0))
    setLocalValues(v => ({ ...v, [slug]: String(parsed) }))
    mutation.mutate({ slug, discountPct: parsed })
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
                    onBlur={() => handleBlur(s.slug)}
                    className="w-16 text-right text-sm px-2 py-1 rounded-lg border border-[#E5E5E3] focus:outline-none focus:ring-2 focus:ring-[#2DBDAA]/40 focus:border-[#2DBDAA] tabular-nums"
                  />
                  <span className="text-sm text-gray-400">%</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-[#E5E5E3] text-xs text-gray-400">
          Changes save automatically on blur
          {mutation.isPending && <span className="ml-2 text-[#2DBDAA]">Saving…</span>}
        </div>
      </div>
    </div>
  )
}
