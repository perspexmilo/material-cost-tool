'use client'

import { X } from 'lucide-react'
import { useState } from 'react'

interface Props {
  category: 'plastic' | 'wood'
  discountMap: Record<string, number>
  onSave: (map: Record<string, number>) => void
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

export function DiscountEditorModal({ category, discountMap, onSave, onClose }: Props) {
  const slugs = category === 'wood' ? WOOD_SLUGS : PLASTIC_SLUGS

  const [localValues, setLocalValues] = useState<Record<string, string>>(
    () => Object.fromEntries(slugs.map(slug => [slug, String(discountMap[slug] ?? 0)]))
  )

  function handleSave() {
    const newMap = { ...discountMap }
    for (const slug of slugs) {
      const raw = localValues[slug] ?? '0'
      newMap[slug] = Math.min(100, Math.max(0, parseFloat(raw) || 0))
    }
    onSave(newMap)
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

        <div className="divide-y divide-gray-50">
          {slugs.map((slug, i) => (
            <div key={slug}>
              {i === 1 && (
                <p className="px-5 pt-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  Competitors
                </p>
              )}
              <div className="flex items-center justify-between px-5 py-3 gap-4">
                <span className={`text-sm ${slug === 'cut-my' ? 'font-semibold text-[#009FE3]' : 'text-gray-700'}`}>
                  {SLUG_LABELS[slug] ?? slug}
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={localValues[slug] ?? '0'}
                    onChange={e => setLocalValues(v => ({ ...v, [slug]: e.target.value }))}
                    className="w-16 text-right text-sm px-2 py-1 rounded-lg border border-[#E5E5E3] focus:outline-none focus:ring-2 focus:ring-[#2DBDAA]/40 focus:border-[#2DBDAA] tabular-nums"
                  />
                  <span className="text-sm text-gray-400">%</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-[#E5E5E3] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[#2DBDAA] text-white hover:bg-[#28a898] transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
