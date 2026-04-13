'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import { ChevronDown, ChevronRight, Trash2, ArrowUpDown, ArrowUp, ArrowDown, X, Pencil, Check } from 'lucide-react'
import { SearchInput } from '@/components/ui/SearchInput'
import { CostHistoryPanel } from './CostHistoryPanel'
import { ImportDialog } from './ImportDialog'
import { AddVariantDialog } from './AddVariantDialog'
import type { Material, MaterialFilters, MaterialGroup } from '@/types'

const PAGE_SIZE = 100

interface FilterOptions {
  categories: string[]
  typeFinishes: string[]
  suppliers: { id: string; name: string }[]
  variantTypes: string[]
}

interface MaterialsTableProps {
  initialData: Material[]
  initialTotal: number
  filters?: MaterialFilters
}

type SortColumn = 'variantType' | 'description' | 'thicknessMm' | 'costPerSheet' | 'supplier' | 'lastUpdatedAt'
type SortDir = 'asc' | 'desc'

interface EditValues {
  description: string
  variantType: string
  magentoSku: string
  magentoEntityId: string
  thicknessMm: string
  widthMm: string
  heightMm: string
  supplierName: string
  costPerSheet: string
  markupMultiplier: string
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function formatM2Cost(value: number | undefined): string {
  if (value === undefined) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'email-parse': return 'Email'
    case 'manual':      return 'Manual'
    case 'import':      return 'Import'
    case 'staged':      return 'Scheduled'
    default:            return source
  }
}

// ─── Sort + group ─────────────────────────────────────────────────────────────

function sortMaterials(materials: Material[], col: SortColumn, dir: SortDir): Material[] {
  return [...materials].sort((a, b) => {
    let cmp = 0
    switch (col) {
      case 'variantType':
        cmp = (a.variantType ?? '').localeCompare(b.variantType ?? '')
        break
      case 'description':
        cmp = a.description.localeCompare(b.description)
        break
      case 'thicknessMm':
        cmp = a.thicknessMm - b.thicknessMm
        break
      case 'costPerSheet':
        cmp = a.costPerSheet - b.costPerSheet
        break
      case 'supplier':
        cmp = (a.supplier?.name ?? '').localeCompare(b.supplier?.name ?? '')
        break
      case 'lastUpdatedAt':
        cmp = new Date(a.lastUpdatedAt).getTime() - new Date(b.lastUpdatedAt).getTime()
        break
    }
    return dir === 'asc' ? cmp : -cmp
  })
}

function groupMaterials(materials: Material[]): MaterialGroup[] {
  const groupMap = new Map<string, MaterialGroup>()
  for (const material of materials) {
    const key = `${material.category}::${material.typeFinish}`
    if (!groupMap.has(key)) {
      groupMap.set(key, { category: material.category, typeFinish: material.typeFinish, materials: [] })
    }
    groupMap.get(key)!.materials.push(material)
  }
  return Array.from(groupMap.values())
}

// ─── Indeterminate checkbox ───────────────────────────────────────────────────

