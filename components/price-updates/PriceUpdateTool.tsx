'use client'

import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, AlertCircle, CheckCircle, Upload, FileText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ReviewTable } from './ReviewTable'
import { ContextPanel } from './ContextPanel'
import { PerspexReviewPanel } from './PerspexReviewPanel'
import type { ParseResult, BulkUpdateResponse, PerspexParseResult } from '@/types'

type LeftTab = 'email' | 'lathams' | 'perspex' | 'context'

export function PriceUpdateTool() {
  const [activeTab, setActiveTab] = useState<LeftTab>('email')
  const [emailBody, setEmailBody] = useState('')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [commitResult, setCommitResult] = useState<BulkUpdateResponse | null>(null)
  const [lathamsFile, setLathamsFile] = useState<File | null>(null)
  const [perspexFile, setPerspexFile] = useState<File | null>(null)
  const [perspexResult, setPerspexResult] = useState<PerspexParseResult | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPerspexDragging, setIsPerspexDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const perspexFileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const parseMutation = useMutation<ParseResult, Error, string>({
    mutationFn: async (body) => {
      const res = await fetch('/api/parse-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailBody: body }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Parse failed')
      }
      return res.json()
    },
    onSuccess: (result) => {
      setParseResult(result)
      setCommitResult(null)
    },
  })

  const lathamsMutation = useMutation<ParseResult, Error, File>({
    mutationFn: async (file) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/parse-pdf-lathams', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Parse failed')
      }
      return res.json()
    },
    onSuccess: (result) => {
      setParseResult(result)
      setCommitResult(null)
    },
  })

  const perspexMutation = useMutation<PerspexParseResult, Error, File>({
    mutationFn: async (file) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/parse-pdf-perspex', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Parse failed')
      }
      return res.json()
    },
    onSuccess: (result) => {
      setPerspexResult(result)
      setCommitResult(null)
    },
  })

  function handleParse() {
    if (!emailBody.trim()) return
    setParseResult(null)
    setCommitResult(null)
    parseMutation.mutate(emailBody)
  }

  function handleLathamsParse() {
    if (!lathamsFile) return
    setParseResult(null)
    setCommitResult(null)
    lathamsMutation.mutate(lathamsFile)
  }

  function handleCommitSuccess(result: BulkUpdateResponse) {
    setCommitResult(result)
    queryClient.invalidateQueries({ queryKey: ['materials'] })
    queryClient.invalidateQueries({ queryKey: ['staged-changes'] })
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') setLathamsFile(file)
  }

  function handlePerspexDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsPerspexDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') setPerspexFile(file)
  }

  const hasContent = emailBody.trim().length > 0
  const isPending = parseMutation.isPending || lathamsMutation.isPending || perspexMutation.isPending
  const parseError = parseMutation.error ?? lathamsMutation.error ?? perspexMutation.error

  return (
    <div className="flex gap-6 h-full overflow-hidden">
      {/* Left panel — 38% */}
      <div className="w-[38%] shrink-0 flex flex-col gap-4 overflow-y-auto pr-1">
        <div className="bg-white rounded-xl border border-[#E5E5E3] overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-[#E5E5E3]">
            {([
              { id: 'email', label: 'Email' },
              { id: 'lathams', label: 'Lathams PDF' },
              { id: 'perspex', label: 'Perspex PDF' },
              { id: 'context', label: 'Context' },
            ] as { id: LeftTab; label: string }[]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-[12px] font-semibold tracking-wide transition-colors ${
                  activeTab === tab.id
                    ? 'text-[#2DBDAA] border-b-2 border-[#2DBDAA] -mb-px'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {activeTab === 'email' ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Paste Supplier Email
                  </label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Paste the full supplier price update email here…"
                    className="w-full h-64 px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 border border-[#E5E5E3] rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA] leading-relaxed"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-gray-400">
                    {hasContent ? `${emailBody.trim().split(/\s+/).length} words` : 'No content'}
                  </span>
                  <div className="flex items-center gap-2">
                    {hasContent && (
                      <button
                        type="button"
                        onClick={() => { setEmailBody(''); setParseResult(null); setCommitResult(null) }}
                        className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <Button
                      variant="primary"
                      size="md"
                      disabled={!hasContent || parseMutation.isPending}
                      loading={parseMutation.isPending}
                      onClick={handleParse}
                    >
                      <RefreshCw size={14} />
                      Parse Email
                    </Button>
                  </div>
                </div>
              </div>
            ) : activeTab === 'lathams' ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Upload Lathams Quotation PDF
                  </label>
                  {/* Drop zone */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex flex-col items-center justify-center gap-2 h-36 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                      isDragging
                        ? 'border-[#2DBDAA] bg-[#E6F4F1]'
                        : lathamsFile
                        ? 'border-[#2DBDAA]/40 bg-[#F0FAF8]'
                        : 'border-[#E5E5E3] bg-[#F7F7F5] hover:border-[#2DBDAA]/40 hover:bg-[#F0FAF8]'
                    }`}
                  >
                    {lathamsFile ? (
                      <>
                        <FileText size={24} className="text-[#2DBDAA]" />
                        <p className="text-[13px] font-medium text-gray-700">{lathamsFile.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {(lathamsFile.size / 1024).toFixed(0)} KB — click to replace
                        </p>
                      </>
                    ) : (
                      <>
                        <Upload size={24} className="text-gray-400" />
                        <p className="text-[13px] text-gray-500">Drop PDF here or click to browse</p>
                        <p className="text-[11px] text-gray-400">James Latham quotations only</p>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) setLathamsFile(file)
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-gray-400">
                    {lathamsFile ? 'Ready to parse' : 'No file selected'}
                  </span>
                  <div className="flex items-center gap-2">
                    {lathamsFile && (
                      <button
                        type="button"
                        onClick={() => { setLathamsFile(null); setParseResult(null); setCommitResult(null) }}
                        className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <Button
                      variant="primary"
                      size="md"
                      disabled={!lathamsFile || lathamsMutation.isPending}
                      loading={lathamsMutation.isPending}
                      onClick={handleLathamsParse}
                    >
                      <RefreshCw size={14} />
                      Parse PDF
                    </Button>
                  </div>
                </div>
              </div>
            ) : activeTab === 'perspex' ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Upload Perspex Rate Card PDF
                  </label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsPerspexDragging(true) }}
                    onDragLeave={() => setIsPerspexDragging(false)}
                    onDrop={handlePerspexDrop}
                    onClick={() => perspexFileInputRef.current?.click()}
                    className={`flex flex-col items-center justify-center gap-2 h-36 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                      isPerspexDragging
                        ? 'border-[#2DBDAA] bg-[#E6F4F1]'
                        : perspexFile
                        ? 'border-[#2DBDAA]/40 bg-[#F0FAF8]'
                        : 'border-[#E5E5E3] bg-[#F7F7F5] hover:border-[#2DBDAA]/40 hover:bg-[#F0FAF8]'
                    }`}
                  >
                    {perspexFile ? (
                      <>
                        <FileText size={24} className="text-[#2DBDAA]" />
                        <p className="text-[13px] font-medium text-gray-700">{perspexFile.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {(perspexFile.size / 1024).toFixed(0)} KB — click to replace
                        </p>
                      </>
                    ) : (
                      <>
                        <Upload size={24} className="text-gray-400" />
                        <p className="text-[13px] text-gray-500">Drop PDF here or click to browse</p>
                        <p className="text-[11px] text-gray-400">Perspex Distribution rate cards only</p>
                      </>
                    )}
                  </div>
                  <input
                    ref={perspexFileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) setPerspexFile(file)
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-gray-400">
                    {perspexFile ? 'Ready to parse' : 'No file selected'}
                  </span>
                  <div className="flex items-center gap-2">
                    {perspexFile && (
                      <button
                        type="button"
                        onClick={() => { setPerspexFile(null); setPerspexResult(null); setCommitResult(null) }}
                        className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <Button
                      variant="primary"
                      size="md"
                      disabled={!perspexFile || perspexMutation.isPending}
                      loading={perspexMutation.isPending}
                      onClick={() => { if (perspexFile) { setPerspexResult(null); setCommitResult(null); perspexMutation.mutate(perspexFile) } }}
                    >
                      <RefreshCw size={14} />
                      Parse PDF
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <ContextPanel />
            )}
          </div>
        </div>

        {/* Parse status */}
        {isPending && (
          <div className="bg-white rounded-xl border border-[#E5E5E3] p-4">
            <div className="flex items-center gap-3">
              <svg className="animate-spin h-4 w-4 text-[#2DBDAA]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <div>
                <p className="text-[13px] font-medium text-gray-700">
                  {lathamsMutation.isPending ? 'Parsing Lathams PDF with Claude…' : perspexMutation.isPending ? 'Parsing Perspex rate card with Claude…' : 'Parsing email with Claude…'}
                </p>
                <p className="text-[12px] text-gray-400">This usually takes 10–30 seconds</p>
              </div>
            </div>
          </div>
        )}

        {(parseMutation.isError || lathamsMutation.isError) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-medium text-red-700">Parse failed</p>
                <p className="text-[12px] text-red-600 mt-0.5">{parseError?.message}</p>
              </div>
            </div>
          </div>
        )}

        {parseResult && !parseMutation.isPending && (
          <div className="bg-white rounded-xl border border-[#E5E5E3] p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#2DBDAA]" />
              <p className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
                Parse Summary
              </p>
            </div>
            <div className="space-y-2">
              {parseResult.manufacturers.length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Suppliers</p>
                  <div className="flex flex-wrap gap-1">
                    {parseResult.manufacturers.map((m) => (
                      <span
                        key={m}
                        className="text-[12px] px-2 py-0.5 bg-[#F7F7F5] border border-[#E5E5E3] rounded text-gray-700"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Stat label="Matched" value={parseResult.resolved.length} color="text-[#1A7A6A]" />
                <Stat label="Unresolved" value={parseResult.unresolved.length} color="text-[#B07D00]" />
              </div>
            </div>
          </div>
        )}

        {commitResult && (
          <div className={`rounded-xl p-4 border ${commitResult.errors.length > 0 ? 'bg-red-50 border-red-200' : 'bg-[#E6F4F1] border-[#2DBDAA]/30'}`}>
            <div className="flex items-start gap-2">
              <CheckCircle size={15} className={`mt-0.5 shrink-0 ${commitResult.errors.length > 0 ? 'text-red-400' : 'text-[#2DBDAA]'}`} />
              <div className="flex-1">
                <p className={`text-[13px] font-medium ${commitResult.errors.length > 0 ? 'text-red-700' : 'text-[#1A5C52]'}`}>Changes committed</p>
                <p className={`text-[12px] mt-0.5 ${commitResult.errors.length > 0 ? 'text-red-600' : 'text-[#2A7A6E]'}`}>
                  {commitResult.updated} updated immediately
                  {commitResult.staged > 0 && `, ${commitResult.staged} staged for later`}
                  {commitResult.errors.length > 0 && `, ${commitResult.errors.length} error(s)`}
                </p>
                {commitResult.errors.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {commitResult.errors.map((e, i) => (
                      <li key={i} className="text-[11px] text-red-600 font-mono bg-red-100 rounded px-2 py-1">
                        {e.materialId.slice(0, 8)}…: {e.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right panel — 62% */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {!parseResult && !perspexResult && !isPending && (
          <div className="flex items-center justify-center h-full min-h-64">
            <div className="text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ backgroundColor: '#EEEEEC' }}
              >
                <RefreshCw size={20} className="text-gray-400" />
              </div>
              <p className="text-[13px] font-medium text-gray-500">Nothing parsed yet</p>
              <p className="text-[12px] text-gray-400 mt-1">
                Paste an email or upload a PDF on the left
              </p>
            </div>
          </div>
        )}

        {isPending && (
          <div className="flex items-center justify-center h-full min-h-64">
            <div className="text-center">
              <svg className="animate-spin h-8 w-8 text-[#2DBDAA] mx-auto mb-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-[13px] text-gray-500">
                {lathamsMutation.isPending ? 'Claude is reading the Lathams PDF…' : perspexMutation.isPending ? 'Claude is reading the Perspex rate card…' : 'Claude is reading the email…'}
              </p>
            </div>
          </div>
        )}

        {parseResult && !parseMutation.isPending && (
          <div className="fade-in flex flex-col flex-1 min-h-0">
            {parseResult.resolved.length === 0 && parseResult.unresolved.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <p className="text-[13px] font-medium text-gray-500">No price changes found</p>
                  <p className="text-[12px] text-gray-400 mt-1">
                    The email may not contain recognizable price update data.
                  </p>
                </div>
              </div>
            ) : (
              <ReviewTable
                parseResult={parseResult}
                onCommitSuccess={handleCommitSuccess}
              />
            )}
          </div>
        )}

        {perspexResult && !perspexMutation.isPending && (
          <div className="fade-in flex flex-col flex-1 min-h-0">
            {perspexResult.productGroups.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <p className="text-[13px] font-medium text-gray-500">No price data found</p>
                  <p className="text-[12px] text-gray-400 mt-1">
                    Check the PDF is a Perspex Distribution rate card.
                  </p>
                </div>
              </div>
            ) : (
              <PerspexReviewPanel
                result={perspexResult}
                onCommitSuccess={handleCommitSuccess}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[#F7F7F5] rounded-lg px-3 py-2">
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
    </div>
  )
}
