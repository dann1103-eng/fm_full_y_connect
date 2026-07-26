import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { InvoicePDF } from '@/components/billing/InvoicePDF'
import type { Invoice, InvoiceItem } from '@/types/db'

/**
 * Generación del PDF de una factura SIN gate de autenticación: el llamador es
 * responsable de validar el scope.
 *
 * Se divide en tres piezas a propósito:
 *  - `fetchInvoiceForPdf` para poder AUTORIZAR entre la carga y el render
 *    (la ruta HTTP usa invoice.client_id para decidir permisos antes de gastar
 *    el render).
 *  - `renderInvoicePdf` para renderizar datos ya cargados.
 *  - `renderInvoicePdfBuffer` que compone ambas, para los flujos server-side
 *    con service role (recordatorio de vencimiento, bot de WhatsApp), donde el
 *    scope ya viene validado por el propio job.
 */

export interface InvoicePdfData {
  invoice: Invoice
  items: InvoiceItem[]
}

/** Carga la factura y sus líneas. Devuelve null si la factura no existe. */
export async function fetchInvoiceForPdf(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<InvoicePdfData | null> {
  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return null

  const { data: items } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('sort_order')

  return { invoice: invoice as Invoice, items: (items ?? []) as InvoiceItem[] }
}

/** Renderiza el PDF a partir de datos ya cargados. */
export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoicePDF invoice={data.invoice} items={data.items} />)
}

/**
 * Carga + renderiza en un solo paso. Para llamadores que ya validaron el scope
 * (jobs con service role). Devuelve null si la factura no existe.
 */
export async function renderInvoicePdfBuffer(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<{ buffer: Buffer; invoice: Invoice; items: InvoiceItem[] } | null> {
  const data = await fetchInvoiceForPdf(supabase, invoiceId)
  if (!data) return null
  const buffer = await renderInvoicePdf(data)
  return { buffer, ...data }
}