function IndeterminateCheckbox({ checked, indeterminate, onChange, className }: {
  checked: boolean; indeterminate: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className={className} />
}

// ─── Sort header ──────────────────────────────────────────────────────────────

function SortTh({ col, label, activeCol, dir, onSort, className }: {
  col: SortColumn; label: string; activeCol: SortColumn; dir: SortDir
  onSort: (col: SortColumn) => void; className?: string
}) {
  const active = col === activeCol
  return (
    <th
      className={`px-4 py-3 text-gray-500 cursor-pointer select-none hover:text-gray-700 transition-colors ${className ?? ''}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? dir === 'asc' ? <ArrowUp size={12} className="text-[#2DBDAA]" /> : <ArrowDown size={12} className="text-[#2DBDAA]" />
          : <ArrowUpDown size={12} className="opacity-30" />}
      </span>
    </th>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MaterialsTable({ initialData, initialTotal, filters: externalFilters }: MaterialsTableProps) {
  const [search, setSearch]             = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterType, setFilterType]     = useState('')
  const [filterSupplierId, setFilterSupplierId] = useState('')
  const [sortCol, setSortCol]           = useState<SortColumn>('variantType')
  const [sortDir, setSortDir]           = useState<SortDir>('asc')
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [deleteError, setDeleteError]   = useState<string | null>(null)
  const [editingId, setEditingId]       = useState<string | null>(null)
  const [editValues, setEditValues]     = useState<EditValues | null>(null)
  const [editError, setEditError]       = useState<string | null>(null)
  const queryClient = useQueryClient()

  const queryFilters = {
    search: search || undefined,
    category: filterCategory || undefined,
    typeFinish: filterType || undefined,
    supplierId: filterSupplierId || undefined,
    ...externalFilters,
  }

  // Only use SSR initial data when no filters are active — filters must trigger a real fetch
  // so that the new queryKey starts with undefined (proper loading state) instead of stale
  // unfiltered rows, which caused filtered results to show wrong data.
  const hasNoFilters = !queryFilters.search && !queryFilters.category && !queryFilters.typeFinish && !queryFilters.supplierId

  const {
    data: pagedData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['materials', queryFilters],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const params = new URLSearchParams()
      if (queryFilters.search) params.set('search', queryFilters.search)
      if (queryFilters.category) params.set('category', queryFilters.category)
      if (queryFilters.typeFinish) params.set('typeFinish', queryFilters.typeFinish)
      if (queryFilters.supplierId) params.set('supplierId', queryFilters.supplierId)
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(pageParam))
      const res = await fetch(`/api/materials?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch materials')
      return res.json() as Promise<{ materials: Material[]; total: number }>
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.materials.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    ...(hasNoFilters && {
      initialData: {
        pages: [{ materials: initialData, total: initialTotal }],
        pageParams: [0],
      },
    }),
    staleTime: 30 * 1000,
  })

  const allMaterials = pagedData?.pages.flatMap((p) => p.materials) ?? initialData
  const total = pagedData?.pages[0]?.total ?? initialTotal

  // Fetch filter dropdown options from lightweight endpoint
  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ['material-filters'],
    queryFn: async () => {
      const res = await fetch('/api/materials/filters')
      if (!res.ok) throw new Error('Failed to fetch filter options')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  const categories  = filterOptions?.categories ?? [...new Set(allMaterials.map((m) => m.category))].sort()
  const typeFinishes = useMemo(() => {
    const base = filterOptions?.typeFinishes ?? [...new Set(allMaterials.map((m) => m.typeFinish))].sort()
    return filterCategory
      ? base.filter((t) => allMaterials.some((m) => m.category === filterCategory && m.typeFinish === t))
      : base
  }, [filterOptions, allMaterials, filterCategory])
  const supplierOptions = filterOptions?.suppliers ?? []
  const thicknesses = useMemo(() =>
    [...new Set(allMaterials.map((m) => String(m.thicknessMm)))].sort((a, b) => parseFloat(a) - parseFloat(b)),
    [allMaterials])
  const variantTypes = useMemo(() =>
    filterOptions?.variantTypes ?? [...new Set(allMaterials.map((m) => m.variantType).filter(Boolean) as string[])].sort(),
    [filterOptions, allMaterials])

  // Sort loaded materials (filtering is server-side)
  const materials = useMemo(() => sortMaterials(allMaterials, sortCol, sortDir), [allMaterials, sortCol, sortDir])

  const groups = useMemo(() => groupMaterials(materials), [materials])

  const hasActiveFilters = !!(filterCategory || filterType || filterSupplierId)

  function handleSort(col: SortColumn) {
    if (col === sortCol) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function clearFilters() {
    setFilterCategory('')
    setFilterType('')
    setFilterSupplierId('')
  }

  // Selection
  const allIds = useMemo(() => materials.map((m) => m.id), [materials])
  const allSelected  = allIds.length > 0 && allIds.every((id) => selectedIds.has(id))
  const someSelected = selectedIds.size > 0 && !allSelected

  const toggleRow    = useCallback((id: string) => setExpandedId((p) => p === id ? null : id), [])
  const toggleSelect = useCallback((id: string) => setSelectedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }), [])
  const toggleSelectAll = useCallback(() => setSelectedIds(allSelected ? new Set() : new Set(allIds)), [allSelected, allIds])

  const handleImportSuccess = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['materials'] })
    void queryClient.invalidateQueries({ queryKey: ['material-filters'] })
    void refetch()
  }, [queryClient, refetch])

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/materials/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'Delete failed') }
      return res.json() as Promise<{ deleted: number }>
    },
    onSuccess: () => { setSelectedIds(new Set()); setDeleteError(null); void queryClient.invalidateQueries({ queryKey: ['materials'] }) },
    onError: (err: Error) => setDeleteError(err.message),
  })

  const handlePrefetchHistory = useCallback((id: string) => {
    void queryClient.prefetchQuery({
      queryKey: ['cost-history', id],
      queryFn: async () => {
        const res = await fetch(`/api/materials/${id}/history`)
        if (!res.ok) throw new Error('Failed to fetch cost history')
        return res.json()
      },
      staleTime: 5 * 60 * 1000,
    })
  }, [queryClient])

  function handleDelete() {
    const ids = Array.from(selectedIds)
    if (!window.confirm(`Permanently delete ${ids.length} material${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
    deleteMutation.mutate(ids)
  }

  function handleStartEdit() {
    const id = Array.from(selectedIds)[0]
    const material = materials.find((m) => m.id === id)
    if (!material) return
    setEditingId(id)
    setEditError(null)
    setEditValues({
      description:  material.description,
      variantType:  material.variantType ?? '',
      magentoSku:   material.magentoSku ?? '',
      magentoEntityId: material.magentoEntityId != null ? String(material.magentoEntityId) : '',
      thicknessMm:  String(material.thicknessMm),
      widthMm:      String(material.widthMm),
      heightMm:     String(material.heightMm),
      supplierName: material.supplier?.name ?? '',
      costPerSheet: String(material.costPerSheet),
      markupMultiplier: material.markupMultiplier != null ? String(material.markupMultiplier) : '',
    })
  }

  function handleCancelEdit() {
    setEditingId(null)
    setEditValues(null)
    setEditError(null)
  }

  function handleEditChange(field: keyof EditValues, value: string) {
    setEditValues((prev) => prev ? { ...prev, [field]: value } : prev)
  }

  const editMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: EditValues }) => {
      const res = await fetch(`/api/materials/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description:  values.description,
          variantType:  values.variantType || null,
          magentoSku:   values.magentoSku || null,
          magentoEntityId: values.magentoEntityId.trim() !== '' ? parseInt(values.magentoEntityId.trim(), 10) : null,
          thicknessMm:  parseFloat(values.thicknessMm),
          widthMm:      parseFloat(values.widthMm),
          heightMm:     parseFloat(values.heightMm),
          supplierName: values.supplierName,
          costPerSheet: parseFloat(values.costPerSheet),
          markupMultiplier: values.markupMultiplier.trim() !== '' ? parseFloat(values.markupMultiplier) : null,
        }),
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'Update failed') }
      return res.json()
    },
    onSuccess: () => {
      setEditingId(null)
      setEditValues(null)
      setEditError(null)
      setSelectedIds(new Set())
      void queryClient.invalidateQueries({ queryKey: ['materials'] })
    },
    onError: (err: Error) => setEditError(err.message),
  })

  return (
    <div className="flex flex-col">
      {/* Toolbar + Filter bar — single sticky block so nothing shifts independently */}
      <div className="sticky top-0 z-30 bg-[#F7F7F5] pt-4">
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search materials…" value={search} onChange={(e) => setSearch(e.target.value)} containerClassName="w-72" />
            <span className="text-[12px] text-gray-400">{materials.length} of {total} material{total !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-3">
            {selectedIds.size > 0 && (
              <>
                <span className="text-[12px] text-gray-500">{selectedIds.size} selected</span>
                {selectedIds.size === 1 && !editingId && (
                  <button
                    type="button" onClick={handleStartEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-white border border-[#E5E5E3] text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Pencil size={13} /> Edit
                  </button>
                )}
                <button
                  type="button" onClick={handleDelete} disabled={deleteMutation.isPending || !!editingId}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  <Trash2 size={13} />
                  {deleteMutation.isPending ? 'Deleting…' : `Delete ${selectedIds.size}`}
                </button>
              </>
            )}
            <AddVariantDialog
            categories={categories}
            typeFinishes={typeFinishes}
            variantTypes={variantTypes}
            thicknesses={thicknesses}
            suppliers={supplierOptions.map((s) => s.name)}
            onSuccess={handleImportSuccess}
          />
          <ImportDialog onSuccess={handleImportSuccess} />
          </div>
        </div>

        <div className="pb-4 flex items-center gap-2">
          <select
            value={filterCategory}
            onChange={(e) => { setFilterCategory(e.target.value); setFilterType('') }}
            className="text-[12px] border border-[#E5E5E3] rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-[12px] border border-[#E5E5E3] rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]"
          >
            <option value="">All types</option>
            {typeFinishes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <select
            value={filterSupplierId}
            onChange={(e) => setFilterSupplierId(e.target.value)}
            className="text-[12px] border border-[#E5E5E3] rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]"
          >
            <option value="">All suppliers</option>
            {supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {hasActiveFilters && (
            <button
              type="button" onClick={clearFilters}
              className="flex items-center gap-1 text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={12} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {deleteError && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-600">{deleteError}</div>
      )}
      {editError && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-600">{editError}</div>
      )}

      {/* Table */}
      <div className="relative z-0 bg-white rounded-xl border border-[#E5E5E3]">
        <table className="w-full data-table relative border-separate border-spacing-0">
          <thead className="sticky top-[112px] z-20 bg-white shadow-[0_1px_0_rgba(0,0,0,0.05)]">
            <tr style={{ backgroundColor: '#FFFFFF', boxShadow: 'inset 0 -1px 0 #E5E5E3' }}>
              <th className="px-4 py-3 w-10">
                <IndeterminateCheckbox
                  checked={allSelected} indeterminate={someSelected}
                  onChange={toggleSelectAll} className="cursor-pointer accent-[#2DBDAA]"
                />
              </th>
              <SortTh col="description"   label="Description"   activeCol={sortCol} dir={sortDir} onSort={handleSort} className="text-left w-[240px]" />
              <SortTh col="variantType"   label="Variant Type"  activeCol={sortCol} dir={sortDir} onSort={handleSort} className="text-left w-[160px]" />
              <th className="text-left px-4 py-3 text-gray-500 w-[150px]">Magento SKU</th>
              <SortTh col="thicknessMm"   label="Thickness"     activeCol={sortCol} dir={sortDir} onSort={handleSort} className="text-left w-[90px]" />
              <th className="text-left px-4 py-3 text-gray-500 w-[130px]">Sheet Size</th>
              <SortTh col="supplier"      label="Supplier"      activeCol={sortCol} dir={sortDir} onSort={handleSort} className="text-left w-[130px]" />
              <SortTh col="costPerSheet"  label="Cost/Sheet"    activeCol={sortCol} dir={sortDir} onSort={handleSort} className="text-right w-[110px]" />
              <th className="text-right px-4 py-3 text-gray-500 w-[110px]">Cost/m²</th>
              <SortTh col="lastUpdatedAt" label="Cost Updated"  activeCol={sortCol} dir={sortDir} onSort={handleSort} className="text-left w-[120px]" />
              <th className="text-right px-4 py-3 text-gray-500 w-[80px]">Markup</th>
              <th className="text-left px-4 py-3 text-gray-500 w-[70px]">Pending</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-12 text-center text-sm text-gray-400">No materials found</td>
              </tr>
            )}
            {groups.map((group) => (
              <GroupRows
                key={`${group.category}::${group.typeFinish}`}
                group={group}
                expandedId={expandedId}
                selectedIds={selectedIds}
                onToggle={toggleRow}
                onSelect={toggleSelect}
                editingId={editingId}
                editValues={editValues}
                onEditChange={handleEditChange}
                onSave={() => editingId && editValues && editMutation.mutate({ id: editingId, values: editValues })}
                onCancelEdit={handleCancelEdit}
                isSaving={editMutation.isPending}
                onPrefetch={handlePrefetchHistory}
              />
            ))}
          </tbody>
        </table>
      </div>

      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-5 py-2 text-[13px] font-medium rounded-lg bg-white border border-[#E5E5E3] text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {isFetchingNextPage ? 'Loading…' : `Load more (${total - materials.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Group rows ───────────────────────────────────────────────────────────────

function GroupRows({ group, expandedId, selectedIds, onToggle, onSelect, editingId, editValues, onEditChange, onSave, onCancelEdit, isSaving, onPrefetch }: {
  group: MaterialGroup; expandedId: string | null
  selectedIds: Set<string>; onToggle: (id: string) => void; onSelect: (id: string) => void
  editingId: string | null; editValues: EditValues | null
  onEditChange: (field: keyof EditValues, value: string) => void
  onSave: () => void; onCancelEdit: () => void; isSaving: boolean
  onPrefetch: (id: string) => void
}) {
  return (
    <>
      <tr style={{ backgroundColor: '#EEEEEC' }}>
        <td colSpan={13} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {group.category} — {group.typeFinish}
          <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">({group.materials.length})</span>
        </td>
      </tr>

      {group.materials.map((material) => {
        const isExpanded = expandedId === material.id
        const isSelected = selectedIds.has(material.id)
        const isEditing  = editingId === material.id
        const lastUpdated = new Date(material.lastUpdatedAt)

        const editInput = (field: keyof EditValues, opts?: { className?: string; type?: string }) => (
          <input
            type={opts?.type ?? 'text'}
            value={editValues?.[field] ?? ''}
            onChange={(e) => onEditChange(field, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancelEdit() }}
            className={`border-b border-[#2DBDAA] bg-transparent outline-none text-[13px] w-full px-0 ${opts?.className ?? ''}`}
          />
        )

        return (
          <React.Fragment key={material.id}>
            {isEditing ? (
              <tr className="border-b border-[#F0F0EE]" style={{ backgroundColor: '#EFF9F7' }}>
                <td className="px-4 py-2">
                  <input type="checkbox" checked={isSelected} readOnly className="accent-[#2DBDAA]" />
                </td>
                <td className="px-4 py-2">{editInput('description')}</td>
                <td className="px-4 py-2">{editInput('variantType')}</td>
                <td className="px-4 py-2">
                  {editInput('magentoSku')}
                  <div className="text-[10px] text-gray-400 mt-1">SKU · Entity ID: {editInput('magentoEntityId', { type: 'number', className: 'w-20' })}</div>
                </td>
                <td className="px-4 py-2">{editInput('thicknessMm', { type: 'number' })}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    <input
                      type="number" value={editValues?.widthMm ?? ''}
                      onChange={(e) => onEditChange('widthMm', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancelEdit() }}
                      className="border-b border-[#2DBDAA] bg-transparent outline-none text-[13px] w-[52px] px-0"
                    />
                    <span className="text-gray-400 text-[12px]">×</span>
                    <input
                      type="number" value={editValues?.heightMm ?? ''}
                      onChange={(e) => onEditChange('heightMm', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancelEdit() }}
                      className="border-b border-[#2DBDAA] bg-transparent outline-none text-[13px] w-[52px] px-0"
                    />
                  </div>
                </td>
                <td className="px-4 py-2">{editInput('supplierName')}</td>
                <td className="px-4 py-2">{editInput('costPerSheet', { type: 'number' })}</td>
                <td className="px-4 py-2 text-right text-[13px] text-gray-400">—</td>
                <td className="px-4 py-2 text-[13px] text-gray-400">—</td>
                <td className="px-4 py-2 text-right">{editInput('markupMultiplier', { type: 'number' })}</td>
                <td className="px-4 py-2 text-[13px] text-gray-400">—</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button" onClick={onSave} disabled={isSaving}
                      className="text-[#2DBDAA] hover:text-[#249A8B] disabled:opacity-50 transition-colors"
                      title="Save"
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button" onClick={onCancelEdit} disabled={isSaving}
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
                      title="Cancel"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr
                onClick={() => onToggle(material.id)}
                className="cursor-pointer border-b border-[#F0F0EE] transition-colors duration-100"
                style={{ backgroundColor: isSelected ? '#F0FAF8' : isExpanded ? '#F0F0EE' : undefined }}
                onMouseEnter={(e) => { onPrefetch(material.id); if (!isExpanded && !isSelected) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#F0F0EE' }}
                onMouseLeave={(e) => { if (!isExpanded && !isSelected) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '' }}
              >
                <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); onSelect(material.id) }}>
                  <input type="checkbox" checked={isSelected} onChange={() => onSelect(material.id)} onClick={(e) => e.stopPropagation()} className="cursor-pointer accent-[#2DBDAA]" />
                </td>
                <td className="px-4 py-3 text-[13px] text-gray-900 font-medium">{material.description}</td>
                <td className="px-4 py-3">
                  {material.variantType
                    ? <span className="text-[12px] text-gray-600">{material.variantType}</span>
                    : <span className="text-[12px] text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {material.magentoSku
                    ? <span className="font-mono text-[12px] text-gray-400">{material.magentoSku}</span>
                    : <span className="text-[12px] text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-[13px] text-gray-600">{material.thicknessMm}mm</td>
                <td className="px-4 py-3 text-[13px] text-gray-600">{material.heightMm} × {material.widthMm}mm</td>
                <td className="px-4 py-3 text-[13px] text-gray-600">{material.supplier?.name ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <span className="cost-cell tabular-nums text-gray-900">{formatCurrency(material.costPerSheet)}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="cost-cell tabular-nums text-gray-500">{formatM2Cost(material.costPerM2)}</span>
                </td>
                <td className="px-4 py-3">
                  {material.lastCostUpdatedAt ? (
                    <time dateTime={material.lastCostUpdatedAt} title={format(new Date(material.lastCostUpdatedAt), 'dd MMM yyyy HH:mm')} className="text-[13px] text-gray-500">
                      {formatDistanceToNow(new Date(material.lastCostUpdatedAt), { addSuffix: true })}
                    </time>
                  ) : (
                    <span className="text-[13px] text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {material.markupMultiplier != null
                    ? <span className="tabular-nums text-[13px] text-gray-600">{material.markupMultiplier}×</span>
                    : <span className="text-[13px] text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {material.hasPendingChange
                    ? <span className="text-[12px] font-medium text-[#2DBDAA]">Yes</span>
                    : <span className="text-[12px] text-gray-300">No</span>}
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </td>
              </tr>
            )}

            {isExpanded && !isEditing && (
              <tr>
                <td colSpan={13} className="p-0 border-b border-[#E5E5E3]">
                  <div className="slide-down">
                    <CostHistoryPanel materialId={material.id} materialDescription={material.description} />
                  </div>
                </td>
              </tr>
            )}
          </React.Fragment>
        )
      })}
    </>
  )
}
