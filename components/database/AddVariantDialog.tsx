'use client'

import React, { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, X, AlertCircle } from 'lucide-react'

interface AddVariantDialogProps {
  categories:   string[]
  typeFinishes: string[]
  variantTypes: string[]
  thicknesses:  string[]
  suppliers:    string[]
  onSuccess:    () => void
}

interface FormValues {
  description:  string
  category:     string
  typeFinish:   string
  variantType:  string
  magentoSku:   string
  magentoEntityId: string
  thicknessMm:  string
  widthMm:      string
  heightMm:     string
  supplierName: string
  costPerSheet: string
  markupMultiplier: string
}

const EMPTY: FormValues = {
  description:  '',
  category:     '',
  typeFinish:   '',
  variantType:  '',
  magentoSku:   '',
  magentoEntityId: '',
  thicknessMm:  '',
  widthMm:      '',
  heightMm:     '',
  supplierName: '',
  costPerSheet: '',
  markupMultiplier: '',
}

const fieldClass =
  'w-full px-3 py-1.5 text-[13px] border border-[#E5E5E3] rounded-lg bg-white text-gray-800 ' +
  'placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]'

export function AddVariantDialog({
  categories, typeFinishes, variantTypes, thicknesses, suppliers, onSuccess,
}: AddVariantDialogProps) {
  const [open, setOpen]       = useState(false)
  const [form, setForm]       = useState<FormValues>(EMPTY)
  const [error, setError]     = useState<string | null>(null)

  const set = useCallback((field: keyof FormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    setForm(EMPTY)
    setError(null)
  }, [])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await fetch('/api/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description:  values.description.trim(),
          category:     values.category.trim(),
          typeFinish:   values.typeFinish.trim(),
          variantType:  values.variantType.trim() || null,
          magentoSku:   values.magentoSku.trim()  || null,
          magentoEntityId: values.magentoEntityId.trim() !== '' ? parseInt(values.magentoEntityId.trim(), 10) : null,
          thicknessMm:  parseFloat(values.thicknessMm),
          widthMm:      parseFloat(values.widthMm),
          heightMm:     parseFloat(values.heightMm),
          supplierName: values.supplierName.trim(),
          costPerSheet: parseFloat(values.costPerSheet),
          markupMultiplier: values.markupMultiplier.trim() !== '' ? parseFloat(values.markupMultiplier) : null,
        }),
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'Failed to create variant') }
      return res.json()
    },
    onSuccess: () => { handleClose(); onSuccess() },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const required: (keyof FormValues)[] = ['description', 'category', 'typeFinish', 'thicknessMm', 'widthMm', 'heightMm', 'supplierName', 'costPerSheet']
    for (const field of required) {
      if (!form[field].trim()) {
        setError(`"${field}" is required`)
        return
      }
    }
    mutation.mutate(form)
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E5E3] bg-white text-[13px] text-gray-600 hover:bg-[#F0F0EE] transition-colors duration-100"
      >
        <Plus size={14} />
        Add Variant
      </button>

      {open && (
        <div className="w-[520px] bg-white border border-[#E5E5E3] rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-semibold text-gray-900">Add Variant</h3>
            <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X size={14} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* Description — full width */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Description *</label>
              <input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. 12mm White MDF" className={fieldClass} />
            </div>

            {/* Category + Type/Finish */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Category *</label>
                <input value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Wood" list="av-categories" className={fieldClass} />
                <datalist id="av-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Type / Finish *</label>
                <input value={form.typeFinish} onChange={(e) => set('typeFinish', e.target.value)} placeholder="e.g. MDF" list="av-typefinishes" className={fieldClass} />
                <datalist id="av-typefinishes">{typeFinishes.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
            </div>

            {/* Variant Type + Magento SKU */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Variant Type</label>
                <input value={form.variantType} onChange={(e) => set('variantType', e.target.value)} placeholder="e.g. Birch" list="av-varianttypes" className={fieldClass} />
                <datalist id="av-varianttypes">{variantTypes.map((v) => <option key={v} value={v} />)}</datalist>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Magento SKU</label>
                <input value={form.magentoSku} onChange={(e) => set('magentoSku', e.target.value)} placeholder="e.g. 12-white-mdf" className={fieldClass} />
              </div>
            </div>

            {/* Magento Entity ID */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Magento Entity ID</label>
              <input value={form.magentoEntityId} onChange={(e) => set('magentoEntityId', e.target.value)} placeholder="e.g. 4059 — required to appear in competitor price picker" type="number" className={fieldClass} />
            </div>

            {/* Thickness + Supplier */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Thickness (mm) *</label>
                <input value={form.thicknessMm} onChange={(e) => set('thicknessMm', e.target.value)} placeholder="e.g. 12" list="av-thicknesses" className={fieldClass} />
                <datalist id="av-thicknesses">{thicknesses.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Supplier *</label>
                <input value={form.supplierName} onChange={(e) => set('supplierName', e.target.value)} placeholder="e.g. Lathams" list="av-suppliers" className={fieldClass} />
                <datalist id="av-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
            </div>

            {/* Sheet size */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Sheet Size (mm) *</label>
              <div className="flex items-center gap-2">
                <input value={form.widthMm} onChange={(e) => set('widthMm', e.target.value)} placeholder="Width" type="number" className={fieldClass} />
                <span className="text-gray-400 text-[12px] shrink-0">×</span>
                <input value={form.heightMm} onChange={(e) => set('heightMm', e.target.value)} placeholder="Height" type="number" className={fieldClass} />
              </div>
            </div>

            {/* Cost + Markup */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Cost / Sheet (£) *</label>
                <input value={form.costPerSheet} onChange={(e) => set('costPerSheet', e.target.value)} placeholder="e.g. 24.50" type="number" step="0.01" className={fieldClass} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Markup Multiplier</label>
                <input value={form.markupMultiplier} onChange={(e) => set('markupMultiplier', e.target.value)} placeholder="e.g. 1.45" type="number" step="0.001" className={fieldClass} />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-[12px] text-red-500">
                <AlertCircle size={13} />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={handleClose} className="px-3 py-1.5 rounded-lg border border-[#E5E5E3] text-[13px] text-gray-600 hover:bg-[#F0F0EE] transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="px-4 py-1.5 rounded-lg text-[13px] font-medium text-white disabled:opacity-50 transition-colors"
                style={{ backgroundColor: '#2DBDAA' }}
              >
                {mutation.isPending ? 'Saving…' : 'Add Variant'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
