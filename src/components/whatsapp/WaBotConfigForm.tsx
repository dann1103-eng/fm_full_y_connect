'use client'

import { useState, useTransition } from 'react'
import { updateBotConfig } from '@/app/actions/whatsapp'
import type { WaBotConfig, WaBotTool } from '@/types/db'

const ALL_TOOLS: Array<{ id: WaBotTool; label: string; description: string }> = [
  { id: 'get_client_context', label: 'get_client_context', description: 'Datos básicos del cliente vinculado (nombre, plan, estado).' },
  { id: 'get_requirements_summary', label: 'get_requirements_summary', description: 'Resumen del pipeline: cuántos contenidos en cada fase visible al cliente.' },
  { id: 'get_requirements_by_phase', label: 'get_requirements_by_phase', description: 'Lista detallada de contenidos en una fase del cliente.' },
  { id: 'get_requirement_detail', label: 'get_requirement_detail', description: 'Detalle de un contenido específico por id.' },
  { id: 'get_billing_status', label: 'get_billing_status', description: 'Ciclo actual: días restantes, estado de pago, plan, gracia.' },
  { id: 'get_unpaid_invoices', label: 'get_unpaid_invoices', description: 'Facturas emitidas sin pago.' },
  { id: 'send_payment_link', label: 'send_payment_link', description: 'Genera y envía el enlace de pago n1co de la factura pendiente. No crea facturas.' },
  { id: 'create_extra_invoice', label: 'create_extra_invoice', description: 'EMITE una factura de un extra de catálogo (contenido/cambios) + enlace de pago. Precios fijos; pide confirmación antes.' },
  { id: 'create_renewal_invoice', label: 'create_renewal_invoice', description: 'EMITE la factura de renovación del próximo ciclo (solo planes monthly; otros → handoff) + enlace de pago.' },
  { id: 'get_next_publications', label: 'get_next_publications', description: 'Próximas publicaciones / deadlines en N días.' },
  { id: 'check_request_eligibility', label: 'check_request_eligibility', description: 'Verifica si el cliente puede solicitar contenido y devuelve disponibilidad por tipo.' },
  { id: 'create_requirement_request', label: 'create_requirement_request', description: 'Crea una nueva solicitud de contenido en nombre del cliente.' },
  { id: 'get_changes_balance', label: 'get_changes_balance', description: 'Cuántos cambios le quedan al cliente (plan + créditos extra).' },
  { id: 'request_requirement_change', label: 'request_requirement_change', description: 'Registra una solicitud de cambio del cliente sobre un contenido.' },
  { id: 'request_reschedule', label: 'request_reschedule', description: 'Registra una solicitud de reprogramación de fecha de un contenido.' },
  { id: 'handoff_to_human', label: 'handoff_to_human', description: 'Pausa el bot y avisa al equipo.' },
  { id: 'submit_lead_info', label: 'submit_lead_info', description: 'Guarda datos recolectados del prospecto (empresa, interés, presupuesto, urgencia, notas).' },
]

const MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]

export function WaBotConfigForm({ config }: { config: WaBotConfig }) {
  const [systemPrompt, setSystemPrompt] = useState(config.system_prompt)
  const [model, setModel] = useState(config.model)
  const [temperature, setTemperature] = useState(config.temperature)
  const [maxTokens, setMaxTokens] = useState(config.max_tokens)
  const [enabledTools, setEnabledTools] = useState<WaBotTool[]>(config.enabled_tools)
  const [debounceSeconds, setDebounceSeconds] = useState(config.debounce_seconds)
  const [historyWindow, setHistoryWindow] = useState(config.history_window)
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function toggleTool(id: WaBotTool) {
    setEnabledTools((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  function handleSave() {
    setStatus(null)
    startTransition(async () => {
      const res = await updateBotConfig({
        audience: config.audience,
        systemPrompt,
        model,
        temperature,
        maxTokens,
        enabledTools,
        debounceSeconds,
        historyWindow,
      })
      if (res.ok) setStatus({ kind: 'ok', text: 'Guardado. El próximo mensaje usará esta configuración.' })
      else setStatus({ kind: 'err', text: res.error })
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
      className="space-y-6"
    >
      <section>
        <label htmlFor="f-system-prompt-3ee46f2c" className="block text-sm font-medium text-fm-on-surface mb-1">System prompt</label>
        <textarea id="f-system-prompt-3ee46f2c"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={10}
          className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary font-mono"
        />
        <p className="text-xs text-fm-on-surface-variant mt-1">{systemPrompt.length} caracteres</p>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="f-modelo-a785c698" className="block text-sm font-medium text-fm-on-surface mb-1">Modelo</label>
          <select id="f-modelo-a785c698"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-temperature-temperature-tofixe-57bffceb" className="block text-sm font-medium text-fm-on-surface mb-1">
            Temperature ({temperature.toFixed(2)})
          </label>
          <input id="f-temperature-temperature-tofixe-57bffceb"
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label htmlFor="f-max-tokens-respuesta-281673b1" className="block text-sm font-medium text-fm-on-surface mb-1">Max tokens (respuesta)</label>
          <input id="f-max-tokens-respuesta-281673b1"
            type="number"
            min={64}
            max={8192}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
          />
        </div>
        <div>
          <label htmlFor="f-debounce-segundos-38970d8e" className="block text-sm font-medium text-fm-on-surface mb-1">Debounce (segundos)</label>
          <input id="f-debounce-segundos-38970d8e"
            type="number"
            min={0}
            max={60}
            value={debounceSeconds}
            onChange={(e) => setDebounceSeconds(Number(e.target.value))}
            className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
          />
          <p className="text-xs text-fm-on-surface-variant mt-1">
            Tiempo de espera para agrupar mensajes consecutivos del usuario antes de responder.
          </p>
        </div>
        <div>
          <label htmlFor="f-memoria-de-chat-mensajes-9632282f" className="block text-sm font-medium text-fm-on-surface mb-1">Memoria de chat (mensajes)</label>
          <input id="f-memoria-de-chat-mensajes-9632282f"
            type="number"
            min={0}
            max={100}
            value={historyWindow}
            onChange={(e) => setHistoryWindow(Number(e.target.value))}
            className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
          />
          <p className="text-xs text-fm-on-surface-variant mt-1">
            Cuántos mensajes anteriores se pasan al modelo como contexto.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-fm-on-surface mb-2">Herramientas habilitadas</h2>
        <ul className="space-y-2">
          {ALL_TOOLS.map((t) => (
            <li key={t.id} className="flex items-start gap-3 p-3 rounded-md border border-fm-outline-variant/40 bg-fm-surface-container-low">
              <input
                type="checkbox"
                checked={enabledTools.includes(t.id)}
                onChange={() => toggleTool(t.id)}
                className="mt-1"
              />
              <div className="min-w-0">
                <code className="text-sm font-mono text-fm-on-surface">{t.label}</code>
                <p className="text-xs text-fm-on-surface-variant">{t.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center justify-between">
        <p
          className={
            status?.kind === 'ok'
              ? 'text-sm text-green-700'
              : status?.kind === 'err'
                ? 'text-sm text-red-700'
                : 'text-sm text-fm-on-surface-variant'
          }
        >
          {status?.text ?? 'Los cambios se aplican al próximo job que reclame el worker.'}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 text-sm rounded-md bg-fm-primary text-white disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </form>
  )
}
