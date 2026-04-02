'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import { ChevronDown, ChevronRight, Trash2, ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react'
import { SearchInput } from '@/components/ui/SearchInput'
import { CostHistoryPanel } from './CostHistoryPanel'
import { ImportDialog } from './ImportDialog'
import type { Material, MaterialFilters, MaterialGroup } from '@/types'

interface MaterialsTableProps {
  initialData: Material[]
  filters?: MaterialFilters
}

type SortColumn = 'variantType' | 'description' | 'thicknessMm' | 'costPerSheet' | 'supplier' | 'lastUpdatedAt'
type SortDir = 'asc' | 'desc'

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

export function MaterialsTable({ initialData, filters: externalFilters }: MaterialsTableProps) {
  const [search, setSearch]             = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterType, setFilterType]     = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [sortCol, setSortCol]           = useState<SortColumn>('variantType')
  const [sortDir, setSortDir]           = useState<SortDir>('asc')
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [deleteError, setDeleteError]   = useState<string | null>(null)
  const queryClient = useQueryClient()

  const queryFilters: MaterialFilters = {
    ...externalFilters,
    search: search || undefined,
  }

  const { data: allMaterials, refetch } = useQuery<Material[]>({
    queryKey: ['materials', queryFilters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (queryFilters.search) params.set('search', queryFilters.search)
      const res = await fetch(`/api/materials?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch materials')
      const json = await res.json()
      return json.materials
    },
    initialData: search ? undefined : initialData,
    staleTime: 30 * 1000,
  })

  // Derive filter options from full dataset
  const categories = useMemo(() =>
    [...new Set((allMaterials ?? []).map((m) => m.category))].sort(), [allMaterials])
  const typeFinishes = useMemo(() =>
    [...new Set((allMaterials ?? []).filter((m) => !filterCategory || m.category === filterCategory).map((m) => m.typeFinish))].sort(),
    [allMaterials, filterCategory])
  const suppliers = useMemo(() =>
    [...new Set((allMaterials ?? []).map((m) => m.supplier?.name).filter(Boolean) as string[])].sort(), [allMaterials])

  // Apply client-side filters then sort
  const materials = useMemo(() => {
    let list = allMaterials ?? []
    if (filterCategory) list = list.filter((m) => m.category === filterCategory)
    if (filterType)     list = list.filter((m) => m.typeFinish === filterType)
    if (filterSupplier) list = list.filter((m) => m.supplier?.name === filterSupplier)
    return sortMaterials(list, sortCol, sortDir)
  }, [allMaterials, filterCategory, filterType, filterSupplier, sortCol, sortDir])

  const groups = useMemo(() => groupMaterials(materials), [materials])

  const hasActiveFilters = !!(filterCategory || filterType || filterSupplier)

  function handleSort(col: SortColumn) {
    if (col === sortCol) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function clearFilters() {
    setFilterCategory('')
    setFilterType('')
    setFilterSupplier('')
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

  function handleDelete() {
    const ids = Array.from(selectedIds)
    if (!window.confirm(`Permanently delete ${ids.length} material${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
    deleteMutation.mutate(ids)
  }

  const totalCount = materials.length

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="sticky top-12 z-20 bg-[#F7F7F5] pt-1 pb-3">
        <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SearchInput placeholder="Search materials…" value={search} onChange={(e) => setSearch(e.target.value)} containerClassName="w-72" />
          <span className="text-[12px] text-gray-400">{totalCount} material{totalCount !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <>
              <span className="text-[12px] text-gray-500">{selectedIds.size} selected</span>
              <button
                type="button" onClick={handleDelete} disabled={deleteMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                <Trash2 size={13} />
                {deleteMutation.isPending ? 'Deleting…' : `Delete ${selectedIds.size}`}
              </button>
            </>
          )}
          <ImportDialog onSuccess={handleImportSuccess} />
        </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="sticky top-[108px] z-20 bg-[#F7F7F5] pb-4 flex items-center gap-2">
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
          value={filterSupplier}
          onChange={(e) => setFilterSupplier(e.target.value)}
          className="text-[12px] border border-[#E5E5E3] rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]"
        >
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
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

      {deleteError && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-600">{deleteError}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#E5E5E3] overflow-hidden">
        <table className="w-full data-table relative border-collapse">
          <thead className="sticky top-[156px] z-10 bg-white shadow-[0_1px_0_rgba(0,0,0,0.05)]">
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
              <SortTh col="lastUpdatedAt" label="Last Updated"  activeCol={sortCol} dir={sortDir} onSort={handleSort} className="text-left w-[120px]" />
              <th className="text-left px-4 py-3 text-gray-500 w-[80px]">Source</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-sm text-gray-400">No materials found</td>
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
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Group rows ───────────────────────────────────────────────────────────────

function GroupRows({ group, expandedId, selectedIds, onToggle, onSelect }: {
  group: MaterialGroup; expandedId: string | null
  selectedIds: Set<string>; onToggle: (id: string) => void; onSelect: (id: string) => void
}) {
  return (
    <>
      <tr style={{ backgroundColor: '#EEEEEC' }}>
        <td colSpan={12} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {group.category} — {group.typeFinish}
          <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">({group.materials.length})</span>
        </td>
      </tr>

      {group.materials.map((material) => {
        const isExpanded = expandedId === material.id
        const isSelected = selectedIds.has(material.id)
        const lastUpdated = new Date(material.lastUpdatedAt)

        return (
          <React.Fragment key={material.id}>
            <tr
              onClick={() => onToggle(material.id)}
              className="cursor-pointer border-b border-[#F0F0EE] transition-colors duration-100"
              style={{ backgroundColor: isSelected ? '#F0FAF8' : isExpanded ? '#F0F0EE' : undefined }}
              onMouseEnter={(e) => { if (!isExpanded && !isSelected) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#F0F0EE' }}
              onMouseLeave={(e) => { if (!isExpanded && !isSelected) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '' }}
            >
              <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); onSelect(material.id) }}>
                <input type="checkbox" checked={isSelected} onChange={() => onSelect(material.id)} className="cursor-pointer accent-[#2DBDAA]" />
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
              <td className="px-4 py-3 text-[13px] text-gray-600">{material.widthMm} × {material.heightMm}mm</td>
              <td className="px-4 py-3 text-[13px] text-gray-600">{material.supplier?.name ?? '—'}</td>
              <td className="px-4 py-3 text-right">
                <span className="cost-cell tabular-nums text-gray-900">{formatCurrency(material.costPerSheet)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="cost-cell tabular-nums text-gray-500">{formatM2Cost(material.costPerM2)}</span>
              </td>
              <td className="px-4 py-3">
                <time dateTime={material.lastUpdatedAt} title={format(lastUpdated, 'dd MMM yyyy HH:mm')} className="text-[13px] text-gray-500">
                  {formatDistanceToNow(lastUpdated, { addSuffix: true })}
                </time>
              </td>
              <td className="px-4 py-3">
                <span className="text-[12px] text-gray-400">{sourceLabel(material.updateSource)}</span>
              </td>
              <td className="px-4 py-3 text-gray-400">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </td>
            </tr>

            {isExpanded && (
              <tr>
                <td colSpan={12} className="p-0 border-b border-[#E5E5E3]">
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
