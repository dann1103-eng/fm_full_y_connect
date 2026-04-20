'use client'

import { useEffect, useRef, useState } from 'react'
import { isoDateStr } from '@/lib/domain/time'

export type DateRangePreset = 'day' | 'week' | 'month' | 'custom'

export interface DateRangeValue {
  start: string   // ISO datetime
  end: string     // ISO datetime (exclusive)
  preset: DateRangePreset
}

interface Props {
  value: DateRangeValue
  onChange: (v: DateRangeValue) => void
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function dayRange(now = new Date()): DateRangeValue {
  const start = startOfDay(now)
  const end = addDays(start, 1)
  return { start: start.toISOString(), end: end.toISOString(), preset: 'day' }
}

export function weekRange(now = new Date()): DateRangeValue {
  const today = startOfDay(now)
  const dayOfWeek = (today.getDay() + 6) % 7 // Monday = 0
  const start = addDays(today, -dayOfWeek)
  const end = addDays(start, 7)
  return { start: start.toISOString(), end: end.toISOString(), preset: 'week' }
}

export function monthRange(now = new Date()): DateRangeValue {
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return { start: start.toISOString(), end: end.toISOString(), preset: 'month' }
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })
}

function displayLabel(v: DateRangeValue): string {
  const endDate = addDays(new Date(v.end), -1).toISOString()
  return `${fmt(v.start)} — ${fmt(endDate)}`
}

export function DateRangePicker({ value, onChange }: Props) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customStart, setCustomStart] = useState(isoDateStr(new Date(value.start)))
  const [customEnd, setCustomEnd] = useState(isoDateStr(addDays(new Date(value.end), -1)))
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!customOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setCustomOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [customOpen])

  function applyCustom() {
    if (!customStart || !customEnd) return
    const start = new Date(customStart)
    start.setHours(0, 0, 0, 0)
    const end = addDays(new Date(customEnd), 1)
    end.setHours(0, 0, 0, 0)
    onChange({ start: start.toISOString(), end: end.toISOString(), preset: 'custom' })
    setCustomOpen(false)
  }

  const presets: { id: DateRangePreset; label: string; build: () => DateRangeValue }[] = [
    { id: 'day', label: 'Hoy', build: () => dayRange() },
    { id: 'week', label: 'Semana', build: () => weekRange() },
    { id: 'month', label: 'Mes', build: () => monthRange() },
  ]

  return (
    <div className="relative flex items-center gap-2">
      <div className="flex items-center gap-1 p-1 bg-white border border-[#dfe3e6] rounded-full">
        {presets.map((p) => {
          const active = value.preset === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.build())}
              className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors ${
                active ? 'bg-[#00675c] text-white' : 'text-[#595c5e] hover:bg-[#f5f7f9]'
              }`}
            >
              {p.label}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setCustomOpen((o) => !o)}
          className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors flex items-center gap-1 ${
            value.preset === 'custom' ? 'bg-[#00675c] text-white' : 'text-[#595c5e] hover:bg-[#f5f7f9]'
          }`}
        >
          <span className="material-symbols-outlined text-sm">calendar_month</span>
          Personalizado
        </button>
      </div>

      <span className="text-xs text-[#595c5e] whitespace-nowrap">{displayLabel(value)}</span>

      {customOpen && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-2 z-20 bg-white border border-[#dfe3e6] rounded-2xl p-4 shadow-lg flex flex-col gap-3 min-w-[280px]"
        >
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Desde</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-2 border border-[#dfe3e6] rounded-lg text-sm text-[#2c2f31] focus:outline-none focus:border-[#00675c]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Hasta</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-2 border border-[#dfe3e6] rounded-lg text-sm text-[#2c2f31] focus:outline-none focus:border-[#00675c]"
            />
          </div>
          <button
            type="button"
            onClick={applyCustom}
            className="px-4 py-2 bg-[#00675c] text-white text-sm font-bold rounded-full hover:bg-[#005047] transition-colors"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  )
}
